import { Type } from "typebox";

export default {
    name: "use_ability", label: "使用能力",
    description: "使用超能力/忍术/咒术。消耗资源+冷却+前置检查。纯叙事能力走narrativeOnly。",
    parameters: Type.Object({
      ability: Type.String({ description: "能力名，如'火遁·豪火球之术'" }),
      target: Type.Optional(Type.String({ description: "目标名" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
      const { useAbility, addAbilityExp } = await import("../../engine/abilities.ts");
      const p = gameState.player;

      // 确保玩家 abilities 已初始化
      if (!p.abilities) (p as any).abilities = {};

      const result = useAbility(
        {
          name: p.name,
          resourcePools: p.resourcePools,
          abilities: p.abilities as any,
          skills: p.skills,
          attributes: p.attributes as any,
        },
        params.ability,
        params.target
      );

      if (!result.ok) {
        return { content: [{ type: "text", text: `❌ ${result.errors.join("; ")}` }], details: {} };
      }

      // 经验成长
      if (p.abilities) {
        addAbilityExp(p.abilities as any, params.ability, 1);
      }

      // 伤害应用（如果指定了目标且是 NPC）
      if (result.damage && params.target) {
        const npc = gameState.npcs[params.target];
        if (npc) {
          npc.hp.current = Math.max(0, npc.hp.current - result.damage.raw);
          if (npc.hp.current <= 0) npc.alive = false;
        } else if (params.target === p.name || params.target === "玩家") {
          p.hp.current = Math.max(0, p.hp.current - result.damage.raw);
          if (p.hp.current <= 0) p.alive = false;
        }
      }

      saveState();
      return { content: [{ type: "text", text: result.narrative }], details: result };
    },
  };
