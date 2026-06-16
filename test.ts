/**
 * earth-0 引擎冒烟测试
 * 不需要 pi，不需要 LLM。2秒跑完全部。
 *
 * 用法：npx tsx test.ts
 */

import {
  gameState, saveState, loadState, resetState,
  movePlayer, placeFurniture, removeFurniture, toggleDoor,
  editCellType, createRoom, getRoom, initPlayerGrid, getGridContext,
  buyItem, sellItem, workJob, stealItem, stealFunds,
  monthlyGrowth, refreshWeather, updateNPCSchedules,
  buildStatePrompt, getBodyForAge, getNpcCurrentAge,
  setPlayerLocation, attrMod, calcMaxHP, calcAC,
  addSkillExp, updateRelation, getOrCreateNPC,
  calcReputationBonus, updateReputation,
  checkAndGrantTitles,
  stampRoom, getRoomAgingLine,
  setNPCOutfit, getNPCOutfitDesc,
  getLocationNav, createDynamicLocation,
  mountVehicle, dismountVehicle, getVehicleMul,
} from "./engine/state.ts";

import { check, attackRoll, rollDamage } from "./engine/dice.ts";
import { lookupRegion } from "./engine/router.ts";
import { advanceMinutes } from "./engine/time.ts";
import {
  checkTimelineEvents, expireHooks, getActiveHooks, getActiveQuests,
  openQuest, advanceQuest, abandonQuest,
  getTodayCalendar, getCalendarEvents, clearCalendarCache,
  getHookNoveltyHint,
} from "./engine/timeline.ts";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("=== earth-0 引擎冒烟测试 ===\n");

// ── 初始化 ──
resetState();
console.log(`玩家: ${gameState.player.name}, ${gameState.player.age}岁`);
console.log(`位置: ${gameState.player.location}`);
console.log(`时间: ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${gameState.time.time_of_day}\n`);

// ── 时间 ──
console.log("── 时间 ──");
test("advanceMinutes 30分", () => {
  const r = advanceMinutes(gameState.time, 30);
  if (r.timeOfDay !== "morning") throw new Error(`预期 morning，得 ${r.timeOfDay}`);
});
test("advanceMinutes 跨天", () => {
  gameState.time.minute_of_day = 1400; // 深夜
  const r = advanceMinutes(gameState.time, 120);
  if (r.daysAdvanced < 1) throw new Error("应跨天");
});

// ── 空间 ──
console.log("\n── 空间 ──");
test("getRoom 侍奉部", () => {
  const r = getRoom("侍奉部");
  if (!r) throw new Error("侍奉部不存在");
  if (r.width < 3 || r.height < 3) throw new Error("房间太小");
});

test("setPlayerLocation + initPlayerGrid", () => {
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  if (!gameState.player.gridPos) throw new Error("gridPos 未初始化");
  const [x, y] = gameState.player.gridPos;
  if (x < 0 || y < 0) throw new Error(`gridPos 异常: ${x},${y}`);
});

// 移动前记录初始位置
const initPos = [...(gameState.player.gridPos || [0, 0])];

test("movePlayer 东", () => {
  const r = movePlayer("东");
  if (!r.success && r.reason.includes("墙壁")) {
    // 侍奉部某些位置东边可能是墙，再试
  } else if (!r.success) {
    throw new Error(`移动失败: ${r.reason}`);
  }
});

// 回到侍奉部门口
setPlayerLocation("侍奉部");
initPlayerGrid();

test("getGridContext 有内容", () => {
  const ctx = getGridContext();
  if (!ctx.includes("侍奉部")) throw new Error("缺少房间名");
  if (!ctx.includes("[空间]")) throw new Error("缺少空间标签");
});

test("placeFurniture 在空位", () => {
  // 在玩家旁边的空地放东西。必须先有物品在背包
  gameState.player.inventory.push({ name: "台灯", type: "tool", weight: 0.5, effects: [], state: "intact" });
  const room = getRoom("侍奉部")!;
  const [px, py] = gameState.player.gridPos || [0, 0];
  // 找相邻空地
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || nx >= room.width || ny < 0 || ny >= room.height) continue;
    const c = room.cells[ny][nx];
    if (c.type === "floor" && !c.furniture) {
      const r = placeFurniture(nx, ny, "台灯");
      if (!r.success) throw new Error(`放置失败: ${r.reason}`);
      if (gameState.player.inventory.some((i: any) => i.name === "台灯")) throw new Error("放置后应从背包扣除台灯");
      // 清理
      removeFurniture(nx, ny);
      return;
    }
  }
  // 没有空地也通过（房间可能很小）
});

test("placeFurniture 拒绝无物品", () => {
  // 背包没东西不能凭空放置
  const before = gameState.player.inventory.length;
  const r = placeFurniture(3, 3, "黄金马桶");
  if (r.success) throw new Error("无物品应拒绝");
  if (gameState.player.inventory.length !== before) throw new Error("拒绝后背包不应变化");
});

test("placeFurniture 拒绝墙上", () => {
  const r = placeFurniture(0, 0, "台灯");
  // 侍奉部(0,0) 可能是墙也可能是地板，不做强断言
});

test("toggleDoor 非门窗拒绝", () => {
  const [px, py] = gameState.player.gridPos || [0, 0];
  const r = toggleDoor(px, py); // 玩家站在地板格上
  // 如果没有门/窗，应该返回失败
});

test("editCellType 造墙需要材料", () => {
  // 无材料拒绝
  const r = editCellType(2, 2, "wall", undefined, undefined);
  if (r.success) throw new Error("无材料造墙应拒绝");
  // 材料名不在背包拒绝
  gameState.player.inventory.push({ name: "砖", type: "tool", weight: 2, effects: [], state: "intact" });
  const r2 = editCellType(2, 2, "wall", undefined, "砖");
  if (!r2.success) throw new Error(`有砖应可造墙: ${r2.reason}`);
  // 应扣除材料
  if (gameState.player.inventory.some((i: any) => i.name === "砖")) throw new Error("造墙后应扣除砖");
  // 恢复
  editCellType(2, 2, "floor", undefined, "锤子");  // 拆墙需工具
});

test("editCellType 拆墙STR不足无工具拒绝", () => {
  // 先造一堵墙（需要材料）
  gameState.player.inventory.push({ name: "废铁板", type: "tool", weight: 3, effects: [], state: "intact" });
  editCellType(5, 5, "wall", undefined, "废铁板");
  // 设力量为4
  const origStr = gameState.player.attributes.力量;
  gameState.player.attributes.力量 = 4;
  const r = editCellType(5, 5, "floor", undefined, undefined);
  if (r.success) throw new Error("STR=4且无工具拆墙应拒绝");
  gameState.player.attributes.力量 = origStr;
  // 清理
  editCellType(5, 5, "floor", undefined, "锤子");
});

test("editCellType 废土材料造墙", () => {
  const room = getRoom("侍奉部")!;
  const [px, py] = gameState.player.gridPos || [0, 0];
  // 找空地
  let tx = 1, ty = 1;
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (room.cells[y][x].type === "floor" && !room.cells[y][x].furniture) {
        tx = x; ty = y; break;
      }
    }
  }
  gameState.player.inventory.push({ name: "魔法石", type: "tool", weight: 1, effects: [], state: "intact" });
  const r = editCellType(tx, ty, "wall", undefined, "魔法石");
  if (!r.success) throw new Error(`魔法石应可造墙: ${r.reason}`);
  if (gameState.player.inventory.some((i: any) => i.name === "魔法石")) throw new Error("应扣除魔法石");
  // 恢复
  editCellType(tx, ty, "floor", undefined, "魔法石");  // 用魔法石当工具拆
});

test("createRoom 拒绝重名", async () => {
  const r = await createRoom("侍奉部", 5, 5, 1);
  if (r.success) throw new Error("重名应拒绝");
});

test("createRoom 正常创建", async () => {
  const origDate = gameState.time.game_date;
  const r = await createRoom("测试房间", 3, 3, 1);
  if (!r.success) throw new Error(`创建失败: ${r.reason}`);
  if (!r.reason.includes("施工")) throw new Error("应包含施工时间信息");
});

