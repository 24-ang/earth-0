import { Type } from "typebox";

export default {
    name: "update_reputation", label: "声望",
    description: "更新玩家在特定圈子的声望。",
    parameters: Type.Object({ group: Type.String(), delta: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const g = params.group, d = params.delta;
      if (!gameState.player.reputation[g]) gameState.player.reputation[g] = 0;
      gameState.player.reputation[g] += d;
      saveState();
      return { content: [{ type: "text", text: `${g}声望 ${d >= 0 ? "+" : ""}${d} → ${gameState.player.reputation[g]}` }], details: {} };
    },
  };
