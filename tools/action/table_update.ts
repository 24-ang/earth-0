import { Type } from "typebox";

export default {
    name: "table_update", label: "表格更新",
    description: "更新表格单元格。table+rowId+col+val。",
    parameters: Type.Object({
      table: Type.String(), rowId: Type.String(), col: Type.String(), val: Type.String(),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { updateCell } = await import("../../engine/scenario-tables.ts");
      const r = updateCell(params.table, params.rowId, params.col, params.val);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
