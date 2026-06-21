/**
 * 状态引擎 - 角色状态 + HP + 负重 + 物品操作 + 持久化
 */

import type { PlayerState, GameState, EquipmentSlots, Item, Wound, Relationship, AttrKey, NPCRuntimeState, StealResult, Skill, StaticCharacter, RoomGrid, SexState, TurnLogEntry, RevealEntry, VisibilityLevel, ContainerState, ContainerDef } from "./types.ts";
import { promptCollectors, schedule, type Collector } from "./collectors.ts";
import { INITIAL_TIME_STATE } from "./time.ts";
import charactersStatic from "../data/characters.json" with { type: "json" };
import roomsStatic from "../data/rooms.json" with { type: "json" };
import { lookupRegion } from "./router.ts";
import charStagesStatic from "../data/character_stages.json" with { type: "json" };
import fs from "node:fs";
import path from "node:path";
import titleRulesStatic from "../data/title_rules.json" with { type: "json" };
import namelessNpcTemplatesStatic from "../data/nameless_npc_templates.json" with { type: "json" };
import economyConfigStatic from "../data/economy.json" with { type: "json" };
import { getSeason, mapChineseWeather, transitionWeather } from "./weather.ts";

export let characters = charactersStatic as any[];
export let rooms = roomsStatic as Record<string, RoomGrid>;
export let charStages = charStagesStatic as any;
export let titleRules = titleRulesStatic as any;
export let namelessNpcTemplates = namelessNpcTemplatesStatic as any;
export let economyConfig = economyConfigStatic as any;

export function getCurrency(): string {
  return economyConfig.currency ?? "¥";
}

export function getConstructionMultiplier(): number {
  return economyConfig.construction_multiplier ?? 100;
}

import shopsCatalogStatic from "../data/shops.json" with { type: "json" };
import itemsCatalogStatic from "../data/items.json" with { type: "json" };
import phoneAppsCatalogStatic from "../data/phone_apps.json" with { type: "json" };
import positionsCatalogStatic from "../data/positions.json" with { type: "json" };
import regionsStatic from "../data/regions.json" with { type: "json" };
import sexProfilesStatic from "../data/sex_profiles.json" with { type: "json" };
import scheduleTemplatesStatic from "../data/schedule_templates.json" with { type: "json" };
import roomTemplatesStatic from "../data/room_templates.json" with { type: "json" };

export let shops = shopsCatalogStatic as any;
export let shopsCatalog = shopsCatalogStatic as any;
export let itemsCatalog = itemsCatalogStatic as any;
export let phoneApps = phoneAppsCatalogStatic as any;
export let phoneAppsCatalog = phoneAppsCatalogStatic as any;
export let positions = positionsCatalogStatic as any;
export let positionsCatalog = positionsCatalogStatic as any;
export let regions = regionsStatic as any;
export let scheduleTemplates = scheduleTemplatesStatic as any;
export let roomTemplates = roomTemplatesStatic as any;
export let activeWorldName = "oregairu";


// --- 空间数据定义 ---
export let ROOMS = structuredClone(rooms);

import locationsDataStatic from "../data/locations.json" with { type: "json" };
import schoolMapDataStatic from "../data/school_map.json" with { type: "json" };
import cityMapDataStatic from "../data/city_map.json" with { type: "json" };
import regionsDataStatic from "../data/regions.json" with { type: "json" };
export let locationsData = locationsDataStatic as any;
export let schoolMapData = schoolMapDataStatic as any;
export let cityMapData = cityMapDataStatic as any;
export let regionsData = regionsDataStatic as any;
export let LOCATIONS_BASE = locationsData as any;
export let SCHOOL_MAP = schoolMapData as any;
export let CITY_MAP = cityMapData as any;
// 运行时地点覆盖层：LLM 动态创建的地点 { parentName: [childName, ...] }
export let LOCATIONS_DELTA: Record<string, string[]> = {};

// 运行时角色注册表：LLM 动态创建的角色 { name: StaticCharacter-like }
export let DYNAMIC_CHARACTERS: Record<string, any> = {};

export function getRoomKey(roomName: string): string | null {
  if (!roomName) return null;
  if (ROOMS[roomName]) return roomName;
  const cleanName = roomName.replace(/[（(].*[）)]/, "").trim().toLowerCase();
  if (ROOMS[cleanName]) return cleanName;
  for (const key of Object.keys(ROOMS)) {
    const cleanKey = key.replace(/[（(].*[）)]/, "").trim().toLowerCase();
    if (cleanKey === cleanName || cleanKey.includes(cleanName) || cleanName.includes(cleanKey)) {
      return key;
    }
  }
  return null;
}

export function isSameLocation(loc1: string, loc2: string): boolean {
  if (!loc1 || !loc2) return false;
  if (loc1 === loc2) return true;
  const k1 = getRoomKey(loc1);
  const k2 = getRoomKey(loc2);
  if (k1 && k2) return k1 === k2;
  
  const clean = (s: string) => s.replace(/[（(].*[）)]/, "").trim().toLowerCase();
  const c1 = clean(loc1);
  const c2 = clean(loc2);
  if (c1 === c2) return true;

  if (c1.includes("总武") && c2.includes("总武")) return true;
  return false;
}

// --- 模块级游戏状态（单例，整个 session 一份） ---
const STATE_DIR = path.resolve(process.cwd(), "state");
const STATE_FILE = path.join(STATE_DIR, "session.json");
const TURN_BACKUP_DIR = path.join(STATE_DIR, "turn_backups");
const SAVES_DIR = path.join(STATE_DIR, "saves");
const MAX_BACKUPS = 5;
const AGENTS_DIR = path.resolve(process.cwd(), "agents");

export let gameState: GameState = createInitialState();

function createInitialState(): GameState {
  return {
    time: { ...INITIAL_TIME_STATE },
    player: createDefaultPlayer(),
    npcs: {},
    sexStates: {},
    mode: "gal",
    activeWorld: "oregairu",
    layer1Enabled: false,
    auMode: false,
    flags: {},
    weather: { type: "晴", temp: 16 },
    turn: 0,
    roomTimestamps: {},
    turnLog: [],
    storySoFar: "",
    revealLog: [],
    calendarEvents: [],
    world_states: {},
  };
}

// ── Layer 2 回合台账 ──
export function recordTurnLog(entry: Omit<TurnLogEntry, "turn" | "timestamp">): TurnLogEntry {
  const log: TurnLogEntry = {
    ...entry,
    turn: gameState.turn,
    timestamp: `${gameState.time.year}年${gameState.time.month}月${gameState.time.day}日 ${gameState.time.timeOfDay ?? ""}`,
  };
  gameState.turnLog.push(log);
  // 滚动压缩：超过 10 条时，把最旧 5 条压成摘要
  if (gameState.turnLog.length > 10) {
    const batch = gameState.turnLog.splice(0, 5);
    const summary = batch.map(e =>
      `第${e.turn}回合${e.playerAction}，${e.sceneResult}。${e.resolvedChanges !== "无" ? e.resolvedChanges + "。" : ""}`
    ).join(" ");
    gameState.storySoFar = gameState.storySoFar
      ? `${gameState.storySoFar} ${summary}`
      : summary;
    // storySoFar 保留最近 500 字
    if (gameState.storySoFar.length > 500) {
      gameState.storySoFar = gameState.storySoFar.slice(-500).replace(/^[^\s]+\s/, "");
    }
  }
  saveState();
  return log;
}

/** 取最近 N 回合上下文 + 前情摘要 */
export function getRecentTurnLogContext(n: number = 5): string {
  const parts: string[] = [];
  if (gameState.storySoFar) parts.push(`[前情] ${gameState.storySoFar}`);
  const recent = gameState.turnLog.slice(-n);
  if (recent.length > 0) {
    parts.push(recent.map(e =>
      `[第${e.turn}回合] 玩家:${e.playerAction} | 变化:${e.resolvedChanges} | 场景:${e.sceneResult} | 钩子:${e.openHooks || "无"}`
    ).join("\n"));
  }
  return parts.join("\n");
}

// ── Layer 3 秘密防火墙 ──
export function revealSecret(id: string, content: string, fromLevel: VisibilityLevel, toLevel: VisibilityLevel): RevealEntry {
  const entry: RevealEntry = {
    id, content, fromLevel, toLevel,
    revealedAt: gameState.time.game_date,
    turn: gameState.turn,
  };
  gameState.revealLog.push(entry);
  saveState();
  return entry;
}

/** 获取已揭示为指定级别及以上（可见性从低到高: hidden → protagonist → player → public）的秘密 */
const VISIBILITY_RANK: Record<VisibilityLevel, number> = {
  "hidden_canonical": 0,
  "protagonist_known": 1,
  "player_known": 2,
  "scene_public": 3,
};

export function getRevealedSecrets(minLevel: VisibilityLevel): RevealEntry[] {
  const minRank = VISIBILITY_RANK[minLevel];
  return gameState.revealLog.filter(e => VISIBILITY_RANK[e.toLevel] >= minRank);
}

function createDefaultPlayer(): PlayerState {
  return {
    name: "维",
    gender: "男",
    age: 16,
    location: "住宅区",
    body: {
      height_cm: 170, weight_kg: 58, build: "标准", leg_type: "修长",
      skin: { base_tone: "普通", tan: 0, texture: "普通" },
    },
    attributes: { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10 },
    skills: {},
    hp: { current: 18, max: 18 },
    ac: 10,
    equipment: {},
    inventory: [],
    wounds: [],
    relationships: {},
    funds: 500,
    flags: {},
    alive: true,
    fatigue: 0,
    party: [],
    gridPos: null,
    reputation: {},
    known_locations: ["住宅区"],
    titles: [],
    properties: {},
  };
}

// --- 持久化 ---
export function saveState(filepath?: string): void {
  const fp = filepath ?? STATE_FILE;
  const targetDir = path.dirname(fp);
  fs.mkdirSync(targetDir, { recursive: true });
  
  // 房间修改也持久化，保存到 session 目录下的 rooms_delta.json，而不覆写 data/rooms.json
  const roomsDeltaPath = path.join(targetDir, "rooms_delta.json");
  fs.writeFileSync(roomsDeltaPath, JSON.stringify(ROOMS, null, 2));
  
  // 动态角色持久化
  const dcPath = path.join(targetDir, "dynamic_characters.json");
  fs.writeFileSync(dcPath, JSON.stringify(DYNAMIC_CHARACTERS, null, 2));

  // 动态地点持久化
  const deltaPath = path.join(targetDir, "locations_delta.json");
  fs.writeFileSync(deltaPath, JSON.stringify(LOCATIONS_DELTA, null, 2));

  fs.writeFileSync(fp, JSON.stringify(gameState, null, 2));
}

export function loadState(filepath?: string): boolean {
  const fp = filepath ?? STATE_FILE;
  if (!fs.existsSync(fp)) return false;
  const targetDir = path.dirname(fp);
  const raw = fs.readFileSync(fp, "utf-8");
  gameState = JSON.parse(raw) as GameState;
  
  // 读取 rooms_delta.json 并覆盖 ROOMS
  const roomsDeltaPath = path.join(targetDir, "rooms_delta.json");
  if (fs.existsSync(roomsDeltaPath)) {
    try {
      ROOMS = JSON.parse(fs.readFileSync(roomsDeltaPath, "utf-8"));
    } catch (_) {
      ROOMS = structuredClone(rooms);
    }
  } else {
    ROOMS = structuredClone(rooms);
  }

  loadLocationsDelta(targetDir);
  // 恢复动态角色
  const dcPath = path.join(targetDir, "dynamic_characters.json");
  if (fs.existsSync(dcPath)) {
    try {
      DYNAMIC_CHARACTERS = JSON.parse(fs.readFileSync(dcPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse dynamic_characters.json:", e);
      DYNAMIC_CHARACTERS = {};
    }
  } else {
    DYNAMIC_CHARACTERS = {};
  }
  // 迁移：旧存档无 roomTimestamps
  if (!gameState.roomTimestamps) gameState.roomTimestamps = {};
  if (!gameState.world_states) gameState.world_states = {};
  if (!gameState.player.properties) gameState.player.properties = {};

  // 还原 player.sex 引用，保障跨会话内存修改同步
  if (gameState.player.sex && gameState.sexStates) {
    const partnerName = (gameState.player.sex.profile as any).name;
    if (partnerName && gameState.sexStates[partnerName]) {
      gameState.player.sex = gameState.sexStates[partnerName];
    }
  }

  // 迁移：旧存档 sexStates 中 null 数值字段 → 初始化为 0
  if (gameState.sexStates) {
    for (const ss of Object.values(gameState.sexStates)) {
      if (ss.arousal == null) ss.arousal = 0;
      if (ss.desire == null) ss.desire = ss.profile.baselineDesire;
      if (ss.climaxCount == null) ss.climaxCount = 0;
      if (ss.squirtCount == null) ss.squirtCount = 0;
      if (ss.climaxed == null) ss.climaxed = false;
      if (!ss.thoughts) ss.thoughts = [];
      // 迁移：无 milestones 的旧存档 → 按 experience 推断初始状态
      if (!ss.milestones) {
        const isDev = ss.profile.experience === "熟练" || ss.profile.experience === "深度开发";
        ss.milestones = {
          virginity: { isVirgin: !isDev, lostTo: isDev ? "?" : null, lostAt: null },
          firstKiss: { given: isDev, partner: isDev ? "?" : null, date: null },
          analVirginity: { isVirgin: true, lostTo: null, lostAt: null },
        };
      }
    }
  }

  // 迁移：旧存档 player.age 与 time.player_age 不同步 → 用 time 覆盖 player
  if (gameState.time?.player_age && gameState.player.age !== gameState.time.player_age) {
    gameState.player.age = gameState.time.player_age;
  }
  // 迁移：旧 bug 存档（timeline_origin.age === 0 → 原为 {year:1992, age:0} 导致 NPC 年龄偏移 16 岁）
  // 仅修复 age===0 的破档；正常存档的 timeline_origin 必须保持不变（否则 NPC 年龄 delta 清零）
  if (gameState.time?.timeline_origin && gameState.time.timeline_origin.age === 0) {
    gameState.time.timeline_origin.age = gameState.time.player_age;
    gameState.time.timeline_origin.year = Number(gameState.time.game_date.split("-")[0]);
  }

  // 迁移：旧存档 npcs 属性/技能/生命值/存活状态补齐 (包含针对旧字段格式及 partial 对象的容错处理)
  if (gameState.npcs) {
    for (const [name, npc] of Object.entries(gameState.npcs)) {
      const src = findCharacter(name);
      const defaultAttrs: Attributes = { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10 };
      
      // 1. 补齐属性 (防范局部属性缺失)
      npc.attributes ??= { ...defaultAttrs };
      for (const key of Object.keys(defaultAttrs) as (keyof Attributes)[]) {
        if (npc.attributes[key] === undefined || typeof npc.attributes[key] !== "number") {
          npc.attributes[key] = src?.attributes?.[key] ?? defaultAttrs[key];
        }
      }

      // 2. 补齐生命值
      if (!npc.hp) {
        const npcAge = src ? getNpcCurrentAge(src.base_age || 16) : 16;
        const maxHP = src?.hp?.max ?? calcMaxHP(npc.attributes.体质, npcAge);
        const currentHP = src?.hp?.current ?? maxHP;
        npc.hp = { current: currentHP, max: maxHP };
      }
      if (npc.alive === undefined) {
        npc.alive = true;
      }

      // 3. 补齐并归一化技能映射 (支持旧版 Record<string, number> 格式)
      if (!npc.skills || typeof npc.skills !== "object") {
        npc.skills = {};
      }
      for (const [sName, sVal] of Object.entries(npc.skills) as any) {
        if (typeof sVal === "number") {
          npc.skills[sName] = {
            level: sVal,
            exp: 0,
            nextLevel: sVal * 10
          };
        } else if (!sVal || typeof sVal.level !== "number") {
          const defaultLevel = src?.skills?.[sName] ?? 1;
          npc.skills[sName] = {
            level: defaultLevel,
            exp: 0,
            nextLevel: defaultLevel * 10
          };
        }
      }
      // 从模板合并缺失的技能
      if (src && src.skills) {
        for (const [sName, sLevel] of Object.entries(src.skills)) {
          if (!npc.skills[sName]) {
            npc.skills[sName] = {
              level: sLevel as number,
              exp: 0,
              nextLevel: (sLevel as number) * 10
            };
          }
        }
      }
    }
  }

  return true;
}

// ── 手动存档槽位 + 回合自动备份 ──

/** 创建手动存档 */
export function createSave(name: string): string {
  const safeName = name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 50) || "quick";
  fs.mkdirSync(SAVES_DIR, { recursive: true });
  const fp = path.join(SAVES_DIR, `${safeName}.json`);
  saveState(fp);
  const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
  data._save_meta = { name: safeName, date: gameState.time.game_date, turn: gameState.turn, location: gameState.player.location, created: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  return safeName;
}

/** 载入手动存档 */
export function loadSave(name: string): boolean {
  const safeName = name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 50);
  const fp = path.join(SAVES_DIR, `${safeName}.json`);
  if (!fs.existsSync(fp)) return false;
  const ok = loadState(fp);
  if (ok) { backupBeforeTurn(); saveState(); }
  return ok;
}

/** 删除手动存档 */
export function deleteSave(name: string): boolean {
  const safeName = name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 50);
  const fp = path.join(SAVES_DIR, `${safeName}.json`);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

/** 列出所有手动存档 */
export function listSaves(): { name: string; date: string; turn: number; location: string }[] {
  const result: { name: string; date: string; turn: number; location: string }[] = [];
  if (!fs.existsSync(SAVES_DIR)) return result;
  for (const f of fs.readdirSync(SAVES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(SAVES_DIR, f), "utf-8");
      const meta = JSON.parse(raw)._save_meta;
      if (meta) result.push(meta);
    } catch (_) {}
  }
  result.sort((a, b) => b.turn - a.turn);
  return result;
}

/** 备份当前存档（commit_turn 前自动调用），滚动保留最近 N 个 */
export function backupBeforeTurn(): void {
  fs.mkdirSync(TURN_BACKUP_DIR, { recursive: true });
  for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
    const older = path.join(TURN_BACKUP_DIR, `turn_${i}.json`);
    const newer = path.join(TURN_BACKUP_DIR, `turn_${i + 1}.json`);
    if (fs.existsSync(older)) {
      try { fs.renameSync(older, newer); } catch (_) { try { fs.copyFileSync(older, newer); fs.unlinkSync(older); } catch (_) {} }
    }
  }
  saveState(path.join(TURN_BACKUP_DIR, "turn_1.json"));
}

