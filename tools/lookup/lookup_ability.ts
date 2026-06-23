import { Type } from "typebox";

export default {
    name: "lookup_ability", label: "查询能力",
    description: "查询能力定义: 效果描述/资源消耗/前置条件/冷却",
    parameters: Type.Object({
      name: Type.String({ description: "能力名，如'火遁·豪火球之术'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getAbilityDef } = await import("../../engine/abilities.ts");
      const def = getAbilityDef(params.name);
      if (!def) {
        return { content: [{ type: "text", text: `未找到能力: ${params.name}` }], details: {} };
      }

      const lines = [
        `📜 ${def.name}${def.rank ? ` [${def.rank}级]` : ""}`,
        `描述: ${def.description}`,
      ];
      if (def.resourceCost) {
        lines.push(`消耗: ${Object.entries(def.resourceCost).map(([k, v]) => `${k}${v}`).join(", ")}`);
      }
      if (def.cooldown) lines.push(`冷却: ${def.cooldown}回合`);
      if (def.damage) {
        lines.push(`伤害: ${def.damage.dice} ${def.damage.type}${def.damage.area ? ` (${def.damage.area})` : ""}`);
      }
      if (def.requires) {
        const reqs: string[] = [];
        if (def.requires.skills) reqs.push(...Object.entries(def.requires.skills).map(([k, v]) => `技能${k}≥Lv${v}`));
        if (def.requires.abilities) reqs.push(...Object.entries(def.requires.abilities).map(([k, v]) => `${k}≥Lv${v}`));
        if (def.requires.attributes) reqs.push(...Object.entries(def.requires.attributes).map(([k, v]) => `${k}≥${v}`));
        if (reqs.length > 0) lines.push(`前置: ${reqs.join("; ")}`);
      }
      if (def.narrativeOnly) lines.push(`类型: 纯叙事（引擎不机械化解）`);

      return { content: [{ type: "text", text: lines.join("\n") }], details: def };
    },
  };