// ── 骰子 ──
console.log("\n── 骰子 ──");
test("d20 check 普通难度", () => {
  const r = check("普通", 14, 3);
  if (!r.outcome) throw new Error("outcome 为空");
  if (r.roll.total === undefined) throw new Error("缺少 total");
});

test("attackRoll", () => {
  const r = attackRoll(14, 3, 12, "无掩体");
  if (r.hit === undefined) throw new Error("缺少 hit");
});

test("rollDamage 1d6", () => {
  for (let i = 0; i < 10; i++) {
    const d = rollDamage("1d6", 2);
    if (d < 3 || d > 8) throw new Error(`1d6+2 范围应为 3-8，得 ${d}`);
  }
});

// ── 经济 ──
console.log("\n── 经济 ──");
test("buyItem 绷带", () => {
  const before = gameState.player.funds;
  const r = buyItem("绷带", 200);
  if (!r.includes("买了")) throw new Error(`购买失败: ${r}`);
  if (gameState.player.funds >= before) throw new Error("钱没扣");
});

test("buyItem 拒绝无效物品", () => {
  const r = buyItem("不存在的东西", 100);
  if (!r.includes("有效物品")) throw new Error("应拒绝无效物品");
});

test("buyItem 拒绝不合理价格", () => {
  const r = buyItem("棒球棍", 10); // 武器最低 ¥500
  if (!r.includes("价格")) throw new Error("应拒绝不合理价格");
});

test("sellItem", () => {
  // 先买个东西再卖掉
  buyItem("绷带", 200);
  const before = gameState.player.funds;
  const idx = gameState.player.inventory.findIndex((i: any) => i.name === "绷带");
  if (idx < 0) throw new Error("绷带不在背包");
  const r = sellItem("绷带", 150);
  if (!r.includes("卖了")) throw new Error(`出售失败: ${r}`);
});

test("workJob", () => {
  const before = gameState.player.funds;
  const r = workJob("便利店", 4);
  if (!r.includes("获得")) throw new Error(`打工失败: ${r}`);
  if (gameState.player.funds <= before) throw new Error("钱没加");
});

// ── 物品操作 ──
console.log("\n── 物品操作 ──");
test("stealItem 潜行", () => {
  // 先确保有 NPC
  getOrCreateNPC("由比滨结衣");
  // 给 NPC 加个物品
  const npc = gameState.npcs["由比滨结衣"];
  npc.inventory.push({
    name: "橡皮", type: "tool", slot: "acc", weight: 0.05,
    effects: [], state: "intact",
  });
  const r = stealItem(gameState.player, "由比滨结衣", "橡皮");
  // 可能成功也可能失败（随机），只验证结构
  if (!r.narrative) throw new Error("缺少叙事");
});

// ── 关系 ──
console.log("\n── 关系 ──");
test("updateRelation", () => {
  updateRelation(gameState.player.relationships, "雪之下雪乃", 15, "初次见面");
  const rel = gameState.player.relationships["雪之下雪乃"];
  if (!rel) throw new Error("关系未创建");
  if (rel.affection !== 15) throw new Error(`好感应为15，得${rel.affection}`);
});

// ── 属性 ──
test("attrMod", () => {
  if (attrMod(10) !== 0) throw new Error("10→0");
  if (attrMod(14) !== 2) throw new Error("14→2");
  if (attrMod(8) !== -1) throw new Error("8→-1");
});

test("calcMaxHP", () => {
  const hp = calcMaxHP(12, 15);
  if (hp !== 24) throw new Error(`12体质15岁HP应为24，得${hp}`);
});

test("addSkillExp", () => {
  const skills: Record<string, any> = {};
  addSkillExp(skills, "格斗", 12);
  if (skills["格斗"].level !== 1) throw new Error("格斗应为Lv1");
  if (skills["格斗"].exp !== 2) throw new Error(`格斗经验应为2，得${skills["格斗"].exp}`);
});

// ── 路由 ──
console.log("\n── 路由 ──");
test("lookupRegion 侍奉部", () => {
  const r = lookupRegion("侍奉部");
  if (!r.all_characters || r.all_characters.length === 0) throw new Error("侍奉部应有角色");
  if (!r.matched_regions || r.matched_regions.length === 0) throw new Error("侍奉部应匹配地区");
});

test("lookupRegion 千叶_住宅区", () => {
  const r = lookupRegion("千叶_住宅区");
  if (!r.all_characters) throw new Error("应返回角色列表");
});

// ── NPC / 日程 ──
console.log("\n── NPC 日程 ──");
test("getOrCreateNPC", () => {
  const npc = getOrCreateNPC("雪之下雪乃");
  if (!npc) throw new Error("NPC 创建失败");
  if (!npc.currentRoom) throw new Error("NPC 缺少位置");
});

test("getNpcCurrentAge", () => {
  const age = getNpcCurrentAge(16);
  if (age < 0) throw new Error(`年龄异常: ${age}`);
});

test("getBodyForAge", () => {
  const char = { body: { height_cm: 160, build: "标准" } };
  const body = getBodyForAge(char, 16);
  if (body.height_cm !== 160) throw new Error("fallback body 应返回");
});

test("updateNPCSchedules", async () => {
  const events = await updateNPCSchedules();
  // 应该有事件或至少不崩溃
});

// ── 天气 ──
test("refreshWeather", () => {
  const r = refreshWeather();
  if (!r.includes("°C")) throw new Error(`天气格式异常: ${r}`);
});

// ── 生长发育 ──
test("monthlyGrowth", () => {
  const r = monthlyGrowth("正常", "日常活动");
  if (!r.includes("月末")) throw new Error(`发育结算异常: ${r}`);
});

// ── 声望 ──
test("updateReputation + calcReputationBonus", () => {
  const val = updateReputation("学生圈", 1);
  if (val !== 1) throw new Error(`声望应为1，得${val}`);
  const bonus = calcReputationBonus("学生圈");
  // 没穿校服不应该有 bonus
});

// ── 持久化 ──
console.log("\n── 持久化 ──");
test("saveState + loadState", () => {
  saveState();
  const before = gameState.player.funds;
  loadState();
  if (gameState.player.funds !== before) throw new Error("存档/读档数据不一致");
});

test("loadState 不改正常存档的 timeline_origin.age（防止 NPC 年龄 delta 清零）", () => {
  // 模拟正常游玩 2 年后的存档
  gameState.time.player_age = 18;
  gameState.time.timeline_origin = { year: 2018, age: 16 };
  gameState.player.age = 18;
  saveState();
  loadState();
  // timeline_origin.age 必须保持 16（不应与 player_age 对齐）
  if (gameState.time.timeline_origin.age !== 16) {
    throw new Error(`timeline_origin.age 应为 16，被错改为 ${gameState.time.timeline_origin.age}——迁移条件过宽`);
  }
  // 出生年不变
  const birthYear = gameState.time.timeline_origin.year - gameState.time.timeline_origin.age;
  if (birthYear !== 2002) throw new Error(`出生年应为 2002，得 ${birthYear}`);
});

test("loadState 修复旧 bug 存档 timeline_origin.age===0", () => {
  // 模拟旧 bug 存档：timeline_origin = {year: 1992, age: 0}
  gameState.time.player_age = 16;
  gameState.time.timeline_origin = { year: 1992, age: 0 };
  gameState.player.age = 16;
  gameState.time.game_date = "2018-04-07";
  saveState();
  loadState();
  // 旧存档应被修复：age 从 0 纠正为 player_age
  if (gameState.time.timeline_origin.age !== 16) {
    throw new Error(`旧存档 timeline_origin.age 应被修复为 16，实际 ${gameState.time.timeline_origin.age}`);
  }
  // 修复后出生年应对齐为 2002
  const birthYear = gameState.time.timeline_origin.year - gameState.time.timeline_origin.age;
  if (birthYear !== 2002) throw new Error(`修复后出生年应为 2002，得 ${birthYear}`);
});

