/**
 * state-grid.ts — 空间系统（棋盘格/房间/移动/家具/门窗）
 * 从 state.ts 拆分。导入 state.ts（ESM live bindings，函数内调用无环）。
 */

import {
  gameState, ROOMS, itemsCatalog,
  getRoomKey, isSameLocation, normalizeLocationName,
  getCurrency, getConstructionMultiplier,
  saveState, damageItem, getEquipmentBonus, hasEquipmentEffect,
  cleanupTempNPCs,
  LOCATIONS_DELTA,
  roomTemplates, residenceTemplates,
} from "./state.ts";
import { lookupRegion } from "./router.ts";
import { attrMod } from "./dice.ts";

// ── 内部工具 ──

function daysBetween(d1: string, d2: string): number {
  const [y1, m1, d1n] = d1.split("-").map(Number);
  const [y2, m2, d2n] = d2.split("-").map(Number);
  return Math.max(0, (y2 * 365 + m2 * 30 + d2n) - (y1 * 365 + m1 * 30 + d1n));
}

const DIRS: Record<string, [number, number]> = {
  "北": [0, -1], "南": [0, 1], "东": [1, 0], "西": [-1, 0],
  "上": [0, -1], "下": [0, 1], "左": [-1, 0], "右": [1, 0],
};

// ── 房间时间戳脏污 ──

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
  const current = gameState.time.game_date;
  const daysSince = daysBetween(lastVisit, current);
  if (daysSince < 4) return "";
  const seed = gameState.turn + roomName.length;
  const poolIdx = seed % 3;
  if (daysSince >= 30) {
    return ["灰尘覆盖了一切——这里像是被遗忘了。","推开门的瞬间，霉味扑面而来。地上积了厚厚一层灰。","这里太久没人来过，连空气都是静止的。"][poolIdx];
  }
  if (daysSince >= 15) {
    return ["角落结了蛛网，空气里有股久置的气味。","地板上能看到清晰的灰尘——很久没人来过了。","窗台上积了薄灰，一片寂静。"][poolIdx];
  }
  return ["有一阵子没人来了。","几天没来，空气有些沉闷。","桌椅还是上次离开时的样子——已经积了薄灰。"][poolIdx];
}

// ── 空间系统 ──

export function getRoom(roomName: string): import("./types.ts").RoomGrid | null {
  const key = getRoomKey(roomName);
  if (key) {
    // ROOMS 键名可能以 , 开头（来自 getRoomKey 回退匹配），按原始名再查一次
    if (!ROOMS[key] && key.startsWith(",")) {
      const cleanKey = key.slice(1);
      if (ROOMS[cleanKey]) return ROOMS[cleanKey];
    }
    if (ROOMS[key]) return ROOMS[key];
    // key 存在但 ROOMS 中无对应值 → 尝试按 includes 匹配
    for (const [rk] of Object.entries(ROOMS)) {
      if (isSameLocation(rk, roomName)) return ROOMS[rk];
    }
  }
  if (roomName && !key) {
    // 先做 fuzzy match 防止 fallback 覆盖已有房间
    for (const [rk, rg] of Object.entries(ROOMS)) {
      if (isSameLocation(rk, roomName)) return rg;
    }
    const inKnown = gameState.player?.known_locations?.some((k: string) => isSameLocation(k, roomName));
    const isDynamic = Object.values(LOCATIONS_DELTA).some((arr: string[]) => arr.includes(roomName));
    if (inKnown || isDynamic) {
      const w = 10, h = 10;
      const cells: any[][] = [];
      for (let y = 0; y < h; y++) {
        const row: any[] = [];
        for (let x = 0; x < w; x++) {
          row.push({ type: "floor", block: false, furniture: null, label: "  " });
        }
        cells.push(row);
      }
      ROOMS[roomName] = { width: w, height: h, cellSize: 1, floor: 0, origin: [Math.floor(w/2), Math.floor(h/2)], cells, capacity: undefined };
      return ROOMS[roomName];
    }
  }
  return null;
}

