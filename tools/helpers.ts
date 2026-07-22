import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { gameState, getNamelessNPCs, getCurrency, normalizeLocationName, getMergedWorldState, translateWorldState } from "../engine/state.ts";
import { getNPCContext } from "../engine/scenario-tables.ts";

/** 提取文本第一句话（到第一个句号/换行），用于 NPC agent 输出摘要 */
function extractFirstSentence(text: string): string {
  const match = text.match(/^(.+?)[。\n]/);
  return match ? match[1] + "。" : text.slice(0, 80);
}

export let pi: ExtensionAPI | null = null;
export function setPi(piInstance: ExtensionAPI) {
  pi = piInstance;
}

/** 把第一人称文本作为玩家消息推入 LLM 流水线（等价玩家打字，走 input 钩子 → Phase 1-3）。
 *  替代死掉的 ctx.chat.addSystemMessage（pi v0.74.2 的 ctx 没有 chat 属性，旧调用全部静默失效）。
 *  无条件 deliverAs:"followUp"：idle 时 pi 忽略该参数立即触发一轮；流式中排队到本轮结束。 */
export function pushUserText(text: string) {
  const t = (text ?? "").trim();
  if (!t) return;
  try {
    if (!pi) { console.error("pushUserText: pi 未注入（setPi 未调用）"); return; }
    (pi as any).sendUserMessage(t, { deliverAs: "followUp" });
  } catch (e) {
    console.error("pushUserText: sendUserMessage 失败", e);
  }
}

/** 两地间移动耗时估算（分钟）。同层房间按格距，跨房间按 origin 距离+楼层惩罚，
 *  导航树上按 breadcrumb 共享比例分档 + 名字哈希扰动（同一对地点估时稳定）。 */
export function estimateTravelMinutes(from: string, to: string): number {
  const { getRoom, getLocationNav } = require("../engine/state.ts");
  const hashDist = (a: string, b: string, min: number, range: number): number => {
    const h = (a + b).split("").reduce((s: number, c: string) => s + c.charCodeAt(0), 0);
    return min + (h % range);
  };
  const fromRoom = getRoom(from);
  const toRoom = getRoom(to);

  if (fromRoom && toRoom && fromRoom.floor === toRoom.floor) {
    const toOrigin = toRoom.origin;
    const fromPos = gameState.player.gridPos || fromRoom.origin;
    const dx = fromPos[0] - toOrigin[0];
    const dy = fromPos[1] - toOrigin[1];
    const cells = Math.sqrt(dx * dx + dy * dy);
    return Math.max(1, Math.round(cells * fromRoom.cellSize / 1.5));
  }
  if (fromRoom && toRoom) {
    const toOrigin = toRoom.origin;
    const fromOrigin = fromRoom.origin;
    const dx = fromOrigin[0] - toOrigin[0];
    const dy = fromOrigin[1] - toOrigin[1];
    const cells = Math.sqrt(dx * dx + dy * dy);
    const floorPenalty = Math.abs(fromRoom.floor - toRoom.floor);
    return Math.max(2, Math.round(cells * fromRoom.cellSize / 1.5) + floorPenalty);
  }

  const fromNav = getLocationNav(from);
  const toNav = getLocationNav(to);
  const fb: string[] = fromNav.breadcrumb || [];
  const tb: string[] = toNav.breadcrumb || [];
  // 直系祖先/后代（一方在另一方的位置链上）：走廊/楼梯级别，按层级差×2分钟。
  // 不加这条时“侍奉部→学校本体”会因校内树/世界树 breadcrumb 体系不同掉进跨城档（~113分钟）。
  const { isSameLocation } = require("../engine/state.ts");
  const fIdx = fb.findIndex((b: string) => isSameLocation(b, to));
  if (fIdx >= 0) return Math.max(2, (fb.length - fIdx) * 2);
  const tIdx = tb.findIndex((b: string) => isSameLocation(b, from));
  if (tIdx >= 0) return Math.max(2, (tb.length - tIdx) * 2);
  const sharePrefix = fb.filter((b: string) => tb.includes(b)).length;
  const maxDepth = Math.max(fb.length, tb.length, 5);
  const shareRatio = sharePrefix / maxDepth;

  if (shareRatio >= 0.9) return 1 + hashDist(from, to, 0, 5);
  if (shareRatio >= 0.7) return 2 + hashDist(from, to, 0, 6);
  if (shareRatio >= 0.5) return 3 + hashDist(from, to, 0, 27);
  if (shareRatio >= 0.3) return 30 + hashDist(from, to, 0, 60);
  return 60 + hashDist(from, to, 0, 120);
}

export const SLOT_NAMES: Record<string, string> = {
  top: "外套大衣",
  shirt: "内搭衬衫",
  inner_top: "胸罩/裹胸",
  bottom: "下装/裙子",
  inner_bot: "内裤/胖次",
  legs: "丝袜/连裤袜",
  feet: "脚部鞋子",
  head: "头部/发饰",
  acc: "配饰/挂件",
  acc2: "配饰②",
  acc3: "配饰③",
  left_hand: "副手/左手",
  right_hand: "主手/右手",
  back: "背部/背包"
};

/** TUI 面板用短标签（节省屏幕空间） */
export const SLOT_NAMES_SHORT: Record<string, string> = {
  top: "外套", shirt: "内搭", inner_top: "胸罩", bottom: "下装", inner_bot: "内裤",
  legs: "袜", feet: "鞋", head: "头饰", acc: "配饰", acc2: "配饰②", acc3: "配饰③", left_hand: "副手", right_hand: "主手", back: "背"
};

export interface MenuItem { label: string; detail?: string; action?: (done: () => void) => void | Promise<void>; }

export let lastRenderParams: {
  playerAction: string;
  resolvedChanges: string;
  sceneResult: string;
  openHooks: string;
  nextPressure: string;
  npcResponses?: string;
} | null = null;

/** 最近一次 render_scene 的正文（含选项），供 /choice 解析 */
export let lastRenderedProse: string | null = null;

export function setLastRenderParams(params: typeof lastRenderParams) {
  lastRenderParams = params;
}

export function setLastRenderedProse(prose: string) {
  lastRenderedProse = prose;
}

export { parseRoleOptions } from "../engine/parse-options.ts";

export const TUI_THEME = {
  border: "\x1b[90m",        // Gray borders
  borderActive: "\x1b[36m",   // Cyan highlighted borders
  titleText: "\x1b[1m\x1b[36m", // Bold Cyan title text
  reset: "\x1b[0m",           // Reset style
  selected: "\x1b[7m\x1b[1m\x1b[36m", // Inverse + Bold Cyan
  itemDetail: "\x1b[90m",    // Gray detail
  keyHint: "\x1b[90m",       // Gray key hints
  keyText: "\x1b[36m",       // Cyan highlight keys
  separator: "\x1b[90m",     // Gray separator lines
  hudText: "\x1b[33m",       // Yellow HUD text
};

export function getStringWidth(str: string): number {
  let w = 0;
  let i = 0;
  while (i < str.length) {
    if (str[i] === "\x1b") {
      const match = str.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (match) {
        i += match[0].length;
        continue;
      }
    }
    const c = str[i]!;
    w += c.charCodeAt(0) > 0x7f ? 2 : 1;
    i++;
  }
  return w;
}

export function truncateToWidth(str: string, maxWidth: number): string {
  let w = 0;
  let res = "";
  let i = 0;
  let hasColor = false;
  while (i < str.length) {
    if (str[i] === "\x1b") {
      const match = str.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (match) {
        res += match[0];
        hasColor = true;
        i += match[0].length;
        continue;
      }
    }
    const c = str[i]!;
    const charW = c.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w + charW > maxWidth) {
      if (hasColor) res += "\x1b[0m"; // Prevent color bleeding
      break;
    }
    res += c;
    w += charW;
    i++;
  }
  return res;
}

export function wrapLine(text: string, maxW: number): string[] {
  const res: string[] = [];
  let cur = "";
  let curW = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b") {
      const match = text.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (match) {
        cur += match[0];
        i += match[0].length;
        continue;
      }
    }
    const c = text[i]!;
    const cw = c.charCodeAt(0) > 0x7f ? 2 : 1;
    if (curW + cw > maxW) {
      res.push(cur + "\x1b[0m");
      cur = c;
      curW = cw;
    } else {
      cur += c;
      curW += cw;
    }
    i++;
  }
  if (cur) res.push(cur);
  return res;
}

export let generateCompletionOverride: ((promptText: string, maxTokens: number, ctx: any, flagModel?: string, systemPrompt?: string) => Promise<string>) | null = null;
export function setGenerateCompletionOverride(fn: typeof generateCompletionOverride) {
  generateCompletionOverride = fn;
}

let _label = "";
export function setProfileLabel(s: string) { _label = s; }

export async function generateCompletion(promptText: string, maxTokens: number, ctx: any, flagModel?: string, systemPrompt?: string): Promise<string> {
  try {
    if (_label) {
      const { record } = await import("../engine/prompt-profiler.ts");
      record(_label, flagModel || "default", promptText, maxTokens);
      _label = "";
    }
  } catch {}
  if (generateCompletionOverride) {
    return generateCompletionOverride(promptText, maxTokens, ctx, flagModel, systemPrompt);
  }
  // Try pi streamSimple first
  try {
    const { streamSimple } = await import("@earendil-works/pi-ai");
    let model: any = undefined;
    try { if (ctx?.model?.provider && ctx?.model?.id) model = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id); } catch (e) { console.error("[Phase3] ctx.modelRegistry.find FAILED:", String(e)); }
    const targetStr = flagModel || process.env.PI_RENDER_MODEL || process.env.FATE_RENDER_MODEL;
    if (targetStr && model == null) {
      try {
        if (targetStr.includes("/")) { const [p, i] = targetStr.split("/"); model = ctx.modelRegistry.find(p, i); }
        else { model = ctx.modelRegistry.getAll().find((m: any) => m.id === targetStr || m.name === targetStr); }
      } catch (e) { console.error("[Phase3] modelRegistry flag lookup FAILED:", String(e)); }
    }
    if (model) {
      try {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (auth.ok) {
          const msgs: any[] = [];
          if (systemPrompt) msgs.push({ role: "system" as const, content: systemPrompt, timestamp: Date.now() });
          msgs.push({ role: "user" as const, content: promptText, timestamp: Date.now() });
          const stream = streamSimple(model, { messages: msgs }, { apiKey: auth.apiKey, headers: auth.headers, maxTokens });
          const msg = await stream.result();
          const text = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          if (text) return text.trim();
          console.error("[Phase3] pi streamSimple returned empty text");
        } else { console.error("[Phase3] getApiKeyAndHeaders NOT OK"); }
      } catch (e) { console.error("[Phase3] pi streamSimple call FAILED:", String(e)); }
    } else { console.error("[Phase3] NO MODEL found. ctx.model:", !!ctx?.model, "flagModel:", flagModel, "PI_RENDER_MODEL:", !!process.env.PI_RENDER_MODEL); }
  } catch (e) { console.error("[Phase3] import @earendil-works/pi-ai FAILED:", String(e)); }

  // Fallback: Fetch directly using environment variables
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  // console.error("[Phase3] direct fetch fallback: apiKey set:", !!apiKey, "url:", process.env.DEEPSEEK_API_URL || "default");
  const baseUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/anthropic/v1/messages";
  const modelName = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  const fallbackMsgs: any[] = [];
  if (systemPrompt) {
    fallbackMsgs.push({ role: "system", content: systemPrompt });
  }
  fallbackMsgs.push({ role: "user", content: promptText });

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: maxTokens,
      messages: fallbackMsgs,
    }),
  });
  if (!res.ok) {
    throw new Error(`Direct fetch failed with status ${res.status}`);
  }
  const data = await res.json() as any;
  return data?.content?.[0]?.text?.trim() || "";
}

