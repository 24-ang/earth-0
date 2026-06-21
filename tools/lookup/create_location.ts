import { Type } from "typebox";

export default {
    name: "create_location", label: "创建地点",
    description: "创建新地点（如新咖啡店、秘密基地）。引擎自动加入导航层级。parent: 上级地名。",
    parameters: Type.Object({
      parent: Type.String({ description: "上级地名，如'千叶县'、'东京都'、'千叶市'" }),
      name: Type.String({ description: "新地点名称" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createDynamicLocation } = await import("../../engine/state.ts");
      const r = createDynamicLocation(params.parent, params.name);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
