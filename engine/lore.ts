/**
 * 世界常识引擎 — 加载 data/orgs/，按触发条件过滤，注入 prompt
 *
 * 设计原则：
 * - 引擎只做过滤+排序，不编内容
 * - 按触发匹配度排序 → 取 top 5
 * - common 自动注入，industry/hidden 需主动查询
 */
import type { LoreOrgFile, LoreEntryItem } from "./types.ts";
import { gameState, isSameLocation, getLocationNav, characters } from "./state.ts";
import fs from "node:fs";
import path from "node:path";

const ORGS_DIR = path.resolve(process.cwd(), "data", "orgs");

let _loreCache: Record<string, LoreOrgFile[]> = {};

/** Load all org lore files for the active world */
export function loadOrgLore(world?: string): LoreOrgFile[] {
  const w = world || gameState.activeWorld || "oregairu";
  if (_loreCache[w]) return _loreCache[w];

  const files: LoreOrgFile[] = [];
  const pathsToScan = [
    path.resolve(process.cwd(), "worldpacks", w, "orgs"),
    ORGS_DIR,
  ];

  for (const dir of pathsToScan) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        if (Array.isArray(data)) files.push(...data);
        else files.push(data);
      } catch (e) { console.error("getLoreCatalog: 解析 lore 文件失败", e); }
    }
  }

  _loreCache[w] = files;
  return files;
}

/** Clear lore cache (world switch) */
export function clearLoreCache(): void { _loreCache = {}; }

/** Get player's current location breadcrumb for tiered matching */
function getBreadcrumb(location: string): string[] {
  try {
    const nav = getLocationNav(location);
    return nav?.breadcrumb || [];
  } catch (e) { console.error("getBreadcrumb: getLocationNav 失败", e); return []; }
}

/** Check if any trigger condition matches */
function matchesTrigger(
  entry: LoreEntryItem,
  location: string,
  topics: string[],
  roles: string[],
  orgs: string[],
  flags: Record<string, boolean>
): { matched: boolean; priority: number } {
  const t = entry.triggers;

  // Priority 1: exact location match
  if (t.locations) {
    for (const loc of t.locations) {
      if (isSameLocation(loc, location)) return { matched: true, priority: 1 };
    }
  }

  // Priority 2: breadcrumb location match
  if (t.locations) {
    const breadcrumb = getBreadcrumb(location);
    for (const loc of t.locations) {
      if (breadcrumb.some(b => isSameLocation(loc, b))) return { matched: true, priority: 2 };
    }
  }

  // Priority 3: org match
  if (t.orgs && orgs.length > 0) {
    for (const o of t.orgs) {
      if (orgs.includes(o)) return { matched: true, priority: 3 };
    }
  }

  // Priority 4: topic keyword match
  if (t.topics && topics.length > 0) {
    for (const topic of topics) {
      for (const tTopic of t.topics) {
        if (topic.includes(tTopic) || tTopic.includes(topic)) return { matched: true, priority: 4 };
      }
    }
  }

  // Priority 5: role match
  if (t.roles && roles.length > 0) {
    for (const role of t.roles) {
      if (roles.includes(role)) return { matched: true, priority: 5 };
    }
  }

  // Flag match — only for hidden entries (returns priority 0, requires explicit flag)
  if (t.flags) {
    for (const f of t.flags) {
      if (flags[f]) return { matched: true, priority: 0 };
    }
  }

  return { matched: false, priority: 99 };
}

/** Get triggered common lore for GM prompt injection */
export function getTriggeredLore(
  location: string,
  topics: string[] = [],
  roles: string[] = [],
  orgs: string[] = [],
  flags: Record<string, boolean> = {}
): string[] {
  const all = loadOrgLore();
  const scored: { text: string; priority: number }[] = [];

  for (const file of all) {
    for (const entry of file.entries) {
      if (entry.level !== "common") continue;
      const { matched, priority } = matchesTrigger(entry, location, topics, roles, orgs, flags);
      if (matched) {
        scored.push({ text: entry.text, priority });
      }
    }
  }

  // Sort by priority (lower = better match), then file order (stable)
  scored.sort((a, b) => a.priority - b.priority);
  return scored.slice(0, 5).map(s => s.text);
}

/** Get triggered lore for a specific NPC */
export function getNPCLore(npcName: string): string[] {
  const npc = gameState.npcs[npcName];
  if (!npc) return [];

  const src = (characters as any[])?.find((c: any) => c.name === npcName);
  const location = npc.currentRoom || "";
  const group = npc.scheduleGroup || src?.schedule_group || "";
  const tags = src?.tags || [];
  const roles = [group, ...tags];
  const orgsForNPC = [group];

  const all = loadOrgLore();
  const scored: { text: string; priority: number }[] = [];

  for (const file of all) {
    for (const entry of file.entries) {
      if (entry.level !== "common") continue;
      const { matched, priority } = matchesTrigger(entry, location, [], roles, orgsForNPC, gameState.flags);
      if (matched) {
        scored.push({ text: entry.text, priority });
      }
    }
  }

  scored.sort((a, b) => a.priority - b.priority);
  return scored.slice(0, 5).map(s => s.text);
}

/** Look up lore by keyword (for lookup_lore tool or GM active query) — returns all levels including industry/hidden */
export function queryLore(keyword: string, npcRoles: string[] = [], flags: Record<string, boolean> = {}): { tag: string; text: string; level: string }[] {
  const all = loadOrgLore();
  const results: { tag: string; text: string; level: string }[] = [];
  const kw = keyword.toLowerCase();

  for (const file of all) {
    for (const entry of file.entries) {
      if (entry.tag.toLowerCase().includes(kw) || entry.text.toLowerCase().includes(kw)) {
        // Check visibility
        if (entry.level === "hidden") {
          const hasFlag = entry.triggers.flags?.some(f => flags[f]);
          const hasRole = entry.triggers.roles?.some(r => npcRoles.includes(r));
          if (!hasFlag && !hasRole) continue;
        }
        if (entry.level === "industry" && npcRoles.length === 0) continue;
        results.push({ tag: entry.tag, text: entry.text, level: entry.level });
      }
    }
  }

  return results.slice(0, 10);
}
