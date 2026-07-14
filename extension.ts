/**
 * earth-0 扩展 — 三段式实体化 + 结构性隔离
 *
 * Phase 1 (before_agent_start): 分类 LLM → JSON → 引擎执行工具 → 结算
 * Phase 2 (before_agent_start 内): 引擎自动 spawn NPC agent
 * Phase 3 (before_agent_start, 裸 stream): generateCompletion(渲染 prompt)，零工具
 * Phase 4 (agent_end): 创意层（可选，best-effort）
 *
 * Phase 3 不再走 pi agent loop。直接用 generateCompletion 裸 stream —
 * 物理上没有 tool definitions，LLM 无法跳过结算或调写工具。
 * pi agent loop 收到回显 prompt，只负责原样输出预生成的叙事文本。
 *
 * 设计参考: fate-sandbox two-pass-render, PHILOSOPHY §1.3
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAll } from "./tools/registry.ts";
import { updateChatHUD } from "./tools/helpers.ts";

export default function (pi: ExtensionAPI) {
  // Register all modular tools and commands
  registerAll(pi);

  // ═══════════════════════════════════════════════════════════
  // 生命周期钩子
  // ═══════════════════════════════════════════════════════════

  pi.on("session_start", async (_event, ctx) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { gameState, loadState, saveState, resetState, buildStatePrompt, listSaves, loadSave } = await import("./engine/state.ts");

    // 检查存档
    const sessionPath = path.resolve(process.cwd(), "state", "session.json");
    const hasAutoSave = fs.existsSync(sessionPath);
    const saves = listSaves();
    let autoDate = "";
    if (hasAutoSave) {
      try {
        const raw = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
        autoDate = `${raw.time?.game_date || "?"} 第${raw.turn || "?"}回合`;
      } catch {}
    }

    // 先 reset，让后续选择决定是否 load
    resetState();

    const items: any[] = [
      {
        label: "🆕 新游戏",
        detail: "开始一段全新的旅程",
        action: async (d: () => void) => { gameState._startup = "new"; gameState._newGame = true; d(); },
      },
      {
        label: "▶ 继续游戏",
        detail: hasAutoSave ? autoDate : "没有进度",
        action: hasAutoSave ? async (d: () => void) => {
          loadState();
          await buildStatePrompt();
          saveState();
          gameState._startup = "continue"; d();
        } : undefined,
      },
      {
        label: `📂 读取存档`,
        detail: saves.length > 0 ? `${saves.length} 个可用` : "没有命名存档",
        action: saves.length > 0 ? async (d: () => void) => {
          const { showMenu } = await import("./tools/helpers.ts");
          const saveItems = saves.map((s: any) => ({
            label: s.name,
            detail: `${s.date} 第${s.turn}回合 @ ${s.location}`,
            action: async (d2: () => void) => {
              loadSave(s.name);
              await buildStatePrompt();
              saveState();
              gameState._startup = "continue"; d2(); d();
            },
          }));
          saveItems.push({ label: "◀ 返回", detail: "", action: undefined });
          await showMenu(ctx, "📂 选择存档", saveItems);
          if (!gameState._startup) d();
        } : undefined,
      },
    ];

    const { showMenu } = await import("./tools/helpers.ts");
    await showMenu(ctx, "🌍 earth-0", items.filter(i => i.action));
    if (!gameState._startup) gameState._startup = "new";

    // 🎮 启动游戏面板 + Web HUD 服务器
    initGamePanel(pi, ctx);
    try {
      const { startWebHud, initEngineRefs } = await import("./tools/tui/web-hud.ts");
      startWebHud(pi, ctx, 3000);
      // 预先缓存引擎引用，避 CJS 双实例问题
      initEngineRefs();
    } catch (e) { console.error("web-hud 启动失败:", e); }
  });

  // 捕获用户输入到 gameState（pi 的 before_agent_start 不传用户消息）
  pi.on("input", async (event) => {
    const { gameState, saveState } = await import("./engine/state.ts");
    try {
      const ev = event as any;
      if (typeof ev.text === "string" && ev.text.trim()) {
        gameState._lastUserInput = ev.text.trim();
        saveState();
      }
    } catch (e) {
      console.error("input hook: failed to capture user text", e);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    updateChatHUD(ctx);
  });

  pi.on("session_shutdown", async () => {
    const { saveState } = await import("./engine/state.ts");
    saveState();
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 1 + Phase 2: before_agent_start
  // ═══════════════════════════════════════════════════════════
  let _hudReady = false;
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!_hudReady) { _hudReady = true; try { ctx.ui.setHiddenThinkingLabel("🧠"); ctx.ui.setToolsExpanded(false); } catch {} }
    const { gameState, saveState } = await import("./engine/state.ts");
    gameState._toolsLocked = false;
    const { runSettlement } = await import("./engine/settlement.ts");
    const { runPhase1 } = await import("./engine/phase1-classifier.ts");

    // ── P0: settle_scene 漏调兜底 ──
    let autoSettled = false;
    const prevTurn = gameState._turnAtLastCheck;
    if (prevTurn !== undefined && gameState.turn > 0 && gameState.turn === prevTurn) {
      await runSettlement({ elapsed_minutes: 5, _autoSettled: true, ctx });
      autoSettled = true;
    }
    gameState._turnAtLastCheck = gameState.turn;

    // ── Phase 1: 分类 LLM → JSON → 引擎执行工具 ──
    let playerInput = gameState._lastUserInput || "";
    // turn 0 且 _newGame：上帝模式分类器。init_game 执行后 _newGame 自动清除
    const isStartup = gameState._newGame === true;

    // ── HUD 数字直选：玩家直接打 1-6 选选项，不用 /h 命令 ──
    if (/^[1-6]$/.test(playerInput.trim()) && !isStartup) {
      const prose = (gameState as any)._renderedProse || "";
      if (prose) {
        try {
          const { parseRoleOptions } = require("./engine/parse-options.ts");
          const r = parseRoleOptions(prose);
          const cs = (r.options || []).map(c => c.text);
          const n = parseInt(playerInput.trim()) - 1;
          if (n >= 0 && n < cs.length) {
            playerInput = cs[n]!;
            gameState._lastUserInput = playerInput;
          }
        // eslint-disable-next-line no-empty
        } catch {}
      }
    }

    // 新游戏等待玩家输入，不做引擎自动结算（turn 保持 0）
    if (!playerInput.trim() && isStartup) {
      return { systemPrompt: "新的旅程即将开始。你是谁？你想成为什么样的人？告诉我。" };
    }
    const phase1 = playerInput.trim()
      ? await runPhase1(playerInput, ctx, isStartup)
      : await engineOnlyPhase1(ctx); // 空输入 → 直接结算

    // 存储 Phase 1 结果供 Phase 4 使用
    gameState._phase1Summary = phase1.summary;
    gameState._phase1ToolsExecuted = phase1.toolsExecuted;
    gameState._phase1DirectorNote = (phase1 as any).directorNote || "";

    // ── Phase 1.5: 条件选项扫描（引擎侧，不调 LLM）──
    let conditionalOptionLines = "";
    try {
      const { scanConditionalOptions, formatConditionalOptions } = require("./engine/conditional-options.ts");
      const condOpts = scanConditionalOptions(gameState);
      conditionalOptionLines = formatConditionalOptions(condOpts);
      if (conditionalOptionLines) {
        gameState._phase1DirectorNote += "\n\n[条件选项 — 追加到标准选项 ①-④ 之后]\n" + conditionalOptionLines;
      }
    } catch (e: any) { console.error("[Phase1.5] conditional options failed:", e.message); }

    // ── 强制结算（确保时间/回合/NPC日程推进） ──
    // 仅在 Phase 1 未执行 settle_scene 时补调
    if (!phase1.toolsExecuted.includes("settle_scene")) {
      // 将 Phase 1 分类的 elapsed_minutes 传进来
      const hasTravel = phase1.toolsExecuted.includes("travel");
      await runSettlement({
        elapsed_minutes: hasTravel ? 15 : 5,
        _autoSettled: !autoSettled, // Phase 1 分类成功不代表漏调
        ctx,
      });
    }

    gameState._toolsLocked = true;

    // 保存前值用于 Phase 4 检测
    gameState._prevLocation = gameState.player?.location;
    gameState._prevAffection = {};
    if (gameState.player?.relationships) {
      for (const [n, r] of Object.entries(gameState.player.relationships) as [string, any][]) {
        gameState._prevAffection[n] = r.affection ?? 0;
      }
    }

    // ── 先创建 NPC（buildStatePrompt → lookupRegion → getOrCreateNPC）──
    const statePrompt = await (await import("./engine/state.ts")).buildStatePrompt();

    // ── Phase 2: 引擎自举 — 自动 spawn 同场 NPC（在日程更新前做，否则日程把NPC挪走查不到人）──
    let npcResponses = "";
    try {
      npcResponses = await autoSpawnNPCs(ctx);
    } catch (e) {
      console.error("Phase2: auto-spawn NPCs failed:", e);
    }

    // 清空本轮换装追踪（Phase 2 NPC Agent 已消费完毕）
    const { clearOutfitChangesThisTurn } = await import("./engine/state.ts");
    clearOutfitChangesThisTurn();

    // NPC 刚创建时 currentRoom 是 default_location，按当前时间段移动 NPC 到正确位置
    await (await import("./engine/state.ts")).updateNPCSchedules();

    // 重新校准 interactionMode（日程更新后同场人数可能变了）
    const { isSameLocation: isSameLoc } = await import("./engine/state.ts");
    const postScheduleCount = Object.values(gameState.npcs).filter((n: any) =>
      n.alive && isSameLoc(n.currentRoom, gameState.player.location)
    ).length;
    const { detectInteractionMode: detectIM } = await import("./engine/detect-mode.ts");
    gameState.interactionMode = detectIM(gameState, postScheduleCount).interactionMode;

    // ── 切镜/幕间消费（viewpoint.ts 的异步 promise → 追加到 NPC 回应后）──
    let viewpointText = "";
    try {
      const { getPendingViewpointPromise, clearPendingViewpointPromise } = await import("./engine/viewpoint.ts");
      const promise = getPendingViewpointPromise();
      if (promise) {
        viewpointText = (await promise) || "";
        clearPendingViewpointPromise();
      }
      // 同时消费 _pending_viewpoint_text（兼容旧路径）
      if (gameState._pending_viewpoint_text) {
        if (gameState._pending_viewpoint_text.turn === gameState.turn) {
          viewpointText = (viewpointText ? viewpointText + "\n" : "") + gameState._pending_viewpoint_text.text;
        }
        delete gameState._pending_viewpoint_text;
      }
    } catch (e) {
      console.error("Phase2.5: viewpoint consumption failed:", e);
    }

    // ── 交互检测：用 NPC 回应更新 interactionMode ──
    let activeNPCs: string[] = [];
    if (npcResponses) {
      try {
        const { isSameLocation } = await import("./engine/state.ts");
        const presentNPCs = Object.entries(gameState.npcs || {})
          .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, gameState.player?.location) && n.alive !== false)
          .map(([name]) => name);
        const parsed = parseNpcResponses(npcResponses, presentNPCs);
        const { analyzeNpcResponses, detectInteractionMode } = await import("./engine/detect-mode.ts");
        activeNPCs = await analyzeNpcResponses(parsed, gameState.player?.name || "维", ctx);
        const result = detectInteractionMode(gameState, presentNPCs.length, {
          npcResponses: parsed,
          activeNPCs,
          skipCounterUpdate: true, // 计数器仍在 settlement 中更新
        });
        gameState.interactionMode = result.interactionMode;
      } catch (e) {
        console.error("Phase2: interaction detection failed:", e);
      }
    }
    gameState._activeNPCs = activeNPCs;

    // ── Mode 自动切换（检测 Phase 1 是否执行了性工具）──
    const sexTools = ["intimate_touch", "masturbate"];
    const hadSex = phase1.toolsExecuted.some((t: string) => sexTools.includes(t));

    // ── GAL 模式场景边界管理 ──
    const prevLocation = gameState._prevLocation;
    const curLocation = gameState.player?.location;
    const locationChanged = prevLocation && curLocation && prevLocation !== curLocation;

    if (!hadSex) {
      // 场景开始时检查 GAL 激活条件（地点变化 或 首次初始化）
      if (locationChanged || gameState._galSceneActive === undefined) {
        const { isSameLocation: galIsSame } = await import("./engine/state.ts");
        const galPresent = Object.entries(gameState.npcs || {})
          .filter(([_, npc]: [string, any]) => galIsSame(npc.currentRoom, curLocation) && npc.alive !== false)
          .map(([name]) => name);

        if (gameState.mode === "rpg" && galPresent.length === 1) {
          const npcName = galPresent[0];
          try {
            const { findCharacter } = await import("./engine/state.ts");
            const src = findCharacter(npcName);
            const isFemale = src?.gender === "female";
            const stage = gameState.player?.relationships?.[npcName]?.stage;
            const hasSexHistory = (gameState.player as any)?._sex_partners?.includes?.(npcName);

            if (isFemale && (stage === "亲密" || hasSexHistory)) {
              gameState.mode = "gal";
              gameState._galSceneActive = true;
            }
          } catch (e) {
            console.error("GAL scene activation check failed:", e);
          }
        }
      }

      // 场景中检查 GAL 退出条件（非 sex 模式时）
      if (gameState._galSceneActive && gameState.mode !== "sex") {
        const { isSameLocation: galExitIsSame } = await import("./engine/state.ts");
        const galPresentNow = Object.entries(gameState.npcs || {})
          .filter(([_, npc]: [string, any]) => galExitIsSame(npc.currentRoom, curLocation) && npc.alive !== false);
        if (locationChanged || galPresentNow.length === 0) {
          gameState._galSceneActive = false;
          gameState.mode = "rpg";
        }
      }
    }

    if (hadSex && gameState.mode !== "sex") {
      gameState._prevMode = gameState.mode;
      gameState.mode = "sex";
      gameState.layer1Enabled = true;
    } else if (!hadSex && gameState.mode === "sex") {
      // 从 sex 恢复：优先回 GAL（场景内无缝），否则回 _prevMode
      gameState.layer1Enabled = false;
      if (gameState._galSceneActive) {
        gameState.mode = "gal";
      } else if (gameState._prevMode) {
        gameState.mode = gameState._prevMode;
      }
      gameState._prevMode = undefined;
    }
    if (gameState.mode === "sex") gameState.layer1Enabled = true;
    await maintainSexMode(ctx);

    saveState();

    // ── Phase 3: 裸 stream 渲染（PHILOSOPHY §2.1 完整版） ──
    // 不再走 pi agent loop。直接用 generateCompletion 裸 stream —
    // 物理上没有 tool definitions，渲染 LLM 无法跳过结算或调写工具。
    const { buildRenderSystemPrompt } = await import("./engine/phase3-render.ts");

    const renderCtx = {
      directorNote: phase1.directorNote,
      npcResponses,
      viewpointText,
      summary: phase1.summary,
      activeNPCs,
    };

    let gmPrompt = await buildRenderSystemPrompt(gameState, renderCtx);

    // 注入引擎通知
    const notices: string[] = [];
    if (autoSettled) {
      notices.push(`[引擎] 上轮 GM 未调用 settle_scene，引擎已自动完整结算（当前 turn ${gameState.turn}）。`);
    }
    if (phase1.classified && phase1.toolsExecuted.length > 0) {
      const dn = (phase1 as any).directorNote || "";
      const rcMatch = dn.match(/<resolved_changes>([\s\S]*?)<\/resolved_changes>/);
      const details = rcMatch ? rcMatch[1].trim() : "";
      const detailHint = details && details !== "无" ? ` | 结果: ${details}` : "";
      notices.push(`[引擎] Phase1 分类器执行: ${phase1.toolsExecuted.join(", ")}${detailHint}。直接写叙事。`);
    } else if (!phase1.classified) {
      notices.push(`[引擎] Phase1 分类失败，已回退引擎兜底结算。直接写叙事。`);
    }
    if (notices.length > 0) {
      gmPrompt += "\n\n" + notices.join("\n");
    }

    // ── 裸 stream 渲染：generateCompletion 物理上无 tool definitions ──
    const { generateCompletion, setLastRenderedProse: setLRP, setLastRenderParams: setParams } = await import("./tools/helpers.ts");
    const flagModel = pi.getFlag("render-model") as string | undefined;

    // 保存渲染参数供 /reroll 使用
    const dn2 = (phase1 as any).directorNote || "";
    const paMatch = dn2.match(/<player_action>([\s\S]*?)<\/player_action>/);
    const rcMatch2 = dn2.match(/<resolved_changes>([\s\S]*?)<\/resolved_changes>/);
    setParams({
      playerAction: paMatch ? paMatch[1].trim() : phase1.summary,
      resolvedChanges: rcMatch2 ? rcMatch2[1].trim() : "无",
      sceneResult: `玩家在${gameState.player?.location || "未知地点"}，turn ${gameState.turn}`,
      openHooks: "无",
      nextPressure: "无",
      npcResponses: npcResponses || "",
    });

    try {
      let rendered = await generateCompletion(gmPrompt, 32768, ctx, flagModel);
      if (rendered) {
        // Lint 扫描
        try {
          const { lintProse } = await import("./engine/audit/lint-rules.ts");
          const lintResult = lintProse(rendered, gameState);
          if (lintResult.needsRetry) {
            console.warn("[Phase3] lint needs retry, auto-pipeline skips retry");
          }
          rendered = lintResult.prose || rendered;
        } catch (_) { /* lint unavailable */ }

        setLRP(rendered);
        // 推送到 web-hud，浏览器 poll 立即可见（避 CJS 跨模块引用问题）
        try {
          const { setLatestProse } = await import("./tools/tui/web-hud.ts");
          setLatestProse(rendered);
        } catch {}

        return { systemPrompt: `[引擎已预生成叙事正文。你只需原样输出以下内容，不分析、不评价、不加额外文字、不调任何工具。]\n\n${rendered}` };
      }
    } catch (e) {
      console.error("Phase3: bare stream render failed, falling back to pi agent:", e);
    }

    // fallback: pi agent 用完整 prompt 自己写
    return { systemPrompt: gmPrompt };
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 4: agent_end（创意层，可选）
  // ═══════════════════════════════════════════════════════════
  pi.on("agent_end", async (_event, ctx) => {
    // Phase 4: ctx in agent_end may be stale after session replacement.
    // Silently skip — this layer is best-effort creative.
    if (!ctx?.model || !ctx?.modelRegistry) return;
    try {
      const { runPhase4 } = await import("./engine/phase4-creative.ts");
      const { gameState } = await import("./engine/state.ts");
      const summary = gameState._phase1Summary || "";
      await runPhase4(summary, ctx);
    } catch (e) {
      // Non-critical — next round will re-check creative triggers
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

/** Phase 1 兜底：空输入或分类失败时，只做引擎结算 */
async function engineOnlyPhase1(ctx: any) {
  const { gameState, saveState } = await import("./engine/state.ts");
  const { runSettlement } = await import("./engine/settlement.ts");
  await runSettlement({ elapsed_minutes: 5, _autoSettled: true, ctx });
  saveState();
  return {
    directorNote: `<directors_note>
  <player_action>无输入（引擎自动结算）</player_action>
  <resolved_changes>时间推进5分钟，turn ${gameState.turn}</resolved_changes>
  <scene_result>玩家在${gameState.player?.location || "未知"}</scene_result>
</directors_note>`,
    toolsExecuted: ["settle_scene"],
    summary: "引擎自动结算",
    classified: false,
  };
}

/** Phase 2: 自动检测同场 NPC 并 spawn */
async function autoSpawnNPCs(ctx: any): Promise<string> {
  const { gameState, isSameLocation } = await import("./engine/state.ts");

  const loc = gameState.player?.location;
  if (!loc || !gameState.npcs) return "";

  const presentNPCs = Object.entries(gameState.npcs)
    .filter(([_, npc]: [string, any]) =>
      isSameLocation(npc.currentRoom, loc) && npc.alive !== false
    )
    .map(([name]) => name);

  if (presentNPCs.length === 0) return "";

  // 本轮已经 spawn 过的跳过
  const lastTools = gameState._lastTurnToolsCalled || [];
  if (lastTools.includes("spawn_npc_agent") || lastTools.includes("spawn_npc_agents")) return "";

  // 选情感权重最高的 NPC（好感度 → 有关系标签 → 有 hook → 随机）
  const scored = presentNPCs.map(name => {
    let score = 0;
    const rel = gameState.player?.relationships?.[name];
    if (rel?.affection) score += rel.affection;
    if (rel?.stage === "亲密" || rel?.stage === "好友") score += 20;
    // 有活跃 hook 的加分
    const hooks = gameState.active_hooks || [];
    if (hooks.some((h: any) => h.target_npc === name || h.source_npc === name)) score += 30;
    return { name, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // 只 spawn 1-2 个
  const toSpawn = scored.slice(0, 2);
  if (toSpawn.length === 0) return "";

  try {
    const { generateCompletion, getNpcAgentModel, recordNpcAgentAction, buildPresentLine } = await import("./tools/helpers.ts");
    const { findCharacter, getOrCreateNPC, recallRelevantMemories, getNpcCurrentAge, getBodyForAge, getNPCOutfitDesc, getAppearanceForAge, translateWorldState, getOutfitChangesThisTurn } = await import("./engine/state.ts");
    const charStages = await import("./data/character_stages.json", { with: { type: "json" } });

    const results = await Promise.all(toSpawn.map(async ({ name }) => {
      try {
        const src = findCharacter(name);
        if (!src) return "";
        const npc = getOrCreateNPC(name);
        const rel = gameState.player?.relationships?.[name];
        const affection = rel?.affection ?? 0;
        const stage = rel?.stage ?? "陌生";
        const curAge = getNpcCurrentAge(src.base_age || 16);
        const body = getBodyForAge(src, curAge);
        const app = getAppearanceForAge(src, curAge);
        const outfit = getNPCOutfitDesc(name);
        const cs = (charStages as any)[name];
        const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
        const personality = cs?.[stageKey] || "";
        const presentOthers = toSpawn.filter(n => n.name !== name).map(n => n.name);
        const memories = recallRelevantMemories(name, {
          location: loc,
          presentNPCs: presentOthers,
        });

        const presentLine = await buildPresentLine(gameState, body?.height_cm || 160, presentOthers);
        const wsLine = translateWorldState(gameState.worldState);

        const prompt = [
          `你是${name}。你现在正在${loc}。`,
          presentLine,
          wsLine,
          `性格: ${personality || "（暂无）"}`,
          `外貌: ${[app?.hair_color, app?.hair_style].filter(Boolean).join("")}，${app?.eye_color ? app.eye_color + "眼睛" : ""}`,
          `穿着: ${outfit}`,
          `关系: ${stage}（好感${affection}）`,
          memories.length > 0 ? `过往记忆: ${memories.join("；")}` : "",
          (() => {
            const changes = getOutfitChangesThisTurn();
            if (changes.length === 0) return "";
            const myChange = changes.find(c => c.npc === name);
            const otherChanges = changes.filter(c => c.npc !== name);
            const lines: string[] = [];
            if (myChange) lines.push(`你刚换上了${myChange.to}服装（${myChange.desc}）。之前穿的是${myChange.from}。思考或说话时自然提及换装动作，不要假装衣服一直穿着。`);
            for (const oc of otherChanges) lines.push(`${oc.npc}刚换上了${oc.to}服装（${oc.desc}）。`);
            return lines.length > 0 ? `[换装] ${lines.join(" ")}` : "";
          })(),
          "",
          "场景中有玩家在场。基于你的性格，自然地做出反应——可以是被动观察到玩家进入，也可以是主动打招呼。",
          "不要写叙事，只输出你的内心独白和回应（参考角色轮格式）。",
        ].filter(Boolean).join("\n");

        const model = await getNpcAgentModel();
        const response = await generateCompletion(prompt, 512, ctx, model);
        if (response) {
          await recordNpcAgentAction(name, response, outfit || "", loc);
          return `[${name}] ${response}`;
        }
      } catch (e) {
        console.error(`Phase2: auto-spawn ${name} failed:`, e);
      }
      return "";
    }));

    return results.filter(Boolean).join("\n");
  } catch (e) {
    console.error("Phase2: autoSpawnNPCs failed:", e);
    return "";
  }
}

/** 解析 NPC 回应字符串为 Record<name, text> */
function parseNpcResponses(raw: string, knownNPCs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || knownNPCs.length === 0) return result;

  // 用已知 NPC 名做锚点分割
  // 输入: "[雪之下雪乃] *仍在看书...*\n[由比滨结衣] 「维！你觉得哪个颜色好看？」"
  // 按最长的 NPC 名优先匹配，避免"雪之下"误匹配"雪之下雪乃"
  const sorted = [...knownNPCs].sort((a, b) => b.length - a.length);
  let remaining = raw;
  let lastEnd = 0;

  // 找到所有 [NPC名] 的位置
  const anchors: { name: string; start: number }[] = [];
  for (const name of sorted) {
    const marker = `[${name}]`;
    let idx = 0;
    while (idx < remaining.length) {
      const pos = remaining.indexOf(marker, idx);
      if (pos === -1) break;
      // 检查不是子串（如 "[雪之下雪乃]" 中的 "[雪之下]" 不匹配）
      const beforeOk = pos === 0 || remaining[pos - 1] === "\n";
      if (beforeOk || anchors.length > 0) {
        anchors.push({ name, start: pos });
      }
      idx = pos + marker.length;
    }
  }

  // 按位置排序
  anchors.sort((a, b) => a.start - b.start);

  // 提取每个 NPC 的文本段
  for (let i = 0; i < anchors.length; i++) {
    const { name, start } = anchors[i];
    const marker = `[${name}]`;
    const contentStart = start + marker.length;
    const contentEnd = i + 1 < anchors.length ? anchors[i + 1].start : remaining.length;
    let text = remaining.slice(contentStart, contentEnd).trim();
    // 去掉尾部可能残留的下一段标记
    // 只保留到最后一个完整句子
    result[name] = text;
  }

  return result;
}

/** Sex 模式维护：sex 模式下 layer1 启用 + 模式切换 */
async function maintainSexMode(ctx: any) {
  const { gameState, saveState } = await import("./engine/state.ts");

  if (gameState.mode !== "sex") return;

  // layer1 强制启用
  gameState.layer1Enabled = true;

  // 欲望自然衰减：检查本轮有无 intimate_touch
  const lastTools = gameState._lastTurnToolsCalled || [];
  const hadTouch = lastTools.includes("intimate_touch");
  if (!hadTouch) {
    gameState._sexTurnsWithoutTouch = (gameState._sexTurnsWithoutTouch || 0) + 1;
    if (gameState._sexTurnsWithoutTouch >= 3 && gameState.player.sex) {
      const decay = Math.min(3, Math.floor(gameState._sexTurnsWithoutTouch / 2));
      gameState.player.sex.arousal = Math.max(0, (gameState.player.sex.arousal || 0) - decay);
    }
  } else {
    gameState._sexTurnsWithoutTouch = 0;
  }

  saveState();
}

// ═══════════════════════════════════════════════════════════
// 向后兼容：buildSystemPrompt（测试文件可能引用）
// ═══════════════════════════════════════════════════════════

export async function buildSystemPrompt(gameState: any, statePrompt: string): Promise<string> {
  // 向后兼容：保留旧的 preset.json 动态组装逻辑
  // 新版三段式使用的是 buildRenderSystemPrompt（phase3-render.ts）
  const fs = await import("node:fs");
  const path = await import("node:path");
  const agentsDir = path.resolve(process.cwd(), "agents");

  const presetPath = path.join(agentsDir, "preset.json");
  if (fs.existsSync(presetPath)) {
    try {
      const presetData = JSON.parse(fs.readFileSync(presetPath, "utf-8"));
      const presetName = gameState.preset || "default";
      const layers = presetData.assembly[presetName] || presetData.assembly["default"];
      const parts: string[] = [];

      for (const key of layers) {
        if (key === "start" && gameState.turn > 0) continue;
        const layerKey = key.replace("{mode}", gameState.mode).replace("{interactionMode}", gameState.interactionMode || "turn_based");
        const layerConfig = presetData.layers[layerKey];
        if (!layerConfig) continue;

        if (layerKey === "state") {
          parts.push(statePrompt);
        } else {
          const fileResolved = layerConfig.file.replace("{mode}", gameState.mode).replace("{interactionMode}", gameState.interactionMode || "turn_based");
          const filePath = path.resolve(process.cwd(), fileResolved);
          let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").trim() : "";
          if (content) {
            const personText = (gameState.mode === "gal" || gameState.mode === "sex") ? "第一人称「我」" : "第三人称「他」（镜头需钉在主角身边，采用第三人称限知视角）";
            content = content.replace(/\{\{person\}\}/g, personText);
            parts.push(content);
          }
        }
      }
      return parts.filter(Boolean).join("\n\n---\n\n");
    } catch (e) {
      console.error("Failed to parse preset.json, falling back to hardcoded default:", e);
    }
  }

  // Hardcoded fallback
  const read = (name: string) => {
    const p = path.join(agentsDir, name);
    let content = fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
    const personText = (gameState.mode === "gal" || gameState.mode === "sex") ? "第一人称「我」" : "第三人称「他」（镜头需钉在主角身边，采用第三人称限知视角）";
    return content.replace(/\{\{person\}\}/g, personText);
  };

  const voiceFile = (gameState.interactionMode === "novel") ? "gm-voice-novel.md" : "gm-voice-turnbased.md";
  const modeFile = gameState.mode === "sex" ? "gm-mode-sex.md"
    : gameState.mode === "rpg" ? "gm-mode-rpg.md"
    : "gm-mode-gal.md";

  return [
    read("gm-pre.md"),
    read("gm-rules.md"),
    statePrompt,
    read(voiceFile),
    read(modeFile),
    read("gm-contract.md"),
  ].filter(Boolean).join("\n\n---\n\n");
}

// ═══════════════════════════════════════════════════════════
// 🎮 终端常驻 HUD widget + /hud 交互
// ═══════════════════════════════════════════════════════════
// widget 可画任意行（只要宽度不超），但不能收按键。用 /hud 做 overlay 交互。

const C = { r:"\x1b[0m", O:"\x1b[38;5;216m", P:"\x1b[38;5;140m", b:"\x1b[38;5;117m", G:"\x1b[38;5;114m", d:"\x1b[38;5;167m", Y:"\x1b[38;5;215m", M:"\x1b[38;5;243m", W:"\x1b[38;5;252m", B:"\x1b[1m", dim:"\x1b[2m", rev:"\x1b[7m" };
/** 动态分割线，匹配终端宽度 */
function makeHLine(W: number) { return "\x1b[90m" + "─".repeat(W) + "\x1b[0m"; }

function initGamePanel(pi: any, ctx: any) {
  // ── HUD 导航状态 ──
  let _tab = 1;        // 0=自身 1=周边 2=房间 3=行动
  let _cursor = 0;
  let _panelMode = false; // Enter 进入面板模式后 ↑↓ 才生效
  let _choicesCache: string[] = [];
  let _choiceTags: string[] = [];
  let _peopleCache: any[] = [];

  // ── 辅助：NPC grid位置 → 文字描述 ──
  const posLabel = (gp: any, rm: any): string => {
    if (!gp || !rm) return "";
    const [x,y] = Array.isArray(gp) ? gp : [0,0];
    let lbl = "";
    const w=rm.width||10, h=rm.height||6;
    if (y===0) lbl="靠墙"; else if (y===h-1) lbl="靠后墙";
    if (x===0) lbl+="靠左"; else if (x===w-1) lbl+="靠右";
    if (!lbl) lbl="中间";
    const c=rm.cells?.[y]?.[x];
    if (c?.label && c.label.trim() && c.label.trim()!=="  ") lbl=c.label.trim();
    return `(${x},${y})${lbl}`;
  };

  ctx.ui.setWidget("game-hud", (tui: any, _theme: any) => {
    const vw = typeof tui?.visibleWidth === "function" ? tui.visibleWidth() : 48;
    const W = Math.max(20, vw - 2);
    const { truncateToWidth } = require("../tools/helpers.ts");
    const tr = (s: string) => truncateToWidth(s, W);
    const todZH: Record<string,string> = {morning:"午前",lunch:"昼",afternoon:"午後",evening:"夕方",night:"夜"};
    const TABS = ["🛡 自身", "👥 周边", "🏠 房间", "▼ 行动"];

    return {
      render(_w: number): string[] {
        try {
          const s = require("../engine/state.ts"); const gs = s.gameState; const p = gs?.player; if (!p) return [];
          const out: string[] = [];
          const loc = p.location||"???"; const t = gs.time; const mode = (gs.mode||"rpg").toUpperCase();
          const hp=p.hp?.current??10, hpM=p.hp?.max??15; const isSex = mode==="SEX";
          const date=t?.game_date||""; const dow=t?.day_of_week||"";
          const tod=todZH[t?.time_of_day]||t?.time_of_day||"";

          const weather = t?.weather||""; const wIcon = weather.includes("雨")?"🌧":weather.includes("雪")?"❄":"☀";
          const turn = gs.turn||0; const rm = s.getRoom(loc);
          const prose = (gs as any)._renderedProse || "";

          // 解析选项（含标签）
          _choicesCache = []; _choiceTags = [];
          if (prose) {
            try {
              const { parseRoleOptions } = require("../../engine/parse-options.ts");
              const r = parseRoleOptions(prose);
              for (const c of (r.options||[])) {
                _choicesCache.push(c.text); _choiceTags.push(c.tag||"");
              }
            } catch {}
          }

          // 同场 NPC
          const nearby = Object.entries(gs.npcs||{}).filter(([_,n]:any)=>n.alive!==false&&s.isSameLocation(n.currentRoom,loc));
          const npcNames = nearby.map(([name]:any)=>name);

          // 构建 _peopleCache（含路人）
          _peopleCache = nearby.map(([name,npc]:[string,any])=>{
            const rel = p.relationships?.[name];
            const body = npc.body||npc.body_by_age||{};
            const gp = npc.gridPos||npc.grid_pos||[0,0];
            return {
              name, type:"named", gp,
              height: body.height_cm||npc.height_cm||npc.height||"?",
              posDesc: posLabel(gp, rm),
              dist: npc.distance||npc.dist||2,
              affection: rel?.affection??0, stage: rel?.stage||"陌生", romance: rel?.romance||"",
              lh: npc.equipment?.left_hand?.name||npc.left_hand||"",
              rh: npc.equipment?.right_hand?.name||npc.right_hand||"",
              lastWords: (npc.lastWords||"").replace(/^\[.*?\]\s*/,""),
              action: npc.action||"",
            };
          });
          try {
            const realCrowd = s.getNamelessNPCs(loc, gs.turn) as any[];
            const sandCrowd = (gs as any)._testCrowd || [];
            const crowd = [...realCrowd, ...sandCrowd];
            for (const c of crowd) _peopleCache.push({
              name: c.name||"???", type:"crowd", gp: c.gridPos||[0,0],
              height: c.height||"?", posDesc: posLabel(c.gridPos, rm), dist: "?",
              clusterSize: c.count||c.clusterSize||1, action: c.act||c.action||"",
              affection:0, stage:"", romance:"", lh:"", rh:"", lastWords:"",
            });
          } catch {}

          // ── 统一渲染 ──
          const hline = makeHLine(W);
          out.push(tr(hline));
          const tabBar = TABS.map((label,i) => i===_tab?`${C.rev}${C.B} ${label} ${C.r}`:`${C.dim} ${label} ${C.r}`).join(" ");
          out.push(tr(tabBar));
          out.push(tr(hline));

          if (_tab === 0) {
              // ═══ 自身 ═══
              const attrs = p.attributes||{};
              const dangerBg = isSex?`${C.d}`:hp<5?`${C.rev}${C.d}`:"";
              out.push(tr(`${dangerBg}❤${hp}/${hpM}${C.r} AC${p.ac||10} ${C.Y}¥${p.funds??0}${C.r} 💤${p.fatigue??0} ${C.M}#${turn}${C.r} ${wIcon}${weather}`));
              out.push(tr(`力${attrs.力量??8} 敏${attrs.敏捷??10} 体${attrs.体质??9} 智${attrs.智力??12} 感${attrs.感知??10} 魅${attrs.魅力??10}`));
              // ── Sex 模式体征 ──
              if (isSex) { try { const sexSt = p.sex; if (sexSt) out.push(tr(`${C.d}🔥兴奋${sexSt.fire||0}${C.r} ${C.P}💓欲望${sexSt.heart||0}${C.r} 裸露:${sexSt.nudity||"全身"}`)); } catch {} }
              const eq = p.equipment||{};
              const eqSlots: [string,string][] = [["top","上衣"],["bottom","下装"],["shoes","鞋子"],["right_hand","右手"],["left_hand","左手"]];
              for (const [sk,label] of eqSlots) {
                const it = eq[sk];
                out.push(tr(`  ${C.dim}${label}:${C.r} ${it?`${C.W}${(it.name||it).slice(0,18)}${C.r}`:`${C.dim}—${C.r}`}`));
              }
              const inv = p.inventory||[];
              const invNames = inv.length ? inv.slice(0,6).map((i:any)=>i.name||i).join(", ") : "（空）";
              out.push(tr(`${C.dim}🎒${inv.length}件${C.r} ${invNames}${inv.length>6?" …":""}`));
              if (p.vehicle) out.push(tr(`${C.Y}🚲 ${p.vehicle.name||""}${C.r} ×${p.vehicle.speedMul||1.5}`));
            } else if (_tab === 1) {
              // ═══ 周边 ═══
              if (!_peopleCache.length){out.push(tr(`${C.dim}（周边无人）${C.r}`));}
              else for (let i=0;i<Math.min(_peopleCache.length,12);i++){
                const n=_peopleCache[i]!;
                const sel = _panelMode && i===_cursor ? `${C.rev}▶${C.r} ` : "  ";
                if (n.type==="named"){
                  const a=n.affection,st=n.stage,rom=n.romance;
                  const icon=rom==="恋人"?`${C.d}♥`:a>=40?`${C.G}◆`:a>=20?`${C.b}◇`:`${C.dim}·`;
                  const lr=`${n.lh||"—"}|${n.rh||"—"}`;
                  let actIcon="";const al=(n.action||"").toLowerCase();
                  if(/警惕|敌|怒|攻击/.test(al))actIcon=`${C.d}⚠`;
                  else if(/友|笑|点头|好奇|高兴/.test(al))actIcon=`${C.G}✓`;
                  else actIcon=`${C.dim}·`;
                  const nm = (n.name).slice(0,8);
                out.push(tr(`  ${C.O}${nm}${C.r} ${C.dim}${n.height}cm ${n.dist}m${C.r} ${lr}`));
                out.push(tr(`  ${actIcon}${icon}${a} ${C.dim}${st}${rom||""}${C.r}`));
                if(n.lastWords)out.push(tr(`  ${C.M}"${n.lastWords.slice(0,25)}"${C.r}`));
                }else{
                  out.push(tr(`${sel}${C.O}${(n.name).slice(0,10)}${C.r} ${C.dim}×${n.clusterSize||1} · ${n.height} · ${n.posDesc.slice(0,10)}${C.r}`));
                  if(n.action)out.push(tr(`   ${C.M}${n.action.slice(0,30)}${C.r}`));
                }
              }
            } else if (_tab === 2) {
              // ═══ 房间 ═══
              if (!rm) out.push(tr(`${C.dim}（无房间数据）${C.r}`));
              else {
                out.push(tr(`📏 ${rm.width||"?"}×${rm.height||"?"}m · 你在(${p.gridPos?.[0]??"?"},${p.gridPos?.[1]??"?"}) · ✨${(rm.atmosphere||"").slice(0,24)}`));
                out.push(tr(`${C.dim}── 家具 ──${C.r}`));
                const cells=rm.cells||[];let fc=0;
                for(let y=0;y<rm.height;y++)for(let x=0;x<rm.width;x++){const c=cells[y]?.[x];if(c?.furniture&&fc<8){const sub=(c.label&&c.label.trim()&&c.label.trim()!=="  ")?` [${c.label.trim()}]`:"";out.push(tr(`  ${C.Y}📦 ${c.furniture}${C.r}${C.dim}(${x},${y})${sub}${C.r}`));fc++;}}
                if(!fc)out.push(tr(`  ${C.dim}（空）${C.r}`));
                out.push(tr(`${C.dim}── 出口 ──${C.r}`));
                const exits:string[]=[];
                for(let y=0;y<rm.height;y++)for(let x=0;x<rm.width;x++){const c=cells[y]?.[x];if((c?.type==="exit"||c?.type==="door")&&c?.exitTo)exits.push(`${c.exitTo}(${x},${y})`);}
                out.push(tr(exits.length?`  ${C.G}🚪 ${exits.join(", ")}${C.r}`:`  ${C.dim}（无）${C.r}`));
              }
            } else {
              // ═══ 行动 ═══
              if (!_choicesCache.length){out.push(tr(`${C.dim}输入文字推进剧情后，选项自动出现${C.r}`));}
              else for (let i=0;i<Math.min(_choicesCache.length,6);i++){
                const idx=String.fromCodePoint(0x2460+i);
                const tag=_choiceTags[i]||"";
                const sel = _panelMode && i===_cursor ? `${C.rev}▶${C.r} ` : "  ";
                out.push(tr(`${sel}${C.O}${idx}${C.r} ${_choicesCache[i]!.slice(0,25)}${tag?` ${C.P}[${tag.slice(0,6)}]${C.r}`:""}`));
              }
            }

            out.push(tr(hline));
            const tip = _panelMode
              ? `↑↓移动  Enter选择  1-6直选  Esc返回`
              : `←→Tab  Enter进入面板`;
            out.push(tr(`${C.dim}${tip}${C.r}`));
          return out;
        } catch { return []; }
      },

      // ── ←→↑↓ Enter 1-6 全在 widget 处理，不用任何指令 ──
      handleInput(d: string, focusedComponent?: any): boolean {
        try {
          const gs = require("../engine/state.ts").gameState;
          if (!gs?.player) return false;
          const hasText = focusedComponent && (
            (typeof focusedComponent.getText === "function" && !!focusedComponent.getText()) ||
            (focusedComponent.buffer && focusedComponent.buffer.length > 0)
          );
          if (hasText) return false;

          // ── 全局：←→ 始终切 Tab ──
          if (d === "\x1b[C" || d === "\x1bOC") { _tab = (_tab + 1) % 4; _cursor = 0; _panelMode = false; return true; }
          if (d === "\x1b[D" || d === "\x1bOD") { _tab = (_tab + 3) % 4; _cursor = 0; _panelMode = false; return true; }

          // ── 面板模式：↑↓ Enter 1-6 Esc ──
          if (_panelMode) {
            if (d === "\x1b" || d === "q" || d === "Escape") { _panelMode = false; return true; }
            if (d === "\x1b[A" || d === "\x1bOA") { _cursor = Math.max(0, _cursor - 1); return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _cursor++; return true; }
            if (d === "\r" || d === "\n") {
              if (_tab === 1) {
                const named = _peopleCache.filter((n:any)=>n.type==="named");
                if (named.length) {
                  const nm = named[Math.min(_cursor, named.length-1)]!.name;
                  (async () => { try { const { showNPCInteractionMenu } = await import("./tools/tui/npc.ts"); await showNPCInteractionMenu(nm, ctx); } catch(e:any){ctx.ui.notify(e.message,"error");} })();
                }
              } else if (_tab === 3 && _choicesCache.length) {
                ctx.chat.addSystemMessage(_choicesCache[Math.min(_cursor, _choicesCache.length-1)]!);
              }
              _panelMode = false; return true;
            }
            if (d.length === 1 && d >= "1" && d <= "6") {
              if (_tab === 3 && _choicesCache.length) {
                const n = parseInt(d)-1;
                if (n >= 0 && n < _choicesCache.length) { ctx.chat.addSystemMessage(_choicesCache[n]!); _panelMode = false; return true; }
              }
              _cursor = parseInt(d)-1; return true;
            }
            return false;
          }

          // ── 默认模式：Enter 进入面板 ──
          if (d === "\r" || d === "\n") { _panelMode = true; return true; }
          return false;
        } catch { return false; }
      },
    };
  }, { placement: "aboveEditor" });
}
