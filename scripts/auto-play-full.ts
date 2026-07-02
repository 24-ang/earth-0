/**
 * earth-0 Auto-Play 完整三段式交互测试
 *
 * 包含完整的三段式管线：
 * 1. Phase 1 — 分类 LLM → JSON → 引擎执行工具
 * 2. Phase 2 — 自动 spawn 独立 NPC Agent（利用长期记忆和短期缓冲）
 * 3. 交互检测与 GAL 场景管理
 * 4. Phase 3 — 渲染 LLM 零工具裸 stream 渲染 + Lint 过滤与 Retry
 */

const CONFIG = {
  maxTurns: 5,                           // 跑 5 回合，方便观察和节约 token
  model: "deepseek-chat",                // 使用 deepseek-chat
  logFile: "auto-play-full-log.md",
};

async function callLLM(prompt: string, maxTokens: number, systemPrompt?: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = "https://api.deepseek.com/v1/chat/completions";

  const messages: any[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      max_tokens: maxTokens,
      messages,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json() as any;
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function main() {
  console.log("=== earth-0 完整三段式 Auto-Play ===\n");
  console.log(`回合数: ${CONFIG.maxTurns}`);
  console.log(`模型: ${CONFIG.model}\n`);

  // 设置环境变量以使 helpers.ts 能够用正确的 DeepSeek API 拨打网络请求
  process.env.DEEPSEEK_API_URL = "https://api.deepseek.com/anthropic/v1/messages";
  process.env.DEEPSEEK_MODEL = "deepseek-chat";

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

  const { runPhase1 } = await import("../engine/phase1-classifier.ts");
  const { buildRenderSystemPrompt } = await import("../engine/phase3-render.ts");
  const { detectInteractionMode, analyzeNpcResponses } = await import("../engine/detect-mode.ts");
  const { lintProse } = await import("../engine/audit/lint-rules.ts");
  const { runWorldTick } = await import("../engine/tick.ts");
  const { buildNpcAgentContext } = await import("../tools/state/spawn_npc_agent.ts");
  const { recordNpcAgentAction, NPC_MOTIVATION_PROMPT, setLastRenderedProse } = await import("../tools/helpers.ts");
  const fs = await import("node:fs");

  // 初始化新游戏
  resetState();
  gameState.player.relationships = {};
  gameState.player.inventory = [];
  gameState.player.equipment = {
    top: { name: "普通高校校服外套" },
    shirt: { name: "白色棉质内搭" },
    bottom: { name: "制服长裤" },
    feet: { name: "学生乐福鞋" }
  };
  gameState.player.skills = {};
  gameState.player.abilities = {};
  gameState.player.wounds = [];
  gameState.player.party = [];
  gameState.player.titles = [];
  gameState.player.funds = 1000; // 给 1000 円以便可以买茶
  gameState.player.fatigue = 0;
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

  console.log(`新游戏已初始化: ${gameState.player.name} → ${gameState.player.location} ${gameState.time.game_date}`);

  const logEntries: string[] = [];
  const narrativeHistory: string[] = [];

  // ── 开幕叙事 ──
  const openingPrompt = [
    "你是文字 RPG 的叙事者。写一段游戏开场（150-200字，第三人称限知视角）。",
    `背景: 2018年4月7日早晨。17岁男高中生「维」在千叶住宅区的家门口。`,
    "今天是新学期第一天。天气是早春的晴天，微凉。",
    "用身体感官写——光线的角度、空气的温度、书包的重量。不要分析心理。",
  ].join("\n");
  let openingNarrative = "";
  try {
    openingNarrative = await callLLM(openingPrompt, 512);
  } catch (e) {
    openingNarrative = "四月的早晨。维站在家门口，书包挂在右肩上。新学期第一天。";
  }
  logEntries.push(`## 序幕\n\n${openingNarrative}`);
  narrativeHistory.push(openingNarrative);
  console.log(`  开幕: ${openingNarrative.slice(0, 80)}...`);

  // ── 主循环 ──
  for (let turn = 1; turn <= CONFIG.maxTurns; turn++) {
    console.log(`\n── 回合 ${turn}/${CONFIG.maxTurns} ──`);

    // 1. 玩家 Agent 生成动作描述 (通过限制玩家 LLM 的 Prompt，告诉它当前的世界状态，但严禁让其瞎编未发生的事)
    const nearbyNPCsBefore = getNearbyNPCs(gameState.player.location, gameState.player.gridPos || [0, 0], 15);
    const nearbyNamesBefore = nearbyNPCsBefore.map(n => n.name);

    const playerPrompt = [
      `你是一个文字 RPG 游戏的玩家（扮演主角“维”，17岁高中生）。`,
      `这是当前屏幕上的叙事正文：`,
      narrativeHistory[narrativeHistory.length - 1],
      "",
      `【当前状态】`,
      `日期时间: ${gameState.time.game_date} 早上`,
      `当前位置: ${gameState.player.location}`,
      `周围人物: ${nearbyNamesBefore.length > 0 ? nearbyNamesBefore.join("、") : "无"}`,
      `金钱余额: ${gameState.player.funds} 円`,
      "",
      `【重要动作指南】`,
      `1. 你只能发出自己的动作、想法或说出的话（例如：走向车站 / 环顾四周 / 对周围人说：“你们好。”）。`,
      `2. 严禁编造任何与引擎状态相悖的世界事件（例如：不能写“突然发生大地震”或“天空下起金子”）。`,
      `3. 严禁编造不属于你的经历（例如：不要说自己在 2025 年、看到精神崩坏新闻等）。你正处于 2018 年新学期第一天。`,
      `4. 只输出你做出的具体行动或说的台词（控制在 30 字以内）。`,
      "",
      `接下来你想做什么？`,
    ].join("\n");

    let playerAction = "";
    try {
      playerAction = await callLLM(playerPrompt, 80);
      playerAction = playerAction.replace(/^["'「]|["'」]$/g, "").trim();
    } catch (e) {
      playerAction = "环顾四周。";
    }
    console.log(`  玩家输入: ${playerAction}`);

    // 2. Phase 1 — 分类 LLM → JSON → 引擎执行工具
    // 这里的 runPhase1 会调用真实的 LLM 将动作映射为引擎调用并改变物理状态！
    const dummyCtx = {
      model: { provider: "deepseek", id: "deepseek-chat" },
      modelRegistry: {
        find: () => null,
        getAll: () => []
      }
    };

    console.log(`  [Phase 1] 正在对意图进行分类并执行引擎结算...`);
    const phase1 = await runPhase1(playerAction, dummyCtx);
    console.log(`  [Phase 1 结果] 分类成功: ${phase1.classified} | 工具执行: ${phase1.toolsExecuted.join(", ") || "无"}`);

    // ── 触发结算 ──
    const { runSettlement } = await import("../engine/settlement.ts");
    if (gameState.pendingTravel) {
      const { moveTo } = await import("../tools/helpers.ts");
      const pt = gameState.pendingTravel;
      gameState.pendingTravel = null;
      saveState();
      await moveTo(pt.to, dummyCtx, gameState, saveState);
      console.log(`  [系统] 自动完成旅行，玩家已到达 ${pt.to}，耗时 ${pt.minutes} 分钟`);
      await runSettlement({
        elapsed_minutes: pt.minutes,
        _autoSettled: true,
        ctx: dummyCtx,
      });
    } else {
      if (!phase1.toolsExecuted.includes("settle_scene")) {
        await runSettlement({
          elapsed_minutes: 5,
          _autoSettled: true,
          ctx: dummyCtx,
        });
      }
    }

    // ── 切镜/幕间消费 ──
    let viewpointText = "";
    try {
      const { getPendingViewpointPromise, clearPendingViewpointPromise } = await import("../engine/viewpoint.ts");
      const promise = getPendingViewpointPromise();
      if (promise) {
        viewpointText = (await promise) || "";
        clearPendingViewpointPromise();
        console.log(`  [系统] 触发切镜/幕间: ${viewpointText ? "成功" : "无内容"}`);
      }
    } catch (e) {
      console.error("  获取切镜/幕间失败:", e);
    }

    // 3. Phase 2 — NPC Agent 并行扮演
    const nearbyNPCsAfter = getNearbyNPCs(gameState.player.location, gameState.player.gridPos || [0, 0], 15);
    const nearbyNamesAfter = nearbyNPCsAfter.map(n => n.name);

    const npcResponses: string[] = [];
    if (nearbyNamesAfter.length > 0) {
      console.log(`  [Phase 2] 发现同场 NPC: ${nearbyNamesAfter.join(", ")}，自动唤醒角色轮...`);
      const npcTasks = nearbyNamesAfter.map(async (npcName) => {
        try {
          const otherNPCs = nearbyNamesAfter.filter(n => n !== npcName);
          const npcCtx = await buildNpcAgentContext(npcName, otherNPCs, undefined, playerAction);
          if (!npcCtx) return null;

          const { src, npc, rel, affection, stage, memories, curAge, body, outfit, app,
                  personality, socialTags, npcEventContext, npcLoreContext, npcImpressionsContext } = npcCtx;

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
            `当前场景中玩家做了: ${playerAction}`,
            socialTags ? `情境约束: ${socialTags}\n` : "",
            NPC_MOTIVATION_PROMPT,
          ].filter(Boolean);

          const prompt = promptParts.join("\n");
          const response = await callLLM(prompt, 512);
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

    // 4. 交互检测（检测哪些 NPC 真正 cue 了玩家）
    let activeNPCs: string[] = [];
    if (npcResponses.length > 0) {
      try {
        const parsed = parseNpcResponsesForDetect(npcResponses.join("\n"), nearbyNamesAfter);
        activeNPCs = await analyzeNpcResponses(parsed, gameState.player.name, dummyCtx);
      } catch (e) {
        console.error("  交互检测失败:", e);
      }
    }
    gameState._activeNPCs = activeNPCs;
    const modeResult = detectInteractionMode(gameState, nearbyNamesAfter.length);
    gameState.interactionMode = modeResult.interactionMode;
    saveState();

    // 5. Phase 3 — 渲染 LLM 零工具裸 stream 叙事渲染
    console.log(`  [Phase 3] 正在生成完整渲染 System Prompt 并调用叙事渲染...`);
    const renderPrompt = await buildRenderSystemPrompt(gameState, {
      directorNote: phase1.directorNote,
      npcResponses: npcResponses.join("\n"),
      viewpointText,
      summary: phase1.summary,
      activeNPCs,
    });

    if (turn === 1) {
      fs.writeFileSync("turn1_prompt.txt", renderPrompt, "utf-8");
    }

    let narrative = "";
    let lintResult: any = { needsRetry: false, findings: [] };

    // 执行 Lint & Retry (最多 3 次)
    let retries = 0;
    let currentPrompt = renderPrompt;
    while (retries < 3) {
      try {
        narrative = await callLLM(currentPrompt, 2048);
        lintResult = lintProse(narrative, gameState);
        if (!lintResult.needsRetry) {
          break;
        }
        console.log(`  [Lint 拦截，重试 #${retries + 1}] 命中风格错误，重新生成中...`);
        const violations = lintResult.findings.map((f: any) => `[${f.ruleId}] ${f.message || f.match}`).join("; ");
        currentPrompt = `${renderPrompt}\n\n[修正要求 — 上一轮输出风格错误：${violations}。请严格修正，重新输出正文。]`;
        retries++;
      } catch (e) {
        console.error("  渲染失败:", e);
        narrative = `[渲染失败] 玩家${playerAction}。`;
        break;
      }
    }

    // 6. 回写引擎状态 + 日志记录
    setLastRenderedProse(narrative);
    recordTurnLog({
      playerAction,
      resolvedChanges: npcResponses.length > 0 ? `NPC回应: ${nearbyNamesAfter.join(",")}` : "无",
      sceneResult: narrative.slice(0, 80),
      openHooks: "无",
      nextPressure: "无",
      toolsCalled: drainToolCalls(),
    });

    narrativeHistory.push(narrative);
    const logEntry = [
      `## 回合 ${turn}`,
      `- **时间**: ${gameState.time.game_date} ${gameState.time.time_of_day}`,
      `- **地点**: ${gameState.player.location}`,
      `- **天气**: ${gameState.weather?.type || "晴"} ${gameState.weather?.temp ?? "?"}°C`,
      `- **在场**: ${nearbyNamesAfter.length > 0 ? nearbyNamesAfter.join("、") : "无人"}`,
      `- **玩家动作**: ${playerAction}`,
      `- **疲劳**: ${gameState.player.fatigue}`,
      "",
      narrative,
      npcResponses.length > 0 ? `\n*NPC回应:*\n${npcResponses.map(r => `  ${r}`).join("\n")}` : "",
      lintResult.findings.length > 0 ? `\n*Lint:*\n${lintResult.findings.map((f: any) => `  [${f.severity}] ${f.ruleId}: ${f.match.slice(0, 40)}`).join("\n")}` : "",
    ].join("\n");
    logEntries.push(logEntry);

    console.log(`  叙事结果:\n${narrative}\n`);
    saveState();
  }

  // ── 7. Review ──
  console.log("\n=== Review 分析 ===");
  const reviewPrompt = [
    "你是 QA。阅读以下真实完整的游戏日志，找出问题:",
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
    review = await callLLM(reviewPrompt, 2048);
  } catch (e) {
    review = "Review 调用失败。";
  }
  console.log(review);

  // ── 写日志 ──
  const fullLog = [
    "# earth-0 真实三段式管线 Auto-Play 日志",
    `\n配置: ${CONFIG.maxTurns}回合 | 玩家模型: ${CONFIG.model} | 叙事模型: ${CONFIG.model}`,
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

function parseNpcResponsesForDetect(raw: string, knownNPCs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || knownNPCs.length === 0) return result;
  const sorted = [...knownNPCs].sort((a, b) => b.length - a.length);
  let remaining = raw;
  const anchors: { name: string; start: number }[] = [];
  for (const name of sorted) {
    const marker = `[${name}]`;
    let idx = 0;
    while (idx < remaining.length) {
      const pos = remaining.indexOf(marker, idx);
      if (pos === -1) break;
      const beforeOk = pos === 0 || remaining[pos - 1] === "\n";
      if (beforeOk || anchors.length > 0) {
        anchors.push({ name, start: pos });
      }
      idx = pos + marker.length;
    }
  }
  anchors.sort((a, b) => a.start - b.start);
  for (let i = 0; i < anchors.length; i++) {
    const { name, start } = anchors[i];
    const marker = `[${name}]`;
    const contentStart = start + marker.length;
    const contentEnd = i + 1 < anchors.length ? anchors[i + 1].start : remaining.length;
    let text = remaining.slice(contentStart, contentEnd).trim();
    result[name] = text;
  }
  return result;
}

main().catch(e => { console.error(e); process.exit(1); });
