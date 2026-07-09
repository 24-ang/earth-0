/**
 * 状态引擎 - 角色状态 + HP + 负重 + 物品操作 + 持久化
 */

import type { PlayerState, GameState, EquipmentSlots, Item, Wound, Relationship, AttrKey, NPCRuntimeState, StealResult, Skill, StaticCharacter, RoomGrid, SexState, TurnLogEntry, RevealEntry, RevealVisibilityLevel, ContainerState, ContainerDef, CharacterFact, TempNPCState } from "./types.ts";
import { promptCollectors, schedule, type Collector } from "./collectors.ts";
import { INITIAL_TIME_STATE } from "./time.ts";
import charactersStatic from "../data/characters.json" with { type: "json" };
import roomsStatic from "../data/rooms.json" with { type: "json" };
import { lookupRegion, setAcademicYearOffset } from "./router.ts";
import charStagesStatic from "../data/character_stages.json" with { type: "json" };
import { validateCharacters as validateCharactersFn } from "./validate-characters.ts";
import fs from "node:fs";
import path from "node:path";
import titleRulesStatic from "../data/title_rules.json" with { type: "json" };
import namelessNpcTemplatesStatic from "../data/nameless_npc_templates.json" with { type: "json" };
import economyConfigStatic from "../data/economy.json" with { type: "json" };
import { getSeason, mapChineseWeather, transitionWeather } from "./weather.ts";
import { attrMod } from "./dice.ts";
import { findFurnitureDef } from "./furniture.ts";

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
import scheduleTemplatesStatic from "../data/schedule_templates.json" with { type: "json" };
import roomTemplatesStatic from "../data/room_templates.json" with { type: "json" };
import residenceTemplatesStatic from "../data/residence_templates.json" with { type: "json" };

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
export let residenceTemplates = residenceTemplatesStatic as any;
export let activeWorldName = "oregairu";


// --- 空间数据定义 ---
export let ROOMS = structuredClone(rooms);

/** 原地更新 ROOMS（不替换引用）。CJS import 是值拷贝，替换引用会让
 *  state-grid.ts 等持有旧引用 → saveState 写错数据、动态房间丢失。 */
function updateROOMSInPlace(src: Record<string, any>) {
  for (const key of Object.keys(ROOMS)) { delete (ROOMS as any)[key]; }
  Object.assign(ROOMS, src);
}

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
  const cleanName = normalizeLocationName(roomName);
  if (ROOMS[cleanName]) return cleanName;
  for (const key of Object.keys(ROOMS)) {
    const cleanKey = normalizeLocationName(key);
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
  
  const c1 = normalizeLocationName(loc1);
  const c2 = normalizeLocationName(loc2);
  if (c1 === c2) return true;

  // 同址判定：两地点共享 fromorg 的 location_contains 值
  // （从 worldpacks/{w}/orgs/ 读取，无需硬编码地点名）
  if (!_orgCache) {
    _orgCache = {};
    const dirs = [path.resolve(process.cwd(), "worldpacks", activeWorldName, "orgs"), path.resolve(process.cwd(), "data", "orgs")];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith("_")) continue;
        try { const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")); for (const e of (Array.isArray(arr)?arr:[arr])) { const orgName = e.org || e.name; if (orgName) _orgCache[orgName] = e; } } catch (_) {}
      }
    }
  }
  if (_orgCache) {
    for (const orgData of Object.values(_orgCache)) {
      const lc = (orgData as any).match_rules?.location_contains;
      if (lc && c1.includes(lc) && c2.includes(lc)) return true;
    }
  }
  return false;
}

// 组织 match_rules 缓存（isSameLocation + npcBelongsToOrg 共享，懒加载）
let _orgCache: Record<string, any> | null = null;

// --- 模块级游戏状态（单例，整个 session 一份） ---
export let STATE_DIR = path.resolve(process.cwd(), "state");
export let STATE_FILE = path.join(STATE_DIR, "session.json");
export let TURN_BACKUP_DIR = path.join(STATE_DIR, "turn_backups");
export let SAVES_DIR = path.join(STATE_DIR, "saves");

function checkStatePaths() {
  const targetDir = process.env.NODE_ENV === "test"
    ? path.resolve(process.cwd(), "state_test")
    : path.resolve(process.cwd(), "state");
  if (STATE_DIR !== targetDir) {
    STATE_DIR = targetDir;
    STATE_FILE = path.join(STATE_DIR, "session.json");
    TURN_BACKUP_DIR = path.join(STATE_DIR, "turn_backups");
    SAVES_DIR = path.join(STATE_DIR, "saves");
  }
}
const MAX_BACKUPS = 5;
const AGENTS_DIR = path.resolve(process.cwd(), "agents");

/** 加载 worldpack 目录中的 JSON 文件（每个文件一个 entry），合并为 Record。无目录则回退读平面文件 */
function loadWorldpackDirRecursive(dirName: string, flatFileName: string): Record<string, any> {
  const result: Record<string, any> = {};
  // 1. 优先扫 worldpacks/{world}/{dirName}/ 目录
  const wpDir = path.resolve(process.cwd(), "worldpacks", activeWorldName, dirName);
  let loaded = false;
  if (fs.existsSync(wpDir)) {
    for (const f of fs.readdirSync(wpDir)) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(wpDir, f), "utf-8"));
        Object.assign(result, data);
        loaded = true;
      } catch (e) { console.error(`loadWorldpackDirRecursive: 解析 ${dirName}/${f} 失败`, e); }
    }
  }
  if (loaded) return result;
  // 2. 回退：读 worldpacks/{world}/{flatFileName}
  const wpFlat = path.resolve(process.cwd(), "worldpacks", activeWorldName, flatFileName);
  if (fs.existsSync(wpFlat)) {
    try { return JSON.parse(fs.readFileSync(wpFlat, "utf-8")); }
    catch (e) { console.error(`loadWorldpackDirRecursive: 解析 worldpack ${flatFileName} 失败`, e); }
  }
  // 3. 最终兜底：data/{flatFileName}
  const dataFlat = path.resolve(process.cwd(), "data", flatFileName);
  if (fs.existsSync(dataFlat)) {
    try { return JSON.parse(fs.readFileSync(dataFlat, "utf-8")); }
    catch (e) { console.error(`loadWorldpackDirRecursive: 解析 data/${flatFileName} 失败`, e); }
  }
  return result;
}

/** 加载 worldpacks/{world}/characters/ 目录（每文件一个角色对象）→ 数组。
 *  无目录/空 → 返回 null（调用方回退旧平面 characters.json）。 */
function loadCharactersFromDir(): any[] | null {
  const dir = path.resolve(process.cwd(), "worldpacks", activeWorldName, "characters");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  if (!files.length) return null;
  const arr: any[] = [];
  for (const f of files) {
    try { arr.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))); }
    catch (e) { console.error(`loadCharactersFromDir: 解析 characters/${f} 失败`, e); }
  }
  return arr.length ? arr : null;
}

/** 从角色对象投影 charStages（stages/stages_if 已内联进单角色文件）。空 → 调用方回退旧文件。 */
function deriveCharStages(chars: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of chars) {
    if (c?.stages) out[c.name] = c.stages;
    if (c?.stages_if) out[c.name + "_if"] = c.stages_if;
  }
  return out;
}

export let gameState: GameState = createInitialState();

function createInitialState(): GameState {
  // 加载世界级秘密 — 优先扫 worldpacks/{w}/secrets/ 目录，回退平面文件
  let initRevealLog: RevealEntry[] = [];
  const ws = loadWorldpackDirRecursive("secrets", "world_secrets.json");
  for (const [_, sec] of Object.entries(ws)) {
    const s = sec as any;
    initRevealLog.push({
      id: s.id,
      content: s.content,
      fromLevel: s.fromLevel || "hidden",
      toLevel: s.toLevel || "protagonist_known",
      revealedAt: INITIAL_TIME_STATE.game_date,
      turn: 0
    });
  }

  // 加载大势默认天空盒 — 扫 locations/ 目录
  let defaultWorldState: WorldState = {
    tech: 0,
    stability: 0,
    tension: 0,
    prosperity: 0,
    regime: "未知体制",
    economy_type: "未知经济型",
    diplomacy_stance: "未知外交立场",
    globalFlags: {}
  };
  
  try {
    const locs = loadWorldpackDirRecursive("locations", "region_contexts.json");
    const countryData = locs["日本"] || locs["japan"] || Object.values(locs).find(l => (l as any).skybox_defaults);
    if (countryData && countryData.skybox_defaults) {
      defaultWorldState = {
        ...defaultWorldState,
        ...countryData.skybox_defaults
      };
    }
  } catch (e) {
    console.error("createInitialState: failed to load skybox defaults from locations", e);
  }

  return {
    time: { ...INITIAL_TIME_STATE },
    player: createDefaultPlayer(),
    npcs: {},
    sexStates: {},
    mode: "rpg",
    activeWorld: "oregairu",
    layer1Enabled: false,
    auMode: false,
    flags: {},
    weather: { type: "晴", temp: 16 },
    turn: 0,
    roomTimestamps: {},
    turnLog: [],
    storySoFar: "",
    revealLog: initRevealLog,
    calendarEvents: [],
    dynamicEvents: [],
    academic_year_offset: 0,
    world_states: {},
    completed_events: [],
    quests: {},
    worldState: defaultWorldState,
    schemaVersion: 1,
    interactionMode: "novel",
    turnsSinceLastNPCInteraction: 2,
    turnsInConversation: 0,
    _toolsLocked: false,
    _cutaway_queue: [],
    _cutaway_cooldown: 0,
    _npc_last_responses: {},
  };
}

// ── 本轮工具调用追踪 ──
const _turnToolCalls: string[] = [];

// ── 本轮换装追踪（Phase 2 NPC Agent 注入后由 extension.ts 清空）──
const _outfitChanges: Array<{npc: string, from: string, to: string, desc: string}> = [];
export function getOutfitChangesThisTurn() { return [..._outfitChanges]; }
export function clearOutfitChangesThisTurn() { _outfitChanges.length = 0; }

/** 记录一个工具被调用（由 registry wrapper 自动调用） */
export function pushToolCall(name: string): void {
  if (!_turnToolCalls.includes(name)) {
    _turnToolCalls.push(name);
  }
}

/** 取出并清空本轮工具调用列表 */
export function drainToolCalls(): string[] {
  const names = [..._turnToolCalls];
  _turnToolCalls.length = 0;
  return names;
}

