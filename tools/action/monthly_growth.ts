import { Type } from "typebox";

export default {
    name: "monthly_growth", label: "成长",
    description: "月末发育结算。传入diet(普通|节食|高蛋白|丰胸)和exercise(普通|规律|高强度)。",
    parameters: Type.Object({ diet: Type.String(), exercise: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { monthlyGrowth } = await import("../../engine/state.ts");
      const r = monthlyGrowth(params.diet, params.exercise);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
