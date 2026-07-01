/**
 * state-location.ts — 地点层级导航
 * 从 state.ts 拆分。导入 state.ts（ESM live bindings，函数内访问无环问题）。
 */

import {
  normalizeLocationName, isSameLocation, getRoomKey,
  LOCATIONS_BASE, SCHOOL_MAP, CITY_MAP, LOCATIONS_DELTA,
  ROOMS, gameState, saveState,
} from "./state.ts";
import fs from "node:fs";
import path from "node:path";

// ── 内部类型 ──

interface LocationNode {
  key: string;
  name: string;
  type: string;
  children: LocationNode[];
  parent: LocationNode | null;
}

// ── 公开类型 ──

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

// ── 地点树构建 ──

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

      const districts = pref.districts;
      if (districts) {
        if (Array.isArray(districts)) {
          const mainDistrict: LocationNode = { key: districts[0], name: districts[0], type: "district", children: [], parent: prefNode };
          prefNode.children.push(mainDistrict);
          for (const s of (pref.schools || [])) {
            mainDistrict.children.push({ key: s, name: s, type: "school", children: [], parent: mainDistrict });
          }
          for (const l of (pref.landmarks || [])) {
            mainDistrict.children.push({ key: l, name: l, type: "landmark", children: [], parent: mainDistrict });
          }
          for (let i = 1; i < districts.length; i++) {
            prefNode.children.push({ key: districts[i], name: districts[i], type: "district", children: [], parent: prefNode });
          }
        } else {
          for (const [dname, ddata] of Object.entries(districts as Record<string, any>)) {
            const distNode: LocationNode = { key: dname, name: dname, type: "district", children: [], parent: prefNode };
            prefNode.children.push(distNode);
            for (const s of (ddata.schools || [])) {
              distNode.children.push({ key: s, name: s, type: "school", children: [], parent: distNode });
            }
            for (const l of (ddata.landmarks || [])) {
              distNode.children.push({ key: l, name: l, type: "landmark", children: [], parent: distNode });
            }
          }
        }
      } else {
        for (const s of (pref.schools || [])) {
          prefNode.children.push({ key: s, name: s, type: "school", children: [], parent: prefNode });
        }
        for (const l of (pref.landmarks || [])) {
          prefNode.children.push({ key: l, name: l, type: "landmark", children: [], parent: prefNode });
        }
      }

      const customs = LOCATIONS_DELTA[pref.name] || [];
      for (const c of customs) {
        prefNode.children.push({ key: c, name: c, type: "custom", children: [], parent: prefNode });
      }
    }

    const regCustoms = LOCATIONS_DELTA[reg.name] || [];
    for (const c of regCustoms) {
      regNode.children.push({ key: c, name: c, type: "custom", children: [], parent: regNode });
    }
  }
  return root;
}

function findInTree(node: LocationNode, locName: string): LocationNode | null {
  const cleanLoc = normalizeLocationName(locName);
  if (normalizeLocationName(node.name) === cleanLoc) return node;
  if (isSameLocation(node.name, locName)) return node;
  for (const child of node.children) {
    const found = findInTree(child, locName);
    if (found) return found;
  }
  return null;
}

function findSchoolContext(locName: string): { school: string; building: string; floor: string } | null {
  if (!SCHOOL_MAP?.buildings) return null;
  const cleanLoc = normalizeLocationName(locName);
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

  const sportsGrounds = SCHOOL_MAP.buildings["运动设施"] as string[] | undefined;
  if (sportsGrounds) {
    for (const sg of sportsGrounds) {
      buildings.push(sg);
    }
  }

  return { buildings, floorsByBuilding, roomsByFloor };
}

