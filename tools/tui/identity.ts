
export default {
    description: "设置或查看当前公开身份（伪装）。用法: /identity [新身份]",
    handler: async (args, ctx) => {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const newId = args.trim();
      if (!newId) {
        const { getDisguiseIdentity } = await import("../../engine/state.ts");
        const disguise = getDisguiseIdentity(gameState.player);
        const manual = gameState.player.public_identity || "总武高学生";
        const info = disguise ? `${manual} | 🎭 装备伪装: ${disguise}` : manual;
        ctx.ui.notify(`当前公开身份: ${info}`, "info");
        return;
      }
      gameState.player.public_identity = newId;
      saveState();
      ctx.ui.notify(`公开身份已更新为: ${newId}`, "success");
    },
  };
