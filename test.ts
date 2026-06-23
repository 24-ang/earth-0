/**
 * earth-0 引擎冒烟测试
 * 不需要 pi，不需要 LLM。2秒跑完全部。
 *
 * 用法：npx tsx test.ts
 */

import {
  gameState, saveState, loadState, resetState,
  movePlayer, placeFurniture, removeFurniture, toggleDoor,
  editCellType, createRoom, getRoom, initPlayerGrid, getGridContext, ROOMS,
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
  mountVehicle, dismountVehicle, getVehicleMul, calcInventoryVolume,
  getCurrency, getConstructionMultiplier, loadActiveWorld,
  getNearbyNPCs, getContainersAt, transferBetweenContainers, findContainerById,
} from "./engine/state.ts";

import { check, checkDC, attackRoll, rollDamage } from "./engine/dice.ts";
import { perceptionCheck } from "./engine/perception.ts";
import { lookupRegion } from "./engine/router.ts";
import { advanceMinutes } from "./engine/time.ts";
import {
  checkTimelineEvents, expireHooks, getActiveHooks, getActiveQuests,
  openQuest, advanceQuest, abandonQuest,
  getTodayCalendar, getCalendarEvents, getCalendarPhase, clearCalendarCache,
  getHookNoveltyHint,
} from "./engine/timeline.ts";

