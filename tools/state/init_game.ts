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
      // ESM 动态 import 返回的 namespace 中 export let 是 live binding，
      // 但 const { gameState } = ns 拆构后本地变量是快照 — resetState() 重新绑定了
      // 模块变量后本地 gameState 会指向旧对象。必须通过 ns.gameState 访问。
      const stateMod = await import("../../engine/state.ts");
      const { resetState, saveState, setPlayerLocation, initPlayerGrid } = stateMod;
      // 重置状态
      resetState();
      const gs = stateMod.gameState; // 取 resetState() 后真正生效的对象

      // 显式清除所有可变状态（resetState 已清，此处防御性再清一次确保无残留）
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
      gs.npcs = {};
      gs.flags = {};
      gs.quests = {};
      gs.active_hooks = [];
      gs.completed_events = [];
      gs.sexStates = {};

      // 设置玩家属性
      gs.player.name = params.name;
      gs.player.gender = params.gender;
      gs.player.age = params.age;

      // 根据年龄初始化属性 (如果是6岁，属性较低；如果是16岁，属性为默认值)
      if (params.age <= 6) {
        gs.player.attributes = { 力量: 3, 敏捷: 4, 体质: 3, 智力: 3, 感知: 3, 魅力: 4 };
        gs.player.body = {
          height_cm: 115, weight_kg: 20, build: "纤细", leg_type: "纤细",
          skin: { base_tone: "普通", tan: 0, texture: "细腻" },
        };

        // 幼童初始装备
        gs.player.equipment = {
          top: { name: "儿童短袖T恤", type: "clothing", slot: "top", weight: 0.2, state: "intact", volume: 0.3 },
          bottom: { name: "运动短裤", type: "clothing", slot: "bottom", weight: 0.2, state: "intact", volume: 0.3 },
          feet: { name: "儿童运动鞋", type: "clothing", slot: "feet", weight: 0.3, state: "intact", volume: 0.4 },
          inner_bot: { name: "儿童内裤", type: "clothing", slot: "inner_bot", weight: 0.02, state: "intact", volume: 0.1 }
        };
      } else {
        gs.player.attributes = { 力量: 8, 敏捷: 10, 体质: 9, 智力: 12, 感知: 10, 魅力: 10 };
        gs.player.body = {
          height_cm: 170, weight_kg: 58, build: "标准", leg_type: "修长",
          skin: { base_tone: "普通", tan: 0, texture: "普通" },
        };

        // 学生初始装备
        if (params.gender === "女") {
          gs.player.equipment = {
            top: {
              name: "总武高女生制服",
              type: "clothing",
              slot: "top",
              weight: 0.5,
              effects: [
                { type: "social_bonus", value: 1, condition: "school_area" },
                { type: "reputation_bonus", value: 1, group: "学生" }
              ],
              state: "intact",
              volume: 0.5
            },
            bottom: { name: "黑白百褶裙", type: "clothing", slot: "bottom", weight: 0.2, state: "intact", volume: 0.5 },
            legs: { name: "黑色过膝袜", type: "clothing", slot: "legs", weight: 0.1, state: "intact", volume: 0.2 },
            feet: { name: "皮鞋", type: "clothing", slot: "feet", weight: 0.5, state: "intact", volume: 0.5 },
            inner_top: { name: "白色棉质胸罩", type: "clothing", slot: "inner_top", weight: 0.05, state: "intact", volume: 0.1 },
            inner_bot: { name: "白色棉内裤", type: "clothing", slot: "inner_bot", weight: 0.03, state: "intact", volume: 0.1 },
            back: { name: "书包", type: "tool", slot: "back", weight: 0.3, effects: [{ type: "pocket", value: 10 }], state: "intact", volume: 0.5 }
          };
        } else {
          gs.player.equipment = {
            top: {
              name: "总武高男生制服",
              type: "clothing",
              slot: "top",
              weight: 0.5,
              effects: [
                { type: "social_bonus", value: 1, condition: "school_area" },
                { type: "reputation_bonus", value: 1, group: "学生" }
              ],
              state: "intact",
              volume: 0.5
            },
            bottom: { name: "制服长裤", type: "clothing", slot: "bottom", weight: 0.5, state: "intact", volume: 0.5 },
            feet: { name: "皮鞋", type: "clothing", slot: "feet", weight: 0.5, state: "intact", volume: 0.5 },
            inner_top: { name: "棉质汗衫", type: "clothing", slot: "inner_top", weight: 0.05, state: "intact", volume: 0.1 },
            inner_bot: { name: "平角裤", type: "clothing", slot: "inner_bot", weight: 0.03, state: "intact", volume: 0.1 },
            back: { name: "书包", type: "tool", slot: "back", weight: 0.3, effects: [{ type: "pocket", value: 10 }], state: "intact", volume: 0.5 }
          };
        }
      }

      // 初始道具放入背包
      gs.player.inventory = [
        { name: "手机", type: "tool", slot: "back", weight: 0.2, effects: [{ type: "communication", value: "通话/短信/网络" }], state: "intact", volume: 0.5 },
        { name: "钱包", type: "tool", slot: "back", weight: 0.1, effects: [{ type: "pocket", value: 5 }], state: "intact", volume: 0.5 },
        { name: "钥匙", type: "tool", slot: "back", weight: 0.05, effects: [{ type: "unlock", value: "自家" }], state: "intact", flavor: "自家钥匙。", volume: 0.5 }
      ];


      // 自动校正 time.player_age 和 timeline_origin
      gs.time.player_age = params.age;
      gs.time.timeline_origin.age = params.age;
      const baseYear = params.year ?? 2018;
      // timeline_origin.year = 游戏开始的日历年。不依赖 age 偏移。
      // currentDay() 从 timeline_origin.year 的 1月1日起计算天数。
      gs.time.timeline_origin.year = baseYear;
      gs.time.game_date = `${baseYear}-04-07`;
      // 用 getLifeStage 统一计算（不用硬编码中文标签）
      const { getLifeStage } = await import("../../engine/time.ts");
      gs.time.player_stage = getLifeStage(params.age);
      
      // 重置起始地点：玩家在自家房间醒来，引擎注入 [空间] + [环境] 段
      setPlayerLocation("家_玩家房间");
      initPlayerGrid();

      // 时间线快进：若开局日期晚于默认起点，自动补完已过期事件（flag/好感/NPC关系/记忆）
      const { currentDay, fastForwardTimeline } = await import("../../engine/timeline.ts");
      const startDay = currentDay();
      if (startDay > 1) {
        const completed = await fastForwardTimeline(startDay);
        if (completed.length > 0) {
          // 注入系统消息告知 GM
          if (_ctx?.chat) {
            try {
              _ctx.chat.addSystemMessage(
                `[引擎] 时间线快进：从 day ${startDay} 开局，已自动完成 ${completed.length} 个过期事件。\n` +
                completed.slice(0, 10).join(", ") + (completed.length > 10 ? `…等` : "")
              );
            } catch {}
          }
        }
      }

      saveState();
      return { content: [{ type: "text", text: `游戏已初始化：玩家 ${params.name}（${params.gender}，${params.age}岁）` }], details: {} };
    }
  };
