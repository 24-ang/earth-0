/**
 * 世界 tick —— 每次游戏时间推进时统一调用的剧情管线
 *
 * 三条时间推进路径（commit_turn / settle_scene / advanceTimeMinutes）
 * 都必须调用此函数，确保时间线扫描、驱动钩子、人生事件一致触发。
 * 不要在各处分别 inline 调用这四个函数——新增 tick 逻辑时只改这里。
 */

export async function runWorldTick(): Promise<void> {
  const { checkTimelineEvents, expireHooks, applyWorldStateToOrgs, evaluateOrgGoals, applyOrgDrivesToNPC } = await import("./timeline.ts");
  const { checkDriveDrivenHooks } = await import("./drives.ts");
  const { tickLifeEvents } = await import("./life-events.ts");

  checkTimelineEvents();
  checkDriveDrivenHooks();
  tickLifeEvents();

  // Step 7: 组织自转管线
  applyWorldStateToOrgs();
  const orgAlerts = evaluateOrgGoals();
  applyOrgDrivesToNPC();

  // 组织危机警告 → 注入动态事件
  if (orgAlerts.length > 0) {
    const { injectDynamicEvent } = await import("./timeline.ts");
    const { gameState } = await import("./state.ts");
    for (const alert of orgAlerts) {
      const org = gameState.organizations?.[alert.orgId];
      injectDynamicEvent({
        id: `org_crisis_${alert.orgId}`,
        source: "engine",
        expires_days: 5,
        repeatable: true,
        hook: {
          source_npc: org?.leader || "旁白",
          hook_text: alert.alert,
          urgency: "low",
        },
      });
    }
  }

  await expireHooks();
}