// ── 公开 API ──

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

  const breadcrumb: string[] = [];
  let cur = node;
  while (cur) { breadcrumb.unshift(cur.name); cur = cur.parent; }

  const schoolCtx = findSchoolContext(locName);
  const isSchoolNode = node?.type === "school";
  const isInsideSchool = !!schoolCtx;

  const rooms: string[] = [];
  if (schoolCtx) {
    const floorKey = `${schoolCtx.building} ${schoolCtx.floor}`;
    const schoolData = getSchoolInternals(schoolCtx.school);
    const floorRooms = schoolData.roomsByFloor[floorKey] || [];
    rooms.push(...floorRooms.filter(r => !isSameLocation(r, locName)));
  }

  let parent: string | null = null;
  let siblings: string[] = [];
  let children: string[] = [];
  let level = node?.type || "unknown";

  if (isInsideSchool) {
    parent = schoolCtx!.school;
    level = "room";
    if (breadcrumb.length === 0 || !breadcrumb.includes(schoolCtx!.school)) {
      breadcrumb.push(schoolCtx!.school);
    }
    breadcrumb.push(schoolCtx!.building, schoolCtx!.floor);
    const floorKey = `${schoolCtx!.building} ${schoolCtx!.floor}`;
    const schoolData = getSchoolInternals(schoolCtx!.school);
    siblings = (schoolData.roomsByFloor[floorKey] || []).filter(r => !isSameLocation(r, locName));
    children = [];
  } else if (isSchoolNode) {
    parent = node?.parent?.name || null;
    level = "school";
    const schoolData = getSchoolInternals(node!.name);
    if (schoolData.buildings.length > 0) {
      children = schoolData.buildings.filter(b => {
        const hasFloors = schoolData.floorsByBuilding[b]?.length > 0;
        const isSportsGround = SCHOOL_MAP?.buildings?.["运动设施"]?.includes(b);
        return hasFloors || isSportsGround;
      });
    } else {
      children = (node?.children || []).map(c => c.name);
    }
    if (node?.parent) {
      for (const c of node.parent.children) {
        if (c.name !== node!.name) siblings.push(c.name);
      }
    }
  } else {
    parent = node?.parent?.name || null;
    level = node?.type || "unknown";
    if (node?.parent) {
      for (const c of node.parent.children) {
        if (c.name !== node!.name) siblings.push(c.name);
      }
    }
    children = (node?.children || []).map(c => c.name);
    for (const [rname] of Object.entries(ROOMS)) {
      if (knownLocationMatch(rname, locName)) rooms.push(rname);
    }
  }

  const nearby: { name: string; minutes: number }[] = [];
  if (isSchoolNode && SCHOOL_MAP?.buildings) {
    const surroundings = SCHOOL_MAP["周边"] as { name: string; min: number }[] | undefined;
    if (surroundings) {
      for (const s of surroundings) nearby.push({ name: s.name, minutes: s.min });
    }
  }
  const parentNode = node?.parent;
  if (parentNode && (node?.type === "school" || node?.type === "landmark" || node?.type === "custom")) {
    for (const c of parentNode.children) {
      if (c.name === node!.name) continue;
      if (nearby.some(n => n.name === c.name)) continue;
      const hash = c.name.split("").reduce((s: number, ch: string) => s + ch.charCodeAt(0), 0);
      const mins = 10 + (hash % 20);
      nearby.push({ name: c.name, minutes: mins });
    }
  }

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

export function createDynamicLocation(parentName: string, name: string): string {
  LOCATIONS_DELTA[parentName] ??= [];
  if (LOCATIONS_DELTA[parentName].includes(name)) return `${name} 已存在`;
  LOCATIONS_DELTA[parentName].push(name);
  if (!gameState.player.known_locations.includes(name)) {
    gameState.player.known_locations.push(name);
  }

  if (!ROOMS[name]) {
    const w = 10, h = 10;
    const cells: any[][] = [];
    for (let y = 0; y < h; y++) {
      const row: any[] = [];
      for (let x = 0; x < w; x++) {
        row.push({ type: "floor", block: false, furniture: null, label: "  " });
      }
      cells.push(row);
    }
    ROOMS[name] = { width: w, height: h, cellSize: 1, floor: 0, origin: [Math.floor(w/2), Math.floor(h/2)], cells, capacity: undefined };
  }

  saveState();
  return `创建了新地点: ${name}（位于 ${parentName}）`;
}

export function loadLocationsDelta(targetDir?: string): void {
  const baseDir = targetDir ?? path.resolve(process.cwd(), "state");
  const deltaPath = path.join(baseDir, "locations_delta.json");
  if (fs.existsSync(deltaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(deltaPath, "utf-8"));
      // ESM import bindings are read-only; mutate in place
      for (const key of Object.keys(LOCATIONS_DELTA)) delete LOCATIONS_DELTA[key];
      Object.assign(LOCATIONS_DELTA, parsed);
    } catch (e) {
      console.error("Failed to parse locations_delta.json:", e);
      for (const key of Object.keys(LOCATIONS_DELTA)) delete LOCATIONS_DELTA[key];
    }
  } else {
    for (const key of Object.keys(LOCATIONS_DELTA)) delete LOCATIONS_DELTA[key];
  }
}
