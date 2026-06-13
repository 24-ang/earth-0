/**
 * 状态引擎 - 角色状态 + HP + 负重 + 物品操作 + 持久化
 */

import type { PlayerState, GameState, EquipmentSlots, Item, Wound, Relationship, AttrKey, NPCRuntimeState, StealResult, Skill, StaticCharacter, RoomGrid, SexState } from "./types.ts";
import { INITIAL_TIME_STATE } from "./time.ts";
import characters from "../data/characters.json" with { type: "json" };
import rooms from "../data/rooms.json" with { type: "json" };
import { lookupRegion } from "./router.ts";
import charStages from "../data/character_stages.json" with { type: "json" };
import fs from "node:fs";
import path from "node:path";

// --- 空间数据定义 ---
const ROOMS_BASE = rooms as Record<string, RoomGrid>;
export let ROOMS = structuredClone(ROOMS_BASE);

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
  return clean(loc1) === clean(loc2);
}

// --- 模块级游戏状态（单例，整个 session 一份） ---
const STATE_DIR = path.resolve(process.cwd(), "state");
const STATE_FILE = path.join(STATE_DIR, "session.json");
const AGENTS_DIR = path.resolve(process.cwd(), "agents");

export let gameState: GameState = createInitialState();

function createInitialState(): GameState {
  return {
    time: { ...INITIAL_TIME_STATE },
    player: createDefaultPlayer(),
    npcs: {},
    sexStates: {},
    mode: "gal",
    layer1Enabled: false,
    auMode: false,
    flags: {},
    weather: { type: "晴", temp: 16 },
    turn: 0,
  };
}

function createDefaultPlayer(): PlayerState {
  return {
    name: "维",
    gender: "男",
    age: 16,
    location: "千叶_住宅区",
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
    party: [],
    gridPos: null,
    reputation: {},
    known_locations: ["千叶_住宅区"],
  };
}

// --- 持久化 ---
export function saveState(filepath?: string): void {
  const fp = filepath ?? STATE_FILE;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  
  // 房间修改也持久化，保存到 session 目录下的 rooms_delta.json，而不覆写 data/rooms.json
  const roomsDeltaPath = path.join(path.dirname(fp), "rooms_delta.json");
  fs.writeFileSync(roomsDeltaPath, JSON.stringify(ROOMS, null, 2));
  
  fs.writeFileSync(fp, JSON.stringify(gameState, null, 2));
}

export function loadState(filepath?: string): boolean {
  const fp = filepath ?? STATE_FILE;
  if (!fs.existsSync(fp)) return false;
  const raw = fs.readFileSync(fp, "utf-8");
  gameState = JSON.parse(raw) as GameState;
  
  // 读取 rooms_delta.json 并覆盖 ROOMS
  const roomsDeltaPath = path.join(path.dirname(fp), "rooms_delta.json");
  if (fs.existsSync(roomsDeltaPath)) {
    try {
      ROOMS = JSON.parse(fs.readFileSync(roomsDeltaPath, "utf-8"));
    } catch (_) {
      ROOMS = structuredClone(ROOMS_BASE);
    }
  } else {
    ROOMS = structuredClone(ROOMS_BASE);
  }

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
    }
  }

  // 迁移：旧存档 player.age 与 time.player_age 不同步 → 用 time 覆盖 player
  if (gameState.time?.player_age && gameState.player.age !== gameState.time.player_age) {
    gameState.player.age = gameState.time.player_age;
  }
  // 迁移：timeline_origin.age 过旧 → 与 player_age 对齐
  if (gameState.time?.timeline_origin && gameState.time.timeline_origin.age !== gameState.time.player_age) {
    gameState.time.timeline_origin.age = gameState.time.player_age;
    gameState.time.timeline_origin.year = Number(gameState.time.game_date.split("-")[0]);
  }
  return true;
}