const timeOfDayZH: Record<string, string> = {
  morning: "午前", lunch: "昼", afternoon: "午後", evening: "夕方", night: "夜"
};

function buildStatusBarText(): string | null {
  try {
    if (gameState && gameState.time && gameState.player) {
      const loc = gameState.player.location;
      const cLoc = normalizeLocationName(loc);
      const npcsHereCount = Object.values(gameState.npcs || {}).filter((n: any) => normalizeLocationName(n.currentRoom) === cLoc).length;
      const namelessCount = getNamelessNPCs(loc, gameState.turn).length;
      const totalCount = npcsHereCount + namelessCount;
      // 列出同场 NPC 名（最多3个）
      const named = Object.entries(gameState.npcs || {} as any)
        .filter(([_, n]: [string, any]) => normalizeLocationName(n.currentRoom) === cLoc)
        .slice(0, 3)
        .map(([name]: [string, any]) => {
          const a = gameState.player?.relationships?.[name]?.affection ?? 0;
          return `${name}💕${a}`;
        }).join(" ") || "无人";

      return `📍 ${loc} · 👥 ${named}${namelessCount>0?` +${namelessCount}路人`:""} · turn ${gameState.turn}`;
    }
  } catch (e) {
    console.error("buildStatusBarText error:", e);
  }
  return null;
}

/** 旧一代状态条（hud-status-bar widget）已被 game-hud 常驻 HUD 取代——
 *  位置/时间/天气在收起态一行，同场 NPC 在周边 Tab。这里保留函数壳并主动清除残留，
 *  防止双 HUD 叠显（turn_end 钩子和旧 TUI 命令仍在调用）；旧命令退役后连壳一起删。 */
export function updateChatHUD(ctx: any) {
  try { ctx?.ui?.setWidget("hud-status-bar", undefined); } catch {}
}

export async function moveTo(loc: string, ctx: any, gs: any, save: any) {
  const { setPlayerLocation } = await import("../engine/state.ts");
  setPlayerLocation(loc);
  const { stampRoom } = await import("../engine/state.ts");
  stampRoom(loc);
  save(); ctx.ui.notify("📍 " + loc, "info");
  updateChatHUD(ctx);
}

export async function showPanel(ctx: any, title: string, lines: string[]): Promise<void> {
  const finalLines: string[] = [];
  for (const line of lines) {
    finalLines.push(...wrapLine(line, 65));
  }
  // 只读面板：独立的滚动视图。内容不带 ▶ 光标（不是可选菜单），↑↓ 滚动而非移光标，q/Enter/ESC 返回。
  return ctx.ui.custom(
    (tui: any, _theme: any, _kb: any, done: any) => {
      let scroll = 0;
      const PAGE = 16;
      const comp = {
        render(width: number): string[] {
          const w = Math.min(width, tui.visibleWidth?.() ?? width) - 1;
          const out: string[] = [];
          const titleW = getStringWidth(title);
          
          // Styled Top border
          const topBorder = TUI_THEME.border + "┌─" + TUI_THEME.reset + 
                            TUI_THEME.titleText + title + TUI_THEME.reset + " " +
                            TUI_THEME.border + "─".repeat(Math.max(0, w - 4 - titleW)) + "┐" + TUI_THEME.reset;
          out.push(topBorder);
          
          const maxScroll = Math.max(0, finalLines.length - PAGE);
          if (scroll > maxScroll) scroll = maxScroll;
          const view = finalLines.slice(scroll, scroll + PAGE);
          
          const total = finalLines.length;
          const visibleCount = view.length;
          const thumbHeight = Math.max(1, Math.round((visibleCount / total) * visibleCount));
          const scrollableDistance = total - visibleCount;
          const thumbStart = scrollableDistance > 0 ? Math.round((scroll / scrollableDistance) * (visibleCount - thumbHeight)) : 0;
          
          const contentW = w - 4;
          for (let i = 0; i < visibleCount; i++) {
            const l = view[i]!;
            
            // Check if this line is a sub-header or divider
            let lineContent = l;
            if (l.startsWith("──") && l.endsWith("──")) {
              // Section header
              lineContent = TUI_THEME.titleText + l + TUI_THEME.reset;
            } else if (l.startsWith("──") || l.includes("────")) {
              // General divider
              lineContent = TUI_THEME.separator + l + TUI_THEME.reset;
            }
            
            const t = truncateToWidth(lineContent, contentW);
            const pad = Math.max(0, contentW - getStringWidth(t));
            const paddedContent = t + " ".repeat(pad);
            
            let rightBorder = "│";
            if (total > PAGE) {
              const isScrollChar = i >= thumbStart && i < thumbStart + thumbHeight;
              rightBorder = isScrollChar ? "\x1b[36m█\x1b[0m" : "\x1b[90m░\x1b[0m";
            }
            
            out.push(TUI_THEME.border + "│ " + TUI_THEME.reset + paddedContent + TUI_THEME.border + " " + rightBorder + TUI_THEME.reset);
          }
          
          out.push(TUI_THEME.border + "└" + "─".repeat(w - 2) + "┘" + TUI_THEME.reset);
          
          const scrollHint = total > PAGE
            ? ` [${scroll + 1}-${Math.min(scroll + PAGE, total)}/${total}] ${TUI_THEME.keyText}↑↓/Space${TUI_THEME.keyHint} 滚动`
            : "";
          const hintText = `${TUI_THEME.keyText}q/Enter/ESC${TUI_THEME.keyHint} 返回${scrollHint}`;
          out.push(truncateToWidth(hintText, w));
          
          return out;
        },
        handleInput(d: string) {
          if (d === "\x1b" || d === "q" || d === "\r" || d === "\n") { done(); return; }
          const maxScroll = Math.max(0, finalLines.length - PAGE);
          if (d === "\x1b[A" || d === "\x1bOA" || d === "k" || d === "w") scroll = Math.max(0, scroll - 1);
          else if (d === "\x1b[B" || d === "\x1bOB" || d === "j" || d === "s") scroll = Math.min(maxScroll, scroll + 1);
          else if (d === "\x1b[5~") scroll = Math.max(0, scroll - PAGE);
          else if (d === "\x1b[6~" || d === " ") scroll = Math.min(maxScroll, scroll + PAGE);
        },
        invalidate() {},
      };
      return comp;
    },
    { overlay: true }
  );
}

