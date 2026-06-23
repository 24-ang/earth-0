/**
 * NPC 人生事件引擎 — 追踪状态变化，自动产钩子/改状态
 *
 * 设计原则：
 * - 引擎不编故事——状态机推进到里程碑 → 产钩子，GM 决定叙事
 * - 和 SexState 同模式：纯引擎追踪，零 tk
 * - 只支持第一期事件类型：illness / pregnancy
 */

import type { LifeEvent, IllnessState, PregnancyState } from "./types.ts";
import { gameState, getOrCreateNPC, saveState } from "./state.ts";
import { injectDynamicEvent, removeDynamicEvent, currentDay } from "./timeline.ts";

/** 每回合调用：推进所有 NPC 的人生事件 */
export function tickLifeEvents(): void {
  const day = currentDay();

  for (const [npcName, npc] of Object.entries(gameState.npcs)) {
    if (!npc.lifeEvents || npc.lifeEvents.length === 0) continue;

    for (const ev of [...npc.lifeEvents]) {
      switch (ev.type) {
        case "illness": tickIllness(npcName, ev, day); break;
        case "pregnancy": tickPregnancy(npcName, ev, day); break;
        // criminal / conflict: 数据结构保留，状态机留待后续
      }
    }
  }
}

/** 疾病状态机 */
function tickIllness(npcName: string, ev: LifeEvent, day: number): void {
  const data = ev.data as IllnessState;
  const daysElapsed = day - data.day_started;
  const npc = gameState.npcs[npcName];
  if (!npc) return;

  // 连续 3 天没去学校/工作 → 产钩子
  if (daysElapsed >= 3 && data.severity !== "重") {
    const eventId = `illness_${npcName}`;
    injectDynamicEvent({
      id: eventId,
      source: "engine",
      expires_days: 4,
      repeatable: false,
      hook: {
        source_npc: npcName,
        hook_text: `${npcName}已经好几天没出现了——她/他是不是病了？`,
        urgency: data.severity === "中" ? "medium" : "low",
      },
    });
  }

  // 重病 → 自动设 pendingOverride 去医院
  if (data.severity === "重" && !npc.pendingOverride) {
    npc.pendingOverride = {
      location: "医院",
      action: "住院治疗中",
      reason: `${ev.id}: 重病`,
      expiresAt: `${day + 7}`,
    };
    saveState();
  }
}

/** 怀孕状态机 */
function tickPregnancy(npcName: string, ev: LifeEvent, day: number): void {
  const data = ev.data as PregnancyState;
  const daysElapsed = day - data.day_started;
  const npc = gameState.npcs[npcName];
  if (!npc) return;

  // Stage progression
  let newStage: typeof data.stage | null = null;

  // early → visible: ~90 天（3 个月）
  if (data.stage === "early" && daysElapsed >= 90) {
    newStage = "visible";
  }
  // visible → due: ~180 天（6 个月）
  if (data.stage === "visible" && daysElapsed >= 180) {
    newStage = "due";
  }

  if (newStage && newStage !== data.stage) {
    data.stage = newStage;
    const eventId = `pregnancy_${npcName}`;

    switch (newStage) {
      case "visible":
        injectDynamicEvent({
          id: eventId,
          source: "engine",
          expires_days: 7,
          repeatable: false,
          hook: {
            source_npc: npcName,
            hook_text: `${npcName}的身体似乎有些变化——她怀孕的事已经瞒不住了`,
            urgency: "medium",
          },
        });
        npc.pendingOverride = {
          location: npc.currentRoom,
          action: "动作变得小心翼翼",
          reason: `${ev.id}: 怀孕可见期`,
          expiresAt: `${day + 100}`,
        };
        break;

      case "due":
        injectDynamicEvent({
          id: eventId,
          source: "engine",
          expires_days: 3,
          repeatable: false,
          hook: {
            source_npc: npcName,
            hook_text: `${npcName}的预产期快到了——她随时可能分娩`,
            urgency: "high",
          },
        });
        npc.pendingOverride = {
          location: "医院",
          action: "住院待产中",
          reason: `${ev.id}: 预产期临近`,
          expiresAt: `${day + 14}`,
        };
        break;
    }
    saveState();
  }

  // due 阶段 270+ 天（~9个月）→ 分娩
  if (data.stage === "due" && daysElapsed >= 270) {
    const eventId = `pregnancy_${npcName}`;
    injectDynamicEvent({
      id: eventId,
      source: "engine",
      expires_days: 1,
      repeatable: false,
      hook: {
        source_npc: npcName,
        hook_text: `${npcName}生下了一个孩子！`,
        urgency: "high",
      },
    });
    // 清除人生事件 + pendingOverride
    npc.pendingOverride = null;
    npc.lifeEvents = (npc.lifeEvents || []).filter(e => e.id !== ev.id);
    saveState();
  }
}

/** GM/引擎设一个 NPC 人生事件 */
export function addLifeEvent(npcName: string, event: LifeEvent): string {
  const npc = getOrCreateNPC(npcName);
  npc.lifeEvents ??= [];
  // 同类型事件去重（一个 NPC 不会同时有两种怀孕）
  npc.lifeEvents = npc.lifeEvents.filter(e => e.type !== event.type);
  npc.lifeEvents.push(event);
  saveState();
  return `${npcName} 人生事件已添加: ${event.type} (${event.id})`;
}

/** 移除人生事件（分娩后/病愈后调用） */
export function removeLifeEvent(npcName: string, eventId: string): string {
  const npc = gameState.npcs[npcName];
  if (!npc?.lifeEvents) return `${npcName} 没有人生事件`;
  npc.lifeEvents = npc.lifeEvents.filter(e => e.id !== eventId);
  removeDynamicEvent(`illness_${npcName}`);
  removeDynamicEvent(`pregnancy_${npcName}`);
  saveState();
  return `${npcName} 人生事件已移除: ${eventId}`;
}
