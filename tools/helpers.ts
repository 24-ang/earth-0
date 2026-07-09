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

export function getStringWidth(str: string): number {
  return [...str].reduce((w, c) => w + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
}

export function truncateToWidth(str: string, maxWidth: number): string {
  let w = 0;
  let res = "";
  for (const c of str) {
    const charW = c.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w + charW > maxWidth) break;
    res += c;
    w += charW;
  }
  return res;
}

export function wrapLine(text: string, maxW: number): string[] {
  const res: string[] = [];
  let cur = "";
  let curW = 0;
  for (const c of text) {
    const cw = c.charCodeAt(0) > 0x7f ? 2 : 1;
    if (curW + cw > maxW) {
      res.push(cur);
      cur = c;
      curW = cw;
    } else {
      cur += c;
      curW += cw;
    }
  }
  if (cur) res.push(cur);
  return res;
}

export let generateCompletionOverride: ((promptText: string, maxTokens: number, ctx: any, flagModel?: string, systemPrompt?: string) => Promise<string>) | null = null;
export function setGenerateCompletionOverride(fn: typeof generateCompletionOverride) {
  generateCompletionOverride = fn;
}

export async function generateCompletion(promptText: string, maxTokens: number, ctx: any, flagModel?: string, systemPrompt?: string): Promise<string> {
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
      return `🕐 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${timeOfDayZH[gameState.time.time_of_day] || gameState.time.time_of_day} | 📍 ${loc} | 👥 周边 ${totalCount} 人活动中`;
    }
  } catch (e) {
    console.error("buildStatusBarText error:", e);
  }
  return null;
}

export function updateChatHUD(ctx: any) {
  const text = buildStatusBarText();
  if (text) ctx.ui.setWidget("hud-status-bar", [text]);
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
  const items: MenuItem[] = finalLines.map(l => ({ label: l, detail: "", action: undefined }));
  return showMenu(ctx, title, items);
}