export async function showMenu(ctx: any, title: string, itemsOrBuilder: MenuItem[] | (() => MenuItem[]), opts?: { style?: "box" | "hud" }): Promise<void> {
  const style = opts?.style || "box";
  return ctx.ui.custom(
    (tui: any, _theme: any, _kb: any, done: any) => {
      let sel = 0;
      const getItems = (): MenuItem[] => typeof itemsOrBuilder === "function" ? itemsOrBuilder() : itemsOrBuilder;
      let items = getItems();
      
      const isSelectable = (idx: number): boolean => {
        const item = items[idx];
        if (!item) return false;
        if (item.label.startsWith("──") || item.label.trim() === "") return false;
        const hasAnyAction = items.some(x => x && x.action);
        if (hasAnyAction && !item.action) return false;
        return true;
      };

      // Find first selectable item on start
      if (items.length > 0 && !isSelectable(sel)) {
        const first = items.findIndex((_, idx) => isSelectable(idx));
        if (first !== -1) sel = first;
      }

      const comp = {
        render(width: number): string[] {
          const out: string[] = [];
          const w = Math.min(width, tui.visibleWidth?.() ?? width) - 1;
          const titleW = getStringWidth(title);

          if (style === "hud") {
            const C = { r:"\x1b[0m", O:"\x1b[38;5;216m", G:"\x1b[38;5;114m", Y:"\x1b[38;5;215m", M:"\x1b[38;5;243m", W:"\x1b[38;5;252m", B:"\x1b[1m" };
            const gray = (s: string) => `${C.M}${s}${C.r}`;
            const hi = (s: string) => `${C.O}${s}${C.r}`;
            const head = (s: string) => `${C.M}【 ${C.r}${C.W}${C.B}${s}${C.r}${C.M} 】${C.r}`;

            out.push("");
            out.push(` ${head(title)}`);
            out.push("");

            // Status bar line
            const statusText = buildStatusBarText();
            if (statusText) {
              const statusClean = statusText.replace(/\x1b\[[0-9;]*m/g, "");
              out.push(` ${C.M}│${C.r} ${gray(statusClean)}`);
              out.push(` ${C.M}│${C.r}`);
            }

            for (let i = 0; i < items.length; i++) {
              const it = items[i]!;
              if (it.label.startsWith("──")) continue; // skip separators in HUD style
              const isSel = i === sel;
              const rail = isSel ? `${C.O}${C.B}┃${C.r}` : `${C.M}│${C.r}`;
              const bullet = isSel ? `${hi("▶")} ` : "  ";
              const detail = it.detail ? `  ${gray(it.detail)}` : "";
              const label = isSel ? `${C.O}${C.B}${it.label}${C.r}` : it.label;
              out.push(` ${rail} ${bullet}${label}${detail}`);
            }

            out.push(` ${C.M}│${C.r}`);
            out.push(` ${gray("─".repeat(46))}`);
            out.push(` ${gray("↑↓ 选择 · Enter 确认 · q/ESC 返回")}`);
            return out;
          }

          // ── Box style (original) ──
          const topBorder = TUI_THEME.border + "┌─" + TUI_THEME.reset + 
                            TUI_THEME.titleText + title + TUI_THEME.reset + " " +
                            TUI_THEME.border + "─".repeat(Math.max(0, w - 4 - titleW)) + "┐" + TUI_THEME.reset;
          out.push(topBorder);
          
          // TUI HUD Status Bar
          const statusText = buildStatusBarText();
          if (statusText) {
            const styledStatus = TUI_THEME.hudText + statusText + TUI_THEME.reset;
            const barTrunc = truncateToWidth(styledStatus, w - 4);
            const barPad = Math.max(0, (w - 4) - getStringWidth(barTrunc));
            out.push(TUI_THEME.border + "│ " + TUI_THEME.reset + barTrunc + " ".repeat(barPad) + TUI_THEME.border + " │" + TUI_THEME.reset);
            out.push(TUI_THEME.border + "├" + "─".repeat(w - 2) + "┤" + TUI_THEME.reset);
          }

          let start = Math.max(0, sel - 5);
          let end = Math.min(items.length, start + 10);
          if (end - start < 10) {
            start = Math.max(0, end - 10);
          }
          
          const total = items.length;
          const visibleCount = end - start;
          const thumbHeight = Math.max(1, Math.round((visibleCount / total) * visibleCount));
          const scrollableDistance = total - visibleCount;
          const thumbStart = scrollableDistance > 0 ? Math.round((start / scrollableDistance) * (visibleCount - thumbHeight)) : 0;

          const contentW = w - 4;
          for (let i = start; i < end; i++) {
            const it = items[i]!;
            const isSel = (i === sel);
            const isSeparator = it.label.startsWith("──");
            
            let labelStr = it.label;
            let detailStr = it.detail ? " " + it.detail : "";
            
            let lineContent = "";
            if (isSeparator) {
              lineContent = TUI_THEME.separator + labelStr + TUI_THEME.reset;
            } else {
              if (isSel) {
                lineContent = TUI_THEME.selected + "▶ " + labelStr + (detailStr ? "  " + detailStr : "") + TUI_THEME.reset;
              } else {
                lineContent = "  " + labelStr + (detailStr ? "  " + TUI_THEME.itemDetail + detailStr + TUI_THEME.reset : "");
              }
            }
            
            const t = truncateToWidth(lineContent, contentW);
            const pad = Math.max(0, contentW - getStringWidth(t));
            const paddedContent = t + " ".repeat(pad);
            
            const lineIdx = i - start;
            let rightBorder = "│";
            if (total > visibleCount) {
              const isScrollChar = lineIdx >= thumbStart && lineIdx < thumbStart + thumbHeight;
              rightBorder = isScrollChar ? "\x1b[36m█\x1b[0m" : "\x1b[90m░\x1b[0m";
            }
            
            out.push(TUI_THEME.border + "│ " + TUI_THEME.reset + paddedContent + TUI_THEME.border + " " + rightBorder + TUI_THEME.reset);
          }
          
          out.push(TUI_THEME.border + "└" + "─".repeat(w - 2) + "┘" + TUI_THEME.reset);
          
          const countStr = `${sel + 1}/${items.length}`;
          const hintText = `${countStr}  ${TUI_THEME.keyText}↑↓${TUI_THEME.keyHint} 选择 · ${TUI_THEME.keyText}Enter${TUI_THEME.keyHint} 确认 · ${TUI_THEME.keyText}q/ESC${TUI_THEME.keyHint} 返回`;
          out.push(truncateToWidth(hintText, w));
          
          return out;
        },
        handleInput(d: string) {
          if (d === "\x1b" || d === "q") { done(); return; }
          
          const hasSelectable = items.some((_, idx) => isSelectable(idx));
          
          if (d === "\x1b[A" || d === "\x1bOA" || d === "k" || d === "w") {
            if (hasSelectable) {
              const prev = sel;
              do {
                sel = sel > 0 ? sel - 1 : items.length - 1;
              } while (!isSelectable(sel) && sel !== prev);
            } else {
              sel = Math.max(0, sel - 1);
            }
          }
          else if (d === "\x1b[B" || d === "\x1bOB" || d === "j" || d === "s") {
            if (hasSelectable) {
              const prev = sel;
              do {
                sel = sel < items.length - 1 ? sel + 1 : 0;
              } while (!isSelectable(sel) && sel !== prev);
            } else {
              sel = Math.min(items.length - 1, sel + 1);
            }
          }
          else if (d === "\r" || d === "\n") {
            const it = items[sel];
            if (it?.action) {
              Promise.resolve(it.action(done)).then(() => { 
                items = getItems(); 
                sel = Math.min(sel, items.length - 1); 
                // Adjust if current item is not selectable anymore
                if (items.length > 0 && !isSelectable(sel)) {
                  const first = items.findIndex((_, idx) => isSelectable(idx));
                  if (first !== -1) sel = first;
                }
              });
            }
            else if (!items.some(x => x?.action)) done();  // 纯信息面板：回车关闭
          }
        },
        invalidate() {},
      };
      return comp;
    },
    { overlay: true }
  );
}

export async function advanceTimeMinutes(mins: number, ctx: any, gs: any, save: any) {
  const { advanceMinutes } = await import("../engine/time.ts");
  const { updateNPCSchedules, refreshWeather } = await import("../engine/state.ts");
  if (gs.time.minute_of_day === undefined) gs.time.minute_of_day = 480;
  const result = advanceMinutes(gs.time, mins);
  gs.player.age = gs.time.player_age;
  gs.turn++;
  if (gs.turn % 4 === 0) refreshWeather();
  const events = await updateNPCSchedules();
  const { tickSexStates } = await import("../engine/state.ts");
  await tickSexStates(result.daysAdvanced, mins);
  const { runWorldTick } = await import("../engine/tick.ts");
  await runWorldTick();
  gs.player.fatigue = Math.min(100, (gs.player.fatigue ?? 0) + Math.round(mins / 12));
  save();

  const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
  ctx.ui.notify(`⏱️ 时间推进了 ${mins} 分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}`, "info");
  if (events.length > 0) {
    ctx.ui.notify(`📢 事件: ${events.join("; ")}`, "info");
  }
  updateChatHUD(ctx);
}

export async function runNavigation(ctx: any, fastTravel = false) {
  const { gameState, saveState, isSameLocation, getLocationNav, getRoom } = await import("../engine/state.ts");

  const doMove = async (to: string, mins: number, subDone: () => void, parentDone: () => void) => {
    const actualMins = Math.max(1, Math.round(mins / vehicleMul));

    if (!fastTravel && mins >= 15) {
      gameState.pendingTravel = {
        from: gameState.player.location,
        to,
        route: vehicleName ? `${vehicleName}（约${actualMins}分钟）` : `步行/短途（约${mins}分钟）`,
        minutes: actualMins,
        timeOfDay: gameState.time.time_of_day
      };
      saveState();
      ctx.ui.notify(`[旅行中] 正在前往 ${to}，行程 ${actualMins} 分钟。引擎已暂停移动。`, "info");
      const vehicleHint = vehicleName ? `骑${vehicleName}，预计${actualMins}分钟到达。` : `步行约${mins}分钟。`;
      pushUserText(`玩家已出发前往 ${to}。${vehicleHint}不要立即让他们到达目的地！请描述路上的见闻、风景。等剧情差不多了，再调用 complete_travel 工具。`);
      updateChatHUD(ctx);
    } else {
      const fromLoc = gameState.player.location;
      await moveTo(to, ctx, gameState, saveState);
      await advanceTimeMinutes(actualMins, ctx, gameState, saveState);
      if (mins >= 2) {
        const vHint = vehicleName ? `（骑${vehicleName}）` : "";
        pushUserText(`[移动] ${fromLoc} → ${to}，耗时 ${actualMins} 分钟${vHint}。`);
      }
    }
    subDone();
    parentDone();
  };

  const loc = gameState.player.location;
  const known = gameState.player.known_locations || [];
  const nav = getLocationNav(loc);
  const vehicleMul = gameState.player.vehicle?.speedMul || 1;
  const vehicleName = gameState.player.vehicle?.name;

  const estTravel = estimateTravelMinutes;

  const buildNavMenu = (parentDone: () => void): MenuItem[] => {
    const items: MenuItem[] = [];

    if (nav.parent) {
      items.push({
        label: `🔼 返回 ${nav.parent}`,
        action: async (subDone) => { await doMove(nav.parent!, estTravel(loc, nav.parent!), subDone, parentDone); }
      });
    }

    if (nav.schoolTree && nav.schoolTree.length > 0) {
      items.push({ label: `── 校内建筑 ──` });
      for (const bld of nav.schoolTree) {
        items.push({
          label: `  🏫 ${bld.name}`,
          detail: `${bld.children.length} 层`,
          action: async (subDone) => {
            const floorItems: MenuItem[] = [];
            for (const fl of bld.children) {
              floorItems.push({
                label: `  📶 ${fl.name}`,
                detail: `${fl.children.length} 个房间`,
                action: async (floorDone) => {
                  const roomItems: MenuItem[] = [];
                  for (const rm of fl.children) {
                    const rmName = rm.name;
                    const here = isSameLocation(loc, rmName);
                    const rmKnown = known.some(k => isSameLocation(k, rmName));
                    const npcs = Object.entries(gameState.npcs).filter(([_, n]: any) => isSameLocation(n.currentRoom, rmName)).map(([n]) => n);
                    if (rmKnown) {
                      roomItems.push({
                        label: `  ${here ? "📍" : "🚪"} ${rmName}`,
                        detail: npcs.length > 0 ? `👥 ${npcs.join(" ")}` : "",
                        action: here ? undefined : async (roomDone) => { await doMove(rmName, 2, roomDone, floorDone); }
                      });
                    } else {
                      roomItems.push({ label: `  ❓ ${rmName}`, detail: "未探索" });
                    }
                  }
                  await showMenu(ctx, `${bld.name} ${fl.name}`, roomItems);
                }
              });
            }
            await showMenu(ctx, bld.name, floorItems);
          }
        });
      }
    }

    if (nav.rooms.length > 0) {
      items.push({ label: `── 同层房间 ──` });
      for (const r of nav.rooms) {
        if (!known.some(k => isSameLocation(k, r))) continue;
        const here = isSameLocation(loc, r);
        const npcs = Object.entries(gameState.npcs).filter(([_, n]: any) => isSameLocation(n.currentRoom, r)).map(([n]) => n);
        items.push({
          label: `  🚪 ${r}`,
          detail: (here ? "📍当前" : "") + (npcs.length > 0 ? ` 👥 ${npcs.join(" ")}` : ""),
          action: here ? undefined : async (subDone) => { await doMove(r, 2, subDone, parentDone); }
        });
      }
    }

    if (nav.children.length > 0 && !nav.schoolTree) {
      items.push({ label: `── 下属地点 ──` });
      for (const c of nav.children) {
        if (!known.some(k => isSameLocation(k, c))) continue;
        items.push({
          label: `  📂 ${c}`,
          action: async (subDone) => { await doMove(c, estTravel(loc, c), subDone, parentDone); }
        });
      }
      const unknownKids = nav.children.filter(c => !known.some(k => isSameLocation(k, c)));
      if (unknownKids.length > 0) {
        items.push({ label: `  ❓ ${unknownKids.length} 个未探索`, detail: "LLM 可以带你去" });
      }
    }

    if (nav.level === "prefecture" || nav.level === "region") {
      items.push({ label: `── 其他地区 ──` });
      const allKnown = known.filter(k => {
        const kn = getLocationNav(k);
        return kn.breadcrumb.length > 0 && !nav.breadcrumb.some(b => isSameLocation(b, k));
      });
      for (const k of allKnown.slice(0, 6)) {
        items.push({
          label: `  🗺️ ${k}`,
          action: async (subDone) => { await doMove(k, estTravel(loc, k), subDone, parentDone); }
        });
      }
    }

    if (nav.stations && nav.stations.length > 0) {
      for (const st of nav.stations) {
        items.push({ label: `── 🚃 ${st.name} | ${st.lines.join("/")} ──` });
        for (const d of st.destinations) {
          items.push({
            label: `  🚃 → ${d.name}`,
            detail: `${d.minutes}分钟`,
            action: async (subDone) => { await doMove(d.name, d.minutes, subDone, parentDone); }
          });
        }
      }
    }

    const nearbyClose = (nav.nearby || []).filter(n => n.minutes <= 8);
    if (nearbyClose.length > 0) {
      const modeIcon = vehicleName ? "🚲" : "🚶";
      const modeLabel = vehicleName ? ` | ${vehicleName}` : "";
      const speedLabel = vehicleMul > 1 ? `×${vehicleMul}` : "";
      items.push({ label: `── 周边${modeLabel} ${speedLabel} ──` });
      for (const n of nearbyClose) {
        const nKnown = known.some(k => isSameLocation(k, n.name));
        const displayMins = vehicleMul > 1 ? Math.max(1, Math.round(n.minutes / vehicleMul)) : n.minutes;
        const unit = vehicleMul > 1 ? "分" : "分钟";
        items.push({
          label: `  ${modeIcon} ${n.name}`,
          detail: `${displayMins}${unit}`,
          action: nKnown ? async (subDone) => { await doMove(n.name, n.minutes, subDone, parentDone); } : undefined
        });
      }
    }

    if (items.length === 0) {
      items.push({ label: "  （当前没有可导航的地点——LLM 可以用 create_location 扩展世界）" });
    }

    return items;
  };

  await showMenu(ctx, `🗺️ ${nav.breadcrumb.join(" ▸ ")}`, () => buildNavMenu(() => {}));
}

export async function showPhoneTUI(ctx: any, phoneItem: any) {
  const { getPlayerPhoneData, syncContactsFromRelationships, markAllRead } = await import("../engine/phone.ts");
  const { phoneAppsCatalog } = await import("../engine/state.ts");
  const phoneApps: any[] = phoneAppsCatalog;
  const { gameState } = await import("../engine/state.ts");

  const pd = getPlayerPhoneData(gameState);
  if (!pd) { ctx.ui.notify("没有手机数据", "warning"); return; }

  syncContactsFromRelationships(gameState, pd);

  const gameYear = parseInt(gameState.time.game_date.split("-")[0]) || (gameState.time.timeline_origin?.year ?? 2018);
  const isJP = true;

  function eraMatches(era: string): boolean {
    if (era === "all") return true;
    if (era === "2004-2014") return gameYear >= 2004 && gameYear <= 2014;
    if (era === "2011+") return gameYear >= 2011;
    return true;
  }
  function regionMatches(region: string): boolean {
    if (region === "all") return true;
    if (region === "jp") return isJP;
    return true;
  }

  const visibleApps = phoneApps.filter(
    (app: any) => eraMatches(app.era) && regionMatches(app.region)
  );

  function buildMessagingPanel(): MenuItem[] {
    const items: MenuItem[] = [];
    const msgs = pd.messages;
    const unread = msgs.filter(m => !m.read && m.to === gameState.player.name);
    if (unread.length > 0) {
      items.push({ label: `🆕 ${unread.length} 条未读消息`, detail: "" });
      items.push({ label: "── 收件箱 ──" });
    }
    if (msgs.length > 0) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        items.push({
          label: `${m.read ? "📩" : "🆕"}「${m.from}」${m.text}`,
          detail: m.timestamp,
        });
      }
    } else {
      items.push({ label: "📩 （收件箱是空的）" });
    }
    markAllRead(pd);
    return items;
  }

  function buildContactsPanel(): MenuItem[] {
    const items: MenuItem[] = [];
    if (pd.contacts.length > 0) {
      for (const c of pd.contacts) {
        items.push({
          label: `👤 ${c.name}`,
          detail: `${c.number} | ${c.relation}`,
        });
      }
    } else {
      items.push({ label: "（通讯录是空的）" });
    }
    return items;
  }

  function buildBoardPanel(appId: string): MenuItem[] {
    const items: MenuItem[] = [];
    if (appId === "call_log") {
      if (pd.callLog.length > 0) {
        for (let i = pd.callLog.length - 1; i >= 0; i--) {
          const cl = pd.callLog[i];
          const icon = cl.status === "missed" ? "🔴" : cl.status === "answered" ? "✅" : "📞";
          items.push({
            label: `${icon} ${cl.caller} → ${cl.callee}`,
            detail: `${cl.status} | ${cl.startTime}`,
          });
        }
      } else {
        items.push({ label: "（无通话记录）" });
      }
    } else if (appId === "bbs") {
      const flags = gameState.flags;
      if (flags.wanted) items.push({ label: "💬 【警视厅通告】您已被列为重要参考人。" });
      if (flags.steal_alert) items.push({ label: "💬 【学校通知】近期校内发生盗窃事件。" });
      if (flags.identity_exposed) items.push({ label: "💬 【匿名】有人已经知道你是谁了。" });
      if (items.length === 0) items.push({ label: "💬 【掲示板】今天没有新帖子。" });
    }
    return items;
  }

  function buildTimelinePanel(appId: string): MenuItem[] {
    const items: MenuItem[] = [];
    const platformFilter = appId === "twitter" ? "twitter" : "mixi";
    const posts = pd.snsPosts.filter(p => p.platform === platformFilter);
    if (posts.length > 0) {
      for (let i = posts.length - 1; i >= 0; i--) {
        const p = posts[i];
        items.push({
          label: `${p.author}: ${p.text}`,
          detail: `❤️${p.likes} | ${p.timestamp}`,
        });
      }
    } else {
      items.push({ label: "（时间线是空的——LLM 可以用 browse_sns 填充内容）" });
    }
    return items;
  }

  function buildGalleryPanel(): MenuItem[] {
    const items: MenuItem[] = [];
    if (pd.photos.length > 0) {
      for (const p of pd.photos) {
        items.push({
          label: `📷 ${p.caption || p.filename}`,
          detail: `${p.location} | ${p.takenAt}`,
        });
      }
    } else {
      items.push({ label: "（相册是空的）" });
    }
    return items;
  }

  const phoneMenu: MenuItem[] = [];
  const { time, weather } = gameState;
  const { getTodayCalendar } = await import("../engine/timeline.ts");
  const { getClockParts } = await import("../engine/time.ts");
  const todayEvents = getTodayCalendar();
  const clock = getClockParts(time);

  phoneMenu.push({ label: `📅 ${clock.display_date} ${clock.display_time}`, detail: "" });
  phoneMenu.push({ label: `⛅ ${clock.season}季 | ${weather.type} (${weather.temp}°C)`, detail: "" });
  if (todayEvents) {
    phoneMenu.push({ label: `📌 今日提醒: ${todayEvents}`, detail: "" });
  }
  phoneMenu.push({ label: "────────────────────────────────────────", detail: "" });

  for (const app of visibleApps) {
    phoneMenu.push({
      label: `${app.icon} ${app.label}`,
      detail: app.type,
      action: async (_done: () => void) => {
        let items: MenuItem[];
        switch (app.type) {
          case "messaging":  items = buildMessagingPanel(); break;
          case "contacts":   items = buildContactsPanel(); break;
          case "board":      items = buildBoardPanel(app.id); break;
          case "timeline":   items = buildTimelinePanel(app.id); break;
          case "gallery":    items = buildGalleryPanel(); break;
          default:           items = [{ label: "未支持的应用类型" }];
        }
        await showMenu(ctx, `📱 ${phoneItem.name} - ${app.label}`, items);
      },
    });
  }

  const unreadStr = pd.unreadCount > 0 ? ` (${pd.unreadCount}条未读)` : "";
  await showMenu(ctx, `📱 ${phoneItem.name}${unreadStr}`, phoneMenu);
}



