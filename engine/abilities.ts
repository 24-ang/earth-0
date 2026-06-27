/**
 * 能力系统引擎 — Layer B
 *
 * 超能力/忍术/咒术等复杂能力的加载、校验、结算。
 * 引擎只做机械化验证（资源/冷却/前置），叙事效果交给 LLM。
 *
 * 与技能系统的关系：平行独立。角色可同时有 skills.格斗Lv5 和 abilities.火球术Lv3。
 */

import fs from "node:fs";
import path from "node:path";
import type { AbilityState, ResourcePools } from "./types.ts";
import { gameState } from "./state.ts";
import { rollDamage } from "./dice.ts";

// ── 类型定义 ──

export interface AbilityDef {
  name: string;
  description: string;        // LLM 可理解的效果描述（≤50字）
  rank?: string;              // 可选等级标记（如 "C" "A" "S"）
  resourceCost?: Record<string, number>;  // { chakra: 15, stamina: 5 }
  cooldown?: number;          // 冷却回合数（0=无冷却）
  damage?: {
    dice: string;             // "2d8"
    type: string;             // "火焰" "雷电" "钝击"
    area?: string;            // "single" | "cone_3m" | "line_5m" | "radius_2m"
  };
  requires?: {
    skills?: Record<string, number>;      // { "忍术": 3 }
    attributes?: Record<string, number>;  // { "智力": 12 }
    abilities?: Record<string, number>;   // { "写轮眼": 1 }
  };
  narrativeOnly?: boolean;    // true=纯叙事，引擎只验证最低条件
}

// ── 数据加载 ──

let _catalog: Record<string, AbilityDef> | null = null;

const ABILITIES_DIR = path.join(process.cwd(), "data", "abilities");

export function loadAbilities(world?: string): Record<string, AbilityDef> {
  if (_catalog) return _catalog;
  _catalog = {};
  const dir = world
    ? path.join(process.cwd(), "worldpacks", world)
    : ABILITIES_DIR;

  // 优先 worldpack，fallback 到全局 data/abilities
  const wpFile = path.join(dir, "abilities.json");
  const globalFile = path.join(ABILITIES_DIR, "abilities.json");

  for (const file of [wpFile, globalFile]) {
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        const entries = Array.isArray(data) ? data : [data];
        for (const entry of entries) {
          if (entry?.name) _catalog[entry.name] = entry;
        }
      }
    } catch (e) { console.error("loadAbilitiesCatalog: 解析能力 JSON 失败", e); }
  }
  return _catalog;
}

export function getAbilityDef(name: string): AbilityDef | null {
  const cat = loadAbilities(gameState?.activeWorld);
  return cat[name] || null;
}

export function getAllAbilities(): AbilityDef[] {
  return Object.values(loadAbilities(gameState?.activeWorld));
}

// ── 能力 EXP ──

export function addAbilityExp(
  abilities: Record<string, AbilityState>,
  name: string,
  amount: number
): Record<string, AbilityState> {
  if (!abilities[name]) {
    abilities[name] = { name, level: 0, exp: 0, nextLevel: 10, cooldownRemaining: 0 };
  }
  const a = abilities[name];
  if (a.level >= 10) return abilities;

  a.exp += amount;
  while (a.exp >= a.nextLevel && a.level < 10) {
    a.exp -= a.nextLevel;
    a.level++;
    a.nextLevel = (a.level + 1) * 10;
  }
  return abilities;
}

// ── 资源操作 ──

export function getResource(
  pools: ResourcePools | undefined,
  poolName: string
): { current: number; max: number } {
  if (!pools || !pools[poolName]) return { current: 0, max: 0 };
  return pools[poolName]!;
}

export function consumeResource(
  pools: ResourcePools | undefined,
  poolName: string,
  amount: number
): { ok: boolean; remaining: number } {
  if (!pools || !pools[poolName]) return { ok: false, remaining: 0 };
  const pool = pools[poolName]!;
  if (pool.current < amount) return { ok: false, remaining: pool.current };
  pool.current -= amount;
  return { ok: true, remaining: pool.current };
}

export function restoreResource(
  pools: ResourcePools | undefined,
  poolName: string,
  amount: number
): number {
  if (!pools || !pools[poolName]) return 0;
  const pool = pools[poolName]!;
  const before = pool.current;
  pool.current = Math.min(pool.max, pool.current + amount);
  return pool.current - before;
}

// ── 前置检查 ──

export interface RequirementResult {
  ok: boolean;
  missing: string[];  // 人类可读的缺失列表
}

