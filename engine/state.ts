/**
 * 状态引擎 - 角色状态 + HP + 负重 + 物品操作 + 持久化
 */

import type { PlayerState, GameState, EquipmentSlots, Item, Wound, Relationship, AttrKey, NPCRuntimeState, StealResult, Skill } from "./types.ts";
import { INITIAL_TIME_STATE } from "./time.ts";
import characters from "../data/characters.json" with { type: "json" };
import rooms from "../data/rooms.json" with { type: "json" };
import { lookupRegion } from "./router.ts";
import charStages from "../data/character_stages.json" with { type: "json" };
import fs from "node:fs";
import path from "node:path";

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
    age: 6,
    location: "千叶_住宅区",
    body: {
      height_cm: 115, weight_kg: 20, build: "标准", leg_type: "纤细",
      skin: { base_tone: "普通", tan: 0, texture: "普通" },
    },
    attributes: { 力量: 2, 敏捷: 3, 体质: 3, 智力: 4, 感知: 5, 魅力: 5 },
    skills: {},
    hp: { current: 7, max: 7 },
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
  // 房间修改也持久化
  const ROOMS_PATH = path.resolve(process.cwd(), "data", "rooms.json");
  fs.writeFileSync(ROOMS_PATH, JSON.stringify(ROOMS, null, 2));
  fs.writeFileSync(fp, JSON.stringify(gameState, null, 2));
}

export function loadState(filepath?: string): boolean {
  const fp = filepath ?? STATE_FILE;
  if (!fs.existsSync(fp)) return false;
  const raw = fs.readFileSync(fp, "utf-8");
  gameState = JSON.parse(raw) as GameState;
  return true;
}

export function resetState(): void {
  gameState = createInitialState();
  saveState();
}