export async function renderCombatLines(): Promise<string[]> {
  const { gameState, isSameLocation } = await import("../engine/state.ts");
  const p = gameState.player;
  const lines: string[] = [];

  // 死亡豁免（战斗核心指标）
  const ds = p.deathSaves;
  lines.push(`💀 死亡豁免: ${ds?.successes || 0} 成功 / ${ds?.failures || 0} 失败${!p.alive ? " ⚠️濒死中" : ""}`);

  // 周边 NPC 战力
  const nearbyNPCs = Object.entries(gameState.npcs).filter(([_, n]: any) => isSameLocation(n.currentRoom, p.location));
  if (nearbyNPCs.length > 0) {
    lines.push("");
    lines.push("── 周边战力 ──");
    for (const [name, npc] of nearbyNPCs as any) {
      const npcHp = npc.hp || { current: 10, max: 10 };
      const npcAttr = npc.attributes || { 力量: 10, 敏捷: 10, 体质: 10 };
      const w = npc.equipment?.right_hand || npc.equipment?.left_hand;
      const wpnStr = w?.damage ? `${w.name}(${w.damage.dice})` : "徒手";
      lines.push(`  ${name}: HP${npcHp.current}/${npcHp.max} AC${10 + Math.floor(((npcAttr.敏捷 || 10) - 10) / 2)} ${wpnStr}`);
    }
  }

  // 警报
  const flags = gameState.flags || {} as any;
  if ((flags as any).steal_alert) lines.push("⚠️ 偷窃警报生效中，NPC可能敌对！");
  if ((flags as any).school_alert) lines.push("⚠️ 校园警戒中！");

  if (lines.length === 0) lines.push("（暂无战斗数据）");
  return lines;
}


// ── 经济子面板渲染（被 /economy 收编，原 /shop /gamble /housing）──

export async function renderShopLines(): Promise<string[]> {
  const { gameState, getLocationNav, getCurrency, getRoom, shopsCatalog, economyConfig } = await import("../engine/state.ts");
  const lines: string[] = [];
  const loc = gameState.player.location;
  lines.push(`🏪 商店与打工`);
  lines.push("────────────────────────────────────────");
  lines.push(`📍 当前位置: ${loc}`);
  const shopTypes = shopsCatalog && typeof shopsCatalog === "object" ? Object.keys(shopsCatalog) : [];
  const nav = getLocationNav(loc);
  const room = getRoom(loc);
  const furnitureNames: string[] = [];
  if (room?.cells) for (const row of room.cells) for (const c of (row || [])) if (c?.furniture) furnitureNames.push(c.furniture);
  const locText = [loc, ...(nav.breadcrumb || [])].join(" ");
  const matched = shopTypes.filter(t => furnitureNames.some(f => f.includes(t) || t.includes(f)) || locText.includes(t));
  if (matched.length > 0) {
    for (const t of matched) {
      const its = (shopsCatalog as any)[t]?.items || [];
      lines.push("");
      lines.push(`🏬 ${t} (${its.length}种)`);
      for (const it of its.slice(0, 12)) lines.push(`  • ${it}`);
      if (its.length > 12) lines.push(`  ... 还有 ${its.length - 12} 种`);
    }
  } else {
    lines.push("");
    lines.push("（这附近没有可直接光顾的货架）");
    if (shopTypes.length > 0) lines.push(`世界内已知店类型: ${shopTypes.join("、")}（走到对应场所或找到相应家具再逛）`);
  }
  lines.push("");
  lines.push("────────────────────────────────────────");
  lines.push("💼 可打工种 (时薪):");
  const jobRates = (economyConfig as any)?.job_rates;
  if (jobRates && Object.keys(jobRates).length > 0) for (const [job, rate] of Object.entries(jobRates) as any) lines.push(`  • ${job}: ${getCurrency()}${rate}/小时`);
  else lines.push("  （暂无可打工种数据）");
  lines.push("────────────────────────────────────────");
  lines.push(`💰 你的余额: ${getCurrency()}${gameState.player.funds}`);
  lines.push("使用 buy_item / sell_item / work_job 工具进行交易。");
  return lines;
}

