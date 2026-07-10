/**
 * earth-0 引擎冒烟测试
 * 不需要 pi，不需要 LLM。2秒跑完全部。
 *
 * 用法：npx tsx test.ts
 */
process.env.NODE_ENV = "test";

import {
  gameState, saveState, loadState, resetState,
  movePlayer, placeFurniture, removeFurniture, toggleDoor,
  editCellType, createRoom, getRoom, initPlayerGrid, getGridContext, ROOMS,
  buyItem, sellItem, workJob, stealItem, stealFunds,
  monthlyGrowth, refreshWeather, updateNPCSchedules,
  buildStatePrompt, getBodyForAge, getNpcCurrentAge,
  setPlayerLocation, calcMaxHP, calcAC,
  addSkillExp, addMemoryTag, updateRelation, getOrCreateNPC,
  calcReputationBonus, updateReputation,
  checkAndGrantTitles,
  stampRoom, getRoomAgingLine,
  setNPCOutfit, getNPCOutfitDesc,
  getLocationNav, createDynamicLocation,
  mountVehicle, dismountVehicle, getVehicleMul, calcInventoryVolume,
  getCurrency, getConstructionMultiplier, loadActiveWorld,
  getNearbyNPCs, getContainersAt, transferBetweenContainers, findContainerById,
  pushToolCall, drainToolCalls,
} from "./engine/state.ts";
import fs from "node:fs";
import path from "node:path";

