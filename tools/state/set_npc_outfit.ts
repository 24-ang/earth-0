import { Type } from "typebox";

export default {
    name: "set_npc_outfit", label: "NPC换装",
    description: "切换NPC服装卡。outfit用lookup_character查该角色[可切换服装卡]列表获取可用key。引擎联动equipment_by_outfit切换装备池含单品flavor。",
    parameters: Type.Object({
      npc: Type.String({ description: "NPC 名" }),
      outfit: Type.String({ description: "服装卡：school / pe / swim / casual / sleep" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { setNPCOutfit, saveState } = await import("../../engine/state.ts");
      const r = setNPCOutfit(params.npc, params.outfit);
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
