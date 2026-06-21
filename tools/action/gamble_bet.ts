import { Type } from "typebox";

export default {
    name: "gamble_bet",
    label: "博弈下注",
    description: "概率博弈。game: dice_2d6|blackjack。strategy: normal|cheat|calc。超额拒绝。",
    parameters: Type.Object({
      game: Type.String({ description: "游戏类型 (dice_2d6|blackjack)" }),
      amount: Type.Number({ description: "下注金额" }),
      strategy: Type.String({ description: "博弈策略 (normal|cheat|calc)" })
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { executeGamble } = await import("../../engine/gambling.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      const res = executeGamble(params.game, params.amount, params.strategy, gameState);
      saveState();
      return { content: [{ type: "text", text: res.message }], details: res };
    }
  };
