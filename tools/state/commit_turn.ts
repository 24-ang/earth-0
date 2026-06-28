import { Type } from "typebox";

export default {
    name: "commit_turn", label: "推进时间",
    description: "推进游戏时间（分钟）。下课/放学/等待时调用。",
    parameters: Type.Object({ minutes: Type.Number({ description: "推进分钟数，如 5/30/60" }) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState, backupBeforeTurn, updateNPCSchedules, refreshWeather, stampRoom, cleanupTempNPCs, drainToolCalls } = await import("../../engine/state.ts");
      // 清掉上轮残留（如果有），开始新一轮追踪
      drainToolCalls();
      const { advanceMinutes } = await import("../../engine/time.ts");
      const cleanupMsgs = cleanupTempNPCs("回合结束");
      const mins = params.minutes;
      // 回合自动备份
      backupBeforeTurn();
      // 初始化 legacy session 没有 minute_of_day
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      const result = advanceMinutes(gameState.time, mins);
      // 同步玩家年龄（time.player_age → player.age），确保 NPC 年龄同步
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      if (gameState.turn % 4 === 0) refreshWeather();
      const events = await updateNPCSchedules();
      const { runWorldTick } = await import("../../engine/tick.ts");
      await runWorldTick();
      stampRoom();
      // 疲劳累积：每推进1小时+5疲劳
      gameState.player.fatigue = Math.min(100, (gameState.player.fatigue ?? 0) + Math.round(mins / 12));
      saveState();
      const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
      const cleanupText = cleanupMsgs.length > 0 ? cleanupMsgs.join("\n") + "\n" : "";
      return { content: [{ type: "text", text: cleanupText + `时间推进 ${mins}分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}。${events.length > 0 ? events.join("; ") : "无特殊事件"}` }], details: { time: gameState.time, events } };
    },
  };