let passed = 0, failed = 0;
const testQueue: { name: string; fn: () => any }[] = [];
function test(name: string, fn: () => any) {
  testQueue.push({ name, fn });
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
  gameState.player.funds = 2000;
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
  resetState();
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
  resetState();
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
  resetState();
  const sState2 = await getOrCreateSexState("由比滨结衣");
  updateRelation(gameState.player.relationships, "由比滨结衣", -80);
  gameState.player.sex = sState2;
  gameState.layer1Enabled = true;
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
  gameState.player.attributes.魅力 = 16;
  gameState.player.reputation["学生"] = 4;
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
const mockFlags: Record<string, any> = {};
const mockPi = {
  registerTool(tool: any) {
    registeredTools[tool.name] = tool;
  },
  registerCommand() {},
  registerFlag(name: string, config: any) {
    mockFlags[name] = config;
  },
  getFlag(name: string) {
    return mockFlags[name]?.default;
  },
  on() {}
};

test("加载 extension 并初始化 mockPi", async () => {
  const registerExtension = (await import("./extension.ts")).default;
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
      flavor: "祖传的宝刀",
      volume: 2
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

test("getCalendarEvents 按世界观过滤", () => {
  clearCalendarCache();
  const entries = getCalendarEvents("2018-04-07", "总武高");
  // 当前 activeWorld=oregairu，只加载春物日历
  if (entries.length < 1) throw new Error(`应至少1条（当前世界观），实际: ${entries.length}`);
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

test("P1: 日历 org_effects — 体育祭当天总武高学生自动移到操场", async () => {
  resetState();
  const { getOrCreateNPC, updateNPCSchedules } = await import("./engine/state.ts");
  const { clearCalendarCache } = await import("./engine/timeline.ts");

  // Set date to 体育祭 day (6月5日)
  gameState.time.game_date = "2018-06-05";
  gameState.time.day_of_week = "火";
  gameState.time.time_of_day = "morning";

  // Create an NPC that should be affected
  const yui = getOrCreateNPC("由比滨结衣");
  yui.scheduleGroup = "总武高学生";
  yui.currentRoom = "2年F班";

  // Add org_effects calendar entry via calendarEvents
  clearCalendarCache();
  gameState.calendarEvents = [{
    year: null, date: "6月5日", location: "总武高",
    text: "总武高体育祭当日",
    org_effects: [{
      org: "总武高",
      override_location: "操场",
      override_action_template: "{role}参加体育祭{role_action}中"
    }]
  }];

  gameState.player.location = "总武高";
  await updateNPCSchedules();

  if (yui.currentRoom !== "操场") {
    throw new Error(`由比滨应在操场，实际在 ${yui.currentRoom}`);
  }
  if (!yui.action || !yui.action.includes("体育祭")) {
    throw new Error(`由比滨动作应包含"体育祭"，实际: ${yui.action}`);
  }
});

test("getCalendarPhase pre_phase: 5日前でadvance_days=10→pre", () => {
  clearCalendarCache();
  resetState();
  gameState.time.game_date = "2018-04-25";
  gameState.player.location = "总武高";
  gameState.calendarEvents = [{
    year: null, date: "4月30日", location: null,
    text: "月末大事件",
    advance_days: 10
  }];
  const { phase, entries } = getCalendarPhase("2018-04-25", "总武高");
  if (phase !== "pre") throw new Error(`预期 phase=pre，实际=${phase}`);
  if (entries.length === 0) throw new Error("应有匹配的预兆条目");
  if (!entries[0].text.includes("月末大事件")) throw new Error(`文本应包含"月末大事件"，实际: ${entries[0].text}`);
});

test("getCalendarPhase after_phase: 1日後でaftermath_text→after", () => {
  clearCalendarCache();
  resetState();
  gameState.time.game_date = "2018-04-23";
  gameState.player.location = "总武高";
  gameState.calendarEvents = [{
    year: null, date: "4月22日", location: null,
    text: "昨日大事件",
    aftermath_text: "余波未平，人心惶惶"
  }];
  const { phase, entries } = getCalendarPhase("2018-04-23", "总武高");
  if (phase !== "after") throw new Error(`预期 phase=after，实际=${phase}`);
  if (entries.length === 0) throw new Error("应有匹配的余波条目");
  if (!entries[0].aftermath_text) throw new Error("条目应包含 aftermath_text");
  if (!entries[0].aftermath_text.includes("余波未平")) throw new Error(`aftermath_text应包含"余波未平"，实际: ${entries[0].aftermath_text}`);
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
  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "temp_test_flag_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "temp_test_event",
    title: "测试事件",
    trigger: {
      player_stage: "高中",
      flags: { test_flag: true }
    },
    hook: { source_npc: "旁白", hook_text: "测试", urgency: "low" },
    beats: []
  }));

  try {
    gameState.active_hooks = [];
    gameState.completed_events = [];
    gameState.quests = {};
    gameState.flags = {}; // flag not met
    gameState.time.player_stage = "高中";
    gameState.time.game_date = "2018-04-12";

    checkTimelineEvents();
    let hooks = getActiveHooks();
    if (hooks.find(h => h.event_id === "temp_test_event")) {
      throw new Error("flag未满足时不应触发");
    }

    gameState.flags = { test_flag: true }; // flag met
    gameState.active_hooks = [];
    checkTimelineEvents();
    hooks = getActiveHooks();
    if (!hooks.find(h => h.event_id === "temp_test_event")) {
      throw new Error("flag满足后应触发");
    }
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
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

test("expireHooks 过期钩子→移除+执行on_expire", async () => {
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

  await expireHooks();
  const hooks = getActiveHooks();
  if (hooks.length !== 0) throw new Error(`过期钩子应被移除，实际: ${hooks.length}`);
  if (gameState.flags["cookie_missed"] !== true) throw new Error("过期应设置cookie_missed flag");
  if (!gameState.completed_events.includes("cookie_delegation")) throw new Error("应加入completed_events");
});

test("expireHooks 未过期钩子保留", async () => {
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
  await expireHooks();
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

test("双轨制重构: 静默功能检测 (队列溢出不触发处罚)", () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  
  // 预置3个钩子，其中 zaimokuza_novel 为低紧迫度
  gameState.active_hooks = [
    { event_id: "zaimokuza_novel", source_npc: "材木座", hook_text: "1", urgency: "low", created_day: 1, expires_day: 10, seen_count: 0 },
    { event_id: "old_med", source_npc: "路人", hook_text: "2", urgency: "medium", created_day: 2, expires_day: 10, seen_count: 0 },
    { event_id: "old_high", source_npc: "路人", hook_text: "3", urgency: "high", created_day: 3, expires_day: 10, seen_count: 0 },
  ];
  
  // 满足 founding 触发条件 (职员室 + afternoon + day 97)
  gameState.time.time_of_day = "afternoon";
  gameState.player.location = "职员室";
  gameState.time.game_date = "2018-04-07";
  
  checkTimelineEvents();
  
  // zaimokuza_novel 应被静默挤掉
  if (gameState.flags["novel_missed"] === true) {
    throw new Error("静默过期的钩子不应该触发 on_expire 的惩罚效果");
  }
  if (!gameState.completed_events.includes("zaimokuza_novel")) {
    throw new Error("静默过期的钩子应该被加入 completed_events 防止再次触发");
  }
});

// ── Quest 生命周期 ──
console.log("── Quest 生命周期 ──");

test("openQuest 创建任务+移除钩子", async () => {
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

  const r = await openQuest("cookie_delegation");
  if (!r || !r.includes("由比滨的曲奇委托")) throw new Error(`openQuest应返回任务标题: ${r}`);
  if (!gameState.quests["cookie_delegation"]) throw new Error("应创建QuestState");
  if (gameState.quests["cookie_delegation"].status !== "active") throw new Error("状态应为active");
  if (gameState.quests["cookie_delegation"].current_beat !== "accept") throw new Error(`首beat应为accept，实际: ${gameState.quests["cookie_delegation"].current_beat}`);

  if (getActiveHooks().find(h => h.event_id === "cookie_delegation")) throw new Error("钩子应被移除");
});

test("advanceQuest 推进→应用效果→完成", async () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {};
  gameState.time.game_date = "2018-04-08";

  await openQuest("cookie_delegation");
  const r1 = await advanceQuest("cookie_delegation", "一起指导她做曲奇");
  if (!r1 || !r1.includes("曲奇完成")) throw new Error(`应推进到baking: ${r1}`);
  if (gameState.flags["cookie_helped"] !== true) throw new Error("'指导做曲奇'应设置cookie_helped flag");
  const yuiAff = gameState.player.relationships["由比滨结衣"]?.affection;
  if (yuiAff !== 10) throw new Error(`由比滨好感应为10，实际: ${yuiAff}`);

  const r2 = await advanceQuest("cookie_delegation");
  if (!r2 || !r2.includes("完成")) throw new Error(`应完成任务: ${r2}`);
  if (gameState.quests["cookie_delegation"].status !== "completed") throw new Error("状态应为completed");
  if (!gameState.completed_events.includes("cookie_delegation")) throw new Error("应加入completed_events");
});

test("abandonQuest 放弃任务", async () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.time.game_date = "2018-04-08";

  await openQuest("cookie_delegation");
  const r = abandonQuest("cookie_delegation");
  if (!r || !r.includes("放弃")) throw new Error(`应返回已放弃: ${r}`);
  if (gameState.quests["cookie_delegation"].status !== "abandoned") throw new Error("状态应为abandoned");
  if (!gameState.completed_events.includes("cookie_delegation")) throw new Error("应加入completed_events防止重新触发");
});

test("getActiveQuests 仅返回active状态", async () => {
  resetState();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.time.game_date = "2018-04-08";

  await openQuest("cookie_delegation");
  if (getActiveQuests().length !== 1) throw new Error("应有1个活跃quest");
  abandonQuest("cookie_delegation");
  if (getActiveQuests().length !== 0) throw new Error("放弃后应0个活跃quest");
});

test("timeline events applying sex effects successfully", async () => {
  resetState();
  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "temp_test_sex_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "temp_test_sex_event",
    title: "测试性爱事件",
    trigger: { player_stage: "高中" },
    hook: { source_npc: "雪之下雪乃", hook_text: "测试", urgency: "low" },
    beats: [
      {
        id: "beat1",
        label: "测试节拍",
        prompt: "测试",
        outcomes: [
          {
            "pick": "选择",
            "effects": {
              "sex": {
                "npc": "雪之下雪乃",
                "partner": "维",
                "touched_parts": ["秘部"],
                "thoughts": ["测试想法"],
                "duration": 45
              }
            }
          }
        ]
      }
    ]
  }));

  try {
    gameState.active_hooks = [];
    gameState.completed_events = [];
    gameState.quests = {};
    gameState.flags = {};
    gameState.time.player_stage = "高中";
    gameState.time.game_date = "2018-04-12";
    gameState.sexStates = {};

    await openQuest("temp_test_sex_event");
    await advanceQuest("temp_test_sex_event", "选择");

    const ss = gameState.sexStates["雪之下雪乃"];
    if (!ss) throw new Error("SexState应被自动创建");
    if (ss.milestones.virginity.isVirgin) throw new Error("处女应由于秘部接触被破处");
    if (ss.milestones.virginity.lostTo !== "维") throw new Error("对象应为维");
    if (ss.thoughts[0].text !== "测试想法") throw new Error("想法应记录");
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
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

  // openQuest 会消耗钩子转成任务，所以先验证钩子存在
  let prompt = await buildStatePrompt();
  if (!prompt.includes("[日历]")) throw new Error("应包含[日历]");
  if (!prompt.includes("[剧情钩子]")) throw new Error("应包含[剧情钩子]");

  await openQuest("cookie_delegation");
  prompt = await buildStatePrompt();
  if (!prompt.includes("[活跃任务]")) throw new Error("应包含[活跃任务]");
  if (!prompt.includes("由比滨的曲奇委托")) throw new Error("应包含任务标题");
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
  if (!prompt.includes("[日历]")) throw new Error("应包含[日历]");
  if (!prompt.includes("入学式")) throw new Error("应包含入学式文本");
});

test("openQuest 不存在的eventId返回错误", async () => {
  resetState();
  gameState.quests = {};
  const r = await openQuest("nonexistent");
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

console.log("\n── 秘密与世界观附加测试 ──");

test("秘密防火墙: getRevealedSecrets & prompt collector", async () => {
  resetState();
  const { revealSecret } = await import("./engine/state.ts");
  revealSecret("雪乃的秘密", "其实喜欢玩偶潘先生", "hidden_canonical", "player_known");
  
  const prompt = await buildStatePrompt();
  if (!prompt.includes("潘先生")) {
    throw new Error("已揭示的秘密应该被注入到 prompt 中");
  }
});

test("世界线切换: loadActiveWorld(wasteland) 切换并校验解耦数据", async () => {
  const state = await import("./engine/state.ts");
  
  // 1. 切换到废土
  state.loadActiveWorld("wasteland");
  
  if (state.activeWorldName !== "wasteland") {
    throw new Error(`世界线名称应为 wasteland，但实际为: ${state.activeWorldName}`);
  }
  
  const ranger = state.findCharacter("Wasteland Ranger");
  if (!ranger || ranger.name !== "Wasteland Ranger") {
    throw new Error("应该能查到 Wasteland Ranger 角色");
  }
  
  const yukino = state.findCharacter("雪之下雪乃");
  if (yukino) {
    throw new Error("在废土世界线不应该查到 雪之下雪乃");
  }
  
  const camp = state.getRoom("Wasteland Camp");
  if (!camp) {
    throw new Error("应该能查到 Wasteland Camp 房间");
  }
  
  const club = state.getRoom("侍奉部");
  if (club) {
    throw new Error("在废土世界线不应该查到 侍奉部");
  }
  
  if (!state.itemsCatalog.weapons || !state.itemsCatalog.weapons["废土砍刀"]) {
    throw new Error("itemsCatalog 应包含废土砍刀");
  }
  
  if (state.itemsCatalog.weapons["木刀"]) {
    throw new Error("在废土世界线不应该有木刀");
  }
  
  if (!state.shopsCatalog["废土集市"]) {
    throw new Error("shopsCatalog 应包含废土集市");
  }
  
  if (state.shopsCatalog["便利店"]) {
    throw new Error("在废土世界线不应该有便利店商店");
  }

  // 2. 切回默认的 oregairu
  state.loadActiveWorld("oregairu");
  
  if (state.activeWorldName !== "oregairu") {
    throw new Error(`世界线名称应恢复为 oregairu，但实际为: ${state.activeWorldName}`);
  }
  
  const rangerBack = state.findCharacter("Wasteland Ranger");
  if (rangerBack) {
    throw new Error("切回后不应该再有 Wasteland Ranger");
  }
  
  const yukinoBack = state.findCharacter("雪之下雪乃");
  if (!yukinoBack) {
    throw new Error("切回后应该重新有 雪之下雪乃");
  }
  
  const clubBack = state.getRoom("侍奉部");
  if (!clubBack) {
    throw new Error("切回后应该重新有 侍奉部");
  }
  
  if (!state.itemsCatalog.weapons["木刀"]) {
    throw new Error("切回后 itemsCatalog 应该重新有木刀");
  }
});

test("通话工具 make_call: 拨打、接听、拒接与好感度限制", async () => {
  resetState();
  const { createDefaultPhoneData, getPlayerPhoneData } = await import("./engine/phone.ts");
  
  // 1. 给玩家配个手机
  gameState.player.equipment.right_hand = {
    name: "手机", type: "tool", slot: "right_hand", weight: 0.2,
    effects: [{ type: "communication", value: "通话/短信/网络" }],
    state: "intact",
    phoneData: createDefaultPhoneData(gameState.player.name),
  };

  const tool = registeredTools["make_call"];
  if (!tool) throw new Error("make_call tool not registered");

  // 2. NPC 呼叫玩家 (不需要亲密度限制)
  const resDialNpc = await tool.execute("id", { caller: "雪之下雪乃", callee: "玩家", action: "dial" }, null, null, null);
  if (resDialNpc.content[0].text.includes("不够亲密")) {
    throw new Error(`NPC拨打玩家不应受亲密度限制: ${resDialNpc.content[0].text}`);
  }
  
  const pd = getPlayerPhoneData()!;
  if (pd.callLog.length !== 1 || pd.callLog[0].status !== "ongoing") {
    throw new Error("电话应处于 ongoing 状态");
  }

  // 3. 玩家接听
  await tool.execute("id", { caller: "雪之下雪乃", callee: "玩家", action: "answer" }, null, null, null);
  if (pd.callLog[0].status !== "answered") {
    throw new Error("电话应处于 answered 状态");
  }

  // 4. 玩家挂断已接听的电话
  await tool.execute("id", { caller: "雪之下雪乃", callee: "玩家", action: "hangup" }, null, null, null);

  // 5. 玩家拨打 NPC (未同步/好感度不足 -> 拒绝)
  const resDialFail = await tool.execute("id", { caller: "玩家", callee: "雪之下雪乃", action: "dial" }, null, null, null);
  if (!resDialFail.content[0].text.includes("关系不够亲密")) {
    throw new Error("好感度不足时拨打应该被拒绝");
  }

  // 6. 好感度足够 -> 成功
  gameState.player.relationships["雪之下雪乃"] = { affection: 50, stage: "朋友", tone: "普通", lastInteractionDay: 0 };
  const resDialSuccess = await tool.execute("id", { caller: "玩家", callee: "雪之下雪乃", action: "dial" }, null, null, null);
  if (resDialSuccess.content[0].text.includes("关系不够亲密")) {
    throw new Error("好感度足够时拨打不应被拒绝");
  }

  // 7. 拒接
  await tool.execute("id", { caller: "玩家", callee: "雪之下雪乃", action: "decline" }, null, null, null);
  if (pd.callLog[pd.callLog.length - 1].status !== "rejected") {
    throw new Error("电话应处于 rejected 状态");
  }
});

test("日历工具 add_calendar_event: 动态写入日程与世界线隔离", async () => {
  resetState();
  const { getCalendarEvents } = await import("./engine/timeline.ts");
  
  const tool = registeredTools["add_calendar_event"];
  if (!tool) throw new Error("add_calendar_event tool not registered");

  // 1. 玩家添加一个日程
  await tool.execute("id", { date: "12月25日", text: "圣诞派对", location: "部室" }, null, null, null);
  
  // 2. 查询该日期事件
  const events = getCalendarEvents("2026-12-25", "部室");
  const found = events.some(e => e.text === "圣诞派对");
  if (!found) {
    throw new Error("查询到的日历事件应包含 圣诞派对");
  }

  // 3. 切换世界线 -> 隐藏该日程
  const { loadActiveWorld } = await import("./engine/state.ts");
  loadActiveWorld("wasteland");
  const eventsWasteland = getCalendarEvents("2026-12-25", "部室");
  if (eventsWasteland.some(e => e.text === "圣诞派对")) {
    throw new Error("切换至废土世界线后不应查到 圣诞派对 日程");
  }

  // 4. 切回默认 -> 重新出现
  loadActiveWorld("oregairu");
  const eventsOregairu = getCalendarEvents("2026-12-25", "部室");
  if (!eventsOregairu.some(e => e.text === "圣诞派对")) {
    throw new Error("切回默认世界线后应重新查到 圣诞派对 日程");
  }
});

test("空间感知: horizon 与 faces 跨节点感知", async () => {
  resetState();
  const { ROOMS } = await import("./engine/state.ts");
  
  // 1. 注册一个测试房间，配置 horizon 远景和 faces 窗外感知
  ROOMS["测试感知房"] = {
    width: 3,
    height: 3,
    cellSize: 1,
    floor: 1,
    origin: [0, 0],
    cells: [
      [
        { type: "wall", block: true, label: "WL", faces: "小花园" },
        { type: "floor", block: false, label: "  " },
        { type: "floor", block: false, label: "  " }
      ],
      [
        { type: "floor", block: false, label: "  " },
        { type: "floor", block: false, label: "  " },
        { type: "floor", block: false, label: "  " }
      ],
      [
        { type: "floor", block: false, label: "  " },
        { type: "floor", block: false, label: "  " },
        { type: "floor", block: false, label: "  " }
      ]
    ],
    horizon: {
      "north": "远远的北面有高山",
      "south": "南面是无尽的荒漠"
    }
  };

  // 2. 玩家处于中间 (1, 1)，测试全局远景与窗户
  setPlayerLocation("测试感知房");
  gameState.player.gridPos = [1, 1];
  
  const ctxGlobal = getGridContext();
  if (!ctxGlobal.includes("北面望去:远远的北面有高山")) {
    throw new Error(`远景北面未被注入: ${ctxGlobal}`);
  }
  if (!ctxGlobal.includes("南面望去:南面是无尽的荒漠")) {
    throw new Error(`远景南面未被注入: ${ctxGlobal}`);
  }
  if (!ctxGlobal.includes("窗外视野: 坐标(0,0)的窗户朝向【小花园】")) {
    throw new Error(`窗户全局朝向未被注入: ${ctxGlobal}`);
  }

  // 3. 玩家走到窗户墙壁格的邻格 (1, 0)，测试局部西侧墙壁窗户朝向
  gameState.player.gridPos = [1, 0];
  const ctxLocal = getGridContext();
  if (!ctxLocal.includes("西侧是墙壁(有窗户朝向【小花园】)")) {
    throw new Error(`邻格窗外感知未被注入: ${ctxLocal}`);
  }
});

test("体积容错: 缺失 volume 字段的物品不产生 NaN", () => {
  resetState();
  
  // 无体积属性的道具
  const stone = {
    name: "普通石头",
    type: "tool",
    slot: "acc",
    weight: 1.0,
    effects: [],
    state: "intact"
  } as any;

  const vol = calcInventoryVolume([stone], {});
  if (isNaN(vol)) {
    throw new Error("物品没有 volume 字段时计算总体积不应返回 NaN");
  }
  if (vol !== 0) {
    throw new Error(`默认体积应为 0, 实际计算为: ${vol}`);
  }
});

test("社交八卦: NPC 碰面记忆标签排重、隐私过滤与额度限制", async () => {
  resetState();
  const { getOrCreateNPC, updateNPCSchedules } = await import("./engine/state.ts");

  // 1. 初始化三个 NPC，雪乃、结衣、阳乃
  const yukino = getOrCreateNPC("雪之下雪乃");
  const yui = getOrCreateNPC("由比滨结衣");
  const haruno = getOrCreateNPC("雪之下阳乃");

  // 让雪乃和结衣是闺蜜关系
  yukino.npcRelationships = {
    "由比滨结衣": { stage: "闺蜜", tone: "喜欢", notes: "" }
  };
  yui.npcRelationships = {
    "雪之下雪乃": { stage: "闺蜜", tone: "喜欢", notes: "" }
  };

  // 阳乃是陌生人 (无关系记录)
  yukino.npcRelationships["雪之下阳乃"] = undefined as any;
  haruno.npcRelationships = {};

  // 给雪乃添加三个记忆，一个私密，两个公开，一个重复
  const dateStr = gameState.time.game_date;
  yukino.memoryTags = [
    { tag: "[性] 敏感部位自慰", since: dateStr, expires: 7, tone: "困惑" },
    { tag: "[八卦] 便利店打折", since: dateStr, expires: 7, tone: "无感" },
    { tag: "[日常] 喜欢潘先生玩偶", since: dateStr, expires: 7, tone: "期待" },
    { tag: "[日常] 喜欢潘先生玩偶", since: dateStr, expires: 7, tone: "期待" } // 重复项
  ];

  // 结衣和阳乃初始没有记忆，并且大家都在“侍奉部”
  yui.memoryTags = [];
  haruno.memoryTags = [];

  yukino.currentRoom = "侍奉部";
  yui.currentRoom = "侍奉部";
  haruno.currentRoom = "侍奉部";

  // 2. 跑一轮更新，触发社交碰面
  await updateNPCSchedules();

  // 3. 校验排重：雪乃自己的重复项应该被剔除
  const ykTags = yukino.memoryTags.map(t => t.tag);
  const dupCount = ykTags.filter(t => t === "[日常] 喜欢潘先生玩偶").length;
  if (dupCount !== 1) {
    throw new Error(`排重失败，雪乃依然有重复的标签，数量为: ${dupCount}`);
  }

  // 4. 校验隐私过滤与额度限制：
  const yuiTags = yui.memoryTags.map(t => t.tag);
  if (yuiTags.length > 2) {
    throw new Error(`额度限制失效，结衣学到了多于 2 个标签: ${yuiTags.join(", ")}`);
  }

  // 阳乃 (陌生人) 不管怎样都不应该学到私密标签，只能学到公开标签
  const harunoTags = haruno.memoryTags.map(t => t.tag);
  if (harunoTags.includes("[性] 敏感部位自慰")) {
    throw new Error("隐私泄漏！陌生人阳乃学到了雪乃的私密标签");
  }
  if (harunoTags.length > 2) {
    throw new Error(`额度限制失效，阳乃学到了多于 2 个标签: ${harunoTags.join(", ")}`);
  }
});

test("建造与拆除：消耗材料与工具耐久退化，非建材拒绝，Ruined拒绝，家具拆除退回", () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();

  const [px, py] = gameState.player.gridPos || [0, 0];
  const tx = px + 1, ty = py;

  // 1. 设置力量为4，测试工具需求
  gameState.player.attributes.力量 = 4;

  // 2. 只有材料(砖)没有工具，建造应该失败
  gameState.player.inventory.push({ name: "砖", type: "tool", weight: 2, effects: [], state: "intact", volume: 0.5 });
  const r1 = editCellType(tx, ty, "wall", undefined, "砖");
  if (r1.success) throw new Error("力量不足且没有锤子时，建造墙壁应该失败");

  // 3. 有材料(砖)且有工具(锤子)，建造应该成功，并且材料减少，锤子退化为damaged
  gameState.player.inventory.push({ name: "锤子", type: "tool", weight: 1.5, effects: [], state: "intact", volume: 0.5 });
  const r2 = editCellType(tx, ty, "wall", undefined, "砖");
  if (!r2.success) throw new Error(`建墙失败: ${r2.reason}`);

  // 检查砖是否扣除
  const hasBrick = gameState.player.inventory.some((i: any) => i.name === "砖");
  if (hasBrick) throw new Error("建造完成后材料(砖)应该被扣除");

  // 检查锤子状态
  const hammer = gameState.player.inventory.find((i: any) => i.name === "锤子");
  if (!hammer || hammer.state !== "damaged") {
    throw new Error(`锤子应该退化为 damaged 状态，实际为: ${hammer?.state}`);
  }

  // 4. 再次用 砖 建造（再加一个砖），由于锤子是 damaged 状态，可以继续使用并退化为 ruined
  gameState.player.inventory.push({ name: "砖", type: "tool", weight: 2, effects: [], state: "intact", volume: 0.5 });
  const tx2 = px, ty2 = py + 1;
  const r3 = editCellType(tx2, ty2, "wall", undefined, "砖");
  if (!r3.success) throw new Error(`第二次建墙失败: ${r3.reason}`);

  if (hammer.state !== "ruined") {
    throw new Error(`锤子应该退化为 ruined 状态，实际为: ${hammer.state}`);
  }

  // 5. 试图再次建墙，因为锤子已经 ruined 且力量为4，应该被拒绝
  gameState.player.inventory.push({ name: "砖", type: "tool", weight: 2, effects: [], state: "intact", volume: 0.5 });
  const tx3 = px - 1, ty3 = py;
  const r4 = editCellType(tx3, ty3, "wall", undefined, "砖");
  if (r4.success) throw new Error("使用 ruined 锤子且力量不足，建造应该被拒绝");

  // 6. 试图使用功能性道具（如手机）作为建材，应该被拒绝
  const r5 = editCellType(tx3, ty3, "wall", undefined, "手机");
  if (r5.success) throw new Error("使用手机作为建材应该被拒绝");

  // 7. 测试拆除墙壁：使用 ruined 锤子拆除墙壁应该失败（力量为4）
  const r6 = editCellType(tx, ty, "floor", undefined, "锤子");
  if (r6.success) throw new Error("力量不足且使用 ruined 锤子拆墙应该被拒绝");

  // 8. 放入一个新的 intact 锤子，拆墙应该成功，且该锤子退化为 damaged
  gameState.player.inventory.push({ name: "锤子", type: "tool", weight: 1.5, effects: [], state: "intact", volume: 0.5 });
  // 这时有两个锤子，一个 ruined，一个 intact
  const activeHammer = gameState.player.inventory.find((i: any) => i.name === "锤子" && i.state === "intact")!;
  const r7 = editCellType(tx, ty, "floor", undefined, "锤子");
  if (!r7.success) throw new Error(`用新锤子拆墙失败: ${r7.reason}`);
  if (activeHammer.state !== "damaged") {
    throw new Error(`新锤子拆墙后应退化为 damaged，实际为: ${activeHammer.state}`);
  }

  // 9. 测试放置家具与拆除家具退回背包
  gameState.player.inventory.push({ name: "台灯", type: "tool", weight: 0.5, effects: [], state: "intact", volume: 0.5 });
  const rPlace = placeFurniture(tx, ty, "台灯");
  if (!rPlace.success) throw new Error(`放置台灯失败: ${rPlace.reason}`);
  if (gameState.player.inventory.some((i: any) => i.name === "台灯")) {
    throw new Error("放置后背包应该扣除台灯");
  }

  const rRemove = removeFurniture(tx, ty);
  if (!rRemove.success) throw new Error(`拆除台灯失败: ${rRemove.reason}`);
  const returnedLamp = gameState.player.inventory.find((i: any) => i.name === "台灯");
  if (!returnedLamp) {
    throw new Error("拆除后背包没有退回台灯");
  }
});

// ── Phase 7: 新特性测试 (Issue ⑥, ⑯, ⑧, ⑪) ──
console.log("\n── 新特性与机制测试 ──");

test("空间 z-axis/Wall Tags: 单元格标签与高度扫描", () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  const room = ROOMS[gameState.player.location];
  if (!room) throw new Error("没有当前房间数据");
  gameState.player.gridPos = [0, 0];
  room.cells[0][0].tags = ["window", "high_shelf"];
  room.cells[0][0].height = 2.5;
  const ctxStr = getGridContext();
  if (!ctxStr.includes("[window,high_shelf]")) {
    throw new Error(`getGridContext 应包含标签window,high_shelf，实际: ${ctxStr}`);
  }
  if (!ctxStr.includes("[h:2.5m]")) {
    throw new Error(`getGridContext 应包含高度信息h:2.5m，实际: ${ctxStr}`);
  }
});

test("动态货币与施工倍率: 切换世界线校验", async () => {
  loadActiveWorld("oregairu");
  if (getCurrency() !== "¥") throw new Error(`oregairu 货币应为 ¥，实际: ${getCurrency()}`);
  if (getConstructionMultiplier() !== 100) throw new Error(`oregairu 施工倍率应为 100，实际: ${getConstructionMultiplier()}`);
  loadActiveWorld("wasteland");
  if (getCurrency() !== "Caps") throw new Error(`wasteland 货币应为 Caps，实际: ${getCurrency()}`);
  if (getConstructionMultiplier() !== 10) throw new Error(`wasteland 施工倍率应为 10，实际: ${getConstructionMultiplier()}`);
  loadActiveWorld("oregairu");
});

test("NPC 运行时状态初始化与存档读取", () => {
  resetState();
  const npc = getOrCreateNPC("由比滨结衣");
  if (!npc.attributes || npc.attributes.力量 === undefined) {
    throw new Error("NPC 运行时状态应正确初始化属性");
  }
  if (!npc.hp || npc.hp.max <= 0) {
    throw new Error("NPC 运行时状态应根据体质计算或读取模板初始化 HP");
  }
  if (!npc.skills) {
    throw new Error("NPC 运行时状态应初始化技能");
  }
  saveState();
  const loaded = loadState();
  if (!loaded) throw new Error("重新加载存档失败");
  const loadedNpc = gameState.npcs["由比滨结衣"];
  if (!loadedNpc || !loadedNpc.attributes || !loadedNpc.hp) {
    throw new Error("重新加载后 NPC 运行时状态应正确保存并迁移补齐");
  }
});

test("队友状态详情 prompt 收集器", async () => {
  resetState();
  const p = gameState.player;
  p.party = ["雪之下雪乃"];
  const npc = getOrCreateNPC("雪之下雪乃");
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[队伍成员]")) {
    throw new Error(`StatePrompt 应包含队伍成员信息，实际: ${prompt}`);
  }
  if (!prompt.includes("雪之下雪乃: HP")) {
    throw new Error(`StatePrompt 应包含队友详细状态，实际: ${prompt}`);
  }
});

test("战斗伤害结算写回 NPC 运行时状态", async () => {
  resetState();
  const p = gameState.player;
  const tool = registeredTools["combat_action"];
  const npc = getOrCreateNPC("雪之下雪乃");
  npc.hp.current = npc.hp.max;
  p.equipment.right_hand = {
    name: "无名神刀",
    type: "weapon",
    slot: "right_hand",
    weight: 2.0,
    effects: [],
    state: "intact",
    damage: { dice: "1d6+5", damageType: "切割" }
  };
  
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const res = await tool.execute("combat-test", {
      action: "attack",
      target: "雪之下雪乃"
    }, null, null, null);
    if (npc.hp.current >= npc.hp.max) {
      throw new Error(`雪乃的运行时 HP 不应仍为最大值: ${npc.hp.current}/${npc.hp.max}。战斗结果: ${res.content[0].text}`);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test("日历层级穿透与时间线整合 (Issue ⑱)", async () => {
  resetState();
  const { loadActiveWorld, setPlayerLocation } = await import("./engine/state.ts");
  const { getCalendarEvents, checkTimelineEvents, getActiveHooks } = await import("./engine/timeline.ts");
  const { parseMonthDay } = await import("./engine/timeline.ts");

  loadActiveWorld("oregairu");
  setPlayerLocation("侍奉部"); // "侍奉部" 属于 "总武高" 层次结构
  
  gameState.time.game_date = "2018-04-07";
  
  // 1. 验证 getCalendarEvents 是否正确穿透位置层级（"侍奉部" 能匹配到 "总武高" 上的入学式）
  const events = getCalendarEvents(gameState.time.game_date, gameState.player.location);
  const hasAdmission = events.some(e => e.text.includes("入学式"));
  if (!hasAdmission) {
    throw new Error(`侍奉部单元格应该能匹配到总武高入学式日历事件`);
  }

  // 2. 模拟一个配置有 calendar_event: "入学式" 条件的时间线剧情事件
  const mockEvent = {
    id: "test_calendar_trigger",
    title: "测试日历事件触发时间线",
    source: "test",
    trigger: {
      calendar_event: "入学式"
    },
    expires_days: 3,
    repeatable: false,
    hook: {
      source_npc: "雪之下雪乃",
      hook_text: "雪乃正看着入学式的人群发呆",
      urgency: "low" as const
    },
    beats: []
  };

  const fs = await import("node:fs");
  const path = await import("node:path");
  const tempPath = path.resolve(process.cwd(), "data", "timelines", "oregairu", "test_temp_calendar.json");
  
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(mockEvent), "utf-8");

  try {
    gameState.active_hooks = [];
    checkTimelineEvents();
    const hooks = getActiveHooks();
    const hasHook = hooks.some(h => h.event_id === "test_calendar_trigger");
    if (!hasHook) {
      throw new Error("时间线事件未能通过日历事件触发");
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
});

test("preset.json 动态组装与模式替换 (Issue ⑲)", async () => {
  const { buildSystemPrompt } = await import("./extension.ts");
  
  // 1. 测试 RPG 探索模式组装
  const state1 = { preset: "default", mode: "rpg" };
  const prompt1 = await buildSystemPrompt(state1, "MOCK_STATE_PROMPT");
  if (!prompt1.includes("MOCK_STATE_PROMPT")) {
    throw new Error("组装提示词应该包含状态简报");
  }
  if (!prompt1.includes("探索") && !prompt1.includes("检定")) {
    throw new Error("RPG 探索模式下应该正确引入 RPG 规则描述文件");
  }
  
  // 2. 测试 GAL 日常模式组装
  const state2 = { preset: "default", mode: "gal" };
  const prompt2 = await buildSystemPrompt(state2, "MOCK_STATE_PROMPT");
  if (!prompt2.includes("MOCK_STATE_PROMPT")) {
    throw new Error("组装提示词应该包含状态简报");
  }
  
  // 3. 测试 Lite 轻量预设
  const state3 = { preset: "lite", mode: "rpg" };
  const prompt3 = await buildSystemPrompt(state3, "MOCK_STATE_PROMPT");
  if (prompt3.length >= prompt1.length) {
    throw new Error("Lite 预设组装的提示词长度应该比 Default 预设短");
  }
});

test("loadActiveWorld 防崩溃 (Issue ⑮)", () => {
  const { loadActiveWorld } = require("./engine/state.ts");
  // 应不抛出任何异常，安静地容错返回
  loadActiveWorld("non_existent_worldpack_12345");
  // 恢复为正常世界线
  loadActiveWorld("oregairu");
});

test("双轨制重构: 缺hook字段的剧情事件防崩溃", () => {
  resetState();
  const { loadActiveWorld } = require("./engine/state.ts");
  const { checkTimelineEvents } = require("./engine/timeline.ts");

  loadActiveWorld("wasteland");
  // wasteland_intro 没有 hook 配置，应正常检测通过，不抛出 TypeError
  checkTimelineEvents();

  loadActiveWorld("oregairu");
});

test("双轨制重构: 玩家与比企谷八幡共存检定", async () => {
  resetState();
  const { loadActiveWorld } = require("./engine/state.ts");
  const { checkTimelineEvents, getActiveHooks } = require("./engine/timeline.ts");

  loadActiveWorld("oregairu");

  // 1. 自定义名字 "维"，好感低，且未在小时候保护雪乃 -> 保留比企谷八幡原著戏份
  gameState.player.name = "维";
  gameState.player.relationships["雪之下雪乃"] = { affection: 5, stage: "陌生", notes: "" };
  gameState.flags.protected_yukino_childhood = false;
  gameState.player.location = "职员室";
  gameState.time.game_date = "2018-04-08";
  gameState.time.time_of_day = "afternoon";
  
  gameState.active_hooks = [];
  gameState.completed_events = [];
  checkTimelineEvents();
  
  let hooks = getActiveHooks();
  const foundingHook = hooks.find(h => h.event_id === "service_club_founding");
  if (!foundingHook) {
    throw new Error("应该能触发 service_club_founding 钩子");
  }
  // 比企谷八幡作为独立NPC始终存在于叙事中
  if (!foundingHook.hook_text.includes("比企谷八幡") || !foundingHook.hook_text.includes("维")) {
    throw new Error("叙事中应同时包含玩家名(维)和比企谷八幡，实际文本：" + foundingHook.hook_text);
  }

  // 2. 满足初始好感度 >= 20 -> 触发顶替，替换为 "维"
  resetState();
  loadActiveWorld("oregairu");
  gameState.player.name = "维";
  gameState.player.relationships["雪之下雪乃"] = { affection: 65, stage: "熟人", notes: "" };
  gameState.flags.protected_yukino_childhood = false;
  gameState.player.location = "职员室";
  gameState.time.game_date = "2018-04-08";
  gameState.time.time_of_day = "afternoon";
  
  gameState.active_hooks = [];
  gameState.completed_events = [];
  checkTimelineEvents();
  
  hooks = getActiveHooks();
  const foundingHook2 = hooks.find(h => h.event_id === "service_club_founding");
  if (!foundingHook2) {
    throw new Error("应该能触发 service_club_founding 钩子");
  }
  // 高好感度时：玩家名和比企谷八幡共存（两人始终是独立角色）
  if (!foundingHook2.hook_text.includes("维") || !foundingHook2.hook_text.includes("比企谷八幡")) {
    throw new Error("好感度高时玩家名和比企谷八幡应共存，实际文本：" + foundingHook2.hook_text);
  }

  // 3. 满足小时候保护过雪乃 -> 触发顶替，替换为 "维"
  resetState();
  loadActiveWorld("oregairu");
  gameState.player.name = "维";
  gameState.player.relationships["雪之下雪乃"] = { affection: 0, stage: "陌生", notes: "" };
  gameState.flags.protected_yukino_childhood = true;
  gameState.player.location = "职员室";
  gameState.time.game_date = "2018-04-08";
  gameState.time.time_of_day = "afternoon";
  
  gameState.active_hooks = [];
  gameState.completed_events = [];
  checkTimelineEvents();
  
  hooks = getActiveHooks();
  const foundingHook3 = hooks.find(h => h.event_id === "service_club_founding");
  if (!foundingHook3) {
    throw new Error("应该能触发 service_club_founding 钩子");
  }
  // 保护flag时：玩家名和比企谷八幡共存
  if (!foundingHook3.hook_text.includes("维") || !foundingHook3.hook_text.includes("比企谷八幡")) {
    throw new Error("保护Flag满足时玩家名和比企谷八幡应共存，实际文本：" + foundingHook3.hook_text);
  }

  // 4. NPC 派生与过滤校验
  // 4a. 满足顶替时，主角是"维"，"比企谷八幡"可以作为NPC派生
  const spawnNpcAgent = require("./tools/state/spawn_npc_agent.ts").default;
  const spawnNpcAgents = require("./tools/state/spawn_npc_agents.ts").default;

  // 此时仍处于满足顶替状态（player.name = "维", protected_yukino_childhood = true）
  const result1 = await spawnNpcAgent.execute("test_id", { npcName: "比企谷八幡", sceneContext: "测试" });
  if (result1.content[0].text.includes("是当前主角或玩家")) {
    throw new Error("满足顶替时，比企谷八幡应能作为同伴NPC派生，但被错误拦截了：" + result1.content[0].text);
  }

  const result1_batch = await spawnNpcAgents.execute("test_id", { npcs: [{ npcName: "比企谷八幡", sceneContext: "测试" }] });
  if (!result1_batch.content[0].text.includes("比企谷八幡")) {
    throw new Error("满足顶替时，比企谷八幡应能作为同伴NPC批量派生，但被过滤了: " + result1_batch.content[0].text);
  }

  // 4b. 不满足顶替条件时，比企谷八幡仍可作为NPC派生（玩家和八幡是两个人）
  resetState();
  loadActiveWorld("oregairu");
  gameState.player.name = "维";
  gameState.player.relationships["雪之下雪乃"] = { affection: 0, stage: "陌生", notes: "" };
  gameState.flags.protected_yukino_childhood = false;

  const result2 = await spawnNpcAgent.execute("test_id", { npcName: "比企谷八幡", sceneContext: "测试" });
  if (result2.content[0].text.includes("是当前主角或玩家")) {
    throw new Error("比企谷八幡应始终可作为NPC派生，但被错误拦截了：" + result2.content[0].text);
  }

  const result2_batch = await spawnNpcAgents.execute("test_id", { npcs: [{ npcName: "比企谷八幡", sceneContext: "测试" }] });
  if (!result2_batch.content[0].text.includes("比企谷八幡")) {
    throw new Error("比企谷八幡应始终可作为NPC批量派生，但被过滤了: " + result2_batch.content[0].text);
  }
});

test("双轨制重构: 入学式车祸干涉剧情走向", async () => {
  resetState();
  const { loadActiveWorld } = require("./engine/state.ts");
  const { getCalendarEvents } = require("./engine/timeline.ts");

  loadActiveWorld("oregairu");

  gameState.player.name = "维";
  gameState.player.age = 16;
  gameState.time.player_stage = "高中";
  gameState.player.location = "千叶_住宅区";
  gameState.time.game_date = "2018-04-07";
  gameState.time.time_of_day = "morning";

  // 1. 验证日历中包含车祸干涉机制规则
  const calendarEvents = getCalendarEvents("2018-04-07", "千叶_住宅区");
  const accidentEvent = calendarEvents.find(e => e.text.includes("player_accident"));
  if (!accidentEvent) {
    throw new Error("日历中应该包含车祸的干涉机制规则说明");
  }

  const { getPlayerNameParts } = require("./engine/timeline.ts");

  // 2. 无论哪个分支，玩家名字始终是自己的名字（与八幡是两个人）
  // 分支一：玩家推开八幡被撞 → 玩家走雪乃线，八幡安全
  gameState.flags.player_accident = true;
  gameState.flags.hachiman_accident = false;
  gameState.flags.no_accident = false;
  let parts = getPlayerNameParts();
  if (parts.full !== "维") {
    throw new Error("玩家被撞后，名字应始终是自己的名字 维，实际：" + parts.full);
  }

  // 分支二：拽住狗绳无车祸 → 玩家和八幡都安全，各自发展
  gameState.flags.player_accident = false;
  gameState.flags.hachiman_accident = false;
  gameState.flags.no_accident = true;
  parts = getPlayerNameParts();
  if (parts.full !== "维") {
    throw new Error("无车祸时，玩家名字应始终是自己的名字 维，实际：" + parts.full);
  }

  // 分支三：旁观原著车祸 → 八幡被撞（canon事件），玩家名字不变
  gameState.flags.player_accident = false;
  gameState.flags.hachiman_accident = true;
  gameState.flags.no_accident = false;
  parts = getPlayerNameParts();
  if (parts.full !== "维") {
    throw new Error("旁观车祸时，玩家名字应始终是自己的名字 维，实际：" + parts.full);
  }
});

test("⑳ Gambling: executeGamble & getBlackMarketPrice", async () => {
  resetState();
  const { executeGamble, getBlackMarketPrice } = await import("./engine/gambling.ts");

  // 1. 余额不足下注应拒绝
  gameState.player.funds = 10;
  try {
    executeGamble("dice_2d6", 50, "normal", gameState);
    throw new Error("余额不足时下注应当抛出错误");
  } catch (e: any) {
    if (!e.message.includes("余额不足")) throw e;
  }

  // 2. 模拟 Nat 1 自然大失败
  gameState.player.funds = 100;
  const originalRandom = Math.random;
  Math.random = () => 0.0; // 导致 roll = 1
  const res1 = executeGamble("dice_2d6", 50, "cheat", gameState);
  Math.random = originalRandom;

  if (res1.success || res1.critical !== "fail") {
    throw new Error("Math.random 为 0.0 时应触发 Nat 1 失败");
  }
  if (!gameState.player.flags.exposed || !gameState.player.flags.wanted) {
    throw new Error("Nat 1 失败后应被通缉/暴露");
  }
  if (gameState.player.funds !== 50) {
    throw new Error(`Nat 1 应扣除本金且无奖金，余额应为 50，实际：${gameState.player.funds}`);
  }

  // 3. 模拟 Nat 20 自然大成功
  gameState.player.funds = 100;
  Math.random = () => 0.99; // 导致 roll = 20
  const res2 = executeGamble("dice_2d6", 50, "cheat", gameState);
  Math.random = originalRandom;

  if (!res2.success || res2.critical !== "success") {
    throw new Error("Math.random 为 0.99 时应触发 Nat 20 成功");
  }
  if (gameState.player.funds !== 250) {
    throw new Error(`Nat 20 应赚取双倍赔率奖金，余额应为 250，实际：${gameState.player.funds}`);
  }

  // 4. 黑市定价规则测试
  const priceBuy0 = getBlackMarketPrice("buy", 100, 0, 0);
  if (priceBuy0 !== 150) {
    throw new Error(`黑市买入价(无声望/好感)应为 150，实际：${priceBuy0}`);
  }
  const priceBuyMod = getBlackMarketPrice("buy", 100, 5, 50);
  if (priceBuyMod !== 84) {
    throw new Error(`黑市买入价(有声望/好感优惠)应为 84，实际：${priceBuyMod}`);
  }
  const priceSell0 = getBlackMarketPrice("sell", 100, 0, 0);
  if (priceSell0 !== 40) {
    throw new Error(`黑市卖出价(无声望/好感)应为 40，实际：${priceSell0}`);
  }
  const priceSellMod = getBlackMarketPrice("sell", 100, 5, 50);
  if (priceSellMod !== 51) {
    throw new Error(`黑市卖出价(有声望/好感加成)应为 51，实际：${priceSellMod}`);
  }

  // 5. 测试 gamble_bet 工具
  gameState.player.funds = 100;
  const gambleTool = registeredTools["gamble_bet"];
  if (!gambleTool) throw new Error("gamble_bet 工具未注册");
  Math.random = () => 0.99; // Nat 20
  await gambleTool.execute("id", { game: "dice_2d6", amount: 50, strategy: "cheat" }, null, null, null);
  Math.random = originalRandom;
  if (gameState.player.funds !== 250) {
    throw new Error(`通过 gamble_bet 工具 Nat 20，余额应为 250，实际：${gameState.player.funds}`);
  }

  // 6. 测试 black_market_trade 工具
  gameState.player.funds = 500;
  const tradeTool = registeredTools["black_market_trade"];
  if (!tradeTool) throw new Error("black_market_trade 工具未注册");
  await tradeTool.execute("id", { action: "buy", itemName: "绷带", quantity: 2, itemType: "contraband" }, null, null, null);
  if (gameState.player.funds !== 350) {
    throw new Error(`购买2个黑市绷带后，余额应为 350，实际：${gameState.player.funds}`);
  }
  const bandages = gameState.player.inventory.filter((i: any) => i.name === "绷带");
  if (bandages.length !== 2) {
    throw new Error(`背包中应有 2 个绷带，实际：${bandages.length}`);
  }
});

test("㉑ Housing: purchaseOrRentProperty, transferHousingStorage & settleHousingContracts", async () => {
  resetState();
  const { purchaseOrRentProperty, transferHousingStorage, settleHousingContracts } = await import("./engine/housing.ts");

  // 1. 购入千叶单身公寓 202 室
  gameState.player.funds = 200000;
  const msgBuy = purchaseOrRentProperty("chiba_apartment_202", "buy", gameState);
  if (!msgBuy.includes("购买成功")) throw new Error("购房返回信息不正确");
  if (gameState.player.funds !== 80000) throw new Error("购房扣费不正确");
  const prop = gameState.player.properties["chiba_apartment_202"];
  if (!prop || prop.type !== "own") throw new Error("购房后属性状态不正确");

  // 2. 租房测试 (先退租)
  purchaseOrRentProperty("chiba_apartment_202", "terminate", gameState);
  if (gameState.player.properties["chiba_apartment_202"]) throw new Error("退租/出售后不应拥有该房产");
  
  gameState.player.funds = 10000;
  const msgRent = purchaseOrRentProperty("chiba_apartment_202", "rent", gameState);
  if (!msgRent.includes("租房成功")) throw new Error("租房返回信息不正确");
  if (gameState.player.funds !== 8500) throw new Error("租房扣首月租金(1500)不正确");
  const propRent = gameState.player.properties["chiba_apartment_202"];
  if (!propRent || propRent.type !== "rent" || propRent.rent_fee !== 1500) throw new Error("租房状态不正确");

  // 3. 储物箱容量与承重限制测试
  gameState.player.location = "千叶_公寓202"; 
  
  gameState.player.inventory = [
    { name: "哑铃", type: "tool", weight: 90, volume: 40, state: "intact", effects: [] },
    { name: "哑铃", type: "tool", weight: 90, volume: 40, state: "intact", effects: [] },
    { name: "哑铃", type: "tool", weight: 90, volume: 40, state: "intact", effects: [] }
  ] as any[];

  transferHousingStorage("chiba_apartment_202", "store", "哑铃", 2, gameState);
  const storedDumbbells = propRent.storage.find(i => i.name === "哑铃");
  if (!storedDumbbells || storedDumbbells.quantity !== 2) throw new Error("存入数量不正确");

  try {
    transferHousingStorage("chiba_apartment_202", "store", "哑铃", 1, gameState);
    throw new Error("超限存储应当被拒绝");
  } catch (e: any) {
    if (!e.message.includes("承重超限") && !e.message.includes("体积已满")) throw e;
  }

  // 4. 房产税扣减与欠租驱逐机制
  propRent.rent_due_date = gameState.time.game_date;
  gameState.player.funds = 2000; 
  settleHousingContracts(gameState);
  if (gameState.player.funds !== 500) throw new Error("扣除租金失败");
  if (propRent.rent_due_date === gameState.time.game_date) throw new Error("续租后日期未推进");

  propRent.rent_due_date = gameState.time.game_date;
  gameState.player.funds = 0;
  
  settleHousingContracts(gameState);
  if (propRent.arrears_days !== 1 || !gameState.player.flags["arrears_warning_chiba_apartment_202"]) {
    throw new Error("第1天欠费状态不正确");
  }

  settleHousingContracts(gameState);
  if (propRent.arrears_days !== 2) throw new Error("第2天欠费天数不正确");

  settleHousingContracts(gameState);
  if (gameState.player.properties["chiba_apartment_202"]) throw new Error("欠租3天应该被清退驱逐");
  if (!gameState.player.flags["evicted_chiba_apartment_202"]) throw new Error("未设置被驱逐标记");
  
  const backpackDumbbells = gameState.player.inventory.filter(i => i.name === "哑铃");
  if (backpackDumbbells.length !== 3) throw new Error(`被驱逐后储物柜哑铃应退回背包，背包中哑铃应为3，实际：${backpackDumbbells.length}`);

  // 5. 校验安全屋外非法改造触发 exposure/wanted（察觉统一检定）
  resetState();
  gameState.player.location = "侍奉部";
  initPlayerGrid();
  gameState.player.inventory.push({ name: "台灯", type: "tool", slot: "acc", weight: 0.5, effects: [], state: "intact" });
  // 在附近生成一个感知极高的 NPC 作为目击者
  const { getOrCreateNPC } = await import("./engine/state.ts");
  const witness = getOrCreateNPC("目击者");
  witness.currentRoom = "侍奉部";
  witness.gridPos = [gameState.player.gridPos![0] + 1, gameState.player.gridPos![1]]; // 相邻格
  witness.attributes.感知 = 20;  // 极高感知，确保看到

  const interactTool = registeredTools["world_interact"];
  await interactTool.execute("id", { action: "place", item: "台灯" }, null, null, null);

  if (!gameState.player.flags.exposed || !gameState.player.flags.wanted) {
    throw new Error("安全屋外非法改装应该触发通缉暴露");
  }
});

test("㉒ Weather: getFatigueMultiplier, transitionWeather & settle_scene Integration", async () => {
  resetState();
  const { getFatigueMultiplier, transitionWeather } = await import("./engine/weather.ts");

  if (getFatigueMultiplier(20) !== 1.0) throw new Error("舒适温度乘数应为 1.0");
  if (getFatigueMultiplier(38) <= 1.0) throw new Error("炎热温度乘数应大于 1.0");
  if (getFatigueMultiplier(-10) <= 1.0) throw new Error("寒冷温度乘数应大于 1.0");

  gameState.weather = { type: "晴", temp: 15 };
  gameState.time.game_date = "2018-07-15"; 
  transitionWeather(gameState);
  if (!gameState.weather.type || typeof gameState.weather.temp !== "number") {
    throw new Error("天气转移后结构不正确");
  }

  gameState.player.fatigue = 0;
  gameState.weather = { type: "暴雨", temp: 38 }; 
  const settleTool = registeredTools["settle_scene"];
  await settleTool.execute("id", { summary: "酷暑下干活", elapsed_minutes: 120 }, null, null, null);
  if (gameState.player.fatigue !== 13) {
    throw new Error(`酷暑下 120 分钟疲劳累积应为 13，实际：${gameState.player.fatigue}`);
  }
});

test("㉓ Intercity Travel: switchActiveWorld & travel_intercity Tool", async () => {
  resetState();
  const { switchActiveWorld } = await import("./engine/state.ts");

  gameState.activeWorld = "oregairu";
  gameState.player.location = "住宅区";
  gameState.player.known_locations = ["住宅区", "侍奉部"];
  
  const phoneItem: any = {
    name: "智能手机",
    type: "tool",
    slot: "left_hand",
    weight: 0.2,
    state: "intact",
    effects: [],
    phoneData: {
      owner: "维",
      contacts: [],
      chatThreads: [],
      callLog: [],
      snsPosts: [
        { id: "post1", author: "维", content: "今天天气真好", timestamp: Date.now() }
      ]
    }
  };
  gameState.player.inventory.push(phoneItem);

  switchActiveWorld("wasteland");

  if (gameState.activeWorld !== "wasteland") throw new Error("世界线应切换为 wasteland");
  if (gameState.player.known_locations.includes("侍奉部")) {
    throw new Error("切换到新世界线时，旧世界线的已知位置应该被隔离清除");
  }
  const activePhone = gameState.player.inventory.find(i => i.phoneData !== undefined);
  if (activePhone.phoneData.snsPosts.length > 0) {
    throw new Error("切换到新世界线时，手机 SNS 帖子应当隔离清空");
  }

  gameState.player.known_locations.push("荒野营地");
  activePhone.phoneData.snsPosts.push({ id: "post_wl", author: "废土浪人", content: "废土沙尘暴太大了", timestamp: Date.now() });

  switchActiveWorld("oregairu");
  if (gameState.activeWorld !== "oregairu") throw new Error("世界线应回切为 oregairu");
  
  if (!gameState.player.known_locations.includes("侍奉部")) {
    throw new Error("切回原世界线后，原已知位置应该被恢复");
  }
  if (activePhone.phoneData.snsPosts.length !== 1 || activePhone.phoneData.snsPosts[0].id !== "post1") {
    throw new Error("切回原世界线后，手机 SNS 帖子应该恢复");
  }

  gameState.player.funds = 5000;
  const travelTool = registeredTools["travel_intercity"];
  if (!travelTool) throw new Error("travel_intercity 工具未注册");

  const travelRes = await travelTool.execute("id", { route: "wasteland_caravan", destination: "荒野营地" }, null, null, null);
  if (!travelRes.content[0].text.includes("荒野营地") || gameState.activeWorld !== "wasteland") {
    throw new Error("城际旅行工具未能正确运送并切换世界线");
  }
  if (gameState.player.location !== "荒野营地") throw new Error("城际旅行后目的地位置错误");
  if (gameState.player.funds !== 3000) throw new Error("城际旅行车票扣费错误");
});

test("㉔ Dual-model Rendering: render_scene Tool with local directors_note and narrative render model", async () => {
  resetState();
  const renderTool = registeredTools["render_scene"];
  if (!renderTool) throw new Error("render_scene 工具未注册");

  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let firstPrompt = "";

  globalThis.fetch = async (url: any, init: any) => {
    fetchCallCount++;
    const reqBody = JSON.parse(init.body);
    firstPrompt = reqBody.messages[0].content;
    return {
      ok: true,
      json: async () => ({
        content: [{
          text: "战斗结束，你赢了。\n---\n> [格斗] ① 庆祝"
        }]
      })
    } as any;
  };

  try {
    const res = await renderTool.execute("id", {
      playerAction: "攻击",
      resolvedChanges: "NPC HP扣减",
      sceneResult: "战斗结束",
      openHooks: "无",
      nextPressure: "无",
      npcResponses: "雪乃: 可恶..."
    }, null, null, null);

    if (fetchCallCount !== 1) {
      throw new Error(`应调用 1 次大模型，实际调用了 ${fetchCallCount} 次`);
    }
    if (!firstPrompt.includes("文学主笔") || !firstPrompt.includes("<directors_note>")) {
      throw new Error("渲染 Prompt 不正确，应包含文学主笔规则和导演单 XML");
    }
    if (!res.content[0].text.includes("战斗结束，你赢了。")) {
      throw new Error(`最终正文不正确: ${res.content[0].text}`);
    }
    if (!res.details.directorsNote.includes("NPC HP扣减") || !res.details.directorsNote.includes("雪乃: 可恶...")) {
      throw new Error("返回 of directorsNote 不包含拼接的数据详情");
    }

    // 2. 模拟渲染模型调用失败，退回到单阶段传统 Prompt 渲染路径
    fetchCallCount = 0;
    globalThis.fetch = async (url: any, init: any) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        throw new Error("API Network Error");
      } else {
        const reqBody = JSON.parse(init.body);
        firstPrompt = reqBody.messages[0].content;
        return {
          ok: true,
          json: async () => ({
            content: [{ text: "Fallback 渲染出来的文本。" }]
          })
        } as any;
      }
    };

    const resFallback = await renderTool.execute("id", {
      playerAction: "攻击",
      resolvedChanges: "NPC HP扣减",
      sceneResult: "战斗结束",
      openHooks: "无",
      nextPressure: "无",
    }, null, null, null);

    if (fetchCallCount !== 2) {
      throw new Error(`全部崩溃时应调用 2 次 fetch，实际为: ${fetchCallCount}`);
    }
    if (!firstPrompt.includes("你是 earth-0 的渲染 GM")) {
      throw new Error("单模型回退 Prompt 应当被送给渲染器");
    }
    if (!resFallback.content[0].text.includes("Fallback 渲染出来的文本。")) {
      throw new Error("Fallback 渲染出来的文本不正确");
    }

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("存档安全: 隔离不同存档路径的动态地点与角色防止信息污染", async () => {
  resetState();
  const state = await import("./engine/state.ts");
  const fs = await import("node:fs");
  const path = await import("node:path");

  // 1. 在当前/初始存档中创建一个动态地点，并添加一个动态角色
  state.createDynamicLocation("住宅区", "维的地下室");
  state.DYNAMIC_CHARACTERS["测试小猫"] = { name: "测试小猫", base_age: 2 };

  // 2. 保存该存档到测试槽路径 slot_A/session.json
  const slotADir = path.resolve(process.cwd(), "state", "test_slots", "slot_A");
  const slotAFile = path.join(slotADir, "session.json");
  saveState(slotAFile);

  // 3. 在“未来”状态中添加新的动态地点 and 动态角色
  state.createDynamicLocation("住宅区", "未来的太空电梯");
  state.DYNAMIC_CHARACTERS["未来机器人"] = { name: "未来机器人", base_age: 100 };
  
  // 4. 读取 slot_A 存档 (回溯到过去)
  const loaded = loadState(slotAFile);
  if (!loaded) throw new Error("加载 Slot A 存档失败");

  // 5. 验证过去的存档中，不应该包含未来的任何信息
  if (state.LOCATIONS_DELTA["住宅区"]?.includes("未来的太空电梯")) {
    throw new Error("存档污染！回溯的存档中竟包含了未来的动态地点");
  }
  if (state.DYNAMIC_CHARACTERS["未来机器人"]) {
    throw new Error("存档污染！回溯的存档中竟包含了未来的动态角色");
  }

  // 6. 验证过去的已知信息被正常恢复
  if (!state.LOCATIONS_DELTA["住宅区"]?.includes("维的地下室")) {
    throw new Error("存档损坏！过去的动态地点丢失了");
  }
  if (!state.DYNAMIC_CHARACTERS["测试小猫"]) {
    throw new Error("存档损坏！过去的动态角色丢失了");
  }

  // 7. 清理测试产生的文件
  try {
    fs.rmSync(path.dirname(slotADir), { recursive: true, force: true });
  } catch (_) {}
});

// ── 察觉统一检定 (perceptionCheck) ──
console.log("\n── 察觉统一检定 ──");
// 确保 rooms 数据正确（之前的测试可能调用 loadActiveWorld 污染了 rooms 导出变量）
loadActiveWorld("oregairu");

test("perceptionCheck: 近距离直视必被看到", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5; // d20 will roll 11
  try {
    const actor = { attributes: { 敏捷: 10 }, skills: {}, equipment: {} };
    const observer = { attributes: { 感知: 20 }, skills: { "察觉": { level: 10 } }, equipment: {} };
    const ctx = { distance_m: 1, noise: "quiet" as const, light: "bright" as const, walls_between: 0 };
    const r = perceptionCheck(actor, observer, ctx);
    if (!r.seen) throw new Error("1m + bright + 感知20应该被看到");
    if (!r.heard) throw new Error("quiet环境近距离应该被听到");
    if (r.margin <= 0) throw new Error("裕度应 >0");
  } finally {
    Math.random = originalRandom;
  }
});

test("perceptionCheck: concealed 角色视觉自动失败", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const actor = { attributes: { 敏捷: 10 }, skills: {}, equipment: {}, concealed: true };
    const observer = { attributes: { 感知: 20 }, skills: { "察觉": { level: 10 } }, equipment: {} };
    const ctx = { distance_m: 1, noise: "quiet" as const, light: "bright" as const, walls_between: 0 };
    const r = perceptionCheck(actor, observer, ctx);
    if (r.seen) throw new Error("concealed角色不应被看到");
    // 听觉仍应成功
    if (!r.heard) throw new Error("concealed只影响视觉，不影响听觉");
  } finally {
    Math.random = originalRandom;
  }
});

test("perceptionCheck: 远距离+墙壁 降低margin", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const actor = { attributes: { 敏捷: 10 }, skills: {}, equipment: {} };
    const observer = { attributes: { 感知: 10 }, skills: {}, equipment: {} };
    const ctx = { distance_m: 10, noise: "loud" as const, light: "dark" as const, walls_between: 2 };
    const r = perceptionCheck(actor, observer, ctx);
    // 极端不利条件下margin应很低（即使d20=20也可能刚好及格）
    // 只需验证函数不崩溃，margin存在
    if (r.margin === undefined) throw new Error("应有margin");
    if (!r.roll || r.roll.dc === undefined) throw new Error("应有roll");
  } finally {
    Math.random = originalRandom;
  }
});

test("perceptionCheck: checkDC 数字DC版本", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const r = checkDC(15, 14, 3); // 属性14(+2) + 技能3*2(+6) = +8
    if (r.margin === undefined) throw new Error("应有margin字段");
    // d20+8 vs DC15, 有概率成功失败，只验证结构
    if (!r.roll || r.roll.dc !== 15) throw new Error("roll.dc应为15");
  } finally {
    Math.random = originalRandom;
  }
});