export function checkRequirements(
  user: { skills?: Record<string, { level: number }>; abilities?: Record<string, AbilityState>; attributes?: Record<string, number> },
  def: AbilityDef
): RequirementResult {
  const missing: string[] = [];
  const req = def.requires;
  if (!req) return { ok: true, missing: [] };

  if (req.skills) {
    for (const [name, minLv] of Object.entries(req.skills)) {
      const lv = user.skills?.[name]?.level ?? 0;
      if (lv < minLv) missing.push(`技能"${name}"需Lv${minLv}(当前Lv${lv})`);
    }
  }
  if (req.abilities) {
    for (const [name, minLv] of Object.entries(req.abilities)) {
      const lv = user.abilities?.[name]?.level ?? 0;
      if (lv < minLv) missing.push(`能力"${name}"需Lv${minLv}(当前Lv${lv})`);
    }
  }
  if (req.attributes) {
    for (const [name, minVal] of Object.entries(req.attributes)) {
      const val = user.attributes?.[name] ?? 0;
      if (val < minVal) missing.push(`属性"${name}"需≥${minVal}(当前${val})`);
    }
  }

  return { ok: missing.length === 0, missing };
}

// ── 冷却管理 ──

export function tickCooldowns(abilities: Record<string, AbilityState>): void {
  for (const a of Object.values(abilities)) {
    if (a.cooldownRemaining > 0) a.cooldownRemaining--;
  }
}

// ── 能力结算结果 ──

export interface AbilityResult {
  ok: boolean;
  narrative: string;         // 结算摘要，LLM 在此基础上叙事
  damage?: { raw: number; type: string };
  resourceChanges: { pool: string; before: number; after: number }[];
  cooldownSet: number;       // 设置的冷却回合
  errors: string[];
}

// ── 核心：使用能力 ──

export function useAbility(
  user: {
    name: string;
    resourcePools?: ResourcePools;
    abilities?: Record<string, AbilityState>;
    skills?: Record<string, { level: number }>;
    attributes?: Record<string, number>;
  },
  abilityName: string,
  targetName?: string
): AbilityResult {
  const errors: string[] = [];
  const resourceChanges: AbilityResult["resourceChanges"] = [];

  // 1. 加载定义
  const def = getAbilityDef(abilityName);
  if (!def) {
    return { ok: false, narrative: "", resourceChanges, cooldownSet: 0,
      errors: [`未知能力: ${abilityName}`] };
  }

  // 2. 前置检查
  const req = checkRequirements(user, def);
  if (!req.ok) {
    return { ok: false, narrative: "", resourceChanges, cooldownSet: 0,
      errors: [`前置条件不满足: ${req.missing.join("; ")}`] };
  }

  // 3. 冷却检查
  const state = user.abilities?.[abilityName];
  if (state && state.cooldownRemaining > 0) {
    return { ok: false, narrative: "", resourceChanges, cooldownSet: 0,
      errors: [`${abilityName}冷却中，还需${state.cooldownRemaining}回合`] };
  }

  // 4. 资源消耗
  if (def.resourceCost) {
    for (const [poolName, amount] of Object.entries(def.resourceCost)) {
      const result = consumeResource(user.resourcePools, poolName, amount);
      if (!result.ok) {
        const pool = getResource(user.resourcePools, poolName);
        errors.push(`资源不足: ${poolName}需${amount}, 当前${pool.current}`);
      } else {
        resourceChanges.push({ pool: poolName, before: result.remaining + amount, after: result.remaining });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, narrative: "", resourceChanges, cooldownSet: 0, errors };
  }

  // 5. 纯叙事能力
  if (def.narrativeOnly) {
    // 设置冷却
    if (state && def.cooldown) state.cooldownRemaining = def.cooldown;
    const resText = `${user.name}使用了${abilityName}。${def.description}`;
    return { ok: true, narrative: resText, resourceChanges, cooldownSet: def.cooldown || 0, errors: [] };
  }

  // 6. 伤害结算
  let damageResult: AbilityResult["damage"] = undefined;
  if (def.damage) {
    damageResult = {
      raw: rollDamage(def.damage.dice, 0),
      type: def.damage.type,
    };
  }

  // 7. 设置冷却
  if (state && def.cooldown) state.cooldownRemaining = def.cooldown;

  // 8. 构建叙事摘要
  const parts: string[] = [];
  parts.push(`${user.name}使用了${abilityName}`);
  if (def.rank) parts.push(`[${def.rank}级]`);
  if (targetName) parts.push(`→ ${targetName}`);
  if (damageResult) parts.push(`造成${damageResult.raw}点${damageResult.type}伤害`);
  if (resourceChanges.length > 0) {
    parts.push(resourceChanges.map(r => `${r.pool}:${r.before}→${r.after}`).join(", "));
  }
  if (def.cooldown) parts.push(`(冷却${def.cooldown}回合)`);

  return {
    ok: true,
    narrative: parts.join(" "),
    damage: damageResult,
    resourceChanges,
    cooldownSet: def.cooldown || 0,
    errors: [],
  };
}
