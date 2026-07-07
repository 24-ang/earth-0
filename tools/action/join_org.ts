import { Type } from "typebox";

/** 玩家加入某个组织。默认 rank=1（边缘成员）。如果 leader 或核心成员批准，可给更高 rank。 */
export default {
  name: "join_org",
  label: "加入组织",
  description: "玩家加入某个势力/组织。默认边缘成员(rank=1)。可指定职位名。如果org.leader主动邀请，可设更高rank。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID，如 'soubu_service_club', 'tennis_club'" }),
    role: Type.Optional(Type.String({ description: "职位名，如 '部员', '顾问', '临时帮手'。不填则默认'成员'" })),
    rank: Type.Optional(Type.Number({ description: "初始级别 1-10。仅 leader/核心成员邀请时可设>1，自己申请加入固定=1" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) {
      return { content: [{ type: "text", text: `❌ 组织「${params.orgId}」不存在。` }], details: {} };
    }
    if (org.archived) {
      return { content: [{ type: "text", text: `❌ 「${org.name}」已解体消亡，无法加入。` }], details: {} };
    }

    gameState.player.memberships ??= [];
    const existing = gameState.player.memberships.find(m => m.orgId === params.orgId);
    if (existing) {
      return { content: [{ type: "text", text: `你已经是「${org.name}」的成员（职位: ${existing.role}, 级别: ${existing.rank}）。如需变更职位请用 promote_member。` }], details: {} };
    }

    const roleName = params.role || "成员";
    const entryRank = params.rank && params.rank > 1 ? params.rank : 1;
    const finalRank = Math.max(1, Math.min(10, entryRank)); // 夹在 1-10

    const membership = {
      orgId: params.orgId,
      role: roleName,
      rank: finalRank,
      joinedAt: gameState.time.game_date,
    };

    gameState.player.memberships.push(membership);

    // 同步写入 org.members（玩家名不会和 NPC 重名，但引擎可能不期望 player 在 members 里——加 isPlayer 标记）
    org.members ??= [];
    const alreadyInOrg = org.members.some((m: any) => m.npcName === gameState.player.name);
    if (!alreadyInOrg) {
      org.members.push({ npcName: gameState.player.name, role: roleName, rank: finalRank, isPlayer: true });
    }

    // 如果玩家 rank >= 7 且 org.leader 为空或玩家声望极高，自动设为 leader
    if (finalRank >= 7 && (!org.leader || (gameState.player.reputation?.[params.orgId] ?? 0) >= 4)) {
      // 玩家 rank 够高但让 leader 的替换由 promote_member 专门处理——这里不悄悄抢 leader
    }

    // 声望初始同步：如果玩家之前不在成员中，根据加入 rank 初始化声望
    const rep = gameState.player.reputation?.[params.orgId] ?? 0;
    if (rep < finalRank) {
      gameState.player.reputation ??= {};
      gameState.player.reputation[params.orgId] = Math.max(rep, finalRank * 2 - 1); // rank4起有正面声望
    }

    saveState();

    const tierLabel = finalRank >= 10 ? "领袖" : finalRank >= 7 ? "核心成员" : finalRank >= 4 ? "普通成员" : "边缘成员";
    return {
      content: [{ type: "text", text: `✅ 你已加入「${org.name}」！\n职位: ${roleName} | 级别: ${finalRank}（${tierLabel}）\n加入日期: ${gameState.time.game_date}` }],
      details: { membership, tier: tierLabel },
    };
  },
};
