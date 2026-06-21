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

  // 每轮组装 GM 系统提示词
  pi.on("before_agent_start", async (event) => {
    const { buildStatePrompt, gameState } = await import("./engine/state.ts");
    const statePrompt = await buildStatePrompt();
    if (gameState.mode === "sex") gameState.layer1Enabled = true;
    const gmPrompt = await buildSystemPrompt(gameState, statePrompt);
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
        const layerKey = key.replace("{mode}", gameState.mode);
        const layerConfig = presetData.layers[layerKey];
        if (!layerConfig) continue;
        
        if (layerKey === "state") {
          parts.push(statePrompt);
        } else {
          const fileResolved = layerConfig.file.replace("{mode}", gameState.mode);
          const filePath = path.resolve(process.cwd(), fileResolved);
          const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").trim() : "";
          if (content) parts.push(content);
        }
      }
      gmPrompt = parts.filter(Boolean).join("\n\n---\n\n");
    } catch (e) {
      console.error("Failed to parse preset.json, falling back to hardcoded default:", e);
      const read = (name: string) => {
        const p = path.join(agentsDir, name);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
      };
      const modeFile = gameState.mode === "sex" ? "gm-mode-sex.md"
        : gameState.mode === "rpg" ? "gm-mode-rpg.md"
        : "gm-mode-gal.md";
      gmPrompt = [
        read("gm-pre.md"),
        read("gm-rules.md"),
        read("gm-contract.md"),
        statePrompt,
        read(modeFile),
      ].filter(Boolean).join("\n\n---\n\n");
    }
  } else {
    const read = (name: string) => {
      const p = path.join(agentsDir, name);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
    };
    const modeFile = gameState.mode === "sex" ? "gm-mode-sex.md"
      : gameState.mode === "rpg" ? "gm-mode-rpg.md"
      : "gm-mode-gal.md";
    gmPrompt = [
      read("gm-pre.md"),
      read("gm-rules.md"),
      read("gm-contract.md"),
      statePrompt,
      read(modeFile),
    ].filter(Boolean).join("\n\n---\n\n");
  }

  return gmPrompt;
}