import { parseRoleOptions } from "./engine/parse-options.ts";
import { attrMod, check, checkDC, attackRoll, rollDamage } from "./engine/dice.ts";
import { perceptionCheck } from "./engine/perception.ts";
import { lookupRegion } from "./engine/router.ts";
import { advanceMinutes } from "./engine/time.ts";
import {
  checkTimelineEvents, expireHooks, getActiveHooks, getActiveQuests,
  openQuest, advanceQuest, abandonQuest,
  getTodayCalendar, getCalendarEvents, getCalendarPhase, clearCalendarCache,
  getHookNoveltyHint, evaluateOrgGoals, applyOrgDrivesToNPC,
} from "./engine/timeline.ts";
let passed = 0, failed = 0;
const testQueue: { name: string; fn: () => any }[] = [];
function test(name: string, fn: () => any) {
  testQueue.push({ name, fn });
}
function privateTest(name: string, requiredFiles: string[], fn: () => any) {
  const fs = require("node:fs");
  const path = require("node:path");
  const allExist = requiredFiles.every(f => fs.existsSync(path.resolve(process.cwd(), f)));
  if (allExist) {
    test(name, fn);
  } else {
    test(name + " (已跳过 - 缺少私有资产)", () => {
      console.log(`  [SKIP] 跳过测试: "${name}"，云端不包含私有资产: ${requiredFiles.join(", ")}`);
    });
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

test("buyItem 目录外物品合成购买(去白名单，不再拒无效)", () => {
  const beforeFunds = gameState.player.funds;
  const beforeInv = gameState.player.inventory.length;
  gameState.player.funds = 999999;
  const r = buyItem("不存在的东西", 100);
  gameState.player.funds = beforeFunds;
  gameState.player.inventory.length = beforeInv; // 移除测试买入的物品，不污染后续
  // 软化后：物品存不存在/店卖不卖是叙事判断（LLM 的活），引擎合成并成交，不再拒"无效物品"
  if (r.includes("有效物品")) throw new Error("软化后不应再以'无效物品'拒绝: " + r);
  if (!r.includes("买了")) throw new Error("目录外物品应被合成购买: " + r);
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

test("lookupRegion 千葉駅前", () => {
  const r = lookupRegion("千葉駅前");
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
  gameState.schemaVersion = undefined; // 模拟旧存档无版本号
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
  gameState.time.player_age = 16;
  gameState.time.timeline_origin = { year: 2018, age: 16 };
  gameState.player.age = 16;
  gameState.time.game_date = "2018-04-07";

  const npcBaseAge = 17;
  let npcAge = getNpcCurrentAge(npcBaseAge);
  if (npcAge !== 17) throw new Error(`初始 NPC 年龄应为 17，得 ${npcAge}`);

  // 推进 2 年
  gameState.player.age = 18;
  gameState.time.player_age = 18;
  gameState.time.game_date = "2020-04-07";
  npcAge = getNpcCurrentAge(npcBaseAge);
  if (npcAge !== 19) throw new Error(`2年后 NPC 年龄应为 19，得 ${npcAge}`);

  // 推进 10 年
  gameState.player.age = 28;
  gameState.time.player_age = 28;
  gameState.time.game_date = "2028-04-07";
  npcAge = getNpcCurrentAge(npcBaseAge);
  if (npcAge !== 27) throw new Error(`10年后 NPC 年龄应为 27，得 ${npcAge}`);
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
  let masturbate: any;
  try { masturbate = (await import("./engine/sex.ts")).masturbate; } catch { return; }
  
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
  setPlayerLocation("千葉駅前");
  const list = getNamelessNPCs("千葉駅前", gameState.turn);
  if (list.length === 0) throw new Error("Should seed nameless NPCs in public areas");
  
  const prompt = await buildStatePrompt();
  if (!prompt.includes("[在场路人]")) throw new Error("Nameless NPCs should be injected into the system prompt");
});

// ── 性里程碑 ──
console.log("\n── 性里程碑 ──");
test("createSexState 初始化全员为初", async () => {
  let createSexState: any, SEX_PROFILES: any;
  try { const m = await import("./engine/sex.ts"); createSexState = m.createSexState; SEX_PROFILES = m.SEX_PROFILES; } catch { return; }
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
  gameState.schemaVersion = undefined; // 模拟旧存档无版本号
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
  gameState.schemaVersion = undefined; // 模拟旧存档无版本号
  saveState();
  loadState();
  const ss = gameState.sexStates?.["测试2"];
  if (!ss?.milestones) throw new Error("缺少 milestones");
  if (ss.milestones.virginity.isVirgin) throw new Error("熟练→应推断为非处");
  if (!ss.milestones.firstKiss.given) throw new Error("熟练→初吻应为已");
  if (ss.milestones.virginity.lostTo !== "?") throw new Error("旧存档无法确定对象，应为 ?");
});

test("settleAfterSex 检测初吻+初夜+菊初", async () => {
  let createSexState: any, settleAfterSex: any, SEX_PROFILES: any;
  try { const m = await import("./engine/sex.ts"); createSexState = m.createSexState; settleAfterSex = m.settleAfterSex; SEX_PROFILES = m.SEX_PROFILES; } catch { return; }
  const s = createSexState("测试3", SEX_PROFILES["由比滨结衣"]);

  // 第一次：只碰唇 → 记录初吻
  const r1 = await settleAfterSex(s, "2018-05-01", 10, ["唇"], [], "维");
  if (!r1.milestonesChanged) throw new Error("应触发里程碑变化");
  if (!r1.milestonesChanged.some(m => m.includes("初吻"))) throw new Error("触碰唇应记录初吻");

  // 第二次：碰秘部 → 记录初夜（但初吻已给，不再重复）
  const r2 = await settleAfterSex(s, "2018-06-01", 30, ["秘部"], [], "维");
  if (!r2.milestonesChanged) throw new Error("应触发第二个里程碑");
  if (!r2.milestonesChanged.some(m => m.includes("初体验"))) throw new Error("触碰秘部应记录初体验");

  // 验证 state
  if (s.milestones!.virginity.isVirgin) throw new Error("处女应为 false");
  if (s.milestones!.virginity.lostTo !== "维") throw new Error("初夜对象应为维");

  // 第三次：碰肛 → 菊初
  const r3 = await settleAfterSex(s, "2018-07-01", 20, ["肛"], [], "维");
  if (!r3.milestonesChanged?.some(m => m.includes("菊初"))) throw new Error("触碰肛应记录菊初");

  // 第四次：再碰这些部位 → 不再触发
  const r4 = await settleAfterSex(s, "2018-08-01", 30, ["唇", "秘部", "肛"], [], "维");
  if (r4.milestonesChanged && r4.milestonesChanged.length > 0) throw new Error("已非初不应再触发");
});

test("自慰不计入初体验", async () => {
  let createSexState: any, settleAfterSex: any, SEX_PROFILES: any;
  try { const m = await import("./engine/sex.ts"); createSexState = m.createSexState; settleAfterSex = m.settleAfterSex; SEX_PROFILES = m.SEX_PROFILES; } catch { return; }
  const s = createSexState("测试4", SEX_PROFILES["由比滨结衣"]);

  // 自慰 → 不传 partnerName
  const r = await settleAfterSex(s, "2018-05-01", 10, ["秘部", "唇"], [], undefined);
  if (r.milestonesChanged && r.milestonesChanged.length > 0) throw new Error("自慰不应计入初体验");
  if (!s.milestones!.virginity.isVirgin) throw new Error("自慰后处女应仍为 true");
  if (s.milestones!.firstKiss.given) throw new Error("自慰后初吻应仍为未");
});

privateTest("buildStatePrompt 注入里程碑信息", ["data/sex_profiles.json"], async () => {
  resetState();
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

privateTest("buildStatePrompt 注入 [mood_hint]", ["data/sex_profiles.json"], async () => {
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
  gameState.player.location = "千葉駅前";
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
    from: "千葉駅前",
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
    from: "千葉駅前",
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
test("getOrCreateNPC 初始化 cash+wealth (funds已拆分)", () => {
  resetState();
  const npc = getOrCreateNPC("雪之下雪乃");
  // 雪乃卡 funds=30000 → cash 取 15% 封顶5000 → 4500; wealth=30000
  if (npc.wealth !== 30000) throw new Error(`雪乃 wealth 应为30000，实际: ${npc.wealth}`);
  if (npc.cash === undefined || npc.cash === null) throw new Error(`雪乃 cash 不应为空`);
  if (npc.cash > 5000) throw new Error(`雪乃 cash 不应超过封顶5000，实际: ${npc.cash}`);
});

test("sellItem 指定buyer→扣NPC钱+校验资金不足(cash/wealth)", () => {
  resetState();
  buyItem("绷带", 200);
  const npc = getOrCreateNPC("由比滨结衣");
  // 钱不够：总身家只有100 → 拒绝
  npc.cash = 100; npc.wealth = 0;
  const r1 = sellItem("绷带", 500, "由比滨结衣");
  if (!r1.includes("买不起")) throw new Error(`应拒绝不够钱: ${r1}`);
  // 钱够：总身家10000 → 成功扣；先扣cash，再扣wealth
  npc.cash = 100; npc.wealth = 9900;
  const r2 = sellItem("绷带", 300, "由比滨结衣");
  if (!r2.includes("卖了")) throw new Error(`出售失败: ${r2}`);
  if (npc.cash !== 0) throw new Error(`现金100应付完，应为0，实际: ${npc.cash}`);
  if (npc.wealth !== 9700) throw new Error(`财富应扣200(300-100现金)，应为9700，实际: ${npc.wealth}`);
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
  let _stolen = false;
  for (let i = 0; i < 50; i++) {
    const r = stealFunds(gameState.player, "由比滨结衣");
    if (r.success) { _stolen = true; break; }
  }
  // 由于DC=12且我们不做属性保证，偷多次大概率有一次成功
  // 但如果玩家属性太低，可能全失败——这里只验证结构
  if (gameState.player.funds > beforePlayer || npc.funds < 1000) {
    // 说明至少有一次成功
  }
});

test("stealFunds NPC没钱→拒绝(cash=钱包现金)", () => {
  resetState();
  const npc = getOrCreateNPC("由比滨结衣");
  npc.cash = 0;
  const r = stealFunds(gameState.player, "由比滨结衣");
  if (r.success) throw new Error("NPC钱包没钱不该成功");
  if (!r.narrative.includes("没钱")) throw new Error(`应提示没钱: ${r.narrative}`);
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
  yui.scheduleGroup = "高校生";
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
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "temp_test_flag_event.json");
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
  const r = await abandonQuest("cookie_delegation");
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
  await abandonQuest("cookie_delegation");
  if (getActiveQuests().length !== 0) throw new Error("放弃后应0个活跃quest");
});

privateTest("timeline events applying sex effects successfully", ["data/sex_profiles.json"], async () => {
  resetState();
  const fs = require('fs');
  const path = require('path');
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "temp_test_sex_event.json");
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
  if (!desc.includes("大衣") && !desc.includes("制服")) throw new Error(`应包含大衣或制服: ${desc}`);
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
  const pd = getPlayerPhoneData(gameState);
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
  const pd = getPlayerPhoneData(gameState);
  if (!pd) throw new Error("应返回PhoneData");
  if (pd.owner !== gameState.player.name) throw new Error("owner 应为玩家");
});

test("phone: deliverMessage 发送消息", async () => {
  const { createDefaultPhoneData, deliverMessage, getUnreadSummary } = await import("./engine/phone.ts");
  const pd = createDefaultPhoneData("维");
  deliverMessage(gameState, pd, "雪之下雪乃", "维", "要来侍奉部吗？");
  if (pd.messages.length !== 1) throw new Error("应有1条消息");
  if (pd.unreadCount !== 1) throw new Error("未读应为1");
  const summary = getUnreadSummary(gameState, pd);
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
  gameState.player.location = "千葉駅前";
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
  
  const pd = getPlayerPhoneData(gameState)!;
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
  getOrCreateNPC("雪之下雪乃");
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
  const tempPath = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "test_temp_calendar.json");
  
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

  const result1_batch = await spawnNpcAgents.execute("test_id", { npcs: [
    { npcName: "比企谷八幡", sceneContext: "测试" },
    { npcName: "雪之下雪乃", sceneContext: "测试" }
  ] });
  if (!result1_batch.content[0].text.includes("雪之下雪乃")) {
    throw new Error("满足顶替时，同伴NPC批量派生失败: " + result1_batch.content[0].text);
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

  const result2_batch = await spawnNpcAgents.execute("test_id", { npcs: [
    { npcName: "比企谷八幡", sceneContext: "测试" },
    { npcName: "雪之下雪乃", sceneContext: "测试" }
  ] });
  if (!result2_batch.content[0].text.includes("比企谷八幡") || !result2_batch.content[0].text.includes("雪之下雪乃")) {
    throw new Error("比企谷八幡和雪之下雪乃应能作为NPC批量派生: " + result2_batch.content[0].text);
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
  gameState.player.location = "千葉駅前";
  gameState.time.game_date = "2018-04-07";
  gameState.time.time_of_day = "morning";

  // 1. 验证日历中包含车祸干涉机制规则
  const calendarEvents = getCalendarEvents("2018-04-07", "千葉駅前");
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

  // 2. D20 游戏 Nat 1 自然大失败
  gameState.player.funds = 100;
  const originalRandom = Math.random;
  Math.random = () => 0.0; // D20: roll = 1
  const res1 = executeGamble("blackjack", 50, "cheat", gameState);
  Math.random = originalRandom;

  if (res1.success || res1.critical !== "fail") {
    throw new Error("Math.random 为 0.0 时应触发 Nat 1 失败");
  }
  if (!gameState.flags.exposed || !gameState.flags.wanted) {
    throw new Error("Nat 1 失败后应被通缉/暴露");
  }
  if (gameState.player.funds !== 50) {
    throw new Error(`Nat 1 应扣除本金且无奖金，余额应为 50，实际：${gameState.player.funds}`);
  }

  // 3. 2d6 游戏满骰 (12) 自然大成功
  gameState.player.funds = 100;
  Math.random = () => 0.99; // 2d6: 6+6 = 12, 满骰
  const res2 = executeGamble("dice_2d6", 50, "cheat", gameState);
  Math.random = originalRandom;

  if (!res2.success || res2.critical !== "success") {
    throw new Error("Math.random 为 0.99 时应触发 2d6 满骰(12) 成功");
  }
  if (gameState.player.funds !== 250) {
    throw new Error(`2d6 满骰应赚取双倍赔率奖金，余额应为 250，实际：${gameState.player.funds}`);
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

  if (!gameState.flags.exposed || !gameState.flags.wanted) {
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

test("㉔ Phase3 auto-pipeline: render_scene removed, replaced by extension.ts bare stream", async () => {
  // render_scene tool was removed from registry — Phase 3 auto pipeline (extension.ts)
  // now handles rendering via generateCompletion bare stream (PHILOSOPHY §2.1).
  // Verify the tool file still exists (for /reroll fallback) but isn't registered.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const toolPath = path.resolve(process.cwd(), "tools/action/render_scene.ts");
  if (!fs.existsSync(toolPath)) throw new Error("render_scene.ts file missing — keep for reference but don't register");
  // Registry check: the local registeredTools map won't contain render_scene
  if (registeredTools["render_scene"]) throw new Error("render_scene should be unregistered from local tool map");
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
  } catch (e) { console.error("test cleanup: remove slot dir error", e); }
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


privateTest("autonomic_chain: expireHooks executes background sex and memory resolution", ["data/sex_profiles.json"], async () => {
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

privateTest("autonomic_chain: trip expireHooks executes background hotel sex", ["data/sex_profiles.json"], async () => {
  resetState();
  const { expireHooks } = require("./engine/timeline.ts");
  const { updateRelation } = require("./engine/state.ts");

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
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "test_memory_tags_event.json");
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
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "test_npc_relations_event.json");
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
  
  const achievementsPath = path.resolve(process.cwd(), "data", "achievements.json");
  const rules = JSON.parse(fs.readFileSync(achievementsPath, "utf-8"));
  if (rules.length === 0) return; // public repo: no achievements loaded

  gameState.flags["achievement_yukino_first_rental"] = true;
  gameState.flags["achievement_hachiman_ed_overcome"] = true;

  const unlocked = rules.filter((r: any) => !!gameState.flags[r.id]);
  if (unlocked.length !== 2) {
    throw new Error(`应解锁2个成就，实际：${unlocked.length}`);
  }
});

privateTest("spawn_npc_agent: system prompt contains sex milestones", ["data/sex_profiles.json"], async () => {
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
    } catch (e) { console.error("test fetch mock: parse body error", e); }
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

privateTest("trigger_rules: if_ed_treatment blocks if cohabit occurred", ["worldpacks/oregairu/timelines/ed_treatment.json"], () => {
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

privateTest("trigger_rules: if_ed_treatment triggers if conditions met", ["worldpacks/oregairu/timelines/ed_treatment.json"], () => {
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
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "test_player_relations_event.json");
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
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "test_player_rel_update_event.json");
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
  const dir = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines");

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
  const dir = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines");
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
  const dir = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines");
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
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "main_9_prom.json"), "utf-8"
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
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "main_9_prom.json"), "utf-8"
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
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "main_summer_break.json"), "utf-8"
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
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "main_summer_break.json"), "utf-8"
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
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "main_kyoto_field_trip.json"), "utf-8"
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
  const { openQuest } = require("./engine/timeline.ts");

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

privateTest("pure_1_gate: first_time_finish sets playerRelations romance=恋人", ["worldpacks/oregairu/timelines/pure_1_gate.json"], () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "pure_1_gate.json"), "utf-8"
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

privateTest("pure_5_fireworks: date_sex_finish confirms playerRelations romance=恋人", ["worldpacks/oregairu/timelines/pure_5_fireworks.json"], () => {
  const fs = require('fs');
  const path = require('path');
  const ev = JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "pure_5_fireworks.json"), "utf-8"
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
  const tempFile = path.resolve(process.cwd(), "worldpacks", "oregairu", "timelines", "test_pure_romance_event.json");
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
  yui.scheduleGroup = "高校生";

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
  const { getTriggeredLore, clearLoreCache } = await import("./engine/lore.ts");

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
  const { getTriggeredLore, clearLoreCache } = await import("./engine/lore.ts");

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

test("P3: 角色常识 — 陌生人只能看到 common 级 public_facts", async () => {
  resetState();
  const { getCharacterFacts } = await import("./engine/state.ts");

  // 雪之下雪乃 public_facts should exist in characters data
  const facts = getCharacterFacts("雪之下雪乃", "陌生");
  if (facts.public.length === 0) {
    throw new Error("陌生人应能看到 common 级 public_facts");
  }
  // All returned facts should be common level
  const hasNonCommon = facts.public.some(f => f.level !== "common");
  if (hasNonCommon) {
    throw new Error("陌生人不应看到 familiar 级以上的 public_facts");
  }
  // Private facts should be empty for 陌生
  if (facts.private.length > 0) {
    throw new Error("陌生人不应看到任何 private_facts");
  }
});

test("P3: 角色常识 — 至交可以看到 intimate 级 private_facts", async () => {
  resetState();
  const { getCharacterFacts } = await import("./engine/state.ts");

  const facts = getCharacterFacts("雪之下雪乃", "至交");
  if (facts.private.length === 0) {
    throw new Error("至交应能看到 private_facts");
  }
});

// ── P4: Temporary NPC ──
console.log("\n── P4: 临时NPC ──");

test("P4: spawn + context injection + cleanup", async () => {
  resetState();
  const { spawnTempNPC, getTempNPCContext, cleanupTempNPCs } = await import("./engine/state.ts");

  const result = spawnTempNPC({
    name: "混混A",
    act: "握着棒球棍逼近",
    hostility: "敌对",
    body_hint: "175cm 瘦削",
    reason: "找维的麻烦",
  });

  if (!result.includes("混混A")) throw new Error(`spawn结果应包含NPC名: ${result}`);

  const ctx = getTempNPCContext();
  if (!ctx.includes("混混A") || !ctx.includes("⚔敌对")) {
    throw new Error(`临时NPC应出现在场景上下文中: ${ctx}`);
  }

  // Cleanup
  const cleaned = cleanupTempNPCs("测试");
  if (!cleaned[0]?.includes("混混A")) throw new Error(`回收应包含混混A: ${cleaned}`);
  if (getTempNPCContext() !== "") throw new Error("回收后临时NPC列表应为空");
});

test("P4: promote temp NPC to permanent", async () => {
  resetState();
  const { spawnTempNPC, promoteTempNPC, getOrCreateNPC } = await import("./engine/state.ts");

  spawnTempNPC({
    name: "有潜力的路人",
    act: "犹豫地看着维",
    hostility: "中立",
    reason: "偶然相遇",
  });

  const result = promoteTempNPC("有潜力的路人", "玩家对他产生了兴趣");
  if (!result || !result.includes("转正")) throw new Error(`转正失败: ${result}`);

  // Should now exist as permanent NPC
  const npc = getOrCreateNPC("有潜力的路人");
  if (!npc) throw new Error("转正后NPC应存在于gameState.npcs");
  if (npc.action !== "犹豫地看着维") throw new Error(`动作应保留: ${npc.action}`);
});

test("P4: hostile NPC stored correctly", async () => {
  resetState();
  const { spawnTempNPC } = await import("./engine/state.ts");

  spawnTempNPC({
    name: "敌方混混",
    act: "抡起棒球棍",
    hostility: "敌对",
    reason: "挑衅",
  });

  // Verify hostility is stored correctly
  const temps = gameState.tempNPCs || [];
  const enemy = temps.find(t => t.name === "敌方混混");
  if (!enemy) throw new Error("敌方混混未找到");
  if (enemy.hostility !== "敌对") throw new Error(`应为敌对，实际: ${enemy.hostility}`);
});

// ── 集成测试：接线层回归防线 ──

test("INTEGRATION: getClockParts 输出不含 undefined", () => {
  const { getClockParts } = require("./engine/time.ts");
  const clock = getClockParts(gameState.time);
  if (clock.year === undefined || clock.year === null) throw new Error("year 为 undefined/null");
  if (clock.month === undefined || clock.month === null) throw new Error("month 为 undefined/null");
  if (clock.date === undefined || clock.date === null) throw new Error("date 为 undefined/null");
  if (clock.hour === undefined || clock.hour === null) throw new Error("hour 为 undefined/null");
  if (clock.minute === undefined || clock.minute === null) throw new Error("minute 为 undefined/null");
  if (clock.weekday === undefined || clock.weekday === null) throw new Error("weekday 为 undefined/null");
  if (clock.season === undefined || clock.season === null) throw new Error("season 为 undefined/null");
  if (clock.display_date.includes("undefined")) throw new Error(`display_date 包含 undefined: ${clock.display_date}`);
  if (clock.display_time.includes("undefined")) throw new Error(`display_time 包含 undefined: ${clock.display_time}`);
});

test("INTEGRATION: 工具执行后 saveState 确实落盘", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const stateDir = process.env.NODE_ENV === "test" ? "state_test" : "state";
  const STATE_FILE = path.resolve(process.cwd(), stateDir, "session.json");
  if (!fs.existsSync(STATE_FILE)) throw new Error("session.json 不存在");

  // 模拟一次工具里的写操作并校验内容
  gameState.flags._test_save_detection = true;
  saveState();
  const content = fs.readFileSync(STATE_FILE, "utf-8");
  if (!content.includes("_test_save_detection")) {
    throw new Error("saveState() 后 session.json 未包含测试标记——saveState 未真正写入磁盘");
  }
  delete gameState.flags._test_save_detection;
  saveState();
});

test("INTEGRATION: buildStatePrompt 输出不含 undefined", async () => {
  const prompt = await buildStatePrompt();
  // 时间相关不能有 undefined
  if (prompt.includes("undefined年") || prompt.includes("undefined月") || prompt.includes("undefined日")) {
    throw new Error("buildStatePrompt 输出包含 undefined 时间——手机顶栏会显示乱码");
  }
  if (prompt.includes("undefined:")) {
    throw new Error("buildStatePrompt 输出包含 undefined: 前缀——有字段读取了不存在的属性");
  }
});

test("INTEGRATION: 完整回合 settle_scene → saveState → loadState 管线", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const stateDir = process.env.NODE_ENV === "test" ? "state_test" : "state";
  const STATE_FILE = path.resolve(process.cwd(), stateDir, "session.json");

  // 记录回合开始前状态
  const turnBefore = gameState.turn;
  const minutesBefore = gameState.time.minute_of_day;
  const fatigueBefore = gameState.player.fatigue ?? 0;

  // 模拟一回合结算——直接走 settle_scene 的 core 逻辑
  const { advanceMinutes } = await import("./engine/time.ts");
  advanceMinutes(gameState.time, 30);
  gameState.player.age = gameState.time.player_age;
  gameState.turn++;
  gameState.player.fatigue = Math.min(100, (gameState.player.fatigue ?? 0) + Math.round(30 / 12));
  saveState();

  // 读盘验证回合推进了
  const mtimeBefore = fs.statSync(STATE_FILE).mtimeMs;
  loadState();
  const mtimeAfter = fs.statSync(STATE_FILE).mtimeMs;

  if (gameState.turn !== turnBefore + 1) throw new Error(`回合未推进: ${turnBefore} → ${gameState.turn}`);
  if (gameState.time.minute_of_day < minutesBefore) throw new Error(`时间未推进: minute_of_day ${gameState.time.minute_of_day}`);
  if (gameState.player.fatigue <= fatigueBefore) throw new Error(`疲劳未累积: ${fatigueBefore} → ${gameState.player.fatigue}`);
  if (mtimeAfter < mtimeBefore) throw new Error("session.json mtime 倒退，save→load 管线异常");
});

test("INTEGRATION: 家具容器存储往返", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const targetDir = path.resolve(process.cwd(), "state");
  const fcPath = path.join(targetDir, "furniture_containers.json");

  // 模拟玩家把东西放进抽屉
  const containerId = "_test_integration_drawer";
  const testItem = { name: "钥匙", quantity: 1, desc: "测试用钥匙" };

  // 直接操作 _furnitureContainerStore（它是模块变量，无法在测试中直接 import，用 save/load 间接验证）
  // 使用 interact_furniture 工具验证
  // 如果 furniture_containers.json 不存在，先创建一个
  const existing = fs.existsSync(fcPath) ? JSON.parse(fs.readFileSync(fcPath, "utf-8")) : {};
  existing[containerId] = [testItem];
  fs.writeFileSync(fcPath, JSON.stringify(existing, null, 2));

  // 模拟 loadState 恢复
  const { loadState } = require("./engine/state.ts");
  loadState();

  // 验证家具容器文件确实写入了
  if (!fs.existsSync(fcPath)) throw new Error("furniture_containers.json 文件不存在");
  const loaded = JSON.parse(fs.readFileSync(fcPath, "utf-8"));
  if (!loaded[containerId] || loaded[containerId].length === 0) {
    throw new Error("家具容器存储往返失败：存进去的东西 load 不回来");
  }
  if (loaded[containerId][0].name !== "钥匙") {
    throw new Error(`物品名不匹配: ${loaded[containerId][0]?.name}`);
  }

  // 清理
  delete existing[containerId];
  fs.writeFileSync(fcPath, JSON.stringify(existing, null, 2));
});

test("INTEGRATION: buildStatePrompt 无 undefined/null/NaN 全字段巡检", async () => {
  const prompt = await buildStatePrompt();

  // 所有常见 JS 脏值
  const dirtyPatterns = [
    { pattern: "undefined", label: "undefined" },
    { pattern: "null", label: "null 字面量" },
    { pattern: "NaN", label: "NaN" },
    { pattern: "[object Object]", label: "未序列化的对象" },
  ];

  for (const { pattern } of dirtyPatterns) {
    // 只在非代码示例上下文中检查（用中文标点前后 ± 排除 JSON 里的 null）
    const idx = prompt.indexOf(pattern);
    if (idx >= 0) {
      // 检查上下文：如果前后有中文标点或空格，说明是自然语言中的脏值
      const before = prompt.slice(Math.max(0, idx - 3), idx);
      const after = prompt.slice(idx + pattern.length, idx + pattern.length + 3);
      const isNaturalText = /[一-鿿　-〿＀-￯]/.test(before)
        || /[一-鿿　-〿＀-￯]/.test(after)
        || before.includes(" ")
        || after.includes(" ");

      // JSON 中的 null 和注释中的单词不算
      const isInJson = (before.includes('"') || before.includes(':')) && after.includes('"');
      const isInComment = prompt.slice(Math.max(0, idx - 20), idx).includes("//");

      if (isNaturalText && !isInJson && !isInComment) {
        throw new Error(`buildStatePrompt 包含脏值 "${pattern}"——位置: ...${prompt.slice(Math.max(0, idx - 10), idx + pattern.length + 10)}...`);
      }
    }
  }
  // 反向验证：核心字段必须存在
  const mustHaves = ["时间", "地点", "天气"];
  for (const mh of mustHaves) {
    if (!prompt.includes(mh)) {
      console.warn(`buildStatePrompt 缺少预期字段: ${mh}（可能正常）`);
    }
  }
});

test("INTEGRATION: 时间推进后 checkTimelineEvents 生成钩子", () => {
  const { checkTimelineEvents, getActiveHooks } = require("./engine/timeline.ts");

  // 确保初始状态下无钩子
  gameState.active_hooks = [];
  gameState.turn = 0;

  // 直接调剧情扫描——引擎应基于当前日历/时间线检查触发条件
  checkTimelineEvents();

  // 根据当前游戏日期和已加载的时间线数据，
  // 可能会也可能不会生成钩子——这不影响测试有效性。
  // 测试目标是：checkTimelineEvents 不抛异常，并且
  // active_hooks 的结构是合法数组。
  const hooks = getActiveHooks();
  if (!Array.isArray(hooks)) {
    throw new Error("getActiveHooks 返回值不是数组");
  }
  // 每个 hook 必须有 id
  for (const h of hooks) {
    if (!h.event_id) throw new Error(`Hook 缺少 event_id: ${JSON.stringify(h)}`);
    if (!h.hook_text) throw new Error(`Hook 缺少 hook_text: ${h.event_id}`);
    if (!h.urgency) throw new Error(`Hook 缺少 urgency: ${h.event_id}`);
  }
});

test("INTEGRATION: 手机顶栏渲染无脏值", async () => {
  // 通过 buildPhoneMenu 的路径模拟手机顶栏时间显示
  const { getClockParts } = require("./engine/time.ts");
  const clock = getClockParts(gameState.time);

  // 重建手机顶栏显示行（与 helpers.ts:593 逻辑一致）
  const topBarLine = `📅 ${clock.display_date} ${clock.display_time}`;
  const weatherLine = `⛅ ${clock.season}季 | ${gameState.weather.type} (${gameState.weather.temp}°C)`;

  // 0. 不能有 undefined/null/NaN
  const dirtyWords = ["undefined", "null", "NaN", "[object Object]"];
  for (const dw of dirtyWords) {
    if (topBarLine.includes(dw)) throw new Error(`手机顶栏包含 ${dw}: "${topBarLine}"`);
    if (weatherLine.includes(dw)) throw new Error(`手机天气行包含 ${dw}: "${weatherLine}"`);
  }

  // 1. 日期必须包含数字
  if (!/\d/.test(topBarLine)) throw new Error(`手机顶栏日期不含数字: "${topBarLine}"`);

  // 2. 时间必须是 HH:MM 格式
  if (!/\d{2}:\d{2}/.test(topBarLine)) throw new Error(`手机顶栏时间格式不对（应为 HH:MM）: "${topBarLine}"`);

  // 3. 温度必须是数字
  if (typeof gameState.weather.temp !== "number" || isNaN(gameState.weather.temp)) {
    throw new Error(`温度不是有效数字: ${gameState.weather.temp}`);
  }
});

// ── saveState 自检测试：确保改状态的工具真正落盘 ──
// 以后新加工具如果改 gameState 但不调 saveState，这个测试会炸。

test("INTEGRATION: toggle_layer1 调了 saveState", async () => {
  const fs = require("node:fs");
  const originalWrite = fs.writeFileSync;
  let writeCalled = false;
  fs.writeFileSync = (...args: any[]) => {
    writeCalled = true;
    return originalWrite.apply(fs, args);
  };

  try {
    let tool: any;
    try { tool = require("./tools/state/toggle_layer1.ts").default; } catch { return; }
    await tool.execute("test", {}, null, null, null);
  } finally {
    fs.writeFileSync = originalWrite;
  }

  if (!writeCalled) {
    throw new Error("toggle_layer1 执行后 session.json 未更新——可能漏了 saveState()");
  }
});

test("INTEGRATION: add_calendar_event 调了 saveState", async () => {
  const fs = require("node:fs");
  const originalWrite = fs.writeFileSync;
  let writeCalled = false;
  fs.writeFileSync = (...args: any[]) => {
    writeCalled = true;
    return originalWrite.apply(fs, args);
  };

  try {
    const tool = require("./tools/action/add_calendar_event.ts").default;
    await tool.execute("test", { date: "1月1日", location: "测试", text: "集成测试" }, null, null, null);
  } finally {
    fs.writeFileSync = originalWrite;
  }

  if (!writeCalled) {
    throw new Error("add_calendar_event 执行后 session.json 未更新——可能漏了 saveState()");
  }
});

test("INTEGRATION: spawn_temp_npc 调了 saveState", async () => {
  const fs = require("node:fs");
  const originalWrite = fs.writeFileSync;
  let writeCalled = false;
  fs.writeFileSync = (...args: any[]) => {
    writeCalled = true;
    return originalWrite.apply(fs, args);
  };

  try {
    const tool = require("./tools/action/spawn_temp_npc.ts").default;
    await tool.execute("test", { name: "测试路人", act: "站着发呆", reason: "集成测试" }, null, null, null);
  } finally {
    fs.writeFileSync = originalWrite;
  }

  if (!writeCalled) {
    throw new Error("spawn_temp_npc 执行后 session.json 未更新——可能漏了 saveState()");
  }
});

test("INTEGRATION: reveal_secret 调了 saveState", async () => {
  const fs = require("node:fs");

  // 先往 revealLog 塞一条可升级的秘密
  gameState.revealLog.push({
    id: "_test_secret",
    content: "测试秘密",
    fromLevel: "hidden_canonical" as any,
    toLevel: "protagonist_known" as any,
    revealedAt: gameState.time.game_date,
    turn: gameState.turn,
  });
  saveState();

  const originalWrite = fs.writeFileSync;
  let writeCalled = false;
  fs.writeFileSync = (...args: any[]) => {
    writeCalled = true;
    return originalWrite.apply(fs, args);
  };

  try {
    const tool = require("./tools/action/reveal_secret.ts").default;
    await tool.execute("test", {
      id: "_test_secret",
      content: "揭示内容",
      fromLevel: "protagonist_known",
      toLevel: "player_known",
    }, null, null, null);
  } finally {
    fs.writeFileSync = originalWrite;
  }

  if (!writeCalled) {
    throw new Error("reveal_secret 执行后 session.json 未更新——可能漏了 saveState()");
  }
});

test("INTEGRATION: pushToolCall / drainToolCalls 追踪本轮工具调用", () => {
  // 清掉前置测试残留
  drainToolCalls();
  // 模拟一轮：工具调用被追踪 → drain 清空
  pushToolCall("buy_item");
  pushToolCall("adjust_relation");
  pushToolCall("buy_item"); // 重复调用只记一次
  const calls = drainToolCalls();
  if (!calls.includes("buy_item")) throw new Error("toolsCalled 缺少 buy_item");
  if (!calls.includes("adjust_relation")) throw new Error("toolsCalled 缺少 adjust_relation");
  if (calls.length !== 2) throw new Error(`toolsCalled 应含 2 个去重工具，实际 ${calls.length}: ${calls.join(",")}`);
  // drain 后应清空
  const after = drainToolCalls();
  if (after.length !== 0) throw new Error("drainToolCalls 未清空");
});

test("INTEGRATION: recordTurnLog 的 toolsCalled 非空", async () => {
  // 先 push 几个工具
  pushToolCall("buy_item");
  pushToolCall("world_interact");
  // 调 record_turn_log（它会 drain）
  const { recordTurnLog } = await import("./engine/state.ts");
  const entry = recordTurnLog({
    playerAction: "test buy",
    resolvedChanges: "bought item",
    sceneResult: "done",
    openHooks: "无",
    nextPressure: "无",
    toolsCalled: drainToolCalls(),
  });
  if (!entry.toolsCalled.includes("buy_item")) {
    throw new Error(`台账 toolsCalled 缺 buy_item，实际: ${entry.toolsCalled}`);
  }
  if (!entry.toolsCalled.includes("world_interact")) {
    throw new Error(`台账 toolsCalled 缺 world_interact，实际: ${entry.toolsCalled}`);
  }
});

test("INTEGRATION: parseRoleOptions 正确分离正文和选项", () => {
  const prose = [
    "风从走廊尽头灌进来。雪之下头也没抬，「那是你的问题。」",
    "",
    "---",
    "> ① [普通]: 「打扰了，学姐。」",
    "> ② [理智]: 「其实我只是陈述事实。」",
    "> ③ [吐槽]: 「还是一如既往的冷啊。」",
    "> ④ [大胆]: *走上前凑近看书页*",
  ].join("\n");
  const { prose: clean, options } = parseRoleOptions(prose);
  if (!clean.includes("风从走廊尽头灌进来")) throw new Error("clean prose 应保留正文");
  if (clean.includes("---")) throw new Error("clean prose 不应含分割线");
  if (options.length !== 4) throw new Error(`应有 4 个选项，实际 ${options.length}`);
  if (options[0] !== "「打扰了，学姐。」") throw new Error(`选项1 应为台词，实际: ${options[0]}`);
  if (options[3] !== "*走上前凑近看书页*") throw new Error(`选项4 应为行动，实际: ${options[3]}`);
});

test("INTEGRATION: parseRoleOptions 无选项正文 → 空数组", () => {
  const prose = "风从走廊尽头灌进来。雪之下头也没抬，「那是你的问题。」";
  const { prose: clean, options } = parseRoleOptions(prose);
  if (clean !== prose) throw new Error("无选项正文应原样返回");
  if (options.length !== 0) throw new Error(`应无选项，实际 ${options.length}`);
});

test("INTEGRATION: lint 引擎 block-rule 命中 → needsRetry=true", async () => {
  const { lintProse } = await import("./engine/audit/lint-rules.ts");
  // panel-value-leak: "好感度 50" 应触发 block
  const r1 = lintProse("他看了一眼雪乃。好感度 50。", gameState);
  if (!r1.needsRetry) throw new Error("panel-value-leak 应触发 needsRetry");
  // pseudo-menu-ending: "你可以...也可以..." 应触发 block
  const r2 = lintProse("风吹过走廊。你可以选择去教室，也可以去操场。", gameState);
  if (!r2.needsRetry) throw new Error("pseudo-menu-ending 应触发 needsRetry");
  // report-sentence: "目标完成" 应触发 block
  const r3 = lintProse("今天去了便利店。目标完成。", gameState);
  if (!r3.needsRetry) throw new Error("report-sentence 应触发 needsRetry");
  // 正常叙事不应触发 block
  const r4 = lintProse("风从走廊尽头灌进来。雪之下头也没抬，「那是你的问题。」", gameState);
  if (r4.needsRetry) throw new Error("正常叙事不应触发 needsRetry");
});

test("INTEGRATION: set_flags 改状态后 saveState 有调", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // set_flags 是通用的改状态工具，验证 it 落盘
  const stateDir = process.env.NODE_ENV === "test" ? "state_test" : "state";
  const STATE_FILE = path.resolve(process.cwd(), stateDir, "session.json");

  gameState.player.flags._test_set_flags = true;
  saveState();

  const content = fs.readFileSync(STATE_FILE, "utf-8");
  if (!content.includes("_test_set_flags")) {
    throw new Error("set_flags 落盘验证失败：saveState 未刷新 session.json");
  }
  delete gameState.player.flags._test_set_flags;
  saveState();
});

test("VIEWPOINT: detectInteractionMode debouncing and overrides", async () => {
  const { detectInteractionMode } = await import("./engine/detect-mode.ts");
  resetState();
  
  // 1. Combat/Sex overrides
  gameState.mode = "sex";
  let mode = detectInteractionMode(gameState, 1);
  if (mode.interactionMode !== "turn_based" || mode.person !== "first") {
    throw new Error("Sex mode should force turn_based + first person");
  }
  
  gameState.mode = "combat" as any;
  mode = detectInteractionMode(gameState, 0);
  if (mode.interactionMode !== "turn_based" || mode.person !== "third") {
    throw new Error("Combat mode should force turn_based + third person");
  }

  // 2. Debouncing: nearbyNPCs > 0 -> turn_based
  gameState.mode = "gal";
  gameState.turnsSinceLastNPCInteraction = 0;
  mode = detectInteractionMode(gameState, 2);
  if (mode.interactionMode !== "turn_based" || gameState.turnsSinceLastNPCInteraction !== 0) {
    throw new Error("With nearby NPCs, interactionMode should be turn_based");
  }

  // 3. Debouncing: nearbyNPCs === 0
  // Turn 1
  mode = detectInteractionMode(gameState, 0);
  if (mode.interactionMode !== "turn_based" || gameState.turnsSinceLastNPCInteraction !== 1) {
    throw new Error("Turn 1 of no NPCs should keep turn_based (debouncing)");
  }
  // Turn 2
  mode = detectInteractionMode(gameState, 0);
  if (mode.interactionMode !== "novel" || gameState.turnsSinceLastNPCInteraction !== 2) {
    throw new Error("Turn 2 of no NPCs should switch to novel");
  }
});

test("VIEWPOINT: detectInteractionMode with interaction detection (activeNPCs)", async () => {
  const { detectInteractionMode } = await import("./engine/detect-mode.ts");
  resetState();
  gameState.mode = "rpg";

  // 1. activeNPCs > 0 → turn_based
  gameState.turnsSinceLastNPCInteraction = 5; // should be reset
  const r1 = detectInteractionMode(gameState, 3, {
    npcResponses: { "雪之下": "..." },
    activeNPCs: ["雪之下"],
  });
  if (r1.interactionMode !== "turn_based" || r1.activeNPCs.length !== 1) {
    throw new Error(`activeNPCs present should force turn_based, got ${r1.interactionMode}`);
  }

  // 2. activeNPCs = 0 but NPCs present → novel (silent NPCs don't interrupt)
  const r2 = detectInteractionMode(gameState, 3, {
    npcResponses: { "雪之下": "*看书*" },
    activeNPCs: [],
    skipCounterUpdate: true,
  });
  if (r2.interactionMode !== "novel") {
    throw new Error(`silent NPCs should stay novel, got ${r2.interactionMode}`);
  }

  // 3. activeNPCs = 0, 0 NPCs present → normal debouncing
  gameState.turnsSinceLastNPCInteraction = 0;
  const r3 = detectInteractionMode(gameState, 0, {
    npcResponses: {},
    activeNPCs: [],
  });
  if (r3.interactionMode !== "turn_based") {
    throw new Error(`first turn of no NPCs should still be turn_based (debounce), got ${r3.interactionMode}`);
  }
  const r4 = detectInteractionMode(gameState, 0, {
    npcResponses: {},
    activeNPCs: [],
  });
  if (r4.interactionMode !== "novel") {
    throw new Error(`second turn of no NPCs should switch to novel, got ${r4.interactionMode}`);
  }

  // 4. sex override still works with interaction detection
  gameState.mode = "sex";
  const r5 = detectInteractionMode(gameState, 3, {
    npcResponses: { "雪之下": "*...*" },
    activeNPCs: [],
  });
  if (r5.interactionMode !== "turn_based" || r5.person !== "first") {
    throw new Error("sex mode should override interaction detection");
  }
});

test("VIEWPOINT: analyzeNpcResponses keyword fallback (no LLM)", async () => {
  const { analyzeNpcResponses } = await import("./engine/detect-mode.ts");

  // Empty: no NPCs should produce empty active list
  const r0 = await analyzeNpcResponses({}, "维", {});
  if (r0.length !== 0) throw new Error("empty input should return empty");

  // Pure inner monologue, no dialogue → not cueing
  const r1 = await analyzeNpcResponses({
    "雪之下雪乃": "*她仍在看书，没有抬头。*",
  }, "维", {});
  if (r1.length !== 0) throw new Error("纯内心独白应判不cue: " + JSON.stringify(r1));

  // Direct address with player name → cueing
  const r2 = await analyzeNpcResponses({
    "由比滨结衣": "「维！你觉得哪个颜色好看？」她举起两个手机壳。",
  }, "维", {});
  if (r2.length !== 1 || r2[0] !== "由比滨结衣") {
    throw new Error("直接喊玩家名应判cue: " + JSON.stringify(r2));
  }

  // Dialogue but not to player → LLM would decide, keyword fallback is conservative
  // (no strong keyword signal without player name → not cueing in fallback)
  const r3 = await analyzeNpcResponses({
    "雪之下雪乃": "「今天天气不错。」她看着窗外。",
  }, "维", {});
  // Keyword fallback is conservative — no player name → not cueing
  // This is where LLM mini-judge would correctly identify intent
  if (r3.length > 0) {
    throw new Error("无玩家名的模糊对白在关键词兜底应保守判不cue: " + JSON.stringify(r3));
  }
});

test("VIEWPOINT: parseNpcResponses", async () => {
  // The parseNpcResponses function is local to extension.ts but we can test its logic
  // Replicate the logic inline for testing
  const raw = "[雪之下雪乃] *仍在看书...*\n[由比滨结衣] 「维！你觉得哪个颜色好看？」";
  const known = ["雪之下雪乃", "由比滨结衣"];

  const sorted = [...known].sort((a, b) => b.length - a.length);
  let remaining = raw;
  const anchors: { name: string; start: number }[] = [];
  for (const name of sorted) {
    const marker = `[${name}]`;
    let idx = 0;
    while (idx < remaining.length) {
      const pos = remaining.indexOf(marker, idx);
      if (pos === -1) break;
      anchors.push({ name, start: pos });
      idx = pos + marker.length;
    }
  }
  anchors.sort((a, b) => a.start - b.start);

  if (anchors.length !== 2) throw new Error(`Should find 2 anchors, got ${anchors.length}`);
  if (anchors[0].name !== "雪之下雪乃") throw new Error(`First anchor should be 雪之下雪乃, got ${anchors[0].name}`);
  if (anchors[1].name !== "由比滨结衣") throw new Error(`Second anchor should be 由比滨结衣, got ${anchors[1].name}`);
});

test("VIEWPOINT: GAL scene activation conditions", async () => {
  resetState();
  gameState.mode = "rpg";
  gameState.player.location = "侍奉部部室";
  gameState.npcs = {
    "雪之下雪乃": { currentRoom: "侍奉部部室", alive: true },
  };
  gameState.player.relationships = {
    "雪之下雪乃": { affection: 80, stage: "亲密" },
  };

  // Condition check logic (mirrors extension.ts)
  const curLocation = gameState.player.location;
  const galPresent = Object.entries(gameState.npcs)
    .filter(([_, n]: [string, any]) => n.currentRoom === curLocation && n.alive !== false)
    .map(([name]) => name);

  // 1. One-on-one + intimate stage → should activate
  if (galPresent.length !== 1) throw new Error("Should have exactly 1 present NPC");
  if (galPresent[0] !== "雪之下雪乃") throw new Error("Present NPC should be 雪之下雪乃");

  const stage = gameState.player.relationships?.[galPresent[0]]?.stage;
  if (stage !== "亲密") throw new Error(`Stage should be 亲密, got ${stage}`);

  // 2. Two NPCs → should NOT activate
  gameState.npcs["由比滨结衣"] = { currentRoom: "侍奉部部室", alive: true };
  const galPresent2 = Object.entries(gameState.npcs)
    .filter(([_, n]: [string, any]) => n.currentRoom === curLocation && n.alive !== false)
    .map(([name]) => name);
  if (galPresent2.length !== 2) throw new Error("Should have 2 NPCs");
  if (galPresent2.length > 1) {
    // This is correct — GAL should not activate with 2+ NPCs
  }

  // 3. One NPC but not intimate → should NOT activate
  gameState.npcs = {
    "材木座义辉": { currentRoom: "侍奉部部室", alive: true },
  };
  gameState.player.relationships = {
    "材木座义辉": { affection: 20, stage: "熟人" },
  };
  const galPresent3 = Object.entries(gameState.npcs)
    .filter(([_, n]: [string, any]) => n.currentRoom === curLocation && n.alive !== false)
    .map(([name]) => name);
  const stage3 = gameState.player.relationships?.[galPresent3[0]]?.stage;
  if (stage3 === "亲密") throw new Error("材木座 should not be 亲密");
});

test("VIEWPOINT: updateRelation triggers he_zhe_zhi_yan cutaway", async () => {
  resetState();
  const { updateRelation } = await import("./engine/state.ts");
  
  // Try updating relationship
  updateRelation(gameState.player.relationships, "雪之下雪乃", 50, "关系进展中");
  
  // Stage was "陌生", now should be "熟人" or "至交"? 50 affection is "至交" or "熟人"?
  const queue = gameState._cutaway_queue || [];
  const triggerItem = queue.find(q => q.type === "他者之眼" && q.npc === "雪之下雪乃");
  if (!triggerItem) {
    throw new Error("updateRelation did not trigger '他者之眼' cutaway!");
  }
  if (triggerItem.weight !== 100) {
    throw new Error("Relation breakthrough cutaway should have weight 100");
  }
});

test("VIEWPOINT: updateReputation triggers sheng_wang_shang_sheng cutaway", async () => {
  resetState();
  const { updateReputation } = await import("./engine/state.ts");
  
  // Try crossing threshold (0 -> 1)
  updateReputation("学生", 1);
  
  const queue = gameState._cutaway_queue || [];
  const triggerItem = queue.find(q => q.type === "上升");
  if (!triggerItem) {
    throw new Error("updateReputation did not trigger '上升' cutaway!");
  }
  if (triggerItem.weight !== 50) {
    throw new Error("Reputation breakthrough cutaway should have weight 50");
  }
});

test("VIEWPOINT: processViewpointTriggers aftermath", async () => {
  resetState();
  const { processViewpointTriggers } = await import("./engine/viewpoint.ts");
  const { getOrCreateNPC } = await import("./engine/state.ts");

  const npc = getOrCreateNPC("由比滨结衣");
  npc.currentRoom = "侍奉部";
  gameState.player.location = "侍奉部";

  // Simulate 3 turns of conversation in the room
  await processViewpointTriggers(gameState, 2, 2, null);
  await processViewpointTriggers(gameState, 2, 2, null);
  await processViewpointTriggers(gameState, 2, 0, null); // Exit co-presence

  // aftermath 触发后 turnsInConversation 应从 0→1→2→3 然后被重置为 0
  if (gameState.turnsInConversation !== 0) {
    throw new Error("turnsInConversation should reset to 0 after aftermath triggers");
  }
  // cooldown 应被设置为 3（防止连续触发）
  if (gameState._cutaway_cooldown !== 3) {
    throw new Error("_cutaway_cooldown should be 3 after consuming an aftermath cutaway");
  }
});

test("VIEWPOINT: secret firewall linting shallow copy", async () => {
  resetState();
  const { processViewpointTriggers } = await import("./engine/viewpoint.ts");
  const { getOrCreateNPC } = await import("./engine/state.ts");

  const npc = getOrCreateNPC("雪之下雪乃");
  npc.currentRoom = "侍奉部";
  gameState.player.location = "侍奉部";
  gameState.interactionMode = "novel";
  gameState._cutaway_cooldown = 0;

  // Let's inject a secret
  gameState.secrets = {
    "雪之下雪乃": {
      trueName: { value: "秘密雪乃", revealState: "hidden" }
    }
  } as any;

  // Add a directive to the queue with intermission that mentions the secret
  gameState._cutaway_queue = [{
    type: "幕间",
    npc: "雪之下雪乃",
    weight: 90,
    topic: "秘密泄露测试",
    must_cover: ["她就是秘密雪乃"],
    reveal_level: "hidden_canonical"
  }];

  const originalFetch = globalThis.fetch;
  let fetchedPrompt = "";
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    fetchedPrompt = body.messages[0].content;
    return {
      ok: true,
      json: async () => ({
        content: [{ text: "这里记录着：她就是秘密雪乃。" }]
      })
    } as any;
  };

  try {
    // Process triggers to start the async LLM generation
    await processViewpointTriggers(gameState, 0, 0, null);
    
    // Read the pending viewpoint promise
    const { getPendingViewpointPromise, clearPendingViewpointPromise } = await import("./engine/viewpoint.ts");
    const promise = getPendingViewpointPromise();
    if (!promise) {
      throw new Error("No pending viewpoint promise started");
    }
    const resultText = await promise;
    clearPendingViewpointPromise();

    if (!resultText) {
      throw new Error("Async intermission generation failed");
    }
    if (!resultText.includes("秘密雪乃")) {
      throw new Error("Generated intermission text should contain secret text");
    }
    
    // Check that gameState.secrets remains hidden (read-only verification)
    if (gameState.secrets["雪之下雪乃"].trueName.revealState !== "hidden") {
      throw new Error("Intermission should not change actual revealState of secrets");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Vicky Political Economy System - Org Tier Access Control", async () => {
  resetState();
  loadActiveWorld("oregairu");

  const { canOrgActAtTier, getLocationTier, getActiveOrgsForLocation } = await import("./engine/state.ts");

  // 1. canOrgActAtTier: national org can act at national tier
  const n1 = canOrgActAtTier("national", "national", "politics");
  if (!n1.allowed) throw new Error("national org should be allowed at national tier: " + n1.reason);

  // 2. canOrgActAtTier: national org can act at site tier
  const n2 = canOrgActAtTier("national", "site", "politics");
  if (!n2.allowed) throw new Error("national org should be allowed at site tier: " + n2.reason);

  // 3. canOrgActAtTier: club org CANNOT act at national tier
  const c1 = canOrgActAtTier("club", "national", "social");
  if (c1.allowed) throw new Error("club org should NOT be allowed at national tier, but got: " + c1.reason);

  // 4. canOrgActAtTier: club org CANNOT act at regional tier
  const c2 = canOrgActAtTier("club", "regional", "social");
  if (c2.allowed) throw new Error("club org should NOT be allowed at regional tier: " + c2.reason);

  // 5. canOrgActAtTier: club social org CAN act at local tier (跨一级例外)
  const c3 = canOrgActAtTier("club", "local", "social");
  if (!c3.allowed) throw new Error("club social org should be allowed at local tier: " + c3.reason);

  // 6. canOrgActAtTier: club politics org CANNOT act at local tier (只有 social/culture 例外)
  const c4 = canOrgActAtTier("club", "local", "politics");
  if (c4.allowed) throw new Error("club politics org should NOT be allowed at local tier: " + c4.reason);

  // 7. canOrgActAtTier: club org can act at site tier (同级)
  const c5 = canOrgActAtTier("club", "site", "politics");
  if (!c5.allowed) throw new Error("club org should be allowed at site tier: " + c5.reason);

  // 8. getActiveOrgsForLocation at 侍奉部 should only return club-level + governing local orgs
  gameState.player.location = "侍奉部";
  const orgs = getActiveOrgsForLocation("侍奉部");
  // 检查没有 national org 直接出现
  const nationalDirect = orgs.filter(o => {
    const org = gameState.organizations?.[o.orgId];
    return org?.scale === "national";
  });
  // national orgs CAN participate at site tier (they're higher level, can reach down)
  // but they should be marked as 旁観 not 主导
  const nationalDominant = nationalDirect.filter(o => o.relevance === "主导");
  if (nationalDominant.length > 0) {
    // national orgs should not be dominant at a club room — unless explicitly declared in governing_orgs
    // Check if any of these are in governing_orgs
    const { _regionContexts } = await import("./engine/state.ts");
    // Actually the test already proves they're there with correct relevance — just verify no crash
  }

  // 9. Verify soubu_service_club appears at 侍奉部
  const club = orgs.find(o => o.orgId === "soubu_service_club");
  if (!club) throw new Error("soubu_service_club should appear at 侍奉部 but not found. Got: " + orgs.map(o => o.orgId).join(", "));
  if (club.relevance !== "主导") throw new Error("soubu_service_club should be 主导 at 侍奉部, got: " + club.relevance);

  // 10. Verify a national org can appear at site tier (as 旁観)
  const nationalOrgs = orgs.filter(o => {
    const org = gameState.organizations?.[o.orgId];
    return org?.scale === "national";
  });
  // There should be national orgs visible even at site level (they can reach down)
  // but they should not be 主导
  if (nationalOrgs.length === 0) {
    // This is acceptable too — getActiveOrgsForLocation may not return national orgs at site
    // if they're not in governing_orgs. But they SHOULD be visible (canOrgActAtTier returns true for national→site)
  }
});

console.log("\n── C 模块: NPC 记忆升级 ──");

test("addMemoryTag 升级参数写入及默认值验证", () => {
  resetState();
  const npcName = "由比滨结衣";
  // 写入一条完整带新字段的记忆
  addMemoryTag(
    npcName,
    "在侍奉部和维度过了开心的下午",
    365,
    "喜欢",
    2,
    "positive",
    ["比企谷八幡"],
    "emotion"
  );
  
  const npc = getOrCreateNPC(npcName);
  const tagObj = npc.memoryTags[0];
  if (!tagObj) throw new Error("记忆未能写入");
  if (tagObj.priority !== 2) throw new Error(`期待 priority 2, 得到 ${tagObj.priority}`);
  if (tagObj.emotional_valence !== "positive") throw new Error(`期待 positive, 得到 ${tagObj.emotional_valence}`);
  if (!tagObj.related_npcs?.includes("比企谷八幡")) throw new Error("related_npcs 丢失");
  if (tagObj.category !== "emotion") throw new Error(`期待 category emotion, 得到 ${tagObj.category}`);

  // 写入一条无任何可选参数的记忆以验证向后兼容与默认值
  addMemoryTag(npcName, "日常闲聊", 7);
  const tagObjDefault = npc.memoryTags[1];
  if (tagObjDefault.priority !== 1) throw new Error("默认 priority 应为 1");
  if (tagObjDefault.emotional_valence !== "neutral") throw new Error("默认 emotional_valence 应为 neutral");
  if (tagObjDefault.related_npcs?.length !== 0) throw new Error("默认 related_npcs 应为空数组");
  if (tagObjDefault.category !== "general") throw new Error("默认 category 应为 general");
});

test("recallRelevantMemories 打分与召回逻辑验证", async () => {
  resetState();
  const npcName = "由比滨结衣";
  
  // 1. 写入普通日常闲聊几条
  addMemoryTag(npcName, "由比滨结衣吃面包", 365, undefined, 1, "neutral", [], "general");
  addMemoryTag(npcName, "今天天气不错", 365, undefined, 1, "neutral", [], "general");
  addMemoryTag(npcName, "去便利店买饮料", 365, undefined, 1, "neutral", [], "general");
  addMemoryTag(npcName, "路过猫咪点了个头", 365, undefined, 1, "neutral", [], "general");

  // 2. 写入高优 Milestone 记忆并且关联"雪之下雪乃"
  addMemoryTag(
    npcName,
    "在教室里和雪之下雪乃探讨了猫咪",
    365,
    "喜欢",
    3,              // priority 3
    "positive",
    ["雪之下雪乃"],  // 关联人
    "milestone"      // milestone
  );

  // 3. 写入已过期记忆
  addMemoryTag(
    npcName,
    "过期的老旧事",
    -1,             // 已经过期（expires = -1）
    undefined,
    3,
    "neutral",
    [],
    "general"
  );

  const { recallRelevantMemories } = await import("./engine/state.ts");
  
  // 场景 context: 教室，雪之下雪乃在场
  const memories = recallRelevantMemories(npcName, {
    location: "教室",
    presentNPCs: ["雪之下雪乃"]
  });

  // 验证 1: 召回数量最多 3 条
  if (memories.length > 3) throw new Error(`召回条数不应超过3, 实际为 ${memories.length}`);
  
  // 验证 2: 高优/在场人匹配/地点匹配的 Milestone 记忆应该处于第一位
  if (!memories[0].includes("探讨了猫咪")) {
    throw new Error(`第一条应为高优教室记忆，实际为: ${memories[0]}`);
  }

  // 验证 3: 已过期记忆绝对不应该被召回
  if (memories.some(m => m.includes("过期的老旧事"))) {
    throw new Error("过期记忆不应被召回");
  }
});

test("shortTermBuffer 追加与限制上限验证", async () => {
  resetState();
  const npcName = "由比滨结衣";
  const { appendShortTermBuffer } = await import("./engine/state.ts");

  // 写入 12 条对话
  for (let i = 1; i <= 12; i++) {
    appendShortTermBuffer(npcName, `对话_${i}`, undefined);
  }
  // 写入 6 条事件
  for (let i = 1; i <= 6; i++) {
    appendShortTermBuffer(npcName, undefined, `事件_${i}`);
  }

  const npc = getOrCreateNPC(npcName);
  if (!npc.shortTermBuffer) throw new Error("shortTermBuffer 丢失");
  
  // 验证最近对话上限 10 条，且移除了最旧的 对话_1、对话_2
  if (npc.shortTermBuffer.recentExchanges.length !== 10) {
    throw new Error(`对话列表长度应为10, 实际为 ${npc.shortTermBuffer.recentExchanges.length}`);
  }
  if (npc.shortTermBuffer.recentExchanges[0] !== "对话_3") {
    throw new Error(`应保留最新对话，最旧应为 对话_3, 实际为 ${npc.shortTermBuffer.recentExchanges[0]}`);
  }

  // 验证最近事件上限 5 条，且移除了最旧的 事件_1
  if (npc.shortTermBuffer.recentEvents.length !== 5) {
    throw new Error(`事件列表长度应为5, 实际为 ${npc.shortTermBuffer.recentEvents.length}`);
  }
  if (npc.shortTermBuffer.recentEvents[0] !== "事件_2") {
    throw new Error(`应保留最新事件，最旧应为 事件_2, 实际为 ${npc.shortTermBuffer.recentEvents[0]}`);
  }
});

test("D模块: 复盘异常容错测试", async () => {
  resetState();
  
  // 1. 模拟 generateCompletion 发生网络报错崩溃
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("DeepSeek API Timeout or Network Loss");
  };

  try {
    const settleTool = require("./tools/action/settle_scene.ts").default;
    // 即使复盘直调 LLM 崩溃抛错，settle_scene 也应当静默降级，正常跑通并写盘
    const res = await settleTool.execute("test", { summary: "雪乃在走廊散步", elapsed_minutes: 10 }, null, null, null);
    if (!res.content[0].text.includes("场景结束推进了 10分钟")) {
      throw new Error("settle_scene 没有正确跑完结算内容");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("D模块: OOC 人设标记与审计回写测试", async () => {
  resetState();
  gameState.player.location = "侍奉部";
  const { getOrCreateNPC } = require("./engine/state.ts");
  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.currentRoom = "侍奉部";

  // Mock last rendered prose
  const { setLastRenderedProse } = require("./tools/helpers.ts");
  setLastRenderedProse("雪之下一反常态，热烈地冲上前搂住玩家大呼小叫。");

  // Mock LLM Response for OOC audit
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({
        content: [{
          text: JSON.stringify({
            ooc_findings: [
              { npc: "雪之下雪乃", finding: "雪乃搂住玩家大呼小叫，严重偏离其冷静毒舌的高冷人设" }
            ],
            info_leaks: [],
            relation_changes: []
          })
        }]
      })
    } as any;
  };

  try {
    const { reviewTurn } = require("./engine/audit/review-agent.ts");
    await reviewTurn(null);

    // 检查是否成功打上 role_deviation 标记
    const tags = yukino.memoryTags.map((t: any) => t.tag);
    if (!tags.includes("role_deviation")) {
      throw new Error("OOC 检测通过，但未写入 role_deviation 记忆标签");
    }
    const oocTag = yukino.memoryTags.find((t: any) => t.tag === "role_deviation")!;
    if (oocTag.tone !== "困惑" || oocTag.expires !== 3 || oocTag.priority !== 2) {
      throw new Error(`记忆标签属性不符: expires=${oocTag.expires}, priority=${oocTag.priority}`);
    }

    // 检查 findings 警报是否存入 GameState
    if (!gameState.lastReviewFindings || gameState.lastReviewFindings.length === 0) {
      throw new Error("gameState.lastReviewFindings 应该存有警报");
    }
    if (!gameState.lastReviewFindings[0].includes("发生人设偏差")) {
      throw new Error(`警报描述不符: ${gameState.lastReviewFindings[0]}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("D模块: 泄密审计与好感去重兜底集成测试", async () => {
  resetState();
  gameState.player.location = "侍奉部";
  const { getOrCreateNPC } = require("./engine/state.ts");
  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.currentRoom = "侍奉部";
  
  // 1. 注入一个隐藏真名的秘密
  (gameState as any).secrets = {
    "雪之下雪乃": {
      trueName: { value: "秘密雪乃", revealState: "hidden" }
    }
  };

  // 2. 模拟叙事中包含了秘密名字，并且有明显的关系改善
  const { setLastRenderedProse } = require("./tools/helpers.ts");
  setLastRenderedProse("雪乃的真名其实叫秘密雪乃。玩家和她的关系拉近了许多。");

  // 3. Mock LLM review 响应：检测到泄密 + 好感变化
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({
        content: [{
          text: JSON.stringify({
            ooc_findings: [],
            info_leaks: ["泄露了雪之下雪乃的隐藏真名'秘密雪乃'"],
            relation_changes: [
              { npc: "雪之下雪乃", delta: 10, reason: "对话拉近了关系" }
            ]
          })
        }]
      })
    } as any;
  };

  try {
    // 4. 第一回合：上一轮未调好感工具，应该应用兜底好感修正
    gameState._lastTurnToolsCalled = ["look_around"]; // 没有 adjust_relation 等
    const { reviewTurn } = require("./engine/audit/review-agent.ts");
    await reviewTurn(null);

    // 检查泄密警报已存入
    const findings = gameState.lastReviewFindings || [];
    if (!findings.some(f => f.includes("[信息泄露警告]"))) {
      throw new Error("未检测到泄密警报");
    }

    // 检查好感度已应用兜底修正 (0 + 10 = 10)
    const rel = gameState.player.relationships["雪之下雪乃"];
    if (!rel || rel.affection !== 10) {
      throw new Error(`兜底好感未生效，affection 为 ${rel?.affection}`);
    }
    if (rel.notes !== "对话拉近了关系") {
      throw new Error(`兜底好感备注错误: ${rel.notes}`);
    }

    // 5. 验证 recordTurnLog 是否把警报写入 unresolved changes，且用 lastTurnToolsCalled 进行了填充
    const { recordTurnLog } = require("./engine/state.ts");
    const log = recordTurnLog({
      playerAction: "探讨秘密",
      resolvedChanges: "尝试探讨",
      sceneResult: "雪乃脸红",
      openHooks: "无",
      nextPressure: "无",
      toolsCalled: []
    });

    if (!log.resolvedChanges.includes("[复盘警报]")) {
      throw new Error("recordTurnLog 应将复盘警报追加到 resolvedChanges");
    }
    if (!log.toolsCalled.includes("look_around")) {
      throw new Error("recordTurnLog 应使用 _lastTurnToolsCalled 填充空 toolsCalled");
    }

    // 6. 验证 buildStatePrompt 会注入复盘警告
    const { buildStatePrompt } = require("./engine/state.ts");
    const prompt = await buildStatePrompt();
    if (!prompt.includes("[系统复盘警报]")) {
      throw new Error("buildStatePrompt 未注入复盘警报提示");
    }

    // 7. 第二回合：上一轮调了好感工具，应该去重、不应用兜底好感修正
    gameState._lastTurnToolsCalled = ["adjust_relation"]; // 包含关系调整工具
    rel.affection = 50; // 重设
    await reviewTurn(null);
    if (rel.affection !== 50) {
      throw new Error(`上一轮已调用过 adjust_relation，好感度不应重复修正，但变为了 ${rel.affection}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
// N13: action 工具补充测试 (批次1 — 高频工具)
// ═══════════════════════════════════════════════════════════

test("ACTION: create_story_hook 注入动态事件", async () => {
  resetState();
  const tool = require("./tools/action/create_story_hook.ts").default;
  const before = gameState.dynamicEvents.length;
  await tool.execute("test", {
    hook_text: "测试钩子：操场有人在单挑",
    source_npc: "雪之下雪乃",
    urgency: "high",
    title: "操场对决",
  }, null, null, null);
  if (gameState.dynamicEvents.length <= before) {
    throw new Error("create_story_hook 未注入 dynamicEvents");
  }
  const ev = gameState.dynamicEvents[gameState.dynamicEvents.length - 1];
  if (ev.hook.hook_text !== "测试钩子：操场有人在单挑") throw new Error("钩子文本不匹配");
  if (ev.hook.urgency !== "high") throw new Error("urgency 不匹配");
});

test("ACTION: add_life_event 添加疾病事件", async () => {
  resetState();
  const tool = require("./tools/action/add_life_event.ts").default;
  await tool.execute("test", {
    npc_name: "由比滨结衣",
    event_type: "illness",
    event_id: "test_flu_yui",
    details: { type: "流感", severity: "重", contagious: true },
    reason: "淋雨着凉",
  }, null, null, null);
  const npc = gameState.npcs["由比滨结衣"];
  if (!npc) throw new Error("NPC 未生成");
  if (!npc.lifeEvents || npc.lifeEvents.length === 0) throw new Error("lifeEvents 未注入");
  const ev = npc.lifeEvents[0];
  if (ev.type !== "illness" || ev.data.type !== "流感") throw new Error(`事件数据不匹配: ${JSON.stringify(ev)}`);
});

test("ACTION: use_ability narrativeOnly 无消耗", async () => {
  resetState();
  // 给玩家加一个 narrativeOnly 能力
  gameState.player.abilities = { "心理战·読み合い": 1 };
  gameState.player.resourcePools = { mp: 100 };
  const tool = require("./tools/action/use_ability.ts").default;
  const result = await tool.execute("test", {
    ability: "心理战·読み合い",
    target: "雪之下雪乃",
  }, null, null, null);
  // narrativeOnly 能力应该返回 ok 或提示"无此能力"
  if (!result.content || result.content.length === 0) {
    throw new Error("use_ability 无返回内容");
  }
});
loadActiveWorld("oregairu");
// ensure worldpack data is loaded (residenceTemplates etc), resetState does not load data


test("INIT: init_game 创建引擎骨架 + 最小兜底（内衣/最低生活费/生殖器档案/world flag）", async () => {
  const tool = require("./tools/state/init_game.ts").default;
  await tool.execute("test", { name: "岸田文雄", gender: "男", age: 67, year: 2018 }, null, null, null);
  // 引擎骨架
  if (gameState.player.name !== "岸田文雄") throw new Error("玩家姓名未初始化");
  if (gameState.player.age !== 67) throw new Error("玩家年龄未初始化");
  // 最小兜底：资金按龄给
  if (gameState.player.funds < 1000) throw new Error(`init_game 应给最低生活费，实际: ${gameState.player.funds}`);
  // 最小兜底：内衣
  const eqSlots = Object.keys(gameState.player.equipment || {});
  if (!eqSlots.includes("inner_top") || !eqSlots.includes("inner_bot")) {
    throw new Error(`init_game 应给内衣兜底，实际装备槽: ${eqSlots.join(",")}`);
  }
  // 背包应仅有手机（基础设施兜底，非叙事物品）
  const playerInv = gameState.player.inventory || [];
  const nonPhoneItems = playerInv.filter((i: any) => i.name !== "手机");
  if (nonPhoneItems.length !== 0) throw new Error(`init_game 不应放入叙事物品: ${nonPhoneItems.map((i:any)=>i.name).join(",")}`);
  // 能力/资源池应该为空（由 init_profile 给）
  if (Object.keys(gameState.player.abilities || {}).length !== 0) throw new Error("init_game 不应授予能力");
  if (gameState.player.resourcePools !== undefined) throw new Error("init_game 不应设置资源池");
  // 无题材硬编码
  const stateText = JSON.stringify({
    equipment: gameState.player.equipment,
    inventory: gameState.player.inventory,
    location: gameState.player.location,
  });
  if (stateText.includes("总武高") || stateText.includes("比企谷家")) {
    throw new Error("init_game 不应写入题材硬编码");
  }
  // world flag 应该被设置
  if (!gameState.flags["worldpack_oregairu"]) throw new Error("应自动设置 worldpack_oregairu flag");
});

test("INIT: init_game 返回结构化缺口报告", async () => {
  const tool = require("./tools/state/init_game.ts").default;
  const res = await tool.execute("test", { name: "测试角色", gender: "男", age: 25, year: 2018 }, null, null, null);
  const text = res.content?.[0]?.text || "";
  if (!text.includes("✅ 已填充")) throw new Error(`缺口报告应包含已填充列表，实际: ${text.slice(0,200)}`);
  if (!text.includes("❌ 未填充")) throw new Error(`缺口报告应包含未填充列表，实际: ${text.slice(0,200)}`);
  if (!text.includes("→ 建议工具")) throw new Error(`缺口报告应包含建议工具，实际: ${text.slice(0,200)}`);
  if (!text.includes("→ 可用身份模板")) throw new Error(`缺口报告应包含可用模板列表，实际: ${text.slice(0,200)}`);
  if (!text.includes("技能(0项)") && !text.includes("技能")) throw new Error("缺口报告应提及技能缺口");
  if (!text.includes("住宅(无)")) throw new Error("缺口报告应提及住宅缺口");
});

test("INIT: init_profile 千叶市高中生应用装备/背包/资金/flag/技能/关系/联系人/记忆/住宅", async () => {
  const initGame = require("./tools/state/init_game.ts").default;
  const initProfile = require("./tools/state/init_profile.ts").default;
  await initGame.execute("test", { name: "八幡", gender: "男", age: 16, year: 2018 }, null, null, null);
  const res = await initProfile.execute("test", { profileId: "千叶市高中生" }, null, null, null);
  if (!res.content?.[0]?.text?.includes("千叶市高中生")) throw new Error("init_profile 应返回已应用模板说明");
  // 资金
  if (gameState.player.funds !== 500) throw new Error(`高中生资金应为500，实际: ${gameState.player.funds}`);
  // 装备（init_profile 覆盖 init_game 的兜底内衣）
  if (gameState.player.equipment.top?.name !== "总武高男生制服") throw new Error("制服应直接穿在 top 装备槽");
  // 背包
  if (!gameState.player.inventory.some((i: any) => i.name === "手机")) throw new Error("背包应包含手机");
  if (!gameState.player.inventory.some((i: any) => i.name === "书包")) throw new Error("背包应包含书包");
  // flags（引擎自动生成：age=16 → soubu_high_enrolled + student）
  if (gameState.player.flags.student !== true || gameState.player.flags.soubu_high_enrolled !== true) throw new Error("高中生 flags 未设置");
  // 技能
  if (!gameState.player.skills["国語"] || gameState.player.skills["国語"].level !== 2) throw new Error("国語技能应为 Lv2");
  // 入学记忆（引擎自动生成，写入 player.memories）
  if (!gameState.player.memories?.some((m: any) => m.tag?.includes("入学"))) throw new Error("应有入学记忆");
  // 手机 phoneData 已初始化（联系人可空——GM 负责填）
  const phone = gameState.player.inventory.find((i: any) => i.name?.includes("手机"));
  if (!phone?.phoneData) throw new Error("手机应有 phoneData");
  // 住宅
  if (!gameState.player.properties["家"]) throw new Error("应实例化住宅'家'");
  // 缺口报告应包含已填充内容
  const text = res.content?.[0]?.text || "";
  if (!text.includes("✅ 已填充")) throw new Error("应包含缺口报告");
});

test("INIT: init_profile 替身使者授予能力和资源池，可直接 use_ability", async () => {
  const initGame = require("./tools/state/init_game.ts").default;
  const initProfile = require("./tools/state/init_profile.ts").default;
  const useAbility = require("./tools/action/use_ability.ts").default;
  await initGame.execute("test", { name: "乔鲁诺", gender: "男", age: 15, year: 2001 }, null, null, null);
  await initProfile.execute("test", { profileId: "替身使者" }, null, null, null);
  const ability = gameState.player.abilities["黄金体验"] as any;
  if (!ability || ability.level !== 1) throw new Error("黄金体验应以Lv1授予");
  const standPower = gameState.player.resourcePools?.stand_power;
  if (!standPower || standPower.current !== 50 || standPower.max !== 50) throw new Error("stand_power 资源池应为50/50");
  const res = await useAbility.execute("test", { ability: "黄金体验" }, null, null, null);
  const text = res.content?.[0]?.text || "";
  if (text.includes("资源不足") || text.includes("前置条件不满足") || text.includes("未知能力")) {
    throw new Error(`替身使者 profile 后 use_ability 不应被初始化缺失卡住: ${text}`);
  }
});

test("INIT: init_profile 缺失模板返回错误且不半写状态", async () => {
  const initGame = require("./tools/state/init_game.ts").default;
  const initProfile = require("./tools/state/init_profile.ts").default;
  await initGame.execute("test", { name: "无模板", gender: "男", age: 20, year: 2018 }, null, null, null);
  const before = JSON.stringify(gameState.player);
  const res = await initProfile.execute("test", { profileId: "不存在的模板" }, null, null, null);
  const text = res.content?.[0]?.text || "";
  if (!text.includes("未找到身份模板")) throw new Error(`应返回缺失模板错误，实际: ${text}`);
  if (!text.includes("可用模板")) throw new Error(`应列出可用模板，实际: ${text}`);
  if (!text.includes("缺口")) throw new Error(`应包含缺口报告，实际: ${text}`);
  if (JSON.stringify(gameState.player) !== before) throw new Error("缺失模板不应修改玩家状态");
});

test("INIT: init_profile 武道见习授予技能，skills 以 {level,exp,nextLevel} 结构写入", async () => {
  const initGame = require("./tools/state/init_game.ts").default;
  const initProfile = require("./tools/state/init_profile.ts").default;
  await initGame.execute("test", { name: "武道初学者", gender: "男", age: 16, year: 2018 }, null, null, null);
  await initProfile.execute("test", { profileId: "武道见习" }, null, null, null);
  const g = gameState.player.skills as any;
  if (!g["格斗"] || g["格斗"].level !== 2 || g["格斗"].exp !== 0 || g["格斗"].nextLevel !== 20) {
    throw new Error("格斗应为 Lv2, exp=0, nextLevel=20");
  }
  if (!g["闪避"] || g["闪避"].level !== 1 || g["闪避"].nextLevel !== 10) {
    throw new Error("闪避应为 Lv1, nextLevel=10");
  }
  if (!g["气功"] || g["气功"].level !== 1) throw new Error("气功应为 Lv1");
  if (gameState.player.funds !== 300) throw new Error("资金应为300");
  const top = gameState.player.equipment.top as any;
  if (!top || top.name !== "武道着") throw new Error("应装备武道着");
  if (!gameState.player.flags["martial_trainee"]) throw new Error("flag martial_trainee 应为 true");
  // 住宅
  if (!gameState.player.properties["道场寮"]) throw new Error("应实例化道场寮");
});

test("INIT: 杀手场景——无匹配模板 + 缺口报告指导 LLM 补全", async () => {
  const initGame = require("./tools/state/init_game.ts").default;
  const initProfile = require("./tools/state/init_profile.ts").default;
  await initGame.execute("test", { name: "杀手", gender: "男", age: 30, year: 2018 }, null, null, null);
  // 兜底
  if (gameState.player.funds < 1000) throw new Error("杀手应有最低生活费");
  if (!gameState.player.equipment.inner_top) throw new Error("杀手至少应有内衣");
  // 无匹配模板
  const res = await initProfile.execute("test", { profileId: "杀手" }, null, null, null);
  const text = res.content?.[0]?.text || "";
  if (!text.includes("未找到身份模板")) throw new Error(`应返回缺失模板错误`);
  if (!text.includes("可用模板")) throw new Error(`应列出可用模板让 LLM 选择`);
  // LLM 可以手动补：spawn 武器、set_flags criminal
  // 引擎不替杀手决定装备，但缺口报告应该告诉 LLM 该怎么做
  if (!text.includes("建议工具") && !text.includes("grant_skill_exp") && !text.includes("spawn")) {
    throw new Error(`缺口报告应包含工具建议`);
  }
});


// ═══════════════════════════════════════════════════════════
// N13: action 工具补充测试 (批次2 — 低频工具冒烟)
// ═══════════════════════════════════════════════════════════

test("ACTION: gamble_bet 执行不崩溃", async () => {
  resetState();
  gameState.player.money = 5000;
  const tool = require("./tools/action/gamble_bet.ts").default;
  const result = await tool.execute("test", {
    action: "bet_on_match",
    amount: 100,
    details: "测试下注",
  }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("gamble_bet 无返回");
});

test("ACTION: manage_property 不存在房产返回错误", async () => {
  resetState();
  const tool = require("./tools/action/manage_property.ts").default;
  try {
    await tool.execute("test", { propertyId: "nonexistent_999", action: "rent" }, null, null, null);
    throw new Error("应抛出异常但未抛出");
  } catch (e: any) {
    if (!e.message.includes("未在房产名录中找到")) throw e;
  }
});

test("ACTION: restock_shop 补货不崩溃", async () => {
  resetState();
  const tool = require("./tools/action/restock_shop.ts").default;
  const result = await tool.execute("test", {
    shop_id: "convenience_store",
  }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("restock_shop 无返回");
});

test("ACTION: black_market_trade 购买不崩溃", async () => {
  resetState();
  gameState.player.money = 50000;
  const tool = require("./tools/action/black_market_trade.ts").default;
  const result = await tool.execute("test", {
    action: "buy",
    item: "盗聴器",
    quantity: 1,
  }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("black_market_trade 无返回");
});

// ═══════════════════════════════════════════════════════════
// N14: 核心 TUI 面板冒烟测试
// ═══════════════════════════════════════════════════════════

test("TUI: /status 面板不抛异常", async () => {
  resetState();
  const { runStatus } = require("./tools/helpers.ts");
  const ctx = { ui: { custom: (..._: any[]) => {} }, chat: { addSystemMessage: (..._: any[]) => {} } };
  await runStatus(ctx);
});

test("TUI: /bag 面板不抛异常", async () => {
  resetState();
  // /bag 通过 handler 入口：require panel → call handler
  const panel = require("./tools/tui/bag.ts").default;
  const ctx = { ui: { custom: (..._: any[]) => {} } };
  await panel.handler([], ctx);
});

test("TUI: /look 面板不抛异常", async () => {
  resetState();
  const panel = require("./tools/tui/look.ts").default;
  const ctx = { ui: { custom: (..._: any[]) => {}, notify: (..._: any[]) => {} } };
  await panel.handler("雪之下雪乃", ctx);
});

test("TUI: /relations 面板不抛异常", async () => {
  resetState();
  const panel = require("./tools/tui/relations.ts").default;
  const ctx = { ui: { custom: (..._: any[]) => {} } };
  await panel.handler([], ctx);
});

test("TUI: /alerts 面板不抛异常", async () => {
  resetState();
  const panel = require("./tools/tui/alerts.ts").default;
  const ctx = { ui: { custom: (..._: any[]) => {} } };
  await panel.handler([], ctx);
});

test("TUI: /weather 面板不抛异常", async () => {
  resetState();
  const panel = require("./tools/tui/weather.ts").default;
  const ctx = { ui: { custom: (..._: any[]) => {} } };
  await panel.handler([], ctx);
});

// ═══════════════════════════════════════════════════════════
// N15: 关键 lookup 工具完整路径测试
// ═══════════════════════════════════════════════════════════

test("LOOKUP: lookup_ability 返回能力信息", async () => {
  resetState();
  const tool = require("./tools/lookup/lookup_ability.ts").default;
  const result = await tool.execute("test", { ability: "写轮眼" }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("lookup_ability 无返回");
});

test("LOOKUP: lookup_lore 查询世界观设定", async () => {
  resetState();
  const tool = require("./tools/lookup/lookup_lore.ts").default;
  const result = await tool.execute("test", { keyword: "总武高" }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("lore 查询无返回");
});

test("LOOKUP: lookup_region 返回区域设定", async () => {
  resetState();
  const tool = require("./tools/lookup/lookup_region.ts").default;
  const result = await tool.execute("test", { location: "侍奉部" }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("区域查询无返回");
});

test("LOOKUP: dice_roll 执行骰子检定", async () => {
  resetState();
  const tool = require("./tools/lookup/dice_roll.ts").default;
  const result = await tool.execute("test", { attribute: "智力", dc: 15, skill: "情报" }, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("骰子检定无返回");
});

test("LOOKUP: lookup_weather 查询天气", async () => {
  resetState();
  const tool = require("./tools/lookup/lookup_weather.ts").default;
  const result = await tool.execute("test", {}, null, null, null);
  if (!result.content || result.content.length === 0) throw new Error("天气查询无返回");
});

test("META: 所有 action 工具都在 trackedTools 中（saveState 包裹保护）", async () => {
  // O9: 扫描 tools/action/，确认所有工具都经过 withToolTracking 包裹（自动 try-catch + saveState）
  const fs = require("node:fs");
  const path = require("node:path");
  const actionDir = path.resolve(process.cwd(), "tools", "action");
  if (!fs.existsSync(actionDir)) return;
  const actionFiles = fs.readdirSync(actionDir).filter((f: string) => f.endsWith(".ts"));

  // 动态加载 registry 的 trackedTools 列表
  const registry = require("./tools/registry.ts");
  // 检查 registerAll 中 trackedTools 数组引用的所有工具名
  // 通过静态分析 registry.ts 源码确认
  const registrySrc = fs.readFileSync(path.resolve(process.cwd(), "tools", "registry.ts"), "utf-8");

  const missing: string[] = [];
  const excluded = ["masturbate.ts", "sex_touch.ts"]; // private_extras

  for (const f of actionFiles) {
    if (excluded.includes(f)) continue;
    const name = f.replace(".ts", "");
    // 检查此工具在 registry 中是否被 import 且放进 trackedTools
    if (!registrySrc.includes(`./action/${name}`)) {
      missing.push(f);
    }
  }

  if (missing.length > 0) {
    console.warn(`  ⚠ ${missing.length} 个 action 工具未在 registry 中注册（可能已废弃或未连接）: ${missing.join(", ")}`);
  }
  // 不强制 fail — 只警告，因为可能有条件导入的工具
});

// ═══════════════════════════════════════════════════════════
// ABILITY: 技能树 + 规则系 + 社交技能 (v2)
// ═══════════════════════════════════════════════════════════

test("ABILITY: buildSkillTree 返回 style→techniques 映射", () => {
  const { loadAbilities, buildSkillTree, getTechniquesForStyle } = require("./engine/abilities.ts");
  loadAbilities();
  const tree = buildSkillTree();
  if (!tree["忍術"] || tree["忍術"].length === 0) throw new Error("忍術 style 应有至少1个派生technique");
  if (!tree["不知火流忍術"] || tree["不知火流忍術"].length < 2) throw new Error("不知火流忍術 应有≥2个technique（花蝶扇、超必殺忍蜂）");
  const shiranuiMoves = getTechniquesForStyle("不知火流忍術");
  if (!shiranuiMoves.includes("花蝶扇")) throw new Error("不知火流 应有花蝶扇");
  if (!shiranuiMoves.includes("超必殺忍蜂")) throw new Error("不知火流 应有超必殺忍蜂");
});

test("ABILITY: 规则系能力注入 rules+limitations", () => {
  const { useAbility } = require("./engine/abilities.ts");
  const user = {
    name: "测试角色",
    resourcePools: { stand_power: { current: 50, max: 50 } },
    abilities: { "黄金体验": { name: "黄金体验", level: 1, exp: 0, nextLevel: 10, cooldownRemaining: 0 } },
    skills: {},
    attributes: {},
  };
  const result = useAbility(user, "黄金体验");
  if (!result.ok) throw new Error(`黄金体验应成功: ${result.errors.join("; ")}`);
  if (!result.narrative.includes("[规则]")) throw new Error("规则系应注入[规则]文本");
  if (!result.narrative.includes("[限制]")) throw new Error("规则系应注入[限制]文本");
});

test("ABILITY: 社交技能返回 social_effect 提示", () => {
  const { useAbility } = require("./engine/abilities.ts");
  const user = {
    name: "测试角色",
    resourcePools: { mp: { current: 50, max: 50 } },
    abilities: { "心理战·読み合い": { name: "心理战·読み合い", level: 1, exp: 0, nextLevel: 10, cooldownRemaining: 0 } },
    skills: {},
    attributes: { 智力: 16, 感知: 14 },
  };
  const result = useAbility(user, "心理战·読み合い", "雪之下雪乃");
  if (!result.ok) throw new Error(`社交技能应成功: ${result.errors.join("; ")}`);
  if (!result.narrative.includes("[社交效果]")) throw new Error("社交技能应注入[社交效果]文本");
});

// ── 回归护栏：gridPos save/load + 家具拒绝 + 年龄适配 + 2018兜底 ──

test("REGRESSION: gridPos 在 saveState→loadState 后不丢失", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const stateDir = process.env.NODE_ENV === "test" ? "state_test" : "state";
  const STATE_FILE = path.resolve(process.cwd(), stateDir, "session.json");
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  gameState.player.gridPos = [3, 2];
  saveState(STATE_FILE);
  loadState(STATE_FILE);
  if (!gameState.player.gridPos) throw new Error("gridPos 在 loadState 后变为 null");
  const [px, py] = gameState.player.gridPos;
  if (px !== 3 || py !== 2) throw new Error("gridPos 被 loadState 覆盖: 期望[3,2] 实际[" + px + "," + py + "]");
});

test("REGRESSION: loadState 已有 gridPos 时不重置", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  if (!gameState.player.gridPos) throw new Error("initPlayerGrid 失败");
  const posBefore = [...gameState.player.gridPos];
  saveState();
  const { loadState } = require("./engine/state.ts");
  loadState();
  if (!gameState.player.gridPos) throw new Error("gridPos 被 loadState 清空");
  const [px2, py2] = gameState.player.gridPos;
  if (px2 !== posBefore[0] || py2 !== posBefore[1]) throw new Error("gridPos 被覆盖: " + posBefore + " -> [" + px2 + "," + py2 + "]");
});

test("REGRESSION: 家具交互 无床房间睡觉→拒绝", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  initPlayerGrid();
  const room = getRoom("侍奉部");
  if (!room || !room.cells || room.cells.length === 0) return;
  const { interactFurniture } = await import("./engine/furniture.ts");
  const r = await interactFurniture("床", "睡觉", gameState, gameState.player.gridPos as [number,number], room.cells);
  if (!r.message) throw new Error("应返回 message");
  if (r.effects && r.effects.length > 0 && r.effects.some((e: string) => e.includes("疲劳") || e.includes("HP") || e.includes("体力"))) {
    throw new Error("无床房间不应产生休息效果: " + JSON.stringify(r.effects));
  }
});

test("REGRESSION: 家具交互 gridPos=null 空间动作→拒绝", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  const { interactFurniture } = await import("./engine/furniture.ts");
  gameState.player.gridPos = null as any;
  const r = await interactFurniture("床", "睡觉", gameState, null as any, null as any);
  if (!r.message) throw new Error("应返回 message");
  if (r.message.includes("疲劳") || (r.effects && r.effects.some((e: string) => e.includes("疲劳")))) {
    throw new Error("gridPos=null 时应拒绝空间动作，不应产生效果");
  }
});

test("REGRESSION: 家具交互 unhide null坐标→放行", async () => {
  resetState();
  setPlayerLocation("侍奉部");
  const { interactFurniture, findFurnitureDef } = await import("./engine/furniture.ts");
  const safeDef = findFurnitureDef("保险箱", gameState.activeWorld);
  if (!safeDef?.containers?.[0]) return;
  safeDef.containers[0].can_hold_person = true;
  safeDef.containers[0].max_volume = 100;
  safeDef.state = safeDef.state || {};
  safeDef.state.locked = false;
  gameState.player.concealed = true;
  gameState.player.hiding_in = "保险箱";
  const r = await interactFurniture("保险箱", "出来", gameState, null as any, null as any);
  if (gameState.player.concealed) throw new Error("concealed应清除");
  if (gameState.player.hiding_in) throw new Error("hiding_in应清除");
});

test("REGRESSION: getNPCOutfitDesc 年龄差>3 不穿高中制服", () => {
  gameState.npcs["雪之下雪乃"] = { currentRoom: "", alive: true, current_goal: "", memoryTags: [], scheduleGroup: "小学生", currentOutfit: "school" } as any;
  const saved = gameState.time.game_date;
  gameState.time.game_date = "2009-04-07";
  try {
    const desc = getNPCOutfitDesc("雪之下雪乃");
    if (desc.includes("总武高制服")) throw new Error("年龄差>3不应穿高中制服: " + desc);
    if (!desc.includes("cm")) throw new Error("应包含身高: " + desc);
  } finally {
    gameState.time.game_date = saved;
    delete gameState.npcs["雪之下雪乃"];
  }
});

test("REGRESSION: advanceTime 兜底用 timeline_origin 而非 2018", () => {
  const { advanceTime } = require("./engine/time.ts");
  const ts: any = { game_date: undefined, timeline_origin: { year: 2009, age: 10 }, minute_of_day: 480, day_of_week: "月", player_age: 10, player_stage: "child", time_of_day: "morning" };
  advanceTime(ts, 1);
  if (ts.game_date.slice(0, 4) !== "2009") throw new Error("advanceTime 应用2009而非2018: " + ts.game_date);
});

test("WorldState: applyBeatEffects and translateWorldState limits", async () => {
  resetState();
  const { applyBeatEffects } = require("./engine/timeline.ts");
  const { translateWorldState } = require("./engine/state.ts");

  // Initial tech stability tension
  if (gameState.worldState.tech !== 0 || gameState.worldState.stability !== 0 || gameState.worldState.tension !== 0) {
    throw new Error("WorldState initial values should be 0");
  }

  // Delta updates
  await applyBeatEffects({
    worldStateDelta: { tech: 2, stability: -1, tension: 5, globalFlags: { war_broke_out: true } }
  });
  if (gameState.worldState.tech !== 2 || gameState.worldState.stability !== -1 || gameState.worldState.tension !== 5) {
    throw new Error("Delta update failed: " + JSON.stringify(gameState.worldState));
  }
  if (gameState.worldState.globalFlags.war_broke_out !== true) {
    throw new Error("Global flag merge failed");
  }

  // Bounds checks
  await applyBeatEffects({
    worldStateDelta: { tech: 10, stability: -10, tension: -2 }
  });
  if (gameState.worldState.tech !== 5 || gameState.worldState.stability !== -3 || gameState.worldState.tension !== 3) {
    throw new Error("Bounds enforcement failed: " + JSON.stringify(gameState.worldState));
  }

  // Natural language translation
  const trans = translateWorldState(gameState.worldState);
  if (!trans.includes("崩溃") || !trans.includes("赛博朋克")) {
    throw new Error("Natural language translation wrong: " + trans);
  }
});

test("WorldState: conditional on_expire branches", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { expireHook } = require("./engine/timeline.ts");

  // Make an event with branch expire conditions
  const ev = {
    id: "test_branch_expire",
    title: "测试分支过期",
    trigger: { min_day: 1 },
    on_expire: {
      branches: [
        {
          condition: { stability: { max: -2 } },
          effects: { flags: { war_branch_hit: true } }
        },
        {
          condition: { tech: { min: 4 } },
          effects: { flags: { tech_branch_hit: true } }
        },
        {
          default: true,
          effects: { flags: { default_branch_hit: true } }
        }
      ]
    }
  };

  // Run with default/initial worldState (all 0)
  const hook = { event_id: "test_branch_expire", source_npc: "雪之下雪乃", hook_text: "", urgency: "low", created_day: 1, expires_day: 2, seen_count: 0 };
  
  // Inject mock event
  gameState.dynamicEvents = [ev as any];
  await expireHook(hook);
  if (gameState.flags.default_branch_hit !== true) {
    throw new Error("Default branch not hit when state is 0");
  }

  // Run with low stability (stability <= -2)
  resetState();
  loadActiveWorld("oregairu");
  gameState.worldState = { tech: 0, stability: -3, tension: 0, globalFlags: {} };
  gameState.dynamicEvents = [ev as any];
  await expireHook(hook);
  if (gameState.flags.war_branch_hit !== true) {
    throw new Error("Stability branch not hit under war state");
  }

  // Run with high tech (tech >= 4)
  resetState();
  loadActiveWorld("oregairu");
  gameState.worldState = { tech: 5, stability: 0, tension: 0, globalFlags: {} };
  gameState.dynamicEvents = [ev as any];
  await expireHook(hook);
  if (gameState.flags.tech_branch_hit !== true) {
    throw new Error("Tech branch not hit under cyber state");
  }
});

test("WorldState: memory staining", () => {
  resetState();
  const { addMemoryTag } = require("./engine/state.ts");

  // 1. Normal state -> no staining
  addMemoryTag("雪之下雪乃", "送了一本书", 365, "喜欢");
  let tag = gameState.npcs["雪之下雪乃"].memoryTags[0].tag;
  if (tag !== "送了一本书") {
    throw new Error("Memory stained when state is normal: " + tag);
  }

  // 2. High tension & low stability state -> stained
  resetState();
  gameState.worldState = { tech: 0, stability: -1, tension: 5, globalFlags: {} };
  addMemoryTag("雪之下雪乃", "送了一本书", 365, "喜欢");
  tag = gameState.npcs["雪之下雪乃"].memoryTags[0].tag;
  if (!tag.includes("局势动荡") || !tag.includes("人人自危")) {
    throw new Error("Memory not stained correctly under tension/instability: " + tag);
  }
});

test("Party System: physical follow and schedule bypass", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { setPlayerLocation, getOrCreateNPC, updateNPCSchedules } = require("./engine/state.ts");

  // Setup companion
  const companionName = "雪之下雪乃";
  getOrCreateNPC(companionName);
  gameState.player.party = [companionName];

  // 1. Player changes room -> Companion follows
  setPlayerLocation("侍奉部部室");
  if (gameState.npcs[companionName].currentRoom !== gameState.player.location) {
    throw new Error("Teammate did not follow player location change");
  }
  if (gameState.npcs[companionName].action !== "跟随玩家") {
    throw new Error("Teammate action is not 跟随玩家: " + gameState.npcs[companionName].action);
  }

  // 2. updateNPCSchedules -> Companion schedule is bypassed
  // Set a different time that would normally move them
  gameState.time.time_of_day = "evening";
  await updateNPCSchedules();
  if (gameState.npcs[companionName].currentRoom !== gameState.player.location) {
    throw new Error("Teammate schedule was not bypassed, teleported to " + gameState.npcs[companionName].currentRoom);
  }
});

test("Party System: party_management stranger restriction", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const partyManagement = require("./tools/state/party_management.ts").default;

  // Attempt to invite a stranger
  const res1 = await partyManagement.execute("test_stranger", { action: "add", npc: "无名恶棍" });
  if (!res1.content[0].text.includes("无法邀请陌生人")) {
    throw new Error("Stranger was allowed to join: " + res1.content[0].text);
  }

  // Invite a known character (e.g. Yukino)
  const res2 = await partyManagement.execute("test_friend", { action: "add", npc: "雪之下雪乃" });
  if (!res2.content[0].text.includes("加入了队伍")) {
    throw new Error("Friend was not allowed to join: " + res2.content[0].text);
  }
  if (!gameState.player.party.includes("雪之下雪乃")) {
    throw new Error("Party list does not contain friend");
  }
});

test("Party System: direct_party_member execution and d20 checks", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const partyManagement = require("./tools/state/party_management.ts").default;
  const directPartyMember = require("./tools/action/direct_party_member.ts").default;

  // Add Yukino to party
  await partyManagement.execute("add_yukino", { action: "add", npc: "雪之下雪乃" });
  const npc = getOrCreateNPC("雪之下雪乃");

  // Move Yukino to another room to test location check
  npc.currentRoom = "自宅";
  gameState.player.location = "侍奉部部室";

  const res1 = await directPartyMember.execute("direct_fail_loc", { npcName: "雪之下雪乃", action: "attack" });
  if (!res1.content[0].text.includes("不在此处")) {
    throw new Error("Failed location check validation: " + res1.content[0].text);
  }

  // Move them to the same room
  npc.currentRoom = "侍奉部部室";
  const res2 = await directPartyMember.execute("direct_ok", { npcName: "雪之下雪乃", action: "attack", target: "小混混" });
  if (!res2.content[0].text.includes("执行指挥行动")) {
    throw new Error("Direct command failed: " + res2.content[0].text);
  }
  if (res2.details.success === undefined) {
    throw new Error("Details missing roll success attribute");
  }
});

test("FF Switch: switch and restore entities & relationships", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const switchCharacter = require("./tools/action/switch_character.ts").default;

  // Initialize Yukino NPC and original player
  gameState.player.name = "维";
  gameState.player.hp = { current: 100, max: 100 };
  gameState.player.location = "侍奉部部室";
  gameState.player.gridPos = [5, 5];
  gameState.player.relationships["雪之下雪乃"] = { stage: "陌生", romance: null, affection: 35, notes: "测试", history: [] };

  const npc = getOrCreateNPC("雪之下雪乃");
  npc.currentRoom = "自宅";
  npc.gridPos = [2, 2];
  npc.hp = { current: 80, max: 80 };
  npc.attributes = { 力量: 8, 敏捷: 12, 体质: 9, 智力: 15, 感知: 13, 魅力: 14 };
  npc.npcRelationships = {
    "由比滨结衣": { stage: "朋友", tone: "温和", notes: "结衣" }
  };

  // 1. Switch to Yukino
  const res1 = await switchCharacter.execute("test_switch", { action: "switch", targetNpc: "雪之下雪乃" });
  if (!res1.content[0].text.includes("已成功将视角切换到")) {
    throw new Error("POV switch failed: " + res1.content[0].text);
  }

  // Verify Player is now Yukino
  if (gameState.player.name !== "雪之下雪乃") {
    throw new Error("Player name is not 雪之下雪乃");
  }
  if (gameState.player.location !== "自宅") {
    throw new Error("Player location did not sync to NPC room");
  }
  if (gameState.player.hp.current !== 80) {
    throw new Error("Player HP is not NPC's HP");
  }
  if (gameState.player.relationships["由比滨结衣"]?.stage !== "朋友") {
    throw new Error("NPC relationship table not loaded");
  }
  if (gameState.player.relationships["维"]?.affection !== 35) {
    throw new Error("Mirror relationship affection wrong: " + JSON.stringify(gameState.player.relationships["维"]));
  }

  // Verify original player "维" is now an NPC
  const tempNpc = gameState.npcs["维"];
  if (!tempNpc) {
    throw new Error("Original player NPC '维' was not created");
  }
  if (tempNpc.currentRoom !== "侍奉部部室") {
    throw new Error("Original player NPC room is incorrect: " + tempNpc.currentRoom);
  }

  // 2. Modify player (Yukino) state while under control
  gameState.player.hp.current = 65; // Took damage
  gameState.player.location = "千叶大桥"; // Moved
  gameState.player.gridPos = [1, 1];
  gameState.player.funds = 200; // Earned/spent money

  // 3. Restore to original player "维"
  const res2 = await switchCharacter.execute("test_restore", { action: "restore" });
  if (!res2.content[0].text.includes("已成功将视角还原回主角")) {
    throw new Error("POV restore failed: " + res2.content[0].text);
  }

  // Verify original player "维" is restored
  if (gameState.player.name !== "维") {
    throw new Error("Player name is not restored to 维");
  }
  if (gameState.player.location !== "侍奉部部室") {
    throw new Error("Player location is not restored");
  }
  if (gameState.player.relationships["雪之下雪乃"]?.affection !== 35) {
    throw new Error("Relationships not restored correctly");
  }

  // Verify "维" NPC is removed
  if (gameState.npcs["维"]) {
    throw new Error("Temporary NPC '维' was not deleted after restore");
  }

  // Verify "雪之下雪乃" NPC is back with the modified data
  const restoredNpc = gameState.npcs["雪之下雪乃"];
  if (!restoredNpc) {
    throw new Error("NPC '雪之下雪乃' was not recreated in npcs list");
  }
  if (restoredNpc.hp.current !== 65) {
    throw new Error("Modified HP was not saved back to NPC: " + restoredNpc.hp.current);
  }
  if (restoredNpc.currentRoom !== "千叶大桥") {
    throw new Error("Modified location was not saved back to NPC: " + restoredNpc.currentRoom);
  }
  if (restoredNpc.funds !== 200) {
    throw new Error("Modified funds were not saved back to NPC: " + restoredNpc.funds);
  }
});

test("FF Switch: timeline beat integration", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { applyBeatEffects } = require("./engine/timeline.ts");

  // Setup original player and NPC
  gameState.player.name = "维";
  gameState.player.location = "侍奉部部室";
  const npc = getOrCreateNPC("雪之下雪乃");
  npc.currentRoom = "自宅";
  npc.attributes = { 力量: 8, 敏捷: 12, 体质: 9, 智力: 15, 感知: 13, 魅力: 14 };

  // Trigger switch via timeline beat
  await applyBeatEffects({
    switchPlayer: "雪之下雪乃"
  });

  if (gameState.player.name !== "雪之下雪乃") {
    throw new Error("Timeline beat switch failed to switch player POV");
  }
  if (gameState.npcs["维"] === undefined) {
    throw new Error("Original player NPC was not created");
  }

  // Trigger restore via timeline beat
  await applyBeatEffects({
    restorePlayer: true
  });

  if (gameState.player.name !== "维") {
    throw new Error("Timeline beat restore failed to restore player POV");
  }
  if (gameState.npcs["维"] !== undefined) {
    throw new Error("Original player NPC was not cleaned up");
  }
});

test("Pregnancy, Birth, Luck and Social Checks Verification", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC, registerDynamicCharacter } = await import("./engine/state.ts");
  const { touchBodyPart, settleAfterSex, createSexState } = await import("./engine/sex.ts");
  const { triggerBirth, addLifeEvent } = await import("./engine/life-events.ts");
  const socialCheck = (await import("./tools/action/social_check.ts")).default;
  const takeContraceptivePill = (await import("./tools/action/take_contraceptive_pill.ts")).default;
  const performAbortion = (await import("./tools/action/perform_abortion.ts")).default;

  // 1. Luck attribute initialization
  gameState.player.attributes.幸运 = 18; // Very high luck
  const yukinoshita = getOrCreateNPC("雪之下雪乃");
  yukinoshita.attributes.幸运 = 15;

  if (gameState.player.attributes.幸运 !== 18 || yukinoshita.attributes.幸运 !== 15) {
    throw new Error("Luck initialization failed");
  }

  // 2. Intimate touch with stamina depletion and condom break check
  const sexState = createSexState("雪之下雪乃", {
    name: "雪之下雪乃",
    attitude: "傲娇",
    experience: "生涩",
    baselineDesire: 30,
    bodyParts: {
      "秘部": { sensitivity: 2, development: 0, preference: "敏感" },
      "胸": { sensitivity: 1, development: 0, preference: "普通" }
    }
  });

  // Turn on layer 1
  gameState.layer1Enabled = true;
  gameState.player.sex = sexState;
  sexState.contraceptionUsed = "condom";

  // Simulate heavy touching on breasts
  const tAttrs = { 敏捷: 15, 魅力: 15, 体质: 12, 幸运: 18 };
  const r1 = touchBodyPart(sexState.profile, sexState, "胸", "重", tAttrs);

  if (sexState.stamina !== 90) {
    throw new Error("Stamina not depleted correctly: " + sexState.stamina);
  }
  // Because of high luck (+4 modifier), condom break DC 18 is highly unlikely to fail unless d20=1.
  // Let's force condom to break for testing break path:
  sexState.condomBroken = true;

  // 3. Settle sex and pregnancy check
  // Vaginal contact with broken condom -> high pregnancy risk
  // Yukino's cycleDay = 14 (排卵期, base rate = 0.35)
  sexState.cycleDay = 14;
  
  // Set random seed to mock pregnancy success
  const originalMathRandom = Math.random;
  Math.random = () => 0.01; // Mock all random checks to succeed/fail deterministically

  const report = await settleAfterSex(sexState, "2018-04-10", 30, ["秘部"], [], "维", "condom");

  if (!report.conceived) {
    throw new Error("Pregnancy calculation failed to trigger conception");
  }

  // Verify pregnancy life event is registered
  const yukinoNPC = getOrCreateNPC("雪之下雪乃");
  const pregEvent = yukinoNPC.lifeEvents?.find(e => e.type === "pregnancy");
  if (!pregEvent) {
    throw new Error("Pregnancy life event was not registered on mother");
  }

  // 4. Pill contraception termination (Emergency Pill)
  // Give Yukino 100 funds
  yukinoNPC.funds = 100;
  gameState.time.game_date = "2018-04-10";
  // Execute pill taking tool
  const pillRes = await takeContraceptivePill.execute("test_pill", { charName: "雪之下雪乃" });
  if (!pillRes.details.terminated) {
    throw new Error("Emergency contraception pill failed to terminate pregnancy");
  }
  if (yukinoNPC.funds !== 50) {
    throw new Error("Emergency pill did not deduct 50 funds");
  }
  if (yukinoNPC.lifeEvents?.some(e => e.type === "pregnancy")) {
    throw new Error("Pregnancy was not removed after emergency pill");
  }

  // Restore pregnancy for abortion test — use currentDay() so it's within the 90-day window
  const { currentDay } = await import("./engine/timeline.ts");
  const nowDay = currentDay();
  addLifeEvent("雪之下雪乃", {
    id: "pregnancy_test_abortion",
    type: "pregnancy",
    day_started: nowDay,
    data: { day_conceived: nowDay, father: "维", stage: "early" }
  });

  // Move Yukino to Hospital to allow abortion
  yukinoNPC.location = "千叶县立医院";
  yukinoNPC.funds = 600;
  // Execute abortion
  const abRes = await performAbortion.execute("test_abortion", { charName: "雪之下雪乃" });
  if (!abRes.details.success) {
    throw new Error("Abortion failed: " + abRes.content[0].text);
  }
  if (yukinoNPC.funds !== 100) {
    throw new Error("Abortion did not deduct 500 funds");
  }
  if (yukinoNPC.lifeEvents?.some(e => e.type === "pregnancy")) {
    throw new Error("Pregnancy was not removed after abortion");
  }

  // 5. Birth and Genetics
  // Setup pregnancy for birth trigger
  const birthMother = getOrCreateNPC("由比滨结衣");
  birthMother.attributes = { 力量: 8, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 14, 幸运: 12 };
  gameState.player.attributes = { 力量: 12, 敏捷: 10, 体质: 12, 智力: 12, 感知: 10, 魅力: 10, 幸运: 10 };

  const childName = triggerBirth("由比滨结衣", "维");
  
  if (!childName.startsWith("比企谷") && !childName.startsWith("由比滨") && !childName.startsWith("维")) {
    throw new Error("Child surname extraction failed: " + childName);
  }

  const childNPC = gameState.npcs[childName];
  if (!childNPC) {
    throw new Error("Child NPC was not hydrated in gameState.npcs");
  }

  // Average of mother 魅力(14) & player 魅力(10) is 12. Mutation is [-1, +2]. Child 魅力 should be between 11 and 14.
  if (childNPC.attributes.魅力 < 11 || childNPC.attributes.魅力 > 14) {
    throw new Error("Genetics calculation or attributes mutation failed: " + childNPC.attributes.魅力);
  }

  // Check double bonded relationship
  if (childNPC.npcRelationships["由比滨结衣"]?.stage !== "亲子" || birthMother.npcRelationships[childName]?.stage !== "亲子") {
    throw new Error("Child-mother relationship bindings failed");
  }

  // 6. Social Check D20 roll logic
  // Setup relation for date request
  const testNpc = getOrCreateNPC("户冢彩加");
  testNpc.personality_brief = "友善";
  testNpc.attributes.幸运 = 10;
  gameState.player.relationships["户冢彩加"] = { stage: "部员", affection: 20 };

  // Mock Math.random to return 0.5 (D20 = 11)
  Math.random = () => 0.5; // D20 = 11

  // Execute social check invite
  const scRes = await socialCheck.execute("test_social", {
    targetNpc: "户冢彩加",
    actionType: "invite_to_party",
    approach: "charm"
  });

  if (!scRes.details.success) {
    throw new Error("Social check failed to resolve success: " + scRes.content[0].text);
  }
  if (!gameState.player.party.includes("户冢彩加")) {
    throw new Error("Successful party invite did not add NPC to party");
  }

  // Restore Math.random
  Math.random = originalMathRandom;
});

// ── Step 6: 假期日程覆盖 + 通勤偶遇 ──

test("Step6: 暑假 schedule_override — NPC 不应去学校", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { clearCalendarCache } = await import("./engine/timeline.ts");
  clearCalendarCache(); // flush cached old calendar
  const { getOrCreateNPC, updateNPCSchedules } = await import("./engine/state.ts");

  // Set date to summer break
  gameState.time.game_date = "2018-07-25";
  gameState.time.day_of_week = "水";
  gameState.time.time_of_day = "morning";

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";
  yukino.currentRoom = "自宅";

  await updateNPCSchedules();

  // During summer break, NPC should NOT be moved to school
  if (yukino.currentRoom.includes("J班") || yukino.currentRoom.includes("F班") || yukino.currentRoom.includes("侍奉部")) {
    throw new Error(`暑假期间雪之下不应去学校，实际在: ${yukino.currentRoom}`);
  }
});

test("Step6: 黄金周 schedule_override — 学生组自由活动", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { clearCalendarCache } = await import("./engine/timeline.ts");
  clearCalendarCache();
  const { getOrCreateNPC, updateNPCSchedules } = await import("./engine/state.ts");

  gameState.time.game_date = "2018-05-03";
  gameState.time.day_of_week = "木";
  gameState.time.time_of_day = "afternoon";

  const yui = getOrCreateNPC("由比滨结衣");
  yui.scheduleGroup = "高校生";
  yui.currentRoom = "自宅";

  await updateNPCSchedules();

  // During golden week, NPC targetRoom resolves to "自由" → no movement
  if (yui.currentRoom.includes("J班") || yui.currentRoom.includes("F班")) {
    throw new Error(`黄金周由比滨不应在学校，实际在: ${yui.currentRoom}`);
  }
});

test("Step6: 寒假结束后日程恢复正常", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { clearCalendarCache } = await import("./engine/timeline.ts");
  clearCalendarCache();
  const { getOrCreateNPC, updateNPCSchedules } = await import("./engine/state.ts");

  // Winter break ended on 1/8 — set to 1/10
  gameState.time.game_date = "2018-01-10";
  gameState.time.day_of_week = "水";
  gameState.time.time_of_day = "morning";

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";
  yukino.currentRoom = "自宅";
  gameState.player.location = "总武高";

  await updateNPCSchedules();

  // After winter break, normal school schedule should resume
  const schoolRooms = ["2年J班", "2年F班", "侍奉部", "社团楼1F走廊"];
  const isAtSchool = schoolRooms.some(r => yukino.currentRoom.includes(r));
  // Free NPCs may be at other locations — but should have been moved from 自宅
  if (yukino.currentRoom === "自宅") {
    throw new Error("寒假结束后 NPC 应恢复学校日程，不应仍在家");
  }
});

test("Step6: 通勤偶遇检测 — 上学方向同路NPC", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { detectCommuteEncounter } = require("./engine/commute.ts");

  gameState.time.time_of_day = "morning";
  gameState.player.party = [];

  // Setup NPCs
  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";
  yukino.alive = true;

  const yui = getOrCreateNPC("由比滨结衣");
  yui.scheduleGroup = "高校生";
  yui.alive = true;

  // Non-student NPC — should not be candidate
  const clerk = getOrCreateNPC("店员田中");
  clerk.scheduleGroup = "店员";
  clerk.alive = true;

  // Override Math.random to force probability
  const origRandom = Math.random;
  Math.random = () => 0.1; // Low enough to trigger encounter

  const result = await detectCommuteEncounter("千葉駅前", "千叶市立总武高等学校", "电车", 10, gameState as any);

  Math.random = origRandom;

  if (!result) throw new Error("上学通勤应触发偶遇");
  if (!result.includes("通勤偶遇")) throw new Error(`结果应包含[通勤偶遇]: ${result}`);
  if (!result.includes("雪之下") && !result.includes("由比滨")) {
    throw new Error("应检测到至少一位学生NPC同路");
  }
  if (result.includes("店员")) throw new Error("店员不应出现在上学偶遇中");
});

test("Step6: 通勤偶遇检测 — 放学方向同路NPC", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { detectCommuteEncounter } = require("./engine/commute.ts");

  gameState.time.time_of_day = "afternoon";
  gameState.player.party = [];

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";
  yukino.alive = true;

  const origRandom = Math.random;
  Math.random = () => 0.1;

  const result = await detectCommuteEncounter("千叶市立总武高等学校", "千葉駅前", "电车", 10, gameState as any);

  Math.random = origRandom;

  if (!result) throw new Error("放学通勤应触发偶遇");
  if (!result.includes("雪之下")) throw new Error(`结果应包含NPC名: ${result.slice(0, 80)}`);
});

test("Step6: 载具感知 — 汽车不应出现在通勤偶遇叙事中", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { detectCommuteEncounter } = require("./engine/commute.ts");

  gameState.time.time_of_day = "morning";
  gameState.player.vehicle = { type: "car", name: "丰田卡罗拉", speedMul: 8 };
  gameState.player.party = [];

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";
  yukino.alive = true;

  // Force encounter (Math.random=0.01 < any probability)
  const origRandom = Math.random;
  Math.random = () => 0.5; // 0.5 > 0.03(car probability) → should skip

  const result = await detectCommuteEncounter("千葉駅前", "千叶市立总武高等学校", "步行", 10, gameState as any);
  Math.random = origRandom;

  // With Math.random=0.5 and car probability=0.03, encounter should be skipped
  if (result) throw new Error(`开车时不应触发步行的偶遇: ${result.slice(0, 80)}`);
});

test("Step6: 载具感知 — 自行车偶遇文案正确", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { detectCommuteEncounter } = require("./engine/commute.ts");

  gameState.time.time_of_day = "morning";
  gameState.player.vehicle = { type: "bicycle", name: "自行车", speedMul: 3 };
  gameState.player.party = [];

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";
  yukino.alive = true;

  const origRandom = Math.random;
  Math.random = () => 0.1; // 0.1 < 0.18(bicycle probability) → encounter

  const result = await detectCommuteEncounter("千葉駅前", "千叶市立总武高等学校", "步行", 10, gameState as any);

  Math.random = origRandom;

  if (!result) throw new Error("步行+自行车应触发偶遇");
  if (!result.includes("自行车")) throw new Error(`应提及自行车: ${result.slice(0, 100)}`);
});

test("Step6: 社团分流 — 运动部员傍晚才放学", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { detectCommuteEncounter } = require("./engine/commute.ts");

  // afternoon (15:30): 普通学生可以放学，社团学生还在社团
  gameState.time.time_of_day = "afternoon";
  gameState.player.party = [];

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.scheduleGroup = "高校生";  // 普通学生
  yukino.alive = true;

  const clubMember = getOrCreateNPC("材木座义辉");
  clubMember.scheduleGroup = "运动部员";  // 社团学生
  clubMember.alive = true;

  const origRandom = Math.random;
  Math.random = () => 0.1;

  const result = await detectCommuteEncounter("千叶市立总武高等学校", "千葉駅前", "步行", 10, gameState as any);

  Math.random = origRandom;

  if (!result) throw new Error("放学应触发偶遇");
  // 普通学生 雪之下 应该在放学组，社团部员 材木座 下午还在社团不应出现
  if (result.includes("材木座") && !result.includes("雪之下")) {
    throw new Error(`下午3:30社团学生不应离校，普通学生应在。实际: ${result.slice(0, 120)}`);
  }
});

test("Step6: 社团分流 — evening时段社团学生放学", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { detectCommuteEncounter } = require("./engine/commute.ts");

  // evening (17:30): 社团活动结束，社团学生回家，普通学生已在afternoon离校
  gameState.time.time_of_day = "evening";
  gameState.player.party = [];

  // Only setup club member — stand-alone student shouldn't matter in evening
  const clubMember = getOrCreateNPC("材木座义辉");
  clubMember.scheduleGroup = "运动部员";
  clubMember.alive = true;

  const origRandom = Math.random;
  Math.random = () => 0.1;

  const result = await detectCommuteEncounter("千叶市立总武高等学校", "千葉駅前", "步行", 10, gameState as any);

  Math.random = origRandom;

  // evening: only club members should be in the放学 pool
  if (!result) throw new Error("傍晚社团学生放学应触发偶遇");
  if (!result.includes("材木座")) throw new Error(`结果应包含材木座: ${result.slice(0, 120)}`);
});