export async function showMenu(ctx: any, title: string, itemsOrBuilder: MenuItem[] | (() => MenuItem[])): Promise<void> {
  return ctx.ui.custom(
    (tui: any, _theme: any, _kb: any, done: any) => {
      let sel = 0;
      const getItems = (): MenuItem[] => typeof itemsOrBuilder === "function" ? itemsOrBuilder() : itemsOrBuilder;
      let items = getItems();
      const comp = {
        render(width: number): string[] {
          const out: string[] = [];
          const w = Math.min(width, tui.visibleWidth?.() ?? width) - 1;
          const titleW = getStringWidth(title);
          out.push("┌─" + title + " " + "─".repeat(Math.max(0, w - 4 - titleW)) + "┐");
          
          // TUI HUD Status Bar
          const statusText = buildStatusBarText();
          if (statusText) {
            const barTrunc = truncateToWidth(statusText, w - 4);
            const barPad = Math.max(0, (w - 4) - getStringWidth(barTrunc));
            out.push("│ " + barTrunc + " ".repeat(barPad) + " │");
            out.push("├" + "─".repeat(w - 2) + "┤");
          }

          const start = Math.max(0, sel - 5), end = Math.min(items.length, start + 10);
          for (let i = start; i < end; i++) {
            const it = items[i];
            const line = (i === sel ? "▶ " : "  ") + it.label + (it.detail ? "  " + it.detail : "");
            const t = tui.truncateToWidth ? tui.truncateToWidth(line, w - 2) : truncateToWidth(line, w - 2);
            const pad = Math.max(0, (w - 4) - getStringWidth(t));
            out.push("│ " + t + " ".repeat(pad) + " │");
          }
          out.push("└" + "─".repeat(w - 2) + "┘");
          out.push((sel+1 + "/" + items.length + " 方向键选择 Enter确认 q退出").slice(0, w));
          return out;
        },
        handleInput(d: string) {
          if (d === "\x1b" || d === "q") { done(); return; }
          if (d === "\x1b[A" || d === "\x1bOA" || d === "k" || d === "w") sel = Math.max(0, sel - 1);
          else if (d === "\x1b[B" || d === "\x1bOB" || d === "j" || d === "s") sel = Math.min(items.length - 1, sel + 1);
          else if (d === "\r" || d === "\n") {
            const it = items[sel];
            if (it?.action) Promise.resolve(it.action(done)).then(() => { items = getItems(); sel = Math.min(sel, items.length-1); });
            else done();
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
      ctx.chat.addSystemMessage(`玩家已出发前往 ${to}。${vehicleHint}不要立即让他们到达目的地！请描述路上的见闻、风景。等剧情差不多了，再调用 complete_travel 工具。`);
      updateChatHUD(ctx);
    } else {
      await moveTo(to, ctx, gameState, saveState);
      await advanceTimeMinutes(actualMins, ctx, gameState, saveState);
      if (mins >= 2) {
        const vHint = vehicleName ? `（骑${vehicleName}）` : "";
        ctx.chat.addSystemMessage(`[移动] ${gameState.player.location} → ${to}，耗时 ${actualMins} 分钟${vHint}。`);
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

  const estTravel = (from: string, to: string): number => {
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
    const sharePrefix = fromNav.breadcrumb.filter(b => toNav.breadcrumb.includes(b)).length;
    const maxDepth = Math.max(fromNav.breadcrumb.length, toNav.breadcrumb.length, 5);
    const shareRatio = sharePrefix / maxDepth;

    if (shareRatio >= 0.9) return 1 + hashDist(from, to, 0, 5);
    if (shareRatio >= 0.7) return 2 + hashDist(from, to, 0, 6);
    if (shareRatio >= 0.5) return 3 + hashDist(from, to, 0, 27);
    if (shareRatio >= 0.3) return 30 + hashDist(from, to, 0, 60);
    return 60 + hashDist(from, to, 0, 120);
  };

  const hashDist = (a: string, b: string, min: number, range: number): number => {
    const h = (a + b).split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    return min + (h % range);
  };

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

export async function runStatus(ctx: any) {
  const { gameState, saveState, calcMaxCarry, calcCurrentWeight, isOverburdened, calcPocketVolume, calcInventoryVolume } = await import("../engine/state.ts");
  const p = gameState.player;

  const maxC = calcMaxCarry(p.attributes.力量);
  const curW = calcCurrentWeight(p.inventory, p.equipment);
  const burden = isOverburdened(curW, maxC);
  const pocketVol = calcPocketVolume(p.equipment);
  const invVol = calcInventoryVolume(p.inventory, p.equipment);

  // 构建物品 flavor 速查表（从 itemsCatalog 读描述文本）
  const flavorMap = new Map<string, string>();
  try {
    const { itemsCatalog } = await import("../engine/state.ts");
    for (const cat of Object.values(itemsCatalog as any)) {
      for (const [iname, item] of Object.entries(cat as any)) {
        if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
      }
    }
  } catch (e) { console.error("runStatus: flavorMap lookup error", e); }

  const buildMenu = () => {
    const items: MenuItem[] = [];
    const identityStr = p.public_identity ? ` | 🎭 伪装: ${p.public_identity}` : "";
    items.push({ label: `👤 角色: ${p.name} (${p.gender}) | 年龄: ${p.age}岁${identityStr}`, detail: "" });
    items.push({ label: `❤️ HP: ${p.hp.current}/${p.hp.max} | 🛡️ AC: ${p.ac} | 💰 资金: ${getCurrency()}${p.funds} | 💤 疲劳: ${p.fatigue ?? 0}/100`, detail: "" });
    items.push({ label: `🏋️ 负重: ${curW}/${maxC}kg${burden.overloaded ? " ⚠️超重!" : burden.encumbered ? " 📦较重" : ""} | 📦 体积: ${invVol}${pocketVol > 0 ? `/${pocketVol}` : ""}L`, detail: "" });
    items.push({ label: `📊 属性: 力${p.attributes.力量} 敏${p.attributes.敏捷} 体${p.attributes.体质} 智${p.attributes.智力} 感${p.attributes.感知} 魅${p.attributes.魅力}`, detail: "" });
    const woundStr = p.wounds && p.wounds.length > 0 
      ? p.wounds.map(w => `${w.severity}: ${w.text}`).join(", ")
      : "健康";
    items.push({ label: `🩸 伤势: ${woundStr}`, detail: "" });

    if (p.body) {
      const b = p.body;
      let bodyStr = `📏 ${b.height_cm}cm ${b.weight_kg}kg ${b.build}`;
      if (b.cup) bodyStr += ` ${b.cup}cup`;
      if (b.measurements) bodyStr += ` 三围${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`;
      if (b.leg_type) bodyStr += ` ${b.leg_type}腿`;
      if (b.skin) bodyStr += ` 肤${b.skin.texture}·${b.skin.base_tone}`;
      items.push({ label: bodyStr, detail: "" });
    }

    items.push({ label: "── 🌟 声望与派系 ──", detail: "" });
    const reps = Object.entries(p.reputation || {});
    if (reps.length > 0) {
      items.push({ label: `  ${reps.map(([k, v]) => `${k}(${v})`).join(" | ")}`, detail: "" });
    } else {
      items.push({ label: `  (无)`, detail: "" });
    }

    items.push({ label: "── 装备槽位 (点击卸下) ──", detail: "" });
    for (const [slotKey, slotName] of Object.entries(SLOT_NAMES)) {
      const item = p.equipment[slotKey as any];
      if (item) {
        const flavor = flavorMap.get(item.name) || (item as any).flavor;
        const desc = flavor ? `${item.name} — ${flavor}` : item.name;
        items.push({
          label: `  [${slotName}] ${desc}`,
          detail: `🛡️ 卸下`,
          action: (_done) => {
            p.inventory.push(item);
            p.equipment[slotKey as any] = null;
            saveState();
            ctx.ui.notify(`卸下了 ${item.name}`, "info");
          }
        });
      } else {
        items.push({
          label: `  [${slotName}] (空)`,
          detail: `➕ 穿戴`,
          action: async (_done) => {
            const fitItems = p.inventory.filter(it => it.slot === slotKey);
            if (fitItems.length === 0) {
              ctx.ui.notify(`背包中没有适合该槽位的装备`, "warning");
              return;
            }
            await showMenu(ctx, `装备到 [${slotName}]`, fitItems.map(it => ({
              label: it.name,
              detail: `${it.type} ${it.weight}kg`,
              action: (subDone) => {
                p.equipment[slotKey as any] = it;
                p.inventory.splice(p.inventory.indexOf(it), 1);
                saveState();
                ctx.ui.notify(`装备了 ${it.name}`, "info");
                subDone();
              }
            })));
          }
        });
      }
    }

    items.push({ label: "── 背包物品 (点击查看/操作) ──", detail: "" });
    if (p.inventory.length > 0) {
      p.inventory.forEach(it => {
        const itFlavor = flavorMap.get(it.name) || (it as any).flavor;
        const itDesc = itFlavor ? `${it.name} — ${itFlavor}` : it.name;
        items.push({
          label: `  ${itDesc}`,
          detail: `${it.type} ${it.weight}kg`,
          action: async (_done) => {
            const isPhone = it.name.includes("手机") || it.effects?.some((e: any) => e.type === "communication");
            const subItems: MenuItem[] = [
              {
                label: "🔍 查看详情",
                action: (subDone) => {
                  const lines = [
                    `名称: ${it.name}`,
                    `类型: ${it.type} | 重量: ${it.weight}kg | 体积: ${(it as any).volume ?? "?"}L | 状态: ${it.state}`,
                    it.flavor ? `描述: ${it.flavor}` : "",
                    it.damage ? `伤害: ${it.damage.dice} (${it.damage.damageType})` : "",
                  ].filter(Boolean);
                  if (it.effects && it.effects.length > 0) {
                    lines.push("效果:");
                    it.effects.forEach((eff: any) => {
                      lines.push(`  - ${eff.type}: ${eff.value}${eff.group ? ` (${eff.group})` : ""}`);
                    });
                  }
                  showPanel(ctx, it.name, lines);
                  subDone();
                }
              }
            ];

            if (isPhone) {
              subItems.push({
                label: "📱 打开手机",
                action: async (subDone) => {
                  await showPhoneTUI(ctx, it);
                  subDone();
                }
              });
            }

            if (it.slot) {
              const slotName = SLOT_NAMES[it.slot] || it.slot;
              subItems.push({
                label: `🛡️ 装备到 [${slotName}]`,
                action: (subDone) => {
                  const slot = it.slot as any;
                  if (p.equipment[slot]) p.inventory.push(p.equipment[slot]!);
                  p.equipment[slot] = it;
                  p.inventory.splice(p.inventory.indexOf(it), 1);
                  saveState();
                  ctx.ui.notify(`装备了 ${it.name}`, "info");
                  subDone();
                }
              });
            }

            subItems.push({
              label: "❌ 丢弃物品",
              action: (subDone) => {
                p.inventory.splice(p.inventory.indexOf(it), 1);
                saveState();
                ctx.ui.notify(`丢弃了 ${it.name}`, "info");
                subDone();
              }
            });

            await showMenu(ctx, it.name, subItems);
          }
        });
      });
    } else {
      items.push({ label: "  （背包空空如也）", detail: "" });
    }

    items.push({ label: "── ⚙️ 系统与引擎状态 ──", detail: "" });
    const activeFlags = Object.entries(gameState.flags)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    items.push({
      label: `  [状态] 模式:${gameState.mode} | Layer1:${gameState.layer1Enabled ? "启用" : "禁用"} | 魔改:${gameState.auMode ? "启用" : "禁用"}`,
      detail: `阻合:${gameState.turn}`
    });
    items.push({
      label: `  [天气] ${gameState.weather.type} (${gameState.weather.temp}°C)`,
      detail: `时间:${gameState.time.game_date}`
    });
    items.push({
      label: `  [标记] ${activeFlags.length > 0 ? activeFlags.join(", ") : "(空)"}`,
      detail: "🔍 查看详情",
      action: async (_done) => {
        const lines = [
          `当前世界模式: ${gameState.mode}`,
          `Layer1 亲密引擎: ${gameState.layer1Enabled ? "ON" : "OFF"}`,
          `魔改模式 (AU): ${gameState.auMode ? "ON" : "OFF"}`,
          `游戏总回合数: ${gameState.turn}`,
          `游戏当前时间: ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${gameState.time.time_of_day}`,
          `当前天气状况: ${gameState.weather.type} (${gameState.weather.temp}°C)`,
          ``,
          `所有已记录的世界/事件标记 (gameState.flags):`,
          ...Object.entries(gameState.flags).map(([k, v]) => `  - ${k}: ${v}`),
          Object.keys(gameState.flags).length === 0 ? "  （目前无任何事件标记）" : ""
        ].filter(Boolean);
        await showPanel(ctx, "⚙️ 系统与标记详情", lines);
      }
    });

    return items;
  };

  await showMenu(ctx, `👤 状态与装备`, buildMenu);
}

// ── spawn_npc_agent / spawn_npc_agents 共用工具函数 ──

/** 从 rendering.json 读取 npc_agent_model（fallback: flash） */
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

  const refPlaces = isStudent
    ? "自宅, 商店街, 千葉駅前, 稲毛海岸, カラオケ, 図書館, 本屋, ゲームセンター, ファミレス, コンビニ, 塾, 公園"
    : "自宅, 商店街, 千葉駅前, 居酒屋, ラーメン屋, ファミレス, 本屋, 公園";

  lines.push(`如果你的性格或今天状态让你有不同于预设日程的真实去向，请在输出末尾加一段 JSON（选填）:
{"schedule_intent": {"location": "地点名", "action": "在做什么", "reason": "为什么去"}}
另外，如果你发现玩家做了令你不安/愤怒/警惕的事，你可以声明反制意图（选填）:
{"intent": {"type": "avoid_player"|"confront_player"|"inform_teacher"|"hire_help"|"none", "target": "NPC或地点", "reason": "理由", "cost": 金额(仅hire_help)}}
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
