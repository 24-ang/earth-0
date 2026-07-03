import { Type } from "typebox";

export default {
    name: "board_train", label: "乘电车",
    description: "从当前所在车站乘电车。读city_map.json时刻表，触发旅行叙事模式。",
    parameters: Type.Object({
      from: Type.String({ description: "出发站名" }),
      to: Type.String({ description: "目的站名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      // 查时刻表——读 worldpacks 而非 data
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { gameState, saveState } = await import("../../engine/state.ts");
      const activeWorld = gameState.activeWorld || "oregairu";
      const wPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "city_map.json");
      const defaultPath = path.resolve(process.cwd(), "data", "city_map.json");
      const raw = fs.existsSync(wPath) ? fs.readFileSync(wPath, "utf-8") : fs.readFileSync(defaultPath, "utf-8");
      const cityMapConfig = JSON.parse(raw);
      const regions = cityMapConfig.regions || {};
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
      if (mins <= 0) {
        // 收集所有可用车站名，帮助 LLM 选择正确的站名
        const allStations: string[] = [];
        for (const reg of Object.values(regions) as any[]) {
          if (!reg.stations) continue;
          for (const sn of Object.keys(reg.stations)) allStations.push(sn);
        }
        const stationHints = allStations.length > 0 ? `可用车站: ${allStations.join(", ")}。城际旅行请用 travel_intercity。` : "";
        return { content: [{ type: "text", text: `找不到 ${params.from} → ${params.to} 的电车路线。${stationHints}` }], details: {} };
      }

      // 触发旅行模式
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