// ── Layer 2 回合台账 ──
export function recordTurnLog(entry: Omit<TurnLogEntry, "turn" | "timestamp">): TurnLogEntry {
  let resolvedChanges = entry.resolvedChanges;
  if (gameState.lastReviewFindings && gameState.lastReviewFindings.length > 0) {
    resolvedChanges = resolvedChanges + "\n[复盘警报]\n" + gameState.lastReviewFindings.map(f => `- ${f}`).join("\n");
  }

  const toolsCalled = (entry.toolsCalled && entry.toolsCalled.length > 0)
    ? entry.toolsCalled
    : (gameState._lastTurnToolsCalled || []);

  const log: TurnLogEntry = {
    ...entry,
    resolvedChanges,
    toolsCalled,
    turn: gameState.turn,
    timestamp: gameState.time.game_date + " " + (gameState.time.time_of_day ?? ""),
  };
  gameState.turnLog.push(log);
  // P1: 位置守恒量 lint — 检测 GM 叙事声称位置变化但引擎未记录
  gameState._locationMismatchWarning = null;
  const locKeywords = /到达|前往|进入|离开|来到|走到|回到|抵达|出发|步行至|乘车至|回家|去学校|去操场|去教室|回房|出门/;
  const locTools = ["travel_intercity", "complete_travel", "move", "move_to", "board_train", "go_to_location"];
  // 扫描三个字段：动作描述 / 变化声明 / 场景结果
  const locCheckText = [entry.playerAction, resolvedChanges, entry.sceneResult].join(" ");
  if (locKeywords.test(locCheckText)) {
    const hasLocTool = toolsCalled.some(t => locTools.includes(t));
    if (!hasLocTool) {
      const excerpt = locCheckText.length > 80 ? locCheckText.slice(0, 80) + "…" : locCheckText;
      gameState._locationMismatchWarning = `上轮台账提到位置变化（"${excerpt}"）但未调用任何移动工具。引擎实际位置仍是 ${gameState.player.location}。跨地点请用 go_to_location（同城）或 travel_intercity（跨城），到达后调 complete_travel 收口。`;
    }
  }
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
export function revealSecret(id: string, content: string, fromLevel: RevealVisibilityLevel, toLevel: RevealVisibilityLevel): RevealEntry {
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
const VISIBILITY_RANK: Record<RevealVisibilityLevel, number> = {
  "hidden_canonical": 0,
  "protagonist_known": 1,
  "player_known": 2,
  "scene_public": 3,
};

export function getRevealedSecrets(minLevel: RevealVisibilityLevel): RevealEntry[] {
  const minRank = VISIBILITY_RANK[minLevel];
  return gameState.revealLog.filter(e => VISIBILITY_RANK[e.toLevel] >= minRank);
}

function createDefaultPlayer(): PlayerState {
  return {
    name: "维",
    gender: "男",
    age: 16,
    location: "千葉駅前",
    body: {
      height_cm: 170, weight_kg: 58, build: "标准", leg_type: "修长",
      skin: { base_tone: "普通", tan: 0, texture: "普通" },
    },
    attributes: { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10, 幸运: 10 },
    skills: {},
    abilities: {},
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
    known_locations: ["千葉駅前"],
    titles: [],
    properties: {},
    social_class: "小资产阶级",
    memberships: [],
    personal_axes: { "经济立场": 0, "政治立场": 0 },
  };
}

// --- 持久化 ---
/** 原子写入：先写 .tmp，再 rename（M1 fix） */
function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp";
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, filepath);
  } catch (_) {
    // rename 跨卷可能失败 → copy+delete 兜底
    fs.copyFileSync(tmp, filepath);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

export function saveState(filepath?: string): void {
  checkStatePaths();
  let fp = filepath ?? STATE_FILE;
  let isTheater = false;
  if (gameState._theaterActive && !filepath) {
    fp = path.join(STATE_DIR, "theater_session.json");
    isTheater = true;
  }
  const targetDir = path.dirname(fp);
  fs.mkdirSync(targetDir, { recursive: true });

  // 房间修改也持久化，保存到 session 目录下的 rooms_delta.json，而不覆写 data/rooms.json
  const roomsDeltaPath = isTheater ? path.join(targetDir, "theater_rooms_delta.json") : path.join(targetDir, "rooms_delta.json");
  atomicWrite(roomsDeltaPath, JSON.stringify(ROOMS, null, 2));

  // 动态角色持久化
  const dcPath = isTheater ? path.join(targetDir, "theater_dynamic_characters.json") : path.join(targetDir, "dynamic_characters.json");
  atomicWrite(dcPath, JSON.stringify(DYNAMIC_CHARACTERS, null, 2));

  // 动态地点持久化
  const deltaPath = isTheater ? path.join(targetDir, "theater_locations_delta.json") : path.join(targetDir, "locations_delta.json");
  atomicWrite(deltaPath, JSON.stringify(LOCATIONS_DELTA, null, 2));

  // 家具容器持久化
  const fcPath = isTheater ? path.join(targetDir, "theater_furniture_containers.json") : path.join(targetDir, "furniture_containers.json");
  atomicWrite(fcPath, JSON.stringify(_furnitureContainerStore, null, 2));

  atomicWrite(fp, JSON.stringify(gameState, null, 2));
}

export function loadState(filepath?: string): boolean {
  checkStatePaths();
  let fp = filepath ?? STATE_FILE;
  let isTheater = false;
  if (!filepath) {
    const theaterPath = path.join(STATE_DIR, "theater_session.json");
    if (fs.existsSync(theaterPath)) {
      fp = theaterPath;
      isTheater = true;
    }
  }
  if (!fs.existsSync(fp)) return false;
  const targetDir = path.dirname(fp);
  const raw = fs.readFileSync(fp, "utf-8");
  // 原地更新，不替换引用：CJS 模块（state-grid.ts/phone.ts）的 import 是值拷贝，
  // 替换 gameState 会导致它们持有旧对象引用 → 所有读写打到不同的 gameState
  const parsed = JSON.parse(raw) as GameState;
  for (const key of Object.keys(gameState)) { delete (gameState as any)[key]; }
  Object.assign(gameState, parsed);
  // 清理旧版 bug 写入 npcs 的玩家幽灵条目
  if (gameState.npcs && gameState.npcs[gameState.player?.name]) {
    console.error(`loadState: 清理 npcs 中的玩家幽灵 "${gameState.player.name}"`);
    delete gameState.npcs[gameState.player.name];
  }
  setAcademicYearOffset(gameState.academic_year_offset ?? 0);
  // 迁移老存档 NPC funds→cash+wealth（现金 vs 财产拆分）
  for (const [_, npc] of Object.entries(gameState.npcs || {})) {
    const n = npc as any;
    if (n.funds !== undefined && n.cash === undefined) {
      n.cash = Math.min(5000, Math.floor(n.funds * 0.15));
      n.wealth = n.funds;
      delete n.funds;
    }
  }
  gameState._toolsLocked = false; // 绝不让存档中的锁标志复活
  if (gameState.player && gameState.player.attributes) {
    gameState.player.attributes.幸运 ??= 10;
  }

  gameState.worldState ??= { tech: 0, stability: 0, tension: 0, globalFlags: {} };
  Object.assign(gameState.worldState, {
    tech: gameState.worldState.tech ?? 0,
    stability: gameState.worldState.stability ?? 0,
    tension: gameState.worldState.tension ?? 0,
    globalFlags: gameState.worldState.globalFlags ?? {}
  });

  // 读取 rooms_delta.json 并覆盖 ROOMS（原地更新，不替换引用）
  function updateROOMS(newRooms: any) {
    for (const key of Object.keys(ROOMS)) { delete (ROOMS as any)[key]; }
    Object.assign(ROOMS, newRooms);
  }
  const roomsDeltaName = isTheater ? "theater_rooms_delta.json" : "rooms_delta.json";
  const roomsDeltaPath = path.join(targetDir, roomsDeltaName);
  if (fs.existsSync(roomsDeltaPath)) {
    try {
      updateROOMS(JSON.parse(fs.readFileSync(roomsDeltaPath, "utf-8")));
    } catch (e) {
      console.error(`loadState: 解析 ${roomsDeltaName} 失败，回退到静态rooms`, e);
      updateROOMS(rooms);
    }
  } else {
    updateROOMS(rooms);
  }

  // 恢复动态地点
  const locationsDeltaName = isTheater ? "theater_locations_delta.json" : "locations_delta.json";
  const locationsDeltaPath = path.join(targetDir, locationsDeltaName);
  if (fs.existsSync(locationsDeltaPath)) {
    try {
      const parsedLocs = JSON.parse(fs.readFileSync(locationsDeltaPath, "utf-8"));
      for (const key of Object.keys(LOCATIONS_DELTA)) delete LOCATIONS_DELTA[key];
      Object.assign(LOCATIONS_DELTA, parsedLocs);
    } catch (e) {
      console.error(`Failed to parse ${locationsDeltaName}:`, e);
      for (const key of Object.keys(LOCATIONS_DELTA)) delete LOCATIONS_DELTA[key];
    }
  } else {
    for (const key of Object.keys(LOCATIONS_DELTA)) delete LOCATIONS_DELTA[key];
  }

  // 恢复动态角色
  const dcName = isTheater ? "theater_dynamic_characters.json" : "dynamic_characters.json";
  const dcPath = path.join(targetDir, dcName);
  if (fs.existsSync(dcPath)) {
    try {
      DYNAMIC_CHARACTERS = JSON.parse(fs.readFileSync(dcPath, "utf-8"));
    } catch (e) {
      console.error(`Failed to parse ${dcName}:`, e);
      DYNAMIC_CHARACTERS = {};
    }
  } else {
    DYNAMIC_CHARACTERS = {};
  }
  // 恢复家具容器
  const fcName = isTheater ? "theater_furniture_containers.json" : "furniture_containers.json";
  const fcPath = path.join(targetDir, fcName);
  if (fs.existsSync(fcPath)) {
    try {
      Object.assign(_furnitureContainerStore, JSON.parse(fs.readFileSync(fcPath, "utf-8")));
    } catch (e) { console.error(`loadState: 解析 ${fcName} 失败`, e); }
  }
  // 存档版本迁移——旧档无 schemaVersion 视为 v0，按版本增量跑迁移
  const currentSchemaVersion = 1;
  const loadedVersion = gameState.schemaVersion ?? 0;

  // 还原 player.sex 引用（每次加载都跑，不是迁移）
  if (gameState.player.sex && gameState.sexStates) {
    const partnerName = (gameState.player.sex.profile as any).name;
    if (partnerName && gameState.sexStates[partnerName]) {
      gameState.player.sex = gameState.sexStates[partnerName];
    }
  }

  if (loadedVersion < 1) {
    // ── v0 → v1 迁移：旧存档缺失字段补齐 ──
    if (!gameState.roomTimestamps) gameState.roomTimestamps = {};
    if (!gameState.world_states) gameState.world_states = {};
    if (!gameState.player.properties) gameState.player.properties = {};

    // 旧存档 sexStates 中 null 数值字段 → 初始化为 0
    if (gameState.sexStates) {
      for (const ss of Object.values(gameState.sexStates)) {
        if (ss.arousal == null) ss.arousal = 0;
        if (ss.desire == null) ss.desire = ss.profile.baselineDesire;
        if (ss.climaxCount == null) ss.climaxCount = 0;
        if (ss.squirtCount == null) ss.squirtCount = 0;
        if (ss.climaxed == null) ss.climaxed = false;
        if (!ss.thoughts) ss.thoughts = [];
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

    // 旧存档 player.age 与 time.player_age 不同步 → 用 time 覆盖 player
    if (gameState.time?.player_age && gameState.player.age !== gameState.time.player_age) {
      gameState.player.age = gameState.time.player_age;
    }
    // 旧 bug 存档（timeline_origin.age === 0 → NPC 年龄偏移 16 岁）
    if (gameState.time?.timeline_origin && gameState.time.timeline_origin.age === 0) {
      gameState.time.timeline_origin.age = gameState.time.player_age;
      gameState.time.timeline_origin.year = Number(gameState.time.game_date.split("-")[0]);
    }

    // 旧存档 npcs 属性/技能/生命值/存活状态补齐
    if (gameState.npcs) {
      for (const [name, npc] of Object.entries(gameState.npcs)) {
        const src = findCharacter(name);
        const defaultAttrs: Attributes = { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10 };

        npc.attributes ??= { ...defaultAttrs };
        for (const key of Object.keys(defaultAttrs) as (keyof Attributes)[]) {
          if (npc.attributes[key] === undefined || typeof npc.attributes[key] !== "number") {
            npc.attributes[key] = src?.attributes?.[key] ?? defaultAttrs[key];
          }
        }

        if (!npc.hp) {
          const npcAge = src ? getNpcCurrentAge(src.base_age || 16) : 16;
          const maxHP = src?.hp?.max ?? calcMaxHP(npc.attributes.体质, npcAge);
          const currentHP = src?.hp?.current ?? maxHP;
          npc.hp = { current: currentHP, max: maxHP };
        }
        if (npc.alive === undefined) npc.alive = true;

        if (!npc.skills || typeof npc.skills !== "object") npc.skills = {};
        for (const [sName, sVal] of Object.entries(npc.skills) as any) {
          if (typeof sVal === "number") {
            npc.skills[sName] = { level: sVal, exp: 0, nextLevel: sVal * 10 };
          } else if (!sVal || typeof sVal.level !== "number") {
            const defaultLevel = src?.skills?.[sName] ?? 1;
            npc.skills[sName] = { level: defaultLevel, exp: 0, nextLevel: defaultLevel * 10 };
          }
        }
        if (src && src.skills) {
          for (const [sName, sLevel] of Object.entries(src.skills)) {
            if (!npc.skills[sName]) {
              npc.skills[sName] = { level: sLevel as number, exp: 0, nextLevel: (sLevel as number) * 10 };
            }
          }
        }

        if (!npc.abilities || typeof npc.abilities !== "object") npc.abilities = {};
      }
    }
  }

  // 补齐视角系统新字段的向下兼容默认值
  gameState.interactionMode ??= "turn_based";
  gameState.turnsSinceLastNPCInteraction ??= 0;
  gameState.turnsInConversation ??= 0;
  gameState._cutaway_queue ??= [];
  gameState._cutaway_cooldown ??= 0;
  gameState._npc_last_responses ??= {};

  // 写回最新版本号
  gameState.schemaVersion = currentSchemaVersion;

  // 加载后重建空间状态（仅 gridPos 为 null 时初始化，防止覆盖已持久化的位置）
  if (gameState.player?.location && !gameState.player.gridPos) {
    try {
      initPlayerGrid();
    } catch {}
  }

  // 旧档兜底：organizations 缺失或为空 → 从 worldpack 文件重新加载
  if (!gameState.organizations || Object.keys(gameState.organizations).length === 0) {
    gameState.organizations ??= {};
    const orgsDir = path.resolve(process.cwd(), "worldpacks", gameState.activeWorld || "oregairu", "orgs");
    if (fs.existsSync(orgsDir)) {
      for (const f of fs.readdirSync(orgsDir)) {
        if (!f.endsWith(".json") || f.startsWith("_")) continue;
        try {
          const arr = JSON.parse(fs.readFileSync(path.join(orgsDir, f), "utf-8"));
          for (const item of (Array.isArray(arr) ? arr : [arr])) {
            const orgId = item.id || item.org;
            if (!orgId) continue;
            gameState.organizations[orgId] = {
              id: orgId,
              name: item.name || item.org || orgId,
              type: item.type || "学校",
              scale: item.scale || "local",
              sector: item.sector || "social",
              parent_org: item.parent_org,
              wealth: item.wealth ?? 50,
              influence: item.influence ?? 50,
              cohesion: item.cohesion ?? 50,
              public_legitimacy: item.public_legitimacy ?? 50,
              coreLocation: item.coreLocation || "",
              territoryRoomKeys: item.territoryRoomKeys || [],
              class_base: item.class_base || {},
              organizationalAxes: item.organizationalAxes || { "经济立场": 0, "政治立场": 0 },
              goals: item.goals || { macroGoal: "", currentPhaseGoal: "" },
              leader: item.leader || "",
              members: item.members || [],
              relations: item.relations || {},
              match_rules: item.match_rules || {},
              entries: item.entries || [],
            };
          }
        } catch (e) { console.error(`loadState: 解析 org ${f} 失败`, e); }
      }
    }
  }

  return true;
}

// ── 手动存档槽位 + 回合自动备份 ──

/** 创建手动存档 */
export function createSave(name: string): string {
  checkStatePaths();
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
  checkStatePaths();
  const safeName = name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 50);
  const fp = path.join(SAVES_DIR, `${safeName}.json`);
  if (!fs.existsSync(fp)) return false;
  const ok = loadState(fp);
  if (ok) { backupBeforeTurn(); saveState(); }
  return ok;
}

/** 删除手动存档 */
export function deleteSave(name: string): boolean {
  checkStatePaths();
  const safeName = name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 50);
  const fp = path.join(SAVES_DIR, `${safeName}.json`);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

/** 列出所有手动存档 */
export function listSaves(): { name: string; date: string; turn: number; location: string }[] {
  checkStatePaths();
  const result: { name: string; date: string; turn: number; location: string }[] = [];
  if (!fs.existsSync(SAVES_DIR)) return result;
  for (const f of fs.readdirSync(SAVES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(SAVES_DIR, f), "utf-8");
      const meta = JSON.parse(raw)._save_meta;
      if (meta) result.push(meta);
    } catch (e) { console.error("listSaves: 解析存档元数据失败", e); }
  }
  result.sort((a, b) => b.turn - a.turn);
  return result;
}

/** 备份当前存档（commit_turn 前自动调用），滚动保留最近 N 个 */
export function backupBeforeTurn(): void {
  checkStatePaths();
  fs.mkdirSync(TURN_BACKUP_DIR, { recursive: true });
  // M2 fix: 每个 turn 用子目录存全部 5 个文件（session.json + 4 delta）
  for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
    const older = path.join(TURN_BACKUP_DIR, `turn_${i}`);
    const newer = path.join(TURN_BACKUP_DIR, `turn_${i + 1}`);
    if (fs.existsSync(older)) {
      try {
        if (fs.existsSync(newer)) { fs.rmSync(newer, { recursive: true, force: true }); }
        fs.renameSync(older, newer);
      } catch (_) {
        try {
          fs.cpSync(older, newer, { recursive: true });
          fs.rmSync(older, { recursive: true, force: true });
        } catch (_) {}
      }
    }
  }
  saveState(path.join(TURN_BACKUP_DIR, "turn_1", "session.json"));
}

/** 还原到倒数第 N 回合的存档（1=上一回合） */
export function restoreLastTurn(n: number = 1): boolean {
  checkStatePaths();
  const safeN = Math.max(1, Math.min(n, MAX_BACKUPS));
  const fp = path.join(TURN_BACKUP_DIR, `turn_${safeN}`, "session.json");
  if (!fs.existsSync(fp)) return false;
  return loadState(fp);
}

/** 列出可用的备份 */
export function listBackups(): number[] {
  checkStatePaths();
  const result: number[] = [];
  for (let i = 1; i <= MAX_BACKUPS; i++) {
    if (fs.existsSync(path.join(TURN_BACKUP_DIR, `turn_${i}`, "session.json"))) result.push(i);
  }
  return result;
}

export function resetState(): void {
  checkStatePaths();
  // 原地更新，不替换引用（原因同 loadState）
  const fresh = createInitialState();
  for (const key of Object.keys(gameState)) { delete (gameState as any)[key]; }
  Object.assign(gameState, fresh);
  updateROOMSInPlace(rooms);
  // 删除默认 session 对应的 rooms_delta.json
  const roomsDeltaPath = path.join(STATE_DIR, "rooms_delta.json");
  if (fs.existsSync(roomsDeltaPath)) {
    try { fs.unlinkSync(roomsDeltaPath); } catch (_) {}
  }
  // 删除 theater_session.json 和 theater_rooms_delta.json
  const theaterPath = path.join(STATE_DIR, "theater_session.json");
  if (fs.existsSync(theaterPath)) {
    try { fs.unlinkSync(theaterPath); } catch (_) {}
  }
  const theaterRoomsDeltaPath = path.join(STATE_DIR, "theater_rooms_delta.json");
  if (fs.existsSync(theaterRoomsDeltaPath)) {
    try { fs.unlinkSync(theaterRoomsDeltaPath); } catch (_) {}
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
  // NPC base_age 以 2018 年为基准。用年份差计算实际年龄。
  const gameYear = parseInt((gameState.time?.game_date || "2018").split("-")[0]) || 2018;
  const npcBirthYear = 2018 - npcBaseAge;
  return Math.max(1, gameYear - npcBirthYear);
}

/** 根据 NPC 当前年龄从 schedule_group_by_age 解析正确的日程组 */
function resolveScheduleGroup(src: any, currentAge: number): string {
  let g: string;
  const byAge: Record<string, string> | undefined = src?.schedule_group_by_age;
  if (byAge && Object.keys(byAge).length > 0) {
    const keys = Object.keys(byAge).map(Number).sort((a, b) => a - b);
    g = byAge[String(keys[0]!)]!;
    for (const k of keys) {
      if (k <= currentAge) g = byAge[String(k)]!;
      else break;
    }
  } else {
    // 无 by_age 映射表 → 按当前年龄推断（修复"小学生"标签钉死 bug）
    if (currentAge <= 6) g = "自由人";           // 学龄前：在家，无固定日程，具体一天交叙事发挥（不武断塞"小学生"）
    else if (currentAge <= 12) g = "小学生";
    else if (currentAge <= 15) g = "中学生";
    else if (currentAge <= 18) g = "高校生";
    else if (currentAge <= 22) g = "大学生";
    else g = src?.schedule_group || "自由人";
  }
  // 结构性不变量：引擎【绝不】产出不存在于 schedule_templates 的组名，否则日程解析为空/崩。
  // 兜底出来的（或角色数据里的）非法组 → 钳到 自由人。防"幼儿""社会人""海外"等复发。
  const templates = scheduleTemplates as any;
  return (templates && templates[g]) ? g : "自由人";
}

/** 按年龄缩放属性。身体属性按年龄比例缩放，心智属性保持 baseline */
function scaleAttributesForAge(src: any, age: number): Record<string, number> {
  const base = (src?.attributes as Record<string, number>) || { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10, 幸运: 10 };
  const physicalRatio = age <= 6 ? 0.5 : age <= 12 ? 0.7 : age <= 15 ? 0.85 : 1.0;
  if (physicalRatio >= 1.0) return { ...base };
  const physical = new Set(["力量", "敏捷", "体质"]);
  const scaled: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) {
    scaled[k] = physical.has(k) ? Math.max(1, Math.round(v * physicalRatio)) : v;
  }
  return scaled;
}

/** 按年龄选 personality_stages 文本 */
function resolvePersonality(src: any, age: number): string {
  const stages = src?.personality_stages;
  if (!stages) return src?.personality_brief || "";
  const keys = Object.keys(stages).map(Number).sort((a, b) => a - b);
  let best = stages[String(keys[0]!)];
  for (const k of keys) {
    if (k <= age) best = stages[String(k)];
    else break;
  }
  return String(best || "");
}

/**
 * NPC 状态水合管线：输入角色静态数据 + 实际年龄 → 输出完整一致运行时数据
 * 这是所有 NPC 年龄分层数据（body/appearance/schedule/personality/attributes）的单一入口
 */
function hydrateNPCState(src: any, effectiveAge: number): {
  body: any;
  appearance: any;
  scheduleGroup: string;
  personality: string;
  attributes: Record<string, number>;
  equipment: Record<string, any>;
  inventory: any[];
  equipmentSource: "card" | "auto";
} {
  const baseAge = src?.base_age ?? 16;
  const ageGap = Math.abs(effectiveAge - baseAge);

  // 装备：优先按年龄分层取，缺数据时年龄差>3岁则跳过（防止7岁穿高中制服），
  // 但不再留空——改用按年龄+性别的默认穿着（_equipmentSource="auto" 标记，待 LLM 重编）。
  let equipment: Record<string, any> = {};
  let equipmentSource: "card" | "auto" = "card";
  if (src?.equipment_by_age) {
    const keys = Object.keys(src.equipment_by_age).map(Number).sort((a, b) => a - b);
    let best = keys[0];
    for (const k of keys) { if (k <= effectiveAge) best = k; else break; }
    equipment = structuredClone(src.equipment_by_age[String(best)] ?? {});
  } else if (ageGap <= 3) {
    equipment = structuredClone(src?.equipment ?? {});
  }
  // 兜底：无论什么原因装备为空 → 按年龄性别给默认穿着
  if (!equipment || Object.keys(equipment).length === 0) {
    equipment = makeDefaultEquipment(effectiveAge, src?.gender ?? "female");
    equipmentSource = "auto";
  }

  // 库存：同上
  let inventory: any[] = [];
  if (src?.inventory_by_age) {
    const keys = Object.keys(src.inventory_by_age).map(Number).sort((a, b) => a - b);
    let best = keys[0];
    for (const k of keys) { if (k <= effectiveAge) best = k; else break; }
    inventory = structuredClone(src.inventory_by_age[String(best)] ?? []);
  } else if (ageGap <= 3) {
    inventory = structuredClone(src?.inventory ?? []);
  } else {
    console.warn(`hydrateNPCState: ${src?.name ?? "?"} age=${effectiveAge} vs base_age=${baseAge} (gap=${ageGap})，无 inventory_by_age 数据，跳过库存注入`);
  }

  return {
    body: getBodyForAge(src, effectiveAge),
    appearance: getAppearanceForAge(src, effectiveAge),
    scheduleGroup: resolveScheduleGroup(src, effectiveAge),
    personality: resolvePersonality(src, effectiveAge),
    attributes: scaleAttributesForAge(src, effectiveAge),
    equipment,
    inventory,
    equipmentSource,
  };
}

/** 按年龄+性别生成默认穿着（装备数据缺失时的兜底，不是 LLM 的活）。
 *  返回 { equipment, source:"auto" }——将来 LLM 见到 _equipmentSource="auto" 可按角色重编。 */
function makeDefaultEquipment(age: number, gender: string): Record<string, any> {
  const isFemale = gender === "female" || gender === "女";
  const eq: Record<string, any> = {};
  if (age <= 6) {
    eq.top = { name: "儿童上衣", type: "clothing", slot: "top", weight: 0.15, effects: [], state: "intact" };
    eq.bottom = { name: "儿童裤子", type: "clothing", slot: "bottom", weight: 0.15, effects: [], state: "intact" };
  } else if (age <= 12) {
    eq.top = { name: "小学生校服", type: "clothing", slot: "top", weight: 0.2, effects: [], state: "intact" };
    eq.bottom = { name: isFemale ? "小学生裙子" : "小学生短裤", type: "clothing", slot: "bottom", weight: 0.2, effects: [], state: "intact" };
  } else {
    eq.top = { name: isFemale ? "女士上衣" : "男士上衣", type: "clothing", slot: "top", weight: 0.3, effects: [], state: "intact" };
    eq.bottom = { name: isFemale ? "裙子" : "长裤", type: "clothing", slot: "bottom", weight: 0.3, effects: [], state: "intact" };
  }
  eq.inner_top = { name: isFemale ? "内衣" : "背心", type: "clothing", slot: "inner_top", weight: 0.05, effects: [], state: "intact" };
  eq.inner_bot = { name: "内裤", type: "clothing", slot: "inner_bot", weight: 0.05, effects: [], state: "intact" };
  eq.feet = { name: age <= 6 ? "小鞋子" : age <= 12 ? "学生鞋" : "便鞋", type: "clothing", slot: "feet", weight: 0.3, effects: [], state: "intact" };
  return eq;
}