export async function renderGambleLines(): Promise<string[]> {
  const { gameState, economyConfig } = await import("../engine/state.ts");
  const { getBlackMarketPrice } = await import("../engine/gambling.ts");
  const lines: string[] = [];
  lines.push("🎲 灰色博弈与黑市状态");
  lines.push("────────────────────────────────────────");
  lines.push(` 💰 当前资金: ${gameState.player.funds} 资金`);
  const rep = gameState.player.reputation?.["underworld"] ?? 0;
  const aff = gameState.player.relationships?.["underworld_merchant"]?.affection ?? 0;
  lines.push(` 💀 地下声望: ${rep}/10  |  🤝 黑市商人好感: ${aff}/100`);
  lines.push("────────────────────────────────────────");
  lines.push("📈 可用博弈项目：");
  const games = (economyConfig as any)?.gambling?.games || { "dice_2d6": { label: "掷双骰", payout_multiplier: 2.0, difficulty_class: 12 }, "blackjack": { label: "二十一点", payout_multiplier: 2.0, difficulty_class: 14 } };
  for (const [key, config] of Object.entries(games) as any) lines.push(`  • [${key}] ${config.label}: 赔率 x${config.payout_multiplier} | 判定DC: ${config.difficulty_class}`);
  lines.push("────────────────────────────────────────");
  lines.push("⚖️ 黑市交易折扣预测：");
  const buyRate = getBlackMarketPrice("buy", 100, rep, aff);
  const sellRate = getBlackMarketPrice("sell", 100, rep, aff);
  lines.push(`  • 购入违禁品折算比率: ${buyRate}% (原价100 -> 黑市售价 ${buyRate})`);
  lines.push(`  • 出售赃物折算比率: ${sellRate}% (原价100 -> 黑市回收价 ${sellRate})`);
  return lines;
}

export async function renderHousingLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const lines: string[] = [];
  lines.push("🏠 安全屋与储物柜概览");
  lines.push("────────────────────────────────────────");
  lines.push(` 💰 当前资金: ${gameState.player.funds} 资金`);
  lines.push("────────────────────────────────────────");
  const props = gameState.player.properties || {};
  if (Object.keys(props).length === 0) {
    lines.push("  你当前名下没有任何房产或安全屋。");
    lines.push("  你可以使用 `manage_property` 购买或租用房产。");
  } else {
    for (const [id, prop] of Object.entries(props) as any) {
      const typeStr = prop.type === "own" ? "【永久产权】" : `【租赁契约 (欠费 ${prop.arrears_days}天)】`;
      lines.push(`🏠 ${prop.name} (${id}) ${typeStr}`);
      lines.push(`  • 坐落区域: ${prop.regionId}`);
      if (prop.type === "rent") lines.push(`  • 租金: ${prop.rent_fee} 资金/30天 | 下次扣租: ${prop.rent_due_date}`);
      const storage = prop.storage || [];
      const curVol = storage.reduce((s: number, i: any) => s + i.volume * i.quantity, 0);
      const curWgt = storage.reduce((s: number, i: any) => s + i.weight * i.quantity, 0);
      lines.push(`  • 储物箱体积: ${curVol.toFixed(2)}/${prop.max_volume} m³ | 承重: ${curWgt.toFixed(2)}/${prop.max_weight} kg`);
      if (storage.length === 0) lines.push("  • 储物箱内容: 空");
      else { lines.push("  • 储物柜内物品："); for (const item of storage) lines.push(`    - ${item.name} x${item.quantity} (${(item.weight * item.quantity).toFixed(1)}kg)`); }
      lines.push("────────────────────────────────────────");
    }
  }
  return lines;
}

// ── 信息子面板渲染（被 /info 收编，原 /calendar /quest /alerts /schedule /weather /memory）──

export async function renderCalendarLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const { getTodayCalendar, getActiveQuests } = await import("../engine/timeline.ts");
  const lines: string[] = [];
  lines.push(`📅 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日`);
  lines.push("────────────────────────────────────────");
  const todayEvent = getTodayCalendar();
  if (todayEvent) { lines.push("📌 今日事件"); lines.push(`  ${todayEvent}`); }
  else lines.push("📌 今日: 无特殊事件");
  lines.push("────────────────────────────────────────");
  const quests = getActiveQuests();
  lines.push(`📋 进行中的任务 (${quests.length})`);
  if (quests.length > 0) for (const q of quests) lines.push(`  ▶ ${q.id} ${q.title || ""}`);
  else lines.push("  (无)");
  lines.push("────────────────────────────────────────");
  const hooks = gameState.active_hooks || [];
  lines.push(`🔗 待触发事件: ${hooks.length}`);
  if (hooks.length > 0) for (const h of hooks.slice(0, 10)) lines.push(`  • ${h.event_id} (${h.urgency || "?"})`);
  return lines;
}

export async function renderQuestLines(): Promise<string[]> {
  const { getActiveQuests } = await import("../engine/timeline.ts");
  const { gameState } = await import("../engine/state.ts");
  const activeQuests = getActiveQuests();
  const lines: string[] = [];
  lines.push(`📋 进行中的任务: (${activeQuests.length})`);
  lines.push("────────────────────────────────────────");
  if (activeQuests.length > 0) for (const q of activeQuests) lines.push(`▶ [${q.id}] ${q.title || ""}`);
  else lines.push("  (当前没有正在进行的任务)");
  lines.push("────────────────────────────────────────");
  const hooks = gameState.active_hooks || [];
  lines.push(`🔗 等待触发的剧情钩子: (${hooks.length})`);
  if (hooks.length > 0) for (const h of hooks) lines.push(`  - ${h.event_id} (${h.urgency || "?"}) ${(h.hook_text || "").slice(0, 40)}`);
  return lines;
}

export async function renderAlertsLines(): Promise<string[]> {
  const { gameState, getDisguiseIdentity } = await import("../engine/state.ts");
  const lines: string[] = [];
  const f = gameState.flags || {} as any;
  const alerts: string[] = [];
  if ((f as any).steal_alert) alerts.push("🚨 偷窃警报生效中");
  if ((f as any).school_alert) alerts.push("🏫 校园警戒中");
  if ((f as any).identity_exposed) alerts.push("🎭 身份已暴露");
  if ((f as any).wanted) alerts.push("👮 已被通缉");
  const caught = Object.keys(f as any).filter(k => k.startsWith("steal_caught_by_"));
  if (caught.length > 0) alerts.push(`👀 偷窃目击者: ${caught.map(k => k.replace("steal_caught_by_", "")).join("、")}`);
  lines.push("🚨 当前警报状态");
  lines.push("────────────────────────────────────────");
  if (alerts.length === 0) lines.push("✅ 一切正常，无活跃警报");
  else for (const a of alerts) lines.push(a);
  lines.push("────────────────────────────────────────");
  lines.push(`当前身份: ${gameState.player.public_identity || "未公开"}`);
  const disguise = getDisguiseIdentity(gameState.player);
  if (disguise) lines.push(`🎭 装备伪装: ${disguise}`);
  return lines;
}

export async function renderScheduleLines(): Promise<string[]> {
  const { gameState, getMemoryTags } = await import("../engine/state.ts");
  const lines: string[] = [];
  const t = gameState.time;
  lines.push(`📋 NPC 日程一览 | ${t.game_date} ${t.day_of_week}曜日 ${t.time_of_day}`);
  lines.push("────────────────────────────────────────");
  const npcs = Object.entries(gameState.npcs);
  if (npcs.length === 0) { lines.push("（尚未追踪任何NPC日程）"); return lines; }
  const byLocation: Record<string, string[]> = {};
  for (const [name, npc] of npcs as any) {
    const loc = npc.currentRoom || "未知";
    if (!byLocation[loc]) byLocation[loc] = [];
    const tags = getMemoryTags(name);
    const override = npc.pendingOverride;
    let info = name;
    if (override) info += ` [🔶${override.location}]`;
    if (tags.length > 0) info += ` 🏷${tags.length}`;
    info += ` | ${npc.action || npc.scheduleGroup || "?"}`;
    byLocation[loc].push(info);
  }
  for (const [loc, names] of Object.entries(byLocation)) {
    const isHere = loc === gameState.player.location;
    lines.push(`${isHere ? "📍" : "  "} ${loc} (${names.length}人)`);
    for (const n of names.slice(0, 8)) lines.push(`    ${n}`);
    if (names.length > 8) lines.push(`    ... 还有 ${names.length - 8} 人`);
  }
  lines.push("────────────────────────────────────────");
  lines.push("🔶 = 日程覆盖中 | 🏷 = 有记忆标签 | 📍 = 当前位置");
  return lines;
}

export async function renderWeatherLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const lines: string[] = [];
  const t = gameState.time;
  const m = Number(t.game_date.split("-")[1]);
  const season = m >= 3 && m <= 5 ? "春" : m >= 6 && m <= 8 ? "夏" : m >= 9 && m <= 11 ? "秋" : "冬";
  lines.push(`🌈 天气面板`);
  lines.push("────────────────────────────────────────");
  lines.push(`📅 ${t.game_date} ${t.day_of_week}曜日 ${t.time_of_day}`);
  lines.push(`🌤 当前: ${gameState.weather?.type || "晴"}`);
  lines.push(`🌡 季节: ${season} | 温度: ${gameState.weather?.temp ?? "?"}°C`);
  lines.push("────────────────────────────────────────");
  lines.push("提示: 天气影响移动速度、NPC出没、事件触发。暴雨天NPC倾向室内，下雪天操场不可用。");
  return lines;
}

export async function renderMemoryLines(): Promise<string[]> {
  const { gameState, getMemoryTags, getOrCreateNPC } = await import("../engine/state.ts");
  const lines: string[] = [];
  lines.push("🧠 NPC 记忆标签");
  lines.push("────────────────────────────────────────");
  const npcs = Object.keys(gameState.npcs);
  let found = false;
  for (const name of npcs) {
    const npc = getOrCreateNPC(name);
    const tags = getMemoryTags(name);
    if (tags.length > 0) {
      found = true;
      lines.push(`👤 ${name} (${npc.currentRoom || "未知位置"})`);
      for (const tag of tags) lines.push(`  📌 ${tag}`);
      lines.push("");
    }
  }
  if (!found) { lines.push("（尚无NPC对你留下记忆标签）"); lines.push("记忆标签在关键剧情事件时由GM写入，注入后续NPC上下文。"); }
  return lines;
}

