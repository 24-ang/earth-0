/**
 * engine/phase4-creative.ts — Phase 4 创意层（可选，best-effort）
 *
 * 在渲染完成后检查触发条件，满足时调一次 LLM 做创意判断。
 * 只有 5 个 B 类工具：create_story_hook / reveal_secret / instantiate_npc /
 *                        create_character / spawn_temp_npc
 *
 * Phase 4 失败不影响游戏推进——渲染已经输出给玩家了。
 */

import { generateCompletion } from "../tools/helpers.ts";

// ── 公开 API ──

/** 运行 Phase 4 创意层。不做不影响游戏推进。 */
export async function runPhase4(
  phase1Summary: string,
  ctx: any,
): Promise<void> {
  const { gameState, saveState } = await import("./state.ts");

  // 1. 检查触发条件
  const triggers = detectTriggers(gameState, phase1Summary);
  if (triggers.length === 0) return;

  // 2. 组装最小的创意 prompt
  const prompt = buildCreativePrompt(triggers, gameState);

  // 3. 调 LLM（best-effort，失败静默）
  try {
    const raw = await generateCompletion(prompt, 512, ctx);
    // 创意 LLM 的输出目前仅作为日志——工具调用仍需走 pi agent
    // 后续可以扩展为解析 JSON 并自动调用创意工具
    if (raw) {
      gameState._lastCreativeOutput = raw;
      saveState();
    }
  } catch (e) {
    console.error("Phase4: creative LLM call failed (non-critical):", e);
  }
}

// ── 触发条件检测 ──

interface CreativeTrigger {
  type: "relation_breakthrough" | "scene_change" | "timeline_event" | "potential_hook";
  detail: string;
}

function detectTriggers(gs: any, phase1Summary: string): CreativeTrigger[] {
  const triggers: CreativeTrigger[] = [];

  // 关系突破检测
  if (gs.player?.relationships) {
    for (const [npcName, rel] of Object.entries(gs.player.relationships) as [string, any][]) {
      // 检查好感度是否刚跨过阈值
      const prevAffection = gs._prevAffection?.[npcName] ?? 0;
      const currentAffection = rel.affection ?? 0;

      const thresholds = [
        { value: 20, label: "认识" },
        { value: 40, label: "朋友" },
        { value: 60, label: "好友" },
        { value: 80, label: "亲密" },
      ];

      for (const t of thresholds) {
        if (prevAffection < t.value && currentAffection >= t.value) {
          triggers.push({
            type: "relation_breakthrough",
            detail: `${npcName}好感度突破${t.label}阈值（${prevAffection}→${currentAffection}）`,
          });
        }
      }
    }
  }

  // 场景切换检测
  const prevLocation = gs._prevLocation;
  const currentLocation = gs.player?.location;
  if (prevLocation && currentLocation && prevLocation !== currentLocation) {
    triggers.push({
      type: "scene_change",
      detail: `玩家从${prevLocation}移动到${currentLocation}`,
    });
  }

  // timeline 事件
  const activeHooks = gs.active_hooks || [];
  if (activeHooks.length > 0) {
    triggers.push({
      type: "timeline_event",
      detail: `${activeHooks.length}个活跃钩子待处理`,
    });
  }

  // Phase 1 summary 包含剧情暗示
  const hookKeywords = ["冲突", "危机", "秘密", "揭露", "告白", "发现", "意外"];
  if (hookKeywords.some(kw => phase1Summary.includes(kw))) {
    triggers.push({
      type: "potential_hook",
      detail: `摘要含剧情暗示: ${phase1Summary}`,
    });
  }

  return triggers;
}

// ── 创意 prompt ──

function buildCreativePrompt(triggers: CreativeTrigger[], gs: any): string {
  const triggerText = triggers.map(t => `- [${t.type}] ${t.detail}`).join("\n");

  return [
    "你是创意导演。以下触发条件已满足，决定是否需要创建剧情钩子、揭示秘密或引入新角色。",
    `当前回合: ${gs.turn}，场景: ${gs.player?.location}`,
    "",
    "触发条件:",
    triggerText,
    "",
    "如果不需要做任何事，回复: none",
    "如果需要，回复你想做的事的一句话描述。",
  ].join("\n");
}
