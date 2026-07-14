/**
 * 从 render_scene 输出的正文末尾解析扮演选项。
 * 纯函数，零依赖，可在 test.ts 中直接使用。
 *
 * 选项格式：> ① [tag]: "text" 或 > ① [tag]: *action*
 * tag 示例：[真诚] [挑衅] [理智] [大胆] [普通] [温柔] [放置]
 */
export interface ParsedOption {
  label: string;   // 完整显示文本（含序号）如 `① "我想找到真正的自己"`
  text: string;    // 动作文本，如 `"我想找到真正的自己"`
  tag: string;     // 风格标签，如 `真诚`（不含方括号）
  index: number;   // 0-based 序号
}

export function parseRoleOptions(prose: string): { prose: string; options: ParsedOption[] } {
  const sepIdx = prose.lastIndexOf("---");
  if (sepIdx === -1) return { prose, options: [] };

  const beforeSep = prose.slice(0, sepIdx).trimEnd();
  const afterSep = prose.slice(sepIdx + 3);

  const options: ParsedOption[] = [];
  const lines = afterSep.split("\n");
  for (const line of lines) {
    // Match: > ① [tag]: "text" or > ① [tag]: *action*
    // Capture groups: 1=tag, 2=text
    const m = line.match(/^>\s*[①②③④⑤⑥⑦⑧]\s*\[(.+?)\][:：]\s*(.+)/);
    if (m) {
      options.push({
        label: `${String.fromCodePoint(0x2460 + options.length)} ${m[2].trim()}`, // ① text
        text: m[2].trim(),
        tag: m[1].trim(),
        index: options.length,
      });
    }
  }

  if (options.length === 0) return { prose, options: [] };
  return { prose: beforeSep, options };
}