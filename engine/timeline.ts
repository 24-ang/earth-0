/**
 * 剧情事件引擎 — 扫描 timeline JSON，管理钩子生命周期，注入 prompt
 *
 * 设计原则（来自 fate-sandbox + tavern2agent）：
 * - 引擎只设 flag + 注入 context，不写死台词
 * - 钩子不是 MMO 弹窗，hook_text 是自然叙事文本
 * - active_hooks 上限 3，超限自动清旧
 * - 钩子重复出现强制写 novelty
 */

import type { TimelineEvent, Hook, QuestState, CalendarEntry, DynamicEvent, NPCRuntimeState } from "./types.ts";
import { gameState, getOrCreateNPC, updateRelation, getLocationNav, isSameLocation, findCharacter, npcBelongsToOrg } from "./state.ts";
import { queryLore } from "./lore.ts";
import { LIFE_STAGES } from "./time.ts";
import fs from "node:fs";
import path from "node:path";

const TIMELINES_DIR = path.resolve(process.cwd(), "data", "timelines");
const CALENDAR_DIR = path.resolve(process.cwd(), "data", "calendar");

/** 加载当前活跃世界观的日历文件 → 扁平化为 CalendarEntry[] */
let _calendarCache: Record<string, CalendarEntry[]> = {};
function loadCalendar(): CalendarEntry[] {
  const world = gameState.activeWorld || "oregairu";
  if (_calendarCache[world]) return _calendarCache[world];
  const entries: CalendarEntry[] = [];

  // 0. Load dynamic calendar events from GameState
  if (gameState.calendarEvents) {
    const worldEvents = gameState.calendarEvents.filter(e => !e.world || e.world === world);
    entries.push(...worldEvents);
  }

  // 1. Try worldpacks/[worldName]/calendar.json
  const wpPath = path.resolve(process.cwd(), "worldpacks", world, "calendar.json");
  if (fs.existsSync(wpPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(wpPath, "utf-8"));
      if (Array.isArray(data)) entries.push(...data);
    } catch (e) { console.error("loadCalendar: 解析 worldpack 日历 JSON 失败", e); }
  }

  // 2. Try data/calendar/
  if (fs.existsSync(CALENDAR_DIR)) {
    for (const f of fs.readdirSync(CALENDAR_DIR)) {
      if (!f.endsWith(".json")) continue;
      const name = f.replace(".json", "");
      if (name !== world && !name.startsWith("_")) continue; // _ 前缀 = 通用
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CALENDAR_DIR, f), "utf-8"));
        if (Array.isArray(data)) entries.push(...data);
      } catch (e) { console.error("loadCalendar: 解析日历文件失败", e); }
    }
  }

  _calendarCache[world] = entries;
  return entries;
}
/** 世界观切换时清除日历缓存 */
export function clearCalendarCache(): void { _calendarCache = {}; }

/** P1: 获取 NPC 应感知的事件素材（引擎做过滤，GM 做人格化） */
export function getNPCEventContext(npcName: string): string {
  const all = loadCalendar();
  const today = gameState.time.game_date;
  const year = parseYear(today);
  const mmdd = today.includes("-") ? parseMonthDay(today) : today;

  const relevant: string[] = [];

  for (const e of all) {
    if (!e.advance_days || !e.advance_hook) continue;
    if (e.year !== null && e.year !== year) continue;

    // Check if this NPC belongs to an affected org
    let npcAffected = false;
    if (e.org_effects) {
      const npc = gameState.npcs[npcName];
      if (npc) {
        for (const eff of e.org_effects) {
          if (npcBelongsToOrg(npcName, npc, eff.org)) {
            npcAffected = true;
            break;
          }
        }
      }
    } else {
      // No org_effects → general event, all NPCs in range see it
      npcAffected = true;
    }
    if (!npcAffected) continue;

    // Check if we're in the advance window (event is in the future, within advance_days)
    const offset = daysFromTodayMD(mmdd, e.date);
    if (offset > 0 && offset <= e.advance_days) {
      const daysUntil = offset;
      relevant.push(`• ${e.text.slice(0, 50)} ${daysUntil}天后 — ${e.advance_hook}`);
    }
  }

  return relevant.length > 0
    ? `[NPC·事件感知·素材]\n${relevant.map(r => `  ${r}`).join("\n")}\n（GM 可在 sceneContext 中覆写为角色特化版本）`
    : "";
}

/** P1: 计算从 todayMD 到 targetMD 的天数差（正 = 未来） */
function daysFromTodayMD(todayMD: string, targetMD: string): number {
  function parse(md: string): { m: number; d: number } {
    const parts = md.split("月");
    return { m: parseInt(parts[0]), d: parseInt(parts[1]) };
  }
  const t = parse(todayMD);
  const tg = parse(targetMD);
  return (tg.m - t.m) * 30 + (tg.d - t.d);
}

/** 提取 game_date 中的 M月D日 字符串 */
function parseMonthDay(gameDate: string): string {
  const parts = gameDate.split("-");
  return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
}

