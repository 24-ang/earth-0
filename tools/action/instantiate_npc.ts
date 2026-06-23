import { Type } from "typebox";

export default {
    name: "instantiate_npc", label: "路人转正",
    description: "将路人/临时NPC升级为可交互永久角色",
    parameters: Type.Object({
      nameless_name: Type.Optional(Type.String({ description: "路人模板名，如'路人(主妇)'" })),
      temp_name: Type.Optional(Type.String({ description: "临时NPC名，从spawn_temp_npc创建的角色" })),
      reason: Type.Optional(Type.String({ description: "实例化原因" })),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { instantiateNamelessNPC, promoteTempNPC } = await import("../../engine/state.ts");

      // P4: Promote temp NPC
      if (params.temp_name) {
        const result = promoteTempNPC(params.temp_name, params.reason || "有长期剧情价值");
        if (!result) {
          return {
            content: [{ type: "text", text: `未找到临时NPC「${params.temp_name}」。可能已被回收或名称不匹配。` }],
            details: {},
          };
        }
        return {
          content: [{ type: "text", text: result }],
          details: { promotedFrom: params.temp_name },
        };
      }

      // Original: instantiate from template
      if (!params.nameless_name) {
        return {
          content: [{ type: "text", text: "需提供 nameless_name 或 temp_name 参数" }],
          details: {},
        };
      }
      const result = instantiateNamelessNPC(params.nameless_name, params.reason || "");
      return {
        content: [{ type: "text", text: result }],
        details: { namelessName: params.nameless_name },
      };
    }
  };