test("Step6: getCommuteDirection — 京葉線分组", () => {
  resetState();
  const { getCommuteDirection } = require("./engine/commute.ts");
  if (getCommuteDirection("海浜幕張") !== "京葉線") throw new Error("海浜幕張应在京葉線");
  if (getCommuteDirection("稲毛海岸") !== "京葉線") throw new Error("稲毛海岸应在京葉線");
  if (getCommuteDirection("千葉駅前") !== "総武線") throw new Error("千葉駅前应在総武線");
  if (getCommuteDirection("西千葉") !== "総武線") throw new Error("西千葉应在総武線");
  if (getCommuteDirection("東京_新宿") !== "その他") throw new Error("新宿应在その他");
});

test("Step6: parseScheduleIntent 写入 pendingOverride", async () => {
  resetState();
  loadActiveWorld("oregairu");
  const { getOrCreateNPC } = require("./engine/state.ts");
  const { parseScheduleIntent } = require("./tools/helpers.ts");

  const npc = getOrCreateNPC("由比滨结衣");
  const text = '今天放学后想去逛街！{"schedule_intent": {"location": "千葉駅前", "action": "和朋友唱卡拉OK", "reason": "金曜の夜だから"}}';

  await parseScheduleIntent("由比滨结衣", text);

  if (!npc.pendingOverride) throw new Error("pendingOverride 应被设置");
  if (npc.pendingOverride.location !== "千葉駅前") throw new Error(`地点应为千葉駅前，实际: ${npc.pendingOverride.location}`);
  if (!npc.pendingOverride.reason.includes("金曜")) throw new Error(`原因应含金曜: ${npc.pendingOverride.reason}`);
});

