import { gameState, getOrCreateNPC, getNpcCurrentAge, findCharacter, isSameLocation, addMemoryTag, updateRelation } from "../state.ts";
import { generateCompletion, getNpcAgentModel } from "../../tools/helpers.ts";

export async function reviewTurn(ctx: any): Promise<void> {
  // 1. 防爆开关
  if (gameState.flags?.disable_review === true) {
    gameState.lastReviewFindings = [];
    return;
  }

  // 2. 提取在场 NPC 设定与外貌
  const playerRoom = gameState.player.location;
  if (!playerRoom) return;

  const charStages = (await import("../../data/character_stages.json", { with: { type: "json" } })).default;

  const presentNPCs: string[] = [];
  const presentNPCDescriptions: string[] = [];

  for (const [name, npc] of Object.entries(gameState.npcs)) {
    if (!npc.alive || !npc.currentRoom) continue;
    if (!isSameLocation(npc.currentRoom, playerRoom)) continue;

    presentNPCs.push(name);

    const src = findCharacter(name);
    if (!src) continue;

    const curAge = getNpcCurrentAge(src.base_age || 16);
    const cs = charStages[name];
    const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
    const personality = src.personality_text || cs?.[stageKey] || "";
    const appearance = src.appearance_brief || "";

    presentNPCDescriptions.push(`NPC: ${name}
- 阶段: ${stageKey} (年龄 ${curAge})
- 设定/性格: ${personality}
- 外貌特征: ${appearance}`);
  }

  // 如果没有 NPC 在场，通常不需要复盘
  if (presentNPCs.length === 0) {
    gameState.lastReviewFindings = [];
    return;
  }

  // 3. 提取未披露秘密（用于泄密审计）
  const hiddenSecrets: string[] = [];
  const secrets = (gameState as any).secrets;
  if (secrets) {
    for (const [actorId, slots] of Object.entries(secrets)) {
      if (!slots || typeof slots !== "object") continue;
      // 只审计当前在场 NPC 的秘密
      if (!presentNPCs.includes(actorId)) continue;

      if ((slots as any).trueName?.revealState === "hidden" && (slots as any).trueName?.value) {
        hiddenSecrets.push(`- ${actorId} 的隐藏真名: "${(slots as any).trueName.value}"`);
      }
      for (const np of (slots as any).hiddenNoblePhantasms || []) {
        if (np.revealState === "hidden" && np.value?.name) {
          hiddenSecrets.push(`- ${actorId} 的隐藏宝具/能力名: "${np.value.name}"`);
        }
      }
      for (const motive of (slots as any).privateMotives || []) {
        if (motive.revealState === "hidden" && motive.value) {
          hiddenSecrets.push(`- ${actorId} 的隐藏动机/所属: "${motive.value}"`);
        }
      }
    }
  }

  // 4. 获取当前回合的渲染正文
  const prose = (await import("../../tools/helpers.ts")).lastRenderedProse || "";
  if (!prose) {
    gameState.lastReviewFindings = [];
    return;
  }

  // 5. 组装 Prompt
  const prompt = `你是 earth-0 的回合后审查与复盘智能体（Review Agent）。
你需要根据本回合刚刚渲染出来的游戏叙事正文，结合当前在场 NPC 的背景设定，对本回合的表现进行三项审计：
1. 【人设偏差（OOC）审计】：在场 NPC 的言行是否严重偏离其预设的性格或身份？
2. 【秘密泄露（防火墙越界）审计】：在场 NPC 是否在对话或旁白中，泄露了目前处于隐藏状态（hidden）的机密信息？（仅限我们提供给你的隐藏秘密列表，已经公开或未提及的信息不计入泄露）。
3. 【好感度变动兜底】：在刚才的剧情中，玩家与 NPC 之间是否有明显的感情升温/恶化，但引擎在本回合中可能遗漏了对其好感值的调整？

【在场 NPC 设定列表】:
${presentNPCDescriptions.join("\n\n")}

【在场 NPC 隐藏机密信息列表（如果泄露了这些文字则属于超游越界）】:
${hiddenSecrets.length > 0 ? hiddenSecrets.join("\n") : "（无隐藏机密）"}

【本回合叙事正文（需要审计的文本）】:
"""
${prose}
"""

请仔细阅读叙事正文，给出审计结果。你必须返回一个严格的 JSON 对象，包含以下字段（不要包含 markdown 代码块包裹，也不要包含任何多余文字，仅输出 JSON）：
{
  "ooc_findings": [
    { "npc": "NPC名字", "finding": "具体人设偏差原因" }
  ],
  "info_leaks": [
    "说明泄露了哪项隐藏机密"
  ],
  "relation_changes": [
    { "npc": "NPC名字", "delta": 好感变动值(整数，如 3, 5, -2, -5), "reason": "变动原因" }
  ]
}

如果没有发现任何问题，对应数组留空即可。
请输出 JSON：`;

  // 6. 调用 LLM
  try {
    const model = await getNpcAgentModel();
    const rawResult = await generateCompletion(prompt, 512, ctx, model);
    if (!rawResult) {
      gameState.lastReviewFindings = [];
      return;
    }

    // 解析 JSON
    let cleanJson = rawResult.trim();
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.slice(7);
    }
    if (cleanJson.endsWith("```")) {
      cleanJson = cleanJson.slice(0, -3);
    }
    cleanJson = cleanJson.trim();

    const auditRes = JSON.parse(cleanJson);
    const findings: string[] = [];

    // 处理 OOC findings
    if (Array.isArray(auditRes.ooc_findings)) {
      for (const item of auditRes.ooc_findings) {
        if (item.npc && item.finding) {
          findings.push(`[OOC 警报] NPC ${item.npc} 发生人设偏差: ${item.finding}`);
          // 写入 3 天过期的 role_deviation 记忆标签
          addMemoryTag(item.npc, "role_deviation", 3, "困惑", 2, "negative", [], "emotion");
        }
      }
    }

    // 处理信息泄露
    if (Array.isArray(auditRes.info_leaks)) {
      for (const leak of auditRes.info_leaks) {
        if (leak) {
          findings.push(`[信息泄露警告] ${leak}`);
        }
      }
    }

    // 处理好感度变动兜底
    if (Array.isArray(auditRes.relation_changes)) {
      const toolsCalled = gameState._lastTurnToolsCalled || [];
      const hasRelToolCalled = toolsCalled.includes("adjust_relation") || toolsCalled.includes("set_npc_relation");

      if (!hasRelToolCalled) {
        for (const relChange of auditRes.relation_changes) {
          if (relChange.npc && relChange.delta && typeof relChange.delta === "number" && presentNPCs.includes(relChange.npc)) {
            const delta = relChange.delta;
            const reason = relChange.reason || "复盘兜底修正";
            updateRelation(gameState.player.relationships, relChange.npc, delta, reason);
            findings.push(`[好感兜底修正] NPC ${relChange.npc} 好感度修正 ${delta > 0 ? "+" : ""}${delta}，原因: ${reason}`);
          }
        }
      }
    }

    gameState.lastReviewFindings = findings;
  } catch (e) {
    console.error("[Review Agent] 审计执行/解析发生异常:", e);
    gameState.lastReviewFindings = [];
  }
}
