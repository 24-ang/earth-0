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

function initGamePanel(pi: any, ctx: any) {
  let _tab = 0;
  let _cursor = 0;
  let _panelMode = false;
  let _choicesCache: string[] = [];
  let _choiceTags: string[] = [];
  let _peopleCache: any[] = [];
  let _lastProseHash = "";

  const posLabel = (gp: any, rm: any): string => {
    if (!gp || !rm) return "";
    if (!Array.isArray(gp)) { console.warn("[game-hud] non-array gridPos", typeof gp, gp); }
    const [x,y] = Array.isArray(gp) ? gp : [0,0];
    let lbl = ""; const w=rm.width||10, h=rm.height||6;
    if (y===0) lbl="靠墙"; else if (y===h-1) lbl="靠后墙";
    if (x===0) lbl+="靠左"; else if (x===w-1) lbl+="靠右";
    if (!lbl) lbl="中间";
    const c=rm.cells?.[y]?.[x];
    if (c?.label && c.label.trim() && c.label.trim()!=="  ") lbl=c.label.trim();
    return lbl;
  };

  const npcQuickActions = (gs: any, name: string): string => {
    const aff = getNpcAffection(gs, name); const lover = isNpcLover(gs, name);
    const pty: string[] = gs?.player?.party || [];
    const inParty = pty.includes(name);
    const parts: string[] = ["快捷:"];
    parts.push("①搭话");
    parts.push(aff>=10 ? "②接触" : "②接触(需好感≥10)");
    parts.push("③观察");
    parts.push(aff>=40||lover ? (inParty?"④离队":"④组队") : "④组队(需≥40)");
    if(aff>=50||lover) parts.push(aff>=50 ? "⑤恋爱" : "⑤恋爱(需≥50)");
    if(lover&&aff>=80) parts.push("⑨亲密");
    return parts.join("  ");
  };

  ctx.ui.setWidget("game-hud", (tui: any, _theme: any) => {
    const vw = typeof tui?.visibleWidth === "function" ? tui.visibleWidth() : 48;
    const W = Math.max(20, vw - 2);
    const tr = (s: string) => { let w=0,res="",i=0;while(i<s.length){const c=s[i]!;const cw=c.charCodeAt(0)>0x7f?2:1;if(w+cw>W){res+="…";break;}res+=c;w+=cw;i++;}return res; };
    const TABS = ["[自身]","[周边]","[房间]","[行动]"];

    return {
      render(_w: number): string[] {
        try {
          const s = require("./engine/state.ts"); const gs = s.gameState; const p = gs?.player; if (!p) return [];
          const out: string[] = [];
          const loc = p.location||"???"; const t = gs.time; const mode = gs.mode||"rpg";
          const hp=p.hp?.current??10, hpM=p.hp?.max??15, ac=p.ac||10;
          const weather=t?.weather||""; const wIcon=weather.includes("雨")?"🌧":weather.includes("雪")?"❄":"☀";
          const rm=s.getRoom(loc);
          const prose=(gs as any)._renderedProse||"";

          const ph=prose.length;const pk=ph+prose.slice(-30);
          if(pk!==_lastProseHash){_lastProseHash=pk;_choicesCache=[];_choiceTags=[];
            if(prose){try{const{parseRoleOptions}=require("./engine/parse-options.ts");const r=parseRoleOptions(prose);for(const c of(r.options||[])){_choicesCache.push(c.text);_choiceTags.push(c.tag||"");}}catch{}}
          }

          const nearby=Object.entries(gs.npcs||{}).filter(([_,n]:any)=>n.alive!==false&&s.isSameLocation(n.currentRoom,loc));
          _peopleCache=nearby.map(([name,npc]:[string,any])=>{
            const rel=p.relationships?.[name];const body=npc.body||npc.body_by_age||{};
            return{name,type:"named",gp:npc.gridPos||npc.grid_pos||[0,0],
              height:body.height_cm||npc.height_cm||npc.height||"?",
              posDesc:posLabel(npc.gridPos||npc.grid_pos,rm),
              dist:npc.distance||npc.dist||2,
              affection:rel?.affection??0,stage:rel?.stage||"陌生",romance:rel?.romance||"",
              lh:npc.equipment?.left_hand?.name||npc.left_hand||"",
              rh:npc.equipment?.right_hand?.name||npc.right_hand||"",
              lastWords:(npc.lastWords||"").replace(/^\[.*?\]\s*/,""),action:npc.action||""};
          });
          try{const rc=s.getNamelessNPCs(loc,gs.turn)as any[];const sc=(gs as any)._testCrowd||[];
            for(const c of[...rc,...sc])_peopleCache.push({name:c.name||"???",type:"crowd",gp:c.gridPos||[0,0],height:c.height||"?",posDesc:posLabel(c.gridPos,rm),dist:"?",clusterSize:c.count||c.clusterSize||1,action:c.act||c.action||"",affection:0,stage:"",romance:"",lh:"",rh:"",lastWords:""});
          }catch{}

          // ═══ Tab 栏 ═══
          const hline = "─".repeat(Math.min(W, 80));
          out.push(tr(hline));
          const tabBar = TABS.map((lb,i) => (i===_tab?`▶${lb}◀`:` ${lb} `)).join(" │ ");
          out.push(tr(tabBar));
          out.push(tr(hline));

          // ═══ Tab 0: 自身 ═══
          if(_tab===0){
            const attrs=p.attributes||{};
            const w=((p?.equipment?.right_hand||p?.equipment?.left_hand) as any)?.damage;
            const wp=w?`🗡 ${(p.equipment.right_hand||p.equipment.left_hand).name} ${w}`:`空手 1d2`;
            out.push(tr(`  ❤ ${hp}/${hpM} · AC${ac} · ${wp} · ¥${p.funds??0} · 💤${p.fatigue??0}  ${wIcon}${weather}`));
            out.push(tr(`  力${attrs.力量??8}  敏${attrs.敏捷??10}  体${attrs.体质??9}  智${attrs.智力??12}  感${attrs.感知??10}  魅${attrs.魅力??10}`));
            if(mode==="sex"){try{const sx=p.sex;if(sx)out.push(tr(`  🔥兴奋${sx.fire||0}  💓欲望${sx.heart||0}  裸露:${sx.nudity||"—"}`));}catch(e:any){console.error("[game-hud] sex:",e.message);}}
            out.push(tr(`  装备:`));
            const eq=p.equipment||{};
            for(const [sk,lb] of [["top","上衣"],["bottom","下装"],["shoes","鞋子"],["right_hand","右手"],["left_hand","左手"]] as [string,string][]){
              const it=eq[sk]; out.push(tr(`    ${lb}: ${it?(it.name||it).slice(0,20):"— (穿戴)"}`));
            }
            const inv=p.inventory||[];
            out.push(tr(`  🎒 背包 ${inv.length}件:`));
            if(inv.length)out.push(tr(`    ${inv.slice(0,6).map((it:any,i:number)=>`${String.fromCodePoint(0x2460+i)}${it.name||it}`).join("  ")}${inv.length>6?" …":""}`));
            else out.push(tr(`    （空）`));
            if(p.vehicle)out.push(tr(`  🚲 载具: ${p.vehicle.name||""} ×${p.vehicle.speedMul||1.5} · 良好`));
          }

          // ═══ Tab 1: 周边 ═══
          else if(_tab===1){
            if(!_peopleCache.length){out.push(tr(`  （周边无人）`));}
            else {
              for(let i=0;i<Math.min(_peopleCache.length,8);i++){
                const n=_peopleCache[i]!;
                const sel = _panelMode && i===_cursor ? "▶" : " ";
                if(n.type==="named"){
                  const a=n.affection, st=n.stage, rom=n.romance;
                  const icon=rom==="恋人"?"♥":a>=40?"◆":a>=20?"◇":"·";
                  const held=n.rh||n.lh?`携带${[n.rh,n.lh].filter((x:string)=>x&&x!=="—").join("·")}`:"";
                  out.push(tr(`${sel} ${n.name}  ${n.height}cm · ${n.posDesc} · 隔${n.dist}m`));
                  out.push(tr(`    ${icon}${a}/100 ${st}${rom||""}  ${held}`));
                  out.push(tr(`    ${npcQuickActions(gs, n.name)}`));
                } else {
                  out.push(tr(`${sel} ${n.name}  ×${n.clusterSize||1} · ${n.height} · ${n.posDesc}`));
                  if(n.action)out.push(tr(`    ${n.action.slice(0,35)}`));
                }
              }
            }
          }

          // ═══ Tab 2: 房间 ═══
          else if(_tab===2){
            if(!rm)out.push(tr(`  （无房间数据）`));
            else{
              out.push(tr(`  📏 ${rm.width||"?"}m×${rm.height||"?"}m · 你在(${p.gridPos?.[0]??"?"},${p.gridPos?.[1]??"?"}) · ${(rm.atmosphere||"普通").slice(0,20)}`));
              out.push(tr(`  ── 家具 ──`));
              const cells=rm.cells||[]; let fc=0; const exits:string[]=[];
              for(let y=0;y<rm.height;y++)for(let x=0;x<rm.width;x++){const c=cells[y]?.[x];
                if(c?.furniture&&fc<10){const sub=(c.label&&c.label.trim()&&c.label.trim()!=="  ")?` · ${c.label.trim()}`:"";const acts=furnitureActions(c.furniture as string);out.push(tr(`    📦 ${c.furniture}(${x},${y})${sub}  ${acts}`));fc++;}
                if((c?.type==="exit"||c?.type==="door")&&c?.exitTo)exits.push(`${c.exitTo}(${x},${y})`);}
              if(!fc)out.push(tr(`    （空）`));
              out.push(tr(`  ── 出口 ──`));
              if(exits.length)for(const e of exits)out.push(tr(`    🚪 → ${e}`));
              else out.push(tr(`    （无）`));
            }
          }

          // ═══ Tab 3: 行动 ═══
          else {
            if(!_choicesCache.length){out.push(tr(`  输入文字推进剧情后，选项自动出现`));}
            else for(let i=0;i<Math.min(_choicesCache.length,6);i++){
              const idx=String.fromCodePoint(0x2460+i); const tag=_choiceTags[i]||"";
              const sel=_panelMode&&i===_cursor?"▶":" ";
              out.push(tr(`${sel} ${idx} "${_choicesCache[i]!}"${tag?` [${tag}]`:""}`));
            }
          }

          out.push(tr(hline));
          const tip=_panelMode
            ?(_tab===1?`↑↓选NPC  Enter=搭话  1-9=操作  Esc返回`
              :_tab===3?`↑↓选选项  Enter/数字=确认  Esc返回`
              :`Esc返回`)
            :`← → 切Tab  Enter 进入面板`;
          out.push(tr(tip));
          return out;
        }catch(e:any){console.error("[game-hud] render:",e.message||e);return[];}
      },

      handleInput(d:string,_fc?:any):boolean{
        try{
          const gs=require("./engine/state.ts").gameState;if(!gs?.player)return false;
          if(d==="\x1b[C]"||d==="\x1bOC"||d==="l"){_tab=(_tab+1)%4;_cursor=0;_panelMode=false;return true;}
          if(d==="\x1b[D]"||d==="\x1bOD"||d==="h"){_tab=(_tab+3)%4;_cursor=0;_panelMode=false;return true;}
          if(_panelMode){
            if(d==="\x1b"||d==="q"){_panelMode=false;return true;}
            if(d==="\x1b[A"||d==="\x1bOA"){_cursor=Math.max(0,_cursor-1);return true;}
            if(d==="\x1b[B"||d==="\x1bOB"){
              const max=_tab===1?Math.min(_peopleCache.length,8)-1
                :_tab===3?Math.max(0,Math.min(_choicesCache.length,6)-1):0;
              _cursor=Math.min(_cursor+1,Math.max(0,max));return true;
            }
            if(d==="\r"||d==="\n"||(d.length===1&&d>="1"&&d<="9")){
              const isEnter = d==="\r"||d==="\n";
              if(_tab===1){
                const cur = _peopleCache[Math.min(_cursor, _peopleCache.length-1)];
                if(!cur || cur.type!=="named"){
                  if(isEnter){ ctx.ui.notify("路人不能交互，请选择有名NPC","info"); }
                  return false;
                }
                const actionKey=isEnter?0:parseInt(d)-1;
                _handleNpcAction(gs,cur.name,actionKey,ctx);
              }else if(_tab===3){
                if(!_choicesCache.length){ ctx.ui.notify("暂无选项","info"); return false; }
                const n=isEnter?_cursor:parseInt(d)-1;
                const idx=Math.min(n,_choicesCache.length-1);
                ctx.chat.addSystemMessage(_choicesCache[idx]!);_panelMode=false;
              }else{
                // 自身/房间面板：光标浏览模式，无需操作
              }
              return _tab!==0&&_tab!==2; // 自身/房间不消费按键
            }
            return false;
          }
          if(d==="\r"||d==="\n"){_panelMode=true;return true;}
          return false;
        }catch(e:any){console.error("[game-hud] handleInput:",e.message||e);return false;}
      },
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

    function _handleNpcAction(gs:any,name:string,key:number,ctx:any){
      const aff=getNpcAffection(gs,name);const lover=isNpcLover(gs,name);
      const pty:string[]=gs?.player?.party||[];
      if(key===0){ctx.chat.addSystemMessage(`我找 ${name} 聊天。`);_panelMode=false;}
      else if(key===1){if(aff<10){ctx.ui.notify(`与${name}关系还不够熟`,"warning");return;}_doTouch(gs,name,ctx);}
      else if(key===2){ctx.chat.addSystemMessage(`我仔细观察 ${name}。`);_panelMode=false;}
      else if(key===3){if(aff<40&&!lover){ctx.ui.notify(`好感需≥40或恋人`,"warning");return;}if(pty.includes(name)){gs.player.party=pty.filter((n:string)=>n!==name);ctx.chat.addSystemMessage(`${name}离开了队伍。`);}else{gs.player.party=[...pty,name];ctx.chat.addSystemMessage(`${name}加入了队伍。`);}require("./engine/state.ts").saveState();_panelMode=false;}
      else if(key===4){if(aff<50){ctx.ui.notify("好感需≥50","warning");return;}_doDate(gs,name,ctx);_panelMode=false;}
      else if(key===8){if(!lover||aff<80){ctx.ui.notify("需恋人+好感≥80","warning");return;}const ok=Math.random()>0.2;if(ok){gs.mode="sex";gs.layer1Enabled=true;}else{const rel=gs.player.relationships[name];if(rel)rel.affection=Math.max(0,(rel.affection||0)-15);}require("./engine/state.ts").saveState();ctx.chat.addSystemMessage(ok?`${name}红着脸点了点头…`:``);_panelMode=false;}
    }
    function _doTouch(gs:any,name:string,ctx:any){
      const aff=getNpcAffection(gs,name);const{updateRelation,saveState}=require("./engine/state.ts");
      const levels=[{n:"握手",min:0,rw:2,pen:2},{n:"摸头",min:30,rw:2,pen:5},{n:"拥抱",min:50,rw:3,pen:10},{n:"按摩",min:60,rw:3,pen:10,needL1:true},{n:"亲吻",min:70,rw:5,pen:15}];
      for(let i=levels.length-1;i>=0;i--){
        const l=levels[i]!;if(aff>=l.min&&(!l.needL1||gs.layer1Enabled)){
          const ok=Math.random()>0.2;const msg=ok?`我与${name}${l.n}。✓ 好感+${l.rw}`:`${name}拒绝了${l.n}。✗ 好感-${l.pen}`;
          if(ok)updateRelation(gs.player.relationships,name,l.rw,l.n);else updateRelation(gs.player.relationships,name,-l.pen,`${l.n}被拒`);
          saveState();ctx.chat.addSystemMessage(msg);_panelMode=false;return;
        }
      }
      ctx.ui.notify("条件未满足","warning");
    }
    function _doDate(gs:any,name:string,ctx:any){
      const aff=getNpcAffection(gs,name);if(aff<50)return;
      const rel=gs.player.relationships[name]||(gs.player.relationships[name]={stage:"熟人",affection:aff,history:[],notes:""});
      const ok=Math.random()>0.2;
      if(ok)rel.affection=Math.min(100,(rel.affection||0)+5);else rel.affection=Math.max(0,(rel.affection||0)-5);
      require("./engine/state.ts").saveState();
      ctx.chat.addSystemMessage(ok?`我约 ${name} 周末出去玩。${name}：「好啊。」好感+5`:`约 ${name} 出去玩，但${name}说有事。好感-5`);
    }
  },{placement:"aboveEditor"});
}
