/**
 * Layer 1 性欲模块 - 可选
 * 不启用时不注入LLM上下文。
 * 
 * 参考: NW2规则 + Koikatsu设计思路
 * 原则: engine算数字，LLM只收描述，玩家永远看不到数值面板
 */

import type { SexProfile, SexState, Thought, SettlementReport } from "./types.ts";

export type CyclePhase = "生理期" | "安全期" | "排卵期";
export type SexPhase = "caress" | "service" | "insertion";
export type { SexProfile, SexState };

// --- 预设档案 ---
export const SEX_PROFILES: Record<string, SexProfile> = {
  "雪之下雪乃": {
    baselineDesire: 25, attitude: "抗拒", experience: "未开发",
    female: {
      breast: { cup: "A", shape: "水滴", nipple_size: "小", nipple_color: "淡粉", areola_size: "普通", feel: "柔软" },
      vagina: { type: "一线天", labia_size: "小", depth_cm: 13, tightness: "极紧", inner_color: "淡粉", feel: "紧致" },
      pubic_hair: { amount: "稀疏", color: "黑色", style: "自然" }, clitoris: "隐藏",
    },
    bodyParts: {
      "唇":   { sensitivity: 8, development: 0, preference: "普通" },
      "颈":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "胸":   { sensitivity: 6, development: 0, preference: "排斥" },
      "腰":   { sensitivity: 7, development: 0, preference: "普通" },
      "腿":   { sensitivity: 5, development: 0, preference: "普通" },
      "秘部": { sensitivity: 3, development: 0, preference: "排斥" },
      "肛":   { sensitivity: 2, development: 0, preference: "排斥" },
    },
    cycleDay: 14, climaxThreshold: 40,
    likes: ["被动被引导", "注视对方的眼睛", "温柔的触摸"],
    dislikes: ["粗暴", "被嘲笑", "公开场合"],
  },
  "由比滨结衣": {
    baselineDesire: 40, attitude: "顺从", experience: "未开发",
    female: {
      breast: { cup: "D", shape: "半球", nipple_size: "普通", nipple_color: "粉色", areola_size: "普通", feel: "柔软" },
      vagina: { type: "馒头", labia_size: "普通", depth_cm: 14, tightness: "紧致", inner_color: "玫瑰", feel: "紧致" },
      pubic_hair: { amount: "普通", color: "褐色", style: "修剪" }, clitoris: "普通",
    },
    bodyParts: {
      "唇":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "颈":   { sensitivity: 8, development: 0, preference: "喜欢" },
      "胸":   { sensitivity: 9, development: 0, preference: "普通" },
      "腰":   { sensitivity: 6, development: 0, preference: "普通" },
      "腿":   { sensitivity: 6, development: 0, preference: "普通" },
      "秘部": { sensitivity: 5, development: 0, preference: "普通" },
      "肛":   { sensitivity: 3, development: 0, preference: "排斥" },
    },
    cycleDay: 7, climaxThreshold: 35,
    likes: ["被夸赞", "拥抱", "接吻"], dislikes: ["被冷落", "太急"],
  },
  "喜多川海梦": {
    baselineDesire: 55, attitude: "主动", experience: "未开发",
    female: {
      breast: { cup: "E", shape: "吊钟", nipple_size: "大", nipple_color: "浅褐", areola_size: "宽", feel: "弹力" },
      vagina: { type: "贝壳", labia_size: "普通", depth_cm: 15, tightness: "普通", inner_color: "玫瑰", feel: "普通" },
      pubic_hair: { amount: "稀疏", color: "褐色", style: "剃除" }, clitoris: "敏感突出",
    },
    bodyParts: {
      "唇":   { sensitivity: 6, development: 0, preference: "喜欢" },
      "颈":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "胸":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "腰":   { sensitivity: 8, development: 0, preference: "喜欢" },
      "腿":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "秘部": { sensitivity: 8, development: 0, preference: "普通" },
      "肛":   { sensitivity: 5, development: 0, preference: "普通" },
    },
    cycleDay: 10, climaxThreshold: 50,
    likes: ["cosplay相关", "新鲜感的互动", "主动探索"], dislikes: ["单调重复", "太被动的人"],
  },
  "椎名詩織": {
    baselineDesire: 35, attitude: "期待", experience: "熟练",
    female: {
      breast: { cup: "J", shape: "纺锤", nipple_size: "普通", nipple_color: "浅褐", areola_size: "普通", feel: "柔软" },
      vagina: { type: "蝴蝶", labia_size: "普通", depth_cm: 15, tightness: "普通", inner_color: "玫瑰", feel: "普通" },
      pubic_hair: { amount: "普通", color: "黑色", style: "自然" }, clitoris: "普通",
    },
    bodyParts: {
      "唇":   { sensitivity: 6, development: 2, preference: "喜欢" },
      "颈":   { sensitivity: 7, development: 2, preference: "喜欢" },
      "胸":   { sensitivity: 7, development: 3, preference: "喜欢" },
      "腰":   { sensitivity: 5, development: 2, preference: "普通" },
      "腿":   { sensitivity: 5, development: 1, preference: "普通" },
      "秘部": { sensitivity: 6, development: 3, preference: "喜欢" },
      "肛":   { sensitivity: 3, development: 0, preference: "排斥" },
    },
    cycleDay: 2, climaxThreshold: 45,
    likes: ["温柔的引导", "耳边低语", "被夸奖身材"], dislikes: ["粗暴", "被提年龄", "仓促结束"],
  },
  "如月真绫": {
    baselineDesire: 40, attitude: "期待", experience: "未开发",
    female: {
      breast: { cup: "E", shape: "吊钟", nipple_size: "普通", nipple_color: "粉色", areola_size: "普通", feel: "柔软" },
      vagina: { type: "闭合", labia_size: "普通", depth_cm: 14, tightness: "紧致", inner_color: "淡粉", feel: "紧致" },
      pubic_hair: { amount: "稀疏", color: "黑色", style: "修剪" }, clitoris: "普通",
    },
    bodyParts: {
      "唇":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "颈":   { sensitivity: 8, development: 0, preference: "喜欢" },
      "胸":   { sensitivity: 8, development: 0, preference: "普通" },
      "腰":   { sensitivity: 6, development: 0, preference: "普通" },
      "腿":   { sensitivity: 7, development: 0, preference: "喜欢" },
      "秘部": { sensitivity: 5, development: 0, preference: "普通" },
      "肛":   { sensitivity: 3, development: 0, preference: "排斥" },
    },
    cycleDay: 12, climaxThreshold: 40,
    likes: ["被注视", "温柔的触摸", "在水边"], dislikes: ["粗暴", "在学校被发现"],
  },
  "雪之下绫乃": {
    baselineDesire: 50, attitude: "主动", experience: "熟练",
    female: {
      breast: { cup: "D", shape: "水滴", nipple_size: "普通", nipple_color: "浅褐", areola_size: "普通", feel: "柔软" },
      vagina: { type: "蝴蝶", labia_size: "普通", depth_cm: 14, tightness: "普通", inner_color: "玫瑰", feel: "名器" },
      pubic_hair: { amount: "普通", color: "黑色", style: "自然" }, clitoris: "普通",
    },
    bodyParts: {
      "唇":   { sensitivity: 6, development: 3, preference: "普通" },
      "颈":   { sensitivity: 8, development: 3, preference: "喜欢" },
      "胸":   { sensitivity: 8, development: 4, preference: "喜欢" },
      "腰":   { sensitivity: 7, development: 3, preference: "喜欢" },
      "腿":   { sensitivity: 7, development: 3, preference: "喜欢" },
      "秘部": { sensitivity: 7, development: 4, preference: "喜欢" },
      "肛":   { sensitivity: 5, development: 2, preference: "普通" },
    },
    cycleDay: 8, climaxThreshold: 55,
    likes: ["掌控节奏", "被服从", "耳边的恭维"], dislikes: ["被动", "敷衍", "被挑战权威"],
  },
};

