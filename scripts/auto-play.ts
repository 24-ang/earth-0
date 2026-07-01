/**
 * earth-0 Auto-Play 交互测试 ⚠️ WIP — 跳过 GM LLM，测试引擎+叙事一致性
 *
 * 现状：
 * - 玩家 LLM 生成文本动作 → 正则匹配关键词调引擎函数（move/setPlayerLocation）
 * - 渲染 LLM 把引擎结算结果转为叙事正文
 * - Review LLM 读完整日志找 bug
 *
 * 已知限制：
 * - 跳过了 GM LLM（三段式 Settlement 阶段），用正则替代工具调用判断
 * - 只处理了移动意图，未覆盖偷窃/购买/战斗/调查等工具
 * - 玩家 LLM 和渲染 LLM 用同一 API，存在闭环风险
 *
 * 正解：让 CC / 有工具调用能力的 agent 直接玩 earth-0，完整跑 GM→工具→渲染三段式
 *
 * 用法: npx tsx scripts/auto-play.ts
 * 环境: 需要 DEEPSEEK_API_KEY
 *
 * CONFIG 区可调: maxTurns / turnMinutes / 模型 / 从存档继续
 */

// ── 配置 ──
const CONFIG = {
  maxTurns: 10,                          // 跑多少回合
  turnMinutes: 10,                       // 每回合推进分钟数
  playerModel: "deepseek-chat",          // deepseek-chat→flash 别名；v4-flash/v4-pro 在Anthropic端点返回空
  narrativeModel: "deepseek-chat",       // 同上
  reviewModel: "deepseek-chat",          // 同上
  startFromSave: false,                  // true=从已有存档继续
  logFile: "auto-play-log.md",
};

// ── LLM 直调（不走 pi 框架） ──
async function callLLM(prompt: string, maxTokens: number, model: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  // 与 helpers.ts fallback 一致：Anthropic 兼容端点
  const baseUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/anthropic/v1/messages";

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json() as any;
  return data?.content?.[0]?.text?.trim() || "";
}

