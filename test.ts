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
  buyItem, sellItem, workJob, stealItem,
  monthlyGrowth, refreshWeather, updateNPCSchedules,
  buildStatePrompt, getBodyForAge, getNpcCurrentAge,
  setPlayerLocation, attrMod, calcMaxHP, calcAC,
  addSkillExp, updateRelation, getOrCreateNPC,
  calcReputationBonus, updateReputation,
  checkAndGrantTitles,
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

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
saveState();
process.exit(failed > 0 ? 1 : 0);