/** 设置玩家位置并自动发现新地点 */
export function setPlayerLocation(loc: string): void {
  const oldLoc = gameState.player.location;
  const key = getRoomKey(loc) || loc;
  gameState.player.location = key;
  if (!gameState.player.known_locations) gameState.player.known_locations = ["住宅区"];
  if (!gameState.player.known_locations.includes(key)) {
    gameState.player.known_locations.push(key);
  }
  if (oldLoc !== key && gameState.tempNPCs?.length > 0) {
    cleanupTempNPCs("玩家移动");
  }
  // 移动后自动初始化网格坐标（位置变化时 或 gridPos 为 null 时触发）
  if (oldLoc !== key || !gameState.player.gridPos) {
    initPlayerGrid();
  }

  // 队友跟随移动
  if (gameState.player.party && gameState.player.party.length > 0) {
    for (const name of gameState.player.party) {
      const npc = gameState.npcs[name];
      if (npc && npc.alive !== false) {
        npc.currentRoom = key;
        npc.gridPos = null; // 重新进入场景时分配坐标
        npc.action = "跟随玩家";
      }
    }
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

/** 判断某身体区域（由若干装备槽位覆盖）是否"暴露"，即可被他人看到性征。
 *  规则区分两种"空"：
 *   - 槽位有遮盖物（item 对象）→ 没暴露；
 *   - 槽位全部是 undefined（从未交互过，通常是"衣服数据没填"）→ 视为默认穿着，没暴露；
 *   - 无遮盖物、且至少一个槽位被显式设为 null（剧情里被脱下）→ 才算暴露。
 *  这样"衣服数据缺失"不会被误判成"全裸"（P0#3）；只有真正被脱光才注入裸露描述。 */
function isBodyRegionExposed(...slots: any[]): boolean {
  if (slots.some(s => s && typeof s === "object")) return false;  // 有遮盖物 → 穿着
  return slots.some(s => s === null);                             // 无遮盖物：仅显式 null(被脱) 才暴露
}

/** 根据装备覆盖检测玩家身体暴露情况，返回 NPC 可感知的性征描述（生殖器/胸部/阴毛等）。
 *  原则：物理可见性驱动——脱了就能看到，不脱就看不到。与 mode（gal/sex/rpg）无关。 */
export function getVisibleBodyDescription(): string {
  const p = gameState.player;
  const eq = p.equipment || {};

  // 覆盖检测：所有覆盖该区域的槽位都为空 → 暴露
  const bottomCovered = !isBodyRegionExposed(eq.bottom, eq.inner_bot);
  const topCovered = !isBodyRegionExposed(eq.top, eq.shirt, eq.inner_top);

  if (bottomCovered && topCovered) return ""; // 全身穿着整齐，无需额外注入

  // 读玩家自己的 sex profile
  const sState = gameState.sexStates?.[p.name];
  const profile = sState?.profile;
  if (!profile) return "";

  const parts: string[] = [];

  // ── 下身暴露 → 生殖器可见 ──
  if (!bottomCovered) {
    if (profile.male) {
      const m = profile.male;
      const circum = m.penis.circumcised ? "已割包皮" : "未割包皮";
      parts.push(`阴茎${m.penis.length_cm}cm ${m.penis.shape}型 ${m.penis.head_size}头 ${circum}`);
      parts.push(`睾丸${m.testicles.size}`);
      if (m.pubic_hair) {
        parts.push(`阴毛${m.pubic_hair.amount} ${m.pubic_hair.color} ${m.pubic_hair.style}`);
      }
    } else if (profile.female) {
      const f = profile.female;
      parts.push(`阴部${f.vagina.type}型 ${f.labia_size}阴唇 ${f.vagina.inner_color}`);
      parts.push(`阴蒂${f.clitoris}`);
      if (f.pubic_hair) {
        parts.push(`阴毛${f.pubic_hair.amount} ${f.pubic_hair.color} ${f.pubic_hair.style}`);
      }
    }
  }

  // ── 上身暴露 → 胸部可见（主要对女性有意义） ──
  if (!topCovered && profile.female) {
    const f = profile.female;
    parts.push(`胸部${f.breast.cup}cup ${f.breast.shape} ${f.breast.nipple_color}乳头 ${f.breast.nipple_size}`);
  }

  if (parts.length === 0) return "";
  return `可见身体: ${parts.join("；")}`;
}

/** NPC 版本：检测指定 NPC 的装备覆盖，返回其他角色可感知的性征描述。
 *  与 getVisibleBodyDescription 逻辑完全对称——装备决定可见性。 */
export function getNPCVisibleBodyDescription(npcName: string): string {
  const npc = gameState.npcs?.[npcName];
  if (!npc) return "";
  const eq = npc.equipment || {};

  const bottomCovered = !isBodyRegionExposed(eq.bottom, eq.inner_bot);
  const topCovered = !isBodyRegionExposed(eq.top, eq.shirt, eq.inner_top);

  if (bottomCovered && topCovered) return "";

  const sState = gameState.sexStates?.[npcName];
  const profile = sState?.profile;
  if (!profile) return "";

  const parts: string[] = [];

  if (!bottomCovered) {
    if (profile.male) {
      const m = profile.male;
      const circum = m.penis.circumcised ? "已割包皮" : "未割包皮";
      parts.push(`阴茎${m.penis.length_cm}cm ${m.penis.shape}型 ${m.penis.head_size}头 ${circum}`);
      parts.push(`睾丸${m.testicles.size}`);
      if (m.pubic_hair) {
        parts.push(`阴毛${m.pubic_hair.amount} ${m.pubic_hair.color} ${m.pubic_hair.style}`);
      }
    } else if (profile.female) {
      const f = profile.female;
      parts.push(`阴部${f.vagina.type}型 ${f.labia_size}阴唇 ${f.vagina.inner_color}`);
      parts.push(`阴蒂${f.clitoris}`);
      if (f.pubic_hair) {
        parts.push(`阴毛${f.pubic_hair.amount} ${f.pubic_hair.color} ${f.pubic_hair.style}`);
      }
    }
  }

  if (!topCovered && profile.female) {
    const f = profile.female;
    parts.push(`胸部${f.breast.cup}cup ${f.breast.shape} ${f.breast.nipple_color}乳头 ${f.breast.nipple_size}`);
  }

  if (parts.length === 0) return "";
  return `可见身体: ${parts.join("；")}`;
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
      match = p.reputation[cond.group] !== undefined && (p.reputation[cond.group] ?? 0) >= cond.min;
    } else if (cond.type === "reputation_max") {
      match = p.reputation[cond.group] !== undefined && (p.reputation[cond.group] ?? 0) <= cond.max;
    } else if (cond.type === "attribute") {
      match = ((p.attributes as any)[cond.attr] ?? 0) >= cond.min;
    } else if (cond.type === "funds") {
      match = p.funds >= cond.min;
    } else if (cond.type === "skill") {
      match = (p.skills[cond.skillName]?.level ?? 0) >= cond.min;
    } else if (cond.type === "flag") {
      match = !!gameState.flags[cond.flagName];
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
      const skillsStr = Object.entries(p.skills)
        .filter(([_, sk]) => sk.level > 0)
        .map(([k, sk]) => `${k}:Lv${sk.level}`)
        .join(", ");
      if (skillsStr) text += `\n[技能] ${skillsStr}`;
      const abilitiesStr = Object.entries(p.abilities || {})
        .filter(([_, a]) => (a as any).level > 0)
        .map(([k, a]) => `${k}:Lv${(a as any).level}`)
        .join(", ");
      if (abilitiesStr) text += `\n[能力] ${abilitiesStr}`;
      const rp = p.resourcePools;
      if (rp) {
        const rpStr = Object.entries(rp)
          .filter(([_, v]) => v)
          .map(([k, v]) => `${k}:${v!.current}/${v!.max}`)
          .join(", ");
        if (rpStr) text += `\n[资源] ${rpStr}`;
      }
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
      if (namelessNPCs.length > 0) lines.push(`[在场路人] ${namelessNPCs.map((n: any) => `${n.name}(${n.act})`).join("；")}`);
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
        let sexMod: any = null;
        try { sexMod = await import("./sex.ts"); } catch { return lines; /* public repo */ }
        const { getDesireNarrative, getArousalNarrative, getDevNarrative, getCyclePhase, getThoughtsSummary, getMoodHint, SEX_PROFILES } = sexMod;
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

          // Inject detailed genital and body specs for sex scene consistency
          if (s().mode === "sex") {
            const linesSpec: string[] = [];
            // Active player's body and genitals (the switched POV character or original player)
            if (p.gender === "女" && prof.female) {
              const f = prof.female;
              linesSpec.push(`  [我的物理规格特征]`);
              if (f.breast) linesSpec.push(`    胸部: ${f.breast.cup}罩杯 | 形状: ${f.breast.shape} | 触感: ${f.breast.feel} | 乳头: ${f.breast.nipple_color}(${f.breast.nipple_size})`);
              if (f.vagina) linesSpec.push(`    秘部: 阴道: ${f.vagina.type} | 紧致: ${f.vagina.tightness} | 内壁: ${f.vagina.inner_color} | 深度: ${f.vagina.depth_cm}cm`);
              if (f.clitoris) linesSpec.push(`    阴蒂: ${f.clitoris}`);
            } else if (p.gender === "男" && prof.male) {
              const m = prof.male;
              linesSpec.push(`  [我的物理规格特征]`);
              if (m.penis) linesSpec.push(`    阴茎: 疲软: ${m.penis.length_cm}cm/${m.penis.girth_cm}cm | 勃起: ${m.penis.erect_length_cm}cm/${m.penis.erect_girth_cm}cm | 形状: ${m.penis.shape} | 包皮: ${m.penis.circumcised ? "已切除" : "包茎/未切"}`);
            }

            // Target NPC's body and genitals
            const targetName = prof.name;
            const targetNpc = s().npcs[targetName] || (s()._npcSnapshot && s()._npcSnapshot.name === targetName ? s()._npcSnapshot : null);
            if (targetNpc) {
              const tp = prof;
              if (p.gender === "男" && tp.female) {
                const f = tp.female;
                linesSpec.push(`  [对方的物理规格特征]`);
                if (f.breast) linesSpec.push(`    胸部: ${f.breast.cup}罩杯 | 形状: ${f.breast.shape} | 触感: ${f.breast.feel} | 乳头: ${f.breast.nipple_color}(${f.breast.nipple_size})`);
                if (f.vagina) linesSpec.push(`    秘部: 阴道: ${f.vagina.type} | 紧致: ${f.vagina.tightness} | 内壁: ${f.vagina.inner_color} | 深度: ${f.vagina.depth_cm}cm`);
                if (f.clitoris) linesSpec.push(`    阴蒂: ${f.clitoris}`);
              } else if (p.gender === "女" && tp.male) {
                const m = tp.male;
                linesSpec.push(`  [对方的物理规格特征]`);
                if (m.penis) linesSpec.push(`    阴茎: 疲软: ${m.penis.length_cm}cm/${m.penis.girth_cm}cm | 勃起: ${m.penis.erect_length_cm}cm/${m.penis.erect_girth_cm}cm | 形状: ${m.penis.shape} | 包皮: ${m.penis.circumcised ? "已切除" : "包茎/未切"}`);
              }
            }
            if (sx.stamina !== undefined) {
              linesSpec.push(`  [男方体力] ${sx.stamina}/100`);
            }
            if (sx.contraceptionUsed) {
              const brokenStr = sx.condomBroken ? " (安全套已破损！避孕失效)" : "";
              const contraNames: Record<string, string> = { condom: "安全套", pill: "避孕药", none: "无避孕措施" };
              linesSpec.push(`  [避孕状态] ${contraNames[sx.contraceptionUsed] || sx.contraceptionUsed}${brokenStr}`);
            }
            linesSpec.push(`  [我的幸运] ${p.attributes.幸运 ?? 10} | [对方幸运] ${targetNpc?.attributes?.幸运 ?? 10}`);
            if (linesSpec.length > 0) {
              lines.push(...linesSpec);
            }
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
  // 玩家当前装备摘要（全部槽位，始终注入以确保 TUI 修改后 LLM 同步）
  const SLOT_LABELS: Record<string, string> = {
    top: "外套", shirt: "内搭", inner_top: "胸衣", bottom: "下装", inner_bot: "内裤",
    legs: "袜", feet: "鞋", head: "头饰", acc: "配饰",
    left_hand: "左手", right_hand: "右手", back: "背"
  };
  const wornParts: string[] = [];
  const emptySlots: string[] = [];
  let mountItem: string | null = null;
  for (const [slot, item] of Object.entries(p.equipment)) {
    if (!item) {
      if (slot !== "mount" && SLOT_LABELS[slot]) emptySlots.push(SLOT_LABELS[slot]);
      continue;
    }
    if (slot === "mount") { mountItem = item.name; continue; }
    const label = SLOT_LABELS[slot] || slot;
    // Layer1 关闭时 inner 只标记有/无，不暴露具体名
    if ((slot === "inner_top" || slot === "inner_bot") && !s.layer1Enabled) {
      wornParts.push(`${label}:有`);
    } else {
      wornParts.push(`${label}:${item.name}`);
    }
  }
  const eqSummary = wornParts.length > 0 ? wornParts.join(" | ") : "（全裸）";
  tpl += `\n[装备] ${eqSummary}`;
  if (emptySlots.length > 0 && emptySlots.length <= 6) {
    tpl += `  [空槽] ${emptySlots.join("、")}`;
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
      if (h.iconic_lines?.length) {
        tpl += `\n    💬 标志性台词参考: ${h.iconic_lines.join(" | ")}`;
      }
    }
    tpl += `\n→ 玩家接受委托后，调用 open_quest 工具开启任务。`;
  }
  // 日历事件注入
  const todayCal = getTodayCalendar();
  if (todayCal) {
    tpl += `\n[日历] 今日特殊: ${todayCal}`;
  }
  // 课程表注入（玩家在学校时）
  if (p.location.includes("総武高") || p.location.includes("总武高") || p.location.includes("教室") || p.location.includes("校") || p.location.includes("部室") || p.location.includes("体育") || p.location.includes("プール")) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const ttPath = path.resolve(process.cwd(), "worldpacks", gameState.activeWorld || "oregairu", "timetable.json");
      const orgPath = path.resolve(process.cwd(), "worldpacks", gameState.activeWorld || "oregairu", "orgs", "soubu_high.json");
      if (fs.existsSync(ttPath)) {
        const tt = JSON.parse(fs.readFileSync(ttPath, "utf-8"));
        let timetableKey = "";
        // v2: Resolve via class_config (持ち上がり制対応)
        if (fs.existsSync(orgPath)) {
          const org = JSON.parse(fs.readFileSync(orgPath, "utf-8"));
          const cc = org.class_config?.grades;
          if (cc) {
            const playerGrade = (p as any).grade || 2; // default 2年生
            const playerHR = (p as any).homeroom || null;
            const yearKey = `${playerGrade}年`;
            const yearData = cc[yearKey];
            if (playerHR && yearData?.classes?.[playerHR]) {
              timetableKey = yearData.classes[playerHR].homeroom;
            }
          }
        }
        // Fallback: search all timetables for a matching student flag
        if (!timetableKey) {
          for (const fk of Object.keys(gameState.flags || {})) {
            if (fk.startsWith("hr_teacher_") && gameState.flags[fk]) {
              timetableKey = fk.replace("hr_teacher_", "");
              break;
            }
          }
        }
        if (timetableKey) {
          const { buildPeriodLines } = await import("./time.ts");
          const periodLine = buildPeriodLines(timetableKey, gameState.time.minute_of_day, gameState.time.day_of_week, tt);
          if (periodLine) {
            tpl += `\n[课堂] ${periodLine}`;
          }
        }
      }
    } catch (_e) { /* timetable 加载失败不阻塞 */ }
  }
  // 世界常识注入 (P2)
  try {
    const { getTriggeredLore } = await import("./lore.ts");
    const playerGroup = gameState.player.schedule_group || "";
    const loreTexts = getTriggeredLore(
      p.location,
      [], // topics — could be extracted from recent dialogue in future
      [playerGroup],
      [],
      s.flags
    );
    if (loreTexts.length > 0) {
      tpl += `\n[常识]\n${loreTexts.map(t => `  • ${t}`).join("\n")}`;
    }
  } catch (e) {
    console.error("lore injection error:", e);
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

  // 临时NPC注入 (P4)
  const tempCtx = getTempNPCContext();
  if (tempCtx) {
    tpl += `\n[在场·临时]\n${tempCtx}`;
  }

  // 注入 collector 注册表产出的上下文（NPC详情/关系/Layer1 等重段已迁移至 collector）
  const collectorText = await buildCollectorContext();
  if (collectorText) tpl += "\n" + collectorText;

  // 手机通知注入
  try {
    const { getPlayerPhoneData, getUnreadSummary } = await import("./phone.ts");
    const phoneNote = getUnreadSummary(gameState, getPlayerPhoneData(gameState));
    if (phoneNote) tpl += `\n${phoneNote}`;
  } catch (e) { console.error("buildStatePrompt: 手机通知注入失败", e); }

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
  if (p.location.includes("校") || p.location.includes("部室")) {
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
    const always = "始终可用: lookup_character, lookup_region, lookup_lore, dice_roll, get_status, commit_turn, add_to_party, remove_from_party, lookup_weather, spawn_item, grant_skill_exp, create_story_hook, instantiate_npc";
    tpl += `\n[工具提示] ${[...sceneHints, always].join(" | ")}`;
  }

  if (gameState.lastReviewFindings && gameState.lastReviewFindings.length > 0) {
    tpl += `\n[系统复盘警报] 上一回合复盘检出以下问题，请在叙事中注意遵守设定或进行合理找补：\n` + gameState.lastReviewFindings.map(f => `  • ${f}`).join("\n");
  }

  if (gameState._locationMismatchWarning) {
    tpl += `\n[引擎告警] ⚠️ ${gameState._locationMismatchWarning}`;
  }

  return tpl;
}

// --- 属性调整值 ---
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
    if (!item?.effects) continue;
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

  // 从背包找——先按 vehicle effect 匹配，再按名字兜底
  let idx = p.inventory.findIndex(i => i.effects?.some(e => e.type === "vehicle") && i.name === itemName);
  if (idx < 0) {
    // 兜底：名字匹配（spawn_item 可能没加 vehicle effect）
    idx = p.inventory.findIndex(i => i.name === itemName);
    if (idx >= 0 && !p.inventory[idx].effects?.some(e => e.type === "vehicle")) {
      // 补充 vehicle effect
      if (!p.inventory[idx].effects) p.inventory[idx].effects = [];
      p.inventory[idx].effects.push({ type: "vehicle", value: "bicycle" });
    }
  }
  if (idx < 0) return `背包里没有 ${itemName}`;

  const found = p.inventory.splice(idx, 1)[0];
  const vtype = found.effects.find(e => e.type === "vehicle")?.value as string || "bicycle";
  const def = VEHICLES[vtype];
  if (!def) {
    // 已知载具类型列表供 LLM 参考
    const known = Object.keys(VEHICLES).join("、");
    return `未知载具类型: ${vtype}。已知类型: ${known}`;
  }

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
    if (!item?.effects) continue;
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
  const pocketVol = calcPocketVolume(equipment);
  // 最小容积：即使裸体/无口袋，人的双手也能抱 ≈ STR×2 升
  const minVol = Math.max(pocketVol, (gameState.player.attributes.力量 || 10) * 2);
  const maxVol = minVol;
  const newVol = curVol + newItem.volume;
  const ratio = newVol / maxVol;

  if (newVol <= maxVol) {
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
              furnitureDef = findFurnitureDef(name, gameState.activeWorld);
            } catch (e) { console.error("getContainersAt: findFurnitureDef 失败", e); }

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
  if (name === gameState.player.name) {
    console.error(`updateRelation: 拒绝写入玩家自身关系 (${name})`);
    return rels;
  }
  const oldStage = rels[name]?.stage || "陌生";
  if (!rels[name]) {
    rels[name] = { stage: "陌生", affection: 0, romance: null, notes: "", history: [] };
  }
  rels[name].affection = Math.max(0, Math.min(100, rels[name].affection + delta));
  rels[name].stage = affectionToStage(rels[name].affection);
  const newStage = rels[name].stage;
  if (note) rels[name].notes = note;
  // 记录历史
  rels[name].history ??= [];
  rels[name].history!.push({ delta, reason: note || "未记录原因", date: gameState.time.game_date });
  // 只保留最近20条
  if (rels[name].history!.length > 20) rels[name].history = rels[name].history!.slice(-20);

  // 关系阶段突破触发他者之眼切镜
  if (oldStage !== newStage && newStage !== "陌生") {
    gameState._cutaway_queue ??= [];
    gameState._cutaway_queue.push({
      type: "他者之眼",
      npc: name,
      weight: 100,
      trigger: `她与玩家的关系从${oldStage}变为${newStage}: ${note || "关系进展"}`
    });
  }

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
const OUTFIT_NON_SLOT = new Set(["hair", "desc", "head"]);

/** 把 itemsCatalog 拍平成 name→item Map。处理两种结构：
 *  顶层直接条目（key=物品名，value 含 name/type）+ 分类容器（weapons/clothing… 内含多个物品）。 */
function buildCatalogLookup(): Map<string, any> {
  const lookup = new Map<string, any>();
  for (const [key, val] of Object.entries(itemsCatalog as any)) {
    if (!val || typeof val !== "object") continue;
    if ((val as any).name && (val as any).type) {
      lookup.set(key, val);                                   // 顶层直接物品
    } else {
      for (const [name, item] of Object.entries(val as any)) {
        if (item && typeof item === "object") lookup.set(name, item);  // 分类内物品
      }
    }
  }
  return lookup;
}

/** 用目录补全装备的引擎属性（effects/pocket/weight/volume），但【角色手写 flavor 优先】。
 *  这样 items.json 补服装骨架后，不覆盖 135 个角色手写的专属 flavor（decision #30）。 */
function fillEffectsFromCatalog(equipment: Record<string, any>): Record<string, any> {
  const lookup = buildCatalogLookup();
  const result: Record<string, any> = {};
  for (const [slot, item] of Object.entries(equipment)) {
    if (!item) { result[slot] = null; continue; }
    const catalog = lookup.get(item.name);
    result[slot] = catalog
      ? { ...structuredClone(catalog),
          flavor: (item as any).flavor ?? (catalog as any).flavor,        // 角色手写优先
          effects: (item as any).effects ?? (catalog as any).effects ?? [],
          state: (item as any).state || "intact" }
      : item;
  }
  return result;
}

/** 从 outfit 定义（{hair,desc,top,bottom,…}）构建装备槽 Item 表：
 *  槽位名字 → items.json 查（拿 effects/pocket/weight）→ 查不到则合成兜底 clothing Item。
 *  用于 setNPCOutfit 给【所有角色】填 equipment（不再只有 equipment_by_outfit 的雪乃）。 */
function buildEquipmentFromOutfit(outfitDef: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!outfitDef) return out;
  const lookup = buildCatalogLookup();
  for (const [slot, name] of Object.entries(outfitDef)) {
    if (OUTFIT_NON_SLOT.has(slot) || typeof name !== "string") continue;
    const cat = lookup.get(name);
    out[slot] = cat
      ? { ...structuredClone(cat), state: "intact" }
      : { name, type: "clothing", slot, effects: [], state: "intact" };  // 兜底：至少有名字
  }
  return out;
}

