/**
 * 骰子引擎 - d20 + AC + 伤害 + 掩体
 */

/** D&D 属性修正： (val - 10) / 2 向下取整 */
export function attrMod(val: number): number {
  return Math.floor((val - 10) / 2);
}

export type Difficulty = "简单" | "普通" | "困难" | "极难" | "不可能";
export type Advantage = "优势" | "劣势" | "平";
export type CoverType = "无掩体" | "半掩体" | "全掩体";

const DC: Record<string, number> = {
  "简单": 8, "普通": 12, "困难": 16, "极难": 20, "不可能": 25,
  "trivial": 8, "easy": 8, "moderate": 12, "hard": 16, "very_hard": 20, "nearly_impossible": 25,
};

function d20(): number { return Math.floor(Math.random() * 20) + 1; }

// --- 通用检定（数字DC版，引擎底层通用工具） ---
export function checkDC(dc: number, attribute: number, skillLv: number, advantage: Advantage = "平") {
  const d = d20();
  const d2 = (advantage !== "平") ? d20() : d;
  const kept = advantage === "优势" ? Math.max(d,d2) : advantage === "劣势" ? Math.min(d,d2) : d;
  const mod = attrMod(attribute) + skillLv * 2;
  const total = kept + mod;
  const crit = d === 20;
  const fumble = d === 1;

  let outcome: "success" | "success-with-cost" | "failure";
  if (crit) outcome = "success";
  else if (fumble) outcome = "failure";
  else if (total >= dc) outcome = "success";
  else if (total >= dc - 3) outcome = "success-with-cost";
  else outcome = "failure";

  return { success: outcome !== "failure", partial: outcome === "success-with-cost", outcome, roll: { kept, mod, total, dc, crit, fumble }, margin: total - dc };
}

// --- 通用检定 ---
export function check(difficulty: Difficulty, attribute: number, skillLv: number, advantage: Advantage = "平") {
  const d = d20();
  const d2 = (advantage !== "平") ? d20() : d;
  const kept = advantage === "优势" ? Math.max(d,d2) : advantage === "劣势" ? Math.min(d,d2) : d;
  const mod = attrMod(attribute) + skillLv * 2;
  const total = kept + mod;
  const dc = DC[difficulty];
  const crit = d === 20;
  const fumble = d === 1;

  let outcome: "success" | "success-with-cost" | "failure";
  if (crit) outcome = "success";
  else if (fumble) outcome = "failure";
  else if (total >= dc) outcome = "success";
  else if (total >= dc - 3) outcome = "success-with-cost";
  else outcome = "failure";

  return { success: outcome !== "failure", partial: outcome === "success-with-cost", outcome, roll: { kept, mod, total, dc, crit, fumble }, margin: total - dc };
}

// --- 攻击 ---
export function attackRoll(
  attackerDexOrStr: number,
  attackerSkill: number,
  targetAC: number,
  cover: CoverType,
  advantage: Advantage = "平"
) {
  const d = d20();
  const d2 = (advantage !== "平") ? d20() : d;
  let kept = advantage === "优势" ? Math.max(d,d2) : advantage === "劣势" ? Math.min(d,d2) : d;
  
  // 掩体影响攻击方
  if (cover === "半掩体") kept = Math.min(kept, (advantage !== "平") ? Math.min(d,d2) : d20()); // 劣势等效
  if (cover === "全掩体") return { hit: false, crit: false, fumble: false, total: 0 };
  
  if (advantage === "平" && cover === "半掩体") kept = Math.min(kept, d20());
  
  const mod = attrMod(attackerDexOrStr) + attackerSkill * 2;
  const total = kept + mod;
  const crit = d === 20;
  const fumble = d === 1;
  
  return { hit: crit || total >= targetAC, crit, fumble, total, margin: total - targetAC };
}

// --- 伤害 ---
export function rollDamage(dice: string, strMod: number): number {
  const match = dice.match(/^(\d+)d(\d+)(?:([+-]\d+))?$/);
  if (!match) {
    const [count, sides] = dice.split("d").map(Number);
    let total = 0;
    for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
    return total + strMod;
  }
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total + modifier + strMod;
}

// --- 减伤 ---
export function applyDR(damage: number, dr: number): number {
  return Math.max(0, damage - dr);
}

// --- 等级碾压 ---
export function isOverwhelming(attackerLv: number, defenderLv: number): boolean {
  return attackerLv - defenderLv >= 10;
}

// --- 身份检定 ---
export function identityCheck(difficulty: Difficulty, charisma: number, disguiseSkillLv: number = 0) {
  return check(difficulty, charisma, disguiseSkillLv);
}
