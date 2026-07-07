import { Type } from "typebox";

export default {
    name: "complete_travel", label: "完成旅行",
    description: "完成旅行叙事：玩家到达目的地+推进时间+清除pendingTravel。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const { moveTo, advanceTimeMinutes } = await import("../helpers.ts");
      if (!gameState.pendingTravel) return { content: [{ type: "text", text: "目前没有正在进行的旅行" }], details: {} };

      const pt = gameState.pendingTravel;
      gameState.pendingTravel = null;
      saveState();

      await moveTo(pt.to, _ctx, gameState, saveState);
      await advanceTimeMinutes(pt.minutes, _ctx, gameState, saveState);

      // 通勤偶遇检测
      try {
        const { detectCommuteEncounter } = await import("../../engine/commute.ts");
        const encounter = await detectCommuteEncounter(pt.from, pt.to, pt.route || "步行", pt.minutes, gameState);
        if (encounter) {
          gameState._lastCommuteEncounter = encounter;
          saveState();
        }
      } catch (e) {
        console.error("complete_travel: detectCommuteEncounter failed:", e);
      }

      return { content: [{ type: "text", text: `旅行完成，已到达 ${pt.to}，耗时 ${pt.minutes} 分钟` }], details: {} };
    },
  };
