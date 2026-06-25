import { Type } from "typebox";

export default {
    name: "set_npc_outfit", label: "NPC换装",
    description: "切换NPC服装卡。outfit: school|pe|swim|casual|sleep。引擎自动注入服装上下文。",
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