export function getNearbyNPCs(roomName: string, gridPos: [number, number], maxRange = 10): Array<{ name: string; distance: number; walls: number }> {
  const room = getRoom(roomName);
  if (!room) return [];
  const [px, py] = gridPos;
  const result: Array<{ name: string; distance: number; walls: number }> = [];
  for (const [npcName, npc] of Object.entries(gameState.npcs)) {
    if (!npc.alive || !npc.gridPos || !npc.currentRoom) continue;
    if (!isSameLocation(npc.currentRoom, roomName)) continue;
    const [nx, ny] = npc.gridPos;
    const dist = Math.sqrt((nx - px) ** 2 + (ny - py) ** 2) * (room.cellSize || 1);
    if (dist > maxRange) continue;
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
        if (cell && (cell.type === "wall" || (cell.type === "door" && cell.locked))) walls++;
      }
    }
    result.push({ name: npcName, distance: Math.round(dist * 10) / 10, walls });
  }
  return result;
}

export function initPlayerGrid(): void {
  const roomName = gameState.player.location;
  const grid = getRoom(roomName);
  if (!grid) {
    console.warn(`[initPlayerGrid] 位置 "${roomName}" 不在已知房间中，gridPos 设为 null。ROOMS keys: ${Object.keys(ROOMS).join(", ").slice(0, 200)}`);
    gameState.player.gridPos = null;
    return;
  }
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
  // 没有 exit/door/floor 户型（全部 wall 或家具挡满），用 origin 但有家具的格子跳过
  const [ox, oy] = grid.origin;
  if (grid.cells[oy]?.[ox]?.type === "floor" && !grid.cells[oy]?.[ox]?.furniture) {
    gameState.player.gridPos = [ox, oy];
  } else {
    // 扫描找一个 floor 格子
    for (let yy = 0; yy < grid.height; yy++)
      for (let xx = 0; xx < grid.width; xx++)
        if (grid.cells[yy][xx].type === "floor" && !grid.cells[yy][xx].furniture) {
          gameState.player.gridPos = [xx, yy];
          return;
        }
    gameState.player.gridPos = [0, 0];
  }
}

// ── 钥匙匹配 ──

