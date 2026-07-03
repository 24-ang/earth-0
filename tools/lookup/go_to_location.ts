import { Type } from "typebox";

export default {
    name: "go_to_location", label: "去某地",
    description: "前往同城已知地点。设pendingTravel后需调complete_travel收口。跨城请用travel_intercity。",
    parameters: Type.Object({
      destination: Type.String({ description: "目标地点名（如'千叶市立总武高等学校'）" }),
      route: Type.Optional(Type.String({ description: "交通方式：步行|电车|公交，默认步行" })),
    }),
    async execute(_id, params, _s, _o, ctx) {
      const { gameState, saveState, isSameLocation } = await import("../../engine/state.ts");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const dest = params.destination;
      const route = params.route || "步行";
      const currentLoc = gameState.player.location;
      if (isSameLocation(currentLoc, dest)) {
        return { content: [{ type: "text", text: `你已经在 ${dest} 了。` }], details: {} };
      }

      // 查 city_map 确认目的地存在 + 估算时间
      const activeWorld = gameState.activeWorld || "oregairu";
      const wPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "city_map.json");
      const defaultPath = path.resolve(process.cwd(), "data", "city_map.json");
      let cityMapConfig: any = {};
      try {
        const fileContent = fs.existsSync(wPath) ? fs.readFileSync(wPath, "utf-8") : fs.readFileSync(defaultPath, "utf-8");
        cityMapConfig = JSON.parse(fileContent);
      } catch (e) { console.error("go_to_location: city_map.json load error", e); }

      // 确认目的地存在于 landmarks 中
      let foundRegion = "";
      for (const [regionName, regionData] of Object.entries<any>(cityMapConfig.regions || {})) {
        if (regionData.landmarks?.includes(dest)) {
          foundRegion = regionName;
          break;
        }
      }
      // 兜底：也检查 known_locations
      if (!foundRegion && !(gameState.player.known_locations || []).includes(dest)) {
        return { content: [{ type: "text", text: `未找到地点 "${dest}"。请确认名称正确，或用 travel_intercity 跨城。` }], details: {} };
      }

      // 估算时间
      const walkSpeed = cityMapConfig.travel?.walk_speed || 80;
      let minutes = route === "电车" ? 10 : route === "公交" ? 20 : 25; // 默认步行 25 分钟（同城内）

      // 查当前区域的目标是否在同一区
      let currentRegion = "";
      for (const [regionName, regionData] of Object.entries<any>(cityMapConfig.regions || {})) {
        if (regionData.landmarks?.some((l: string) => isSameLocation(currentLoc, l))) {
          currentRegion = regionName;
          break;
        }
      }
      // 同建筑内房间移动：秒级（非城市级旅行）
      const ROOMS = (await import("../../engine/state.ts")).ROOMS;
      if (ROOMS[currentLoc] && ROOMS[dest]) {
        minutes = 0.5; // 30秒，房间间走几步的距离
      } else if (currentRegion && foundRegion && currentRegion === foundRegion) {
        minutes = route === "电车" ? 8 : route === "公交" ? 15 : 15; // 同区更短
      }

      gameState.pendingTravel = {
        from: currentLoc,
        to: dest,
        route,
        minutes,
        timeOfDay: gameState.time.time_of_day || "morning",
      };
      saveState();

      const vehicleHint = route === "步行" ? "描述途中的街景、路人和季节变化。"
        : route === "电车" ? "描述车厢内的氛围、车窗外的风景。到站后调 complete_travel。"
        : "描述沿途的街区和交通状况。到达后调 complete_travel。";

      if (ctx?.chat) {
        try {
          ctx.chat.addSystemMessage(
            `玩家出发前往 ${dest}（${route}，约${minutes}分钟）。${vehicleHint}到达目的地后请调用 complete_travel 完成移动。`
          );
        } catch {}
      }

      return {
        content: [{ type: "text", text: `已设pendingTravel: ${currentLoc} → ${dest}（${route}，约${minutes}分钟）。请在叙事途中到达后调用 complete_travel 收口。` }],
        details: { from: currentLoc, to: dest, route, minutes }
      };
    },
  };
