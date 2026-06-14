/**
 * 剧情事件引擎 — 扫描 timeline JSON，管理钩子生命周期，注入 prompt
 *
 * 设计原则（来自 fate-sandbox + tavern2agent）：
 * - 引擎只设 flag + 注入 context，不写死台词
 * - 钩子不是 MMO 弹窗，hook_text 是自然叙事文本
 * - active_hooks 上限 3，超限自动清旧
 * - 钩子重复出现强制写 novelty
 */

import type { TimelineEvent, Hook, QuestState } from "./types.ts";
import { gameState, getOrCreateNPC, updateRelation } from "./state.ts";
import fs from "node:fs";
import path from "node:path";

const TIMELINES_DIR = path.resolve(process.cwd(), "data", "timelines");
const CALENDAR_FILE = path.resolve(process.cwd(), "data", "calendar.json");

/** 加载世界日历 */
let _calendarCache: Record<string, string> | null = null;
function loadCalendar(): Record<string, string> {
  if (_calendarCache) return _calendarCache;
  try { _calendarCache = JSON.parse(fs.readFileSync(CALENDAR_FILE, "utf-8")); } catch (_) { _calendarCache = {}; }
  return _calendarCache!;
}

/** 加载所有 timeline 文件 */
function loadAllTimelines(): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (!fs.existsSync(TIMELINES_DIR)) return events;
  for (const f of fs.readdirSync(TIMELINES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(TIMELINES_DIR, f), "utf-8"));
      if (Array.isArray(data)) events.push(...data);
    } catch (_) {}
  }
  return events;
}

/** 计算当前游戏天数（从 game_date 解析） */
function currentDay(): number {
  const d = gameState.time.game_date; // "2018-04-07"
  const parts = d.split("-");
  const start = new Date(Number(parts[0]), 0, 1);
  const now = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
}

/** 检查触发条件 */
function checkTrigger(event: TimelineEvent, day: number): boolean {
  const t = event.trigger;
  // 天数条件
  if (t.min_day && day < t.min_day) return false;
  if (t.max_day && day > t.max_day) return false;
  // 时间带
  if (t.time_of_day && !t.time_of_day.includes(gameState.time.time_of_day)) return false;
  // 地点
  if (t.location && gameState.player.location !== t.location) return false;
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
  return true;
}

