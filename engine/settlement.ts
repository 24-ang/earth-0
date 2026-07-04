/**
 * engine/settlement.ts — 场景结算共享逻辑
 *
 * 工具 (settle_scene) 和引擎 hook (before_agent_start 兜底) 共用此函数。
 *
 * PHILOSOPHY §1.3: 约束下沉到引擎——结算不再是"LLM记得调"，
 * 而是"引擎保证执行"。当 settle_scene 漏调时，引擎跑完整结算流程，
 * 而非之前的不完整兜底。
 *
 * 同时负责 P1: record_turn_log 自动生成（台账保底）。
 */

export interface SettlementParams {
  elapsed_minutes: number;
  memory_tags?: Array<{
    target: string;
    tag: string;
    tone?: string;
    priority?: number;
    emotional_valence?: "positive" | "negative" | "neutral";
    related_npcs?: string[];
    category?: "fact" | "emotion" | "milestone" | "general";
  }>;
  /** pi framework context, for reviewTurn + viewpoint triggers. Omit in auto-settlement. */
  ctx?: any;
  /** If true, settlement was auto-triggered (GM forgot to call settle_scene). */
  _autoSettled?: boolean;
}

export interface SettlementResult {
  resultText: string;
  events: string[];
  autoSettled: boolean;
  time: any;
}

export async function runSettlement(params: SettlementParams): Promise<SettlementResult> {
  const {
    gameState, saveState, backupBeforeTurn, updateNPCSchedules,
    refreshWeather, addMemoryTag, stampRoom, cleanupTempNPCs,
    drainToolCalls, isSameLocation, appendShortTermBuffer, recordTurnLog,
  } = await import("./state.ts");
  const { advanceMinutes } = await import("./time.ts");

  const mins = params.elapsed_minutes;
  const autoSettled = params._autoSettled ?? false;

  // --- 0. 收口工具调用记录 ---
  gameState._lastTurnToolsCalled = drainToolCalls();

  // --- 1. 清场临时 NPC ---
  const cleanupMsgs = cleanupTempNPCs(autoSettled ? "引擎自动结算" : "场景结算");

  // --- 2. 回合前备份（仅当时间确实推进时） ---
  if (mins > 0) backupBeforeTurn();

  // --- 3. 初始化 minute_of_day ---
  if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;

  // --- 4. 推进时间 ---
  const result = advanceMinutes(gameState.time, mins);
  gameState.player.age = gameState.time.player_age;

  // --- 5. 推进回合计数 ---
  gameState.turn++;

  // --- 6. 天气刷新（每 4 回合） ---
  if (gameState.turn % 4 === 0) refreshWeather();

  // --- 7. NPC 日程推进 ---
  const events = await updateNPCSchedules();

  // --- 8. 世界 Tick（时间线/驱动钩子/人生事件） ---
  const { runWorldTick } = await import("./tick.ts");
  await runWorldTick();

  // --- 9. 疲劳累积（长时间→休息恢复，短时间→活动累积） ---
  const { getFatigueMultiplier } = await import("./weather.ts");
  const kFatigue = getFatigueMultiplier(gameState.weather?.temp ?? 16);
  let rawFatigue: number;
  if (mins >= 240) {
    // 4小时以上视为休息/睡眠，疲劳递减而非递增
    rawFatigue = Math.max(0, (gameState.player.fatigue ?? 0) - Math.round(mins / 12));
  } else {
    rawFatigue = (gameState.player.fatigue ?? 0) + Math.round((mins / 12) * kFatigue);
  }
  // --- 10. 跨天结算：住房合同 + 每日睡眠恢复40疲劳 ---
  if (result.daysAdvanced > 0) {
    const { settleHousingContracts } = await import("./housing.ts");
    settleHousingContracts(gameState);
    rawFatigue = Math.max(0, rawFatigue - result.daysAdvanced * 40);
  }
  gameState.player.fatigue = Math.min(100, rawFatigue);

  // --- 11. 统计同场 NPC 数量 ---
  const countAliveNPCsHere = () =>
    Object.values(gameState.npcs).filter(
      (n: any) => n.alive && isSameLocation(n.currentRoom, gameState.player.location)
    ).length;

  const previousRoundNPCs = (() => {
    // auto-settled 时上一轮的数据已不可得，用当前数据作为近似
    return countAliveNPCsHere();
  })();

  const currentRoundNPCs = countAliveNPCsHere();

  // --- 12. 检测叙事模式 ---
  const { detectInteractionMode } = await import("./detect-mode.ts");
  const modeResult = detectInteractionMode(gameState, currentRoundNPCs);
  gameState.interactionMode = modeResult.interactionMode;

  // --- 13. 视角触发器（多 NPC 切镜/幕间/内心独白） ---
  const { processViewpointTriggers } = await import("./viewpoint.ts");
  await processViewpointTriggers(gameState, previousRoundNPCs, currentRoundNPCs, params.ctx);

  // --- 14. 写入记忆标签 ---
  if (params.memory_tags && params.memory_tags.length > 0) {
    for (const m of params.memory_tags) {
      addMemoryTag(m.target, m.tag, 365, (m as any).tone, m.priority, m.emotional_valence, m.related_npcs, m.category);
      try {
        appendShortTermBuffer(m.target, undefined, `场景结算事件: ${m.tag}`);
      } catch (e) {
        console.error("runSettlement appendShortTermBuffer error:", e);
      }
    }
  }

  // --- 15. 标记房间时间戳 ---
  stampRoom();

  // --- 16. 复盘审计（仅当有 ctx 时） ---
  if (params.ctx) {
    try {
      const { reviewTurn } = await import("./audit/review-agent.ts");
      await reviewTurn(params.ctx);
    } catch (e) {
      console.error("[Review Agent Error] 复盘执行发生未捕获异常/超时:", e);
    }
  }

  // --- 17. 自动台账（P1: record_turn_log 保底） ---
  // 工具正常调用时 GM 会手动写台账。引擎自动结算时生成保底台账。
  if (autoSettled) {
    try {
      const toolsList = gameState._lastTurnToolsCalled || [];
      const toolSummary = toolsList.length > 0 ? toolsList.join(", ") : "无工具调用";
      recordTurnLog({
        playerAction: "（引擎自动结算）",
        resolvedChanges: `本轮工具: ${toolSummary}`,
        sceneResult: "场景自动推进",
        openHooks: "",
        nextPressure: "",
        toolsCalled: toolsList,
      });
    } catch (e) {
      console.error("runSettlement auto recordTurnLog error:", e);
    }
  }

  // --- 18. 落盘 ---
  saveState();

  // --- 18.5 状态完整性校验（turn 阶段：仅 ERROR 大声） ---
  try {
    const { validatePlayerState } = await import("./validate-state.ts");
    validatePlayerState(gameState, { phase: "turn" });
  } catch (e: any) {
    console.error("settlement: 状态校验器调用失败", e?.message || String(e));
  }

  // --- 19. 拼结果文案 ---
  const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
  const cleanupText = cleanupMsgs.length > 0 ? cleanupMsgs.join("\n") + "\n" : "";
  const autoTag = autoSettled ? "[引擎自动结算] " : "";
  const textResult =
    autoTag + cleanupText +
    `场景结束推进了 ${mins}分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}。\n` +
    `日程更新: ${events.length > 0 ? events.join("; ") : "无特殊事件"}\n` +
    `写入记忆: ${params.memory_tags && params.memory_tags.length > 0
      ? params.memory_tags.map(m => `${m.target}(${m.tag})`).join(", ")
      : "无"}`;

  return { resultText: textResult, events, autoSettled, time: gameState.time };
}
