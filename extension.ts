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
import { C, truncAnsi } from "./tools/tui/colors.ts";

/** 最新的含 chat API 的 ctx（before_agent_start / turn_end 更新） */
let _latestCtx: any = null;

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
    _latestCtx = ctx;
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
    _latestCtx = ctx;
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
// [DEPRECATED] buildSystemPrompt — 仅保留供 test.ts 引用
// 新版 Phase 3 使用 buildRenderSystemPrompt（phase3-render.ts）
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
// 🎮 终端常驻 HUD widget — 支持 ANSI 彩色（aboveEditor 不过滤 \x1b，见下）
//
// 【重要更正 2026-07-15】旧交接文档说"aboveEditor 过滤 ANSI，widget 永远纯文本"是误诊。
// 真相：pi-tui 的 Text 组件全程 ANSI 感知（wrapTextWithAnsi/visibleWidth），pi 自己
// 也往 widget 塞 theme.fg("muted",...) 彩色行。旧版看到裸色码的根因是当年的 tr() 截断
// 函数按 charCodeAt 逐字符计宽，把 \x1b[..m 序列当可见字符、截断时拦腰斩断 → 裸码。
// 现已换成 ANSI 感知的 truncAnsi()（tools/tui/panel-render.ts）。色彩语义见 tmp/TUI-HUD-HANDOFF.md。
// ═══════════════════════════════════════════════════════════

/** NPC 好感度 helper */
function getNpcAffection(gs: any, name: string): number {
  return gs?.player?.relationships?.[name]?.affection ?? 0;
}
function isNpcLover(gs: any, name: string): boolean {
  return gs?.player?.relationships?.[name]?.romance === "恋人";
}