/** 每回合调用：扫描未触发事件 → 满足条件 → 加入 active_hooks */
export function checkTimelineEvents(): void {
  const day = currentDay();
  const events = loadAllTimelines();
  gameState.active_hooks ??= [];
  gameState.completed_events ??= [];

  for (const ev of events) {
    // 已完成/已过期/不可重复 → 跳过
    if (gameState.completed_events.includes(ev.id) && !ev.repeatable) continue;
    // 已在钩子列表中 → 跳过
    if (gameState.active_hooks.some(h => h.event_id === ev.id)) continue;
    // 条件不满足 → 跳过
    if (!checkTrigger(ev, day)) continue;

    // 创建钩子
    const hook: Hook = {
      event_id: ev.id,
      source_npc: ev.hook.source_npc,
      hook_text: ev.hook.hook_text,
      urgency: ev.hook.urgency,
      created_day: day,
      expires_day: day + ev.expires_days,
      seen_count: 0,
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
    // 多余的标记为过期
    const removed = gameState.active_hooks.splice(3);
    for (const h of removed) {
      expireHook(h);
    }
  }
}

/** 清理过期钩子 */
export function expireHooks(): void {
  const day = currentDay();
  gameState.active_hooks ??= [];
  gameState.completed_events ??= [];
  const remaining: Hook[] = [];
  for (const h of gameState.active_hooks) {
    if (day > h.expires_day) {
      expireHook(h);
    } else {
      remaining.push(h);
    }
  }
  gameState.active_hooks = remaining;
}

/** 单个钩子过期处理 */
function expireHook(hook: Hook): void {
  const events = loadAllTimelines();
  const ev = events.find(e => e.id === hook.event_id);
  if (!ev) return;

  // 记录到 completed_events
  if (!ev.repeatable) {
    gameState.completed_events.push(ev.id);
  }

  // 执行 on_expire effects
  if (ev.on_expire?.effects) {
    const fx = ev.on_expire.effects;
    if (fx.flags) {
      for (const [k, v] of Object.entries(fx.flags)) {
        gameState.flags[k] = v;
      }
    }
    if (fx.affection) {
      for (const [npc, delta] of Object.entries(fx.affection)) {
        updateRelation(gameState.player.relationships, npc, delta, "剧情事件过期");
      }
    }
  }

  // 如果有对应的 active quest，标记为 expired
  if (gameState.quests[hook.event_id]?.status === "active") {
    gameState.quests[hook.event_id].status = "expired";
  }
}

/** 获取活跃钩子列表（供 prompt 注入） */
export function getActiveHooks(): Hook[] {
  gameState.active_hooks ??= [];
  return gameState.active_hooks;
}

/** 获取活跃 quest 列表 */
export function getActiveQuests(): QuestState[] {
  gameState.quests ??= {};
  return Object.values(gameState.quests).filter(q => q.status === "active");
}

/** 打开一个 quest（LLM 通过工具调用） */
export function openQuest(eventId: string): string | null {
  const events = loadAllTimelines();
  const ev = events.find(e => e.id === eventId);
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

  return `任务开始: ${ev.title}`;
}

/** 推进 quest beat */
export function advanceQuest(eventId: string, outcomeKey?: string): string | null {
  gameState.quests ??= {};
  const q = gameState.quests[eventId];
  if (!q) return `未找到任务: ${eventId}`;

  const events = loadAllTimelines();
  const ev = events.find(e => e.id === eventId);
  if (!ev) return `未找到事件定义: ${eventId}`;

  // 找当前 beat
  const currentBeat = ev.beats.find(b => b.id === q.current_beat);
  if (!currentBeat) return `未找到当前节拍: ${q.current_beat}`;

  // 记录玩家选择
  if (outcomeKey) q.outcomes[currentBeat.id] = outcomeKey;

  // 应用 beat effects
  if (currentBeat.effects) {
    applyBeatEffects(currentBeat.effects);
  }

  // 应用 outcome effects
  if (outcomeKey && currentBeat.outcomes) {
    const oc = currentBeat.outcomes.find(o => o.pick === outcomeKey);
    if (oc?.effects) applyBeatEffects(oc.effects);
  }

  // 如果 expires_quest → 标记完成
  if (currentBeat.expires_quest) {
    q.status = "completed";
    gameState.completed_events.push(eventId);
    return `任务完成: ${ev.title}`;
  }

  // 找下一个 beat
  let nextBeatId: string | null = null;
  if (outcomeKey && currentBeat.outcomes) {
    const oc = currentBeat.outcomes.find(o => o.pick === outcomeKey);
    if (oc?.next_beat) nextBeatId = oc.next_beat;
  }

  if (nextBeatId) {
    q.current_beat = nextBeatId;
    return `任务推进: ${ev.title} → ${ev.beats.find(b => b.id === nextBeatId)?.label || nextBeatId}`;
  }

  // 没有 next_beat → 完成
  q.status = "completed";
  gameState.completed_events.push(eventId);
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

/** 获取今日日历文本（供 prompt 注入） */
export function getTodayCalendar(): string {
  const cal = loadCalendar();
  const d = gameState.time.game_date; // "2018-04-07"
  const parts = d.split("-");
  const mmdd = `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  return cal[mmdd] || "";
}

/** 清除日历缓存（测试用） */
export function clearCalendarCache(): void {
  _calendarCache = null;
}

function applyBeatEffects(effects: { flags?: Record<string, boolean>; affection?: Record<string, number> }): void {
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
}
