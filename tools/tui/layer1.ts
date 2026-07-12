
export default {
    description: "切换模式：rpg ↔ gal ↔ sex（自动注入对应规则）",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("../../engine/state.ts");
      // 三态循环: rpg → gal → sex → rpg
      const cycle: Record<string, "rpg" | "gal" | "sex"> = { rpg: "gal", gal: "sex", sex: "rpg" };
      gameState.mode = cycle[gameState.mode] || "rpg";
      gameState.layer1Enabled = gameState.mode === "sex";
      saveState();
      const labels: Record<string, string> = { rpg: "RPG 模式", gal: "GAL 模式", sex: "🔞 Sex 模式（Layer1 自动启用）" };
      ctx.ui.notify(labels[gameState.mode] || gameState.mode, "info");
    },
  };
