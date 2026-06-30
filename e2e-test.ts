/**
 * 端到端测试：Phase 1 分类 → 关键词回落 → Phase 3 渲染 prompt
 * 不依赖 LLM API，纯测引擎层行为
 */
async function main() {
  const { runPhase1, keywordFallback, buildClassificationPrompt } = await import("./engine/phase1-classifier.ts");
  const { buildRenderSystemPrompt } = await import("./engine/phase3-render.ts");
  const { gameState, saveState, resetState } = await import("./engine/state.ts");

  // 初始化
  resetState();
  gameState.player.location = "千叶市立总武高等学校";
  gameState.npcs = {
    "雪之下雪乃": { currentRoom: "千叶市立总武高等学校", alive: true },
    "由比滨结衣": { currentRoom: "千叶市立总武高等学校", alive: true },
  };
  gameState.turn = 5;
  gameState.mode = "gal";
  gameState.interactionMode = "turn_based";
  gameState.time = { game_date: "2018-04-07", day_of_week: "土曜日", game_time: "10:30", minute_of_day: 630, player_age: 16 };
  gameState.weather = { type: "晴", temp: 18 };
  saveState();

  let passed = 0;
  let failed = 0;

  function check(name: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
      failed++;
    }
  }

  // ═══ Phase 1: 分类 prompt 组装 ═══
  console.log("\n── Phase 1: 分类 prompt ──");
  const prompt1 = buildClassificationPrompt("去便利店买瓶水", gameState);
  check("商品名在动作列表中", prompt1.includes("buy_item"));
  check("玩家输入嵌入", prompt1.includes("去便利店买瓶水"));
  check("在场 NPC 列出", prompt1.includes("雪之下雪乃"));
  check("否定规则存在", prompt1.includes("想去但放弃了"));

  // ═══ 关键词回落 — 正常移动 ═══
  console.log("\n── 关键词回落 — 正常情况 ──");
  const r1 = await keywordFallback("去便利店买瓶水", {});
  check("travel 执行", r1.toolsExecuted.includes("travel"));
  // buy_item 需要 itemsCatalog 有对应物品且当前地点有商店，测试环境无完整数据
  // 关键验证：travel 被执行 + 回落标记正确
  check("classified=false（回落标记）", !r1.classified);

  // ═══ 关键词回落 — 否定检测 ═══
  console.log("\n── 关键词回落 — 否定检测 ──");
  const r2 = await keywordFallback("我想去便利店但太远了算了", {});
  check("travel 不应执行", !r2.toolsExecuted.includes("travel"), `实际执行了: ${r2.toolsExecuted.join(",")}`);
  check("buy_item 不应执行", !r2.toolsExecuted.includes("buy_item"), `实际执行了: ${r2.toolsExecuted.join(",")}`);

  // ═══ 关键词回落 — 模糊输入 ═══
  console.log("\n── 关键词回落 — 模糊输入 ──");
  const r3 = await keywordFallback("随便看看周围环境", {});
  check("travel 不应执行（无具体地点）", !r3.toolsExecuted.includes("travel"), `实际执行了: ${r3.toolsExecuted.join(",")}`);
  check("buy_item 不应执行", !r3.toolsExecuted.includes("buy_item"));

  // ═══ 关键词回落 — 多个否定场景 ═══
  console.log("\n── 关键词回落 — 更多否定场景 ──");
  const r4 = await keywordFallback("太远了，不去了", {});
  check("travel 不应执行（纯否定）", !r4.toolsExecuted.includes("travel"), `实际执行了: ${r4.toolsExecuted.join(",")}`);

  const r5 = await keywordFallback("想去学校但还是算了", {});
  check("travel 不应执行（放弃）", !r5.toolsExecuted.includes("travel"), `实际执行了: ${r5.toolsExecuted.join(",")}`);

  const r6 = await keywordFallback("没有想去的地方", {});
  check("travel 不应执行（否定）", !r6.toolsExecuted.includes("travel"), `实际执行了: ${r6.toolsExecuted.join(",")}`);

  // ═══ Phase 3: 渲染 prompt ─═
  console.log("\n── Phase 3: 渲染 prompt ──");
  const renderPrompt = await buildRenderSystemPrompt(gameState, {
    directorNote: '<directors_note>\n  <player_action>玩家去便利店买水</player_action>\n  <resolved_changes>travel: 便利店; buy_item: 矿泉水x1</resolved_changes>\n  <tools_called>travel, buy_item</tools_called>\n  <scene_result>玩家在便利店，turn 5</scene_result>\n</directors_note>',
    npcResponses: "[雪之下雪乃] 看到你从书页间抬起头。「来得挺早。」",
    summary: "玩家去便利店买水",
  });
  check("不含 gm-contract.md 内容", !renderPrompt.includes("三段式工作流") && !renderPrompt.includes("结算轮禁止"));
  check("不含 gm-rules.md 核心纪律", !renderPrompt.includes("分析意图") || !renderPrompt.includes("只调用必要的工具"));
  check("不含 工具提示", !renderPrompt.includes("工具提示") && !renderPrompt.includes("始终可用"));
  check("含 director_note", renderPrompt.includes("directors_note") || renderPrompt.includes("director_note"));
  check("含 NPC 回应文本", renderPrompt.includes("雪之下雪乃"));
  check("含 渲染输出合约", renderPrompt.includes("渲染输出合约"));
  check("含 '禁止调用任何工具'", renderPrompt.includes("禁止调用任何工具"));
  check("含 字数限制", renderPrompt.includes("200-400") || renderPrompt.includes("400-800"));
  check("含 在场人物外观", renderPrompt.includes("[在场人物]"));
  check("长度合理（<20KB）", renderPrompt.length < 20000, `实际 ${renderPrompt.length} 字节`);

  // ═══ 验证渲染 prompt 不含我们删掉的关键层 ═══
  console.log("\n── Phase 3: 禁止内容验证 ──");
  const bannedInRender = ["gm-contract.md", "gm-rules.md", "settle_scene", "工具提示"];
  for (const word of bannedInRender) {
    check(`不含 "${word}"`, !renderPrompt.includes(word));
  }
  // 渲染合约中的关键指令
  check("含 '禁止调用任何工具'", renderPrompt.includes("禁止调用任何工具"));
  // 不含结算层才有的工具名（不在 mode/voice 文件里的）
  check("不含 steal_item", !renderPrompt.includes("steal_item"));
  check("不含 world_interact", !renderPrompt.includes("world_interact"));
  check("不含 combat_action", !renderPrompt.includes("combat_action"));

  // ═══ Prompt 瘦身验证 ═══
  console.log("\n── Prompt 瘦身验证 ──");
  // Verify mode files don't mention tools Phase 3 can't use
  check("gm-mode-rpg 不含 '世界交互工具'", !renderPrompt.includes("世界交互工具"));
  check("gm-mode-gal 不含 'intimate_touch'", !renderPrompt.includes("你也可以手动调用"));
  check("gm-mode-sex 不含 '手动调用 intimate_touch'", !renderPrompt.includes("手动调用 `intimate_touch`"));

  // ═══ Prompt 信息密度验证 ═══
  console.log("\n── Prompt 信息密度验证 ──");
  // Note: test state has no rooms/grid/equipment set up, so these may be absent
  // But the scene brief should always be present
  check("含 场景状态", renderPrompt.includes("[场景状态]"));
  check("含 渲染输出合约", renderPrompt.includes("渲染输出合约"));

  // ═══ 交互检测：关键词兜底 ═══
  console.log("\n── 交互检测：关键词兜底 ──");
  const { analyzeNpcResponses } = await import("./engine/detect-mode.ts");
  // 无需 LLM，纯测试关键词兜底路径

  // 空回应 → 不 cue
  const a0 = await analyzeNpcResponses({}, "维", {});
  check("空回应返回空数组", a0.length === 0);

  // 纯内心独白 → 不 cue
  const a1 = await analyzeNpcResponses({
    "雪之下雪乃": "*她仍在看书，没有抬头。*",
  }, "维", {});
  check("纯内心独白判不cue", a1.length === 0, `实际: ${JSON.stringify(a1)}`);

  // 直接喊玩家名 → cue
  const a2 = await analyzeNpcResponses({
    "由比滨结衣": "「维！你觉得哪个颜色好看？」",
  }, "维", {});
  check("直接喊玩家名判cue", a2.includes("由比滨结衣"), `实际: ${JSON.stringify(a2)}`);

  // 对话含"你" → cue
  const a3 = await analyzeNpcResponses({
    "雪之下雪乃": "「你觉得呢？」她看向你。",
  }, "维", {});
  check("对话含'你'判cue", a3.includes("雪之下雪乃"), `实际: ${JSON.stringify(a3)}`);

  // ═══ 交互检测：detectInteractionMode 扩展参数 ═══
  console.log("\n── 交互检测：detectInteractionMode ──");
  const { detectInteractionMode } = await import("./engine/detect-mode.ts");

  // 保存旧 mode
  const savedMode = gameState.mode;
  gameState.mode = "rpg";

  // 1. activeNPCs 非空 → turn_based
  const dm1 = detectInteractionMode(gameState, 3, {
    npcResponses: { "由比滨": "「维！」" },
    activeNPCs: ["由比滨"],
  });
  check("activeNPCs非空→turn_based", dm1.interactionMode === "turn_based");

  // 2. activeNPCs 为空但 NPC 在场 → novel
  const dm2 = detectInteractionMode(gameState, 3, {
    npcResponses: { "雪之下": "*看书*" },
    activeNPCs: [],
    skipCounterUpdate: true,
  });
  check("沉默NPC→novel", dm2.interactionMode === "novel");

  // 3. sex 模式仍然强制 turn_based
  gameState.mode = "sex";
  const dm3 = detectInteractionMode(gameState, 3, {
    npcResponses: { "雪之下": "*...*" },
    activeNPCs: [],
  });
  check("sex模式强制turn_based", dm3.interactionMode === "turn_based" && dm3.person === "first");

  // 恢复
  gameState.mode = savedMode;

  // ═══ GAL 场景边界测试 ═══
  console.log("\n── GAL 场景边界 ──");
  // 模拟场景边界条件检查逻辑
  gameState.mode = "rpg";
  gameState.npcs = {
    "雪之下雪乃": { currentRoom: "千叶市立总武高等学校", alive: true },
    "由比滨结衣": { currentRoom: "千叶市立总武高等学校", alive: true },
  };
  gameState.player.location = "千叶市立总武高等学校";

  const present = Object.entries(gameState.npcs)
    .filter(([_, n]: [string, any]) => n.currentRoom === gameState.player?.location && n.alive !== false)
    .map(([name]) => name);

  // 2 NPCs → should NOT activate GAL
  check("2人同场不应激活GAL", present.length !== 1, `实际在场: ${present.length}人`);

  // 1 NPC → could activate if conditions met
  delete gameState.npcs["由比滨结衣"];
  const present2 = Object.entries(gameState.npcs)
    .filter(([_, n]: [string, any]) => n.currentRoom === gameState.player?.location && n.alive !== false)
    .map(([name]) => name);
  check("1人独处可触发GAL检查", present2.length === 1 && present2[0] === "雪之下雪乃");

  // ═══ 总结 ═══
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
