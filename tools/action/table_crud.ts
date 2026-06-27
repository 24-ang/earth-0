import { Type } from "typebox";

export default {
    name: "table_crud", label: "表格操作",
    description: "结构化记忆表操作。action: create|read|update|delete",
    parameters: Type.Object({
      action: Type.String({ description: "create|read|update|delete" }),
      table: Type.Optional(Type.String({ description: "表格名" })),
      row: Type.Optional(Type.Record(Type.String(), Type.String())),
      rowId: Type.Optional(Type.String()),
      col: Type.Optional(Type.String()),
      val: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createRow, getAllTables, updateCell, deleteRow } = await import("../../engine/scenario-tables.ts");
      const a = params.action;
      if (a === "create") {
        if (!params.table || !params.row) return { content: [{ type: "text", text: "create 需要 table + row" }], details: {} };
        return { content: [{ type: "text", text: createRow(params.table, params.row) }], details: {} };
      }
      if (a === "read") {
        return { content: [{ type: "text", text: getAllTables() || "表格为空" }], details: {} };
      }
      if (a === "update") {
        if (!params.table || !params.rowId || !params.col || !params.val) return { content: [{ type: "text", text: "update 需要 table + rowId + col + val" }], details: {} };
        return { content: [{ type: "text", text: updateCell(params.table, params.rowId, params.col, params.val) }], details: {} };
      }
      if (a === "delete") {
        if (!params.table || !params.rowId) return { content: [{ type: "text", text: "delete 需要 table + rowId" }], details: {} };
        return { content: [{ type: "text", text: deleteRow(params.table, params.rowId) }], details: {} };
      }
      return { content: [{ type: "text", text: `未知 action: ${a}。可用: create|read|update|delete` }], details: {} };
    },
  };