function matchKeyForDoor(equipment: import("./types.ts").EquipmentSlots, roomName: string, exitTo: string): string | null {
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

// ── 玩家移动 ──

export function movePlayer(direction: string, running: boolean = false): import("./types.ts").MoveResult {
  const delta = DIRS[direction];
  if (!delta) return { success: false, newX: -1, newY: -1, blocked: true, reason: `无效方向：${direction}`, distance: 0, seconds: 0 };
  if (!gameState.player.gridPos) return { success: false, newX: -1, newY: -1, blocked: true, reason: "当前位置不可步行移动", distance: 0, seconds: 0 };
  const curRoom = getRoom(gameState.player.location);
  if (!curRoom) return { success: false, newX: -1, newY: -1, blocked: true, reason: "当前位置没有地图数据" };
  const [cx, cy] = gameState.player.gridPos;
  const nx = cx + delta[0];
  const ny = cy + delta[1];
  if (nx < 0 || nx >= curRoom.width || ny < 0 || ny >= curRoom.height) {
    return { success: false, newX: cx, newY: cy, blocked: true, reason: "前方没有路了", distance: 0, seconds: 0 };
  }
  const cell = curRoom.cells[ny]?.[nx];
  if (!cell) return { success: false, newX: cx, newY: cy, blocked: true, reason: "前方没有路了", distance: 0, seconds: 0 };
  const cellDist = curRoom.cellSize;
  const speed = running && curRoom.cellSize >= 3 ? 3 : 1.5;
  const seconds = Math.round(cellDist / speed * 10) / 10;
  if (cell.type === "exit" || cell.type === "door" || cell.type === "stairs") {
    if (cell.isOpen === false) {
      if (cell.locked) {
        const keyMatch = matchKeyForDoor(gameState.player.equipment, gameState.player.location, cell.exitTo || "");
        if (!keyMatch) return { success: false, newX: cx, newY: cy, blocked: true, reason: "门锁着，需要钥匙", distance: 0, seconds: 0 };
        cell.locked = false; cell.isOpen = true; cell.block = false;
      } else {
        return { success: false, newX: cx, newY: cy, blocked: true, reason: "门关着", distance: 0, seconds: 0 };
      }
    }
    if (cell.exitTo) {
      if (!ROOMS[cell.exitTo]) return { success: false, newX: cx, newY: cy, blocked: true, reason: `${cell.exitTo}不存在`, distance: 0, seconds: 0 };
      gameState.player.location = cell.exitTo;
      initPlayerGrid();
      if (gameState.tempNPCs?.length > 0) cleanupTempNPCs("玩家移动");return { success: true, newX: gameState.player.gridPos?.[0] ?? 0, newY: gameState.player.gridPos?.[1] ?? 0, newRoom: cell.exitTo, blocked: false, reason: "", distance: cellDist, seconds };
    }
    return { success: false, newX: cx, newY: cy, blocked: true, reason: "门打不开", distance: 0, seconds: 0 };
  }
  let heightSeconds = 0;
  if (cell.block && cell.height !== undefined) {
    if (cell.height < 0.4) {
    } else if (cell.height < 1.0) { heightSeconds = 1; }
    else {
      if (cell.tags && cell.tags.includes("climbable")) {
        const str = gameState.player.attributes.力量 + getEquipmentBonus(gameState.player.equipment, "attribute_bonus", "力量");
        const athletics = (gameState.player.skills["运动"]?.level ?? 0) + getEquipmentBonus(gameState.player.equipment, "skill_bonus", "运动");
        const d = Math.floor(Math.random() * 20) + 1;
        if (d + attrMod(str) + athletics < 15) return { success: false, newX: cx, newY: cy, blocked: true, reason: "攀爬失败——手滑了", distance: 0, seconds: 0 };
        heightSeconds = 2;
      } else { return { success: false, newX: cx, newY: cy, blocked: true, reason: "前方是不可翻越的高墙", distance: 0, seconds: 0 }; }
    }
  }
  if ((cell.block || cell.type === "wall") && cell.height === undefined) {
    return { success: false, newX: cx, newY: cy, blocked: true, reason: cell.furniture ? `被${cell.furniture}挡住了` : "前方是墙壁", distance: 0, seconds: 0 };
  }
  gameState.player.gridPos = [nx, ny];
  const holdingHeavy = gameState.player.inventory.some((i: any) => i.holding_in_hands);
  const finalSeconds = holdingHeavy ? (seconds + heightSeconds) * 2 : seconds + heightSeconds;
  return { success: true, newX: nx, newY: ny, blocked: false, reason: "", distance: cellDist, seconds: Math.round(finalSeconds * 10) / 10 };
}

// ── 房间创建 ──

/** 内部：创建房间网格（不收费、不耗时）。extend 加墙壁边界、自动出口、氛围/家具。 */
function createRoomGrid(
  roomName: string, width: number, height: number, floor: number,
  opts?: { atmosphere?: string; directions?: Record<string, string>; furniture?: string[]; exitTo?: string }
): void {
  const cells: any[][] = [];
  for (let y = 0; y < height; y++) {
    const row: any[] = [];
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      if (isBorder) {
        // 如果有 exitTo 且这是第一条边的第一格 → 放出口
        if (opts?.exitTo && x === Math.floor(width / 2) && (y === 0 || y === height - 1)) {
          row.push({ type: "exit", block: false, exitTo: opts.exitTo, label: "DR" });
        } else {
          row.push({ type: "wall", block: true, label: "WL" });
        }
      } else {
        const cell: any = { type: "floor", block: false, label: "  " };
        if (opts?.furniture && opts.furniture.length > 0) {
          // 均匀分布家具到内部格子
          const innerIdx = (y - 1) * (width - 2) + (x - 1);
          const fi = innerIdx % opts.furniture.length;
          if (innerIdx < opts.furniture.length) {
            cell.furniture = opts.furniture[fi];
            cell.block = true;
          }
        }
        row.push(cell);
      }
    }
    cells.push(row);
  }
  ROOMS[roomName] = {
    width, height, cellSize: 1, floor,
    origin: [Math.floor(width / 2), Math.floor(height / 2)],
    cells,
    capacity: undefined,
    ...(opts?.atmosphere ? { atmosphere: opts.atmosphere } : {}),
    ...(opts?.directions ? { directions: opts.directions } : {}),
  };
}

