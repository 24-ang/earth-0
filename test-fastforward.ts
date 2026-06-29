/**
 * 测试时间线快进：高二开局 (age=17, year=2019)
 */
async function main() {
  const { gameState, resetState, setPlayerLocation, initPlayerGrid } = await import("./engine/state.ts");
  const { getLifeStage } = await import("./engine/time.ts");
  const { currentDay, fastForwardTimeline } = await import("./engine/timeline.ts");

  resetState();
  gameState.player.name = "维";
  gameState.player.gender = "男";
  gameState.player.age = 17;
  gameState.time.player_age = 17;
  gameState.time.timeline_origin = { year: 2019, age: 17 };
  gameState.time.game_date = "2019-04-07";
  gameState.time.player_stage = getLifeStage(17);
  setPlayerLocation("家_玩家房间");
  initPlayerGrid();

  console.log("=== 高二开局 (age=17, year=2019) ===");
  const startDay = currentDay();
  console.log(`game_date: ${gameState.time.game_date}`);
  console.log(`player_stage: ${gameState.time.player_stage}`);
  console.log(`currentDay: ${startDay}`);
  gameState.completed_events ??= [];
  gameState.flags ??= {};
  console.log(`completed_events before: ${gameState.completed_events.length}`);
  console.log(`flags before: ${Object.keys(gameState.flags).length}`);

  const completed = await fastForwardTimeline(startDay);

  console.log(`\n=== 快进结果 ===`);
  console.log(`completed_events after: ${gameState.completed_events.length}`);
  console.log(`flags after: ${Object.keys(gameState.flags).length}`);
  const flagList = Object.entries(gameState.flags).slice(0, 30).map(([k, v]) => `${k}=${v}`).join(", ");
  console.log(`flags: ${flagList}`);
  const rels = Object.keys(gameState.player.relationships);
  console.log(`player relationships: ${rels.length > 0 ? rels.join(", ") : "(none)"}`);
  console.log(`auto-completed (first 20): ${completed.slice(0, 20).join(", ")}`);
  console.log(`total auto-completed: ${completed.length}`);

  const npcWithRels = Object.entries(gameState.npcs)
    .filter(([_, n]: [string, any]) => Object.keys(n.npcRelationships || {}).length > 0)
    .map(([name, n]: [string, any]) => `${name}→${Object.keys(n.npcRelationships).join(",")}`);
  console.log(`NPC间关系: ${npcWithRels.length > 0 ? npcWithRels.join("; ") : "(none)"}`);

  console.log("\n=== OK ===");
}

main().catch(e => { console.error(e); process.exit(1); });