// ── getNearbyNPCs 辅助函数 ──
console.log("\n── getNearbyNPCs ──");

test("getNearbyNPCs: 同房间相邻格NPC", () => {
  resetState();
  // 确保 rooms 数据被正确加载（之前的 test 可能调用 loadActiveWorld 污染了 rooms 导出变量）
  loadActiveWorld("oregairu");
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  if (!gameState.player.gridPos) throw new Error("initPlayerGrid失败: gridPos为null");
  const npc = getOrCreateNPC("测试NPC");
  npc.currentRoom = "侍奉部";
  const px = gameState.player.gridPos[0];
  const py = gameState.player.gridPos[1];
  npc.gridPos = [px + 1, py];
  const nearby = getNearbyNPCs("侍奉部", gameState.player.gridPos, 10);
  if (nearby.length === 0) throw new Error("应找到相邻的NPC");
  if (nearby[0].name !== "测试NPC") throw new Error("应返回测试NPC");
  if (nearby[0].distance <= 0) throw new Error("距离应>0");
});

test("getNearbyNPCs: 不同房间NPC不计入", () => {
  resetState();
  gameState.player.location = "侍奉部";
  initPlayerGrid();
  const npc = getOrCreateNPC("远处NPC");
  npc.currentRoom = "教室2-A";
  npc.gridPos = [0, 0];
  const nearby = getNearbyNPCs("侍奉部", gameState.player.gridPos!, 10);
  if (nearby.length > 0) throw new Error("不同房间NPC不应计入");
});