// --- 周期 ---
export function getCyclePhase(day: number): CyclePhase {
  if (day === 0) return "安全期";
  if (day <= 5) return "生理期";
  if (day <= 13) return "安全期";
  if (day <= 15) return "排卵期";
  return "安全期";
}

// --- 欲望 ---
export function calcDesire(profile: SexProfile, state: SexState): number {
  let desire = profile.baselineDesire;
  if (state.cyclePhase === "排卵期") desire *= 2;
  if (state.cyclePhase === "生理期") desire = Math.max(0, desire - 30);
  const devBonus = Object.values(profile.bodyParts).reduce((sum, p) => sum + p.development, 0);
  desire += devBonus * 2;
  if (state.climaxed) desire = Math.max(0, desire - 40);
  return Math.min(100, Math.max(0, Math.round(desire)));
}

// --- 开发度→解锁动作 ---
export function getAvailableActions(profile: SexProfile, state: SexState, posDB?: PositionDB): {
  phase: SexPhase;
  actions: string[];
  locked: string[];
  positions: string[];
  lockedPositions: string[];
} {
  const dev = Object.values(profile.bodyParts).reduce((sum, p) => sum + p.development, 0);
  const avgDev = Object.keys(profile.bodyParts).length > 0 ? dev / Object.keys(profile.bodyParts).length : 0;
  
  let phase: SexPhase = "caress";
  if (state.climaxCount >= 1) phase = "service";
  if (state.climaxCount >= 2) phase = "insertion";
  
  const actions: string[] = ["接吻", "抚摸头发", "拥抱", "说话"];
  const locked: string[] = [];
  
  if (avgDev >= 0.5) actions.push("抚摸身体");
  else locked.push("抚摸身体 [需开发≥0.5]");
  
  if (avgDev >= 1) actions.push("手指进入");
  else locked.push("手指进入 [需开发≥1]");
  
  if (phase === "service" || phase === "insertion") {
    actions.push("口交");
    if (avgDev >= 1.5) actions.push("乳交");
    else locked.push("乳交 [需开发≥1.5]");
  }
  
  if (phase === "insertion") {
    actions.push("插入");
    const analDev = profile.bodyParts["肛"]?.development ?? 0;
    if (analDev >= 2) actions.push("肛交");
    else locked.push("肛交 [需开发≥2]");
  }
  
  const positions = getPositionsForPhase(phase, avgDev, profile, posDB);
  const lockedPositions = getLockedPositions(phase, avgDev, profile, posDB);
  
  return { phase, actions, locked, positions, lockedPositions };
}