/** 换装时同步 npc.equipment：清旧 outfit 独有的槽位（脱旧衣），写新 outfit 的槽位。
 *  两个 outfit 都没定义的槽位（武器/工具）不碰。数据源优先 equipment_by_outfit（雪乃深耕），
 *  否则从 outfit 槽位名字经目录构建（所有角色通用）——修 set_npc_outfit display/data 脱节。 */
function applyOutfitEquipment(npc: any, src: any, oldOutfit: string, outfitKey: string): void {
  const newEquip = src?.equipment_by_outfit?.[outfitKey] ?? buildEquipmentFromOutfit(src?.outfits?.[outfitKey]);
  if (!newEquip || !Object.keys(newEquip).length) return;
  const oldEquip = src?.equipment_by_outfit?.[oldOutfit] ?? buildEquipmentFromOutfit(src?.outfits?.[oldOutfit]);
  const oldSlots = new Set(Object.keys(oldEquip || {}));
  const newSlots = new Set(Object.keys(newEquip));
  for (const slot of oldSlots) if (!newSlots.has(slot)) (npc.equipment as any)[slot] = null;
  for (const slot of newSlots) {
    const item = (newEquip as any)[slot];
    (npc.equipment as any)[slot] = item ? structuredClone(item) : null;
  }
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
    attributes: { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10, 幸运: 10 },
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

/** 从 nameless_npc_templates 中查找模板 */
function findNamelessTemplate(namelessName: string): { name: string; act: string; height: string; vehicle?: string } | null {
  const traits = namelessNpcTemplates.traits;
  if (!Array.isArray(traits)) return null;
  return traits.find((t: any) => t.name === namelessName) || null;
}

/** 从 act 描述推断 schedule_group */
function inferScheduleGroup(act: string): string {
  if (act.includes("学生") || act.includes("书包") || act.includes("校")) return "学生";
  if (act.includes("上班") || act.includes("职员") || act.includes("公文包") || act.includes("电话") && act.includes("赶路")) return "上班族";
  if (act.includes("主妇") || act.includes("购物")) return "主妇";
  if (act.includes("小学生") || act.includes("红蓝书包")) return "小学生";
  if (act.includes("店员")) return "便利店店员";
  if (act.includes("巡警")) return "巡警";
  if (act.includes("跑步") || act.includes("运动服")) return "运动者";
  return "自由人";
}

/** 从 name/act 推断性别 */
function inferGender(name: string, act: string): string {
  if (name.includes("女生") || name.includes("主妇") || name.includes("老奶奶")) return "female";
  if (name.includes("男生") || name.includes("不良少年") || name.includes("流浪汉") || name.includes("上班族")) return "male";
  if (act.includes("他") && !act.includes("她")) return "male";
  if (act.includes("她")) return "female";
  return "male";
}

/** 从 name/act 推断年龄 */
function inferBaseAge(name: string, act: string): number {
  if (name.includes("小学生")) return 10;
  if (name.includes("学生")) return 16;
  if (name.includes("老奶奶")) return 70;
  if (name.includes("上班族") || name.includes("职员")) return 30;
  if (name.includes("主妇")) return 35;
  if (name.includes("店员")) return 25;
  if (name.includes("不良少年")) return 17;
  if (name.includes("巡警")) return 35;
  if (name.includes("流浪汉")) return 50;
  return 20;
}

/** 从 height 字符串解析身高 cm（取第一个数字；情侣/双人取平均值） */
function inferHeightCm(heightStr: string): number {
  const nums = heightStr.match(/\d+/g);
  if (!nums) return 165;
  const vals = nums.map(Number);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** 将路人模板实例化为完整角色。返回描述文本。 */
export function instantiateNamelessNPC(namelessName: string, reason: string = ""): string {
  const template = findNamelessTemplate(namelessName);
  if (!template) return `未找到路人模板: ${namelessName}`;

  // 改名：去掉 "路人()" 前缀，取内部文本作为角色名
  const match = namelessName.match(/路人\((.+)\)/);
  const baseName = match ? match[1] : namelessName;
  // 如果已存在同名角色，加后缀
  let charName = baseName;
  if ((characters as any[]).find((c: any) => c.name === charName) || DYNAMIC_CHARACTERS[charName]) {
    charName = `${baseName}(路人转正)`;
  }

  const heightCm = inferHeightCm(template.height);
  const weightKg = Math.round((heightCm - 100) * 0.9);

  const charData: Record<string, any> = {
    name: charName,
    gender: inferGender(namelessName, template.act),
    base_age: inferBaseAge(namelessName, template.act),
    appearance_brief: `${template.act}的${baseName}`,
    body: {
      height_cm: heightCm,
      weight_kg: weightKg,
      build: weightKg / (heightCm / 100) ** 2 > 24 ? "结实" : "标准",
      leg_type: "修长",
      skin: { base_tone: "普通", tan: 0, texture: "普通" },
    },
    schedule_group: inferScheduleGroup(template.act),
    default_location: gameState.player.location,
    tags: ["路人转正"],
  };

  const result = registerDynamicCharacter(charName, charData);
  // 初始化 NPC 运行时状态
  getOrCreateNPC(charName);

  const reasonLine = reason ? `\n原因: ${reason}` : "";
  return `${result}${reasonLine}\n模板: ${template.name} | act: ${template.act} | 推断: ${charData.gender}, ${charData.base_age}岁, ${charData.schedule_group}`;
}

// ── P4: 临时 NPC 管理 ──

/** P4: Spawn a temporary NPC into the current scene */
export function spawnTempNPC(params: {
  name: string;
  act: string;
  hostility?: "友好" | "中立" | "敌对";
  body_hint?: string;
  reason: string;
}): string {
  gameState.tempNPCs ??= [];

  // Check for duplicate name
  if (gameState.tempNPCs.some(t => t.name === params.name)) {
    return `临时NPC「${params.name}」已存在于当前场景`;
  }

  const temp: TempNPCState = {
    name: params.name,
    act: params.act,
    hostility: params.hostility || "中立",
    body_hint: params.body_hint,
    reason: params.reason,
    created_at_turn: gameState.turn,
    created_at_date: gameState.time.game_date,
  };

  gameState.tempNPCs.push(temp);
  return `临时NPC「${params.name}」已加入场景（${params.hostility || "中立"}）。场景结束自动回收。`;
}

/** P4: Clean up temp NPCs on scene transition */
export function cleanupTempNPCs(trigger: string): string[] {
  gameState.tempNPCs ??= [];
  const removed = gameState.tempNPCs.map(t => t.name);
  const count = removed.length;
  gameState.tempNPCs = [];
  if (count > 0) {
    return [`[临时NPC回收] ${trigger}: ${removed.join("、")} 已离开场景（${count}人）`];
  }
  return [];
}

/** P4: Promote a temp NPC to permanent character */
export function promoteTempNPC(tempName: string, reason: string): string | null {
  gameState.tempNPCs ??= [];
  const idx = gameState.tempNPCs.findIndex(t => t.name === tempName);
  if (idx < 0) return null;

  const temp = gameState.tempNPCs[idx];

  // Build minimal StaticCharacter from temp data
  const charData: any = {
    name: temp.name,
    source: "dynamic",
    gender: "男",
    base_age: 17,
    appearance_brief: temp.body_hint || "普通身材",
    schedule_group: "自由人",
    tags: [],
  };

  // Store in dynamicCharacters
  gameState.dynamicCharacters ??= {};
  gameState.dynamicCharacters[temp.name] = charData;

  // Initialize NPC runtime state
  const npc = getOrCreateNPC(temp.name);
  npc.action = temp.act;
  npc.currentRoom = gameState.player.location;
  npc.memoryTags.push({
    tag: `[临时NPC转正] ${reason}`,
    since: gameState.time.game_date,
    expires: 365,
    tone: "无感",
  });

  // Remove from temp list
  gameState.tempNPCs.splice(idx, 1);

  return `临时NPC「${temp.name}」已转正为永久角色。理由: ${reason}`;
}

/** P4: Get temp NPC context for prompt injection */
export function getTempNPCContext(): string {
  gameState.tempNPCs ??= [];
  if (gameState.tempNPCs.length === 0) return "";

  return gameState.tempNPCs.map(t => {
    const hostilityNote = t.hostility === "敌对" ? " ⚔敌对" : t.hostility === "友好" ? " ☮友好" : "";
    return `  [临时] ${t.name} — ${t.act}${hostilityNote}（${t.body_hint || "身材普通"}）`;
  }).join("\n");
}

/** 查找角色（先静态库 → 动态注册表） */
export function findCharacter(name: string): any | null {
  const src = (characters as any[]).find((c: any) => c.name === name);
  if (src) return src;
  return DYNAMIC_CHARACTERS[name] || null;
}

/** P3: 按关系级别过滤角色事实 */
const FACT_LEVEL_ORDER: Record<string, number> = {
  "common": 0,
  "familiar": 1,
  "close": 2,
  "intimate": 3,
};

const RELATION_TO_MAX_LEVEL: Record<string, string> = {
  "陌生": "common",
  "熟人": "familiar",
  "友人": "close",
  "信赖": "close",
  "至交": "intimate",
};

export function getCharacterFacts(
  characterName: string,
  relationshipStage: string,
  isSelf: boolean = false
): { public: CharacterFact[]; private: CharacterFact[] } {
  const src = findCharacter(characterName);
  if (!src) return { public: [], private: [] };

  const maxLevel = isSelf ? "intimate" : (RELATION_TO_MAX_LEVEL[relationshipStage] || "common");
  const maxLevelOrder = FACT_LEVEL_ORDER[maxLevel] ?? 0;

  const publicFacts = (src.public_facts || []).filter((f: CharacterFact) => FACT_LEVEL_ORDER[f.level] <= maxLevelOrder);
  const privateFacts = isSelf
    ? (src.private_facts || [])
    : (src.private_facts || []).filter((f: CharacterFact) => FACT_LEVEL_ORDER[f.level] <= maxLevelOrder);

  return { public: publicFacts, private: privateFacts };
}

/** P3: 获取 NPC 对场景内其他角色的 common 级印象 */
export function getNPCCharacterImpressions(npcName: string, otherNames: string[]): Record<string, string[]> {
  const impressions: Record<string, string[]> = {};
  for (const other of otherNames) {
    const src = findCharacter(other);
    if (!src?.public_facts) continue;
    const commonFacts = (src.public_facts as CharacterFact[]).filter(f => f.level === "common");
    if (commonFacts.length > 0) {
      impressions[other] = commonFacts.map(f => f.text);
    }
  }
  return impressions;
}

export function getOrCreateNPC(name: string): NPCRuntimeState {
  // 拒绝为玩家名创建 NPC 运行时状态（防数据污染 #3）
  if (name === gameState.player.name) {
    console.error(`getOrCreateNPC: 拒绝为玩家 "${name}" 创建 NPC 状态——玩家不应出现在 npcs 表`);
    // 若已污染则返回并清理
    if (gameState.npcs[name]) delete gameState.npcs[name];
    // 返回一个不可写入的占位对象防止调用方崩溃
    const dummy: any = { currentRoom: "", alive: true, current_goal: "", memoryTags: [], scheduleGroup: "自由人" };
    return dummy;
  }
  if (!gameState.npcs[name]) {
    const src = findCharacter(name);
    const npcAge = src ? getNpcCurrentAge(src.base_age || 16) : 16;
    const hydrated = src ? hydrateNPCState(src, npcAge) : null;
    const runtimeAttrs = hydrated?.attributes || { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10 };
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

    // 缓存水合数据（不污染 worldpacks 文件，供后续 buildStatePrompt 使用）
    if (src && hydrated) {
      if (!(src as any)._hydratedCache) (src as any)._hydratedCache = {};
      (src as any)._hydratedCache[npcAge] = hydrated;
    }

    gameState.npcs[name] = {
      inventory: hydrated?.inventory ?? (src ? structuredClone(src.inventory ?? []) : []),
      equipment: hydrated ? fillEffectsFromCatalog(hydrated.equipment) : (src ? fillEffectsFromCatalog(src.equipment ?? {}) : {}),
      _equipmentSource: hydrated?.equipmentSource ?? (src?.equipment && Object.keys(src.equipment).length > 0 ? "card" : "auto"),
      currentRoom: src?.default_location || "",
      gridPos: src?.grid_pos || null,
      action: "",
      scheduleGroup: hydrated?.scheduleGroup || resolveScheduleGroup(src, npcAge),
      scheduleOverrides: src?.schedule_overrides,
      currentOutfit: "school",
      // 现金 vs 财产分离：角色卡 funds 是总身家，随身现金只取一小部分。
      // 富人钱包多些但不上万（谁兜里揣 120 万？），穷人钱包少但总身家如实低。
      cash: src?.funds ? Math.min(5000, Math.floor(src.funds * 0.15)) : 1000,
      wealth: src?.funds !== undefined ? src.funds : 1000,
      memoryTags: [],
      hp: { current: currentHP, max: maxHP },
      alive: true,
      attributes: runtimeAttrs,
      skills: runtimeSkills,
      abilities: {},
      social_class: src?.social_class || "普通市民",
      personal_axes: src?.personal_axes || { "经济立场": 0, "政治立场": 0 }
    };
    // 初始化自主意图（从 drives_by_age 按当前年龄取对应段）
    if (src?.drives_by_age) {
      const keys = Object.keys(src.drives_by_age).map(Number).sort((a, b) => a - b);
      let best = keys[0];
      for (const k of keys) { if (k <= npcAge) best = k; else break; }
      const ageDrives = src.drives_by_age[String(best)];
      if (ageDrives) {
        gameState.npcs[name].current_drives = [...ageDrives.drives];
        gameState.npcs[name].current_goal = ageDrives.goal;
      }
    }
    // 魅力→初始印象：NPC首次创建时自动写入关系（玩家自己除外）
    if (name !== gameState.player.name && !gameState.player.relationships[name]) {
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
    // 自动收录 NPC 的 default_location 到玩家已知地点（否则 travel 找不到）
    if (src?.default_location) {
      const defLoc = src.default_location as string;
      if (!gameState.player.known_locations.some((k: string) => isSameLocation(k, defLoc))) {
        gameState.player.known_locations.push(defLoc);
      }
    }
  }
  return gameState.npcs[name];
}

/** NPC 场景服装切换。返回当前 outfit 描述 */
export function setNPCOutfit(npcName: string, outfitKey: string): string {
  const src = findCharacter(npcName);
  const npc = getOrCreateNPC(npcName);
  // 兜底：动态角色无预设 outfits → 自动生成基础服装卡
  if (!src?.outfits?.[outfitKey]) {
    const defaults: Record<string, Record<string, string>> = {
      school: { top: "校服", bottom: "校服裤", feet: "学生鞋" },
      casual: { top: "便服上衣", bottom: "休闲裤", feet: "运动鞋" },
      pe: { top: "体操服", bottom: "运动短裤", feet: "运动鞋" },
      swim: { top: "泳衣", bottom: "泳裤" },
      sleep: { top: "家居服" },
    };
    const def = defaults[outfitKey];
    if (!def) return `${npcName}没有 ${outfitKey} 服装卡`; // 非标准 key 才拒绝
    // 写入 outfits 使其持久
    if (!(src as any).outfits) (src as any).outfits = {};
    (src as any).outfits[outfitKey] = { ...def };
    const oldOutfit = npc.currentOutfit || "school";
    npc.currentOutfit = outfitKey as any;
    applyOutfitEquipment(npc, src, oldOutfit, outfitKey);
    const desc = Object.values(def).join("、");
    _outfitChanges.push({ npc: npcName, from: oldOutfit, to: outfitKey, desc });
    return `${npcName} → ${outfitKey}（自动生成）: ${desc}`;
  }
  const oldOutfitMain = npc.currentOutfit || "school";
  npc.currentOutfit = outfitKey as any;
  applyOutfitEquipment(npc, src, oldOutfitMain, outfitKey);
  const items = src.outfits[outfitKey];
  const desc = Object.values(items).join("、");
  _outfitChanges.push({ npc: npcName, from: oldOutfitMain, to: outfitKey, desc });
  return `${npcName} → ${outfitKey}: ${desc}`;
}

/** 获取 NPC 当前 outfit 的外观描述。已从装备槽移除的物品不显示。
 *  支持 outfits_by_age 按年龄段选择服装；年龄差 >3 且无 by_age 数据时用年龄大体型通用描述。 */
export function getNPCOutfitDesc(npcName: string): string {
  const src = findCharacter(npcName);
  if (!src?.outfits) {
    const hairDesc = [src?.hair_color, src?.hair_style].filter(Boolean).join("");
    return hairDesc || src?.appearance_brief || "";
  }
  const npc = gameState.npcs[npcName];
  const curAge = npc ? getNpcCurrentAge(src.base_age || 16) : (src.base_age || 16);
  const baseAge = src.base_age || 16;
  const ageGap = Math.abs(curAge - baseAge);

  // 年龄差 >3 且无 outfits_by_age → 用年龄体型的通用描述（防 6 岁穿高中制服）
  if (ageGap > 3 && !src.outfits_by_age) {
    const body = getBodyForAge(src, curAge);
    const h = body?.height_cm || "?";
    if (curAge <= 6) return `${h}cm，穿着儿童便服（${curAge}岁）`;
    if (curAge <= 12) return `${h}cm，穿着小学生校服（${curAge}岁）`;
    if (curAge <= 15) return `${h}cm，穿着中学生校服（${curAge}岁）`;
    // 年龄差大但在高中以上 → 继续走正常路径（成年人穿高中制服没那么违和）
  }

  // 有 outfits_by_age → 按年龄选择对应 outfit key
  let outfitKey: string;
  if (src.outfits_by_age) {
    const keys = Object.keys(src.outfits_by_age).map(Number).sort((a,b) => a-b);
    let best = keys[0]!;
    for (const k of keys) { if (k <= curAge) best = k; else break; }
    outfitKey = src.outfits_by_age[String(best)];
  } else {
    outfitKey = npc?.currentOutfit || "school";
  }
  const outfit = src.outfits[outfitKey];
  if (!outfit) {
    const hairDesc = [src?.hair_color, src?.hair_style].filter(Boolean).join("");
    return hairDesc || src.appearance_brief || "";
  }
  // 分层：内层 vs 外层；跳过已被移除的装备
  const inner: string[] = [];
  const outer: string[] = [];
  // 懒加载 items.json（优先读 worldpacks，fallback 到 data）
  let itemsData = null;
  const getFlavor = (itemName: string) => {
    if (!itemsData) {
      try {
        const wpPath = path.resolve(process.cwd(), "worldpacks", activeWorldName || "oregairu", "items.json");
        if (fs.existsSync(wpPath)) {
          itemsData = JSON.parse(fs.readFileSync(wpPath, "utf-8"));
        } else {
          itemsData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data", "items.json"), "utf-8"));
        }
      } catch { itemsData = {}; }
    }
    return (itemsData as any)[itemName]?.flavor || itemName;
  };
  for (const [slot, item] of Object.entries(outfit)) {
    if (slot === 'desc' || slot === 'hair' || slot === 'acc' || slot === 'head') continue;
    // 检查装备槽：如果对应槽位为空 (undefined) 表示未被交互过，默认穿着；如果显式为 null 表示被剥除
    const equipSlot = npc?.equipment?.[slot as any];
    const isMissing = equipSlot === null;
    const flavor = getFlavor(item as string);
    const label = isMissing ? `${flavor}（已被拿走）` : flavor;
    if (slot.startsWith("inner_")) inner.push(label);
    else outer.push(label);
  }
  const outerStr = outer.join("；");
  if (inner.length > 0) return `外层: ${outerStr}。内层: ${inner.join("；")}`;
  return outerStr;
}

export async function getOrCreateSexState(npcName: string): Promise<SexState | null> {
  gameState.sexStates ??= {};
  if (!gameState.sexStates[npcName]) {
    let SEX_PROFILES: Record<string, any> = {};
    let createSexState: any = null;
    try {
      const sexMod = await import("./sex.ts");
      SEX_PROFILES = sexMod.SEX_PROFILES;
      createSexState = sexMod.createSexState;
    } catch { /* sex.ts not present in public repo */ }
    if (!createSexState) return null;
    let profile = SEX_PROFILES[npcName];
    // 玩家不在 SEX_PROFILES 中 → 按性别构建默认 profile
    if (!profile && npcName === gameState.player.name) {
      const pGender = gameState.player.gender;
      profile = {
        attitude: "期待",
        experience: "熟练",
        likes: [],
        dislikes: [],
        baselineDesire: 30,
        cycleDay: 0,
        climaxThreshold: 60,
        bodyParts: {
          "秘部": { sensitivity: 3, development: 2, preference: "喜欢" as const },
        },
      } as any;
      if (pGender === "女") {
        profile.female = {
          breast: { cup: "B", shape: "半球" as any, nipple_size: "普通" as any, nipple_color: "粉色" as any, areola_size: "普通" as any, feel: "柔软" as any },
          vagina: { type: "闭合" as any, labia_size: "普通" as any, depth_cm: 10, tightness: "普通" as any, inner_color: "淡粉" as any, feel: "普通" as any },
          pubic_hair: { amount: "普通" as any, color: "黑色" as any, style: "自然" as any },
          clitoris: "普通" as any,
        };
      } else {
        profile.male = {
          penis: { length_cm: 14, girth_cm: 10, erect_length_cm: 17, erect_girth_cm: 12, shape: "直" as any, head_size: "普通" as any, circumcised: false, color: "普通" as any },
          testicles: { size: "普通" as any },
          pubic_hair: { amount: "普通" as any, color: "黑色" as any, style: "自然" as any },
        };
      }
    } else if (!profile) {
      // 动态创建角色 / 临时 NPC → 按性别自动生成默认 sex profile
      const char = findCharacter(npcName);
      const charGender = (char as any)?.gender || "女";
      if (char || gameState.npcs[npcName]) {
        profile = {
          attitude: "普通",
          experience: "未开发",
          likes: [],
          dislikes: [],
          baselineDesire: 20,
          cycleDay: 0,
          climaxThreshold: 60,
          bodyParts: {
            "秘部": { sensitivity: 2, development: 0, preference: "喜欢" as const },
            "唇": { sensitivity: 1, development: 0, preference: "喜欢" as const },
            "颈": { sensitivity: 1, development: 0, preference: "喜欢" as const },
            "胸": { sensitivity: 2, development: 0, preference: "喜欢" as const },
            "腰": { sensitivity: 1, development: 0, preference: "喜欢" as const },
            "腿": { sensitivity: 1, development: 0, preference: "喜欢" as const },
            "肛": { sensitivity: 1, development: 0, preference: "排斥" as const },
          },
        } as any;
        if (charGender === "女" || charGender === "female") {
          profile.female = {
            breast: { cup: "B", shape: "半球" as any, nipple_size: "普通" as any, nipple_color: "粉色" as any, areola_size: "普通" as any, feel: "柔软" as any },
            vagina: { type: "闭合" as any, labia_size: "普通" as any, depth_cm: 10, tightness: "普通" as any, inner_color: "淡粉" as any, feel: "普通" as any },
            pubic_hair: { amount: "普通" as any, color: "黑色" as any, style: "自然" as any },
            clitoris: "普通" as any,
          };
        } else {
          profile.male = {
            penis: { length_cm: 14, girth_cm: 10, erect_length_cm: 17, erect_girth_cm: 12, shape: "直" as any, head_size: "普通" as any, circumcised: false, color: "普通" as any },
            testicles: { size: "普通" as any },
            pubic_hair: { amount: "普通" as any, color: "黑色" as any, style: "自然" as any },
          };
        }
      } else {
        return null; // 真的不存在
      }
    }
    gameState.sexStates[npcName] = createSexState(npcName, profile);
  }
  return gameState.sexStates[npcName];
}

/** 时间驱动：推进所有 NPC SexState（欲望累积 + 周期推进 + 自主行为） */
export async function tickSexStates(daysAdvanced: number, minutesPassed: number): Promise<void> {
  if (!gameState.sexStates) return;
  let sexMod: any = null;
  try { sexMod = await import("./sex.ts"); } catch { return; /* sex.ts not present in public repo */ }
  const { getCyclePhase, calcDesire, masturbate } = sexMod;

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

/** 规范化地点名：去掉括号注释、首尾空格、转小写 */
export function normalizeLocationName(s: string): string {
  return s.replace(/[（(].*[）)]/, "").trim().toLowerCase();
}

// 地点导航 / 动态创建 → 已移至 engine/state-location.ts
import { getLocationNav, createDynamicLocation, loadLocationsDelta } from "./state-location.ts";
export { getLocationNav, createDynamicLocation, loadLocationsDelta };
export type { SchoolInternalNode, StationInfo } from "./state-location.ts";

// 空间系统（棋盘格/房间/移动/家具）→ 已移至 engine/state-grid.ts
import {
  stampRoom, getRoomAgingLine, getRoom, getNearbyNPCs, initPlayerGrid,
  movePlayer, createRoom, editCellType, placeFurniture, getItemTemplate,
  removeFurniture, toggleDoor, getFallbackRoom, getRoomCapacity, getGridContext,
} from "./state-grid.ts";
export {
  stampRoom, getRoomAgingLine, getRoom, getNearbyNPCs, initPlayerGrid,
  movePlayer, createRoom, editCellType, placeFurniture, getItemTemplate,
  removeFurniture, toggleDoor, getFallbackRoom, getRoomCapacity, getGridContext,
};

// --- 记忆标签：LLM观察到某事 → 打标签 ---
// --- 记忆标签：LLM观察到某事 → 打标签 ---
/** 将全局大势（WorldState）翻译成自然语言描述 */
export function translateWorldState(ws?: any): string {
  if (!ws) return "";
  const lines: string[] = [];
  if (ws.stability !== undefined) {
    if (ws.stability <= -3) lines.push("【社会大局势】社会秩序全面崩溃，爆发严重冲突与战乱，法律已失效。暴力与混乱成了日常。");
    else if (ws.stability <= -2) lines.push("【社会大局势】战火蔓延，街头可见巡逻兵，物资配给开始受限。人们普遍缺乏安全感。");
    else if (ws.stability <= -1) lines.push("【社会大局势】社会暗流涌动，治安恶化。人们在街上行走时下意识加快了脚步。");
    else if (ws.stability >= 3) lines.push("【社会大局势】处于铁血的高压强力秩序下，军管状态，所有反抗被绝对抹杀。秩序死寂。");
    else if (ws.stability >= 2) lines.push("【社会大局势】社会处于高压秩序下，街头布满监控与警卫，秩序井然得有些压抑。");
  }
  if (ws.tech !== undefined) {
    if (ws.tech >= 5) lines.push("【科技水平】高科技、低生活。赛博朋克风的全息日常，AI与黑客成为常态，资源由技术寡头垄断。");
    else if (ws.tech >= 4) lines.push("【科技水平】虚拟现实和AI已渗透日常生活。全息广告随处可见。");
    else if (ws.tech >= 2) lines.push("【科技水平】一些新奇的技术开始进入民用领域。");
  }
  if (ws.tension !== undefined) {
    if (ws.tension >= 5) lines.push("【危机感】末日终焉即临，所有人陷入彻底的绝望，末日警钟轰鸣，世界危在旦夕。");
    else if (ws.tension >= 4) lines.push("【危机感】人人自危，危机逼近的压抑感弥漫在每个角落。");
  }
  if (ws.prosperity !== undefined) {
    if (ws.prosperity <= -5) lines.push("【社会繁荣度】经济彻底崩溃，大面积企业破产，失业率飙升，民生凋敝。");
    else if (ws.prosperity <= -3) lines.push("【社会繁荣度】处于严重经济衰退期，市场低迷，降薪裁员潮不断，生活成本高企。");
    else if (ws.prosperity <= -1) lines.push("【社会繁荣度】经济增长乏力，部分行业低迷，居民消费趋于保守。");
    else if (ws.prosperity >= 5) lines.push("【社会繁荣度】经济极度繁荣狂热，资本涌流，各行各业欣欣向荣。");
    else if (ws.prosperity >= 3) lines.push("【社会繁荣度】经济处于景气繁荣期，就业充足，市场信心强劲。");
    else if (ws.prosperity >= 1) lines.push("【社会繁荣度】经济稳步增长，商业活动活跃。");
  }
  if (ws.regime) lines.push(`【政治体制】${ws.regime}`);
  if (ws.economy_type) lines.push(`【经济体制】${ws.economy_type}`);
  if (ws.diplomacy_stance) lines.push(`【地缘外交】${ws.diplomacy_stance}`);
  return lines.join("\n");
}

/** 动态级联合并地理层级的天空盒默认值 */
export function getMergedWorldState(location: string): WorldState {
  if (!_regionContexts) {
    _regionContexts = loadWorldpackDirRecursive("locations", "region_contexts.json");
  }

  // 运行时 worldState 为权威底值（事件/自转可动态修改）
  const base: WorldState = {
    tech: gameState.worldState?.tech ?? 0,
    stability: gameState.worldState?.stability ?? 0,
    tension: gameState.worldState?.tension ?? 0,
    prosperity: gameState.worldState?.prosperity ?? 0,
    regime: gameState.worldState?.regime ?? "未知体制",
    economy_type: gameState.worldState?.economy_type ?? "未知经济型",
    diplomacy_stance: gameState.worldState?.diplomacy_stance ?? "未知外交立场",
    globalFlags: { ...(gameState.worldState?.globalFlags || {}) }
  };

  let breadcrumbs: string[] = [];
  try {
    const nav = getLocationNav(location);
    if (nav && nav.breadcrumb) { breadcrumbs = [...nav.breadcrumb]; }
  } catch (e) {}
  if (breadcrumbs.length === 0) { breadcrumbs = [location]; }

  // tier 优先级: global=0 national=1 regional=2 local=3 site=4（数字越大越底层，越不能覆盖上层数值）
  const TIER_RANK: Record<string, number> = { global: 0, national: 1, regional: 2, local: 3, site: 4 };
  const numericSourceTier: Record<string, number> = {}; // 哪个 tier 设置了 prosperity/stability/tension/tech

  // 自下而上遍历 breadcrumb（子节点先，父节点后——较上层后应用，覆盖下层数值）
  const reversed = [...breadcrumbs].reverse();

  for (const node of reversed) {
    const nodeLower = node.toLowerCase();

    // 最长 key 精确匹配
    let bestMatchKey: string | null = null;
    let bestMatchData: any = null;
    let bestMatchLen = 0;
    for (const [rk, data] of Object.entries(_regionContexts)) {
      for (const k of (data?.keys || [])) {
        const kl = k.toLowerCase();
        if (nodeLower.includes(kl) || kl.includes(nodeLower)) {
          if (kl.length > bestMatchLen) {
            bestMatchLen = kl.length;
            bestMatchKey = rk;
            bestMatchData = data;
          }
        }
      }
    }

    if (!bestMatchData?.skybox_defaults) continue;

    // 跳过日本根节点（national 级 skybox 在 createInitialState 已加载为 worldState 底值）
    if (bestMatchKey === "日本" || bestMatchKey === "japan") continue;

    const sd = bestMatchData.skybox_defaults;
    const tier = sd.tier || "site"; // 无 tier 声明的视为 site（最底层），数值继承上级
    const tierRank = TIER_RANK[tier] ?? 99;

    // 字符串字段——总是允许覆盖（描述本地特征，上层不需要保护）
    if (sd.regime !== undefined) base.regime = sd.regime;
    if (sd.economy_type !== undefined) base.economy_type = sd.economy_type;
    if (sd.diplomacy_stance !== undefined) base.diplomacy_stance = sd.diplomacy_stance;

    // 数值字段——只允许较高 tier（更宏观）覆盖较低 tier（更局部）
    // 即：国家 > 地区 > 省市 > 城区 > 具体地点。site 不能改 local 设的 prosperity
    for (const numField of ["prosperity", "stability", "tension", "tech"]) {
      if (sd[numField] !== undefined) {
        const prevSourceRank = numericSourceTier[numField] ?? 99;
        if (tierRank <= prevSourceRank) {
          base[numField] = sd[numField];
          numericSourceTier[numField] = tierRank;
        }
      }
    }
  }

  return base;
}
/** 获取匹配某 location 节点的 tier（从 skybox_defaults.tier 读取） */
export function getLocationTier(location: string): string {
  if (!_regionContexts) {
    _regionContexts = loadWorldpackDirRecursive("locations", "region_contexts.json");
  }
  let bestTier = "site"; let bestLen = 0;
  const locLower = location.toLowerCase();
  for (const [rk, data] of Object.entries(_regionContexts)) {
    for (const k of (data?.keys || [])) {
      const kl = k.toLowerCase();
      if (locLower.includes(kl) && kl.length > bestLen) {
        bestLen = kl.length;
        if (data?.skybox_defaults?.tier) bestTier = data.skybox_defaults.tier;
      }
    }
  }
  return bestTier;
}

/** 层级映射: org scale → location tier 的参与权限
 *  national → 可参与所有层级
 *  regional → regional/local/site
 *  local    → local/site
 *  club     → 只能 site; social/culture 可跨一级到 local
 */
export function canOrgActAtTier(orgScale: string, targetTier: string, orgSector?: string): { allowed: boolean; reason: string } {
  const SCALE_RANK: Record<string, number> = { national: 0, regional: 1, local: 2, club: 3 };
  const TIER_RANK: Record<string, number> = { global: 0, national: 0, regional: 1, local: 2, site: 3 };
  const orgRank = SCALE_RANK[orgScale] ?? 99;
  const tierRank = TIER_RANK[targetTier] ?? 99;
  if (orgRank <= tierRank) return { allowed: true, reason: "同等级或上级——可直接参与" };
  if (orgScale === "club" && targetTier === "local" && (orgSector === "social" || orgSector === "culture")) {
    return { allowed: true, reason: "社团的社会/文化影响力可渗透到地方层级" };
  }
  return { allowed: false, reason: orgScale + "级势力无法直接参与" + targetTier + "级事务——需通过 parent_org 链中的上级组织间接干涉" };
}

/** 获取当前地点活跃的组织列表（按层级过滤 + 声望排序） */
/** 获取当前地点活跃的组织列表（多重判定：声明+领土+成员在场+阶级基本盘）
 *  relevance: "大本营" > "控制" > "主导(声明)" > "在场(成员)" > "参与(同tier)" > "旁観(上级)"
 *  同级同sector组织之间产生竞争信号（relations<0→对抗, relations>0→合作）
 */
export function getActiveOrgsForLocation(location: string): {
  orgId: string; name: string;
  relevance: "大本营" | "控制" | "主导" | "在场" | "参与" | "旁観";
  sector: string; playerRep: number; tier: string;
  scale?: string; lifecycle_stage?: string;
  rivalries?: { orgId: string; name: string; relation: number; cause: string }[];
}[] {
  const tier = getLocationTier(location);
  const orgs = gameState.organizations;
  if (!orgs) return [];

  // ── 1. 多重判定 relevance ──
  const result: any[] = [];
  const governingSet = new Set<string>();

  // breadcrumb 链匹配 governing_orgs
  let govBreadcrumbs = [location];
  try { const nav = getLocationNav(location); if (nav?.breadcrumb) govBreadcrumbs = [...nav.breadcrumb]; } catch (e) {}
  if (_regionContexts) {
    for (const [rk, data] of Object.entries(_regionContexts)) {
      if (!data?.governing_orgs) continue;
      const matched = data.keys?.some(k => govBreadcrumbs.some(b => b.includes(k) || k.includes(b)));
      if (matched) { for (const gov of data.governing_orgs) { governingSet.add(gov.orgId); } }
    }
  }

  // 获取当前地点的在场 NPC 列表
  const presentNPCs = new Set<string>();
  if (gameState.npcs) {
    for (const [name, npc] of Object.entries(gameState.npcs)) {
      if ((npc as any).currentRoom && isSameLocation((npc as any).currentRoom, location)) {
        presentNPCs.add(name);
      }
    }
  }

  for (const [id, org] of Object.entries(orgs)) {
    const check = canOrgActAtTier(org.scale || "club", tier, org.sector);
    if (!check.allowed) continue;

    const rep = gameState.player.reputation?.[id] ?? 0;
    let relevance = "参与" as any;

    // 判定优先级：大本营 > 领土控制 > 声明主导 > 成员在场 > 同tier参与 > 上级旁观
    if (org.coreLocation && isSameLocation(org.coreLocation, location)) {
      relevance = "大本营";
    } else if (org.territoryRoomKeys?.some((r: string) => isSameLocation(r, location))) {
      relevance = "控制";
    } else if (governingSet.has(id)) {
      relevance = "主导";
    } else if (org.members?.some((m: any) => presentNPCs.has(m.npcName))) {
      relevance = "在场";
    } else if (check.reason.includes("上级")) {
      relevance = "旁観";
    }

    result.push({ orgId: id, name: org.name, relevance, sector: org.sector || "unknown", playerRep: rep, tier: org.scale || "club", scale: org.scale, lifecycle_stage: org.lifecycle_stage || "初创" });
  }

  // ── 2. 同级同 sector 竞争检测 ──
  for (const entry of result) {
    if (entry.relevance === "旁観") continue; // 上级旁观者不参与同级竞争
    const rivals: any[] = [];
    for (const other of result) {
      if (other.orgId === entry.orgId) continue;
      if (other.tier !== entry.tier) continue; // 不同层级不构成直接竞争
      if (other.sector !== entry.sector) continue; // 不同部门不构成直接竞争
      // 查 org 间 relations
      const org = orgs[entry.orgId];
      const rel = org?.relations?.[other.orgId] ?? 0;
      const cause = rel < 0 ? "sector冲突：同属" + entry.sector + "部门，利益直接对立" :
                    rel > 0 ? "sector合作：同属" + entry.sector + "部门，共同维护行业利益" :
                    "sector共存：同属" + entry.sector + "部门，当前关系中性";
      rivals.push({ orgId: other.orgId, name: other.name, relation: rel, cause });
    }
    if (rivals.length > 0) entry.rivalries = rivals;
  }

  // ── 3. 排序 ──
  const relOrder: Record<string, number> = { "大本营": 0, "控制": 1, "主导": 2, "在场": 3, "参与": 4, "旁観": 5 };
  result.sort((a, b) => { const d = relOrder[a.relevance] - relOrder[b.relevance]; return d !== 0 ? d : Math.abs(b.playerRep) - Math.abs(a.playerRep); });

  return result;
}
export function addMemoryTag(
  npcName: string,
  tag: string,
  expiresDays: number = 365,
  tone?: string,
  priority?: number,
  emotional_valence?: "positive" | "negative" | "neutral",
  related_npcs?: string[],
  category?: "fact" | "emotion" | "milestone" | "general"
): void {
  let stainedTag = tag;
  if (gameState.worldState) {
    const ws = gameState.worldState;
    const elements: string[] = [];
    if (ws.stability !== undefined && ws.stability < 0) elements.push("局势动荡");
    if (ws.tension !== undefined && ws.tension >= 4) elements.push("人人自危");
    if (ws.tech !== undefined && ws.tech >= 4) elements.push("AI渗透");
    if (elements.length > 0) {
      stainedTag += `（但在${elements.join("、")}的背景下）`;
    }
  }

  // 玩家记忆写入 player.memories，绝不污染 npcs 表
  if (npcName === gameState.player.name) {
    gameState.player.memories ??= [];
    gameState.player.memories.push({
      tag: stainedTag,
      since: gameState.time.game_date,
      expires: expiresDays,
      tone: tone as any,
      priority: priority ?? 1,
      emotional_valence: emotional_valence ?? "neutral",
      related_npcs: related_npcs ?? [],
      category: category ?? "general"
    });
    return;
  }
  const npc = getOrCreateNPC(npcName);
  npc.memoryTags ??= [];
  npc.memoryTags.push({
    tag: stainedTag,
    since: gameState.time.game_date,
    expires: expiresDays,
    tone: tone as any,
    priority: priority ?? 1,
    emotional_valence: emotional_valence ?? "neutral",
    related_npcs: related_npcs ?? [],
    category: category ?? "general"
  });
  // 容量上限：超过 50 条则只保留最近 30 条
  if (npc.memoryTags.length > 50) {
    npc.memoryTags = npc.memoryTags.slice(-30);
  }
}

export function getMemoryTags(npcName: string): string[] {
  const npc = gameState.npcs[npcName];
  if (!npc?.memoryTags) return [];
  return npc.memoryTags.slice(-5).map(t => `${t.tag}${t.tone ? ` [${t.tone}]` : ""}`);
}

export function recallRelevantMemories(
  npcName: string,
  context: { location: string; presentNPCs: string[]; topic?: string }
): string[] {
  const npc = gameState.npcs[npcName];
  if (!npc?.memoryTags || npc.memoryTags.length === 0) return [];

  const currentDate = gameState.time?.game_date ? new Date(gameState.time.game_date).getTime() : Date.now();
  const ONE_DAY_MS = 86400000;

  // 1. 过滤已过期标签
  const activeTags = npc.memoryTags.filter(t => {
    const time = new Date(t.since).getTime();
    if (isNaN(time)) return true; // 无法解析时间则安全保留
    const daysSince = (currentDate - time) / ONE_DAY_MS;
    return daysSince < t.expires;
  });

  if (activeTags.length === 0) return [];

  // 2. 打分排序
  const scoredTags = activeTags.map((t, index) => {
    let score = (t.priority ?? 1) * 10;

    // 命中在场其他 NPC：求 presentNPCs ∩ related_npcs 的交集长度
    if (t.related_npcs && t.related_npcs.length > 0 && context.presentNPCs && context.presentNPCs.length > 0) {
      const intersectCount = context.presentNPCs.filter(p => t.related_npcs!.includes(p)).length;
      score += intersectCount * 8;
    }

    // 命中当前位置
    if (context.location && t.tag.includes(context.location)) {
      score += 5;
    }

    // 分类加分
    if (t.category === "milestone") {
      score += 6;
    } else if (t.category === "emotion") {
      score += 4;
    } else if (t.category === "fact" && context.location && t.tag.includes(context.location)) {
      score += 3;
    }

    // 新近度时间衰减：按索引渐进加分，最远 0，最近 +3 
    const recencyBonus = Math.min(3, (index / Math.max(1, activeTags.length - 1)) * 3);
    score += recencyBonus;

    // 场景话题语义匹配（可选）
    if (context.topic && t.tag.includes(context.topic)) {
      score += 5;
    }

    return { tag: t, score };
  });

  // 降序排序
  scoredTags.sort((a, b) => b.score - a.score);

  // 取前三条最相关的长期记忆
  const topTags = scoredTags.slice(0, 3).map(st => st.tag);

  return topTags.map(t => `${t.tag}${t.tone ? ` [${t.tone}]` : ""}`);
}

export function appendShortTermBuffer(
  npcName: string,
  exchange?: string,
  event?: string
): void {
  const npc = getOrCreateNPC(npcName);
  npc.shortTermBuffer ??= { recentExchanges: [], recentEvents: [] };
  npc.shortTermBuffer.recentExchanges ??= [];
  npc.shortTermBuffer.recentEvents ??= [];

  if (exchange) {
    npc.shortTermBuffer.recentExchanges.push(exchange);
    if (npc.shortTermBuffer.recentExchanges.length > 10) {
      npc.shortTermBuffer.recentExchanges.shift();
    }
  }

  if (event) {
    npc.shortTermBuffer.recentEvents.push(event);
    if (npc.shortTermBuffer.recentEvents.length > 5) {
      npc.shortTermBuffer.recentEvents.shift();
    }
  }
}

// --- 组织声望桥接辅助 ---

/** 通过 scheduleGroup 名/组织名/orgId 查找关联的 orgId */
export function resolveOrgIdForGroup(group: string): string | null {
  const orgs = gameState.organizations;
  if (!orgs) return null;
  // 1. 直接 orgId 匹配
  if (orgs[group]) return group;
  // 2. 名称匹配
  for (const [id, org] of Object.entries(orgs)) {
    if (org.name === group) return id;
  }
  // 3. match_rules.schedule_groups 匹配
  const groupLower = group.toLowerCase();
  for (const [id, org] of Object.entries(orgs)) {
    if (org.match_rules?.schedule_groups) {
      if (org.match_rules.schedule_groups.some(sg => sg.toLowerCase() === groupLower)) return id;
    }
  }
  return null;
}

/** 检查目标 roomKey 是否是某势力的核心区，返回该势力 id 或 null */
export function getOrgForTerritory(roomKey: string): string | null {
  // 1. 优先查 rooms.json 中房间是否指定 controlled_by
  try {
    const room = getRoom(roomKey);
    if (room && room.controlled_by) {
      return room.controlled_by;
    }
  } catch (e) {}

  // 2. 其次查 organizations 中的 territoryRoomKeys
  const orgs = gameState.organizations;
  if (!orgs) return null;
  const rk = roomKey.toLowerCase();
  for (const [id, org] of Object.entries(orgs)) {
    if (org.territoryRoomKeys?.some(t => t.toLowerCase() === rk)) return id;
  }
  return null;
}

/** 查找 NPC 所属的所有组织 ID */
export function getOrgMembershipsForNpc(npcName: string): string[] {
  const orgs = gameState.organizations;
  if (!orgs) return [];
  const result: string[] = [];
  for (const [id, org] of Object.entries(orgs)) {
    if (org.members?.some(m => m.npcName === npcName)) {
      result.push(id);
    }
  }
  return result;
}

// --- 多维声望 ---
export function updateReputation(group: string, delta: number): number {
  if (!gameState.player.reputation[group]) gameState.player.reputation[group] = 0;
  const oldVal = gameState.player.reputation[group];
  const newVal = Math.max(-3, Math.min(5, oldVal + delta));
  gameState.player.reputation[group] = newVal;

  // 声望桥接：将 scheduleGroup 声望变化同步到对应 orgId，并支持嵌套传导
  const orgId = resolveOrgIdForGroup(group) || (gameState.organizations?.[group] ? group : null);
  if (orgId) {
    if (!gameState.player.reputation[orgId]) gameState.player.reputation[orgId] = 0;
    gameState.player.reputation[orgId] = Math.max(-3, Math.min(5, gameState.player.reputation[orgId] + delta));
    
    // 嵌套组织声望传导：子组织声望波动按 20% 传导到父组织
    const orgObj = gameState.organizations?.[orgId];
    if (orgObj && orgObj.parent_org) {
      const parentId = orgObj.parent_org;
      if (!gameState.player.reputation[parentId]) gameState.player.reputation[parentId] = 0;
      gameState.player.reputation[parentId] = Math.max(-3, Math.min(5, gameState.player.reputation[parentId] + delta * 0.2));
    }
  }

  // 检测跨越 ±1, ±2, ±3 阈值
  const thresholdCrossed = (val1: number, val2: number) => {
    for (const t of [-3, -2, -1, 1, 2, 3]) {
      if ((val1 < t && val2 >= t) || (val1 > t && val2 <= t)) return true;
    }
    return false;
  };

  if (thresholdCrossed(oldVal, newVal)) {
    // 寻找最相关的 NPC 演这场戏
    let bestNpc = "旁白";
    let maxAffection = -1;
    for (const [npcName, npc] of Object.entries(gameState.npcs) as [string, any][]) {
      const rel = gameState.player.relationships[npcName];
      const aff = rel?.affection ?? 0;

      if (npcBelongsToOrg(npcName, npc, group) && aff > maxAffection) {
        maxAffection = aff;
        bestNpc = npcName;
      }
    }

    const goingUp = newVal > oldVal;
    const absVal = Math.abs(newVal);

    // ── 基调：声望搞低→负基调，声望搞高→正基调 ──
    const toneByLevel: Record<number, { up: string; down: string }> = {
      0: { up: "淡淡的好感，像微风一样轻盈", down: "旁观的淡漠——没人真的在意" },
      1: { up: "悄悄的关注，偶尔有人在走廊回头看一眼", down: "微妙的距离——敬而远之，但不至于敌意" },
      2: { up: "轻轻的认可，有人开始主动搭话", down: "明显的警惕，窃窃私语时会在背后压低声量" },
      3: { up: "真切的仰慕，校园里流传着关于你的传说", down: "公开的排斥，你走过的地方眼神都在躲闪" },
      4: { up: "炽热的目光追随，你的名字挂在每个人的嘴边", down: "深深的忌惮，有人开始主动绕路避开你所在的走廊" },
      5: { up: "无声的致敬——你在圈子里的地位已无可撼动", down: "恐惧与敌意的漩涡，传言越滚越大" },
    };
    const levelTone = toneByLevel[absVal] || toneByLevel[1]!;
    const tone = goingUp ? levelTone.up : levelTone.down;

    gameState._cutaway_queue ??= [];
    gameState._cutaway_queue.push({
      type: goingUp ? "上升" : "下降",
      npc: bestNpc,
      weight: 50,
      trigger: goingUp
        ? `玩家的${group}声望升至${newVal}，圈子内开始关注`
        : `玩家的${group}声望跌至${newVal}，引起了周围人的反应`,
      tone,
      topic: goingUp
        ? `TA怎么会这样看待这个变化？这份关注是欣慰、好奇，还是隐隐的不安？`
        : `TA对玩家的看法被这件事染上了什么颜色？是失望、警惕，还是一丝幸灾乐祸？`,
    });
  }

  saveState();
  return newVal;
}

/** 服装声望加成：扫描当前装备中的reputation_bonus */
export function calcReputationBonus(group: string): number {
  let bonus = 0;
  for (const item of Object.values(gameState.player.equipment)) {
    if (!item?.effects) continue;
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

function getPriceMultiplier(): number {
  const stability = gameState.worldState?.stability ?? 0;
  const prosperity = gameState.worldState?.prosperity ?? 0;
  
  if (stability < 0 && prosperity < 0) {
    // 萧条且动荡 -> 通货膨胀 (物价上涨)
    return 1 + Math.abs(stability) * 0.15;
  } else if (prosperity < 0) {
    // 萧条但稳定 -> 通货紧缩 (物价下跌)
    return 1 + prosperity * 0.05;
  } else if (prosperity > 0) {
    // 景气繁荣 -> 物价小幅上涨
    return 1 + prosperity * 0.05;
  }
  return 1.0;
}

function validatePrice(itemName: string, price: number): string | null {
  let itemType = "tool";
  let found = false;
  for (const [cat, items] of Object.entries(itemsCatalog)) {
    if ((items as any)[itemName]) {
      itemType = cat === "consumables" ? "consumable" : cat === "weapons" ? "weapon" : cat === "armor" ? "armor" : cat === "clothing" ? "clothing" : "tool";
      found = true;
      break;
    }
  }
  const mult = getPriceMultiplier();
  // 目录外物品（LLM 现编/合成，如"笔记本电脑"）：引擎不知其"合理价"——那是叙事判断，交 LLM。
  // 只防非正/离谱天价，不套按类型的窄区间（否则会把贵重物卡在便宜类的上限里）。
  const [baseMin, baseMax] = found ? (PRICE_RANGE[itemType] || [10, 50000]) : [1, 10_000_000];
  const min = Math.round(baseMin * mult);
  const max = Math.round(baseMax * mult);
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

  // 货架不再硬拒——"这店卖不卖 X"是叙事判断（LLM 的活，不是守恒量）。
  // 引擎只守价格/钱/物；shopName 仅用于 flavor 叙事。
  // 物品不在 itemsCatalog（含 LLM 现编的商品）→ 合成基础数据。
  if (!itemData) {
    itemData = {
      name: itemName,
      type: "consumable",
      slot: "back",
      weight: 0.2,
      effects: [],
      state: "intact",
      volume: 0.3,
      flavor: shopName ? `${shopName}售卖的${itemName}` : itemName,
    };
  }

  if (!itemData) return `LLM必须指定有效物品名`;

  const err = validatePrice(itemName, price);
  if (err) return err;
  
  const mult = getPriceMultiplier();
  const scaledPrice = Math.round(price * mult);

  // 魅力谈判：高魅力砍价
  const chaBonus = attrMod(gameState.player.attributes.魅力);
  const discount = Math.round(scaledPrice * chaBonus * 0.01);
  const finalPrice = Math.max(scaledPrice - discount, scaledPrice * 0.85);
  const currencySymbol = getCurrency();
  if (gameState.player.funds < finalPrice) return `钱不够。需要${currencySymbol}${finalPrice}，余额${currencySymbol}${gameState.player.funds}`;
  gameState.player.funds -= finalPrice;
  gameState.player.inventory.push(structuredClone(itemData));
  saveState();
  const discountStr = discount > 0 ? ` (魅力砍价-${currencySymbol}${discount})` : "";
  const scalingStr = mult !== 1.0 ? ` (因社会环境物价波动系数: ${mult.toFixed(2)})` : "";
  return `买了${itemName}，花费${currencySymbol}${finalPrice}${discountStr}${scalingStr}。余额${currencySymbol}${gameState.player.funds}`;
}

export function sellItem(itemName: string, price: number, buyerName?: string, shopName?: string): string {
  const idx = gameState.player.inventory.findIndex(i => i.name === itemName);
  if (idx < 0) return `背包里没有${itemName}`;

  // 卖给谁/店收不收——叙事判断交 LLM，引擎不拦（原货架"不收"硬拒已移除）。
  // 守恒仍在：上面已校验"背包里得真有这件"，下面校验价格 + 买家钱够。

  const err = validatePrice(itemName, price);
  if (err) return err;
  
  const mult = getPriceMultiplier();
  const scaledPrice = Math.round(price * mult);

  // 魅力谈判：高魅力卖更高价
  const chaBonus = attrMod(gameState.player.attributes.魅力);
  const premium = Math.round(scaledPrice * chaBonus * 0.005);
  const finalPrice = Math.min(scaledPrice + premium, scaledPrice * 1.1);
  const currencySymbol = getCurrency();
  // 卖方：NPC 作为买家时用总身家（银行存款+现金）付款，先扣现金再扣存款
  if (buyerName) {
    const npc = getOrCreateNPC(buyerName);
    const total = npc.cash + npc.wealth;
    if (total < finalPrice) return `${buyerName}只有${currencySymbol}${total}，买不起${currencySymbol}${finalPrice}的${itemName}`;
    if (npc.cash >= finalPrice) { npc.cash -= finalPrice; }
    else { npc.wealth -= (finalPrice - npc.cash); npc.cash = 0; }
  }
  gameState.player.inventory.splice(idx, 1);
  gameState.player.funds += finalPrice;
  saveState();
  const buyerMsg = buyerName ? `（卖给${buyerName}）` : "";
  const premiumStr = premium > 0 ? ` (魅力谈价+${currencySymbol}${premium})` : "";
  const scalingStr = mult !== 1.0 ? ` (因社会环境物价波动系数: ${mult.toFixed(2)})` : "";
  return `卖了${itemName}${buyerMsg}，获得${currencySymbol}${finalPrice}${premiumStr}${scalingStr}。余额${currencySymbol}${gameState.player.funds}`;
}

export function workJob(jobName: string, hours: number): string {
  const rates = economyConfig.job_rates as Record<string, number>;
  const rate = rates[jobName] || 900;
  
  // 根据全局繁荣度计算时薪（直接读 runtime worldState，响应事件/自转的动态修改）
  const prosperity = gameState.worldState?.prosperity ?? 0;
  const multiplier = 1 + prosperity * 0.05;
  const finalRate = Math.round(rate * multiplier);
  
  const pay = finalRate * hours;
  gameState.player.funds += pay;
  saveState();
  const currencySymbol = getCurrency();
  const recessionHint = prosperity < 0 ? ` (因经济不景气时薪由${rate}降为${finalRate})` : prosperity > 0 ? ` (因经济景气时薪由${rate}升为${finalRate})` : "";
  return `工作${hours}小时（${jobName}），获得${currencySymbol}${pay}${recessionHint}。余额${currencySymbol}${gameState.player.funds}`;
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
export let sexProfilesData: any = {};
const TEMPLATES = scheduleTemplates as any;


export async function updateNPCSchedules(): Promise<string[]> {
  const events: string[] = [];
  const { time_of_day, day_of_week } = gameState.time;
  const isWeekend = ["土", "日"].includes(day_of_week);
  
  // 当前时段 → 模板key（通用 + 星期前缀）
  const slotMap: Record<string, string> = {
    "morning": "morning",
    "lunch": "lunch",
    "afternoon": "afternoon",
    "evening": "evening",
    "night": "evening",
  };
  const slot = slotMap[time_of_day] || "morning";
  const timeKey = isWeekend ? "weekend" : `weekday_${slot}`;
  // 星期前缀 key: 月_afternoon, 水_afternoon, 金_evening 等 → 引擎先查这个
  const dayKey = isWeekend ? "weekend" : `${day_of_week}_${slot}`;
  
  // 房间容量计数器，初始化玩家所在位置人数
  const roomCounts: Record<string, number> = {};
  if (gameState.player.location) {
    const pLocKey = getRoomKey(gameState.player.location) || gameState.player.location;
    roomCounts[pLocKey] = 1;
  }

  // P1: Apply calendar org_effects before normal schedule processing
  try {
    await applyOrgEffects();
  } catch (e) {
    console.error("applyOrgEffects error:", e);
  }

  // 假期/长假: 日历 multi-day schedule_override
  const activeOverrides = await getActiveScheduleOverrides();

  for (const [name, npc] of Object.entries(gameState.npcs)) {
    // 队友跟随移动，屏蔽日程计算
    if (gameState.player.party && gameState.player.party.includes(name)) {
      npc.currentRoom = gameState.player.location;
      npc.gridPos = null;
      npc.action = "跟随玩家";
      continue;
    }

    // 旧存档修复：用 schedule_group_by_age 重解析 scheduleGroup
    const _src2 = findCharacter(name);
    if (_src2?.schedule_group_by_age) {
      const _age2 = getNpcCurrentAge((_src2 as any).base_age || 16);
      const _corrected2 = resolveScheduleGroup(_src2, _age2);
      if (npc.scheduleGroup !== _corrected2) npc.scheduleGroup = _corrected2;
    }
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
    
    // 优先 override > 群体模板 > 旧 schedule（星期前缀优先）
    let targetRoom: string | null = null;
    if (npc.scheduleOverrides?.[dayKey] || npc.scheduleOverrides?.[timeKey]) {
      targetRoom = npc.scheduleOverrides[dayKey] || npc.scheduleOverrides[timeKey];
    } else if (src?.schedule_overrides?.[dayKey] || src?.schedule_overrides?.[timeKey]) {
      targetRoom = src.schedule_overrides[dayKey] || src.schedule_overrides[timeKey];
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
      // 优先星期前缀（月_afternoon / 水_afternoon / 金_evening），回退通用 weekday_xxx
      let routeStr = tpl?.[dayKey] || tpl?.[timeKey];
      if (tpl) {
        const season = getSeason(gameState.time.game_date);
        const wKey = mapChineseWeather(gameState.weather?.type || "晴");
        // weather_overrides/seasonal_overrides 同样优先星期前缀
        if (tpl.weather_overrides?.[wKey]?.[dayKey]) {
          routeStr = tpl.weather_overrides[wKey][dayKey];
        } else if (tpl.weather_overrides?.[wKey]?.[timeKey]) {
          routeStr = tpl.weather_overrides[wKey][timeKey];
        } else if (tpl.seasonal_overrides?.[season]?.[dayKey]) {
          routeStr = tpl.seasonal_overrides[season][dayKey];
        } else if (tpl.seasonal_overrides?.[season]?.[timeKey]) {
          routeStr = tpl.seasonal_overrides[season][timeKey];
        }
      }
      if (routeStr) {
        const opts = routeStr.split("/");
        targetRoom = opts[Math.floor(Math.random() * opts.length)].trim();
      }

      // 假期/长假覆盖: calendar schedule_override 覆写模板决议结果
      if (targetRoom && activeOverrides[effectiveGroup]) {
        targetRoom = activeOverrides[effectiveGroup];
      }
    }

    if (targetRoom === "不在日本") {
      npc.currentRoom = "";
      npc.gridPos = null;
      events.push(`${name}: 离境（不在日本），暂时退出当前世界线`);
      continue;
    }
    if (!targetRoom || targetRoom === "自由") continue;

    // 先决议世界级位置关键词，再走 getRoomKey（否则 getRoomKey("自宅") 会模糊匹配到别人的房间）
    let resolvedTarget = targetRoom;
    if (targetRoom === "自宅" || targetRoom === "下校") {
      const src = (characters as any[]).find((c: any) => c.name === name);
      let defaultLoc = (src as any)?.default_location || npc.currentRoom || "";
      // default_location_by_age: 住址随年龄变化（如 6岁→雪之下邸, 15岁→海浜幕張）
      if ((src as any)?.default_location_by_age) {
        const byAge = (src as any).default_location_by_age;
        const curAge = getNpcCurrentAge(src.base_age || 16);
        const keys = Object.keys(byAge).map(Number).sort((a, b) => a - b);
        let best = byAge[String(keys[0])];
        for (const k of keys) { if (k <= curAge) best = byAge[String(k)]; else break; }
        defaultLoc = best || defaultLoc;
      }
      resolvedTarget = defaultLoc;
    }

    let matchedRoom = getRoomKey(resolvedTarget);
    if (!matchedRoom) {
      // 不在网格中 → 世界级位置，直接移动
      if (resolvedTarget && resolvedTarget !== npc.currentRoom) {
        const old = npc.currentRoom;
        npc.currentRoom = resolvedTarget;
        npc.gridPos = null;
        events.push(`${name}: ${old} → ${resolvedTarget}`);
      }
      continue;
    }

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

    // 物理碰撞：门关了/出口格被占 → 拦住（CellData.block 框架落地）
    let doorBlocked = false;
    if (npc.currentRoom !== finalRoom && npc.gridPos) {
      const curRoom = ROOMS[npc.currentRoom];
      if (curRoom) {
        const pGrid = gameState.player.gridPos;
        const playerHere = gameState.player.location === npc.currentRoom;
        for (let y = 0; y < curRoom.cells.length && !doorBlocked; y++) {
          const row = curRoom.cells[y];
          if (!row) continue;
          for (let x = 0; x < row.length && !doorBlocked; x++) {
            const cell = row[x];
            if (!cell) continue;
            if ((cell.type === "exit" || cell.type === "door") && cell.exitTo) {
              const exitKey = getRoomKey(cell.exitTo);
              const finalKey = getRoomKey(finalRoom);
              if (!exitKey || !finalKey || exitKey !== finalKey) continue;

              if (cell.isOpen === false) {
                events.push(`[日程受阻] ${name}: ${npc.currentRoom}→${finalRoom}的门${cell.locked ? "锁着" : "关着"}，${name}无法离开`);
                doorBlocked = true; break;
              }
              if (playerHere && pGrid && pGrid[0] === x && pGrid[1] === y) {
                events.push(`[日程受阻] ${name}: ${npc.currentRoom}→${finalRoom}的出口被玩家挡住，${name}无法通过`);
                doorBlocked = true; break;
              }
              if (cell.furniture && cell.block) {
                events.push(`[日程受阻] ${name}: ${npc.currentRoom}→${finalRoom}的出口被${cell.furniture}堵住`);
                doorBlocked = true; break;
              }
              if (doorBlocked) break;
            }
          }
        }
      }
    }
    if (doorBlocked) continue;

    // 通勤提示：NPC跨区域移动时经过车站/电车
    if (npc.currentRoom !== finalRoom && npc.currentRoom && finalRoom) {
      const fromZone = getLocationZone(npc.currentRoom);
      const toZone = getLocationZone(finalRoom);
      const commuteHours = time_of_day === "morning" || time_of_day === "afternoon";
      if (fromZone === "residential" && toZone === "school" && commuteHours) {
        events.push(`[通勤] ${name}: ${npc.currentRoom} → 🚃车站/电车 → ${finalRoom}`);
      } else if (fromZone === "school" && toZone === "residential" && commuteHours) {
        events.push(`[放学] ${name}: ${npc.currentRoom} → 🚃回家路上 → ${finalRoom}`);
      }
    }

    // 移动（门开着或不在网格房间则正常执行）
    if (npc.currentRoom !== finalRoom) {
      const oldRoom = npc.currentRoom;
      if (isSameLocation(oldRoom, gameState.player.location)) {
        events.push(`[离场] ${name}离开了${oldRoom}，前往${finalRoom}`);
      }
      npc.currentRoom = finalRoom;
      npc.gridPos = ROOMS[finalRoom]?.origin || null;
      events.push(`${name}: ${oldRoom} → ${finalRoom}`);
    }
  }
  
  // 公共区域填充：用 getNamelessNPCs（有地点/时段/区域过滤）
  const publicRoomNames = ["中庭", "1F南走廊", "2F南走廊-J班前", "2F南走廊-F班前"];
  for (const rn of publicRoomNames) {
    const room = ROOMS[rn];
    if (!room) continue;
    const nameless = getNamelessNPCs(rn, gameState.turn || 1);
    for (const n of nameless) {
      events.push(`[路人: ${n.act}]: ${rn}`);
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
    const pd = getPlayerPhoneData(gameState);
    if (pd) {
      syncContactsFromRelationships(gameState, pd);
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
            deliverMessage(gameState, pd, name, gameState.player.name,
              templates[Math.floor(Math.random() * templates.length)]);
          }
        }
        const meetMatch = ev.match(/^(.+?)和(.+?)在(.+?)碰面/);
        if (meetMatch) {
          const [, a, b, loc] = meetMatch;
          const relA = gameState.player.relationships[a];
          if (relA && relA.affection >= 40 && Math.random() < 0.4) {
            deliverMessage(gameState, pd, a, gameState.player.name, `刚在${loc}碰到${b}了！`);
          }
        }
      }
      for (const [nname, npc] of Object.entries(gameState.npcs)) {
        if (!npc.memoryTags || npc.memoryTags.length === 0) continue;
        const rel = gameState.player.relationships[nname];
        if (!rel || rel.affection <= 0) continue;
        const latest = npc.memoryTags[npc.memoryTags.length - 1];
        if (latest && Math.random() < 0.25) {
          deliverMessage(gameState, pd, nname, gameState.player.name,
            `听说 "${latest.tag}"…能告诉我更多吗？`);
        }
      }
    }
  } catch (e) { console.error("updateNPCSchedules: 手机消息投递失败", e); }

  return events;
}

/** 检查日历中是否有活跃的多日 schedule_override（假期/长假） */
async function getActiveScheduleOverrides(): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};
  const today = gameState.time.game_date;
  const year = parseInt(today.split("-")[0]);
  const mmdd = today.includes("-") ? `${parseInt(today.split("-")[1])}月${parseInt(today.split("-")[2])}日` : today;

  // Parse calendar entries — reuse loadCalendar() from timeline
  let calendarEntries: any[] = [];
  try {
    const { loadCalendar } = await import("./timeline.ts");
    const all = loadCalendar();
    calendarEntries = all.filter((e: any) => e.schedule_override && e.duration_days);
  } catch (e) {
    console.error("getActiveScheduleOverrides timeline load failed:", e);
    return overrides;
  }

  for (const e of calendarEntries) {
    if (e.year !== null && e.year !== year) continue;

    // Calculate offset: is today within [date, date + duration_days)?
    const eParts = e.date.split("月");
    const tParts = mmdd.split("月");
    const eMonth = parseInt(eParts[0]), eDay = parseInt(eParts[1]);
    const tMonth = parseInt(tParts[0]), tDay = parseInt(tParts[1]);
    const offset = (tMonth - eMonth) * 30 + (tDay - eDay);

    if (offset >= 0 && offset < (e.duration_days || 1)) {
      for (const [group, target] of Object.entries(e.schedule_override)) {
        overrides[group] = target as string;
      }
    }
  }

  return overrides;
}

/** P1: 应用日历事件的 org_effects — 为匹配组织的 NPC 自动设 pendingOverride */
async function applyOrgEffects(): Promise<void> {
  const { getCalendarPhase } = await import("./timeline.ts");
  const { phase, entries } = getCalendarPhase(gameState.time.game_date, gameState.player.location);
  if (phase !== "today") return;

  for (const entry of entries) {
    if (!entry.org_effects) continue;
    for (const effect of entry.org_effects) {
      for (const [name, npc] of Object.entries(gameState.npcs)) {
        if (npcBelongsToOrg(name, npc, effect.org)) {
          // Fill template variables
          const role = inferRoleForNPC(name, npc);
          const roleAction = inferRoleActionForNPC(name, npc);
          const action = effect.override_action_template
            .replace("{role}", role)
            .replace("{role_action}", roleAction);

          // 已有手动override时不被日历事件覆盖
          if (npc.pendingOverride) continue;
          npc.pendingOverride = {
            location: effect.override_location,
            action,
            reason: `日历事件: ${entry.text.slice(0, 30)}`,
            expiresAt: gameState.time.game_date, // expires end of day
          };
        }
      }
    }
  }
}

/** P1 启发式：判断 NPC 是否属于某组织 */
export function npcBelongsToOrg(name: string, npc: NPCRuntimeState, org: string): boolean {
  const src = (characters as any[]).find((c: any) => c.name === name);
  const group = npc.scheduleGroup || src?.schedule_group || "";
  const defLoc = src?.default_location || "";

  const orgLower = org.toLowerCase();
  const groupLower = group.toLowerCase();
  const defLocLower = defLoc.toLowerCase();

  // 1. 直接同名匹配
  if (groupLower.includes(orgLower) || defLocLower.includes(orgLower)) return true;
  if (orgLower.includes(groupLower) || orgLower.includes(defLocLower)) return true;

  // 2. 组织 match_rules 匹配
  if (!_orgCache) {
    _orgCache = {};
    const dirsToScan = [
      path.resolve(process.cwd(), "worldpacks", activeWorldName, "orgs"),
      path.resolve(process.cwd(), "data", "orgs"),
    ];
    for (const dir of dirsToScan) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith("_")) continue;
        try {
          const entries = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
          for (const entry of (Array.isArray(entries) ? entries : [entries])) {
            if (entry.org) _orgCache[entry.org] = entry;
          }
        } catch (_) {}
      }
    }
  }
  const orgData = _orgCache[org];
  if (orgData?.match_rules?.schedule_groups) {
    if (orgData.match_rules.schedule_groups.some((sg: string) => sg.toLowerCase() === groupLower)) return true;
  }
  if (orgData?.match_rules?.location_contains) {
    if (defLocLower.includes(orgData.match_rules.location_contains.toLowerCase())) return true;
  }

  return false;
}

