import { Type } from "typebox";

export default {
    name: "table_read", label: "表格读取",
    description: "读取所有结构化记忆表。GM用此查看当前世界状态。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _o, _ctx) {
      const { getAllTables } = await import("../../engine/scenario-tables.ts");
      return { content: [{ type: "text", text: getAllTables() || "表格为空" }], details: {} };
    },
  };
