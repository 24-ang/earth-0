/**
 * 路由引擎 - 位置→地区→角色触发链
 * 
 * 对应 ST 动漫角色目录的分层触发设计：
 *   player.location → region_entry → character_names → LLM
 */

/** 动态引用——随 Worldpack 切换自动更新。懒加载避免循环引用。 */
function getRegions(): any[] {
  return regions || [];
}
function getSchoolMap(): any {
  return schoolMap || { buildings: {}, school: "" };
}
function getCityMap(): any {
  return cityMap || {};
}

// 学校房间→学校名映射（路由用）
// 改为函数动态构建，避免 school_map.json 更新后缓存不一致
function getSchoolRooms(): Set<string> {
  const rooms = new Set<string>();
  const addRoom = (r: string) => {
    const clean = r.replace(/[（(].*[）)]/, "").trim().toLowerCase();
    if (clean) rooms.add(clean);
  };
  const sm = getSchoolMap();
  for (const [bname, bld] of Object.entries(sm.buildings)) {
    addRoom(bname);
    const b = bld as any;
    if (!b.rooms && !b.stairs && !b.bathrooms) continue;
    for (const roomList of Object.values(b.rooms || {})) {
      for (const r of (roomList as string[])) addRoom(r);
    }
    if (b.stairs) for (const s of b.stairs as string[]) addRoom(s);
    if (b.bathrooms) for (const brs of Object.values(b.bathrooms||{}) as string[][]) for (const r of brs) addRoom(r);
    if (Array.isArray(b) && b.length > 0 && typeof b[0] === "string") for (const r of (b as string[])) addRoom(r);
  }
  return rooms;
}

import regionsStatic from "../data/regions.json" with { type: "json" };
import charactersStatic from "../data/characters.json" with { type: "json" };
import schoolMapStatic from "../data/school_map.json" with { type: "json" };
import cityMapStatic from "../data/city_map.json" with { type: "json" };

export let regions = regionsStatic as any;
export let characters = charactersStatic as any[];
export let schoolMap = schoolMapStatic as any;
export let cityMap = cityMapStatic as any;
export let allChars = charactersStatic as any[];

export function updateRouterData(newRegions: any, newCharacters: any, newSchoolMap: any, newCityMap: any) {
  regions = newRegions;
  characters = newCharacters;
  allChars = newCharacters;
  schoolMap = newSchoolMap;
  cityMap = newCityMap;
}

export interface CharRoster {
  grade?: number;
  class?: string;
  role?: string; // "teacher" | "staff"
}

export interface RegionEntry {
  id: number;
  name: string;
  keys: string[];
  location_hints: string[];
  character_count: number;
  characters: string[];
  character_roster?: Record<string, CharRoster>;
  clubs?: Record<string, string[]>;
}

let academicYearOffset = 0;
export function setAcademicYearOffset(offset: number) { academicYearOffset = offset; }
export function getAcademicYearOffset() { return academicYearOffset; }

export interface RouterResult {
  matched_regions: RegionEntry[];
  all_characters: string[];
  context_brief: string;
}

/**
 * 根据玩家位置查询匹配的地区和角色
 */
