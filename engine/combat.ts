/**
 * 战斗引擎 - 回合制战斗流程封装
 * 
 * 依赖 dice.ts 的底层骰子函数。
 * 原则: engine算数字，返回叙事摘要给LLM。
 */

import { attackRoll, rollDamage, applyDR, isOverwhelming } from "./dice.ts";
import type { CoverType, Advantage } from "./dice.ts";
import type { Item, PlayerState, Wound } from "./types.ts";
import { getEquipmentBonus } from "./state.ts";

export type { CoverType, Advantage };

// --- 战斗参与者 ---
export interface Combatant {
  name: string;
  state: PlayerState;
  cover: CoverType;
}

// --- 行动类型 ---
export type ActionType = "攻击" | "防御" | "使用物品" | "逃跑" | "谈判" | "等待";

export interface CombatAction {
  type: ActionType;
  target?: string;
  weapon?: Item;
  item?: Item;
  description?: string;
}

// --- 单次攻击结算 ---
export interface AttackResult {
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  damage: number;
  afterDR: number;
  targetHP: { before: number; after: number };
  narrative: string;
  killed: boolean;
  coverApplied: CoverType;
}

export function resolveAttack(
  attacker: Combatant,
  defender: Combatant,
  weapon: Item,
  advantage: Advantage = "平",
  combatSkill: string = "格斗"
): AttackResult {
  const useStr = weapon.damage?.damageType !== "穿刺";
  const attrKey = useStr ? "力量" : "敏捷";
  const baseAttr = attacker.state.attributes[attrKey];
  const equipBonus = getEquipmentBonus(attacker.state.equipment, "attribute_bonus", attrKey);
  const attr = baseAttr + equipBonus;
  const skill = (attacker.state.skills[combatSkill]?.level ?? attacker.state.skills["格斗"]?.level ?? 0)
    + getEquipmentBonus(attacker.state.equipment, "skill_bonus", combatSkill);
  const ac = defender.state.ac;

  // 等级碾压
  if (isOverwhelming(attr, defender.state.hp.max)) {
    return {
      hit: true, crit: true, fumble: false,
      damage: 999, afterDR: 999,
      targetHP: { before: defender.state.hp.current, after: 0 },
      narrative: `${attacker.name}的攻击对${defender.name}是压倒性的——一击致命。`,
      killed: true, coverApplied: defender.cover,
    };
  }

  // 攻击检定
  const roll = attackRoll(attr, skill, ac, defender.cover, advantage);
  if (!roll.hit) {
    const missDesc = roll.fumble
      ? `${attacker.name}的攻击完全打偏了。`
      : defender.cover === "全掩体"
        ? `${attacker.name}的攻击打在掩体上。`
        : `${attacker.name}的攻击没能命中${defender.name}。`;
    return {
      hit: false, crit: false, fumble: roll.fumble ?? false,
      damage: 0, afterDR: 0,
      targetHP: { before: defender.state.hp.current, after: defender.state.hp.current },
      narrative: missDesc, killed: false, coverApplied: defender.cover,
    };
  }

  // 伤害计算
  const strMod = useStr ? Math.floor((attacker.state.attributes.力量 - 10) / 2) : 0;
  const baseDmg = rollDamage(weapon.damage?.dice ?? "1d2", strMod);
  const critBonus = roll.crit ? Math.floor(baseDmg * 0.5) : 0;
  const rawDmg = baseDmg + critBonus;

  // 减伤
  let dr = 0;
  for (const [_, item] of Object.entries(defender.state.equipment)) {
    if (!item) continue;
    for (const eff of item.effects) {
      if (eff.type === "damage_reduction") dr += Number(eff.value);
    }
  }
  const finalDmg = applyDR(rawDmg, dr);

  // 扣HP
  const beforeHP = defender.state.hp.current;
  defender.state.hp.current = Math.max(0, beforeHP - finalDmg);
  const afterHP = defender.state.hp.current;
  const killed = afterHP <= 0;

  // 叙事与伤势记录
  let narrative = "";
  if (roll.crit) narrative += `重击！`;
  if (defender.cover === "半掩体") narrative += `${defender.name}在掩体后，但${attacker.name}的攻击还是穿透了。`;
  narrative += `${attacker.name}用${weapon.name}造成${finalDmg}点伤害。`;
  
  if (finalDmg > 0 && defender.state.wounds) {
    const wound = describeWound(finalDmg, weapon.damage?.damageType || "钝击");
    defender.state.wounds.push(wound);
    narrative += ` 造成伤势: ${wound.text} (${wound.severity})。`;
  }
  
  if (defender.state.hp.current <= 3 && defender.state.hp.current > 0) narrative += ` ${defender.name}摇摇欲坠。`;
  if (killed) narrative += ` ${defender.name}倒下了。`;

  return {
    hit: true, crit: roll.crit ?? false, fumble: false,
    damage: rawDmg, afterDR: finalDmg,
    targetHP: { before: beforeHP, after: afterHP },
    narrative, killed, coverApplied: defender.cover,
  };
}