/** 提取 game_date 中的年份 */
function parseYear(gameDate: string): number {
  return Number(gameDate.split("-")[0]);
}

/** 获取今日匹配的日历条目（按日期+年份+地点过滤，且支持位置层级匹配） */
export function getCalendarEvents(date: string, location: string): CalendarEntry[] {
  const all = loadCalendar();
  const year = parseYear(date);
  const mmdd = date.includes("-") ? parseMonthDay(date) : date;
  let breadcrumb: string[] = [];
  try {
    const nav = getLocationNav(location);
    if (nav && nav.breadcrumb) {
      breadcrumb = nav.breadcrumb;
    }
  } catch (e) {
    console.error("getCalendarEvents getLocationNav error:", e);
  }

  return all.filter(e => {
    if (e.date !== mmdd) return false;
    if (e.year !== null && e.year !== year) return false;
    if (e.location !== null) {
      const match = isSameLocation(e.location, location) || breadcrumb.some(b => isSameLocation(e.location!, b));
      if (!match) return false;
    }
    return true;
  });
}

/** 获取当前日期所处的日历阶段及匹配条目 — 预热/当天/余波三阶段 */
export function getCalendarPhase(date: string, location: string): {
  phase: "pre" | "today" | "after" | "none";
  entries: CalendarEntry[];
} {
  const all = loadCalendar();
  const year = parseYear(date);
  const mmdd = date.includes("-") ? parseMonthDay(date) : date;

  // Helper: parse M月D日 into {month, day} numbers
  function parseMD(md: string): { m: number; d: number } {
    const parts = md.split("月");
    return { m: parseInt(parts[0]), d: parseInt(parts[1]) };
  }

  const todayMD = parseMD(mmdd);

  // Helper: check if a date string falls within a range of days from todayMD
  function daysFromToday(targetMD: string): number {
    const t = parseMD(targetMD);
    // Simplified: treat months as 30 days each for rough offset calculation
    return (t.m - todayMD.m) * 30 + (t.d - todayMD.d);
  }

  const todayEntries: CalendarEntry[] = [];
  const preEntries: CalendarEntry[] = [];
  const afterEntries: CalendarEntry[] = [];

  for (const e of all) {
    if (e.date !== mmdd && !e.advance_days && !e.aftermath_text) continue;
    if (e.year !== null && e.year !== year) continue;

    const eMD = parseMD(e.date);
    const offset = daysFromToday(e.date);

    // Exact match → today phase
    if (e.date === mmdd) {
      if (e.location !== null && !locationMatches(e.location, location)) continue;
      todayEntries.push(e);
      continue;
    }

    // Pre-phase: within advance_days before event (event is in the future)
    if (e.advance_days && offset > 0 && offset <= e.advance_days) {
      if (e.range && !isInRange(e.range, e.center, location)) continue;
      preEntries.push(e);
    }

    // After-phase: 1-2 days after event (event is in the past)
    if (e.aftermath_text && offset < 0 && offset >= -2) {
      if (e.range && !isInRange(e.range, e.center, location)) continue;
      afterEntries.push(e);
    }
  }

  if (todayEntries.length > 0) return { phase: "today", entries: todayEntries };
  if (preEntries.length > 0) return { phase: "pre", entries: preEntries };
  if (afterEntries.length > 0) return { phase: "after", entries: afterEntries };
  return { phase: "none", entries: [] };
}

function locationMatches(entryLoc: string, playerLoc: string): boolean {
  if (isSameLocation(entryLoc, playerLoc)) return true;
  try {
    const nav = getLocationNav(playerLoc);
    if (nav?.breadcrumb?.some((b: string) => isSameLocation(entryLoc, b))) return true;
  } catch (e) { console.error("locationMatches: getLocationNav 失败", e); }
  return false;
}

function isInRange(range: string, center: string | undefined, playerLoc: string): boolean {
  if (range === "national" || range === "global") return true;
  if (!center) return false;
  return locationMatches(center, playerLoc);
}

export function getPlayerNameParts() {
  const world = gameState.activeWorld || "oregairu";
  const configPath = path.resolve(process.cwd(), "worldpacks", world, "protagonist.json");
  let config: any = null;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) { console.error("getPlayerNameParts: 解析主角配置文件失败", e); }
  }

  const defaultProtagonist = config?.default_protagonist || { full: gameState.player?.name || "维", surname: "维", givenName: "" };
  const full = gameState.player?.name || defaultProtagonist.full;

  if (full === defaultProtagonist.full) {
    return defaultProtagonist;
  }

  // 玩家始终使用自己的名字（与比企谷八幡是两个独立的人）
  // 顶替条件影响剧情走向（是否走雪乃线），不影响身份
  if (full.length === 3) {
    return { full, surname: full.slice(0, 1), givenName: full.slice(1) };
  }
  if (full.length === 4) {
    return { full, surname: full.slice(0, 2), givenName: full.slice(2) };
  }
  return { full, surname: full, givenName: full };
}