/** P1: 从 NPC 的 tags/skills 推断 {role} */
function inferRoleForNPC(name: string, npc: NPCRuntimeState): string {
  const src = (characters as any[]).find((c: any) => c.name === name);
  const tags = src?.tags || [];
  if (tags.includes("学生会") || tags.includes("生徒会")) return "作为学生会成员";
  if (tags.includes("运动部") || tags.includes("体育部")) return "作为运动部员";
  if (npc.scheduleGroup === "总武高教师" || npc.scheduleGroup === "教师") return "作为教师";
  return "";
}

/** P1: 从 NPC 的 skills 推断 {role_action} */
function inferRoleActionForNPC(name: string, npc: NPCRuntimeState): string {
  const src = (characters as any[]).find((c: any) => c.name === name);
  const tags = src?.tags || [];
  if (tags.includes("学生会")) return "组织开幕式";
  if (tags.includes("田径部") || src?.skills?.["运动"] || src?.skills?.["跑步"]) return "为自己的项目热身";
  if (tags.includes("读书部") || tags.includes("文化部")) return "做后勤记录";
  return "参与活动";
}


// ── 区域设定自动注入 ──

export let _regionContexts: Record<string, { keys: string[]; context: string; social_norms?: string; npc_beauty_ref?: string }> | null = null;

