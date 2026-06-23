import { Type } from "typebox";

export default {
    name: "board_train", label: "乘电车",
    description: "从当前所在车站乘电车。读city_map.json时刻表，触发旅行叙事模式。",
    parameters: Type.Object({
      from: Type.String({ description: "出发站名" }),
      to: Type.String({ description: "目的站名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      // 查时刻表
      const cityMap = await import("../../data/city_map.json", { with: { type: "json" } });
      const regions = (cityMap as any).default?.regions || {};
      let mins = 0;
      for (const reg of Object.values(regions) as any[]) {
        if (!reg.stations) continue;
        for (const [sn, sd] of Object.entries(reg.stations)) {
          if (sn === params.from || sn.includes(params.from)) {
            const timeTo = (sd as any).time_to || {};
            for (const [dn, dm] of Object.entries(timeTo)) {
              if (dn === params.to || dn.includes(params.to)) { mins = dm as number; break; }
            }
          }
        }
      }
      if (mins <= 0) return { content: [{ type: "text", text: `找不到 ${params.from} → ${params.to} 的电车路线` }], details: {} };

      // 触发旅行模式
      const { gameState, saveState } = await import("../../engine/state.ts");
      gameState.pendingTravel = {
        from: params.from,
        to: params.to,
        route: `电车（约${mins}分钟）`,
        minutes: mins,
        timeOfDay: gameState.time.time_of_day
      };
      saveState();
      return { content: [{ type: "text", text: `登上了 ${params.from} → ${params.to} 的电车。预计 ${mins} 分钟。到达前请叙述车内见闻，然后调用 complete_travel。` }], details: {} };
    },
  };