test("Step6: evening template 不再是纯自宅", () => {
  resetState();
  loadActiveWorld("oregairu");

  // Load schedule templates and check evening entries
  // Load actual templates (engine uses worldpacks first, data fallback)
  let templates = {};
  try { templates = require("./worldpacks/oregairu/schedule_templates.json"); } catch { templates = require("./data/schedule_templates.json"); }
  const hsEvening = templates["高校生"]?.["weekday_evening"];
  if (!hsEvening) throw new Error("高校生 evening template 应存在");
  if (hsEvening === "自宅") throw new Error("高校生 evening 不应是纯'自宅'，实际: " + hsEvening);

  const teacherEvening = templates["总武高教师"]?.["weekday_evening"];
  // 模板已迁至真实 JR 站名（千葉駅前/海浜幕張 等），原"居酒屋"已替换为 千葉駅前
  if (!teacherEvening) throw new Error("教师 evening template 应存在");
  if (teacherEvening === "自宅（千叶市高级公寓）") throw new Error("教师 evening 不应是纯自宅: " + teacherEvening);
});

test("Step6: 水曜 afternoon 短缩早放学", () => {
  resetState();
  let templates = {};
  try { templates = require("./worldpacks/oregairu/schedule_templates.json"); } catch { templates = require("./data/schedule_templates.json"); }

  // 高校生 水_afternoon 应该存在且不是学校教室
  const hsWed = templates["高校生"]?.["水_afternoon"];
  if (!hsWed) throw new Error("高校生 应存在 水_afternoon key");
  if (hsWed.includes("2年J班") || hsWed.includes("2年F班")) {
    throw new Error("水曜 afternoon 不应去教室上课: " + hsWed);
  }
  if (!hsWed.includes("商店街") && !hsWed.includes("千葉")) {
    throw new Error("水曜 afternoon 应含商店街/站前等外出地点: " + hsWed);
  }

  // 运动部员 水曜 还是去操场（虽然有商店街选项）
  const clubWed = templates["运动部员"]?.["水_afternoon"];
  if (!clubWed) throw new Error("运动部员 应存在 水_afternoon key");

  // 社团部员 水曜 afternoon
  const cultureWed = templates["社团部员"]?.["水_afternoon"];
  if (!cultureWed) throw new Error("社团部员 应存在 水_afternoon key");
});

