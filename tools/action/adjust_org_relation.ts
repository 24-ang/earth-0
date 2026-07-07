import { Type } from "typebox";

/** 调整两个组织之间的关系。引擎只写数据——LLM 决定这个行为在叙事中是否合理。 */
export default {
  name: "adjust_org_relation",
  label: "调整组织关系",
  description: "代表组织调整与其他组织的关系：结盟(正向)/敌对(负向)/中立(归零)。引擎只写数据。",
  parameters: Type.Object({
    orgIdA: Type.String({ description: "己方组织ID" }),
    orgIdB: Type.String({ description: "对方组织ID" }),
    delta: Type.Number({ description: "关系变化量 (-100~+100)。正值=改善(结盟)，负值=恶化(敌对)，0=重置为中立" }),
    reason: Type.Optional(Type.String({ description: "变动原因：签署条约/撕毁协议/公开谴责/合并/分裂" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const orgA = gameState.organizations?.[params.orgIdA];
    const orgB = gameState.organizations?.[params.orgIdB];
    if (!orgA) return { content: [{ type: "text", text: `❌ 组织「${params.orgIdA}」不存在。` }], details: {} };
    if (!orgB) return { content: [{ type: "text", text: `❌ 组织「${params.orgIdB}」不存在。` }], details: {} };

    orgA.relations ??= {};
    orgB.relations ??= {};

    const oldRelAB = orgA.relations[params.orgIdB] ?? 0;

    if (params.delta === 0) {
      // 重置为中立
      delete orgA.relations[params.orgIdB];
      delete orgB.relations[params.orgIdA];
      saveState();
      const reason = params.reason || "关系重置";
      return {
        content: [{ type: "text", text: `🤝 「${orgA.name}」与「${orgB.name}」的关系已重置为中立。\n${reason}\n（旧关系: ${oldRelAB > 0 ? '+' + oldRelAB : oldRelAB}）` }],
        details: { success: true, oldRelation: oldRelAB, newRelation: 0 }
      };
    }

    const delta = Math.max(-100, Math.min(100, params.delta));
    orgA.relations[params.orgIdB] = Math.max(-100, Math.min(100, (orgA.relations[params.orgIdB] ?? 0) + delta));
    orgB.relations[params.orgIdA] = Math.max(-100, Math.min(100, (orgB.relations[params.orgIdA] ?? 0) + delta));

    const newRelAB = orgA.relations[params.orgIdB];
    const reason = params.reason || (delta > 0 ? "关系改善" : delta < 0 ? "关系恶化" : "关系调整");

    // 组织公开合法性受影响（结盟=公信力微升，敌对=微降）
    if (delta >= 50) { orgA.public_legitimacy = Math.min(100, (orgA.public_legitimacy ?? 50) + 2); }
    if (delta <= -50) { orgA.public_legitimacy = Math.max(0, (orgA.public_legitimacy ?? 50) - 2); }

    saveState();

    const direction = delta > 0 ? "改善" : "恶化";
    const label = newRelAB >= 70 ? "牢固同盟" : newRelAB >= 30 ? "合作关系" : newRelAB >= 0 ? "中立偏友好"
      : newRelAB <= -70 ? "死敌" : newRelAB <= -30 ? "敌对" : "中立偏冷淡";

    const memberHint = gameState.player.memberships?.find(m => m.orgId === params.orgIdA)
      ? `\n（你当前是「${orgA.name}」的 ${gameState.player.memberships.find(m => m.orgId === params.orgIdA)!.role}——LLM 请根据叙事判断你是否有权代表组织签署此协定）`
      : `\n（你并非「${orgA.name}」的正式成员——LLM 请根据叙事判断此次关系调整的合法性）`;

    return {
      content: [{
        type: "text",
        text: `🤝 「${orgA.name}」↔「${orgB.name}」关系${direction}（${oldRelAB > 0 ? '+' + oldRelAB : oldRelAB} → ${newRelAB > 0 ? '+' + newRelAB : newRelAB}，${label}）\n${reason}${memberHint}`
      }],
      details: { success: true, delta, oldRelation: oldRelAB, newRelation: newRelAB, label }
    };
  },
};
