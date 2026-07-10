import { Type } from "typebox";

/** 玩家或 NPC 退出某个组织。如果是 leader（rank=10），退出后 leader 自动传给最高 rank 的成员。 */
export default {
  name: "leave_org",
  label: "退出组织",
  description: "退出势力/组织。targetNpc不填=自己退出。领袖退出自动传位。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID" }),
    targetNpc: Type.Optional(Type.String({ description: "要退出的 NPC 名；不填=玩家自己" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) return { content: [{ type: "text", text: `❌ 组织「${params.orgId}」不存在。` }], details: {} };

    const isPlayer = !params.targetNpc;
    const memberName = isPlayer ? gameState.player.name : params.targetNpc;

    let oldMembership: any;
    if (isPlayer) {
      gameState.player.memberships ??= [];
      const idx = gameState.player.memberships.findIndex(m => m.orgId === params.orgId);
      if (idx < 0) return { content: [{ type: "text", text: `你不在「${org.name}」中，无法退出。` }], details: {} };
      oldMembership = gameState.player.memberships[idx];
      gameState.player.memberships.splice(idx, 1);
    } else {
      const npc = getOrCreateNPC(memberName!);
      npc.memberships ??= [];
      const idx = npc.memberships.findIndex(m => m.orgId === params.orgId);
      if (idx < 0) return { content: [{ type: "text", text: `${memberName} 不在「${org.name}」中。` }], details: {} };
      oldMembership = npc.memberships[idx];
      npc.memberships.splice(idx, 1);
    }

    // 从 org.members 移除
    if (org.members) {
      const pIdx = org.members.findIndex((m: any) => m.npcName === memberName);
      if (pIdx >= 0) org.members.splice(pIdx, 1);
    }

    const wasLeader = oldMembership.rank >= 10;
    let successionMsg = "";
    if (wasLeader) {
      const ranked = (org.members || []).filter((m: any) => m.npcName !== memberName).sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));
      if (ranked.length > 0) {
        org.leader = ranked[0].npcName;
        successionMsg = `\n领袖之位自动传给 ${ranked[0].npcName}（原 rank ${ranked[0].rank}）。`;
      } else {
        org.leader = "";
        successionMsg = `\n该组织已无成员，领袖之位空缺。`;
      }
    }

    saveState();
    const who = isPlayer ? "你" : memberName;
    return {
      content: [{ type: "text", text: `👋 ${who} 已退出「${org.name}」（原职位: ${oldMembership.role}）。${successionMsg}` }],
      details: { left: true, succession: successionMsg || null },
    };
  },
};
