import locationsData from "../data/locations.json" with { type: "json" };
import schoolMapData from "../data/school_map.json" with { type: "json" };
import cityMapData from "../data/city_map.json" with { type: "json" };
const LOCATIONS_BASE = locationsData as any;
const SCHOOL_MAP = schoolMapData as any;
const CITY_MAP = cityMapData as any;
export let LOCATIONS_DELTA: Record<string, string[]> = {};
function getDefaultSexAtmosphere(location: string): string {
  if (location.includes("教室") || location.includes("班")) return "空旷的教室，课桌椅整齐排列——在这里做点什么有种背德的刺激。";
  if (location.includes("侍奉部") || location.includes("部室")) return "狭小的部室，只有老旧暖炉的嗡嗡声和窗外操场的喧闹。";
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

// --- 装备效果扫描（attribute_bonus / social_bonus / cold_resist） ---

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

interface VehicleDef { speedMul: number; tags: string[]; desc: string; }
const VEHICLES: Record<string, VehicleDef> = {
  bicycle:    { speedMul: 3, tags: ["narrow","steep","off-road"], desc: "自行车——通学路最常见的交通工具，小巷山路都能钻" },
  motorcycle: { speedMul: 5, tags: ["narrow","steep"], desc: "摩托车——比汽车灵活，窄巷和山路没问题，但还是要走车道" },
  car:        { speedMul: 8, tags: [], desc: "汽车——只能在铺装路上开，需要停车场" },
};

export function mountVehicle(itemName: string): string {
  const p = gameState.player;
  if (p.equipment.mount) return `已经骑着 ${p.equipment.mount.name}，请先下车`;

export function dismountVehicle(): string {
  const p = gameState.player;
  const item = p.equipment.mount;
  if (!item) return "当前没有骑乘载具";

export function getVehicleMul(): { mul: number; name?: string } {
  const v = gameState.player.vehicle;
  return v ? { mul: v.speedMul, name: v.name } : { mul: 1 };
}

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

export function setNPCOutfit(npcName: string, outfitKey: string): string {
  const src = (characters as any[]).find((c: any) => c.name === npcName);
  if (!src?.outfits?.[outfitKey]) return `${npcName}没有 ${outfitKey} 服装卡`;
  const npc = getOrCreateNPC(npcName);
  npc.currentOutfit = outfitKey as any;
  const items = src.outfits[outfitKey];
  const desc = Object.values(items).join("、");
  return `${npcName} → ${outfitKey}: ${desc}`;
}

export function getNPCOutfitDesc(npcName: string): string {
  const src = (characters as any[]).find((c: any) => c.name === npcName);
  if (!src?.outfits) return src?.appearance_brief || "";
  const npc = gameState.npcs[npcName];
  const key = npc?.currentOutfit || "school";
  const outfit = src.outfits[key];
  if (!outfit) return src.appearance_brief || "";
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

// --- 地点层级系统（locations.json 树形结构） ---

function buildLocationTree(): LocationNode {
  const root: LocationNode = { key: "japan", name: LOCATIONS_BASE.japan?.name || "日本", type: "root", children: [], parent: null };

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

function getSchoolInternals(schoolName: string): { buildings: string[]; floorsByBuilding: Record<string, string[]>; roomsByFloor: Record<string, string[]> } {
  const buildings: string[] = [];
  const floorsByBuilding: Record<string, string[]> = {};
  const roomsByFloor: Record<string, string[]> = {};
  if (!SCHOOL_MAP?.buildings) return { buildings, floorsByBuilding, roomsByFloor };

export interface SchoolInternalNode {
  name: string;
  type: "building" | "floor" | "room";
  children: SchoolInternalNode[];
}

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

function knownLocationMatch(roomName: string, locName: string): boolean {
  return roomName.includes(locName) || isSameLocation(roomName, locName);
}

export function createDynamicLocation(parentName: string, name: string): string {
  LOCATIONS_DELTA[parentName] ??= [];
  if (LOCATIONS_DELTA[parentName].includes(name)) return `${name} 已存在`;
  LOCATIONS_DELTA[parentName].push(name);
  // 持久化到 session 目录
  const deltaPath = path.join(STATE_DIR, "locations_delta.json");
  fs.writeFileSync(deltaPath, JSON.stringify(LOCATIONS_DELTA, null, 2));
  // 自动加入已知地点
  if (!gameState.player.known_locations.includes(name)) {
    gameState.player.known_locations.push(name);
  }
  saveState();
  return `创建了新地点: ${name}（位于 ${parentName}）`;
}

export function loadLocationsDelta(): void {
  const deltaPath = path.join(STATE_DIR, "locations_delta.json");
  if (fs.existsSync(deltaPath)) {
    try { LOCATIONS_DELTA = JSON.parse(fs.readFileSync(deltaPath, "utf-8")); } catch (_) {}
  }
}

// --- 房间时间戳脏污（方向A） ---

export function stampRoom(roomName?: string): void {
  const name = roomName || gameState.player.location;
  if (!name) return;
  const key = getRoomKey(name) || name;
  gameState.roomTimestamps ??= {};
  gameState.roomTimestamps[key] = gameState.time.game_date;
}

export function getRoomAgingLine(roomName: string): string {
  gameState.roomTimestamps ??= {};
  const key = getRoomKey(roomName) || roomName;
  const lastVisit = gameState.roomTimestamps[key];
  if (!lastVisit) return "";

function daysBetween(d1: string, d2: string): number {
  const [y1, m1, d1n] = d1.split("-").map(Number);
  const [y2, m2, d2n] = d2.split("-").map(Number);
  const total1 = y1 * 365 + m1 * 30 + d1n;
  const total2 = y2 * 365 + m2 * 30 + d2n;
  return Math.max(0, total2 - total1);
}
