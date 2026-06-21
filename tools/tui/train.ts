import { Type } from "typebox";
import { showMenu } from "../helpers.ts";

export default {
    description: "电车通勤：查看当前区域车站，购票乘车",
    handler: async (_args, ctx) => {
      const { gameState, saveState, getLocationNav } = await import("../../engine/state.ts");
      const loc = gameState.player.location;
      const nav = getLocationNav(loc);

      // 加载车站数据
      let cityMap: any = null;
      try {
        cityMap = (await import("./data/city_map.json", { with: { type: "json" } })).default;
      } catch (e) {
        console.error("train command cityMap loading error:", e);
      }

      // 在 city_map 中搜索当前位置所在区域的车站
      const findStations = (): { region: string; stationName: string; station: any }[] => {
        const result: { region: string; stationName: string; station: any }[] = [];
        if (!cityMap?.regions) return result;
        for (const [rname, rdata] of Object.entries(cityMap.regions) as any) {
          // 匹配：导航路径包含该区域名 或 该区域的 landmarks 中有当前位置
          const inBreadcrumb = nav.breadcrumb.some((b: string) => b.includes(rname) || rname.includes(b));
          const hasLandmark = (rdata.landmarks || []).some((lm: string) => loc.includes(lm) || lm.includes(loc));
          if (inBreadcrumb || hasLandmark) {
            if (rdata.stations) {
              for (const [sname, sdata] of Object.entries(rdata.stations) as any) {
                result.push({ region: rname, stationName: sname, station: sdata });
              }
            }
          }
        }
        // 没匹配到 → 返回所有车站
        if (result.length === 0 && cityMap?.regions) {
          for (const [rname, rdata] of Object.entries(cityMap.regions) as any) {
            if (rdata.stations) {
              for (const [sname, sdata] of Object.entries(rdata.stations) as any) {
                result.push({ region: rname, stationName: sname, station: sdata });
              }
            }
          }
        }
        return result;
      };

      const stations = findStations();
      if (stations.length === 0) {
        ctx.ui.notify("附近没有车站。试着移动到城区再乘坐。", "warning");
        return;
      }

      // 一级菜单：选择出发站
      const stationItems: MenuItem[] = stations.map(s => ({
        label: `🚉 ${s.stationName}`,
        detail: `${s.region} | ${(s.station.lines || []).join("、")}`,
        action: async (stationDone) => {
          // 二级菜单：选择目的地
          const dests = s.station.time_to || {};
          const destEntries = Object.entries(dests) as [string, number][];
          if (destEntries.length === 0) {
            ctx.ui.notify(`${s.stationName}没有可直达的车站`, "warning");
            stationDone();
            return;
          }
          const destItems: MenuItem[] = destEntries.map(([dest, mins]) => ({
            label: `🎫 → ${dest}`,
            detail: `约${mins}分钟 | ${getCurrency()}${Math.round(mins * 20)}`,
            action: async (destDone) => {
              const fare = Math.round(mins * 20);
              if (gameState.player.funds < fare) {
                ctx.ui.notify(`资金不足！需要 ${getCurrency()}${fare}，当前 ${getCurrency()}${gameState.player.funds}`, "warning");
                destDone();
                return;
              }
              gameState.player.funds -= fare;
              // 推进时间 + 移动
              gameState.pendingTravel = {
                from: loc,
                to: dest,
                route: `电车 ${s.stationName}→${dest}（${mins}分钟）`,
                minutes: mins,
                timeOfDay: gameState.time.time_of_day
              };
              saveState();
              ctx.ui.notify(`🚃 从 ${s.stationName} 出发，前往 ${dest}。${getCurrency()}${fare}`, "info");
              ctx.chat.addSystemMessage(`玩家乘坐电车从 ${s.stationName} 前往 ${dest}，约${mins}分钟。描述车窗外的风景，到达前调用 complete_travel。`);
              updateChatHUD(ctx);
              destDone();
              stationDone();
            }
          }));
          await showMenu(ctx, `🚉 ${s.stationName} → 目的地`, destItems);
        }
      }));

      await showMenu(ctx, "🚃 电车通勤 — 选择出发站", stationItems);
    },
  };
