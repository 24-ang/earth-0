import { Type } from "typebox";

/** 玩家或 NPC 加入某个组织。默认 rank=1（边缘成员）。 */
export default {
  name: "join_org",
  label: "加入组织",
  description: "加入势力/组织。targetNpc不填=自己加入。默认边缘(rank=1)。leader邀请可设更高。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID" }),
    targetNpc: Type.Optional(Type.String({ description: "要加入的 NPC 名；不填=玩家自己" })),
    role: Type.Optional(Type.String({ description: "职位名。不填默认'成员'" })),
    rank: Type.Optional(Type.Number({ description: "初始级别1-10。自己申请=1，邀请可>1" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) return { content: [{ type: "text", text: `❌ 组织「${params.orgId}」不存在。` }], details: {} };
    if (org.archived) return { content: [{ type: "text", text: `❌ 「${org.name}」已解体消亡。` }], details: {} };

    const isPlayer = !params.targetNpc;
    const memberName = isPlayer ? gameState.player.name : params.targetNpc;

    const roleName = params.role || "成员";
    const entryRank = params.rank && params.rank > 1 ? params.rank : 1;
    const finalRank = Math.max(1, Math.min(10, entryRank));

    const membership = { orgId: params.orgId, role: roleName, rank: finalRank, joinedAt: gameState.time.game_date };

    if (isPlayer) {
      gameState.player.memberships ??= [];
      if (gameState.player.memberships.find(m => m.orgId === params.orgId))
        return { content: [{ type: "text", text: `你已经是「${org.name}」的成员。` }], details: {} };
      gameState.player.memberships.push(membership);
      const rep = gameState.player.reputation?.[params.orgId] ?? 0;
      if (rep < finalRank) { gameState.player.reputation ??= {}; gameState.player.reputation[params.orgId] = Math.max(rep, finalRank * 2 - 1); }
    } else {
      const npc = getOrCreateNPC(memberName!);
      npc.memberships ??= [];
      if (npc.memberships.find(m => m.orgId === params.orgId))
        return { content: [{ type: "text", text: `${memberName} 已经是「${org.name}」的成员。` }], details: {} };
      npc.memberships.push(membership);
    }

    org.members ??= [];
    if (!org.members.some((m: any) => m.npcName === memberName)) {
      org.members.push({ npcName: memberName, role: roleName, rank: finalRank, isPlayer });
    }

    saveState();
    const who = isPlayer ? "你" : memberName;
    const tierLabel = finalRank >= 10 ? "领袖" : finalRank >= 7 ? "核心成员" : finalRank >= 4 ? "普通成员" : "边缘成员";
    return {
      content: [{ type: "text", text: `✅ ${who} 已加入「${org.name}」！\n职位: ${roleName} | 级别: ${finalRank}（${tierLabel}）` }],
      details: { membership, tier: tierLabel },
    };
  },
};
