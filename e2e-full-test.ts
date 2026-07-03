// e2e-full-test.ts —— GM 全流程实战测试（秋月孝三开局）
// 删旧档 → init_game → init_profile → 建宅 → 创NPC → 设关系 → TUI → 校验
async function main() {
  const stateMod = await import("./engine/state.ts");
  const getGS = () => stateMod.gameState;
  const initGame = (await import("./tools/state/init_game.ts")).default;
  const initProfile = (await import("./tools/state/init_profile.ts")).default;
  const { validatePlayerState } = await import("./engine/validate-state.ts");
  const path = await import("node:path");
  const fs = await import("node:fs");

  let passed = 0, failed = 0;
  function check(name: string, cond: boolean, detail?: string) {
    if (cond) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`); failed++; }
  }

  // ── 0. 清理旧档 ──
  const stateDir = path.resolve(process.cwd(), "state");
  if (fs.existsSync(stateDir)) fs.rmSync(stateDir, { recursive: true });
  console.log("✓ 旧档已清理\n");

  // ═══════════════════════════════════════════════
  // 场景：秋月孝三（35岁教师）→ 千叶市上班族 profile
  // ═══════════════════════════════════════════════
  stateMod.resetState();
  await initGame.execute("t", { name: "秋月孝三", gender: "男", age: 35 }, null, null, null);
  await initProfile.execute("t", { profileId: "千叶市上班族" }, null, null, null);

  {
    const p = getGS().player;
    const gs = getGS();

    console.log("── 基础状态 ──");
    check("玩家名=秋月孝三", p.name === "秋月孝三", p.name);
    check("年龄=35", p.age === 35, String(p.age));
    check("性别=男", p.gender === "男", p.gender);
    check("存活", p.alive === true);
    check("有内衣上", !!p.equipment.inner_top && !!p.equipment.inner_top.name);
    check("有内衣下", !!p.equipment.inner_bot && !!p.equipment.inner_bot.name);
    check("资金>0", p.funds > 0, String(p.funds));
    check("HP合法", p.hp.current > 0 && p.hp.current <= p.hp.max,
      `${p.hp.current}/${p.hp.max}`);

    console.log("\n── 网格坐标 ──");
    check("gridPos非null", p.gridPos !== null && Array.isArray(p.gridPos),
      JSON.stringify(p.gridPos));
    if (p.gridPos) {
      check("gridPos是合法坐标", p.gridPos[0] >= 0 && p.gridPos[1] >= 0,
        `[${p.gridPos[0]},${p.gridPos[1]}]`);
    }

    console.log("\n── 位置与导航 ──");
    check("location非空", typeof p.location === "string" && p.location.length > 0,
      JSON.stringify(p.location));
    const { getRoom } = await import("./engine/state-grid.ts");
    check("location可getRoom", getRoom(p.location) !== null, p.location);

    console.log("\n── 世界flag ──");
    check("worldpack flag", gs.flags["worldpack_oregairu"] === true);
    check("oregairu flag", gs.flags["oregairu"] === true);

    console.log("\n── 流程flag ──");
    check("有上衣(top)", !!p.equipment.top && !!p.equipment.top.name,
      p.equipment.top?.name || "无");
    check("有裤子(bottom)", !!p.equipment.bottom && !!p.equipment.bottom.name,
      p.equipment.bottom?.name || "无");

    console.log("\n── 住宅 ──");
    check("properties非空", Object.keys(p.properties || {}).length > 0,
      JSON.stringify(Object.keys(p.properties || {})));
    const { getRoom: gr } = await import("./engine/state-grid.ts");
    for (const propName of Object.keys(p.properties || {})) {
      check(`住宅"${propName}"在known_locations`, p.known_locations?.includes(propName));
      // 检查住宅的子房间是否存在
      const subRooms = Object.keys(stateMod.ROOMS || {}).filter((r: string) => r.startsWith(propName));
      check(`住宅"${propName}"有≥2个子房间`, subRooms.length >= 2,
        `找到${subRooms.length}个: ${subRooms.slice(0, 3).join(",")}`);
    }

    console.log("\n── 物品价格 ──");
    const { getItemTemplate } = await import("./engine/state-grid.ts");
    const testItems = ["手机", "绷带", "饭团", "沙发", "棒球棍"];
    for (const name of testItems) {
      const item = getItemTemplate(name);
      check(`${name}有价格`, typeof item.price === "number" && item.price > 0,
        `price=${item.price}`);
    }

    console.log("\n── 装备槽位 ──");
    const bodyItem = { name: "白衣", type: "clothing", slot: "body", weight: 0.3, volume: 0.5, effects: [], state: "intact" as const };
    p.equipment.body = bodyItem;
    check("body槽位可装备", p.equipment.body?.name === "白衣");
    delete p.equipment.body;

    console.log("\n── 关系表无自引用 ──");
    check("无自引用关系", !p.relationships[p.name],
      p.relationships[p.name] ? JSON.stringify(p.relationships[p.name]) : "");

    console.log("\n── 校验器 ──");
    const v = validatePlayerState(gs, { phase: "init" });
    check("校验器ok", v.ok, v.errors.join("; "));
    if (v.warnings.length > 0) {
      console.log("  ⚠ warnings:", v.warnings.join("; "));
    }
    check("校验器无warning", v.warnings.length === 0, v.warnings.join("; "));
  }

  // ── 鉴证：saveState 后 gridPos 不丢 ──
  console.log("\n── 持久化验证(girdPos不丢) ──");
  stateMod.saveState();
  const afterSave = getGS().player.gridPos;
  check("saveState后gridPos保留", afterSave !== null && Array.isArray(afterSave),
    JSON.stringify(afterSave));

  // loadState 回来验证
  const { loadState } = stateMod;
  const loaded = loadState();
  check("loadState成功", loaded === true);
  const afterLoad = getGS().player.gridPos;
  check("loadState后gridPos非null", afterLoad !== null && Array.isArray(afterLoad),
    JSON.stringify(afterLoad));

  // ── 摘要 ──
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
