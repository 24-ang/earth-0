import type { GameState, CutawayDirective } from "./types.ts";
import { isSameLocation } from "./state.ts";

let pendingViewpointPromise: Promise<string | null> | null = null;

export function getPendingViewpointPromise(): Promise<string | null> | null {
  return pendingViewpointPromise;
}

export function clearPendingViewpointPromise(): void {
  pendingViewpointPromise = null;
}

function getDayNumber(dateStr: string): number {
  if (!dateStr) return 1;
  const parts = dateStr.split("-");
  const y = Number(parts[0]) || 2018;
  const m = (Number(parts[1]) || 4) - 1;
  const day = Number(parts[2]) || 7;
  const start = Date.UTC(2018, 0, 1);
  const now = Date.UTC(y, m, day);
  return Math.round((now - start) / 86400000) + 1;
}

export async function processViewpointTriggers(
  gameState: GameState,
  previousNPCsCount: number,
  currentNPCsCount: number,
  ctx: any
): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  // 1. 更新对话持续时间与触发余波
  if (previousNPCsCount >= 2) {
    gameState.turnsInConversation = (gameState.turnsInConversation || 0) + 1;
  } else {
    gameState.turnsInConversation = 0;
  }

  const prevLocation = gameState.player.location;
  const candidateNPCNames = Object.entries(gameState.npcs)
    .filter(([_, n]) => n.alive && isSameLocation(n.currentRoom, prevLocation))
    .map(([name]) => name);

  if (previousNPCsCount >= 2 && currentNPCsCount === 0 && (gameState.turnsInConversation || 0) >= 3) {
    // 触发余波：挑选权重最高的一个 NPC
    const { getActiveHooks } = await import("./timeline.ts");
    const activeHooks = getActiveHooks();
    let bestNPC = "";
    let maxWeight = -999;

    for (const npcName of candidateNPCNames) {
      const npc = gameState.npcs[npcName];
      if (!npc) continue;

      let baseWeight = 10;
      const rel = gameState.player.relationships[npcName];
      const affectionWeight = rel ? Math.min(30, rel.affection * 0.3) : 0;
      const memoriesCount = npc.memoryTags ? npc.memoryTags.length : 0;
      const memoryTagWeight = Math.min(25, memoriesCount * 5);
      const timelineWeight = activeHooks.some(h => h.source_npc === npcName) ? 15 : 0;

      // 处罚：最近 3 回合切过
      let recentCutawayPenalty = 0;
      const curDayNum = getDayNumber(gameState.time.game_date);
      if (npc.memoryTags) {
        for (const tag of npc.memoryTags) {
          if (tag.tag.startsWith("[切镜")) {
            const tagDayNum = getDayNumber(tag.since);
            if (curDayNum - tagDayNum < 3) {
              recentCutawayPenalty = -50;
              break;
            }
          }
        }
      }

      const weight = baseWeight + affectionWeight + memoryTagWeight + timelineWeight + recentCutawayPenalty;
      if (weight > maxWeight) {
        maxWeight = weight;
        bestNPC = npcName;
      }
    }

    if (bestNPC) {
      gameState._cutaway_queue ??= [];
      gameState._cutaway_queue.push({
        type: "余波",
        npc: bestNPC,
        weight: 30,
        trigger: "刚才的对话结束了——她独自离开"
      });
    }

    gameState.turnsInConversation = 0; // 重置
  }

  // 2. 同场复述触发
  if (gameState._replay_pov) {
    const replayNpc = gameState._replay_pov;
    const lastResponse = gameState._npc_last_responses?.[replayNpc];
    if (lastResponse) {
      gameState._cutaway_queue ??= [];
      gameState._cutaway_queue.push({
        type: "同场复述",
        npc: replayNpc,
        weight: 80,
        trigger: lastResponse
      });
    }
    delete gameState._replay_pov; // 清空
  }

  // 3. 队列整理 (合并同NPC、排序、裁剪上限为 3)
  if (gameState._cutaway_queue && gameState._cutaway_queue.length > 0) {
    const merged: Record<string, CutawayDirective> = {};
    for (const dir of gameState._cutaway_queue) {
      const key = `${dir.type}_${dir.npc}`;
      if (merged[key]) {
        if (dir.trigger && merged[key].trigger && !merged[key].trigger!.includes(dir.trigger!)) {
          merged[key].trigger += `；${dir.trigger}`;
        }
      } else {
        merged[key] = { ...dir };
      }
    }
    gameState._cutaway_queue = Object.values(merged)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
  }

  // 4. 冷却递减
  if (gameState._cutaway_cooldown && gameState._cutaway_cooldown > 0) {
    gameState._cutaway_cooldown--;
  }

  // 5. 消费队列启动异步任务
  if (
    gameState.interactionMode === "novel" &&
    (!gameState._cutaway_cooldown || gameState._cutaway_cooldown === 0) &&
    gameState._cutaway_queue &&
    gameState._cutaway_queue.length > 0
  ) {
    const directive = gameState._cutaway_queue.shift()!;
    gameState._cutaway_cooldown = 3;

    // 拉起异步 LLM 任务 (Non-blocking Fork)
    pendingViewpointPromise = (async () => {
      try {
        const contractPath = path.resolve(process.cwd(), "agents", "gm-intermission-contract.md");
        const contract = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, "utf-8") : "";

        const prompt = [
          contract,
          "",
          "---",
          "",
          "【当前要编写的角色与时空背景】:",
          `- 视角角色 (POV NPC): ${directive.npc}`,
          `- 其他出场角色: ${directive.npcs ? directive.npcs.join(", ") : "无"}`,
          `- 地点: ${directive.setting || "未知地点"}`,
          `- 触发缘由: ${directive.trigger || "日常生活"}`,
          `- 主题: ${directive.topic || "内心活动与当下细节"}`,
          `- 基调 (Tone): ${directive.tone || "静谧描写"}`,
          `- 核心要点 (Must Cover): ${directive.must_cover ? directive.must_cover.map(p => `  • ${p}`).join("\n") : "无"}`,
          `- 字数控制: ${directive.length === "long" ? "800-2000字" : "200-500字"}`,
          "",
          "---",
          "",
          "现在，请作为文学主笔开始创作这一章节。直接输出正文，不要包含任何前言、总结或标记："
        ].join("\n");

        // 解析模型
        let narrativeModel = "deepseek/deepseek-v4-pro";
        try {
          const renderJsonPath = path.resolve(process.cwd(), "data", "rendering.json");
          if (fs.existsSync(renderJsonPath)) {
            const config = JSON.parse(fs.readFileSync(renderJsonPath, "utf-8"));
            if (config.model_mappings?.narrative_render_model) {
              narrativeModel = config.model_mappings.narrative_render_model;
            }
          }
        } catch (_) {}

        const { generateCompletion } = await import("../tools/helpers.ts");
        let generatedText = await generateCompletion(prompt, 2048, ctx, narrativeModel);
        if (!generatedText) {
          return null;
        }

        // Lint 扫描与秘密防火墙临时解密
        const { lintProse } = await import("./audit/lint-rules.ts");
        const lintState = {
          ...gameState,
          secrets: gameState.secrets ? { ...gameState.secrets } : {}
        };
        // 临时 reveal 秘密防止误拦截
        if (gameState.secrets) {
          for (const actorId of Object.keys(gameState.secrets)) {
            const actorSecrets = gameState.secrets[actorId];
            if (actorSecrets) {
              const clonedSlots = { ...actorSecrets };
              if (clonedSlots.trueName) {
                clonedSlots.trueName = { ...clonedSlots.trueName, revealState: "revealed" };
              }
              if (clonedSlots.hiddenNoblePhantasms) {
                clonedSlots.hiddenNoblePhantasms = clonedSlots.hiddenNoblePhantasms.map((np: any) => ({
                  ...np,
                  revealState: "revealed"
                }));
              }
              if (clonedSlots.privateMotives) {
                clonedSlots.privateMotives = clonedSlots.privateMotives.map((m: any) => ({
                  ...m,
                  revealState: "revealed"
                }));
              }
              (lintState as any).secrets[actorId] = clonedSlots;
            }
          }
        }

        const lintResult = lintProse(generatedText, lintState);
        generatedText = lintResult.prose;

        // 写入 NPC 记忆 (仅切镜写入，幕间不写)
        if (directive.type !== "幕间") {
          const { addMemoryTag } = await import("./state.ts");
          addMemoryTag(directive.npc, `[切镜·${directive.type}] ${directive.trigger || "他者之眼记录"}`, 30);
        }

        // 格式包装
        let formattedText = "";
        if (directive.type === "幕间") {
          const loc = directive.setting || "未知地点";
          formattedText = `\n─────────────────────────────────────────\n【幕间 · ${loc}】\n\n${generatedText}\n\n[/幕间]\n─────────────────────────────────────────`;
        } else {
          formattedText = `\n─────────────────────────────────────────\n【切镜 · ${directive.npc}】\n\n${generatedText}\n\n[/切镜]\n─────────────────────────────────────────`;
        }

        return formattedText;
      } catch (err) {
        console.error("Viewpoint LLM generation error:", err);
        return null;
      }
    })();
  }
}
