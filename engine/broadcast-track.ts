import { GameState } from "./types.ts";
import { generateCompletion } from "../tools/helpers.ts";
import path from "node:path";
import fs from "node:fs";

/**
 * 产生匿名弹幕轨数据 (静态模板匹配)
 */
export function generateBroadcastDanmaku(gs: GameState, lastNarrative: string): string[] {
  if (!gs._theaterActive) return [];

  // 递减冷却计数
  gs._danmakuCooldown = (gs._danmakuCooldown ?? 3) - 1;

  // 重情节检测：如果检测到死亡、告白、走光、心动等词汇，强制触发且重置CD
  const isHeavyPlot = /死亡|牺牲|告白|走光|心动|接吻|破损|避孕/.test(lastNarrative);
  if (!isHeavyPlot && gs._danmakuCooldown > 0) {
    return [];
  }

  // 重置冷却 (3-5 轮)
  gs._danmakuCooldown = Math.floor(Math.random() * 3) + 3;

  // 加载弹幕模板库
  let templates: any = {};
  const scriptWorld = gs._theaterScriptId || "test_broadcast";
  const scriptPath = path.join(process.cwd(), "worldpacks", scriptWorld, "danmaku_templates.json");
  const fallbackPath = path.join(process.cwd(), "data", "theater", "danmaku_templates.json");

  if (fs.existsSync(scriptPath)) {
    try { templates = JSON.parse(fs.readFileSync(scriptPath, "utf-8")); } catch (_) {}
  } else if (fs.existsSync(fallbackPath)) {
    try { templates = JSON.parse(fs.readFileSync(fallbackPath, "utf-8")); } catch (_) {}
  }

  const resultDanmakus: string[] = [];
  const anonymousPool: string[] = templates.anonymous || ["前方高能！", "打卡名场面！"];

  // 1. 随机捞取 1-2 条匿名普通弹幕
  const numAnon = Math.floor(Math.random() * 2) + 1;
  for (let i = 0; i < numAnon; i++) {
    const rIdx = Math.floor(Math.random() * anonymousPool.length);
    resultDanmakus.push(`[弹幕] ${anonymousPool[rIdx]}`);
  }

  // 2. 根据模板中配置的角色名匹配弹幕（模板 key 即角色名，anonymous 除外）
  const knownNpcs = Object.keys(templates).filter(k => k !== "anonymous");
  for (const name of knownNpcs) {
    if (lastNarrative.includes(name) && templates[name]) {
      const typeKey = lastNarrative.includes("尴尬") || lastNarrative.includes("抱") || lastNarrative.includes("走光")
        ? "romantic"
        : "generic";
      const list = templates[name][typeKey] || templates[name]["generic"] || [];
      if (list.length > 0) {
        const item = list[Math.floor(Math.random() * list.length)];
        resultDanmakus.push(`[${name}（弹幕）]：${item}`);
      }
    }
  }

  return resultDanmakus;
}

/**
 * 产生具名主世界观众吐槽 (独立 Agent LLM 调用)
 */
export async function generateNPCCommentary(gs: GameState, lastNarrative: string, ctx?: any): Promise<string | null> {
  if (!gs._theaterActive || !gs._theaterBackup) return null;

  gs._commentaryCooldown = (gs._commentaryCooldown ?? 4) - 1;

  // 重情节检测：同理，强制触发且重置CD
  const isHeavyPlot = /死亡|牺牲|告白|走光|心动|接吻|破损|避孕/.test(lastNarrative);
  if (!isHeavyPlot && gs._commentaryCooldown > 0) {
    return null;
  }

  // 重置冷却 (5-8 轮)
  gs._commentaryCooldown = Math.floor(Math.random() * 4) + 5;

  // 解析备份主世界，用于找出观众状态
  let backupState: GameState;
  try {
    backupState = JSON.parse(gs._theaterBackup);
  } catch (e) {
    console.error("generateNPCCommentary: 无法解析 _theaterBackup", e);
    return null;
  }

  // 1. 智能筛选吐槽的观众 NPC
  // 优先级 A: 剧情内容中提到的本体 NPC (如 lastNarrative 里包含 "雪之下雪乃"，则优先用雪乃)
  const knownNpcs = Object.keys(backupState.npcs);
  let targetNpc = "";
  for (const name of knownNpcs) {
    if (lastNarrative.includes(name)) {
      targetNpc = name;
      break;
    }
  }

  // 优先级 B: 若无，挑选跟主角色在同一个放映厅附近的观众
  if (!targetNpc) {
    const audienceList = Object.entries(backupState.npcs)
      .filter(([_, n]) => n.alive && n.currentRoom === backupState.player.location)
      .map(([name]) => name);
    if (audienceList.length > 0) {
      targetNpc = audienceList[Math.floor(Math.random() * audienceList.length)];
    }
  }

  // 优先级 C: 挑选好感度最高的角色
  if (!targetNpc) {
    let maxAff = -1;
    for (const [name, rel] of Object.entries(backupState.player.relationships)) {
      if (rel.affection > maxAff && backupState.npcs[name]) {
        maxAff = rel.affection;
        targetNpc = name;
      }
    }
  }

  // 兜底：无任何匹配观众则跳过本轮评论
  if (!targetNpc) {
    return null;
  }

  const npcState = backupState.npcs[targetNpc];
  if (!npcState) return null;

  const appearanceBrief = npcState.appearance_brief || "冷静毒舌的总武高二年级女生。";
  const rel = backupState.player.relationships[targetNpc];
  const affection = rel?.affection ?? 0;

  // 2. 拼接 Prompt
  const systemPrompt = `你正在扮演动漫《我的青春恋爱物语果然有问题》中的经典角色【${targetNpc}】。目前你作为观众坐在放映厅里，看着大屏幕上播放着主角维（以及平行世界的你）的异常荒野冒险。你现在要发表弹幕评论。`;
  
  const userPrompt = `
【当前屏幕上映出的放映切片故事】
"${lastNarrative}"

【你的设定背景】
你的名字：${targetNpc}
性格特征/人设：${appearanceBrief}
你对主角 维 的现实好感度：${affection}/100 (0-100，好感越高心智越受触动，低好感则比较冷漠或嫌弃)

请根据你自身的性格设定、对维的好感，以及刚刚看到的画面，发表一句 30-50 字的傲娇/嫌弃/感触的真实吐槽弹幕。
必须遵守的格式要求：
1. 仅输出单行评论。
2. 格式必须为：[${targetNpc}（弹幕）]：吐槽内容。
3. 绝对不要带有任何其他多余文本、Markdown 引导语或系统说明。
  `.trim();

  // 3. 执行轻量 LLM query
  try {
    const commentary = await generateCompletion(userPrompt, 80, ctx, undefined, systemPrompt);
    if (commentary && commentary.includes("（弹幕）")) {
      return commentary.trim();
    }
    // 简单兜底防止LLM返回格式错乱
    return `[${targetNpc}（弹幕）]：……这可真是让人惊叹的放映内容呢。`;
  } catch (e) {
    console.error(`generateNPCCommentary LLM FAILED for ${targetNpc}:`, e);
    return `[${targetNpc}（弹幕）]：这是什么粗劣的影像。`;
  }
}
