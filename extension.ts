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
// 🎮 终端常驻 HUD widget — 纯文本渲染（pi-tui aboveEditor 过滤 ANSI 转义）
// ═══════════════════════════════════════════════════════════

/** NPC 好感度 helper */
function getNpcAffection(gs: any, name: string): number {
  return gs?.player?.relationships?.[name]?.affection ?? 0;
}
function isNpcLover(gs: any, name: string): boolean {
  return gs?.player?.relationships?.[name]?.romance === "恋人";
}

function initGamePanel(_pi: any, sessionCtx: any) {
  let _tab = 0;
  let _cursor = 0;
  let _panelMode = false;
  let _lastEnterTime = 0; // 双击 Enter 进面板的时间戳

  // ── 三级状态机 ──
  let _submenu: "npc-detail" | "npc-talk" | "npc-touch" | "npc-observe" | "npc-combat" | "npc-steal" | "npc-romance" | "item-detail" | "vehicle-detail" | "furniture-detail" | "body-detail" | "skills-detail" | "party-detail" | "reputation-detail" | "titles-detail" | "sex-detail" | "settlement-detail" | null = null;
  let _subCursor = 0; // 子菜单内部光标
  let _selectedTarget: any = null; // 当前交互的目标实体 (如选中 NPC, 物品, 载具)

  let _choicesCache: string[] = [];
  let _choiceTags: string[] = [];
  let _peopleCache: any[] = [];
  let _lastProseHash = "";

  // 收集当前 Tab 所有的可聚焦行
  let _focusItems: any[] = [];

  /** 取最新有 chat API 的 ctx，兜底用 session ctx */
  const getCtx = () => _latestCtx || sessionCtx;

  const posLabel = (gp: any, rm: any): string => {
    if (!gp || !rm) return "";
    const [x,y] = Array.isArray(gp) ? gp : [0,0];
    let lbl = ""; const rw=rm.width||10, rh=rm.height||6;
    if (y===0) lbl="靠墙"; else if (y===rh-1) lbl="靠后墙";
    if (x===0) lbl+="靠左"; else if (x===rw-1) lbl+="靠右";
    if (!lbl) lbl="中间";
    const c=rm.cells?.[y]?.[x];
    if (c?.label && c.label.trim() && c.label.trim()!=="  ") lbl=c.label.trim();
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
      ctx?.chat?.addSystemMessage(`我找 ${name} 聊天。`);
      ctx?.ui?.notify(`向${name}搭话`, "info");
      _panelMode=false;
    }
    else if(key===1){if(aff<10){ctx?.ui?.notify(`与${name}关系还不够熟`,"warning");return;}_doTouch(gs,name);}
    // key===2 → 观察子面板（由 handleInput 路由，不经过这里）
    else if(key===3){
      if(aff<40&&!lover){ctx?.ui?.notify(`好感需≥40或恋人`,"warning");return;}
      if(pty.includes(name)){
        gs.player.party=pty.filter((n:string)=>n!==name);
        ctx?.chat?.addSystemMessage(`${name}离开了队伍。`);
        ctx?.ui?.notify(`${name}离队`, "info");
      } else {
        gs.player.party=[...pty,name];
        ctx?.chat?.addSystemMessage(`${name}加入了队伍。`);
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
    else if(key===20){ctx?.chat?.addSystemMessage(`我轻轻抚摸 ${name}。`);ctx?.ui?.notify(`爱抚${name}`, "info");_panelMode=false;}
    else if(key===21){ctx?.chat?.addSystemMessage(`我吻向 ${name}。`);ctx?.ui?.notify(`亲吻${name}`, "info");_panelMode=false;}
    else if(key===22){ctx?.chat?.addSystemMessage(`我进入 ${name} 的身体。`);ctx?.ui?.notify(`进入${name}`, "info");_panelMode=false;}
    else if(key===23){ctx?.chat?.addSystemMessage(`我变换了体位。`);ctx?.ui?.notify("变换体位", "info");_panelMode=false;}
    else if(key===24){ctx?.chat?.addSystemMessage(`我对 ${name} 说着挑逗的话。`);ctx?.ui?.notify(`挑逗${name}`, "info");_panelMode=false;}
    else if(key===25){
      // ⑥状态 → 展开自身 sex-detail
      ctx?.chat?.addSystemMessage(`我看了看 ${name} 的状态。`);
      ctx?.ui?.notify(`查看${name}性状态`, "info");
      _panelMode=false;
    }
    else if(key===26){gs.mode=gs._prevMode||"gal";gs._prevMode=undefined;require("./engine/state.ts").saveState();ctx?.chat?.addSystemMessage(`我和 ${name} 结束了亲密。`);ctx?.ui?.notify("结束亲密", "info");_panelMode=false;}
    else if(key===7){
      // ⑧暗示 — 需心理或话术技能
      const hasPsych = (gs?.player?.skills?.心理 || gs?.player?.skills?.话术 || 0) >= 1;
      if(!hasPsych){ctx?.ui?.notify("需要心理或话术技能Lv1+", "warning");return;}
      ctx?.chat?.addSystemMessage(`我对 ${name} 发出了微妙的暗示。`);
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
      ctx?.chat?.addSystemMessage(ok?`${name}红着脸点了点头…`:``);
      _panelMode=false;
    }
    // 技能交互
    else if(key===30){ctx?.chat?.addSystemMessage(`我对 ${name} 进行伤势检查与包扎治疗。`);ctx?.ui?.notify(`医疗${name}`, "info");_panelMode=false;}
    else if(key===31){ctx?.chat?.addSystemMessage(`我施展话术，试图说服 ${name}。`);ctx?.ui?.notify(`说服${name}`, "info");_panelMode=false;}
    else if(key===32){ctx?.chat?.addSystemMessage(`我凝视着 ${name} 的眼睛，尝试施加暗示…`);ctx?.ui?.notify(`暗示${name}`, "info");_panelMode=false;}
  }

  function _doTouch(gs:any,name:string){
    const ctx=getCtx();
    const aff=getNpcAffection(gs,name);const{updateRelation,saveState}=require("./engine/state.ts");
    const levels=[{n:"握手",min:0,rw:2,pen:2},{n:"摸头",min:30,rw:2,pen:5},{n:"拥抱",min:50,rw:3,pen:10},{n:"按摩",min:60,rw:3,pen:10,needL1:true},{n:"亲吻",min:70,rw:5,pen:15}];
    for(let i=levels.length-1;i>=0;i--){
      const l=levels[i]!;if(aff>=l.min&&(!l.needL1||gs.layer1Enabled)){
        const ok=Math.random()>0.2;const msg=ok?`我与${name}${l.n}。✓ 好感+${l.rw}`:`${name}拒绝了${l.n}。✗ 好感-${l.pen}`;
        if(ok){updateRelation(gs.player.relationships,name,l.rw,l.n);ctx?.ui?.notify(`${l.n}${name} ✓ +${l.rw}`, "info");}
        else{updateRelation(gs.player.relationships,name,-l.pen,`${l.n}被拒`);ctx?.ui?.notify(`${name}拒绝${l.n} -${l.pen}`, "warning");}
        saveState();ctx?.chat?.addSystemMessage(msg);_panelMode=false;return;
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
    ctx?.chat?.addSystemMessage(ok?`我约 ${name} 周末出去玩。${name}：「好啊。」好感+5`:`约 ${name} 出去玩，但${name}说有事。好感-5`);
  }

  const widget = {
    render(w: number): string[] {
      try {
        const W = Math.max(20, w - 2);
        const tr = (s: string) => {
          let ww=0,res="",ii=0;
          while(ii<s.length){
            const ch=s[ii]!;
            const cw=ch.charCodeAt(0)>0x7f?2:1;
            if(ww+cw>W){res+="…";break;}
            res+=ch;
            ww+=cw;
            ii++;
          }
          return res;
        };
        /** 进度条: bar(45,100,8) → "[====----] 45/100" */
        const bar = (val: number, max: number, w: number = 8): string => {
          const pct = Math.max(0, Math.min(1, val / max));
          const n = Math.round(pct * w);
          return "[" + "=".repeat(n) + "-".repeat(w - n) + `] ${val}/${max}`;
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

        // 收集焦点项并生成 Tab 栏
        _focusItems = [];
        const TABS = ["[自身]","[周边]","[房间]","[行动]"];
        const hline = "─".repeat(Math.min(W, 80));
        out.push(tr(hline));
        const tabBar = TABS.map((lb,i) => (i===_tab?`▶${lb}◀`:` ${lb} `)).join(" │ ");
        out.push(tr(tabBar));
        out.push(tr(hline));

        // ── 自身 Tab 渲染 ──
        if (_tab === 0) {
          const eq = p.equipment || {};
          const EQUIP_SLOTS = [
            { id: "top", label: "外套" }, { id: "shirt", label: "内搭" }, { id: "inner_top", label: "胸罩" },
            { id: "bottom", label: "下装" }, { id: "inner_bot", label: "内裤" }, { id: "legs", label: "袜" },
            { id: "feet", label: "鞋" }, { id: "head", label: "头饰" },
            { id: "acc", label: "配饰" }, { id: "acc2", label: "配饰②" }, { id: "acc3", label: "配饰③" },
            { id: "right_hand", label: "主手" }, { id: "left_hand", label: "副手" }, { id: "back", label: "背" },
          ];
          // 收集焦点项
          for (const s of EQUIP_SLOTS) { _focusItems.push({ type: "slot", slotId: s.id, label: s.label, item: eq[s.id] }); }
          const eqEnd = EQUIP_SLOTS.length; // 14
          _focusItems.push({ type: "body" });
          _focusItems.push({ type: "skills" });
          const inv = p.inventory || [];
          for (let i = 0; i < inv.length; i++) { _focusItems.push({ type: "bag", item: inv[i], index: i }); }
          const bagStart = eqEnd + 2; // 14 slots + body + skills
          if (p.vehicle) { _focusItems.push({ type: "vehicle", vehicle: p.vehicle }); }
          const vehIdx = _focusItems.findIndex(f => f.type === "vehicle");
          _focusItems.push({ type: "party" });
          _focusItems.push({ type: "reputation" });
          _focusItems.push({ type: "titles" });

          // 子菜单渲染
          if (_submenu === "item-detail" && _selectedTarget) {
            const it = _selectedTarget.item || _selectedTarget;
            out.push(tr(`o ${it.name || "物品"}`));
            out.push(tr(`  类型: ${it.type || "装备"} · ${it.weight_kg ?? 0}kg · ${it.volume_l ?? 0}L`));
            if (it.damage) out.push(tr(`  伤害骰: ${it.damage}`));
            if (it.description) out.push(tr(`  描述: "${it.description}"`));
            out.push(tr(`  ─ 操作 ─`));
            out.push(tr(`${_subCursor === 0 ? "▶" : " "} ① 卸下放回背包`));
            out.push(tr(`${_subCursor === 1 ? "▶" : " "} ② 丢弃`));
          } else if (_submenu === "vehicle-detail" && _selectedTarget) {
            const v = _selectedTarget;
            out.push(tr(`🚲 ${v.name || "载具"}`));
            out.push(tr(`  速度倍率 ×${v.speedMul || 1.5} · 状态良好`));
            out.push(tr(`  ─ 操作 ─`));
            out.push(tr(`${_subCursor === 0 ? "▶" : " "} ① 设为当前骑行载具`));
            out.push(tr(`${_subCursor === 1 ? "▶" : " "} ② 检查状况`));
          } else if (_submenu === "body-detail") {
            const b = p.body || {};
            out.push(tr(`── 身体详情 ──`));
            out.push(tr(`  身高 ${b.height_cm || "?"}cm · 体重 ${b.weight_kg || "?"}kg · 体型 ${b.build || "?"}`));
            if (b.cup) out.push(tr(`  罩杯 ${b.cup}-cup`));
            if (b.measurements) out.push(tr(`  三围 ${b.measurements.bust||"?"}-${b.measurements.waist||"?"}-${b.measurements.hips||"?"}`));
            if (b.leg_type) out.push(tr(`  腿型 ${b.leg_type}`));
            if (b.skin) out.push(tr(`  肤色 ${b.skin.base_tone || "?"} · 日晒 ${b.skin.tan || 0}`));
            if (b.plastic_surgery?.length) out.push(tr(`  整形: ${b.plastic_surgery.join(", ")}`));
          } else if (_submenu === "skills-detail") {
            const sk = p.skills || {};
            const names = Object.keys(sk);
            out.push(tr(`── 技能详情 ──`));
            if (!names.length) { out.push(tr(`  （无）`)); }
            else { for (const n of names) { const s = sk[n]; const lv = s?.level ?? s ?? 0; const exp = s?.exp ?? 0; const next = s?.nextLevel ?? (lv * 10); out.push(tr(`  ${n} Lv.${lv} (${exp}/${next})`)); } }
          } else if (_submenu === "party-detail") {
            const pty = p.party || [];
            out.push(tr(`── 队伍详情 ──`));
            if (!pty.length) { out.push(tr(`  （无队友）`)); }
            else { for (const nm of pty) { const rel = p.relationships?.[nm]; const npc = gs?.npcs?.[nm]; const aff = rel?.affection ?? 0; const rl = rel?.romance || rel?.stage || ""; const hpc = npc?.hp?.current ?? "?"; const hpm = npc?.hp?.max ?? "?"; out.push(tr(`  👤 ${nm}  💕${aff} ${rl}  ❤${hpc}/${hpm}`)); } }
          } else if (_submenu === "reputation-detail") {
            const rep = p.reputation || {};
            const keys = Object.keys(rep);
            out.push(tr(`── 声望详情 ──`));
            if (!keys.length) { out.push(tr(`  （暂无声望）`)); }
            else { for (const k of keys) { const v = rep[k] ?? 0; out.push(tr(`  ${k}: ${v >= 0 ? "+" : ""}${v}`)); } }
          } else if (_submenu === "titles-detail") {
            const tt = p.titles || [];
            out.push(tr(`── 称号详情 ──`));
            if (!tt.length) { out.push(tr(`  （暂无称号）`)); }
            else { for (const t of tt) { out.push(tr(`  🏅 ${t}`)); } }
          } else if (_submenu === "sex-detail" && mode === "sex") {
            // Sex 详情（对标旧版 /sex 面板）
            const sx = p.sex;
            if (sx) {
              const prof = sx.profile || {};
              out.push(tr(`[ SEX ]`));
              out.push(tr(`  🔥 兴奋 ${bar(sx.arousal||0, 100, 10)}  💓 欲望 ${bar(sx.desire||0, 100, 10)}`));
              out.push(tr(`  📅 周期 第${sx.cycleDay||0}天 · ${sx.cyclePhase||"?"}  高潮阈值 ${prof.climaxThreshold||70}`));
              out.push(tr(`  💫 高潮 ${sx.climaxCount||0}次 · 潮吹 ${sx.squirtCount||0}次`));
              // 避孕 + 受孕率
              const baseRates: Record<string,number> = { "排卵期":0.35, "安全期":0.01, "生理期":0 };
              const rate = baseRates[sx.cyclePhase] ?? 0.01;
              const contra = sx.contraceptionUsed || "none";
              const contraLabel = contra === "pill" ? "避孕药" : contra === "condom" ? "避孕套" : "无";
              const risk = contra === "pill" ? 0.01*rate : contra === "condom" ? 0.02*rate : rate;
              out.push(tr(`  💊 避孕: ${contraLabel} → 受孕率 ${(risk*100).toFixed(1)}%`));
              // 初体验
              if (sx.milestones) {
                const m = sx.milestones;
                const ml: string[] = [];
                if (m.firstKiss?.given) ml.push(`初吻: ${m.firstKiss.partner} (${m.firstKiss.date})`);
                if (!m.virginity?.isVirgin) ml.push(`初夜: ${m.virginity.lostTo} (${m.virginity.lostAt})`);
                if (!m.analVirginity?.isVirgin) ml.push(`菊初: ${m.analVirginity.lostTo} (${m.analVirginity.lostAt})`);
                if (ml.length) out.push(tr(`  💝 ${ml.join(" | ")}`));
              }
              out.push(tr(`  态度: ${prof.attitude||"?"} · 经验: ${prof.experience||"?"}`));
              // 可用动作/体位
              try {
                const { getAvailableActions } = require("./engine/sex.ts");
                const avail = getAvailableActions(prof, sx);
                if (avail.actions?.length) out.push(tr(`  可用动作: ${avail.actions.join("、")}`));
                if (avail.positions?.length) out.push(tr(`  可用体位: ${avail.positions.join("、")}`));
              } catch {}
              // 心里话
              if (sx.thoughts?.length) {
                out.push(tr(`  ── 心里话 ──`));
                sx.thoughts.slice(-3).forEach((t: any) => out.push(tr(`  「${t.text}」`)));
              }
            } else { out.push(tr(`  （无 SexState）`)); }
          } else {
            // ── 默认自身面板 ──
            const attrs = p.attributes || {};
            const wep = ((p?.equipment?.right_hand || p?.equipment?.left_hand) as any);
            const wp = wep?.damage ? `🗡 ${wep.name} ${wep.damage}` : `空手 1d2`;

            // HP 行（带进度条）
            out.push(tr(`  ❤ ${bar(hp, hpM, 8)} · AC${ac} · ${wp}`));
            out.push(tr(`  力${attrs.力量??8} 敏${attrs.敏捷??10} 体${attrs.体质??9} 智${attrs.智力??12} 感${attrs.感知??10} 魅${attrs.魅力??10}`));
            if(mode==="sex"){
              try {
                const sx=p.sex;
                if(sx) out.push(tr(`  🔥${bar(sx.arousal||0, 100, 8)}  💓${bar(sx.desire||0, 100, 8)}`));
              } catch {}
            }

            // 身体行（Sex 模式摘要，可 Enter 展开详情）
            if (mode === "sex") {
              const sx = p.sex;
              const summary = sx ? `${sx.cyclePhase||"?"} · 高潮${sx.climaxCount||0}次` : "未激活";
              const selB = _panelMode && _cursor === eqEnd ? "▶" : " ";
              out.push(tr(`${selB} ── Sex ──`));
              out.push(tr(`    ${summary}`));
            } else {
              const b = p.body || {};
              const bodySum = [b.height_cm ? `${b.height_cm}cm` : "", b.weight_kg ? `${b.weight_kg}kg` : "", b.build || ""].filter(Boolean).join(" · ") || "?";
              const selB = _panelMode && _cursor === eqEnd ? "▶" : " ";
              out.push(tr(`${selB} ── 身体 ──`));
              out.push(tr(`    ${bodySum}`));
            }

            // 装备（一行一槽竖列）
            out.push(tr(`  ── 装备 ──`));
            for (let i = 0; i < EQUIP_SLOTS.length; i++) {
              const s = EQUIP_SLOTS[i]!;
              const item = eq[s.id];
              const sel = _panelMode && _cursor === i ? "▶" : " ";
              const display = item ? (item.name || item).slice(0, 22) : "—";
              out.push(tr(`    ${sel} ${s.label} [${display}]`));
            }

            // 技能
            const sk = p.skills || {};
            const skNames = Object.keys(sk).filter(k => (sk[k]?.level ?? sk[k] ?? 0) > 0);
            const skSum = skNames.length ? skNames.map(k => `${k}Lv${sk[k]?.level ?? sk[k]}`).join(" · ") : "（无）";
            const selSk = _panelMode && _cursor === eqEnd + 1 ? "▶" : " ";
            out.push(tr(`${selSk} ── 技能 ──`));
            out.push(tr(`    ${skSum}`));

            // 背包
            out.push(tr(`  🎒 背包 ${inv.length}件:`));
            if (inv.length) {
              for (let i = 0; i < Math.min(inv.length, 5); i++) {
                const idx = i + bagStart;
                const sel = _panelMode && _cursor === idx ? "▶" : " ";
                out.push(tr(`    ${sel} ${String.fromCodePoint(0x2460 + i)} ${inv[i].name}`));
              }
            } else { out.push(tr(`    （空）`)); }

            // 载具
            if (p.vehicle) {
              const selV = _panelMode && vehIdx >= 0 && _cursor === vehIdx ? "▶" : " ";
              out.push(tr(`  ${selV} ── 驾驶 ──`));
              out.push(tr(`    🚲 ${p.vehicle.name} ×${p.vehicle.speedMul || 1.5}`));
            }

            // 队伍
            const pty = p.party || [];
            const ptyIdx = _focusItems.findIndex(f => f.type === "party");
            const selPty = _panelMode && _cursor === ptyIdx ? "▶" : " ";
            out.push(tr(`${selPty} ── 队伍 ──`));
            out.push(tr(`    ${pty.length ? pty.map(n => "👤" + n).join(" · ") : "（无队友）"}`));

            // 声望
            const rep = p.reputation || {};
            const repKeys = Object.keys(rep);
            const repIdx = _focusItems.findIndex(f => f.type === "reputation");
            const selRep = _panelMode && _cursor === repIdx ? "▶" : " ";
            out.push(tr(`${selRep} ── 声望 ──`));
            out.push(tr(`    ${repKeys.length ? repKeys.slice(0,4).map(k => `${k}:${rep[k]>=0?"+":""}${rep[k]}`).join(" · ") : "（暂无）"}`));

            // 称号
            const tt = p.titles || [];
            const ttIdx = _focusItems.findIndex(f => f.type === "titles");
            const selTt = _panelMode && _cursor === ttIdx ? "▶" : " ";
            out.push(tr(`${selTt} ── 称号 ──`));
            out.push(tr(`    ${tt.length ? tt.map(t => `「${t}」`).join(" · ") : "（暂无）"}`));

            // 底栏
            const dateStr = t?.game_date ? `${t.day_of_week||""}曜日 · ${t.game_date}` : "";
            out.push(tr(`  ────────────────`));
            if (dateStr) out.push(tr(`  |-[${dateStr}]`));
            out.push(tr(`  ¥${p.funds ?? 0} · 💤${p.fatigue ?? 0} · ${(p.weight ?? 0).toFixed(1)}kg/12L`));
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
            out.push(tr(`▶ ${n.name} ◀  ${n.height}cm · ${n.posDesc} · 隔${n.dist}m`));
            out.push(tr(`    ${statusLabel} · 💕${n.affection}/100 · 携带: ${[n.rh, n.lh].filter(Boolean).join("·") || "—"}`));
            if (n.lastWords) out.push(tr(`    "${n.lastWords}"`));

            out.push(tr(`  ── 快捷操作 ──`));
            const npcActions = _buildNpcActions(gs, n.name);
            out.push(tr(`    ` + npcActions.map((ac, idx) => _subCursor === idx ? `▶${ac.label}◀` : ` ${ac.label} `).join(" ")));
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
              const bagItems = (npc?.inventory || []).slice(0, 5).map((x: any) => x?.name || x).join("·") || "—";
              out.push(tr(`  ─ 携带 ─`));
              out.push(tr(`  现金 ¥${cash} · 右:${rh} 左:${lh}`));
              out.push(tr(`  背包: ${bagItems}`));
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
          // 默认展示周边列表
          else {
            for (let i = 0; i < Math.min(_peopleCache.length, 8); i++) {
              const n = _peopleCache[i]!;
              const sel = _panelMode && i === _cursor ? "▶" : " ";
              if (n.type === "named") {
                const a = n.affection;
                const statusLabel = getNPCStatusLabel(gs, n.name);
                out.push(tr(`${sel} ${n.name}  ${n.height}cm · ${n.posDesc} · 隔${n.dist}m`));
                out.push(tr(`    ${statusLabel} · 💕${a}/100`));
                if (n.lastWords) out.push(tr(`    "${n.lastWords}"`));
              } else {
                out.push(tr(`${sel} ${n.name}  ×${n.clusterSize||1} · ${n.height} · ${n.posDesc}`));
                if (n.action) out.push(tr(`    ${n.action.slice(0, 35)}`));
              }
            }
          }
        }

        // ── 房间 Tab 渲染 ──
        else if (_tab === 2) {
          // 家具详情子面板
          if (_submenu === "furniture-detail" && _selectedTarget) {
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
                out.push(tr(`  ── 容器 ──`));
                const offset = ftActions.length;
                for (let i = 0; i < furnContainers.length; i++) {
                  const fc = furnContainers[i];
                  const locked = !!(fc.def?.locked);
                  const itemList = (fc.items || []).map((x: any) => x.name).join("·") || "空";
                  const subName = (fc.ownerId && fc.ownerId.includes("·")) ? fc.ownerId.split("·")[1] : "储物";
                  out.push(tr(`  ${_subCursor === offset + i ? "▶" : " "} ${String.fromCodePoint(0x2460+offset+i)} ${locked?"🔒":"📂"} ${subName} ${itemList}`));
                }
                (_selectedTarget as any)._furnContainers = furnContainers;
              }
            } catch {}
          }
          else if (!rm) {
            out.push(tr(`  （无房间数据）`));
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

            out.push(tr(`  📏 ${rm.width||"?"}m×${rm.height||"?"}m · 你在(${p.gridPos?.[0]??"?"},${p.gridPos?.[1]??"?"}) · ${(rm.atmosphere||"普通").slice(0, 25)}`));
            out.push(tr(`  ── 家具 ──`));
            let fCount = 0;
            for (let i = 0; i < _focusItems.length; i++) {
              const item = _focusItems[i];
              const sel = _panelMode && i === _cursor ? "▶" : " ";
              if (item.type === "furniture") {
                const sub = (item.label && item.label.trim()) ? ` · ${item.label.trim()}` : "";
                const acts = furnitureActions(item.name);
                out.push(tr(`    ${sel} 📦 ${item.name}(${item.x},${item.y})${sub}  ${acts}`));
                fCount++;
              }
            }
            if (!fCount) out.push(tr(`    （空）`));

            out.push(tr(`  ── 出口 ──`));
            let eCount = 0;
            for (let i = 0; i < _focusItems.length; i++) {
              const item = _focusItems[i];
              const sel = _panelMode && i === _cursor ? "▶" : " ";
              if (item.type === "exit") {
                out.push(tr(`    ${sel} 🚪 → ${item.exitTo}(${item.x},${item.y})`));
                eCount++;
              }
            }
            if (!eCount) out.push(tr(`    （无）`));
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
            if (!_choicesCache.length) { out.push(tr(`  输入文字推进剧情后，选项自动出现`)); }
            else {
              for (let i = 0; i < Math.min(_choicesCache.length, 6); i++) {
                const idx = String.fromCodePoint(0x2460 + i);
                const tag = _choiceTags[i] || "";
                const sel = _panelMode && i === _cursor ? "▶" : " ";
                out.push(tr(`${sel} ${idx} "${_choicesCache[i]}"${tag ? ` [${tag}]` : ""}`));
              }
            }
          }
          // 默认选项列表
          else {
            for (let i = 0; i < _choicesCache.length; i++) {
              _focusItems.push({ type: "choice", text: _choicesCache[i], tag: _choiceTags[i], index: i });
            }
            if (!_choicesCache.length) {
              out.push(tr(`  输入文字推进剧情后，选项自动出现`));
            } else {
              for (let i = 0; i < Math.min(_choicesCache.length, 6); i++) {
                const idx = String.fromCodePoint(0x2460 + i);
                const tag = _choiceTags[i] || "";
                const sel = _panelMode && i === _cursor ? "▶" : " ";
                out.push(tr(`${sel} ${idx} "${_choicesCache[i]}"${tag ? ` [${tag}]` : ""}`));
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
          } else if (_submenu === "item-detail" || _submenu === "vehicle-detail" || _submenu === "furniture-detail") {
            tip = "↑ ↓ 选操作 · Enter确认 · Esc返回";
          } else {
            tip = _tab === 1 ? "← → 切Tab  ↑ ↓ 移光标 · Enter展开 · Esc返回" : "← → 切Tab  ↑ ↓ 选项目 · Enter操作 · Esc返回";
          }
        } else {
          tip = "双击 Enter 进面板";
        }
        out.push(tr(tip));
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

        // 如果是子菜单内部输入，单独消费
        if (_panelMode && _submenu) {
          // ESC/q 返回上一级
          if (d === "\x1b" || d === "q") {
            if (_submenu === "npc-talk" || _submenu === "npc-touch" || _submenu === "npc-observe" || _submenu === "npc-combat" || _submenu === "npc-steal" || _submenu === "npc-romance") {
              _submenu = "npc-detail";
              _subCursor = 0;
            } else if (_submenu === "npc-detail") {
              _submenu = null;
              _subCursor = 0;
            } else if (_submenu === "item-detail" || _submenu === "vehicle-detail" || _submenu === "furniture-detail" ||
                       _submenu === "body-detail" || _submenu === "skills-detail" || _submenu === "party-detail" ||
                       _submenu === "reputation-detail" || _submenu === "titles-detail" || _submenu === "sex-detail") {
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
                ctx?.chat?.addSystemMessage(`我找 ${_selectedTarget.name} ${topic}。`);
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
                  _doTouch(gs, _selectedTarget.name);
                  _submenu = null;
                  _panelMode = false;
                }
              }
              return true;
            }
            return false;
          }

          // 观察/身体/技能/队伍/声望/称号/Sex 子面板（只读，仅 Esc 退出）
          if (_submenu === "npc-observe" || _submenu === "body-detail" || _submenu === "skills-detail" ||
              _submenu === "party-detail" || _submenu === "reputation-detail" || _submenu === "titles-detail" ||
              _submenu === "sex-detail" || _submenu === "settlement-detail") {
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
                  ctx?.chat?.addSystemMessage(`我向 ${n} 告白了。${n}沉默了很久，然后轻轻点了点头。「……我也。」好感+10，成为恋人！`);
                  ctx?.ui?.notify(`${n}接受了告白！`, "info");
                } else {
                  rel.affection = Math.max(0, (rel.affection || 0) - 10);
                  ctx?.chat?.addSystemMessage(`我向 ${n} 告白了。${n}低下了头。「……对不起。」好感-10。`);
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
                ctx?.chat?.addSystemMessage(`我对 ${n} 抱拳行礼：「请赐教。」${n}摆出了架势。切磋开始！`);
                ctx?.ui?.notify(`⚔ 与${n}切磋武艺`, "info");
              } else if (idx === 1) {
                // 死斗
                const rel = gs.player.relationships[n] || (gs.player.relationships[n] = { stage: "熟人", affection: 0, history: [], notes: "" });
                rel.affection = Math.max(0, (rel.affection || 0) - 50);
                rel.stage = "死敌";
                gs.mode = "rpg";
                ctx?.chat?.addSystemMessage(`我向 ${n} 发起了死斗！一场你死我活的战斗即将展开……`);
                ctx?.ui?.notify(`💀 向${n}发起死斗`, "warning");
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
                  ctx?.chat?.addSystemMessage(result.narrative);
                  ctx?.ui?.notify(result.caught ? `偷钱被${_selectedTarget.name}抓住！` : result.success ? "顺到了钱" : "没摸到钱包", result.caught ? "warning" : "info");
                } else {
                  const result = st.stealItem(gs.player, _selectedTarget.name, si.key);
                  st.saveState();
                  ctx?.chat?.addSystemMessage(result.narrative);
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
                const rm2 = s2.getRoom(p.location);
                if (idx < ftActions.length) {
                  // 执行家具动作（async 用 void 触发，handleInput 是同步的）
                  const action = ftActions[idx];
                  void interactFurniture(
                    _selectedTarget.name, action, gs,
                    gs.player.gridPos, rm2?.cells || null
                  ).then((result: any) => {
                    s2.saveState();
                    ctx?.ui?.notify(result.message || `已${action}${_selectedTarget.name}`, "info");
                    ctx?.chat?.addSystemMessage(result.narrative || result.message);
                  }).catch((e: any) => {
                    console.error("[furniture] 动作失败:", e?.message || e);
                    ctx?.ui?.notify("操作失败", "error");
                  });
                } else {
                  // 容器操作
                  const cIdx = idx - ftActions.length;
                  const container = ftContainers[cIdx];
                  if (!container) return false;
                  if (container.def?.locked) {
                    ctx?.ui?.notify("容器已锁", "warning");
                    return true;
                  }
                  // 简单取物：列出物品 → 选一个取
                  if (!container.items?.length) {
                    ctx?.ui?.notify("容器是空的", "info");
                    return true;
                  }
                  // 取第一件物品（简化：以后可以加子菜单选）
                  const item = container.items[0];
                  const transferFn = s2.transferBetweenContainers;
                  if (transferFn) {
                    const r = transferFn(container.id, "backpack", item.name);
                    s2.saveState();
                    ctx?.ui?.notify(r, "info");
                  }
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

          // 物品详情控制
          if (_submenu === "item-detail") {
            if (d === "\x1b[A" || d === "\x1bOA" || d === "\x1b[B" || d === "\x1bOB") {
              _subCursor = _subCursor === 0 ? 1 : 0;
              return true;
            }
            if (d === "\r" || d === "\n" || d === "1" || d === "2") {
              const option = (d === "\r" || d === "\n") ? _subCursor : parseInt(d) - 1;
              const ctx = getCtx();
              if (option === 0) {
                // 卸下放回背包
                if (_selectedTarget.slotId) {
                  const itemName = _selectedTarget.item?.name || _selectedTarget.item;
                  ctx?.chat?.addSystemMessage(`卸下 ${itemName}`);
                  ctx?.ui?.notify(`已卸下 ${itemName}`, "info");
                }
              } else {
                // 丢弃物品
                const itemName = _selectedTarget.item?.name || _selectedTarget.item?.name || "物品";
                ctx?.chat?.addSystemMessage(`丢弃 ${itemName}`);
                ctx?.ui?.notify(`已丢弃 ${itemName}`, "warning");
              }
              _submenu = null;
              _panelMode = false;
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
              if (option === 0) {
                ctx?.chat?.addSystemMessage(`我骑上载具 ${_selectedTarget.name}。`);
                ctx?.ui?.notify(`骑上${_selectedTarget.name}`, "info");
              } else {
                ctx?.chat?.addSystemMessage(`检查 ${_selectedTarget.name} 车况。`);
                ctx?.ui?.notify(`检查${_selectedTarget.name}车况：良好`, "info");
              }
              _submenu = null;
              _panelMode = false;
              return true;
            }
            return false;
          }

          return false;
        }

        // 未开启面板时：双击 Enter 进面板，←→↑↓ 和字母键全部放行给聊天输入栏
        if (!_panelMode) {
          // 行动 Tab 有结算卡片 + 单次 Enter → 查看详情
          if (_tab === 3 && (gs as any)._pendingSettlement && (d === "\r" || d === "\n")) {
            _submenu = "settlement-detail";
            _selectedTarget = (gs as any)._pendingSettlement;
            _subCursor = 0;
            _panelMode = true;
            return true;
          }
          // 双击 Enter（600ms 内两次）→ 进入面板模式
          if (d === "\r" || d === "\n") {
            const now = Date.now();
            if (now - _lastEnterTime < 600 && _lastEnterTime > 0) {
              // 双击！进入面板
              _lastEnterTime = 0;
              if (_tab === 1 && !_peopleCache.length) return false;
              if (_tab === 3 && !_choicesCache.length && !(gs as any)._pendingSettlement) return false;
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

        // 面板激活中：ESC 退出
        if (d === "\x1b" || d === "q") {
          _panelMode = false;
          _cursor = 0;
          // 如果不在子菜单中，退出面板同时清子菜单
          if (!_submenu || _submenu === "npc-detail") { _submenu = null; }
          return true;
        }

        // 面板激活中：← → 切 Tab（不在子菜单中时）
        if (!_submenu && (d === "\x1b[C" || d === "\x1bOC" || d === "\x1b[D" || d === "\x1bOD")) {
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
            ctx?.chat?.addSystemMessage(currentItem.text);
            ctx?.ui?.notify(`选择: ${currentItem.text.slice(0, 20)}`, "info");
            delete (gs as any)._pendingSettlement;
            _panelMode = false;
            return true;
          }

          // 2.5 自身面板专用项（body/skills/party/reputation/titles）
          if (currentItem.type === "body") {
            _submenu = (gs.mode === "sex") ? "sex-detail" : "body-detail";
            _subCursor = 0;
            return true;
          }
          if (currentItem.type === "skills") { _submenu = "skills-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "party") { _submenu = "party-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "reputation") { _submenu = "reputation-detail"; _subCursor = 0; return true; }
          if (currentItem.type === "titles") { _submenu = "titles-detail"; _subCursor = 0; return true; }

          // 3. 装备槽或背包项
          if (currentItem.type === "slot" || currentItem.type === "bag") {
            if (currentItem.item) {
              _selectedTarget = currentItem;
              _submenu = "item-detail";
              _subCursor = 0;
            } else {
              // 空装备槽直接提示
              ctx?.ui?.notify(`空装备槽：你可以去背包选中防具或武器穿戴。`, "info");
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
          if (currentItem.type === "exit") {
            // 实际移动：调用引擎 setPlayerLocation
            try {
              const st = require("./engine/state.ts");
              const dest = currentItem.exitTo;
              if (dest && st.setPlayerLocation) {
                st.setPlayerLocation(dest, gs);
                st.saveState();
                ctx?.chat?.addSystemMessage(`我走向 ${dest}。`);
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

  sessionCtx.ui.setWidget("game-hud", () => widget, { placement: "aboveEditor" });
}

