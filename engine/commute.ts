/**
 * 通勤偶遇引擎 — 在玩家旅行时检测同方向 NPC，注入途中偶遇叙事
 *
 * 设计原则：
 * - 不建新房间、不移动 NPC、不拦截旅行流程
 * - 玩家照常到达目的地后，叙事中追加"途中偶遇"的倒叙段落
 * - NPC 日程完全不受影响——只检测"谁和你同路"
 * - 同一条通勤线（京葉線/総武線）上的 NPC 更容易偶遇
 */
import type { GameState } from "./types.ts";
import fs from "node:fs";
import path from "node:path";

// lazy-import to avoid circular deps
let _findCharacter: any = null;
let _getNpcCurrentAge: any = null;
async function _ensureHelpers() {
  if (!_findCharacter) {
    const state = await import("./state.ts");
    _findCharacter = state.findCharacter;
    _getNpcCurrentAge = state.getNpcCurrentAge;
  }
}

/** 根据角色数据判断住址（优先 default_location_by_age） */
async function getNPCHomeArea(name: string, npc: any): Promise<string> {
  await _ensureHelpers();
  const src = _findCharacter(name);
  if (!src) return npc.currentRoom || "";
  if (src.default_location_by_age) {
    const curAge = _getNpcCurrentAge(src.base_age || 16);
    const keys = Object.keys(src.default_location_by_age).map(Number).sort((a, b) => a - b);
    let best = src.default_location_by_age[String(keys[0])];
    for (const k of keys) { if (k <= curAge) best = src.default_location_by_age[String(k)]; else break; }
    if (best) return best;
  }
  return src.default_location || npc.currentRoom || "";
}

/** 获取当前世界线地图配置 */
function getCityMapConfig(): any {
  try {
    const { gameState } = require("./state.ts");
    const activeWorld = gameState.activeWorld || "oregairu";
    const wPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "city_map.json");
    const defaultPath = path.resolve(process.cwd(), "data", "city_map.json");
    const filePath = fs.existsSync(wPath) ? wPath : defaultPath;
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {
    console.error("commute: getCityMapConfig error", e);
  }
  return null;
}

/** 通勤方向分组 */
export function getCommuteDirection(location: string): string {
  // 1. 优先使用正则判断（保证与测试和春物特定地点的完全兼容性）
  if (/幕張|稲毛海岸|検見川|蘇我|千葉みなと|海浜幕張/i.test(location)) return "京葉線";
  if (/千葉駅|西千葉|稲毛|本千葉|千葉_下町/i.test(location)) return "総武線";

  const config = getCityMapConfig();
  const cleanLoc = location.replace(/[（(].*[）)]/, "").trim().toLowerCase();

  if (config) {
    // 2. 直接匹配线路站名 (stops)
    if (config.transit) {
      for (const [lineName, lineData] of Object.entries<any>(config.transit)) {
        const stops = lineData.stops || [];
        for (const stop of stops) {
          const cleanStop = stop.replace(/[站駅]/, "").toLowerCase();
          if (cleanLoc.includes(cleanStop) || cleanStop.includes(cleanLoc)) {
            if (lineName.includes("京叶") || lineName.includes("京葉")) return "京葉線";
            if (lineName.includes("总武") || lineName.includes("総武")) return "総武線";
            return lineName;
          }
        }
      }
    }

    // 3. 匹配区域 (regions) 关联的车站所属线路
    if (config.regions) {
      let foundRegionData: any = null;
      for (const [rname, rdata] of Object.entries<any>(config.regions)) {
        const landmarks = rdata.landmarks || [];
        const isLandmark = landmarks.some((l: string) => {
          const cleanL = l.toLowerCase();
          return cleanLoc.includes(cleanL) || cleanL.includes(cleanLoc);
        });
        if (isLandmark || cleanLoc.includes(rname.toLowerCase())) {
          foundRegionData = rdata;
          break;
        }
      }

      if (foundRegionData?.stations && config.transit) {
        for (const stationName of Object.keys(foundRegionData.stations)) {
          const cleanStation = stationName.replace(/[站駅]/, "").toLowerCase();
          for (const [lineName, lineData] of Object.entries<any>(config.transit)) {
            const stops = lineData.stops || [];
            if (stops.some((s: string) => s.toLowerCase().includes(cleanStation) || cleanStation.includes(s.toLowerCase()))) {
              if (lineName.includes("京叶") || lineName.includes("京葉")) return "京葉線";
              if (lineName.includes("总武") || lineName.includes("総武")) return "総武線";
              return lineName;
            }
          }
        }
      }
    }
  }

  return "その他";
}

/** 判断玩家当前可能的住址：如果在 evening/night 且在家，用 current location 推 */
function inferPlayerHome(gs: GameState): string {
  const loc = gs.player?.location || "";
  // 世界级位置（非房间名）→ 可能就是住宅区方向
  if (getCommuteDirection(loc) !== "その他") return loc;
  return "";
}