// --- 状态简报模板注入（填充 gm-state.md 的 {{}} 变量） ---
/** 按年龄取身体数据：优先 body_by_age（找 ≤ targetAge 的最大键），否则 fallback body */
export function getBodyForAge(char: any, targetAge: number): any {
  if (char.body_by_age) {
    const keys = Object.keys(char.body_by_age).map(Number).sort((a,b) => a - b);
    let best = keys[0];
    for (const k of keys) {
      if (k <= targetAge) best = k;
      else break;
    }
    return char.body_by_age[String(best)] || char.body;
  }
  return char.body;
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

export function buildStatePrompt(): string {
  const tplPath = path.join(AGENTS_DIR, "gm-state.md");
  if (!fs.existsSync(tplPath)) return "";
  let tpl = fs.readFileSync(tplPath, "utf-8");
  const s = gameState;
  const p = s.player;
  
  // 周边角色：首次触发时懒初始化 NPC
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
  // 附加空间上下文
  const gridCtx = getGridContext();
  if (gridCtx) tpl += `\n${gridCtx}`;
  // 附加周边角色（通过地区路由器）
  const r = lookupRegion(p.location);
  if (r.all_characters.length > 0) {
    const nearby = r.all_characters.slice(0, 8);
    if (nearby.length > 0) tpl += `\n[周边] ${nearby.join(", ")}`;
  }
  // 碰面检测：当前房间内已存在的NPC
  const inRoom = Object.entries(gameState.npcs)
    .filter(([_, n]) => n.currentRoom === p.location || n.currentRoom.includes(p.location) || p.location.includes(n.currentRoom))
    .map(([name, n]) => `${name}${n.action ? "("+n.action+")" : ""}`);
  if (inRoom.length > 0) tpl += `\n[在场] ${inRoom.join(", ")}`;
  // NPC阶段描述 + 实时身材
  for (const [nname, npc] of Object.entries(gameState.npcs)) {
    if (npc.currentRoom !== p.location && !npc.currentRoom.includes(p.location) && !p.location.includes(npc.currentRoom)) continue;
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

export function listNPCItems(name: string): Item[] {
  const npc = getOrCreateNPC(name);
  const equipped = Object.values(npc.equipment).filter(Boolean) as Item[];
  return [...npc.inventory, ...equipped];
}

// --- 空间系统（棋盘格） ---
const ROOMS = rooms as Record<string, RoomGrid>;
const DIRS: Record<string, [number, number]> = {
  "北": [0, -1], "南": [0, 1], "东": [1, 0], "西": [-1, 0],
  "上": [0, -1], "下": [0, 1], "左": [-1, 0], "右": [1, 0],
};

// 初始化时注册保留字
const RESERVED: Record<string, string> = {
  "墙壁": "WL", "墙": "WL", "门": "DR", "出口": "DR",
  "窗户": "WD", "落地窗": "WD", "窗": "WD",
  "课桌": "DK", "书桌": "DK", "讲台": "PD", "黑板": "BB",
  "柱": "CL", "储物柜": "LK", "沙发": "SF", "茶几": "TB",
  "床": "BD",
};

const usedLabels = new Set<string>();
const labelRegistry = new Map<string, string>();

// 注册保留字标签
for (const [name, label] of Object.entries(RESERVED)) {
  usedLabels.add(label);
  labelRegistry.set(label, name);
}
usedLabels.add("PL"); // 玩家始终保留
usedLabels.add("  "); // 空地

/** 四级降级：给物品生成双字母缩写 */
export function registerLabel(name: string): string {
  // 先查保留字
  for (const [kw, lbl] of Object.entries(RESERVED)) {
    if (name.includes(kw)) return lbl;
  }
  
  // 二级：英文首字母+首辅音
  const en = toEnglish(name);
  const abbr = extractAbbr(en);
  if (!usedLabels.has(abbr)) {
    usedLabels.add(abbr);
    labelRegistry.set(abbr, name);
    return abbr;
  }
  
  // 三级：错位辅音
  const alt = shiftConsonant(en);
  if (alt && !usedLabels.has(alt)) {
    usedLabels.add(alt);
    labelRegistry.set(alt, name);
    return alt;
  }
  
  // 四级：首字母+数字
  const first = en[0]?.toUpperCase() || "X";
  for (let i = 1; i <= 99; i++) {
    const num = `${first}${i}`;
    if (!usedLabels.has(num)) {
      usedLabels.add(num);
      labelRegistry.set(num, name);
      return num;
    }
  }
  
  return "??";
}

function toEnglish(name: string): string {
  // 简单的中→英映射，覆盖常见建造物品
  const map: Record<string, string> = {
    "帐篷": "Tent", "猫窝": "Catbed", "猫爬架": "Cattree",
    "桌子": "Table", "椅子": "Chair", "床": "Bed",
    "沙发": "Sofa", "茶几": "Table", "柜子": "Cabinet",
    "书架": "Bookshelf", "灯": "Lamp", "地毯": "Rug",
    "电视": "TV", "冰箱": "Fridge", "洗衣机": "Washer",
    "马桶": "Toilet", "浴缸": "Bathtub", "镜子": "Mirror",
    "花盆": "Flowerpot", "垃圾桶": "Trashcan", "纸箱": "Carton",
    "垫子": "Cushion", "枕头": "Pillow", "毯子": "Blanket",
  };
  return map[name] || name;
}

function extractAbbr(en: string): string {
  const upper = en.toUpperCase().replace(/[^A-Z]/g, "");
  if (upper.length >= 2) return upper.slice(0, 2);
  if (upper.length === 1) return upper + "0";
  return "??";
}

function shiftConsonant(en: string): string | null {
  const upper = en.toUpperCase().replace(/[^A-Z]/g, "");
  if (upper.length < 2) return null;
  const first = upper[0];
  // 找第二个辅音
  for (let i = 2; i < upper.length; i++) {
    const ch = upper[i];
    if (!"AEIOU".includes(ch)) {
      return first + ch;
    }
  }
  return null;
}

export function getRoom(roomName: string): RoomGrid | null {
  return ROOMS[roomName] || null;
}

export function initPlayerGrid(): void {
  const roomName = gameState.player.location;
  const grid = ROOMS[roomName];
  if (grid) {
    gameState.player.gridPos = [...grid.origin];
  } else {
    gameState.player.gridPos = null;
  }
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
  
  const label = registerLabel(itemName);
  cell.furniture = itemName;
  cell.label = label;
  cell.block = true;
  saveState();
  return { success: true, reason: `放置了${itemName} [${label}]` };
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
  
  for (const [name, npc] of Object.entries(gameState.npcs)) {
    // Tier 1: 一次性覆盖（生病/约定/紧急事件）
    if (npc.pendingOverride) {
      const ov = npc.pendingOverride;
      // 过期自动清除
      if (ov.expiresAt && ov.expiresAt < gameState.time.game_date) {
        npc.pendingOverride = null;
      } else {
        const matchedRoom = [...Object.keys(ROOMS)].find(rn => 
          rn.includes(ov.location) || ov.location.includes(rn)
        ) || ov.location;
        if (npc.currentRoom !== matchedRoom) {
          const old = npc.currentRoom;
          npc.currentRoom = matchedRoom;
          npc.gridPos = ROOMS[matchedRoom]?.origin || null;
          npc.action = ov.action;
          events.push(`${name}: ${old} → ${matchedRoom}（${ov.reason}）`);
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
    
    // 模糊匹配房间名
    let matchedRoom: string | null = null;
    for (const rn of Object.keys(ROOMS)) {
      if (rn.includes(targetRoom) || targetRoom.includes(rn)) {
        matchedRoom = rn;
        break;
      }
    }
    if (!matchedRoom) continue;
    
    // 物理优先：当前房间有网格时才检查出口
    if (npc.currentRoom !== matchedRoom && npc.gridPos) {
      const curRoom = ROOMS[npc.currentRoom];
      if (curRoom) {
        // 找通往目标方向的出口
        let exitFound = false;
        for (const row of curRoom.cells) {
          for (const cell of row) {
            if ((cell.type === "exit" || cell.type === "door") && cell.exitTo) {
              if (cell.exitTo === matchedRoom || cell.exitTo.includes(matchedRoom) || matchedRoom.includes(cell.exitTo)) {
                if (cell.isOpen === false) {
                  events.push(`${name}: 门关着，无法离开${npc.currentRoom}前往${matchedRoom}`);
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
        if (!exitFound) {
          events.push(`${name}: ${npc.currentRoom}无出口通往${matchedRoom}，留在原地`);
          continue;
        }
      }
    }
    
    // 移动
    if (npc.currentRoom !== matchedRoom) {
      const oldRoom = npc.currentRoom;
      npc.currentRoom = matchedRoom;
      npc.gridPos = ROOMS[matchedRoom]?.origin || null;
      events.push(`${name}: ${oldRoom} → ${matchedRoom}`);
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
        a.memoryTags = newTags;
        b.memoryTags = newTags;
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

// --- 路径与移动判��（引擎做，LLM不碰） ---
function isWalkable(room: RoomGrid, x: number, y: number): boolean {
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return false;
  const cell = room.cells[y][x];
  if (cell.type === "wall") return false;
  if (cell.block) return false;
  return true;
}

export interface PathResult {
  reached: boolean;
  path: [number, number][];      // 走过的格子
  blockedAt?: [number, number];   // 在哪被挡住
  blockedBy?: string;            // 被什么挡住
  walked: [number, number][];    // 实际走到的路径（不含起点）
}

/** 从 (fx,fy) 直线移动向 (tx,ty)，逐个检查碰撞 */
export function moveTo(
  roomName: string,
  from: [number, number],
  to: [number, number]
): PathResult {
  const room = ROOMS[roomName];
  if (!room) return { reached: false, path: [], walked: [] };
  
  const [fx, fy] = from;
  const [tx, ty] = to;
  const path: [number, number][] = [];
  const walked: [number, number][] = [];
  
  let cx = fx, cy = fy;
  
  // 简单直线逼近：每次选离目标更近的一步
  while (cx !== tx || cy !== ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    
    // 优先水平还是垂直，选差值大的方向
    let nx = cx, ny = cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      nx = cx + (dx > 0 ? 1 : -1);
    } else {
      ny = cy + (dy > 0 ? 1 : -1);
    }
    
    // 如果首选方向不通，试另一方向
    if (!isWalkable(room, nx, ny)) {
      const cell = room.cells[ny]?.[nx];
      const blockedBy = cell?.furniture || "墙壁";
      
      // 尝试另一轴
      if (Math.abs(dx) >= Math.abs(dy)) {
        ny = cy + (dy > 0 ? 1 : -1);
        nx = cx;
      } else {
        nx = cx + (dx > 0 ? 1 : -1);
        ny = cy;
      }
      
      if (!isWalkable(room, nx, ny)) {
        // 两个方向都堵了
        return { reached: false, path, blockedAt: [cx, cy], blockedBy, walked };
      }
    }
    
    cx = nx;
    cy = ny;
    path.push([cx, cy]);
    walked.push([cx, cy]);
    
    // 防死循环：最多走 100 步
    if (path.length > 100) break;
  }
  
  return { reached: cx === tx && cy === ty, path, walked };
}

// --- 空间统计注�LLM上下文 ---
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
  
  // 四周一�
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
  // 远景
  const hz = (room as any).horizon;
  if (hz) {
    const dirs = Object.entries(hz).map(([d, v]) => `${d}:${v}`).join("; ");
    ctx += ` | 远景: ${dirs}`;
  }
  // 窗外景色（房间级：只要房间有窗就注入，不靠邻格）
  let outsideView = "";
  for (const row of room.cells) {
    for (const c of row) {
      if (c.outsideView) { outsideView = c.outsideView; break; }
    }
    if (outsideView) break;
  }
  if (outsideView) ctx += ` | 窗外: ${outsideView}`;
  // 跨节点感官渗透：读目标房间实时ambient
  let bleed = "";
  for (const row of room.cells) {
    for (const c of row) {
      if (!c.faces) continue;
      const target = ROOMS[c.faces] as any;
      if (!target?.ambient) continue;
      const isClosed = c.isOpen === false;
      const v = target.ambient.visual || "";
      const a = target.ambient.audio || "";
      bleed = isClosed ? `窗外隐约可见${v}，声音模糊` : `窗外${v}，${a}传进来`;
      break;
    }
    if (bleed) break;
  }
  if (bleed) ctx += ` | ${bleed}`;
  // 外部环境音（房间级）
  const amb = (room as any).ambient;
  if (amb) ctx += ` | 环境: ${[amb.visual, amb.audio].filter(Boolean).join("，")}`;
  if (exits.length > 0) ctx += ` | 出口:${exits.join(",")}`;
  if (furniture.length > 0) ctx += ` | 家具:${furniture.join(",")}`;
  ctx += ` | 四周:${around.join(" ")}`;
  return ctx;
}

export function getRoomState(roomName: string): { grid: RoomGrid | null; playerPos: [number, number] | null; nearby: string } | null {
  const grid = ROOMS[roomName];
  if (!grid) return null;
  const pos = gameState.player.gridPos;
  let nearby = "";
  if (pos) {
    const [px, py] = pos;
    const parts: string[] = [];
    for (const [dir, [dx, dy]] of Object.entries(DIRS).slice(0, 4)) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
        const cell = grid.cells[ny][nx];
        if (cell.furniture) parts.push(`${dir}边：${cell.furniture}`);
        if (cell.type === "exit" || cell.type === "door") parts.push(`${dir}边：通往${cell.exitTo || "出口"}`);
      }
    }
    nearby = parts.join(" | ");
  }
  return { grid, playerPos: pos, nearby };
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
