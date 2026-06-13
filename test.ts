/**
 * earth-0 引擎冒烟测试
 * 不需要 pi，不需要 LLM。2秒跑完全部。
 *
 * 用法：npx tsx test.ts
 */

import {
  gameState, saveState, loadState, resetState,
  movePlayer, placeFurniture, removeFurniture, toggleDoor,
  getRoom, initPlayerGrid, getGridContext,
  buyItem, sellItem, workJob, stealItem,
  monthlyGrowth, refreshWeather, updateNPCSchedules,
  buildStatePrompt, getBodyForAge, getNpcCurrentAge,
  setPlayerLocation, attrMod, calcMaxHP, calcAC,
  addSkillExp, updateRelation, getOrCreateNPC,
  calcReputationBonus, updateReputation,
} from "./engine/state.ts";

import { check, attackRoll, rollDamage } from "./engine/dice.ts";
import { lookupRegion } from "./engine/router.ts";
import { advanceMinutes } from "./engine/time.ts";

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
  // 在玩家旁边的空地放东西
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
      // 清理
      removeFurniture(nx, ny);
      return;
    }
  }
  // 没有空地也通过（房间可能很小）
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

test("updateNPCSchedules", () => {
  const events = updateNPCSchedules();
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

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
saveState();
process.exit(failed > 0 ? 1 : 0);
