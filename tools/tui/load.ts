export default {
    description: "载入手动存档。用法: /load <存档名>",
    handler: async (args: string, ctx: any) => {
      const { loadSave, gameState } = await import("../../engine/state.ts");
      const name = args.trim();
      if (!name) { ctx.ui.notify("用法: /load <存档名> 用 /saves 查看可用存档", "warning"); return; }
      const ok = loadSave(name);
      if (ok) {
        ctx.ui.notify(`📂 已载入: ${name} → ${gameState.player.location} 第${gameState.turn}回合`, "info");
      } else {
        ctx.ui.notify(`❌ 存档不存在: ${name}`, "warning");
      }
    },
  };
