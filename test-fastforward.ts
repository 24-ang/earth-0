/**
 * 测试时间线快进：高二学期中 (age=17, 2019-06-15)
 */
async function main() {
  const stateMod = await import("./engine/state.ts");
  const { resetState, setPlayerLocation, initPlayerGrid } = stateMod;
  // IMPORTANT: gameState is a live ESM binding — never destructure.
  // After resetState() reassigns the module variable, stale destructured refs point to the old object.
  const gs = () => stateMod.gameState;
  const { getLifeStage } = await import("./engine/time.ts");
  const { currentDay, fastForwardTimeline, loadAllTimelines } = await import("./engine/timeline.ts");

  resetState();
  gs().player.name = "维";
  gs().player.gender = "男";
  gs().player.age = 17;
  gs().time.player_age = 17;
  gs().time.timeline_origin = { year: 2019, age: 17 };
  gs().time.game_date = "2019-06-15";
  gs().time.player_stage = getLifeStage(17);
  setPlayerLocation("家_玩家房间");
  initPlayerGrid();

  console.log("=== 高二学期中 (age=17, 2019-06-15) ===");
  console.log(`game_date: ${gs().time.game_date}`);
  console.log(`timeline_origin: ${JSON.stringify(gs().time.timeline_origin)}`);

  const startDay = currentDay();
  console.log(`currentDay: ${startDay}`);

  gs().completed_events ??= [];
  gs().flags ??= [];

  const allEvts = loadAllTimelines();
  console.log(`timeline events loaded: ${allEvts.length}`);
  const withMinDay = allEvts.filter((e: any) => e.trigger?.min_day);
  console.log(`  with min_day: ${withMinDay.length}`);
  const underStart = withMinDay.filter((e: any) => e.trigger.min_day < startDay);
  console.log(`  min_day < ${startDay}: ${underStart.length}`);

  console.log(`completed_events before: ${gs().completed_events.length}`);
  console.log(`flags before: ${Object.keys(gs().flags).length}`);

  const completed = await fastForwardTimeline(startDay);

  console.log(`\n=== 快进结果 ===`);
  console.log(`completed_events after: ${gs().completed_events.length}`);
  console.log(`flags after: ${Object.keys(gs().flags).length}`);
  const flagList = Object.entries(gs().flags).slice(0, 30).map(([k, v]) => `${k}=${v}`).join(", ");
  console.log(`flags: ${flagList}`);
  const rels = Object.keys(gs().player.relationships);
  console.log(`player relationships: ${rels.length > 0 ? rels.join(", ") : "(none)"}`);
  // 看看关系详情
  for (const [name, rel] of Object.entries<any>(gs().player.relationships).slice(0, 10)) {
    console.log(`  ${name}: stage=${rel.stage} affection=${rel.affection}`);
  }
  console.log(`auto-completed (first 20): ${completed.slice(0, 20).join(", ")}`);
  console.log(`total auto-completed: ${completed.length}`);

  const npcWithRels = Object.entries(gs().npcs)
    .filter(([_, n]: [string, any]) => Object.keys(n.npcRelationships || {}).length > 0)
    .map(([name, n]: [string, any]) => `${name}→${Object.keys(n.npcRelationships).join(",")}`);
  console.log(`NPC间关系: ${npcWithRels.length > 0 ? npcWithRels.join("; ") : "(none)"}`);

  console.log("\n=== OK ===");
}

main().catch(e => { console.error(e); process.exit(1); });
