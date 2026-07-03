import { Type } from "typebox";

export default {
    name: "update_reputation", label: "声望",
    description: "更新玩家在特定圈子的声望。",
    parameters: Type.Object({ group: Type.String(), delta: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { updateReputation } = await import("../../engine/state.ts");
      const g = params.group, d = params.delta;
      const newRep = updateReputation(g, d);
      const oldRep = newRep - d;
      return { content: [{ type: "text", text: `${g}声望: ${oldRep} → ${newRep} (${d >= 0 ? "+" : ""}${d})` }], details: {} };
    },
  };