export function clearRegionContextCache(): void {
  _regionContexts = null;
}

/** 根据玩家位置匹配 region_contexts.json 中的区域设定，自动注入到 prompt */
export function getRegionContext(location: string): string {
  // 懒加载 — 优先扫 worldpacks/{w}/locations/ 目录，回退平面文件
  if (!_regionContexts) {
    _regionContexts = loadWorldpackDirRecursive("locations", "region_contexts.json");
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

/** 从 NPC 偷现金（只能偷钱包里的，偷不走银行存款） */
export function stealFunds(player: PlayerState, targetName: string): StealResult {
  const npc = getOrCreateNPC(targetName);
  if (npc.cash <= 0) {
    return { success: false, caught: false, narrative: targetName + "钱包里没钱。", roll: { kept: 0, mod: 0, total: 0, dc: 0 } };
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
    const stolen = Math.floor(Math.random() * npc.cash * 0.8) + 1;
    const actual = Math.min(stolen, npc.cash);
    npc.cash -= actual;
    player.funds += actual;
    const currencySymbol = getCurrency();
    return { success: true, caught: false, narrative: "从" + targetName + "钱包里偷到了" + currencySymbol + actual + "。", roll: { kept: d, mod, total, dc } };
  }
  if (caught) {
    return { success: false, caught: true, narrative: "手被" + targetName + "抓住了。", roll: { kept: d, mod, total, dc } };
  }
  return { success: false, caught: false, narrative: "没能摸到钱包。", roll: { kept: d, mod, total, dc } };
}

export function stealItem(
  player: PlayerState,
  targetName: string,
  itemName: string,
  cashAmount?: number
): StealResult {
  const npc = getOrCreateNPC(targetName);
  const zeroRoll = { kept: 0, mod: 0, total: 0, dc: 0 };

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

  // "她身上有没有这东西"是叙事判断——GM 既然调了 steal，就是已判断合理。引擎不硬拒，合成。
  // catalog 里有 → 用真实数据（含真实体积/重量）；没有 → 合成小型可揣物。
  let synthesized = false;
  if (!item) {
    // 合成物防重复：同一样东西顺过一次就真没了，不能刷第二个
    if ((npc as any)._stolenNames?.includes(itemName)) {
      return { success: false, caught: false, narrative: `${targetName}身上已经没有${itemName}了。`, roll: zeroRoll };
    }
    const cat = buildCatalogLookup().get(itemName);
    item = cat
      ? { ...structuredClone(cat), state: "intact" }
      : { name: itemName, type: "tool", slot: "back", weight: 0.2, volume: 0.3, effects: [], state: "intact", flavor: `从${targetName}处顺来的${itemName}` } as any;
    synthesized = true;
  }

  // 引擎守恒：太大顺不走 → 判失败（不掷骰），交渲染写成叙事（防"偷兰博基尼塞进背包"）。
  // 仅对 catalog 里有真实体积的大件生效；合成的未知物默认小型，靠 LLM 判断"该不该偷"兜第一道。
  const CARRY_VOLUME_LIMIT = 50; // 顺手牵羊体积上限（升）：超过=家具/车辆/大件，带不走
  if ((item!.volume ?? 0) > CARRY_VOLUME_LIMIT) {
    return { success: false, caught: false, narrative: `「${itemName}」太大，没法顺手带走。`, roll: zeroRoll };
  }

  // 检定（引擎算，LLM 碰不到）
  const dex = player.attributes.敏捷 + getEquipmentBonus(player.equipment, "attribute_bonus", "敏捷");
  const stealth = player.skills["潜行"]?.level ?? 0;
  const mod = attrMod(dex) + stealth;
  const d = Math.floor(Math.random() * 20) + 1;
  const dc = item!.weight > 0.5 ? 16 : item!.weight > 0.2 ? 12 : 8;
  const total = d + mod;
  const success = d === 20 || total >= dc;
  const caught = d === 1;

  if (success && !caught) {
    // 成功：真实存在的物品从 NPC 容器移出（合成物本就不在其容器里，改记入"已被顺走"）
    if (!synthesized) {
      if (fromInventory) {
        const idx = npc.inventory.findIndex(i => i.name === itemName);
        if (idx >= 0) npc.inventory.splice(idx, 1);
      } else {
        for (const [k, v] of Object.entries(npc.equipment)) {
          if (v && v.name === itemName) { npc.equipment[k] = null; break; }
        }
      }
    } else {
      ((npc as any)._stolenNames ??= []).push(itemName);
    }
    // 现金：LLM 提议偷到的容器内有多少钱，引擎封顶在实际随身现金（偷不走银行存款）
    let cashMsg = "";
    if (cashAmount && cashAmount > 0 && npc.cash > 0) {
      const actual = Math.min(Math.round(cashAmount), npc.cash);
      npc.cash -= actual;
      player.funds += actual;
      cashMsg = ` 内含${getCurrency()}${actual}`;
    }
    player.inventory.push(structuredClone(item!));
    return {
      success: true, item: item!, caught: false,
      narrative: `从${targetName}身上偷到了「${itemName}」${cashMsg}。`,
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
    if (!item.effects) { item.effects = []; return item; }
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

/**
 * 房间群演数据层 — 输出场景中有多少路人、什么类型、在干嘛。不做叙事拼接。
 * Phase 1 LLM 根据这些数据自行判断该创建什么群演（spawn_temp_npc）。
 * Phase 3 LLM 根据数据自行编织人群描写。
 */
export function getNamelessNPCs(loc: string, turn: number): NamelessNPC[] {
  const rKey = getRoomKey(loc);
  const room = rKey ? ROOMS[rKey] : null;
  if (!room) return [];

  const zone = getLocationZone(loc);
  const timeLabel = getCurrentTimeLabel();
  const cap = getRoomCapacity(loc);
  const namedHere = Object.values(gameState.npcs)
    .filter((n: any) => isSameLocation(n.currentRoom, loc)).length;

  if (namedHere >= cap) return [];

  var densityMap = {
    school: { weekday_morning:0.7, weekday_lunch:0.5, weekday_afternoon:0.55, weekday_evening:0.1, weekend:0 },
    street: { weekday_morning:0.5, weekday_lunch:0.6, weekday_afternoon:0.6, weekday_evening:0.7, weekend:0.7 },
    residential: { weekday_morning:0.1, weekday_lunch:0.15, weekday_afternoon:0.15, weekday_evening:0.3, weekend:0.25 },
    station: { weekday_morning:0.8, weekday_lunch:0.5, weekday_afternoon:0.5, weekday_evening:0.8, weekend:0.6 },
    park: { weekday_morning:0.2, weekday_lunch:0.3, weekday_afternoon:0.4, weekday_evening:0.3, weekend:0.6 },
  };
  var zoneD = densityMap[zone] || densityMap["street"];
  var density = (zoneD[timeLabel] !== undefined ? zoneD[timeLabel] : 0.3);
  var estimate = Math.max(0, Math.round(cap * density) - namedHere);

  var crowdType = { school:"学生", street:"顾客/路人", residential:"居民", station:"乘客", park:"散步的人" }[zone] || "路人";
  var typeAct = { school:"在上课/课间活动", street:"在逛街/购物/路过", residential:"在附近散步/活动", station:"在候车/赶路", park:"在散步/休憩" }[zone] || "在附近活动";

  if (estimate <= 0) return [];

  return [{
    name: crowdType + " (~" + estimate + "人)",
    act: typeAct + " (房间容量" + cap + ", " + zone + " " + timeLabel + ")",
    height: "",
    gridPos: [1, 1],
    clusterSize: estimate,
  } as any];
}

/** 根据位置名推断区域类型 */
function getLocationZone(loc: string): string {
  const normalized = loc.toLowerCase();
  if (normalized.includes("学校") || normalized.includes("教室") || normalized.includes("校") ||
      normalized.includes("走廊") || normalized.includes("中庭") || normalized.includes("操场") ||
      normalized.includes("体育") || normalized.includes("図書") || normalized.includes("部室") ||
      normalized.includes("j班") || normalized.includes("f班") || normalized.includes("侍奉部")) return "school";
  if (normalized.includes("駅") || normalized.includes("站") || normalized.includes("月台") || normalized.includes("電車")) return "station";
  if (normalized.includes("公園") || normalized.includes("河堤") || normalized.includes("神社") || normalized.includes("広場")) return "park";
  if (normalized.includes("住宅") || normalized.includes("自宅") || normalized.includes("マンション") || normalized.includes("アパート")) return "residential";
  return "street"; // 默认街道/商业区
}

/** 根据游戏时间返回时段标签 */
function getCurrentTimeLabel(): string {
  const tt = gameState.time?.time_of_day;
  const dow = gameState.time?.day_of_week;
  if (!dow) return tt === "morning" ? "weekday_morning" : tt === "night" || tt === "dawn" ? "weekday_evening" : "weekday_lunch";
  const isWeekend = dow === "日曜日" || dow === "土曜日";
  if (isWeekend) return "weekend";
  if (tt === "night" || tt === "dawn") return "weekday_evening";
  if (tt === "morning") return "weekday_morning";
  if (tt === "noon") return "weekday_lunch";
  return "weekday_afternoon";
}

// ── 世界状态冻结与热挂载 ──
/** 查找玩家持有的手机（背包或装备栏） */
function findPlayerPhone(): any {
  return gameState.player.inventory.find(i => i.phoneData !== undefined)
    || Object.values(gameState.player.equipment).find(item => item && item.phoneData !== undefined);
}

export function freezeWorldState(worldName: string): void {
  const npcsSnapshot = structuredClone(gameState.npcs);
  const roomDeltasSnapshot = structuredClone(ROOMS);
  const locationsDeltaSnapshot = structuredClone(LOCATIONS_DELTA);
  const knownLocationsSnapshot = structuredClone(gameState.player.known_locations);

  let snsFeedSnapshot: any[] = [];
  const phone = findPlayerPhone();
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
  clearRegionContextCache();
  loadActiveWorld(targetWorld);

  const snapshot = gameState.world_states[targetWorld];
  if (snapshot) {
    gameState.npcs = structuredClone(snapshot.npcs);
    updateROOMSInPlace(snapshot.room_deltas);
    LOCATIONS_DELTA = structuredClone(snapshot.dynamic_locations);
    // 合并快照的地点 + 玩家当前已知地点（避免快照覆盖新探索的地点）
    const merged = new Set(gameState.player.known_locations || []);
    for (const loc of (snapshot.known_locations || [])) {
      merged.add(loc);
    }
    gameState.player.known_locations = [...merged];

    const phone = findPlayerPhone();
    if (phone && phone.phoneData) {
      phone.phoneData.snsPosts = structuredClone(snapshot.sns_feed || []);
    }
  } else {
    gameState.npcs = {};
    updateROOMSInPlace(rooms);
    LOCATIONS_DELTA = {};
    gameState.player.known_locations = [];

    const phone = findPlayerPhone();
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

    // 角色：优先扫 characters/ 目录（每人一文件，真相源），回退旧平面文件
    characters = loadCharactersFromDir() ?? loadJSON("characters.json", charactersStatic);
    rooms = loadJSON("rooms.json", roomsStatic);
    // charStages 从角色对象投影（stages/stages_if 已内联）；空则回退旧平面文件
    const _derivedStages = deriveCharStages(characters);
    charStages = Object.keys(_derivedStages).length ? _derivedStages : loadJSON("character_stages.json", charStagesStatic);
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
    residenceTemplates = loadJSON("residence_templates.json", residenceTemplatesStatic);
    // sex profiles 从角色对象投影（sex_profile 已内联为完整对象）；空则回退旧平面文件
    const _derivedSex: Record<string, any> = {};
    for (const c of characters) if (c?.sex_profile && typeof c.sex_profile === "object") _derivedSex[c.name] = c.sex_profile;
    sexProfilesData = Object.keys(_derivedSex).length ? _derivedSex : loadJSON("sex_profiles.json", null);

    // 启动校验：只报硬错误（缺必填/非法组/孤儿），warn/info 是 backlog 不刷屏（铁律：bug 要看得见）
    try {
      const vr = validateCharactersFn(characters, new Set(Object.keys(scheduleTemplates || {})));
      const errs = vr.issues.filter((i) => i.severity === "error");
      if (errs.length) {
        console.error(`⚠ 角色校验发现 ${errs.length} 个硬错误:`);
        for (const e of errs.slice(0, 20)) console.error(`   [${e.name}] ${e.detail}`);
      }
    } catch (e) { console.error("loadActiveWorld: 角色校验失败", e); }

    // Step 7: 组织/势力系统数据加载 (纯动态从 orgs/ 扫描，去中心化)
    if (gameState) {
      // 保持之前的声望关系不丢失，只更新势力属性
      gameState.organizations ??= {};
      
      const orgsDir = path.resolve(process.cwd(), "worldpacks", world, "orgs");
      if (fs.existsSync(orgsDir)) {
        for (const f of fs.readdirSync(orgsDir)) {
          if (!f.endsWith(".json") || f.startsWith("_")) continue;
          try {
            const arr = JSON.parse(fs.readFileSync(path.join(orgsDir, f), "utf-8"));
            for (const item of (Array.isArray(arr) ? arr : [arr])) {
              const orgId = item.id || item.org;
              if (!orgId) continue;
              
              gameState.organizations[orgId] = {
                id: orgId,
                name: item.name || item.org || orgId,
                type: item.type || "学校",
                scale: item.scale || "local",
                sector: item.sector || "social",
                parent_org: item.parent_org,
                wealth: item.wealth ?? 50,
                influence: item.influence ?? 50,
                cohesion: item.cohesion ?? 50,
                public_legitimacy: item.public_legitimacy ?? 50,
                coreLocation: item.coreLocation || "",
                territoryRoomKeys: item.territoryRoomKeys || [],
                class_base: item.class_base || {},
                organizationalAxes: item.organizationalAxes || { "经济立场": 0, "政治立场": 0 },
                goals: item.goals || { macroGoal: "", currentPhaseGoal: "" },
                leader: item.leader || "",
                members: item.members || [],
                relations: item.relations || {},
                match_rules: item.match_rules || {},
                entries: item.entries || []
              };
            }
          } catch (e) {
            console.error(`Failed to load org file: ${f}`, e);
          }
        }

        // 初始化生命周期字段（对没有这些字段的已有 org，引擎自动推断）
        for (const org of Object.values(gameState.organizations)) {
          if (!org.lifecycle_stage) {
            const w = org.wealth, inf = org.influence, coh = org.cohesion;
            if (w < 20 && inf < 20) org.lifecycle_stage = "萌芽";
            else if (w < 40 && inf < 40) org.lifecycle_stage = "初创";
            else if (coh < 40 || w < 30) org.lifecycle_stage = "衰退";
            else if (w < 70 && inf < 70) org.lifecycle_stage = "成长";
            else if (w >= 70 && inf >= 70 && coh >= 60) org.lifecycle_stage = "成熟";
            else org.lifecycle_stage = "成长";
          }
          org.ticks_at_stage ??= 0;
          org.ticks_at_scale ??= 0;
        }
      }

      // 重新加载新世界包的天空盒默认值
      try {
        const locs = loadWorldpackDirRecursive("locations", "region_contexts.json");
        let foundDefaults = false;
        for (const [_, locData] of Object.entries(locs)) {
          if (locData && (locData as any).skybox_defaults) {
            gameState.worldState = {
              tech: 0,
              stability: 0,
              tension: 0,
              prosperity: 0,
              regime: "未知体制",
              economy_type: "未知经济型",
              diplomacy_stance: "未知外交立场",
              globalFlags: {},
              ...(gameState.worldState || {}),
              ...(locData as any).skybox_defaults
            };
            foundDefaults = true;
            break;
          }
        }
        if (!foundDefaults) {
          gameState.worldState = {
            tech: 0,
            stability: 0,
            tension: 0,
            prosperity: 0,
            globalFlags: {},
            ...(gameState.worldState || {})
          };
        }
      } catch (e) {
        console.error("loadActiveWorld: failed to update worldState from locations", e);
      }
    }

    // ── 脑裂检测：data/ 比 worldpack 内容多 → 警告 ──
    // 你正在改 data/ 下的文件，但游戏运行时读的是 worldpacks/<world>/。
    // 如果 data/ 版本条目数明显大于 worldpack 版本，说明有修改不会在游戏中生效。
    try {
      const checks: Array<{ label: string; dataVar: any; worldVar: any; measure: (v: any) => number }> = [
        { label: "characters.json",      dataVar: charactersStatic,      worldVar: characters,           measure: v => Array.isArray(v) ? v.length : Object.keys(v).length },
        { label: "items.json",           dataVar: itemsCatalogStatic,    worldVar: itemsCatalog,         measure: v => Array.isArray(v) ? v.length : Object.keys(v).length },
        { label: "rooms.json",           dataVar: roomsStatic,           worldVar: rooms,                measure: v => Object.keys(v).length },
        { label: "shops.json",           dataVar: shopsCatalogStatic,    worldVar: shopsCatalog,         measure: v => Object.keys(v).length },
        { label: "regions.json",         dataVar: regionsDataStatic,     worldVar: regionsData,          measure: v => Array.isArray(v) ? v.length : Object.keys(v).length },
        { label: "locations.json",       dataVar: locationsDataStatic,   worldVar: locationsData,        measure: v => Array.isArray(v) ? v.length : Object.keys(v).length },
        { label: "schedule_templates.json", dataVar: scheduleTemplatesStatic, worldVar: scheduleTemplates, measure: v => Object.keys(v).length },
        { label: "school_map.json",      dataVar: schoolMapDataStatic,   worldVar: schoolMapData,        measure: v => Object.keys(v).length },
        { label: "city_map.json",        dataVar: cityMapDataStatic,     worldVar: cityMapData,          measure: v => Object.keys(v).length },
        { label: "character_stages.json",dataVar: charStagesStatic,      worldVar: charStages,           measure: v => Object.keys(v).length },
        { label: "title_rules.json",     dataVar: titleRulesStatic,      worldVar: titleRules,           measure: v => Object.keys(v).length },
        { label: "nameless_npc_templates.json", dataVar: namelessNpcTemplatesStatic, worldVar: namelessNpcTemplates, measure: v => Object.keys(v).length },
        { label: "economy.json",         dataVar: economyConfigStatic,   worldVar: economyConfig,        measure: v => Object.keys(v).length },
        { label: "phone_apps.json",      dataVar: phoneAppsCatalogStatic,worldVar: phoneAppsCatalog,     measure: v => Array.isArray(v) ? v.length : Object.keys(v).length },
        { label: "positions.json",       dataVar: positionsCatalogStatic,worldVar: positionsCatalog,     measure: v => Array.isArray(v) ? v.length : Object.keys(v).length },
        { label: "room_templates.json",  dataVar: roomTemplatesStatic,   worldVar: roomTemplates,        measure: v => Object.keys(v).length },
        { label: "residence_templates.json", dataVar: residenceTemplatesStatic, worldVar: residenceTemplates, measure: v => Object.keys(v).length },
      ];
      const warnings: string[] = [];
      for (const c of checks) {
        const dataSize = c.measure(c.dataVar);
        const worldSize = c.measure(c.worldVar);
        if (dataSize > worldSize) {
          warnings.push(`  data/${c.label} (${dataSize}条) > worldpacks/${world}/${c.label} (${worldSize}条)`);
        }
      }
      if (warnings.length > 0) {
        console.warn(`\n[脑裂警告] data/ 下以下文件内容比 worldpacks/${world}/ 多，你改的东西不会在游戏中生效：`);
        console.warn(warnings.join("\n"));
        console.warn(`请把修改同步到 worldpacks/${world}/ 下的对应文件。\n`);
      }
    } catch (e) { console.error("loadActiveWorld: 脑裂检测失败", e); }

    // Re-initialize dependent variables — MUST update in-place, NEVER reassign
    // (CJS import is value copy; reassigning ROOMS causes state-grid.ts to hold
    // a stale reference → dynamic rooms silently lost on next saveState)
    updateROOMSInPlace(rooms);
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
      }).catch(() => { /* sex.ts not present in public repo */ });
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
