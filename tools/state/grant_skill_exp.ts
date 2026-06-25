import { Type } from "typebox";

export default {
    name: "grant_skill_exp", label: "技能成长",
    description: "技能经验。单次≤5 EXP。引擎自动升级(Lv×10)。",
    parameters: Type.Object({
      skill: Type.String({ description: "技能名，如'格斗'、'潜行'" }),
      amount: Type.Number({ description: "经验值，1-5" }),
      reason: Type.String({ description: "获得原因，如'平冢静指导格斗训练'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { addSkillExp, gameState, saveState } = await import("../../engine/state.ts");
      const amount = Math.max(1, Math.min(5, params.amount));
      const before = gameState.player.skills[params.skill]?.level ?? 0;
      addSkillExp(gameState.player.skills, params.skill, amount);
      const after = gameState.player.skills[params.skill]?.level ?? 0;
      const leveledUp = after > before ? ` → Lv${after}!` : "";
      saveState();
      return { content: [{ type: "text", text: `${params.skill} +${amount}EXP（${params.reason}）${leveledUp}` }], details: {} };
    },
  };
