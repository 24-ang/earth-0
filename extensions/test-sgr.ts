/**
 * test-sgr.ts — ANSI SGR 管道验证 (Phase 1)
 *
 * 用法: pi -e extensions/test-sgr.ts
 * 进入后输入 /sgr 查看 ANSI 颜色测试面板
 *
 * 目的: 确认 pi TUI 的 ctx.ui.custom() render() 返回的字符串中
 * ANSI SGR 转义码是否被保留。这是 chafa/galgame 立绘显示的前置条件。
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("sgr", {
    description: "ANSI SGR 管道测试 — 如果看到彩色则管道畅通",
    handler: async (_args, ctx) => {
      ctx.ui.custom(
        (_tui: any, _theme: any, _kb: any, done: any) => ({
          render(width: number): string[] {
            const w = Math.min(width, 80);
            const box = (s: string, visibleLen: number) =>
              "│ " + s + " ".repeat(Math.max(0, w - 4 - visibleLen)) + " │";

            const out: string[] = [];
            out.push("┌" + "─".repeat(w - 2) + "┐");
            out.push(box("\x1b[1;36m═══ ANSI SGR 管道验证 ═══\x1b[0m", 20));

            // ── 基础 16 色 ──
            out.push("├" + "─".repeat(w - 2) + "┤");
            out.push(box("基础 16 色:", 7));
            out.push(box(
              "\x1b[31m■RED\x1b[0m \x1b[32m■GREEN\x1b[0m \x1b[33m■YELLOW\x1b[0m \x1b[34m■BLUE\x1b[0m " +
              "\x1b[35m■MAGENTA\x1b[0m \x1b[36m■CYAN\x1b[0m \x1b[37m■WHITE\x1b[0m",
              53
            ));

            // ── 粗体 + 颜色 ──
            out.push(box("粗体亮色:", 6));
            out.push(box(
              "\x1b[1;31m■亮红\x1b[0m \x1b[1;32m■亮绿\x1b[0m \x1b[1;33m■亮黄\x1b[0m " +
              "\x1b[1;34m■亮蓝\x1b[0m \x1b[1;35m■亮紫\x1b[0m \x1b[1;36m■亮青\x1b[0m \x1b[1;37m■亮白\x1b[0m",
              36
            ));

            // ── 256 色调色板 ──
            out.push(box("256 色 (0-255):", 11));
            out.push(box(
              "\x1b[38;5;196m■196\x1b[0m \x1b[38;5;208m■208\x1b[0m \x1b[38;5;226m■226\x1b[0m " +
              "\x1b[38;5;46m■046\x1b[0m \x1b[38;5;51m■051\x1b[0m \x1b[38;5;21m■021\x1b[0m " +
              "\x1b[38;5;129m■129\x1b[0m \x1b[38;5;201m■201\x1b[0m \x1b[38;5;15m■015\x1b[0m",
              50
            ));

            // ── 背景色 ──
            out.push(box("背景色:", 5));
            out.push(box(
              "\x1b[48;5;22m\x1b[37m 深绿底 \x1b[0m " +
              "\x1b[48;5;52m\x1b[37m 深红底 \x1b[0m " +
              "\x1b[48;5;17m\x1b[37m 深蓝底 \x1b[0m " +
              "\x1b[48;5;235m\x1b[37m 深灰底 \x1b[0m",
              30
            ));

            // ── 模拟 chafa 输出 (盲文块 + 颜色) ──
            out.push("├" + "─".repeat(w - 2) + "┤");
            out.push(box("chafa 输出模拟 (彩色盲文块):", 17));
            out.push(box(
              "\x1b[38;5;196m⣿⣶⣦⣤⣀\x1b[0m" +
              "\x1b[38;5;208m⣿⣶⣦⣤\x1b[0m " +
              "\x1b[38;5;226m⣿⣶⣦\x1b[0m " +
              "\x1b[38;5;46m⣿⣶\x1b[0m " +
              "\x1b[38;5;21m⣿⣶⣦\x1b[0m " +
              "\x1b[38;5;129m⣿⣶⣦⣤\x1b[0m",
              30
            ));
            out.push(box(
              "\x1b[38;5;196m████\x1b[0m" +
              "\x1b[38;5;208m████\x1b[0m" +
              "\x1b[38;5;226m████\x1b[0m" +
              "\x1b[38;5;46m████\x1b[0m" +
              "\x1b[38;5;21m████\x1b[0m" +
              "\x1b[38;5;129m████\x1b[0m",
              24
            ));
            out.push(box(
              "\x1b[38;5;196m▀▀▀▀\x1b[0m" +
              "\x1b[38;5;208m▄▄▄▄\x1b[0m" +
              "\x1b[38;5;226m▀▀▀▀\x1b[0m" +
              "\x1b[38;5;46m▄▄▄▄\x1b[0m" +
              "\x1b[38;5;21m▀▀▀▀\x1b[0m" +
              "\x1b[38;5;129m▄▄▄▄\x1b[0m",
              24
            ));

            // ── 结论 ──
            out.push("├" + "─".repeat(w - 2) + "┤");
            out.push(box("\x1b[1;32m✅ 看到彩色文字 + 彩色盲文块 → SGR 管道畅通！\x1b[0m", 32));
            out.push(box("\x1b[1;31m❌ 看到 \\x1b[31m 等原始转义码 → SGR 被 strip\x1b[0m", 35));
            out.push(box("\x1b[1;33m⚠️  看到颜色但盲文是乱码 → Nerd Font 未安装\x1b[0m", 33));
            out.push("└" + "─".repeat(w - 2) + "┘");
            out.push("ESC/q 关闭 | 截图发给 Claude");
            return out;
          },
          handleInput(d: string) {
            if (d === "\x1b" || d === "q") done();
          },
          invalidate() {},
        }),
        { overlay: true }
      );
    },
  });

  // 如果 chafa 可用，也注册一个真实chafa测试命令
  pi.registerCommand("chafa", {
    description: "运行 chafa 显示真实图片 → ANSI 输出测试",
    handler: async (args, ctx) => {
      const imgPath = args?.[0] || "/sdcard/Pictures/test.png";

      let ansiOutput = "";
      try {
        const { execSync } = await import("child_process");
        ansiOutput = execSync(`chafa --size=60 "${imgPath}" 2>/dev/null || echo "chafa failed"`, {
          encoding: "utf-8",
          timeout: 10000,
        });
      } catch {
        ctx.ui.notify("❌ chafa 执行失败。用法: /chafa [图片路径]", "warning");
        return;
      }

      const ansiLines = ansiOutput.split("\n").filter(Boolean);

      ctx.ui.custom(
        (_tui: any, _theme: any, _kb: any, done: any) => ({
          render(width: number): string[] {
            const out: string[] = [];
            const w = Math.min(width, 80);
            out.push("┌" + "─".repeat(w - 2) + "┐");
            out.push("│ chafa: " + imgPath.slice(0, w - 11).padEnd(w - 4) + " │");
            out.push("├" + "─".repeat(w - 2) + "┤");
            // 直接输出 chafa 的 ANSI 行
            for (const line of ansiLines.slice(0, 40)) {
              out.push("│ " + line + " ".repeat(Math.max(0, w - 4 - line.length)) + " │");
            }
            if (ansiLines.length > 40) {
              out.push("│ ... (" + (ansiLines.length - 40) + " more lines) ... │");
            }
            out.push("└" + "─".repeat(w - 2) + "┘");
            out.push("ESC/q 关闭 | 这是 chafa 真实输出");
            return out;
          },
          handleInput(d: string) {
            if (d === "\x1b" || d === "q") done();
          },
          invalidate() {},
        }),
        { overlay: true }
      );
    },
  });

  console.log("[test-sgr] ANSI SGR 管道验证扩展已加载。输入 /sgr 开始测试。");
  console.log("[test-sgr] 如果安装了 chafa: /chafa [图片路径]");
}
