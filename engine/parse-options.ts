/**
 * 从 render_scene 输出的正文末尾解析扮演选项。
 * 纯函数，零依赖，可在 test.ts 中直接使用。
 */
export function parseRoleOptions(prose: string): { prose: string; options: string[] } {
  const sepIdx = prose.lastIndexOf("---");
  if (sepIdx === -1) return { prose, options: [] };

  const beforeSep = prose.slice(0, sepIdx).trimEnd();
  const afterSep = prose.slice(sepIdx + 3);

  const options: string[] = [];
  const lines = afterSep.split("\n");
  for (const line of lines) {
    // Match: > ① [风格]: "..." or > ① [风格]: *...*
    const m = line.match(/^>\s*[①②③④⑤⑥⑦⑧]\s*\[.+?\][:：]\s*(.+)/);
    if (m) {
      options.push(m[1].trim());
    }
  }

  if (options.length === 0) return { prose, options: [] };
  return { prose: beforeSep, options };
}