/** 在两个已存在的房间之间建立双向 exit 连接 */
function connectRooms(roomA: string, roomB: string): void {
  const ra = ROOMS[roomA];
  const rb = ROOMS[roomB];
  if (!ra || !rb) return;
  // 在 A 的某个墙壁格上放出口到 B
  const placedA = placeExitOnBorder(ra, roomB);
  const placedB = placeExitOnBorder(rb, roomA);
  if (placedA && placedB) return;
  // fallback：如果 border 没空位（比如房间太小），在内部找个位置
  if (!placedA) placeExitAnywhere(ra, roomB);
  if (!placedB) placeExitAnywhere(rb, roomA);
}

function placeExitOnBorder(room: any, exitTo: string): boolean {
  const w = room.width, h = room.height;
  // 优先在长边的中间位置找 wall 格
  const candidates: [number, number][] = [];
  for (let x = 0; x < w; x++) { candidates.push([x, 0]); candidates.push([x, h - 1]); }
  for (let y = 0; y < h; y++) { candidates.push([0, y]); candidates.push([w - 1, y]); }
  for (const [x, y] of candidates) {
    const cell = room.cells[y]?.[x];
    if (cell && cell.type === "wall") {
      room.cells[y][x] = { type: "exit", block: false, exitTo, label: "DR" };
      return true;
    }
  }
  return false;
}

function placeExitAnywhere(room: any, exitTo: string): void {
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (room.cells[y][x].type === "floor" && !room.cells[y][x].furniture) {
        room.cells[y][x] = { type: "exit", block: false, exitTo, label: "DR" };
        return;
      }
    }
  }
}

/** 创建房间（玩家施工路径，收费+耗时）。支持 template/exitFrom/atmosphere 可选参数。 */
export async function createRoom(
  roomName: string, width: number, height: number, floor: number,
  opts?: { templateId?: string; exitFrom?: string; atmosphere?: string }
): Promise<{ success: boolean; reason: string }> {
  const cleanName = normalizeLocationName(roomName);
  if (ROOMS[cleanName] || ROOMS[roomName]) return { success: false, reason: `房间 ${roomName} 已存在` };

  // 如果有 template，从 room_templates 读尺寸
  let w = width, h = height;
  if (opts?.templateId) {
    const tmpl = findTemplate(roomTemplates, opts.templateId);
    if (tmpl) { w = tmpl.width || w; h = tmpl.height || h; }
  }

  if (w < 1 || h < 1) return { success: false, reason: "房间尺寸无效" };
  if (w * h > 10000) return { success: false, reason: `房间面积过大（${w * h}m²，上限10000m²）` };

  const multiplier = getConstructionMultiplier();
  const currencySymbol = getCurrency();
  const constructionMinutes = w * h * 5;
  const constructionCost = w * h * multiplier;
  if (gameState.player.funds < constructionCost) {
    return { success: false, reason: `资金不足。建造${w}×${h}房间需要${currencySymbol}${constructionCost}，当前余额${currencySymbol}${gameState.player.funds}` };
  }

  // 创建网格（带可选的氛围和出口）
  const gridOpts: any = {};
  if (opts?.atmosphere) gridOpts.atmosphere = opts.atmosphere;
  if (opts?.exitFrom) gridOpts.exitTo = opts.exitFrom;
  createRoomGrid(roomName, w, h, floor, gridOpts);

  // 如果有 exitFrom，双向连接
  if (opts?.exitFrom && ROOMS[opts.exitFrom]) {
    connectRooms(roomName, opts.exitFrom);
  }

  gameState.player.funds -= constructionCost;
  const { advanceMinutes } = await import("./time.ts");
  if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
  advanceMinutes(gameState.time, constructionMinutes);
  saveState();
  const tmplNote = opts?.templateId ? `（模板: ${opts.templateId}）` : "";
  return { success: true, reason: `创建了新房间 ${roomName} (${w}x${h})${tmplNote}，花费${currencySymbol}${constructionCost}，施工耗时${constructionMinutes}分钟。` };
}