// 体位数据shape（与 positions.json 对应）
export interface PositionDef {
  phase: "caress" | "service" | "insertion";
  devRequired: number;
  scene: string[];
  tags: string[];
  desc: string;
}

export type PositionDB = Record<string, PositionDef>;

function getPositionsForPhase(phase: SexPhase, avgDev: number, _profile: SexProfile, posDB?: PositionDB): string[] {
  if (!posDB) return []; // 没有体位数据时不报错，返回空
  if (phase !== "insertion" && phase !== "service") return [];
  const unlocked: string[] = [];
  const allPositions = Object.entries(posDB);
  let mainPhase = phase; // service 也允许显示插入体位（如69等互含体位在service中也可能用到insertion条目）

  for (const [name, def] of allPositions) {
    if (def.devRequired <= avgDev) unlocked.push(name);
  }
  return unlocked;
}

function getLockedPositions(phase: SexPhase, avgDev: number, _profile: SexProfile, posDB?: PositionDB): string[] {
  if (!posDB) return [];
  if (phase !== "insertion" && phase !== "service") return [];
  const locked: string[] = [];
  for (const [name, def] of Object.entries(posDB)) {
    if (def.devRequired > avgDev) {
      locked.push(`${name} [需开发≥${def.devRequired}]`);
    }
  }
  return locked;
}

// --- 互动 ---
export interface TouchResult {
  arousalChange: number;
  reaction: string;
  sensitive: boolean;
}

export function touchBodyPart(profile: SexProfile, state: SexState, part: string, intensity: "轻" | "中" | "重"): TouchResult {
  const bp = profile.bodyParts[part];
  if (!bp) return { arousalChange: 0, reaction: "无特别反应", sensitive: false };
  
  if (bp.preference === "排斥" && bp.development === 0) {
    return { arousalChange: -3, reaction: "明显退缩，身体绷紧", sensitive: true };
  }
  
  const intensityMult = { "轻": 0.5, "中": 1.0, "重": 1.5 };
  const change = bp.sensitivity * intensityMult[intensity] - bp.development;
  const finalChange = Math.round(Math.max(0, change)); // 最低0,不会降
  
  const devDesc = getDevDescription(bp.development);
  let reaction = "";
  if (finalChange >= 10) reaction = `剧烈反应, ${devDesc}`;
  else if (finalChange >= 5) reaction = `身体颤抖, ${devDesc}`;
  else if (finalChange >= 2) reaction = "轻轻吸气";
  else reaction = "没什么反应";
  
  return { arousalChange: finalChange, reaction, sensitive: finalChange >= 5 };
}