export async function renderQuestDetailLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const lines: string[] = [];
  const quests: Record<string, any> = gameState.quests || {};
  const entries = Object.entries(quests);
  const active = entries.filter(([, q]) => q.status === "active");
  const completed = entries.filter(([, q]) => q.status === "completed");
  const dead = entries.filter(([, q]) => q.status === "abandoned" || q.status === "expired");

  if (entries.length === 0) {
    lines.push("  (暂无任务记录)");
    lines.push("  剧情钩子接受后会变成任务，通过 open_quest 开启");
    return lines;
  }

  if (active.length > 0) {
    lines.push(`◆ 进行中 (${active.length})`);
    for (const [, q] of active) {
      lines.push(`  ▸ ${q.title || q.id}`);
      if (q.current_beat) lines.push(`    当前阶段: ${q.current_beat}`);
      const nOutcomes = Object.keys(q.outcomes || {}).length;
      lines.push(`    第${q.started_day}天开始  ·  已选择${nOutcomes}个分支`);
    }
  }

  if (completed.length > 0) {
    lines.push(`✓ 已完成 (${completed.length})`);
    for (const [, q] of completed) {
      lines.push(`  — ${q.title || q.id}`);
    }
  }

  if (dead.length > 0) {
    lines.push(`✗ 已结束 (${dead.length})`);
    for (const [, q] of dead) {
      lines.push(`  — ${q.title || q.id} [${q.status}]`);
    }
  }

  const completed2 = gameState.completed_events || [];
  const dynamics2 = gameState.dynamicEvents || [];
  if (completed2.length > 0 || dynamics2.length > 0) {
    lines.push("");
    lines.push(`📜 事件记录: 已完成${completed2.length}个 · 动态${dynamics2.length}个`);
  }

  return lines;
}

export async function renderHookDetailLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const lines: string[] = [];
  const hooks: any[] = gameState.active_hooks || [];

  if (hooks.length === 0) {
    lines.push("  (暂无等待触发的剧情钩子)");
    lines.push("  随着游戏推进，新的剧情钩子会自动出现");
    lines.push("  最多同时存在 3 个，高优先级先出");
    return lines;
  }

  lines.push(`当前 ${hooks.length} 个钩子（最多 3 个）`);
  lines.push("");

  const I: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
  const U: Record<string, string> = { high: "紧急", medium: "普通", low: "低优先" };

  for (const h of hooks) {
    const icon = I[h.urgency] || "⚪";
    lines.push(`${icon} [${U[h.urgency] || h.urgency}] ${h.hook_text || h.event_id}`);
    if (h.source_npc) lines.push(`  来源NPC: ${h.source_npc}`);
    if (h.novelty) lines.push(`  新意: ${h.novelty}`);
    const created = h.created_day;
    const expires = h.expires_day;
    if (created != null && expires != null) {
      const window2 = expires - created;
      lines.push(`  有效期: 第${created}天 → 第${expires}天（窗口${window2}天）`);
    }
    if (h.seen_count > 0) lines.push(`  已呈现${h.seen_count}次`);
    if (h.iconic_lines?.length) {
      lines.push(`  标志台词: 「${h.iconic_lines[0]}」`);
    }
  }

  return lines;
}

export async function renderWoundDetailLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const wounds: any[] = gameState.player.wounds || [];
  const lines: string[] = [];
  if (!wounds.length) {
    lines.push("  (无伤势)");
    return lines;
  }
  lines.push(`当前 ${wounds.length} 处伤势`);
  for (const w of wounds) {
    const sevIcon = w.severity === "重伤" || w.severity === "危重" ? "🔴" : w.severity === "中度" ? "🟡" : "🟢";
    lines.push(`  ${sevIcon} [${w.severity || "轻伤"}] ${w.text || w.name || w.bodyPart || ""}`);
    if (w.source) lines.push(`    来源: ${w.source}`);
  }
  lines.push("");
  lines.push("伤势影响战斗和行动能力，随时间或治疗恢复");
  return lines;
}

export async function renderOrgBrowserLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const orgs: Record<string, any> = gameState.organizations || {};
  const entries = Object.entries(orgs).filter(([, o]: any) => !o.archived);
  const archived = Object.entries(orgs).filter(([, o]: any) => o.archived);
  const lines: string[] = [];
  if (!entries.length && !archived.length) {
    lines.push("  (无已知组织)");
    return lines;
  }

  if (entries.length > 0) {
    lines.push(`🏛️ 活跃组织 (${entries.length})`);
    const bySector: Record<string, any[]> = {};
    for (const [, o] of entries) {
      const sec = (o as any).sector || "其他";
      if (!bySector[sec]) bySector[sec] = [];
      bySector[sec].push(o);
    }
    for (const [sec, list] of Object.entries(bySector)) {
      lines.push(`── ${sec} (${list.length}) ──`);
      for (const o of list) {
        const scale = (o as any).scale || "?";
        lines.push(`  ▸ ${(o as any).name || (o as any).id}  [${scale}]`);
        lines.push(`    影响力${(o as any).influence||0} · 凝聚力${(o as any).cohesion||0} · 公信力${(o as any).public_legitimacy||0}`);
        if ((o as any).leader) lines.push(`    领袖: ${(o as any).leader}`);
        if ((o as any).lifecycle_stage) lines.push(`    阶段: ${(o as any).lifecycle_stage}`);
      }
    }
  }

  if (archived.length > 0) {
    lines.push("");
    lines.push(`💀 已消亡组织 (${archived.length})`);
    for (const [, o] of archived) {
      lines.push(`  — ${(o as any).name || (o as any).id} [${(o as any).scale || "?"}]`);
    }
  }

  return lines;
}

export async function renderWorldLines(): Promise<string[]> {
  const { gameState, translateWorldState } = await import("../engine/state.ts");
  const lines: string[] = [];
  const ws = gameState.worldState;
  if (!ws) { lines.push("  （暂无世界状态数据）"); return lines; }
  lines.push(`🌍 当前位置大势`);
  if (ws.regime) lines.push(`  政权 │ ${ws.regime}`);
  if (ws.prosperity != null) lines.push(`  繁荣 │ ${ws.prosperity}`);
  if (ws.stability != null) lines.push(`  稳定 │ ${ws.stability}`);
  if (ws.tension != null) lines.push(`  紧张 │ ${ws.tension}`);
  if (ws.tech != null) lines.push(`  科技 │ ${ws.tech}`);
  const desc = translateWorldState ? translateWorldState(ws) : "";
  if (desc) { lines.push(""); lines.push(desc); }
  return lines;
}

export async function renderStoryLogLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const lines: string[] = [];
  const ssf = gameState.storySoFar || "";
  const tlog = gameState.turnLog || [];

  if (ssf) {
    lines.push("── 📖 故事摘要 ──");
    const chunks = ssf.match(/.{1,60}/g) || [ssf];
    for (const ch of chunks) lines.push(`  ${ch}`);
    lines.push("");
  }

  if (tlog.length > 0) {
    lines.push(`── 📋 最近回合 (共${tlog.length}条) ──`);
    const recent = tlog.slice(-12).reverse();
    for (const entry of recent) {
      const tNum = entry.turn || "?";
      const ts = entry.timestamp || "";
      lines.push(`  T${tNum} ${ts} │ ${entry.playerAction || "?"}`);
      if (entry.resolvedChanges && entry.resolvedChanges !== "无") lines.push(`       │ ${entry.resolvedChanges}`);
      if (entry.sceneResult) lines.push(`       │ ${entry.sceneResult}`);
    }
  }

  if (!ssf && !tlog.length) {
    lines.push("  (暂无故事记录)");
    lines.push("  随着游戏推进，回合日志和摘要会自动生成");
  }

  return lines;
}

export async function renderAchievementLines(): Promise<string[]> {
  const { gameState } = await import("../engine/state.ts");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const lines: string[] = [];
  const flags = gameState.flags || {};
  const achPath = path.resolve(process.cwd(), "data", "achievements.json");
  let rules: { id: string; name: string; description: string }[] = [];
  try { rules = JSON.parse(fs.readFileSync(achPath, "utf-8")); } catch { lines.push("（成就数据读取失败）"); return lines; }
  if (!rules.length) { lines.push("（成就系统尚未配置）"); return lines; }
  const unlocked = rules.filter(r => !!flags[r.id]);
  const locked = rules.filter(r => !flags[r.id]);
  lines.push(`🏆 成就 · ${unlocked.length}/${rules.length} 已解锁`);
  lines.push("────────────────────────────────────────");
  if (unlocked.length > 0) {
    for (const a of unlocked) lines.push(`  🏆 ${a.name} — ${a.description}`);
  } else {
    lines.push("  （暂无已解锁成就）");
  }
  if (locked.length > 0) {
    lines.push("────────────────────────────────────────");
    lines.push(`🔒 未解锁 (${locked.length})`);
    for (const a of locked.slice(0, 20)) lines.push(`  🔒 ${a.name}`);
    if (locked.length > 20) lines.push(`  … 还有 ${locked.length - 20} 项`);
  }
  return lines;
}

export async function getNpcAgentModel(): Promise<string> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cfgPath = path.resolve(process.cwd(), "data", "rendering.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      if (cfg.model_mappings?.npc_agent_model) return cfg.model_mappings.npc_agent_model;
      if (cfg.model_mappings?.narrative_render_model) return cfg.model_mappings.narrative_render_model;
    }
  } catch (e) { console.error("getNpcAgentModel: rendering.json read error", e); }
  return "deepseek/deepseek-v4-flash";
}

/** NPC Agent 角色动机 prompt 块（共用） */
export const NPC_MOTIVATION_PROMPT = [
  "【角色动机 — 嘴上那套不是动机】",
  "先想清楚：你现在说的/做的不一定是真心的——那可能是保护壳。追问：你在保护什么？",
  "① 嘴上那套: 你此刻在说什么/做什么？（嘴硬/傲娇/冷淡/说教/岔开话题——这些都是防御，不是目标）",
  "② 真正想要的（内驱力）: 你内心深处在追什么？（被认可/怕被冷落/想保护某人/试探底线/掩饰不安/确认自己的位置）",
  "  提示: 如果你嘴上在挑刺，你可能怕被拒绝；如果你在说教，你可能想确认自己的价值；如果你沉默，你可能在等对方先表态。",
  "③ 潜台词强度(beneath 0-3): 这轮你的真心藏得多深？",
  "  0-1 = 淡淡的小心思，一个微妙的停顿或移开视线就够了。",
  "  2-3 = 嘴上说的和心里想的完全相反。表面一套+深层一套，用两个互相矛盾的小动作泄漏真相。",
  "④ 行为泄漏: 哪个具体的小动作会出卖你？（停顿的时长、移开视线的方向、放杯子力道重了一点、话说到一半咽回去）",
].join("\n");

/** 为单个 NPC 提取社交情境约束标签 */
export async function getSocialContextTagsForNPC(
  npcName: string,
  socialContext: any,
): Promise<string> {
  if (!socialContext) return "";
  try {
    const { SEX_PROFILES, getSocialContextTags } = await import("../engine/sex.ts");
    const { getOrCreateSexState } = await import("../engine/state.ts");
    const profile = SEX_PROFILES[npcName];
    if (!profile) return "";
    const sState = await getOrCreateSexState(npcName);
    if (!sState) return "";
    return getSocialContextTags(profile, sState, {
      trigger: socialContext.trigger,
      exposure: socialContext.exposure,
      setting: socialContext.setting,
      present: socialContext.present || [],
      firstTime: socialContext.firstTime ?? true,
      worldliness: socialContext.worldliness,
    });
  } catch (e) {
    console.error("getSocialContextTagsForNPC error:", e);
    return "";
  }
}

