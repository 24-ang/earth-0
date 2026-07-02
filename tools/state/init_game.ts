import { Type } from "typebox";

function baseStats(age: number, gender: string) {
  if (age <= 6) {
    return {
      attributes: { 力量: 3, 敏捷: 4, 体质: 3, 智力: 3, 感知: 3, 魅力: 4 },
      body: {
        height_cm: 115, weight_kg: 20, build: "纤细", leg_type: "纤细",
        skin: { base_tone: "普通", tan: 0, texture: "细腻" },
      },
    };
  }
  if (age <= 19) {
    return {
      attributes: { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10 },
      body: {
        height_cm: gender === "女" ? 158 : 170, weight_kg: gender === "女" ? 50 : 58,
        build: "标准", leg_type: "修长",
        skin: { base_tone: "普通", tan: 0, texture: "普通" },
      },
    };
  }
  if (age >= 40) {
    return {
      attributes: { 力量: 10, 敏捷: 8, 体质: 9, 智力: 13, 感知: 12, 魅力: 11 },
      body: {
        height_cm: gender === "女" ? 162 : 173, weight_kg: gender === "女" ? 55 : 72,
        build: "结实", leg_type: "结实",
        skin: { base_tone: "普通", tan: 1, texture: "普通" },
      },
    };
  }
  if (age >= 30) {
    return {
      attributes: { 力量: 10, 敏捷: 9, 体质: 10, 智力: 13, 感知: 11, 魅力: 11 },
      body: {
        height_cm: gender === "女" ? 162 : 175, weight_kg: gender === "女" ? 53 : 70,
        build: "标准", leg_type: "修长",
        skin: { base_tone: "普通", tan: 0, texture: "普通" },
      },
    };
  }
  return {
    attributes: { 力量: 9, 敏捷: 10, 体质: 10, 智力: 12, 感知: 10, 魅力: 11 },
    body: {
      height_cm: gender === "女" ? 162 : 173, weight_kg: gender === "女" ? 52 : 65,
      build: "标准", leg_type: "修长",
      skin: { base_tone: "普通", tan: 0, texture: "普通" },
    },
  };
}

export default {
  name: "init_game", label: "初始化游戏",
  description: "初始化新游戏骨架。身份装备请用init_profile。",
  parameters: Type.Object({
    name: Type.String({ description: "玩家姓名" }),
    gender: Type.String({ description: "玩家性别，男/女" }),
    age: Type.Number({ description: "起始年龄，例如16" }),
    year: Type.Optional(Type.Number({ description: "起始年份，默认2018" })),
  }),
  async execute(_id, params, _signal, _onUpdate, _ctx) {
    const stateMod = await import("../../engine/state.ts");
    const { resetState, saveState, setPlayerLocation, initPlayerGrid, calcMaxHP, calcAC } = stateMod;
    resetState();
    const gs = stateMod.gameState;

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
    gs.npcs = {};
    gs.flags = {};
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

    setPlayerLocation("千叶_住宅区");
    gs.player.known_locations = ["千叶_住宅区"];
    initPlayerGrid();

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
    return { content: [{ type: "text", text: `游戏骨架已初始化：玩家 ${params.name}（${params.gender}，${params.age}岁）。身份装配可调用 init_profile。` }], details: {} };
  },
};
