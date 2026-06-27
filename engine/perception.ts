/**
 * 察觉统一检定 — 替代硬编码 Math.random() 和纯 LLM 判断。
 * 所有视觉/听觉检测都走此函数，引擎零硬编码。
 */

import { checkDC, attrMod } from "./dice.ts";

export interface PerceptionActor {
  attributes: Record<string, number>;
  skills: Record<string, { level: number }>;
  equipment: any;
  concealed?: boolean;
}

export interface PerceptionContext {
  distance_m: number;
  noise: "quiet" | "normal" | "loud";
  light: "dark" | "dim" | "bright";
  walls_between: number;
}

export interface PerceptionResult {
  seen: boolean;
  heard: boolean;
  margin: number;
  roll: { kept: number; mod: number; total: number; dc: number };
}

/**
 * 通用察觉检定
 * @param actor     被观察者（偷窃者/躲藏者）
 * @param observer  观察者（NPC/警卫）
 * @param context   环境上下文
 * @returns 是否被看到、是否被听到、检定裕度
 */
export function perceptionCheck(
  actor: PerceptionActor,
  observer: PerceptionActor,
  context: PerceptionContext
): PerceptionResult {
  // 基础 DC = 10
  let visualDC = 10;
  let audioDC = 10;

  // 距离修正：每米 -1（越远越难察觉）
  const distPenalty = Math.min(context.distance_m, 10);  // 上限 -10
  visualDC -= distPenalty;
  audioDC -= distPenalty;

  // 噪音修正：噪音大 → 动作声音被掩盖 → 听觉更难察觉
  if (context.noise === "quiet")  { visualDC -= 4; audioDC -= 4; }
  if (context.noise === "loud")   { visualDC += 0; audioDC += 8; }
  // normal: no change

  // 光照修正：亮容易看到，暗不容易
  if (context.light === "dark")   { visualDC += 4; }
  if (context.light === "bright") { visualDC -= 4; }
  // dim: no change

  // 墙壁：每堵墙 -5（视觉+听觉）
  visualDC -= context.walls_between * 5;
  audioDC -= context.walls_between * 5;

  // observer 感知属性 + 察觉技能
  const perception = observer.attributes["感知"] || observer.attributes["感知"] || 10;
  const perceptionSkill = observer.skills["察觉"]?.level || 0;

  // 视觉检定（actor concealed 则自动失败）
  let seen = false;
  let visualResult: any = null;
  if (actor.concealed) {
    seen = false;
  } else {
    visualResult = checkDC(visualDC, perception, perceptionSkill);
    seen = visualResult.success;
  }

  // 听觉检定
  const audioResult = checkDC(audioDC, perception, perceptionSkill);
  const heard = audioResult.success;

  // 裕度取视觉/听觉中的较高值
  const visualMargin = visualResult?.margin ?? -99;
  const audioMargin = audioResult.margin;
  const margin = Math.max(visualMargin, audioMargin);

  // 返回视觉检定的 roll（如果视觉失败/不适用则用听觉的）
  const roll = visualResult?.roll || audioResult.roll;

  return { seen, heard, margin, roll };
}
