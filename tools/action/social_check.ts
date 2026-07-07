import { Type } from "typebox";

export default {
  name: "social_check",
  label: "社交骰子检定",
  description: "日常说服/邀请/打听秘密的D20骰子检定，属性、好感、性格均会影响DC与加成。",
  parameters: Type.Object({
    targetNpc: Type.String({ description: "交互的NPC名称" }),
    actionType: Type.String({ enum: ["invite_to_party", "persuade_secret", "convince_lie"], description: "社交动作类型" }),
    approach: Type.String({ enum: ["charm", "reason", "threat"], description: "游说风格：charm(魅力), reason(智力), threat(威逼)" })
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState, getOrCreateNPC, findCharacter } = await import("../../engine/state.ts");
    
    const targetNpc = params.targetNpc;
    const actionType = params.actionType;
    const approach = params.approach;

    const npc = getOrCreateNPC(targetNpc);
    const p = gameState.player;

    p.relationships ??= {};
    const rel = p.relationships[targetNpc] || { stage: "陌生", affection: 0 };

    // 1. Base DC
    const baseDcs: Record<string, number> = {
      invite_to_party: 12,
      persuade_secret: 15,
      convince_lie: 14
    };
    const baseDc = baseDcs[actionType] ?? 12;

    // 2. Personality Modifier
    let personalityMod = 0;
    const personality = findCharacter(targetNpc)?.personality_brief || (npc as any).personality_brief || "";
    if (personality.includes("高冷")) personalityMod += 5;
    if (personality.includes("警惕")) personalityMod += 8;
    if (personality.includes("友善")) personalityMod -= 3;

    // 3. Affection & Romance modifier
    const affection = rel.affection ?? 0;
    const affectionMod = Math.min(10, Math.floor(affection / 10));
    
    let romanceMod = 0;
    if (rel.romance === "恋人" || rel.stage === "恋人") romanceMod += 5;
    if (rel.stage === "至交") romanceMod += 3;

    let dc = baseDc + personalityMod - affectionMod - romanceMod;

    // 5. Organization Hostility DC penalty
    let orgHostilityMod = 0;
    let orgHostilityNote = "";
    try {
      const { getOrgMembershipsForNpc } = await import("../../engine/state.ts");
      const npcOrgs = getOrgMembershipsForNpc(targetNpc);
      for (const orgId of npcOrgs) {
        const rep = p.reputation?.[orgId] ?? 0;
        if (rep <= -2) {
          const org = gameState.organizations?.[orgId];
          const penalty = Math.min(3, Math.abs(rep));
          if (penalty > orgHostilityMod) {
            orgHostilityMod = penalty;
            orgHostilityNote = `「${org?.name || orgId}」势力敌对`;
          }
        }
      }
    } catch {}
    dc += orgHostilityMod;

    dc = Math.max(5, Math.min(30, dc)); // Clamp DC

    // 4. Automatic Outcomes (Guardrails)
    let autoSuccess = false;
    let autoFail = false;
    let autoReason = "";

    if (rel.stage === "敌对" && actionType === "invite_to_party") {
      autoFail = true;
      autoReason = "对方视你为死敌，绝不可能接受你的邀请同行。";
    } else if ((rel.romance === "恋人" || rel.stage === "恋人" || rel.stage === "至交") && actionType === "invite_to_party") {
      autoSuccess = true;
      autoReason = "由于你们的亲密关系，对方自然地接受了你的同行邀请。";
    }

    // 5. D20 Roll & Modifiers
    const d20 = Math.floor(Math.random() * 20) + 1;

    // Attribute key mapping
    const attrMapping: Record<string, string> = {
      charm: "魅力",
      reason: "智力",
      threat: "力量"
    };
    const attrKey = attrMapping[approach] ?? "魅力";
    const attrVal = p.attributes[attrKey] ?? 10;
    const attrMod = Math.floor((attrVal - 10) / 2);

    const luck = p.attributes.幸运 ?? 10;
    const luckMod = Math.floor((luck - 10) / 2);

    const totalRoll = d20 + attrMod + luckMod;

    // Evaluate result
    let success = false;
    let detailMsg = "";

    if (autoFail) {
      success = false;
      detailMsg = `【自动失败】${autoReason}`;
    } else if (autoSuccess) {
      success = true;
      detailMsg = `【免检成功】${autoReason}`;
    } else if (d20 === 20) {
      success = true;
      detailMsg = `【大成功！(Critical Success)】投出20点！叙事上对方可能有额外的积极反应或意外的顺从。`;
    } else if (d20 === 1) {
      success = false;
      detailMsg = `【大失败！(Critical Failure)】投出1点！叙事上对方可能会有戏剧性的傲娇、强烈反弹、或由于突发状况拒绝。`;
    } else {
      success = totalRoll >= dc;
      detailMsg = success 
        ? `投骰成功！合计 ${totalRoll} >= DC ${dc}。` 
        : `投骰失败！合计 ${totalRoll} < DC ${dc}。`;
    }

    // Apply side-effects
    if (success && actionType === "invite_to_party") {
      p.party ??= [];
      if (!p.party.includes(targetNpc)) {
        p.party.push(targetNpc);
      }
      // Set NPC schedule bypass in gameState
      npc.currentRoom = p.location; // Move NPC to player's location immediately
    }

    // Threatening penalty (reduces affection)
    if (approach === "threat") {
      rel.affection = Math.max(0, affection - 15);
      detailMsg += ` (使用威胁手段导致好感度下降15点，当前好感: ${rel.affection})`;
    }

    // Record check log to transient game state
    gameState._lastSocialCheck = {
      targetNpc,
      actionType,
      approach,
      d20,
      attrMod,
      luckMod,
      totalRoll,
      dc,
      success,
      isCritical: d20 === 1 || d20 === 20,
      isCriticalSuccess: d20 === 20,
      isCriticalFailure: d20 === 1,
      autoSuccess,
      autoFail,
      detailMsg
    };

    saveState();

    const summary = `[社交检定] 目标:${targetNpc} | 动作:${actionType} | 风格:${approach} | DC:${dc} | 掷骰:${d20}+修正${attrMod}+幸运${luckMod}=${totalRoll} | 结果:${success ? "成功" : "失败"} | 备注:${detailMsg}`;
    
    return {
      content: [{ type: "text", text: summary }],
      details: {
        success,
        dc,
        roll: totalRoll,
        d20,
        luckMod,
        attrMod,
        detailMsg
      }
    };
  }
};
