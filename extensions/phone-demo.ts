/**
 * phone-demo.ts — 复古 ASCII 手机桌面原型
 * pi -e ~/phone-demo.ts → /phone
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const C = {
  border:   "\x1b[38;5;240m",  // 灰边框
  label:    "\x1b[38;5;250m",  // 浅灰标签
  title:    "\x1b[1;37m",      // 白标题
  sel:      "\x1b[48;5;33m\x1b[1;37m", // 蓝底白字选中
  sms:      "\x1b[48;5;34m\x1b[1;37m", // 绿底 短信
  gallery:  "\x1b[48;5;202m\x1b[1;37m", // 橙底 相册
  twitter:  "\x1b[48;5;27m\x1b[1;37m",  // 蓝底 推特
  darkweb:  "\x1b[48;5;53m\x1b[1;37m", // 紫底 暗网
  contacts: "\x1b[48;5;99m\x1b[1;37m",  // 紫蓝 联系人
  reset:    "\x1b[0m",
};

const APPS = [
  { icon: "✉", name: "短信",   color: C.sms,      detail: "3 条未读" },
  { icon: "📷", name: "相册",   color: C.gallery,  detail: "42 张照片" },
  { icon: "🐦", name: "推特",   color: C.twitter,  detail: "趋势: #千葉" },
  { icon: "👤", name: "联系人", color: C.contacts, detail: "12 人" },
  { icon: "⬛", name: "暗网",   color: C.darkweb,  detail: "🔒" },
];

export default function (pi: ExtensionAPI) {
  pi.registerCommand("phone", {
    description: "复古ASCII手机桌面",
    handler: async (_args, ctx) => {
      let cursor = 0;
      let subApp: string | null = null; // 当前打开的应用

      const contacts = ["雪之下雪乃", "由比滨结衣", "比企谷八幡", "一色彩羽", "平塚静"];
      let contactSel = 0;

      ctx.ui.custom(
        (tui: any, _theme: any, _kb: any, done: any) => {
          let w = 60;
          return {
            render(termW: number): string[] {
              w = Math.min(termW, 50);
              const out: string[] = [];
              const h = "─".repeat(w - 2);
              const p = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

              if (subApp === "短信") {
                // ── 短信子界面 ──
                out.push(`┌${h}┐`);
                out.push(`│${C.title} ✉ 短信`.padEnd(w - 2 + 16) + `${C.reset}${C.border} │${C.reset}`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                const msgs = [
                  { from: "雪之下雪乃", text: "明天的侍奉部活动..." },
                  { from: "由比滨结衣", text: "小企！便当买多了..." },
                  { from: "平塚静", text: "八幡，论文交了吗" },
                ];
                msgs.forEach((m, i) => {
                  const marker = i === contactSel ? `${C.sel} ▶` : "  ";
                  out.push(`│${marker}${C.reset}${C.border} ${m.from.padEnd(8)} ${C.label}${m.text.slice(0, w - 14)}${C.reset}${C.border} │${C.reset}`);
                });
                for (let i = msgs.length; i < 8; i++) out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} ← ESC 返回  ↑↓ 选择  ENTER 查看${" ".repeat(w - 24)}${C.reset}│`);
                out.push(`└${h}┘`);

              } else if (subApp === "相册") {
                // ── 相册子界面 ──
                out.push(`┌${h}┐`);
                out.push(`│${C.title} 📷 相册 (22张)`.padEnd(w - 2 + 16) + `${C.reset}${C.border} │${C.reset}`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                const grid = ["🏫学校", "🌸樱花", "🌊海边", "🏠自宅", "🌙夜景", "🎆花火"];
                for (let row = 0; row < 2; row++) {
                  let line = `│${C.border} `;
                  for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col;
                    if (idx < grid.length) {
                      const isSel = idx === contactSel;
                      const card = `┌────┐\n│ ${grid[idx].padEnd(2)} │\n└────┘`;
                      if (isSel) line += `${C.sel}${card}${C.reset}${C.border} `;
                      else line += `${C.border}${card} │ `;
                    }
                  }
                  // Actually this is too complex for a simple line - simplify
                }
                out.push(`│${C.border}  ┌──┐ ┌──┐ ┌──┐ ${" ".repeat(w - 22)}${C.reset}│`);
                out.push(`│${C.border}  │🏫│ │🌸│ │🌊│ ${" ".repeat(w - 22)}${C.reset}│`);
                out.push(`│${C.border}  │学校│ │樱花│ │海边│ ${" ".repeat(w - 21)}${C.reset}│`);
                out.push(`│${C.border}  └──┘ └──┘ └──┘ ${" ".repeat(w - 22)}${C.reset}│`);
                out.push(`│${C.border}  ┌──┐ ┌──┐ ┌──┐ ${" ".repeat(w - 22)}${C.reset}│`);
                out.push(`│${C.border}  │🏠│ │🌙│ │🎆│ ${" ".repeat(w - 22)}${C.reset}│`);
                out.push(`│${C.border}  │自宅│ │夜景│ │花火│ ${" ".repeat(w - 21)}${C.reset}│`);
                out.push(`│${C.border}  └──┘ └──┘ └──┘ ${" ".repeat(w - 22)}${C.reset}│`);
                for (let i = 9; i < 12; i++) out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} ← ESC 返回${" ".repeat(w - 10)}${C.reset}│`);
                out.push(`└${h}┘`);

              } else {
                // ── 主桌面 ──
                out.push(`┌${h}┐`);
                out.push(`│${C.title} ◆ スマートフォン`.padEnd(w - 2 + 16) + `${C.reset}${C.label} 18:42${" ".repeat(Math.max(0, w - 29))}${C.reset}${C.border} │${C.reset}`);
                out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`│${C.border}${" ".repeat(Math.floor((w-2-40)/2))}📶 ${C.title}IIII${C.reset}${C.border}      🔋 ${C.title}IIIIIII${C.reset}${C.border}${" ".repeat(Math.floor((w-2-40)/2))}${C.reset}│`);

                // 应用网格 2x3
                const cardW = 14; // 每个卡片宽
                const gap = Math.floor((w - 4 - 3 * cardW) / 4);
                const pad1 = " ".repeat(gap);
                const pad2 = " ".repeat(w - 4 - 3 * cardW - 2 * gap);

                for (let row = 0; row < 2; row++) {
                  out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                  // 卡片顶行
                  let topRow = `│${C.border}`;
                  for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col;
                    if (idx < APPS.length) {
                      topRow += pad1;
                      if (idx === cursor) topRow += `${C.sel}┌${"─".repeat(cardW - 2)}┐${C.reset}${C.border}`;
                      else topRow += `${APPS[idx].color}┌${"─".repeat(cardW - 2)}┐${C.reset}${C.border}`;
                    }
                  }
                  topRow += pad2 + `${C.reset}│`;
                  out.push(topRow);

                  // 图标行
                  let iconRow = `│${C.border}`;
                  for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col;
                    if (idx < APPS.length) {
                      iconRow += pad1;
                      const icon = APPS[idx].icon;
                      if (idx === cursor) iconRow += `${C.sel}│${" ".repeat(6)}${icon}${" ".repeat(cardW - 9)}│${C.reset}${C.border}`;
                      else iconRow += `${APPS[idx].color}│${" ".repeat(6)}${icon}${" ".repeat(cardW - 9)}│${C.reset}${C.border}`;
                    }
                  }
                  iconRow += pad2 + `${C.reset}│`;
                  out.push(iconRow);

                  // 名字行
                  let nameRow = `│${C.border}`;
                  for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col;
                    if (idx < APPS.length) {
                      nameRow += pad1;
                      const name = APPS[idx].name;
                      const namePad = Math.floor((cardW - 2 - name.length) / 2);
                      if (idx === cursor) nameRow += `${C.sel}│${" ".repeat(namePad)}${name}${" ".repeat(cardW - 2 - namePad - name.length)}│${C.reset}${C.border}`;
                      else nameRow += `${APPS[idx].color}│${" ".repeat(namePad)}${name}${" ".repeat(cardW - 2 - namePad - name.length)}│${C.reset}${C.border}`;
                    }
                  }
                  nameRow += pad2 + `${C.reset}│`;
                  out.push(nameRow);

                  // 详情行
                  let detailRow = `│${C.border}`;
                  for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col;
                    if (idx < APPS.length) {
                      detailRow += pad1;
                      const det = APPS[idx].detail.slice(0, cardW - 4);
                      if (idx === cursor) detailRow += `${C.sel}│${C.label} ${det}${" ".repeat(cardW - 4 - det.length)}${C.sel}│${C.reset}${C.border}`;
                      else detailRow += `${APPS[idx].color}│${C.label} ${det}${" ".repeat(cardW - 4 - det.length)}${APPS[idx].color}│${C.reset}${C.border}`;
                    }
                  }
                  detailRow += pad2 + `${C.reset}│`;
                  out.push(detailRow);

                  // 卡片底行
                  let botRow = `│${C.border}`;
                  for (let col = 0; col < 3; col++) {
                    const idx = row * 3 + col;
                    if (idx < APPS.length) {
                      botRow += pad1;
                      if (idx === cursor) botRow += `${C.sel}└${"─".repeat(cardW - 2)}┘${C.reset}${C.border}`;
                      else botRow += `${APPS[idx].color}└${"─".repeat(cardW - 2)}┘${C.reset}${C.border}`;
                    }
                  }
                  botRow += pad2 + `${C.reset}│`;
                  out.push(botRow);
                }

                out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} ${C.title}${APPS[cursor].icon} ${APPS[cursor].name}${C.reset}${C.border}  ← → ↑ ↓ 选择  ENTER 打开  q 退出${" ".repeat(Math.max(0, w - 42))}${C.reset}│`);
                out.push(`└${h}┘`);
              }
              return out;
            },
            handleInput(d: string) {
              if (subApp) {
                // 子界面操作
                if (d === "\x1b") { subApp = null; if (tui.requestRender) tui.requestRender(); return; }
                if (subApp === "短信" || subApp === "相册") {
                  if (d === "\x1b[A" || d === "k") contactSel = Math.max(0, contactSel - 1);
                  else if (d === "\x1b[B" || d === "j") contactSel = Math.min(5, contactSel + 1);
                }
                if (tui.requestRender) tui.requestRender();
              } else {
                // 桌面操作
                if (d === "q") done();
                else if (d === "\x1b[D" || d === "h") cursor = Math.max(0, cursor - 1);
                else if (d === "\x1b[C" || d === "l") cursor = Math.min(APPS.length - 1, cursor + 1);
                else if (d === "\x1b[A" || d === "k") cursor = Math.max(0, cursor - 3);
                else if (d === "\x1b[B" || d === "j") cursor = Math.min(APPS.length - 1, cursor + 3);
                else if (d === "\r" || d === "\n") {
                  const name = APPS[cursor].name;
                  if (name === "短信") { subApp = "短信"; contactSel = 0; }
                  else if (name === "相册") { subApp = "相册"; contactSel = 0; }
                }
                if (tui.requestRender) tui.requestRender();
              }
            },
            invalidate() {},
          };
        },
        { overlay: true }
      );
    },
  });
  console.log("[phone-demo] /phone 就绪 — 复古ASCII手机桌面");
}
