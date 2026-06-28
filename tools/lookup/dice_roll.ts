import { Type } from "typebox";

export default {
    name: "dice_roll", label: "骰子",
    description: "d20检定。传入难度、属性值、技能等级。",
    parameters: Type.Object({
      difficulty: Type.String({ description: "难度等级: trivial|easy|moderate|hard|very_hard|nearly_impossible" }),
      attribute: Type.Number({ description: "属性值 (1-20)" }),
      skillLv: Type.Number({ description: "技能等级 (0-20)" }),
      advantage: Type.Optional(Type.String({ description: "优势/劣势: advantage|disadvantage|平" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { check } = await import("../../engine/dice.ts");
      const r = check(params.difficulty as any, params.attribute, params.skillLv, (params.advantage as any) || "平");
      return { content: [{ type: "text", text: `${r.outcome} (${r.roll.kept}+${r.roll.mod}=${r.roll.total} vs DC${r.roll.dc})` }], details: r };
    },
  };
