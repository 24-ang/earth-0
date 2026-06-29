/**
 * 调试工具：强制提升 NPC 性欲值 — 测试 sex 模块用
 * "远程跳蛋 / 催眠暗示 / 洗脑发情" — 以叙事道具包装引擎调试入口
 */
import { Type } from "typebox";

export default {
    name: "debug_sex_heat", label: "发情调试",
    description: "调试：对NPC设定欲望/兴奋值。target:all=所有NPC。desire/arousal:0-100。alone:是否移到独处。",
    parameters: Type.Object({
      target: Type.String({ description: "NPC名或'all'(所有sex profile NPC)" }),
      desire: Type.Optional(Type.Number({ description: "欲望值 0-100，默认90" })),
      arousal: Type.Optional(Type.Number({ description: "兴奋值 0-100，默认0" })),
      alone: Type.Optional(Type.Boolean({ description: "是否移至独处环境（测试自主行为），默认false" })),
      advance_hours: Type.Optional(Type.Number({ description: "额外推进小时数让引擎跑tick，默认0" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateSexState, getOrCreateNPC } = await import("../../engine/state.ts");
      const { advanceMinutes } = await import("../../engine/time.ts");
      const { tickSexStates } = await import("../../engine/state.ts");
      const { autoSwitchMode } = await import("../helpers.ts");

      autoSwitchMode("sex_touch"); // 自动切 sex 模式

      const d = params.desire ?? 90;
      const a = params.arousal ?? 0;
      const alone = params.alone ?? false;
      const hours = params.advance_hours ?? 0;

      const targets: string[] = params.target === "all"
        ? Object.keys(gameState.sexStates || {})
        : [params.target];

      if (targets.length === 0) {
        return { content: [{ type: "text", text: `没有找到 sex profile: ${params.target}。先得 NPC 有 sex_profiles.json 定义。` }], details: {} };
      }

      const results: string[] = [];

      for (const name of targets) {
        const ss = await getOrCreateSexState(name);
        if (!ss) {
          results.push(`${name}: 无sex档案，跳过`);
          continue;
        }

        ss.desire = Math.min(100, d);
        ss.arousal = Math.min(100, a);
        ss.cycleDay = 14; // 排卵期 — 最大加成
        const { getCyclePhase } = await import("../../engine/sex.ts");
        ss.cyclePhase = getCyclePhase(14);

        // 如果 alone，把 NPC 移到独立房间
        if (alone) {
          const npc = getOrCreateNPC(name);
          npc.currentRoom = name + "_独处测试";
          // 确保这个房间在 ROOMS 里
          const { getRoom, ROOMS } = await import("../../engine/state.ts");
          const existing = getRoom(npc.currentRoom);
          if (!existing) {
            const w = 8, h = 8;
            const cells: any[][] = [];
            for (let y = 0; y < h; y++) {
              const row: any[] = [];
              for (let x = 0; x < w; x++) {
                row.push({ type: "floor", block: false, furniture: null, label: "  " });
              }
              cells.push(row);
            }
            ROOMS[npc.currentRoom] = { width: w, height: h, cellSize: 1, floor: 0, origin: [4, 4], cells, capacity: undefined };
          }
        }

        results.push(`${name}: desire=${ss.desire} arousal=${ss.arousal} cycle=${ss.cyclePhase}${alone ? " (独处)" : ""}`);
      }

      // 推进时间让 tick 跑起来
      if (hours > 0) {
        advanceMinutes(gameState.time, hours * 60);
        gameState.player.age = gameState.time.player_age;
        // 强制执行 tick
        if (gameState.sexStates) {
          await tickSexStates(0, hours * 60);
        }
      }

      saveState();

      results.push(`\n模式已切为: ${gameState.mode} | Layer1: ${gameState.layer1Enabled}`);
      if (hours > 0) {
        results.push(`时间推进了 ${hours} 小时 → ${gameState.time.game_date} ${gameState.time.time_of_day}`);
        results.push(`自主行为检查已执行（每 tick）`);
      }
      results.push(`\n接下来：GM 可以用 sex_touch / masturbate 工具，或 spawn NPC agent 观察身体语言。`);

      return { content: [{ type: "text", text: results.join("\n") }], details: {} };
    },
  };