/** 在嵌套模板对象中递归查找 key */
function findTemplate(templates: any, id: string): any | null {
  for (const cat of Object.values(templates)) {
    if (typeof cat !== "object" || !cat) continue;
    if ((cat as any)[id]) return (cat as any)[id];
    // 递归查找子分类
    for (const sub of Object.values(cat as object)) {
      if (typeof sub === "object" && sub && (sub as any)[id]) return (sub as any)[id];
    }
  }
  return null;
}

/** GM 免费用住宅实例化：从 residence_templates 读取蓝图，创建一组互连房间。幂等——已存在的房间跳过。 */
export function instantiateResidence(
  templateId: string, residenceName: string
): { success: boolean; reason: string; rooms: string[] } {
  const tmpl = residenceTemplates[templateId];
  if (!tmpl) return { success: false, reason: `住宅模板 ${templateId} 不存在`, rooms: [] };

  const prefix = residenceName;
  const created: string[] = [];
  const skipped: string[] = [];
  const keyToFullName: Record<string, string> = {};

  // 第一遍：创建所有房间
  for (const roomDef of tmpl.rooms) {
    const fullName = roomDef.name.replace("{prefix}", prefix);
    keyToFullName[roomDef.key] = fullName;
    if (ROOMS[fullName]) { skipped.push(fullName); continue; }

    const gridOpts: any = {};
    if (roomDef.atmosphere) gridOpts.atmosphere = roomDef.atmosphere;
    if (roomDef.directions) gridOpts.directions = roomDef.directions;
    if (roomDef.furniture) gridOpts.furniture = roomDef.furniture;
    if (roomDef.exitTo) gridOpts.exitTo = roomDef.exitTo;

    createRoomGrid(fullName, roomDef.w, roomDef.h, roomDef.floor, gridOpts);
    created.push(fullName);
  }

  // 第二遍：建立连接
  if (tmpl.connections) {
    for (const [aKey, bKey] of tmpl.connections) {
      const nameA = keyToFullName[aKey];
      const nameB = keyToFullName[bKey];
      if (nameA && nameB && ROOMS[nameA] && ROOMS[nameB]) {
        connectRooms(nameA, nameB);
      }
    }
  }

  saveState();

  const parts: string[] = [];
  if (created.length > 0) parts.push(`创建了 ${created.length} 个房间: ${created.join(", ")}`);
  if (skipped.length > 0) parts.push(`跳过了 ${skipped.length} 个已存在房间`);
  if (tmpl.player_room && keyToFullName[tmpl.player_room]) {
    parts.push(`玩家房间: ${keyToFullName[tmpl.player_room]}`);
  }

  return {
    success: created.length > 0 || skipped.length > 0,
    reason: parts.join("。") || "未创建任何房间",
    rooms: [...created, ...skipped],
  };
}

// ── 单元操作 ──

