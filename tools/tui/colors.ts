/**
 * colors.ts — ANSI 颜色常量 + 截断工具
 * 从旧 panel-render.ts 提取（HUD 只用了 C 和 truncAnsi，其余全部退役）
 */

export const C = {
  r:  "\x1b[0m",
  O:  "\x1b[38;5;216m",  // warm orange
  P:  "\x1b[38;5;140m",  // purple
  b:  "\x1b[38;5;117m",  // blue
  G:  "\x1b[38;5;114m",  // green
  d:  "\x1b[38;5;167m",  // red
  Y:  "\x1b[38;5;215m",  // gold
  M:  "\x1b[38;5;243m",  // gray
  W:  "\x1b[38;5;252m",  // white
  B:  "\x1b[1m",
  I:  "\x1b[3m",         // italic
};

/** 按可视宽度截断（ANSI 转义码不计宽，中文 2 列），超宽末尾加 "…" */
export function truncAnsi(s: string, width: number): string {
  let w = 0, esc = false, i = 0;
  for (; i < s.length; i++) {
    const ch = s[i]!;
    if (esc) { if (ch === "m") esc = false; continue; }
    if (ch === "\x1b") { esc = true; continue; }
    w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w > width) break;
  }
  if (i >= s.length) return s;
  return s.slice(0, i) + "…";
}
