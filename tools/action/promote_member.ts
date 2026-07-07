import { Type } from "typebox";

/**
 * 提拔/降级组织成员（NPC 或玩家自身）。
 * 权限：领袖可任免核心成员；核心成员可提拔普通成员；普通/边缘成员无权提拔任何人。
 * 卸任领袖：leader 把 rank 10 转给另一个成员（传位），自己降到 rank 8（核心）。
 */
export default {
  name: "promote_member",
  label: "任免成员",
  description: "提拔或降级组织成员。leader可任免核心成员+传位；核心成员可提拔普通成员。传位: targetRank=10且caller原为领袖。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID" }),
    targetNpc: Type.String({ description: "目标成员姓名。传位给自己用玩家自己的名字。" }),
    newRank: Type.Number({ description: "新级别 1-10。10=领袖。0=开除（仅leader可用）" }),
    newRole: Type.Optional(Type.String({ description: "新职位名，如'副会长','顾问'。不填保留原职位" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) {
      return { content: [{ type: "text", text: `❌ 组织「${params.orgId}」不存在。` }], details: {} };
    }
    if (org.archived) {
      return { content: [{ type: "text", text: `❌ 「${org.name}」已解体消亡，无法操作。` }], details: {} };
    }

    const playerName = gameState.player.name;

    // 判断调用者权限：先从游戏内玩家身份查，其次从 org.members 查
    const playerMembership = gameState.player.memberships?.find(m => m.orgId === params.orgId);
    const callerRank = playerMembership?.rank ?? 0;
    if (callerRank < 7) {
      return { content: [{ type: "text", text: `❌ 你的级别（${callerRank}）不足——只有核心成员(rank≥7)或领袖才能任免成员。` }], details: {} };
    }

    const isLeader = callerRank >= 10;
    const isCore = callerRank >= 7 && callerRank < 10;

    // 开除权限：仅 leader
    if (params.newRank === 0) {
      if (!isLeader) {
        return { content: [{ type: "text", text: `❌ 只有领袖(rank 10)才能开除成员。你的 rank 是 ${callerRank}。` }], details: {} };
      }
      // 开除
      org.members = (org.members || []).filter((m: any) => m.npcName !== params.targetNpc);
      // 如果开除的是玩家自己
      if (params.targetNpc === playerName && playerMembership) {
        gameState.player.memberships = gameState.player.memberships!.filter(m => m.orgId !== params.orgId);
      }
      saveState();
      return { content: [{ type: "text", text: `🚫 ${params.targetNpc} 已被「${org.name}」开除。` }], details: {} };
    }

    // ── 传位：caller 是 leader，target_rank=10 → 换领袖 ──
    if (isLeader && params.newRank === 10 && params.targetNpc !== playerName) {
      // 传位：原 leader 降到 rank 8（核心），新 leader 升到 10
      const oldLeader = org.leader;
      org.leader = params.targetNpc;

      // 更新原 leader
      if (playerMembership) {
        playerMembership.rank = 8;
        playerMembership.role = params.newRole || "前领袖·核心成员";
      }
      const selfInOrg = org.members?.find((m: any) => m.npcName === playerName);
      if (selfInOrg) { selfInOrg.rank = 8; selfInOrg.role = playerMembership?.role || selfInOrg.role; }

      // 更新新 leader
      const targetInOrg = org.members?.find((m: any) => m.npcName === params.targetNpc);
      if (targetInOrg) {
        targetInOrg.rank = 10;
        targetInOrg.role = params.newRole || "领袖";
      } else {
        org.members ??= [];
        org.members.push({ npcName: params.targetNpc, role: params.newRole || "领袖", rank: 10 });
      }

      // 如果目标是玩家
      if (params.targetNpc === playerName) {
        if (playerMembership) { playerMembership.rank = 10; playerMembership.role = params.newRole || "领袖"; }
      }

      saveState();
      return {
        content: [{ type: "text", text: `👑 领袖之位已从 ${playerName} 传给 ${params.targetNpc}。\n${playerName}: rank 10→8（前领袖·核心成员）\n${params.targetNpc}: → rank 10（新任领袖）` }],
        details: { succession: { from: playerName, to: params.targetNpc } },
      };
    }

    // ── 提拔/降级 ──
    const newRank = Math.max(1, Math.min(10, params.newRank));

    // 权限校验
    if (!isLeader && newRank >= 7) {
      return { content: [{ type: "text", text: `❌ 只有领袖(rank 10)才能任命核心成员(rank≥7)。你的 rank 是 ${callerRank}。` }], details: {} };
    }
    if (!isLeader && newRank === 10) {
      return { content: [{ type: "text", text: `❌ 只有领袖才能传位给 rank 10。` }], details: {} };
    }

    // 查找目标（NPC 或 玩家自己）
    const isPlayerTarget = params.targetNpc === playerName;
    const npcInOrg = org.members?.find((m: any) => m.npcName === params.targetNpc);

    if (!npcInOrg && !isPlayerTarget) {
      return { content: [{ type: "text", text: `❌ ${params.targetNpc} 不在「${org.name}」的成员名单中。` }], details: {} };
    }

    if (npcInOrg) {
      npcInOrg.rank = newRank;
      if (params.newRole) npcInOrg.role = params.newRole;
    }
    if (isPlayerTarget && playerMembership) {
      playerMembership.rank = newRank;
      if (params.newRole) playerMembership.role = params.newRole;
    }

    // 如果目标 rank=10 且原 leader≠target → 更新 leader
    if (newRank === 10) {
      org.leader = params.targetNpc;
    } else if (org.leader === params.targetNpc && newRank < 10) {
      // 把 leader 降级了 → 需要处理（但让下一步自然流动，或者找最高 rank 的继承）
      const ranked = (org.members || []).filter((m: any) => m.npcName !== params.targetNpc).sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));
      org.leader = ranked.length > 0 && ranked[0].rank >= 7 ? ranked[0].npcName : "";
    }

    saveState();

    const direction = newRank > (npcInOrg?.rank || playerMembership?.rank || 0) ? "升" : "降";
    return {
      content: [{ type: "text", text: `✅ ${params.targetNpc} 在「${org.name}」中的职位已${direction}为 ${params.newRole || npcInOrg?.role || playerMembership?.role || "成员"}（rank: ${newRank}）` }],
      details: { target: params.targetNpc, oldRank: npcInOrg?.rank || playerMembership?.rank || 0, newRank },
    };
  },
};
