import { Type } from "typebox";
import { gameState, saveState } from "../../engine/state.ts";

export default {
  name: "contribute_to_org",
  label: "向组织贡献/互动",
  description: "玩家对组织势力的直接行动：捐赠资金|完成任务获取声望|背叛泄密|招募成员",
  parameters: Type.Object({
    orgId: Type.String({ description: "目标组织ID，如 'soubu_service_club'" }),
    action: Type.String({
      enum: ["donate", "complete_quest", "betray", "recruit_member"],
      description: "互动类型：donate(捐款)|complete_quest(完成任务)|betray(背叛泄密)|recruit_member(招募成员)"
    }),
    amount: Type.Optional(Type.Number({ description: "捐款金额（日元，仅donate时有效）" })),
    details: Type.Optional(Type.String({ description: "行动细节描述：任务名/情报内容/招募理由等" })),
    targetNpc: Type.Optional(Type.String({ description: "涉及的目标NPC姓名（recruit_member的招募对象/betray的泄密对象）" }))
  }),
  async execute(_id, params, _s, _o, _ctx) {
    gameState.organizations ??= {};

    const org = gameState.organizations[params.orgId];
    if (!org) {
      return {
        content: [{ type: "text", text: `❌ 未找到势力 「${params.orgId}」。可用 lookup_org 查询已有势力。` }],
        details: { success: false }
      };
    }

    const { action } = params;
    let summary = "";

    // ── 权限校验：根据 action 判断是否需要成员资格 ──
    gameState.player.memberships ??= [];
    const membership = gameState.player.memberships.find(m => m.orgId === params.orgId);
    const memberRank = membership?.rank ?? 0;

    // donate：所有人都可以捐款（包括非成员）
    // complete_quest：普通成员(rank≥4)以上
    // betray：必须是成员才能背叛
    // recruit_member：核心成员(rank≥7)以上
    const actionMinRank: Record<string, number> = {
      donate: 0,
      complete_quest: 4,
      betray: 1,
      recruit_member: 7,
    };
    const requiredRank = actionMinRank[action] ?? 0;
    if (requiredRank > 0 && memberRank < requiredRank) {
      const rankLabels: Record<number, string> = { 0: "非成员", 1: "边缘成员", 4: "普通成员", 7: "核心成员", 10: "领袖" };
      const need = rankLabels[requiredRank] || `rank≥${requiredRank}`;
      const have = membership ? `${membership.role}(${rankLabels[memberRank < 4 ? 1 : memberRank < 7 ? 4 : memberRank < 10 ? 7 : 10]})` : "非成员";
      return {
        content: [{ type: "text", text: `❌ 「${action}」需要 ${need} 权限。你当前的身份: ${have}。` }],
        details: { success: false }
      };
    }
    let playerRepDelta = 0;

    // ── 辅助：确保 player.reputation[orgId] 存在 ──
    if (!("reputation" in gameState.player)) {
      (gameState.player as any).reputation = {};
    }
    if (gameState.player.reputation[params.orgId] === undefined) {
      gameState.player.reputation[params.orgId] = 0;
    }

    switch (action) {
      case "donate": {
        const amt = params.amount ?? 0;
        if (amt <= 0) {
          return {
            content: [{ type: "text", text: "❌ 捐款金额必须大于 0。" }],
            details: { success: false }
          };
        }
        // 检查玩家资金
        const playerFunds = gameState.player.funds ?? 0;
        if (amt > playerFunds) {
          return {
            content: [{ type: "text", text: `❌ 资金不足。你有 ¥${playerFunds.toLocaleString()}，需要 ¥${amt.toLocaleString()}。` }],
            details: { success: false }
          };
        }

        gameState.player.funds = playerFunds - amt;
        // 每 100 日元 ≈ 1 wealth 点
        const wealthGain = Math.min(Math.floor(amt / 100), 30);
        org.wealth = Math.min(100, (org.wealth ?? 50) + wealthGain);
        playerRepDelta = Math.max(1, Math.floor(wealthGain / 2));
        summary = `💰 向「${org.name}」捐赠 ¥${amt.toLocaleString()}。\n势力财力 +${wealthGain}（当前: ${org.wealth}）。\n你的声望 +${playerRepDelta}。`;
        break;
      }

      case "complete_quest": {
        const questName = params.details || "未命名任务";
        org.cohesion = Math.min(100, (org.cohesion ?? 50) + 5);
        org.influence = Math.min(100, (org.influence ?? 50) + 2);
        // 少量资源奖励
        if (!org.goals.requiredResources) {
          org.goals.requiredResources = [];
        }
        const hasRes = org.goals.requiredResources.find(r => r.type === "quest_credit");
        if (hasRes) {
          hasRes.value += 1;
        } else {
          org.goals.requiredResources.push({ type: "quest_credit", value: 1 });
        }
        playerRepDelta = 3;
        summary = `✅ 完成势力任务「${questName}」→「${org.name}」。\n凝聚力 +5，影响力 +2。\n你的声望 +3。`;
        break;
      }

      case "betray": {
        const leakDetail = params.details || "内部情报";
        org.cohesion = Math.max(0, (org.cohesion ?? 50) - 10);
        org.public_legitimacy = Math.max(0, (org.public_legitimacy ?? 50) - 5);
        playerRepDelta = -4;

        // 查找敌对势力并给予声望
        let rivalGained = false;
        if (org.relations) {
          for (const [otherOrgId, relVal] of Object.entries(org.relations) as [string, number][]) {
            if (relVal <= -2 && gameState.organizations[otherOrgId]) {
              const rival = gameState.organizations[otherOrgId];
              if (!gameState.player.reputation[otherOrgId]) {
                gameState.player.reputation[otherOrgId] = 0;
              }
              const rivalRep = Math.min(2, Math.floor(Math.abs(relVal) / 2));
              gameState.player.reputation[otherOrgId] += rivalRep;
              summary += `\n⚠️ 敌对势力「${rival.name}」对你的声望 +${rivalRep}。`;
              rivalGained = true;
            }
          }
        }

        summary = `🔓 向「${org.name}」泄露内部情报：${leakDetail}。\n凝聚力 -10（当前: ${org.cohesion}），公信力 -5（当前: ${org.public_legitimacy}）。\n你的声望 ${playerRepDelta}（当前: ${gameState.player.reputation[params.orgId] + playerRepDelta}）。${summary}`;
        if (!rivalGained && Object.keys(org.relations || {}).length === 0) {
          summary += `\n（该势力无已知敌对关系，情报流向未公开。）`;
        }
        break;
      }

      case "recruit_member": {
        const npcName = params.targetNpc;
        if (!npcName) {
          return {
            content: [{ type: "text", text: "❌ recruit_member 需要指定 targetNpc（招募对象的姓名）。" }],
            details: { success: false }
          };
        }

        // 检查 NPC 是否已在成员列表中
        const alreadyMember = org.members?.some(
          (m: { npcName: string }) => m.npcName === npcName
        );
        if (alreadyMember) {
          return {
            content: [{ type: "text", text: `❌ 「${npcName}」已经是「${org.name}」的成员。` }],
            details: { success: false }
          };
        }

        const recruitRole = params.details || "新成员";
        org.members ??= [];
        org.members.push({ npcName, role: recruitRole, rank: 1 });
        org.cohesion = Math.min(100, (org.cohesion ?? 50) + 3);
        playerRepDelta = 2;
        summary = `👥 招募「${npcName}」加入「${org.name}」（身份: ${recruitRole}）。\n凝聚力 +3（当前: ${org.cohesion}）。\n你的声望 +2。`;
        break;
      }

      default:
        return {
          content: [{ type: "text", text: `❌ 未知的行动类型: ${action}。支持: donate | complete_quest | betray | recruit_member` }],
          details: { success: false }
        };
    }

    // ── 应用声望变化 ──
    gameState.player.reputation[params.orgId] = Math.max(-3, Math.min(5,
      (gameState.player.reputation[params.orgId] ?? 0) + playerRepDelta
    ));

    // ── 同步 org.relations（组织→玩家的感知） ──
    if (!org.relations) org.relations = {};
    org.relations["player"] = (org.relations["player"] ?? 0) + playerRepDelta;

    saveState();

    return {
      content: [{ type: "text", text: summary }],
      details: {
        success: true,
        orgId: params.orgId,
        action,
        playerRepDelta,
        playerRepNew: gameState.player.reputation[params.orgId],
        orgWealth: org.wealth,
        orgCohesion: org.cohesion,
        orgInfluence: org.influence,
        orgLegitimacy: org.public_legitimacy
      }
    };
  }
};
