import { Type } from "typebox";

export default {
    name: "travel_intercity",
    label: "跨城旅行",
    description: "购买车票前往其它城市世界线。route须在city_map.json中。扣减金钱与时间。",
    parameters: Type.Object({
      route: Type.String({ description: "路线标识 (如 sobu_line|wasteland_caravan)" }),
      destination: Type.String({ description: "目标站名" })
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, switchActiveWorld } = await import("../../engine/state.ts");
      const { advanceMinutes } = await import("../../engine/time.ts");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const activeWorld = gameState.activeWorld || "oregairu";
      const wPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "city_map.json");
      const defaultPath = path.resolve(process.cwd(), "data", "city_map.json");
      let cityMapConfig: any = {};
      try {
        const fileContent = fs.existsSync(wPath) ? fs.readFileSync(wPath, "utf-8") : fs.readFileSync(defaultPath, "utf-8");
        cityMapConfig = JSON.parse(fileContent);
      } catch (e) { console.error("travel_intercity: city_map.json load error", e); }

      const connection = cityMapConfig.connections?.[params.route] || cityMapConfig.intercity_lines?.[params.route];
      if (!connection) {
        return { content: [{ type: "text", text: `未找到名称为 [${params.route}] 的城际路线。` }], details: {} };
      }

      const price = connection.price ?? connection.ticket_price ?? 500;
      const duration = connection.duration ?? connection.duration_minutes ?? 60;
      const targetWorld = connection.target_world ?? "oregairu";

      if (gameState.player.funds < price) {
        return { content: [{ type: "text", text: `旅行失败: 余额不足。购买车票需要 ${price}，当前仅有 ${gameState.player.funds}` }], details: {} };
      }

      gameState.player.funds -= price;
      const timeRes = advanceMinutes(gameState.time, duration);
      
      switchActiveWorld(targetWorld);
      
      gameState.player.location = params.destination;
      gameState.player.gridPos = null;
      
      saveState();

      return {
        content: [{ type: "text", text: `你购买了车票，搭乘 [${connection.name}] 经过 ${duration} 分钟的行程到达了 [${params.destination}]。${timeRes.daysAdvanced > 0 ? "旅行途中跨越了深夜。" : ""}\n当前世界线已热挂载切换为 [${targetWorld}]。` }],
        details: { targetWorld, destination: params.destination }
      };
    }
  };