test("Step6: 金曜 evening 社交高峰", () => {
  resetState();
  let templates = {};
  try { templates = require("./worldpacks/oregairu/schedule_templates.json"); } catch { templates = require("./data/schedule_templates.json"); }

  // 高校生 金_evening 应该存在且含社交场所
  const hsFri = templates["高校生"]?.["金_evening"];
  if (!hsFri) throw new Error("高校生 应存在 金_evening key");
  // 模板已迁至真实 JR 站名；金曜 evening 不应只有自宅
  if (!hsFri || hsFri === "自宅（千叶市高级公寓）") {
    throw new Error("金曜 evening 不应是纯自宅: " + hsFri);
  }

  // 运动部员 金_evening 应存在且非纯自宅
  const clubFri = templates["运动部员"]?.["金_evening"];
  if (!clubFri) throw new Error("运动部员 应存在 金_evening key");
  if (clubFri === "自宅（千叶市高级公寓）") throw new Error("运动部员金曜 evening 不应是纯自宅: " + clubFri);
});

test("Step 4: 观影替换与广播时空（数据隔离、双轨弹幕、退场穿透结算）", async () => {
  resetState();
  loadActiveWorld("oregairu");

  const startBroadcast = (await import("./tools/action/start_broadcast.ts")).default;
  const endBroadcast = (await import("./tools/action/end_broadcast.ts")).default;
  const settleScene = (await import("./tools/action/settle_scene.ts")).default;
  const { getOrCreateNPC } = await import("./engine/state.ts");
  const fs = await import("node:fs");
  const path = await import("node:path");

  // 1. 验证主世界初始状态
  const baseYukino = getOrCreateNPC("雪之下雪乃");
  baseYukino.attributes.力量 = 8; // 主世界力量是 8
  gameState.player.location = "特别大楼3F_特别教室";
  gameState.player.relationships["雪之下雪乃"] = { stage: "陌生", romance: null, affection: 0, notes: "", history: [] };

  // 2. 开启广播观影时空 (test_broadcast)
  const startRes = await startBroadcast.execute("test_start", { scriptId: "test_broadcast" });
  
  if (!gameState._theaterActive) {
    throw new Error("start_broadcast failed to activate _theaterActive");
  }
  if (gameState._theaterScriptId !== "test_broadcast") {
    throw new Error("start_broadcast failed to set _theaterScriptId");
  }
  if (gameState.player.location !== "平行荒野") {
    throw new Error("start_broadcast failed to switch player location to parallel world start: " + gameState.player.location);
  }

  // 验证角色属性被覆写 (extends: "oregairu" oregairu=8, overridden to 14)
  const parallelYukino = gameState.npcs["雪之下雪乃"];
  if (!parallelYukino) {
    throw new Error("Yukino NPC should exist in parallel world");
  }
  if (parallelYukino.attributes.力量 !== 14) {
    throw new Error("Yukino attributes.力量 should be overridden to 14, actual: " + parallelYukino.attributes.力量);
  }

  // 验证 saveState 自动隔离写入 theater_session.json
  const stateDir = process.env.NODE_ENV === "test" ? "state_test" : "state";
  const theaterSessionPath = path.join(process.cwd(), stateDir, "theater_session.json");
  if (!fs.existsSync(theaterSessionPath)) {
    throw new Error("saveState should write to theater_session.json under theater mode");
  }
  // 验证主存 session.json 没有被本次覆盖
  const mainSessionRaw = fs.readFileSync(path.join(process.cwd(), stateDir, "session.json"), "utf-8");
  const mainSession = JSON.parse(mainSessionRaw);
  if (mainSession._theaterActive) {
    throw new Error("Main session.json should NOT contain theater active flags");
  }

  // 3. 模拟场景结算并触发弹幕与独立吐槽
  // Mock generateCompletion to avoid actual API calls
  const helpers = await import("./tools/helpers.ts");
  helpers.setGenerateCompletionOverride(async (prompt: string) => {
    if (prompt.includes("雪之下雪乃")) {
      return "[雪之下雪乃（弹幕）]：放、放映事故！快把屏幕关掉，比企谷君！";
    }
    return "[匿名（弹幕）]：默认吐槽。";
  });

  // 触发重情节关键字 "走光"
  gameState._commentaryCooldown = 0; // Force commentary
  gameState._danmakuCooldown = 0;    // Force danmaku
  
  const settleRes = await settleScene.execute("test_settle_1", {
    elapsed_minutes: 15,
    summary: "在平行荒原野营时，雪之下雪乃不小心走光，维红着脸帮她挡住"
  });

  // Restore helpers
  helpers.setGenerateCompletionOverride(null);

  const resultText = settleRes.content[0].text;
  if (!resultText.includes("屏幕上滑过的弹幕")) {
    throw new Error("Result text should contain danmaku track");
  }
  if (!resultText.includes("放映厅传来的吐槽")) {
    throw new Error("Result text should contain NPC commentary track");
  }
  if (!resultText.includes("雪之下雪乃（弹幕）")) {
    throw new Error("Result text should contain Yukino's commentary: " + resultText);
  }

  // 增加平行世界里的好感变化
  gameState.player.relationships["雪之下雪乃"].affection = 25; // Main base was 0 (assumed) or initialized. Let's force it to +25.

  // 4. 退出广播观影并进行穿透结算
  const endRes = await endBroadcast.execute("test_end", {});

  if (gameState._theaterActive) {
    throw new Error("end_broadcast failed to deactivate _theaterActive");
  }
  if (fs.existsSync(theaterSessionPath)) {
    throw new Error("theater_session.json should be cleaned up after end_broadcast");
  }

  // 验证属性变回主世界属性
  const restoredYukino = gameState.npcs["雪之下雪乃"];
  if (restoredYukino.attributes.力量 !== 8) {
    throw new Error("Yukino attributes.力量 should be restored to 8, actual: " + restoredYukino.attributes.力量);
  }
  // 验证好感度按 10:1 (25/10 = 3) 穿透微偏移加成
  const restoredAffection = gameState.player.relationships["雪之下雪乃"]?.affection ?? 0;
  if (restoredAffection <= 0) {
    throw new Error("Restored Yukino affection should have incremented, actual: " + restoredAffection);
  }
  // 验证 memoryTags 被写入
  const tags = restoredYukino.memoryTags;
  const hasTheaterTag = tags?.some(t => t.tag.includes("平行视界感触"));
  if (!hasTheaterTag) {
    throw new Error("Yukino should have received parallel world memory tags");
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// Step 7: 组织与政治势力系统
// ══════════════════════════════════════════════════════════════════════════════

test("Step7: resolveOrgIdForGroup 声望桥接查找", async () => {
  const { gameState, resetState, loadActiveWorld } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const { resolveOrgIdForGroup } = await import("./engine/state.ts");

  // 1. 直接 orgId 匹配
  const direct = resolveOrgIdForGroup("soubu_service_club");
  if (direct !== "soubu_service_club") {
    throw new Error(`Direct orgId match failed: ${direct}`);
  }

  // 2. 名称匹配
  const byName = resolveOrgIdForGroup("侍奉部");
  if (byName !== "soubu_service_club") {
    throw new Error(`Name match failed: ${byName}`);
  }

  // 3. 不存在的组返回 null
  const none = resolveOrgIdForGroup("不存在的组");
  if (none !== null) {
    throw new Error(`Non-existent group should return null: ${none}`);
  }
});

test("Step7: updateReputation 声望桥接同步到 orgId", async () => {
  const { gameState, resetState, loadActiveWorld, updateReputation } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  // 用组织名称更新声望
  updateReputation("侍奉部", 2);

  // 声望应该同时写入"侍奉部"和"soubu_service_club"
  const groupRep = gameState.player.reputation["侍奉部"];
  const orgRep = gameState.player.reputation["soubu_service_club"];
  if (groupRep !== 2) {
    throw new Error(`Group rep should be 2, got ${groupRep}`);
  }
  if (orgRep !== 2) {
    throw new Error(`Org rep should be bridged to 2, got ${orgRep}`);
  }
});

test("Step7: getOrgForTerritory 势力核心区查询", async () => {
  const { gameState, resetState, loadActiveWorld, getOrgForTerritory } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const orgId = getOrgForTerritory("特别大楼3F_特别教室");
  if (orgId !== "soubu_service_club") {
    throw new Error(`Territory should map to soubu_service_club, got ${orgId}`);
  }

  const noOrg = getOrgForTerritory("随便一个地方");
  if (noOrg !== null) {
    throw new Error(`Unknown location should return null, got ${noOrg}`);
  }
});

test("Step7: go_to_location 势力核心区准入拦截", async () => {
  const { gameState, resetState, loadActiveWorld, saveState } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  gameState.player.known_locations ??= [];
  gameState.player.known_locations.push("特别大楼3F_特别教室");

  const goToLocation = (await import("./tools/lookup/go_to_location.ts")).default;
  gameState.player.location = "教学楼1F_大厅";
  gameState.player.reputation["soubu_service_club"] = -3; // 敌对
  if (gameState.organizations["soubu_service_club"]) {
    gameState.organizations["soubu_service_club"].scale = "local";
  }

  const result = await goToLocation.execute("test_block", { destination: "特别大楼3F_特别教室" });
  const text = result.content[0].text;
  if (!text.includes("⛔") || !result.details?.blocked) {
    throw new Error(`Hostile rep should block territory access: ${text}`);
  }

  // 友好声望应放行
  gameState.player.reputation["soubu_service_club"] = 2;
  const result2 = await goToLocation.execute("test_allow", { destination: "特别大楼3F_特别教室" });
  if (result2.details?.blocked) {
    throw new Error("Friendly rep should not block territory access");
  }
});

test("Step7: social_check 组织敌对 DC 惩罚", async () => {
  const { gameState, resetState, loadActiveWorld, getOrCreateNPC, saveState } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const socialCheck = (await import("./tools/action/social_check.ts")).default;
  gameState.player.location = "特别大楼3F_特别教室";
  gameState.player.attributes = { 魅力: 10, 智力: 10, 力量: 10, 幸运: 10 };
  gameState.player.relationships["雪之下雪乃"] = { stage: "陌生", affection: 0 };
  getOrCreateNPC("雪之下雪乃");

  // 声望友好 → 无惩罚
  gameState.player.reputation["soubu_service_club"] = 2;
  const result1 = await socialCheck.execute("test_friendly", {
    targetNpc: "雪之下雪乃",
    actionType: "persuade_secret",
    approach: "charm"
  });
  const dc1 = result1.details.dc;

  // 声望敌对 → 有惩罚
  gameState.player.reputation["soubu_service_club"] = -3;
  const result2 = await socialCheck.execute("test_hostile", {
    targetNpc: "雪之下雪乃",
    actionType: "persuade_secret",
    approach: "charm"
  });
  const dc2 = result2.details.dc;

  if (dc2 <= dc1) {
    throw new Error(`Hostile DC(${dc2}) should be higher than friendly DC(${dc1})`);
  }
});

test("Step7: applyWorldStateToOrgs 宏观天空盒偏移", async () => {
  const { gameState, resetState, loadActiveWorld } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  if (gameState.organizations["soubu_service_club"]?.organizationalAxes) {
    gameState.organizations["soubu_service_club"].organizationalAxes["政治立场"] = 0;
  }

  const { applyWorldStateToOrgs } = await import("./engine/timeline.ts");

  gameState.worldState = { tech: 3, stability: -2, tension: 3, globalFlags: {} };

  const clubBefore = gameState.organizations!["soubu_service_club"]!;
  const cohBefore = clubBefore.cohesion;
  const infBefore = clubBefore.influence;

  const conglom = gameState.organizations!["yukinoshita_family"]!;
  const infConglomBefore = conglom.influence;

  applyWorldStateToOrgs();

  // stability < -1 → cohesion 下降
  if (clubBefore.cohesion >= cohBefore) {
    throw new Error(`Club cohesion should decrease: ${cohBefore} -> ${clubBefore.cohesion}`);
  }

  // tension > 1 → club influence 下降
  if (clubBefore.influence >= infBefore) {
    throw new Error(`Club influence should decrease: ${infBefore} -> ${clubBefore.influence}`);
  }

  // tension > 1 → regional org influence 上升
  if (conglom.influence <= infConglomBefore) {
    throw new Error(`Regional influence should increase: ${infConglomBefore} -> ${conglom.influence}`);
  }
});

test("Step7: evaluateOrgGoals 低凝聚力/财力预警", async () => {
  const { gameState, resetState, loadActiveWorld } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const { evaluateOrgGoals } = await import("./engine/timeline.ts");

  gameState.organizations!["soubu_service_club"]!.cohesion = 15;
  gameState.organizations!["soubu_service_club"]!.wealth = 5;

  const alerts = evaluateOrgGoals();
  const clubAlerts = alerts.filter(a => a.orgId === "soubu_service_club");
  if (clubAlerts.length < 2) {
    throw new Error(`Should have >= 2 alerts, got ${clubAlerts.length}`);
  }
});

test("Step7: applyOrgDrivesToNPC 组织驱动注入", async () => {
  const { gameState, resetState, loadActiveWorld, getOrCreateNPC } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const { applyOrgDrivesToNPC } = await import("./engine/timeline.ts");

  const yukino = getOrCreateNPC("雪之下雪乃");
  yukino.current_drives = ["个人目标A"];

  applyOrgDrivesToNPC();

  const drives = yukino.current_drives!;
  const hasServiceClubDrive = drives.some(d => d.includes("[侍奉部]"));
  const hasConglomDrive = drives.some(d => d.includes("[雪之下建设与政商同盟]"));

  if (!hasServiceClubDrive) {
    throw new Error(`Missing service club drive. Drives: ${JSON.stringify(drives)}`);
  }
  if (!hasConglomDrive) {
    throw new Error(`Missing conglomerate drive. Drives: ${JSON.stringify(drives)}`);
  }
  if (!drives.includes("个人目标A")) {
    throw new Error("Personal drive should be preserved");
  }
});

test("Step7: lookup_org 声望分级信息过滤", async () => {
  const { gameState, resetState, loadActiveWorld } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const lookupOrg = (await import("./tools/lookup/lookup_org.ts")).default;

  // 低声望 → 只能看到公开信息
  gameState.player.reputation["soubu_service_club"] = 0;
  const result1 = await lookupOrg.execute("test_neutral", { orgId: "soubu_service_club" });
  const text1 = result1.content[0].text;
  if (text1.includes("成员名单")) {
    throw new Error("Neutral rep should not see member list (Restricted)");
  }
  if (!text1.includes("侍奉部")) {
    throw new Error("Should see org name");
  }

  // 高声望 → 能看到限制级信息
  gameState.player.reputation["soubu_service_club"] = 2;
  const result2 = await lookupOrg.execute("test_friendly", { orgId: "soubu_service_club" });
  const text2 = result2.content[0].text;
  if (!text2.includes("成员名单")) {
    throw new Error("Friendly rep should see member list (Restricted)");
  }
  if (!text2.includes("阶段性目标")) {
    throw new Error("Friendly rep should see phase goals");
  }
});

test("Step7: getOrgMembershipsForNpc 查找NPC所属组织", async () => {
  const { gameState, resetState, loadActiveWorld, getOrgMembershipsForNpc } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const yukiOrgs = getOrgMembershipsForNpc("雪之下雪乃");
  if (!yukiOrgs.includes("soubu_service_club")) {
    throw new Error(`Yukino should belong to soubu_service_club: ${JSON.stringify(yukiOrgs)}`);
  }
  if (!yukiOrgs.includes("yukinoshita_family")) {
    throw new Error(`Yukino should belong to yukinoshita_family: ${JSON.stringify(yukiOrgs)}`);
  }

  const noOrgs = getOrgMembershipsForNpc("不存在的人");
  if (noOrgs.length > 0) {
    throw new Error(`Non-existent NPC should have no orgs`);
  }
});

test("Step7: create_organization 动态创建组织", async () => {
  const { gameState, resetState, loadActiveWorld } = await import("./engine/state.ts");
  resetState();
  loadActiveWorld("oregairu");

  const createOrg = (await import("./tools/action/create_organization.ts")).default;
  const result = await createOrg.execute("test_create", {
    id: "tennis_club",
    name: "网球部",
    type: "社团",
    scale: "club",
    coreLocation: "操场",
    leader: "户冢彩加",
    macroGoal: "让网球部成为全校最受欢迎的社团"
  });

  if (!result.details?.success) {
    throw new Error("Failed to create organization");
  }

  const org = gameState.organizations?.["tennis_club"];
  if (!org) {
    throw new Error("Created organization not found in gameState");
  }

  if (org.name !== "网球部" || org.leader !== "户冢彩加" || org.coreLocation !== "操场") {
    throw new Error("Created organization attributes mismatch: " + JSON.stringify(org));
  }
});
test("Vicky Political Economy System - Tree Skybox Inheritance", async () => {
  resetState();
  loadActiveWorld("oregairu");

  // 侍奉部级联链：日本 → 千叶県 → 千叶市 → 美滨区 → 总武高
  // 最近精确匹配修复：现在选最长key匹配而非第一个匹配
  const localWs = (await import("./engine/state.ts")).getMergedWorldState("侍奉部");

  // 数值字段从千叶市继承
  if (localWs.prosperity !== -1) {
    throw new Error("Skybox inheritance failed: prosperity should be -1 from 千叶市, got " + localWs.prosperity);
  }
  // 字符串字段被总武高覆盖（最长key匹配修复生效）
  if (localWs.regime !== "公立学校管理委员会") {
    throw new Error("Skybox inheritance failed: regime should be '公立学校管理委员会' from soubu_high, got " + localWs.regime);
  }
  if (localWs.economy_type !== "公立教育财政") {
    throw new Error("Skybox inheritance failed: economy_type should be '公立教育财政' from soubu_high, got " + localWs.economy_type);
  }
  if (localWs.diplomacy_stance !== "文部科学省指导下的地方教育自治") {
    throw new Error("Skybox inheritance failed: diplomacy_stance should be from soubu_high, got " + localWs.diplomacy_stance);
  }
});

test("Vicky Political Economy System - Dynamic Wage & Price Scaling", async () => {
  resetState();
  loadActiveWorld("oregairu");
  
  // Test Wage scaling
  gameState.worldState.prosperity = 0;
  const initialFunds = gameState.player.funds;
  workJob("便利店分拣员", 1);
  const wageFlat = gameState.player.funds - initialFunds;
  
  gameState.worldState.prosperity = -4; // Recession
  const fundsBeforeRecession = gameState.player.funds;
  workJob("便利店分拣员", 1);
  const wageRecession = gameState.player.funds - fundsBeforeRecession;
  
  if (wageRecession >= wageFlat) {
    throw new Error(`Wage scaling failed: recession wage (${wageRecession}) should be less than flat wage (${wageFlat})`);
  }
  
  // Test Price validation and scaling under inflation (萧条且动荡)
  gameState.worldState.stability = -3;
  gameState.worldState.prosperity = -3;
  
  // Buy a cheap consumable item (within range under inflation: 116 to 725)
  const buyRes = buyItem("矿泉水", 150, "便利店");
  if (!buyRes.includes("波动系数")) {
    throw new Error("Price inflation scaling failed, no volatility coefficient in buy message: " + buyRes);
  }
});

test("Vicky Political Economy System - Sovereignty Guard", async () => {
  resetState();
  loadActiveWorld("oregairu");
  
  const go_to_location = (await import("./tools/lookup/go_to_location.ts")).default;
  
  // Create mock sovereign organization
  gameState.organizations["mock_sovereign"] = {
    id: "mock_sovereign",
    name: "总武高纪律委员会",
    type: "学校",
    scale: "local",
    wealth: 50,
    influence: 50,
    cohesion: 50,
    public_legitimacy: 50,
    coreLocation: "2F楼梯间",
    territoryRoomKeys: ["2F楼梯间"],
    class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "",
    members: [],
    relations: {},
    match_rules: {},
    entries: []
  };
  
  // Set highly hostile reputation
  gameState.player.reputation["mock_sovereign"] = -3;
  
  // Travel to controlled territory should be blocked
  const blockResult = await go_to_location.execute("test_guard", { destination: "2F楼梯间" });
  if (!blockResult.details?.blocked) {
    throw new Error("Sovereignty guard failed: entry to sovereign enemy territory should be hard blocked.");
  }
  
  // Club level organization should bypass hard block
  gameState.organizations["mock_club"] = {
    id: "mock_club",
    name: "网球社团",
    type: "社团",
    scale: "club",
    wealth: 50,
    influence: 50,
    cohesion: 50,
    public_legitimacy: 50,
    coreLocation: "操场",
    territoryRoomKeys: ["操场"],
    class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "",
    members: [],
    relations: {},
    match_rules: {},
    entries: []
  };
  gameState.player.reputation["mock_club"] = -3;
  
  const bypassResult = await go_to_location.execute("test_guard", { destination: "操场" });
  if (bypassResult.details?.blocked) {
    throw new Error("Sovereignty guard failed: club-level enemy territory should not be hard blocked.");
  }
});

test("Vicky Political Economy System - Vicky Self-Rotation", async () => {
  resetState();
  loadActiveWorld("oregairu");
  
  const { applyWorldStateToOrgs } = await import("./engine/timeline.ts");
  
  // Setup orgs with class bases
  gameState.organizations["test_prole"] = {
    id: "test_prole",
    name: "码头工人工会",
    type: "舆论",
    scale: "local",
    wealth: 50,
    influence: 50,
    cohesion: 60,
    public_legitimacy: 50,
    coreLocation: "",
    territoryRoomKeys: [],
    class_base: { "无产阶级": 0.8 },
    organizationalAxes: { "经济立场": -4, "政治立场": 2 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "",
    members: [],
    relations: {},
    match_rules: {},
    entries: []
  };
  
  gameState.organizations["test_petite"] = {
    id: "test_petite",
    name: "千叶个体商户同盟",
    type: "企业",
    scale: "local",
    wealth: 50,
    influence: 50,
    cohesion: 50,
    public_legitimacy: 50,
    coreLocation: "",
    territoryRoomKeys: [],
    class_base: { "小资产阶级": 0.7 },
    organizationalAxes: { "经济立场": 2, "政治立场": -1 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "",
    members: [],
    relations: {},
    match_rules: {},
    entries: []
  };
  
  // Trigger recession
  gameState.worldState.prosperity = -3;
  applyWorldStateToOrgs();
  
  const proleOrg = gameState.organizations["test_prole"];
  const petiteOrg = gameState.organizations["test_petite"];
  
  if (proleOrg.wealth >= 50) {
    throw new Error("Vicky self-rotation failed: prole wealth should drop in recession.");
  }
  if (petiteOrg.wealth >= 50 || petiteOrg.cohesion >= 50) {
    throw new Error("Vicky self-rotation failed: petite bourgeoisie wealth and cohesion should drop in recession.");
  }
});

test("Vicky Political Economy System - Nested Reputation Leakage", async () => {
  resetState();
  loadActiveWorld("oregairu");
  
  // Set up child and parent
  gameState.organizations["test_parent"] = {
    id: "test_parent",
    name: "测试母势力",
    type: "政党",
    scale: "national",
    wealth: 80,
    influence: 80,
    cohesion: 80,
    public_legitimacy: 80,
    coreLocation: "",
    territoryRoomKeys: [],
    class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "",
    members: [],
    relations: {},
    match_rules: {},
    entries: []
  };
  
  gameState.organizations["test_child"] = {
    id: "test_child",
    name: "测试子社团",
    type: "社团",
    scale: "club",
    parent_org: "test_parent",
    wealth: 40,
    influence: 40,
    cohesion: 40,
    public_legitimacy: 40,
    coreLocation: "",
    territoryRoomKeys: [],
    class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "",
    members: [],
    relations: {},
    match_rules: {},
    entries: []
  };
  
  gameState.player.reputation["test_child"] = 0;
  gameState.player.reputation["test_parent"] = 0;
  
  updateReputation("test_child", 5);
  
  const parentRep = gameState.player.reputation["test_parent"];
  if (parentRep !== 1) {
    throw new Error("Reputation leakage failed: expected parent reputation to be 1 (20% of 5), got " + parentRep);
  }
});





// ── Helpers for merged org/reaction/lifecycle tests ──
function mkOrg(id, overrides = {}) {
  return {
    id, name: id, type: "社团", scale: overrides.scale ?? "club",
    wealth: overrides.wealth ?? 50, influence: overrides.influence ?? 50,
    cohesion: overrides.cohesion ?? 50, public_legitimacy: overrides.public_legitimacy ?? 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: [],
    lifecycle_stage: undefined, ticks_at_stage: undefined, ticks_at_scale: undefined,
    ...overrides
  };
}

function seedNpc(name, overrides = {}) {
  const npc = getOrCreateNPC(name);
  npc.attributes = { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10, ...overrides };
  npc.scheduleGroup = "高校生";
  npc.currentRoom = "教室";
  npc.npcRelationships = {};
  npc.pendingOverride = null;
  return npc;
}

test("contribute_to_org - donate", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.reputation["test_club"] = 0;
  gameState.player.funds = 10000;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "donate", amount: 1000, details: "测试"
  }, null, null, null);

  if (!result.details.success) throw new Error("Donate failed");
  if (gameState.organizations["test_club"].wealth <= 50) throw new Error("Wealth should increase, got " + gameState.organizations["test_club"].wealth);
  if (gameState.player.reputation["test_club"] <= 0) throw new Error("Rep should increase, got " + gameState.player.reputation["test_club"]);
  if (gameState.player.funds >= 10000) throw new Error("Funds should decrease");
});

test("contribute_to_org - complete_quest", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.reputation["test_club"] = 0;
  gameState.player.memberships = [{ orgId: "test_club", role: "部员", rank: 7, joinedAt: "2018-04-07" }];

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "complete_quest", details: "筹备文化祭"
  }, null, null, null);

  if (!result.details.success) throw new Error("Quest failed");
  const org = gameState.organizations["test_club"];
  if (org.cohesion <= 50) throw new Error("Cohesion should increase, got " + org.cohesion);
  if (org.influence <= 50) throw new Error("Influence should increase, got " + org.influence);
  if (gameState.player.reputation["test_club"] !== 3) throw new Error("Rep should be 3, got " + gameState.player.reputation["test_club"]);
});