function getDevDescription(dev: number): string {
  if (dev < 1) return "很紧张, 动作僵硬";
  if (dev < 2) return "开始适应触碰";
  if (dev < 3) return "自然地回应";
  return "主动配合";
}

// --- 自慰(NPC自主, 不注入LLM除非被看到) ---
export function masturbate(state: SexState, minutes: number): { climaxed: boolean; arousalChange: number } {
  const rate = state.profile.bodyParts["秘部"] ? state.profile.bodyParts["秘部"].sensitivity * 0.3 : 2;
  const gain = Math.round(rate * (minutes / 10));
  state.arousal = Math.min(100, state.arousal + gain);
  const did = checkClimax(state);
  if (did) triggerClimax(state);
  return { climaxed: did, arousalChange: gain };
}

// --- 高潮 ---
export function checkClimax(state: SexState): boolean {
  return state.arousal >= state.profile.climaxThreshold && !state.climaxed;
}

export function triggerClimax(state: SexState): SexState {
  state.climaxed = true;
  state.climaxCount++;
  state.arousal = Math.max(0, state.arousal - 30);
  state.desire = Math.max(0, calcDesire(state.profile, state) - 40);
  const sq = checkSquirt(state.profile, state.arousal + 30);
  if (sq.triggered) state.squirtCount++;
  return state;
}

// --- 潮吹 ---
export function checkSquirt(profile: SexProfile, arousal: number): { triggered: boolean; hint: string } {
  if (!profile.female) return { triggered: false, hint: "" };
  const clit = profile.female.clitoris;
  const threshold = clit === "敏感突出" ? 75 : clit === "普通" ? 85 : 95;
  if (arousal < threshold) return { triggered: false, hint: "" };
  
  const baseChance = clit === "敏感突出" ? 0.35 : clit === "普通" ? 0.15 : 0.05;
  const triggered = Math.random() < baseChance;
  return { triggered, hint: triggered ? "[潮吹]" : "" };
}

// --- 开发度成长 ---
export function developPart(state: SexState, part: string): void {
  const bp = state.profile.bodyParts[part];
  if (!bp || bp.development >= 4) return;
  bp.development += 0.1;
  if (bp.development >= 1 && bp.development < 1.1) bp.development = 1;
  if (bp.development >= 2 && bp.development < 2.1) bp.development = 2;
  if (bp.development >= 3 && bp.development < 3.1) bp.development = 3;
  if (bp.development >= 4) bp.development = 4;
}

// --- 更新整体经验 ---
export function updateExperience(profile: SexProfile): void {
  const avgDev = Object.values(profile.bodyParts).reduce((sum, p) => sum + p.development, 0) / Object.keys(profile.bodyParts).length;
  if (avgDev >= 3) profile.experience = "深度开发";
  else if (avgDev >= 2) profile.experience = "熟练";
  else if (avgDev >= 1) profile.experience = "生涩";
}

// --- LLM注入文本 ---
export function getDesireNarrative(state: SexState): string {
  if (state.cyclePhase === "生理期") return "今天身体不太舒服，没什么兴致。";
  if (state.desire <= 20) return "";
  if (state.desire <= 40) return "偶尔无意识地调整了一下坐姿。";
  if (state.desire <= 60) return "眼神偶尔飘向对方，又迅速移开。";
  if (state.desire <= 80) return "呼吸有些乱，脸颊微微发烫。";
  return "脑子里的想法越来越危险。";
}

export function getArousalNarrative(state: SexState): string {
  if (state.arousal <= 10) return "";
  if (state.arousal <= 30) return "呼吸变快了。";
  if (state.arousal <= 50) return "身体开始发烫，咬住嘴唇不让自己出声。";
  if (state.arousal <= 70) return "已经顾不上表情管理了，声音漏出来。";
  if (state.arousal <= 90) return "全身感官集中在被触碰的地方。";
  return "快到极限了——";
}