export function resetState(): void {
  gameState = createInitialState();
  ROOMS = structuredClone(ROOMS_BASE);
  // 删除默认 session 对应的 rooms_delta.json
  const roomsDeltaPath = path.join(STATE_DIR, "rooms_delta.json");
  if (fs.existsSync(roomsDeltaPath)) {
    try { fs.unlinkSync(roomsDeltaPath); } catch (_) {}
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

/** 计算 NPC 当前年龄（base_age + 游戏时间流逝） */
export function getNpcCurrentAge(npcBaseAge: number): number {
  const ageDelta = gameState.player.age - gameState.time.timeline_origin.age;
  return Math.max(0, npcBaseAge + ageDelta);
}

/** 设置玩家位置并自动发现新地点 */
export function setPlayerLocation(loc: string): void {
  gameState.player.location = loc;
  if (!gameState.player.known_locations) gameState.player.known_locations = ["千叶_住宅区"];
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

export async function buildStatePrompt(): Promise<string> {
  const tplPath = path.join(AGENTS_DIR, "gm-state.md");
  if (!fs.existsSync(tplPath)) return "";
  let tpl = fs.readFileSync(tplPath, "utf-8");
  const s = gameState;
  const p = s.player;
  
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
  // 附加玩家装备与背包物品
  const eq = Object.entries(p.equipment).filter(([_, v]) => v);
  if (eq.length > 0) {
    tpl += `\n[玩家装备] ${eq.map(([s, it]) => `${s}:${it!.name}`).join(", ")}`;
  }
  if (p.inventory.length > 0) {
    tpl += `\n[玩家背包] ${p.inventory.map(it => it.name).join(", ")}`;
  }
  // 附加空间上下文
  const gridCtx = getGridContext();
  if (gridCtx) tpl += `\n${gridCtx}`;
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
  // NPC阶段描述 + 实时身材
  for (const [nname, npc] of Object.entries(gameState.npcs)) {
    if (!isSameLocation(npc.currentRoom, p.location)) continue;
    const cs = (charStages as any)[nname];
    const src = (characters as any[]).find((c: any) => c.name === nname);
    if (!src) continue;
    // AU 过滤：非 AU 模式下跳过带 au 标签的角色（不注入 prompt）
    if (!gameState.auMode && src.tags?.includes("au")) continue;
    
    // 阶段性格：按 NPC 当前年龄取 stage，IF 线优先
    if (cs) {
      const curAge = getNpcCurrentAge(src.base_age || 6);
      const stageKey = curAge <= 5 ? "幼儿_小学" : curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
      // IF 线：检查是否有 {name}_if 版本且对应 flag 激活
      const ifKey = nname + "_if";
      const ifCs = (charStages as any)[ifKey];
      let desc = cs[stageKey];
      // tachibanaIF → 橘家三人 / osanaIF → 円香透
      if (ifCs?.[stageKey]) {
        if (gameState.flags.tachibanaIF && ["橘京香","橘结花","橘小春"].includes(nname)) desc = ifCs[stageKey];
        if (gameState.flags.osanaIF && ["樋口円香","浅仓透"].includes(nname)) desc = ifCs[stageKey];
      }
      if (desc) tpl += `\n[${nname}] ${desc}`;
    }
    
    // 实时身体数据：年龄分层，只用当前年龄档位
    const curAgeBody = getNpcCurrentAge(src.base_age || 6);
    const body = getBodyForAge(src, curAgeBody);
    if (body) {
      let bodyStr = `${body.height_cm}cm ${body.build}`;
      if (body.cup) bodyStr += ` ${body.cup}cup`;
      if (body.measurements) bodyStr += ` 三围${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
      bodyStr += ` ${body.skin?.base_tone || ""}${body.body_shape?.chest ? " "+body.body_shape.chest : ""}`;
      tpl += `\n[${nname}·身体] ${bodyStr}`;
    }
  }
  // 附加声望
  const rep = gameState.player.reputation;
  if (Object.keys(rep).length > 0) {
    const repStr = Object.entries(rep).map(([k,v]) => {
      const bonus = calcReputationBonus(k);
      return bonus ? `${k}:${v}(+${bonus})` : `${k}:${v}`;
    }).join(" ");
    tpl += `\n[声誉] ${repStr}`;
  }
  // 附加关系（室内 NPC 的玩家关系，LLM 需要知道才能正确叙事）
  const rels = gameState.player.relationships;
  for (const [nname, rel] of Object.entries(rels)) {
    // 只注在室内的，跟 NPC 阶段描述同一过滤
    const npc = gameState.npcs[nname];
    if (!npc || !isSameLocation(npc.currentRoom, gameState.player.location)) continue;
    if ((rel as any).affection === 0) continue;
    let relStr = `${(rel as any).stage}(好感${(rel as any).affection})`;
    if ((rel as any).romance) relStr += ` ${(rel as any).romance}`;
    if ((rel as any).notes) relStr += ` — ${(rel as any).notes}`;
    tpl += `\n[${nname}·关系] ${relStr}`;
  }

  // 附加 Layer1 — 分两层：
  //   [印记] 永久属性（态度/经验/开发度），gal/sex 都注入——这是身体记忆
  //   [实时] 欲望/兴奋/周期，仅 sex 模式注入——这是瞬时状态
  try {
    const { getDesireNarrative, getArousalNarrative, getDevNarrative, getCyclePhase, SEX_PROFILES } = await import("./sex.ts");
    const profiles = SEX_PROFILES as Record<string, any>;

    // [印记] 玩家当前 partner（如有）
    if (gameState.player.sex) {
      const sx = gameState.player.sex;
      const prof = sx.profile;
      const devHint = getDevNarrative(prof);
      tpl += `\n[印记] ${prof.attitude} | ${prof.experience} | ${devHint}`;
      // [实时] 仅 sex 模式
      if (gameState.layer1Enabled) {
        const phase = getCyclePhase(sx.cycleDay);
        if (phase !== "安全期") tpl += ` | ${phase}`;
        const dh = getDesireNarrative(sx);
        const ah = getArousalNarrative(sx);
        if (dh) tpl += `\n  欲望: ${dh}`;
        if (ah) tpl += `\n  兴奋: ${ah}`;
      }
    }

    // [印记] 室内 NPC 永久档案
    for (const [nname, npc] of Object.entries(gameState.npcs)) {
      if (!isSameLocation(npc.currentRoom, gameState.player.location)) continue;
      const sp = profiles[nname];
      if (!sp) continue;
      const devHint = getDevNarrative(sp);
      tpl += `\n[${nname}·印记] ${sp.attitude} | ${sp.experience} | ${devHint}`;
      if (gameState.layer1Enabled) {
        const npcPhase = getCyclePhase(sp.cycleDay);
        if (npcPhase !== "安全期") tpl += ` | ${npcPhase}`;
      }
    }

    if (!gameState.layer1Enabled) {
      // 在 gal 模式下，对在场且在 gameState.sexStates 中有记录的 NPC，注入其身体语言描述（无具体数值）
      for (const [nname, npc] of Object.entries(gameState.npcs)) {
        if (!isSameLocation(npc.currentRoom, gameState.player.location)) continue;
        const sState = gameState.sexStates?.[nname];
        if (sState) {
          const dh = getDesireNarrative(sState);
          if (dh) {
            tpl += `\n[${nname}·身体语言] ${dh}`;
          }
        }
      }
    }
  } catch (_) {}

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
    rels[name] = { stage: "陌生", affection: 0, romance: null, notes: "" };
  }
  rels[name].affection = Math.max(0, Math.min(100, rels[name].affection + delta));
  rels[name].stage = affectionToStage(rels[name].affection);
  if (note) rels[name].notes = note;
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

export function getOrCreateNPC(name: string): NPCRuntimeState {
  if (!gameState.npcs[name]) {
    const src = (characters as any[]).find((c: any) => c.name === name);
    gameState.npcs[name] = {
      inventory: src ? structuredClone(src.inventory ?? []) : [],
      equipment: src ? structuredClone(src.equipment ?? {}) : {},
      currentRoom: src?.default_location || "",
      gridPos: src?.grid_pos || null,
      action: "",
      scheduleGroup: src?.schedule_group || "自由人",
      scheduleOverrides: src?.schedule_overrides,
    };
  }
  return gameState.npcs[name];
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

export function listNPCItems(name: string): Item[] {
  const npc = getOrCreateNPC(name);
  const equipped = Object.values(npc.equipment).filter(Boolean) as Item[];
  return [...npc.inventory, ...equipped];
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
      return { success: false, newX: cx, newY: cy, blocked: true, reason: "门关着", distance: 0, seconds: 0 };
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
  
  // 阻挡
  if (cell.block || cell.type === "wall") {
    return { success: false, newX: cx, newY: cy, blocked: true, reason: cell.furniture ? `被${cell.furniture}挡住了` : "前方是墙壁", distance: 0, seconds: 0 };
  }
  
  // 通行
  gameState.player.gridPos = [nx, ny];
  return { success: true, newX: nx, newY: ny, blocked: false, reason: "", distance: cellDist, seconds };
}

export function placeFurniture(x: number, y: number, itemName: string): { success: boolean; reason: string } {
  if (!gameState.player.gridPos) return { success: false, reason: "当前位置不可建造" };
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图" };
  
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };
  
  const cell = room.cells[y][x];
  if (cell.type === "wall") return { success: false, reason: "不能放在墙上" };
  if (cell.type === "exit" || cell.type === "door") return { success: false, reason: "不能堵住门口" };
  if (cell.furniture) return { success: false, reason: `这里已经有${cell.furniture}了` };
  
  cell.furniture = itemName;
  cell.label = itemName.slice(0, 4);  // 简单缩写，用于棋盘格显示
  cell.block = true;
  saveState();
  return { success: true, reason: `放置了${itemName}` };
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
  saveState();
  return { success: true, reason: `拆除了${item}`, item };
}

// --- 门窗开关 ---
export function toggleDoor(x: number, y: number): { success: boolean; reason: string; isOpen: boolean } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图", isOpen: false };
  const cell = room.cells[y][x];
  if (cell.type !== "door" && cell.type !== "exit") return { success: false, reason: "这不是门窗", isOpen: false };
  cell.isOpen = !(cell.isOpen !== false); // 切换，默认true
  cell.block = !cell.isOpen;
  saveState();
  return { success: true, reason: cell.isOpen ? "打开了" : "关上了", isOpen: cell.isOpen };
}

// --- 记忆标签：LLM观察到某事 → 打标签 ---
export function addMemoryTag(npcName: string, tag: string, expiresDays: number = 3): void {
  const npc = gameState.npcs[npcName];
  if (!npc) return;
  npc.memoryTags ??= [];
  npc.memoryTags.push({ tag, since: gameState.time.game_date, expires: expiresDays });
}

export function getMemoryTags(npcName: string): string[] {
  const npc = gameState.npcs[npcName];
  if (!npc?.memoryTags) return [];
  return npc.memoryTags.slice(-5).map(t => t.tag);
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
import itemsCatalog from "../data/items.json" with { type: "json" };

const PRICE_RANGE: Record<string, [number, number]> = {
  consumable: [80, 800],
  tool: [50, 5000],
  weapon: [500, 50000],
  armor: [500, 30000],
  clothing: [500, 30000],
};

function validatePrice(itemName: string, price: number): string | null {
  let itemType = "tool";
  for (const [cat, items] of Object.entries(itemsCatalog)) {
    if ((items as any)[itemName]) {
      itemType = cat === "consumables" ? "consumable" : cat === "weapons" ? "weapon" : cat === "armor" ? "armor" : cat === "clothing" ? "clothing" : "tool";
      break;
    }
  }
  const [min, max] = PRICE_RANGE[itemType] || [10, 50000];
  if (price < min) return `${itemName}价格通常不低于¥${min}`;
  if (price > max) return `${itemName}价格通常不超过¥${max}`;
  return null;
}

export function buyItem(itemName: string, price: number): string {
  let itemData: any = null;
  for (const cat of Object.values(itemsCatalog)) {
    if ((cat as any)[itemName]) { itemData = (cat as any)[itemName]; break; }
  }
  if (!itemData) return `LLM必须指定有效物品名`;
  const err = validatePrice(itemName, price);
  if (err) return err;
  if (gameState.player.funds < price) return `钱不够。需要¥${price}，余额¥${gameState.player.funds}`;
  gameState.player.funds -= price;
  gameState.player.inventory.push(structuredClone(itemData));
  saveState();
  return `买了${itemName}，花费¥${price}。余额¥${gameState.player.funds}`;
}

export function sellItem(itemName: string, price: number): string {
  const idx = gameState.player.inventory.findIndex(i => i.name === itemName);
  if (idx < 0) return `背包里没有${itemName}`;
  const err = validatePrice(itemName, price);
  if (err) return err;
  gameState.player.inventory.splice(idx, 1);
  gameState.player.funds += price;
  saveState();
  return `卖了${itemName}，获得¥${price}。余额¥${gameState.player.funds}`;
}

export function workJob(jobName: string, hours: number): string {
  const rates: Record<string, number> = {"便利店":900,"送报纸":500,"家教":1500,"餐厅":1000,"发传单":850};
  const rate = rates[jobName] || 900;
  const pay = rate * hours;
  gameState.player.funds += pay;
  saveState();
  return `工作${hours}小时（${jobName}），获得¥${pay}。余额¥${gameState.player.funds}`;
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
  const m = Number(gameState.time.game_date.split("-")[1]);
  const s = m >= 3 && m <= 5 ? "春" : m >= 6 && m <= 8 ? "夏" : m >= 9 && m <= 11 ? "秋" : "冬";
  const p = SEASONS[s];
  gameState.weather.type = p.types[Math.floor(Math.random() * p.types.length)];
  gameState.weather.temp = p.temps[0] + Math.floor(Math.random() * (p.temps[1] - p.temps[0]));
  saveState();
  return `${gameState.weather.type} ${gameState.weather.temp}°C`;
}

// --- NPC 日程更新 ---
import scheduleTemplates from "../data/schedule_templates.json" with { type: "json" };
const TEMPLATES = scheduleTemplates as any;

const FALLBACK_ROOMS: Record<string, string> = {
  "2年J班": "2F南走廊-J班前",
  "2年F班": "2F南走廊-F班前",
  "侍奉部": "社团楼1F走廊",
  "如月家_浴室": "如月家",
  "如月家_2F": "如月家",
};

export function getRoomCapacity(roomName: string): number {
  const room = ROOMS[roomName];
  if (!room) return 999;
  if (room.capacity !== undefined) return room.capacity;
  if (roomName.includes("班")) return 40;
  if (roomName.includes("走廊") || roomName.includes("楼梯")) return 15;
  if (roomName === "侍奉部") return 6;
  if (roomName.includes("家") || roomName.includes("自宅")) return 10;
  if (roomName === "操场" || roomName === "中庭" || roomName === "体育馆" || roomName === "校门" || roomName === "天台") return 100;
  return Math.max(6, Math.floor(room.width * room.height / 3));
}

export function updateNPCSchedules(): string[] {
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
          const fallback = FALLBACK_ROOMS[finalRoom] || "1F南走廊";
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
        const curAge = getNpcCurrentAge(src.base_age || 6);
        const keys = Object.keys(src.schedule_group_by_age).map(Number).sort((a,b) => a - b);
        let best = keys[0];
        for (const k of keys) {
          if (k <= curAge) best = k;
          else break;
        }
        effectiveGroup = src.schedule_group_by_age[String(best)] || effectiveGroup;
      }
      const tpl = TEMPLATES[effectiveGroup];
      if (tpl?.[timeKey]) {
        const opts = tpl[timeKey].split("/");
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
      const fallback = FALLBACK_ROOMS[finalRoom] || "1F南走廊";
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
  const traits = ["情侣，牵着手", "戴耳机听歌", "边走路边看书", "似乎在赶时间", "和朋友大声聊天", "一个人发呆", "在打电话", "偷偷打量周围", "拎着便利店袋子", "穿着运动服刚训练完"];
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
  const socialEvents: string[] = [];
  for (const [room, names] of Object.entries(roomNPCs)) {
    if (names.length < 2) continue;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = gameState.npcs[names[i]];
        const b = gameState.npcs[names[j]];
        a.memoryTags ??= [];
        b.memoryTags ??= [];
        // 交换标签——干净的数据过滤
        const newTags = [...a.memoryTags, ...b.memoryTags].filter(t => {
          const daysSince = (Date.now() - new Date(t.since).getTime()) / 86400000;
          return daysSince < t.expires;
        });
        a.memoryTags = [...newTags];
        b.memoryTags = [...newTags];
        // 生成碰面事件
        const rel = gameState.player.relationships[names[i]];
        const knowA = rel && rel.affection > 0;
        const knowB = gameState.player.relationships[names[j]]?.affection > 0;
        if (knowA || knowB) {
          socialEvents.push(`${names[i]}和${names[j]}在${room}碰面`);
        }
      }
    }
  }
  
  return events;
}

// --- 空间统计注入 LLM 上下文 ---
export function getGridContext(): string {
  const room = ROOMS[gameState.player.location];
  if (!room || !gameState.player.gridPos) return "";

  const [px, py] = gameState.player.gridPos;

  // 出口列表
  const exits: string[] = [];
  const furniture: string[] = [];
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const c = room.cells[y][x];
      if (c.type === "exit" || c.type === "door") exits.push(`${c.exitTo || "出口"}(${x},${y})`);
      if (c.furniture) furniture.push(`${c.furniture}(${x},${y})`);
    }
  }

  // 四周一格：LLM 知道邻格有什么，但不知道邻格之外
  const around: string[] = [];
  for (const [d, [dx, dy]] of Object.entries(DIRS).slice(0, 4)) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || nx >= room.width || ny < 0 || ny >= room.height) continue;
    const c = room.cells[ny][nx];
    if (c.type === "wall") around.push(`${d}:墙`);
    else if (c.furniture) around.push(`${d}:${c.furniture}`);
    else if (c.type === "exit" || c.type === "door") around.push(`${d}:出口→${c.exitTo || "?"}`);
    else around.push(`${d}:空`);
  }

  let ctx = `[空间] ${gameState.player.location} ${room.width}×${room.height}格 ${room.cellSize}m/格 F${room.floor} 你在(${px},${py})`;
  if ((room as any).atmosphere) ctx += ` | ${(room as any).atmosphere}`;
  const amb = (room as any).ambient;
  if (amb) ctx += ` | 环境: ${[amb.visual, amb.audio].filter(Boolean).join("，")}`;
  if (exits.length > 0) ctx += ` | 出口:${exits.join(",")}`;
  if (furniture.length > 0) ctx += ` | 家具:${furniture.join(",")}`;
  ctx += ` | 四周:${around.join(" ")}`;
  return ctx;
}

// --- 偷窃 ---
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
  const dex = player.attributes.敏捷;
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