/** 记录 NPC Agent 自主发言: memory tag + 角色状态表 + saveState */
export async function recordNpcAgentAction(
  npcName: string,
  response: string,
  outfit: string,
  location: string,
): Promise<void> {
  try {
    const { addMemoryTag, saveState, isSameLocation, appendShortTermBuffer } = await import("../engine/state.ts");
    
    // 1. 扫描当前在场的其他 NPC 作为 related_npcs
    const normalizedLoc = normalizeLocationName(location);
    const relatedNPCs = Object.entries(gameState.npcs || {})
      .filter(([name, n]) => name !== npcName && n.alive && n.currentRoom && normalizeLocationName(n.currentRoom) === normalizedLoc)
      .map(([name]) => name);

    // 2. 分析语气与情感倾向 (根据文本粗略映射)
    let emotionalValence: "positive" | "negative" | "neutral" = "neutral";
    const cleanResponse = response.toLowerCase();
    if (cleanResponse.includes("谢谢") || cleanResponse.includes("开心") || cleanResponse.includes("喜欢") || cleanResponse.includes("感激") || cleanResponse.includes("高兴")) {
      emotionalValence = "positive";
    } else if (cleanResponse.includes("讨厌") || cleanResponse.includes("生气") || cleanResponse.includes("愧疚") || cleanResponse.includes("受伤") || cleanResponse.includes("难过") || cleanResponse.includes("烦人")) {
      emotionalValence = "negative";
    }

    // 3. 写入长期记忆
    addMemoryTag(
      npcName,
      `[Agent自主发言] ${extractFirstSentence(response)}`,
      7,                // 默认 7 天过期
      undefined,        // tone
      1,                // priority (1 = 日常)
      emotionalValence,
      relatedNPCs,
      "general"         // category
    );

    // 4. 追加对话到自身的 shortTermBuffer 对话缓冲中
    try {
      appendShortTermBuffer(npcName, `${npcName}: "${response.slice(0, 100)}"`, undefined);
      
      // 5. 【社交广播】：也将其余在场 NPC 的短期对话缓冲同步追加（让其他人“听到”这句发言）
      for (const otherNpc of relatedNPCs) {
        appendShortTermBuffer(otherNpc, `${npcName}: "${response.slice(0, 100)}"`, undefined);
      }
    } catch (e) {
      console.error("recordNpcAgentAction appendShortTermBuffer error:", e);
    }

    try {
      const { createRow } = await import("../engine/scenario-tables.ts");
      createRow("角色状态表", {
        角色名: npcName,
        穿着: (outfit || "").slice(0, 30),
        精确动作: response.slice(0, 60),
        情绪: "",
        精确位置: location,
      });
    } catch (err) { console.error("recordNpcAgentAction: createRow error", err); }
    saveState();
  } catch (err) { console.error("recordNpcAgentAction: addMemoryTag error", err); }
}

/** 自动切换 mode：intimate_touch/masturbate 调用时切 sex，战斗时切 rpg */
export function autoSwitchMode(toolName: string): void {
  const sexTools = ["intimate_touch", "masturbate"];
  const combatTools = ["combat_action"];
  if (sexTools.includes(toolName) && gameState.mode !== "sex") {
    gameState._prevMode = gameState.mode;
    gameState.mode = "sex";
    gameState.layer1Enabled = true;
  } else if (combatTools.includes(toolName) && gameState.mode !== "rpg") {
    gameState._prevMode = gameState.mode;
    gameState.mode = "rpg";
  }
}

/** 构建"在场人物"行（玩家+其他NPC描述），供 NPC Agent prompt 使用 */
export async function buildPresentLine(gs: any, npcHeight: number, otherNPCs: string[]): Promise<string> {
  const { getBodyForAge, getNpcCurrentAge, getAppearanceForAge, findCharacter, getVisibleBodyDescription, getNPCVisibleBodyDescription, getNamelessNPCs, getNPCOutfitDesc } = await import("../engine/state.ts");
  const hDiff = (h: number) => h > npcHeight + 8 ? "需仰视" : h > npcHeight + 3 ? "稍高" : h < npcHeight - 8 ? "需俯视" : h < npcHeight - 3 ? "稍矮" : "";

  // 1. 玩家描述
  const pBody = (gs.player as any).body || getBodyForAge({ base_age: gs.player.age || 17 }, gs.player.age || 17);
  const pBuild = pBody?.build || "普通";
  const pH = hDiff(pBody?.height_cm || 172);
  const pEquip = gs.player.equipment || {};
  const hasTop = !!pEquip.top || !!pEquip.shirt;
  const hasBottom = !!pEquip.bottom;
  const pTop = pEquip.top || (pEquip.inner_top && !hasTop ? "[内衣]" : "");
  const pBot = pEquip.bottom || "";
  const pOutfit = [pTop, pBot].filter(Boolean).join("+") || "便服";
  const outfitNote = (!hasTop && !hasBottom) ? "（全裸）" : (!hasTop || !hasBottom) ? "（衣着不整）" : "";
  const genderLabel = gs.player.gender === "女" ? "女性" : gs.player.gender === "男" ? "男性" : (gs.player.gender || "");

  // 伤口和血量
  const wounds = gs.player.wounds || [];
  const woundNote = wounds.length > 0 ? `，身上有伤: ${wounds.map((w: any) => `${w.severity || ''}${w.text || w.desc || w.type}`).filter(Boolean).join("、")}` : "";
  const pHp = gs.player.hp || {};
  const hpNote = pHp.current !== undefined && pHp.max !== undefined && pHp.current < pHp.max ? `，血量${pHp.current}/${pHp.max}` : "";

  let list = `在场人物: 玩家（${[genderLabel, pBuild, pH, pOutfit + outfitNote + woundNote + hpNote].filter(Boolean).join("·")}）`;

  const visibleBody = getVisibleBodyDescription();
  if (visibleBody) list += `\n[玩家身体暴露] ${visibleBody}`;

  // 2. 其他NPC描述
  for (const oName of otherNPCs) {
    const oSrc = findCharacter(oName);
    if (!oSrc) { list += `、${oName}`; continue; }
    const oAge = getNpcCurrentAge(oSrc.base_age || 16);
    const oHeight = getBodyForAge(oSrc, oAge)?.height_cm || 160;
    const oApp = getAppearanceForAge(oSrc, oAge);
    
    const oOutfit = getNPCOutfitDesc(oName) || "";
    const oDescParts = [oApp?.build];
    const hair = [oApp?.hair_color, oApp?.hair_style].filter(Boolean).join("");
    if (hair) oDescParts.push(hair);
    if (oOutfit) oDescParts.push(oOutfit);
    const oDesc = oDescParts.filter(Boolean).join("·") || oName;
    
    const oH = hDiff(oHeight);
    const oBody = getNPCVisibleBodyDescription(oName);
    const oBodyExtra = oBody ? `，${oBody}` : "";
    list += `、${oName}（${[oDesc, oH].filter(Boolean).join("·")}${oBodyExtra}）`;
  }

  // 3. 在场路人
  const nameless = getNamelessNPCs(gs.player.location, gs.turn || 1);
  if (nameless.length > 0) {
    const namelessBrief = nameless.map((n: any) => `${n.name}(${n.act})`).join("、");
    list += `\n[在场路人] ${namelessBrief}`;
  }

  return list + "。";
}

