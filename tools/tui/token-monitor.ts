/**
 * /tokens    — 一览最近 LLM 调用的 prompt 大小 + 来源
 * /tokens N  — 查看第 N 条的完整 prompt 原文
 */

import { showPanel, wrapLine } from "../helpers.ts";
import { getAll, type PromptEntry } from "../../engine/prompt-profiler.ts";
import { fmtTokens } from "../../engine/token-counter.ts";

export default {
  description: "查看各阶段 prompt 内容。用法: /tokens [序号]",
  handler: async (args: string, ctx: any) => {
    const all = getAll();
    if (all.length === 0) {
      await showPanel(ctx, "🔍 Prompt 日志", ["（暂无数据——过一轮游戏后打 /tokens 查看）"]);
      return;
    }

    // /tokens N — 查看第 N 条的完整原文
    const n = parseInt(args || "");
    if (!isNaN(n) && n >= 1 && n <= all.length) {
      showFullPrompt(ctx, all[n - 1]!, n);
      return;
    }

    // /tokens — 一览表
    const lines: string[] = [];
    const { getNpcAgentModel } = await import("../helpers.ts");
    try {
      const rm = process.env.PI_RENDER_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
      const nm = await getNpcAgentModel();
      lines.push(`模型: P1/P3=${rm}  P2=${nm}`);
    } catch { /* best-effort */ }
    lines.push("");

    // 表头
    const headLine =
      " # │Turn│ 阶段          │  字数│ Token│maxOut│ 前 70 字";
    const sepLine =
      "───┼────┼───────────────┼──────┼──────┼──────┼────────────────────────────────";

    // 按 label 分组排序
    const order = ["P1·分类", "P2·", "P3·渲染", "P1.6·选项"];
    const sorted = [...all].sort((a, b) => {
      const oa = order.findIndex(o => a.label.startsWith(o));
      const ob = order.findIndex(o => b.label.startsWith(o));
      return oa - ob || a.turn - b.turn;
    });

    lines.push(headLine);
    lines.push(sepLine);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]!;
      const realIdx = all.indexOf(e) + 1; // 原始序号
      const num = String(realIdx).padStart(2);
      const turn = String(e.turn).padStart(4);
      const lbl = e.label.length > 14 ? e.label.slice(0, 13) + "…" : e.label.padEnd(14);
      const ch = String(e.chars).padStart(5);
      const tk = fmtTokens(e.tokens).padStart(5) + "t";
      const mo = String(e.maxOut >= 1000 ? (e.maxOut / 1000).toFixed(1) + "k" : e.maxOut).padStart(5);
      const firstLine = e.text.replace(/\n/g, " ").slice(0, 70);
      lines.push(`${num} │${turn}│ ${lbl}│ ${ch}│ ${tk}│ ${mo}│ ${firstLine}`);
    }

    // 汇总
    const totalT = all.reduce((s, e) => s + e.tokens, 0);
    const totalC = all.reduce((s, e) => s + e.chars, 0);
    lines.push(sepLine);
    lines.push(`  共 ${all.length} 次调用 · ${totalC} 字 · ~${fmtTokens(totalT)} tokens`);
    lines.push("");
    lines.push("输入 /tokens N 查看第 N 条的完整 prompt 原文");

    await showPanel(ctx, "🔍 Prompt 日志", lines);
  },
};

/** 展示完整 prompt 原文（分行，支持 ↑↓/Space 滚动） */
async function showFullPrompt(ctx: any, entry: PromptEntry, idx: number) {
  const info = [
    `T${entry.turn} · ${entry.label} · 模型: ${entry.model}`,
    `${entry.chars} 字 · ~${fmtTokens(entry.tokens)} tokens · 输出上限: ${entry.maxOut}`,
    "",
    "═══ 以下为传给 LLM 的完整 prompt ═══",
  ];

  // 按 75 字符宽度分行
  const bodyLines = entry.text.split("\n").flatMap(line => {
    if (line.length <= 75) return [line];
    return wrapLine(line, 75);
  });

  await showPanel(ctx, `🔍 Prompt #${idx} · ${entry.label}`, [...info, ...bodyLines]);
}