export function initGamePanel(_pi: any, sessionCtx: any) {
  let _tab = 0;
  let _cursor = 0;
  let _panelMode = false;
  let _expanded = false; // 折叠态：false=只显示 1 行摘要；双击 Enter 展开
  let _lastEnterTime = 0; // 双击 Enter 进面板的时间戳

  // ── 三级状态机 ──
  let _submenu: "npc-detail" | "npc-talk" | "npc-touch" | "npc-observe" | "npc-combat" | "npc-steal" | "npc-romance" | "item-detail" | "vehicle-detail" | "furniture-detail" | "equip-detail" | "body-detail" | "skills-detail" | "party-detail" | "reputation-detail" | "titles-detail" | "sex-detail" | "settlement-detail" | "go-nav" | "info-detail" | "info-section" | "economy-detail" | "combat-detail" | "relations-detail" | "world-detail" | "container-pick" | "phone-main" | "phone-messages" | "identity-detail" | "turnlog-detail" | "bag-empty" | "bag-list" | null = null;
  let _subCursor = 0; // 子菜单内部光标
  let _selectedTarget: any = null; // 当前交互的目标实体 (如选中 NPC, 物品, 载具)
  let _pickSlot: string | null = null; // equip-detail 空槽 Enter → 选物品模式（slot id）, null=正常槽列表

  let _choicesCache: string[] = [];
  let _choiceTags: string[] = [];
  let _condOptsCache: any[] = []; // Phase 1.5 条件选项（引擎扫描，行动 Tab 追加显示）
  let _peopleCache: any[] = [];
  let _lastProseHash = "";
  let _sortMode = 0; // 0=类型 1=名称 2=重量 3=最近（背包排序，非持久化）
  let _confirmMode: null | { action: string; item: any; slotId?: string; cb: () => void } = null;

  // ── 经济/战斗/世界子面板缓存（异步加载，渲染同步读）──
  let _econLines: string[] | null = null;
  let _combatLines: string[] | null = null;
  let _worldLines: string[] | null = null;
  const _gry = (s: string) => `${C.M}${s}${C.r}`;
  const _loadEconCombat = async () => {
    try {
      const h = require("./tools/helpers.ts");
      _econLines = [
        ...(h.renderShopLines ? await h.renderShopLines() : []),
        _gry("─".repeat(30)),
        ...(h.renderGambleLines ? await h.renderGambleLines() : []),
        _gry("─".repeat(30)),
        ...(h.renderHousingLines ? await h.renderHousingLines() : []),
      ];
      _combatLines = h.renderCombatLines ? await h.renderCombatLines() : [];
    } catch (e) {
      console.error("[econ/combat] 预加载失败:", e);
      _econLines = [_gry("数据加载失败")];
      _combatLines = [_gry("数据加载失败")];
    }
    try { _tuiRef?.requestRender?.(); } catch {}
  };
  const _loadWorld = async () => {
    try {
      const s0 = require("./engine/state.ts");
      const ws = s0.gameState?.worldState;
      if (!ws) { _worldLines = [_gry("（暂无世界状态数据）")]; return; }
      const lines: string[] = [];
      lines.push(_gry(`── 🌍 当前位置大势 ──`));
      const desc = s0.translateWorldState ? s0.translateWorldState(ws) : "";
      if (desc) lines.push(desc);
      _worldLines = lines;
    } catch (e) {
      console.error("[world-detail] 预加载失败:", e);
      _worldLines = [_gry("数据加载失败")];
    }
    try { _tuiRef?.requestRender?.(); } catch {}
  };

  // 收集当前 Tab 所有的可聚焦行
  let _focusItems: any[] = [];

  // 装备槽定义（render 和 handleInput 共用）
  const EQUIP_SLOTS_ALL = [
    { id: "top", label: "外套", femaleOnly: false }, { id: "shirt", label: "内搭", femaleOnly: false },
    { id: "inner_top", label: "胸罩", femaleOnly: true },
    { id: "bottom", label: "下装", femaleOnly: false }, { id: "inner_bot", label: "内裤", femaleOnly: false },
    { id: "legs", label: "袜", femaleOnly: false },
    { id: "feet", label: "鞋", femaleOnly: false }, { id: "head", label: "头饰", femaleOnly: false },
    { id: "acc", label: "配饰", femaleOnly: false }, { id: "acc2", label: "配饰②", femaleOnly: false },
    { id: "acc3", label: "配饰③", femaleOnly: false },
    { id: "right_hand", label: "主手", femaleOnly: false }, { id: "left_hand", label: "副手", femaleOnly: false },
    { id: "back", label: "背", femaleOnly: false },
  ];
  /** 按玩家性别过滤装备槽（女保留全，男去掉胸罩等专有槽） */
  const getEquipSlots = (gender?: string) =>
    EQUIP_SLOTS_ALL.filter(s => !s.femaleOnly || (gender || "").includes("女"));
  const EQUIP_SLOTS = getEquipSlots(); // 默认全量（render 里会按实性别再过滤）

  /** item-detail 可用操作（render 与 handleInput 共用，杜绝两处漂移）。
   *  slotId 来源=已装备（equip-detail 进入）；否则=背包物品。 */
  const _buildItemActions = (sel: any): { id: string; label: string }[] => {
    if (sel?.slotId) return [{ id: "unequip", label: "卸下放回背包" }, { id: "discard", label: "丢弃" }];
    const it = sel?.item;
    const acts: { id: string; label: string }[] = [];
    if (it?.type === "consumable") acts.push({ id: "use", label: "使用" });
    if (it?.slot) acts.push({ id: "equip", label: `装备 → ${EQUIP_SLOTS_ALL.find(s => s.id === it.slot)?.label || it.slot}` });
    if (it?.phoneData) acts.push({ id: "open_phone", label: "📱 打开手机" });
    acts.push({ id: "discard", label: "丢弃" });
    return acts;
  };

  /** 性征摘要段（自身 Tab 一级"性征"行；字段可能缺失，全程 ?. 并过滤空段）。
   *  focusItems 收集与渲染两处共用——条件必须一致，否则光标停在不存在的行上。 */
  const _buildSexSegs = (p: any): string[] => {
    const prof = p?.sex?.profile || {};
    const segs: string[] = [];
    if ((p?.gender || "").includes("女") && prof.female) {
      const f = prof.female;
      const br = [f.breast?.cup && `${f.breast.cup}-cup`, f.breast?.shape].filter(Boolean).join("");
      if (br) segs.push(br);
      const vg = [f.vagina?.type, f.vagina?.tightness].filter(Boolean).join("/");
      if (vg) segs.push(vg);
      if (f.pubic_hair?.amount) segs.push(`阴毛${f.pubic_hair.amount}`);
    } else if (prof.male) {
      const m = prof.male;
      if (m.penis?.length_cm || m.penis?.erect_length_cm)
        segs.push(`${m.penis?.length_cm ?? "?"}cm→勃起${m.penis?.erect_length_cm ?? "?"}cm·围${m.penis?.erect_girth_cm ?? "?"}cm`);
      if (m.pubic_hair?.amount) segs.push(`阴毛${m.pubic_hair.amount}`);
    }
    return segs;
  };

  // ── 外出导航（房间 Tab「外出」子面板，吃掉旧 /go /train）──
  let _goNavItems: any[] = []; // {kind:"header",label} | {kind:"dest",mode:"walk"|"train"|"unknown",name,mins,rawMins?,fare?,station?}

  /** 构建外出目的地列表。known_locations 过滤 = 信息可见性守恒（没去过的显示❓不可选） */
  const _buildGoNav = (gs: any, s: any): any[] => {
    const p = gs.player;
    const loc = p.location;
    const known: string[] = p.known_locations || [];
    const isKnown = (n: string) => known.some((k: string) => s.isSameLocation(k, n));
    const { estimateTravelMinutes } = require("./tools/helpers.ts");
    const nav = s.getLocationNav(loc);
    const mul = p.vehicle?.speedMul || 1;
    const items: any[] = [];
    const walk = (name: string, rawMins: number) => {
      items.push({ kind: "dest", mode: "walk", name, rawMins, mins: Math.max(1, Math.round(rawMins / mul)) });
    };
    if (nav.parent && !s.isSameLocation(nav.parent, loc)) {
      items.push({ kind: "header", label: "── 返回上级 ──" });
      walk(nav.parent, estimateTravelMinutes(loc, nav.parent));
    }
    const rooms = (nav.rooms || []).filter((r: string) => !s.isSameLocation(r, loc) && isKnown(r));
    if (rooms.length) {
      items.push({ kind: "header", label: "── 同层 ──" });
      for (const r of rooms) walk(r, estimateTravelMinutes(loc, r));
    }
    const nearby = nav.nearby || [];
    if (nearby.length) {
      items.push({ kind: "header", label: mul > 1 ? `── 附近 🚲×${mul} ──` : "── 附近 ──" });
      for (const n of nearby) {
        if (isKnown(n.name)) walk(n.name, n.minutes);
        else items.push({ kind: "dest", mode: "unknown", name: n.name, mins: Math.max(1, Math.round(n.minutes / mul)) });
      }
    }
    for (const st of nav.stations || []) {
      if (!st.destinations?.length) continue;
      items.push({ kind: "header", label: `── 电车 🚉 ${st.name} ──` });
      for (const d of st.destinations) {
        items.push({ kind: "dest", mode: "train", name: d.name, mins: d.minutes, fare: Math.round(d.minutes * 20), station: st.name });
      }
    }
    return items;
  };

  /** 外出落地（与 helpers.runNavigation.doMove 语义一致）：
   *  电车=扣钱+pendingTravel；步行≥15分=pendingTravel+旅途叙事；短途=直移+推进时间。 */
  const _doTravel = async (it: any) => {
    const s = require("./engine/state.ts");
    const h = require("./tools/helpers.ts");
    const gs = s.gameState;
    const ctx = getCtx();
    const vName = gs.player.vehicle?.name;
    if (it.mode === "train") {
      const fare = it.fare || 0;
      if (fare <= 0) { ctx?.ui?.notify("车费数据异常，无法购票", "warning"); return; }
      if (gs.player.funds < fare) { ctx?.ui?.notify(`资金不足！需要 ¥${fare}，当前 ¥${gs.player.funds}`, "warning"); return; }
      gs.player.funds -= fare;
      gs.pendingTravel = { from: gs.player.location, to: it.name, route: `电车 ${it.station}→${it.name}（${it.mins}分钟）`, minutes: it.mins, timeOfDay: gs.time.time_of_day };
      s.saveState();
      ctx?.ui?.notify(`🚃 ${it.station} → ${it.name}，¥${fare}`, "info");
      pushText(`玩家乘坐电车从 ${it.station} 前往 ${it.name}，约${it.mins}分钟。描述车窗外的风景，到达前调用 complete_travel。`);
    } else if ((it.rawMins ?? it.mins) >= 15) {
      gs.pendingTravel = { from: gs.player.location, to: it.name, route: vName ? `${vName}（约${it.mins}分钟）` : `步行/短途（约${it.rawMins}分钟）`, minutes: it.mins, timeOfDay: gs.time.time_of_day };
      s.saveState();
      ctx?.ui?.notify(`[旅行中] 前往 ${it.name}，行程 ${it.mins} 分钟`, "info");
      pushText(`玩家已出发前往 ${it.name}。${vName ? `骑${vName}，预计${it.mins}分钟到达。` : `步行约${it.rawMins}分钟。`}不要立即让他们到达目的地！请描述路上的见闻、风景。等剧情差不多了，再调用 complete_travel 工具。`);
    } else {
      const fromLoc = gs.player.location;
      await h.moveTo(it.name, ctx, gs, s.saveState);
      await h.advanceTimeMinutes(it.mins, ctx, gs, s.saveState);
      if (it.mins >= 2) pushText(`[移动] ${fromLoc} → ${it.name}，耗时 ${it.mins} 分钟${vName ? `（骑${vName}）` : ""}。`);
    }
  };

  // ── 行动 Tab 常驻动作（吃掉旧 /sleep；条件满足才出现）──

  /** 在家判定（与旧 tools/tui/sleep.ts 一致：自有房产 or 地名含 家/公寓/邸） */
  const _isAtHome = (gs: any): boolean => {
    const loc = gs.player.location || "";
    const ownsHere = Object.values(gs.player.properties || {}).some((pr: any) => pr?.name && (loc.includes(pr.name) || pr.name.includes(loc)));
    return ownsHere || loc.includes("家") || loc.includes("公寓") || loc.includes("邸");
  };

  /** 常驻动作列表：恒有等待；在家→睡觉；背包有消耗品→吃。渲染与 focusItems 收集共用。 */
  const _buildStandingActions = (gs: any): any[] => {
    const acts: any[] = [];
    acts.push({ id: "wait", icon: "⏳", label: "原地等待", hint: "30分钟" });
    if (_isAtHome(gs)) {
      const tired = (gs.player.fatigue ?? 0) >= 70;
      acts.push({ id: "sleep", icon: "💤", label: "睡到明早", hint: "在家·HP/疲劳全恢复", hot: tired });
    }
    // 存放物品：同房间有未锁家具容器 + 背包非空
    try {
      const inv2 = gs.player.inventory || [];
      if (inv2.length) {
        const s0 = require("./engine/state.ts");
        const containers = s0.getContainersAt ? s0.getContainersAt(gs.player.location, gs.player.gridPos || undefined) || [] : [];
        const avail = containers.filter((c: any) => c.ownerType === "furniture" && !c.def?.locked);
        if (avail.length) {
          const cname = (avail[0].ownerId && avail[0].ownerId.includes("·")) ? avail[0].ownerId.split("·")[1] : "储物";
          acts.push({ id: "store", icon: "📥", label: "存放物品", hint: `→ ${cname}(${avail[0].items?.length || 0}件)`, container: avail[0] });
        }
      }
    } catch {}
    const foods = (gs.player.inventory || []).filter((i: any) => i.type === "consumable");
    if (foods.length) {
      const counts: Record<string, number> = {};
      for (const f of foods) counts[f.name] = (counts[f.name] || 0) + 1;
      const summary = Object.entries(counts).slice(0, 2).map(([n2, c2]) => c2 > 1 ? `${n2}×${c2}` : n2).join("·");
      acts.push({ id: "eat", icon: "🍱", label: "吃点东西", hint: `背包:${summary}` });
    }
    return acts;
  };

  /** 常驻动作落地：纯引擎直改+notify，不推正文（守恒量路径） */
  const _doStandingAction = async (act: any) => {
    const s = require("./engine/state.ts");
    const h = require("./tools/helpers.ts");
    const gs = s.gameState;
    const ctx = getCtx();
    if (act.id === "wait") {
      await h.advanceTimeMinutes(30, ctx, gs, s.saveState);
    } else if (act.id === "sleep") {
      // 与旧 /sleep 一致：+1天、满血、疲劳清零
      const { advanceTime } = require("./engine/time.ts");
      gs.time = advanceTime(gs.time, 1);
      gs.player.hp.current = gs.player.hp.max;
      gs.player.fatigue = 0;
      if (s.stampRoom) s.stampRoom();
      s.saveState();
      ctx?.ui?.notify(`😴 一觉睡到 ${gs.time.game_date} ${gs.time.day_of_week}曜日早上。HP/体力全恢复。`, "info");
    } else if (act.id === "eat") {
      const idx = (gs.player.inventory || []).findIndex((i: any) => i.type === "consumable");
      if (idx < 0) { ctx?.ui?.notify("背包里没有能吃的了", "warning"); return; }
      const food = gs.player.inventory[idx];
      for (const ef of food.effects || []) {
        if (ef.type === "heal") {
          const amt = typeof ef.value === "number" ? ef.value : (parseInt(ef.value) || 5);
          gs.player.hp.current = Math.min(gs.player.hp.max, gs.player.hp.current + amt);
        }
      }
      gs.player.inventory.splice(idx, 1);
      s.saveState();
      ctx?.ui?.notify(`🍱 吃了 ${food.name}，HP ${gs.player.hp.current}/${gs.player.hp.max}`, "info");
    } else if (act.id === "store") {
      const container = act.container;
      if (!container) { ctx?.ui?.notify("附近没有可用的容器", "warning"); return; }
      const idx = (gs.player.inventory || []).findIndex((i: any) => !i.slot); // 选第一件非装备物品
      if (idx < 0) { ctx?.ui?.notify("背包没有可存放的物品（有装备槽的先卸下）", "warning"); return; }
      const item = gs.player.inventory[idx];
      const tf = s.transferBetweenContainers;
      const r = tf ? tf("backpack", container.id, item.name) : "引擎不可用";
      s.saveState();
      ctx?.ui?.notify(`📥 ${r}`, "info");
    }
  };

  // ── 情报子面板（吃掉旧 /info 六合一；二级=六项菜单，三级=单段内容）──
  let _tuiRef: any = null;      // pi-tui 实例，异步加载完成后主动 requestRender
  let _infoSections: string[][] | null = null; // 六段内容（与 _INFO_SECTIONS 同序），null=加载中
  let _infoSecIdx = 0;          // info-section 当前查看的段

  const _INFO_SECTIONS = [
    { icon: "🚨", label: "警报" },
    { icon: "📋", label: "任务" },
    { icon: "🪝", label: "钩子" },
    { icon: "📅", label: "日历" },
    { icon: "🏛️", label: "势力" },
    { icon: "🌍", label: "世界" },
    { icon: "🌈", label: "天气" },
    { icon: "🏆", label: "成就" },
    { icon: "📜", label: "日志" },
  ];

  /** 九项菜单右侧的同步摘要（轻量，直接读 gameState，不等异步加载） */
  const _infoSummary = (gs: any, idx: number): string => {
    try {
      if (idx === 0) {
        const f = gs.flags || {};
        const bits: string[] = [];
        if (f.wanted) bits.push("👮通缉");
        if (f.steal_alert) bits.push("🚨警报");
        if (f.identity_exposed) bits.push("🎭暴露");
        if (f.school_alert) bits.push("🏫警戒");
        return bits.length ? bits.join(" ") : "✅正常";
      }
      if (idx === 1) {
        const qs = gs.quests || {};
        const actives = Object.values(qs).filter((q: any) => q.status === "active");
        const total = Object.keys(qs).length;
        return actives.length ? `${actives.length}进行中 · 共${total}` : total ? `${total}已结束` : "暂无任务";
      }
      if (idx === 2) {
        const hooks = gs.active_hooks || [];
        return hooks.length ? `${hooks.length}个待触发` : "暂无钩子";
      }
      if (idx === 3) {
        const { getTodayCalendar } = require("./engine/timeline.ts");
        const ev = getTodayCalendar();
        if (!ev) return "今日无事件";
        const s3 = String(ev);
        return s3.length > 9 ? s3.slice(0, 9) + "…" : s3;
      }
      if (idx === 4) {
        const orgCount = Object.keys(gs.organizations || {}).length;
        return orgCount ? `${orgCount}个组织` : "无已知组织";
      }
      if (idx === 5) {
        if (!gs?.worldState) return "暂无数据";
        return `${gs.worldState.regime?.slice(0,6)||"?"} · 繁荣${gs.worldState.prosperity??0}`;
      }
      if (idx === 6) return [gs.time?.weather, gs.time?.season].filter(Boolean).join(" · ") || "当前天气·预报";
      if (idx === 7) {
        const flags = gs.flags || {};
        let total = 0, unlocked = 0;
        try {
          const fs = require("node:fs"); const path = require("node:path");
          const rules = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data", "achievements.json"), "utf-8"));
          total = rules.length;
          unlocked = rules.filter((r: any) => !!flags[r.id]).length;
        } catch {}
        return total ? `${unlocked}/${total} 已解锁` : "未配置";
      }
      if (idx === 8) {
        const tlogN = (gs.turnLog || []).length;
        const ssfLen = (gs.storySoFar || "").length;
        if (!tlogN && !ssfLen) return "暂无记录";
        return `${tlogN}回合 · ${ssfLen}字摘要`;
      }
    } catch {}
    return "";
  };

  /** 异步拼装九段情报（复用 helpers 现成渲染函数），完成后触发重绘 */
  const _loadInfoLines = async () => {
    try {
      const h = require("./tools/helpers.ts");
      _infoSections = await Promise.all([
        h.renderAlertsLines(), h.renderQuestDetailLines(), h.renderHookDetailLines(),
        h.renderCalendarLines(), h.renderOrgBrowserLines(), h.renderWorldLines(),
        h.renderWeatherLines(), h.renderAchievementLines(), h.renderStoryLogLines(),
      ]);
    } catch (e: any) {
      console.error("[info-detail] 情报加载失败:", e?.message || e);
      _infoSections = _INFO_SECTIONS.map(() => ["情报加载失败，请看控制台"]);
    }
    try { _tuiRef?.requestRender?.(); } catch {}
  };

  /** 取最新 ctx，兜底用 session ctx */
  const getCtx = () => _latestCtx || sessionCtx;

  /** 把第一人称文本作为玩家消息推入 LLM 流水线（等价玩家打字，走 input 钩子 → Phase 1-3）。
   *  旧 ctx.chat.addSystemMessage 是 pi 遗留 API（v0.74.2 已无 chat 属性，可选链静默失效）。
   *  无条件 deliverAs:"followUp"：idle 时 pi 忽略该参数并立即触发一轮；流式中排队到本轮结束
   *  （流式 throw 是异步 rejection，同步 catch 接不到，必须前置指定）。 */
  const pushText = (text: string) => {
    const t = (text ?? "").trim();
    if (!t) return; // 亲密失败分支等会传空串
    try {
      _pi.sendUserMessage(t, { deliverAs: "followUp" });
      const ctx = getCtx();
      if (typeof ctx?.isIdle === "function" && !ctx.isIdle())
        ctx?.ui?.notify("已排队，本轮叙事结束后发送", "info");
    } catch (e) {
      console.error("[game-hud] pushText: sendUserMessage 失败", e);
      getCtx()?.ui?.notify("消息发送失败", "error");
    }
  };

  /** 位置描述：基于网格坐标 + 房间家具标签，如 "靠右" / "靠窗" / "桌前" */
  const posLabel = (gp: any, rm: any): string => {
    if (!gp || !rm) return "";
    const [x,y] = Array.isArray(gp) ? gp : [0,0];
    let lbl = ""; const rw=rm.width||10, rh=rm.height||6;
    if (y===0) lbl="靠墙"; else if (y===rh-1) lbl="靠后墙";
    if (x===0) lbl+="靠左"; else if (x===rw-1) lbl+="靠右";
    if (!lbl) lbl="中间";
    const c=rm.cells?.[y]?.[x];
    // cell.label 可能是内部代号（如 "DR"），只采用含中文的可读标签
    const cl = c?.label?.trim();
    if (cl && cl !== "" && /[一-鿿]/.test(cl)) lbl = cl;
    return lbl;
  };

  const getNPCStatusLabel = (gs: any, name: string): string => {
    const aff = getNpcAffection(gs, name);
    if (aff >= 80) return "♥ 极度亲密";
    if (aff >= 50) return "💕 关系亲密";
    if (aff >= 30) return "✓ 友友好奇";
    if (aff >= 10) return "◇ 略微熟悉";
    return "⚠ 警惕观察";
  };

  /** 读 NPC 身高：兼容运行时 npcs 实例和 findCharacter 静态模板数据 */
  const getNpcHeight = (name: string, npc: any): string|number => {
    if (npc.height_cm) return npc.height_cm;
    if (npc.height) return npc.height;
    if (npc.body?.height_cm) return npc.body.height_cm;
    try {
      const s = require("./engine/state.ts");
      const char = s.findCharacter(name);
      if (char) {
        if (char.height_cm) return char.height_cm;
        if (char.height) return char.height;
        if (char.body?.height_cm) return char.body.height_cm;
        if (char.body_by_age && typeof char.body_by_age === "object") {
          const age = s.getNpcCurrentAge(char.base_age || 16);
          const bd = char.body_by_age[String(age)] || Object.values(char.body_by_age)[0];
          if (bd?.height_cm) return bd.height_cm;
        }
      }
    } catch {}
    return "?";
  };

  /** 玩家洞察技能等级 */
  const _getNpcInsightLevel = (gs: any): number => gs?.player?.skills?.洞察 ?? 0;

  /** 构建 NPC 操作栏（8项 + 可选⑨亲密），含条件标签。Sex 模式下替换为 7 项专用操作 */
  const _buildNpcActions = (gs: any, name: string) => {
    const mode = gs.mode || "rpg";
    const aff = getNpcAffection(gs, name);
    const lover = isNpcLover(gs, name);
    const pSkills = gs?.player?.skills || {};
    const hasInsight = (pSkills.洞察 || 0) >= 1;
    const hasStealth = (pSkills.潜行 || 0) >= 1;
    const hasPsych = (pSkills.心理 || pSkills.话术 || 0) >= 1;
    if (mode === "sex") {
      const acts: { label: string; key: number; locked: boolean }[] = [
        { label: "①爱抚", key: 20, locked: false },
        { label: "②亲吻", key: 21, locked: false },
        { label: "③进入", key: 22, locked: false },
        { label: "④换体位", key: 23, locked: false },
        { label: "⑤挑逗", key: 24, locked: false },
        { label: "⑥状态", key: 25, locked: false },
        { label: "⑦结束", key: 26, locked: false },
      ];
      return acts;
    }
    const acts: { label: string; key: number; locked: boolean }[] = [
      { label: "①搭话", key: 0, locked: false },
      { label: aff < 10 ? "②接触≥10" : "②接触", key: 1, locked: aff < 10 },
      { label: hasInsight ? "③观察" : "③观察·洞察", key: 2, locked: false },
      { label: (aff < 40 && !lover) ? "④组队≥40" : "④组队", key: 3, locked: aff < 40 && !lover },
      { label: aff < 50 ? "⑤恋爱≥50" : "⑤恋爱", key: 4, locked: aff < 50 },
      { label: "⑥战斗", key: 5, locked: false },
      { label: hasStealth ? "⑦窃取" : "⑦窃取·潜行", key: 6, locked: !hasStealth },
      { label: hasPsych ? "⑧暗示" : "⑧暗示·心理", key: 7, locked: !hasPsych },
    ];
    if (lover && aff >= 80) {
      acts.push({ label: "⑨亲密", key: 8, locked: false });
    }
    // 技能驱动交互项（动态追加）
    for (const [sName, sv] of Object.entries(pSkills) as [string, any][]) {
      const lvl = sv?.level ?? 0;
      if (lvl <= 0) continue;
      if (sName === "医疗" || sName === "治疗") {
        acts.push({ label: `🩹${sName}Lv${lvl}`, key: 30, locked: false });
      } else if (sName === "说服" || sName === "口才" || sName === "话术") {
        acts.push({ label: `🗣${sName}Lv${lvl}`, key: 31, locked: false });
      } else if (sName === "暗示" || sName === "催眠") {
        acts.push({ label: `🌀${sName}Lv${lvl}`, key: 32, locked: false });
      }
    }
    return acts;
  };

  function furnitureActions(f:string):string{
    if(/桌/.test(f))return "使用/查看/开抽屉";
    if(/架/.test(f))return "查看/取书";
    if(/板/.test(f))return "书写/擦除";
    if(/床/.test(f))return "休息/查看";
    if(/贩卖机/.test(f))return "购买";
    if(/椅|沙发|凳/.test(f))return "坐下";
    if(/柜|箱/.test(f))return "打开/存放";
    return "查看/使用";
  }

  function _handleNpcAction(gs:any,name:string,key:number){
    const ctx=getCtx();
    const aff=getNpcAffection(gs,name);const lover=isNpcLover(gs,name);
    const pty:string[]=gs?.player?.party||[];
    if(key===0){
      pushText(`我找 ${name} 聊天。`);
      ctx?.ui?.notify(`向${name}搭话`, "info");
      _panelMode=false;
    }
    else if(key===1){if(aff<10){ctx?.ui?.notify(`与${name}关系还不够熟`,"warning");return;}_doTouch(gs,name);}
    // key===2 → 观察子面板（由 handleInput 路由，不经过这里）
    else if(key===3){
      if(aff<40&&!lover){ctx?.ui?.notify(`好感需≥40或恋人`,"warning");return;}
      if(pty.includes(name)){
        gs.player.party=pty.filter((n:string)=>n!==name);
        pushText(`${name}离开了队伍。`);
        ctx?.ui?.notify(`${name}离队`, "info");
      } else {
        gs.player.party=[...pty,name];
        pushText(`${name}加入了队伍。`);
        ctx?.ui?.notify(`${name}入队`, "info");
      }
      require("./engine/state.ts").saveState();_panelMode=false;
    }
    else if(key===4){
      if(aff<50){ctx?.ui?.notify("好感需≥50","warning");return;}
      _doDate(gs,name);_panelMode=false;
    }
    // key===5/6 → 战斗/窃取子菜单，key===4 → 恋爱子菜单（由 handleInput 路由）
    // key===20-26 → Sex 模式专用操作
    else if(key===20){pushText(`我轻轻抚摸 ${name}。`);ctx?.ui?.notify(`爱抚${name}`, "info");_panelMode=false;}
    else if(key===21){pushText(`我吻向 ${name}。`);ctx?.ui?.notify(`亲吻${name}`, "info");_panelMode=false;}
    else if(key===22){pushText(`我进入 ${name} 的身体。`);ctx?.ui?.notify(`进入${name}`, "info");_panelMode=false;}
    else if(key===23){pushText(`我变换了体位。`);ctx?.ui?.notify("变换体位", "info");_panelMode=false;}
    else if(key===24){pushText(`我对 ${name} 说着挑逗的话。`);ctx?.ui?.notify(`挑逗${name}`, "info");_panelMode=false;}
    else if(key===25){
      // ⑥状态 → 展开自身 sex-detail
      pushText(`我看了看 ${name} 的状态。`);
      ctx?.ui?.notify(`查看${name}性状态`, "info");
      _panelMode=false;
    }
    else if(key===26){gs.mode=gs._prevMode||"gal";gs._prevMode=undefined;require("./engine/state.ts").saveState();pushText(`我和 ${name} 结束了亲密。`);ctx?.ui?.notify("结束亲密", "info");_panelMode=false;}
    else if(key===7){
      // ⑧暗示 — 需心理或话术技能
      const hasPsych = (gs?.player?.skills?.心理 || gs?.player?.skills?.话术 || 0) >= 1;
      if(!hasPsych){ctx?.ui?.notify("需要心理或话术技能Lv1+", "warning");return;}
      pushText(`我对 ${name} 发出了微妙的暗示。`);
      ctx?.ui?.notify(`对${name}使用暗示`, "info");
      _panelMode=false;
    }
    else if(key===8){
      if(!lover||aff<80){ctx?.ui?.notify("需恋人+好感≥80","warning");return;}
      const ok=Math.random()>0.2;
      if(ok){
        gs.mode="sex";gs.layer1Enabled=true;
        ctx?.ui?.notify(`与${name}进入亲密模式`, "info");
      } else {
        const rel=gs.player.relationships[name];if(rel)rel.affection=Math.max(0,(rel.affection||0)-15);
        ctx?.ui?.notify(`${name}拒绝了…好感-15`, "warning");
      }
      require("./engine/state.ts").saveState();
      pushText(ok?`${name}红着脸点了点头…`:``);
      _panelMode=false;
    }
    // 技能交互
    else if(key===30){pushText(`我对 ${name} 进行伤势检查与包扎治疗。`);ctx?.ui?.notify(`医疗${name}`, "info");_panelMode=false;}
    else if(key===31){pushText(`我施展话术，试图说服 ${name}。`);ctx?.ui?.notify(`说服${name}`, "info");_panelMode=false;}
    else if(key===32){pushText(`我凝视着 ${name} 的眼睛，尝试施加暗示…`);ctx?.ui?.notify(`暗示${name}`, "info");_panelMode=false;}
  }

  function _doTouch(gs:any,name:string,levelIdx?:number){
    const ctx=getCtx();
    const aff=getNpcAffection(gs,name);const{updateRelation,saveState}=require("./engine/state.ts");
    const levels=[{n:"握手",min:0,rw:2,pen:2},{n:"摸头",min:30,rw:2,pen:5},{n:"拥抱",min:50,rw:3,pen:10},{n:"按摩",min:60,rw:3,pen:10,needL1:true},{n:"亲吻",min:70,rw:5,pen:15}];
    // 指定了具体等级：只执行该项（需满足门槛）
    if (levelIdx !== undefined && levelIdx >= 0 && levelIdx < levels.length) {
      const l = levels[levelIdx]!;
      if (aff < l.min || (l.needL1 && !gs.layer1Enabled)) {
        ctx?.ui?.notify(`条件不满足：${l.n}需要好感≥${l.min}${l.needL1?" 且开启Layer1":""}`, "warning");
        return;
      }
      const ok=Math.random()>0.2;const msg=ok?`我与${name}${l.n}。✓ 好感+${l.rw}`:`${name}拒绝了${l.n}。✗ 好感-${l.pen}`;
      if(ok){updateRelation(gs.player.relationships,name,l.rw,l.n);ctx?.ui?.notify(`${l.n}${name} ✓ +${l.rw}`, "info");}
      else{updateRelation(gs.player.relationships,name,-l.pen,`${l.n}被拒`);ctx?.ui?.notify(`${name}拒绝${l.n} -${l.pen}`, "warning");}
      saveState();pushText(msg);_panelMode=false;return;
    }
    // 未指定 → 自动匹配最高可用（快捷按钮路径）
    for(let i=levels.length-1;i>=0;i--){
      const l=levels[i]!;if(aff>=l.min&&(!l.needL1||gs.layer1Enabled)){
        const ok=Math.random()>0.2;const msg=ok?`我与${name}${l.n}。✓ 好感+${l.rw}`:`${name}拒绝了${l.n}。✗ 好感-${l.pen}`;
        if(ok){updateRelation(gs.player.relationships,name,l.rw,l.n);ctx?.ui?.notify(`${l.n}${name} ✓ +${l.rw}`, "info");}
        else{updateRelation(gs.player.relationships,name,-l.pen,`${l.n}被拒`);ctx?.ui?.notify(`${name}拒绝${l.n} -${l.pen}`, "warning");}
        saveState();pushText(msg);_panelMode=false;return;
      }
    }
    ctx?.ui?.notify("条件未满足","warning");
  }

  function _doDate(gs:any,name:string){
    const ctx=getCtx();
    const aff=getNpcAffection(gs,name);if(aff<50)return;
    const rel=gs.player.relationships[name]||(gs.player.relationships[name]={stage:"熟人",affection:aff,history:[],notes:""});
    const ok=Math.random()>0.2;
    if(ok){rel.affection=Math.min(100,(rel.affection||0)+5);ctx?.ui?.notify(`约${name}成功 ✓ +5`, "info");}
    else{rel.affection=Math.max(0,(rel.affection||0)-5);ctx?.ui?.notify(`${name}说有事… -5`, "warning");}
    require("./engine/state.ts").saveState();
    pushText(ok?`我约 ${name} 周末出去玩。${name}：「好啊。」好感+5`:`约 ${name} 出去玩，但${name}说有事。好感-5`);
  }

  const widget = {
    render(w: number): string[] {
      try {
        const W = Math.max(20, w - 2) - 2; // 减 2 列给左侧竖线轨道 "│ "
        // 竖线轨道：聚焦区 → 粗橙 ┃，其余 → 灰 │
        const _secOf = (ft: string|null): string|null =>
          !ft ? null : (ft === "identity" || ft === "titles" || ft === "reputation" || ft === "infoline") ? "info"
          : (ft === "body" || ft === "sex" || ft === "equip" || ft === "skills" || ft === "bag" || ft === "vehicle" || ft === "party") ? "gear"
          : (ft === "gonav") ? "nav" : null;
        const tr = (s: string, sec?: string|null, focus?: boolean) => {
          const active = sec && sec === _secOf(_panelMode ? _focusItems[_cursor]?.type : null);
          const rail = active ? `${C.O}${C.B}┃${C.r} ` : `${C.M}│${C.r} `;
          return rail + truncAnsi(s, W);
        };
        // ── 着色小工具（世界书风格：灰为主，橙点睛）──
        const gray = (s: string) => `${C.M}${s}${C.r}`;
        const dim  = (s: string) => `${C.M}${C.I}${s}${C.r}`;   // 灰斜体（心里话）
        const hi   = (s: string) => `${C.O}${s}${C.r}`;         // 橙（选中/可用）
        const gold = (s: string) => `${C.Y}${s}${C.r}`;         // 金（钱）
        const head = (s: string) => `${C.M}【 ${C.r}${C.W}${C.B}${s}${C.r}${C.M} 】${C.r}`; // 区块标头：括号灰、字白粗
        const COL = 10; // 统一对齐线（视觉列数）= 5中文字宽
        /** 把 s pad 到视觉列 COL（所有 kv 的 │ 和入口行的 │ 都在同一列） */
        const padCol = (s: string) => s + " ".repeat(Math.max(0, COL - visW(s)));
        /** key │ value 竖排行：键白，pad 到 COL 后 │ 白，值白 */
        const kv = (key: string, val: string) =>
          `  ${padCol(key)} │ ${val}`;
        /** 入口行（身体/装备/技能/背包/队伍等可聚焦项），对齐到 kv 的 │ 列 */
        const entry = (focus: boolean, label: string, val: string, suffix?: string) =>
          ` ${focus ? hi("▶") : " "} ${padCol(label)} ${C.M}│${C.r} ${val}${suffix ? " " + suffix : ""}`;
        /** 进度条: bar(45,100,10) → "██████░░░░ [45/100]"，low=true 变红。max<=0 时按空条处理 */
        const bar = (val: number, max: number, w: number = 10, low = false): string => {
          const pct = max > 0 ? Math.max(0, Math.min(1, val / max)) : 0;
          const n = Math.round(pct * w);
          const fill = n > 0 ? `${low ? C.d : C.G}${"█".repeat(n)}` : "";
          const rest = n < w ? `${C.M}${"░".repeat(w - n)}` : "";
          return `${fill}${rest}${C.r} [${val}/${max}]`;
        };
        /** 方块条（世界书 ■■□□□ 风格）: sq(12,20,5) → "■■■□□ [12/20]" */
        const sq = (val: number, max: number, w: number = 5, low = false): string => {
          const pct = max > 0 ? Math.max(0, Math.min(1, val / max)) : 0;
          const n = Math.round(pct * w);
          const fill = n > 0 ? `${low ? C.d : C.G}${"■".repeat(n)}` : "";
          const rest = n < w ? `${C.M}${"□".repeat(w - n)}` : "";
          return `${fill}${rest}${C.r} ${C.M}[${C.r}${val}${C.M}/${C.r}${max}${C.M}]${C.r}`;
        };
        /** 属性偏离注解（10=常人基线，只标偏离值） */
        const attrNote = (v: number): string => {
          if (v >= 14) return dim(" (远超常人)");
          if (v >= 12) return dim(" (出色)");
          if (v <= 5) return dim(" (相当孱弱)");
          if (v <= 7) return dim(" (低于常人)");
          return "";
        };
        /** 可见宽度（中文2，ANSI 0）*/
        const visW = (s: string): number => {
          let ww = 0, esc = false;
          for (let i = 0; i < s.length; i++) {
            const ch = s[i]!;
            if (esc) { if (ch === "m") esc = false; continue; }
            if (ch === "\x1b") { esc = true; continue; }
            ww += ch.charCodeAt(0) > 0x7f ? 2 : 1;
          }
          return ww;
        };

        const s = require("./engine/state.ts");
        const gs = s.gameState;
        const p = gs?.player;
        if (!p) return [];

        const out: string[] = [];
        const loc = p.location||"???";
        const t = gs.time;
        const mode = gs.mode||"rpg";
        const hp=p.hp?.current??10, hpM=p.hp?.max??15, ac=p.ac||10;
        const weather=t?.weather||"";
        const wIcon=weather.includes("雨")?"🌧":weather.includes("雪")?"❄":"☀";
        const rm=s.getRoom(loc);
        const prose=(gs as any)._renderedProse||"";

        // 更新选项缓存
        const ph=prose.length;
        const pk=ph+prose.slice(-30);
        if(pk!==_lastProseHash){
          _lastProseHash=pk;
          _choicesCache=[];
          _choiceTags=[];
          _condOptsCache=[];
          if(prose){
            try {
              const{parseRoleOptions}=require("./engine/parse-options.ts");
              const r=parseRoleOptions(prose);
              for(const c of(r.options||[])){
                _choicesCache.push(c.text);
                _choiceTags.push(c.tag||"");
              }
            } catch {}
          }
          // Phase 1.5 条件选项（引擎侧扫描，展示层追加；去重：已有的不重复）
          try {
            const{scanConditionalOptions}=require("./engine/conditional-options.ts");
            const conds=scanConditionalOptions(gs);
            const seen=new Set(_choicesCache.map((t:string)=>t.slice(0,20)));
            for(const c of conds) {
              if(!seen.has(c.text.slice(0,20))) {
                _condOptsCache.push({text:c.text,tag:c.tag,type:"conditional"});
                seen.add(c.text.slice(0,20));
              }
            }
            if(_condOptsCache.length>4) _condOptsCache=_condOptsCache.slice(0,4);
          } catch {}
        }

        // 加载周边人物
        const nearby=Object.entries(gs.npcs||{}).filter(([_,n]:any)=>n.alive!==false&&s.isSameLocation(n.currentRoom,loc));
        _peopleCache=nearby.map(([name,npc]:[string,any])=>{
          const rel=p.relationships?.[name];
          return{
            name, type:"named", gp:npc.gridPos||npc.grid_pos||[0,0],
            height:getNpcHeight(name, npc),
            posDesc:posLabel(npc.gridPos||npc.grid_pos,rm),
            dist:npc.distance||npc.dist||2,
            affection:rel?.affection??0, stage:rel?.stage||"陌生", romance:rel?.romance||"",
            lh:npc.equipment?.left_hand?.name||npc.left_hand||"",
            rh:npc.equipment?.right_hand?.name||npc.right_hand||"",
            lastWords:(npc.lastWords||"").replace(/^\[.*?\]\s*/,""), action:npc.action||""
          };
        });
        try {
          const rc=s.getNamelessNPCs(loc,gs.turn)as any[];
          const sc=(gs as any)._testCrowd||[];
          for(const c of[...rc,...sc]) {
            _peopleCache.push({
              name:c.name||"???", type:"crowd", gp:c.gridPos||[0,0], height:c.height||"?",
              posDesc:posLabel(c.gridPos,rm), dist:"?", clusterSize:c.count||c.clusterSize||1,
              action:c.act||c.action||"", affection:0, stage:"", romance:"", lh:"", rh:"", lastWords:""
            });
          }
        } catch {}

        // ── 收起态摘要行（始终作为第一行）：[ 区域|HH:MM-天气|季节 ] + 模式 logo ──
        const modeLogo = mode === "sex" ? "🔞" : mode === "gal" ? "🌸"
          : gs.interactionMode === "novel" ? "📖" : "🎮";
        let region = loc, clock = "", season = "", wx = "", dayType = "";
        try {
          const sl = require("./engine/state-location.ts");
          const nav = sl.getLocationNav(loc);
          // 收起态开头永远是国家级：树里有链取顶层，动态住宅等不在树里的退化到世界根名
          region = (nav?.breadcrumb?.length > 1) ? nav.breadcrumb[0] : sl.getWorldRootName();
        } catch {}
        try {
          const cp = require("./engine/time.ts").getClockParts(t);
          clock = cp.display_time; season = cp.season;
        } catch {}
        wx = gs.weather?.type || "";
        // 平日/休日（土·日=休日），对标世界书 |平日]
        const dow = t?.day_of_week || "";
        dayType = (dow === "土" || dow === "日" || dow === "六" || dow === "天") ? "休日" : "平日";
        // 灰框白字（与开场日期行 |-[土曜日-…] 同款：|-[ ] | 分隔符灰，内容白）
        const summarySegs = [region, `${clock}${wx ? gray("-") + wx : ""}`, `${season}${gray("·")}${dayType}`].filter(Boolean);
        const summaryLine = `${gray("|-[")}${summarySegs.join(gray("|"))}${gray("]")} ${modeLogo}`;

        // 收起态：只显示摘要行
        if (!_expanded) {
          out.push(tr(summaryLine));
          return out;
        }

        // 确认对话框模式（拦截在渲染最前面，覆盖所有 Tab 内容）
        if (_confirmMode) {
          out.push(tr(""));
          out.push(tr(head("确认")));
          const actionLabels: Record<string,string> = { discard: "丢弃", deathmatch: "发起死斗", delete_save: "删除存档" };
          const actionWarn = _confirmMode.action === "deathmatch" ? "（好感-50，关系降为死敌，不可撤销）" : "（不可撤销）";
          const itemName = typeof _confirmMode.item === "string" ? _confirmMode.item : (_confirmMode.item?.name || "?");
          out.push(tr(`  ${C.d}⚠ 确定要${actionLabels[_confirmMode.action] || _confirmMode.action}「${itemName}」？${C.r}`, "gear"));
          out.push(tr(gray(`  ${actionWarn}`), "gear"));
          out.push(tr(""));
          out.push(tr(` ${_subCursor === 0 ? hi("▶") : " "} ① 确认`));
          out.push(tr(` ${_subCursor === 1 ? hi("▶") : " "} ② 取消`));
          out.push(tr(gray("─".repeat(46)), "gear"));
          out.push(tr(gray("↑↓ 或 1/2 · Esc=取消"), "gear"));
          // 跳过正常面板渲染（聚焦行只有确认和取消）
          _focusItems = [{ type: "confirm_yes" }, { type: "confirm_no" }];
          // Tab 栏仍显示（上下文提示哪个 Tab 下触发的）
          out.push(tr(""));
          const tbar = " " + ["自身","周边","房间","行动"].map((lb,i) => i===_tab ? `${C.O}${C.B}▶[${lb}]◀${C.r}` : gray(` [${lb}] `)).join(gray("│"));
          out.push(tr(tbar));
          _expanded = true; // 确认模式下保持展开
          return out;
        }

        // 收集焦点项并生成 Tab 栏
        _focusItems = [];
        const TABS = ["自身","周边","房间","行动"];
        const hline = gray("─".repeat(Math.min(W, 80)));
        out.push(tr(summaryLine));
        out.push(tr(hline));
        const tabBar = " " + TABS.map((lb,i) =>
          i===_tab ? `${C.O}${C.B}▶[${lb}]◀${C.r}` : gray(` [${lb}] `)
        ).join(gray("│"));
        out.push(tr(tabBar));
        out.push(tr(hline));

        // ── 自身 Tab 渲染 ──
        if (_tab === 0) {
          const gdot2 = ` ${C.M}·${C.r} `; // 自身 Tab 全域可用（子面板 sex-detail body-detail 等也在此分支内）
          const eq = p.equipment || {};
          // 焦点项（顺序=显示顺序）：称号 · 声望 · 身体 · [性状态·性征] · 装备 · 技能 · 背包×n · 载具 · 队伍
          _focusItems.push({ type: "identity" });
          _focusItems.push({ type: "titles" });
          _focusItems.push({ type: "reputation" });
          _focusItems.push({ type: "body" });
          _focusItems.push({ type: "equip" });
          _focusItems.push({ type: "skills" });
          const inv = [...(p.inventory || [])].sort((a: any, b: any) => {
            if (_sortMode === 1) return (a.name || "").localeCompare(b.name || "");
            if (_sortMode === 2) return (a.weight || 0) - (b.weight || 0);
            if (_sortMode === 3) return (b._acquiredAt || 0) - (a._acquiredAt || 0);
            return (a.type || "").localeCompare(b.type || "");
          });
          _focusItems.push({ type: "bag" });
          if (p.vehicle) { _focusItems.push({ type: "vehicle", vehicle: p.vehicle }); }
          _focusItems.push({ type: "economy" });
          _focusItems.push({ type: "combat" });
          _focusItems.push({ type: "party" });
          _focusItems.push({ type: "infoline" });

          // 子菜单渲染
          if (_submenu === "item-detail" && _selectedTarget) {
            const it = _selectedTarget.item || _selectedTarget;
            out.push(tr(`o ${it.name || "物品"}`));
            out.push(tr(`  类型: ${it.type || "装备"} · ${it.weight ?? 0}kg · ${it.volume ?? 0}L`));
            if (it.state && it.state !== "intact") out.push(tr(`  状态: ${it.state === "ruined" ? "损毁💀" : "破损⚠️"}`));
            if (it.damage?.dice) out.push(tr(`  伤害: ${it.damage.dice}（${it.damage.damageType || "物理"}）`));
            if (Array.isArray(it.effects) && it.effects.length)
              out.push(tr(`  效果: ${it.effects.map((e: any) => `${e.type}:${e.value}`).join("  ")}`));
            if (it.flavor) out.push(tr(`  描述: "${it.flavor}"`));
            // 物品对比：有 slot 时显示当前槽位装备
            if (it.slot && p.equipment[it.slot]) {
              const cur = p.equipment[it.slot];
              const curDmg = cur.damage?.dice ? ` ${gray(cur.damage.dice + " " + (cur.damage.damageType||""))}` : "";
              out.push(tr(`  ${gray("── 当前装备 ──")}`));
              out.push(tr(`  ${gray("槽位:")} ${gray(EQUIP_SLOTS_ALL.find(s => s.id === it.slot)?.label || it.slot)} ${gray("│")} ${cur.name}${curDmg}`));
            }
            out.push(tr(`  ─ 操作 ─`));
            const acts = _buildItemActions(_selectedTarget);
            for (let i = 0; i < acts.length; i++) {
              out.push(tr(`${_subCursor === i ? "▶" : " "} ${String.fromCodePoint(0x2460 + i)} ${acts[i].label}`));
            }
          } else if (_submenu === "vehicle-detail" && _selectedTarget) {
            const v = _selectedTarget;
            const isMounted = p.vehicle?.name === v.name;
            out.push(tr(`🚲 ${v.name || "载具"}${isMounted ? ` ${gray("【骑行中】")}` : ""}`));
            out.push(tr(`  速度倍率 ×${v.speedMul || 1.5} · 状态良好`));
            out.push(tr(`  ─ 操作 ─`));
            out.push(tr(`${_subCursor === 0 ? "▶" : " "} ① ${isMounted ? "下车（放回背包）" : "设为当前骑行载具"}`));
            out.push(tr(`${_subCursor === 1 ? "▶" : " "} ② 检查状况`));
          } else if (_submenu === "info-detail") {
            // 二级：六项菜单 + 同步摘要（内容后台加载，进三级即看）
            out.push(tr(head("情报"), "info"));
            for (let i = 0; i < _INFO_SECTIONS.length; i++) {
              const sec = _INFO_SECTIONS[i]!;
              const on = _subCursor === i;
              const summ = _infoSummary(gs, i);
              const summStr = i === 0 && summ !== "✅正常" ? `${C.d}${summ}${C.r}` : gray(summ);
              out.push(tr(` ${on ? hi("▶") : " "} ${sec.icon} ${padCol(sec.label)} ${C.M}│${C.r} ${summStr} ${gray("›")}`, "info", on));
            }
          } else if (_submenu === "info-section") {
            // 三级：单段内容（过滤旧全屏面板的分隔线装饰）
            const sec = _INFO_SECTIONS[_infoSecIdx]!;
            out.push(tr(head(`${sec.icon} ${sec.label}`), "info"));
            const seg = _infoSections?.[_infoSecIdx];
            if (!seg) {
              out.push(tr(gray("  …加载中")));
            } else {
              const body = seg.filter(ln => !/^[─═-]{6,}$/.test(ln.trim()));
              if (!body.length) out.push(tr(gray("  （无内容）")));
              for (const ln of body) out.push(tr(`  ${ln}`, "info"));
            }
          } else if (_submenu === "body-detail") {
            const b = p.body || {};
            const isF = (p.gender || "").includes("女");
            // 体型
            out.push(tr(head("身体")));
            out.push(tr(kv("身高", `${b.height_cm || "?"}cm`)));
            out.push(tr(kv("体重", `${b.weight_kg || "?"}kg`)));
            out.push(tr(kv("体型", b.build || "?")));
            if (isF && b.cup) out.push(tr(kv("罩杯", `${b.cup}-cup`)));
            if (isF && b.measurements) out.push(tr(kv("三围", `${b.measurements.bust||"?"}-${b.measurements.waist||"?"}-${b.measurements.hips||"?"}`)));
            if (b.leg_type) out.push(tr(kv("腿型", b.leg_type)));
            if (b.skin) out.push(tr(kv("肤色", `${b.skin.base_tone || "?"} · 日晒${b.skin.tan || 0} · ${b.skin.texture || "?"}`)));
            if (b.body_shape) {
              const bs = b.body_shape;
              let bsStr = "";
              if (bs.chest) bsStr += `胸:${bs.chest} `;
              if (bs.hips) bsStr += `臀:${bs.hips} `;
              if (bs.waist) bsStr += `腰:${bs.waist}`;
              if (bsStr) out.push(tr(kv("身型", bsStr.trim())));
            }
            if (b.diet && b.diet !== "正常") out.push(tr(kv("饮食", b.diet)));
            if (b.exercise && b.exercise !== "日常活动") out.push(tr(kv("运动", b.exercise)));
            if (b.plastic_surgery?.length) out.push(tr(kv("整形", b.plastic_surgery.join("、"))));

            // 性器详情（按性别 + SexProfile）——自己的身体不需要"开启模式"才能看
            if (p.sex) {
              const sx = p.sex;
              const prof = sx.profile || {};
              out.push(tr(""));
              out.push(tr(head("性器")));
              if (isF && prof.female) {
                const f = prof.female;
                out.push(tr(kv("乳房", `${f.breast.shape||"?"} · ${f.breast.cup||"?"} · 乳首${f.breast.nipple_size||"?"}·${f.breast.nipple_color||"?"}`)));
                out.push(tr(kv("膣", `${f.vagina.type||"?"} · ${f.vagina.tightness||"?"} · ${f.vagina.depth_cm||"?"}cm · ${f.vagina.inner_color||"?"}`)));
                out.push(tr(kv("陰核", f.clitoris || "?")));
                out.push(tr(kv("陰毛", `${f.pubic_hair.amount||"?"} · ${f.pubic_hair.color||"?"} · ${f.pubic_hair.style||"?"}`)));
              } else if (prof.male) {
                const m = prof.male;
                out.push(tr(kv("阴茎", `${m.penis.length_cm||"?"}cm · ${m.penis.shape||"?"} · ${m.penis.circumcised?"包皮":"无包皮"}`)));
                out.push(tr(kv("勃起", `${m.penis.erect_length_cm||"?"}cm × ${m.penis.erect_girth_cm||"?"}cm`)));
                out.push(tr(kv("睾丸", m.testicles?.size || "?")));
                out.push(tr(kv("陰毛", `${m.pubic_hair.amount||"?"} · ${m.pubic_hair.color||"?"} · ${m.pubic_hair.style||"?"}`)));
              }
              out.push(tr(kv("周期", `第${sx.cycleDay||0}天 · ${sx.cyclePhase||"?"}`)));
              out.push(tr(kv("高潮", `${sx.climaxCount||0}次 · 潮吹${sx.squirtCount||0}次`)));
              if (isF) {
                const baseRates: Record<string,number> = { "排卵期":0.35, "安全期":0.01, "生理期":0 };
                const rate = baseRates[sx.cyclePhase] ?? 0.01;
                const contra = sx.contraceptionUsed || "none";
                const contraLabel = contra === "pill" ? "避孕药" : contra === "condom" ? "避孕套" : "无";
                const risk = contra === "pill" ? 0.01*rate : contra === "condom" ? 0.02*rate : rate;
                out.push(tr(kv("避孕", `${contraLabel} → 受孕率 ${(risk*100).toFixed(1)}%`)));
                if (sx.milestones) {
                  const m = sx.milestones;
                  if (!m.virginity?.isVirgin) out.push(tr(kv("初夜", `${m.virginity?.lostTo || "?"} (${m.virginity?.lostAt || "?"})`)));
                  if (!m.analVirginity?.isVirgin) out.push(tr(kv("菊初", `${m.analVirginity?.lostTo || "?"}`)));
                }
              }
              out.push(tr(kv("态度", prof.attitude||"?")));
              out.push(tr(kv("经验", prof.experience||"?")));
            }
            // 发育追踪（初始 vs 当前 body 变化）
            let initBody: any = null;
            try {
              const fd = s.findCharacter(p.name);
              if (fd?.base_age) {
                const ib = s.getBodyForAge(fd, fd.base_age);
                if (ib) initBody = ib;
              }
            } catch {}
            if (initBody) {
              out.push(tr(""));
              out.push(tr(head("发育追踪")));
              out.push(tr(kv("初始", `${initBody.height_cm||"?"}cm · ${initBody.weight_kg||"?"}kg · ${initBody.build||"?"}`)));
              out.push(tr(kv("当前", `${b.height_cm||"?"}cm · ${b.weight_kg||"?"}kg · ${b.build||"?"}`)));
              const dh = (b.height_cm ?? 0) - (initBody.height_cm ?? 0);
              const dw = (b.weight_kg ?? 0) - (initBody.weight_kg ?? 0);
              const dBuild = b.build !== initBody.build ? ` ${initBody.build}→${b.build}` : "";
              const dhStr = dh > 0 ? `${C.G}+${dh}cm${C.r}` : dh < 0 ? `${C.d}${dh}cm${C.r}` : gray(`${dh}cm`);
              const dwStr = dw > 0 ? `${C.G}+${dw.toFixed(1)}kg${C.r}` : dw < 0 ? `${C.d}${dw.toFixed(1)}kg${C.r}` : gray(`${dw.toFixed(1)}kg`);
              out.push(tr(kv("变化", `${dhStr} ${gdot} ${dwStr}${dBuild ? gdot + gray(dBuild) : ""}`)));
              if (b.diet) out.push(tr(kv("饮食", b.diet)));
              if (b.exercise) out.push(tr(kv("运动", b.exercise)));
            }
          } else if (_submenu === "skills-detail") {
            const sk = p.skills || {};
            const names = Object.keys(sk);
            out.push(tr(head("技能")));
            if (!names.length) { out.push(tr(kv("（无）", ""))); }
            else { for (const n of names) { const s = sk[n]; const lv = s?.level ?? s ?? 0; const exp = s?.exp ?? 0; const next = s?.nextLevel ?? (lv * 10); out.push(tr(kv(n, `Lv.${lv}  ${exp}/${next}`))); } }
            // 能力（超能力/忍术等 Layer B）
            const abs = p.abilities || {};
            const abNames = Object.keys(abs);
            if (abNames.length > 0) {
              out.push(tr(""));
              out.push(tr(head("能力")));
              for (const n of abNames) {
                const a = abs[n];
                const lv = a?.level ?? a ?? 0;
                const cd = a?.cooldownRemaining ?? 0;
                const cdStr = cd > 0 ? `${C.d}冷却 ${cd} 回合${C.r}` : `${C.G}就绪${C.r}`;
                out.push(tr(kv(n, `Lv.${lv}  ${cdStr}`)));
              }
            }
          } else if (_submenu === "party-detail") {
            const pty = p.party || [];
            out.push(tr(`── 队伍详情 ──`));
            if (!pty.length) { out.push(tr(`  （无队友）`)); }
            else { for (const nm of pty) { const rel = p.relationships?.[nm]; const npc = gs?.npcs?.[nm]; const aff = rel?.affection ?? 0; const rl = rel?.romance || rel?.stage || ""; const hpc = npc?.hp?.current ?? "?"; const hpm = npc?.hp?.max ?? "?"; out.push(tr(`  👤 ${nm}  💕${aff} ${rl}  ❤${hpc}/${hpm}`)); } }
          } else if (_submenu === "container-pick" && _selectedTarget) {
            const cpItems = (_selectedTarget as any)?._containerItems || [];
            const cname = (_selectedTarget as any)?._containerName || "容器";
            out.push(tr(head(`📂 ${cname}`), "gear"));
            if (!cpItems.length) { out.push(tr(gray("  （容器是空的）"))); }
            else {
              for (let i = 0; i < cpItems.length; i++) {
                const it = cpItems[i];
                const on = _subCursor === i;
                const meta = gray(`${it.type || "??"} · ${it.weight ?? 0}kg`);
                out.push(tr(` ${on ? hi("▶") : " "} ${String.fromCodePoint(0x2460+i)} ${it.name}  ${meta}`, "gear", on));
              }
              const allIdx = cpItems.length;
              out.push(tr(gray("  ── 快捷 ──"), "gear"));
              out.push(tr(` ${_subCursor === allIdx ? hi("▶") : " "} ${String.fromCodePoint(0x2460+allIdx)} 📦 全部取出`, "gear", _subCursor === allIdx));
            }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 选物品 · Enter=取到背包 · N=全部取出 · Esc=返回"), "gear"));
          } else if (_submenu === "bag-list") {
            const inv3: any[] = gs.player.inventory || [];
            out.push(tr(head("背包"), "gear"));
            if (!inv3.length) {
              out.push(tr(gray("  （背包是空的）"), "gear"));
            } else {
              for (let i = 0; i < inv3.length; i++) {
                const it = inv3[i];
                const on = _subCursor === i;
                const stIcon = it.state === "ruined" ? "💀" : it.state === "damaged" ? "⚠️" : "";
                const meta = gray("[" + (it.type || "??").slice(0, 2) + "] " + it.name + " " + (it.weight ?? 0) + "kg") + stIcon;
                out.push(tr(" " + (on ? hi("▶") : " ") + " " + gray(String.fromCodePoint(0x2460 + i)) + " " + meta, "gear", on));
              }
            }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 选物品 · Enter 查看详情 · Esc 返回"), "gear"));
          } else if (_submenu === "economy-detail") {
            out.push(tr(head("个人财经"), "gear"));
            out.push(tr(gray("── 💰 资金 ──"), "gear"));
            out.push(tr(kv("余额", gold(`¥${(p.funds ?? 0).toLocaleString()}`))));
            try {
              const ec = require("./engine/state.ts").economyConfig || {};
              const rates = ec.job_rates || {};
              const jobNames = Object.keys(rates);
              if (jobNames.length) {
                const jobStr = jobNames.map((j: string) => `${j} ¥${rates[j]}/h`).join(" · ");
                out.push(tr(kv("时薪参考", gray(jobStr))));
              }
            } catch {}
            out.push(tr(""));
            out.push(tr(gray("── 🏠 房产 ──"), "gear"));
            const props = p.properties || {};
            const propKeys = Object.keys(props);
            if (!propKeys.length) {
              out.push(tr(gray("  暂无房产或安全屋")));
            } else {
              for (const [id, prop] of Object.entries(props) as any) {
                const typeLabel = prop.type === "own" ? `${C.G}自有${C.r}` : `${C.Y}租赁${C.r}`;
                const arrears = prop.arrears_days || 0;
                const arrearsStr = arrears > 0 ? ` ${C.d}欠租${arrears}天${C.r}` : ` ${gray("正常")}`;
                out.push(tr(`  ▸ ${prop.name || id}  ${typeLabel}${arrearsStr}`));
                if (prop.type === "rent") out.push(tr(`    月租 ¥${(prop.rent_fee||0).toLocaleString()} · 到期 ${prop.rent_due_date || "?"}`));
                const storage = prop.storage || [];
                if (storage.length) out.push(tr(`    储物: ${storage.length}件`));
              }
            }
            out.push(tr(""));
            out.push(tr(gray("── 🎲 博弈 ──"), "gear"));
            try {
              const underRep = p.reputation?.["underworld"] ?? 0;
              const underAff = p.relationships?.["underworld_merchant"]?.affection ?? 0;
              out.push(tr(kv("地下声望", `${underRep}/10`)));
              out.push(tr(kv("黑商好感", `${underAff}/100`)));
              out.push(tr(gray("  可用: 双骰(DC7) · 21点(DC11) — 通过 LLM gamble_bet")));
            } catch {}
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 滚动 · Enter 无动作（只读）· Esc 返回"), "gear"));
          } else if (_submenu === "combat-detail") {
            out.push(tr(head("战斗"), "gear"));
            if (!_combatLines) { out.push(tr(gray("  …加载中"))); }
            else { for (const ln of _combatLines) out.push(tr(ln, "gear")); }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 滚动 · Enter 无动作（只读）· Esc 返回"), "gear"));
          } else if (_submenu === "world-detail") {
            out.push(tr(head("世界"), "gear"));
            if (!_worldLines) { out.push(tr(gray("  …加载中"))); }
            else { for (const ln of _worldLines) out.push(tr(ln, "gear")); }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 滚动 · Enter 无动作（只读）· Esc 返回"), "gear"));
          } else if (_submenu === "turnlog-detail") {
            out.push(tr(head("回合台账"), "gear"));
            const recent = (gs.turnLog || []).slice(-8).reverse();
            if (!recent.length) { out.push(tr(gray("  （暂无记录）"))); }
            else {
              for (const entry of recent) {
                const tNum = entry.turn || "?";
                const ts = entry.timestamp || "";
                out.push(tr(""));
                out.push(tr(`  ${C.G}T${tNum}${C.r} ${gray(`│ ${ts}`)} ${gray("│")} ${Y}${C.r}${entry.playerAction || "?"}`, "gear"));
                if (entry.resolvedChanges) out.push(tr(`       ${gray("│")} ${gray(entry.resolvedChanges)}`, "gear"));
                if (entry.sceneResult) out.push(tr(`       ${gray("│")} ${gray(entry.sceneResult)}`, "gear"));
                if (entry.openHooks) out.push(tr(`       ${gray("│")} ${C.d}⚠ ${entry.openHooks}${C.r}`, "gear"));
              }
            }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 滚动 · Enter 无动作（只读）· Esc 返回"), "gear"));
          } else if (_submenu === "phone-main") {
            // 手机主菜单
            const phoneName = (_selectedTarget as any)?.name || (_selectedTarget as any)?.item?.name || "手机";
            out.push(tr(head(`📱 ${phoneName}`), "gear"));
            let pd: any = null;
            try {
              const { getPlayerPhoneData, getUnreadSummary } = require("../engine/phone.ts");
              pd = getPlayerPhoneData(gs);
            } catch {}
            const unread = pd?.unreadCount ?? 0;
            out.push(tr(gray(`  ── 📶 ${loc.slice(0,16)} │ ${unread > 0 ? `${C.G}${unread} 条未读${C.r}` : "无未读"} ──`), "gear"));
            out.push(tr(""));
            const phoneApps = [
              { id: "messages", icon: "💬", label: "消息", hint: unread > 0 ? `🆕 ${unread} 条未读` : "" },
              { id: "calllog", icon: "📞", label: "通话记录", hint: pd?.callLog?.length ? `${pd.callLog.length} 条` : "" },
              { id: "contacts", icon: "👥", label: "通讯录", hint: pd?.contacts?.length ? `${pd.contacts.length} 人` : "" },
              { id: "sns", icon: "🌐", label: "mixi", hint: pd?.snsPosts?.length ? `${pd.snsPosts.length} 条动态` : "" },
              { id: "photos", icon: "📸", label: "相册", hint: pd?.photos?.length ? `${pd.photos.length} 张` : "" },
            ];
            for (let i = 0; i < phoneApps.length; i++) {
              const app = phoneApps[i]!;
              const on = _subCursor === i;
              const hi2 = app.hint ? ` ${C.M}│${C.r} ` + (app.hint.includes("🆕") ? `${C.G}${app.hint}${C.r}` : gray(app.hint)) : "";
              out.push(tr(` ${on ? hi("▶") : " "} ${String.fromCodePoint(0x2460+i)} ${app.icon} ${app.label}${hi2}`, "gear", on));
            }
            out.push(tr(gray("  ── 操作 ──"), "gear"));
            out.push(tr(` ${_subCursor === 5 ? hi("▶") : " "} ⑥ 📴 合上手机`, "gear"));
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 选功能 · Enter 进入 · Esc/⑥ 合上"), "gear"));
          } else if (_submenu === "phone-messages") {
            out.push(tr(head("消息"), "gear"));
            let pd: any = null;
            try { const { getPlayerPhoneData } = require("../engine/phone.ts"); pd = getPlayerPhoneData(gs); } catch {}
            const msgs: any[] = pd?.messages || [];
            // 按联系人分组，取每组最后一条
            const grouped: Map<string, { last: any; unread: number }> = new Map();
            for (const m of msgs) {
              const key = m.from === gs.player.name ? m.to : m.from;
              const existing = grouped.get(key);
              if (!existing || (m.timestamp > existing.last.timestamp)) {
                grouped.set(key, { last: m, unread: (existing?.unread || 0) + (m.read ? 0 : 1) });
              } else if (!m.read && m.to === gs.player.name) {
                grouped.set(key, { last: m, unread: existing.unread + 1 });
              }
            }
            const entries = Array.from(grouped.entries());
            if (!entries.length) { out.push(tr(gray("  （没有消息）"))); }
            else {
              for (let i = 0; i < entries.length; i++) {
                const [name, info] = entries[i]!;
                const on = _subCursor === i;
                const unreadStr = info.unread > 0 ? ` ${C.G}🆕${C.r}` : "";
                const text = (info.last.text || "").slice(0, 30);
                out.push(tr(` ${on ? hi("▶") : " "} ${String.fromCodePoint(0x2460+i)} ${name}${unreadStr}  ${gray(text)}`, "gear", on));
              }
            }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 选对话 · Enter 查看 · Esc 返回"), "gear"));
          } else if (_submenu === "reputation-detail") {
            const rep = p.reputation || {};
            const keys = Object.keys(rep);
            out.push(tr(head("声望")));
            if (!keys.length) { out.push(tr(gray("  （暂无声望）"))); }
            else { for (const k of keys) { const v = rep[k] ?? 0; out.push(tr(`  ${k}: ${v >= 0 ? "+" : ""}${v}`)); } }
          } else if (_submenu === "relations-detail") {
            out.push(tr(head("关系"), "gear"));
            const rels = Object.entries(p.relationships || {}) as [string, any][];
            // 分组：恋人 > 友好(≥50) > 普通(0-49) > 死敌(<0)
            const lovers = rels.filter(([_, r]) => r.romance === "恋人");
            const friends = rels.filter(([_, r]) => r.romance !== "恋人" && (r.affection || 0) >= 50);
            const neutrals = rels.filter(([_, r]) => r.romance !== "恋人" && (r.affection || 0) >= 0 && (r.affection || 0) < 50);
            const enemies = rels.filter(([_, r]) => (r.affection || 0) < 0 || r.stage === "死敌");
            const grp = (icon: string, label: string, list: any[]) => {
              out.push(tr(gray(`── ${icon} ${label} (${list.length}) ──`), "gear"));
              if (!list.length) { out.push(tr(gray("  （无）"))); return; }
              for (const [nm, r] of list) {
                const aff = r.affection ?? 0;
                const affStr = aff >= 50 ? `${C.G}好感${aff}${C.r}` : aff < 0 ? `${C.d}好感${aff}${C.r}` : gray(`好感${aff}`);
                const npc = gs?.npcs?.[nm];
                const sameRoom = npc && s.isSameLocation(npc.currentRoom, loc);
                const roomStr = sameRoom ? gray("同室") : gray("不在同室");
                const inParty = (p.party || []).includes(nm) ? ` ${gray("队伍中")}` : "";
                out.push(tr(`  ${nm}  ${affStr} ${gray("·")} ${roomStr}${inParty}`, "gear"));
              }
            };
            grp("❤️", "恋人", lovers);
            grp("🤝", "友好", friends);
            grp("😐", "普通", neutrals);
            grp("💀", "死敌", enemies);
            out.push(tr(gray("── 🏛️ 声望 ──"), "gear"));
            const repKeys = Object.keys(p.reputation || {});
            if (!repKeys.length) { out.push(tr(gray("  （暂无）"))); }
            else {
              const repStrs = repKeys.map(k => {
                const v = p.reputation?.[k] ?? 0;
                return `${k} ${v >= 0 ? `${C.G}+${v}${C.r}` : `${C.d}${v}${C.r}`}`;
              }).join(` ${gray("·")} `);
              out.push(tr(`  ${repStrs}`, "gear"));
            }
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 滚动 · Enter 无动作（只读）· Esc 返回"), "gear"));
          } else if (_submenu === "titles-detail") {
            const tt = p.titles || [];
            out.push(tr(`── 称号详情 ──`));
            if (!tt.length) { out.push(tr(`  （暂无称号）`)); }
            else { for (const t of tt) { out.push(tr(`  🏅 ${t}`)); } }
          } else if (_submenu === "bag-empty") {
            out.push(tr(head("背包"), "gear"));
            out.push(tr(gray("  （背包空空如也）"), "gear"));
            out.push(tr(""));
            out.push(tr(gray("  💡 如何获取物品："), "gear"));
            out.push(tr(gray("  1. 家具容器搜刮（房间 Tab → 容器 → Enter）"), "gear"));
            out.push(tr(gray("  2. 告诉 LLM 要一件 → spawn_item"), "gear"));
            out.push(tr(gray("  3. 商店购买 → buy_item"), "gear"));
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("Esc 返回"), "gear"));
          } else if (_submenu === "identity-detail") {
            out.push(tr(head("身份"), "gear"));
            out.push(tr(gray("── 🏷️ 社会身份 ──"), "gear"));
            out.push(tr(kv("姓名", p.name || "?")));
            out.push(tr(kv("性别", p.gender || "?")));
            out.push(tr(kv("年龄", `${p.age ?? t?.player_age ?? "?"}岁`)));
            const sc = p.social_class || "?";
            out.push(tr(kv("阶级", `${C.Y}${sc}${C.r}`)));
            out.push(tr(kv("公开身份", gray(p.public_identity || p.memberships?.[0]?.title || "?"))));
            out.push(tr(kv("伪装身份", p.public_identity && p.public_identity !== (p.memberships?.[0]?.title || "") ? gray(p.public_identity) : dim("(无)"))));
            const axes = p.personal_axes || {};
            if (Object.keys(axes).length > 0) {
              out.push(tr(""));
              out.push(tr(gray("── 🧭 立场坐标 ──"), "gear"));
              for (const [ax, v] of Object.entries(axes) as [string, any][]) {
                const val = v ?? 0;
                const left = val < 0 ? Math.min(5, Math.abs(val)) : 0;
                const right = val > 0 ? Math.min(5, Math.abs(val)) : 0;
                const bar5 = `${C.G}${"■".repeat(left)}${C.r}${gray("□".repeat(5 - left - right))}${val > 0 ? C.d : C.r}${"■".repeat(right)}${C.r}`;
                const lbl = val < 0 ? `${C.G}◀ 左倾 (${val})${C.r}` : val > 0 ? `${C.d}▶ 偏右 (${val})${C.r}` : gray(`○ 中立`);
                out.push(tr(`  ${gray(ax)}  ${bar5}  ${lbl}`, "gear"));
              }
            }
            // 组织
            const mems = p.memberships || [];
            out.push(tr(""));
            out.push(tr(gray("── 🏛️ 所属组织 ──"), "gear"));
            if (!mems.length) { out.push(tr(gray("  （无）"))); }
            else {
              for (const m of mems) {
                let org: any = null;
                try { const s0 = require("./engine/state.ts"); const orgs = s0.gameState?.organizations || {}; org = orgs[m.orgId]; } catch {}
                const oname = org?.name || m.orgId || "?";
                const role = m.role || "?";
                const rank = m.rank ?? 0;
                const stage = org?.lifecycle_stage || "?";
                const active = !org?.archived;
                out.push(tr(`  🏫 ${wb(oname)}  ${gray("│")} ${role} ${gray("│")} rank ${rank}/10 ${gray("│")} ${active ? gn("活跃") : gray("已归档")}${stage !== "?" ? gray("·"+stage) : ""}`, "gear"));
                if (org) {
                  out.push(tr(`    影响力 ${gn(org.influence||0)}/100  ${gray("·")} 凝聚力 ${gn(org.cohesion||0)}/100  ${gray("·")} 公信力 ${gn(org.public_legitimacy||0)}/100`, "gear"));
                  if (org.class_base && Object.keys(org.class_base).length) {
                    out.push(tr(`    阶级基本盘: ${Object.entries(org.class_base).map(([k2,v2]:any)=>`${k2} ${Math.round(v2*100)}%`).join(gray(" · "))}`, "gear"));
                  }
                  if (org.goals?.macroGoal) out.push(tr(`    目标: ${gray(org.goals.macroGoal)}`, "gear"));
                }
                // 权限
                const permBits: string[] = [];
                if (rank >= 1) permBits.push("进大本营");
                if (rank >= 4) permBits.push("查受限信息");
                if (rank >= 7) permBits.push("招募·动资·代表·开除");
                if (rank >= 10) permBits.push("设目标·任免核心");
                if (permBits.length) out.push(tr(`    权限: ${gray(permBits.join(" · "))}`, "gear"));
              }
            }
            // 当前位置活跃组织
            try {
              const s0 = require("./engine/state.ts");
              const activeOrgs = s0.getActiveOrgsForLocation ? s0.getActiveOrgsForLocation(loc) : [];
              const otherOrgs = activeOrgs.filter((a:any) => !mems.some((m:any) => m.orgId === a.orgId));
              if (otherOrgs.length > 0) {
                out.push(tr(""));
                out.push(tr(gray("── 🏙️ 当前位置活跃组织 ──"), "gear"));
                for (const ao of otherOrgs.slice(0, 6)) {
                  const repHere = ao.playerRep || 0;
                  const repStr = repHere !== 0 ? (repHere > 0 ? `${C.G}+${repHere}${C.r}` : `${C.d}${repHere}${C.r}`) : gray("无");
                  out.push(tr(`  ${ao.name}  ${gray("│")} ${ao.sector||"?"} ${gray("│")} ${dim((ao.scale||"?")+"·"+(ao.lifecycle_stage||"?"))} ${gray("│")} ${gray("声望:")} ${repStr}`, "gear"));
                }
              }
            } catch {}
            out.push(tr(gray("─".repeat(46)), "gear"));
            out.push(tr(gray("↑↓ 滚动 · Enter 无动作（只读）· Esc 返回"), "gear"));
          } else if (_submenu === "sex-detail") {
            const sx = p.sex;
            // 找 sex 对手：同房恋人或最高好感 NPC
            let partner: { name: string; sx: any } | null = null;
            try {
              const nearby2: [string, any][] = Object.entries(gs.npcs || {}).filter(([_, n2]: any) => n2.alive !== false && s.isSameLocation(n2.currentRoom, loc));
              const lovers = nearby2.filter(([n2]) => p.relationships?.[n2]?.romance === "恋人");
              const pick = (lovers.length ? lovers : nearby2).sort((a, b) => (p.relationships?.[b[0]]?.affection || 0) - (p.relationships?.[a[0]]?.affection || 0));
              if (pick.length) {
                const [pn, pnpc] = pick[0];
                const psx = (gs.sexStates || {})[pn];
                partner = { name: pn, sx: psx || null };
              }
            } catch {}
            const compact = (v: number) => sq(v, 100, 5);
            out.push(tr(head(partner ? `SEX · 相手: ${partner.name}` : "SEX"), "gear"));
            if (sx) {
              // 自身一段
              const pMale = (p.gender || "").includes("男") && !(p.gender || "").includes("女");
              const selfProf = sx.profile || {};
              const adjExp: Record<string, number> = { "未开发": 10, "生涩": 10, "熟练": 0, "深度开发": -10 };
              const selfTh = Math.max(55, (selfProf.climaxThreshold || 65)) + (adjExp[selfProf.experience] || 0);
              const ejacBar = sq(sx.arousal || 0, selfTh, 7);
              const selfExtra = pMale ? "" : `  ${gray("💦")}${sx.squirtCount || 0}`;
              out.push(tr(`  ${gray("── 自身 ──")}`, "gear"));
              out.push(tr(`  💥 ${ejacBar} ${gray("高潮")}${sx.climaxCount || 0}${gray("次")}${selfExtra}`, "gear"));
              out.push(tr(`  🔥 ${compact(sx.arousal || 0)}  💓 ${compact(sx.desire || 0)}`, "gear"));
            }
            if (partner) {
              const psx = partner.sx;
              out.push(tr(`  ${gray("── " + partner.name + " ──")}`, "gear"));
              if (psx) {
                // 相手性别判定：查角色卡
                let pnrMale = false;
                try {
                  const fd = require("./engine/state.ts").findCharacter(partner.name);
                  pnrMale = (fd?.gender || "").includes("男") && !(fd.gender || "").includes("女");
                } catch {}
                const pnrProf = psx.profile || {};
                const pnrTh = Math.max(55, (pnrProf.climaxThreshold || 65)) + (({ "未开发": 10, "生涩": 10, "熟练": 0, "深度开发": -10 } as Record<string,number>)[pnrProf.experience] || 0);
                const pnrEjacBar = sq(psx.arousal || 0, pnrTh, 7);
                const pnrExtra = pnrMale ? "" : `  ${gray("💦")}${psx.squirtCount || 0}`;
                out.push(tr(`  💥 ${pnrEjacBar} ${gray("高潮")}${psx.climaxCount || 0}${gray("次")}${pnrExtra}`, "gear"));
                out.push(tr(`  🔥 ${compact(psx.arousal || 0)}  💓 ${compact(psx.desire || 0)}`, "gear"));
              } else {
                out.push(tr(gray(`  （无 SexState —— 引擎尚未为该 NPC 生成性状态）`), "gear"));
              }
            }
            // 共通：体位 / 可用动作 / 避孕（只用玩家侧数据）
            out.push(tr(`  ${gray("── 共通 ──")}`, "gear"));
            if (sx) {
              const prof = sx.profile || {};
              try {
                const { getAvailableActions } = require("./engine/sex.ts");
                const avail = getAvailableActions(prof, sx);
                if (avail.positions?.length) out.push(tr(`  体位: ${avail.positions.join(gdot2)}`, "gear"));
                if (avail.actions?.length) out.push(tr(`  动作: ${avail.actions.join("、")}`, "gear"));
              } catch {}
              const cycleLabel = ["生理期","卵泡期","排卵期","黄体期"][["生理期","卵泡期","排卵期","黄体期"].indexOf(sx.cyclePhase)] || sx.cyclePhase || "?";
              const baseRates: Record<string,number> = { "排卵期":0.35, "安全期":0.01, "生理期":0 };
              const rate = baseRates[sx.cyclePhase] ?? 0.01;
              const contra = sx.contraceptionUsed || "none";
              const contraLabel = contra === "pill" ? "药" : contra === "condom" ? "套" : "无";
              const risk = contra === "pill" ? 0.01*rate : contra === "condom" ? 0.02*rate : rate;
              out.push(tr(`  📅 ${gray("周期")}${sx.cycleDay||0}${gray("天·")}${cycleLabel}  💊 ${gray("避孕:")}${contraLabel}  ${risk > 0.05 ? C.d : ""}${gray("受孕")}${(risk*100).toFixed(1)}%${C.r}`, "gear"));
              if (sx.milestones) {
                const m = sx.milestones;
                const ml: string[] = [];
                // 注意：字段缺失 ≠ 已失去，必须先判存在（旧写法 !m.x?.isVirgin 在缺字段时读 lostTo 崩）
                if (m.virginity && !m.virginity.isVirgin) ml.push(`初夜:${m.virginity.lostTo}(${m.virginity.lostAt})`);
                if (m.analVirginity && !m.analVirginity.isVirgin) ml.push(`菊初:${m.analVirginity.lostTo}(${m.analVirginity.lostAt})`);
                if (ml.length) out.push(tr(`  💝 ${ml.join(" | ")}`, "gear"));
              }
              // 心里话
              if (sx.thoughts?.length) {
                out.push(tr(`  ${gray("── 心里话 ──")}`, "gear"));
                sx.thoughts.slice(-3).forEach((t: any) => out.push(tr(`  「${t.text}」`, "gear")));
              }
            } else {
              out.push(tr(gray(`  （无 SexState）`), "gear"));
            }
          } else if (_submenu === "equip-detail") {
            const eqSlots = getEquipSlots(p.gender);
            if (_pickSlot) {
              // 选物品模式：列出背包里能与该槽位兼容的物品（item.slot === _pickSlot）
              const slotLabel = eqSlots.find(s => s.id === _pickSlot)?.label || _pickSlot;
              const compat = inv.filter((i: any) => i.slot === _pickSlot);
              out.push(tr(head(`装备 → ${slotLabel}`), "gear"));
              if (!compat.length) {
                out.push(tr(gray(`  （背包里没有能贴${slotLabel}的物品——底部"背包"入口找 LLM 要一个）`)));
              } else {
                for (let i = 0; i < compat.length; i++) {
                  const it = compat[i];
                  const on = _subCursor === i;
                  const meta = `  ${gray(`[${(it.type || "??").slice(0, 2)}]`)} ${it.name} ${gray(`${it.weight ?? 0}kg`)}`;
                  out.push(tr(` ${on ? hi("▶") : " "} ${meta}`, "gear", on));
                }
              }
            } else {
              // 装备详情：N 槽竖排（按性别），槽上 Enter 进 item-detail
              out.push(tr(head("装备"), "gear"));
              for (let i = 0; i < eqSlots.length; i++) {
                const slot = eqSlots[i]!;
                const item = eq[slot.id];
                const stIcon = item ? (item.state === "ruined" ? " 💀" : item.state === "damaged" ? " ⚠️" : "") : "";
              let eqHint = "";
              if (item) {
                if (item.damage?.dice) eqHint = ` ${C.G}${item.damage.dice}${item.damage.damageType ? " " + item.damage.damageType : ""}${C.r}`;
                else if (item.effects?.length) {
                  const bits = item.effects.slice(0, 2).map((e: any) => {
                    if (e.type === "ac") return `AC${e.value > 0 ? "+" : ""}${e.value}`;
                    if (e.type === "attribute") return `${e.attr || ""}${e.value > 0 ? "+" : ""}${e.value}`;
                    if (e.type === "pocket") return `口袋Lv${e.value || 1}`;
                    if (e.type === "warmth") return "防寒";
                    return e.type;
                  }).filter(Boolean);
                  if (bits.length) eqHint = ` ${gray(bits.join("·"))}`;
                }
              }
              const disp = item ? (item.name || item) + stIcon + eqHint : gray("—");
                const cur = _subCursor === i ? hi("▶") : " ";
                const lbl = "  " + slot.label;
                out.push(tr(` ${cur} ${gray(padCol(lbl))} ${disp}`, "gear"));
              }
            }
          } else {
            // ── 默认自身面板（F 世界书正统版：|-[日期]开场 + ■□条 + 属性注解 + 页脚三连）──
            const attrs = p.attributes || {};
            const b = p.body || {};
            const sel = (type: string) => _panelMode && _focusItems[_cursor]?.type === type;
            const cur = (on: boolean) => on ? hi("▶") : " ";
            const gdot = gdot2; // 自身 Tab 内可直接用；子面板区（sex-detail 等）用 gdot2

            // 开场日期行
            if (t?.game_date) {
              const [gy, gm, gd] = String(t.game_date).split("-");
              out.push(tr(`${C.M}|-[${C.r}${t.day_of_week || "?"}曜日${C.M}-${C.r}${gy}年${gm}月${gd}日${C.M}]${C.r}`));
            }

            // 资金/声望/负重摘要行（常驻可见，三种状态）
            const currWt = s.calcCurrentWeight(p.inventory || [], p.equipment || {});
            const maxWt = s.calcMaxCarry(attrs.力量 ?? 10);
            const over = s.isOverburdened(currWt, maxWt);
            const wanted = p.reputation ? Object.entries(p.reputation as Record<string,number>).filter(([k]) => /警|通缉|wanted|cop/i.test(k)) : [];
            const repKeys0 = Object.keys(p.reputation || {});
            const topReps = repKeys0.filter(k => Math.abs(p.reputation?.[k] ?? 0) >= 3 || (p.reputation?.[k] ?? 0) < 0).slice(0, 3);
            const repStr = wanted.length > 0 && (p.reputation as any)?.[wanted[0]![0]] > 0
              ? `${C.d}通缉[${wanted[0]![0]}]${C.r}`
              : topReps.length > 0
                ? topReps.map(k => `${(p.reputation?.[k] ?? 0) >= 0 ? C.G : C.d}${k}${(p.reputation?.[k] ?? 0) >= 0 ? "+" : ""}${p.reputation?.[k]}${C.r}`).join(gdot)
                : "";
            const wtStr = over.overloaded ? `${C.d}⚠ 超重 ${currWt.toFixed(1)}/${maxWt.toFixed(0)}kg${C.r}`
              : over.encumbered ? `${C.Y}${currWt.toFixed(1)}/${maxWt.toFixed(0)}kg${C.r}`
              : gray(`${currWt.toFixed(1)}/${maxWt.toFixed(0)}kg`);
            const fundStr = `${C.Y}💰 ${C.r}¥${(p.funds ?? 0).toLocaleString()}`;
            const parts: string[] = [fundStr];
            if (repStr) parts.push(repStr);
            parts.push(wtStr);
            out.push(tr(parts.join(`  ${gdot}  `)));
            out.push(tr(""));

            // 角色信息竖排
            const identity = p.public_identity || p.memberships?.[0]?.title || "";
            const focusId = sel("identity");
            out.push(tr(entry(focusId, '身份', identity || dim("?") , gray('›'))));
            const tt = p.titles || [];
            const focusTitles = sel("titles");
            out.push(tr(entry(focusTitles, '称号', tt.length ? `「${tt[tt.length-1]}」${tt.length > 1 ? gray(` +${tt.length-1}`) : ""}` : dim('尚未获得'), gray('›'))));
            const rep = p.reputation || {};
            const repKeys = Object.keys(rep);
            const repSum = repKeys.slice(0,3).map(k => `${k}${(rep[k]??0)>=0 ? `${C.G}+${rep[k]}${C.r}` : `${C.d}${rep[k]}${C.r}`}`).join(gdot);
            const focusRep = sel("reputation");
            out.push(tr(entry(focusRep, '声望', repKeys.length ? repSum : dim('默默无闻'), gray('›'))));
            out.push(tr(""));

            // 状态条（■□ 方块 10 格）
            out.push(tr(kv("体力", sq(hp, hpM, 10, hp / hpM < 0.3))));
            const pools = p.resourcePools || {};
            for (const [pn, pv] of Object.entries(pools) as [string, any][]) {
              if (pv && typeof pv.current === "number") out.push(tr(kv(pn.slice(0,2), sq(pv.current, pv.max ?? pv.current, 10))));
            }
            out.push(tr(kv("疲劳", sq(p.fatigue ?? 0, 100, 10))));
            if (mode === "sex" && p.sex) {
              out.push(tr(kv("兴奋", `🔥 ${sq(p.sex.arousal||0, 100, 10)}`)));
              out.push(tr(kv("欲望", `💓 ${sq(p.sex.desire||0, 100, 10)}`)));
            }
            out.push(tr(kv("防御", `AC ${ac}`)));

            // 属性竖排（带偏离注解，10=常人）
            for (const nm of ["力量","敏捷","体质","智力","感知","魅力","幸运"]) {
              const v = attrs[nm] ?? 10;
              out.push(tr(kv(nm, `${v}${attrNote(v)}`)));
            }
            out.push(tr(""));

            // 身体（按性别+模式显示不同摘要）
            const isFemale = (p.gender || "").includes("女");
            const bodyParts: string[] = [];
            if (b.height_cm) bodyParts.push(`${b.height_cm}cm`);
            if (b.weight_kg) bodyParts.push(`${b.weight_kg}kg`);
            if (b.build) bodyParts.push(b.build);
            if (isFemale && b.cup) bodyParts.push(`${b.cup}-cup`);
            const bodySum = bodyParts.join(gdot) || "?";
            const focusBody = sel("body");
            out.push(tr(entry(focusBody, '身体', bodySum, gray("›")), "gear"));
            const genderSlots = getEquipSlots(p.gender);
            const eqCount = genderSlots.filter(s2 => eq[s2.id]).length;
            const focusEquip = sel("equip");
            out.push(tr(entry(focusEquip, '装备', eqCount+'/'+genderSlots.length+' 件穿戴', gray('›')), 'gear'));

            const sk = p.skills || {};
            const skCount = Object.keys(sk).filter(k => (sk[k]?.level ?? sk[k] ?? 0) > 0).length;
            const skSum = skCount ? `${skCount}项` : dim("（无）");
            const focusSkills = sel("skills");
            out.push(tr(entry(focusSkills, '技能', skSum, gray('›')), 'gear'));

            // 背包——只显示件数，Enter 打开背包列表
            const bagCount = (p.inventory || []).length;
            const catSum = bagCount ? `${bagCount}件` : "0件";
            out.push(tr(entry(_panelMode && _cursor === _focusItems.findIndex(f => f.type === "bag"), '背包', catSum, gray('›')), 'gear'));

            // 载具 / 经济 / 战斗 / 队伍
            const focusVehicle = sel("vehicle");
            if (p.vehicle) {
              out.push(tr(entry(focusVehicle, '载具', '🚲'+p.vehicle.name, gray('×'+(p.vehicle.speedMul||1.5))), 'gear'));
            }
            const focusEconomy = sel("economy");
            out.push(tr(entry(focusEconomy, '经济', `${gold(`¥${(p.funds ?? 0).toLocaleString()}`)}`, gray('›')), 'gear'));
            const focusCombat = sel("combat");
            const wpn = p.equipment?.right_hand || p.equipment?.left_hand;
            const wpnStr = wpn?.damage ? `${wpn.name}(${wpn.damage.dice||"?"})` : "徒手";
            out.push(tr(entry(focusCombat, '战斗', wpnStr, gray('›')), 'gear'));
            const pty = p.party || [];
            const focusParty = sel("party");
            out.push(tr(entry(focusParty, '队伍', pty.length ? pty.map(n => '👤'+n).join(gdot) : dim('（无队友）'), gray('›')), 'gear'));

            // 伤口 + 隐藏状态 + 情报摘要行
            if ((p.wounds || []).length > 0) {
              out.push(tr(gray(`  伤口: ${p.wounds.map((w:any) => w.name || w.bodyPart || "轻伤").join("、")}`)));
            }
            if (p.concealed || p.hiding_in) {
              const hidingSpot = p.hiding_in ? ` · ${p.hiding_in}` : "";
              out.push(tr(gray(`  🥷 躲藏中${hidingSpot}`)));
            }
            {
              const flags2: any = gs.flags || {};
              const alertBits: string[] = [];
              if (flags2.wanted) alertBits.push("👮通缉");
              if (flags2.steal_alert) alertBits.push("🚨警报");
              if (flags2.identity_exposed) alertBits.push("🎭暴露");
              if (flags2.school_alert) alertBits.push("🏫警戒");
              const quests = gs.quests || {};
              const actives = Object.values(quests).filter((q: any) => q.status === "active");
              let calBit = "";
              try {
                const { getTodayCalendar } = require("./engine/timeline.ts");
                const ev = getTodayCalendar();
                if (ev) calBit = `📅${String(ev).slice(0, 10)}`;
              } catch {}
              const segs2: string[] = [];
              if (alertBits.length) segs2.push(`${C.d}${alertBits.join(" ")}${C.r}`);
              if (calBit) segs2.push(calBit);
              const infoIdx = _focusItems.findIndex(f => f.type === "infoline");
              const onInfo = _panelMode && _cursor === infoIdx;
              out.push(tr(entry(onInfo, '情报', segs2.length ? segs2.join(gdot) : dim("无异常"), gray('›')), 'info'));
            }
          }
        }

        // ── 周边 Tab 渲染 ──
        else if (_tab === 1) {
          for (let i = 0; i < _peopleCache.length; i++) {
            _focusItems.push({ type: "people", npc: _peopleCache[i], index: i });
          }

          if (!_peopleCache.length) {
            out.push(tr(`  （周边无人）`));
          }
          // 二级状态：展示 NPC 操作列表
          else if (_submenu === "npc-detail" && _selectedTarget) {
            const n = _selectedTarget;
            const statusLabel = getNPCStatusLabel(gs, n.name);
            out.push(tr(`${hi(`▶ ${n.name} ◀`)}  ${gray(`${n.height}cm · ${n.posDesc} · 隔${n.dist}m`)}`));
            out.push(tr(gray(`    ${statusLabel} · 💕${n.affection}/100 · 携带: ${[n.rh, n.lh].filter(Boolean).join("·") || "—"}`)));
            if (n.lastWords) out.push(tr(`    ${dim(`「${n.lastWords}」`)}`));

            out.push(tr(head("快捷操作")));
            const npcActions = _buildNpcActions(gs, n.name);
            // 按钮栏：>5 个拆两行；选中=橙粗▶◀，锁定=灰，可用=默认
            const btn = (ac: any, idx: number) =>
              _subCursor === idx ? `${C.O}${C.B}▶${ac.label}◀${C.r}`
              : ac.locked ? gray(` ${ac.label} `)
              : ` ${ac.label} `;
            if (npcActions.length > 5) {
              const half = Math.ceil(npcActions.length / 2);
              out.push(tr(`    ` + npcActions.slice(0, half).map((ac, i) => btn(ac, i)).join(" ")));
              out.push(tr(`    ` + npcActions.slice(half).map((ac, i) => btn(ac, i + half)).join(" ")));
            } else {
              out.push(tr(`    ` + npcActions.map((ac, idx) => btn(ac, idx)).join(" ")));
            }
          }
          // 三级状态：搭话子菜单
          else if (_submenu === "npc-talk" && _selectedTarget) {
            out.push(tr(`💬 搭话: ${_selectedTarget.name}`));
            out.push(tr(`  (按数字直选 或 ↑↓+Enter 选择)`));
            const talks = ["聊聊日常", "聊聊自己", "聊聊对方", "聊聊八卦"];
            for (let i = 0; i < talks.length; i++) {
              out.push(tr(`  ${_subCursor === i ? "▶" : " "} ${String.fromCodePoint(0x2460+i)} ${talks[i]}`));
            }
          }
          // 三级状态：接触子菜单
          else if (_submenu === "npc-touch" && _selectedTarget) {
            out.push(tr(`🖐️ 接触: ${_selectedTarget.name}`));
            const levels = [
              { label: "🤝 友好握手", min: 0 },
              { label: "👋 亲切摸头", min: 30 },
              { label: "🤗 温暖拥抱", min: 50 },
              { label: "💆 肢体按摩", min: 60 },
              { label: "💋 深情亲吻", min: 70 }
            ];
            for (let i = 0; i < levels.length; i++) {
              const lock = _selectedTarget.affection < levels[i].min;
              const suffix = lock ? ` (✗ 需≥${levels[i].min})` : ` (✓ 可用)`;
              out.push(tr(`  ${_subCursor === i ? "▶" : " "} ${String.fromCodePoint(0x2460+i)} ${levels[i].label}${suffix}`));
            }
          }
          // 三级状态：观察子面板
          else if (_submenu === "npc-observe" && _selectedTarget) {
            const n = _selectedTarget;
            const il = _getNpcInsightLevel(gs);
            out.push(tr(`🔍 观察: ${n.name}`));
            // 基础：外观（始终可见）
            let charData: any = null;
            try {
              const s2 = require("./engine/state.ts");
              charData = s2.findCharacter(n.name);
            } catch {}
            const body = charData?.body || {};
            const attrs = charData?.attributes || {};
            // 基本信息
            const gender = charData?.gender || "?";
            const ageLabel = charData?.base_age ? `${charData.base_age}岁` : "?";
            const src = charData?.source || "";
            out.push(tr(`  ${n.name}  ${gender} · ${ageLabel}${src ? " · " + src : ""}`));
            // 外观（Lv0）
            if (charData?.appearance_brief) out.push(tr(`  ${charData.appearance_brief}`));
            else {
              const h = n.height && n.height !== "?" ? `${n.height}cm` : "";
              const bd = body.build || "";
              out.push(tr(`  ${[h, bd].filter(Boolean).join(" · ") || "—"}`));
            }
            // 关系（Lv1+）
            if (il >= 1) {
              const aff = getNpcAffection(gs, n.name);
              const stage = gs?.player?.relationships?.[n.name]?.stage || "陌生";
              const statusLabel = getNPCStatusLabel(gs, n.name);
              out.push(tr(`  ─ 关系 ─`));
              out.push(tr(`  ${statusLabel} · ♥ ${aff}/100 · ${stage}`));
            } else {
              out.push(tr(`  ─ 关系不明（洞察Lv1+解锁）`));
            }
            // 身体（Lv3+）
            if (il >= 3 && (body.height_cm || body.weight_kg || body.cup)) {
              const parts = [];
              if (body.height_cm) parts.push(`${body.height_cm}cm`);
              if (body.weight_kg) parts.push(`${body.weight_kg}kg`);
              if (body.build) parts.push(body.build);
              if (body.cup) parts.push(`${body.cup}-cup`);
              if (body.measurements) {
                const m = body.measurements;
                parts.push(`${m.bust || "?"}-${m.waist || "?"}-${m.hips || "?"}`);
              }
              out.push(tr(`  ─ 身体 ─`));
              out.push(tr(`  ${parts.join(" · ")}`));
            }
            // 携带（Lv2+）
            if (il >= 2) {
              const npc = gs?.npcs?.[n.name];
              const eq = npc?.equipment || {};
              const lh = eq?.left_hand?.name || npc?.left_hand || "—";
              const rh = eq?.right_hand?.name || npc?.right_hand || "—";
              const cash = npc?.funds ?? "?";
              const wealth = npc?.wealth ?? 0;
              const bagItems = (npc?.inventory || []).slice(0, 5).map((x: any) => x?.name || x).join("·") || "—";
              out.push(tr(`  ─ 携带 ─`));
              out.push(tr(`  现金 ¥${cash} · 资产 ¥${wealth.toLocaleString()} · 右:${rh} 左:${lh}`));
              out.push(tr(`  背包: ${bagItems}`));
              // 服装 + NPC→NPC 关系（Lv2+）
              const outfit = npc?.currentOutfit;
              const npcRels = npc?.npcRelationships;
              if (outfit || (npcRels && Object.keys(npcRels).length > 0)) {
                out.push(tr(`  ─ 社交 ─`));
                if (outfit) out.push(tr(`  穿着: ${outfit}`));
                if (npcRels && Object.keys(npcRels).length > 0) {
                  const relStrs = Object.entries(npcRels).slice(0, 4).map(([n2, r2]: any) => {
                    const tone = r2?.tone ? ` (${r2.tone})` : "";
                    return `${n2}:${r2?.stage||"?"}${tone}`;
                  });
                  out.push(tr(`  对他者: ${relStrs.join(gdot)}`));
                }
              }
              // NPC 技能+能力（Lv3+）
              if (il >= 3) {
                const npcSk = npc?.skills || {};
                const npcAb = npc?.abilities || {};
                const skNames = Object.keys(npcSk).filter(k => (npcSk[k]?.level ?? npcSk[k] ?? 0) > 0);
                const abNames = Object.keys(npcAb).filter(k => (npcAb[k]?.level ?? npcAb[k] ?? 0) > 0);
                if (skNames.length || abNames.length) {
                  out.push(tr(`  ─ 能力 ─`));
                  if (skNames.length) out.push(tr(`  技能: ${skNames.map(k => `${k}Lv${npcSk[k]?.level ?? npcSk[k]}`).join(gdot)}`));
                  if (abNames.length) {
                    const abStrs = abNames.map(k => {
                      const cd = npcAb[k]?.cooldownRemaining ?? 0;
                      return `${k}Lv${npcAb[k]?.level ?? "?"}${cd > 0 ? ` ${C.d}CD${cd}${C.r}` : ""}`;
                    });
                    out.push(tr(`  能力: ${abStrs.join(gdot)}`));
                  }
                }
              }
            }
            // 属性（Lv3+）
            if (il >= 3 && Object.keys(attrs).length > 0) {
              out.push(tr(`  ─ 属性 ─`));
              out.push(tr(`  力${attrs.力量??"?"} 敏${attrs.敏捷??"?"} 体${attrs.体质??"?"} 智${attrs.智力??"?"} 感${attrs.感知??"?"} 魅${attrs.魅力??"?"}`));
            }
            // 设定（Lv3+）
            if (il >= 3 && charData?.anchors?.[0]) {
              out.push(tr(`  ─ 设定 ─`));
              out.push(tr(`  "${charData.anchors[0]}"`));
            }
            // 内心话
            if (n.lastWords) out.push(tr(`  💭 "${n.lastWords}"`));
            // Layer1 性状态（开启时显示）
            if (gs.layer1Enabled) {
              try {
                const sexStates = gs.sexStates || {};
                const sx = sexStates[n.name];
                if (sx) {
                  out.push(tr(`  ── 性状态（Layer1）──`));
                  out.push(tr(`  💓欲望 ${sx.desire||0}/100  🔥兴奋 ${sx.arousal||0}/100`));
                  const prof = sx.profile || {};
                  if (prof.attitude) out.push(tr(`  态度: ${prof.attitude} · 经验: ${prof.experience||"?"}`));
                  if (sx.thoughts?.length) {
                    out.push(tr(`  💭 "${sx.thoughts[sx.thoughts.length-1].text}"`));
                  }
                }
              } catch {}
            }
            // 妊娠状态（从 NPC lifeEvents 读取）
            const npcState = gs?.npcs?.[n.name];
            if (npcState?.lifeEvents) {
              const preg = npcState.lifeEvents.find((e: any) => e.type === "pregnancy");
              if (preg) {
                const pd = preg.data || {};
                const stageLabel: Record<string,string> = { "early":"初期（0-90天）· 尚无可见变化", "visible":"可见期（90-180天）· 身体变化瞒不住了", "due":"临产（180-270天）· 已住院待产" };
                out.push(tr(`  ── 🤰 妊娠状态 ──`));
                out.push(tr(`  父亲: ${pd.father||"?"} · 受孕日: 第${pd.day_conceived||"?"}天`));
                out.push(tr(`  阶段: ${stageLabel[pd.stage] || pd.stage || "?"}`));
              }
              // illness / injury
              const ill = npcState.lifeEvents.find((e: any) => e.type === "illness" || e.type === "injury");
              if (ill) {
                const d = ill.data || {};
                out.push(tr(`  ── 🤒 疾病/受伤 ──`));
                out.push(tr(`  类型: ${d.illness||d.name||"?"} · 严重度: ${d.severity||"?"} (${d.severityValue||"?"}/10)`));
                if (d.startedAt) out.push(tr(`  起始: 第${d.startedAt}天`));
                if (d.symptoms) out.push(tr(`  症状: ${d.symptoms}`));
              }
              // conflict
              const cnf = npcState.lifeEvents.find((e: any) => e.type === "conflict" || e.type === "feud");
              if (cnf) {
                const d = cnf.data || {};
                out.push(tr(`  ── ⚔️ 冲突/纠纷 ──`));
                out.push(tr(`  对象: ${d.target||"?"} · 原因: ${d.cause||"?"}`));
                out.push(tr(`  状态: ${d.phase||d.status||"?"} · 开始: ${cnf.startedAt ? "第"+cnf.startedAt+"天" : "?"}`));
                if (d.escalationRisk) out.push(tr(`  升级风险: ${d.escalationRisk}`));
              }
            }
            // 驱动力 + 当前目标（Lv2+）
            if (il >= 2 && npcState) {
              const drives = npcState.current_drives || [];
              const goal = npcState.current_goal;
              if (drives.length || goal) {
                out.push(tr(`  ─ 内面 ─`));
                if (drives.length) out.push(tr(`  驱动力: ${drives.join(" · ")}`));
                if (goal) out.push(tr(`  当前目标: ${goal}`));
              }
            }
            // 组织+日程（Lv2+）
            if (il >= 2) {
              const sched = npcState?.scheduleGroup;
              if (sched) out.push(tr(`  日程: ${sched}`));
              const npcMems = npcState?.memberships || [];
              if (npcMems.length) {
                const memStrs = npcMems.map((m:any) => `${m.orgId||"?"}:${m.role||"?"} R${m.rank??"?"}`);
                out.push(tr(`  组织: ${memStrs.join(gdot)}`));
              }
              // pending override
              const po = npcState?.pendingOverride;
              if (po) out.push(tr(`  ⚡ 临时行动: ${po.action} @ ${po.location}（${po.reason}）`));
            }
          }
          // 三级状态：恋爱子菜单
          else if (_submenu === "npc-romance" && _selectedTarget) {
            const n = _selectedTarget;
            const aff = getNpcAffection(gs, n.name);
            out.push(tr(`💕 恋爱: ${n.name}`));
            const canConfess = aff >= 70;
            const canDate = aff >= 50;
            out.push(tr(`  ${_subCursor === 0 ? "▶" : " "} ① 💌 告白交往${canConfess ? "" : " (需好感70+)"}`));
            out.push(tr(`  ${_subCursor === 1 ? "▶" : " "} ② 📅 邀请约会${canDate ? "" : " (需好感50+)"}`));
          }
          // 三级状态：战斗子菜单
          else if (_submenu === "npc-combat" && _selectedTarget) {
            const n = _selectedTarget;
            out.push(tr(`⚔️ 战斗: ${n.name}`));
            const combatOpts = [
              { label: "⚔️ 切磋武艺", desc: "友好切磋，点到为止" },
              { label: "💀 发起死斗", desc: "以命相搏，关系降为死敌" },
            ];
            for (let i = 0; i < combatOpts.length; i++) {
              out.push(tr(`  ${_subCursor === i ? "▶" : " "} ${String.fromCodePoint(0x2460+i)} ${combatOpts[i].label} — ${combatOpts[i].desc}`));
            }
          }
          // 三级状态：窃取子菜单
          else if (_submenu === "npc-steal" && _selectedTarget) {
            const n = _selectedTarget;
            out.push(tr(`💰 窃取: ${n.name}`));
            const stealItems: { label: string; detail: string; action: string; key: string }[] = [];
            // 读取 NPC 运行时状态
            const npcState = gs?.npcs?.[n.name];
            if (npcState) {
              stealItems.push({
                label: `💰 钱包`, detail: `现金: ¥${npcState.funds ?? 0}`,
                action: "steal_cash", key: "cash",
              });
              // 背包物品
              if (npcState.inventory) {
                for (const it of npcState.inventory) {
                  stealItems.push({
                    label: `🎒 ${it.name}`, detail: `重: ${it.weight ?? "?"}kg`,
                    action: "steal_item", key: it.name,
                  });
                }
              }
              // 装备物品
              const eq = Object.entries(npcState.equipment || {}).filter(([_, v]) => v);
              for (const [slot, eqItem] of eq) {
                if (eqItem) {
                  stealItems.push({
                    label: `🛡️ ${(eqItem as any).name || eqItem}`, detail: `装备|${slot}`,
                    action: "steal_item", key: (eqItem as any).name || String(eqItem),
                  });
                }
              }
            }
            if (!stealItems.length) {
              stealItems.push({ label: "（身上没有可偷的东西）", detail: "", action: "", key: "" });
            }
            // 缓存窃取列表供 handleInput 使用
            (_selectedTarget as any)._stealItems = stealItems;
            for (let i = 0; i < stealItems.length; i++) {
              const si = stealItems[i];
              out.push(tr(`  ${_subCursor === i ? "▶" : " "} ${String.fromCodePoint(0x2460+i)} ${si.label}  ${si.detail}`));
            }
          }
          // 默认展示周边列表（甲：世界书动态版 — |-[位置] *动作* + 阶段色 + ■□好感条 + 携带）
          else {
            /** 关系阶段徽章：文本用引擎 rel.stage/romance，颜色按好感分档 */
            const stageBadge = (name: string, aff: number): string => {
              const rel = p.relationships?.[name];
              if (rel?.stage === "死敌") return `${C.d}[死敌]${C.r}`;
              if (rel?.romance === "恋人") return `${C.P}[恋人]${C.r}`;
              const label = rel?.stage || (aff >= 90 ? "至交" : aff >= 70 ? "信赖" : aff >= 40 ? "友人" : aff >= 20 ? "熟人" : "陌生");
              const col = aff >= 90 ? C.Y : aff >= 70 ? C.O : aff >= 40 ? C.G : aff >= 20 ? "" : C.M;
              return `${col}[${label}]${col ? C.r : ""}`;
            };
            out.push(tr(head("周边动态")));
            for (let i = 0; i < Math.min(_peopleCache.length, 8); i++) {
              const n = _peopleCache[i]!;
              const on = _panelMode && i === _cursor;
              if (n.type === "named") {
                const a = n.affection;
                const nameDisp = on ? `${hi("▶")} ${C.W}${C.B}${n.name}${C.r} ${hi("◀")}` : `  ${C.W}${C.B}${n.name}${C.r}`;
                const pos = `${C.M}|-[${C.r}${n.posDesc || "?"}${n.dist !== undefined && n.dist !== "?" ? `${C.M}·隔${n.dist}m${C.r}` : ""}${C.M}]${C.r}`;
                const act = n.action ? ` ${dim(`*${String(n.action).slice(0, 20)}*`)}` : "";
                out.push(tr(` ${nameDisp}  ${n.height}cm ${pos}${act}`));
                const carry = [n.rh, n.lh].filter(Boolean).join("·") || "—";
                out.push(tr(`      ${stageBadge(n.name, a)} ${sq(a, 100, 5)} ${C.M}·${C.r} 携带 ${carry}`));
                if (n.lastWords) out.push(tr(`      ${dim(`「${n.lastWords}」`)}`));
              } else {
                const act = n.action ? ` ${dim(`*${String(n.action).slice(0, 25)}*`)}` : "";
                out.push(tr(gray(`   |-[${n.name}${n.clusterSize && n.clusterSize > 1 ? `×${n.clusterSize}` : ""}] ${n.height !== "?" && n.height ? `${n.height}·` : ""}${n.posDesc || "?"}${act}`)));
              }
            }
            // 底栏
            out.push(tr(""));
            out.push(tr(gray(`  |-[${loc}${clock ? " · " + clock : ""}]`)));
          }
        }

        // ── 房间 Tab 渲染 ──
        else if (_tab === 2) {
          // 外出导航子面板
          if (_submenu === "go-nav") {
            out.push(tr(head("外出"), "nav"));
            const bc = (() => { try { return require("./engine/state.ts").getLocationNav(p.location).breadcrumb || []; } catch { return []; } })();
            if (bc.length) out.push(tr(gray(`|-[${bc.join("-")}]`)));
            out.push(tr(""));
            if (!_goNavItems.some(it => it.kind === "dest")) {
              out.push(tr(gray("  （当前没有可去的地点——问 GM 带你探索）")));
            }
            const GCOL = 16; // 地名列宽（地名比 kv 键长，单独对齐线）
            const padG = (s2: string) => s2 + " ".repeat(Math.max(0, GCOL - visW(s2)));
            for (let i = 0; i < _goNavItems.length; i++) {
              const it = _goNavItems[i];
              if (it.kind === "header") { out.push(tr(`  ${gray(it.label)}`, "nav")); continue; }
              const on = _panelMode && _subCursor === i;
              const curMark = on ? hi("▶") : " ";
              if (it.mode === "unknown") {
                out.push(tr(` ${curMark} ${gray("❓ " + padG(it.name))} ${gray(`步行${it.mins}分 · 未探索`)}`, "nav"));
              } else if (it.mode === "train") {
                out.push(tr(` ${curMark} ${padG("→ " + it.name)} ${C.M}│${C.r} ${gold(`¥${it.fare}`)} ${gray(`· ${it.mins}分`)}`, "nav", on));
              } else {
                const slow = (it.rawMins ?? 0) >= 15 ? ` ${hi("💭旅途叙事")}` : "";
                out.push(tr(` ${curMark} ${padG(it.name)} ${C.M}│${C.r} ${gray(`步行${it.mins}分`)}${slow}`, "nav", on));
              }
            }
            // 已探索地点段
            const knownLocs = p.known_locations || [];
            if (knownLocs.length > 0) {
              out.push(tr(""));
              out.push(tr(gray(`── 🗺️ 已探索 (${knownLocs.length}) ──`), "nav"));
              const shown = knownLocs.slice(0, 8);
              for (const kl of shown) {
                let area = "";
                try { const s0 = require("./engine/state.ts"); const nv = s0.getLocationNav(kl); area = nv?.breadcrumb?.slice(-2).join("·") || ""; } catch {}
                out.push(tr(`  ${gray("·")} ${kl}${area ? "  " + gray(area) : ""}`, "nav"));
              }
              if (knownLocs.length > 8) out.push(tr(gray(`  … 还有 ${knownLocs.length - 8} 处`), "nav"));
            }
          }
          // 家具详情子面板
          else if (_submenu === "furniture-detail" && _selectedTarget) {
            const ft = _selectedTarget;
            out.push(tr(`📦 ${ft.name} (${ft.x},${ft.y})`));
            if (ft.label && ft.label.trim()) out.push(tr(`  标签: ${ft.label.trim()}`));
            // 获取家具引擎动作
            let ftActions: string[] = [];
            try {
              const { findFurnitureDef, getAvailableActions } = require("./engine/furniture.ts");
              const def = findFurnitureDef(ft.name);
              ftActions = getAvailableActions(def, ft.name);
            } catch { ftActions = []; }
            if (!ftActions.length) ftActions = ["查看", "使用"];
            // 缓存给 handleInput
            (_selectedTarget as any)._furnActions = ftActions;
            (_selectedTarget as any)._furnX = ft.x;
            (_selectedTarget as any)._furnY = ft.y;
            out.push(tr(`  ── 操作 ──`));
            for (let i = 0; i < ftActions.length; i++) {
              out.push(tr(`  ${_subCursor === i ? "▶" : " "} ${String.fromCodePoint(0x2460+i)} ${ftActions[i]}`));
            }
            // 容器预览
            try {
              const st = require("./engine/state.ts");
              const containers = st.getContainersAt ? st.getContainersAt(p.location, p.gridPos) : [];
              const furnContainers = containers.filter((c: any) => c.ownerType === "furniture" && (c.ownerId === ft.name || (c.ownerId && c.ownerId.startsWith(ft.name + "·"))));
              if (furnContainers.length > 0) {
                out.push(tr(gray("  ── 容器 ──")));
                const offset = ftActions.length;
                for (let i = 0; i < furnContainers.length; i++) {
                  const fc = furnContainers[i];
                  const locked = !!(fc.def?.locked);
                  const itemNames = (fc.items || []).map((x: any) => x.name).join("·") || "空";
                  const subName = (fc.ownerId && fc.ownerId.includes("·")) ? fc.ownerId.split("·")[1] : "储物";
                  const cnt = (fc.items || []).length;
                  const cntStr = cnt ? `${cnt}件` : "空";
                  out.push(tr(`  ${_subCursor === offset + i ? "▶" : " "} ${String.fromCodePoint(0x2460+offset+i)} ${locked?"🔒":"📂"} ${subName} ${gray(cntStr)} ${itemNames ? gray("·") + " " + itemNames : ""}`));
                }
                (_selectedTarget as any)._furnContainers = furnContainers;
              }
            } catch {}
          }
          else if (!rm) {
            out.push(tr(gray(`  （无房间数据）`)));
          } else {
            const cells = rm.cells || [];
            for (let y = 0; y < rm.height; y++) {
              for (let x = 0; x < rm.width; x++) {
                const c = cells[y]?.[x];
                if (c?.furniture) {
                  _focusItems.push({ type: "furniture", name: c.furniture, x, y, label: c.label });
                }
                if ((c?.type === "exit" || c?.type === "door") && c?.exitTo) {
                  _focusItems.push({ type: "exit", exitTo: c.exitTo, x, y });
                }
              }
            }

            out.push(tr(gray(`  📏 ${rm.width||"?"}m×${rm.height||"?"}m · 你在(${p.gridPos?.[0]??"?"},${p.gridPos?.[1]??"?"}) · ${(rm.atmosphere||"普通").slice(0, 25)}`)));
            if (rm.controlled_by) {
              try {
                const s0 = require("./engine/state.ts");
                const orgs = s0.gameState?.organizations || {};
                const org = orgs[rm.controlled_by];
                if (org) out.push(tr(gray(`  🏛️ 此区域由 ${org.name || rm.controlled_by} 控制`)));
              } catch {}
            }
            out.push(tr(head("家具")));
            let fCount = 0;
            for (let i = 0; i < _focusItems.length; i++) {
              const item = _focusItems[i];
              const sel = _panelMode && i === _cursor ? hi("▶") : " ";
              if (item.type === "furniture") {
                const sub = (item.label && item.label.trim()) ? ` · ${item.label.trim()}` : "";
                const acts = furnitureActions(item.name);
                out.push(tr(`    ${sel} 📦 ${item.name}${gray(`(${item.x},${item.y})${sub}  ${acts}`)}`));
                fCount++;
              }
            }
            if (!fCount) out.push(tr(gray(`    （空）`)));

            out.push(tr(head("出口")));
            let eCount = 0;
            for (let i = 0; i < _focusItems.length; i++) {
              const item = _focusItems[i];
              const sel = _panelMode && i === _cursor ? hi("▶") : " ";
              if (item.type === "exit") {
                out.push(tr(`    ${sel} 🚪 → ${item.exitTo}${gray(`(${item.x},${item.y})`)}`));
                eCount++;
              }
            }
            if (!eCount) out.push(tr(gray(`    （无）`)));
            // 外出入口（跨区导航，Enter → go-nav 子面板）
            {
              const goIdx = _focusItems.length;
              _focusItems.push({ type: "gonav" });
              const onGo = _panelMode && _cursor === goIdx;
              let goHint = "";
              try {
                const nav2 = s.getLocationNav(p.location);
                const nDest = (nav2.rooms?.length || 0) + (nav2.nearby?.length || 0) + (nav2.stations || []).reduce((n2: number, st2: any) => n2 + (st2.destinations?.length || 0), 0);
                const area = nav2.breadcrumb?.[nav2.breadcrumb.length - 2] || "";
                goHint = `${area ? area + "·" : ""}${nDest}处可去`;
              } catch { goHint = "跨区导航"; }
              out.push(tr(` ${onGo ? hi("▶") : " "} 🚶 ${padCol("外出")} ${C.M}│${C.r} ${goHint} ${gray("›")}`, "nav", onGo));
            }
            // 页脚三连（Phase 1 LLM 生成优先，空则引擎 fallback）
            out.push(tr(""));
            const sf = gs._sceneFooter as { posture: string; location_detail: string; main_quest: string } | null;
            if (sf?.posture || sf?.location_detail || sf?.main_quest) {
              if (sf.posture) out.push(tr(gray(`  |-[${sf.posture}]`)));
              if (sf.location_detail) out.push(tr(gray(`  |-[${sf.location_detail}]`)));
              if (sf.main_quest && sf.main_quest !== "暂无")
                out.push(tr(gray(`  |-[主线任务:${sf.main_quest}]`)));
            } else {
              const postureBits: string[] = [];
              if (p.hiding_in) postureBits.push(p.hiding_in);
              else if (rm) { const pl = posLabel(p.gridPos, rm); if (pl) postureBits.push(pl); }
              if (postureBits.length) out.push(tr(gray(`  |-[动作位置-${postureBits.join("·")}]`)));
              try {
                const nav = require("./engine/state-location.ts").getLocationNav(loc);
                const chain = nav?.breadcrumb?.length ? nav.breadcrumb.join("-")
                  : `${require("./engine/state-location.ts").getWorldRootName()}-${loc}`;
                out.push(tr(gray(`  |-[${chain}]`)));
              } catch { out.push(tr(gray(`  |-[${loc}]`))); }
              const quests = gs.quests || {};
              const mainQuest = Object.values(quests).find((q: any) => q.status === "active") as any;
              if (mainQuest?.title) out.push(tr(gray(`  |-[主线任务:${mainQuest.title}]`)));
            }
          }
        }

        // ── 行动 Tab 渲染 ──
        else {
          // 结算详情子面板
          if (_submenu === "settlement-detail" && _selectedTarget) {
            const stl = _selectedTarget;
            const rep = stl.report || {};
            const ratingEmoji: Record<string,string> = { "SSS":"👑","SS":"🌟","S":"⭐","A":"💫","B":"✨","C":"💤" };
            out.push(tr(`══ 事后结算 ══`));
            out.push(tr(`${stl.charName || "?"} · ${ratingEmoji[rep.rating]||""} ${rep.rating||"?"} (得分: ${(rep.climaxCount||0)*20+(rep.squirtCount||0)*15+Object.keys(rep.partsGrowth||{}).length*10})`));
            if (rep.milestonesChanged?.length) out.push(tr(`💝 ${rep.milestonesChanged.join(" | ")}`));
            out.push(tr(`用时: ${rep.duration_minutes||0}min | 高潮: ${rep.climaxCount||0}次 | 潮吹: ${rep.squirtCount||0}次`));
            if (rep.partsGrowth && Object.keys(rep.partsGrowth).length) {
              out.push(tr(`── 部位成长 ──`));
              const pg = Object.entries(rep.partsGrowth).map(([k,v]) => `${k}↑${v}`).join(" · ");
              out.push(tr(`  ${pg}`));
            }
            if (rep.conceived) out.push(tr(`  ⚠️ 受精确认 — ${stl.charName}可能怀孕了`));
            // 生理明细（从 SexState 读取）
            try {
              const sx = stl._sx;
              if (sx) {
                const baseRates: Record<string,number> = { "排卵期":0.35, "安全期":0.01, "生理期":0 };
                const rate = baseRates[sx.cyclePhase] ?? 0.01;
                const contra = sx.contraceptionUsed || "none";
                const contraLabel = contra === "pill" ? "避孕药" : contra === "condom" ? "避孕套" : "无";
                const risk = contra === "pill" ? 0.01 * rate : contra === "condom" ? 0.02 * rate : rate;
                out.push(tr(`── 🔬 生理 ──`));
                out.push(tr(`  周期 第${sx.cycleDay||0}天·${sx.cyclePhase||"?"}（受孕率 ${(rate*100).toFixed(0)}%）`));
                out.push(tr(`  避孕: ${contraLabel} → 实际受孕率 ${(risk*100).toFixed(1)}%`));
                out.push(tr(`  受精: ${rep.conceived ? "✅ 是（骰中）" : "❌ 否（未中）"}`));
              }
            } catch {}
            if (rep.thoughts?.length) {
              out.push(tr(`── 心里话 ──`));
              rep.thoughts.slice(-3).forEach((t: any) => out.push(tr(`  「${t.text}」`)));
            }
            out.push(tr(`按 Esc 返回`));
          }
          // 结算卡片
          else if ((gs as any)._pendingSettlement) {
            const pends = (gs as any)._pendingSettlement;
            const rep = pends.report || {};
            const ratingEmoji: Record<string,string> = { "SSS":"👑","SS":"🌟","S":"⭐","A":"💫","B":"✨","C":"💤" };
            out.push(tr(`🏆 亲密结算 | ${pends.charName || "?"}`));
            const highlights: string[] = [];
            highlights.push(`${ratingEmoji[rep.rating]||""} ${rep.rating||"?"}`);
            if (rep.climaxCount) highlights.push(`高潮 ${rep.climaxCount}次`);
            if (rep.squirtCount) highlights.push(`潮吹 ${rep.squirtCount}次`);
            highlights.push(`用时 ${rep.duration_minutes||0}min`);
            out.push(tr(`  ${highlights.join(" · ")}`));
            if (rep.milestonesChanged?.length) out.push(tr(`  💝 ${rep.milestonesChanged.join(" | ")}`));
            if (rep.partsGrowth && Object.keys(rep.partsGrowth).length) {
              out.push(tr(`  📈 ${Object.entries(rep.partsGrowth).map(([k,v]) => `${k}↑${v}`).join(" · ")}`));
            }
            if (rep.conceived) out.push(tr(`  ⚠️ 受精确认 — ${pends.charName}可能怀孕了`));
            out.push(tr(`  Enter 查看详情 · 选选项继续`));
            out.push(tr(hline));
            // 选项列表
            for (let i = 0; i < _choicesCache.length; i++) {
              _focusItems.push({ type: "choice", text: _choicesCache[i], tag: _choiceTags[i], index: i });
            }
            if (!_choicesCache.length) { out.push(tr(gray(`  输入文字推进剧情后，选项自动出现`))); }
            else {
              for (let i = 0; i < Math.min(_choicesCache.length, 6); i++) {
                const idx = String.fromCodePoint(0x2460 + i);
                const tag = _choiceTags[i] || "";
                const sel = _panelMode && i === _cursor ? hi("▶") : " ";
                out.push(tr(`${sel} ${gray(idx)} ${_choicesCache[i]}${tag ? gray(` [${tag}]`) : ""}`));
              }
            }
          }
          // 默认选项列表
          else {
            for (let i = 0; i < _choicesCache.length; i++) {
              _focusItems.push({ type: "choice", text: _choicesCache[i], tag: _choiceTags[i], index: i });
            }
            for (const co of _condOptsCache) {
              _focusItems.push({ type: "choice", text: co.text, tag: co.tag, conditional: true });
            }
            const standing = _buildStandingActions(gs);
            for (const sa of standing) {
              _focusItems.push({ type: "standing", act: sa });
            }
            if (!_focusItems.length) {
              out.push(tr(gray(`  输入文字推进剧情后，选项自动出现`)));
            } else {
              const nStd = Math.min(_choicesCache.length, 6);
              for (let i = 0; i < nStd; i++) {
                const idx = String.fromCodePoint(0x2460 + i);
                const tag = _choiceTags[i] || "";
                const sel = _panelMode && i === _cursor ? hi("▶") : " ";
                out.push(tr(`${sel} ${gray(idx)} ${_choicesCache[i]}${tag ? gray(` [${tag}]`) : ""}`));
              }
              // 条件选项：编号顺延，条件 tag 橙色（DLC2.09 风格）
              for (let j = 0; j < _condOptsCache.length && nStd + j < 9; j++) {
                const co = _condOptsCache[j];
                const fi = _choicesCache.length + j; // focusItems 中的真实下标
                const idx = String.fromCodePoint(0x2460 + nStd + j);
                const sel = _panelMode && fi === _cursor ? hi("▶") : " ";
                out.push(tr(`${sel} ${gray(idx)} ${co.text} ${hi(`[${co.tag}]`)}`));
              }
              // 常驻动作：等待/睡觉/吃东西（引擎直改不推正文），编号继续顺延
              if (standing.length) {
                out.push(tr(`  ${gray("── 常驻 ──")}`));
                const nShown = nStd + Math.min(_condOptsCache.length, Math.max(0, 9 - nStd));
                for (let k2 = 0; k2 < standing.length; k2++) {
                  const sa = standing[k2];
                  const fi = _choicesCache.length + _condOptsCache.length + k2;
                  const idx = String.fromCodePoint(0x2460 + nShown + k2);
                  const sel = _panelMode && fi === _cursor ? hi("▶") : " ";
                  const lbl = sa.hot ? hi(`${sa.icon} ${sa.label}`) : `${sa.icon} ${sa.label}`;
                  out.push(tr(`${sel} ${gray(idx)} ${lbl} ${dim(`(${sa.hint})`)}`));
                }
              }
            }
          }
        }

        // 底部状态提示栏
        out.push(tr(hline));
        let tip = "";
        if (_panelMode) {
          if (_submenu === "npc-detail") {
            tip = "← → 选快捷操作 · Enter确认 · Esc返回";
          } else if (_submenu === "npc-talk" || _submenu === "npc-touch" || _submenu === "npc-combat" || _submenu === "npc-steal" || _submenu === "npc-romance") {
            tip = "↑ ↓ 选子选项 · 1-9数字直选 · Esc返回";
          } else if (_submenu === "npc-observe" || _submenu === "settlement-detail") {
            tip = "信息量 = 洞察技能等级 · Esc 返回";
          } else if (_submenu === "item-detail" || _submenu === "vehicle-detail" || _submenu === "furniture-detail" || _submenu === "equip-detail") {
            tip = "↑ ↓ 选操作 · Enter确认 · Esc返回";
          } else if (_submenu === "go-nav") {
            tip = "↑ ↓ 选目的地 · Enter出发 · Esc返回";
          } else if (_submenu === "info-detail") {
            tip = "↑ ↓ 选分类 · Enter查看 · Esc返回";
          } else if (_submenu === "info-section") {
            tip = "Esc 返回";
          } else {
            tip = _tab === 1 ? "← → 切Tab  ↑ ↓ 移光标 · Enter展开 · Esc收起" : "← → 切Tab  ↑ ↓ 选项目 · Enter操作 · Esc收起";
          }
        } else {
          tip = "双击 Enter 展开";
        }
        out.push(tr(gray(tip)));
        return out;
      } catch (e: any) {
        console.error("[game-hud] render error:", e.message || e);
        return [];
      }
    },

    handleInput(d: string, _fc?: any): boolean {
      try {
        const s = require("./engine/state.ts");
        const gs = s.gameState;
        if (!gs?.player) return false;
        // 列表可能在动作后变短（使用/丢弃/装备），光标越界一律夹回
        if (_cursor >= _focusItems.length) _cursor = Math.max(0, _focusItems.length - 1);

        // 确认对话框模式：拦截所有按键，只处理确认/取消
        if (_confirmMode) {
          if (d === "\x1b" || d === "q") { _confirmMode = null; _subCursor = 0; return true; }
          if (d === "\x1b[A" || d === "\x1bOA" || d === "\x1b[B" || d === "\x1bOB") { _subCursor = _subCursor === 0 ? 1 : 0; return true; }
          const isEnter2 = d === "\r" || d === "\n";
          const num2 = /^[12]$/.test(d) ? parseInt(d) - 1 : -1;
          if (isEnter2 || num2 >= 0) {
            const choice = isEnter2 ? _subCursor : num2;
            if (choice === 0 && _confirmMode.cb) { _confirmMode.cb(); }
            _confirmMode = null;
            _subCursor = 0;
            return true;
          }
          return true; // 拦截所有其他按键
        }

        // 如果是子菜单内部输入，单独消费
        if (_panelMode && _submenu) {
          // ESC/q 返回上一级
          if (d === "\x1b" || d === "q") {
            // 装备选物品模式的 Esc 只退出选物品模式，回正常槽列表
            if (_submenu === "equip-detail" && _pickSlot) { _pickSlot = null; _subCursor = 0; return true; }
            if (_submenu === "npc-talk" || _submenu === "npc-touch" || _submenu === "npc-observe" || _submenu === "npc-combat" || _submenu === "npc-steal" || _submenu === "npc-romance") {
              _submenu = "npc-detail";
              _subCursor = 0;
            } else if (_submenu === "npc-detail") {
              _submenu = null;
              _subCursor = 0;
            } else if (_submenu === "item-detail") {
              // 从装备详情进来的，Esc 退回装备详情；否则退到面板
              if (_selectedTarget?.slotId) {
                _submenu = "equip-detail";
                const eqSlots3 = getEquipSlots(gs.player.gender);
                _subCursor = eqSlots3.findIndex((s:any) => s.id === _selectedTarget.slotId);
                if (_subCursor < 0) _subCursor = 0;
              } else {
                _submenu = null;
                _subCursor = 0;
              }
            } else if (_submenu === "info-section") {
              // 三级退回二级菜单，光标停留在刚看的段
              _submenu = "info-detail";
              _subCursor = _infoSecIdx;
            } else if (_submenu === "vehicle-detail" || _submenu === "furniture-detail" || _submenu === "equip-detail" ||
                       _submenu === "body-detail" || _submenu === "skills-detail" || _submenu === "party-detail" ||
                       _submenu === "reputation-detail" || _submenu === "relations-detail" || _submenu === "titles-detail" || _submenu === "sex-detail" ||
                       _submenu === "identity-detail" ||
                       _submenu === "go-nav" || _submenu === "info-detail" || _submenu === "economy-detail" || _submenu === "combat-detail" ||
                       _submenu === "world-detail" || _submenu === "phone-main" ||
                       _submenu === "phone-messages" || _submenu === "bag-empty" || _submenu === "bag-list" ||
                       _submenu === "turnlog-detail" ||
                       _submenu === "container-pick") {
              _submenu = null;
              _subCursor = 0;
            } else if (_submenu === "settlement-detail") {
              _submenu = null;
              _subCursor = 0;
              delete (gs as any)._pendingSettlement;
            }
            return true;
          }

          // NPC 二级详情菜单控制 (快捷键一横排)
          if (_submenu === "npc-detail") {
            const npcActs = _buildNpcActions(gs, _selectedTarget.name);
            const actionCount = npcActs.length;
            const actionKeys = npcActs.map(a => a.key);
            if (d === "\x1b[C" || d === "\x1bOC" || d === "l") {
              _subCursor = (_subCursor + 1) % actionCount;
              return true;
            }
            if (d === "\x1b[D" || d === "\x1bOD" || d === "h") {
              _subCursor = (_subCursor + actionCount - 1) % actionCount;
              return true;
            }
            // 键盘 1-9 直选或者 Enter 触发
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const isEnter = d === "\r" || d === "\n";
              const key = isEnter ? (actionKeys[_subCursor] ?? _subCursor) : parseInt(d) - 1;

              if (key === 0) {
                // 搭话
                _submenu = "npc-talk";
                _subCursor = 0;
              } else if (key === 1) {
                // 接触
                _submenu = "npc-touch";
                _subCursor = 0;
              } else if (key === 2) {
                // 观察 → 进入分级信息子面板
                _submenu = "npc-observe";
                _subCursor = 0;
              } else if (key === 4) {
                // 恋爱子菜单
                _submenu = "npc-romance";
                _subCursor = 0;
              } else if (key === 5) {
                // 战斗子菜单
                _submenu = "npc-combat";
                _subCursor = 0;
              } else if (key === 6) {
                // 窃取子菜单
                _submenu = "npc-steal";
                _subCursor = 0;
              } else {
                // 其他普通操作，调用 _handleNpcAction 并关闭菜单
                try {
                  _handleNpcAction(gs, _selectedTarget.name, key);
                } catch (e: any) {
                  console.error("[npc-action] _handleNpcAction 异常:", e?.message || e, "name:", _selectedTarget?.name, "key:", key);
                  getCtx()?.ui?.notify("操作异常，请看控制台", "error");
                }
                _submenu = null;
                _panelMode = false;
              }
              return true;
            }
            return false;
          }

          // 三级搭话菜单控制
          if (_submenu === "npc-talk") {
            const talks = ["聊聊日常", "聊聊自己", "聊聊对方", "聊聊八卦"];
            if (d === "\x1b[A" || d === "\x1bOA") {
              _subCursor = (_subCursor + talks.length - 1) % talks.length;
              return true;
            }
            if (d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = (_subCursor + 1) % talks.length;
              return true;
            }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const isEnter = d === "\r" || d === "\n";
              const idx = isEnter ? _subCursor : parseInt(d) - 1;
              if (idx >= 0 && idx < talks.length) {
                const ctx = getCtx();
                const topic = talks[idx];
                pushText(`我找 ${_selectedTarget.name} ${topic}。`);
                ctx?.ui?.notify(`与${_selectedTarget.name}${topic}`, "info");
                _submenu = null;
                _panelMode = false;
              }
              return true;
            }
            return false;
          }

          // 三级接触菜单控制
          if (_submenu === "npc-touch") {
            const levels = [
              { label: "握手", min: 0 },
              { label: "摸头", min: 30 },
              { label: "拥抱", min: 50 },
              { label: "按摩", min: 60 },
              { label: "亲吻", min: 70 }
            ];
            if (d === "\x1b[A" || d === "\x1bOA") {
              _subCursor = (_subCursor + levels.length - 1) % levels.length;
              return true;
            }
            if (d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = (_subCursor + 1) % levels.length;
              return true;
            }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const isEnter = d === "\r" || d === "\n";
              const idx = isEnter ? _subCursor : parseInt(d) - 1;
              if (idx >= 0 && idx < levels.length) {
                const reqAff = levels[idx].min;
                const ctx = getCtx();
                if (_selectedTarget.affection < reqAff) {
                  ctx?.ui?.notify(`与${_selectedTarget.name}的关系不足以进行此接触(需好感度≥${reqAff})`, "warning");
                } else {
                  _doTouch(gs, _selectedTarget.name, idx);
                  _submenu = null;
                  _panelMode = false;
                }
              }
              return true;
            }
            return false;
          }

          // 观察/身体/技能/队伍/声望/称号/Sex/情报单段 子面板（只读，仅 Esc 退出）
          if (_submenu === "npc-observe" || _submenu === "body-detail" || _submenu === "skills-detail" ||
              _submenu === "party-detail" || _submenu === "reputation-detail" || _submenu === "relations-detail" || _submenu === "titles-detail" ||
              _submenu === "identity-detail" ||
              _submenu === "sex-detail" || _submenu === "settlement-detail" || _submenu === "info-section" ||
              _submenu === "economy-detail" || _submenu === "combat-detail" || _submenu === "world-detail" ||
              _submenu === "turnlog-detail") {
            // 消费所有方向键和回车，防止漏到外层
            if (d === "\x1b[A" || d === "\x1bOA" || d === "\x1b[B" || d === "\x1bOB" ||
                d === "\x1b[C" || d === "\x1bOC" || d === "\x1b[D" || d === "\x1bOD" ||
                d === "\r" || d === "\n") {
              return true;
            }
            return false;
          }

          // 恋爱子菜单控制
          if (_submenu === "npc-romance") {
            if (d === "\x1b[A" || d === "\x1bOA" || d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = _subCursor === 0 ? 1 : 0;
              return true;
            }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "2")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              const ctx = getCtx();
              const n = _selectedTarget?.name;
              const aff = getNpcAffection(gs, n);
              if (idx === 0) {
                // 告白
                if (aff < 70) { ctx?.ui?.notify("好感需≥70", "warning"); return false; }
                const rel = gs.player.relationships[n] || (gs.player.relationships[n] = { stage: "熟人", affection: aff, history: [], notes: "" });
                const ok = Math.random() > 0.25;
                if (ok) {
                  rel.affection = Math.min(100, (rel.affection || 0) + 10); rel.romance = "恋人";
                  pushText(`我向 ${n} 告白了。${n}沉默了很久，然后轻轻点了点头。「……我也。」好感+10，成为恋人！`);
                  ctx?.ui?.notify(`${n}接受了告白！`, "info");
                } else {
                  rel.affection = Math.max(0, (rel.affection || 0) - 10);
                  pushText(`我向 ${n} 告白了。${n}低下了头。「……对不起。」好感-10。`);
                  ctx?.ui?.notify(`${n}拒绝了…`, "warning");
                }
                require("./engine/state.ts").saveState();
              } else if (idx === 1) {
                // 约会
                if (aff < 50) { ctx?.ui?.notify("好感需≥50", "warning"); return false; }
                _doDate(gs, n);
              }
              _submenu = null;
              _panelMode = false;
              return true;
            }
            return false;
          }

          // 战斗子菜单控制
          if (_submenu === "npc-combat") {
            const combatOpts = ["切磋", "死斗"];
            if (d === "\x1b[A" || d === "\x1bOA" || d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = _subCursor === 0 ? 1 : 0;
              return true;
            }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "2")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              const ctx = getCtx();
              const n = _selectedTarget?.name;
              if (idx === 0) {
                // 切磋
                gs.mode = "rpg";
                pushText(`我对 ${n} 抱拳行礼：「请赐教。」${n}摆出了架势。切磋开始！`);
                ctx?.ui?.notify(`⚔ 与${n}切磋武艺`, "info");
              } else if (idx === 1) {
                // 死斗 → 确认对话框
                _confirmMode = { action: "deathmatch", item: n, cb: () => {
                  const rel = gs.player.relationships[n] || (gs.player.relationships[n] = { stage: "熟人", affection: 0, history: [], notes: "" });
                  rel.affection = Math.max(0, (rel.affection || 0) - 50);
                  rel.stage = "死敌";
                  gs.mode = "rpg";
                  require("./engine/state.ts").saveState();
                  pushText(`我向 ${n} 发起了死斗！一场你死我活的战斗即将展开……`);
                  ctx?.ui?.notify(`💀 向${n}发起死斗`, "warning");
                  _submenu = null;
                  _panelMode = false;
                }};
                _subCursor = 0;
                return true;
              }
              require("./engine/state.ts").saveState();
              _submenu = null;
              _panelMode = false;
              return true;
            }
            return false;
          }

          // 窃取子菜单控制
          if (_submenu === "npc-steal") {
            const stealItems = (_selectedTarget as any)?._stealItems || [];
            if (!stealItems.length) return false;
            if (d === "\x1b[A" || d === "\x1bOA") {
              _subCursor = (_subCursor + stealItems.length - 1) % stealItems.length;
              return true;
            }
            if (d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = (_subCursor + 1) % stealItems.length;
              return true;
            }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              if (idx < 0 || idx >= stealItems.length) return false;
              const si = stealItems[idx];
              if (!si.action) return false;
              const ctx = getCtx();
              try {
                const st = require("./engine/state.ts");
                if (si.action === "steal_cash") {
                  const result = st.stealFunds(gs.player, _selectedTarget.name);
                  st.saveState();
                  pushText(result.narrative);
                  ctx?.ui?.notify(result.caught ? `偷钱被${_selectedTarget.name}抓住！` : result.success ? "顺到了钱" : "没摸到钱包", result.caught ? "warning" : "info");
                } else {
                  const result = st.stealItem(gs.player, _selectedTarget.name, si.key);
                  st.saveState();
                  pushText(result.narrative);
                  ctx?.ui?.notify(result.caught ? `偷窃被${_selectedTarget.name}抓住！好感-20` : result.success ? `偷到了${si.key}` : "偷窃失败", result.caught ? "warning" : "info");
                }
              } catch(e: any) {
                console.error("[steal] 异常:", e?.message || e);
                ctx?.ui?.notify("窃取系统异常", "error");
              }
              _submenu = null;
              _panelMode = false;
              return true;
            }
            return false;
          }

          // 家具详情控制
          if (_submenu === "furniture-detail") {
            const ftActions: string[] = (_selectedTarget as any)?._furnActions || [];
            const ftContainers: any[] = (_selectedTarget as any)?._furnContainers || [];
            const totalItems = ftActions.length + ftContainers.length;
            if (d === "\x1b[A" || d === "\x1bOA") {
              _subCursor = (_subCursor + totalItems - 1) % totalItems;
              return true;
            }
            if (d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = (_subCursor + 1) % totalItems;
              return true;
            }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              if (idx < 0 || idx >= totalItems) return false;
              const ctx = getCtx();
              try {
                const s2 = require("./engine/state.ts");
                const { interactFurniture } = require("./engine/furniture.ts");
                const rm2 = s2.getRoom(gs.player.location);
                if (idx < ftActions.length) {
                  // 执行家具动作（async 用 void 触发，handleInput 是同步的）
                  const action = ftActions[idx];
                  void interactFurniture(
                    _selectedTarget.name, action, gs,
                    gs.player.gridPos, rm2?.cells || null
                  ).then((result: any) => {
                    s2.saveState();
                    ctx?.ui?.notify(result.message || `已${action}${_selectedTarget.name}`, "info");
                    pushText(result.narrative || result.message);
                  }).catch((e: any) => {
                    console.error("[furniture] 动作失败:", e?.message || e);
                    ctx?.ui?.notify("操作失败", "error");
                  });
                } else {
                  // 容器 → 进入逐物选择子面板
                  const cIdx = idx - ftActions.length;
                  const container = ftContainers[cIdx];
                  if (!container) return false;
                  if (container.def?.locked) {
                    ctx?.ui?.notify("容器已锁", "warning");
                    return true;
                  }
                  if (!container.items?.length) {
                    ctx?.ui?.notify("容器是空的", "info");
                    return true;
                  }
                  (_selectedTarget as any)._containerItems = container.items;
                  (_selectedTarget as any)._containerId = container.id;
                  (_selectedTarget as any)._containerName = (container.ownerId && container.ownerId.includes("·")) ? container.ownerId.split("·")[1] : "储物";
                  _submenu = "container-pick";
                  _subCursor = 0;
                  return true;
                }
              } catch(e: any) {
                console.error("[furniture] 操作异常:", e?.message || e);
                ctx?.ui?.notify("家具操作异常", "error");
              }
              // 执行后退出子菜单
              _submenu = null;
              return true;
            }
            return false;
          }

          // 容器逐物选择控制
          if (_submenu === "bag-list") {
            const inv3 = gs.player.inventory || [];
            const n = inv3.length;
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + n - 1) % Math.max(1, n); return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % Math.max(1, n); return true; }
            if (d === "\r" || d === "\n") {
              const it = inv3[_subCursor];
              if (it) {
                _selectedTarget = { type: "bag", item: it, index: _subCursor };
                _submenu = "item-detail";
                _subCursor = 0;
              }
              return true;
            }
            return false;
          }
          if (_submenu === "container-pick") {
            const cpItems = (_selectedTarget as any)?._containerItems || [];
            const total = cpItems.length + 1; // +1 = 全部取出
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + total - 1) % total; return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % total; return true; }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              const ctx = getCtx();
              const cid = (_selectedTarget as any)?._containerId;
              if (idx === cpItems.length) {
                // 全部取出
                if (!cpItems.length) { ctx?.ui?.notify("容器是空的", "info"); return true; }
                try {
                  const s2 = require("./engine/state.ts");
                  const tf = s2.transferBetweenContainers;
                  let ok = 0;
                  for (const it of cpItems) {
                    if (tf) { const r = tf(cid, "backpack", it.name); if (typeof r === "string" && r.includes("转移成功")) ok++; }
                  }
                  s2.saveState();
                  ctx?.ui?.notify(`全部取出 ${ok}/${cpItems.length} 件`, "info");
                } catch (e: any) { console.error("[container-pick] 全部取出失败:", e); ctx?.ui?.notify("操作异常", "error"); }
              } else {
                if (idx < 0 || idx >= cpItems.length) return false;
                const item = cpItems[idx];
                try {
                  const s2 = require("./engine/state.ts");
                  const tf = s2.transferBetweenContainers;
                  const r = tf ? tf(cid, "backpack", item.name) : "引擎不可用";
                  s2.saveState();
                  ctx?.ui?.notify(r, "info");
                } catch (e: any) { console.error("[container-pick] 取物失败:", e); ctx?.ui?.notify("操作异常", "error"); }
              }
              _submenu = "furniture-detail";
              _subCursor = 0;
              return true;
            }
            return false;
          }

          // 手机消息列表控制
          if (_submenu === "phone-messages") {
            let pd: any = null;
            try { const { getPlayerPhoneData } = require("../engine/phone.ts"); pd = getPlayerPhoneData(gs); } catch {}
            const msgs: any[] = pd?.messages || [];
            const grouped: [string, {last:any;unread:number}][] = [];
            const seen = new Map<string, {last:any;unread:number}>();
            for (const m of msgs) {
              const key = m.from === gs.player.name ? m.to : m.from;
              const e = seen.get(key);
              if (!e || m.timestamp > e.last.timestamp) seen.set(key, {last:m, unread:(e?.unread||0)+(m.read?0:1)});
              else if (!m.read && m.to === gs.player.name) seen.set(key, {last:m, unread:e.unread+1});
            }
            // mark all as read
            for (const m of msgs) if (!m.read) m.read = true;
            const entries = Array.from(seen.entries());
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + entries.length - 1) % entries.length; return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % entries.length; return true; }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              if (idx >= 0 && idx < entries.length) {
                const [name] = entries[idx]!;
                const thread = msgs.filter((m:any) => m.from === name || m.to === name).sort((a:any,b:any) => (a.timestamp||"").localeCompare(b.timestamp||""));
                if (thread.length) {
                  // Show thread summary via notify + pushText as quick reply entry
                  const lastMsgs = thread.slice(-5).map((m:any) => `${m.from===gs.player.name?"我":m.from}: ${m.text.slice(0,25)}`).join(" | ");
                  pushText(`我打开与 ${name} 的对话。`);
                  ctx?.ui?.notify(`${name} (${thread.length}条): ${lastMsgs}`, "info");
                }
                _submenu = null;
                _subCursor = 0;
                return true;
              }
            }
            return false;
          }

          // 手机主菜单控制
          if (_submenu === "phone-main") {
            const apps = ["messages","calllog","contacts","sns","photos"];
            const total = apps.length + 1; // + close
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + total - 1) % total; return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % total; return true; }
            if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
              const idx = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              if (idx === apps.length) { _submenu = "item-detail"; _subCursor = 0; return true; } // close
              if (idx < 0 || idx >= apps.length) return false;
              const ctx = getCtx();
              const appId = apps[idx];
              // 暂时全部走 pushText + notify（完整消息/对话面板留后续细化）
              if (appId === "messages") {
                _submenu = "phone-messages";
                _subCursor = 0;
                return true;
              } else if (appId === "calllog") {
                const pd = (() => { try { const { getPlayerPhoneData } = require("../engine/phone.ts"); return getPlayerPhoneData(gs); } catch { return null; } })();
                const cls = pd?.callLog || [];
                if (cls.length) { pushText(`我翻看通话记录。`); ctx?.ui?.notify(`最近通话：${cls.slice(-3).map((c:any)=>`${c.caller}→${c.callee}(${c.status})`).join(" | ")}`,"info"); }
                else { ctx?.ui?.notify("没有通话记录", "info"); }
              } else if (appId === "contacts") {
                const pd = (() => { try { const { getPlayerPhoneData } = require("../engine/phone.ts"); const pdd = getPlayerPhoneData(gs); if (pdd) { const { syncContactsFromRelationships } = require("../engine/phone.ts"); syncContactsFromRelationships(gs, pdd); } return pdd; } catch { return null; } })();
                if (pd?.contacts?.length) { ctx?.ui?.notify(`通讯录 ${pd.contacts.length} 人：${pd.contacts.slice(0,5).map((c:any)=>c.name).join("、")}`,"info"); }
                else { ctx?.ui?.notify("通讯录为空（好感≥20的NPC自动添加）", "info"); }
              } else if (appId === "sns") {
                const pd = (() => { try { const { getPlayerPhoneData } = require("../engine/phone.ts"); return getPlayerPhoneData(gs); } catch { return null; } })();
                const posts = pd?.snsPosts || [];
                if (posts.length) { ctx?.ui?.notify(`mixi 最近 ${Math.min(3,posts.length)} 条: ${posts.slice(-3).map((p:any)=>p.author+":"+p.text.slice(0,15)).join(" | ")}`,"info"); }
                else { ctx?.ui?.notify("mixi 时间线为空", "info"); }
              } else if (appId === "photos") {
                const pd = (() => { try { const { getPlayerPhoneData } = require("../engine/phone.ts"); return getPlayerPhoneData(gs); } catch { return null; } })();
                ctx?.ui?.notify(`相册 ${pd?.photos?.length || 0} 张`, "info");
              }
              return true;
            }
            return false;
          }

          // 装备详情控制（上下选，Enter 进物品详情）
          if (_submenu === "equip-detail") {
            // 选物品模式：背包里兼容该槽的物品列表，↑↓ 选 Enter 装备
            if (_pickSlot) {
              const inv2 = gs.player.inventory || [];
              const compat = inv2.filter((i: any) => i.slot === _pickSlot);
              if (d === "\x1b" || d === "q") { _pickSlot = null; _subCursor = 0; return true; }
              if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + compat.length - 1) % Math.max(1, compat.length); return true; }
              if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % Math.max(1, compat.length); return true; }
              if (d === "\r" || d === "\n") {
                const it = compat[_subCursor];
                if (!it) { getCtx()?.ui?.notify("没有选中物品", "info"); return true; }
                // 装备落地：原槽有物先回背包（与 tools/action/equip_item.ts 一致）
                const p2 = gs.player;
                if (p2.equipment[_pickSlot]) p2.inventory.push(p2.equipment[_pickSlot]);
                const idx = p2.inventory.findIndex((i: any) => i.name === it.name);
                if (idx < 0) { getCtx()?.ui?.notify(`背包里找不到 ${it.name}`, "warning"); return true; }
                p2.equipment[_pickSlot] = p2.inventory.splice(idx, 1)[0];
                s.saveState();
                getCtx()?.ui?.notify(`装备了 ${it.name}`, "info");
                _pickSlot = null;
                _subCursor = 0;
                return true;
              }
              return false;
            }
            // 正常槽列表模式
            const eqSlots2 = getEquipSlots(gs.player.gender);
            const n = eqSlots2.length;
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + n - 1) % n; return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % n; return true; }
            if (d === "\r" || d === "\n") {
              const slot = eqSlots2[_subCursor]!;
              const item = gs.player.equipment?.[slot.id];
              if (item) {
                _selectedTarget = { type: "slot", slotId: slot.id, label: slot.label, item };
                _submenu = "item-detail";
                _subCursor = 0;
              } else {
                // 空槽 → 进入选物品模式（背包里该槽兼容物品列表）
                const inv2 = gs.player.inventory || [];
                const compat = inv2.filter((i: any) => i.slot === slot.id);
                if (!compat.length) {
                  getCtx()?.ui?.notify(`${slot.label}槽为空，且背包里也没有能填 ${slot.label} 的物品`, "info");
                } else {
                  _pickSlot = slot.id;
                  _subCursor = 0;
                }
              }
              return true;
            }
            return false;
          }

          // 外出导航控制（↑↓ 跳过段头和未探索项，Enter 出发）
          if (_submenu === "go-nav") {
            const selectable = (idx: number) => _goNavItems[idx]?.kind === "dest" && _goNavItems[idx]?.mode !== "unknown";
            const step = (dir: 1 | -1): boolean => {
              const n = _goNavItems.length;
              if (!n || !_goNavItems.some((_, i2) => selectable(i2))) return true; // 无可选项，吞掉按键
              let i2 = _subCursor;
              for (let c2 = 0; c2 < n; c2++) {
                i2 = (i2 + dir + n) % n;
                if (selectable(i2)) { _subCursor = i2; return true; }
              }
              return true;
            };
            if (d === "\x1b[A" || d === "\x1bOA") return step(-1);
            if (d === "\x1b[B" || d === "\x1bOB") return step(1);
            if (d === "\r" || d === "\n") {
              const it = _goNavItems[_subCursor];
              if (!it || !selectable(_subCursor)) { getCtx()?.ui?.notify("没有选中可去的地点", "info"); return true; }
              _doTravel(it).catch(e => {
                console.error("[go-nav] 移动失败:", e?.message || e);
                getCtx()?.ui?.notify("移动异常，请看控制台", "error");
              });
              _submenu = null;
              _subCursor = 0;
              _panelMode = false;
              _expanded = false; // 出发后收起 HUD，看叙事/移动结果
              return true;
            }
            return false;
          }

          // 情报二级菜单控制（↑↓ 选段，Enter/数字进单段）
          if (_submenu === "info-detail") {
            const n = _INFO_SECTIONS.length;
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + n - 1) % n; return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % n; return true; }
            const isEnterK = d === "\r" || d === "\n";
            const numK = /^[1-9]$/.test(d) ? parseInt(d) - 1 : -1;
            if (isEnterK || numK >= 0) {
              _infoSecIdx = isEnterK ? _subCursor : numK;
              _submenu = "info-section";
              return true;
            }
            return false;
          }

          // 物品详情控制（动作真落地：守恒量=引擎直改+saveState，不推正文）
          if (_submenu === "item-detail") {
            const acts = _buildItemActions(_selectedTarget);
            if (_subCursor >= acts.length) _subCursor = 0;
            if (d === "\x1b[A" || d === "\x1bOA") { _subCursor = (_subCursor + acts.length - 1) % acts.length; return true; }
            if (d === "\x1b[B" || d === "\x1bOB") { _subCursor = (_subCursor + 1) % acts.length; return true; }
            const isEnterKey = d === "\r" || d === "\n";
            const numIdx = /^[1-9]$/.test(d) ? parseInt(d) - 1 : -1;
            if (isEnterKey || (numIdx >= 0 && numIdx < acts.length)) {
              const act = acts[isEnterKey ? _subCursor : numIdx];
              const ctx = getCtx();
              const p2 = gs.player;
              const it = _selectedTarget?.item;
              const itemName = it?.name || "物品";
              if (act.id === "unequip") {
                // 卸下：放回背包（与 tools/action/equip_item.ts 卸下逻辑一致）
                const slot = _selectedTarget.slotId;
                if (slot && p2.equipment[slot]) {
                  p2.inventory.push(p2.equipment[slot]);
                  p2.equipment[slot] = null;
                  s.saveState();
                  ctx?.ui?.notify(`已卸下 ${itemName}，放回背包`, "info");
                } else {
                  ctx?.ui?.notify(`槽位上没有 ${itemName}`, "warning");
                }
              } else if (act.id === "use") {
                // 使用消耗品（与旧 /bag 一致：heal effect 回血后移除）
                const idx = p2.inventory.findIndex((i: any) => i.name === itemName);
                if (idx < 0) { ctx?.ui?.notify(`背包里没有 ${itemName}`, "warning"); return true; }
                const target = p2.inventory[idx];
                for (const ef of target.effects || []) {
                  if (ef.type === "heal") {
                    const amt = typeof ef.value === "number" ? ef.value : (parseInt(ef.value) || 5);
                    p2.hp.current = Math.min(p2.hp.max, p2.hp.current + amt);
                  }
                }
                p2.inventory.splice(idx, 1);
                s.saveState();
                ctx?.ui?.notify(`使用了 ${itemName}，HP ${p2.hp.current}/${p2.hp.max}`, "info");
              } else if (act.id === "equip") {
                // 装备：原槽有物先回背包。mount 槽调引擎 mountVehicle 以正确设 p.vehicle。
                const idx = p2.inventory.findIndex((i: any) => i.name === itemName);
                if (idx < 0) { ctx?.ui?.notify(`背包里没有 ${itemName}`, "warning"); return true; }
                const target = p2.inventory[idx];
                const slot = target.slot;
                if (!slot) { ctx?.ui?.notify(`${itemName} 没有装备槽位`, "warning"); return true; }
                if (slot === "mount") {
                  const r = s.mountVehicle(itemName);
                  ctx?.ui?.notify(r, r.includes("骑上") ? "info" : "warning");
                } else {
                  if (p2.equipment[slot]) p2.inventory.push(p2.equipment[slot]);
                  p2.equipment[slot] = target;
                  p2.inventory.splice(idx, 1);
                  s.saveState();
                  ctx?.ui?.notify(`装备了 ${itemName}`, "info");
                }
              } else if (act.id === "open_phone") {
                _submenu = "phone-main";
                _subCursor = 0;
                return true;
              } else if (act.id === "discard") {
                // 弹出确认对话框
                _confirmMode = { action: "discard", item: it, cb: () => {
                  if (_selectedTarget.slotId && p2.equipment[_selectedTarget.slotId]) {
                    p2.inventory.push(p2.equipment[_selectedTarget.slotId]);
                    p2.equipment[_selectedTarget.slotId] = null;
                  }
                  let done = "";
                  try {
                    const containers = s.getContainersAt(p2.location, p2.gridPos || undefined) || [];
                    const furn = containers.find((c: any) => c.ownerType === "furniture" && !c.def?.locked);
                    if (furn) {
                      const r = s.transferBetweenContainers("backpack", furn.id, itemName);
                      if (typeof r === "string" && r.includes("转移成功")) done = `已把 ${itemName} 丢进 ${furn.ownerId}`;
                    }
                  } catch (e) { console.error("[game-hud] 丢弃→容器失败", e); }
                  if (!done) {
                    const idx2 = p2.inventory.findIndex((i: any) => i.name === itemName);
                    if (idx2 >= 0) { p2.inventory.splice(idx2, 1); s.saveState(); }
                    done = `已丢弃 ${itemName}（散落无踪）`;
                  }
                  ctx?.ui?.notify(done, "warning");
                  _submenu = null;
                  _selectedTarget = null;
                  _subCursor = 0;
                }};
                _subCursor = 0;
                return true;
              }
              // 留在面板：纯引擎动作无正文可看，收面板会丢失反馈
              _submenu = null;
              _selectedTarget = null;
              _subCursor = 0;
              return true;
            }
            return false;
          }

          // 载具详情控制
          if (_submenu === "vehicle-detail") {
            if (d === "\x1b[A" || d === "\x1bOA" || d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = _subCursor === 0 ? 1 : 0;
              return true;
            }
            if (d === "\r" || d === "\n" || d === "1" || d === "2") {
              const option = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              const ctx = getCtx();
              const vname = _selectedTarget?.name || "载具";
              const isMounted = gs.player.vehicle?.name === vname;
              if (option === 0) {
                if (isMounted) {
                  const r = s.dismountVehicle();
                  ctx?.ui?.notify(r, "info");
                  pushText(`我从 ${vname} 上下来了。`);
                } else {
                  const r = s.mountVehicle(vname);
                  ctx?.ui?.notify(r, "info");
                  pushText(`我骑上了 ${vname}。`);
                }
              } else {
                pushText(`我检查了一下 ${vname} 的状况。`);
                ctx?.ui?.notify(`${vname}：状态良好`, "info");
              }
              _submenu = null;
              _panelMode = false;
              return true;
            }
            return false;
          }

          return false;
        }

        // 未开启面板时：双击 Enter 展开面板，←→↑↓ 和字母键全部放行给聊天输入栏
        if (!_panelMode) {
          // 行动 Tab 有结算卡片 + 单次 Enter → 展开并查看详情
          if (_tab === 3 && (gs as any)._pendingSettlement && (d === "\r" || d === "\n")) {
            _expanded = true;
            _submenu = "settlement-detail";
            _selectedTarget = (gs as any)._pendingSettlement;
            _subCursor = 0;
            _panelMode = true;
            return true;
          }
          // 双击 Enter（600ms 内两次）→ 展开 + 进入面板模式
          if (d === "\r" || d === "\n") {
            const now = Date.now();
            if (now - _lastEnterTime < 600 && _lastEnterTime > 0) {
              // 双击！展开面板
              _lastEnterTime = 0;
              if (_tab === 1 && !_peopleCache.length) return false;
              // 行动 Tab 恒可进：即使无 LLM 选项，常驻动作（等待/睡觉/吃）也在
              _expanded = true;
              _panelMode = true;
              _cursor = 0;
              return true;
            }
            _lastEnterTime = now;
            return false; // 第一次 Enter：放行给聊天输入
          }
          // 非 Enter 键重置计时（不是连续 Enter 就不算双击）
          _lastEnterTime = 0;
          return false;
        }

        // 面板激活中：ESC — 无子菜单时收起整个 HUD，有则退回上一级
        if (d === "\x1b" || d === "q") {
          _panelMode = false;
          _expanded = false; // 收起回摘要行
          _cursor = 0;
          // 如果不在子菜单中，退出面板同时清子菜单
          if (!_submenu || _submenu === "npc-detail") { _submenu = null; }
          return true;
        }

        // 面板激活中：← → 切 Tab / 背包排序切模式
        if (!_submenu && (d === "\x1b[C" || d === "\x1bOC" || d === "\x1b[D" || d === "\x1bOD")) {
          // 如果光标在背包头上，←→ 切换排序模式
          const bagHeaderIdx = _focusItems.findIndex(f => f.type === "bag" && f.index === -1);
          if (bagHeaderIdx >= 0 && _cursor === bagHeaderIdx) {
            _sortMode = d === "\x1b[C" || d === "\x1bOC" ? (_sortMode + 1) % 4 : (_sortMode + 3) % 4;
            return true;
          }
          if (d === "\x1b[C" || d === "\x1bOC") _tab = (_tab + 1) % 4;
          else _tab = (_tab + 3) % 4;
          _cursor = 0;
          return true;
        }

        // 面板激活中：↑ ↓ 移动焦点（不在子菜单中时）
        if (!_submenu) {
          if (d === "\x1b[A" || d === "\x1bOA") {
            _cursor = (_cursor + _focusItems.length - 1) % _focusItems.length;
            return true;
          }
          if (d === "\x1b[B" || d === "\x1bOB") {
            _cursor = (_cursor + 1) % _focusItems.length;
            return true;
          }
        }

        // 面板激活中：确认触发 (Enter 或 数字直选)
        if (d === "\r" || d === "\n" || (d.length === 1 && d >= "1" && d <= "9")) {
          const isEnter = d === "\r" || d === "\n";
          const selectIdx = isEnter ? _cursor : parseInt(d) - 1;
          const currentItem = _focusItems[Math.min(selectIdx, _focusItems.length - 1)];

          if (!currentItem) return false;

          const ctx = getCtx();

          // 1. 周边 NPC 交互项
          if (currentItem.type === "people") {
            if (currentItem.npc.type !== "named") {
              if (isEnter) ctx?.ui?.notify("路人不能深度交互，请聚焦命名NPC", "info");
              return false;
            }
            // 缓存交互目标，进入二级操作面板
            _selectedTarget = currentItem.npc;
            _submenu = "npc-detail";
            _subCursor = 0;
            return true;
          }

          // 2. 选项推进项
          if (currentItem.type === "choice") {
            pushText(currentItem.text);
            ctx?.ui?.notify(`选择: ${currentItem.text.slice(0, 20)}`, "info");
            delete (gs as any)._pendingSettlement;
            _panelMode = false;
            return true;
          }

          // 2.2 常驻动作（等待/睡觉/吃东西——引擎直改，留在面板看结果）
          if (currentItem.type === "standing") {
            _doStandingAction(currentItem.act).catch(e => {
              console.error("[standing-action] 执行失败:", e?.message || e, "act:", currentItem.act?.id);
              getCtx()?.ui?.notify("动作异常，请看控制台", "error");
            });
            return true;
          }

          // 2.3 情报摘要行 → info-detail（六项菜单，内容后台预加载）
          if (currentItem.type === "infoline") {
            _submenu = "info-detail";
            _subCursor = 0;
            _infoSections = null;
            _loadInfoLines();
            return true;
          }
          if (currentItem.type === "turnlog") { _submenu = "turnlog-detail"; _subCursor = 0; return true; }

          // 2.5 自身面板专用项（body/skills/party/reputation/titles）
          if (currentItem.type === "body") {
            _submenu = "body-detail"; _subCursor = 0; return true;
          }
          if (currentItem.type === "identity") { _submenu = "identity-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "sex") {
            _submenu = "sex-detail"; _subCursor = 0; return true;
            _subCursor = 0;
            return true;
          }
          if (currentItem.type === "equip") { _submenu = "equip-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "skills") { _submenu = "skills-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "economy") { _submenu = "economy-detail"; _subCursor = 0; if (!_econLines) void _loadEconCombat(); return true; }
          if (currentItem.type === "combat") { _submenu = "combat-detail"; _subCursor = 0; if (!_combatLines) void _loadEconCombat(); return true; }
          if (currentItem.type === "world") { _submenu = "world-detail"; _subCursor = 0; if (!_worldLines) void _loadWorld(); return true; }
          if (currentItem.type === "party") { _submenu = "party-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "reputation") { _submenu = "reputation-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "relations") { _submenu = "relations-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "titles") { _submenu = "titles-detail"; _subCursor = 0; return true; }

          // 3. 背包 Enter → 打开背包列表子面板
          if (currentItem.type === "bag") {
            const inv0 = gs.player.inventory || [];
            if (inv0.length) {
              _submenu = "bag-list";
              _subCursor = 0;
            } else {
              _submenu = "bag-empty";
              _subCursor = 0;
            }
            return true;
          }
          // 装备槽项
          if (currentItem.type === "slot") {
            if (currentItem.item) {
              _selectedTarget = currentItem;
              _submenu = "item-detail";
              _subCursor = 0;
            } else {
              ctx?.ui?.notify("空装备槽：去背包选中防具或武器穿戴。", "info");
            }
            return true;
          }

          // 4. 载具项
          if (currentItem.type === "vehicle") {
            _selectedTarget = currentItem.vehicle;
            _submenu = "vehicle-detail";
            _subCursor = 0;
            return true;
          }

          // 5. 房间元素 (家具 / 出口) 交互项
          if (currentItem.type === "furniture") {
            _selectedTarget = currentItem;
            _submenu = "furniture-detail";
            _subCursor = 0;
            return true;
          }
          if (currentItem.type === "gonav") {
            // 进入外出导航：构建目的地列表，光标停在第一个可选项
            const st0 = require("./engine/state.ts");
            _goNavItems = _buildGoNav(gs, st0);
            _submenu = "go-nav";
            _subCursor = Math.max(0, _goNavItems.findIndex(it2 => it2.kind === "dest" && it2.mode !== "unknown"));
            return true;
          }
          if (currentItem.type === "exit") {
            // 实际移动：调用引擎 setPlayerLocation
            try {
              const st = require("./engine/state.ts");
              const dest = currentItem.exitTo;
              if (dest && st.setPlayerLocation) {
                st.setPlayerLocation(dest, gs);
                st.saveState();
                pushText(`我走向 ${dest}。`);
                ctx?.ui?.notify(`前往 ${dest}`, "info");
              } else {
                ctx?.ui?.notify(`无法移动到 ${dest || "未知"}`, "warning");
              }
            } catch(e: any) {
              console.error("[room-exit] 移动失败:", e?.message || e);
              ctx?.ui?.notify("移动异常", "error");
            }
            _panelMode = false;
            return true;
          }

          return true;
        }

        return false;
      } catch (e: any) {
        console.error("[game-hud] handleInput error:", e.message || e);
        return false;
      }
    }
  };

  sessionCtx.ui.setWidget("game-hud", (tui: any) => { _tuiRef = tui; return widget; }, { placement: "aboveEditor" });
  return widget; // 便于测试直接拿到 widget 调 render/handleInput
}