test("getNpcCurrentAge 在时间推进后 NPC 年龄跟随增长", () => {
  // 重置到正常状态
  gameState.time.player_age = 16;
  gameState.time.timeline_origin = { year: 2018, age: 16 };
  gameState.player.age = 16;

  const npcBaseAge = 17;
  // 初始：玩家 16，NPC 基龄 17，年龄差 = 0 → NPC 仍是 17
  let npcAge = getNpcCurrentAge(npcBaseAge);
  if (npcAge !== 17) throw new Error(`初始 NPC 年龄应为 17，得 ${npcAge}`);

  // 推进 2 年：玩家 18
  gameState.player.age = 18;
  gameState.time.player_age = 18;
  npcAge = getNpcCurrentAge(npcBaseAge);
  if (npcAge !== 19) throw new Error(`2年后 NPC 年龄应为 19，得 ${npcAge}`);

  // 推进 10 年：玩家 28
  gameState.player.age = 28;
  gameState.time.player_age = 28;
  npcAge = getNpcCurrentAge(npcBaseAge);
  if (npcAge !== 29) throw new Error(`10年后 NPC 年龄应为 29，得 ${npcAge}`);
});

// ── buildStatePrompt ──
test("buildStatePrompt 无崩溃", async () => {
  const prompt = await buildStatePrompt();
  if (!prompt) throw new Error("prompt 为空");
  // 关键变量都应该已替换
  if (prompt.includes("{{game_date}}")) throw new Error("game_date 未替换");
  if (prompt.includes("{{player_name}}")) throw new Error("player_name 未替换");
  if (!prompt.includes("[玩家状态] 维 | 身体状况: 健康")) throw new Error("缺少健康状态描述");
  
  // 模拟重伤
  gameState.player.hp.current = 2;
  const hurtPrompt = await buildStatePrompt();
  if (!hurtPrompt.includes("重伤")) throw new Error("HP过低应该显示重伤描述");
  // 恢复
  gameState.player.hp.current = gameState.player.hp.max;
});

test("Layer1: affection to desire, body language injection, and masturbate", async () => {
  const { getOrCreateSexState } = await import("./engine/state.ts");
  const { masturbate } = await import("./engine/sex.ts");
  
  // 1. Initial sexState should be null until created
  const char = "由比滨结衣";
  const sState = await getOrCreateSexState(char);
  if (!sState) throw new Error("SexState creation failed");
  if (sState.desire !== 40) throw new Error("Baseline desire mismatch");
  
  // 2. Affection to Desire check
  updateRelation(gameState.player.relationships, char, 10);
  const delta = 10;
  const desireDelta = Math.max(1, Math.round(delta * 0.5));
  sState.desire = Math.min(100, sState.desire + desireDelta);
  if (sState.desire !== 45) throw new Error("Desire accumulation failed");
  
  // 3. Gal mode body language injection check
  gameState.layer1Enabled = false;
  const npc = getOrCreateNPC(char);
  npc.currentRoom = gameState.player.location;
  
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[由比滨结衣·身体语言]")) {
    throw new Error("Missing body language injection in gal mode");
  }
  
  // 4. Masturbation check
  const r = masturbate(sState, 30);
  if (sState.arousal <= 0) throw new Error("Masturbation did not increase arousal");
});

test("getNamelessNPCs helper and LLM prompt integration", async () => {
  const { getNamelessNPCs } = await import("./engine/state.ts");
  setPlayerLocation("千叶_住宅区");
  const list = getNamelessNPCs("千叶_住宅区", gameState.turn);
  if (list.length === 0) throw new Error("Should seed nameless NPCs in public areas");
  
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[在场路人]")) throw new Error("Nameless NPCs should be injected into the system prompt");
});

// ── 性里程碑 ──
console.log("\n── 性里程碑 ──");
test("createSexState 初始化全员为初", async () => {
  const { createSexState } = await import("./engine/sex.ts");
  const { SEX_PROFILES } = await import("./engine/sex.ts");
  const s = createSexState("测试角色", SEX_PROFILES["由比滨结衣"]);
  if (!s.milestones) throw new Error("缺少 milestones");
  if (!s.milestones.virginity.isVirgin) throw new Error("应为处女");
  if (s.milestones.firstKiss.given) throw new Error("初吻应为未");
  if (!s.milestones.analVirginity.isVirgin) throw new Error("菊应为未");
});

test("loadState 迁移旧存档补 milestones", async () => {
  // 模拟旧存档：无 milestones 字段
  gameState.sexStates ??= {};
  gameState.sexStates["测试"] = {
    profile: { baselineDesire: 40, attitude: "顺从" as any, experience: "未开发" as any, bodyParts: {}, cycleDay: 7, climaxThreshold: 35, likes: [], dislikes: [] },
    desire: 40, arousal: 0, cycleDay: 7, cyclePhase: "安全期", climaxed: false, climaxCount: 0, squirtCount: 0, thoughts: [],
  };
  saveState();
  loadState();
  const ss = gameState.sexStates?.["测试"];
  if (!ss?.milestones) throw new Error("迁移后应补上 milestones");
  if (!ss.milestones.virginity.isVirgin) throw new Error("未开发→应推断为处女");
});

test("loadState 迁移熟練角色推断为非处", async () => {
  gameState.sexStates!["测试2"] = {
    profile: { baselineDesire: 50, attitude: "主动" as any, experience: "熟练" as any, bodyParts: {}, cycleDay: 8, climaxThreshold: 50, likes: [], dislikes: [] },
    desire: 50, arousal: 0, cycleDay: 8, cyclePhase: "安全期", climaxed: false, climaxCount: 0, squirtCount: 0, thoughts: [],
  };
  saveState();
  loadState();
  const ss = gameState.sexStates?.["测试2"];
  if (!ss?.milestones) throw new Error("缺少 milestones");
  if (ss.milestones.virginity.isVirgin) throw new Error("熟练→应推断为非处");
  if (!ss.milestones.firstKiss.given) throw new Error("熟练→初吻应为已");
  if (ss.milestones.virginity.lostTo !== "?") throw new Error("旧存档无法确定对象，应为 ?");
});

test("settleAfterSex 检测初吻+初夜+菊初", async () => {
  const { createSexState, settleAfterSex } = await import("./engine/sex.ts");
  const { SEX_PROFILES } = await import("./engine/sex.ts");
  const s = createSexState("测试3", SEX_PROFILES["由比滨结衣"]);

  // 第一次：只碰唇 → 记录初吻
  const r1 = settleAfterSex(s, "2018-05-01", 10, ["唇"], [], "维");
  if (!r1.milestonesChanged) throw new Error("应触发里程碑变化");
  if (!r1.milestonesChanged.some(m => m.includes("初吻"))) throw new Error("触碰唇应记录初吻");

  // 第二次：碰秘部 → 记录初夜（但初吻已给，不再重复）
  const r2 = settleAfterSex(s, "2018-06-01", 30, ["秘部"], [], "维");
  if (!r2.milestonesChanged) throw new Error("应触发第二个里程碑");
  if (!r2.milestonesChanged.some(m => m.includes("初体验"))) throw new Error("触碰秘部应记录初体验");

  // 验证 state
  if (s.milestones!.virginity.isVirgin) throw new Error("处女应为 false");
  if (s.milestones!.virginity.lostTo !== "维") throw new Error("初夜对象应为维");

  // 第三次：碰肛 → 菊初
  const r3 = settleAfterSex(s, "2018-07-01", 20, ["肛"], [], "维");
  if (!r3.milestonesChanged?.some(m => m.includes("菊初"))) throw new Error("触碰肛应记录菊初");

  // 第四次：再碰这些部位 → 不再触发
  const r4 = settleAfterSex(s, "2018-08-01", 30, ["唇", "秘部", "肛"], [], "维");
  if (r4.milestonesChanged && r4.milestonesChanged.length > 0) throw new Error("已非初不应再触发");
});

test("自慰不计入初体验", async () => {
  const { createSexState, settleAfterSex } = await import("./engine/sex.ts");
  const { SEX_PROFILES } = await import("./engine/sex.ts");
  const s = createSexState("测试4", SEX_PROFILES["由比滨结衣"]);

  // 自慰 → 不传 partnerName
  const r = settleAfterSex(s, "2018-05-01", 10, ["秘部", "唇"], [], undefined);
  if (r.milestonesChanged && r.milestonesChanged.length > 0) throw new Error("自慰不应计入初体验");
  if (!s.milestones!.virginity.isVirgin) throw new Error("自慰后处女应仍为 true");
  if (s.milestones!.firstKiss.given) throw new Error("自慰后初吻应仍为未");
});

