/**
 * earth-0 扩展 — tools注册，LLM ↔ engine桥梁
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAll } from "./tools/registry.ts";
import { updateChatHUD } from "./tools/helpers.ts";

export default function (pi: ExtensionAPI) {
  // Register all modular tools and commands
  registerAll(pi);

  // Register TUI lifecycle event handlers
  pi.on("session_start", async (event, ctx) => {
    const { gameState, loadState, saveState, resetState, buildStatePrompt } = await import("./engine/state.ts");
    if (loadState()) {
      // 确保 NPC 懒初始化（恢复旧存档时补上）
      await buildStatePrompt();
      saveState();
      ctx.ui.notify(`earth-0 ${(await import("./engine/state.ts")).gameState.time.game_date}`, "info");
    } else {
      resetState();
      ctx.ui.notify("earth-0 新游戏", "info");
    }
    updateChatHUD(ctx);
  });

  // P3: 捕获用户输入到 gameState，供 before_agent_start 自动检测用
  // （pi 框架的 before_agent_start 不传用户消息，只能通过 input hook 中转）
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

  pi.on("turn_end", async (event, ctx) => {
    updateChatHUD(ctx);
  });

  pi.on("session_shutdown", async () => {
    const { saveState } = await import("./engine/state.ts");
    saveState();
  });

  // 每轮组装 GM 系统提示词（含 settle_scene 漏调兜底 + mode 自动切换 + sex 自动检测）
  pi.on("before_agent_start", async (event, ctx) => {
    const { buildStatePrompt, gameState, saveState } = await import("./engine/state.ts");

    // ═══════════════════════════════════════════════════════════
    // P0: settle_scene 漏调兜底 → 完整结算（PHILOSOPHY §1.3）
    // ═══════════════════════════════════════════════════════════
    let autoSettled = false;
    const prevTurn = gameState._turnAtLastCheck;
    if (prevTurn !== undefined && gameState.turn > 0 && gameState.turn === prevTurn) {
      const { runSettlement } = await import("./engine/settlement.ts");
      await runSettlement({
        elapsed_minutes: 5,
        _autoSettled: true,
        ctx,  // 传给 reviewTurn → 好感度兜底生效
      });
      autoSettled = true;
    }
    gameState._turnAtLastCheck = gameState.turn;

    // P3 前置：确保 sex 模式下 layer1 始终启用
    if (gameState.mode === "sex") gameState.layer1Enabled = true;

    // ═══════════════════════════════════════════════════════════
    // P3: sex 模式引擎自动检测（在 mode 检查之前运行，结果影响 mode 恢复判断）
    // ═══════════════════════════════════════════════════════════
    let sexAutoTouchResult: string | null = null;
    let sexAutoTouched = false;
    const lastTools = gameState._lastTurnToolsCalled || [];
    if (gameState.mode === "sex" && gameState.layer1Enabled) {
      const hadIntimateTouch = lastTools.includes("intimate_touch");
      if (!hadIntimateTouch) {
        let userText = cleanUserInput(gameState._lastUserInput || "");

        const bodyKeywords = /触|摸|碰|揉|捏|舔|吻|吸|插|抽|进|出|顶|压|按|抓|握|抚|蹭|贴|抱|搂|亲|咬|含|吮|脱|伸|探/;
        if (userText && bodyKeywords.test(userText)) {
          try {
            const { gameState: gs, saveState: sv, getOrCreateSexState, pushToolCall, getOrCreateNPC, isSameLocation } = await import("./engine/state.ts");
            const { SEX_PROFILES, touchBodyPart, checkClimax, triggerClimax, settleAfterSex, formatSettlement } = await import("./engine/sex.ts");

            let targetName: string | null = (gs.player.sex?.profile as any)?.name || null;
            if (!targetName || !SEX_PROFILES[targetName]) {
              const candidates = Object.entries(SEX_PROFILES).filter(([name, _p]) => {
                const npc = getOrCreateNPC(name);
                return npc && npc.alive && isSameLocation(npc.currentRoom, gs.player.location);
              });
              if (candidates.length > 0) {
                targetName = candidates[0][0];
                const ss = await getOrCreateSexState(targetName);
                if (ss) {
                  gs.player.sex = ss;
                  gs.player.sex.desire = Math.max(gs.player.sex.desire || 0, 50);
                  console.error(`sex auto-detection: auto-aligned to ${targetName} (${candidates.length} candidates in scene)`);
                }
              }
            }

            if (targetName && SEX_PROFILES[targetName]) {
              const p = SEX_PROFILES[targetName];
              const { part, intensity } = inferTouchTarget(userText);
              const r = touchBodyPart(p, gs.player.sex, part, intensity);

              if (gs.player.sex.arousal == null) gs.player.sex.arousal = 0;
              const newArousal = gs.player.sex.arousal + r.arousalChange;
              gs.player.sex.arousal = isNaN(newArousal) ? 0 : Math.min(100, newArousal);

              pushToolCall("intimate_touch");
              gameState._lastTurnToolsCalled ??= [];
              if (!gameState._lastTurnToolsCalled.includes("intimate_touch")) {
                gameState._lastTurnToolsCalled.push("intimate_touch");
              }
              sv();
              sexAutoTouched = true;

              sexAutoTouchResult = `[自动检测] ${part}${intensity} → ${targetName}: ${r.reaction} (兴奋 ${gs.player.sex.arousal}/100)`;

              if (checkClimax(gs.player.sex)) {
                triggerClimax(gs.player.sex);
                sexAutoTouchResult += `\n高潮！${targetName}达到了高潮！`;
                const report = settleAfterSex(gs.player.sex, gs.time.game_date, 30, [], [], gs.player.name);
                sexAutoTouchResult += formatSettlement(report, targetName);
              }
            } else {
              console.error("sex auto-detection: no NPC with SEX_PROFILES in current scene. Cannot auto-bootstrap.");
            }
          } catch (e) {
            console.error("sex auto-detection: intimate_touch execution failed", e);
          }
        }
      }

      // 欲望自然衰减：仅当本轮既无手动 touch 也无自动 touch
      const anyTouchThisRound = lastTools.includes("intimate_touch") || sexAutoTouched;
      if (!anyTouchThisRound) {
        gameState._sexTurnsWithoutTouch = (gameState._sexTurnsWithoutTouch || 0) + 1;
        if (gameState._sexTurnsWithoutTouch >= 3 && gameState.player.sex) {
          const decay = Math.min(3, Math.floor(gameState._sexTurnsWithoutTouch / 2));
          gameState.player.sex.arousal = Math.max(0, (gameState.player.sex.arousal || 0) - decay);
          if (gameState._sexTurnsWithoutTouch === 3) {
            sexAutoTouchResult = (sexAutoTouchResult || "") +
              `\n[引擎] ⚠️ 已${gameState._sexTurnsWithoutTouch}轮无身体接触，NPC欲望自然下降（-${decay}/轮）。`;
          }
        }
      } else {
        gameState._sexTurnsWithoutTouch = 0;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Mode 自动切换（在 P3 之后运行——auto-touch 结果已写入 _lastTurnToolsCalled）
    // ═══════════════════════════════════════════════════════════
    const finalLastTools = gameState._lastTurnToolsCalled || [];
    const sexTools = ["intimate_touch", "masturbate"];
    const hadSex = finalLastTools.some((t: string) => sexTools.includes(t));
    if (hadSex && gameState.mode !== "sex") {
      gameState._prevMode = gameState.mode;
      gameState.mode = "sex";
      gameState.layer1Enabled = true;
      saveState();
    } else if (!hadSex && gameState.mode === "sex" && gameState._prevMode) {
      gameState.mode = gameState._prevMode;
      gameState.layer1Enabled = false;
      gameState._prevMode = undefined;
      saveState();
    }

    // ═══════════════════════════════════════════════════════════
    // 组装系统提示词
    // ═══════════════════════════════════════════════════════════
    const statePrompt = await buildStatePrompt();
    let gmPrompt = await buildSystemPrompt(gameState, statePrompt);

    // 注入引擎通知
    const notices: string[] = [];
    if (autoSettled) {
      notices.push(`[引擎] ⚠️ 上轮 GM 未调用 settle_scene，引擎已自动完整结算（+5分钟，当前 turn ${gameState.turn}）。`);
    }
    if (sexAutoTouchResult) {
      notices.push(`[引擎·sex] ${sexAutoTouchResult}`);
    }
    if (notices.length > 0) {
      gmPrompt += "\n\n" + notices.join("\n");
    }

    return { systemPrompt: gmPrompt };
  });
}

// 顶层导出系统提示词组装逻辑，以便进行单元测试
export async function buildSystemPrompt(gameState: any, statePrompt: string): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const agentsDir = path.resolve(process.cwd(), "agents");

  let gmPrompt = "";
  const presetPath = path.join(agentsDir, "preset.json");
  if (fs.existsSync(presetPath)) {
    try {
      const presetData = JSON.parse(fs.readFileSync(presetPath, "utf-8"));
      const presetName = gameState.preset || "default";
      const layers = presetData.assembly[presetName] || presetData.assembly["default"];
      const parts: string[] = [];

      for (const key of layers) {
        // 开局流程只在第一回合需要。开局后跳过，省 ~1.5KB/回合。
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
      gmPrompt = parts.filter(Boolean).join("\n\n---\n\n");
    } catch (e) {
      console.error("Failed to parse preset.json, falling back to hardcoded default:", e);
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
      gmPrompt = [
        read("gm-pre.md"),
        read("gm-rules.md"),
        statePrompt,
        read(voiceFile),
        read(modeFile),
        read("gm-contract.md"),
      ].filter(Boolean).join("\n\n---\n\n");
    }
  } else {
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
    gmPrompt = [
      read("gm-pre.md"),
      read("gm-rules.md"),
      statePrompt,
      read(voiceFile),
      read(modeFile),
      read("gm-contract.md"),
    ].filter(Boolean).join("\n\n---\n\n");
  }

  return gmPrompt;
}

// ═══════════════════════════════════════════════════════════
// P3 辅助函数
// ═══════════════════════════════════════════════════════════

/** 清洗 pi 框架 artifact（Windows 路径前缀、slash command 等） */
function cleanUserInput(raw: string): string {
  // 去掉 Windows 路径前缀: "C:/Program Files/Git/mode sex。然后推门..." → "然后推门..."
  let text = raw.replace(/^[A-Z]:\/(?:\S+\/)*\S*\s*/i, "");
  // 去掉 Unix 路径前缀: "/home/user/mode sex"
  text = text.replace(/^\/\S+\/\S+\s*/, "");
  // 去掉 slash command: "/mode sex" 或 "/mode rpg"
  text = text.replace(/^\/mode\s+\S+\s*/, "");
  return text.trim();
}

/** 从用户输入推断触碰部位和强度 */
function inferTouchTarget(userText: string): { part: string; intensity: "轻" | "中" | "重" } {
  const partMap: [RegExp, string][] = [
    [/唇|嘴|口|舌/, "唇"],
    [/脸|面|颊|额|耳/, "脸"],
    [/颈|脖|喉/, "颈"],
    [/胸|乳|奶|酥/, "胸"],
    [/腰|腹|肚|脐/, "腰"],
    [/腿|大|膝|足|脚|踝/, "腿"],
    [/臀|屁|菊|肛|后/, "臀"],
    [/手|指|掌|腕|臂/, "手"],
    [/阴|秘|下|裆|穴|缝/, "秘部"],
    [/肩|背|脊/, "肩"],
  ];
  for (const [re, part] of partMap) {
    if (re.test(userText)) return { part, intensity: "中" };
  }
  // 有舔/吻/咬 → 强度提升
  if (/舔|吻|咬|含|吮/.test(userText)) return { part: "唇", intensity: "重" };
  return { part: "胸", intensity: "中" };
}