/** 还原到倒数第 N 回合的存档（1=上一回合） */
export function restoreLastTurn(n: number = 1): boolean {
  const safeN = Math.max(1, Math.min(n, MAX_BACKUPS));
  const fp = path.join(TURN_BACKUP_DIR, `turn_${safeN}.json`);
  if (!fs.existsSync(fp)) return false;
  return loadState(fp);
}

/** 列出可用的备份 */
export function listBackups(): number[] {
  const result: number[] = [];
  for (let i = 1; i <= MAX_BACKUPS; i++) {
    if (fs.existsSync(path.join(TURN_BACKUP_DIR, `turn_${i}.json`))) result.push(i);
  }
  return result;
}

export function resetState(): void {
  gameState = createInitialState();
  ROOMS = structuredClone(rooms);
  // 删除默认 session 对应的 rooms_delta.json
  const roomsDeltaPath = path.join(STATE_DIR, "rooms_delta.json");
  if (fs.existsSync(roomsDeltaPath)) {
    try { fs.unlinkSync(roomsDeltaPath); } catch (_) {}
  }
  // 删除 locations_delta.json 并重置内存
  LOCATIONS_DELTA = {};
  const locDeltaPath = path.join(STATE_DIR, "locations_delta.json");
  if (fs.existsSync(locDeltaPath)) {
    try { fs.unlinkSync(locDeltaPath); } catch (_) {}
  }
  // 重置动态角色
  DYNAMIC_CHARACTERS = {};
  const dcPath = path.join(STATE_DIR, "dynamic_characters.json");
  if (fs.existsSync(dcPath)) {
    try { fs.unlinkSync(dcPath); } catch (_) {}
  }
  saveState();
}

// --- 状态简报模板注入（填充 gm-state.md 的 {{}} 变量） ---
/** 按年龄取身体数据：优先 body_by_age（找 ≤ targetAge 的最大键），否则 fallback body */
export function getBodyForAge(char: StaticCharacter | any, targetAge: number): BodyMeasurements {
  if (char.body_by_age) {
    const keys = Object.keys(char.body_by_age).map(Number).sort((a,b) => a - b);
    let best = keys[0];
    for (const k of keys) {
      if (k <= targetAge) best = k;
      else break;
    }
    return (char.body_by_age[String(best)] || char.body) as BodyMeasurements;
  }
  return char.body as BodyMeasurements;
}

/** 按年龄取外貌：仅发育期应用 appearance_by_age，达到覆盖最大键后回退 base */
export function getAppearanceForAge(char: StaticCharacter | any, targetAge: number): {
  hair_color?: string; hair_style?: string; eye_color?: string; hair_accessories?: string;
} {
  const base = {
    hair_color: char.hair_color,
    hair_style: char.hair_style,
    eye_color: char.eye_color,
    hair_accessories: char.hair_accessories,
  };
  if (!char.appearance_by_age) return base;
  const keys = Object.keys(char.appearance_by_age).map(Number).sort((a, b) => a - b);
  // 已达到覆盖最大年龄 → 直接用 base
  if (targetAge >= keys[keys.length - 1]) return base;
  // 发育期 → 找 ≤ targetAge 的最大键
  let best = keys[0];
  for (const k of keys) {
    if (k <= targetAge) best = k;
    else break;
  }
  return { ...base, ...char.appearance_by_age[String(best)] };
}

/** 计算 NPC 当前年龄（base_age + 游戏时间流逝） */
export function getNpcCurrentAge(npcBaseAge: number): number {
  const ageDelta = gameState.player.age - (gameState.time?.timeline_origin?.age ?? 16);
  return Math.max(0, npcBaseAge + ageDelta);
}

/** 设置玩家位置并自动发现新地点 */
export function setPlayerLocation(loc: string): void {
  gameState.player.location = loc;
  if (!gameState.player.known_locations) gameState.player.known_locations = ["住宅区"];
  if (!gameState.player.known_locations.includes(loc)) {
    gameState.player.known_locations.push(loc);
  }
}

export function getPlayerStatusNarrative(p: PlayerState): string {
  const hpPct = p.hp.current / p.hp.max;
  let status = "完好";
  if (hpPct <= 0) status = "濒死 / 死亡豁免中";
  else if (hpPct < 0.2) status = "重伤 (极度虚弱，动作迟缓，意识模糊)";
  else if (hpPct < 0.5) status = "受伤 (伤口流血，呼吸急促，动作受限)";
  else if (hpPct < 0.8) status = "轻伤 (有些许擦伤或疼痛)";
  else status = "健康 (精神饱满)";
  
  let desc = `[玩家状态] ${p.name} | 身体状况: ${status}`;
  if (p.wounds && p.wounds.length > 0) {
    desc += ` | 伤势描述: ${p.wounds.map(w => `${w.severity}: ${w.text}`).join(", ")}`;
  }
  return desc;
}

// --- 称号系统（引擎自动授予，只加不删） ---
export function checkAndGrantTitles(): void {
  const p = gameState.player;
  p.titles = []; // 动态触发：每次重置，只保留当前仍符合条件的称号
  const grant = (title: string) => { if (!p.titles.includes(title)) p.titles.push(title); };

  for (const rule of titleRules) {
    if (rule.location_filter && !rule.location_filter.some((loc: string) => p.location.includes(loc))) {
      continue;
    }
    const cond = rule.condition;
    let match = false;
    if (cond.type === "reputation") {
      match = (p.reputation[cond.group] ?? 0) >= cond.min;
    } else if (cond.type === "reputation_max") {
      match = (p.reputation[cond.group] ?? 0) <= cond.max;
    } else if (cond.type === "attribute") {
      match = ((p.attributes as any)[cond.attr] ?? 0) >= cond.min;
    } else if (cond.type === "funds") {
      match = p.funds >= cond.min;
    } else if (cond.type === "skill") {
      match = (p.skills[cond.skillName]?.level ?? 0) >= cond.min;
    }

    if (match) grant(rule.title);
  }
}

export function getDisguiseIdentity(player: PlayerState): string | null {
  for (const item of Object.values(player.equipment)) {
    if (!item || !item.effects) continue;
    for (const eff of item.effects) {
      if (eff.type === "disguise_tag") return String(eff.value);
    }
  }
  return null;
}

// ── 声誉 → 自然语言 ──

/** 将玩家的多维声望转为 LLM 可引用的自然语言。根据当前身份过滤可见组。 */
export function getReputationNarrative(): string {
  const p = gameState.player;
  const rep = p.reputation;
  if (!rep || Object.keys(rep).length === 0) return "";

  const disguise = getDisguiseIdentity(p);
  if (disguise) {
    return `你当前伪装为${disguise}。`;
  }

  return Object.entries(rep).map(([group, val]) => `${group}声望:${val}`).join("，");
}

