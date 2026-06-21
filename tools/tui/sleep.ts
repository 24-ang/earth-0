export default {
    description: "睡觉+N天+满血（需在家）。用法: /sleep [天数=1] 最多7天",
    handler: async (args: string, ctx: any) => {
      const { gameState, saveState, stampRoom } = await import("../../engine/state.ts");
      const { advanceTime } = await import("../../engine/time.ts");
      const loc = gameState.player.location;
      if (!(loc.includes("家")||loc.includes("公寓")||loc.includes("邸")||loc.includes("橘家"))) {
        ctx.ui.notify("需要在家才能睡觉", "warning"); return;
      }
      const days = Math.max(1, Math.min(7, parseInt(args.trim()) || 1));
      for (let d = 0; d < days; d++) {
        gameState.time = advanceTime(gameState.time, 1);
      }
      gameState.player.hp.current = gameState.player.hp.max;
      gameState.player.fatigue = 0;
      stampRoom(); // 房间时间戳更新
      saveState();
      ctx.ui.notify(`😴 睡了 ${days} 天 → ${gameState.time.game_date} ${gameState.time.day_of_week}曜日。HP/体力恢复。`, "info");
      (await import("../../tools/helpers.ts")).updateChatHUD(ctx);
    },
  };
