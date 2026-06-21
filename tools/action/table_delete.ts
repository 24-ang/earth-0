import { Type } from "typebox";

export default {
    name: "table_delete", label: "表格删除",
    description: "删除表格行。table+rowId。",
    parameters: Type.Object({ table: Type.String(), rowId: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { deleteRow } = await import("../../engine/scenario-tables.ts");
      const r = deleteRow(params.table, params.rowId);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