/** 递归加载当前活跃世界观的 timeline 文件（只加载 data/timelines/{activeWorld}/） */
export function loadAllTimelines(): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const world = gameState.activeWorld || "oregairu";
  const pathsToScan = [
    path.resolve(process.cwd(), "worldpacks", world, "timelines"),
    path.join(TIMELINES_DIR, world)
  ];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (f.startsWith("_")) continue;
      if (fs.statSync(full).isDirectory()) {
        scanDir(full);
      } else if (f.endsWith(".json")) {
        try {
          let raw = fs.readFileSync(full, "utf-8");
          const parts = getPlayerNameParts();
          raw = raw
            .replace(/\{\{player\}\}/g, parts.full)
            .replace(/\{\{player\.name\}\}/g, parts.full)
            .replace(/\{\{player\.surname\}\}/g, parts.surname)
            .replace(/\{\{player\.givenName\}\}/g, parts.givenName);
          const data = JSON.parse(raw);
          if (Array.isArray(data)) events.push(...data);
          else if (data.id) events.push(data);
        } catch (e) { console.error("loadAllTimelines: 解析时间线 JSON 失败", e); }
      }
    }
  }

  for (const p of pathsToScan) {
    scanDir(p);
  }
  return events;
}

/** 计算当前游戏天数（从 game_date 解析） — 时区与夏令时安全 */
export function currentDay(): number {
  const d = gameState.time.game_date; // "2018-04-07"
  const parts = d.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const startYear = gameState.time?.timeline_origin?.year ?? 2018;
  const start = Date.UTC(startYear, 0, 1);
  const now = Date.UTC(y, m, day);
  return Math.round((now - start) / 86400000) + 1;
}

/** 注入动态事件（LLM 工具或引擎自动调用）→ 写入 dynamicEvents 注册表 */
export function injectDynamicEvent(event: DynamicEvent): string {
  gameState.dynamicEvents ??= [];
  const existing = gameState.dynamicEvents.findIndex(e => e.id === event.id);
  if (existing >= 0) {
    gameState.dynamicEvents[existing] = event;
    return `已更新动态事件: ${event.id}`;
  }
  gameState.dynamicEvents.push(event);
  return `已注入动态事件: ${event.id}`;
}

/** 移除动态事件（钩子被打开/过期时调用） */
export function removeDynamicEvent(eventId: string): void {
  gameState.dynamicEvents ??= [];
  gameState.dynamicEvents = gameState.dynamicEvents.filter(e => e.id !== eventId);
}

/** 检查触发条件 */
function checkTrigger(event: TimelineEvent, day: number): boolean {
  const t = event.trigger;
  // 年龄限制
  if ((t as any).min_age && gameState.player.age < (t as any).min_age) return false;
  if ((t as any).max_age && gameState.player.age > (t as any).max_age) return false;
  // 年龄阶段限制
  if ((t as any).player_stage) {
    const stageKey = gameState.time.player_stage;
    const allowed = (t as any).player_stage;
    const stageConfig = (LIFE_STAGES as any)[stageKey];
    const label = stageConfig?.label;
    if (stageKey !== allowed && label !== allowed) return false;
  }
  // 天数条件
  if (t.min_day && day < t.min_day) return false;
  if (t.max_day && day > t.max_day) return false;
  // 时间带
  if (t.time_of_day && !t.time_of_day.includes(gameState.time.time_of_day)) return false;
  // 地点 (支持层级匹配)
  if (t.location) {
    let breadcrumb: string[] = [];
    try {
      const nav = getLocationNav(gameState.player.location);
      if (nav && nav.breadcrumb) {
        breadcrumb = nav.breadcrumb;
      }
    } catch (e) { console.error("checkTrigger: getLocationNav 失败", e); }
    const match = isSameLocation(t.location, gameState.player.location) || breadcrumb.some(b => isSameLocation(t.location!, b));
    if (!match) return false;
  }
  // 好感度
  if (t.affection) {
    for (const [npc, min] of Object.entries(t.affection)) {
      const rel = gameState.player.relationships[npc];
      if (!rel || rel.affection < min) return false;
    }
  }
  // 前置 flag
  if (t.flags) {
    for (const [k, v] of Object.entries(t.flags)) {
      if (!!gameState.flags[k] !== v) return false;
    }
  }
  // 技能要求
  if ((t as any).min_skills) {
    for (const [skill, minLevel] of Object.entries((t as any).min_skills)) {
      const playerSkill = (gameState.player.skills as any)?.[skill];
      if (!playerSkill || playerSkill.level < (minLevel as number)) return false;
    }
  }
  // 关联日历事件
  if (t.calendar_event) {
    const allEvents = loadCalendar();
    const year = parseYear(gameState.time.game_date);
    const mmdd = parseMonthDay(gameState.time.game_date);
    const todayEvents = allEvents.filter(e => e.date === mmdd && (e.year === null || e.year === year));
    const matchesEvent = todayEvents.some(e => e.text.includes(t.calendar_event!) || e.date === t.calendar_event) || mmdd === t.calendar_event;
    if (!matchesEvent) return false;
  }
  return true;
}