export function editCellType(x: number, y: number, type: "floor" | "wall" | "door" | "exit" | "stairs", exitTo?: string, material?: string): { success: boolean; reason: string } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图" };
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };
  const cell = room.cells[y][x];
  if (type === "wall" || type === "door" || type === "exit") {
    if (!material) return { success: false, reason: `建造${type}需要指定材料。请通过 material 参数传入材料物品名（如"砖"、"木板"、"门框"）。` };
    const invalidMaterials = ["锤子", "铲子", "撬棍", "手机", "钱包", "书包", "钥匙", "手电筒", "打火机", "自行车", "摩托车", "轻自动车", "绷带", "急救包"];
    if (invalidMaterials.includes(material)) return { success: false, reason: `${material}是功能性装备或工具，无法作为建材消耗。` };
    const idx = gameState.player.inventory.findIndex((i: any) => i.name === material && i.state !== "ruined");
    if (idx < 0) return { success: false, reason: `背包里没有${material}。需要先获取该材料。` };
    const buildingTools = ["锤子", "铲子", "撬棍"];
    const tool = gameState.player.inventory.find((i: any) => buildingTools.includes(i.name) && i.state !== "ruined");
    if (!tool && gameState.player.attributes.力量 < 5) return { success: false, reason: `力量不足（需要≥5），且背包里没有合适的建造工具（如"锤子"、"铲子"、"撬棍"）。` };
    gameState.player.inventory.splice(idx, 1);
    if (tool) damageItem(tool);
  }
  if (type === "floor" && cell.type === "wall") {
    const tool = material ? gameState.player.inventory.find((i: any) => i.name === material && i.state !== "ruined") : null;
    if (!tool && gameState.player.attributes.力量 < 5) return { success: false, reason: `力量不足（需要≥5），且背包里没有合适的工具。请指定 material 参数传入工具名（如"锤子"、"撬棍"）。` };
    if (tool) damageItem(tool);
  }
  cell.type = type;
  if (type === "wall") { cell.block = true; cell.label = "WL"; cell.furniture = null; }
  else if (type === "floor" || type === "stairs") { cell.block = !!cell.furniture; cell.label = cell.furniture ? cell.furniture.slice(0, 4) : "  "; }
  else if (type === "door" || type === "exit") { cell.block = !(cell.isOpen !== false); cell.label = "DR"; if (exitTo) cell.exitTo = exitTo; }
  saveState();
  return { success: true, reason: `在(${x},${y})建造了${type}${exitTo ? ` 通往${exitTo}` : ""}${material ? `（消耗${material}）` : ""}` };
}

export function placeFurniture(x: number, y: number, itemName: string, furnitureActions?: Record<string, any>): { success: boolean; reason: string } {
  if (!gameState.player.gridPos) return { success: false, reason: "当前位置不可建造" };
  const room = getRoom(gameState.player.location);
  if (!room) return { success: false, reason: "当前位置没有地图" };
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };
  const cell = room.cells[y][x];
  if (cell.type === "wall") return { success: false, reason: "不能放在墙上" };
  if (cell.type === "exit" || cell.type === "door") return { success: false, reason: "不能堵住门口" };
  if (cell.furniture) return { success: false, reason: `这里已经有${cell.furniture}了` };
  const idx = gameState.player.inventory.findIndex((i: any) => i.name === itemName);
  if (idx < 0) return { success: false, reason: `背包里没有${itemName}。需要先获取该物品（购买/拾荒/偷窃等）。` };
  gameState.player.inventory.splice(idx, 1);
  cell.furniture = itemName;
  cell.label = itemName.slice(0, 4);
  cell.block = true;
  if (furnitureActions && Object.keys(furnitureActions).length > 0) (cell as any).furniture_actions = furnitureActions;
  saveState();
  return { success: true, reason: `放置了${itemName}（已从背包扣除）` };
}

export function getItemTemplate(itemName: string): import("./types.ts").Item {
  let itemData: any = null;
  for (const cat of Object.values(itemsCatalog)) {
    if ((cat as any)[itemName]) { itemData = (cat as any)[itemName]; break; }
  }
  if (itemData) return structuredClone(itemData);
  return { name: itemName, type: "tool", slot: "back", weight: 1.0, effects: [], state: "intact", volume: 0.5 };
}

export function removeFurniture(x: number, y: number): { success: boolean; reason: string; item?: string } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图" };
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) return { success: false, reason: "坐标超出房间范围" };
  const cell = room.cells[y][x];
  if (!cell.furniture) return { success: false, reason: "这里没有家具" };
  const item = cell.furniture;
  cell.furniture = null; cell.block = false;
  const template = getItemTemplate(item);
  gameState.player.inventory.push(template);
  saveState();
  return { success: true, reason: `拆除了${item}（已放回背包）`, item };
}