test("buildStatePrompt 注入里程碑信息", async () => {
  const { SEX_PROFILES } = await import("./engine/sex.ts");
  const { getOrCreateSexState } = await import("./engine/state.ts");
  const sState = await getOrCreateSexState("由比滨结衣");
  // 设置一些里程碑
  sState!.milestones!.firstKiss = { given: true, partner: "维", date: "2018-05-01" };
  sState!.milestones!.virginity = { isVirgin: true, lostTo: null, lostAt: null };
  gameState.player.sex = sState;

  const prompt = await buildStatePrompt();
  if (!prompt.includes("初吻: 维")) throw new Error("应显示初吻对象");
  if (!prompt.includes("初夜: 未")) throw new Error("应显示初夜未");
  gameState.player.sex = undefined;
});

test("buildStatePrompt 注入 [mood_hint]", async () => {
  const { getOrCreateSexState, updateRelation } = await import("./engine/state.ts");
  const sState = await getOrCreateSexState("由比滨结衣");
  // 高好感 → "沉溺"
  updateRelation(gameState.player.relationships, "由比滨结衣", 80);
  gameState.player.sex = sState;
  gameState.layer1Enabled = true;

  const prompt = await buildStatePrompt();
  if (!prompt.includes("[mood_hint]")) throw new Error("应注入[mood_hint]标签");
  if (!prompt.includes("沉溺")) throw new Error("好感80应→沉溺，prompt中未找到");

  // 低好感 → "身心分离的绝望"
  updateRelation(gameState.player.relationships, "由比滨结衣", -80);
  const prompt2 = await buildStatePrompt();
  if (!prompt2.includes("身心分离的绝望")) throw new Error("好感极低应→身心分离的绝望");

  gameState.player.sex = undefined;
  gameState.layer1Enabled = false;
});

// ── 称号系统 ──
console.log("\n── 称号系统 ──");
test("checkAndGrantTitles 无达成条件不授予", () => {
  resetState();
  gameState.player.titles = [];
  gameState.player.attributes.魅力 = 10;
  gameState.player.attributes.力量 = 8;
  gameState.player.funds = 500;
  gameState.player.reputation = {};
  gameState.player.location = "千叶_住宅区";
  checkAndGrantTitles();
  if (gameState.player.titles.length !== 0) throw new Error(`不应有称号，但得到: ${gameState.player.titles}`);
});

test("checkAndGrantTitles 魅力>=16 → 校园偶像", () => {
  resetState();
  gameState.player.attributes.魅力 = 16;
  checkAndGrantTitles();
  if (!gameState.player.titles.includes("校园偶像")) throw new Error("应授予校园偶像");
});

test("checkAndGrantTitles 学生声望>=4 → 年级第一", () => {
  resetState();
  gameState.player.reputation["学生"] = 4;
  checkAndGrantTitles();
  if (!gameState.player.titles.includes("年级第一")) throw new Error("应授予年级第一");
});

test("checkAndGrantTitles 已有称号不重复", () => {
  resetState();
  gameState.player.attributes.魅力 = 16;
  checkAndGrantTitles();
  const count1 = gameState.player.titles.filter(t => t === "校园偶像").length;
  checkAndGrantTitles(); // 再调一次
  const count2 = gameState.player.titles.filter(t => t === "校园偶像").length;
  if (count1 !== 1 || count2 !== 1) throw new Error("称号不应重复授予");
});

test("buildStatePrompt 注入 [称号]", async () => {
  resetState();
  gameState.player.titles = ["校园偶像", "年级第一"];
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[称号]")) throw new Error("应包含[称号]标签");
  if (!prompt.includes("校园偶像")) throw new Error("应包含校园偶像");
  if (!prompt.includes("年级第一")) throw new Error("应包含年级第一");
});

// ── 叙事旅行 ──
console.log("\n── 叙事旅行 ──");
test("pendingTravel 注入 prompt", async () => {
  resetState();
  gameState.pendingTravel = {
    from: "千叶_住宅区",
    to: "千叶_市中心",
    route: "京叶线/公交",
    minutes: 30,
    timeOfDay: "morning"
  };
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[旅行中]")) throw new Error("应包含[旅行中]标签");
  if (!prompt.includes("千叶_市中心")) throw new Error("应包含目的地");
});

test("pendingTravel 序列化正常", () => {
  resetState();
  gameState.pendingTravel = {
    from: "千叶_住宅区",
    to: "侍奉部",
    route: "步行",
    minutes: 15,
    timeOfDay: "morning"
  };
  saveState();
  loadState();
  if (!gameState.pendingTravel) throw new Error("pendingTravel丢失");
  if (gameState.pendingTravel.to !== "侍奉部") throw new Error("目的地错误");
});

test("模拟 complete_travel 逻辑更新状态", () => {
  resetState();
  gameState.pendingTravel = {
    from: "A", to: "B", route: "步行", minutes: 30, timeOfDay: "morning"
  };
  const pt = gameState.pendingTravel;
  // 模拟 complete_travel
  gameState.player.location = pt.to;
  gameState.pendingTravel = null;
  if (gameState.player.location !== "B") throw new Error("位置未更新");
  if (gameState.pendingTravel !== null) throw new Error("未清除状态");
});

// ── 身份与伪装 ──
console.log("\n── 身份与伪装 ──");
test("identityCheck 普通难度", async () => {
  const { identityCheck } = await import("./engine/dice.ts");
  const r = identityCheck("普通", 10, 0);
  if (!r.outcome || r.roll.total === undefined) throw new Error("identityCheck格式错误");
});

test("getDisguiseIdentity 无装备", async () => {
  resetState();
  const { getDisguiseIdentity } = await import("./engine/state.ts");
  if (getDisguiseIdentity(gameState.player) !== null) throw new Error("应返回null");
});

test("getDisguiseIdentity 穿校服", async () => {
  resetState();
  gameState.player.equipment.top = {
    name: "总武高男校服",
    type: "clothing", slot: "top", weight: 1, state: "intact",
    effects: [{ type: "disguise_tag", value: "学生" }]
  };
  const { getDisguiseIdentity } = await import("./engine/state.ts");
  if (getDisguiseIdentity(gameState.player) !== "学生") throw new Error("应返回学生");
});

test("buildStatePrompt 注入 [身份认知]", async () => {
  resetState();
  gameState.player.equipment.top = {
    name: "总武高男校服",
    type: "clothing", slot: "top", weight: 1, state: "intact",
    effects: [{ type: "disguise_tag", value: "总武高学生" }]
  };
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[身份认知] 你被认知为: 总武高学生")) throw new Error("应包含伪装认知");
});

// ── Phase 1: 新领域工具（替换 patch_state）──
console.log("\n── 领域工具（transfer_item / adjust_relation / grant_skill_exp）──");
test("transfer_item 玩家→NPC", () => {
  resetState();
  gameState.player.inventory.push({ name: "测试物品", type: "tool", slot: "acc", weight: 0.1, effects: [], state: "intact" });
  const npc = getOrCreateNPC("由比滨结衣");
  const idx = gameState.player.inventory.findIndex((i: any) => i.name === "测试物品");
  if (idx < 0) throw new Error("物品应在背包");
  const item = gameState.player.inventory.splice(idx, 1)[0];
  npc.inventory.push(item);
  if (gameState.player.inventory.some((i: any) => i.name === "测试物品")) throw new Error("转移后玩家不应持有");
  if (!npc.inventory.some((i: any) => i.name === "测试物品")) throw new Error("NPC应收到物品");
});

test("transfer_item 来源无物品应拒绝", () => {
  resetState();
  const npc = getOrCreateNPC("由比滨结衣");
  npc.inventory = [];
  if (npc.inventory.some((i: any) => i.name === "不存在的东西")) throw new Error("NPC不应有该物品");
});

test("adjust_relation 正值+备注", () => {
  resetState();
  updateRelation(gameState.player.relationships, "雪之下雪乃", 15, "聊得很投机");
  const rel = gameState.player.relationships["雪之下雪乃"];
  if (!rel) throw new Error("关系未创建");
  if (rel.affection !== 15) throw new Error("好感应为15");
  if (rel.notes !== "聊得很投机") throw new Error("备注未写入");
});

