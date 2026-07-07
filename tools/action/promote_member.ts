import { Type } from "typebox";

/**
 * 提拔/降级组织成员（NPC 或玩家自身）。
 * 引擎不替 LLM 判断权力边界——LLM 根据叙事上下文决定谁有权力提拔谁。
 * 引擎只做数据写入和硬守恒校验（人是否存在、财政是否允许）。
 */
export default {
  name: "promote_member",
  label: "任免成员",
  description: "提拔或降级组织成员。LLM自行判断权力边界；引擎仅写入数据和传位逻辑。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID" }),
    targetNpc: Type.String({ description: "目标成员姓名" }),
    newRank: Type.Number({ description: "新级别 1-10。10=领袖。0=开除" }),
    newRole: Type.Optional(Type.String({ description: "新职位名，如副会长,顾问。不填保留原职位" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) return { content: [{ type: "text", text: "❌ 组织「" + params.orgId + "」不存在。" }], details: {} };
    if (org.archived) return { content: [{ type: "text", text: "❌ 「" + org.name + "」已解体消亡。" }], details: {} };

    const playerName = gameState.player.name;
    const isPlayerTarget = params.targetNpc === playerName;
    const newRank = Math.max(0, Math.min(10, params.newRank));

    // ── 开除 (newRank=0) ──
    if (newRank === 0) {
      org.members = (org.members || []).filter((m: any) => m.npcName !== params.targetNpc);
      if (isPlayerTarget) { gameState.player.memberships = gameState.player.memberships!.filter(m => m.orgId !== params.orgId); }
      saveState();
      return { content: [{ type: "text", text: "🚫 " + params.targetNpc + " 已被「" + org.name + "」除名。" }], details: {} };
    }

    // ── 传位 (newRank=10 且目标≠现任 leader) ──
    if (newRank === 10 && org.leader && org.leader !== params.targetNpc) {
      const oldLeader = org.leader;
      const oldInOrg = org.members?.find((m: any) => m.npcName === oldLeader);
      if (oldInOrg) { oldInOrg.rank = 8; oldInOrg.role = params.newRole || "前领袖·顾问"; }
      org.leader = params.targetNpc;
      // 新领袖
      const targetInOrg = org.members?.find((m: any) => m.npcName === params.targetNpc);
      if (targetInOrg) { targetInOrg.rank = 10; targetInOrg.role = params.newRole || "领袖"; }
      else { org.members ??= []; org.members.push({ npcName: params.targetNpc, role: params.newRole || "领袖", rank: 10 }); }
      if (isPlayerTarget) { const pm = gameState.player.memberships?.find(m => m.orgId === params.orgId); if (pm) { pm.rank = 10; pm.role = params.newRole || "领袖"; } }
      saveState();
      return { content: [{ type: "text", text: "👑 「" + org.name + "」领袖之位从 " + oldLeader + " 传给 " + params.targetNpc + "。" }], details: { succession: { from: oldLeader, to: params.targetNpc } } };
    }

    // ── 提拔/降级（普通情况） ──
    const targetInOrg = org.members?.find((m: any) => m.npcName === params.targetNpc);
    if (!targetInOrg && !isPlayerTarget) {
      return { content: [{ type: "text", text: "🚫 " + params.targetNpc + " 已被「" + org.name + "」除名。" }], details: {} };
    }
    if (targetInOrg) { targetInOrg.rank = newRank; if (params.newRole) targetInOrg.role = params.newRole; }
    if (isPlayerTarget) { const pm = gameState.player.memberships?.find(m => m.orgId === params.orgId); if (pm) { pm.rank = newRank; if (params.newRole) pm.role = params.newRole; } }

    // 如果目标 rank=10 → 自动设 leader
    if (newRank === 10) { org.leader = params.targetNpc; }
    else if (org.leader === params.targetNpc && newRank < 10) {
      const ranked = (org.members || []).filter((m: any) => m.npcName !== params.targetNpc).sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));
      org.leader = ranked.length > 0 ? ranked[0].npcName : "";
    }

    saveState();
    const newRoleName = params.newRole || targetInOrg?.role || "成员";
    return { content: [{ type: "text", text: "✅ " + params.targetNpc + " 在「" + org.name + "」的职位已更新为 " + (params.newRole || targetInOrg?.role || "成员") + "（rank: " + newRank + "）。LLM 请根据叙事判断此变动是否合理。" }], details: { target: params.targetNpc, newRank, newRole: newRoleName } };
  },
};
