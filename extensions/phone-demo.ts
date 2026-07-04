/**
 * phone-demo.ts — 手机桌面（接入 phone.ts 引擎真实数据）
 * pi -e ~/phone-demo.ts → /phone
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const C = {
  border:   "\x1b[38;5;240m",
  label:    "\x1b[38;5;250m",
  title:    "\x1b[1;37m",
  sel:      "\x1b[48;5;33m\x1b[1;37m",
  sms:      "\x1b[48;5;34m\x1b[1;37m",
  gallery:  "\x1b[48;5;202m\x1b[1;37m",
  twitter:  "\x1b[48;5;27m\x1b[1;37m",
  darkweb:  "\x1b[48;5;53m\x1b[1;37m",
  contacts: "\x1b[48;5;99m\x1b[1;37m",
  reset:    "\x1b[0m",
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("phone", {
    description: "手机：短信/相册/联系人/掲示板",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("../engine/state.ts");
      const {
        getPlayerPhoneData, addContact, syncContactsFromRelationships,
        markAllRead, getUnreadSummary
      } = await import("../engine/phone.ts");

      let pd = getPlayerPhoneData(gameState);
      if (!pd) {
        ctx.ui.notify("你没有手机！需要装备具有 communication 效果的物品。", "warning");
        return;
      }

      // 自动同步通讯录
      syncContactsFromRelationships(gameState, pd);
      saveState();

      let cursor = 0;
      let subApp: string | null = null;
      let contactSel = 0;
      let msgSel = 0;

      const APPS = [
        { icon: "✉", name: "短信",   color: C.sms,      detail: pd.unreadCount > 0 ? `${pd.unreadCount} 条未读` : "无新消息" },
        { icon: "📷", name: "相册",   color: C.gallery,  detail: `${pd.photos.length} 张照片` },
        { icon: "🐦", name: "掲示板", color: C.twitter,  detail: `${pd.snsPosts.length} 条动态` },
        { icon: "👤", name: "联系人", color: C.contacts, detail: `${pd.contacts.length} 人` },
      ];

      ctx.ui.custom(
        (tui: any, _theme: any, _kb: any, done: any) => {
          let w = 60;
          return {
            render(termW: number): string[] {
              w = Math.min(termW, 50);
              const out: string[] = [];
              const h = "─".repeat(w - 2);

              if (subApp === "短信") {
                out.push(`┌${h}┐`);
                out.push(`│${C.title} ✉ 短信`.padEnd(w - 2 + 16) + `${C.reset}${C.border} │${C.reset}`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                const msgs = pd!.messages.filter(m => m.to === gameState.player.name || m.from === gameState.player.name);
                if (msgs.length === 0) {
                  out.push(`│${C.border}  （无消息）${" ".repeat(w - 13)}${C.reset}│`);
                } else {
                  const show = msgs.slice(-Math.min(10, msgs.length));
                  show.forEach((m, i) => {
                    const marker = i === msgSel ? `${C.sel} ▶` : "  ";
                    const prefix = m.read ? " " : "●";
                    const sender = m.from.slice(0, 6);
                    const body = m.text.slice(0, w - 16);
                    out.push(`│${marker}${C.reset}${C.border} ${prefix}${sender.padEnd(6)} ${C.label}${body}${C.reset}${C.border} │${C.reset}`);
                  });
                }
                for (let i = msgs.length; i < 8; i++) out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} R 标记已读  ← ESC 返回${" ".repeat(w - 22)}${C.reset}│`);
                out.push(`└${h}┘`);

              } else if (subApp === "相册") {
                out.push(`┌${h}┐`);
                out.push(`│${C.title} 📷 相册 (${pd!.photos.length}张)`.padEnd(w - 2 + 16) + `${C.reset}${C.border} │${C.reset}`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                if (pd!.photos.length === 0) {
                  out.push(`│${C.border}  （还没有照片）${" ".repeat(w - 15)}${C.reset}│`);
                } else {
                  const show = pd!.photos.slice(-6);
                  show.forEach((p, i) => {
                    const marker = i === contactSel ? "▶" : " ";
                    out.push(`│${C.border} ${marker} ${p.caption.slice(0, w - 20)} ${C.label}${p.takenAt}${C.reset}${C.border} │${C.reset}`);
                  });
                }
                for (let i = pd!.photos.length; i < 6; i++) out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} ← ESC 返回${" ".repeat(w - 10)}${C.reset}│`);
                out.push(`└${h}┘`);

              } else if (subApp === "联系人") {
                out.push(`┌${h}┐`);
                out.push(`│${C.title} 👤 联系人 (${pd!.contacts.length}人)`.padEnd(w - 2 + 16) + `${C.reset}${C.border} │${C.reset}`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                pd!.contacts.forEach((c, i) => {
                  const marker = i === contactSel ? `${C.sel} ▶` : "  ";
                  out.push(`│${marker}${C.reset}${C.border} ${c.name.padEnd(8)} ${C.label}${c.number}  ${c.relation}${C.reset}${C.border} │${C.reset}`);
                });
                for (let i = pd!.contacts.length; i < 8; i++) out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} ← ESC 返回${" ".repeat(w - 10)}${C.reset}│`);
                out.push(`└${h}┘`);

              } else if (subApp === "掲示板") {
                out.push(`┌${h}┐`);
                out.push(`│${C.title} 🐦 掲示板 (${pd!.snsPosts.length}条)`.padEnd(w - 2 + 16) + `${C.reset}${C.border} │${C.reset}`);
                out.push(`├${C.border}${h}${C.reset}┤`);
                if (pd!.snsPosts.length === 0) {
                  out.push(`│${C.border}  （还没有帖子）${" ".repeat(w - 15)}${C.reset}│`);
                } else {
                  const show = pd!.snsPosts.slice(-8);
                  show.forEach((p, i) => {
                    const marker = i === contactSel ? `${C.sel} ▶` : "  ";
                    out.push(`│${marker}${C.reset}${C.border} ${C.title}${p.author}${C.reset}${C.border}: ${p.text.slice(0, w - 20)}${" ".repeat(Math.max(0, w - 20 - p.text.length))}${C.reset}│`);
                    out.push(`│${C.border}  ${C.label}${p.platform} · ${p.timestamp} · ♥${p.likes}${C.reset}${" ".repeat(Math.max(0, w - 24 - p.platform.length - p.timestamp.length))}${C.reset}│`);
                  });
                }
                for (let i = pd!.snsPosts.length; i < 6; i++) { out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`); }
                out.push(`├${C.border}${h}${C.reset}┤`);
                out.push(`│${C.border} ← ESC 返回${" ".repeat(w - 10)}${C.reset}│`);
                out.push(`└${h}┘`);

              } else {
                // 主桌面
                out.push(`┌${h}┐`);
                out.push(`│${C.title} ◆ スマートフォン`.padEnd(w - 2 + 16) + `${C.reset}${C.label} ${gameState.time.time_of_day}${" ".repeat(Math.max(0, w - 25))}${C.reset}${C.border} │${C.reset}`);
                out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);

                // 应用网格 2x2
                const cardW = 14;
                const gap = Math.floor((w - 4 - 2 * cardW) / 3);
                const pad1 = " ".repeat(gap);
                const pad2 = " ".repeat(w - 4 - 2 * cardW - gap);

                for (let row = 0; row < 2; row++) {
                  out.push(`│${C.border}${" ".repeat(w - 2)}${C.reset}│`);
                  let topRow = `│${C.border}`;
                  for (let col = 0; col < 2; col++) {
                    const idx = row * 2 + col;
                    if (idx < APPS.length) {
                      topRow += pad1;
                      if (idx === cursor) topRow += `${C.sel}┌${"─".repeat(cardW - 2)}┐${C.reset}${C.border}`;
                      else topRow += `${APPS[idx].color}┌${"─".repeat(cardW - 2)}┐${C.reset}${C.border}`;
                    }
                  }
                  topRow += pad2 + `${C.reset}│`;
                  out.push(topRow);

                  let iconRow = `│${C.border}`;
                  for (let col = 0; col < 2; col++) {
                    const idx = row * 2 + col;
                    if (idx < APPS.length) {
                      iconRow += pad1;
                      const icon = APPS[idx].icon;
                      if (idx === cursor) iconRow += `${C.sel}│${" ".repeat(6)}${icon}${" ".repeat(cardW - 9)}│${C.reset}${C.border}`;
                      else iconRow += `${APPS[idx].color}│${" ".repeat(6)}${icon}${" ".repeat(cardW - 9)}│${C.reset}${C.border}`;
                    }
                  }
                  iconRow += pad2 + `${C.reset}│`;
                  out.push(iconRow);

                  let nameRow = `│${C.border}`;
                  for (let col = 0; col < 2; col++) {
                    const idx = row * 2 + col;
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

                  let detailRow = `│${C.border}`;
                  for (let col = 0; col < 2; col++) {
                    const idx = row * 2 + col;
                    if (idx < APPS.length) {
                      detailRow += pad1;
                      const det = APPS[idx].detail.slice(0, cardW - 4);
                      if (idx === cursor) detailRow += `${C.sel}│${C.label} ${det}${" ".repeat(cardW - 4 - det.length)}${C.sel}│${C.reset}${C.border}`;
                      else detailRow += `${APPS[idx].color}│${C.label} ${det}${" ".repeat(cardW - 4 - det.length)}${APPS[idx].color}│${C.reset}${C.border}`;
                    }
                  }
                  detailRow += pad2 + `${C.reset}│`;
                  out.push(detailRow);

                  let botRow = `│${C.border}`;
                  for (let col = 0; col < 2; col++) {
                    const idx = row * 2 + col;
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
                if (d === "\x1b") { subApp = null; msgSel = 0; contactSel = 0; if (tui.requestRender) tui.requestRender(); return; }
                if (d === "r" && subApp === "短信") {
                  markAllRead(gameState, pd!);
                  saveState();
                  APPS[0].detail = "无新消息";
                  if (tui.requestRender) tui.requestRender();
                  return;
                }
                if (d === "\x1b[A" || d === "k") {
                  if (subApp === "短信") msgSel = Math.max(0, msgSel - 1);
                  else contactSel = Math.max(0, contactSel - 1);
                }
                else if (d === "\x1b[B" || d === "j") {
                  const max = subApp === "短信" ? Math.min(9, pd!.messages.length - 1) :
                    subApp === "相册" ? Math.min(5, pd!.photos.length - 1) :
                    subApp === "联系人" ? Math.min(7, pd!.contacts.length - 1) :
                    subApp === "掲示板" ? Math.min(7, pd!.snsPosts.length - 1) : 5;
                  if (subApp === "短信") msgSel = Math.min(max, msgSel + 1);
                  else contactSel = Math.min(max, contactSel + 1);
                }
                if (tui.requestRender) tui.requestRender();
              } else {
                if (d === "q") done();
                else if (d === "\x1b[D" || d === "h") cursor = Math.max(0, cursor - 1);
                else if (d === "\x1b[C" || d === "l") cursor = Math.min(APPS.length - 1, cursor + 1);
                else if (d === "\x1b[A" || d === "k") cursor = Math.max(0, cursor - 2);
                else if (d === "\x1b[B" || d === "j") cursor = Math.min(APPS.length - 1, cursor + 2);
                else if (d === "\r" || d === "\n") {
                  subApp = APPS[cursor].name;
                  contactSel = 0;
                  msgSel = 0;
                  if (subApp === "短信") markAllRead(gameState, pd!);
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
  console.log("[phone-demo] /phone 就绪 — 接入 phone.ts 引擎");
}