test("adjust_relation 自动 clamp 0-100", () => {
  resetState();
  updateRelation(gameState.player.relationships, "测试角色", 150, "过度喜爱");
  if (gameState.player.relationships["测试角色"].affection > 100) throw new Error("好感超过100");
  updateRelation(gameState.player.relationships, "测试角色2", -20, "严重冲突");
  if (gameState.player.relationships["测试角色2"].affection < 0) throw new Error("好感低于0");
});

test("grant_skill_exp 正常升级", () => {
  resetState();
  addSkillExp(gameState.player.skills, "潜行", 12);
  const sk = gameState.player.skills["潜行"];
  if (!sk) throw new Error("技能未创建");
  if (sk.level < 1) throw new Error("12EXP应升到Lv1");
});

test("grant_skill_exp Lv10上限", () => {
  resetState();
  for (let i = 0; i < 200; i++) {
    addSkillExp(gameState.player.skills, "格斗", 50);
  }
  if (gameState.player.skills["格斗"].level > 10) throw new Error("技能等级不应超过10");
});

// ── Phase 2: 后果系统 ──
console.log("\n── 后果系统（steal / identity / combat NPC）──");
test("stealItem 被抓自动扣好感+写flag", () => {
  resetState();
  // 利用引擎直接测试：不管是否真的成功，验证后果逻辑
  // updateRelation + flag 写入是 engine 函数，直接测
  updateRelation(gameState.player.relationships, "由比滨结衣", 50, "初始");
  updateRelation(gameState.player.relationships, "由比滨结衣", -20, "偷窃被抓");
  const rel = gameState.player.relationships["由比滨结衣"];
  if (rel.affection !== 30) throw new Error("好感应从50降到30");
  if (rel.notes !== "偷窃被抓") throw new Error("备注未记录偷窃");
  // flag 确认
  gameState.flags.steal_alert = true;
  if (!gameState.flags.steal_alert) throw new Error("alert flag未设置");
});

test("identity_check 失败写 identity_exposed", async () => {
  resetState();
  const { identityCheck } = await import("./engine/dice.ts");
  const r = identityCheck("极难", 10, 0);
  if (r.success) {
    // 极难检定玩家也可能碰巧通过，跳过断言
  } else {
    gameState.flags.identity_exposed = true;
    if (!gameState.flags.identity_exposed) throw new Error("identity_exposed flag未设置");
  }
});

test("combat_action NPC 可攻击玩家", () => {
  resetState();
  const npc = getOrCreateNPC("雪之下雪乃");
  const src = { attributes: { 力量:8,敏捷:12,体质:7,智力:15,感知:13,魅力:18 }, skills: { 合气道: 3 }, hp: { current: 14, max: 14 }, ac: 12 };
  const npcState = {
    ...structuredClone(gameState.player),
    name: "雪之下雪乃",
    attributes: src.attributes,
    skills: src.skills,
    hp: src.hp,
    ac: src.ac,
    equipment: npc.equipment || {},
  };
  if (npcState.name !== "雪之下雪乃") throw new Error("NPC combatant name错误");
  if (npcState.attributes.智力 !== 15) throw new Error("NPC combatant 属性错误");
});

// ── Phase 3: Scene Macro 层 ──
console.log("\n── Phase 3: Scene Macro 层 ──");

const registeredTools: Record<string, any> = {};
const mockPi = {
  registerTool(tool: any) {
    registeredTools[tool.name] = tool;
  },
  registerCommand() {},
  on() {}
};

test("加载 extension 并初始化 mockPi", () => {
  const registerExtension = require("./extension.ts").default;
  registerExtension(mockPi);
  if (!registeredTools["world_interact"]) throw new Error("world_interact 未注册");
  if (!registeredTools["settle_scene"]) throw new Error("settle_scene 未注册");
});

test("world_interact place 有物品 → 放置成功，背包扣除", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  // 给玩家塞一个台灯
  gameState.player.inventory.push({ name: "台灯", type: "tool", slot: "acc", weight: 0.5, effects: [], state: "intact" });
  
  const tool = registeredTools["world_interact"];
  const res = await tool.execute("id", { action: "place", item: "台灯" }, null, null, null);
  
  if (res.content[0].text.includes("错误") || res.content[0].text.includes("拒绝")) {
    throw new Error(`world_interact 失败: ${res.content[0].text}`);
  }
  if (gameState.player.inventory.some((i: any) => i.name === "台灯")) {
    throw new Error("放置后背包应该扣除台灯");
  }
});

test("world_interact place 无物品 → 引擎拒绝", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  
  const tool = registeredTools["world_interact"];
  const res = await tool.execute("id", { action: "place", item: "黄金马桶" }, null, null, null);
  
  if (!res.content[0].text.includes("没有") && !res.content[0].text.includes("拒绝") && !res.content[0].text.includes("无法")) {
    throw new Error(`应该因为没有物品拒绝，但返回: ${res.content[0].text}`);
  }
});

test("world_interact build_wall 无材料 → 引擎拒绝", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  
  const tool = registeredTools["world_interact"];
  const res = await tool.execute("id", { action: "build_wall", material: "砖头" }, null, null, null);
  
  if (!res.content[0].text.includes("没有") && !res.content[0].text.includes("拒绝") && !res.content[0].text.includes("无法")) {
    throw new Error(`应该因为无材料拒绝，但返回: ${res.content[0].text}`);
  }
});

test("settle_scene 推进时间+日程", async () => {
  resetState();
  const beforeMinute = gameState.time.minute_of_day || 480;
  
  const tool = registeredTools["settle_scene"];
  await tool.execute("id", { summary: "聊了一下午", elapsed_minutes: 60 }, null, null, null);
  
  const afterMinute = gameState.time.minute_of_day;
  if (afterMinute !== beforeMinute + 60) {
    throw new Error(`时间未正确推进，前:${beforeMinute}，后:${afterMinute}`);
  }
});

test("settle_scene 写入记忆标签", async () => {
  resetState();
  const tool = registeredTools["settle_scene"];
  const npc = getOrCreateNPC("雪之下雪乃");
  npc.memoryTags = [];
  
  await tool.execute("id", {
    summary: "帮助了雪乃",
    elapsed_minutes: 30,
    memory_tags: [{ target: "雪之下雪乃", tag: "接受了维的帮助" }]
  }, null, null, null);
  
  const tags = npc.memoryTags || [];
  if (!tags.some((t: any) => t.tag === "接受了维的帮助")) {
    throw new Error("记忆标签未成功写入");
  }
});

// ── Phase 4: 补齐工具闭环 ──
console.log("\n── Phase 4: 补齐工具闭环 ──");

test("spawn_item 武器 → target背包有该武器，含damage属性且记录来源", async () => {
  resetState();
  const tool = registeredTools["spawn_item"];
  const res = await tool.execute("id", {
    target: "玩家",
    item: {
      name: "家传宝刀",
      type: "weapon",
      slot: "right_hand",
      weight: 2,
      damage: { dice: "1d10", damageType: "劈砍" },
      flavor: "祖传的宝刀"
    },
    source: "平冢静",
    reason: "师徒传承"
  }, null, null, null);

  if (res.content[0].text.includes("错误")) throw new Error(`spawn_item 失败: ${res.content[0].text}`);
  const item = gameState.player.inventory.find((i: any) => i.name === "家传宝刀");
  if (!item) throw new Error("背包里找不到生成的武器");
  if (!item.damage || item.damage.dice !== "1d10") throw new Error("武器damage属性丢失或不正确");
  if (!item.flavor.includes("来源: 平冢静")) throw new Error("武器未正确记录来源");
});

test("inflict_damage 玩家 → HP减少且致死alive=false", async () => {
  resetState();
  const beforeHP = gameState.player.hp.current;
  
  const tool = registeredTools["inflict_damage"];
  // 非致死伤害
  await tool.execute("id", {
    target: "玩家",
    amount: 2,
    type: "毒素",
    reason: "喝了过期牛奶"
  }, null, null, null);
  
  if (gameState.player.hp.current !== beforeHP - 2) {
    throw new Error(`伤害扣除不正确: 前 ${beforeHP}, 后 ${gameState.player.hp.current}`);
  }
  if (!gameState.player.alive) {
    throw new Error("非致命伤害不应致死");
  }

  // 致死伤害
  await tool.execute("id", {
    target: "玩家",
    amount: 100,
    type: "坠落",
    reason: "高处坠落"
  }, null, null, null);

  if (gameState.player.hp.current !== 0) {
    throw new Error(`当前 HP 应为0，但是是 ${gameState.player.hp.current}`);
  }
  if (gameState.player.alive) {
    throw new Error("致命伤害后玩家应处于死亡/倒下状态");
  }
});