// ── 主流程 ──
async function main() {
  console.log("=== earth-0 Auto-Play ===\n");
  console.log(`回合数: ${CONFIG.maxTurns} | 每回合推进: ${CONFIG.turnMinutes}分钟`);
  console.log(`玩家模型: ${CONFIG.playerModel} | 叙事模型: ${CONFIG.narrativeModel}\n`);

  // 动态导入引擎
  const state = await import("../engine/state.ts");
  const { resetState, loadState, saveState, getNearbyNPCs, getOrCreateNPC,
          updateNPCSchedules, refreshWeather, addMemoryTag, appendShortTermBuffer,
          stampRoom, cleanupTempNPCs, drainToolCalls, buildStatePrompt, findCharacter,
          getNPCOutfitDesc, getNpcCurrentAge, getBodyForAge, getAppearanceForAge,
          isSameLocation, recordTurnLog } = state;

  const gameState = new Proxy({}, {
    get(_, prop) {
      return (state.gameState as any)[prop];
    },
    set(_, prop, value) {
      (state.gameState as any)[prop] = value;
      return true;
    }
  }) as any;

  const { advanceMinutes } = await import("../engine/time.ts");
  const { runWorldTick } = await import("../engine/tick.ts");
  const { lintProse } = await import("../engine/audit/lint-rules.ts");
  const { buildNpcAgentContext } = await import("../tools/state/spawn_npc_agent.ts");
  const { generateCompletion, getNpcAgentModel, NPC_MOTIVATION_PROMPT,
          getSocialContextTagsForNPC, recordNpcAgentAction, setLastRenderedProse } = await import("../tools/helpers.ts");
  const { detectInteractionMode } = await import("../engine/detect-mode.ts");
  const fs = await import("node:fs");

  // ── 初始化（复刻 init_game 完整逻辑）──
  if (CONFIG.startFromSave) {
    if (!loadState()) {
      console.log("未找到存档，开始新游戏。");
      CONFIG.startFromSave = false;
    } else {
      console.log(`从存档恢复: ${gameState.time.game_date} 回合 ${gameState.turn}`);
    }
  }
  if (!CONFIG.startFromSave) {
    resetState();
    // 以下完全复刻 tools/state/init_game.ts
    gameState.player.relationships = {};
    gameState.player.inventory = [];
    gameState.player.equipment = {};
    gameState.player.skills = {};
    gameState.player.abilities = {};
    gameState.player.wounds = [];
    gameState.player.party = [];
    gameState.player.titles = [];
    gameState.player.funds = 0;
    gameState.player.fatigue = 0;
    gameState.player.resourcePools = undefined;
    gameState.npcs = {};
    gameState.flags = {};
    gameState.quests = {};
    gameState.active_hooks = [];
    gameState.completed_events = [];
    gameState.sexStates = {};
    gameState.player.name = "维";
    gameState.player.gender = "男";
    gameState.player.age = 17;
    gameState.player.attributes = { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10 };
    gameState.player.body = {
      height_cm: 170, weight_kg: 58, build: "标准", leg_type: "修长",
      skin: { base_tone: "普通", tan: 0, texture: "普通" },
    };
    const { getLifeStage } = await import("../engine/time.ts");
    gameState.time.player_age = 17;
    gameState.time.timeline_origin.age = 17;
    gameState.time.timeline_origin.year = 2018;
    gameState.time.game_date = "2018-04-07";
    gameState.time.minute_of_day = 480; // 早上 8:00
    gameState.time.player_stage = getLifeStage(17);
    const { setPlayerLocation, initPlayerGrid } = await import("../engine/state.ts");
    setPlayerLocation("千叶_住宅区");
    initPlayerGrid();
    await buildStatePrompt();
    saveState();
    console.log(`新游戏已初始化: ${gameState.player.name}（${gameState.player.age}岁 ${gameState.player.gender}）→ ${gameState.player.location} ${gameState.time.game_date}`);
  }

  const logEntries: string[] = [];           // 完整日志（Review + 输出用）
  const narrativeHistory: string[] = [];     // 只有叙事正文（给「玩家」看的屏幕内容）
  const npcModelRaw = await getNpcAgentModel();
  const npcModel = npcModelRaw.includes("/") ? npcModelRaw.split("/")[1] : npcModelRaw;

  // ── 开幕叙事 ──
  if (!CONFIG.startFromSave) {
    const openingPrompt = [
      "你是文字 RPG 的叙事者。写一段游戏开场（150-200字，第三人称限知视角）。",
      `背景: 2018年4月7日早晨。17岁男高中生「维」在千叶住宅区的家门口。`,
      "今天是新学期第一天。天气是早春的晴天，微凉。",
      "用身体感官写——光线的角度、空气的温度、书包的重量。不要分析心理。",
    ].join("\n");
    let openingNarrative = "";
    try {
      openingNarrative = await callLLM(openingPrompt, 512, CONFIG.narrativeModel);
    } catch (e) {
      openingNarrative = "四月的早晨。维站在家门口，书包挂在右肩上。新学期第一天。";
    }
    logEntries.push(`## 序幕\n\n${openingNarrative}`);
    narrativeHistory.push(openingNarrative);
    console.log(`  开幕: ${openingNarrative.slice(0, 80)}...`);
  }

  // ── 主循环 ──
  for (let turn = 1; turn <= CONFIG.maxTurns; turn++) {
    console.log(`\n── 回合 ${turn}/${CONFIG.maxTurns} ──`);

    // 1. 场景快照（引擎用，不喂给玩家 agent）
    const nearbyNPCs = getNearbyNPCs(gameState.player.location, gameState.player.gridPos || [0, 0], 15);
    const nearbyNames = nearbyNPCs.map(n => n.name);
    const weather = `${gameState.weather?.type || "晴"} ${gameState.weather?.temp ?? 20}°C`;
    const timeLabel = ["凌晨","早晨","上午","中午","下午","傍晚","晚上","深夜"][Math.floor((gameState.time.minute_of_day ?? 480) / 180)] || "早晨";
    const sceneSummary = `位置:${gameState.player.location} | 时间:${gameState.time.game_date} ${timeLabel} | 天气:${weather} | 在场NPC:${nearbyNames.length > 0 ? nearbyNames.join("、") : "无"}`;

    // 2. 玩家 agent — 只看屏幕上的叙事文字，不看任何后台数据
    const isFirstTurn = turn === 1 && !CONFIG.startFromSave;
    let playerPrompt: string;
    if (isFirstTurn) {
      // 第一回合：只有开幕叙事
      playerPrompt = [
        narrativeHistory[narrativeHistory.length - 1],
        "",
        "（你正在玩一个文字冒险游戏。上面是屏幕上显示的内容。你想做什么？输入你的动作或对话。）",
      ].join("\n");
    } else {
      // 每回合：叙事正文 + 该知道的（你在哪、周围有谁）
      const hud = `[你当前在${gameState.player.location}。${nearbyNames.length > 0 ? "周围: " + nearbyNames.join("、") : "周围没有人。"}]`;
      playerPrompt = [
        narrativeHistory[narrativeHistory.length - 1],
        "",
        hud,
        "",
        "（你想做什么？）",
      ].join("\n");
    }

    let playerAction = "";
    try {
      playerAction = await callLLM(playerPrompt, 80, CONFIG.playerModel);
      playerAction = playerAction.replace(/^["'「]|["'」]$/g, "").trim();
    } catch (e) {
      console.error("  玩家 LLM 调用失败:", String(e).slice(0, 100));
    }
    // LLM 返回空或失败 → 兜底（不重复）
    if (!playerAction) {
      const alreadyDone = logEntries.slice(-2).map(e => {
        const m = e.match(/\*\*玩家动作\*\*: (.+)/);
        return m ? m[1] : "";
      });
      const fallbacks: string[] = [];
      if (nearbyNames.length > 0) {
        for (const n of nearbyNames) {
          fallbacks.push(`走向${n}，打了个招呼。`);
          fallbacks.push(`对着${n}说："你好。"`);
        }
      }
      if (gameState.player.location !== "总武高") fallbacks.push("朝学校的方向走去。");
      if (gameState.player.location !== "住宅区") fallbacks.push("朝住宅区走去。");
      fallbacks.push("环顾四周。", "看看附近有什么。", "拿出手机看了一眼。");
      // 选一个没做过的
      playerAction = fallbacks.find(f => !alreadyDone.some(d => d === f)) || fallbacks[0] || "环顾四周。";
    }
    console.log(`  玩家: ${playerAction.slice(0, 80)}`);

    // 2.5 移动意图检测：纯字符串匹配，不用正则
    const knownLocations: Record<string, string> = {
      "学校": "总武高", "总武高": "总武高", "校门": "总武高", "教室": "总武高",
      "便利店": "便利店", "商店街": "商店街", "车站": "车站", "站": "车站",
      "住宅区": "住宅区", "家": "住宅区", "回家": "住宅区",
      "公园": "公园", "图书馆": "图书馆",
    };
    let movedTo: string | null = null;
    for (const [keyword, loc] of Object.entries(knownLocations)) {
      if (!playerAction.includes(keyword)) continue;
      if (loc === gameState.player.location) continue;   // 已经在这里了，跳过
      // 检测移动意图动词
      const moveIntents = ["去", "前往", "走向", "出发去", "离开去", "朝", "到"];
      const hasMove = moveIntents.some(v =>
        playerAction.includes(v + keyword) || playerAction.includes(keyword + "方向")
      );
      if (hasMove) { movedTo = loc; break; }
    }
    // 如果卡在原地超过2回合 → 强制推到最近地点
    if (!movedTo) {
      const lastActions = logEntries.slice(-3).map(e => { const m = e.match(/\*\*玩家动作\*\*: (.+)/); return m ? m[1] : ""; });
      if (lastActions.length >= 2 && lastActions.slice(-2).every(a => a === lastActions[lastActions.length - 1])) {
        if (nearbyNames.length > 0) {
          movedTo = null; // 有NPC说不上话 → 不是移动问题
        } else if (gameState.player.location !== "总武高") {
          movedTo = "总武高";
        } else if (gameState.player.location !== "便利店") {
          movedTo = "便利店";
        }
      }
    }
    let travelMins = 0;
    if (movedTo) {
      const travelDist: Record<string, number> = { "总武高": 15, "便利店": 5, "商店街": 10, "车站": 10, "住宅区": 5, "公园": 10, "图书馆": 10 };
      travelMins = travelDist[movedTo] ?? 10;
      console.log(`  → 移动到: ${movedTo} (${travelMins}分钟)`);
    }

    // 3. 引擎管线
    drainToolCalls();
    const cleanupMsgs = cleanupTempNPCs("回合结束");
    const actualMinutes = travelMins > 0 ? travelMins : CONFIG.turnMinutes;  // 移动则消耗路程时间
    const result = advanceMinutes(gameState.time, actualMinutes);
    gameState.player.age = gameState.time.player_age;
    gameState.turn++;
    if (movedTo) {
      const { setPlayerLocation, initPlayerGrid } = await import("../engine/state.ts");
      setPlayerLocation(movedTo);
      initPlayerGrid();
      // 重新扫描新地点的 NPC
      const newNearby = getNearbyNPCs(movedTo, gameState.player.gridPos || [0, 0], 15);
      nearbyNames.length = 0;
      nearbyNames.push(...newNearby.map(n => n.name));
    }
    if (gameState.turn % 4 === 0) refreshWeather();
    const scheduleEvents = await updateNPCSchedules();
    await runWorldTick();
    stampRoom();
    gameState.player.fatigue = Math.min(100, (gameState.player.fatigue ?? 0) + Math.round(CONFIG.turnMinutes / 12));
    const modeResult = detectInteractionMode(gameState, nearbyNames.length);
    gameState.interactionMode = modeResult.interactionMode;
    saveState();

    // 4. NPC Agent 并行
    const npcResponses: string[] = [];
    if (nearbyNames.length > 0) {
      const npcTasks = nearbyNames.map(async (npcName) => {
        try {
          const otherNPCs = nearbyNames.filter(n => n !== npcName);
          const ctx = await buildNpcAgentContext(npcName, otherNPCs, undefined, playerAction);
          if (!ctx) return null;

          const { src, npc, rel, affection, stage, memories, curAge, body, outfit, app,
                  personality, socialTags, npcEventContext, npcLoreContext, npcImpressionsContext } = ctx;

          const promptParts = [
            `你是${npcName}。你现在正在${gameState.player.location}。`,
            `在场: 玩家${otherNPCs.length > 0 ? "、" + otherNPCs.join("、") : "（仅你一人）"}。`,
            `性格: ${personality || "（暂无）"}`,
            `外貌: ${[app?.hair_color, app?.hair_style].filter(Boolean).join("")}，${app?.eye_color ? app.eye_color + "眼睛" : ""}`,
            `穿着: ${outfit}`,
            `关系: ${stage}（好感${affection}）`,
            memories.length > 0 ? `过往记忆: ${memories.join("；")}` : "",
            npc.shortTermBuffer?.recentExchanges?.length > 0
              ? `即时对话: ${npc.shortTermBuffer.recentExchanges.join("\n")}` : "",
            npcEventContext ? `事件: ${npcEventContext}` : "",
            npcLoreContext,
            npcImpressionsContext,
            "",
            `当前场景: ${playerAction}`,
            socialTags ? `情境约束: ${socialTags}\n` : "",
            NPC_MOTIVATION_PROMPT,
          ].filter(Boolean);

          const prompt = promptParts.join("\n");
          const response = await callLLM(prompt, 512, npcModel);
          return { npcName, response: response || `${npcName}（沉默）`, outfit: outfit || "" };
        } catch (e) {
          console.error(`  NPC ${npcName} spawn 失败:`, e);
          return { npcName, response: `${npcName}（沉默）`, outfit: "" };
        }
      });

      const npcResults = (await Promise.all(npcTasks)).filter(Boolean) as { npcName: string; response: string; outfit: string }[];
      for (const r of npcResults) {
        if (!r.response.includes("（沉默）")) {
          npcResponses.push(`[${r.npcName}] ${r.response}`);
          await recordNpcAgentAction(r.npcName, r.response, r.outfit, gameState.player.location);
        }
      }
    }

    // 5. 叙事渲染
    const npcText = npcResponses.join("\n");
    const movedNote = movedTo ? `玩家移动到了: ${movedTo}。` : "";
    const npcNote = npcText ? `NPC说了:\n${npcText}` : "附近没有可对话的人物。";
    const directorsNote = [
      "以下是引擎本回合的结算结果。把它转成叙事。不要添加引擎没有产生的内容。",
      "",
      `【世界状态】`,
      `日期: ${gameState.time.game_date} | 时段: ${timeLabel} | 天气: ${weather}`,
      `主角: ${gameState.player.name}（${gameState.player.age}岁 ${gameState.player.gender}）`,
      `当前位置: ${gameState.player.location}`,
      `在场人物: ${nearbyNames.length > 0 ? nearbyNames.join("、") : "无"}`,
      "",
      `【本回合事件】`,
      `玩家做了: ${playerAction}`,
      movedNote,
      npcNote,
      "",
      `第三人称，100-200字。对话用「」。不写心理。不写比喻。主角名必须是"${gameState.player.name}"。`,
    ].filter(Boolean).join("\n");

    const renderPrompt = directorsNote;

    let narrative = "";
    try {
      narrative = await callLLM(renderPrompt, 2048, CONFIG.narrativeModel);
    } catch (e) {
      console.error("  叙事 LLM 调用失败:", e);
      narrative = `[渲染失败] 玩家${playerAction}。`;
    }

    // 6. Lint
    const lintResult = lintProse(narrative, gameState as any);
    if (lintResult.needsRetry) {
      const violations = lintResult.findings.map(f => `[${f.ruleId}] ${f.message || f.match}`).join("; ");
      console.log("  ⚠ Lint 拦截: " + violations.slice(0, 120));
      narrative = lintResult.prose || narrative;
    }

    // 7. 回写引擎状态
    setLastRenderedProse(narrative);
    recordTurnLog({
      playerAction,
      resolvedChanges: npcResponses.length > 0 ? `NPC回应: ${nearbyNames.join(",")}` : "无",
      sceneResult: narrative.slice(0, 80),
      openHooks: "无",
      nextPressure: "无",
      toolsCalled: drainToolCalls(),
    });

    try {
      const { reviewTurn } = await import("../engine/audit/review-agent.ts");
      await reviewTurn(null);
    } catch (e) {
      console.error("  Review Agent error in auto-play:", e);
    }

    // 8. 日志记录 + 叙事历史
    narrativeHistory.push(narrative);
    const logEntry = [
      `## 回合 ${turn}`,
      `- **时间**: ${gameState.time.game_date} ${result.timeOfDay}`,
      `- **地点**: ${gameState.player.location}`,
      `- **天气**: ${weather}`,
      `- **在场**: ${nearbyNames.length > 0 ? nearbyNames.join("、") : "无人"}`,
      `- **玩家动作**: ${playerAction}`,
      `- **疲劳**: ${gameState.player.fatigue}`,
      "",
      narrative,
      npcResponses.length > 0 ? `\n*NPC回应:*\n${npcResponses.map(r => `  ${r}`).join("\n")}` : "",
      lintResult.findings.length > 0 ? `\n*Lint:*\n${lintResult.findings.map(f => `  [${f.severity}] ${f.ruleId}: ${f.match.slice(0, 40)}`).join("\n")}` : "",
    ].join("\n");
    logEntries.push(logEntry);

    console.log(`  叙事: ${narrative.slice(0, 80)}...`);
    saveState();
  }

  // ── 9. Review ──
  console.log("\n=== Review 分析 ===");
  const reviewPrompt = [
    "你是 QA。阅读以下游戏日志，找出问题:",
    "- NPC 是否说了不符合性格的话？",
    "- 叙事是否暴露了未揭示的秘密？",
    "- 时间/地点/人物是否一致？",
    "- 对话是否出现复读机现象？",
    "- 记忆召回是否有明显错误？",
    "",
    logEntries.join("\n\n---\n\n"),
    "",
    "输出格式（无问题请写「无」）:",
    "## 发现的问题",
    "1. ...",
    "2. ...",
  ].join("\n");

  let review = "";
  try {
    review = await callLLM(reviewPrompt, 2048, CONFIG.reviewModel);
  } catch (e) {
    console.error("  Review LLM 调用失败:", e);
    review = "Review 调用失败。";
  }
  console.log(review);

  // ── 写日志 ──
  const fullLog = [
    "# earth-0 Auto-Play 日志",
    `\n配置: ${CONFIG.maxTurns}回合 × ${CONFIG.turnMinutes}分钟 | 玩家模型: ${CONFIG.playerModel} | 叙事模型: ${CONFIG.narrativeModel}`,
    `开始时间: ${gameState.time.game_date} | 疲劳: ${gameState.player.fatigue}`,
    "",
    ...logEntries,
    "",
    "---",
    "",
    "## Review 报告",
    review,
  ].join("\n");

  fs.writeFileSync(CONFIG.logFile, fullLog, "utf-8");
  console.log(`\n日志已写入: ${CONFIG.logFile}`);
  console.log(`=== 完成: ${CONFIG.maxTurns} 回合 ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