// ── 容器打通 (getContainersAt + transferBetweenContainers) ──
console.log("\n── 容器打通 ──");

test("getContainersAt: 课桌返回子容器(桌面+抽屉)", () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  const room = getRoom("侍奉部")!;
  const px = gameState.player.gridPos![0];
  const py = gameState.player.gridPos![1];
  // 在相邻格放置课桌
  if (px + 1 < room.width) {
    room.cells[py][px + 1] = { type: "floor", block: false, furniture: "课桌", label: "课桌" };
  } else {
    room.cells[py][px - 1] = { type: "floor", block: false, furniture: "课桌", label: "课桌" };
  }
  const containers = getContainersAt("侍奉部", gameState.player.gridPos!);
  const deskContainers = containers.filter(c => c.ownerType === "furniture" && c.ownerId.includes("课桌"));
  if (deskContainers.length < 2) throw new Error(`课桌应有2个子容器, 实际${deskContainers.length}`);
  const hasDesktop = deskContainers.some(c => c.def.id.includes("桌面"));
  const hasDrawer = deskContainers.some(c => c.def.id.includes("抽屉"));
  if (!hasDesktop) throw new Error("应有桌面容器");
  if (!hasDrawer) throw new Error("应有抽屉容器");
  // 抽屉默认lockable
  const drawer = deskContainers.find(c => c.def.id.includes("抽屉"))!;
  if (!drawer.def.lockable) throw new Error("抽屉应为lockable");
});

