import { Type } from "typebox";

/** 以组织成员身份使用组织资源。引擎只做硬守恒校验（钱够不够），不替 LLM 判断权力边界。 */
export default {
  name: "org_action",
  label: "组织行动",
  description: "以组织成员身份行动：动用资金|召开会议|发表声明|派遣成员。引擎只校验钱/人在不在。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID" }),
    action: Type.String({
      enum: ["spend_funds", "hold_meeting", "issue_statement", "dispatch_member"],
      description: "spend_funds(动用资金)|hold_meeting(召开内部会议)|issue_statement(公开发表声明)|dispatch_member(派遣成员执行任务)"
    }),
    amount: Type.Optional(Type.Number({ description: "金额（日元，仅 spend_funds 时有效）" })),
    purpose: Type.Optional(Type.String({ description: "用途说明：为什么花钱/开什么会/声明内容/任务内容" })),
    targetNpc: Type.Optional(Type.String({ description: "涉及的目标NPC（dispatch_member 的派遣对象）" })),
    targetOrg: Type.Optional(Type.String({ description: "涉及的目标组织ID（issue_statement 的对象）" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const org = gameState.organizations?.[params.orgId];
    if (!org) return { content: [{ type: "text", text: `❌ 组织「${params.orgId}」不存在。` }], details: {} };
    if (org.archived) return { content: [{ type: "text", text: `❌ 「${org.name}」已解体消亡。` }], details: {} };

    switch (params.action) {
      case "spend_funds": {
        const amt = params.amount ?? 0;
        if (amt <= 0) return { content: [{ type: "text", text: "❌ 金额必须大于 0。" }], details: {} };
        const orgWealth = org.wealth ?? 0;
        if (amt > orgWealth * 1000) {
          // 假设 1 wealth ≈ 1000 日元购买力
          return { content: [{ type: "text", text: `❌ 「${org.name}」财力不足。当前财力 ${orgWealth}/100（约 ¥${(orgWealth * 1000).toLocaleString()}），需要 ¥${amt.toLocaleString()}。` }], details: {} };
        }
        const wealthCost = Math.max(1, Math.ceil(amt / 1000));
        org.wealth = Math.max(0, orgWealth - wealthCost);
        const purpose = params.purpose || "未注明用途";
        saveState();
        const memberHint = gameState.player.memberships?.find(m => m.orgId === params.orgId)
          ? `（你当前是「${org.name}」的 ${gameState.player.memberships.find(m => m.orgId === params.orgId)!.role}）`
          : "（你并非该组织正式成员——LLM 请根据叙事判断此次动用资金是否合理）";
        return {
          content: [{ type: "text", text: `💸 「${org.name}」支出 ¥${amt.toLocaleString()}（财力 -${wealthCost}，当前 ${org.wealth}）\n用途: ${purpose}\n${memberHint}` }],
          details: { success: true, wealthCost, orgWealth: org.wealth }
        };
      }

      case "hold_meeting": {
        const topic = params.purpose || "内部会议";
        org.cohesion = Math.min(100, (org.cohesion ?? 50) + 2);
        saveState();
        return {
          content: [{ type: "text", text: `📋 「${org.name}」召开内部会议（议题: ${topic}）。\n凝聚力 +2（当前: ${org.cohesion}）。\n组织成员之间就「${topic}」进行了讨论——LLM 请根据叙事推进后续。` }],
          details: { success: true, cohesion: org.cohesion }
        };
      }

      case "issue_statement": {
        const content = params.purpose || "公开声明";
        const targetOrg = params.targetOrg ? gameState.organizations?.[params.targetOrg] : null;
        let relEffect = "";
        if (targetOrg && org.relations) {
          // 声明会影响与该组织的关系（LLM 决定是+还是-，引擎只给中性标记）
          relEffect = `\n涉及组织: ${targetOrg.name}（当前关系: ${org.relations[params.targetOrg] ?? 0}）`;
        }
        org.influence = Math.min(100, (org.influence ?? 50) + 1);
        saveState();
        return {
          content: [{ type: "text", text: `📢 「${org.name}」发表声明: ${content}${relEffect}\n影响力 +1（当前: ${org.influence}）。\nLLM 请根据声明内容决定公众反应和相关组织的关系变化。` }],
          details: { success: true, influence: org.influence }
        };
      }

      case "dispatch_member": {
        const npcName = params.targetNpc;
        if (!npcName) return { content: [{ type: "text", text: "❌ dispatch_member 需要指定 targetNpc（派遣对象）。" }], details: {} };
        const isMember = org.members?.some((m: any) => m.npcName === npcName);
        if (!isMember) {
          return { content: [{ type: "text", text: `❌ 「${npcName}」不是「${org.name}」的成员，无法派遣。` }], details: {} };
        }
        const task = params.purpose || "执行任务";
        // 设置 NPC 的 pendingOverride
        const { getOrCreateNPC } = await import("../../engine/state.ts");
        const npc = getOrCreateNPC(npcName);
        const expiresAt = gameState.time.game_date;
        npc.pendingOverride = {
          location: params.targetOrg ? gameState.organizations?.[params.targetOrg]?.coreLocation || npc.currentRoom : npc.currentRoom,
          action: `[组织派遣] ${task}`,
          reason: `「${org.name}」派遣: ${task}`,
          expiresAt
        };
        saveState();
        return {
          content: [{ type: "text", text: `📨 「${org.name}」派遣 ${npcName} 执行任务: ${task}。\nNPC 日程已覆写为组织任务。` }],
          details: { success: true, dispatched: npcName, task }
        };
      }

      default:
        return { content: [{ type: "text", text: `❌ 未知行动: ${params.action}` }], details: {} };
    }
  },
};
