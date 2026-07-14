/**
 * /hud — 统一面板：正文·选项·自身/周边/房间/行动 四页签
 *
 *   ←→ 切Tab  ↑↓ 移光标  Enter 确认  Esc 收起  1-6 直选
 *   /h 3 → 直选第3个选项（不开 overlay）
 */
import { showNPCInteractionMenu } from "./npc.ts";

const TABS = ["🛡 自身", "👥 周边", "🏠 房间", "▼ 行动"];

export default {
  description: "打开终端HUD面板（四Tab导航+行动选项 / /h 数字直选）",
  handler: async (_args: string, ctx: any) => {
    const { gameState, isSameLocation: isSL, getRoom, getNamelessNPCs } = await import("../../engine/state.ts");
    const { parseRoleOptions } = await import("../../engine/parse-options.ts");

    const prose = (gameState as any)._renderedProse || "";
    const opts = prose ? parseRoleOptions(prose) : null;
    const choices = opts?.options || [];

    // 参数解析：widget Enter 传入 "tab cursor"，如 "1 3" = 周边Tab+第3个光标
    const parts = (_args || "").trim().split(/\s+/);
    // 数字直选：/h 3 → 直接选第3个选项，不开 overlay
    if (/^\d$/.test(parts[0]!) && parts.length === 1) {
      const n = parseInt(parts[0]!) - 1;
      if (n >= 0 && n < choices.length) {
        const text = choices[n]!.text;
        ctx.chat.addSystemMessage(`玩家选择了: ${text}`);
        ctx.ui.notify(`已选择: ${text.slice(0,30)}`, "info");
        return;
      }
      ctx.ui.notify(`选项 ${parts[0]} 不存在（共 ${choices.length} 项）`, "warning");
      return;
    }

    // 如果传了 "tab cursor"，对齐起始位置
    let tab = 1;
    let cursor = 0;
    if (parts.length >= 2) {
      tab = parseInt(parts[0]!) % 4;
      cursor = Math.max(0, parseInt(parts[1]!) || 0);
    }

    const getNPCList = (): string[] => {
      const p = gameState.player; const loc = p?.location;
      if (!gameState.npcs || !loc) return [];
      return Object.entries(gameState.npcs)
        .filter(([_, n]: [string, any]) => n.alive !== false && (isSL as any)(n.currentRoom, loc))
        .map(([name]) => name);
    };

    return ctx.ui.custom((tui: any, _theme: any, _kb: any, done: any) => {
      const vw = typeof tui?.visibleWidth === "function" ? tui.visibleWidth() : 60;
      const W = Math.max(20, vw - 2);
      const tr = (s: string) => typeof tui?.truncateToWidth === "function" ? tui.truncateToWidth(s, W) : s;

      return {
        render(_w: number): string[] {
          const out: string[] = [];
          const p = gameState.player; const loc = p?.location ?? "???";

          // Tab bar
          const tabLine = TABS.map((label, i) =>
            i === tab ? `\x1b[7m\x1b[1m\x1b[38;5;216m ${label} \x1b[0m` : `\x1b[90m ${label} \x1b[0m`
          ).join("");
          out.push(tr(tabLine));

          if (tab === 0) {
            const attrs = p.attributes || {}; const eq = p.equipment || {};
            const slots = ["上衣", "下装", "鞋子", "右手", "左手"];
            const skeys = ["top", "bottom", "shoes", "right_hand", "left_hand"];
            out.push(tr(`\x1b[38;5;167m❤ ${p.hp?.current ?? "?"}/${p.hp?.max ?? "?"}\x1b[0m  AC${p.ac ?? 10}  \x1b[38;5;215m¥${p.funds ?? 0}\x1b[0m  💤${p.fatigue ?? 0}`));
            out.push(tr(`力${attrs.力量 ?? 8} 敏${attrs.敏捷 ?? 10} 体${attrs.体质 ?? 9} 智${attrs.智力 ?? 12} 感${attrs.感知 ?? 10} 魅${attrs.魅力 ?? 10}`));
            out.push(`\x1b[90m── 装备 ──\x1b[0m`);
            skeys.forEach((sk, i) => { const it = eq[sk]; out.push(tr(`  ${slots[i]}: ${it ? `\x1b[38;5;252m${it.name ?? it}\x1b[0m` : "\x1b[90m—\x1b[0m"}`)); });
            const inv = p.inventory || [];
            out.push(`\x1b[90m── 背包 ${inv.length} 件 ──\x1b[0m`);
            out.push(tr(inv.length ? `  ${inv.slice(0, 12).map((i: any) => i.name ?? i).join(", ")}${inv.length > 12 ? " …" : ""}` : `  \x1b[90m（空）\x1b[0m`));
          } else if (tab === 1) {
            const npcs = getNPCList();
            if (!npcs.length) { out.push(tr("\x1b[90m（周边无人）\x1b[0m")); }
            else for (let i = 0; i < npcs.length && i < 20; i++) {
              const name = npcs[i]!;
              const rel = p.relationships?.[name]; const a = rel?.affection ?? 0; const stage = rel?.stage ?? "陌生";
              const icon = stage === "恋人" ? "♥" : a >= 40 ? "◆" : a >= 20 ? "◇" : "·";
              out.push(tr(`${i === cursor ? " \x1b[7m\x1b[1m▶\x1b[0m " : "   "}\x1b[38;5;216m${name}\x1b[0m  \x1b[90m${icon}\x1b[0m${a} \x1b[90m${stage}\x1b[0m`));
            }
          } else if (tab === 2) {
            const rm = (getRoom as any)(loc);
            if (!rm) { out.push(tr("\x1b[90m（无房间数据）\x1b[0m")); }
            else {
              out.push(tr(`📏 ${rm.width}×${rm.height}m  ✨${(rm.atmosphere ?? "").slice(0, 30)}`));
              const cells = rm.cells || [];
              for (let y = 0; y < rm.height; y++) for (let x = 0; x < rm.width; x++) { const c = cells[y]?.[x]; if (c?.furniture) out.push(tr(`  📦 \x1b[38;5;215m${c.furniture}\x1b[0m \x1b[90m(${x},${y})\x1b[0m`)); }
              const exits: string[] = [];
              for (let y = 0; y < rm.height; y++) for (let x = 0; x < rm.width; x++) { const c = cells[y]?.[x]; if ((c?.type === "exit" || c?.type === "door") && c?.exitTo) exits.push(c.exitTo); }
              if (exits.length > 0) out.push(tr(`\x1b[38;5;114m🚪 ${exits.join(", ")}\x1b[0m`));
            }
          } else {
            if (!choices.length) { out.push(tr("\x1b[90m输入文字推进剧情后，选项自动出现\x1b[0m")); }
            else for (let i = 0; i < Math.min(choices.length, 10); i++) {
              const c = choices[i]!;
              const idx = String.fromCodePoint(0x2460 + i);
              out.push(tr(`${i === cursor ? " \x1b[7m\x1b[1m▶\x1b[0m " : "   "}${idx} ${c.text}${c.tag ? ` \x1b[38;5;140m[${c.tag}]\x1b[0m` : ""}`));
            }
          }

          out.push(tr("\x1b[90m← → 切面板  ↑↓ 移光标  Enter 确认  Esc/q 收起  1-6 直选\x1b[0m"));
          return out;
        },

        handleInput(d: string) {
          if (d === "\x1b" || d === "q") { done(); return; }
          if (d === "\x1b[D" || d === "\x1bOD" || d === "h") { tab = (tab + 3) % 4; cursor = 0; return; }
          if (d === "\x1b[C" || d === "\x1bOC" || d === "l") { tab = (tab + 1) % 4; cursor = 0; return; }
          if (d === "\x1b[A" || d === "\x1bOA" || d === "k") { cursor = Math.max(0, cursor - 1); return; }
          if (d === "\x1b[B" || d === "\x1bOB" || d === "j") { cursor++; return; }

          if (d >= "1" && d <= "6") {
            cursor = parseInt(d) - 1;
            if (tab === 3 && choices.length > 0) {
              done();
              ctx.chat.addSystemMessage(`玩家选择了: ${choices[cursor]!.text}`);
            }
            return;
          }

          if (d === "\r" || d === "\n") {
            if (tab === 1) {
              const npcs = getNPCList();
              if (!npcs.length) return;
              done();
              try { showNPCInteractionMenu(npcs[Math.min(cursor, npcs.length - 1)]!, ctx); } catch (e) { console.error("npc menu error:", e); }
            } else if (tab === 3 && choices.length > 0) {
              done();
              ctx.chat.addSystemMessage(`玩家选择了: ${choices[Math.min(cursor, choices.length - 1)]!.text}`);
            }
          }
        },

        invalidate() {},
      };
    }, { overlay: true });
  },
};
