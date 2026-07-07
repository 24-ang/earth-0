import { Type } from "typebox";

/** 玩家退出某个组织。如果是 leader（rank=10），退出后 leader 自动传给最高 rank 的成员。 */
export default {
  name: "leave_org",
  label: "退出组织",
  description: "玩家退出某个势力/组织。如果是领袖，退出后自动传位给最高rank成员。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID，如 'soubu_service_club'" }),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) {
      return { content: [{ type: "text", text: `❌ 组织「${params.orgId}」不存在。` }], details: {} };
    }

    gameState.player.memberships ??= [];
    const idx = gameState.player.memberships.findIndex(m => m.orgId === params.orgId);
    if (idx < 0) {
      return { content: [{ type: "text", text: `你不在「${org.name}」中，无法退出。` }], details: {} };
    }

    const oldMembership = gameState.player.memberships[idx];
    const wasLeader = oldMembership.rank >= 10;
    gameState.player.memberships.splice(idx, 1);

    // 从 org.members 移除玩家
    if (org.members) {
      const pIdx = org.members.findIndex((m: any) => m.npcName === gameState.player.name);
      if (pIdx >= 0) org.members.splice(pIdx, 1);
    }

    // 如果玩家是 leader→自动传位
    let successionMsg = "";
    if (wasLeader) {
      const ranked = (org.members || []).filter((m: any) => m.npcName !== gameState.player.name).sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));
      if (ranked.length > 0) {
        org.leader = ranked[0].npcName;
        successionMsg = `\n领袖之位自动传给 ${ranked[0].npcName}（原 rank ${ranked[0].rank}）。`;
      } else {
        org.leader = "";
        successionMsg = `\n该组织已无成员，领袖之位空缺。`;
      }
    }

    saveState();

    return {
      content: [{ type: "text", text: `👋 你已退出「${org.name}」（原职位: ${oldMembership.role}）。${successionMsg}` }],
      details: { left: true, succession: successionMsg || null },
    };
  },
};