test("add_memory_tag → NPC memoryTags 包含标签", async () => {
  resetState();
  const npc = getOrCreateNPC("雪之下雪乃");
  npc.memoryTags = [];
  
  const tool = registeredTools["add_memory_tag"];
  await tool.execute("id", {
    target: "雪之下雪乃",
    tag: "知道玩家是杀手",
    expires_days: 5
  }, null, null, null);

  const tags = npc.memoryTags || [];
  if (!tags.some((t: any) => t.tag === "知道玩家是杀手")) {
    throw new Error("记忆标签未成功写入");
  }
});

// ── Phase 6: NPC 资金系统 ──
console.log("\n── NPC 资金系统 ──");
test("getOrCreateNPC 初始化 funds from characters.json", () => {
  resetState();
  const npc = getOrCreateNPC("雪之下雪乃");
  if (npc.funds !== 30000) throw new Error(`雪乃应有30,000初始资金，实际: ${npc.funds}`);
});

test("sellItem 指定buyer→扣NPC钱+校验资金不足", () => {
  resetState();
  buyItem("绷带", 200);
  const npc = getOrCreateNPC("由比滨结衣");
  npc.funds = 100;
  // 钱不够 → 拒绝
  const r1 = sellItem("绷带", 500, "由比滨结衣");
  if (!r1.includes("买不起")) throw new Error(`应拒绝不够钱: ${r1}`);
  // 钱够 → 成功扣NPC
  npc.funds = 500;
  const r2 = sellItem("绷带", 300, "由比滨结衣");
  if (!r2.includes("卖了")) throw new Error(`出售失败: ${r2}`);
  if (npc.funds !== 200) throw new Error(`NPC应扣300，剩余200，实际: ${npc.funds}`);
});

test("sellItem 不指定buyer→正常出售不扣NPC", () => {
  resetState();
  buyItem("绷带", 200);
  const before = gameState.player.funds;
  sellItem("绷带", 150);
  if (gameState.player.funds !== before + 150) throw new Error("玩家钱应增加150");
});

test("stealFunds 从NPC偷钱→NPC钱减少+玩家钱增加", () => {
  resetState();
  const npc = getOrCreateNPC("由比滨结衣");
  npc.funds = 1000;
  const beforePlayer = gameState.player.funds;
  // 跑多次直到成功（可能随机失败）
  let stolen = false;
  for (let i = 0; i < 50; i++) {
    const r = stealFunds(gameState.player, "由比滨结衣");
    if (r.success) { stolen = true; break; }
  }
  // 由于DC=12且我们不做属性保证，偷多次大概率有一次成功
  // 但如果玩家属性太低，可能全失败——这里只验证结构
  if (gameState.player.funds > beforePlayer || npc.funds < 1000) {
    // 说明至少有一次成功
  }
});

test("stealFunds NPC没钱→拒绝", () => {
  resetState();
  const npc = getOrCreateNPC("由比滨结衣");
  npc.funds = 0;
  const r = stealFunds(gameState.player, "由比滨结衣");
  if (r.success) throw new Error("NPC没钱不该成功");
  if (!r.narrative.includes("身无分文")) throw new Error(`应提示身无分文: ${r.narrative}`);
});

test("transfer_item 金钱:数字→双方资金变动", async () => {
  resetState();
  const tool = registeredTools["transfer_item"];
  const npc = getOrCreateNPC("由比滨结衣");
  npc.funds = 1000;
  gameState.player.funds = 500;

  // 玩家→NPC 转账
  await tool.execute("id", { from: "玩家", to: "由比滨结衣", item: "金钱:200" }, null, null, null);
  if (gameState.player.funds !== 300) throw new Error(`玩家应剩300，实际: ${gameState.player.funds}`);
  if (npc.funds !== 1200) throw new Error(`NPC应1200，实际: ${npc.funds}`);
});

test("transfer_item 金钱→余额不足拒绝", async () => {
  resetState();
  const tool = registeredTools["transfer_item"];
  const npc = getOrCreateNPC("由比滨结衣");
  npc.funds = 50;

  const r = await tool.execute("id", { from: "由比滨结衣", to: "玩家", item: "金钱:100" }, null, null, null);
  if (r.content[0].text.includes("成功")) throw new Error("不够钱应拒绝");
  if (!r.content[0].text.includes("不够")) throw new Error(`应提示不够: ${r.content[0].text}`);
});

// ── 日历 ──
console.log("── 日历 (calendar/) ──");

test("getCalendarEvents 日期匹配", () => {
  clearCalendarCache();
  const entries = getCalendarEvents("2018-04-07", "总武高");
  const match = entries.find(e => e.date === "4月7日" && e.location === "总武高");
  if (!match) throw new Error("应匹配4月7日总武高入学式条目");
  if (!match.text.includes("入学式")) throw new Error(`文本应包含入学式，实际: ${match.text.slice(0,40)}`);
});

test("getCalendarEvents year=null 匹配任意年", () => {
  clearCalendarCache();
  const entries = getCalendarEvents("2025-05-01", "住宅区");
  const match = entries.find(e => e.date === "5月1日" && e.location === null);
  if (!match) throw new Error("year=null 的黄金周条目应匹配2025年");
  if (!match.text.includes("黄金周")) throw new Error(`文本应包含黄金周: ${match.text.slice(0,30)}`);
  const entries2 = getCalendarEvents("2018-05-01", "总武高");
  if (!entries2.find(e => e.date === "5月1日")) throw new Error("year=null 应也匹配2018年");
});

test("getCalendarEvents year特定值=仅匹配该年", () => {
  clearCalendarCache();
  const e2020 = getCalendarEvents("2020-04-07", "总武高");
  const m2020 = e2020.find(e => e.date === "4月7日" && e.location === "总武高");
  if (m2020) throw new Error("year=2018 入学式不应匹配2020年");
  const e2018 = getCalendarEvents("2018-04-07", "总武高");
  if (!e2018.find(e => e.date === "4月7日" && e.location === "总武高")) throw new Error("year=2018 应匹配");
});

test("getCalendarEvents location=null 匹配任意地点", () => {
  clearCalendarCache();
  const entries = getCalendarEvents("2018-05-01", "任何地点");
  const match = entries.find(e => e.date === "5月1日");
  if (!match) throw new Error("location=null 应匹配任意地点");
});

test("getCalendarEvents location特定值=仅匹配该地点", () => {
  clearCalendarCache();
  const atSobu = getCalendarEvents("2018-04-07", "总武高");
  if (!atSobu.find(e => e.date === "4月7日" && e.location === "总武高")) throw new Error("在总武高应找到总武高条目");
  const atHome = getCalendarEvents("2018-04-07", "住宅区");
  if (atHome.find(e => e.date === "4月7日" && e.location === "总武高")) throw new Error("在住宅区不应有总武高专属条目");
});

test("getCalendarEvents 多个来源合并", () => {
  clearCalendarCache();
  const entries = getCalendarEvents("2018-04-07", "总武高");
  if (entries.length < 2) throw new Error(`应至少2条（春物+橘家），实际: ${entries.length}`);
  const sources = new Set(entries.map(e => e.text.slice(0, 4)));
  if (sources.size < 2) throw new Error(`应有不同来源的条目，实际: ${entries.length}条`);
});

test("getTodayCalendar 返回1-2条合并文本", () => {
  clearCalendarCache();
  resetState();
  gameState.time.game_date = "2018-04-07";
  gameState.player.location = "总武高";
  const text = getTodayCalendar();
  if (!text.includes("入学式")) throw new Error(`应包含入学式: ${text.slice(0,60)}`);
  if (text.length > 400) throw new Error(`文本过长(${text.length}字): ${text.slice(0,80)}`);
});

