import { Type } from "typebox";

function baseStats(age: number, gender: string) {
  if (age <= 6) {
    return {
      attributes: { 力量: 3, 敏捷: 4, 体质: 3, 智力: 3, 感知: 3, 魅力: 4 },
      body: { height_cm: 115, weight_kg: 20, build: "纤细", leg_type: "纤细", skin: { base_tone: "普通", tan: 0, texture: "细腻" } },
    };
  }
  if (age <= 12) {
    return {
      attributes: { 力量: 5, 敏捷: 7, 体质: 6, 智力: 9, 感知: 8, 魅力: 8 },
      body: { height_cm: gender === "女" ? 142 : 144, weight_kg: gender === "女" ? 35 : 37, build: "纤细", leg_type: "修长", skin: { base_tone: "普通", tan: 0, texture: "普通" } },
    };
  }
  if (age <= 15) {
    return {
      attributes: { 力量: 7, 敏捷: 9, 体质: 8, 智力: 11, 感知: 9, 魅力: 9 },
      body: { height_cm: gender === "女" ? 157 : 165, weight_kg: gender === "女" ? 47 : 52, build: "标准", leg_type: "修长", skin: { base_tone: "普通", tan: 0, texture: "普通" } },
    };
  }
  if (age <= 19) {
    return {
      attributes: { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10 },
      body: { height_cm: gender === "女" ? 158 : 170, weight_kg: gender === "女" ? 50 : 58, build: "标准", leg_type: "修长", skin: { base_tone: "普通", tan: 0, texture: "普通" } },
    };
  }
  if (age >= 40) {
    return {
      attributes: { 力量: 10, 敏捷: 8, 体质: 9, 智力: 13, 感知: 12, 魅力: 11 },
      body: { height_cm: gender === "女" ? 162 : 173, weight_kg: gender === "女" ? 55 : 72, build: "结实", leg_type: "结实", skin: { base_tone: "普通", tan: 1, texture: "普通" } },
    };
  }
  if (age >= 30) {
    return {
      attributes: { 力量: 10, 敏捷: 9, 体质: 10, 智力: 13, 感知: 11, 魅力: 11 },
      body: { height_cm: gender === "女" ? 162 : 175, weight_kg: gender === "女" ? 53 : 70, build: "标准", leg_type: "修长", skin: { base_tone: "普通", tan: 0, texture: "普通" } },
    };
  }
  return {
    attributes: { 力量: 9, 敏捷: 10, 体质: 10, 智力: 12, 感知: 10, 魅力: 11 },
    body: { height_cm: gender === "女" ? 162 : 173, weight_kg: gender === "女" ? 52 : 65, build: "标准", leg_type: "修长", skin: { base_tone: "普通", tan: 0, texture: "普通" } },
  };
}

/** 按年龄段给最低生活费。这不是叙事判断——0元开局等于引擎忘了给。 */
function minFundsByAge(age: number): number {
  if (age <= 6) return 100;
  if (age <= 19) return 300;
  if (age <= 29) return 1000;
  if (age <= 39) return 3000;
  return 5000;
}

/** 最小兜底装备：内衣。引擎不替 LLM 决定穿什么，但「裸体」不是合法默认状态。 */
export function defaultUnderwear(gender: string) {
  const innerTop: any = {
    name: gender === "女" ? "内衣(上)" : "汗衫",
    type: "clothing", slot: "inner_top", weight: 0.1, volume: 0.1, effects: [], state: "intact",
    flavor: gender === "女" ? "白色棉质内衣，最简单的款式。" : "洗得发白的棉质汗衫，领口微微泛黄，肩线处有两处缝补的痕迹。",
  };
  const innerBot: any = {
    name: "内裤",
    type: "clothing", slot: "inner_bot", weight: 0.1, volume: 0.1, effects: [], state: "intact",
    flavor: gender === "女" ? "纯白棉质内裤，简洁朴素。" : "深灰色平角内裤，松紧带已经洗得有些松垮了。",
  };
  return { inner_top: innerTop, inner_bot: innerBot };
}

