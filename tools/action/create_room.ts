import { Type } from "typebox";

export default {
    name: "create_room", label: "创建房间",
    description: "建造新房间（收费施工）。用模板省去手写尺寸。",
    parameters: Type.Object({
      name: Type.String({ description: "房间名" }),
      template: Type.Optional(Type.String({ description: "房间模板名，如 家庭浴室/咖啡厅/普通教室。自动套尺寸" })),
      width: Type.Optional(Type.Number({ description: "房间宽度（格），模板提供时可选" })),
      height: Type.Optional(Type.Number({ description: "房间高度（格），模板提供时可选" })),
      floor: Type.Optional(Type.Number({ description: "楼层，默认0" })),
      exitFrom: Type.Optional(Type.String({ description: "从哪个已有房间开门连通新房间" })),
      atmosphere: Type.Optional(Type.String({ description: "房间氛围描述" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createRoom } = await import("../../engine/state-grid.ts");
      const r = await createRoom(
        params.name,
        params.width ?? 3,
        params.height ?? 3,
        params.floor ?? 0,
        {
          templateId: params.template,
          exitFrom: params.exitFrom,
          atmosphere: params.atmosphere,
        }
      );
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  };