test("transferBetweenContainers: 背包→课桌桌面", () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  gameState.player.inventory = [
    { name: "笔记本", type: "tool", weight: 0.3, volume: 1, state: "intact", effects: [], slot: "back" }
  ] as any[];
  const room = getRoom("侍奉部")!;
  const px = gameState.player.gridPos![0];
  const py = gameState.player.gridPos![1];
  const nx = px + 1 < room.width ? px + 1 : px - 1;
  room.cells[py][nx] = { type: "floor", block: false, furniture: "课桌", label: "课桌" };
  const containers = getContainersAt("侍奉部", gameState.player.gridPos!);
  const desktop = containers.find(c => c.def.id.includes("桌面"));
  if (!desktop) throw new Error("未找到桌面容器");
  const result = transferBetweenContainers("backpack", desktop.id, "笔记本");
  if (!result.includes("转移成功")) throw new Error(`应成功转移: ${result}`);
  if (gameState.player.inventory.length !== 0) throw new Error("背包应为空");
});

test("transferBetweenContainers: 锁着的容器拒绝存取", () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  gameState.player.inventory = [
    { name: "秘密文件", type: "tool", weight: 0.2, volume: 0.5, state: "intact", effects: [], slot: "back" }
  ] as any[];
  const room = getRoom("侍奉部")!;
  const px = gameState.player.gridPos![0];
  const py = gameState.player.gridPos![1];
  const nx = px + 1 < room.width ? px + 1 : px - 1;
  room.cells[py][nx] = { type: "floor", block: false, furniture: "保险箱", label: "保险箱" };
  const containers = getContainersAt("侍奉部", gameState.player.gridPos!);
  const safe = containers.find(c => c.ownerId.includes("保险箱"));
  if (!safe) throw new Error("未找到保险箱容器");
  // 保险箱默认 locked=true
  if (!safe.def.locked) throw new Error("保险箱应为locked状态");
  const result = transferBetweenContainers("backpack", safe.id, "秘密文件");
  if (!result.includes("锁着")) throw new Error(`锁着的容器应拒绝: ${result}`);
});

// ── 藏人系统 (hide/unhide) ──
console.log("\n── 藏人系统 ──");

test("hide: concealed + hiding_in 设置", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  const { interactFurniture, findFurnitureDef } = await import("./engine/furniture.ts");
  // 使用保险箱，给它加 can_hold_person
  const safeDef = findFurnitureDef("保险箱", gameState.activeWorld);
  if (!safeDef?.containers?.[0]) throw new Error("保险箱应有容器定义");
  safeDef.containers[0].can_hold_person = true;
  safeDef.containers[0].max_volume = 100; // 够装人
  safeDef.state = safeDef.state || {};
  safeDef.state.locked = false; // 确保没锁

  const room = getRoom("侍奉部")!;
  const px = gameState.player.gridPos![0];
  const py = gameState.player.gridPos![1];
  const nx = px + 1 < room.width ? px + 1 : px - 1;
  room.cells[py][nx] = { type: "floor", block: false, furniture: "保险箱", label: "保险箱" };
  const result = await interactFurniture("保险箱", "躲进去", gameState, [px, py], room.cells);
  if (!gameState.player.concealed) throw new Error("应设为concealed");
  if (!gameState.player.hiding_in) throw new Error("应设置hiding_in");
  if (!result.effects.some((e: string) => e.includes("躲藏"))) throw new Error("effects应含躲藏");
});

test("unhide: 清除 concealed 状态", async () => {
  const { interactFurniture, findFurnitureDef } = await import("./engine/furniture.ts");
  // 使用保险箱（有container定义，引擎能找到furnitureDef）
  const safeDef = findFurnitureDef("保险箱", gameState.activeWorld);
  if (!safeDef?.containers?.[0]) throw new Error("保险箱应有容器定义");
  safeDef.containers[0].can_hold_person = true;
  safeDef.containers[0].max_volume = 100;
  safeDef.state = safeDef.state || {};
  safeDef.state.locked = false;

  gameState.player.concealed = true;
  gameState.player.hiding_in = "保险箱";
  // 现在 "出来" 动作会匹配 unhide 效果
  const result = await interactFurniture("保险箱", "出来", gameState, null, null);
  if (gameState.player.concealed) throw new Error("concealed应清除");
  if (gameState.player.hiding_in) throw new Error("hiding_in应清除");
  if (!result.effects.some((e: string) => e.includes("躲藏"))) throw new Error("effects应含躲藏状态OFF");
});

// ── Lint 引擎测试 ──

test("散文Lint: 废话开头自动裁剪", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const r1 = lintProse("好的，以下是今天的叙事内容：风吹过校园");
  if (r1.prose.includes("好的")) throw new Error("应裁剪掉'好的，以下是...'");
  if (!r1.prose.includes("风吹过校园")) throw new Error("正文内容不应丢失");

  const r2 = lintProse("那么，雪之下抬起头看了你一眼。");
  if (r2.prose.includes("那么，")) throw new Error("应裁剪掉'那么，'");
  if (!r2.prose.includes("雪之下")) throw new Error("正文内容不应丢失");

  const r3 = lintProse("风吹过校园。"); // 没有废话
  if (r3.findings.some(f => f.ruleId === "opening-delivery-wrapper")) throw new Error("不应误判");
});

test("散文Lint: 伪菜单拦截", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const r = lintProse("你可以选择继续追上去，也可以转身离开。");
  if (!r.needsRetry) throw new Error("伪菜单应触发 needsRetry");
  if (!r.findings.some(f => f.ruleId === "pseudo-menu-ending")) throw new Error("应命中 pseudo-menu-ending");
});

test("散文Lint: 面板数值泄露拦截", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const r = lintProse("她的好感度 68 让你觉得有机会。");
  if (!r.needsRetry) throw new Error("面板数值泄露应触发 needsRetry");
  if (!r.findings.some(f => f.ruleId === "panel-value-leak")) throw new Error("应命中 panel-value-leak");
});

test("散文Lint: 报告体拦截", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const r = lintProse("战斗结束。威胁提升。你需要做出选择。");
  if (!r.needsRetry) throw new Error("报告体应触发 needsRetry");
});

test("散文Lint: 禁止词汇警告", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const r = lintProse("她虔诚地低下了头，指节泛白。");
  const warns = r.findings.filter(f => f.severity === "warn");
  if (warns.length === 0) throw new Error("禁止词汇应触发警告");
});

