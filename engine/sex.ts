/**
 * Layer 1 性欲模块 - 可选
 * 不启用时不注入LLM上下文。
 * 
 * 参考: NW2规则 + Koikatsu设计思路
 * 原则: engine算数字，LLM只收描述，玩家永远看不到数值面板
 */

import type { SexProfile, SexState, Thought, SettlementReport, SexualMilestones } from "./types.ts";
export type CyclePhase = "生理期" | "安全期" | "排卵期";
export type SexPhase = "caress" | "service" | "insertion";
export type { SexProfile, SexState };

import sexProfilesStatic from "../data/sex_profiles.json" with { type: "json" };

let sexProfilesData = sexProfilesStatic as any;

export function setSexProfiles(newProfiles: any) {
  sexProfilesData = newProfiles;
}

export const SEX_PROFILES: Record<string, SexProfile> = new Proxy({} as any, {
  get(_, prop) {
    const data = sexProfilesData || sexProfilesStatic;
    return data[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(sexProfilesData || sexProfilesStatic || {});
  },
  getOwnPropertyDescriptor(_, prop) {
    const v = (sexProfilesData || sexProfilesStatic || {})[prop];
    return v ? { configurable: true, enumerable: true, value: v } : undefined;
  }
}) as any;

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

  const intensityMult: Record<string, number> = { "轻": 0.5, "中": 1.0, "重": 1.5 };
  const mult = intensityMult[intensity] ?? 1.0; // 防御非预期 intensity 值导致 NaN
  const sens = typeof bp.sensitivity === "number" ? bp.sensitivity : 1;
  const dev = typeof bp.development === "number" ? bp.development : 0;
  const change = sens * mult - dev;
  const finalChange = Math.round(Math.max(0, change));
  if (isNaN(finalChange)) return { arousalChange: 0, reaction: "无特别反应", sensitive: false };
  
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

// ── 社交情境标签系统（注入 NPC Agent / GM prompt，约束而非剧本）──
// 原则：引擎提供情境事实 + 行为约束，LLM 在约束内自由生成。
// 参考 Ena/Shiro 系统：告诉 LLM 什么不该做 > 告诉它该做什么。

export type ExposureLevel = "clothed" | "partially_undressed" | "topless" | "underwear_only" | "fully_nude";
export type SocialSetting = "private" | "semi_public" | "public";

export interface SocialContext {
  /** 触发情境类型 */
  trigger: "undress" | "seen_naked" | "caught_changing" | "accidental_exposure" | "wardrobe_malfunction"
         | "intimate_touch" | "sexual_topic" | "seeing_body" | "general_embarrassment";
  /** 当前穿着/暴露程度 */
  exposure: ExposureLevel;
  /** 场景私密性 */
  setting: SocialSetting;
  /** 在场的人（名列表，空则仅玩家） */
  present: string[];
  /** 第一次在此人/这些人面前处于此状态 */
  firstTime: boolean;
  /** 该 NPC 的「世故度」——对性/身体话题的认知水平 */
  worldliness?: "纯真" | "普通" | "早熟" | "老练";
}

/** 生成轻量社交情境标签（1-3 行）。
 *  这些是「约束性提示」——告诉 LLM 当前的身体/认知状态，
 *  但不预设具体反应。LLM 在约束内自由发挥。 */
export function getSocialContextTags(
  profile: SexProfile,
  state: SexState,
  ctx: SocialContext
): string {
  const tags: string[] = [];
  const att = profile.attitude;
  const exp = profile.experience;
  const wl = ctx.worldliness ?? (
    exp === "未开发" ? "纯真" : exp === "生涩" ? "普通" : exp === "熟练" ? "早熟" : "老练"
  );

  // ── 身体状态标签 ──
  if (ctx.exposure !== "clothed") {
    const expMod = exp === "未开发" ? "身体对触碰反应剧烈、不加掩饰" :
                   exp === "生涩" ? "会紧张但试着配合，身体反应诚实" :
                   exp === "熟练" ? "熟悉自己的身体，不慌张但也不会假装没感觉" :
                   "完全掌控自己的身体反应，会主动引导";

    if (ctx.firstTime) {
      tags.push(`[初次裸露] 第一次在${ctx.present.join("、") || "此人"}面前暴露到${ctx.exposure}程度。本能防御机制激活。`);
    }
    tags.push(`[身体状态] 穿着:${ctx.exposure} | 身体经验:${expMod} | 性格底色:${att}`);
  }

  // ── 认知标签（知道多少、对性/身体话题的理解水平）──
  if (ctx.trigger === "sexual_topic" || ctx.trigger === "seeing_body") {
    if (wl === "纯真") {
      tags.push(`[认知] 对性/身体话题几乎一无所知。听不懂暗示，看到异性身体可能只是好奇而非兴奋。反应是「这是正常的吗？」而非「这很色情」。`);
    } else if (wl === "普通") {
      tags.push(`[认知] 有基本的性知识但缺乏实际经验。能听懂暗示但会脸红。看到异性身体知道意味着什么，但不确定自己该怎么反应。`);
    } else if (wl === "早熟") {
      tags.push(`[认知] 知识+经验都有。能自然地谈论身体/性话题。看到异性的身体反应知道自己想要什么。`);
    } else {
      tags.push(`[认知] 什么都见过。对性/身体话题不尴尬、不回避。能坦率评价、引导或调侃。`);
    }
  }

  // ── 社交压力标签 ──
  if (ctx.setting === "public") {
    tags.push(`[⚠️ 公开场合] 随时可能被外人看到。反应会被压抑——小动作代替大动作。越克制越有张力。禁止: 夸张反应、大声。`);
  } else if (ctx.setting === "semi_public") {
    tags.push(`[半公开] 有被看到的可能。紧张感让身体更敏感。偶尔瞥向门/窗。`);
  }

  if (ctx.present.length > 1) {
    tags.push(`[旁观者] ${ctx.present.join("、")}在场。NPC的反应会被旁观者影响——对熟人更尴尬，对陌生人更警惕。`);
  }

  // ── 禁止事项（Shiro 模式 — 告诉 LLM 什么绝对不要写）──
  const bans: string[] = [];
  if (ctx.firstTime && att !== "沉溺") {
    bans.push("禁止: 坦然接受、主动配合、游刃有余。这是第一次——应该有紧张/犹豫/笨拙。");
  }
  if (att === "抗拒") {
    bans.push("禁止: 享受、迎合、主动。她的身体语言是关闭的——即使不反抗也是僵硬的。");
  }
  if (ctx.setting !== "private") {
    bans.push("禁止: 完全放松、大声呻吟、忘我状态。有人在附近。");
  }
  if (wl === "纯真" && (ctx.trigger === "sexual_topic" || ctx.trigger === "seeing_body")) {
    bans.push("禁止: 老练的评价、性暗示、主动调情。她根本不懂这些——反应是困惑或天真。");
  }

  if (bans.length > 0) {
    tags.push(`[禁止] ${bans.join(" | ")}`);
  }

  return tags.join("\n");
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
  thoughtsTexts: string[],
  partnerName?: string  // 对方名字，用于记录初体验对象
): SettlementReport {
  // 心里话
  state.thoughts ??= [];
  for (const t of thoughtsTexts) {
    state.thoughts.push({ text: t.slice(0, 60), timestamp: gameDate, context: "scene_end" });
  }

  // 初体验检测（仅在有对方时记录；自慰不计入）
  state.milestones ??= {
    virginity: { isVirgin: true, lostTo: null, lostAt: null },
    firstKiss: { given: false, partner: null, date: null },
    analVirginity: { isVirgin: true, lostTo: null, lostAt: null },
  };
  const milestonesChanged: string[] = [];

  if (partnerName) {
    if (partsTouched.includes("唇") && !state.milestones.firstKiss.given) {
      state.milestones.firstKiss.given = true;
      state.milestones.firstKiss.partner = partnerName;
      state.milestones.firstKiss.date = gameDate;
      milestonesChanged.push(`初吻: ${partnerName}`);
    }
    if (partsTouched.includes("秘部") && state.milestones.virginity.isVirgin) {
      state.milestones.virginity.isVirgin = false;
      state.milestones.virginity.lostTo = partnerName;
      state.milestones.virginity.lostAt = gameDate;
      milestonesChanged.push(`初体验: ${partnerName}`);
    }
    if (partsTouched.includes("肛") && state.milestones.analVirginity.isVirgin) {
      state.milestones.analVirginity.isVirgin = false;
      state.milestones.analVirginity.lostTo = partnerName;
      state.milestones.analVirginity.lostAt = gameDate;
      milestonesChanged.push(`菊初: ${partnerName}`);
    }
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
    milestonesChanged: milestonesChanged.length > 0 ? milestonesChanged : undefined,
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
  // 初体验高亮
  if (report.milestonesChanged && report.milestonesChanged.length > 0) {
    for (const m of report.milestonesChanged) {
      out += `💝 ${m}\n`;
    }
  }
  out += `用时: ${report.duration_minutes}分钟 | 高潮: ${report.climaxCount}次`;
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

// --- 创建 SexState 实例 ---
export function createSexState(name: string, profile: SexProfile): SexState {
  const day = profile.cycleDay || 1 + Math.floor(Math.random() * 28);
  // 为 profile 注入 name 字段以利于还原引用
  (profile as any).name = name;
  // 初始化里程碑：全员默认为初（角色数据约定后续可覆盖）
  const milestones: SexualMilestones = {
    virginity: { isVirgin: true, lostTo: null, lostAt: null },
    firstKiss: { given: false, partner: null, date: null },
    analVirginity: { isVirgin: true, lostTo: null, lostAt: null },
  };
  return {
    profile,
    desire: profile.baselineDesire,
    arousal: 0,
    cycleDay: day,
    cyclePhase: getCyclePhase(day),
    climaxed: false,
    climaxCount: 0,
    squirtCount: 0,
    thoughts: [],
    milestones,
  };
}

// --- 初吻记录（gal 模式下 LLM 可通过 patch_state 触发，或直接调用） ---
export function recordFirstKiss(state: SexState, partnerName: string, gameDate: string): boolean {
  state.milestones ??= {
    virginity: { isVirgin: true, lostTo: null, lostAt: null },
    firstKiss: { given: false, partner: null, date: null },
    analVirginity: { isVirgin: true, lostTo: null, lostAt: null },
  };
  if (state.milestones.firstKiss.given) return false; // 已有初吻
  state.milestones.firstKiss.given = true;
  state.milestones.firstKiss.partner = partnerName;
  state.milestones.firstKiss.date = gameDate;
  return true;
}