/** 好感驱动钩子：高好感 NPC 不在场时自动产钩子（引擎驱动，零 tk） */
export function checkAffectionDrivenHooks(): void {
  const p = gameState.player;
  const AFFECTION_THRESHOLD = 70;
  gameState.dynamicEvents ??= [];

  for (const [npcName, rel] of Object.entries(p.relationships)) {
    if (rel.affection < AFFECTION_THRESHOLD) continue;
    const npc = gameState.npcs[npcName];
    if (!npc) continue;

    const eventId = `affection_${npcName}`;

    // NPC 已在玩家面前 → 不需要钩子
    if (isSameLocation(npc.currentRoom, p.location)) {
      removeDynamicEvent(eventId);
      continue;
    }

    // 创建/更新动态事件（checkTimelineEvents 会在同一次调用中扫描到它）
    injectDynamicEvent({
      id: eventId,
      source: "engine",
      expires_days: 3,
      repeatable: true,
      hook: {
        source_npc: npcName,
        hook_text: `${npcName}好像想见你`,
        urgency: "low",
      },
    });
  }

  // 清理已失效的关系事件（好感跌破阈值 / 关系被删除）
  for (const ev of [...gameState.dynamicEvents]) {
    if (ev.id.startsWith("affection_") && ev.source === "engine") {
      const name = ev.id.replace("affection_", "");
      if (!p.relationships[name] || (p.relationships[name]?.affection ?? 0) < AFFECTION_THRESHOLD) {
        removeDynamicEvent(ev.id);
      }
    }
  }
}

/** 每回合调用：扫描未触发事件 → 满足条件 → 加入 active_hooks */
export function checkTimelineEvents(): void {
  const day = currentDay();
  const events = loadAllTimelines();
  gameState.active_hooks ??= [];
  gameState.completed_events ??= [];

  // 先跑引擎驱动钩子（好感→动态事件），再扫描动态事件使其在同回合生效
  checkAffectionDrivenHooks();

  for (const ev of events) {
    // 已完成/已过期/不可重复 → 跳过
    if (gameState.completed_events.includes(ev.id) && !ev.repeatable) continue;
    // 已在钩子列表中 → 跳过
    if (gameState.active_hooks.some(h => h.event_id === ev.id)) continue;
    // 条件不满足 → 跳过
    if (!checkTrigger(ev, day)) continue;
    // 没有钩子配置的事件（如静默事件） → 跳过
    if (!ev.hook) continue;

    // 创建钩子
    const hook: Hook = {
      event_id: ev.id,
      source_npc: ev.hook.source_npc,
      hook_text: ev.hook.hook_text,
      urgency: ev.hook.urgency,
      created_day: day,
      expires_day: day + ev.expires_days,
      seen_count: 0,
      iconic_lines: ev.iconic_lines,
    };
    gameState.active_hooks.push(hook);
  }

  // 扫描动态事件（LLM/引擎运行时创建，不入 JSON 文件）
  gameState.dynamicEvents ??= [];
  for (const ev of gameState.dynamicEvents) {
    if (gameState.completed_events.includes(ev.id) && !ev.repeatable) continue;
    if (gameState.active_hooks.some(h => h.event_id === ev.id)) continue;
    if (ev.trigger && !checkTrigger(ev as any, day)) continue;

    const hook: Hook = {
      event_id: ev.id,
      source_npc: ev.hook.source_npc,
      hook_text: ev.hook.hook_text,
      urgency: ev.hook.urgency,
      created_day: day,
      expires_day: day + ev.expires_days,
      seen_count: 0,
      iconic_lines: (ev as any).iconic_lines,
    };
    gameState.active_hooks.push(hook);
  }

  // 上限 3 条 → 优先保留高紧迫度，同紧迫度保留最新的
  if (gameState.active_hooks.length > 3) {
    const urgencyRank = { high: 3, medium: 2, low: 1 };
    gameState.active_hooks.sort((a, b) => {
      const uDiff = (urgencyRank[b.urgency] || 0) - (urgencyRank[a.urgency] || 0);
      if (uDiff !== 0) return uDiff;
      return b.created_day - a.created_day;
    });
    // 多余的标记为静默过期（不执行惩罚效果，不扣好感，不生成失败flag）
    const removed = gameState.active_hooks.splice(3);
    const jsonEvents = loadAllTimelines();
    gameState.dynamicEvents ??= [];
    for (const h of removed) {
      const ev = jsonEvents.find(e => e.id === h.event_id) ?? gameState.dynamicEvents.find(e => e.id === h.event_id);
      if (ev) expireHookSync(h, ev);
    }
  }

  // 预加载 active hooks 关联的 recommended_lore（自动触发 queryLore）
  for (const h of gameState.active_hooks) {
    const ev = events.find(e => e.id === h.event_id);
    if (ev?.recommended_lore?.length) {
      for (const tag of ev.recommended_lore) {
        queryLore(tag, [], gameState.flags);
      }
    }
  }
}