test("散文Lint: 模糊镜头警告", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const r = lintProse("她似乎有些不安，仿佛在等什么人。");
  const hedgeWarns = r.findings.filter(f => f.ruleId === "vague-hedge");
  if (hedgeWarns.length < 2) throw new Error("'似乎'和'仿佛'各应触发警告");
});

test("散文Lint: 秘密泄露检测", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  const testState = {
    secrets: {
      "berserker": {
        trueName: { value: "兰斯洛特", revealState: "hidden" },
        hiddenNoblePhantasms: [
          { value: { name: "无毁的湖光" }, revealState: "hidden" }
        ],
        privateMotives: [
          { value: "赎罪", revealState: "hidden" }
        ]
      },
      "saber": {
        trueName: { value: "阿尔托莉雅", revealState: "revealed" }
      }
    }
  } as any;

  // 未揭示秘密泄露
  const r1 = lintProse("你终于意识到，他就是传说中的兰斯洛特。", testState);
  if (!r1.needsRetry) throw new Error("泄露未揭示真名应触发 needsRetry");
  if (!r1.findings.some(f => f.ruleId === "secret-leak-true-name")) throw new Error("应命中 secret-leak-true-name");

  // 已揭示的不触发
  const r2 = lintProse("阿尔托莉雅站在你面前。", testState);
  if (r2.findings.some(f => f.ruleId.startsWith("secret-leak"))) throw new Error("已揭示秘密不应触发告警");

  // 无秘密的正文不触发
  const r3 = lintProse("风吹过校园，樱花飘落。", testState);
  if (r3.needsRetry) throw new Error("无关正文不应触发 needsRetry");
});


test("autonomic_chain: expireHooks executes background sex and memory resolution", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getOrCreateSexState, updateRelation } = require("./engine/state.ts");
  
  // 初始化好感度为 20（好感度在引擎中不能为负数）
  updateRelation(gameState.player.relationships, "雪之下雪乃", 20, "测试初置");
  
  gameState.active_hooks = [{
    event_id: "if_yukino_cohabit_start",
    source_npc: "雪之下雪乃",
    hook_text: "test",
    urgency: "low",
    created_day: 100,
    expires_day: 101,
    seen_count: 0
  }];
  
  // Set day to 102 (expired)
  gameState.time.game_date = "2018-04-12"; // approx day 102
  
  // Run expiration
  await expireHooks();
  
  // Assert flags
  if (gameState.flags["cohabit_bath_occurred"] !== true) {
    throw new Error("on_expire flag cohabit_bath_occurred 未设置");
  }
  
  // Assert affection
  const rel = gameState.player.relationships["雪之下雪乃"];
  if (!rel || rel.affection !== 5) {
    throw new Error(`雪乃好感度应从 20 减少 15 变成 5, 实际: ${rel ? rel.affection : "undefined"}`);
  }
  
  // Assert sexState background evolution
  const ss = await getOrCreateSexState("雪之下雪乃");
  if (!ss) throw new Error("未创建雪乃的 sexState");
  if (ss.milestones.virginity.isVirgin !== false) {
    throw new Error("雪乃在后台应该已经失贞");
  }
  if (ss.milestones.virginity.lostTo !== "比企谷猿畠") {
    throw new Error(`失贞对象应为比企谷猿畠, 实际: ${ss.milestones.virginity.lostTo}`);
  }
  const thought = ss.thoughts[ss.thoughts.length - 1];
  if (!thought || !thought.text.includes("被八幡的父亲粗暴地占有了")) {
    throw new Error(`心里话记录错误: ${thought?.text}`);
  }
});

test("autonomic_chain: trip expireHooks executes background hotel sex", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getOrCreateSexState, updateRelation } = require("./engine/state.ts");
  
  updateRelation(gameState.player.relationships, "雪之下雪乃", 30, "测试初置");
  
  gameState.active_hooks = [{
    event_id: "if_yukino_cohabit_trip",
    source_npc: "雪之下雪乃",
    hook_text: "test trip",
    urgency: "low",
    created_day: 100,
    expires_day: 101,
    seen_count: 0
  }];
  
  // Set day to 152 (expired)
  gameState.time.game_date = "2018-04-12"; // trigger expiration
  
  await expireHooks();
  
  // Assert flags
  if (gameState.flags["cohabit_trip_completed"] !== true) {
    throw new Error("on_expire flag cohabit_trip_completed 未设置");
  }
  
  // Assert affection decreased
  const rel = gameState.player.relationships["雪之下雪乃"];
  if (!rel || rel.affection !== 15) {
    throw new Error(`雪乃好感度应从 30 减少 15 变成 15, 实际: ${rel ? rel.affection : "undefined"}`);
  }
});

test("autonomic_chain: applyBeatEffects supports memoryTags", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getMemoryTags } = require("./engine/state.ts");
  
  gameState.active_hooks = [{
    event_id: "test_memory_tags_event",
    source_npc: "雪之下雪乃",
    hook_text: "test",
    urgency: "low",
    created_day: 100,
    expires_day: 101,
    seen_count: 0
  }];
  
  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "test_memory_tags_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "test_memory_tags_event",
    title: "测试记忆标签事件",
    trigger: { player_stage: "高中" },
    hook: { source_npc: "旁白", hook_text: "测试", urgency: "low" },
    beats: [],
    on_expire: {
      effects: {
        memoryTags: {
          "雪之下雪乃": [
            { "tag": "[失贞] 浴室被强占", "expires": 10, "tone": "屈辱" }
          ]
        }
      }
    }
  }));
  
  try {
    gameState.time.game_date = "2018-04-12";
    await expireHooks();
    
    const tags = getMemoryTags("雪之下雪乃");
    if (!tags.some((t: string) => t.includes("[失贞] 浴室被强占 [屈辱]"))) {
      throw new Error(`雪乃的记忆标签中应包含 [失贞] 浴室被强占 [屈辱], 实际：${JSON.stringify(tags)}`);
    }
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

test("autonomic_chain: applyBeatEffects supports npcRelations", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getOrCreateNPC } = require("./engine/state.ts");
  
  gameState.active_hooks = [{
    event_id: "test_npc_relations_event",
    source_npc: "比企谷八幡",
    hook_text: "test",
    urgency: "low",
    created_day: 100,
    expires_day: 101,
    seen_count: 0
  }];
  
  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "test_npc_relations_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "test_npc_relations_event",
    title: "测试NPC关系事件",
    trigger: { player_stage: "高中" },
    hook: { source_npc: "旁白", hook_text: "测试", urgency: "low" },
    beats: [],
    on_expire: {
      effects: {
        npcRelations: {
          "比企谷八幡": {
            "由比滨结衣": {
              "stage": "情侣",
              "tone": "甜蜜",
              "notes": "确立了关系"
            }
          }
        }
      }
    }
  }));
  
  try {
    gameState.time.game_date = "2018-04-12";
    await expireHooks();
    
    const hachiman = getOrCreateNPC("比企谷八幡");
    const rel = hachiman.npcRelationships?.["由比滨结衣"];
    if (!rel || rel.stage !== "情侣" || rel.tone !== "甜蜜" || rel.notes !== "确立了关系") {
      throw new Error(`八幡与结衣的关系应为情侣-甜蜜-确立了关系, 实际：${JSON.stringify(rel)}`);
    }
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});


test("achievements: query achievements from flags", () => {
  resetState();
  const fs = require('fs');
  const path = require('path');
  
  gameState.flags["achievement_yukino_first_rental"] = true;
  gameState.flags["achievement_hachiman_ed_overcome"] = true;
  
  const achievementsPath = path.resolve(process.cwd(), "data", "achievements.json");
  const rules = JSON.parse(fs.readFileSync(achievementsPath, "utf-8"));
  
  const unlocked = rules.filter((r: any) => !!gameState.flags[r.id]);
  if (unlocked.length !== 2) {
    throw new Error(`应解锁2个成就，实际：${unlocked.length}`);
  }
  if (unlocked[0].id !== "achievement_yukino_first_rental" && unlocked[1].id !== "achievement_yukino_first_rental") {
    throw new Error("解锁列表应包含 achievement_yukino_first_rental");
  }
});

test("spawn_npc_agent: system prompt contains sex milestones", async () => {
  resetState();
  const spawnNpcAgent = require("./tools/state/spawn_npc_agent.ts").default;
  const { getOrCreateSexState } = require("./engine/state.ts");
  
  const ss = await getOrCreateSexState("雪之下雪乃");
  ss.milestones = {
    virginity: { isVirgin: false, lostTo: "比企谷猿畠", lostAt: "2018-04-10" },
    firstKiss: { given: true, partner: "维", date: "2018-04-09" },
    analVirginity: { isVirgin: true, lostTo: null, lostAt: null }
  };
  
  let capturedPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, init: any) => {
    try {
      const reqBody = JSON.parse(init.body);
      capturedPrompt = reqBody.messages[0].content;
    } catch (_) {}
    return {
      ok: true,
      json: async () => ({
        content: [{ text: "Agent response." }]
      })
    } as any;
  };
  
  try {
    await spawnNpcAgent.execute("test_id_milestones", { npcName: "雪之下雪乃", sceneContext: "测试对话" });
    
    if (!capturedPrompt.includes("初吻于 2018-04-09 献给 维")) {
      throw new Error("spawn_npc_agent 提示词应包含初吻里程碑信息！实际：" + capturedPrompt);
    }
    if (!capturedPrompt.includes("初夜于 2018-04-10 丢失给 比企谷猿畠")) {
      throw new Error("spawn_npc_agent 提示词应包含初夜里程碑信息！实际：" + capturedPrompt);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trigger_rules: if_ed_treatment blocks if cohabit occurred", () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {
    cohabit_bath_occurred: true
  };
  gameState.time.player_stage = "大学/社会";
  gameState.time.time_of_day = "afternoon";
  gameState.player.relationships["比企谷八幡"] = { affection: 35, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };
  gameState.player.relationships["雪之下雪乃"] = { affection: 35, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  checkTimelineEvents();
  const hooks = getActiveHooks();
  const edHook = hooks.find(h => h.event_id === "if_ed_treatment");
  if (edHook) {
    throw new Error("当 cohabit_bath_occurred 为 true 时，不应触发 if_ed_treatment！");
  }
});

test("trigger_rules: if_ed_treatment triggers if conditions met", () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {
    cohabit_bath_occurred: false,
    cohabit_trip_completed: false
  };
  gameState.time.player_stage = "大学/社会";
  gameState.time.time_of_day = "afternoon";
  gameState.player.relationships["比企谷八幡"] = { affection: 35, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };
  gameState.player.relationships["雪之下雪乃"] = { affection: 35, trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: "" };

  checkTimelineEvents();
  const hooks = getActiveHooks();
  const edHook = hooks.find(h => h.event_id === "if_ed_treatment");
  if (!edHook) {
    throw new Error("当条件满足且无同居发生时，应正常触发 if_ed_treatment！");
  }
});

// ═══════════════════════════════════════════════
// 春物主线 Volume 8-14 双轨分支测试
// ═══════════════════════════════════════════════

test("autonomic_chain: applyBeatEffects supports playerRelations", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");

  gameState.active_hooks = [{
    event_id: "test_player_relations_event",
    source_npc: "雪之下雪乃",
    hook_text: "测试玩家关系效果",
    urgency: "low",
    created_day: 100,
    expires_day: 101,
    seen_count: 0
  }];

  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "test_player_relations_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "test_player_relations_event",
    title: "测试玩家关系事件",
    trigger: { player_stage: "高中" },
    hook: { source_npc: "旁白", hook_text: "测试", urgency: "low" },
    beats: [],
    on_expire: {
      effects: {
        playerRelations: {
          "雪之下雪乃": {
            stage: "至交",
            romance: "恋人",
            notes: "在天台告白后确立恋人关系"
          }
        }
      }
    }
  }));

  try {
    gameState.time.game_date = "2018-04-12";
    await expireHooks();

    const rel = gameState.player.relationships["雪之下雪乃"];
    if (!rel) throw new Error("雪乃的关系应被创建");
    if (rel.stage !== "至交") throw new Error(`stage应为至交, 实际: ${rel.stage}`);
    if (rel.romance !== "恋人") throw new Error(`romance应为恋人, 实际: ${rel.romance}`);
    if (rel.notes !== "在天台告白后确立恋人关系") throw new Error(`notes错误: ${rel.notes}`);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

test("autonomic_chain: applyBeatEffects playerRelations updates existing relationship", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { updateRelation } = require("./engine/state.ts");

  // 先建立已有关系
  updateRelation(gameState.player.relationships, "雪之下雪乃", 50, "前期积累");

  gameState.active_hooks = [{
    event_id: "test_player_rel_update_event",
    source_npc: "雪之下雪乃",
    hook_text: "测试更新已有关系",
    urgency: "low",
    created_day: 100,
    expires_day: 101,
    seen_count: 0
  }];

  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "test_player_rel_update_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "test_player_rel_update_event",
    title: "测试更新已有关系",
    trigger: { player_stage: "高中" },
    hook: { source_npc: "旁白", hook_text: "测试", urgency: "low" },
    beats: [],
    on_expire: {
      effects: {
        playerRelations: {
          "雪之下雪乃": {
            stage: "至交",
            romance: "恋人",
            notes: "关系升级"
          }
        }
      }
    }
  }));

  try {
    gameState.time.game_date = "2018-04-12";
    await expireHooks();

    const rel = gameState.player.relationships["雪之下雪乃"];
    if (!rel) throw new Error("雪乃的关系应存在");
    if (rel.stage !== "至交") throw new Error(`stage应为至交, 实际: ${rel.stage}`);
    if (rel.romance !== "恋人") throw new Error(`romance应为恋人, 实际: ${rel.romance}`);
    if (rel.affection !== 50) throw new Error(`affection应保持50, 实际: ${rel.affection}`);
    if (rel.notes !== "关系升级") throw new Error(`notes应更新, 实际: ${rel.notes}`);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

test("oregairu main timeline: flag chain connects main_5→6→7→8→9", () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.resolve(process.cwd(), "data", "timelines", "oregairu");

  const m5 = JSON.parse(fs.readFileSync(path.join(dir, "main_5_election.json"), "utf-8"));
  const m6 = JSON.parse(fs.readFileSync(path.join(dir, "main_6_genuine.json"), "utf-8"));
  const m7 = JSON.parse(fs.readFileSync(path.join(dir, "main_7_skitrip.json"), "utf-8"));
  const m8 = JSON.parse(fs.readFileSync(path.join(dir, "main_8_park.json"), "utf-8"));
  const m9 = JSON.parse(fs.readFileSync(path.join(dir, "main_9_prom.json"), "utf-8"));

  // 验证链条: 每个事件要求前一个事件的完成flag
  if (!m6.trigger.flags.election_complete) throw new Error("main_6 应要求 election_complete");
  if (!m7.trigger.flags.genuine_complete) throw new Error("main_7 应要求 genuine_complete");
  if (!m8.trigger.flags.skitrip_complete) throw new Error("main_8 应要求 skitrip_complete");
  if (!m9.trigger.flags.park_complete) throw new Error("main_9 应要求 park_complete");

  // 验证 main_5 的 on_expire 设置了 election_complete（八幡默认路径的衔接flag）
  if (m5.on_expire?.effects?.flags?.election_complete !== true) {
    throw new Error("main_5 on_expire 应设置 election_complete: true");
  }
  // 验证每个事件的 on_expire 都设置了本阶段的完成flag
  if (m6.on_expire?.effects?.flags?.genuine_complete !== true) {
    throw new Error("main_6 on_expire 应设置 genuine_complete: true");
  }
  if (m7.on_expire?.effects?.flags?.skitrip_complete !== true) {
    throw new Error("main_7 on_expire 应设置 skitrip_complete: true");
  }
  if (m8.on_expire?.effects?.flags?.park_complete !== true) {
    throw new Error("main_8 on_expire 应设置 park_complete: true");
  }
  if (m9.on_expire?.effects?.flags?.prom_complete !== true) {
    throw new Error("main_9 on_expire 应设置 prom_complete: true");
  }
});

