/**
 * chafa-image.ts — ChafaImage 组件 (Layer 1)
 *
 * 用法: pi -e extensions/chafa-image.ts
 * 命令: /img <图片路径> [宽度]
 *       /img ~/tmp/test.png       默认 width=50
 *       /img /sdcard/a.jpg 40     指定宽度
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "child_process";
import { homedir } from "os";

// ANSI 转义码 strip 正则
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// 计算去掉 ANSI 码后的可见宽度
function visibleLen(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("img", {
    description: "显示图片 (chafa ANSI 字符画) — 用法: /img 路径 [宽度]",
    handler: async (args, ctx) => {
      // ── 解析参数 ──
      const raw = typeof args === "string" ? args : Array.isArray(args) ? args.join(" ") : String(args || "");
      const parts = raw.trim().split(/\s+/);
      let imgPath: string;
      let cw: number;

      // 最后一个部分如果是纯数字，当作宽度
      if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) {
        cw = parseInt(parts.pop()!, 10);
        imgPath = parts.join(" ");
      } else {
        cw = 50;
        imgPath = parts.join(" ");
      }

      if (!imgPath) {
        ctx.ui.notify("用法: /img 图片路径 [宽度]", "warning");
        return;
      }

      // ── 展开 ~ ──
      if (imgPath.startsWith("~")) {
        imgPath = homedir() + imgPath.slice(1);
      }

      // ── 限制宽度 ──
      cw = Math.max(20, Math.min(cw, 80));

      // ── 运行 chafa ──
      let ansiOutput: string;
      try {
        // 不在双引号内传路径，避免 ~ 展开问题
        ansiOutput = execSync(`chafa --size=${cw} --dither diffusion ${JSON.stringify(imgPath)}`, {
          encoding: "utf-8",
          timeout: 15000,
        });
      } catch (e: any) {
        const msg = e.stderr || e.message || String(e);
        ctx.ui.notify(`chafa 失败: ${msg.slice(0, 80)}`, "error");
        return;
      }

      if (!ansiOutput.trim()) {
        ctx.ui.notify("chafa 输出为空 — 文件存在吗？格式对吗？", "warning");
        return;
      }

      const ansiLines = ansiOutput.split("\n").filter(l => l.trim());

      // ── 覆盖层显示 ──
      ctx.ui.custom(
        (_tui: any, _theme: any, _kb: any, done: any) => ({
          render(width: number): string[] {
            const w = Math.min(width, 80);
            const boxPad = (line: string) => {
              const vl = visibleLen(line);
              if (vl >= w - 4) return `│ ${line}`; // 行太长不加 padding，防止截断 ANSI
              return `│ ${line}${" ".repeat(w - 4 - vl)} │`;
            };
            const out: string[] = [];
            const shortPath = imgPath.replace(homedir(), "~");
            out.push(`┌${"─".repeat(w - 2)}┐`);
            out.push(boxPad(`\x1b[1;36m${shortPath.slice(-(w - 8))}\x1b[0m`));
            out.push(`├${"─".repeat(w - 2)}┤`);
            for (const line of ansiLines.slice(0, 60)) {
              out.push(boxPad(line));
            }
            if (ansiLines.length > 60) {
              out.push(boxPad(`... ${ansiLines.length - 60} more lines ...`));
            }
            out.push(`└${"─".repeat(w - 2)}┘`);
            out.push("ESC/q 关闭");
            return out;
          },
          handleInput(d: string) { if (d === "\x1b" || d === "q") done(); },
          invalidate() {},
        }),
        { overlay: true }
      );
    },
  });

  console.log("[chafa-image] /img 已就绪。用法: /img 路径 [宽度]");
}
