// e2e-init-test.ts —— 完整开局管线冒烟测试（validate-state 护栏）
// 真跑 init_game → init_profile → validatePlayerState，断言最终状态完好
// 两个场景：角色库内（材木座义辉）+ 角色库外（无名路人，验证兜底）
//
process.env.NODE_ENV = "test";
// 注意：不要 destructure gameState（ESM live binding 陷阱——resetState() 重赋值后
// destructured const 仍是旧引用）。始终通过 getGS() 访问。

async function main() {
  // stateMod.gameState 是 ESM namespace 的 live getter——始终拿当前值
  const stateMod = await import("./engine/state.ts");
  const getGS = () => stateMod.gameState;

  const initGame = (await import("./tools/state/init_game.ts")).default;
  const initProfile = (await import("./tools/state/init_profile.ts")).default;
  const { validatePlayerState } = await import("./engine/validate-state.ts");

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string) {
    if (cond) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
      failed++;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 场景 1：数据库内角色 — 材木座义辉
  // init_game(骨架+兜底内衣) → init_profile(千叶市高中生模板) → 角色库自动合并(体型/属性/技能/tags→flags/眼镜)
  // ══════════════════════════════════════════════════════════════
  console.log("\n── 场景1: 材木座义辉（角色库内，完整合并）──");
  stateMod.resetState();
  await initGame.execute("t", { name: "材木座义辉", gender: "男", age: 16 }, null, null, null);
  await initProfile.execute("t", { profileId: "千叶市高中生" }, null, null, null);
  {
    const p = getGS().player;

    // 基础骨架
    check("玩家名=材木座义辉", p.name === "材木座义辉");
    check("年龄=16", p.age === 16);
    check("性别=男", p.gender === "男");
    check("存活", p.alive === true);

    // 内衣兜底（init_game 设置，不被 profile 覆盖）
    check("有内衣上(inner_top)", !!p.equipment.inner_top);
    check("有内衣下(inner_bot)", !!p.equipment.inner_bot);

    // profile 装备（校服 top/bottom）
    check("有上衣(top)", !!p.equipment.top);

    // 角色库自动合并：眼镜（acc 槽 profile 没占 → 角色填入；normalizeItem 已验证带 volume）
    check("有眼镜(acc=圆框眼镜)", p.equipment.acc?.name === "圆框眼镜");

    // 角色库覆盖：体型（170cm/82kg/偏胖）
    check("体型=偏胖", p.body.build === "偏胖");
    check("体重=82", p.body.weight_kg === 82);

    // 资金（profile 500 覆盖 init_game 的 300）
    check("资金=500", p.funds === 500);

    // HP
    check("HP 上限>0", p.hp.max > 0);
    check("HP 当前在范围内", p.hp.current >= 0 && p.hp.current <= p.hp.max);

    // 角色库合并：tags → flags（写入 PlayerState.flags）
    check("flag 中二病", getGS().player.flags["中二病"] === true);
    check("flag 剑豪将军", getGS().player.flags["剑豪将军"] === true);

    // profile flags（写入 PlayerState.flags）
    check("flag soubu_high_enrolled", getGS().player.flags["soubu_high_enrolled"] === true);

    // init_game 世界 flags
    check("flag 世界包 worldpack_oregairu", getGS().flags["worldpack_oregairu"] === true);
    check("flag oregairu", getGS().flags["oregairu"] === true);

    // 角色库技能合并（写入:5 覆盖 profile 国語:2）
    check("技能 写作 lv5", p.skills["写作"]?.level === 5);
    check("技能 国語 lv3（角色库覆盖）", p.skills["国語"]?.level === 3);

    // profile 不预设关系——社交自然增长（contacts/relationships 由游戏内行为决定）
    check("引擎不预设关系", !p.relationships["比企谷八幡"] && !p.relationships["雪之下雪乃"]);

    // 住宅：init_profile 实例化独栋_2F_4人家庭，"家"
    check("住宅'家'已登记", !!p.properties["家"]);

    // 网格位置
    check("gridPos 非 null", p.gridPos !== null);
    check("gridPos 是 [number,number]", Array.isArray(p.gridPos) && p.gridPos.length === 2);
    check("位置=家子女房A", p.location === "家子女房A");

    // 住宅房间展开：location 能被 getRoom 解析到
    const { getRoom } = await import("./engine/state-grid.ts");
    check("住宅房间已展开(getRoom 非空)", getRoom(p.location) !== null);

    // 联系人
    check("known_locations 含 千葉駅前",
      Array.isArray(p.known_locations) && p.known_locations.some((l: string) => l.includes("千葉駅前")));
  }

  // 校验器全绿
  {
    const v = validatePlayerState(getGS(), { phase: "init" });
    check("场景1 校验器 ok===true", v.ok, v.errors.join("; "));
    check("场景1 校验器无 warning", v.warnings.length === 0, v.warnings.join("; "));
  }

  // ══════════════════════════════════════════════════════════════
  // 场景 2：角色库外 — 无名路人（走兜底，不发生角色自动合并）
  // ══════════════════════════════════════════════════════════════
  console.log("\n── 场景2: 无名路人甲XYZ（角色库外，验证兜底）──");
  stateMod.resetState();
  await initGame.execute("t", { name: "无名路人甲XYZ", gender: "男", age: 16 }, null, null, null);
  await initProfile.execute("t", { profileId: "千叶市高中生" }, null, null, null);
  {
    const q = getGS().player;

    check("场景2 玩家名正确", q.name === "无名路人甲XYZ");
    check("场景2 存活", q.alive === true);
    check("场景2 有兜底内衣", !!q.equipment.inner_top && !!q.equipment.inner_bot);
    check("场景2 有上衣(top)", !!q.equipment.top);
    check("场景2 资金>0", q.funds > 0);
    check("场景2 HP 上限>0", q.hp.max > 0);
    check("场景2 HP 当前在范围内", q.hp.current >= 0 && q.hp.current <= q.hp.max);
    check("场景2 gridPos 非 null", q.gridPos !== null);
    check("场景2 gridPos 是 [number,number]", Array.isArray(q.gridPos) && q.gridPos.length === 2);

    // 无角色库匹配 → 体型保持默认值（不被错误覆盖为材木座的 82kg）
    check("场景2 体型未被错误覆盖(非82kg)", q.body.weight_kg !== 82);

    // 无角色库匹配 → flags 不含材木座特有标签（PlayerState.flags）
    check("场景2 无中二病 flag", getGS().player.flags["中二病"] !== true);
    check("场景2 无剑豪将军 flag", getGS().player.flags["剑豪将军"] !== true);

    // profile flags 仍应存在（PlayerState.flags）
    check("场景2 flag soubu_high_enrolled", getGS().player.flags["soubu_high_enrolled"] === true);

    // 世界 flag（GameState.flags）
    check("场景2 flag 世界包", getGS().flags["worldpack_oregairu"] === true);

    // 引擎生成 flag + 技能（PlayerState.flags）
    check("场景2 student flag", getGS().player.flags["student"] === true);
    check("场景2 技能继承", Object.keys(q.skills || {}).length > 0);

    // 住宅
    check("场景2 住宅已登记", !!q.properties["家"]);
  }

  // 校验器全绿
  {
    const v = validatePlayerState(getGS(), { phase: "init" });
    check("场景2 校验器 ok===true", v.ok, v.errors.join("; "));
    check("场景2 校验器无 warning", v.warnings.length === 0, v.warnings.join("; "));
  }

  // ══════════════════════════════════════════════════════════════
  // 场景 3：GM 手动建宅 → 导航整链（模拟 GM 实战：profile 套旧宅 + GM 建新宅入住）
  // ══════════════════════════════════════════════════════════════
  console.log("\n── 场景3: GM 手动建宅（秋月家）→ 导航整链 ──");
  stateMod.resetState();
  // 用千叶市上班族 profile（residenceName="自宅", playerRoom="居室"）先套旧宅
  await initGame.execute("t", { name: "秋月孝三", gender: "男", age: 35 }, null, null, null);
  await initProfile.execute("t", { profileId: "千叶市上班族" }, null, null, null);
  // GM 建新宅并入住（模拟实战中 instantiate_residence 工具调用）
  {
    const instRes = (await import("./tools/action/instantiate_residence.ts")).default;
    await instRes.execute("t", { template: "独栋_2F_4人家庭", name: "秋月家", movePlayerIn: true, playerRoom: "主卧" }, null, null, null);
    const p = getGS().player;
    const { getRoom } = await import("./engine/state-grid.ts");

    check("场景3 玩家名=秋月孝三（非维）", p.name === "秋月孝三");
    check("场景3 秋月家已进 known_locations", p.known_locations.includes("秋月家"));
    check("场景3 秋月家主卧房间可 getRoom", getRoom("秋月家主卧") !== null);
    check("场景3 玩家已搬进秋月家主卧", p.location === "秋月家主卧");
    check("场景3 properties 含秋月家", !!p.properties["秋月家"]);
    check("场景3 无自引用关系", !p.relationships[p.name]);

    // go_to_location 能找到新宅的另一个房间（导航整链验证）
    const goTo = (await import("./tools/lookup/go_to_location.ts")).default;
    const navRes = await goTo.execute("t", { destination: "秋月家客厅" }, null, null, null);
    check("场景3 go_to_location 能导航到秋月家客厅",
      !navRes.content[0].text.includes("未找到"), navRes.content[0].text);

    const v = validatePlayerState(getGS(), { phase: "init" });
    check("场景3 校验器 ok===true", v.ok, v.errors.join("; "));
    check("场景3 校验器无 warning", v.warnings.length === 0, v.warnings.join("; "));
  }

  // ── 摘要 ──
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