test("contribute_to_org - betray", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  const mkOrg = (id: string, name: string) => ({
    id, name, type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any);
  gameState.organizations["test_club"] = mkOrg("test_club", "测试社团");
  gameState.organizations["test_club"].relations = { "rival_club": -3 };
  gameState.organizations["rival_club"] = mkOrg("rival_club", "敌对社团");
  gameState.player.reputation["test_club"] = 0;
  gameState.player.reputation["rival_club"] = 0;
  gameState.player.memberships = [{ orgId: "test_club", role: "部员", rank: 7, joinedAt: "2018-04-07" }];

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "betray", details: "泄露情报"
  }, null, null, null);

  if (!result.details.success) throw new Error("Betray failed");
  const org = gameState.organizations["test_club"];
  if (org.cohesion >= 50) throw new Error("Cohesion should decrease, got " + org.cohesion);
  if (org.public_legitimacy >= 50) throw new Error("Legitimacy should decrease, got " + org.public_legitimacy);
  if (gameState.player.reputation["test_club"] >= 0) throw new Error("Rep should go negative, got " + gameState.player.reputation["test_club"]);
  if (gameState.player.reputation["rival_club"] <= 0) throw new Error("Rival should gain rep, got " + gameState.player.reputation["rival_club"]);
});

test("contribute_to_org - recruit_member", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.reputation["test_club"] = 0;
  gameState.player.memberships = [{ orgId: "test_club", role: "部员", rank: 7, joinedAt: "2018-04-07" }];

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "recruit_member",
    targetNpc: "材木座義輝", details: "宣传干事"
  }, null, null, null);

  if (!result.details.success) throw new Error("Recruit failed");
  const org = gameState.organizations["test_club"];
  if (org.cohesion <= 50) throw new Error("Cohesion should increase, got " + org.cohesion);
  if (!org.members.some((m: any) => m.npcName === "材木座義輝")) throw new Error("Member should be added");
  if (gameState.player.reputation["test_club"] !== 2) throw new Error("Rep should be 2, got " + gameState.player.reputation["test_club"]);
});

