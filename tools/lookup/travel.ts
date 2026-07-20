import { Type } from "typebox";
import { pushUserText } from "../helpers.ts";

/**
 * 统一旅行工具 —— 合并 go_to_location + travel_intercity + complete_travel
 *
 * PHILOSOPHY §1.3: 4→1 工具合并（同 world_interact 先例）。
 * 引擎自动判断同城/跨城/步行/电车/火车，LLM 只需传目的地。
 */

export default {
    name: "travel", label: "旅行",
    description: "前往目的地。同城步行/电车/公交，跨城火车。到达后引擎自动收口。",
    parameters: Type.Object({
      destination: Type.String({ description: "目标地点名，如'千叶市立总武高等学校'" }),
      method: Type.Optional(Type.String({ description: "步行|电车|公交|火车|auto，默认auto自动选择" })),
    }),
    async execute(_id, params, _s, _o, ctx) {
      const { gameState, saveState, setPlayerLocation, isSameLocation } = await import("../../engine/state.ts");
      const { moveTo, advanceTimeMinutes } = await import("../helpers.ts");
      const { advanceMinutes } = await import("../../engine/time.ts");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const dest = params.destination;
      const method = params.method || "auto";
      const currentLoc = gameState.player.location;

      // 0. 已在目的地
      if (isSameLocation(currentLoc, dest)) {
        return {
          content: [{ type: "text", text: `你已经在 ${dest} 了。` }],
          details: { arrived: true, location: currentLoc },
        };
      }

      // 1. 加载 city_map
      const activeWorld = gameState.activeWorld || "oregairu";
      const wPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "city_map.json");
      const defaultPath = path.resolve(process.cwd(), "data", "city_map.json");
      let cityMapConfig: any = {};
      try {
        const fileContent = fs.existsSync(wPath)
          ? fs.readFileSync(wPath, "utf-8")
          : fs.readFileSync(defaultPath, "utf-8");
        cityMapConfig = JSON.parse(fileContent);
      } catch (e) {
        console.error("travel: city_map.json load error", e);
      }

      // 2. 查找目的地所属区域
      let destRegion = "";
      let destIsLandmark = false;
      for (const [regionName, regionData] of Object.entries<any>(cityMapConfig.regions || {})) {
        if (regionData.landmarks?.includes(dest)) {
          destRegion = regionName;
          destIsLandmark = true;
          break;
        }
      }

      // 3. 查找当前所在区域
      let currentRegion = "";
      for (const [regionName, regionData] of Object.entries<any>(cityMapConfig.regions || {})) {
        if (regionData.landmarks?.some((l: string) => isSameLocation(currentLoc, l))) {
          currentRegion = regionName;
          break;
        }
      }

      // 4. 同城移动（目的地在本城 landmarks 中 或 known_locations 中 或 rooms/school_map 中）
      let destIsKnown = destIsLandmark || (gameState.player.known_locations || []).some((k: string) => isSameLocation(k, dest));
      if (!destIsKnown) {
        // 查 rooms.json 和 school_map.json（内景房间）
        const { getRoom } = await import("../../engine/state.ts");
        destIsKnown = !!getRoom(dest);
        if (!destIsKnown) {
          try {
            const sPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "school_map.json");
            const sDefaultPath = path.resolve(process.cwd(), "data", "school_map.json");
            if (fs.existsSync(sPath) || fs.existsSync(sDefaultPath)) {
              const sm = JSON.parse(fs.readFileSync(fs.existsSync(sPath) ? sPath : sDefaultPath, "utf-8"));
              if (sm.buildings) {
                for (const bdata of Object.values(sm.buildings)) {
                  const b = bdata as any;
                  if (b.rooms) {
                    for (const rooms of Object.values(b.rooms)) {
                      if ((rooms as string[]).some((r: string) => isSameLocation(r, dest))) {
                        destIsKnown = true; break;
                      }
                    }
                  }
                  if (destIsKnown) break;
                }
              }
            }
          } catch {}
        }
        if (destIsKnown) {
          gameState.player.known_locations.push(dest);
        }
      }

      // ── 自动生成：如果目的地存在于 location 设定中但无房间网格，自动建一个 ──
      if (!destIsKnown) {
        try {
          const { _regionContexts, createDynamicLocation } = await import("../../engine/state.ts");
          if (_regionContexts) {
            for (const [rk, data] of Object.entries(_regionContexts)) {
              if (data?.keys?.some(k => dest.includes(k) || k.includes(dest))) {
                createDynamicLocation(rk, dest);
                destIsKnown = true;
                break;
              }
            }
          }
        } catch (_) {}
      }

      if (destIsKnown) {
        // 判断交通方式：同建筑内房间→秒级
        const { getRoom } = await import("../../engine/state.ts");
        const isRoomToRoom = getRoom(currentLoc) && getRoom(dest);
        let route: string;
        let minutes: number;
        if (isRoomToRoom) {
          route = "步行";
          minutes = 0.5; // 30秒，房间间走几步
        } else if (method === "auto") {
          if (currentRegion && destRegion && currentRegion === destRegion) {
            route = "步行";
            minutes = 15;
          } else {
            route = "电车";
            minutes = 10;
          }
        } else if (method === "火车") {
          // 同城不用火车，降级为电车
          route = "电车";
          minutes = 10;
        } else {
          route = method;
          minutes = route === "电车" ? 10 : route === "公交" ? 20 : 25;
        }

        gameState.pendingTravel = {
          from: currentLoc,
          to: dest,
          route,
          minutes,
          timeOfDay: gameState.time.time_of_day || "morning",
        };

        // 同城到达：直接更新位置+网格坐标（不再依赖 complete_travel）
        setPlayerLocation(dest);
        advanceMinutes(gameState.time, minutes);

        // 通勤偶遇检测
        try {
          const { detectCommuteEncounter } = await import("../../engine/commute.ts");
          const encounter = await detectCommuteEncounter(currentLoc, dest, route, minutes, gameState);
          if (encounter) {
            gameState._lastCommuteEncounter = encounter;
          }
        } catch (e) {
          console.error("travel: detectCommuteEncounter failed:", e);
        }

        saveState();

        const vehicleHint =
          route === "步行"
            ? "描述途中的街景、路人和季节变化。到达后请直接继续叙事。"
            : route === "电车"
            ? "描述车厢内的氛围、车窗外的风景。到达后请直接继续叙事。"
            : "描述沿途的街区和交通状况。到达后请直接继续叙事。";

        pushUserText(`玩家出发前往 ${dest}（${route}，约${minutes}分钟）。${vehicleHint}`);

        return {
          content: [
            {
              type: "text",
              text: `出发前往 ${dest}（${route}，约${minutes}分钟）。${vehicleHint}`,
            },
          ],
          details: { from: currentLoc, to: dest, route, minutes, pendingTravel: true },
        };
      }

      // 5. 跨城移动：检查城际路线
      const connections = cityMapConfig.connections || cityMapConfig.intercity_lines || {};
      let matchedRoute: string | null = null;
      let connection: any = null;
      for (const [routeKey, conn] of Object.entries<any>(connections)) {
        if ((conn.destination || conn.to) === dest || conn.stations?.includes(dest)) {
          matchedRoute = routeKey;
          connection = conn;
          break;
        }
      }

      if (matchedRoute && connection) {
        const price = connection.price ?? connection.ticket_price ?? 500;
        const duration = connection.duration ?? connection.duration_minutes ?? 60;
        const targetWorld = connection.target_world ?? "oregairu";

        if (gameState.player.funds < price) {
          return {
            content: [
              {
                type: "text",
                text: `旅行失败: 余额不足。购买车票需要 ${price}，当前仅有 ${gameState.player.funds}`,
              },
            ],
            details: {},
          };
        }

        gameState.player.funds -= price;
        advanceMinutes(gameState.time, duration);

        const { switchActiveWorld } = await import("../../engine/state.ts");
        switchActiveWorld(targetWorld);

        setPlayerLocation(dest);
        saveState();

        return {
          content: [
            {
              type: "text",
              text: `你购买了车票，搭乘 ${connection.name || matchedRoute} 经过 ${duration} 分钟到达了 ${dest}。`,
            },
          ],
          details: { targetWorld, destination: dest, price, duration },
        };
      }

      // 6. 目的地未找到——尝试作为房间名模糊匹配
      // 给提示，让 LLM 知道可以用 travel 但需要精确名称
      return {
        content: [
          {
            type: "text",
            text: `未找到目的地 "${dest}"。请确认名称是否正确。已知地点：${(gameState.player.known_locations || []).join("、") || "无"}。跨城旅行请确认路线名称。`,
          },
        ],
        details: { notFound: true },
      };
    },
  };
