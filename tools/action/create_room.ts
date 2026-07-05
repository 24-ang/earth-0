import { Type } from "typebox";

export default {
    name: "create_room", label: "创建房间",
    description: "建新房。流程——①lookup_furniture找模板/家具 ②选最匹配的模板 ③按剧情调整furniture/atmosphere避免雷同 ④create_room。模板不匹配时自传width+height+furniture+atmosphere。家具名须在furniture.json中。",
    parameters: Type.Object({
      name: Type.String({ description: "房间名" }),
      template: Type.Optional(Type.String({ description: "模板名。用 lookup_furniture(category='room_template') 查可用列表。选了模板后仍需按剧情调整 furniture 和 atmosphere——不要照搬默认值，要根据角色性格和情境微调。" })),
      width: Type.Optional(Type.Number({ description: "宽度（格）。有template时可跳过。无模板时必传——按常识估算：小房间5×5、中房间8×8、大厅12×10" })),
      height: Type.Optional(Type.Number({ description: "高度（格）。无模板时必传" })),
      floor: Type.Optional(Type.Number({ description: "楼层，默认0" })),
      exitFrom: Type.Optional(Type.String({ description: "从哪个已有房间开门连通新房间" })),
      atmosphere: Type.Optional(Type.String({ description: "房间氛围描述。模板有默认值但建议你根据剧情重写——两个咖啡厅的气氛不该完全一样。写1-3句中文" })),
      furniture: Type.Optional(Type.Array(Type.String(), { description: "家具列表。模板有默认但一定要按剧情增减。先用 lookup_furniture(search='冰箱') 确认物品在目录中存在。无模板时必传——至少3件。传[]=空房间" })),
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
          furniture: params.furniture,
          userWidth: params.width,
          userHeight: params.height,
        } as any
      );
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  };
