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

  pi.on("turn_end", async (event, ctx) => {
    updateChatHUD(ctx);
  });

  pi.on("session_shutdown", async () => {
    const { saveState } = await import("./engine/state.ts");
    saveState();
  });

  // 每轮组装 GM 系统提示词（含 settle_scene 漏调兜底 + mode 自动切换）
  pi.on("before_agent_start", async (event) => {
    const { buildStatePrompt, gameState, saveState, isSameLocation } = await import("./engine/state.ts");

    // P0-2: 检测上轮是否漏调 settle_scene → 引擎兜底自动结算
    let autoSettled = false;
    const prevTurn = gameState._turnAtLastCheck;
    if (prevTurn !== undefined && gameState.turn > 0 && gameState.turn === prevTurn) {
      const { advanceMinutes } = await import("./engine/time.ts");
      const { detectInteractionMode } = await import("./engine/detect-mode.ts");
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      advanceMinutes(gameState.time, 5);
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      const npcCount = Object.values(gameState.npcs).filter((n: any) =>
        n.alive && isSameLocation(n.currentRoom, gameState.player.location)
      ).length;
      const modeResult = detectInteractionMode(gameState, npcCount);
      gameState.interactionMode = modeResult.interactionMode;
      saveState();
      autoSettled = true;
    }
    gameState._turnAtLastCheck = gameState.turn;

    // Mode 自动切换：上轮有 sex 工具 → auto sex；sex 无 sex 工具 → 恢复
    const lastTools = gameState._lastTurnToolsCalled || [];
    const sexTools = ["sex_touch", "masturbate"];
    const hadSex = lastTools.some((t: string) => sexTools.includes(t));
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

    const statePrompt = await buildStatePrompt();
    if (gameState.mode === "sex") gameState.layer1Enabled = true;
    let gmPrompt = await buildSystemPrompt(gameState, statePrompt);
    if (autoSettled) {
      gmPrompt += `\n\n[引擎] ⚠️ 上轮 GM 未调用 settle_scene，引擎已自动结算（+5分钟，当前 turn ${gameState.turn}）。请在结束本轮叙事前务必调用 settle_scene！`;
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