/** 检测通勤偶遇：返回叙事注入文本，或 null */
export async function detectCommuteEncounter(
  from: string, to: string, method: string, duration: number, gs: GameState
): Promise<string | null> {
  // 0. 载具感知
  const v = gs.player?.vehicle;
  const hasVehicle = !!v;
  const vehicleType = v?.type;
  const vehicleName = v?.name || "";

  // 1. 基础概率（载具影响）
  let probability = 0.30;
  if (vehicleType === "car") probability *= 0.1;
  else if (hasVehicle) probability *= 0.6;
  if ((gs.worldState?.tension ?? 0) >= 3) probability += 0.15;
  if ((gs.worldState?.stability ?? 0) < 0) probability += 0.10;
  if (duration > 15) probability += 0.15;
  probability = Math.max(0.05, Math.min(0.70, probability));
  if (Math.random() > probability) return null;

  // 2. 判断玩家移动方向
  let schoolName = "";
  try {
    const { schoolMap } = require("./router.ts");
    schoolName = schoolMap?.school || "";
  } catch (e) {
    console.error("commute: schoolName load error", e);
  }
  const cleanSchool = schoolName.toLowerCase();
  const isGoingToSchool = (cleanSchool && to.toLowerCase().includes(cleanSchool)) ||
    to.includes("学校") || to.includes("校") || to.includes("高") || to.toLowerCase().includes("school");
  const isLeavingSchool = (cleanSchool && from.toLowerCase().includes(cleanSchool)) ||
    from.includes("学校") || from.includes("校") || from.includes("高") || from.toLowerCase().includes("school");

  const timeOfDay = gs.time?.time_of_day || "morning";
  const isMorningCommute = timeOfDay === "morning";
  const isAfternoonCommute = timeOfDay === "afternoon" || timeOfDay === "evening";

  // 3. 确定玩家通勤方向：早上从家出发用 from，放学回家用 to
  const playerHomeHint = isMorningCommute ? from : (isAfternoonCommute && isLeavingSchool ? to : inferPlayerHome(gs));
  const playerDirection = getCommuteDirection(playerHomeHint);

  // 4. 找同方向 NPC
  const candidates: { name: string; affection: number; sameLine: boolean }[] = [];
  for (const [name, npc] of Object.entries(gs.npcs)) {
    if (!npc.alive) continue;
    const following = (gs.player?.following || []);
    if (gs.player?.party?.includes(name) || following.includes(name)) continue;

    const group = npc.scheduleGroup || "";
    const isStudent = group.includes("学生") || group.includes("高校生") || group.includes("部员") || group.includes("大学");
    const isTeacher = group.includes("教师");

    // 上学方向
    if (isMorningCommute && isGoingToSchool && (isStudent || isTeacher)) {
      candidates.push({ name, affection: gs.player?.relationships?.[name]?.affection ?? 0, sameLine: false });
    }

    // 放学方向
    if (isAfternoonCommute && isLeavingSchool && (isStudent || isTeacher)) {
      const isClubMember = group.includes("运动部") || group.includes("社团") || group.includes("部员");
      if (isClubMember && timeOfDay === "afternoon") continue;
      if (!isClubMember && timeOfDay === "evening") continue;
      candidates.push({ name, affection: gs.player?.relationships?.[name]?.affection ?? 0, sameLine: false });
    }
  }

  // 5. 计算每个候选人的通勤方向（异步——但批量查询不会太重）
  for (const c of candidates) {
    const npc = gs.npcs[c.name];
    if (!npc) continue;
    const npcHome = await getNPCHomeArea(c.name, npc);
    const npcDir = getCommuteDirection(npcHome);
    c.sameLine = npcDir !== "その他" && npcDir === playerDirection;
  }

  if (candidates.length === 0) return null;

  // 6. 排序：同线路优先 ×1.5 + 好感度 → top 3 随机 1-2 人
  candidates.sort((a, b) => {
    const scoreA = a.affection * (a.sameLine ? 1.5 : 1.0);
    const scoreB = b.affection * (b.sameLine ? 1.5 : 1.0);
    return scoreB - scoreA;
  });
  const pool = candidates.slice(0, 3);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 2);
  const names = picked.map(p => p.name).join("、");

  // 7. 生成叙事注入
  let vehicleDesc: string;
  let sharedVehicle: string;
  if (vehicleType === "car") {
    vehicleDesc = "车内";
    sharedVehicle = `你开着${vehicleName}`;
  } else if (hasVehicle) {
    vehicleDesc = "路上";
    sharedVehicle = `你骑着${vehicleName}`;
  } else if (method.includes("电车")) {
    vehicleDesc = "电车车厢";
    sharedVehicle = "这趟电车";
  } else if (method.includes("公交")) {
    vehicleDesc = "公交车";
    sharedVehicle = "这趟公交车";
  } else {
    vehicleDesc = "路上";
    sharedVehicle = "这条路";
  }

  const hints: string[] = [];
  for (const { name } of picked) {
    const rel = gs.player?.relationships?.[name];
    if (rel) {
      hints.push(`${name}（${rel.stage || "熟人"}，好感${rel.affection ?? 0}）`);
    }
  }

  const isDriving = vehicleType === "car";
  const encounterTip = isDriving
    ? `你在路口等红灯时注意到 ${names} 从车旁走过。${hints.length > 0 ? hints.join("；") + "。" : ""}自然地描写这个短暂的画面——摇下车窗打个招呼，或者只是对视一笑。到达 ${to} 后，你把车停好，回归步行。`
    : `在${duration}分钟的${method}旅途中，${vehicleDesc}里${picked.length > 1 ? "恰好有" : "恰好遇到"} ${names} 也在${sharedVehicle}上。${hints.length > 0 ? hints.join("；") + "。" : ""}自然地描写这段途中的偶遇——擦肩、点头、短暂的搭话，或者只是隔窗相望。到达 ${to} 后，你们各自散去，各自继续这一天的行程。`;

  return `[通勤偶遇] ${sharedVehicle}。${encounterTip}`;
}