export function lookupRegion(location: string): RouterResult {
  const lowerLoc = location.toLowerCase();
  
  // 学校内房间 → 精确匹配学校名，不扩散到城市
  let expandedLoc = lowerLoc;
  const schoolRooms = getSchoolRooms();
  if (schoolRooms.has(lowerLoc) || [...schoolRooms].some(r => lowerLoc.includes(r))) {
    expandedLoc = getSchoolMap().school.toLowerCase(); // 只用学校名，不加房间名
  }
  
  const matched: RegionEntry[] = [];
  const broadMatched: RegionEntry[] = []; // 城市级匹配（低优先级）
  
  for (const region of getRegions()) {
    const allTerms = [...region.keys, ...region.location_hints];
    let exactMatch = false;
    let broadMatch = false;
    
    for (const term of allTerms) {
      const t = term.toLowerCase();
      // 精确匹配：双向包含 且 hint长度 ≥ 学校名一半（排除城市名短串穿透）
      if ((expandedLoc.includes(t) && t.length >= expandedLoc.length * 0.5) ||
          (t.includes(expandedLoc) && expandedLoc.length >= t.length * 0.5)) {
        exactMatch = true; break;
      }
      // 宽泛匹配：只用原位置（非学校名扩展）
      if (lowerLoc !== expandedLoc && (lowerLoc.includes(t) || t.includes(lowerLoc))) {
        broadMatch = true; break;
      }
    }
    
    if (exactMatch) matched.push(region);
    else if (broadMatch) broadMatched.push(region);
  }
  
  // 精确 → 宽泛，去重
  // 宽泛匹配：用 city_map.json 的 parent 层级
  if (matched.length === 0 && broadMatched.length === 0) {
    const cm = getCityMap();
    for (const [rname, reg] of Object.entries(cm.regions)) {
      const r = reg as any;
      const hits = lowerLoc.includes(rname.toLowerCase())
        || (r.landmarks || []).some((l: string) => lowerLoc.includes(l.toLowerCase()));
      if (hits && r.parent) {
        const parentLoc = r.parent.toLowerCase();
        for (const region of getRegions()) {
          for (const term of [...region.keys, ...region.location_hints]) {
            if (parentLoc.includes(term.toLowerCase()) || term.toLowerCase().includes(parentLoc)) {
              broadMatched.push(region); break;
            }
          }
        }
        break;
      }
    }
  }
  
  for (const r of broadMatched) {
    if (!matched.find(m => m.name === r.name)) matched.push(r);
  }
  
  // 合并所有角色名（去重）
  let allChars = [...new Set(matched.flatMap(r => r.characters))];
  let filterHint = "";

  // 班级过滤：用 character_roster + academic_year_offset 动态算年级
  const classMatch = location.match(/(\d+)年([A-Z0-9])[班组]?/);
  if (classMatch) {
    const targetGrade = parseInt(classMatch[1]);
    const targetLetter = classMatch[2];
    const classChars: string[] = [];
    for (const region of matched) {
      const roster = (region as any).character_roster as Record<string, CharRoster> | undefined;
      if (!roster) continue;
      for (const [name, info] of Object.entries(roster)) {
        if (info.role === "teacher" || info.role === "staff") {
          classChars.push(name); // 老师在所有班级都出现
        } else if (info.grade !== undefined) {
          const actualGrade = info.grade + academicYearOffset;
          if (actualGrade === targetGrade && (info.class === targetLetter || info.class === "?")) {
            classChars.push(name);
          }
        }
      }
    }
    if (classChars.length > 0) {
      allChars = [...new Set(classChars)];
      filterHint = classMatch[0];
    }
  }

  // 社团过滤
  if (matched.length > 0) {
    for (const region of matched) {
      const cl = (region as any).clubs as Record<string, string[]> | undefined;
      if (!cl) continue;
      for (const [clubName, clubChars] of Object.entries(cl)) {
        if (location.includes(clubName) && clubChars.length > 0) {
          if (filterHint) {
            allChars = allChars.filter(c => clubChars.includes(c));
          } else {
            allChars = [...new Set(clubChars)];
          }
          filterHint = filterHint ? filterHint + "+" + clubName : clubName;
          break;
        }
      }
    }
  }
  // 如果没有班级/社团过滤，过滤掉不在roster中的角色（只保留有roster的角色+原始列表的交集）
  // 保留全部角色作为fallback

  // 生成上下文简报给 LLM
  const brief = buildContextBrief(matched, allChars, filterHint);

  return {
    matched_regions: matched.slice(0, 5), // 最多 5 个地区
    all_characters: allChars.slice(0, 30), // 最多 30 个角色名
    context_brief: brief
  };
}

/**
 * 搜索特定角色所属的地区
 */
export function lookupCharacter(name: string): RegionEntry[] {
  const lowerName = name.toLowerCase();
  return (regions as RegionEntry[]).filter(r =>
    r.characters.some(c => c.toLowerCase().includes(lowerName))
  );
}

/**
 * 生成地区简报文本（注入 LLM context）
 */
function buildContextBrief(regions: RegionEntry[], characters: string[], classroom?: string): string {
  if (regions.length === 0) return "当前地区暂无特殊角色信息。";

  const regionNames = regions.map(r => r.name).join("、");
  const charList = characters.slice(0, 20).join("、");
  const classHint = classroom ? `[${classroom}] ` : "";

  return `${classHint}当前地区关联作品：${regionNames}\n可能出现的角色：${charList}`;
}
