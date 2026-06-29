import { Type } from "typebox";

export default {
    name: "init_game", label: "初始化游戏",
    description: "初始化新游戏。year可选(默认2018)。age=16时game_date=year-04-07。",
    parameters: Type.Object({
      name: Type.String({ description: "玩家姓名" }),
      gender: Type.String({ description: "玩家性别，男/女" }),
      age: Type.Number({ description: "起始年龄，例如6" }),
      year: Type.Optional(Type.Number({ description: "起始年份，默认2018。如JoJo=1999、火影=木叶60年" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, resetState, saveState, setPlayerLocation, initPlayerGrid } = await import("../../engine/state.ts");
      // 重置状态
      resetState();
      
      // 显式清除所有可变状态（resetState 已清，此处防御性再清一次确保无残留）
      gameState.player.relationships = {};
      gameState.player.inventory = [];
      gameState.player.equipment = {};
      gameState.player.skills = {};
      gameState.player.abilities = {};
      gameState.player.wounds = [];
      gameState.player.party = [];
      gameState.player.titles = [];
      gameState.player.funds = 0;
      gameState.player.fatigue = 0;
      gameState.player.resourcePools = undefined;
      gameState.npcs = {};
      gameState.flags = {};
      gameState.quests = {};
      gameState.active_hooks = [];
      gameState.completed_events = [];
      gameState.sexStates = {};

      // 设置玩家属性
      gameState.player.name = params.name;
      gameState.player.gender = params.gender;
      gameState.player.age = params.age;
      
      // 根据年龄初始化属性 (如果是6岁，属性较低；如果是16岁，属性为默认值)
      if (params.age <= 6) {
        gameState.player.attributes = { 力量: 3, 敏捷: 4, 体质: 3, 智力: 3, 感知: 3, 魅力: 4 };
        gameState.player.body = {
          height_cm: 115, weight_kg: 20, build: "纤细", leg_type: "纤细",
          skin: { base_tone: "普通", tan: 0, texture: "细腻" },
        };
      } else {
        gameState.player.attributes = { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10 };
        gameState.player.body = {
          height_cm: 170, weight_kg: 58, build: "标准", leg_type: "修长",
          skin: { base_tone: "普通", tan: 0, texture: "普通" },
        };
      }
      
      // 自动校正 time.player_age 和 timeline_origin
      gameState.time.player_age = params.age;
      gameState.time.timeline_origin.age = params.age;
      const baseYear = params.year ?? 2018;
      gameState.time.timeline_origin.year = baseYear - (16 - params.age); // 出生年由 baseYear 锚定；例 baseYear=1999, age=16→1999
      // 校准游戏日期与时间线年份一致（否则 age=6 时 game_date 仍是 2018，时间推进即跳龄）
      gameState.time.game_date = `${gameState.time.timeline_origin.year}-04-07`;
      // 用 getLifeStage 统一计算（不用硬编码中文标签）
      const { getLifeStage } = await import("../../engine/time.ts");
      gameState.time.player_stage = getLifeStage(params.age);
      
      // 重置起始地点：玩家在自家房间醒来，引擎注入 [空间] + [环境] 段
      setPlayerLocation("家_玩家房间");
      initPlayerGrid();
      
      saveState();
      return { content: [{ type: "text", text: `游戏已初始化：玩家 ${params.name}（${params.gender}，${params.age}岁）` }], details: {} };
    }
  };
