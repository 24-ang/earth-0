export default {
    description: "创建命名存档（需在安全地点）。用法: /save <存档名> 或 /save (默认=quick)",
    handler: async (args: string, ctx: any) => {
      const { gameState, createSave } = await import("../../engine/state.ts");
      const loc = gameState.player.location;
      const safe = loc.includes("家") || loc.includes("公寓") || loc.includes("邸") || loc.includes("教室") || loc.includes("部室") || loc.includes("橘家");
      if (!safe) {
        ctx.ui.notify("⚠ 这里不是安全地点。在安全地点（家/公寓/教室/部室）才能存档。\n用 /redo 可以随时回退最近几回合。", "warning");
        return;
      }
      const name = args.trim() || "quick";
      const saved = createSave(name);
      ctx.ui.notify(`💾 已存档: ${saved}`, "info");
    },
  };