/** NPC Agent 今天的生活上下文：星期、天气、性格、参考地点 */
export function buildTodayContext(gs: any, npcName: string, npc: any, src: any): string {
  const dayNames: Record<string, string> = {
    "月": "月曜日", "火": "火曜日", "水": "水曜日",
    "木": "木曜日", "金": "金曜日", "土": "土曜日", "日": "日曜日"
  };
  const todayInfo = dayNames[gs.time.day_of_week] || gs.time.day_of_week;
  const weather = `${gs.weather?.type || "晴"} ${gs.weather?.temp ?? 18}°C`;
  const season = (() => {
    const m = parseInt((gs.time.game_date || "").split("-")[1]) || 4;
    if (m >= 3 && m <= 5) return "春";
    if (m >= 6 && m <= 8) return "夏";
    if (m >= 9 && m <= 11) return "秋";
    return "冬";
  })();

  const lines = [`今天是${todayInfo}，${weather}，${season}。`];

  if (gs.time.day_of_week === "金") lines.push("今天是金曜日——周末前夕，放学后是社交高峰。");
  if (gs.time.day_of_week === "水") lines.push("水曜日是短缩授课日，下午很早放学。");
  if (gs.time.day_of_week === "月") lines.push("月曜日——新一周的开始。");

  const personality = src?.personality_brief || "";
  if (personality) lines.push(`你的性格: ${personality.slice(0, 80)}`);

  const recentMemories = (npc.memoryTags || []).slice(-3).map((m: any) => m.tag).join("；");
  if (recentMemories) lines.push(`最近记得: ${recentMemories}`);

  if (npc.pendingOverride) {
    lines.push(`你已有安排: ${npc.pendingOverride.action || ""}，去 ${npc.pendingOverride.location || ""}`);
  }

  const rel = gs.player?.relationships?.[npcName];
  if (rel && rel.stage !== "陌生") {
    lines.push(`与 ${gs.player.name || "玩家"} 的关系: ${rel.stage}（好感${rel.affection ?? 0}）`);
  }

  // 注入组织/势力立场与阶级内心冲突上下文 (实现 NPC "挣扎与撕裂" 的心智感知基础)
  try {
    const localWs = getMergedWorldState(npc.currentRoom || "");
    const wsText = translateWorldState(localWs);
    if (wsText) {
      lines.push(wsText);
    }

    const orgs = gs.organizations;
    const socialClass = src?.social_class || npc?.social_class || "普通市民";
    const personalAxes = src?.personal_axes || npc?.personal_axes || { "经济立场": 0, "政治立场": 0 };
    lines.push(`你的阶级基本盘: ${socialClass} | 个人理念轴: 经济立场:${personalAxes["经济立场"]}, 政治立场:${personalAxes["政治立场"]}`);

    if (orgs) {
      const npcOrgs: string[] = [];
      for (const [id, org] of Object.entries(orgs) as [string, any][]) {
        if (org.members?.some((m: any) => m.npcName === npcName)) {
          const rep = gs.player?.reputation?.[id] ?? 0;
          let repStr = "中立";
          if (rep <= -2) repStr = `敌对(声望:${rep})`;
          else if (rep >= 4) repStr = `掌权/核心(声望:${rep})`;
          else if (rep >= 1) repStr = `友好(声望:${rep})`;
          else if (rep === -1) repStr = `疏离/警惕(声望:${rep})`;
          
          const lcIcons: Record<string, string> = { "萌芽": "🌱", "初创": "🌿", "成长": "🌳", "成熟": "🏛️", "衰退": "🥀", "消亡": "💀" };
          let orgLine = `• 【${org.name}】[${org.scale || "?"}] ${lcIcons[org.lifecycle_stage || "初创"] || ""}${org.lifecycle_stage || "?"}期 (你的角色: ${org.members.find((m: any) => m.npcName === npcName)?.role || "成员"}) | 玩家声望: ${repStr}`;
          if (org.goals?.currentPhaseGoal) {
            orgLine += ` | 势力当前阶段目标: ${org.goals.currentPhaseGoal}`;
          }

          // 核心观念冲突校验
          const econDiff = Math.abs((personalAxes["经济立场"] ?? 0) - (org.organizationalAxes?.["经济立场"] ?? 0));
          const polDiff = Math.abs((personalAxes["政治立场"] ?? 0) - (org.organizationalAxes?.["政治立场"] ?? 0));
          if (econDiff >= 3 || polDiff >= 3) {
            if (localWs.prosperity < 0 || localWs.stability < 0) {
              orgLine += `\n  ⚠️ [内心冲突] 由于当前环境萧条动荡（繁荣度:${localWs.prosperity},稳定度:${localWs.stability}），作为【${socialClass}】且个人理念偏向【经济立场:${personalAxes["经济立场"]}, 政治立场:${personalAxes["政治立场"]}】的你，执行组织【${org.name}】（其理念为经济立场:${org.organizationalAxes?.["经济立场"]}, 政治立场:${org.organizationalAxes?.["政治立场"]}）的任务时，内心产生了强烈的挣扎与良心动摇。请在行动和言语中真实展现这种抗拒与心理撕裂感。`;
            }
          }
          npcOrgs.push(orgLine);
        }
      }
      if (npcOrgs.length > 0) {
        lines.push(`你所属的势力/组织及玩家的声望立场:\n${npcOrgs.join("\n")}`);
      }
    }
  } catch (e) {
    console.error("buildTodayContext organizations injection failed:", e);
  }

    // ── 玩家组织身份（Phase 2 NPC Agent 感知）──
  const playerMemberships = gs.player?.memberships;
  if (playerMemberships && playerMemberships.length > 0) {
    const msLines = playerMemberships.map(function(m) {
      var tier = m.rank >= 10 ? "[领袖]" : m.rank >= 7 ? "[核心]" : m.rank >= 4 ? "[成员]" : "[外围]";
      var orgName = gs.organizations?.[m.orgId]?.name || m.orgId;
      return tier + " " + orgName + " — " + m.role + " (rank:" + m.rank + ")";
    });
    lines.push("那个叫" + (gs.player?.name || "??") + "的人是: " + msLines.join(" | "));
    lines.push("你应该根据对方的组织身份决定对他的态度——同组织成员视他为同伴，敌对组织成员视他为威胁。你自己的组织立场(organizationalAxes)与他不同时，你在与他互动时可能有内心挣扎。");
  }

  const group = npc.scheduleGroup || src?.schedule_group || "";
  const isStudent = group.includes("学生") || group.includes("高校生") || group.includes("部员") || group.includes("大学");
  const isTeacher = group.includes("教师");
  const npcLoc = npc.currentRoom || npc.location || "";
  const atSchool = npcLoc.includes("総武高") || npcLoc.includes("总武高") || npcLoc.includes("教室") ||
                   npcLoc.includes("体育") || npcLoc.includes("プール") || npcLoc.includes("職員室") ||
                   npcLoc.includes("职员室") || npcLoc.includes("理科") || npcLoc.includes("美術") ||
                   npcLoc.includes("电脑") || npcLoc.includes("音楽") || npcLoc.includes("図書") ||
                   npcLoc.includes("校");

  // ── 课程表注入（v2: 班主任索引，持ち上がり制対応）──
  if (atSchool) {
    try {
      const nfs = require("node:fs");
      const npath = require("node:path");
      const ttPath = npath.resolve(process.cwd(), "worldpacks", (gs as any).activeWorld || "oregairu", "timetable.json");
      const orgPath = npath.resolve(process.cwd(), "worldpacks", (gs as any).activeWorld || "oregairu", "orgs", "soubu_high.json");
      if (nfs.existsSync(ttPath)) {
        const tt = JSON.parse(nfs.readFileSync(ttPath, "utf-8"));
        let timetableKey = "";
        let periodLine = "";

        if (isStudent) {
          const { resolveStudentTimetableKey } = require("../engine/time.ts");
          // Try class_config first
          if (nfs.existsSync(orgPath)) {
            const org = JSON.parse(nfs.readFileSync(orgPath, "utf-8"));
            const cc = org.class_config?.grades;
            if (cc) {
              timetableKey = resolveStudentTimetableKey(
                (src as any)?.grade, (src as any)?.homeroom, cc
              ) || "";
            }
          }
          // Fallback: NPC flagged with hr_teacher_
          if (!timetableKey) {
            for (const fk of Object.keys((gs as any).flags || {})) {
              if (fk.startsWith(`hr_teacher_${npcName}_`) && (gs as any).flags[fk]) {
                timetableKey = fk.replace(`hr_teacher_${npcName}_`, "");
                break;
              }
            }
          }
          if (timetableKey) {
            const { buildPeriodLines } = require("../engine/time.ts");
            periodLine = buildPeriodLines(timetableKey, (gs as any).time.minute_of_day, (gs as any).time.day_of_week, tt);
          }
        } else if (isTeacher) {
          // 教师：反搜 timetable，找当前课节是不是他在上
          const n = npcName;
          const minuteOfDay = (gs as any).time.minute_of_day;
          const dow = (gs as any).time.day_of_week;
          const { getCurrentPeriod, buildPeriodLines } = require("../engine/time.ts");
          const pi = getCurrentPeriod(minuteOfDay, dow);
          if (pi.phase === "授業中" && pi.period) {
            for (const tKey of Object.keys(tt.timetables || {})) {
              const dayTT = tt.timetables[tKey]?.[dow];
              if (!dayTT) continue;
              const slot = dayTT.find((p: any) => p.period === pi.period && p.teacher === n);
              if (slot) {
                timetableKey = tKey;
                periodLine = buildPeriodLines(tKey, minuteOfDay, dow, tt);
                break;
              }
            }
            if (!periodLine) {
              periodLine = `[現在] ${pi.period}限 空きコマ | 職員室で準備中`;
            }
          } else {
            periodLine = `[現在] ${pi.phase}`;
          }
        }

        if (periodLine) {
          lines.push(`[课堂] ${periodLine}`);
        }
      }
    } catch (_e) { /* timetable 加载失败不阻塞 */ }
  }

  const isLover = gs.player.relationships?.[npcName]?.romance === "恋人";

  const refPlaces = isStudent
    ? "自宅, 商店街, 千葉駅前, 稲毛海岸, カラオケ, 図書館, 本屋, ゲームセンター, ファミレス, コンビニ, 塾, 公園"
    : "自宅, 商店街, 千葉駅前, 居酒屋, ラーメン屋, ファミレス, 本屋, 公園";

  const loverPlaces = isLover
    ? "（你是玩家的恋人。放学后/周末可选择与恋人共处的地点：ラブホテル街, 海浜幕張の公園(夜景), カラオケ(個室), 稲毛海岸の防波堤, 映画館, 彼の自宅）"
    : "";

  lines.push(`如果你的性格或今天状态让你有不同于预设日程的真实去向，请在输出末尾加一段 JSON（选填）:
{"schedule_intent": {"location": "地点名", "action": "在做什么", "reason": "为什么去"}}
另外，如果你发现玩家做了令你不安/愤怒/警惕的事，你可以声明反制意图（选填）:
{"intent": {"type": "avoid_player"|"confront_player"|"inform_teacher"|"hire_help"|"none", "target": "NPC或地点", "reason": "理由", "cost": 金额(仅hire_help)}}
${loverPlaces}
可参考地点: ${refPlaces}`);

  return lines.join("\n");
}

/** 从 NPC 回应文本中提取 schedule_intent JSON → 写入 pendingOverride */
export async function parseScheduleIntent(npcName: string, text: string): Promise<void> {
  // Find schedule_intent JSON — extract from last { to next } at end
  const idx = text.lastIndexOf('{"schedule_intent"');
  if (idx < 0) return;
  const snippet = text.slice(idx);
  // Match balanced braces: fast-n-dirty — find the matching closing brace
  let depth = 0, end = -1;
  for (let i = 0; i < snippet.length; i++) {
    if (snippet[i] === '{') depth++;
    if (snippet[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return;
  try {
    const intent = JSON.parse(snippet.slice(0, end)).schedule_intent;
    if (!intent?.location) return;

    const { gameState, getOrCreateNPC, saveState } = await import("../engine/state.ts");
    const npc = getOrCreateNPC(npcName);
    npc.pendingOverride = {
      location: intent.location,
      action: intent.action || "自由行动",
      reason: intent.reason || "自主决定",
      expiresAt: gameState.time.game_date,
    };
    saveState();
  } catch (e) {
    console.error(`parseScheduleIntent JSON parse failed for ${npcName}:`, e);
  }
}

/** 从 NPC 回应中提取 intent JSON（avoid_player / confront_player / inform_teacher / hire_help）
 *  并转换为物理效果（pendingOverride / 记忆 / 资金操作） */
export async function parseNpcIntent(npcName: string, text: string): Promise<void> {
  const idx = text.lastIndexOf('{"intent"');
  if (idx < 0) return;
  const snippet = text.slice(idx);
  let depth = 0, end = -1;
  for (let i = 0; i < snippet.length; i++) {
    if (snippet[i] === '{') depth++;
    if (snippet[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return;
  try {
    const intent = JSON.parse(snippet.slice(0, end)).intent;
    if (!intent?.type || intent.type === "none") return;

    const { gameState, getOrCreateNPC, saveState } = await import("../engine/state.ts");
    const npc = getOrCreateNPC(npcName);
    const playerLoc = gameState.player.location;
    const now = new Date(gameState.time.game_date);

    switch (intent.type) {
      case "avoid_player": {
        now.setHours(now.getHours() + 8);
        npc.pendingOverride = {
          location: intent.target || "自宅",
          action: "避开玩家",
          reason: intent.reason || "自主决定远离玩家",
          expiresAt: now.toISOString().slice(0, 10)
        };
        break;
      }
      case "confront_player": {
        now.setHours(now.getHours() + 4);
        npc.pendingOverride = {
          location: playerLoc,
          action: "找玩家对质",
          reason: intent.reason || "需要当面问清楚",
          expiresAt: now.toISOString().slice(0, 10)
        };
        break;
      }
      case "inform_teacher": {
        const teacher = intent.target || "平塚静";
        now.setHours(now.getHours() + 6);
        npc.pendingOverride = {
          location: "職員室",
          action: `向${teacher}报告玩家行为`,
          reason: intent.reason || "报告违规行为",
          expiresAt: now.toISOString().slice(0, 10)
        };
        // 给老师写一条记忆
        const teacherNpc = getOrCreateNPC(teacher);
        if (teacherNpc) {
          teacherNpc.memoryTags ??= [];
          teacherNpc.memoryTags.push({
            tag: `[口信-${npcName}] ${intent.reason || "学生举报"}`,
            timestamp: gameState.time.game_date,
            importance: 7
          } as any);
        }
        break;
      }
      case "hire_help": {
        // NPC 花钱雇帮手（扣 NPC 资金，spawn 临时 NPC）
        const cost = intent.cost || 500;
        if ((npc.wealth ?? 0) + (npc.cash ?? 0) >= cost) {
          if (npc.cash >= cost) { npc.cash -= cost; }
          else { npc.wealth -= (cost - (npc.cash ?? 0)); npc.cash = 0; }
          now.setHours(now.getHours() + 12);
          npc.pendingOverride = {
            location: intent.target || playerLoc,
            action: "雇人处理玩家问题",
            reason: intent.reason || "需要外部帮手",
            expiresAt: now.toISOString().slice(0, 10)
          };
        }
        break;
      }
    }
    saveState();
  } catch (e) {
    console.error(`parseNpcIntent JSON parse failed for ${npcName}:`, e);
  }
}