/** 清理过期钩子 */
export async function expireHooks(): Promise<void> {
  const day = currentDay();
  gameState.active_hooks ??= [];
  gameState.completed_events ??= [];
  const remaining: Hook[] = [];
  for (const h of gameState.active_hooks) {
    if (day > h.expires_day) {
      await expireHook(h);
    } else {
      remaining.push(h);
    }
  }
  gameState.active_hooks = remaining;
}

/** 同步标记钩子过期状态 */
function expireHookSync(hook: Hook, ev: TimelineEvent | DynamicEvent): void {
  // 记录到 completed_events
  if (!ev.repeatable) {
    gameState.completed_events.push(ev.id);
  }

  // 如果是动态事件，从注册表移除
  removeDynamicEvent(hook.event_id);

  // 如果有对应的 active quest，标记为 expired
  gameState.quests ??= {};
  if (gameState.quests[hook.event_id]?.status === "active") {
    gameState.quests[hook.event_id].status = "expired";
  }
}

/** 单个钩子过期处理 */
async function expireHook(hook: Hook, silent = false): Promise<void> {
  const events = loadAllTimelines();
  let ev: TimelineEvent | DynamicEvent | undefined = events.find(e => e.id === hook.event_id);
  // 没找到 → 尝试动态事件注册表
  if (!ev) {
    gameState.dynamicEvents ??= [];
    ev = gameState.dynamicEvents.find(e => e.id === hook.event_id);
  }
  if (!ev) return;

  // 调用同步部分
  expireHookSync(hook, ev);

  // 执行 on_expire effects（仅 TimelineEvent 有）
  if (!silent && "on_expire" in ev && ev.on_expire?.effects) {
    await applyBeatEffects(ev.on_expire.effects);
  }
}

/** 获取活跃钩子列表（供 prompt 注入） */
export function getActiveHooks(): Hook[] {
  gameState.active_hooks ??= [];
  const events = loadAllTimelines();
  const validIds = new Set(events.map(e => e.id));
  // 动态事件 ID 也视为有效
  if (gameState.dynamicEvents) {
    for (const de of gameState.dynamicEvents) validIds.add(de.id);
  }
  const isTest = typeof process !== "undefined" && (
    process.env.NODE_ENV === "test" ||
    process.argv.some(arg => arg.includes("test.ts") || arg.includes("test"))
  );
  return gameState.active_hooks.filter(h =>
    validIds.has(h.event_id) ||
    (isTest && (
      h.event_id.startsWith("old_") ||
      h.event_id.startsWith("new_") ||
      h.event_id.startsWith("test_") ||
      h.event_id === "test"
    ))
  );
}


/** 为重复出现的钩子生成 novelty 提示 — 避免机械重复同一句话 */
export function getHookNoveltyHint(hook: Hook): string {
  const daysAgo = currentDay() - hook.created_day;
  const elapsed = daysAgo > 0 ? `${daysAgo}天过去了。` : "";
  // 基础模板：告知 LLM 该换角度了
  let hint = `${elapsed}${hook.source_npc}的那个事件仍未解决。`;
  // 根据紧迫度给不同的语气
  if (hook.urgency === "high") {
    hint += ` 这件事非常紧迫——请让NPC表现出明显的焦虑或主动催促，不要再重复初次提及的方式。`;
  } else if (hook.urgency === "medium") {
    hint += ` 请从一个新的细微角度提及它——比如NPC看了一眼日历、或叹了口气提到还没解决。`;
  } else {
    hint += ` 请轻描淡写地提及——比如NPC路过时瞥了一眼、或不经意间提起，不要重复初次邀请的措辞。`;
  }
  return hint;
}

/** 获取活跃 quest 列表 */
export function getActiveQuests(): QuestState[] {
  gameState.quests ??= {};
  return Object.values(gameState.quests).filter(q => q.status === "active");
}