export function getDevNarrative(profile: SexProfile): string {
  const dev = Object.values(profile.bodyParts).reduce((sum, p) => sum + p.development, 0) / Object.keys(profile.bodyParts).length;
  if (dev < 1) return "身体还很生涩, 对触碰反应剧烈但不知道如何回应。";
  if (dev < 2) return "开始适应亲密的接触, 偶尔会无意识地贴近。";
  if (dev < 3) return "已经熟悉身体的语言, 能自然地回应对方。";
  return "完全放开了。知道怎么让自己舒服, 也知道怎么让对方舒服。";
}

// --- 心里话 mood_hint（注入LLM上下文，控制心里话语感倾向） ---
export type MoodHint = "沉溺" | "动摇" | "身心分离的绝望";

export function getMoodHint(affection: number, attitude: SexProfile["attitude"]): MoodHint {
  if (affection >= 70 || attitude === "沉溺" || attitude === "主动") return "沉溺";
  if (affection < 40 || attitude === "抗拒") return "身心分离的绝望";
  return "动摇";
}

// --- 心里话（LLM生成 → engine存储） ---
export function recordThought(state: SexState, text: string, gameDate: string, context: "climax_after" | "scene_end"): void {
  if (!state.thoughts) state.thoughts = [];
  state.thoughts.push({ text: text.slice(0, 60), timestamp: gameDate, context });
}

// 获取心里话摘要（注入LLM可见，最多3条）
export function getThoughtsSummary(state: SexState): string {
  if (!state.thoughts || state.thoughts.length === 0) return "";
  const recent = state.thoughts.slice(-3);
  return recent.map(t => `[${t.context}] ${t.text}`).join("\n");
}

// --- 事后结算 ---
export function settleAfterSex(
  state: SexState,
  gameDate: string,
  durationMinutes: number,
  partsTouched: string[],
  thoughtsTexts: string[]
): SettlementReport {
  // 心里话
  state.thoughts ??= [];
  for (const t of thoughtsTexts) {
    state.thoughts.push({ text: t.slice(0, 60), timestamp: gameDate, context: "scene_end" });
  }

  // 部位成长记录
  const partsGrowth: Record<string, number> = {};
  for (const part of partsTouched) {
    const before = state.profile.bodyParts[part]?.development ?? 0;
    developPart(state, part);
    const after = state.profile.bodyParts[part]?.development ?? 0;
    const diff = Math.round((after - before) * 10) / 10;
    if (diff > 0) partsGrowth[part] = diff;
  }

  // 更新经验
  updateExperience(state.profile);

  // 评级
  const score = state.climaxCount * 20 + state.squirtCount * 15 + Object.keys(partsGrowth).length * 10;
  let rating: SettlementReport["rating"] = "C";
  if (score >= 100) rating = "SSS";
  else if (score >= 80) rating = "SS";
  else if (score >= 60) rating = "S";
  else if (score >= 40) rating = "A";
  else if (score >= 20) rating = "B";

  // 结算后重置
  const report: SettlementReport = {
    duration_minutes: durationMinutes,
    climaxCount: state.climaxCount,
    squirtCount: state.squirtCount,
    partsGrowth,
    rating,
    thoughts: [...(state.thoughts ?? [])],
  };

  // 重置本轮状态，保留欲望值
  state.arousal = 0;
  state.climaxed = false;
  state.climaxCount = 0;
  state.squirtCount = 0;
  state.desire = Math.max(0, state.desire - 50);

  return report;
}

// 结算报告格式（TUI面板用，不给LLM）
export function formatSettlement(report: SettlementReport, charName: string): string {
  const ratingEmoji: Record<string, string> = { "SSS": "👑", "SS": "🌟", "S": "⭐", "A": "💫", "B": "✨", "C": "💤" };
  const emoji = ratingEmoji[report.rating] ?? "";

  let out = `\n══ 事后结算 ══\n`;
  out += `${charName}\n`;
  out += `用时: ${report.durationMinutes}分钟 | 高潮: ${report.climaxCount}次`;
  if (report.squirtCount > 0) out += ` | 潮吹: ${report.squirtCount}次`;
  out += `\n评级: ${emoji} ${report.rating}`;

  if (Object.keys(report.partsGrowth).length > 0) {
    out += `\n部位成长:`;
    for (const [part, gain] of Object.entries(report.partsGrowth)) {
      out += ` ${part}+${gain}`;
    }
  }

  if (report.thoughts.length > 0) {
    out += `\n心里话:`;
    for (const t of report.thoughts.slice(-3)) {
      out += `\n  「${t.text}」`;
    }
  }

  return out;
}
