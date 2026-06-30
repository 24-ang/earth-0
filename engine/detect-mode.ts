import type { GameState } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════
// Part 1: 叙事模式检测（共位 → 交互检测升级）
// ═══════════════════════════════════════════════════════════════════

export interface InteractionModeResult {
  interactionMode: "novel" | "turn_based";
  person: "first" | "third";
  /** 在 cue 玩家的 NPC 名列表 */
  activeNPCs: string[];
}

/**
 * 检测叙事模式。
 *
 * 旧行为（无 npcResponses + activeNPCs）：
 *   用 nearbyNPCsCount 做共位近似 → 有人在场就 turn_based。
 *
 * 新行为（有 npcResponses + activeNPCs）：
 *   用 activeNPCs 做精确交互检测 → 只有 cue 玩家的 NPC 才切 turn_based。
 *   沉默的在场 NPC 不强制切模式。
 */
export function detectInteractionMode(
  gameState: GameState,
  nearbyNPCsCount: number,
  opts?: {
    npcResponses?: Record<string, string>;
    activeNPCs?: string[];
    skipCounterUpdate?: boolean;
  },
): InteractionModeResult {
  const activeNPCs = opts?.activeNPCs ?? [];

  // 锁死特定场景（不变）
  if (gameState.mode === "sex") {
    return { interactionMode: "turn_based", person: "first", activeNPCs };
  }
  if ((gameState.mode as any) === "combat") {
    return { interactionMode: "turn_based", person: "third", activeNPCs };
  }

  // ── 新路径：有 NPC 回应数据 → 交互检测 ──
  if (opts?.npcResponses && opts?.activeNPCs !== undefined) {
    if (activeNPCs.length > 0) {
      // 有人在 cue 玩家 → turn_based
      if (!opts.skipCounterUpdate) {
        gameState.turnsSinceLastNPCInteraction = 0;
      }
      return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third", activeNPCs };
    } else if (nearbyNPCsCount > 0) {
      // 有人在但没人 cue → novel（沉默 NPC 不打断）
      if (!opts.skipCounterUpdate) {
        gameState.turnsSinceLastNPCInteraction = (gameState.turnsSinceLastNPCInteraction || 0) + 1;
      }
      // 沉默 NPC 场景下：不等防抖，直接 novel（防止沉默 NPC 锁死 turn_based）
      return { interactionMode: "novel", person: gameState.mode === "gal" ? "first" : "third", activeNPCs };
    } else {
      // 没人在场 → novel 防抖
      if (!opts.skipCounterUpdate) {
        gameState.turnsSinceLastNPCInteraction = (gameState.turnsSinceLastNPCInteraction || 0) + 1;
      }
      if ((gameState.turnsSinceLastNPCInteraction || 0) >= 2) {
        return { interactionMode: "novel", person: gameState.mode === "gal" ? "first" : "third", activeNPCs };
      }
      return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third", activeNPCs };
    }
  }

  // ── 旧路径：共位检测（向后兼容） ──
  if (nearbyNPCsCount > 0) {
    gameState.turnsSinceLastNPCInteraction = 0;
    return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third", activeNPCs: [] };
  } else {
    gameState.turnsSinceLastNPCInteraction = (gameState.turnsSinceLastNPCInteraction || 0) + 1;
    if (gameState.turnsSinceLastNPCInteraction >= 2) {
      return { interactionMode: "novel", person: gameState.mode === "gal" ? "first" : "third", activeNPCs: [] };
    }
    return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third", activeNPCs: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════
// analyzeNpcResponses — LLM mini-judge + 关键词兜底
// ═══════════════════════════════════════════════════════════════════

/**
 * 分析每个 NPC 的回应，返回在 cue 玩家的 NPC 名列表。
 *
 * 流程：
 *   1. 空/纯 *内心独白* 无对话 → 直接判不 cue（跳过 LLM）
 *   2. 含「」或『』对话 → LLM mini-judge（JSON 输出 yes/no）
 *   3. JSON parse 失败 → 关键词兜底
 */
export async function analyzeNpcResponses(
  npcResponses: Record<string, string>,
  playerName: string,
  ctx: any,
): Promise<string[]> {
  const names = Object.keys(npcResponses);
  if (names.length === 0) return [];

  // 先分离"需要 LLM 判断"和"直接可判"的
  const needsLLM: { name: string; text: string }[] = [];
  const active: string[] = [];

  for (const name of names) {
    const text = npcResponses[name]?.trim() || "";
    if (!text) continue; // 空回应 → 沉默

    const hasDialogue = /[「『』」]/.test(text);

    if (!hasDialogue) {
      // 只有内心独白 *...* 或纯描述，无对话 → 不 cue
      // 但如果文本中含"看""盯""指""走近"等指向性动词 + 玩家名 → 可能 cue
      // 保守策略：只有内心独白无对话 → 不 cue
      continue;
    }

    // 有对话标记 → 需要 LLM 判断（或关键词兜底）
    needsLLM.push({ name, text });
  }

  if (needsLLM.length === 0) return active;

  // 并行 LLM mini-judge
  const results = await Promise.all(
    needsLLM.map(async ({ name, text }) => {
      // 预先检查用 LLM 还是直接用关键词
      // 如果对话中明确含玩家名「维」「你」→ 快速判 cue（省 LLM 调用）
      const dialogueMatch = text.match(/[「『]([^」』]*)[」』]/g);
      const dialogueText = dialogueMatch ? dialogueMatch.join(" ") : text;
      if (new RegExp(`[「『][^」』]*(${playerName}|你)[^」』]*[」』]`).test(text)) {
        // 对话中直接喊玩家名 → 肯定 cue
        return name;
      }

      // LLM mini-judge
      try {
        const { generateCompletion } = await import("../tools/helpers.ts");
        const judgePrompt = [
          `判断以下NPC对白是否在对玩家说话。`,
          `NPC名: ${name}`,
          `NPC对白: ${text}`,
          `玩家名: ${playerName}`,
          ``,
          `只输出JSON: {"cueing": true/false, "reason": "一句话原因"}`,
          `cueing=true 的条件：NPC主动向玩家发起了对话、提问、打招呼、求助等直接互动。如果NPC在自言自语/和其他NPC说话/内心独白→false。`,
        ].join("\n");

        const raw = await generateCompletion(judgePrompt, 128, ctx, undefined);
        // 尝试 parse JSON
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.cueing === true) return name;
        }
      } catch (e) {
        // LLM 失败 → 关键词兜底
        console.error("analyzeNpcResponses: LLM mini-judge failed for", name, e);
      }

      // 关键词兜底
      if (keywordFallbackCue(dialogueText, playerName, name)) {
        return name;
      }
      return null;
    }),
  );

  for (const r of results) {
    if (r) active.push(r);
  }
  return active;
}

// ── 关键词兜底（保守：宁可漏判不可误判） ──

const CUE_VERBS = /(问|说|告诉|叫|喊|看|盯|指|笑|招手|扭头|转向|走近|抬头|喂|呐|呢|吧)/;
const CUE_ADDRESS = /维|你/;

function keywordFallbackCue(dialogueText: string, playerName: string, npcName: string): boolean {
  // 对话内含玩家名或「你」→ 强信号
  if (CUE_ADDRESS.test(dialogueText)) return true;
  // 对话内含指向性动词 + 玩家名在同一段 → cue
  // 已经在上面的快速检查里处理了，这里是保守兜底
  return false;
}