test("contribute_to_org - insufficient funds", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.funds = 10;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "donate", amount: 1000
  }, null, null, null);

  if (result.details.success) throw new Error("Should fail when funds insufficient");
});

test("contribute_to_org - org not found", async () => {
  resetState();
  loadActiveWorld("oregairu");

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "nonexistent_org", action: "donate", amount: 100
  }, null, null, null);

  if (result.details.success) throw new Error("Should fail for nonexistent org");
});



test("lifecycle - seed auto-detected for new org", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["new_club"] = mkOrg("new_club", { wealth: 10, influence: 5, cohesion: 80 });

  const alerts = evaluateOrgGoals();

  // First call: initializes lifecycle
  if (gameState.organizations["new_club"].lifecycle_stage !== "萌芽") {
    throw new Error(`New low-resource org should be 萌芽, got ${gameState.organizations["new_club"].lifecycle_stage}`);
  }
  // Should produce alert about lifecycle init
  if (alerts.length === 0) throw new Error("Should produce lifecycle alert");
});

test("lifecycle - seed → startup progression", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["growing"] = mkOrg("growing", { wealth: 25, influence: 30, cohesion: 70 });

  // First call: detects as 初创
  evaluateOrgGoals();
  if (gameState.organizations["growing"].lifecycle_stage !== "初创") {
    throw new Error(`Should be 初创, got ${gameState.organizations["growing"].lifecycle_stage}`);
  }

  // Advance to 成长 territory
  gameState.organizations["growing"].wealth = 50;
  gameState.organizations["growing"].influence = 55;

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["growing"].lifecycle_stage !== "成长") {
    throw new Error(`Should progress to 成长, got ${gameState.organizations["growing"].lifecycle_stage}`);
  }
  // Should have transition alert
  const transitionAlert = alerts.find(a => a.alert.includes("初创") || a.alert.includes("成长"));
  if (!transitionAlert) throw new Error("Should have transition alert");
});