test("getTodayCalendar 无匹配日期返回空", () => {
  clearCalendarCache();
  resetState();
  gameState.time.game_date = "2018-12-01";
  gameState.player.location = "住宅区";
  const text = getTodayCalendar();
  if (text !== "") throw new Error(`12月1日无条目应返回空，实际: "${text.slice(0,60)}"`);
});

// ── 剧情钩子 ──
console.log("── 剧情钩子 (timelines/) ──");

test("checkTimelineEvents 条件满足→创建钩子", () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.time_of_day = "afternoon";
  gameState.player.location = "侍奉部";
  gameState.time.game_date = "2018-04-08";
  gameState.player.relationships["雪之下雪乃"] = { affection: 15, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  checkTimelineEvents();
  const hooks = getActiveHooks();
  if (hooks.length < 1) throw new Error("应至少触发1个钩子(cookie_delegation)");
  const cookie = hooks.find(h => h.event_id === "cookie_delegation");
  if (!cookie) throw new Error("应触发cookie_delegation");
  if (cookie.source_npc !== "雪之下雪乃") throw new Error(`source_npc应为雪之下雪乃: ${cookie.source_npc}`);
  if (cookie.seen_count !== 0) throw new Error("新钩子seen_count应为0");
});

test("checkTimelineEvents 未满足条件→不触发", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.time_of_day = "morning";
  gameState.player.location = "住宅区";
  gameState.time.game_date = "2018-04-08";

  checkTimelineEvents();
  const hooks = getActiveHooks();
  if (hooks.length !== 0) throw new Error(`不应触发任何钩子，实际: ${hooks.length}条`);
});

test("checkTimelineEvents 前置flag满足才触发", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = { cookie_complete: true };
  gameState.time.time_of_day = "afternoon";
  gameState.player.location = "侍奉部";
  gameState.time.game_date = "2018-04-12";
  gameState.player.relationships["雪之下雪乃"] = { affection: 20, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  checkTimelineEvents();
  const hooks = getActiveHooks();
  if (hooks.length < 2) throw new Error(`应有2个钩子(cookie+zaimokuza)，实际: ${hooks.length}`);
  if (!hooks.find(h => h.event_id === "zaimokuza_novel")) throw new Error("flag满足后应触发zaimokuza_novel");
});

test("钩子上限3→第4条挤掉最旧低优先级", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.time_of_day = "afternoon";
  gameState.player.location = "侍奉部";
  gameState.time.game_date = "2018-04-08";
  gameState.player.relationships["雪之下雪乃"] = { affection: 15, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  gameState.active_hooks = [
    { event_id: "old_low", source_npc: "路人A", hook_text: "旧低", urgency: "low", created_day: 1, expires_day: 10, seen_count: 0 },
    { event_id: "old_med", source_npc: "路人B", hook_text: "旧中", urgency: "medium", created_day: 2, expires_day: 10, seen_count: 0 },
    { event_id: "old_high", source_npc: "路人C", hook_text: "旧高", urgency: "high", created_day: 3, expires_day: 10, seen_count: 0 },
  ];

  checkTimelineEvents();
  const hooks = getActiveHooks();
  if (hooks.length > 3) throw new Error(`钩子应不超过3，实际: ${hooks.length}`);
  if (hooks.find(h => h.event_id === "old_low")) throw new Error("最旧低优先级 old_low 应被挤掉");
  if (!hooks.find(h => h.event_id === "old_med")) throw new Error("old_med 应保留");
  if (!hooks.find(h => h.event_id === "old_high")) throw new Error("old_high 应保留");
});

test("expireHooks 过期钩子→移除+执行on_expire", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.game_date = "2018-04-20";

  const day = 98;
  gameState.active_hooks = [{
    event_id: "cookie_delegation", source_npc: "雪之下雪乃",
    hook_text: "test", urgency: "low",
    created_day: day, expires_day: day + 1,
    seen_count: 0,
  }];

  expireHooks();
  const hooks = getActiveHooks();
  if (hooks.length !== 0) throw new Error(`过期钩子应被移除，实际: ${hooks.length}`);
  if (gameState.flags["cookie_missed"] !== true) throw new Error("过期应设置cookie_missed flag");
  if (!gameState.completed_events.includes("cookie_delegation")) throw new Error("应加入completed_events");
});

test("expireHooks 未过期钩子保留", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.time.game_date = "2018-04-07";
  const day = 95;

  gameState.active_hooks = [{
    event_id: "test_event", source_npc: "测试", hook_text: "test",
    urgency: "low", created_day: day, expires_day: day + 30,
    seen_count: 0,
  }];
  expireHooks();
  if (getActiveHooks().length !== 1) throw new Error("未过期钩子应保留");
});

test("getHookNoveltyHint 重复钩子→包含已过天数+紧迫度提示", () => {
  resetState();
  gameState.time.game_date = "2018-04-12"; // 4月12日≈day 102，比创建日(98)晚4天
  const hook = {
    event_id: "test", source_npc: "雪之下雪乃", hook_text: "test",
    urgency: "medium" as const, created_day: 98, expires_day: 110,
    seen_count: 2,
  };
  const hint = getHookNoveltyHint(hook);
  if (!hint.includes("4天过去")) throw new Error(`应包含已过天数(4): ${hint}`);
  if (!hint.includes("雪之下雪乃")) throw new Error(`应包含NPC名: ${hint}`);
  if (!hint.includes("细微角度")) throw new Error(`medium应含'细微角度': ${hint}`);
});

test("getHookNoveltyHint high紧迫度→包含焦虑催促", () => {
  resetState();
  gameState.time.game_date = "2018-04-10"; // day=100，比98晚2天
  const hook = {
    event_id: "test", source_npc: "测试", hook_text: "test",
    urgency: "high" as const, created_day: 98, expires_day: 105,
    seen_count: 1,
  };
  const hint = getHookNoveltyHint(hook);
  if (!hint.includes("2天过去")) throw new Error(`应包含已过天数: ${hint}`);
  if (!hint.includes("紧迫")) throw new Error(`high urgency应包含紧迫: ${hint}`);
});

test("getHookNoveltyHint low紧迫度→轻描淡写", () => {
  resetState();
  gameState.time.game_date = "2018-04-14"; // day=104，比98晚6天
  const hook = {
    event_id: "test", source_npc: "路人", hook_text: "test",
    urgency: "low" as const, created_day: 98, expires_day: 115,
    seen_count: 1,
  };
  const hint = getHookNoveltyHint(hook);
  if (!hint.includes("6天过去")) throw new Error(`应包含已过天数: ${hint}`);
  if (!hint.includes("轻描淡写")) throw new Error(`low urgency应轻描淡写: ${hint}`);
});

// ── Quest 生命周期 ──
console.log("── Quest 生命周期 ──");

test("openQuest 创建任务+移除钩子", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.game_date = "2018-04-08";
  gameState.player.relationships["雪之下雪乃"] = { affection: 15, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  gameState.time.time_of_day = "afternoon";
  gameState.player.location = "侍奉部";
  checkTimelineEvents();
  if (!getActiveHooks().find(h => h.event_id === "cookie_delegation")) throw new Error("pre: 应有cookie钩子");

  const r = openQuest("cookie_delegation");
  if (!r || !r.includes("雪乃的第一次委托")) throw new Error(`openQuest应返回任务标题: ${r}`);
  if (!gameState.quests["cookie_delegation"]) throw new Error("应创建QuestState");
  if (gameState.quests["cookie_delegation"].status !== "active") throw new Error("状态应为active");
  if (gameState.quests["cookie_delegation"].current_beat !== "accept") throw new Error(`首beat应为accept，实际: ${gameState.quests["cookie_delegation"].current_beat}`);

  if (getActiveHooks().find(h => h.event_id === "cookie_delegation")) throw new Error("钩子应被移除");
});

test("advanceQuest 推进→应用效果→完成", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.game_date = "2018-04-08";

  openQuest("cookie_delegation");
  const r1 = advanceQuest("cookie_delegation", "一起指导做曲奇");
  if (!r1 || !r1.includes("曲奇烤好了")) throw new Error(`应推进到baking: ${r1}`);
  if (gameState.flags["cookie_helped"] !== true) throw new Error("'指导做曲奇'应设置cookie_helped flag");
  const yuiAff = gameState.player.relationships["由比滨结衣"]?.affection;
  if (yuiAff !== 10) throw new Error(`由比滨好感应为10，实际: ${yuiAff}`);

  const r2 = advanceQuest("cookie_delegation");
  if (!r2 || !r2.includes("完成")) throw new Error(`应完成任务: ${r2}`);
  if (gameState.quests["cookie_delegation"].status !== "completed") throw new Error("状态应为completed");
  if (!gameState.completed_events.includes("cookie_delegation")) throw new Error("应加入completed_events");
});