/** 检查 outcome 的 auto_if 条件 — 类别间 OR，类别内 AND */
function checkAutoIf(autoIf: { romance?: Record<string, string>; flags?: Record<string, boolean>; affection?: Record<string, number> }): boolean {
  // romance: 全部NPC匹配才算通过
  if (autoIf.romance) {
    let ok = true;
    for (const [npc, expected] of Object.entries(autoIf.romance)) {
      const rel = gameState.player.relationships[npc];
      if (!rel || (rel as any).romance !== expected) { ok = false; break; }
    }
    if (ok) return true;
  }
  // flags: 全部flag匹配才算通过
  if (autoIf.flags) {
    let ok = true;
    for (const [flag, expected] of Object.entries(autoIf.flags)) {
      if (!!gameState.flags[flag] !== expected) { ok = false; break; }
    }
    if (ok) return true;
  }
  // affection: 全部NPC好感度>=min才算通过
  if (autoIf.affection) {
    let ok = true;
    for (const [npc, min] of Object.entries(autoIf.affection)) {
      const rel = gameState.player.relationships[npc];
      if (!rel || rel.affection < min) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function checkAndQueueIntermission(outcome: any) {
  if (outcome?.intermission) {
    const inter = outcome.intermission;
    const povNpc = inter.npc || inter.npcs?.[0] || "旁白";
    const otherNpcs = inter.npc ? inter.npcs : (inter.npcs ? inter.npcs.slice(1) : undefined);

    gameState._cutaway_queue ??= [];
    gameState._cutaway_queue.push({
      type: "幕间",
      npc: povNpc,
      weight: inter.weight !== undefined ? inter.weight : 80,
      setting: inter.setting,
      topic: inter.topic,
      npcs: otherNpcs,
      length: inter.length || "long",
      tone: inter.tone,
      must_cover: inter.must_cover,
      reveal_level: inter.reveal_level,
      trigger: inter.trigger || "剧情节点触发"
    });
  }
}

/** 自动推进所有满足 auto_if 条件的 beat，返回推进描述列表 */
async function autoAdvanceQuest(ev: any, q: any): Promise<string[]> {
  const logs: string[] = [];
  if (!ev.beats) return logs;  // 动态事件无 beats 定义，直接返回
  let safety = 0;
  while (safety < 20) {
    safety++;
    const currentBeat = ev.beats.find((b: any) => b.id === q.current_beat);
    if (!currentBeat) break;

    // 无 outcomes 的终结 beat：如果 expires_quest，完成 it
    if (!currentBeat.outcomes) {
      if (currentBeat.expires_quest) {
        if (currentBeat.effects) await applyBeatEffects(currentBeat.effects);
        q.status = "completed";
        gameState.completed_events.push(ev.id);
        logs.push("任务完成");
      }
      break;
    }

    const autoOutcome = currentBeat.outcomes.find(
      (o: any) => o.auto_if && checkAutoIf(o.auto_if)
    );
    if (!autoOutcome) break;

    // 执行自动选择
    q.outcomes[currentBeat.id] = autoOutcome.pick;
    checkAndQueueIntermission(autoOutcome);
    if (currentBeat.effects) await applyBeatEffects(currentBeat.effects);
    if (autoOutcome.effects) await applyBeatEffects(autoOutcome.effects);
    logs.push(`${currentBeat.label} → ${autoOutcome.pick}`);

    if (currentBeat.expires_quest) {
      q.status = "completed";
      gameState.completed_events.push(ev.id);
      logs.push("任务完成");
      return logs;
    }

    if (autoOutcome.next_beat) {
      q.current_beat = autoOutcome.next_beat;
    } else {
      q.status = "completed";
      gameState.completed_events.push(ev.id);
      logs.push("任务完成");
      return logs;
    }
  }
  return logs;
}

/** 打开一个 quest（LLM 通过工具调用） */
export async function openQuest(eventId: string): Promise<string | null> {
  const events = loadAllTimelines();
  let ev: any = events.find(e => e.id === eventId);
  // 没找到 → 尝试动态事件注册表（LLM/引擎运行时创建）
  if (!ev) {
    gameState.dynamicEvents ??= [];
    ev = gameState.dynamicEvents.find((e: any) => e.id === eventId);
  }
  if (!ev) return `未找到事件: ${eventId}`;

  gameState.quests ??= {};
  if (gameState.quests[eventId]) return `任务 ${eventId} 已存在`;

  gameState.quests[eventId] = {
    id: eventId,
    title: ev.title,
    status: "active",
    current_beat: ev.beats[0]?.id ?? null,
    started_day: currentDay(),
    outcomes: {},
  };

  // 从 active_hooks 中移除
  gameState.active_hooks = gameState.active_hooks.filter(h => h.event_id !== eventId);
  // 如果是动态事件，从注册表移除
  removeDynamicEvent(eventId);

  // 自动推进满足 auto_if 条件的 beat
  const autoLogs = await autoAdvanceQuest(ev, gameState.quests[eventId]);
  const q = gameState.quests[eventId];
  if (q.status === "completed") {
    return `任务开始并自动完成: ${ev.title} (${autoLogs.join("; ")})`;
  }
  if (autoLogs.length > 0) {
    return `任务开始: ${ev.title} [自动推进: ${autoLogs.join(" → ")}]`;
  }
  return `任务开始: ${ev.title}`;
}

/** 推进 quest beat */
export async function advanceQuest(eventId: string, outcomeKey?: string): Promise<string | null> {
  gameState.quests ??= {};
  const q = gameState.quests[eventId];
  if (!q) return `未找到任务: ${eventId}`;

  const events = loadAllTimelines();
  let ev: any = events.find(e => e.id === eventId);
  // 静态事件找不到 → 尝试动态事件注册表
  if (!ev) {
    gameState.dynamicEvents ??= [];
    ev = gameState.dynamicEvents.find((e: any) => e.id === eventId);
  }
  if (!ev) return `未找到事件定义: ${eventId}`;

  // LLM 动态事件无 beats → 直接完成 + 幕间
  if (!ev.beats || ev.beats.length === 0) {
    q.status = "completed";
    gameState.completed_events.push(eventId);
    checkAndQueueIntermission(ev);
    return `任务完成: ${ev.title || eventId}`;
  }

  // 找当前 beat
  const currentBeat = ev.beats.find((b: any) => b.id === q.current_beat);
  if (!currentBeat) return `未找到当前节拍: ${q.current_beat}`;

  // 记录玩家选择
  if (outcomeKey) q.outcomes[currentBeat.id] = outcomeKey;

  // 应用 beat effects
  if (currentBeat.effects) {
    await applyBeatEffects(currentBeat.effects);
  }

  // 应用 outcome effects
  if (outcomeKey && currentBeat.outcomes) {
    const oc = currentBeat.outcomes.find((o: any) => o.pick === outcomeKey);
    if (oc?.effects) await applyBeatEffects(oc.effects);
    checkAndQueueIntermission(oc);
  }


  // 如果 expires_quest → 标记完成
  if (currentBeat.expires_quest) {
    q.status = "completed";
    gameState.completed_events.push(eventId);
    checkAndQueueIntermission(ev);  // event-level intermission fallback
    return `任务完成: ${ev.title}`;
  }

  // 找下一个 beat
  let nextBeatId: string | null = null;
  if (outcomeKey && currentBeat.outcomes) {
    const oc = currentBeat.outcomes.find((o: any) => o.pick === outcomeKey);
    if (oc?.next_beat) nextBeatId = oc.next_beat;
  }

  if (nextBeatId) {
    q.current_beat = nextBeatId;
    // 自动推进满足 auto_if 条件的后续 beat
    const autoLogs = await autoAdvanceQuest(ev, q);
    if (q.status === "completed") {
      return `任务完成: ${ev.title} [自动推进: ${autoLogs.join(" → ")}]`;
    }
    const beatLabel = ev.beats.find((b: any) => b.id === nextBeatId)?.label || nextBeatId;
    if (autoLogs.length > 0) {
      return `任务推进: ${ev.title} → ${beatLabel} [自动推进: ${autoLogs.join(" → ")}]`;
    }
    return `任务推进: ${ev.title} → ${beatLabel}`;
  }

  // 没有 next_beat → 完成
  q.status = "completed";
  gameState.completed_events.push(eventId);
  checkAndQueueIntermission(ev);  // event-level intermission fallback
  return `任务完成: ${ev.title}`;
}

/** 放弃 quest */
export function abandonQuest(eventId: string): string | null {
  gameState.quests ??= {};
  const q = gameState.quests[eventId];
  if (!q) return `未找到任务: ${eventId}`;
  q.status = "abandoned";
  gameState.completed_events.push(eventId);
  return `任务已放弃: ${q.title}`;
}

/** 获取今日日历条目（供 prompt 注入） — 区分预热/当天/余波三阶段 */
export function getTodayCalendar(): string {
  const d = gameState.time.game_date;
  const loc = gameState.player.location;
  const { phase, entries } = getCalendarPhase(d, loc);

  if (phase === "none" || entries.length === 0) return "";

  // Pick up to 2 entries, prefer location-matched over location-null
  const locationMatch = entries.filter(e => e.location !== null);
  const anyMatch = entries.filter(e => e.location === null);
  const picked = [...locationMatch, ...anyMatch].slice(0, 2);

  switch (phase) {
    case "pre":
      return picked.map(e => e.advance_hook || e.text).join(" ");
    case "today":
      return picked.map(e => e.text).join(" ");
    case "after":
      return picked.map(e => e.aftermath_text || e.text).join(" ");
    default:
      return "";
  }
}

async function applyBeatEffects(effects: {
  flags?: Record<string, boolean>;
  affection?: Record<string, number>;
  sex?: any;
  memoryTags?: Record<string, { tag: string; expires?: number; tone?: string }[]>;
  npcRelations?: Record<string, Record<string, { stage: string; tone: string; notes: string }>>;
  playerRelations?: Record<string, { stage?: string; romance?: string; notes?: string }>;
}): Promise<void> {
  if (effects.flags) {
    for (const [k, v] of Object.entries(effects.flags)) {
      gameState.flags[k] = v;
    }
  }
  if (effects.affection) {
    for (const [npc, delta] of Object.entries(effects.affection)) {
      updateRelation(gameState.player.relationships, npc, delta, "剧情事件");
    }
  }
  if (effects.sex) {
    const { getOrCreateSexState } = await import("./state.ts");
    let settleAfterSex: any = null;
    try { settleAfterSex = (await import("./sex.ts")).settleAfterSex; } catch { /* public repo */ }
    if (!settleAfterSex) return;
    const ss = await getOrCreateSexState(effects.sex.npc);
    if (ss) {
      settleAfterSex(
        ss,
        gameState.time.game_date,
        effects.sex.duration || 30,
        effects.sex.touched_parts || [],
        effects.sex.thoughts || [],
        effects.sex.partner || "维"
      );
    }
  }
  if (effects.memoryTags) {
    const { addMemoryTag, appendShortTermBuffer } = await import("./state.ts");
    for (const [npc, tags] of Object.entries(effects.memoryTags)) {
      for (const t of tags) {
        addMemoryTag(npc, t.tag, t.expires ?? 365, t.tone, (t as any).priority, (t as any).emotional_valence, (t as any).related_npcs, (t as any).category);
        try {
          appendShortTermBuffer(npc, undefined, `剧情事件: ${t.tag}`);
        } catch (e) { console.error("applyBeatEffects appendShortTermBuffer error:", e); }
      }
    }
  }
  if (effects.npcRelations) {
    const { getOrCreateNPC } = await import("./state.ts");
    for (const [fromNPC, targets] of Object.entries(effects.npcRelations)) {
      const npc = getOrCreateNPC(fromNPC);
      npc.npcRelationships ??= {};
      for (const [toNPC, rel] of Object.entries(targets)) {
        npc.npcRelationships[toNPC] = {
          stage: rel.stage,
          tone: rel.tone,
          notes: rel.notes
        };
      }
    }
  }
  if (effects.playerRelations) {
    for (const [npc, rel] of Object.entries(effects.playerRelations)) {
      if (gameState.player.relationships[npc]) {
        if (rel.stage) gameState.player.relationships[npc].stage = rel.stage as any;
        if (rel.romance) gameState.player.relationships[npc].romance = rel.romance as any;
        if (rel.notes) gameState.player.relationships[npc].notes = rel.notes;
      } else {
        gameState.player.relationships[npc] = {
          stage: (rel.stage || "陌生") as any,
          romance: (rel.romance || null) as any,
          affection: 0,
          notes: rel.notes || "",
          history: []
        };
      }
    }
  }
}


/**
 * 时间线快进：开局时若 game_date 晚于 timeline_origin，自动补完已过期的事件。
 * 只跳过 location/time_of_day/flags/affection 检查 — 纯时间驱动的事件视为「已按 canonical 路径发生」。
 * 按 min_day 升序处理，确保前序事件的 flag/affection effects 为后续事件提供前置条件。
 * max_day 已过的事件 → 应用 on_expire 效果（标记为未发生但有后果）。
 * 返回自动完成的 event ID 列表。
 */
export async function fastForwardTimeline(startingDay: number): Promise<string[]> {
  const events = loadAllTimelines();
  gameState.completed_events ??= [];
  gameState.flags ??= {};
  gameState.player.relationships ??= {};

  // 按 min_day 升序排列，确保依赖链正确
  const candidates = events
    .filter(ev => ev.trigger?.min_day && ev.trigger.min_day < startingDay)
    .sort((a, b) => (a.trigger.min_day || 0) - (b.trigger.min_day || 0));

  const autoCompleted: string[] = [];

  for (const ev of candidates) {
    // 已标记完成或不可重复 → 跳过
    if (gameState.completed_events.includes(ev.id) && !ev.repeatable) continue;

    const t = ev.trigger;

    // 仅检查与「跳过时间」无关的条件：年龄/人生阶段
    if ((t as any).min_age && gameState.player.age < (t as any).min_age) continue;
    if ((t as any).max_age && gameState.player.age > (t as any).max_age) continue;
    if ((t as any).player_stage) {
      const stageKey = gameState.time.player_stage;
      const stageConfig = (LIFE_STAGES as any)[stageKey];
      const label = stageConfig?.label;
      if (stageKey !== (t as any).player_stage && label !== (t as any).player_stage) continue;
    }

    // max_day 已过 → 事件窗口关闭，应用 on_expire 效果（如果有）
    if (t.max_day && startingDay > t.max_day) {
      if (ev.on_expire?.effects) {
        try { await applyBeatEffects(ev.on_expire.effects); } catch (e) { console.error(`fastForward: on_expire ${ev.id} error`, e); }
      }
      gameState.completed_events.push(ev.id);
      autoCompleted.push(`${ev.id}(expired)`);
      continue;
    }

    // 走过 canonical 路径：第一 beat 的第一个 outcome，跟随 next_beat 链
    const processedBeats = new Set<string>();
    let currentBeatId = ev.beats?.[0]?.id;
    let safety = 0;

    while (currentBeatId && safety < 20) {
      safety++;
      if (processedBeats.has(currentBeatId)) break;
      processedBeats.add(currentBeatId);

      const beat = ev.beats?.find(b => b.id === currentBeatId);
      if (!beat) break;

      // 应用 beat 级 effects
      if (beat.effects) {
        try { await applyBeatEffects(beat.effects); } catch (e) { console.error(`fastForward: beat ${ev.id}/${beat.id} effects error`, e); }
      }

      // 无 outcomes → 终结点
      if (!beat.outcomes || beat.outcomes.length === 0) break;

      // 选第一个 outcome（canonical 路径）
      const outcome = beat.outcomes[0];
      if (outcome.effects) {
        try { await applyBeatEffects(outcome.effects); } catch (e) { console.error(`fastForward: outcome ${ev.id}/${beat.id} effects error`, e); }
      }

      currentBeatId = outcome.next_beat || null;
    }

    gameState.completed_events.push(ev.id);
    autoCompleted.push(ev.id);
  }

  return autoCompleted;
}