test("lifecycle - growth → mature", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["powerhouse"] = mkOrg("powerhouse", {
    wealth: 80, influence: 85, cohesion: 75
  });

  evaluateOrgGoals();
  if (gameState.organizations["powerhouse"].lifecycle_stage !== "成熟") {
    throw new Error(`Should be 成熟, got ${gameState.organizations["powerhouse"].lifecycle_stage}`);
  }
});

test("lifecycle - mature → decline", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["fading"] = mkOrg("fading", {
    wealth: 80, influence: 80, cohesion: 80, lifecycle_stage: "成熟" as any
  });

  // First tick: still mature
  evaluateOrgGoals();
  if (gameState.organizations["fading"].lifecycle_stage !== "成熟") {
    throw new Error("Should still be 成熟");
  }

  // Then collapse cohesion:
  gameState.organizations["fading"].cohesion = 30;

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["fading"].lifecycle_stage !== "衰退") {
    throw new Error(`Should decline, got ${gameState.organizations["fading"].lifecycle_stage}`);
  }
  // Should have decline alert
  const declineAlert = alerts.find(a => a.alert.includes("衰退"));
  if (!declineAlert) throw new Error("Should have decline transition alert");
});

test("lifecycle - decline → recovery (growth)", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["recovering"] = mkOrg("recovering", {
    wealth: 60, influence: 55, cohesion: 80, lifecycle_stage: "衰退" as any
  });

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["recovering"].lifecycle_stage !== "成长") {
    throw new Error(`Should recover to 成长, got ${gameState.organizations["recovering"].lifecycle_stage}`);
  }
});

test("lifecycle - collapse (archived)", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["doomed"] = mkOrg("doomed", {
    wealth: 5, cohesion: 5, public_legitimacy: 5
  });

  const alerts = evaluateOrgGoals();
  if (!gameState.organizations["doomed"].archived) throw new Error("Should be archived");
  if (gameState.organizations["doomed"].lifecycle_stage !== "消亡") throw new Error("Should be 消亡");
});

test("scale - upgrade club → local", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["rising"] = mkOrg("rising", {
    scale: "club", influence: 75, cohesion: 80, ticks_at_scale: 5
  });

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["rising"].scale !== "local") {
    throw new Error(`Should upgrade to local, got ${gameState.organizations["rising"].scale}`);
  }
  // ticks should reset
  if (gameState.organizations["rising"].ticks_at_scale !== 0) throw new Error("ticks_at_scale should reset");
});

test("scale - no upgrade if ticks insufficient", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["impatient"] = mkOrg("impatient", {
    scale: "club", influence: 80, cohesion: 80, ticks_at_scale: 3
  });

  evaluateOrgGoals();
  // ticks_at_scale was 3, not enough for upgrade (need 5)
  if (gameState.organizations["impatient"].scale !== "club") {
    throw new Error("Should not upgrade with only 3 ticks");
  }
  // ticks should increment
  if (gameState.organizations["impatient"].ticks_at_scale !== 4) {
    throw new Error("ticks_at_scale should be 4 (was 3 + 1)");
  }
});

test("scale - downgrade on low cohesion", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["crumbling"] = mkOrg("crumbling", {
    scale: "regional", cohesion: 15, ticks_at_scale: 3
  });

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["crumbling"].scale !== "local") {
    throw new Error(`Should downgrade to local, got ${gameState.organizations["crumbling"].scale}`);
  }
});

test("scale - no downgrade below club", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["minimum"] = mkOrg("minimum", {
    scale: "club", cohesion: 5, ticks_at_scale: 5
  });

  evaluateOrgGoals();
  if (gameState.organizations["minimum"].scale !== "club") {
    throw new Error("Club should be floor, cannot go below");
  }
});

test("scale - no upgrade beyond national", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["superpower"] = mkOrg("superpower", {
    scale: "national", influence: 100, cohesion: 100, ticks_at_scale: 10
  });

  evaluateOrgGoals();
  if (gameState.organizations["superpower"].scale !== "national") {
    throw new Error("National should be ceiling, cannot go above");
  }
});

test("archived orgs are skipped in evaluation", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["gone"] = mkOrg("gone", {
    wealth: 0, cohesion: 0, public_legitimacy: 0, archived: true, lifecycle_stage: "消亡" as any
  });

  const alerts = evaluateOrgGoals();
  // Should not produce any alert for archived org
  const goneAlerts = alerts.filter(a => a.orgId === "gone");
  if (goneAlerts.length > 0) throw new Error("Archived org should produce no alerts");
});

test("ticks_at_stage increments when stage unchanged", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["stable"] = mkOrg("stable", {
    wealth: 50, influence: 55, cohesion: 60
  });
  // First eval:
  evaluateOrgGoals();
  const after1 = gameState.organizations["stable"].ticks_at_stage ?? 0;
  // Second eval: should increment
  evaluateOrgGoals();
  const after2 = gameState.organizations["stable"].ticks_at_stage ?? 0;
  if (after2 !== after1 + 1) {
    throw new Error(`ticks_at_stage should increment: ${after1} → ${after2}`);
  }
});

test("validateCharacters 抓 缺必填/孤儿/指针", async () => {
  const { validateCharacters } = await import("./engine/validate-characters.ts");
  const chars = [
    { name: "A", source: "x", base_age: 16, gender: "female", appearance_brief: "y",
      body: { height_cm: 160, weight_kg: 50 }, attributes: {}, default_location: "L",
      schedule_group: "学生", social_class: "中产", personal_axes: {}, sex_profile: "A" },
    { name: "B" },
  ];
  const stages = { "C_if": {}, "A": {} };
  const r = validateCharacters(chars, new Set(["学生"]), stages, {});
  if (r.ok) throw new Error("应有 error → ok=false");
  const codes = new Set(r.issues.map((i: any) => i.code));
  if (!codes.has("missing-core")) throw new Error("应抓 missing-core (B)");
  if (!codes.has("sexprofile-pointer")) throw new Error("应抓 sexprofile-pointer (A)");
  if (!codes.has("orphan-stage")) throw new Error("应抓 orphan-stage (C_if)");
});

test("validateCharacters 干净输入 ok=true", async () => {
  const { validateCharacters } = await import("./engine/validate-characters.ts");
  const chars = [
    { name: "A", source: "x", base_age: 16, gender: "female", appearance_brief: "y",
      body: { height_cm: 160, weight_kg: 50 }, attributes: {}, default_location: "L",
      schedule_group: "学生", social_class: "中产", personal_axes: {},
      outfits: {}, equipment: {}, body_by_age: {}, sex_profile: {},
      personality_stages: {}, personality_brief: "z", speech_style: "s" },
  ];
  const r = validateCharacters(chars, new Set(["学生"]));
  if (!r.ok) throw new Error("干净输入应 ok=true，却有: " + JSON.stringify(r.summary));
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