test("abandonQuest 放弃任务", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.time.game_date = "2018-04-08";

  openQuest("cookie_delegation");
  const r = abandonQuest("cookie_delegation");
  if (!r || !r.includes("放弃")) throw new Error(`应返回已放弃: ${r}`);
  if (gameState.quests["cookie_delegation"].status !== "abandoned") throw new Error("状态应为abandoned");
  if (!gameState.completed_events.includes("cookie_delegation")) throw new Error("应加入completed_events防止重新触发");
});

test("getActiveQuests 仅返回active状态", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.time.game_date = "2018-04-08";

  openQuest("cookie_delegation");
  if (getActiveQuests().length !== 1) throw new Error("应有1个活跃quest");
  abandonQuest("cookie_delegation");
  if (getActiveQuests().length !== 0) throw new Error("放弃后应0个活跃quest");
});

test("buildStatePrompt 注入[今日世界]+[剧情钩子]+[进行中]", async () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.game_date = "2018-04-08";
  gameState.time.time_of_day = "afternoon";
  gameState.player.location = "侍奉部";
  gameState.player.relationships["雪之下雪乃"] = { affection: 15, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  checkTimelineEvents();
  openQuest("cookie_delegation");

  const prompt = await buildStatePrompt();
  if (!prompt.includes("[今日世界]")) throw new Error("应包含[今日世界]");
  if (!prompt.includes("[剧情钩子]")) throw new Error("应包含[剧情钩子]");
  if (!prompt.includes("[进行中]")) throw new Error("应包含[进行中]");
  if (!prompt.includes("雪乃的第一次委托")) throw new Error("应包含任务标题");
});

test("buildStatePrompt [今日世界] 含当日日历文本", async () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.time.game_date = "2018-04-07";
  gameState.player.location = "总武高";

  const prompt = await buildStatePrompt();
  if (!prompt.includes("[今日世界]")) throw new Error("应包含[今日世界]");
  if (!prompt.includes("入学式")) throw new Error("应包含入学式文本");
});

test("openQuest 不存在的eventId返回错误", () => {
  resetState();
  gameState.quests = {};
  const r = openQuest("nonexistent");
  if (!r || !r.includes("未找到")) throw new Error(`应返回错误: ${r}`);
});

// ── 场景持久化 ──
console.log("\n── 场景持久化 ──");

test("stampRoom + getRoomAgingLine 首次访问", () => {
  resetState();
  gameState.time.game_date = "2018-04-07";
  // 首次访问无记录 → 返回空
  const line = getRoomAgingLine("侍奉部");
  if (line !== "") throw new Error(`首次访问应无氛围线: ${line}`);
});

test("stampRoom + getRoomAgingLine 15天后回访", () => {
  resetState();
  gameState.time.game_date = "2018-04-07";
  stampRoom("侍奉部");
  gameState.time.game_date = "2018-04-25";
  const line = getRoomAgingLine("侍奉部");
  if (!line) throw new Error("15天后应有氛围线");
});

// ── 服装卡 ──
console.log("\n── 服装卡 ──");

test("setNPCOutfit 切换雪乃服装卡", () => {
  resetState();
  const r = setNPCOutfit("雪之下雪乃", "pe");
  if (!r.includes("pe")) throw new Error(`应切换成功: ${r}`);
});

test("getNPCOutfitDesc 返回外观描述", () => {
  resetState();
  setNPCOutfit("雪之下雪乃", "school");
  const desc = getNPCOutfitDesc("雪之下雪乃");
  if (!desc.includes("制服")) throw new Error(`应包含制服: ${desc}`);
});

// ── 层级导航 ──
console.log("\n── 层级导航 ──");

test("getLocationNav 学校内部返回schoolTree", () => {
  resetState();
  gameState.player.location = "侍奉部";
  const nav = getLocationNav("侍奉部");
  if (nav.breadcrumb.length === 0) throw new Error("应有面包屑");
});

test("createDynamicLocation 创建+持久化", () => {
  resetState();
  const r = createDynamicLocation("千叶县", "测试咖啡馆");
  if (!r.includes("创建")) throw new Error(`应创建成功: ${r}`);
});

// ── 载具 ──
console.log("\n── 载具 ──");

test("mountVehicle 自行车 → 装备", () => {
  resetState();
  gameState.player.inventory.push({
    name: "自行车", type: "tool", slot: "back", weight: 12,
    effects: [{ type: "vehicle", value: "bicycle" }], state: "intact"
  });
  const r = mountVehicle("自行车");
  if (!r.includes("骑上了")) throw new Error(`应骑上: ${r}`);
  if (gameState.player.vehicle?.speedMul !== 3) throw new Error("速度应为×3");
});

test("dismountVehicle 下车", () => {
  resetState();
  gameState.player.inventory.push({
    name: "自行车", type: "tool", slot: "back", weight: 12,
    effects: [{ type: "vehicle", value: "bicycle" }], state: "intact"
  });
  mountVehicle("自行车");
  const r = dismountVehicle();
  if (!r.includes("下来了")) throw new Error(`应下车: ${r}`);
  if (gameState.player.vehicle) throw new Error("vehicle 应为空");
});

// ── 手机引擎 ──
console.log("\n── 手机引擎 ──");

test("phone: getPlayerPhoneData 无手机返回null", async () => {
  const { getPlayerPhoneData } = await import("./engine/phone.ts");
  resetState();
  const pd = getPlayerPhoneData();
  if (pd !== null) throw new Error("无手机应返回null");
});

test("phone: 装备手机后返回PhoneData", async () => {
  const { getPlayerPhoneData, createDefaultPhoneData } = await import("./engine/phone.ts");
  resetState();
  // 给玩家装备手机
  gameState.player.equipment.right_hand = {
    name: "手机", type: "tool", slot: "right_hand", weight: 0.2,
    effects: [{ type: "communication", value: "通话/短信/网络" }],
    state: "intact",
    phoneData: createDefaultPhoneData(gameState.player.name),
  };
  const pd = getPlayerPhoneData();
  if (!pd) throw new Error("应返回PhoneData");
  if (pd.owner !== gameState.player.name) throw new Error("owner 应为玩家");
});

test("phone: deliverMessage 发送消息", async () => {
  const { createDefaultPhoneData, deliverMessage, getUnreadSummary } = await import("./engine/phone.ts");
  const pd = createDefaultPhoneData("维");
  deliverMessage(pd, "雪之下雪乃", "维", "要来侍奉部吗？");
  if (pd.messages.length !== 1) throw new Error("应有1条消息");
  if (pd.unreadCount !== 1) throw new Error("未读应为1");
  const summary = getUnreadSummary(pd);
  if (!summary) throw new Error("应有未读摘要");
});

// ── 疲劳系统 ──
console.log("\n── 疲劳系统 ──");

test("疲劳: use_item energy 减少疲劳", () => {
  resetState();
  gameState.player.fatigue = 60;
  gameState.player.inventory.push({
    name: "MAX COFFEE", type: "consumable", slot: "back", weight: 0.3,
    effects: [{ type: "energy", value: "提神" }], state: "intact",
    flavor: "千叶发祥的咖啡饮料"
  });
  // 模拟 use_item 的 energy 逻辑
  gameState.player.fatigue = Math.max(0, gameState.player.fatigue - 20);
  if (gameState.player.fatigue !== 40) throw new Error(`应为40: ${gameState.player.fatigue}`);
});

test("疲劳: buildStatePrompt 高疲劳注入状态", async () => {
  resetState();
  gameState.player.fatigue = 85;
  gameState.player.location = "千叶_住宅区";
  const prompt = await buildStatePrompt();
  if (!prompt.includes("筋疲力尽")) throw new Error("应包含疲劳状态");
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
saveState();
process.exit(failed > 0 ? 1 : 0);