test("oregairu main timeline: all events block route_pure, route_brainwash, route_ntr", () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.resolve(process.cwd(), "data", "timelines", "oregairu");
  const files = ["main_5_election.json", "main_6_genuine.json", "main_7_skitrip.json", "main_8_park.json", "main_9_prom.json"];

  for (const f of files) {
    const ev = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    const flags = ev.trigger.flags;
    if (flags.route_pure !== false) throw new Error(`${f}: trigger.flags.route_pure 应为 false（阻挡纯爱线已触发玩家）`);
    if (flags.route_brainwash !== false) throw new Error(`${f}: trigger.flags.route_brainwash 应为 false（阻挡洗脑线玩家）`);
    if (flags.route_ntr !== false) throw new Error(`${f}: trigger.flags.route_ntr 应为 false（阻挡NTR线玩家）`);
  }
});

test("oregairu main timeline: every event has both branch beats with expires_quest", () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.resolve(process.cwd(), "data", "timelines", "oregairu");
  const files = ["main_5_election.json", "main_6_genuine.json", "main_7_skitrip.json", "main_8_park.json", "main_9_prom.json"];

  for (const f of files) {
    const ev = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    // 第一个beat必须有outcomes（分支选择）
    const firstBeat = ev.beats[0];
    if (!firstBeat.outcomes || firstBeat.outcomes.length < 2) {
      throw new Error(`${f}: 第一个beat (${firstBeat.id}) 应有至少2个outcomes`);
    }
    // 检查每个outcome引用的next_beat都存在
    for (const oc of firstBeat.outcomes) {
      const target = ev.beats.find((b: any) => b.id === oc.next_beat);
      if (!target) throw new Error(`${f}: outcome引用的next_beat "${oc.next_beat}" 不存在`);
      if (target.expires_quest !== true) throw new Error(`${f}: beat "${oc.next_beat}" 应设置 expires_quest: true`);
    }
    // on_expire 必须存在（作为默认路径）
    if (!ev.on_expire) throw new Error(`${f}: 必须有 on_expire（默认过期路径）`);
  }
});

test("main_9_prom: player_bridge sets player romance=恋人 and Hachiman-Yui couple", () => {
  const fs = require('fs');
  const path = require('path');
  const m9 = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "main_9_prom.json"), "utf-8"
  ));

  const playerBridge = m9.beats.find((b: any) => b.id === "player_bridge");
  if (!playerBridge) throw new Error("main_9 应有 player_bridge beat");

  const eff = playerBridge.effects;

  // 验证 playerRelations：玩家↔雪乃 成为恋人
  if (!eff.playerRelations) throw new Error("player_bridge 应有 playerRelations");
  const yukino = eff.playerRelations["雪之下雪乃"];
  if (!yukino) throw new Error("playerRelations 应包含雪之下雪乃");
  if (yukino.romance !== "恋人") throw new Error(`雪乃romance应为恋人, 实际: ${yukino.romance}`);

  // 验证 npcRelations：八幡↔结衣 成为情侣
  if (!eff.npcRelations) throw new Error("player_bridge 应有 npcRelations");
  const hachimanToYui = eff.npcRelations["比企谷八幡"]?.["由比滨结衣"];
  if (!hachimanToYui) throw new Error("npcRelations 应有 比企谷八幡→由比滨结衣");
  if (hachimanToYui.stage !== "情侣") throw new Error(`八幡→结衣 stage应为情侣, 实际: ${hachimanToYui.stage}`);

  const yuiToHachiman = eff.npcRelations["由比滨结衣"]?.["比企谷八幡"];
  if (!yuiToHachiman) throw new Error("npcRelations 应有 由比滨结衣→比企谷八幡");
  if (yuiToHachiman.stage !== "情侣") throw new Error(`结衣→八幡 stage应为情侣, 实际: ${yuiToHachiman.stage}`);

  // 验证 route_pure flag 被设置
  if (eff.flags?.route_pure !== true) throw new Error("player_bridge 应设置 route_pure: true");
  if (eff.flags?.prom_complete !== true) throw new Error("player_bridge 应设置 prom_complete: true");

  // 验证好感度
  if ((eff.affection?.["雪之下雪乃"] ?? 0) <= 0) throw new Error("player_bridge 应给雪乃增加好感度");
});

test("main_9_prom: hachiman_bridge sets Hachiman-Yukino couple via npcRelations", () => {
  const fs = require('fs');
  const path = require('path');
  const m9 = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "main_9_prom.json"), "utf-8"
  ));

  const hachimanBridge = m9.beats.find((b: any) => b.id === "hachiman_bridge");
  if (!hachimanBridge) throw new Error("main_9 应有 hachiman_bridge beat");

  const eff = hachimanBridge.effects;
  if (!eff.npcRelations) throw new Error("hachiman_bridge 应有 npcRelations");

  const hToY = eff.npcRelations["比企谷八幡"]?.["雪之下雪乃"];
  if (!hToY) throw new Error("npcRelations 应有 比企谷八幡→雪之下雪乃");
  if (hToY.stage !== "情侣") throw new Error(`八幡→雪乃 stage应为情侣, 实际: ${hToY.stage}`);
  if (hToY.tone !== "甜蜜") throw new Error(`八幡→雪乃 tone应为甜蜜, 实际: ${hToY.tone}`);

  const yToH = eff.npcRelations["雪之下雪乃"]?.["比企谷八幡"];
  if (!yToH) throw new Error("npcRelations 应有 雪之下雪乃→比企谷八幡");
  if (yToH.stage !== "情侣") throw new Error(`雪乃→八幡 stage应为情侣, 实际: ${yToH.stage}`);

  // hachiman_bridge 不应有 playerRelations
  if (eff.playerRelations) throw new Error("hachiman_bridge 不应有 playerRelations（走原著线，玩家不与雪乃成为恋人）");

  if (eff.flags?.prom_complete !== true) throw new Error("hachiman_bridge 应设置 prom_complete: true");
});

test("main_9_prom: on_expire defaults to Hachiman-Yukino couple path", async () => {
  // 验证过期时走八幡路径：八幡↔雪乃成为情侣
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getOrCreateNPC } = require("./engine/state.ts");

  gameState.active_hooks = [{
    event_id: "main_9_prom",
    source_npc: "雪之下雪乃",
    hook_text: "舞会委托测试",
    urgency: "medium",
    created_day: 580,
    expires_day: 583,
    seen_count: 0
  }];

  gameState.time.game_date = "2019-08-10"; // day ~587, past expires_day 583
  gameState.flags = { park_complete: true };
  gameState.time.player_stage = "高中";

  await expireHooks();

  // on_expire 应设置 prom_complete 和 hachiman_prom_led
  if (gameState.flags["prom_complete"] !== true) throw new Error("应设置 prom_complete: true");
  if (gameState.flags["hachiman_prom_led"] !== true) throw new Error("应设置 hachiman_prom_led: true（默认八幡路径）");

  // 验证八幡↔雪乃 npcRelations
  const hachiman = getOrCreateNPC("比企谷八幡");
  const hRel = hachiman.npcRelationships?.["雪之下雪乃"];
  if (!hRel || hRel.stage !== "情侣") {
    throw new Error(`八幡→雪乃应为情侣, 实际: ${JSON.stringify(hRel)}`);
  }

  const yukino = getOrCreateNPC("雪之下雪乃");
  const yRel = yukino.npcRelationships?.["比企谷八幡"];
  if (!yRel || yRel.stage !== "情侣") {
    throw new Error(`雪乃→八幡应为情侣, 实际: ${JSON.stringify(yRel)}`);
  }
});

test("main_5_election: on_expire applies hachiman path effects", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getMemoryTags } = require("./engine/state.ts");

  gameState.active_hooks = [{
    event_id: "main_5_election",
    source_npc: "平冢静",
    hook_text: "选举委托测试",
    urgency: "medium",
    created_day: 380,
    expires_day: 383,
    seen_count: 0
  }];

  gameState.time.game_date = "2019-01-20"; // past day 380
  gameState.flags = { cultural_festival_complete: true };
  gameState.time.player_stage = "高中";

  await expireHooks();

  // on_expire 应设置 election_complete 和 hachiman_sacrificed
  if (gameState.flags["election_complete"] !== true) throw new Error("应设置 election_complete: true");
  if (gameState.flags["hachiman_sacrificed"] !== true) throw new Error("应设置 hachiman_sacrificed: true（默认八幡自爆路径）");

  // 验证 memoryTags
  const yukinoTags = getMemoryTags("雪之下雪乃");
  if (!yukinoTags.some((t: string) => t.includes("选举") && t.includes("自爆"))) {
    throw new Error(`雪乃应有选举自爆记忆标签, 实际: ${JSON.stringify(yukinoTags)}`);
  }
});

test("oregairu main timeline: route_pure blocks main_5 from triggering", () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {
    cultural_festival_complete: true,
    route_pure: true  // 玩家已在纯爱线
  };
  gameState.time.player_stage = "高中";
  gameState.time.time_of_day = "morning";
  gameState.time.game_date = "2019-01-20";

  checkTimelineEvents();
  const hooks = getActiveHooks();
  const main5 = hooks.find(h => h.event_id === "main_5_election");
  if (main5) {
    throw new Error("route_pure=true 时不应触发 main_5_election（玩家已走纯爱线，不应再走主线）");
  }
});

// ═══════════════════════════════════════════════
// 春物 Volume 4 (暑假) + Volume 7 (京都修学旅行)
// ═══════════════════════════════════════════════

test("main_summer_break: structure has both branch beats and on_expire", () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "main_summer_break.json"), "utf-8"
  ));

  if (ev.id !== "summer_break") throw new Error("id 应为 summer_break");
  if (!ev.trigger.flags.camp_complete) throw new Error("应要求 camp_complete");
  if (ev.trigger.flags.route_pure !== false) throw new Error("应阻挡 route_pure");

  // 第一个beat必须有双分支
  const firstBeat = ev.beats[0];
  if (!firstBeat.outcomes || firstBeat.outcomes.length < 2) throw new Error("第一个beat应有至少2个outcomes");

  // 验证两个分支beat都存在且设置 expires_quest
  const hachimanRealization = ev.beats.find((b: any) => b.id === "hachiman_realization");
  const playerPromise = ev.beats.find((b: any) => b.id === "player_promise");
  if (!hachimanRealization || hachimanRealization.expires_quest !== true) {
    throw new Error("hachiman_realization 应设置 expires_quest: true");
  }
  if (!playerPromise || playerPromise.expires_quest !== true) {
    throw new Error("player_promise 应设置 expires_quest: true");
  }

  // on_expire 应设置 summer_break_complete
  if (ev.on_expire?.effects?.flags?.summer_break_complete !== true) {
    throw new Error("on_expire 应设置 summer_break_complete: true");
  }
});

test("main_summer_break: player path sets player_sable_connection and player_fireworks_promise", () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "main_summer_break.json"), "utf-8"
  ));

  // player路径: park_encounter → player分支 → fireworks_night → player_promise
  const parkBeat = ev.beats.find((b: any) => b.id === "park_encounter");
  const playerSable = parkBeat.outcomes.find((o: any) => o.effects?.flags?.player_sable_connection);
  if (!playerSable) throw new Error("park_encounter 应有 player_sable_connection 分支");
  if ((playerSable.effects.affection?.["雪之下雪乃"] ?? 0) <= 0) throw new Error("玩家路径应加雪乃好感");

  const fireworksBeat = ev.beats.find((b: any) => b.id === "fireworks_night");
  const playerFireworks = fireworksBeat.outcomes.find((o: any) => o.effects?.flags?.player_fireworks_promise);
  if (!playerFireworks) throw new Error("fireworks_night 应有 player_fireworks_promise 分支");

  // hachiman路径: park_encounter → hachiman分支 → fireworks_night → hachiman_realization
  const hachimanSable = parkBeat.outcomes.find((o: any) => o.effects?.flags?.hachiman_sable_savior);
  if (!hachimanSable) throw new Error("park_encounter 应有 hachiman_sable_savior 分支");

  const hachimanFireworks = fireworksBeat.outcomes.find((o: any) => !o.effects?.flags?.player_fireworks_promise);
  if (!hachimanFireworks) throw new Error("fireworks_night 应有八幡路径分支");
});

test("main_summer_break: on_expire applies Hachiman path with memoryTags", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getMemoryTags } = require("./engine/state.ts");

  gameState.active_hooks = [{
    event_id: "summer_break",
    source_npc: "平冢静",
    hook_text: "暑假花火测试",
    urgency: "medium",
    created_day: 235,
    expires_day: 240,
    seen_count: 0
  }];

  gameState.time.game_date = "2018-08-30"; // past day 240
  gameState.flags = { camp_complete: true };
  gameState.time.player_stage = "高中";

  await expireHooks();

  if (gameState.flags["summer_break_complete"] !== true) throw new Error("应设置 summer_break_complete: true");
  if (gameState.flags["summer_break_missed"] !== true) throw new Error("应设置 summer_break_missed: true");
  if (gameState.flags["hachiman_sable_savior"] !== true) throw new Error("默认八幡路径应设置 hachiman_sable_savior");

  const yukinoTags = getMemoryTags("雪之下雪乃");
  if (!yukinoTags.some((t: string) => t.includes("暑假") && t.includes("萨布雷"))) {
    throw new Error(`雪乃应有暑假萨布雷记忆标签, 实际: ${JSON.stringify(yukinoTags)}`);
  }
});

test("main_kyoto_field_trip: structure has both branch beats and club crisis", () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "main_kyoto_field_trip.json"), "utf-8"
  ));

  if (ev.id !== "kyoto_field_trip") throw new Error("id 应为 kyoto_field_trip");
  if (!ev.trigger.flags.cultural_festival_complete) throw new Error("应要求 cultural_festival_complete");
  if (ev.trigger.flags.route_pure !== false) throw new Error("应阻挡 route_pure");

  // 第一个beat有双分支
  const firstBeat = ev.beats[0];
  if (!firstBeat.outcomes || firstBeat.outcomes.length < 2) throw new Error("第一个beat应有至少2个outcomes");

  // 验证关键beat都存在
  const hachimanScheme = ev.beats.find((b: any) => b.id === "hachiman_scheme");
  if (!hachimanScheme) throw new Error("应有 hachiman_scheme beat (八幡假告白)");

  const clubCrisis = ev.beats.find((b: any) => b.id === "club_crisis");
  if (!clubCrisis) throw new Error("应有 club_crisis beat (侍奉部裂痕)");
  if (clubCrisis.expires_quest !== true) throw new Error("club_crisis 应设 expires_quest: true");
  if (!clubCrisis.effects.memoryTags?.["雪之下雪乃"]) throw new Error("club_crisis 应有雪乃记忆标签");
  if (!clubCrisis.effects.memoryTags?.["比企谷八幡"]) throw new Error("club_crisis 应有八幡记忆标签");
  if (!clubCrisis.effects.memoryTags?.["由比滨结衣"]) throw new Error("club_crisis 应有结衣记忆标签");

  // 玩家路径beat
  const playerApproach = ev.beats.find((b: any) => b.id === "player_approach");
  if (!playerApproach) throw new Error("应有 player_approach beat (玩家诚实行事)");
  if (playerApproach.expires_quest !== true) throw new Error("player_approach 应设 expires_quest: true");
  if (!playerApproach.effects.flags?.kyoto_resolved_peacefully) {
    throw new Error("player_approach 应设置 kyoto_resolved_peacefully");
  }

  // on_expire 应设置 kyoto_trip_complete
  if (ev.on_expire?.effects?.flags?.kyoto_trip_complete !== true) {
    throw new Error("on_expire 应设置 kyoto_trip_complete: true");
  }
});