/** 生成结构化缺口报告——告诉 LLM 哪些变量是空的、该用什么工具补。 */
function buildGapReport(gs: any, activeWorld: string): string {
  const lines: string[] = [];

  // ✅ 已填充
  const filled: string[] = [];
  filled.push(`属性(6维)`);
  filled.push(`身体(身高/体重/体型)`);
  filled.push(`HP(${gs.player.hp?.current}/${gs.player.hp?.max})`);
  filled.push(`AC(${gs.player.ac})`);
  filled.push(`位置(${gs.player.location})`);
  filled.push(`生殖器档案(已自动生成)`);
  const eqCount = Object.keys(gs.player.equipment || {}).length;
  filled.push(`装备(${eqCount}件——内衣兜底)`);
  filled.push(`资金(¥${gs.player.funds}——年龄段最低生活费)`);
  lines.push(`✅ 已填充: ${filled.join(" / ")}`);

  // ⚠️ 部分填充
  const partial: string[] = [];
  if (eqCount <= 2) partial.push("装备(仅内衣，需外衣/工具)");
  if ((gs.player.inventory || []).length === 0) partial.push("背包(空)");
  if (gs.player.funds <= 1000) partial.push("资金(仅最低生活费)");
  if (partial.length > 0) lines.push(`⚠️ 部分填充: ${partial.join(" / ")}`);

  // ❌ 未填充
  const missing: string[] = [];
  const tools: string[] = [];
  if (Object.keys(gs.player.skills || {}).length === 0) {
    missing.push("技能(0项)");
    tools.push("grant_skill_exp");
  }
  if (Object.keys(gs.player.abilities || {}).length === 0) {
    missing.push("能力(0项)");
    tools.push("use_ability");
  }
  if (!gs.player.resourcePools || Object.keys(gs.player.resourcePools).length === 0) {
    missing.push("资源池(无)");
  }
  if (Object.keys(gs.player.properties || {}).length === 0) {
    missing.push("住宅(无)");
    tools.push("instantiate_residence 或 create_room");
  }
  if (Object.keys(gs.player.relationships || {}).length === 0) {
    missing.push("社会关系(0条)");
    tools.push("adjust_relation");
  }
  if (Object.keys(gs.npcs || {}).length === 0) {
    missing.push("通讯录/NPC(0人)");
    tools.push("create_character / spawn_npc_agent");
  }
  if ((gs.player.party || []).length === 0) {
    missing.push("队伍(0人)");
  }
  if (Object.keys(gs.flags || {}).length <= 1) {
    missing.push("身份flags(几乎空)");
    tools.push("set_flags");
  }
  if (!gs.player.public_identity) {
    missing.push("公开身份(无)");
  }
  if ((gs.player.titles || []).length === 0) {
    missing.push("头衔(无)");
  }
  if ((gs.player.memories || []).length === 0) {
    missing.push("记忆(0条)");
    tools.push("add_memory_tag");
  }
  if (Object.keys(gs.quests || {}).length === 0) {
    missing.push("任务(0个)");
    tools.push("open_quest / add_life_event");
  }
  lines.push(`❌ 未填充: ${missing.join(" / ")}`);

  // → 建议工具
  const uniqueTools = [...new Set(tools)];
  if (uniqueTools.length > 0) {
    lines.push(`→ 建议工具: ${uniqueTools.join(", ")}`);
  }

  // → 可用模板
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const wpPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "init_profiles.json");
    if (fs.existsSync(wpPath)) {
      const profiles = JSON.parse(fs.readFileSync(wpPath, "utf-8"));
      const ids = Object.keys(profiles).filter(k => !k.startsWith("_"));
      if (ids.length > 0) {
        lines.push(`→ 可用身份模板: ${ids.join(", ")} (调用 init_profile 应用)`);
      }
    }
  } catch {}

  return lines.join("\n");
}

