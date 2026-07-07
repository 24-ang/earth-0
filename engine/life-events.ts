/**
 * NPC 人生事件引擎 — 追踪状态变化，自动产钩子/改状态
 *
 * 设计原则：
 * - 引擎不编故事——状态机推进到里程碑 → 产钩子，GM 决定叙事
 * - 和 SexState 同模式：纯引擎追踪，零 tk
 * - 只支持第一期事件类型：illness / pregnancy
 */

import type { LifeEvent, IllnessState, PregnancyState } from "./types.ts";
import { gameState, getOrCreateNPC, saveState, registerDynamicCharacter } from "./state.ts";
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
    // Clean up pregnancy event and pendingOverride
    npc.pendingOverride = null;
    npc.lifeEvents = (npc.lifeEvents || []).filter(e => e.id !== ev.id);
    
    // Trigger child birth registration and hydration
    try {
      const childName = triggerBirth(npcName, data.father);
      console.log(`tickPregnancy: ${npcName} successfully gave birth to ${childName}`);
    } catch (e) {
      console.error(`tickPregnancy: ${npcName} child birth registration failed`, e);
    }
    saveState();
  }
}

/** 触发婴儿出生注册与遗传算法 */
export function triggerBirth(motherName: string, fatherName: string, nameConfig?: {
  surnames?: string[];
  maleNames?: string[];
  femaleNames?: string[];
}): string {
  const mother = getOrCreateNPC(motherName);

  // Resolve father state
  let father: any = null;
  if (fatherName === gameState.player.name) {
    father = gameState.player;
  } else {
    father = getOrCreateNPC(fatherName);
  }

  // Determine child's gender (50% male/female)
  const isFemale = Math.random() < 0.5;
  const gender = isFemale ? "female" : "male";

  // Surname extraction: try config list first, then derive from father name
  const surnames = nameConfig?.surnames || [];
  let surname = "";
  for (const s of surnames) {
    if (fatherName.startsWith(s)) { surname = s; break; }
  }
  if (!surname) {
    // Generic fallback: take first 1-2 chars of father's name
    surname = fatherName.length >= 2 ? fatherName.slice(0, 2) : fatherName;
  }

  // Choose first name from config or use generic fallback
  const maleNames = nameConfig?.maleNames || [];
  const femaleNames = nameConfig?.femaleNames || [];

  // Generic fallback names (not tied to any specific worldpack)
  const fallbackMale = ["太朗", "大介", "健太", "阳翔", "大翔"];
  const fallbackFemale = ["樱", "花", "美咲", "葵", "阳菜"];

  const mNames = maleNames.length > 0 ? maleNames : fallbackMale;
  const fNames = femaleNames.length > 0 ? femaleNames : fallbackFemale;
  const firstName = isFemale
    ? fNames[Math.floor(Math.random() * fNames.length)]
    : mNames[Math.floor(Math.random() * mNames.length)];
  const childName = `${surname}${firstName}`;

  // Averaging & mutation for attributes
  const childAttributes: Record<string, number> = {};
  const attrKeys = ["力量", "敏捷", "体质", "智力", "感知", "魅力", "幸运"];
  for (const k of attrKeys) {
    const mVal = mother.attributes[k] ?? 10;
    const fVal = father.attributes[k] ?? 10;
    const avg = (mVal + fVal) / 2;
    // Mutation [-1, +2]
    const mutation = Math.floor(Math.random() * 4) - 1; // -1, 0, 1, 2
    childAttributes[k] = Math.max(3, Math.min(18, Math.round(avg + mutation)));
  }

  // Register child as a dynamic character
  registerDynamicCharacter(childName, {
    gender,
    base_age: 0, // baby
    appearance_brief: `${surname}家新生儿，长相可爱稚嫩。`,
    attributes: childAttributes,
    default_location: mother.currentRoom || "千叶_住宅区",
    schedule_group: "自由人"
  });

  // Hydrate child as an NPC in gameState.npcs
  gameState.npcs[childName] = {
    name: childName,
    gender,
    age: 0,
    currentRoom: mother.currentRoom || "千叶_住宅区",
    gridPos: mother.gridPos ? [...mother.gridPos] : null,
    attributes: childAttributes,
    skills: {},
    abilities: {},
    hp: { current: 10, max: 10 },
    equipment: {},
    inventory: [],
    wounds: [],
    funds: 0,
    alive: true,
    fatigue: 0,
    action: "熟睡中",
    known_locations: [mother.currentRoom || "千叶_住宅区"],
    npcRelationships: {
      [motherName]: { stage: "亲子", affection: 100, tone: "和", notes: "母亲" },
      [fatherName]: { stage: "亲子", affection: 100, tone: "和", notes: "父亲" }
    }
  } as any;

  // Add mutual relationship from mother to child
  mother.npcRelationships ??= {};
  mother.npcRelationships[childName] = {
    stage: "亲子",
    affection: 100,
    tone: "和",
    notes: "孩子",
    romance: null,
    history: []
  } as any;

  // Add mutual relationship from father to child
  if (fatherName === gameState.player.name) {
    gameState.player.relationships ??= {};
    gameState.player.relationships[childName] = {
      stage: "亲子",
      affection: 100,
      notes: "孩子",
      romance: null,
      history: []
    } as any;
  } else {
    father.npcRelationships ??= {};
    father.npcRelationships[childName] = {
      stage: "亲子",
      affection: 100,
      tone: "和",
      notes: "孩子",
      romance: null,
      history: []
    } as any;
  }

  saveState();
  return childName;
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
