import { Type } from "typebox";

export default {
    name: "instantiate_npc", label: "路人转正",
    description: "将路人升级为可交互NPC，加入角色库",
    parameters: Type.Object({
      nameless_name: Type.String({ description: "路人名，如'路人(主妇)'" }),
      reason: Type.Optional(Type.String({ description: "实例化原因" })),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { instantiateNamelessNPC } = await import("../../engine/state.ts");
      const result = instantiateNamelessNPC(params.nameless_name, params.reason || "");
      return {
        content: [{ type: "text", text: result }],
        details: { namelessName: params.nameless_name },
      };
    }
  };
