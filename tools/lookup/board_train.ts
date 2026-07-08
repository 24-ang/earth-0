import { Type } from "typebox";

export default {
    name: "board_train", label: "乘电车",
    description: "从当前所在车站乘电车。读city_map.json时刻表，触发旅行叙事模式。",
    parameters: Type.Object({
      from: Type.String({ description: "出发站名" }),
      to: Type.String({ description: "目的站名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { gameState, saveState } = await import("../../engine/state.ts");
      const activeWorld = gameState.activeWorld || "oregairu";
      const wPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "city_map.json");
      const defaultPath = path.resolve(process.cwd(), "data", "city_map.json");
      const raw = fs.existsSync(wPath) ? fs.readFileSync(wPath, "utf-8") : fs.readFileSync(defaultPath, "utf-8");
      const cityMapConfig = JSON.parse(raw);
      const regions = cityMapConfig.regions || {};
      const transit = cityMapConfig.transit || {};

      // 收集所有已知车站名（regions + transit 线路 stops，去重）
      const allStations: string[] = [];
      for (const reg of Object.values(regions) as any[]) {
        if (!reg.stations) continue;
        for (const sn of Object.keys(reg.stations)) allStations.push(sn);
      }
      for (const line of Object.values(transit) as any[]) {
        for (const s of (line.stops || [])) {
          if (!allStations.includes(s)) allStations.push(s);
        }
      }

      function fuzzyMatch(input: string): string | null {
        if (allStations.includes(input)) return input;
        // 精确包含匹配优先（"千叶" → "千叶站" 而非 "千叶中央站"）
        const starts = allStations.filter(s => s.startsWith(input));
        if (starts.length === 1) return starts[0]!;
        if (starts.length > 1) {
          // 多候选 → 选带"站"且最短的（主站名），如"千叶站"优于"千叶中央站"
          const withStation = starts.filter(s => s.endsWith("站"));
          if (withStation.length === 1) return withStation[0]!;
          if (withStation.length > 1) return withStation.sort((a,b) => a.length - b.length)[0]!;
          return starts.sort((a,b) => a.length - b.length)[0]!;
        }
        const contains = allStations.filter(s => s.includes(input));
        if (contains.length === 1) return contains[0]!;
        const inputContains = allStations.filter(s => input.includes(s));
        if (inputContains.length === 1) return inputContains[0]!;
        return null;
      }

      const fromStation = fuzzyMatch(params.from);
      const toStation = fuzzyMatch(params.to);
      if (!fromStation || !toStation) {
        const hints = allStations.length > 0 ? `可用车站: ${allStations.join(", ")}。城际旅行请用 travel_intercity。` : "";
        return { content: [{ type: "text", text: `找不到车站: ${!fromStation ? params.from : ""} ${!toStation ? params.to : ""}。${hints}` }], details: {} };
      }

      // 构建邻接图：从 transit 线路的 stops + stations 的 time_to 取边权重
      const graph: Record<string, Record<string, number>> = {};
      for (const line of Object.values(transit) as any[]) {
        const stops = line.stops || [];
        for (let i = 0; i < stops.length; i++) {
          const s = stops[i];
          graph[s] ??= {};
          // 前向边
          if (i < stops.length - 1) {
            const next = stops[i + 1]!;
            // 尝试从 time_to 取精确时间，否则按站数估算 ~3min/站
            let weight = 3;
            for (const reg of Object.values(regions) as any[]) {
              if (reg.stations?.[s]?.time_to?.[next]) { weight = reg.stations[s].time_to[next]; break; }
              if (reg.stations?.[next]?.time_to?.[s]) { weight = reg.stations[next].time_to[s]; break; }
            }
            graph[s][next] = weight;
            graph[next] ??= {};
            graph[next][s] = weight;
          }
        }
      }

      // BFS 最短路径（所有边权重小，BFS 足够）
      function findPath(from: string, to: string): { path: string[]; mins: number } | null {
        const dist: Record<string, number> = { [from]: 0 };
        const prev: Record<string, string | null> = { [from]: null };
        const queue = [from];
        while (queue.length > 0) {
          const u = queue.shift()!;
          if (u === to) break;
          for (const [v, w] of Object.entries(graph[u] || {})) {
            const alt = (dist[u] || 0) + w;
            if (dist[v] === undefined || alt < dist[v]) {
              dist[v] = alt;
              prev[v] = u;
              queue.push(v);
            }
          }
        }
        if (prev[to] === undefined && from !== to) return null;
        const path: string[] = [];
        let cur: string | null = to;
        while (cur) { path.unshift(cur); cur = prev[cur]!; }
        return { path, mins: dist[to] || 0 };
      }

      const result = findPath(fromStation, toStation);
      if (!result) {
        const reachable = Object.keys(graph[fromStation] || {});
        const hints = reachable.length > 0
          ? `从 ${fromStation} 可直达: ${reachable.join(", ")}。`
          : `可用车站: ${allStations.join(", ")}。`;
        return { content: [{ type: "text", text: `找不到 ${fromStation} → ${toStation} 的电车路线。${hints} 城际旅行请用 travel_intercity。` }], details: {} };
      }

      const routeDesc = result.path.length > 2
        ? `${fromStation} 经 ${result.path.slice(1, -1).join("→")} 至 ${toStation}`
        : `${fromStation} → ${toStation}`;

      gameState.pendingTravel = {
        from: params.from,
        to: params.to,
        route: `电车（${routeDesc}，约${result.mins}分钟）`,
        minutes: result.mins,
        timeOfDay: gameState.time.time_of_day
      };
      saveState();
      return { content: [{ type: "text", text: `登上了 ${routeDesc} 的电车。预计 ${result.mins} 分钟。到达前请叙述车内见闻，然后调用 complete_travel。` }], details: {} };
    },
  };
