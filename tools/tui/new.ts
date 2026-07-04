export default {
    description: "开始新游戏（清空当前存档，重新开局）。",
    handler: async (_args: string, ctx: any) => {
      const { resetState, saveState } = await import("../../engine/state.ts");
      resetState();
      saveState();
      ctx.ui.notify("🆕 新游戏已开始。turn=0，上帝模式开启。", "info");
    },
  };
