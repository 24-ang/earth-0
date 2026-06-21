import { Type } from "typebox";

export default {
    name: "table_create", label: "表格新增",
    description: "在结构化记忆表中创建一行。table:情景表/角色身份表/角色状态表/关键实体表/世界观表。row:键值对。",
    parameters: Type.Object({
      table: Type.String({ description: "表格名" }),
      row: Type.Record(Type.String(), Type.String()),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createRow } = await import("../../engine/scenario-tables.ts");
      const r = createRow(params.table, params.row);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