// --- 防御行动 ---
export function defend(actor: Combatant): string {
  // 防御: 本回合AC+2，视为寻找掩体
  return `${actor.name}摆出防御姿态，准备闪避或格挡。`;
}

// --- 逃跑检定 ---
export interface FleeResult {
  success: boolean;
  narrative: string;
}

export function attemptFlee(
  actor: Combatant,
  opponent: Combatant
): FleeResult {
  const dexDiff = actor.state.attributes.敏捷 - opponent.state.attributes.敏捷;
  const fleeDC = 12 - dexDiff;
  const d = Math.floor(Math.random() * 20) + 1;
  const success = d >= fleeDC;
  return {
    success,
    narrative: success
      ? `${actor.name}成功脱离了战斗。`
      : `${actor.name}试图逃跑，但${opponent.name}挡住了去路。`,
  };
}

// --- 死亡豁免 ---
export interface DeathSaveResult {
  roll: number;
  success: boolean;
  nat20: boolean;
  nat1: boolean;
  narrative: string;
}

export function makeDeathSave(state: PlayerState): DeathSaveResult {
  const roll = Math.floor(Math.random() * 20) + 1;
  const nat20 = roll === 20;
  const nat1 = roll === 1;
  const success = roll >= 10;

  // 累积追踪
  state.deathSaves ??= { successes: 0, failures: 0 };
  if (nat20) {
    state.deathSaves.successes = 3; // 20=立即稳定
    state.deathSaves.failures = 0;
  } else if (nat1) {
    state.deathSaves.failures += 2; // 1=计2次失败
  } else if (success) {
    state.deathSaves.successes++;
  } else {
    state.deathSaves.failures++;
  }

  const ss = state.deathSaves.successes;
  const ff = state.deathSaves.failures;

  const narrative = nat20
    ? `${state.name}猛然睁眼——奇迹般地恢复了意识。`
    : nat1
      ? `${state.name}的身体抽搐了一下，然后不动了。（${ss}成功/${ff}失败）`
      : success
        ? `${state.name}的伤势没有恶化。（${ss}成功/${ff}失败）`
        : `${state.name}的呼吸变得更微弱了。（${ss}成功/${ff}失败）`;

  return { roll, success, nat20, nat1, narrative };
}

// --- 回合摘要（给LLM） ---
export interface RoundSummary {
  actions: { actor: string; narrative: string }[];
  stateSnapshots: { name: string; hp: { current: number; max: number }; alive: boolean }[];
  deaths: string[];
}

export function getRoundSummary(combatants: Combatant[], roundActions: { actor: string; narrative: string }[]): RoundSummary {
  return {
    actions: roundActions,
    stateSnapshots: combatants.map(c => ({
      name: c.name,
      hp: { current: c.state.hp.current, max: c.state.hp.max },
      alive: c.state.alive,
    })),
    deaths: combatants.filter(c => !c.state.alive).map(c => c.name),
  };
}

// --- 伤势描述 ---
export function describeWound(damage: number, damageType: string): Wound {
  const sev = damage >= 10 ? "重伤" : damage >= 5 ? "中等" : "轻伤";
  const texts: Record<string, Record<string, string[]>> = {
    "钝击": {
      "轻伤": ["瘀青了一块", "擦破了皮", "肿了起来"],
      "中等": ["肋骨隐隐作痛", "手臂发麻抬不起来", "头被震得嗡嗡响"],
      "重伤": ["骨头可能裂了", "吐出一口血", "意识模糊"],
    },
    "切割": {
      "轻伤": ["一道浅口子渗出血珠", "皮肤被划开"],
      "中等": ["鲜血顺着胳膊流下来", "伤口需要缝合"],
      "重伤": ["血止不住地流", "能看到里面的组织"],
    },
    "穿刺": {
      "轻伤": ["皮肤上多了个小血点"],
      "中等": ["扎得有点深，拔出来时血喷了一下"],
      "重伤": ["穿透伤——必须马上处理"],
    },
    "电击": {
      "轻伤": ["一阵麻木"],
      "中等": ["肌肉痉挛，短暂失去控制"],
      "重伤": ["身体弹起来又重重摔在地上"],
    },
  };

  const pool = texts[damageType]?.[sev] ?? texts["钝击"][sev] ?? ["受伤了"];
  const text = pool[Math.floor(Math.random() * pool.length)];

  return { severity: sev, text, source: damageType };
}