export function toggleDoor(x: number, y: number): { success: boolean; reason: string; isOpen: boolean } {
  const room = ROOMS[gameState.player.location];
  if (!room) return { success: false, reason: "当前位置没有地图", isOpen: false };
  const cell = room.cells[y][x];
  if (cell.type !== "door" && cell.type !== "exit") return { success: false, reason: "这不是门窗", isOpen: false };
  if (cell.locked) {
    const keyMatch = matchKeyForDoor(gameState.player.equipment, gameState.player.location, cell.exitTo || "");
    if (!keyMatch) return { success: false, reason: "门锁着，需要钥匙", isOpen: false };
    cell.locked = false; cell.isOpen = true; cell.block = false;
    saveState();
    return { success: true, reason: `${keyMatch}打开了门`, isOpen: true };
  }
  cell.isOpen = !(cell.isOpen !== false);
  cell.block = !cell.isOpen;
  saveState();
  return { success: true, reason: cell.isOpen ? "打开了" : "关上了", isOpen: cell.isOpen };
}

// ── 房间辅助 ──

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
      if (cell && cell.type !== "wall" && cell.type !== "exit" && cell.type !== "door" && !cell.furniture) traversableCount++;
    }
  }
  room.capacity = Math.max(1, traversableCount);
  return room.capacity;
}

export function getGridContext(): string {
  const room = ROOMS[gameState.player.location];
  if (!room || !gameState.player.gridPos) return "";
  const [px, py] = gameState.player.gridPos;
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
      if (c.faces) around.push(`${side}是墙壁(有窗户朝向【${c.faces}】)${tagStr}${heightStr}`);
      else around.push(`${side}是墙壁${tagStr}${heightStr}`);
    }
    else if (c.furniture) around.push(`${side}被${c.furniture}挡住了${tagStr}${heightStr}`);
    else if (c.type === "exit" || c.type === "door") {
      const lockTag = c.locked ? "🔐" : c.isOpen === false ? "🔒" : "";
      const facingTag = c.faces ? `，朝向【${c.faces}】` : "";
      around.push(`${side}${lockTag}通向${c.exitTo || "?"}${facingTag}${tagStr}${heightStr}`);
    }
    else {
      if (c.faces) around.push(`${side}是空的(有开口朝向【${c.faces}】)${tagStr}${heightStr}`);
      else around.push(`${side}是空的，可以走${tagStr}${heightStr}`);
    }
  }
  const playerCell = room.cells[py][px];
  const pTagStr = playerCell.tags && playerCell.tags.length > 0 ? `[${playerCell.tags.join(",")}]` : "";
  const pHeightStr = playerCell.height !== undefined ? `[h:${playerCell.height}m]` : "";
  let ctx = `[空间] ${gameState.player.location} ${room.width}×${room.height}格 ${room.cellSize}m/格 F${room.floor} 你在(${px},${py})${pTagStr}${pHeightStr}`;
  const amb = (room as any).ambient;
  if (amb) ctx += ` | 环境: ${[amb.visual, amb.audio].filter(Boolean).join("，")}`;
  if (room.horizon) {
    const DIR_ENG_TO_CHN: Record<string, string> = { "north": "北面", "south": "南面", "east": "东面", "west": "西面", "n": "北面", "s": "南面", "e": "东面", "w": "西面" };
    const horStrings: string[] = [];
    for (const [dir, text] of Object.entries(room.horizon)) horStrings.push(`${DIR_ENG_TO_CHN[dir.toLowerCase()] || dir}望去:${text}`);
    if (horStrings.length > 0) ctx += ` | 远景视野: ${horStrings.join("，")}`;
  }
  if (exits.length > 0) ctx += ` | 出口:${exits.join(",")}`;
  if (facingViews.length > 0) ctx += ` | 窗外视野: ${facingViews.join(",")}`;
  if (furniture.length > 0) ctx += ` | 家具:${furniture.join(",")}`;
  ctx += ` | ${around.join("。")}`;
  return ctx;
}