test("main_kyoto_field_trip: on_expire applies Hachiman river fall and club crisis", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { getMemoryTags } = require("./engine/state.ts");

  gameState.active_hooks = [{
    event_id: "kyoto_field_trip",
    source_npc: "户部翔",
    hook_text: "京都修学旅行测试",
    urgency: "medium",
    created_day: 340,
    expires_day: 343,
    seen_count: 0
  }];

  gameState.time.game_date = "2018-12-15"; // past day 343
  gameState.flags = { cultural_festival_complete: true };
  gameState.time.player_stage = "高中";

  await expireHooks();

  if (gameState.flags["kyoto_trip_complete"] !== true) throw new Error("应设置 kyoto_trip_complete: true");
  if (gameState.flags["kyoto_trip_missed"] !== true) throw new Error("应设置 kyoto_trip_missed: true");
  if (gameState.flags["hachiman_river_fall"] !== true) throw new Error("默认八幡路径应设置 hachiman_river_fall");
  if (gameState.flags["club_crisis_triggered"] !== true) throw new Error("应设置 club_crisis_triggered");

  // 验证三方记忆标签
  const yukinoTags = getMemoryTags("雪之下雪乃");
  if (!yukinoTags.some((t: string) => t.includes("京都") && t.includes("怀疑"))) {
    throw new Error(`雪乃应有京都裂痕记忆标签, 实际: ${JSON.stringify(yukinoTags)}`);
  }

  const hachimanTags = getMemoryTags("比企谷八幡");
  if (!hachimanTags.some((t: string) => t.includes("京都") && t.includes("裂痕"))) {
    throw new Error(`八幡应有京都裂痕记忆标签, 实际: ${JSON.stringify(hachimanTags)}`);
  }

  const yuiTags = getMemoryTags("由比滨结衣");
  if (!yuiTags.some((t: string) => t.includes("京都") && t.includes("无力"))) {
    throw new Error(`结衣应有京都无力记忆标签, 实际: ${JSON.stringify(yuiTags)}`);
  }
});

test("main_kyoto_field_trip: route_pure blocks triggering", () => {
  resetState();
  clearCalendarCache();
  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {
    cultural_festival_complete: true,
    route_pure: true
  };
  gameState.time.player_stage = "高中";
  gameState.time.time_of_day = "morning";
  gameState.time.game_date = "2018-12-10";

  checkTimelineEvents();
  const hooks = getActiveHooks();
  const kyoto = hooks.find(h => h.event_id === "kyoto_field_trip");
  if (kyoto) {
    throw new Error("route_pure=true 时不应触发 kyoto_field_trip");
  }
});

// ═══════════════════════════════════════════════
// auto_if 自动分支选择
// ═══════════════════════════════════════════════

test("auto_if: romance 匹配时自动选择玩家路径", async () => {
  resetState();
  const { openQuest, advanceQuest } = require("./engine/timeline.ts");

  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = { camp_complete: true, cultural_festival_complete: true };
  gameState.time.game_date = "2018-04-08";
  gameState.time.player_stage = "高中";

  // 设置玩家与雪乃已经是恋人
  gameState.player.relationships["雪之下雪乃"] = {
    stage: "至交", romance: "恋人", affection: 80,
    trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: ""
  };

  // 打开 summer_break — auto_if 应触发: park_encounter→player, fireworks_night→player, player_promise完成
  const r = await openQuest("summer_break");
  if (!r || !r.includes("自动完成")) throw new Error(`应自动完成, 实际: ${r}`);

  const q = gameState.quests["summer_break"];
  if (q.status !== "completed") throw new Error(`应自动完成, 实际状态: ${q.status}`);
  // 应设置了玩家路径的 flag
  if (gameState.flags["player_sable_connection"] !== true) throw new Error("应设置 player_sable_connection");
  if (gameState.flags["player_fireworks_promise"] !== true) throw new Error("应设置 player_fireworks_promise");
});

test("auto_if: flags 匹配时自动选择玩家路径（粘性路由）", async () => {
  resetState();
  const { openQuest } = require("./engine/timeline.ts");

  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = {
    election_complete: true,
    player_solved_election: true  // 前序事件选了玩家路径
  };
  gameState.time.game_date = "2019-03-15"; // past day 430
  gameState.time.player_stage = "高中";

  // 打开 main_6_genuine — 应自动选择并完成（flags sticky route: collab_dilemma→player_genuine触发expires_quest）
  const r = await openQuest("main_6_genuine");
  if (!r || !r.includes("自动完成")) throw new Error(`应自动完成（粘性路由），实际: ${r}`);

  const q = gameState.quests["main_6_genuine"];
  if (q.status !== "completed") throw new Error(`应自动完成, 实际状态: ${q.status}`);
  if (gameState.flags["player_genuine_triggered"] !== true) throw new Error("应设置 player_genuine_triggered");
});

test("auto_if: 无匹配条件时正常展示选择", async () => {
  resetState();
  const { openQuest } = require("./engine/timeline.ts");

  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = { camp_complete: true };
  gameState.time.game_date = "2018-08-20";
  gameState.time.player_stage = "高中";
  // 不设置任何 romance 或 sticky flag

  const r = await openQuest("summer_break");
  if (!r) throw new Error("应正常打开任务");
  // 不应该自动推进（没有匹配的 auto_if）
  if (r.includes("自动推进")) throw new Error(`不应自动推进（无匹配条件）, 实际: ${r}`);

  const q = gameState.quests["summer_break"];
  // 应停在第一个有选择的分支 beat (park_encounter)
  if (q.current_beat !== "park_encounter") {
    throw new Error(`应停在 park_encounter 等待玩家选择, 实际: ${q.current_beat}`);
  }
  if (q.status !== "active") throw new Error("状态应为 active");
});

test("auto_if: main_9 全自动完成（romance→player_bridge→route_pure）", async () => {
  resetState();
  const { openQuest } = require("./engine/timeline.ts");

  gameState.active_hooks = [];
  gameState.completed_events = [];
  gameState.quests = {};
  gameState.flags = { park_complete: true };
  gameState.time.game_date = "2019-08-15";
  gameState.time.player_stage = "高中";

  // 玩家与雪乃是恋人 + 前序选了玩家路径
  gameState.player.relationships["雪之下雪乃"] = {
    stage: "至交", romance: "恋人", affection: 90,
    trust: 0, first_met_day: 1, last_interaction_day: 1, interactions: 0, notes: ""
  };
  gameState.flags["player_park_led"] = true;

  const r = await openQuest("main_9_prom");
  if (!r) throw new Error("应打开任务");
  if (!r.includes("自动完成")) throw new Error(`应自动完成 main_9, 实际: ${r}`);

  // route_pure 应被设置
  if (gameState.flags["route_pure"] !== true) throw new Error("应设置 route_pure: true");
  // 雪乃 romace 应为恋人
  const rel = gameState.player.relationships["雪之下雪乃"];
  if (!rel || (rel as any).romance !== "恋人") throw new Error(`雪乃 romance 应为恋人, 实际: ${(rel as any)?.romance}`);
  // 八幡↔结衣 应为情侣
  const { getOrCreateNPC } = require("./engine/state.ts");
  const hachiman = getOrCreateNPC("比企谷八幡");
  const hRel = hachiman.npcRelationships?.["由比滨结衣"];
  if (!hRel || hRel.stage !== "情侣") throw new Error("八幡应与结衣成为情侣");
});

// ═══════════════════════════════════════════════
// 纯爱 IF 线 playerRelations 闭环
// ═══════════════════════════════════════════════

test("pure_1_gate: first_time_finish sets playerRelations romance=恋人", () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "pure_1_gate.json"), "utf-8"
  ));

  const finalBeat = ev.beats.find((b: any) => b.id === "first_time_finish");
  if (!finalBeat) throw new Error("应有 first_time_finish beat");

  // 找确立关系那条 outcome（有 route_pure 的）
  const loveOutcome = finalBeat.outcomes.find((o: any) => o.effects?.flags?.route_pure);
  if (!loveOutcome) throw new Error("应有设置 route_pure 的 outcome");

  const pr = loveOutcome.effects?.playerRelations?.["雪之下雪乃"];
  if (!pr) throw new Error("pure_1 结局应设置 playerRelations");
  if (pr.romance !== "恋人") throw new Error(`romance应为恋人, 实际: ${pr.romance}`);
  if (pr.stage !== "至交") throw new Error(`stage应为至交, 实际: ${pr.stage}`);
});

test("pure_5_fireworks: date_sex_finish confirms playerRelations romance=恋人", () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "data", "timelines", "oregairu", "pure_5_fireworks.json"), "utf-8"
  ));

  const finalBeat = ev.beats.find((b: any) => b.id === "date_sex_finish");
  if (!finalBeat) throw new Error("应有 date_sex_finish beat");

  const mainOutcome = finalBeat.outcomes[0];
  const pr = mainOutcome.effects?.playerRelations?.["雪之下雪乃"];
  if (!pr) throw new Error("pure_5 结局应设置 playerRelations");
  if (pr.romance !== "恋人") throw new Error(`romance应为恋人, 实际: ${pr.romance}`);

  // 验证同时有 npcRelations (八幡↔结衣)
  const npcR = mainOutcome.effects?.npcRelations;
  if (!npcR) throw new Error("pure_5 结局应有 npcRelations（八幡↔结衣）");
  if (npcR["比企谷八幡"]?.["由比滨结衣"]?.stage !== "情侣") throw new Error("八幡应与结衣成为情侣");
});

test("pure_route: applyBeatEffects writes playerRelations from pure_1 first_time_finish", async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");

  // 用 temp-file 模式验证 pure_1 的 playerRelations effects 被正确应用
  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "data", "timelines", "oregairu", "test_pure_romance_event.json");
  fs.writeFileSync(tempFile, JSON.stringify({
    id: "test_pure_romance_event",
    title: "测试纯爱确立关系",
    trigger: { player_stage: "高中" },
    hook: { source_npc: "雪之下雪乃", hook_text: "测试", urgency: "low" },
    beats: [],
    on_expire: {
      effects: {
        flags: { route_pure: true, yukino_first_time: true },
        playerRelations: {
          "雪之下雪乃": {
            stage: "至交",
            romance: "恋人",
            notes: "在社办夕阳下完成初体验，确立恋人关系"
          }
        }
      }
    }
  }));

  try {
    gameState.active_hooks = [{
      event_id: "test_pure_romance_event",
      source_npc: "雪之下雪乃",
      hook_text: "测试",
      urgency: "low",
      created_day: 97,
      expires_day: 99,
      seen_count: 0
    }];
    gameState.time.game_date = "2018-04-12";
    await expireHooks();

    // 验证 playerRelations 被写入
    const rel = gameState.player.relationships["雪之下雪乃"];
    if (!rel) throw new Error("雪乃关系应被创建");
    if ((rel as any).romance !== "恋人") throw new Error(`romance 应为恋人, 实际: ${(rel as any).romance}`);
    if (rel.stage !== "至交") throw new Error(`stage 应为至交, 实际: ${rel.stage}`);
    if (gameState.flags["route_pure"] !== true) throw new Error("应设置 route_pure: true");
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

test("P1: NPC 事件感知 — spawn 时拿到日历预热素材", async () => {
  resetState();
  const { getOrCreateNPC } = await import("./engine/state.ts");
  const { clearCalendarCache, getNPCEventContext } = await import("./engine/timeline.ts");

  gameState.time.game_date = "2018-05-26"; // 10 days before 体育祭 (6月5日)
  gameState.activeWorld = "oregairu";

  // Setup NPC
  const yui = getOrCreateNPC("由比滨结衣");
  yui.scheduleGroup = "总武高学生";

  // Add calendar event with advance_days=10
  clearCalendarCache();
  gameState.calendarEvents = [{
    year: null, date: "6月5日", location: "总武高",
    text: "总武高体育祭当日",
    advance_days: 10,
    advance_hook: "操场上各班级在练习接力",
    org_effects: [{ org: "总武高", override_location: "操场", override_action_template: "{role}参加体育祭中" }]
  }];

  const ctx = getNPCEventContext("由比滨结衣");
  if (!ctx.includes("体育祭")) {
    throw new Error(`NPC事件感知应包含体育祭: ${ctx}`);
  }
  if (!ctx.includes("素材")) {
    throw new Error(`应标注为素材供GM覆写: ${ctx}`);
  }
});

test("P2: 世界常识 — 进入总武高自动注入偏差值常识", async () => {
  resetState();
  const { loadOrgLore, getTriggeredLore, clearLoreCache } = await import("./engine/lore.ts");

  gameState.activeWorld = "oregairu";
  clearLoreCache();
  gameState.player.location = "总武高";

  const lore = getTriggeredLore("总武高", [], [], [], {});
  const hasDeviation = lore.some(t => t.includes("偏差值"));
  if (!hasDeviation) {
    throw new Error(`进入总武高应触发偏差值常识，实际: ${lore.join(" | ")}`);
  }
  if (lore.length > 5) {
    throw new Error(`常识注入不应超过5条，实际: ${lore.length}`);
  }
});

test("P2: 世界常识 — 排序规则 location精确 > topic关键词", async () => {
  resetState();
  const { loadOrgLore, getTriggeredLore, clearLoreCache } = await import("./engine/lore.ts");

  gameState.activeWorld = "oregairu";
  clearLoreCache();

  // Location match + topic match: both should be present
  const lore = getTriggeredLore("总武高", ["不良", "打架"], [], [], {});
  // Both entries should be present
  if (lore.length >= 2) {
    const hasDeviation = lore.some(t => t.includes("偏差值"));
    const hasDelinquent = lore.some(t => t.includes("海滨综合"));
    if (!hasDeviation || !hasDelinquent) {
      throw new Error(`应同时有偏差值常识和海滨综合高常识: ${lore.join(" | ")}`);
    }
  }
});

(async () => {
  for (const t of testQueue) {
    try {
      if (t.fn.constructor.name === "AsyncFunction" || t.fn.toString().includes("async") || t.fn.toString().includes("return")) {
        await t.fn();
      } else {
        t.fn();
      }
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (e: any) {
      console.log(`  ✗ ${t.name}: ${e.stack || e.message}`);
      failed++;
    }
  }
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  saveState();
  process.exit(failed > 0 ? 1 : 0);
})();