export default {
  name: "init_game", label: "初始化游戏",
  description: "初始化新游戏骨架。身份装备请用init_profile。",
  parameters: Type.Object({
    name: Type.String({ description: "玩家姓名" }),
    gender: Type.String({ description: "玩家性别，男/女" }),
    age: Type.Number({ description: "起始年龄，例如16" }),
    year: Type.Optional(Type.Number({ description: "起始年份，默认2018" })),
    location: Type.Optional(Type.String({ description: "起始地点，默认千葉駅前。高中生→千葉駅前，独居→千葉駅前或千叶市街，外国人/外星人→自行指定" })),
  }),
  async execute(_id, params, _signal, _onUpdate, _ctx) {
    const stateMod = await import("../../engine/state.ts");
    const { resetState, saveState, setPlayerLocation, initPlayerGrid, calcMaxHP, calcAC } = stateMod;
    resetState();
    const gs = stateMod.gameState;
    gs._toolsLocked = false; // 防御：上次会话异常退出可能残留锁定

    // ── 引擎骨架 ──
    gs.player.relationships = {};
    gs.player.inventory = [];
    gs.player.equipment = {};
    gs.player.skills = {};
    gs.player.abilities = {};
    gs.player.wounds = [];
    gs.player.party = [];
    gs.player.titles = [];
    gs.player.funds = 0;
    gs.player.fatigue = 0;
    gs.player.resourcePools = undefined;
    gs.player.public_identity = undefined;
    gs.player.properties = {};
    gs.player.memories = [];
    gs.npcs = {};
    gs.flags = {};
    gs.player.flags = {};
    gs.quests = {};
    gs.active_hooks = [];
    gs.completed_events = [];
    gs.sexStates = {};

    gs.player.name = params.name;
    gs.player.gender = params.gender;
    gs.player.age = params.age;
    const stats = baseStats(params.age, params.gender);
    gs.player.attributes = stats.attributes as any;
    gs.player.body = stats.body as any;
    const maxHP = calcMaxHP(gs.player.attributes.体质, params.age);
    gs.player.hp = { current: maxHP, max: maxHP };
    gs.player.ac = calcAC(gs.player.attributes.敏捷, gs.player.equipment);
    gs.player.alive = true;

    gs.time.player_age = params.age;
    gs.time.timeline_origin.age = params.age;
    const baseYear = params.year ?? 2018;
    gs.time.timeline_origin.year = baseYear;
    gs.time.game_date = `${baseYear}-04-07`;
    const { getLifeStage } = await import("../../engine/time.ts");
    gs.time.player_stage = getLifeStage(params.age);

    // ── 最小兜底：内衣 + 手机 + 最低生活费 ──
    const underwear = defaultUnderwear(params.gender);
    gs.player.equipment = { inner_top: underwear.inner_top, inner_bot: underwear.inner_bot };
    gs.player.funds = minFundsByAge(params.age);
    // 现代日本基本配备
    gs.player.inventory.push({
      name: "手机", type: "tool", weight: 0.2, volume: 0.2,
      effects: [{ type: "communication" }], state: "intact",
    });

    // reload world data (orgs, items, characters, etc.) after resetState wiped them
    const { loadActiveWorld } = stateMod;
    loadActiveWorld();

    // ── 生殖器档案自动生成 ──
    try {
      const { getOrCreateSexState } = stateMod;
      await getOrCreateSexState(params.name);
    } catch (e: any) {
      // sex.ts 不存在时静默跳过（公开 repo 不含成人内容）
      console.error("init_game: 生殖器档案生成失败", e.message || String(e));
    }

    // ── 位置 ──
    // 玩家未指定起始地点时，从千叶真实住宅区中随机分配（和117个NPC一样）
    const DEFAULT_HOMES = [
      "海浜幕張", "稲毛海岸", "千葉駅前", "西千葉", "検見川浜",
      "蘇我", "千葉みなと", "本千葉", "稲毛"
    ];
    const startLocation = params.location || DEFAULT_HOMES[Math.floor(Math.random() * DEFAULT_HOMES.length)];
    setPlayerLocation(startLocation);
    gs.player.known_locations = [startLocation];

    // ── 世界 flag ──
    const activeWorld = gs.activeWorld || "oregairu";
    gs.flags[`worldpack_${activeWorld}`] = true;
    if (activeWorld === "oregairu") {
      gs.flags["oregairu"] = true;
    }

    // ── 时间线快进 ──
    const { currentDay, fastForwardTimeline } = await import("../../engine/timeline.ts");
    const startDay = currentDay();
    if (startDay > 1) {
      const completed = await fastForwardTimeline(startDay);
      if (completed.length > 0 && _ctx?.chat) {
        try {
          _ctx.chat.addSystemMessage(
            `[引擎] 时间线快进：从 day ${startDay} 开局，已自动完成 ${completed.length} 个过期事件。\n` +
            completed.slice(0, 10).join(", ") + (completed.length > 10 ? `…等` : "")
          );
        } catch {}
      }
    }

    saveState();

    // ── 状态完整性校验（init 阶段：大声报错+警告） ──
    try {
      const { validatePlayerState } = await import("../../engine/validate-state.ts");
      validatePlayerState(gs, { phase: "init" });
    } catch (e: any) {
      console.error("init_game: 状态校验器调用失败", e?.message || String(e));
    }

    // ── 结构化缺口报告 ──
    const gapReport = buildGapReport(gs, activeWorld);
    const summary = [
      `游戏骨架已初始化：玩家 ${params.name}（${params.gender}，${params.age}岁）。`,
      ``,
      gapReport,
    ].join("\n");

    return { content: [{ type: "text", text: summary }], details: {} };
  },
};
