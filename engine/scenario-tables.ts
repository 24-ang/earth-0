/**
 * 结构化记忆系统 — 移植自 deepRolePlay scenario_table_tools.py
 * 五张表 CRUD + LLM 工具
 */

import fs from "node:fs";
import path from "node:path";

// ── 类型 ──
interface Table {
  columns: string[];
  rows: Record<string, Record<string, string>>;
  desc: string;
  guide: string;
}
interface TablesData {
  tables: Record<string, Table>;
  meta: { prefixes: string[]; pIdx: number; num: number };
}

const EMPTY: TablesData = {
  tables: {
    情景表: { columns:["行号","时间","地点","事件","参与人","备注"], rows:{}, desc:"事件时间线", guide:"从上到下严格按时间发展。不明确时用相对时间T+1天。越近越详细。" },
    角色身份表: { columns:["行号","角色名","身份","年龄","性别","社会关系","备注"], rows:{}, desc:"角色基本身份", guide:"增加:建立档案。修改:理解变化。删除:不再重要。" },
    角色状态表: { columns:["行号","角色名","穿着","精确动作","情绪","精确位置"], rows:{}, desc:"角色当前状态", guide:"每轮更新。GM的感官:感觉到场景的信息。" },
    关键实体表: { columns:["行号","实体名","类别","关键信息","备注"], rows:{}, desc:"重要物品/地点/概念", guide:"追踪影响故事的关键要素。" },
    世界观表: { columns:["行号","世界知识"], rows:{}, desc:"世界规则和背景", guide:"建立理解故事的基础规则框架。" },
  },
  meta: { prefixes: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), pIdx: 0, num: 1 },
};

let data: TablesData = structuredClone(EMPTY);

function fp(world?: string): string {
  return path.join(process.cwd(), "data", "scenario", `${world || "oregairu"}_tables.json`);
}

export function initTables(world?: string): void {
  const f = fp(world);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) { try { data = JSON.parse(fs.readFileSync(f,"utf-8")); return; } catch {} }
  data = structuredClone(EMPTY);
  save(world);
}

function save(w?: string): void { const f = fp(w); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,JSON.stringify(data,null,2),"utf-8"); }

function nextId(): string {
  const m = data.meta; const id = `${m.prefixes[m.pIdx]}${m.num}`;
  m.num++; if (m.num > 999) { m.num = 1; m.pIdx = (m.pIdx + 1) % m.prefixes.length; }
  return id;
}

// ── 对外 API ──

export function createRow(table: string, row: Record<string,string>): string {
  const t = data.tables[table]; if (!t) return `表格'${table}'不存在`;
  const id = nextId(); row["行号"] = id; t.rows[id] = row; save(); return `已创建 ${table} ${id}`;
}
export function updateCell(table: string, rowId: string, col: string, val: string): string {
  const t = data.tables[table]; if (!t) return `表格'${table}'不存在`; if (!t.rows[rowId]) return `行'${rowId}'不存在`;
  t.rows[rowId][col] = val; save(); return `已更新 ${table} ${rowId} ${col}`;
}
export function deleteRow(table: string, rowId: string): string {
  const t = data.tables[table]; if (!t) return `表格'${table}'不存在`; delete t.rows[rowId]; save(); return `已删除 ${table} ${rowId}`;
}

/** 返回所有表格的可读文本（注入 GM prompt） */
export function getAllTables(): string {
  const p: string[] = [];
  for (const [n, t] of Object.entries(data.tables)) {
    p.push(`${t.desc} | ${t.columns.join("|")}`);
    for (const [rid, r] of Object.entries(t.rows))
      p.push(`${rid}|${t.columns.map(c=>r[c]||"").join("|")}`);
  }
  return p.join("\n");
}

/** 返回指定 NPC 在所有表格中的相关行 */
export function getNPCContext(npcName: string): string[] {
  const r: string[] = [];
  for (const [n, t] of Object.entries(data.tables)) {
    if (n === "世界观表") continue;
    for (const [, row] of Object.entries(t.rows)) {
      if (row["角色名"] === npcName || (row["参与人"] || "").includes(npcName))
        r.push(`[${n}] ${t.columns.map(c=>row[c]||"").join(" | ")}`);
    }
  }
  return r;
}