// ── Collector 注册（on-demand 懒初始化，首次 buildStatePrompt 时执行）──
let collectorsRegistered = false;
function ensureCollectors(): void {
  if (collectorsRegistered) return;
  collectorsRegistered = true;

  const s = () => gameState; // 懒引用，注册时不执行

  // L0-survival: 模板变量（不可降级）
  promptCollectors.register({
    name: "template-vars", priority: 0, layer: "survival", degradeStrategy: "keep",
    async collect(_gs) {
      // 由 buildStatePrompt 的模板替换逻辑处理
      return null;
    },
  });

  // L1-stable: 玩家状态
  promptCollectors.register({
    name: "player-status", priority: 2, layer: "stable", degradeStrategy: "keep",
    async collect(_gs) {
      const p = s().player;
      let text = getPlayerStatusNarrative(p);
      const disguise = getDisguiseIdentity(p);
      if (disguise) text += `\n[身份认知] 你被认知为: ${disguise}`;
      else if (p.public_identity) text += `\n[身份认知] 公开身份: ${p.public_identity}`;
      if (p.titles?.length) text += `\n[称号] ${p.titles.join(" | ")}`;
      return text.trim() ? { text, priority: 2, layer: "stable", degradeStrategy: "keep", sourceName: "player-status" } : null;
    },
  });

  // L1-stable: 疲劳状态
  promptCollectors.register({
    name: "fatigue", priority: 3, layer: "stable", degradeStrategy: "keep",
    async collect(_gs) {
      const f = s().player.fatigue ?? 0;
      if (f >= 80) return { text: `[状态] 你已经筋疲力尽，急需休息或提神饮品。`, priority: 3, layer: "stable", degradeStrategy: "keep", sourceName: "fatigue" };
      if (f >= 50) return { text: `[状态] 你感到明显的疲劳，动作开始变慢。`, priority: 3, layer: "stable", degradeStrategy: "keep", sourceName: "fatigue" };
      if (f >= 25) return { text: `[状态] 你有一丝倦意。`, priority: 3, layer: "stable", degradeStrategy: "keep", sourceName: "fatigue" };
      return null;
    },
  });

  // L1-stable: 玩家声望数据
  promptCollectors.register({
    name: "reputation-status", priority: 4, layer: "stable", degradeStrategy: "keep",
    async collect(_gs) {
      const p = s().player;
      const rep = p.reputation;
      if (!rep || Object.keys(rep).length === 0) return null;
      const disguise = getDisguiseIdentity(p);
      if (disguise) {
        return {
          text: `[声望与伪装] 你当前伪装为${disguise}，本尊的声望已被隐藏。一旦伪装败露，你的真实声望和身份将会暴露。`,
          priority: 4,
          layer: "stable",
          degradeStrategy: "keep",
          sourceName: "reputation-status"
        };
      }
      const lines = Object.entries(rep).map(([group, val]) => `  • ${group}: ${val}`);
      return {
        text: `[声望数值]\n${lines.join("\n")}`,
        priority: 4,
        layer: "stable",
        degradeStrategy: "keep",
        sourceName: "reputation-status"
      };
    }
  });

  // L1-stable: 队友状态详情
  promptCollectors.register({
    name: "party-details", priority: 15, layer: "stable", degradeStrategy: "keep",
    async collect(_gs) {
      const p = s().player;
      if (!p.party || p.party.length === 0) return null;
      const lines: string[] = [];
      for (const name of p.party) {
        const npc = s().npcs[name];
        if (!npc) continue;
        const attrStr = Object.entries(npc.attributes)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ");
        const skillsStr = Object.entries(npc.skills)
          .filter(([_, sk]) => (sk as any).level > 0)
          .map(([k, sk]) => `${k}:Lv${(sk as any).level}`)
          .join(", ") || "无";
        lines.push(`  • ${name}: HP ${npc.hp.current}/${npc.hp.max} | 属性: ${attrStr} | 技能: ${skillsStr} | 当前行动: ${npc.action || "跟随玩家"}`);
      }
      if (lines.length === 0) return null;
      return {
        text: `[队伍成员]\n${lines.join("\n")}`,
        priority: 15,
        layer: "stable",
        degradeStrategy: "keep",
        sourceName: "party-details"
      };
    }
  });

  // L1-stable: 已揭示的秘密（秘密防火墙）
  promptCollectors.register({
    name: "revealed-secrets", priority: 5, layer: "stable", degradeStrategy: "keep",
    async collect(_gs) {
      const secrets = getRevealedSecrets("protagonist_known");
      if (secrets.length === 0) return null;
      const lines = secrets.map(sec => `  • [${sec.toLevel}] ${sec.id}: ${sec.content} (第${sec.turn}回合由GM通过工具揭示)`);
      return {
        text: `[已揭示秘密]\n${lines.join("\n")}`,
        priority: 5,
        layer: "stable",
        degradeStrategy: "keep",
        sourceName: "revealed-secrets"
      };
    }
  });

  // L2-enhanced: 在场 NPC 简要列表（轻量）
  promptCollectors.register({
    name: "npc-presence", priority: 20, layer: "enhanced", degradeStrategy: "keep",
    async collect(_gs) {
      const p = s().player;
      const lines: string[] = [];
      const r = lookupRegion(p.location);
      if (r.all_characters.length > 0) {
        lines.push(`[周边] ${r.all_characters.slice(0, 8).join(", ")}`);
      }
      const inRoom = Object.entries(s().npcs)
        .filter(([_, n]) => isSameLocation(n.currentRoom, p.location))
        .map(([name, n]) => `${name}${n.action ? "(" + n.action + ")" : ""}`);
      if (inRoom.length > 0) lines.push(`[在场] ${inRoom.join(", ")}`);
      const namelessNPCs = getNamelessNPCs(p.location, s().turn);
      if (namelessNPCs.length > 0) lines.push(`[在场路人] ${namelessNPCs.map(n => `${n.name}(正在${n.act})`).join(", ")}`);
      return lines.length > 0 ? { text: lines.join("\n"), priority: 20, layer: "enhanced", degradeStrategy: "compress", sourceName: "npc-presence" } : null;
    },
  });

  // L2-enhanced: NPC 详情（身体/穿着/外貌 — 重段，可降级）
  promptCollectors.register({
    name: "npc-details", priority: 25, layer: "enhanced", degradeStrategy: "truncate",
    async collect(_gs) {
      const p = s().player;
      const lines: string[] = [];
      for (const [nname, npc] of Object.entries(s().npcs)) {
        if (!isSameLocation(npc.currentRoom, p.location)) continue;
        const src = (characters as any[]).find((c: any) => c.name === nname);
        if (!src) continue;
        if (!s().auMode && src.tags?.includes("au")) continue;

        const cs = (charStages as any)[nname];
        if (cs) {
          const curAge = getNpcCurrentAge(src.base_age || 16);
          const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
          const ifKey = nname + "_if";
          const ifCs = (charStages as any)[ifKey];
          let desc = cs[stageKey];
          if (ifCs?.[stageKey]) {
            if (s().flags.tachibanaIF && ["橘京香","橘结花","橘小春"].includes(nname)) desc = ifCs[stageKey];
            if (s().flags.osanaIF && ["樋口円香","浅仓透"].includes(nname)) desc = ifCs[stageKey];
          }
          if (desc) lines.push(`[${nname}] ${desc}`);
        }

        const curAgeBody = getNpcCurrentAge(src.base_age || 16);
        const body = getBodyForAge(src, curAgeBody);
        if (body) {
          let bodyStr = `${body.height_cm}cm ${body.weight_kg}kg ${body.build}`;
          if (body.cup) bodyStr += ` ${body.cup}cup`;
          if (body.measurements) bodyStr += ` 三围${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
          if (body.leg_type) bodyStr += ` ${body.leg_type}腿`;
          lines.push(`[${nname}·身体] ${bodyStr}`);
        }
        const outfitDesc = getNPCOutfitDesc(nname);
        lines.push(`[${nname}·外观] ${outfitDesc}`);
        const app = getAppearanceForAge(src, curAgeBody);
        const appParts: string[] = [];
        const hairDesc = [app.hair_color, app.hair_style].filter(Boolean).join("");
        if (hairDesc) appParts.push(hairDesc);
        if (app.eye_color) appParts.push(`${app.eye_color}眼睛`);
        if (app.hair_accessories) appParts.push(app.hair_accessories);
        if (appParts.length > 0) lines.push(`[${nname}·外貌] ${appParts.join("、")}`);
      }
      return lines.length > 0 ? { text: lines.join("\n"), priority: 25, layer: "enhanced", degradeStrategy: "truncate", sourceName: "npc-details" } : null;
    },
  });

  // L2-enhanced: 关系
  promptCollectors.register({
    name: "relationships", priority: 26, layer: "enhanced", degradeStrategy: "compress",
    async collect(_gs) {
      const p = s().player;
      const lines: string[] = [];
      for (const [nname, rel] of Object.entries(p.relationships)) {
        const npc = s().npcs[nname];
        if (!npc || !isSameLocation(npc.currentRoom, p.location)) continue;
        if ((rel as any).affection === 0) continue;
        let relStr = `${(rel as any).stage}(好感${(rel as any).affection})`;
        if ((rel as any).romance) relStr += ` ${(rel as any).romance}`;
        if ((rel as any).notes) relStr += ` — ${(rel as any).notes}`;
        lines.push(`[${nname}·关系] ${relStr}`);
      }
      return lines.length > 0 ? { text: lines.join("\n"), priority: 26, layer: "enhanced", degradeStrategy: "compress", sourceName: "relationships" } : null;
    },
  });

  // L2-enhanced: Layer1 印记 + 实时（重段，可 drop）
  promptCollectors.register({
    name: "layer1", priority: 30, layer: "enhanced", degradeStrategy: "drop",
    async collect(_gs) {
      try {
        const { getDesireNarrative, getArousalNarrative, getDevNarrative, getCyclePhase, getThoughtsSummary, getMoodHint, SEX_PROFILES } = await import("./sex.ts");
        const profiles = SEX_PROFILES as Record<string, any>;
        const lines: string[] = [];
        const p = s().player;

        if (p.sex) {
          const sx = p.sex;
          const prof = sx.profile;
          const devHint = getDevNarrative(prof);
          let tagLine = `[印记] ${prof.attitude} | ${prof.experience} | ${devHint}`;
          if (sx.milestones) {
            const m = sx.milestones;
            const mkParts: string[] = [];
            if (m.firstKiss?.given) mkParts.push(`初吻: ${m.firstKiss.partner}`);
            else mkParts.push("初吻: 未");
            if (!m.virginity?.isVirgin) mkParts.push(`初夜: ${m.virginity?.lostTo || "已失"}`);
            else mkParts.push("初夜: 未");
            if (m.analVirginity && !m.analVirginity.isVirgin) mkParts.push(`菊初: ${m.analVirginity.lostTo || "已失"}`);
            tagLine += ` | ${mkParts.join(" | ")}`;
          }
          lines.push(tagLine);

          if (s().layer1Enabled) {
            const phase = getCyclePhase(sx.cycleDay);
            if (phase !== "安全期") lines[lines.length-1] += ` | ${phase}`;
            const dh = getDesireNarrative(sx);
            const ah = getArousalNarrative(sx);
            if (dh) lines.push(`  欲望: ${dh}`);
            if (ah) lines.push(`  兴奋: ${ah}`);
            const rel = p.relationships[prof.name as string];
            const affection = rel?.affection ?? 0;
            const moodHint = getMoodHint(affection, prof.attitude);
            lines.push(`  [mood_hint] ${moodHint}`);
            const ts = getThoughtsSummary(sx);
            if (ts) lines.push(`  [心里话] ${ts}`);
          }
        }
        for (const [nname, npc] of Object.entries(s().npcs)) {
          if (!isSameLocation(npc.currentRoom, p.location)) continue;
          const sp = profiles[nname];
          if (!sp) continue;
          const devHint = getDevNarrative(sp);
          lines.push(`[${nname}·印记] ${sp.attitude} | ${sp.experience} | ${devHint}`);
        }
        if (!s().layer1Enabled) {
          for (const [nname, npc] of Object.entries(s().npcs)) {
            if (!isSameLocation(npc.currentRoom, p.location)) continue;
            const sxState = s().sexStates?.[nname];
            if (sxState) {
              const dh = getDesireNarrative(sxState);
              if (dh) {
                lines.push(`[${nname}·身体语言] ${dh}`);
              }
            }
          }
        }
        return lines.length > 0 ? { text: lines.join("\n"), priority: 30, layer: "enhanced", degradeStrategy: "drop", sourceName: "layer1" } : null;
      } catch { return null; }
    },
  });

  // L2-enhanced: 结构化记忆表（deepRolePlay 移植）
  promptCollectors.register({
    name: "scenario-tables", priority: 35, layer: "enhanced", degradeStrategy: "compress",
    async collect(_gs) {
      try {
        const { getAllTables } = await import("./scenario-tables.ts");
        const text = getAllTables();
        if (text && text.length > 20) {
          return { text: `[结构化记忆]\n${text}`, priority: 35, layer: "enhanced", degradeStrategy: "compress", sourceName: "scenario-tables" };
        }
      } catch {}
      return null;
    },
  });
}

/** 注入 collector 注册表产出的上下文（NPC 重段已迁移至 collector） */
async function buildCollectorContext(): Promise<string> {
  ensureCollectors();
  const nodes = await promptCollectors.collectAll(gameState);
  const result = schedule(nodes, { targetBytes: 24000, hardBytes: 40000 });
  if (result.dropped.length > 0) {
    // 降级日志：调试时取消注释
    // console.log(`[collector] dropped: ${result.dropped.join(", ")}  total: ${result.totalBytes}b`);
  }
  return result.output;
}

export async function buildStatePrompt(): Promise<string> {
  const tplPath = path.join(AGENTS_DIR, "gm-state.md");
  if (!fs.existsSync(tplPath)) return "";
  let tpl = fs.readFileSync(tplPath, "utf-8");
  const s = gameState;
  const p = s.player;

  // 称号系统：每轮检查是否有新称号
  checkAndGrantTitles();
  
  // 周边角色：首次触发时懒初始化 NPC
  let context = "";
  const r = lookupRegion(p.location);
  if (r.all_characters.length > 0) {
    for (const c of r.all_characters) {
      if (!gameState.npcs[c]) getOrCreateNPC(c);
    }
    context = r.all_characters.slice(0, 8).join("、") + " 在附近";
  }
  
  const vars: Record<string, string> = {
    game_date: s.time.game_date,
    day_of_week: s.time.day_of_week,
    time_of_day: s.time.time_of_day,
    player_name: p.name,
    player_age: String(p.age),
    player_stage: s.time.player_stage,
    player_location: p.location,
    mode: s.mode,
    weather: `${s.weather.type} ${s.weather.temp}°C`,
    location_context: context || "暂无特殊角色信息",
  };
  
  for (const [k, v] of Object.entries(vars)) {
    tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
  }
  
  // 附加玩家自身身体状况描述
  tpl += `\n${getPlayerStatusNarrative(p)}`;
  // 身份与称号注入
  const disguise = getDisguiseIdentity(p);
  if (disguise) tpl += `\n[身份认知] 你被认知为: ${disguise}`;
  else if (p.public_identity) tpl += `\n[身份认知] 公开身份: ${p.public_identity}`;
  // 玩家当前穿着（mount 槽单独显示为载具）
  const INNER_SLOTS = new Set(["inner_top", "inner_bot"]);
  const outerItems: string[] = [];
  const innerItems: string[] = [];
  let mountItem: string | null = null;
  for (const [slot, item] of Object.entries(p.equipment)) {
    if (!item) continue;
    if (slot === "mount") { mountItem = (item as any).name; continue; }
    if (INNER_SLOTS.has(slot)) innerItems.push((item as any).name);
    else outerItems.push((item as any).name);
  }
  if (outerItems.length > 0 || innerItems.length > 0) {
    const outerStr = outerItems.length > 0 ? outerItems.join("、") : "（无）";
    if (s.layer1Enabled && innerItems.length > 0) {
      tpl += `\n[穿着] ${outerStr}  |  内: ${innerItems.join("、")}`;
    } else {
      tpl += `\n[穿着] ${outerStr}`;
    }
  } else {
    tpl += `\n[穿着] （什么都没穿）`;
  }
  if (mountItem) {
    const speedStr = p.vehicle ? ` ×${p.vehicle.speedMul}` : "";
    tpl += `\n[载具] ${mountItem}${speedStr}`;
  }
  if (p.titles && p.titles.length > 0) {
    tpl += `\n[称号] ${p.titles.join(" | ")}`;
  }
  // 旅行状态注入
  if (s.pendingTravel) {
    const pt = s.pendingTravel;
    tpl += `\n[旅行中] 正在通过${pt.route}前往 ${pt.to}（耗时约${pt.minutes}分钟）。到达前请通过 complete_travel 工具结束旅程。`;
  }
  // 剧情钩子注入（timeline.ts 自动扫描生成的触发事件）
  const { getActiveHooks, getActiveQuests, getTodayCalendar } = await import("./timeline.ts");
  const hooks = getActiveHooks();
  if (hooks.length > 0) {
    tpl += `\n[剧情钩子] 以下事件等待触发（请自然融入叙事，不要直接朗读hook_text）：`;
    for (const h of hooks) {
      const seenNote = h.seen_count > 0 ? `（第${h.seen_count + 1}次提及，请换角度）` : "";
      tpl += `\n  • [${h.urgency}][${h.event_id}] ${h.hook_text} ${seenNote}`;
    }
    tpl += `\n→ 玩家接受委托后，调用 open_quest 工具开启任务。`;
  }
  // 日历事件注入
  const todayCal = getTodayCalendar();
  if (todayCal) {
    tpl += `\n[日历] 今日特殊: ${todayCal}`;
  }
  // 活跃任务注入
  const activeQuests = getActiveQuests();
  if (activeQuests.length > 0) {
    tpl += `\n[活跃任务]`;
    for (const q of activeQuests) {
      tpl += `\n  • ${q.title} (${q.current_beat || "未开始"}) — 状态: ${q.status}`;
    }
  }
  // 房产安全屋注入
  const props = p.properties || {};
  if (Object.keys(props).length > 0) {
    tpl += `\n[安全屋] 你拥有以下房产：`;
    for (const prop of Object.values(props)) {
      const typeStr = prop.type === "own" ? "永久产权" : "租赁契约";
      tpl += `\n  • ${prop.name} (位于 ${prop.regionId}) — 类型: ${typeStr}`;
      if (prop.type === "rent") tpl += ` | 租期至 ${prop.rent_due_date}`;
      if (prop.arrears_days > 0) tpl += ` (已欠费 ${prop.arrears_days} 天)`;
    }
  }
  // 附加区域设定（根据当前位置匹配 region_contexts.json）
  const regionCtx = getRegionContext(p.location);
  if (regionCtx) tpl += `\n[区域设定] ${regionCtx}`;
  // 附加空间上下文
  const gridCtx = getGridContext();
  if (gridCtx) tpl += `\n${gridCtx}`;
  // 首次进入房间 → 注入 atmosphere（仅一次，不重复）
  gameState.roomTimestamps ??= {};
  const roomKey = getRoomKey(p.location) || p.location;
  if (!gameState.roomTimestamps[roomKey]) {
    const room = ROOMS[p.location];
    if (room && (room as any).atmosphere) {
      tpl += `\n[环境] ${(room as any).atmosphere}`;
    }
  }
  // 房间时间戳脏污 — 低成本氛围注入
  const agingLine = getRoomAgingLine(p.location);
  if (agingLine) tpl += `\n[场景氛围] ${agingLine}`;

  // 疲劳状态注入
  const f = p.fatigue ?? 0;
  if (f >= 80) tpl += `\n[状态] 你已经筋疲力尽，急需休息或提神饮品。`;
  else if (f >= 50) tpl += `\n[状态] 你感到明显的疲劳，动作开始变慢。`;
  else if (f >= 25) tpl += `\n[状态] 你有一丝倦意。`;

  // 寒冷天气装备提示：穿厚外套等 → 注入保暖描述
  if (s.weather.temp < 5 && hasEquipmentEffect(p.equipment, "cold_resist")) {
    tpl += `\n[装备] 厚实的衣物抵御着寒风——你并不觉得冷。`;
  }
  // 附加周边角色（通过地区路由器）
  if (r.all_characters.length > 0) {
    const nearby = r.all_characters.slice(0, 8);
    if (nearby.length > 0) tpl += `\n[周边] ${nearby.join(", ")}`;
  }
  // 碰面检测：当前房间内已存在的NPC
  const inRoom = Object.entries(gameState.npcs)
    .filter(([_, n]) => isSameLocation(n.currentRoom, p.location))
    .map(([name, n]) => `${name}${n.action ? "("+n.action+")" : ""}`);
  if (inRoom.length > 0) tpl += `\n[在场] ${inRoom.join(", ")}`;

  // 注入 collector 注册表产出的上下文（NPC详情/关系/Layer1 等重段已迁移至 collector）
  const collectorText = await buildCollectorContext();
  if (collectorText) tpl += "\n" + collectorText;

/** 按房间名给默认sex氛围描述 */
function getDefaultSexAtmosphere(location: string): string {
  if (location.includes("教室") || location.includes("班")) return "空旷的教室，课桌椅整齐排列——在这里做点什么有种背德的刺激。";
  if (location.includes("部室") || location.includes("社团")) return "狭小的部室，窗外隐约传来操场上的喧闹声。";
  if (location.includes("屋顶")) return "天台的凉风不时吹过，远处的城市景色尽收眼底。";
  if (location.includes("保健室")) return "消毒水的气味，拉上帘子就是一个小天地。";
  if (location.includes("更衣室") || location.includes("体育馆")) return "潮湿的空气里混着运动后的汗味和沐浴露的香气。";
  if (location.includes("住宅") || location.includes("自宅")) return "熟悉的房间里，窗帘透进来的光让一切都显得柔和。";
  if (location.includes("走廊")) return "随时可能有人经过的走廊转角——紧张感和刺激并存。";
  if (location.includes("中庭")) return "夜晚的中庭空无一人，只有路灯洒下昏黄的光。";
  if (location.includes("泳池")) return "水面反射着波光，空气中有氯气的气味。";
  if (location.includes("浴室") || location.includes("温泉")) return "氤氲的蒸汽模糊了视线，水滴声在瓷砖墙间回荡。";
  return "";
}

  // 手机通知注入
  try {
    const { getPlayerPhoneData, getUnreadSummary } = await import("./phone.ts");
    const phoneNote = getUnreadSummary(getPlayerPhoneData());
    if (phoneNote) tpl += `\n${phoneNote}`;
  } catch (_) {}

  // ── 场景工具提示（软约束，不屏蔽工具）──
  // 根据当前场景告诉LLM哪些工具优先。来自顶会论文验证过的attention scoping方法。
  const sceneHints: string[] = [];

  // combat模式 → 战斗工具优先
  if (s.mode === "combat") {
    sceneHints.push("战斗场景: combat_action, dice_roll, move, use_item, equip_item, inflict_damage, add_to_party, remove_from_party");
  }
  // sex/Layer1模式
  if (s.layer1Enabled || s.mode === "sex") {
    sceneHints.push("亲密模式: sex_touch, masturbate, lookup_body, toggle_layer1");
  }
  // 旅行中
  if (s.pendingTravel) {
    sceneHints.push("旅行中: complete_travel(到达时必调), lookup_region");
  }
  // 通缉/警报 → 身份检定相关
  if ((s.flags as any)?.steal_alert || (s.flags as any)?.wanted || (s.flags as any)?.identity_exposed) {
    sceneHints.push("警报生效中: identity_check, update_reputation, schedule_override");
  }
  // 有活跃钩子 → 任务工具
  if (s.active_hooks && s.active_hooks.length > 0) {
    sceneHints.push("剧情钩子待处理: open_quest(接受后调用), advance_quest, abandon_quest");
  }
  // 活跃任务进行中
  if (s.quests && Object.values(s.quests).some((q: any) => q.status === "active")) {
    sceneHints.push("任务进行中: advance_quest, set_flags, add_memory_tag");
  }
  // 在商业区 → 经济工具
  if (p.location.includes("店") || p.location.includes("市场") || p.location.includes("商业")) {
    sceneHints.push("商业区: buy_item, sell_item, work_job, transfer_item");
  }
  // 在学校/社交场所
  if (p.location.includes("校") || p.location.includes("部室") || p.location.includes("侍奉部")) {
    sceneHints.push("社交场景: adjust_relation, lookup_character, set_npc_outfit, add_memory_tag, post_sns, browse_sns");
  }

  // 灰色博弈与黑市
  if (p.location.includes("赌场") || p.location.includes("地下") || p.location.includes("酒馆") || p.location.includes("黑市")) {
    sceneHints.push("地下博弈/黑市: gamble_bet, black_market_trade");
  }
  // 安全屋内容器
  const isInsideOwnedProperty = Object.values(p.properties || {}).some(prop => prop.regionId === p.location);
  if (isInsideOwnedProperty) {
    sceneHints.push("安全屋内: housing_storage");
  }

  if (sceneHints.length > 0) {
    // 始终提醒可用的核心工具（不随场景变）
    const always = "始终可用: lookup_character, lookup_region, lookup_lore, dice_roll, get_status, commit_turn, add_to_party, remove_from_party, lookup_weather";
    tpl += `\n[工具提示] ${[...sceneHints, always].join(" | ")}`;
  }

  return tpl;
}

// --- 属性调整值 ---
export function attrMod(val: number): number {
  return Math.floor((val - 10) / 2);
}

// --- HP计算 ---
export function calcMaxHP(体质: number, age: number): number {
  const base = 体质 * 2;
  const ageBonus = age >= 15 ? Math.floor((age - 14) / 5) : 0;
  return base + ageBonus;
}

// --- AC计算 ---
export function calcAC(敏捷: number, equipment: EquipmentSlots): number {
  let ac = 10 + attrMod(敏捷);
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    for (const eff of item.effects) {
      if (eff.type === "ac_bonus") ac += Number(eff.value);
    }
  }
  return ac;
}

// --- 装备效果扫描（attribute_bonus / social_bonus / cold_resist） ---

/** 扫描装备，累计指定 effectType 的数值加成。context 用于 condition 匹配。 */
export function getEquipmentBonus(
  equipment: EquipmentSlots,
  effectType: string,
  context?: string
): number {
  let bonus = 0;
  for (const item of Object.values(equipment)) {
    if (!item?.effects) continue;
    for (const eff of item.effects) {
      if (eff.type !== effectType) continue;
      if (eff.condition && context) {
        if (!context.includes(eff.condition.replace(/相关.*$/, ""))) continue;
      }
      bonus += Number(eff.value);
    }
  }
  return bonus;
}

/** 检查装备是否有某类效果（用于 cold_resist 等标记型效果） */
export function hasEquipmentEffect(
  equipment: EquipmentSlots,
  effectType: string
): boolean {
  for (const item of Object.values(equipment)) {
    if (!item?.effects) continue;
    for (const eff of item.effects) {
      if (eff.type === effectType) return true;
    }
  }
  return false;
}

// --- 载具系统 ---

interface VehicleDef { speedMul: number; tags: string[]; desc: string; }
const VEHICLES: Record<string, VehicleDef> = {
  bicycle:    { speedMul: 3, tags: ["narrow","steep","off-road"], desc: "自行车——通学路最常见的交通工具，小巷山路都能钻" },
  motorcycle: { speedMul: 5, tags: ["narrow","steep"], desc: "摩托车——比汽车灵活，窄巷和山路没问题，但还是要走车道" },
  car:        { speedMul: 8, tags: [], desc: "汽车——只能在铺装路上开，需要停车场" },
};

/** 装备载具到 mount 槽 */
export function mountVehicle(itemName: string): string {
  const p = gameState.player;
  if (p.equipment.mount) return `已经骑着 ${p.equipment.mount.name}，请先下车`;

  // 从背包找
  const idx = p.inventory.findIndex(i => i.effects?.some(e => e.type === "vehicle") && i.name === itemName);
  if (idx < 0) return `背包里没有 ${itemName}`;

  const found = p.inventory.splice(idx, 1)[0];
  const vtype = found.effects.find(e => e.type === "vehicle")?.value as string || "bicycle";
  const def = VEHICLES[vtype];
  if (!def) return `未知载具类型: ${vtype}`;

  p.equipment.mount = found;
  p.vehicle = { type: vtype as any, name: found.name, speedMul: def.speedMul };
  saveState();
  return `骑上了 ${found.name}（速度×${def.speedMul}）`;
}

/** 下车：从 mount 槽卸下放背包 */
export function dismountVehicle(): string {
  const p = gameState.player;
  const item = p.equipment.mount;
  if (!item) return "当前没有骑乘载具";

  p.equipment.mount = null;
  p.vehicle = undefined;
  p.inventory.push(item);
  saveState();
  return `从 ${item.name} 上下来了`;
}


/** 获取当前载具速度倍率 */
export function getVehicleMul(): { mul: number; name?: string } {
  const v = gameState.player.vehicle;
  return v ? { mul: v.speedMul, name: v.name } : { mul: 1 };
}

// --- 负重 ---
export function calcMaxCarry(力量: number): number {
  return Math.round(力量 * 6.8 * 10) / 10; // STR × 6.8 kg
}

export function calcCurrentWeight(inventory: Item[], equipment: EquipmentSlots): number {
  let total = 0;
  for (const item of inventory) total += item.weight;
  for (const item of Object.values(equipment)) {
    if (item) total += item.weight;
  }
  return Math.round(total * 10) / 10;
}

export function isOverburdened(currentWeight: number, maxCarry: number): { overloaded: boolean; encumbered: boolean } {
  const pct = currentWeight / maxCarry;
  return {
    overloaded: pct > 1.0,   // 不能跑
    encumbered: pct > 0.6,    // 移动减半，DEX劣势
  };
}

// --- 容器/体积系统 ---
export interface VolumeCheckResult {
  ok: boolean;
  totalVolume: number;
  maxVolume: number;
  severity: "ok" | "bulging" | "overflow" | "damage";
  narrative: string;
}

/** 从装备的 pocket 效果计算总容积（升） */
export function calcPocketVolume(equipment: EquipmentSlots): number {
  let total = 0;
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    for (const eff of item.effects) {
      if (eff.type === "pocket") total += Number(eff.value);
    }
  }
  return total;
}

/** 计算背包+装备的总体积 */
export function calcInventoryVolume(inventory: Item[], equipment: EquipmentSlots): number {
  let total = 0;
  for (const item of inventory) total += item.volume || 0;
  for (const item of Object.values(equipment)) {
    if (item) total += item.volume || 0;
  }
  return Math.round(total * 10) / 10;
}

/** 检查加入新物品后的体积是否超限 */
export function checkAddVolume(
  inventory: Item[],
  equipment: EquipmentSlots,
  newItem: { volume: number; name: string }
): VolumeCheckResult {
  const curVol = calcInventoryVolume(inventory, equipment);
  const maxVol = calcPocketVolume(equipment);
  const newVol = curVol + newItem.volume;

  if (maxVol === 0) {
    // 没有任何容器，视为无限空间（裸奔状态）
    return { ok: true, totalVolume: newVol, maxVolume: 0, severity: "ok", narrative: "" };
  }

  const ratio = newVol / maxVol;

  if (ratio <= 1.0) {
    return { ok: true, totalVolume: newVol, maxVolume: maxVol, severity: "ok", narrative: "" };
  }
  if (ratio <= 1.2) {
    return {
      ok: true,
      totalVolume: newVol,
      maxVolume: maxVol,
      severity: "bulging",
      narrative: `勉强塞进去了——${newItem.name}让背包明显鼓胀，看起来很不自然。`
    };
  }
  if (ratio <= 1.5) {
    return {
      ok: false,
      totalVolume: newVol,
      maxVolume: maxVol,
      severity: "overflow",
      narrative: `塞不下${newItem.name}。背包已经撑到极限了。`
    };
  }
  return {
    ok: false,
    totalVolume: newVol,
    maxVolume: maxVol,
    severity: "damage",
    narrative: `强行塞${newItem.name}会把背包撑坏！必须腾出空间或换更大的容器。`
  };
}

/** 装备 locker 容量时检查是否会损坏容器 */
export function checkContainerDamage(totalVolume: number, maxVolume: number): boolean {
  return maxVolume > 0 && totalVolume > maxVolume * 1.3;
}

// --- 容器统一模型 ---

/** 查找玩家背包容器 */
function getBackpackContainer(): ContainerState {
  const p = gameState.player;
  const totalVol = calcInventoryVolume(p.inventory, p.equipment);
  const totalWt = calcCurrentWeight(p.inventory, p.equipment);
  const maxCarry = calcMaxCarry(p.attributes.力量);
  return {
    id: "backpack",
    ownerType: "player",
    ownerId: p.name,
    def: {
      id: "backpack",
      visible: false,
      max_volume: calcPocketVolume(p.equipment),
      max_weight: maxCarry,
    },
    items: [...p.inventory],
    current_volume: totalVol,
    current_weight: totalWt,
  };
}

/** 查找房间地板容器（物品散落在地上） */
function getFloorContainer(location: string): ContainerState {
  const room = ROOMS[location];
  const floorItems: any[] = [];
  if (room) {
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        const cell = room.cells[y][x];
        if (cell.furniture) {
          // 家具作为地板物品（简化：仅存名字）
          floorItems.push({ name: cell.furniture, gridPos: [x, y] });
        }
      }
    }
  }
  return {
    id: `floor-${location}`,
    ownerType: "room",
    ownerId: location,
    def: {
      id: `floor-${location}`,
      visible: true,
      max_volume: 9999,   // 地板理论上无限空间
      max_weight: 9999,
    },
    items: floorItems,
    current_volume: floorItems.length,
    current_weight: floorItems.length,
  };
}

/** 查找指定位置的所有可访问容器（地板 + 相邻家具 + 玩家背包） */
// 家具容器持久化存储（key=containerId, value=items数组）
const _furnitureContainerStore: Record<string, any[]> = {};

export function getContainersAt(location: string, gridPos?: [number, number]): ContainerState[] {
  const containers: ContainerState[] = [];

  // 1. 玩家背包始终可访问
  containers.push(getBackpackContainer());

  // 2. 房间地板
  const key = getRoomKey(location) || location;
  if (ROOMS[key]) {
    containers.push(getFloorContainer(key));
  }

  // 3. 相邻家具（读取 furniture.json 容器定义）
  if (gridPos) {
    const room = ROOMS[key];
    if (room) {
      const [px, py] = gridPos;
      const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dx, dy] of dirs) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx >= 0 && nx < room.width && ny >= 0 && ny < room.height) {
          const cell = room.cells[ny][nx];
          if (cell.furniture) {
            const name = cell.furniture;
            // 尝试从 furniture.json 读取容器定义
            let furnitureDef: any = null;
            try {
              const { findFurnitureDef } = require("./furniture.ts");
              furnitureDef = findFurnitureDef(name, gameState.activeWorld);
            } catch (_) {}

            if (furnitureDef?.containers && furnitureDef.containers.length > 0) {
              // 为每个子容器创建 ContainerState
              for (const sub of furnitureDef.containers) {
                const cid = `furniture-${location}-${nx}-${ny}-${sub.id}`;
                // 兼容两种命名：locked_${id}（多容器）或 locked（单容器）
                const locked = furnitureDef.state?.[`locked_${sub.id}`] ?? furnitureDef.state?.locked ?? false;
                const items = _furnitureContainerStore[cid] || [];
                let vol = 0, wt = 0;
                for (const it of items) {
                  vol += (it.volume || 0);
                  wt += (it.weight || 0);
                }
                containers.push({
                  id: cid,
                  ownerType: "furniture",
                  ownerId: `${name}·${sub.id}`,
                  def: {
                    id: cid,
                    visible: sub.visible !== false,
                    lockable: sub.lockable || false,
                    locked,
                    max_volume: sub.max_volume || 20,
                    max_weight: sub.max_weight || 50,
                    can_hold_person: sub.can_hold_person || false,
                  },
                  items,
                  current_volume: vol,
                  current_weight: wt,
                });
              }
            } else {
              // 回退：无容器定义的家具使用默认容器
              containers.push({
                id: `furniture-${location}-${nx}-${ny}`,
                ownerType: "furniture",
                ownerId: name,
                def: {
                  id: `furniture-${location}-${nx}-${ny}`,
                  visible: true,
                  max_volume: 20,
                  max_weight: 50,
                },
                items: _furnitureContainerStore[`furniture-${location}-${nx}-${ny}`] || [],
                current_volume: 0,
                current_weight: 0,
              });
            }
          }
        }
      }
    }
  }

  return containers;
}

/** 按 ID 查找容器 */
export function findContainerById(id: string): ContainerState | null {
  // 尝试从当前场景查找
  const p = gameState.player;
  const containers = getContainersAt(p.location, p.gridPos || undefined);
  const found = containers.find(c => c.id === id);
  if (found) return found;
  // 玩家背包
  if (id === "backpack") return getBackpackContainer();
  return null;
}

/** 在容器间转移物品（校验体积/重量限制，支持家具容器+锁检查） */
export function transferBetweenContainers(fromId: string, toId: string, itemName: string): string {
  const from = findContainerById(fromId);
  if (!from) return `源容器 ${fromId} 未找到`;

  const to = findContainerById(toId);
  if (!to) return `目标容器 ${toId} 未找到`;

  // 检查目标容器锁定状态
  if (to.def.locked) {
    return `目标容器 ${to.ownerId} 是锁着的，不能存取`;
  }
  if (from.def.locked) {
    return `源容器 ${from.ownerId} 是锁着的，不能存取`;
  }

  // 查找物品在源容器中的索引
  let itemIdx = -1;
  let item: any = null;

  if (from.ownerType === "player" && fromId === "backpack") {
    itemIdx = gameState.player.inventory.findIndex((i: any) => i.name === itemName);
    if (itemIdx >= 0) item = gameState.player.inventory[itemIdx];
  } else if (from.ownerType === "room") {
    // 从地板取走：需要 world_interact removeFurniture 逻辑
    item = { name: itemName, volume: 0.5, weight: 1.0 };
  } else if (from.ownerType === "furniture") {
    // 从家具容器取走
    const items = _furnitureContainerStore[fromId] || [];
    itemIdx = items.findIndex((i: any) => i.name === itemName);
    if (itemIdx >= 0) item = items[itemIdx];
  }

  if (!item) return `在源容器中未找到 ${itemName}`;

  const itemVolume = (item as any).volume || 0;
  const itemWeight = (item as any).weight || 0;

  // 校验目标容器体积/重量限制
  if (to.def.max_volume > 0 && to.current_volume + itemVolume > to.def.max_volume) {
    return `目标容器 ${toId} 空间不足（需${itemVolume}L，剩余${to.def.max_volume - to.current_volume}L）`;
  }
  if (to.def.max_weight > 0 && to.current_weight + itemWeight > to.def.max_weight) {
    return `目标容器 ${toId} 承重不足（${itemWeight}kg 超限）`;
  }

  // 执行转移 — 从源容器移除
  if (from.ownerType === "player" && fromId === "backpack") {
    gameState.player.inventory.splice(itemIdx, 1);
  } else if (from.ownerType === "furniture") {
    const items = _furnitureContainerStore[fromId] || [];
    items.splice(itemIdx, 1);
    _furnitureContainerStore[fromId] = items;
  }

  // 执行转移 — 加入目标容器
  if (to.ownerType === "player" && toId === "backpack") {
    gameState.player.inventory.push(item);
  } else if (to.ownerType === "furniture") {
    if (!_furnitureContainerStore[toId]) _furnitureContainerStore[toId] = [];
    _furnitureContainerStore[toId].push(item);
  }

  to.current_volume += itemVolume;
  to.current_weight += itemWeight;
  from.current_volume -= itemVolume;
  from.current_weight -= itemWeight;

  saveState();
  return `${itemName}: ${fromId} → ${toId} 转移成功`;
}

// --- 技能EXP ---
export function addSkillExp(skills: Record<string, Skill>, name: string, amount: number): Record<string, Skill> {
  if (!skills[name]) {
    skills[name] = { level: 0, exp: 0, nextLevel: 10 };
  }
  const s = skills[name];
  if (s.level >= 10) return skills;
  
  s.exp += amount;
  while (s.exp >= s.nextLevel && s.level < 10) {
    s.exp -= s.nextLevel;
    s.level++;
    s.nextLevel = (s.level + 1) * 10;
  }
  return skills;
}

// --- 属性成长 ---
export function growAttribute(attrs: Record<string, number>, key: AttrKey, delta: number): void {
  attrs[key] = Math.min(20, Math.max(1, attrs[key] + delta));
}

// --- 关系 ---
export function updateRelation(rels: Record<string, Relationship>, name: string, delta: number, note?: string): Record<string, Relationship> {
  if (!rels[name]) {
    rels[name] = { stage: "陌生", affection: 0, romance: null, notes: "", history: [] };
  }
  rels[name].affection = Math.max(0, Math.min(100, rels[name].affection + delta));
  rels[name].stage = affectionToStage(rels[name].affection);
  if (note) rels[name].notes = note;
  // 记录历史
  rels[name].history ??= [];
  rels[name].history!.push({ delta, reason: note || "未记录原因", date: gameState.time.game_date });
  // 只保留最近20条
  if (rels[name].history!.length > 20) rels[name].history = rels[name].history!.slice(-20);
  return rels;
}

function affectionToStage(val: number): Relationship["stage"] {
  if (val < 20) return "陌生";
  if (val < 40) return "熟人";
  if (val < 70) return "友人";
  if (val < 90) return "信赖";
  return "至交";
}

// --- NPC 运行时状态 ---

/** 从 items.json 查找同名物品，补全 effects */
function fillEffectsFromCatalog(equipment: Record<string, any>): Record<string, any> {
  const lookup = new Map<string, any>();
  for (const cat of Object.values(itemsCatalog)) {
    for (const [name, item] of Object.entries(cat as any)) {
      lookup.set(name, item);
    }
  }
  const result: Record<string, any> = {};
  for (const [slot, item] of Object.entries(equipment)) {
    if (!item) { result[slot] = null; continue; }
    const catalog = lookup.get(item.name);
    result[slot] = catalog ? { ...structuredClone(catalog), state: item.state || "intact" } : item;
  }
  return result;
}

/** 注册 LLM 动态创建的角色。返回描述或错误。 */
export function registerDynamicCharacter(name: string, data: Record<string, any>): string {
  if ((characters as any[]).find((c: any) => c.name === name)) {
    return `角色 ${name} 已存在于静态角色库中，不能覆盖`;
  }
  if (DYNAMIC_CHARACTERS[name]) {
    // 更新已有动态角色
    Object.assign(DYNAMIC_CHARACTERS[name], data);
    saveState();
    return `已更新动态角色: ${name}`;
  }
  // 自动补全默认值
  const defaults: any = {
    name,
    gender: "female",
    base_age: 16,
    appearance_brief: "",
    attributes: { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10 },
    body: { height_cm: 160, weight_kg: 50, build: "标准", leg_type: "修长", skin: { base_tone: "普通", tan: 0, texture: "普通" } },
    schedule_group: "自由人",
    default_location: gameState.player.location,
    funds: 1000,
    tags: [],
  };
  DYNAMIC_CHARACTERS[name] = { ...defaults, ...data, name };
  saveState();
  return `创建了动态角色: ${name}（${data.gender || "female"}，${data.base_age || data.age || 16}岁，位于 ${DYNAMIC_CHARACTERS[name].default_location}）`;
}

/** 查找角色（先静态库 → 动态注册表） */
export function findCharacter(name: string): any | null {
  const src = (characters as any[]).find((c: any) => c.name === name);
  if (src) return src;
  return DYNAMIC_CHARACTERS[name] || null;
}

export function getOrCreateNPC(name: string): NPCRuntimeState {
  if (!gameState.npcs[name]) {
    const src = findCharacter(name);
    const defaultAttrs: Attributes = { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10 };
    const runtimeAttrs = src?.attributes ? { ...defaultAttrs, ...src.attributes } : defaultAttrs;

    const npcAge = src ? getNpcCurrentAge(src.base_age || 16) : 16;
    const maxHP = src?.hp?.max ?? calcMaxHP(runtimeAttrs.体质, npcAge);
    const currentHP = src?.hp?.current ?? maxHP;

    const runtimeSkills: Record<string, Skill> = {};
    if (src && src.skills) {
      for (const [sName, sLevel] of Object.entries(src.skills)) {
        runtimeSkills[sName] = {
          level: sLevel as number,
          exp: 0,
          nextLevel: (sLevel as number) * 10
        };
      }
    }

    gameState.npcs[name] = {
      inventory: src ? structuredClone(src.inventory ?? []) : [],
      equipment: src ? fillEffectsFromCatalog(src.equipment ?? {}) : {},
      currentRoom: src?.default_location || "",
      gridPos: src?.grid_pos || null,
      action: "",
      scheduleGroup: src?.schedule_group || "自由人",
      scheduleOverrides: src?.schedule_overrides,
      currentOutfit: "school",
      funds: src?.funds !== undefined ? src.funds : 1000,
      memoryTags: [],
      hp: { current: currentHP, max: maxHP },
      alive: true,
      attributes: runtimeAttrs,
      skills: runtimeSkills
    };
    // 魅力→初始印象：NPC首次创建时自动写入关系
    if (!gameState.player.relationships[name]) {
      const impression = Math.round((gameState.player.attributes.魅力 - 10) / 2) * 3;
      const baseAffection = Math.max(-10, Math.min(10, impression));
      if (baseAffection !== 0) {
        gameState.player.relationships[name] = {
          stage: "陌生",
          affection: Math.max(0, baseAffection),
          romance: null,
          notes: baseAffection > 0 ? "第一印象不错" : "第一印象不太好",
        };
      }
    }
  }
  return gameState.npcs[name];
}

/** NPC 场景服装切换。返回当前 outfit 描述 */
export function setNPCOutfit(npcName: string, outfitKey: string): string {
  const src = findCharacter(npcName);
  if (!src?.outfits?.[outfitKey]) return `${npcName}没有 ${outfitKey} 服装卡`;
  const npc = getOrCreateNPC(npcName);
  npc.currentOutfit = outfitKey as any;
  const items = src.outfits[outfitKey];
  const desc = Object.values(items).join("、");
  return `${npcName} → ${outfitKey}: ${desc}`;
}

/** 获取 NPC 当前 outfit 的外观描述。已从装备槽移除的物品不显示 */
export function getNPCOutfitDesc(npcName: string): string {
  const src = findCharacter(npcName);
  if (!src?.outfits) {
    const hairDesc = [src?.hair_color, src?.hair_style].filter(Boolean).join("");
    return hairDesc || src?.appearance_brief || "";
  }
  const npc = gameState.npcs[npcName];
  const key = npc?.currentOutfit || "school";
  const outfit = src.outfits[key];
  if (!outfit) {
    const hairDesc = [src?.hair_color, src?.hair_style].filter(Boolean).join("");
    return hairDesc || src.appearance_brief || "";
  }
  // 分层：内层 vs 外层；跳过已被移除的装备
  const inner: string[] = [];
  const outer: string[] = [];
  for (const [slot, item] of Object.entries(outfit)) {
    // 检查装备槽：如果对应槽位为空，该物品已被偷/移除 → 不显示
    const equipSlot = npc.equipment[slot as any];
    const isMissing = equipSlot === null || equipSlot === undefined;
    const label = isMissing ? `${item}（已被拿走）` : item as string;
    if (slot.startsWith("inner_")) inner.push(label);
    else outer.push(label);
  }
  const outerStr = outer.join("、");
  if (inner.length > 0) return `${outerStr}。内: ${inner.join("、")}`;
  return outerStr;
}

export async function getOrCreateSexState(npcName: string): Promise<SexState | null> {
  gameState.sexStates ??= {};
  if (!gameState.sexStates[npcName]) {
    const { SEX_PROFILES, createSexState } = await import("./sex.ts");
    const profile = SEX_PROFILES[npcName];
    if (!profile) return null;
    gameState.sexStates[npcName] = createSexState(npcName, profile);
  }
  return gameState.sexStates[npcName];
}

/** 时间驱动：推进所有 NPC SexState（欲望累积 + 周期推进 + 自主行为） */
export async function tickSexStates(daysAdvanced: number, minutesPassed: number): Promise<void> {
  if (!gameState.sexStates) return;
  const { getCyclePhase, calcDesire, masturbate } = await import("./sex.ts");

  for (const [name, ss] of Object.entries(gameState.sexStates)) {
    // 1. 推进生理周期
    if (daysAdvanced > 0) {
      ss.cycleDay = ((ss.cycleDay + daysAdvanced - 1) % 28) + 1;
      ss.cyclePhase = getCyclePhase(ss.cycleDay);
    }

    // 2. 欲望随时间自然累积（每小时 ~0.5~2 取决于周期）
    const hours = minutesPassed / 60;
    const phaseMultiplier = ss.cyclePhase === "排卵期" ? 2.0 : ss.cyclePhase === "生理期" ? 0.3 : 1.0;
    const baselineGain = hours * 0.8 * phaseMultiplier;
    // 独处加成：NPC 独自一人时欲望累积更快
    const npc = gameState.npcs[name];
    const isAlone = npc && !isSameLocation(npc.currentRoom, gameState.player.location);
    const aloneBonus = isAlone ? 1.5 : 1.0;
    const desireGain = Math.round(baselineGain * aloneBonus);
    if (desireGain > 0) {
      ss.desire = Math.min(100, ss.desire + desireGain);
    }

    // 3. 重新计算欲望值（考虑开发度等因素）
    ss.desire = calcDesire(ss.profile, ss);

    // 4. 自主行为：独处 + 高欲望 → 可能自慰
    if (isAlone && ss.desire >= 60 && minutesPassed >= 30) {
      const chance = ss.desire >= 85 ? 0.5 : ss.desire >= 70 ? 0.2 : 0.05;
      if (Math.random() < chance) {
        masturbate(ss, Math.round(minutesPassed * 0.3));
      }
    }
  }
}

export function listNPCItems(name: string): Item[] {
  const npc = getOrCreateNPC(name);
  const equipped = Object.values(npc.equipment).filter(Boolean) as Item[];
  return [...npc.inventory, ...equipped];
}

// --- 地点层级系统（locations.json 树形结构） ---

export interface LocationNode {
  key: string;           // 内部key，如 "chiba"
  name: string;          // 显示名，如 "千叶县"
  type: "root" | "region" | "prefecture" | "district" | "school" | "landmark" | "custom";
  children: LocationNode[];
  parent: LocationNode | null;
}

/** 递归构建地点树 */
function buildLocationTree(): LocationNode {
  const root: LocationNode = { key: "japan", name: LOCATIONS_BASE.japan?.name || "日本", type: "root", children: [], parent: null };

  const regions = LOCATIONS_BASE.japan?.regions || {};
  for (const [regKey, regData] of Object.entries(regions)) {
    const reg = regData as any;
    const regNode: LocationNode = { key: regKey, name: reg.name, type: "region", children: [], parent: root };
    root.children.push(regNode);

    const prefs = reg.prefectures || {};
    for (const [prefKey, prefData] of Object.entries(prefs)) {
      const pref = prefData as any;
      const prefNode: LocationNode = { key: prefKey, name: pref.name, type: "prefecture", children: [], parent: regNode };
      regNode.children.push(prefNode);

      const districts: string[] = pref.districts || [];
      if (districts.length > 0) {
        // 有区/市 → 学校和地标挂到第一个区下面
        const mainDistrict: LocationNode = { key: districts[0], name: districts[0], type: "district", children: [], parent: prefNode };
        prefNode.children.push(mainDistrict);
        for (const s of (pref.schools || [])) {
          mainDistrict.children.push({ key: s, name: s, type: "school", children: [], parent: mainDistrict });
        }
        for (const l of (pref.landmarks || [])) {
          mainDistrict.children.push({ key: l, name: l, type: "landmark", children: [], parent: mainDistrict });
        }
        // 其余区
        for (let i = 1; i < districts.length; i++) {
          prefNode.children.push({ key: districts[i], name: districts[i], type: "district", children: [], parent: prefNode });
        }
      } else {
        // 无区/市 → 学校和地标直接挂在县下
        for (const s of (pref.schools || [])) {
          prefNode.children.push({ key: s, name: s, type: "school", children: [], parent: prefNode });
        }
        for (const l of (pref.landmarks || [])) {
          prefNode.children.push({ key: l, name: l, type: "landmark", children: [], parent: prefNode });
        }
      }

      // 动态地点
      const customs = LOCATIONS_DELTA[pref.name] || [];
      for (const c of customs) {
        prefNode.children.push({ key: c, name: c, type: "custom", children: [], parent: prefNode });
      }
    }

    // prefecture 级别的动态地点
    const regCustoms = LOCATIONS_DELTA[reg.name] || [];
    for (const c of regCustoms) {
      regNode.children.push({ key: c, name: c, type: "custom", children: [], parent: regNode });
    }
  }
  return root;
}

/** 在树中查找匹配地点（模糊匹配） */
function findInTree(node: LocationNode, locName: string): LocationNode | null {
  const cleanLoc = locName.replace(/[（(].*[）)]/, "").trim().toLowerCase();
  if (node.name.replace(/[（(].*[）)]/, "").trim().toLowerCase() === cleanLoc) return node;
  if (isSameLocation(node.name, locName)) return node;
  for (const child of node.children) {
    const found = findInTree(child, locName);
    if (found) return found;
  }
  return null;
}

/** 获取当前地点的导航上下文 */
/** 通过 school_map.json 查找房间所属的学校和楼层，找不到则返回 null */
function findSchoolContext(locName: string): { school: string; building: string; floor: string } | null {
  if (!SCHOOL_MAP?.buildings) return null;
  const cleanLoc = locName.replace(/[（(].*[）)]/, "").trim();
  for (const [bname, bdata] of Object.entries(SCHOOL_MAP.buildings)) {
    const b = bdata as any;
    if (b.rooms) {
      for (const [floor, rooms] of Object.entries(b.rooms)) {
        for (const r of rooms as string[]) {
          if (isSameLocation(r, locName) || r.includes(cleanLoc) || cleanLoc.includes(r)) {
            return { school: SCHOOL_MAP.school, building: bname, floor };
          }
        }
      }
    }
  }
  return null;
}

/** 获取学校内部层级——建筑列表、楼层列表、房间列表 */
function getSchoolInternals(schoolName: string): { buildings: string[]; floorsByBuilding: Record<string, string[]>; roomsByFloor: Record<string, string[]> } {
  const buildings: string[] = [];
  const floorsByBuilding: Record<string, string[]> = {};
  const roomsByFloor: Record<string, string[]> = {};
  if (!SCHOOL_MAP?.buildings) return { buildings, floorsByBuilding, roomsByFloor };

  for (const [bname, bdata] of Object.entries(SCHOOL_MAP.buildings)) {
    const b = bdata as any;
    buildings.push(bname);
    if (b.rooms) {
      const floors = Object.keys(b.rooms);
      floorsByBuilding[bname] = floors;
      for (const [floor, roomList] of Object.entries(b.rooms)) {
        const key = `${bname} ${floor}`;
        roomsByFloor[key] = roomList as string[];
      }
    }
  }

  // 运动设施 → 直接作为叶子房间
  const sportsGrounds = SCHOOL_MAP.buildings["运动设施"] as string[] | undefined;
  if (sportsGrounds) {
    for (const sg of sportsGrounds) {
      buildings.push(sg);  // 操场等直接作为可导航地点
    }
  }

  return { buildings, floorsByBuilding, roomsByFloor };
}

/** 学校内部树结构 */
export interface SchoolInternalNode {
  name: string;
  type: "building" | "floor" | "room";
  children: SchoolInternalNode[];
}

/** 车站信息 */
export interface StationInfo {
  name: string;
  lines: string[];
  destinations: { name: string; minutes: number }[];
}

export function getLocationNav(locName: string): {
  breadcrumb: string[];
  parent: string | null;
  siblings: string[];
  children: string[];
  rooms: string[];
  nearby: { name: string; minutes: number }[];
  stations: StationInfo[];
  schoolTree: SchoolInternalNode[] | null;
  level: string;
} {
  const tree = buildLocationTree();
  const node = findInTree(tree, locName);

  // 面包屑
  const breadcrumb: string[] = [];
  let cur = node;
  while (cur) { breadcrumb.unshift(cur.name); cur = cur.parent; }

  // ── 判断是否在学校内部 ──
  const schoolCtx = findSchoolContext(locName);
  const isSchoolNode = node?.type === "school";
  const isInsideSchool = !!schoolCtx;

  // 同层房间（如果在房间级）
  const rooms: string[] = [];
  if (schoolCtx) {
    const floorKey = `${schoolCtx.building} ${schoolCtx.floor}`;
    const schoolData = getSchoolInternals(schoolCtx.school);
    const floorRooms = schoolData.roomsByFloor[floorKey] || [];
    rooms.push(...floorRooms.filter(r => !isSameLocation(r, locName)));
  }

  // ── 确定当前所在层级和导航上下文 ──
  let parent: string | null = null;
  let siblings: string[] = [];
  let children: string[] = [];
  let level = node?.type || "unknown";

  if (isInsideSchool) {
    // 在学校内部的某个房间
    parent = schoolCtx!.school;  // 父级是学校名
    level = "room";

    // 面包屑补全：学校 → 建筑 → 楼层
    if (breadcrumb.length === 0 || !breadcrumb.includes(schoolCtx!.school)) {
      breadcrumb.push(schoolCtx!.school);
    }
    breadcrumb.push(schoolCtx!.building, schoolCtx!.floor);

    // 同级=同层其他房间
    const floorKey = `${schoolCtx!.building} ${schoolCtx!.floor}`;
    const schoolData = getSchoolInternals(schoolCtx!.school);
    siblings = (schoolData.roomsByFloor[floorKey] || []).filter(r => !isSameLocation(r, locName));

    // 子级=空（房间是最底层）
    children = [];

  } else if (isSchoolNode) {
    // 在学校级
    parent = node?.parent?.name || null;
    level = "school";

    const schoolData = getSchoolInternals(node!.name);
    if (schoolData.buildings.length > 0) {
      // 有 school_map 数据 → 建筑→楼层→房间
      children = schoolData.buildings.filter(b => {
        // 过滤：只保留有房间的建筑
        const hasFloors = schoolData.floorsByBuilding[b]?.length > 0;
        const isSportsGround = SCHOOL_MAP?.buildings?.["运动设施"]?.includes(b);
        return hasFloors || isSportsGround;
      });
    } else {
      // 无 school_map → 直接用 locations.json 的 children
      children = (node?.children || []).map(c => c.name);
    }

    // 同级=同 prefecture 下的其他学校/地标
    if (node?.parent) {
      for (const c of node.parent.children) {
        if (c.name !== node!.name) siblings.push(c.name);
      }
    }

  } else {
    // 不在学校内部——城市/地区/其他
    parent = node?.parent?.name || null;
    level = node?.type || "unknown";

    if (node?.parent) {
      for (const c of node.parent.children) {
        if (c.name !== node!.name) siblings.push(c.name);
      }
    }
    children = (node?.children || []).map(c => c.name);

    // 查找下属房间
    for (const [rname] of Object.entries(ROOMS)) {
      if (knownLocationMatch(rname, locName)) rooms.push(rname);
    }
  }

  // 周边微地点：学校/地标的紧邻地点（步行1-8分钟）
  const nearby: { name: string; minutes: number }[] = [];
  if (isSchoolNode && SCHOOL_MAP?.buildings) {
    const surroundings = SCHOOL_MAP["周边"] as { name: string; min: number }[] | undefined;
    if (surroundings) {
      for (const s of surroundings) nearby.push({ name: s.name, minutes: s.min });
    }
  }
  // 同区其他地标/学校（距离基于名称hash固定）
  const parentNode = node?.parent;
  if (parentNode && (node?.type === "school" || node?.type === "landmark" || node?.type === "custom")) {
    for (const c of parentNode.children) {
      if (c.name === node!.name) continue;
      // 已在上面的周边微地点里 → 跳过
      if (nearby.some(n => n.name === c.name)) continue;
      // 固定距离：hash 地名 → 10-30分钟
      const hash = c.name.split("").reduce((s: number, ch: string) => s + ch.charCodeAt(0), 0);
      const mins = 10 + (hash % 20);
      nearby.push({ name: c.name, minutes: mins });
    }
  }

  // 车站查找
  const stations: StationInfo[] = [];
  const regions = CITY_MAP?.regions || {};
  for (const reg of Object.values(regions) as any[]) {
    if (!reg.stations) continue;
    for (const [sn, sd] of Object.entries(reg.stations)) {
      if (isSameLocation(sn, locName) || locName.includes(sn) || sn.includes(locName)) {
        const sdObj = sd as any;
        const dests: { name: string; minutes: number }[] = [];
        if (sdObj.time_to) {
          for (const [dn, dm] of Object.entries(sdObj.time_to)) {
            dests.push({ name: dn, minutes: dm as number });
          }
        }
        stations.push({ name: sn, lines: sdObj.lines || [], destinations: dests });
      }
    }
  }

  // 学校内部树
  let schoolTree: SchoolInternalNode[] | null = null;
  if (isSchoolNode) {
    const schoolData = getSchoolInternals(node!.name);
    schoolTree = [];
    for (const bname of schoolData.buildings) {
      const bnode: SchoolInternalNode = { name: bname, type: "building", children: [] };
      const floors = schoolData.floorsByBuilding[bname] || [];
      for (const f of floors) {
        const fnode: SchoolInternalNode = { name: f, type: "floor", children: [] };
        const floorKey = `${bname} ${f}`;
        const roomList = schoolData.roomsByFloor[floorKey] || [];
        for (const r of roomList) {
          fnode.children.push({ name: r, type: "room", children: [] });
        }
        bnode.children.push(fnode);
      }
      schoolTree.push(bnode);
    }
  }

  return { breadcrumb, parent, siblings, children, rooms, nearby, stations, schoolTree, level };
}

function knownLocationMatch(roomName: string, locName: string): boolean {
  return roomName.includes(locName) || isSameLocation(roomName, locName);
}

/** LLM 动态创建地点 */
export function createDynamicLocation(parentName: string, name: string): string {
  LOCATIONS_DELTA[parentName] ??= [];
  if (LOCATIONS_DELTA[parentName].includes(name)) return `${name} 已存在`;
  LOCATIONS_DELTA[parentName].push(name);
  // 自动加入已知地点
  if (!gameState.player.known_locations.includes(name)) {
    gameState.player.known_locations.push(name);
  }
  saveState();
  return `创建了新地点: ${name}（位于 ${parentName}）`;
}

/** 恢复 locations delta */
export function loadLocationsDelta(targetDir?: string): void {
  const baseDir = targetDir ?? STATE_DIR;
  const deltaPath = path.join(baseDir, "locations_delta.json");
  if (fs.existsSync(deltaPath)) {
    try {
      LOCATIONS_DELTA = JSON.parse(fs.readFileSync(deltaPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse locations_delta.json:", e);
      LOCATIONS_DELTA = {};
    }
  } else {
    LOCATIONS_DELTA = {};
  }
}

// --- 房间时间戳脏污（方向A） ---

/** 记录房间最后访问时间 */
export function stampRoom(roomName?: string): void {
  const name = roomName || gameState.player.location;
  if (!name) return;
  const key = getRoomKey(name) || name;
  gameState.roomTimestamps ??= {};
  gameState.roomTimestamps[key] = gameState.time.game_date;
}

/** 按距上次访问天数返回氛围描述，空串=不注入 */
export function getRoomAgingLine(roomName: string): string {
  gameState.roomTimestamps ??= {};
  const key = getRoomKey(roomName) || roomName;
  const lastVisit = gameState.roomTimestamps[key];
  if (!lastVisit) return "";

  const current = gameState.time.game_date;
  const daysSince = daysBetween(lastVisit, current);
  if (daysSince < 4) return "";

  const seed = gameState.turn + roomName.length;
  const poolIdx = seed % 3;

  if (daysSince >= 30) {
    const pool = [
      "灰尘覆盖了一切——这里像是被遗忘了。",
      "推开门的瞬间，霉味扑面而来。地上积了厚厚一层灰。",
      "这里太久没人来过，连空气都是静止的。",
    ];
    return pool[poolIdx];
  }
  if (daysSince >= 15) {
    const pool = [
      "角落结了蛛网，空气里有股久置的气味。",
      "地板上能看到清晰的灰尘——很久没人来过了。",
      "窗台上积了薄灰，一片寂静。",
    ];
    return pool[poolIdx];
  }
  // 4-14 天
  const pool = [
    "有一阵子没人来了。",
    "几天没来，空气有些沉闷。",
    "桌椅还是上次离开时的样子——已经积了薄灰。",
  ];
  return pool[poolIdx];
}

/** 简易日期差（天），不依赖 Date 对象 */
function daysBetween(d1: string, d2: string): number {
  const [y1, m1, d1n] = d1.split("-").map(Number);
  const [y2, m2, d2n] = d2.split("-").map(Number);
  const total1 = y1 * 365 + m1 * 30 + d1n;
  const total2 = y2 * 365 + m2 * 30 + d2n;
  return Math.max(0, total2 - total1);
}

// --- 空间系统（棋盘格） ---
const DIRS: Record<string, [number, number]> = {
  "北": [0, -1], "南": [0, 1], "东": [1, 0], "西": [-1, 0],
  "上": [0, -1], "下": [0, 1], "左": [-1, 0], "右": [1, 0],
};

export function getRoom(roomName: string): RoomGrid | null {
  const key = getRoomKey(roomName);
  return key ? ROOMS[key] : null;
}

/**
 * 扫描房间中玩家附近的所有 NPC，返回距离和中间墙壁数。
 * 用于察觉检定（偷窃/改造/撬锁/搬东西）。
 */
export function getNearbyNPCs(roomName: string, gridPos: [number, number], maxRange = 10): Array<{ name: string; distance: number; walls: number }> {
  const room = getRoom(roomName);
  if (!room) return [];

  const [px, py] = gridPos;
  const result: Array<{ name: string; distance: number; walls: number }> = [];

  for (const [npcName, npc] of Object.entries(gameState.npcs)) {
    if (!npc.alive || !npc.gridPos || !npc.currentRoom) continue;
    // 判断 NPC 是否在同一房间
    if (!isSameLocation(npc.currentRoom, roomName)) continue;
    const [nx, ny] = npc.gridPos;
    const dist = Math.sqrt((nx - px) ** 2 + (ny - py) ** 2) * (room.cellSize || 1);
    if (dist > maxRange) continue;

    // 计算中间墙壁数（Bresenham 射线）
    let walls = 0;
    let cx = px, cy = py;
    const dx = nx - px, dy = ny - py;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = Math.round(px + dx * t);
      const sy = Math.round(py + dy * t);
      if (sx === nx && sy === ny) break;
      if (sx >= 0 && sx < room.width && sy >= 0 && sy < room.height) {
        const cell = room.cells[sy]?.[sx];
        if (cell && (cell.type === "wall" || (cell.type === "door" && cell.locked))) {
          walls++;
        }
      }
    }

    result.push({ name: npcName, distance: Math.round(dist * 10) / 10, walls });
  }

  return result;
}

export function initPlayerGrid(): void {
  const roomName = gameState.player.location;
  const grid = ROOMS[roomName];
  if (!grid) {
    gameState.player.gridPos = null;
    return;
  }
  // 扫描找入口/门，其次找地板；避免把玩家放在墙壁上
  for (const priority of ["exit", "door", "floor"]) {
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.cells[y]?.[x]?.type === priority) {
          gameState.player.gridPos = [x, y];
          return;
        }
      }
    }
  }
  // 全室无可行走格（极端情况），fallback 到 origin
  gameState.player.gridPos = [...grid.origin];
}

export function movePlayer(direction: string, running: boolean = false): MoveResult {
  const delta = DIRS[direction];
  if (!delta) return { success: false, newX: -1, newY: -1, blocked: true, reason: `无效方向：${direction}`, distance: 0, seconds: 0 };
  
  if (!gameState.player.gridPos) return { success: false, newX: -1, newY: -1, blocked: true, reason: "当前位置不可步行移动", distance: 0, seconds: 0 };
  
  const curRoom = ROOMS[gameState.player.location];
  if (!curRoom) return { success: false, newX: -1, newY: -1, blocked: true, reason: "当前位置没有地图数据" };
  
  const [cx, cy] = gameState.player.gridPos;
  const nx = cx + delta[0];
  const ny = cy + delta[1];
  
  // 边界检查
  if (nx < 0 || nx >= curRoom.width || ny < 0 || ny >= curRoom.height) {
    return { success: false, newX: cx, newY: cy, blocked: true, reason: "前方没有路了", distance: 0, seconds: 0 };
  }
  
  const cell = curRoom.cells[ny]?.[nx];
  if (!cell) return { success: false, newX: cx, newY: cy, blocked: true, reason: "前方没有路了", distance: 0, seconds: 0 };
  
  const cellDist = curRoom.cellSize;
  const speed = running && curRoom.cellSize >= 3 ? 3 : 1.5; // m/s
  const seconds = Math.round(cellDist / speed * 10) / 10;
  
  // 出口/楼梯
  if (cell.type === "exit" || cell.type === "door" || cell.type === "stairs") {
    if (cell.isOpen === false) {
      // 锁门：检查玩家装备有无匹配钥匙
      if (cell.locked) {
        const keyMatch = matchKeyForDoor(gameState.player.equipment, gameState.player.location, cell.exitTo || "");
        if (!keyMatch) {
          return { success: false, newX: cx, newY: cy, blocked: true, reason: "门锁着，需要钥匙", distance: 0, seconds: 0 };
        }
        // 有钥匙 → 开锁，继续走出口逻辑
        cell.locked = false;
        cell.isOpen = true;
        cell.block = false;
      } else {
        return { success: false, newX: cx, newY: cy, blocked: true, reason: "门关着", distance: 0, seconds: 0 };
      }
    }
    if (cell.exitTo) {
      // 宏观名册校验
      if (!ROOMS[cell.exitTo]) {
        return { success: false, newX: cx, newY: cy, blocked: true, reason: `${cell.exitTo}不存在`, distance: 0, seconds: 0 };
      }
      gameState.player.location = cell.exitTo;
      initPlayerGrid();
      return { success: true, newX: gameState.player.gridPos?.[0] ?? 0, newY: gameState.player.gridPos?.[1] ?? 0, newRoom: cell.exitTo, blocked: false, reason: "", distance: cellDist, seconds };
    }
    return { success: false, newX: cx, newY: cy, blocked: true, reason: "门打不开", distance: 0, seconds: 0 };
  }
  
  // 高度阻挡检查（优先于通用阻挡，处理低障碍/可攀爬墙）
  let heightSeconds = 0;
  if (cell.block && cell.height !== undefined) {
    if (cell.height < 0.4) {
      // 只是个小台阶，直接跨过，无减速
    } else if (cell.height < 1.0) {
      // 低障碍物：可以跨过，但减速1秒
      heightSeconds = 1;
    } else {
      // height >= 1.0m：高障碍
      if (cell.tags && cell.tags.includes("climbable")) {
        const str = gameState.player.attributes.力量 + getEquipmentBonus(gameState.player.equipment, "attribute_bonus", "力量");
        const athletics = (gameState.player.skills["运动"]?.level ?? 0) + getEquipmentBonus(gameState.player.equipment, "skill_bonus", "运动");
        const d = Math.floor(Math.random() * 20) + 1;
        const dc = 15;
        const total = d + attrMod(str) + athletics;
        if (total < dc) {
          return { success: false, newX: cx, newY: cy, blocked: true, reason: "攀爬失败——手滑了", distance: 0, seconds: 0 };
        }
        heightSeconds = 2; // 攀爬耗时
      } else {
        return { success: false, newX: cx, newY: cy, blocked: true, reason: "前方是不可翻越的高墙", distance: 0, seconds: 0 };
      }
    }
  }

  // 通用阻挡（仅当无 height 字段时保持原行为；有 height 的已在上方处理）
  if ((cell.block || cell.type === "wall") && cell.height === undefined) {
    return { success: false, newX: cx, newY: cy, blocked: true, reason: cell.furniture ? `被${cell.furniture}挡住了` : "前方是墙壁", distance: 0, seconds: 0 };
  }

  // 通行
  gameState.player.gridPos = [nx, ny];

  // holding_in_hands 减速：搬运重物时移动速度减半（耗时加倍）
  const holdingHeavy = gameState.player.inventory.some((i: any) => i.holding_in_hands);
  const finalSeconds = holdingHeavy ? (seconds + heightSeconds) * 2 : seconds + heightSeconds;

  return { success: true, newX: nx, newY: ny, blocked: false, reason: "", distance: cellDist, seconds: Math.round(finalSeconds * 10) / 10 };
}

export async function createRoom(roomName: string, width: number, height: number, floor: number): Promise<{ success: boolean; reason: string }> {
  const cleanName = roomName.replace(/[（(].*[）)]/, "").trim().toLowerCase();
  if (ROOMS[cleanName] || ROOMS[roomName]) return { success: false, reason: `房间 ${roomName} 已存在` };
  if (width < 1 || height < 1) return { success: false, reason: "房间尺寸无效" };
  if (width * height > 10000) return { success: false, reason: `房间面积过大（${width*height}m²，上限10000m²）` };  // 防 LLM 恶意巨型房间

  const cells: any[][] = [];
  for (let y = 0; y < height; y++) {
    const row: any[] = [];
    for (let x = 0; x < width; x++) {
      row.push({
        type: "floor",
        block: false,
        furniture: null,
        label: "  "
      });
    }
    cells.push(row);
  }

  ROOMS[roomName] = {
    width, height,
    cellSize: 1,
    floor,
    origin: [Math.floor(width/2), Math.floor(height/2)],
    cells,
    capacity: undefined
  };

  // 物理约束：施工需要时间和金钱
  const multiplier = getConstructionMultiplier();
  const currencySymbol = getCurrency();
  const constructionMinutes = width * height * 5;
  const constructionCost = width * height * multiplier;
  if (gameState.player.funds < constructionCost) {
    return { success: false, reason: `资金不足。建造${width}×${height}房间需要${currencySymbol}${constructionCost}，当前余额${currencySymbol}${gameState.player.funds}` };
  }
  gameState.player.funds -= constructionCost;
  const { advanceMinutes } = await import("./time.ts");
  // 确保 minute_of_day 存在
  if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
  advanceMinutes(gameState.time, constructionMinutes);
  saveState();
  return { success: true, reason: `创建了新房间 ${roomName} (${width}x${height})，花费${currencySymbol}${constructionCost}，施工耗时${constructionMinutes}分钟。` };
}

export function editCellType(x: number, y: number, type: "floor" | "wall" | "door" | "exit" | "stairs", exitTo?: string, material?: string): { success: boolean; reason: string } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图" };
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };

  const cell = room.cells[y][x];

  // 物理约束：建造墙体/门/出口需要材料
  if (type === "wall" || type === "door" || type === "exit") {
    if (!material) {
      return { success: false, reason: `建造${type}需要指定材料。请通过 material 参数传入材料物品名（如"砖"、"木板"、"门框"）。` };
    }
    const invalidMaterials = ["锤子", "铲子", "撬棍", "手机", "钱包", "书包", "钥匙", "手电筒", "打火机", "自行车", "摩托车", "轻自动车", "绷带", "急救包"];
    if (invalidMaterials.includes(material)) {
      return { success: false, reason: `${material}是功能性装备或工具，无法作为建材消耗。` };
    }
    const idx = gameState.player.inventory.findIndex((i: any) => i.name === material && i.state !== "ruined");
    if (idx < 0) {
      return { success: false, reason: `背包里没有${material}。需要先获取该材料。` };
    }

    // 建造也需要工具（耐久消耗）
    const buildingTools = ["锤子", "铲子", "撬棍"];
    const tool = gameState.player.inventory.find((i: any) => buildingTools.includes(i.name) && i.state !== "ruined");
    if (!tool && gameState.player.attributes.力量 < 5) {
      return { success: false, reason: `力量不足（需要≥5），且背包里没有合适的建造工具（如"锤子"、"铲子"、"撬棍"）。` };
    }

    // 扣除材料
    gameState.player.inventory.splice(idx, 1);

    if (tool) {
      damageItem(tool); // 消耗工具耐久而非直接删除！
    }
  }

  // 物理约束：拆墙需要力量或工具
  if (type === "floor" && cell.type === "wall") {
    const tool = material ? gameState.player.inventory.find((i: any) => i.name === material && i.state !== "ruined") : null;
    if (!tool && gameState.player.attributes.力量 < 5) {
      return { success: false, reason: `力量不足（需要≥5），且背包里没有合适的工具。请指定 material 参数传入工具名（如"锤子"、"撬棍"）。` };
    }
    if (tool) {
      damageItem(tool); // 消耗工具耐久而非直接删除！
    }
  }

  cell.type = type;
  if (type === "wall") {
    cell.block = true;
    cell.label = "WL";
    cell.furniture = null;
  } else if (type === "floor" || type === "stairs") {
    cell.block = !!cell.furniture;
    cell.label = cell.furniture ? cell.furniture.slice(0, 4) : "  ";
  } else if (type === "door" || type === "exit") {
    cell.block = !(cell.isOpen !== false);
    cell.label = "DR";
    if (exitTo) cell.exitTo = exitTo;
  }

  saveState();
  return { success: true, reason: `在(${x},${y})建造了${type}${exitTo ? ` 通往${exitTo}` : ""}${material ? `（消耗${material}）` : ""}` };
}

export function placeFurniture(x: number, y: number, itemName: string, furnitureActions?: Record<string, any>): { success: boolean; reason: string } {
  if (!gameState.player.gridPos) return { success: false, reason: "当前位置不可建造" };
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图" };

  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };

  const cell = room.cells[y][x];
  if (cell.type === "wall") return { success: false, reason: "不能放在墙上" };
  if (cell.type === "exit" || cell.type === "door") return { success: false, reason: "不能堵住门口" };
  if (cell.furniture) return { success: false, reason: `这里已经有${cell.furniture}了` };

  // 物理约束：背包必须有该物品
  const idx = gameState.player.inventory.findIndex((i: any) => i.name === itemName);
  if (idx < 0) return { success: false, reason: `背包里没有${itemName}。需要先获取该物品（购买/拾荒/偷窃等）。` };
  gameState.player.inventory.splice(idx, 1);  // 从背包扣除

  cell.furniture = itemName;
  cell.label = itemName.slice(0, 4);  // 简单缩写，用于棋盘格显示
  cell.block = true;
  if (furnitureActions && Object.keys(furnitureActions).length > 0) {
    (cell as any).furniture_actions = furnitureActions;
  }
  saveState();
  return { success: true, reason: `放置了${itemName}（已从背包扣除）` };
}

export function getItemTemplate(itemName: string): Item {
  let itemData: any = null;
  for (const cat of Object.values(itemsCatalog)) {
    if ((cat as any)[itemName]) { itemData = (cat as any)[itemName]; break; }
  }
  if (itemData) {
    return structuredClone(itemData);
  }
  // Fallback for dynamic materials/items like 砖 or 废铁板
  return {
    name: itemName,
    type: "tool",
    slot: "back",
    weight: 1.0,
    effects: [],
    state: "intact",
    volume: 0.5
  };
}

export function removeFurniture(x: number, y: number): { success: boolean; reason: string; item?: string } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图" };
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };
  
  const cell = room.cells[y][x];
  if (!cell.furniture) return { success: false, reason: "这里没有家具" };
  const item = cell.furniture;
  cell.furniture = null;
  cell.block = false;

  // 将家具放回背包
  const template = getItemTemplate(item);
  gameState.player.inventory.push(template);

  saveState();
  return { success: true, reason: `拆除了${item}（已放回背包）`, item };
}

// --- 钥匙匹配 ---

/** 检查装备中是否有钥匙能开这扇门。匹配规则：钥匙 unlock 值包含在当前房间名或出口名中 */
function matchKeyForDoor(equipment: EquipmentSlots, roomName: string, exitTo: string): string | null {
  for (const item of Object.values(equipment)) {
    if (!item?.effects) continue;
    for (const eff of item.effects) {
      if (eff.type !== "unlock") continue;
      const val = String(eff.value);
      if (roomName.includes(val) || exitTo.includes(val)) return item.name;
    }
  }
  return null;
}

// --- 门窗开关 ---
export function toggleDoor(x: number, y: number): { success: boolean; reason: string; isOpen: boolean } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图", isOpen: false };
  const cell = room.cells[y][x];
  if (cell.type !== "door" && cell.type !== "exit") return { success: false, reason: "这不是门窗", isOpen: false };
  // 锁门需要钥匙才能开
  if (cell.locked) {
    const keyMatch = matchKeyForDoor(gameState.player.equipment, gameState.player.location, cell.exitTo || "");
    if (!keyMatch) return { success: false, reason: "门锁着，需要钥匙", isOpen: false };
    cell.locked = false;
    cell.isOpen = true;
    cell.block = false;
    saveState();
    return { success: true, reason: `${keyMatch}打开了门`, isOpen: true };
  }
  cell.isOpen = !(cell.isOpen !== false); // 切换，默认true
  cell.block = !cell.isOpen;
  saveState();
  return { success: true, reason: cell.isOpen ? "打开了" : "关上了", isOpen: cell.isOpen };
}

// --- 记忆标签：LLM观察到某事 → 打标签 ---
export function addMemoryTag(npcName: string, tag: string, expiresDays: number = 365, tone?: string): void {
  const npc = gameState.npcs[npcName];
  if (!npc) return;
  npc.memoryTags ??= [];
  npc.memoryTags.push({ tag, since: gameState.time.game_date, expires: expiresDays, tone: tone as any });
}

export function getMemoryTags(npcName: string): string[] {
  const npc = gameState.npcs[npcName];
  if (!npc?.memoryTags) return [];
  return npc.memoryTags.slice(-5).map(t => `${t.tag}${t.tone ? ` [${t.tone}]` : ""}`);
}

// --- 多维声望 ---
export function updateReputation(group: string, delta: number): number {
  if (!gameState.player.reputation[group]) gameState.player.reputation[group] = 0;
  gameState.player.reputation[group] = Math.max(-3, Math.min(5, gameState.player.reputation[group] + delta));
  saveState();
  return gameState.player.reputation[group];
}

/** 服装声望加成：扫描当前装备中的reputation_bonus */
export function calcReputationBonus(group: string): number {
  let bonus = 0;
  for (const item of Object.values(gameState.player.equipment)) {
    if (!item) continue;
    for (const eff of item.effects) {
      if (eff.type === "reputation_bonus" && eff.group === group) {
        bonus += Number(eff.value);
      }
    }
  }
  return bonus;
}

// --- 日程覆盖（生病/约定等） ---
export function setScheduleOverride(npcName: string, location: string, reason: string, durationHours: number = 24): string {
  const npc = gameState.npcs[npcName];
  if (!npc) return `未找到NPC: ${npcName}`;
  const now = new Date(gameState.time.game_date);
  now.setHours(now.getHours() + durationHours);
  const expiresAt = now.toISOString().slice(0, 10);
  npc.pendingOverride = { location, action: reason, reason, expiresAt };
  saveState();
  return `${npcName}: 覆盖日程 → ${location}（${reason}），${durationHours}小时后过期`;
}

export function clearScheduleOverride(npcName: string): string {
  const npc = gameState.npcs[npcName];
  if (!npc) return `未找到NPC: ${npcName}`;
  npc.pendingOverride = null;
  saveState();
  return `${npcName}: 日程覆盖已清除`;
}
// --- 商店/经济（AIRP风格：引擎只做会计，LLM管市场常识） ---

export let PRICE_RANGE = economyConfig.price_ranges as Record<string, [number, number]>;

function validatePrice(itemName: string, price: number): string | null {
  let itemType = "tool";
  for (const [cat, items] of Object.entries(itemsCatalog)) {
    if ((items as any)[itemName]) {
      itemType = cat === "consumables" ? "consumable" : cat === "weapons" ? "weapon" : cat === "armor" ? "armor" : cat === "clothing" ? "clothing" : "tool";
      break;
    }
  }
  const [min, max] = PRICE_RANGE[itemType] || [10, 50000];
  const currencySymbol = getCurrency();
  if (price < min) return `${itemName}价格通常不低于${currencySymbol}${min}`;
  if (price > max) return `${itemName}价格通常不超过${currencySymbol}${max}`;
  return null;
}

export function buyItem(itemName: string, price: number, shopName?: string): string {
  let itemData: any = null;
  for (const cat of Object.values(itemsCatalog)) {
    if ((cat as any)[itemName]) { itemData = (cat as any)[itemName]; break; }
  }
  if (!itemData) return `LLM必须指定有效物品名`;

  // 货架校验：如果指定了商店，检查该商店是否售卖此物品
  if (shopName) {
    const activeShops: Record<string, { items: string[] }> =
      (gameState as any).shops && Object.keys((gameState as any).shops).length > 0
        ? (gameState as any).shops   // 运行时货架（restock_shop写入）
        : shops;                     // 文件货架（worldpack/data/shops.json）
    const shopEntry = activeShops[shopName];
    if (!shopEntry || !Array.isArray(shopEntry.items)) {
      return `${shopName}没有货架信息`;
    }
    if (!shopEntry.items.includes(itemName)) {
      return `${shopName}不卖${itemName}`;
    }
  }

  const err = validatePrice(itemName, price);
  if (err) return err;
  // 魅力谈判：高魅力砍价
  const chaBonus = attrMod(gameState.player.attributes.魅力);
  const discount = Math.round(price * chaBonus * 0.01);
  const finalPrice = Math.max(price - discount, price * 0.85);
  const currencySymbol = getCurrency();
  if (gameState.player.funds < finalPrice) return `钱不够。需要${currencySymbol}${finalPrice}，余额${currencySymbol}${gameState.player.funds}`;
  gameState.player.funds -= finalPrice;
  gameState.player.inventory.push(structuredClone(itemData));
  saveState();
  const discountStr = discount > 0 ? ` (魅力砍价-${currencySymbol}${discount})` : "";
  return `买了${itemName}，花费${currencySymbol}${finalPrice}${discountStr}。余额${currencySymbol}${gameState.player.funds}`;
}

export function sellItem(itemName: string, price: number, buyerName?: string, shopName?: string): string {
  const idx = gameState.player.inventory.findIndex(i => i.name === itemName);
  if (idx < 0) return `背包里没有${itemName}`;

  // 货架校验：如果指定了商店，检查该商店是否接收此物品类型
  if (shopName) {
    const activeShops: Record<string, { items: string[] }> =
      (gameState as any).shops && Object.keys((gameState as any).shops).length > 0
        ? (gameState as any).shops
        : shops;
    const shopEntry = activeShops[shopName];
    if (!shopEntry || !Array.isArray(shopEntry.items)) {
      return `${shopName}没有货架信息`;
    }
    if (!shopEntry.items.includes(itemName)) {
      return `${shopName}不收${itemName}`;
    }
  }

  const err = validatePrice(itemName, price);
  if (err) return err;
  // 魅力谈判：高魅力卖更高价
  const chaBonus = attrMod(gameState.player.attributes.魅力);
  const premium = Math.round(price * chaBonus * 0.005);
  const finalPrice = Math.min(price + premium, price * 1.1);
  const currencySymbol = getCurrency();
  if (buyerName) {
    const npc = getOrCreateNPC(buyerName);
    if (npc.funds < finalPrice) return `${buyerName}只有${currencySymbol}${npc.funds}，买不起${currencySymbol}${finalPrice}的${itemName}`;
    npc.funds -= finalPrice;
  }
  gameState.player.inventory.splice(idx, 1);
  gameState.player.funds += finalPrice;
  saveState();
  const buyerMsg = buyerName ? `（卖给${buyerName}）` : "";
  const premiumStr = premium > 0 ? ` (魅力谈价+${currencySymbol}${premium})` : "";
  return `卖了${itemName}${buyerMsg}，获得${currencySymbol}${finalPrice}${premiumStr}。余额${currencySymbol}${gameState.player.funds}`;
}

export function workJob(jobName: string, hours: number): string {
  const rates = economyConfig.job_rates as Record<string, number>;
  const rate = rates[jobName] || 900;
  const pay = rate * hours;
  gameState.player.funds += pay;
  saveState();
  const currencySymbol = getCurrency();
  return `工作${hours}小时（${jobName}），获得${currencySymbol}${pay}。余额${currencySymbol}${gameState.player.funds}`;
}

// --- 生长发育（月末结算） ---
export function monthlyGrowth(diet: string, exercise: string): string {
  const b = gameState.player.body;
  const changes: string[] = [];
  
  // 身高（每年约5-8cm，取决于年龄和营养）
  const isGrowing = gameState.player.age < 18;
  if (isGrowing) {
    const baseGrowth = gameState.player.age < 12 ? 0.5 : gameState.player.age < 15 ? 0.8 : 0.4;
    const dietBonus = diet === "丰胸食谱" || diet === "高蛋白" ? 0.2 : 0;
    const exerciseBonus = exercise === "高强度训练" || exercise === "规律运动" ? 0.1 : 0;
    const hChange = Math.round((baseGrowth + dietBonus + exerciseBonus) * 10) / 10;
    b.height_cm = Math.round((b.height_cm + hChange) * 10) / 10;
    changes.push(`身高+${hChange}cm`);
  }
  
  // 体重（波动）
  const wChange = diet === "节食" ? -0.2 : diet === "高蛋白" ? 0.5 : 0.2;
  b.weight_kg = Math.round((b.weight_kg + wChange) * 10) / 10;
  if (Math.abs(wChange) > 0.1) changes.push(`体重${wChange > 0 ? "+" : ""}${wChange}kg`);
  
  // 三围（仅女性，发育期每月微调）
  if (b.measurements && gameState.player.age >= 10 && gameState.player.age < 18) {
    const d = Math.random() * 0.3;
    b.measurements.bust = Math.round((b.measurements.bust + (diet === "丰胸食谱" ? d * 2 : d)) * 10) / 10;
    b.measurements.waist = Math.round((b.measurements.waist + (exercise === "规律运动" ? -0.1 : 0.1)) * 10) / 10;
    b.measurements.hips = Math.round((b.measurements.hips + Math.random() * 0.2) * 10) / 10;
    changes.push(`三围微调`);
  }
  
  saveState();
  return `月末发育结算（${diet} / ${exercise}）: ${changes.join("，")}`;
}

// --- 天气 ---
const SEASONS: Record<string, { types: string[]; temps: [number, number] }> = {
  "春": { types: ["晴","多云","小雨","晴"], temps: [10, 22] },
  "夏": { types: ["晴","晴","多云","小雨","雷阵雨"], temps: [22, 35] },
  "秋": { types: ["晴","多云","阴","小雨"], temps: [8, 20] },
  "冬": { types: ["晴","多云","阴","雪"], temps: [0, 10] },
};

export function refreshWeather(): string {
  transitionWeather(gameState);
  saveState();
  return `${gameState.weather.type} ${gameState.weather.temp}°C`;
}

// --- NPC 日程更新 ---
export let sexProfilesData = sexProfilesStatic as any;
const TEMPLATES = scheduleTemplates as any;

export function getFallbackRoom(roomName: string): string {
  const matched = lookupRegion(roomName);
  if (matched && matched.matched_regions && matched.matched_regions.length > 0) {
    const reg = matched.matched_regions[0] as any;
    if (reg.fallback_room) return reg.fallback_room;
  }
  return "1F南走廊";
}

export function getRoomCapacity(roomName: string): number {
  const room = ROOMS[roomName];
  if (!room) return 999;
  if (room.capacity !== undefined) return room.capacity;
  
  let traversableCount = 0;
  for (let y = 0; y < room.height; y++) {
    const row = room.cells[y];
    if (!row) continue;
    for (let x = 0; x < room.width; x++) {
      const cell = row[x];
      // 地板或出入口类格子作为可通行空间计算容量
      if (cell && (cell.type === "floor" || cell.type === "door" || cell.type === "exit" || cell.type === "stairs") && !cell.block) {
        traversableCount++;
      }
    }
  }
  
  return Math.max(1, traversableCount);
}

export async function updateNPCSchedules(): Promise<string[]> {
  const events: string[] = [];
  const { time_of_day, day_of_week } = gameState.time;
  const isWeekend = ["土", "日"].includes(day_of_week);
  
  // 当前时段 → 模板key
  const slotMap: Record<string, string> = {
    "morning": "weekday_morning",
    "lunch": "weekday_lunch",
    "afternoon": "weekday_afternoon",
    "evening": "weekday_evening",
    "night": "weekday_evening",
  };
  const timeKey = isWeekend ? "weekend" : (slotMap[time_of_day] || "weekday_morning");
  
  // 房间容量计数器，初始化玩家所在位置人数
  const roomCounts: Record<string, number> = {};
  if (gameState.player.location) {
    const pLocKey = getRoomKey(gameState.player.location) || gameState.player.location;
    roomCounts[pLocKey] = 1;
  }

  for (const [name, npc] of Object.entries(gameState.npcs)) {
    // Tier 1: 一次性覆盖（生病/约定/紧急事件）
    if (npc.pendingOverride) {
      const ov = npc.pendingOverride;
      // 过期自动清除
      if (ov.expiresAt && ov.expiresAt < gameState.time.game_date) {
        npc.pendingOverride = null;
      } else {
        const matchedRoom = getRoomKey(ov.location) || ov.location;
        let finalRoom = matchedRoom;
        const cap = getRoomCapacity(finalRoom);
        roomCounts[finalRoom] ??= 0;
        if (roomCounts[finalRoom] >= cap) {
          const fallback = getFallbackRoom(finalRoom);
          events.push(`${name}: 因 ${finalRoom} 人数已满(${roomCounts[finalRoom]}/${cap})，分流至 ${fallback}`);
          finalRoom = fallback;
        }
        roomCounts[finalRoom] ??= 0;
        roomCounts[finalRoom]++;

        if (npc.currentRoom !== finalRoom) {
          const old = npc.currentRoom;
          npc.currentRoom = finalRoom;
          npc.gridPos = ROOMS[finalRoom]?.origin || null;
          npc.action = ov.action;
          events.push(`${name}: ${old} → ${finalRoom}（${ov.reason}）`);
        }
        continue; // 跳过后续模板查询
      }
    }
    
    const src = (characters as any[]).find((c: any) => c.name === name);
    
    // 优先 override > 群体模板 > 旧 schedule
    let targetRoom: string | null = null;
    if (npc.scheduleOverrides?.[timeKey]) {
      targetRoom = npc.scheduleOverrides[timeKey];
    } else if (src?.schedule_overrides?.[timeKey]) {
      targetRoom = src.schedule_overrides[timeKey];
    }
    
    if (!targetRoom) {
      // 按年龄解析 schedule_group（schedule_group_by_age 优先于 scheduleGroup）
      let effectiveGroup = npc.scheduleGroup;
      if (src?.schedule_group_by_age) {
        const curAge = getNpcCurrentAge(src.base_age || 16);
        const keys = Object.keys(src.schedule_group_by_age).map(Number).sort((a,b) => a - b);
        let best = keys[0];
        for (const k of keys) {
          if (k <= curAge) best = k;
          else break;
        }
        effectiveGroup = src.schedule_group_by_age[String(best)] || effectiveGroup;
      }
      const tpl = TEMPLATES[effectiveGroup];
      let routeStr = tpl?.[timeKey];
      if (tpl) {
        const season = getSeason(gameState.time.game_date);
        const wKey = mapChineseWeather(gameState.weather?.type || "晴");
        if (tpl.weather_overrides?.[wKey]?.[timeKey]) {
          routeStr = tpl.weather_overrides[wKey][timeKey];
        } else if (tpl.seasonal_overrides?.[season]?.[timeKey]) {
          routeStr = tpl.seasonal_overrides[season][timeKey];
        }
      }
      if (routeStr) {
        const opts = routeStr.split("/");
        targetRoom = opts[Math.floor(Math.random() * opts.length)].trim();
      }
    }
    
    if (!targetRoom || targetRoom === "自由") continue;
    
    // 匹配房间名
    const matchedRoom = getRoomKey(targetRoom);
    if (!matchedRoom) continue;
    
    // 检查容量并分流
    let finalRoom = matchedRoom;
    const cap = getRoomCapacity(finalRoom);
    roomCounts[finalRoom] ??= 0;
    if (roomCounts[finalRoom] >= cap) {
      const fallback = getFallbackRoom(finalRoom);
      events.push(`${name}: 因 ${finalRoom} 人数已满(${roomCounts[finalRoom]}/${cap})，分流至 ${fallback}`);
      finalRoom = fallback;
    }
    roomCounts[finalRoom] ??= 0;
    roomCounts[finalRoom]++;

    // 物理优先：当前房间有网格时才检查出口
    if (npc.currentRoom !== finalRoom && npc.gridPos) {
      const curRoom = ROOMS[npc.currentRoom];
      if (curRoom) {
        // 找通往目标方向的出口
        let exitFound = false;
        for (const row of curRoom.cells) {
          for (const cell of row) {
            if ((cell.type === "exit" || cell.type === "door") && cell.exitTo) {
              const exitKey = getRoomKey(cell.exitTo);
              const finalKey = getRoomKey(finalRoom);
              if (exitKey && finalKey && exitKey === finalKey) {
                if (cell.isOpen === false) {
                  events.push(`${name}: 门关着，无法离开${npc.currentRoom}前往${finalRoom}`);
                  exitFound = true;
                  break;
                }
                exitFound = true;
                break;
              }
            }
          }
          if (exitFound) break;
        }
      }
    }
    
    // 移动
    if (npc.currentRoom !== finalRoom) {
      const oldRoom = npc.currentRoom;
      npc.currentRoom = finalRoom;
      npc.gridPos = ROOMS[finalRoom]?.origin || null;
      events.push(`${name}: ${oldRoom} → ${finalRoom}`);
    }
  }
  
  // 公共区域填充：带属性的随机路人
  const publicRooms = ["中庭", "1F南走廊", "2F南走廊-J班前", "2F南走廊-F班前"];
  const traits = [
    "戴耳机听歌", "低头看书", "背着书包赶路", "大声打电话", 
    "情侣二人组", "发呆的女生", "角落里抽烟的不良", "提着购物袋的主妇", 
    "互相追逐的小学生", "睡觉的流浪汉", "四处巡视的巡警", "飞驰而过的外卖员"
  ];
  for (const rn of publicRooms) {
    const room = ROOMS[rn];
    if (!room) continue;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const t = traits[Math.floor(Math.random() * traits.length)];
      events.push(`[路人: ${t}]: ${rn}`);
    }
  }
  
  if (events.length > 0) saveState();
  
  // 社交结算：同处一室的NPC交换记忆标签 + 生成碰面事件
  const roomNPCs: Record<string, string[]> = {};
  for (const [name, npc] of Object.entries(gameState.npcs)) {
    if (!roomNPCs[npc.currentRoom]) roomNPCs[npc.currentRoom] = [];
    roomNPCs[npc.currentRoom].push(name);
  }

  const deduplicateTags = (tags: any[]): any[] => {
    const seen = new Set<string>();
    const res: any[] = [];
    for (let k = tags.length - 1; k >= 0; k--) {
      const t = tags[k];
      if (!t || !t.tag) continue;
      if (!seen.has(t.tag)) {
        seen.add(t.tag);
        res.unshift(t);
      }
    }
    return res;
  };

  const isPrivateTag = (tagText: string): boolean => {
    const privateKeywords = ["自慰", "处女", "非处", "初吻", "初夜", "秘密", "性感", "隐私", "[秘密]", "[性]"];
    return privateKeywords.some(kw => tagText.includes(kw));
  };

  const canShareTag = (tag: any, relStage?: string, relTone?: string): boolean => {
    if (isPrivateTag(tag.tag)) {
      const closeStages = ["闺蜜", "恋人", "夫妻"];
      if (closeStages.includes(relStage || "")) return true;
      if (relStage === "朋友" && (relTone === "喜欢" || relTone === "感激")) return true;
      return false;
    }
    return relTone !== "厌恶";
  };

  const checkExpiry = (t: any) => {
    const time = new Date(t.since).getTime();
    if (isNaN(time)) return true; // 解析失败则安全保留，不直接过滤
    const currentDate = gameState.time?.game_date ? new Date(gameState.time.game_date).getTime() : Date.now();
    const daysSince = (currentDate - time) / 86400000;
    return daysSince < t.expires;
  };

  // 预先清理并排重所有 NPC 的记忆标签
  for (const npc of Object.values(gameState.npcs)) {
    if (npc.memoryTags) {
      const active = npc.memoryTags.filter(checkExpiry);
      npc.memoryTags = deduplicateTags(active);
    }
  }

  const socialEvents: string[] = [];
  for (const [room, names] of Object.entries(roomNPCs)) {
    if (names.length < 2) continue;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const nameA = names[i];
        const nameB = names[j];
        const a = gameState.npcs[nameA];
        const b = gameState.npcs[nameB];
        a.memoryTags ??= [];
        b.memoryTags ??= [];

        // 1. 社交过滤：过期标签清理
        const activeA = a.memoryTags.filter(checkExpiry);
        const activeB = b.memoryTags.filter(checkExpiry);

        // 2. 关系检测：获取 NPC 对彼此的关系状态
        const relAtoB = (a as any).npcRelationships?.[nameB];
        const relBtoA = (b as any).npcRelationships?.[nameA];

        // 3. 交换标签（限额 2 个对方没有的最新 Tag）
        const shareableFromA = activeA.filter(t => canShareTag(t, relAtoB?.stage, relAtoB?.tone));
        const shareableFromB = activeB.filter(t => canShareTag(t, relBtoA?.stage, relBtoA?.tone));

        const toAddtoB = shareableFromA
          .filter(t => !activeB.some(bt => bt.tag === t.tag))
          .slice(-2); // 取最新的 2 个
        const toAddtoA = shareableFromB
          .filter(t => !activeA.some(at => at.tag === t.tag))
          .slice(-2); // 取最新的 2 个

        a.memoryTags = deduplicateTags([...activeA, ...toAddtoA]);
        b.memoryTags = deduplicateTags([...activeB, ...toAddtoB]);

        // 生成碰面事件
        const rel = gameState.player.relationships[nameA];
        const knowA = rel && rel.affection > 0;
        const knowB = gameState.player.relationships[nameB]?.affection > 0;
        if (knowA || knowB) {
          socialEvents.push(`${nameA}和${nameB}在${room}碰面`);
        }
      }
    }
  }
  
  // 手机消息：从事件中生成 NPC 短信（使用 phone.ts 引擎）
  try {
    const { getPlayerPhoneData, syncContactsFromRelationships, deliverMessage } = await import("./phone.ts");
    const pd = getPlayerPhoneData();
    if (pd) {
      syncContactsFromRelationships(pd);
      const now = gameState.time.game_date;
      for (const ev of events) {
        const match = ev.match(/^(.+?):\s*(.+?)\s*→\s*(.+)/);
        if (match) {
          const [, name, from, to] = match;
          const rel = gameState.player.relationships[name];
          if (rel && rel.affection >= 30 && Math.random() < 0.3) {
            const templates = [
              `今天换个地方待着——在${to}。`,
              `刚路过${from}，现在到${to}了。`,
              `移动中 ${from}→${to}`,
            ];
            deliverMessage(pd, name, gameState.player.name,
              templates[Math.floor(Math.random() * templates.length)]);
          }
        }
        const meetMatch = ev.match(/^(.+?)和(.+?)在(.+?)碰面/);
        if (meetMatch) {
          const [, a, b, loc] = meetMatch;
          const relA = gameState.player.relationships[a];
          if (relA && relA.affection >= 40 && Math.random() < 0.4) {
            deliverMessage(pd, a, gameState.player.name, `刚在${loc}碰到${b}了！`);
          }
        }
      }
      for (const [nname, npc] of Object.entries(gameState.npcs)) {
        if (!npc.memoryTags || npc.memoryTags.length === 0) continue;
        const rel = gameState.player.relationships[nname];
        if (!rel || rel.affection <= 0) continue;
        const latest = npc.memoryTags[npc.memoryTags.length - 1];
        if (latest && Math.random() < 0.25) {
          deliverMessage(pd, nname, gameState.player.name,
            `听说 "${latest.tag}"…能告诉我更多吗？`);
        }
      }
    }
  } catch (_) {}

  return events;
}

// --- 空间统计注入 LLM 上下文 ---
export function getGridContext(): string {
  const room = ROOMS[gameState.player.location];
  if (!room || !gameState.player.gridPos) return "";

  const [px, py] = gameState.player.gridPos;

  // 出口与窗户开口列表
  const exits: string[] = [];
  const furniture: string[] = [];
  const facingViews: string[] = [];
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const c = room.cells[y][x];
      const tagStr = c.tags && c.tags.length > 0 ? `[${c.tags.join(",")}]` : "";
      const heightStr = c.height !== undefined ? `[h:${c.height}m]` : "";
      if (c.type === "exit" || c.type === "door") {
        const lockTag = c.locked ? "{锁}" : c.isOpen === false ? "{关}" : "";
        exits.push(`${c.exitTo || "出口"}(${x},${y})${lockTag}${tagStr}${heightStr}`);
      }
      if (c.furniture) furniture.push(`${c.furniture}(${x},${y})${tagStr}${heightStr}`);
      if (c.faces) facingViews.push(`坐标(${x},${y})的窗户朝向【${c.faces}】`);
    }
  }

  // 四周一格：LLM 知道邻格有什么，但不知道邻格之外
  const around: string[] = [];
  const DIR_LABELS: Record<string, string> = { "北": "北侧", "南": "南侧", "东": "东侧", "西": "西侧" };
  for (const [d, [dx, dy]] of Object.entries(DIRS).slice(0, 4)) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || nx >= room.width || ny < 0 || ny >= room.height) continue;
    const c = room.cells[ny][nx];
    const side = DIR_LABELS[d] || d;
    const tagStr = c.tags && c.tags.length > 0 ? `[${c.tags.join(",")}]` : "";
    const heightStr = c.height !== undefined ? `[h:${c.height}m]` : "";
    if (c.type === "wall") {
      if (c.faces) {
        around.push(`${side}是墙壁(有窗户朝向【${c.faces}】)${tagStr}${heightStr}`);
      } else {
        around.push(`${side}是墙壁${tagStr}${heightStr}`);
      }
    }
    else if (c.furniture) around.push(`${side}被${c.furniture}挡住了${tagStr}${heightStr}`);
    else if (c.type === "exit" || c.type === "door") {
      const lockTag = c.locked ? "🔐" : c.isOpen === false ? "🔒" : "";
      const facingTag = c.faces ? `，朝向【${c.faces}】` : "";
      around.push(`${side}${lockTag}通向${c.exitTo || "?"}${facingTag}${tagStr}${heightStr}`);
    }
    else {
      if (c.faces) {
        around.push(`${side}是空的(有开口朝向【${c.faces}】)${tagStr}${heightStr}`);
      } else {
        around.push(`${side}是空的，可以走${tagStr}${heightStr}`);
      }
    }
  }

  const playerCell = room.cells[py][px];
  const pTagStr = playerCell.tags && playerCell.tags.length > 0 ? `[${playerCell.tags.join(",")}]` : "";
  const pHeightStr = playerCell.height !== undefined ? `[h:${playerCell.height}m]` : "";

  let ctx = `[空间] ${gameState.player.location} ${room.width}×${room.height}格 ${room.cellSize}m/格 F${room.floor} 你在(${px},${py})${pTagStr}${pHeightStr}`;
  const amb = (room as any).ambient;
  if (amb) ctx += ` | 环境: ${[amb.visual, amb.audio].filter(Boolean).join("，")}`;
  
  // 注入远景视野 (Horizon)
  if (room.horizon) {
    const DIR_ENG_TO_CHN: Record<string, string> = {
      "north": "北面", "south": "南面", "east": "东面", "west": "西面",
      "n": "北面", "s": "南面", "e": "东面", "w": "西面"
    };
    const horStrings: string[] = [];
    for (const [dir, text] of Object.entries(room.horizon)) {
      const chnDir = DIR_ENG_TO_CHN[dir.toLowerCase()] || dir;
      horStrings.push(`${chnDir}望去:${text}`);
    }
    if (horStrings.length > 0) ctx += ` | 远景视野: ${horStrings.join("，")}`;
  }

  if (exits.length > 0) ctx += ` | 出口:${exits.join(",")}`;
  if (facingViews.length > 0) ctx += ` | 窗外视野: ${facingViews.join(",")}`;
  if (furniture.length > 0) ctx += ` | 家具:${furniture.join(",")}`;
  ctx += ` | ${around.join("。")}`;
  return ctx;
}

// ── 区域设定自动注入 ──

let _regionContexts: Record<string, { keys: string[]; context: string; social_norms?: string; npc_beauty_ref?: string }> | null = null;

/** 根据玩家位置匹配 region_contexts.json 中的区域设定，自动注入到 prompt */
export function getRegionContext(location: string): string {
  // 懒加载
  if (!_regionContexts) {
    const rcPath = path.resolve(process.cwd(), "data", "region_contexts.json");
    if (fs.existsSync(rcPath)) {
      try { _regionContexts = JSON.parse(fs.readFileSync(rcPath, "utf-8")); }
      catch (_) { _regionContexts = {}; }
    } else {
      _regionContexts = {};
    }
  }

  const matched: string[] = [];
  for (const [region, data] of Object.entries(_regionContexts)) {
    if (!data?.keys) continue;
    for (const key of data.keys) {
      if (location.includes(key)) {
        let ctx = data.context || "";
        if (data.social_norms) ctx += `\n[社交规范] ${data.social_norms}`;
        if (data.npc_beauty_ref) ctx += `\n[NPC美学参考] ${data.npc_beauty_ref}`;
        matched.push(ctx);
        break; // 每个区域只匹配一次
      }
    }
  }
  return matched.join("\n");
}

// --- 偷窃 ---

/** 从 NPC 偷钱 */
export function stealFunds(player: PlayerState, targetName: string): StealResult {
  const npc = getOrCreateNPC(targetName);
  if (npc.funds <= 0) {
    return { success: false, caught: false, narrative: targetName + "身无分文。", roll: { kept: 0, mod: 0, total: 0, dc: 0 } };
  }
  const dex = player.attributes.敏捷 + getEquipmentBonus(player.equipment, "attribute_bonus", "敏捷");
  const stealth = player.skills["潜行"]?.level ?? 0;
  const mod = attrMod(dex) + stealth;
  const d = Math.floor(Math.random() * 20) + 1;
  const dc = 10;
  const total = d + mod;
  const success = d === 20 || total >= dc;
  const caught = d === 1;
  if (success && !caught) {
    const stolen = Math.floor(Math.random() * npc.funds * 0.8) + 1;
    const actual = Math.min(stolen, npc.funds);
    npc.funds -= actual;
    player.funds += actual;
    const currencySymbol = getCurrency();
    return { success: true, caught: false, narrative: "从" + targetName + "身上偷到了" + currencySymbol + actual + "。", roll: { kept: d, mod, total, dc } };
  }
  if (caught) {
    return { success: false, caught: true, narrative: "手被" + targetName + "抓住了。", roll: { kept: d, mod, total, dc } };
  }
  return { success: false, caught: false, narrative: "没能摸到钱包。", roll: { kept: d, mod, total, dc } };
}

export function stealItem(
  player: PlayerState,
  targetName: string,
  itemName: string
): StealResult {
  const npc = getOrCreateNPC(targetName);
  
  // 找物品
  let item: Item | undefined;
  let fromInventory = false;
  
  item = npc.inventory.find(i => i.name === itemName);
  if (item) fromInventory = true;
  else {
    for (const [_, v] of Object.entries(npc.equipment)) {
      if (v && v.name === itemName) { item = v; break; }
    }
  }
  
  if (!item) {
    return { success: false, caught: false, narrative: `${targetName}身上没有${itemName}。`, roll: { kept: 0, mod: 0, total: 0, dc: 0 } };
  }
  
  // 检定
  const dex = player.attributes.敏捷 + getEquipmentBonus(player.equipment, "attribute_bonus", "敏捷");
  const stealth = player.skills["潜行"]?.level ?? 0;
  const mod = attrMod(dex) + stealth;
  const d = Math.floor(Math.random() * 20) + 1;
  const dc = item.weight > 0.5 ? 16 : item.weight > 0.2 ? 12 : 8;
  const total = d + mod;
  const success = d === 20 || total >= dc;
  const caught = d === 1;
  
  if (success && !caught) {
    // 成功：移出NPC，加入玩家
    if (fromInventory) {
      const idx = npc.inventory.findIndex(i => i.name === itemName);
      if (idx >= 0) npc.inventory.splice(idx, 1);
    } else {
      for (const [k, v] of Object.entries(npc.equipment)) {
        if (v && v.name === itemName) { npc.equipment[k] = null; break; }
      }
    }
    player.inventory.push(structuredClone(item!));
    return {
      success: true, item: item!, caught: false,
      narrative: `从${targetName}身上偷到了「${itemName}」。`,
      roll: { kept: d, mod, total, dc },
    };
  }
  
  if (caught) {
    return {
      success: false, caught: true,
      narrative: `手被${targetName}抓住了。`,
      roll: { kept: d, mod, total, dc },
    };
  }
  
  return {
    success: false, caught: false,
    narrative: `没能摸到「${itemName}」——${targetName}动了一下。`,
    roll: { kept: d, mod, total, dc },
  };
}

export function damageItem(item: Item): Item {
  if (item.state === "ruined") return item;
  if (item.state === "damaged") {
    item.state = "ruined";
    item.effects = [];  // 毁坏后无效果
  } else {
    item.state = "damaged";
    // 效果减半
    for (const eff of item.effects) {
      if (typeof eff.value === "number") eff.value = Math.floor(eff.value / 2);
    }
  }
  return item;
}

// --- 死亡豁免 ---
export function deathSave(): { success: boolean; stable: boolean } {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { success: roll >= 10, stable: roll === 20 };
}

// --- Layer 1 开关 ---
export function toggleLayer1(state: GameState): boolean {
  state.layer1Enabled = !state.layer1Enabled;
  return state.layer1Enabled;
}

// --- 全状态快照（给 /status /look 用） ---
export function getStateSnapshot(state: GameState): GameState {
  return structuredClone(state);
}

// --- 无名路人生成逻辑 (TUI / LLM 共用) ---
export interface NamelessNPC {
  name: string;
  act: string;
  height: string;
  gridPos: [number, number];
}

export function getNamelessNPCs(loc: string, turn: number): NamelessNPC[] {
  const publicRooms = namelessNpcTemplates.public_rooms;
  const isPublic = publicRooms.some(pr => isSameLocation(loc, pr)) || loc.includes("街") || loc.includes("公园") || loc.includes("站");
  if (!isPublic) return [];

  const rKey = getRoomKey(loc);
  const room = rKey ? ROOMS[rKey] : null;
  const seed = turn + loc.length;
  const count = 1 + (seed % 3); // 1 to 3 nameless NPCs
  const traits = namelessNpcTemplates.traits;
  
  const npcs: NamelessNPC[] = [];
  for (let i = 0; i < count; i++) {
    const item = traits[(seed + i * 7) % traits.length];
    let nx = 2 + ((seed + i * 13) % (room?.width ? Math.max(1, room.width - 4) : 4));
    let ny = 2 + ((seed + i * 17) % (room?.height ? Math.max(1, room.height - 4) : 4));
    npcs.push({
      name: item.name,
      act: item.act,
      height: item.height,
      gridPos: [nx, ny]
    });
  }
  return npcs;
}

// ── 世界状态冻结与热挂载 ──
export function freezeWorldState(worldName: string): void {
  const npcsSnapshot = structuredClone(gameState.npcs);
  const roomDeltasSnapshot = structuredClone(ROOMS);
  const locationsDeltaSnapshot = structuredClone(LOCATIONS_DELTA);
  const knownLocationsSnapshot = structuredClone(gameState.player.known_locations);

  let snsFeedSnapshot: any[] = [];
  const phone = gameState.player.inventory.find(i => i.phoneData !== undefined)
    || Object.values(gameState.player.equipment).find(item => item && item.phoneData !== undefined);
  if (phone && phone.phoneData) {
    snsFeedSnapshot = structuredClone(phone.phoneData.snsPosts || []);
  }

  gameState.world_states[worldName] = {
    npcs: npcsSnapshot,
    room_deltas: roomDeltasSnapshot,
    dynamic_locations: locationsDeltaSnapshot,
    known_locations: knownLocationsSnapshot,
    sns_feed: snsFeedSnapshot,
  };
}

export function switchActiveWorld(targetWorld: string): void {
  const oldWorld = gameState.activeWorld || "oregairu";
  if (oldWorld === targetWorld) return;

  freezeWorldState(oldWorld);

  gameState.activeWorld = targetWorld;
  loadActiveWorld(targetWorld);

  const snapshot = gameState.world_states[targetWorld];
  if (snapshot) {
    gameState.npcs = structuredClone(snapshot.npcs);
    ROOMS = structuredClone(snapshot.room_deltas);
    LOCATIONS_DELTA = structuredClone(snapshot.dynamic_locations);
    gameState.player.known_locations = structuredClone(snapshot.known_locations || []);

    const phone = gameState.player.inventory.find(i => i.phoneData !== undefined)
      || Object.values(gameState.player.equipment).find(item => item && item.phoneData !== undefined);
    if (phone && phone.phoneData) {
      phone.phoneData.snsPosts = structuredClone(snapshot.sns_feed || []);
    }
  } else {
    gameState.npcs = {};
    ROOMS = structuredClone(rooms);
    LOCATIONS_DELTA = {};
    gameState.player.known_locations = [];

    const phone = gameState.player.inventory.find(i => i.phoneData !== undefined)
      || Object.values(gameState.player.equipment).find(item => item && item.phoneData !== undefined);
    if (phone && phone.phoneData) {
      phone.phoneData.snsPosts = [];
    }
  }
}
// ── 动态世界观加载 ──
export function loadActiveWorld(worldName?: string): void {
  try {
    const activeWorldPath = path.resolve(process.cwd(), "data", ".active_world");
    let world = worldName;
    if (!world && fs.existsSync(activeWorldPath)) {
      world = fs.readFileSync(activeWorldPath, "utf-8").trim();
    }
    if (!world) world = "oregairu"; // default fallback
    activeWorldName = world;
    gameState.activeWorld = world;

    const worldpackDir = path.resolve(process.cwd(), "worldpacks", world);
    if (!fs.existsSync(worldpackDir)) {
      return;
    }

    const loadJSON = (filename: string, fallback: any) => {
      const fullPath = path.join(worldpackDir, filename);
      if (fs.existsSync(fullPath)) {
        try {
          return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        } catch (e) {
          console.error(`Failed to load worldpack JSON: ${fullPath}`, e);
        }
      }
      return fallback;
    };

    characters = loadJSON("characters.json", charactersStatic);
    rooms = loadJSON("rooms.json", roomsStatic);
    charStages = loadJSON("character_stages.json", charStagesStatic);
    titleRules = loadJSON("title_rules.json", titleRulesStatic);
    namelessNpcTemplates = loadJSON("nameless_npc_templates.json", namelessNpcTemplatesStatic);
    economyConfig = loadJSON("economy.json", economyConfigStatic);
    locationsData = loadJSON("locations.json", locationsDataStatic);
    schoolMapData = loadJSON("school_map.json", schoolMapDataStatic);
    cityMapData = loadJSON("city_map.json", cityMapDataStatic);
    regionsData = loadJSON("regions.json", regionsDataStatic);
    regions = regionsData;
    itemsCatalog = loadJSON("items.json", itemsCatalogStatic);
    shopsCatalog = loadJSON("shops.json", shopsCatalogStatic);
    shops = shopsCatalog;
    positionsCatalog = loadJSON("positions.json", positionsCatalogStatic);
    positions = positionsCatalog;
    phoneAppsCatalog = loadJSON("phone_apps.json", phoneAppsCatalogStatic);
    phoneApps = phoneAppsCatalog;
    scheduleTemplates = loadJSON("schedule_templates.json", scheduleTemplatesStatic);
    roomTemplates = loadJSON("room_templates.json", roomTemplatesStatic);
    sexProfilesData = loadJSON("sex_profiles.json", sexProfilesStatic);

    // Re-initialize dependent variables
    ROOMS = structuredClone(rooms);
    LOCATIONS_BASE = locationsData as any;
    SCHOOL_MAP = schoolMapData as any;
    CITY_MAP = cityMapData as any;
    PRICE_RANGE = economyConfig.price_ranges as Record<string, [number, number]>;

    // Dynamically update router.ts and sex.ts modules
    import("./router.js").then(routerModule => {
      routerModule.updateRouterData(regions, characters, schoolMapData, cityMapData);
    }).catch(() => {
      import("./router.ts").then(routerModule => {
        routerModule.updateRouterData(regions, characters, schoolMapData, cityMapData);
      }).catch(() => {});
    });

    import("./sex.js").then(sexModule => {
      sexModule.setSexProfiles(sexProfilesData);
    }).catch(() => {
      import("./sex.ts").then(sexModule => {
        sexModule.setSexProfiles(sexProfilesData);
      }).catch(() => {});
    });

    import("./timeline.js").then(timelineModule => {
      timelineModule.clearCalendarCache();
    }).catch(() => {
      import("./timeline.ts").then(timelineModule => {
        timelineModule.clearCalendarCache();
      }).catch(() => {});
    });
  } catch (e) {
    console.error("Failed to load active world:", e);
    if (worldName !== "oregairu") {
      console.warn("Falling back to load 'oregairu' worldpack...");
      try {
        loadActiveWorld("oregairu");
      } catch (fallbackError) {
        console.error("Critical: Failed to load fallback worldpack 'oregairu':", fallbackError);
      }
    }
  }
}
try {
  loadActiveWorld();
} catch (e) {
  console.error("Failed to execute loadActiveWorld at startup:", e);
}
