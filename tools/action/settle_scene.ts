import { Type } from "typebox";

export default {
    name: "settle_scene", label: "场景收口",
    description: "场景收口：推进时间+更新NPC日程+写入记忆标签。替代commit_turn+add_memory_tag。NPC换装请用set_npc_outfit。",
    parameters: Type.Object({
      summary: Type.String({ description: "本场景发生的事，如'在侍奉部和雪乃聊了一下午'" }),
      elapsed_minutes: Type.Number({ description: "经过的分钟数" }),
      memory_tags: Type.Optional(Type.Array(Type.Object({
        target: Type.String({ description: "NPC 名" }),
        tag: Type.String({ description: "记忆标签，如'接受了维的帮助'" }),
      }))),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, backupBeforeTurn, updateNPCSchedules, refreshWeather, addMemoryTag, stampRoom, cleanupTempNPCs, drainToolCalls, isSameLocation } = await import("../../engine/state.ts");
      // 1. 计算结算前的同场 NPC 数量
      const previousRoundNPCs = Object.values(gameState.npcs).filter((n: any) => n.alive && isSameLocation(n.currentRoom, gameState.player.location)).length;

      // 清掉上轮残留（如果有），开始新一轮追踪
      drainToolCalls();
      const { advanceMinutes } = await import("../../engine/time.ts");
      const cleanupMsgs = cleanupTempNPCs("场景结算");
      const mins = params.elapsed_minutes;
      if (mins > 0) backupBeforeTurn();
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      const result = advanceMinutes(gameState.time, mins);
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      if (gameState.turn % 4 === 0) refreshWeather();
      const events = await updateNPCSchedules();
      const { runWorldTick } = await import("../../engine/tick.ts");
      await runWorldTick();
      // 疲劳累积（受气温疲劳乘数影响）
      const { getFatigueMultiplier } = await import("../../engine/weather.ts");
      const kFatigue = getFatigueMultiplier(gameState.weather?.temp ?? 16);
      gameState.player.fatigue = Math.min(100, (gameState.player.fatigue ?? 0) + Math.round((mins / 12) * kFatigue));

      // 房产契约结算（仅在跨天时触发）
      if (result.daysAdvanced > 0) {
        const { settleHousingContracts } = await import("../../engine/housing.ts");
        settleHousingContracts(gameState);
      }

      // 2. 计算结算后的同场 NPC 数量，并检测更新视角模式
      const currentRoundNPCs = Object.values(gameState.npcs).filter((n: any) => n.alive && isSameLocation(n.currentRoom, gameState.player.location)).length;
      const { detectInteractionMode } = await import("../../engine/detect-mode.ts");
      const modeResult = detectInteractionMode(gameState, currentRoundNPCs);
      gameState.interactionMode = modeResult.interactionMode;

      // 3. 处理切镜与幕间触发及异步生成
      const { processViewpointTriggers } = await import("../../engine/viewpoint.ts");
      await processViewpointTriggers(gameState, previousRoundNPCs, currentRoundNPCs, _ctx);

      if (params.memory_tags && params.memory_tags.length > 0) {
        for (const m of params.memory_tags) {
          addMemoryTag(m.target, m.tag, 365);
        }
      }

      stampRoom();
      saveState();

      const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
      const cleanupText = cleanupMsgs.length > 0 ? cleanupMsgs.join("\n") + "\n" : "";
      const textResult = cleanupText + `场景结束推进了 ${mins}分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}。\n` +
        `日程更新: ${events.length > 0 ? events.join("; ") : "无特殊事件"}\n` +
        `写入记忆: ${params.memory_tags && params.memory_tags.length > 0 ? params.memory_tags.map(m => `${m.target}(${m.tag})`).join(", ") : "无"}`;
      return { content: [{ type: "text", text: textResult }], details: { time: gameState.time, events, memory_tags: params.memory_tags } };
    },
  };
