/**
 * earth-0 扩展 — tools注册，LLM ↔ engine桥梁
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { gameState, getNamelessNPCs } from "./engine/state.ts";

export default function (pi: ExtensionAPI) {
  // ── 辅助 ──
  interface MenuItem { label: string; detail?: string; action?: (done: () => void) => void | Promise<void>; }

  function updateChatHUD(ctx: any) {
    try {
      if (gameState && gameState.time && gameState.player) {
        const timeOfDayZH: Record<string, string> = {
          morning: "午前",
          lunch: "昼",
          afternoon: "午後",
          evening: "夕方",
          night: "夜"
        };
        const loc = gameState.player.location;
        const clean = (s: string) => s ? s.replace(/[（(].*[）)]/, "").trim().toLowerCase() : "";
        const cLoc = clean(loc);
        const npcsHereCount = Object.values(gameState.npcs || {}).filter((n: any) => clean(n.currentRoom) === cLoc).length;
        const namelessCount = getNamelessNPCs(loc, gameState.turn).length;
        const totalCount = npcsHereCount + namelessCount;
        
        // 18/04/08(日)夜
        const dateParts = gameState.time.game_date.split("-");
        const shortYear = dateParts[0].slice(2);
        const shortDate = `${shortYear}/${dateParts[1]}/${dateParts[2]}`;
        const dayOfWeekShort = gameState.time.day_of_week[0]; // e.g. "日曜日" -> "日"
        const tod = timeOfDayZH[gameState.time.time_of_day] || gameState.time.time_of_day;
        
        // 🏫 / 🏙️ prefix for location
        let shortLoc = loc;
        if (loc.startsWith("千叶市立总武高等学校_")) {
          shortLoc = "🏫" + loc.replace("千叶市立总武高等学校_", "");
        } else if (loc.startsWith("千叶_")) {
          shortLoc = "🏙️" + loc.replace("千叶_", "");
        } else {
          shortLoc = "📍" + loc;
        }
        
        const statusBarText = `🕐 ${shortDate}(${dayOfWeekShort})${tod} | ${shortLoc} | 👥 ${totalCount}人`;
        ctx.ui.setWidget("hud-status-bar", [statusBarText]);
      }
    } catch (_) {}
  }

  function getStringWidth(str: string): number {
    return [...str].reduce((w, c) => w + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  }

  function truncateToWidth(str: string, maxWidth: number): string {
    let w = 0;
    let res = "";
    for (const c of str) {
      const charW = c.charCodeAt(0) > 0x7f ? 2 : 1;
      if (w + charW > maxWidth) break;
      res += c;
      w += charW;
    }
    return res;
  }

  function wrapLine(text: string, maxW: number): string[] {
    const res: string[] = [];
    let cur = "";
    let curW = 0;
    for (const c of text) {
      const cw = c.charCodeAt(0) > 0x7f ? 2 : 1;
      if (curW + cw > maxW) {
        res.push(cur);
        cur = c;
        curW = cw;
      } else {
        cur += c;
        curW += cw;
      }
    }
    if (cur) res.push(cur);
    return res;
  }

  async function moveTo(loc: string, ctx: any, gs: any, save: any) {
    gs.player.location = loc;
    if (!gs.player.known_locations) gs.player.known_locations = ["千叶_住宅区"];
    if (!gs.player.known_locations.includes(loc)) gs.player.known_locations.push(loc);
    const { initPlayerGrid } = await import("./engine/state.ts");
    initPlayerGrid();
    save(); ctx.ui.notify("📍 " + loc, "info");
    updateChatHUD(ctx);
  }

  function showPanel(ctx: any, title: string, lines: string[]): Promise<void> {
    const items: MenuItem[] = lines.map(l => ({ label: l, detail: "", action: undefined }));
    return showMenu(ctx, title, items);
  }

  function showMenu(ctx: any, title: string, itemsOrBuilder: MenuItem[] | (() => MenuItem[])): Promise<void> {
    return ctx.ui.custom(
      (tui: any, _theme: any, _kb: any, done: any) => {
        let sel = 0;
        const getItems = (): MenuItem[] => typeof itemsOrBuilder === "function" ? itemsOrBuilder() : itemsOrBuilder;
        let items = getItems();
        const comp = {
          render(width: number): string[] {
            const out: string[] = [];
            const w = Math.min(width, tui.visibleWidth?.() ?? width) - 1;
            const titleW = getStringWidth(title);
            out.push("┌─" + title + " " + "─".repeat(Math.max(0, w - 4 - titleW)) + "┐");

            // Process dynamic line wrapping
            const linesToDraw: { label: string; detail: string; isSel: boolean; isFirstLine: boolean }[] = [];
            items.forEach((it, idx) => {
              const isSel = idx === sel;
              const detailStr = it.detail ? "  " + it.detail : "";
              const detailW = getStringWidth(detailStr);
              // Visible label width should account for borders ("│ " and " │") and cursor ("▶ " or "  ")
              // Total box width is w. Left border: 2, cursor: 2, right border: 2. Plus detail width.
              const maxLabelW = w - 6 - detailW;
              const wrapped = wrapLine(it.label, maxLabelW);
              
              if (wrapped.length === 0) wrapped.push("");
              
              wrapped.forEach((wrappedLabel, subIdx) => {
                linesToDraw.push({
                  label: wrappedLabel,
                  detail: subIdx === wrapped.length - 1 ? it.detail || "" : "",
                  isSel,
                  isFirstLine: subIdx === 0
                });
              });
            });

            // Viewport scroll offsets for wrapped lines
            const maxVisibleLines = 10;
            if ((comp as any).scrollOffset === undefined) {
              (comp as any).scrollOffset = 0;
            }
            let scrollOffset = (comp as any).scrollOffset;

            const selLineIndices = linesToDraw.map((l, index) => l.isSel ? index : -1).filter(idx => idx !== -1);
            if (selLineIndices.length > 0) {
              const firstSel = selLineIndices[0];
              const lastSel = selLineIndices[selLineIndices.length - 1];
              
              if (lastSel >= scrollOffset + maxVisibleLines) {
                scrollOffset = lastSel - maxVisibleLines + 1;
              }
              if (firstSel < scrollOffset) {
                scrollOffset = firstSel;
              }
            }
            scrollOffset = Math.max(0, Math.min(scrollOffset, linesToDraw.length - maxVisibleLines));
            (comp as any).scrollOffset = scrollOffset;

            const start = scrollOffset;
            const end = Math.min(linesToDraw.length, start + maxVisibleLines);

            for (let i = start; i < end; i++) {
              const lineInfo = linesToDraw[i];
              const cursor = (lineInfo.isSel && lineInfo.isFirstLine) ? "▶ " : "  ";
              const line = cursor + lineInfo.label + (lineInfo.detail ? "  " + lineInfo.detail : "");
              const lineW = getStringWidth(line);
              const pad = Math.max(0, (w - 4) - lineW);
              out.push("│ " + line + " ".repeat(pad) + " │");
            }

            out.push("└" + "─".repeat(w - 2) + "┘");
            out.push((sel+1 + "/" + items.length + " 方向键选择 Enter确认 q退出").slice(0, w));
            return out;
          },
          handleInput(d: string) {
            if (d === "\x1b" || d === "q") { done(); return; }
            if (d === "\x1b[A" || d === "\x1bOA" || d === "k" || d === "w") sel = Math.max(0, sel - 1);
            else if (d === "\x1b[B" || d === "\x1bOB" || d === "j" || d === "s") sel = Math.min(items.length - 1, sel + 1);
            else if (d === "\r" || d === "\n") {
              const it = items[sel];
              if (it?.action) Promise.resolve(it.action(done)).then(() => { items = getItems(); sel = Math.min(sel, items.length-1); });
              else done();
            }
          },
          invalidate() {},
        };
        return comp;
      },
      { overlay: true }
    );
  }

  async function advanceTimeMinutes(mins: number, ctx: any, gs: any, save: any) {
    const { advanceMinutes } = await import("./engine/time.ts");
    const { updateNPCSchedules, refreshWeather } = await import("./engine/state.ts");
    if (gs.time.minute_of_day === undefined) gs.time.minute_of_day = 480;
    const result = advanceMinutes(gs.time, mins);
    gs.player.age = gs.time.player_age;
    gs.turn++;
    if (gs.turn % 4 === 0) refreshWeather();
    const events = updateNPCSchedules();
    save();
    
    const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
    ctx.ui.notify(`⏱️ 时间推进了 ${mins} 分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}`, "info");
    if (events.length > 0) {
      ctx.ui.notify(`📢 事件: ${events.join("; ")}`, "info");
    }
    updateChatHUD(ctx);
  }

  async function runNavigation(ctx: any, fastTravel = false) {
    const { gameState, saveState, isSameLocation } = await import("./engine/state.ts");
    const roomsData = (await import("./data/rooms.json", { with: { type: "json" } })).default as any;
    
    const doMove = async (to: string, mins: number, subDone: () => void, parentDone: () => void) => {
      if (!fastTravel && mins >= 15) {
        gameState.pendingTravel = {
          from: gameState.player.location,
          to,
          route: mins >= 30 ? "交通工具/长途" : "步行/短途",
          minutes: mins,
          timeOfDay: gameState.time.time_of_day
        };
        saveState();
        ctx.ui.notify(`[旅行中] 正在前往 ${to}，行程 ${mins} 分钟。引擎已暂停移动。`, "info");
        ctx.chat.addSystemMessage(`玩家已出发前往 ${to}，耗时约 ${mins} 分钟。不要立即让他们到达目的地！请描述他们在路上的见闻、风景、碰到的事件。等剧情差不多了，再调用 complete_travel 工具让他们到达目的地并扣除时间。`);
        updateChatHUD(ctx);
        pi.sendUserMessage(`我出发前往 ${to}。`);
      } else {
        await moveTo(to, ctx, gameState, saveState);
        await advanceTimeMinutes(mins, ctx, gameState, saveState);
        pi.sendUserMessage(`我来到了 ${to}。`);
      }
      subDone();
      parentDone();
    };
    
    let schoolMap: any = null;
    try {
      schoolMap = (await import("./data/school_map.json", { with: { type: "json" } })).default;
    } catch (_) {}

    let cityMap: any = null;
    try {
      cityMap = (await import("./data/city_map.json", { with: { type: "json" } })).default;
    } catch (_) {}

    const loc = gameState.player.location;
    const curRoom = roomsData[loc];

    const getRegion = (l: string) => {
      if (!cityMap || !cityMap.regions) return "";
      for (const [rn, r] of Object.entries(cityMap.regions) as [string, any][]) {
        if (r.landmarks?.some((lm: string) => isSameLocation(l, lm) || l.includes(lm) || lm.includes(l))) return rn;
        if (r.stations && Object.keys(r.stations).some(s => isSameLocation(l, s) || l.includes(s) || s.includes(l))) return rn;
      }
      return "";
    };

    const getTravelTime = (from: string, to: string) => {
      const curRoomFrom = roomsData[from];
      const destRoomTo = roomsData[to];
      if (curRoomFrom && destRoomTo && curRoomFrom.floor === destRoomTo.floor) {
        return 2;
      }
      const isSchool = (l: string) => {
        return l.includes("班") || l.includes("校") || l.includes("侍奉部") || l.includes("楼") || l.includes("中庭") || l.includes("操场") || l.includes("体育馆");
      };
      if (isSchool(from) && isSchool(to)) {
        return 5;
      }
      const fromReg = getRegion(from);
      const toReg = getRegion(to);
      if (fromReg && toReg) {
        if (fromReg === toReg) return 15;
        return 30;
      }
      return 15;
    };

    const buildSameFloorMenu = (parentDone: () => void) => {
      const sameFloorItems: MenuItem[] = [];
      const floor = curRoom?.floor ?? 0;
      
      for (const [name, room] of Object.entries(roomsData)) {
        if ((room as any).floor !== floor) continue;
        const here = isSameLocation(loc, name);
        const npcs = Object.entries(gameState.npcs)
          .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, name))
          .map(([n]) => n);
        
        sameFloorItems.push({
          label: `  🚪 ${name}`,
          detail: (here ? "📍当前 " : "") + (npcs.length > 0 ? "👥 " + npcs.join(" ") : ""),
          action: here ? undefined : async (subDone) => {
            await doMove(name, 2, subDone, parentDone);
          }
        });
      }
      if (sameFloorItems.length === 0) {
        sameFloorItems.push({ label: "  （无同楼层可用房间）" });
      }
      return sameFloorItems;
    };

    const buildSchoolMenu = (parentDone: () => void) => {
      const schoolItems: MenuItem[] = [];
      if (!schoolMap) {
        schoolItems.push({ label: "  （无学校地图数据）" });
        return schoolItems;
      }
      
      const added = new Set<string>();

      for (const [bname, bld] of Object.entries(schoolMap.buildings)) {
        const b = bld as any;
        if (b.rooms) {
          for (const [fName, rl] of Object.entries(b.rooms)) {
            for (const r of rl as string[]) {
              if (added.has(r)) continue;
              added.add(r);
              const here = isSameLocation(loc, r);
              const npcs = Object.entries(gameState.npcs)
                .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, r))
                .map(([n]) => n);
              
              schoolItems.push({
                label: `  🏫 ${r}`,
                detail: `${bname} ${fName}` + (here ? " 📍当前" : "") + (npcs.length > 0 ? " 👥 " + npcs.join(" ") : ""),
                action: here ? undefined : async (subDone) => {
                  await doMove(r, 5, subDone, parentDone);
                }
              });
            }
          }
        }
      }
      
      if (schoolMap.buildings["运动设施"]) {
        for (const r of schoolMap.buildings["运动设施"] as string[]) {
          if (added.has(r)) continue;
          added.add(r);
          const here = isSameLocation(loc, r);
          const npcs = Object.entries(gameState.npcs)
            .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, r))
            .map(([n]) => n);
          
          schoolItems.push({
            label: `  🏃 ${r}`,
            detail: "运动设施" + (here ? " 📍当前" : "") + (npcs.length > 0 ? " 👥 " + npcs.join(" ") : ""),
            action: here ? undefined : async (subDone) => {
              await doMove(r, 5, subDone, parentDone);
            }
          });
        }
      }
      if (schoolMap.buildings["其他建筑"]) {
        for (const r of schoolMap.buildings["其他建筑"] as string[]) {
          if (added.has(r)) continue;
          added.add(r);
          const here = isSameLocation(loc, r);
          const npcs = Object.entries(gameState.npcs)
            .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, r))
            .map(([n]) => n);
          
          schoolItems.push({
            label: `  🏫 ${r}`,
            detail: "其他区域" + (here ? " 📍当前" : "") + (npcs.length > 0 ? " 👥 " + npcs.join(" ") : ""),
            action: here ? undefined : async (subDone) => {
              await doMove(r, 5, subDone, parentDone);
            }
          });
        }
      }
      
      if (schoolItems.length === 0) {
        schoolItems.push({ label: "  （无可用校园地点）" });
      }
      return schoolItems;
    };

    const buildCityMenu = (parentDone: () => void) => {
      const cityItems: MenuItem[] = [];
      if (!cityMap) {
        cityItems.push({ label: "  （无城市地图数据）" });
        return cityItems;
      }

      const currentLoc = gameState.player.location;
      const regions = cityMap.regions || {};
      
      const stations: string[] = [];
      for (const reg of Object.values(regions) as any[]) {
        if (reg.stations) {
          stations.push(...Object.keys(reg.stations));
        }
      }
      
      const hubList = [
        ...stations,
        "校门",
        "千叶市立总武高等学校_校门",
        "住宅区",
        "千叶_住宅区",
        "自宅",
        "千叶_自宅",
        "高级公寓群"
      ];
      
      const isAtHub = hubList.some(hub => isSameLocation(currentLoc, hub));
      const hasVehicle = gameState.player.inventory.some((i: any) => i.name.includes("自行车") || i.name.includes("汽车"));
      const currentRegion = getRegion(currentLoc);

      for (const [rname, reg] of Object.entries(regions) as [string, any][]) {
        for (const l of (reg.landmarks || [])) {
          const here = isSameLocation(currentLoc, l);
          const known = gameState.player.known_locations || [];
          const isKnown = known.includes(l) || l.includes("站") || l.includes("总武高") || here;
          if (!isKnown) continue;

          const npcs = Object.entries(gameState.npcs)
            .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, l))
            .map(([n]) => n);

          cityItems.push({
            label: `  🚶 ${l}`,
            detail: `${rname}` + (here ? " 📍当前" : "") + (npcs.length > 0 ? " 👥 " + npcs.join(" ") : ""),
            action: here ? undefined : async (subDone) => {
              const toRegion = rname;
              const isCrossRegion = currentRegion && toRegion && currentRegion !== toRegion;
              if (isCrossRegion && !isAtHub && !hasVehicle) {
                ctx.ui.notify("❌ 无法远行: 必须处于交通枢纽(车站、大门、自宅)或拥有交通工具", "warning");
                return;
              }
              const mins = isCrossRegion ? 30 : 15;
              await doMove(l, mins, subDone, parentDone);
            }
          });
        }

        if (reg.stations) {
          for (const [sn, sd] of Object.entries(reg.stations) as [string, any][]) {
            const here = isSameLocation(currentLoc, sn);
            const npcs = Object.entries(gameState.npcs)
              .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, sn))
              .map(([n]) => n);

            cityItems.push({
              label: `  🚉 ${sn}`,
              detail: `${sd.lines?.join("/") || ""} ${rname}` + (here ? " 📍当前" : "") + (npcs.length > 0 ? " 👥 " + npcs.join(" ") : ""),
              action: here ? undefined : async (subDone) => {
                const toRegion = rname;
                const isCrossRegion = currentRegion && toRegion && currentRegion !== toRegion;
                if (isCrossRegion && !isAtHub && !hasVehicle) {
                  ctx.ui.notify("❌ 无法远行: 必须处于交通枢纽(车站、大门、自宅)或拥有交通工具", "warning");
                  return;
                }
                const mins = isCrossRegion ? 30 : 15;
                await doMove(sn, mins, subDone, parentDone);
              }
            });
          }
        }
      }
      
      if (cityItems.length === 0) {
        cityItems.push({ label: "  （无可用城市地点）" });
      }
      return cityItems;
    };

    const buildHistoryMenu = (parentDone: () => void) => {
      const historyItems: MenuItem[] = [];
      const known = gameState.player.known_locations || [];
      const currentLoc = gameState.player.location;

      const filteredKnown = known.filter(k => !isSameLocation(k, currentLoc));

      const regions = cityMap?.regions || {};
      const stations: string[] = [];
      for (const reg of Object.values(regions) as any[]) {
        if (reg.stations) {
          stations.push(...Object.keys(reg.stations));
        }
      }
      const hubList = [
        ...stations,
        "校门",
        "千叶市立总武高等学校_校门",
        "住宅区",
        "千叶_住宅区",
        "自宅",
        "千叶_自宅",
        "高级公寓群"
      ];
      const isAtHub = hubList.some(hub => isSameLocation(currentLoc, hub));
      const hasVehicle = gameState.player.inventory.some((i: any) => i.name.includes("自行车") || i.name.includes("汽车"));
      const currentRegion = getRegion(currentLoc);

      for (const k of filteredKnown) {
        const npcs = Object.entries(gameState.npcs)
          .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, k))
          .map(([n]) => n);

        historyItems.push({
          label: `  📌 ${k}`,
          detail: (npcs.length > 0 ? "👥 " + npcs.join(" ") : "已探索"),
          action: async (subDone) => {
            const toRegion = getRegion(k);
            const isCrossRegion = currentRegion && toRegion && currentRegion !== toRegion;
            if (isCrossRegion && !isAtHub && !hasVehicle) {
              ctx.ui.notify("❌ 无法远行: 必须处于交通枢纽(车站、大门、自宅)或拥有交通工具", "warning");
              return;
            }
            
            const mins = getTravelTime(currentLoc, k);
            await doMove(k, mins, subDone, parentDone);
          }
        });
      }

      if (historyItems.length === 0) {
        historyItems.push({ label: "  （暂无其他已知探索历史）" });
      }
      return historyItems;
    };

    const categories: MenuItem[] = [
      {
        label: "🏢 同层区域",
        detail: `楼层: F${curRoom?.floor ?? 0}`,
        action: async (parentDone) => {
          await showMenu(ctx, "🏢 选择同层房间", () => buildSameFloorMenu(parentDone));
        }
      },
      {
        label: "🏫 学校区域",
        detail: "校园建筑与运动设施",
        action: async (parentDone) => {
          await showMenu(ctx, "🏫 选择校园建筑", () => buildSchoolMenu(parentDone));
        }
      },
      {
        label: "🚉 城市远途",
        detail: "跨区商业与交通地标",
        action: async (parentDone) => {
          await showMenu(ctx, "🚉 选择城市远途", () => buildCityMenu(parentDone));
        }
      },
      {
        label: "📌 探索历史",
        detail: "已去过的历史地点",
        action: async (parentDone) => {
          await showMenu(ctx, "📌 选择探索历史", () => buildHistoryMenu(parentDone));
        }
      }
    ];

    await showMenu(ctx, "🗺️ 导航地图 (当前: " + gameState.player.location + ")", categories);
  }

  async function runStatus(ctx: any) {
    const { gameState, saveState, calcMaxCarry, calcCurrentWeight, isOverburdened } = await import("./engine/state.ts");
    const p = gameState.player;

    const maxC = calcMaxCarry(p.attributes.力量);
    const curW = calcCurrentWeight(p.inventory, p.equipment);
    const burden = isOverburdened(curW, maxC);

    const SLOT_NAMES: Record<string, string> = {
      inner_top: "内衣上",
      inner_bot: "内衣下",
      top: "外套上衣",
      bottom: "下装",
      legs: "袜子/丝袜",
      feet: "鞋子",
      head: "头部/发饰",
      acc: "配饰/挂件",
      left_hand: "副手/左手",
      right_hand: "主手/右手",
      back: "背部/背包"
    };

    const buildMenu = () => {
      const items: MenuItem[] = [];
      
      // 1. 玩家基本状态
      items.push({ label: `👤 角色: ${p.name} (${p.gender}) | 年龄: ${p.age}岁`, detail: "" });
      items.push({ label: `❤️ HP: ${p.hp.current}/${p.hp.max} | 🛡️ AC: ${p.ac} | 💰 资金: ¥${p.funds}`, detail: "" });
      items.push({ label: `🏋️ 负重: ${curW}/${maxC}kg${burden.overloaded ? " ⚠️超重!" : burden.encumbered ? " 📦较重" : ""}`, detail: "" });
      items.push({ label: `  💪 力量: ${p.attributes.力量.toString().padEnd(2)}  |  🧠 智力: ${p.attributes.智力}`, detail: "" });
      items.push({ label: `  🏃 敏捷: ${p.attributes.敏捷.toString().padEnd(2)}  |  👁️ 感知: ${p.attributes.感知}`, detail: "" });
      items.push({ label: `  🛡️ 体质: ${p.attributes.体质.toString().padEnd(2)}  |  ✨ 魅力: ${p.attributes.魅力}`, detail: "" });
      
      const woundStr = p.wounds && p.wounds.length > 0 
        ? p.wounds.map(w => `${w.severity}: ${w.text}`).join(", ")
        : "健康";
      items.push({ label: `🩸 伤势: ${woundStr}`, detail: "" });

      // 1.5 额外系统变量显示
      if (p.titles && p.titles.length > 0) {
        items.push({ label: `🏆 称号: ${p.titles.join(", ")}`, detail: "" });
      }
      const skillLines = Object.entries(p.skills || {})
        .filter(([_, s]) => s.level > 0)
        .map(([sName, s]) => `${sName}:Lv.${s.level}(${s.exp}/${s.nextLevel})`);
      if (skillLines.length > 0) {
        items.push({ label: `🎓 技能: ${skillLines.join("  ")}`, detail: "" });
      }
      const repLines = Object.entries(p.reputation || {})
        .filter(([_, val]) => val !== 0)
        .map(([gName, val]) => `${gName}:${val}`);
      if (repLines.length > 0) {
        items.push({ label: `🏅 声望: ${repLines.join("  ")}`, detail: "" });
      }
      
      // 2. 装备槽位
      items.push({ label: "── 装备槽位 (点击卸下) ──", detail: "" });
      for (const [slotKey, slotName] of Object.entries(SLOT_NAMES)) {
        const item = p.equipment[slotKey as any];
        if (item) {
          items.push({
            label: `  [${slotName}] ${item.name}`,
            detail: `🛡️ 卸下`,
            action: (_done) => {
              p.inventory.push(item);
              p.equipment[slotKey as any] = null;
              saveState();
              ctx.ui.notify(`卸下了 ${item.name}`, "info");
            }
          });
        } else {
          items.push({
            label: `  [${slotName}] (空)`,
            detail: `➕ 穿戴`,
            action: async (_done) => {
              const fitItems = p.inventory.filter(it => it.slot === slotKey);
              if (fitItems.length === 0) {
                ctx.ui.notify(`背包中没有适合该槽位的装备`, "warning");
                return;
              }
              await showMenu(ctx, `装备到 [${slotName}]`, fitItems.map(it => ({
                label: it.name,
                detail: `${it.type} ${it.weight}kg`,
                action: (subDone) => {
                  p.equipment[slotKey as any] = it;
                  p.inventory.splice(p.inventory.indexOf(it), 1);
                  saveState();
                  ctx.ui.notify(`装备了 ${it.name}`, "info");
                  subDone();
                }
              })));
            }
          });
        }
      }

      // 3. 背包物品
      items.push({ label: "── 背包物品 (点击查看/操作) ──", detail: "" });
      if (p.inventory.length > 0) {
        p.inventory.forEach(it => {
          items.push({
            label: `  ${it.name}`,
            detail: `${it.type} ${it.weight}kg`,
            action: async (_done) => {
              const subItems: MenuItem[] = [
                {
                  label: "🔍 查看详情",
                  action: (subDone) => {
                    const lines = [
                      `名称: ${it.name}`,
                      `类型: ${it.type} | 重量: ${it.weight}kg | 状态: ${it.state}`,
                      it.flavor ? `描述: ${it.flavor}` : "",
                      it.damage ? `伤害: ${it.damage.dice} (${it.damage.damageType})` : "",
                    ].filter(Boolean);
                    if (it.effects && it.effects.length > 0) {
                      lines.push("效果:");
                      it.effects.forEach((eff: any) => {
                        lines.push(`  - ${eff.type}: ${eff.value}${eff.group ? ` (${eff.group})` : ""}`);
                      });
                    }
                    showPanel(ctx, it.name, lines);
                    subDone();
                  }
                }
              ];

              if (it.slot) {
                const slotName = SLOT_NAMES[it.slot] || it.slot;
                subItems.push({
                  label: `🛡️ 装备到 [${slotName}]`,
                  action: (subDone) => {
                    const slot = it.slot as any;
                    if (p.equipment[slot]) p.inventory.push(p.equipment[slot]!);
                    p.equipment[slot] = it;
                    p.inventory.splice(p.inventory.indexOf(it), 1);
                    saveState();
                    ctx.ui.notify(`装备了 ${it.name}`, "info");
                    subDone();
                  }
                });
              }

              subItems.push({
                label: "❌ 丢弃物品",
                action: (subDone) => {
                  p.inventory.splice(p.inventory.indexOf(it), 1);
                  saveState();
                  ctx.ui.notify(`丢弃了 ${it.name}`, "info");
                  subDone();
                }
              });

              await showMenu(ctx, it.name, subItems);
            }
          });
        });
      } else {
        items.push({ label: "  （背包空空如也）", detail: "" });
      }

      // 4. 系统标志与引擎状态
      items.push({ label: "── ⚙️ 系统与引擎状态 ──", detail: "" });
      const activeFlags = Object.entries(gameState.flags)
        .filter(([_, v]) => v)
        .map(([k]) => k);
      items.push({
        label: `  [状态] 模式:${gameState.mode} | Layer1:${gameState.layer1Enabled ? "启用" : "禁用"} | 魔改:${gameState.auMode ? "启用" : "禁用"}`,
        detail: `回合:${gameState.turn}`
      });
      items.push({
        label: `  [天气] ${gameState.weather.type} (${gameState.weather.temp}°C)`,
        detail: `时间:${gameState.time.game_date}`
      });
      items.push({
        label: `  [标记] ${activeFlags.length > 0 ? activeFlags.join(", ") : "(空)"}`,
        detail: "🔍 查看详情",
        action: async (_done) => {
          const lines = [
            `当前世界模式: ${gameState.mode}`,
            `Layer1 亲密引擎: ${gameState.layer1Enabled ? "ON" : "OFF"}`,
            `魔改模式 (AU): ${gameState.auMode ? "ON" : "OFF"}`,
            `游戏总回合数: ${gameState.turn}`,
            `游戏当前时间: ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${gameState.time.time_of_day}`,
            `当前天气状况: ${gameState.weather.type} (${gameState.weather.temp}°C)`,
            ``,
            `所有已记录的世界/事件标记 (gameState.flags):`,
            ...Object.entries(gameState.flags).map(([k, v]) => `  - ${k}: ${v}`),
            Object.keys(gameState.flags).length === 0 ? "  （目前无任何事件标记）" : ""
          ].filter(Boolean);
          await showPanel(ctx, "⚙️ 系统与标记详情", lines);
        }
      });

      return items;
    };

    await showMenu(ctx, `👤 状态与装备`, buildMenu);
  }

  // ── Tools ──
  pi.registerTool({
    name: "lookup_character", label: "查角色",
    description: "查询角色属性、装备、技能、身体数据。",
    parameters: Type.Object({ name: Type.String({ description: "角色名" }) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { allChars } = await import("./engine/router.ts");
      const { getBodyForAge, getNpcCurrentAge } = await import("./engine/state.ts");
      const c = allChars.find((x: any) => x.name === params.name);
      if (!c) return { content: [{ type: "text", text: "无此角色" }], details: {} };
      const age = getNpcCurrentAge(c.base_age || 16);
      const aged = { ...c, body: getBodyForAge(c, age) };
      return { content: [{ type: "text", text: JSON.stringify(aged, null, 2) }], details: { character: aged } };
    },
  });

  pi.registerTool({
    name: "lookup_region", label: "查地区",
    description: "查询当前位置关联的作品和角色。",
    parameters: Type.Object({ location: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { lookupRegion } = await import("./engine/router.ts");
      const r = lookupRegion(params.location);
      return { content: [{ type: "text", text: `地区: ${r.matched_regions.join("、")}\n角色: ${r.all_characters.join("、")}` }], details: r };
    },
  });

  pi.registerTool({
    name: "dice_roll", label: "骰子",
    description: "d20检定。传入难度、属性值、技能等级。",
    parameters: Type.Object({ difficulty: Type.String(), attribute: Type.Number(), skillLv: Type.Number(), advantage: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { check } = await import("./engine/dice.ts");
      const r = check(params.difficulty as any, params.attribute, params.skillLv, (params.advantage as any) || "平");
      return { content: [{ type: "text", text: `${r.outcome} (${r.roll.kept}+${r.roll.mod}=${r.roll.total} vs DC${r.roll.dc})` }], details: r };
    },
  });

  pi.registerTool({
    name: "get_status", label: "状态",
    description: "获取玩家或NPC的HP/属性/位置。",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, getBodyForAge, getNpcCurrentAge } = await import("./engine/state.ts");
      if (params.name === gameState.player.name || params.name === "玩家") {
        return { content: [{ type: "text", text: JSON.stringify(gameState.player, null, 2) }], details: { character: gameState.player } };
      }
      const { allChars } = await import("./engine/router.ts");
      const c = allChars.find((x: any) => x.name === params.name);
      if (!c) return { content: [{ type: "text", text: "无此角色" }], details: {} };
      const age = getNpcCurrentAge(c.base_age || 16);
      const body = getBodyForAge(c, age);
      return { content: [{ type: "text", text: JSON.stringify({ name: c.name, location: c.default_location, attributes: c.attributes, skills: c.skills, hp: c.hp, body: body ? `${body.height_cm}cm ${body.cup||""}` : "" }, null, 2) }], details: {} };
    },
  });

  // ── 物品转移（替换 patch_state give_item/take_item）──
  pi.registerTool({
    name: "transfer_item", label: "转移物品/金钱",
    description: "将物品或金钱从一方转移到另一方。from/to 为角色名或'玩家'。item='金钱:500'→转账；否则转移物品。",
    parameters: Type.Object({
      from: Type.String({ description: "物品来源：角色名 或 '玩家'" }),
      to: Type.String({ description: "物品去向：角色名 或 '玩家'" }),
      item: Type.String({ description: "物品名，或'金钱:数字'转账" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("./engine/state.ts");
      const p = gameState.player;

      // 特殊格式: "金钱:500" → 转账
      const moneyMatch = params.item.match(/^金钱[:：](\d+)$/);
      if (moneyMatch) {
        const amount = parseInt(moneyMatch[1], 10);
        if (amount <= 0) return { content: [{ type: "text", text: "转账金额必须大于0。" }], details: {} };

        const fromIsPlayer = params.from === "玩家" || params.from === p.name;
        const toIsPlayer = params.to === "玩家" || params.to === p.name;

        // 扣 from 方
        if (fromIsPlayer) {
          if (p.funds < amount) return { content: [{ type: "text", text: `玩家只有¥${p.funds}，不够转¥${amount}。` }], details: {} };
          p.funds -= amount;
        } else {
          const fromNpc = getOrCreateNPC(params.from);
          if (fromNpc.funds < amount) return { content: [{ type: "text", text: `${params.from}只有¥${fromNpc.funds}，不够转¥${amount}。` }], details: {} };
          fromNpc.funds -= amount;
        }

        // 加 to 方
        if (toIsPlayer) p.funds += amount;
        else getOrCreateNPC(params.to).funds += amount;

        saveState();
        return { content: [{ type: "text", text: `${params.from} → ${params.to}: ¥${amount}` }], details: {} };
      }

      // 原有物品转移逻辑
      const fromIsPlayer = params.from === "玩家" || params.from === p.name;
      const fromInventory: any[] = fromIsPlayer ? p.inventory : getOrCreateNPC(params.from).inventory;
      const fromEquipment: any = fromIsPlayer ? p.equipment : getOrCreateNPC(params.from).equipment;

      // 在背包找
      let idx = fromInventory.findIndex((i: any) => i.name === params.item);
      if (idx >= 0) {
        const item = fromInventory.splice(idx, 1)[0];
        // 放入 to 方
        const toIsPlayer = params.to === "玩家" || params.to === p.name;
        if (toIsPlayer) p.inventory.push(item);
        else getOrCreateNPC(params.to).inventory.push(item);
        saveState();
        return { content: [{ type: "text", text: `${params.from} → ${params.to}: ${params.item}` }], details: {} };
      }

      // 在装备槽找
      for (const [slot, item] of Object.entries(fromEquipment)) {
        if (item && (item as any).name === params.item) {
          fromEquipment[slot as any] = null;
          const toIsPlayer = params.to === "玩家" || params.to === p.name;
          if (toIsPlayer) p.inventory.push(item as any);
          else getOrCreateNPC(params.to).inventory.push(item as any);
          saveState();
          return { content: [{ type: "text", text: `${params.from} → ${params.to}: ${params.item}（从装备槽卸下）` }], details: {} };
        }
      }

      return { content: [{ type: "text", text: `${params.from}没有${params.item}` }], details: {} };
    },
  });

  // ── 关系调整（替换 patch_state add_affection）──
  pi.registerTool({
    name: "adjust_relation", label: "调整关系",
    description: "因剧情互动调整好感度。单次上限±20，自动0-100 clamp。reason 写入关系备注。正值会同步提升该NPC的欲望值。",
    parameters: Type.Object({
      npc: Type.String({ description: "NPC 名称" }),
      delta: Type.Number({ description: "好感变化量，范围 [-20, 20]" }),
      reason: Type.String({ description: "变化原因，如'聊得很投机'、'偷窃被抓'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { updateRelation, gameState, saveState, getOrCreateSexState } = await import("./engine/state.ts");
      const delta = Math.max(-20, Math.min(20, params.delta));
      const p = gameState.player;

      updateRelation(p.relationships, params.npc, delta, params.reason);
      let r = `${params.npc} 好感${delta > 0 ? "+" : ""}${delta}（${params.reason}）`;

      if (delta !== 0) {
        try {
          const sState = await getOrCreateSexState(params.npc);
          if (sState) {
            const desireDelta = Math.max(1, Math.round(Math.abs(delta) * 0.5));
            if (delta > 0) {
              sState.desire = Math.min(100, sState.desire + desireDelta);
              r += `，欲望+${desireDelta}`;
            } else {
              sState.desire = Math.max(0, sState.desire - desireDelta);
              r += `，欲望-${desireDelta}`;
            }
          }
        } catch (_) {}
      }

      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  // ── 技能成长（替换 patch_state add_skill_exp）──
  pi.registerTool({
    name: "grant_skill_exp", label: "技能成长",
    description: "因学习/训练/实战获得技能经验。单次上限5 EXP。走引擎升级公式（Lv×10 升一级）。",
    parameters: Type.Object({
      skill: Type.String({ description: "技能名，如'格斗'、'潜行'" }),
      amount: Type.Number({ description: "经验值，1-5" }),
      reason: Type.String({ description: "获得原因，如'平冢静指导格斗训练'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { addSkillExp, gameState, saveState } = await import("./engine/state.ts");
      const amount = Math.max(1, Math.min(5, params.amount));
      const before = gameState.player.skills[params.skill]?.level ?? 0;
      addSkillExp(gameState.player.skills, params.skill, amount);
      const after = gameState.player.skills[params.skill]?.level ?? 0;
      const leveledUp = after > before ? ` → Lv${after}!` : "";
      saveState();
      return { content: [{ type: "text", text: `${params.skill} +${amount}EXP（${params.reason}）${leveledUp}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "init_game", label: "初始化游戏",
    description: "新开局或重新开始时初始化玩家数据。重置除玩家设定外的所有状态。",
    parameters: Type.Object({
      name: Type.String({ description: "玩家姓名" }),
      gender: Type.String({ description: "玩家性别，男/女" }),
      age: Type.Number({ description: "起始年龄，例如6" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, resetState, saveState, setPlayerLocation, initPlayerGrid } = await import("./engine/state.ts");
      // 重置状态
      resetState();
      
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
      gameState.time.timeline_origin.year = 2018 - (16 - params.age); // 出生年恒为 2002；例 age=6→year=2008，age=16→year=2018
      // 校准游戏日期与时间线年份一致（否则 age=6 时 game_date 仍是 2018，时间推进即跳龄）
      gameState.time.game_date = `${gameState.time.timeline_origin.year}-04-07`;
      // 用 getLifeStage 统一计算（不用硬编码中文标签）
      const { getLifeStage } = await import("./engine/time.ts");
      gameState.time.player_stage = getLifeStage(params.age);
      
      // 重置起始地点
      setPlayerLocation("千叶_住宅区");
      initPlayerGrid();
      
      saveState();
      return { content: [{ type: "text", text: `游戏已初始化：玩家 ${params.name}（${params.gender}，${params.age}岁）` }], details: {} };
    }
  });

  pi.registerTool({
    name: "commit_turn", label: "推进时间",
    description: "推进游戏时间（分钟）。下课/放学/等待时调用。",
    parameters: Type.Object({ minutes: Type.Number() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState, updateNPCSchedules, refreshWeather } = await import("./engine/state.ts");
      const { advanceMinutes } = await import("./engine/time.ts");
      const mins = params.minutes;
      // 初始化 legacy session 没有 minute_of_day
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      const result = advanceMinutes(gameState.time, mins);
      // 同步玩家年龄（time.player_age → player.age），确保 NPC 年龄同步
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      if (gameState.turn % 4 === 0) refreshWeather();
      const events = updateNPCSchedules();
      saveState();
      const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
      return { content: [{ type: "text", text: `时间推进 ${mins}分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}。${events.length > 0 ? events.join("; ") : "无特殊事件"}` }], details: { time: gameState.time, events } };
    },
  });

  pi.registerTool({
    name: "set_flags", label: "IF开关",
    description: "设世界标记：tachibanaIF(橘家), osanaIF(青梅)等。",
    parameters: Type.Object({ flags: Type.Record(Type.String(), Type.Union([Type.Boolean(), Type.String()])) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      for (const [k, v] of Object.entries(params.flags)) gameState.flags[k] = v;
      saveState();
      return { content: [{ type: "text", text: "flags: " + JSON.stringify(gameState.flags) }], details: {} };
    },
  });

  pi.registerTool({
    name: "toggle_layer1", label: "Layer1",
    description: "开关性欲模块。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _o, _ctx) {
      const { toggleLayer1, gameState } = await import("./engine/state.ts");
      const on = toggleLayer1(gameState);
      return { content: [{ type: "text", text: on ? "Layer1 on" : "Layer1 off" }], details: {} };
    },
  });

  pi.registerTool({
    name: "toggle_aumode", label: "魔改",
    description: "开关魔改模式（AU角色可见）。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      gameState.auMode = !gameState.auMode; saveState();
      return { content: [{ type: "text", text: gameState.auMode ? "魔改 on" : "魔改 off" }], details: {} };
    },
  });

  pi.registerTool({
    name: "sex_touch", label: "触碰",
    description: "sex模式触碰部位：唇/颈/胸/腰/腿/秘部/肛。",
    parameters: Type.Object({ 
      char: Type.String(), 
      part: Type.String(), 
      intensity: Type.String(),
      thoughts: Type.Optional(Type.Array(Type.String({ description: "此轮触碰产生的心里话（30字内/条）" })))
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateSexState } = await import("./engine/state.ts");
      if (!gameState.layer1Enabled) return { content: [{ type: "text", text: "Layer1未启用" }], details: {} };
      
      // 自动对齐或懒加载当前 SexState
      if (!gameState.player.sex || (gameState.player.sex.profile as any).name !== params.char) {
        const sState = await getOrCreateSexState(params.char);
        if (!sState) return { content: [{ type: "text", text: `无该角色sex档案: ${params.char}` }], details: {} };
        gameState.player.sex = sState;
      }

      const { SEX_PROFILES, touchBodyPart, checkClimax, triggerClimax, settleAfterSex, formatSettlement, recordThought } = await import("./engine/sex.ts");
      const p = SEX_PROFILES[params.char];
      if (!p) return { content: [{ type: "text", text: "无该角色sex档案" }], details: {} };
      
      const r = touchBodyPart(p, gameState.player.sex, params.part, params.intensity as any);

      // 防御旧存档 null 值
      if (gameState.player.sex.arousal == null) gameState.player.sex.arousal = 0;
      if (gameState.player.sex.climaxCount == null) gameState.player.sex.climaxCount = 0;
      if (gameState.player.sex.squirtCount == null) gameState.player.sex.squirtCount = 0;

      // Apply arousal change
      gameState.player.sex.arousal = Math.min(100, gameState.player.sex.arousal + r.arousalChange);
      
      // Track touched parts in gameState.flags
      const flagKey = `sex_parts_touched_${params.char}`;
      let touchedParts: string[] = [];
      if (gameState.flags[flagKey]) {
        try {
          touchedParts = JSON.parse(gameState.flags[flagKey] as string);
        } catch (_) {}
      }
      if (!touchedParts.includes(params.part)) {
        touchedParts.push(params.part);
      }
      gameState.flags[flagKey] = JSON.stringify(touchedParts);

      let textResult = `[${params.part}] ${r.reaction} arousal ${r.arousalChange >= 0 ? "+" : ""}${r.arousalChange} (当前兴奋度: ${gameState.player.sex.arousal}/100)`;
      let settlementReport: any = null;

      if (params.thoughts && params.thoughts.length > 0) {
        for (const t of params.thoughts) {
          recordThought(gameState.player.sex, t, gameState.time.game_date, checkClimax(gameState.player.sex) ? "climax_after" : "scene_end");
        }
      }

      // Check climax
      if (checkClimax(gameState.player.sex)) {
        triggerClimax(gameState.player.sex);
        textResult += `\n检测到高潮！${params.char}达到了高潮！`;
        
        // Settle sex session
        // 记录在 NPC 的 SexState 上，partner 是玩家名
        const report = settleAfterSex(gameState.player.sex, gameState.time.game_date, 30, touchedParts, [], gameState.player.name);
        settlementReport = report;
        
        // Format report and append to output
        const formatted = formatSettlement(report, params.char);
        textResult += formatted;
        
        // Clean up touched parts flag
        delete gameState.flags[flagKey];
      }

      saveState();
      return { content: [{ type: "text", text: textResult }], details: { touchResult: r, settlementReport } };
    },
  });

  pi.registerTool({
    name: "masturbate", label: "自慰",
    description: "自慰以增加兴奋度、消耗欲望。不传target=玩家自己；传NPC名=该NPC自慰（引擎减少其desire）。",
    parameters: Type.Object({
      char: Type.String({ description: "角色名" }),
      minutes: Type.Number({ description: "持续时间(分钟)" }),
      thoughts: Type.Optional(Type.Array(Type.String({ description: "此轮自慰产生的心里话（30字内/条）" }))),
      target: Type.Optional(Type.String({ description: "可选：自慰的NPC名。不传默认玩家自己" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState, getOrCreateSexState } = await import("./engine/state.ts");
      const { masturbate, settleAfterSex, formatSettlement, recordThought } = await import("./engine/sex.ts");
      const isNpc = params.target && params.target !== gameState.player.name && params.target !== "玩家";

      if (isNpc) {
        // NPC 自慰：消耗 NPC 自身欲望
        const sState = await getOrCreateSexState(params.target);
        if (!sState) return { content: [{ type: "text", text: `无${params.target}的sex档案` }], details: {} };
        if (sState.arousal == null) sState.arousal = 0;
        if (sState.climaxCount == null) sState.climaxCount = 0;
        if (sState.squirtCount == null) sState.squirtCount = 0;

        const r = masturbate(sState, params.minutes);
        // NPC 自慰 → 消耗积累的欲望（释放后欲望下降）
        sState.desire = Math.max(0, sState.desire - Math.round(r.arousalChange * 0.3));

        let textResult = `${params.target}进行了 ${params.minutes} 分钟的自慰。欲望 -${Math.round(r.arousalChange * 0.3)} (当前: ${sState.desire}/100)`;

        if (params.thoughts && params.thoughts.length > 0) {
          for (const t of params.thoughts) {
            recordThought(sState, t, gameState.time.game_date, r.climaxed ? "climax_after" : "scene_end");
          }
        }

        if (r.climaxed) {
          textResult += `\n${params.target}达到了高潮！`;
          const report = settleAfterSex(sState, gameState.time.game_date, params.minutes, ["秘部"], []);
          const formatted = formatSettlement(report, params.target);
          textResult += formatted;
        }

        saveState();
        return { content: [{ type: "text", text: textResult }], details: { masturbateResult: r } };
      }

      // === 玩家自慰（原有逻辑） ===
      // 自动对齐或懒加载当前 SexState
      if (!gameState.player.sex || (gameState.player.sex.profile as any).name !== params.char) {
        const sState = await getOrCreateSexState(params.char);
        if (!sState) return { content: [{ type: "text", text: `无该角色sex档案: ${params.char}` }], details: {} };
        gameState.player.sex = sState;
      }

      // 防御旧存档 null 值
      if (gameState.player.sex.arousal == null) gameState.player.sex.arousal = 0;
      if (gameState.player.sex.climaxCount == null) gameState.player.sex.climaxCount = 0;
      if (gameState.player.sex.squirtCount == null) gameState.player.sex.squirtCount = 0;

      let textResult = `${params.char}进行了 ${params.minutes} 分钟的自慰。兴奋度 +${r.arousalChange} (当前兴奋度: ${gameState.player.sex.arousal}/100)`;
      let settlementReport: any = null;

      if (params.thoughts && params.thoughts.length > 0) {
        for (const t of params.thoughts) {
          recordThought(gameState.player.sex, t, gameState.time.game_date, r.climaxed ? "climax_after" : "scene_end");
        }
      }

      if (r.climaxed) {
        textResult += `\n检测到高潮！${params.char}达到了高潮！`;
        const flagKey = `sex_parts_touched_${params.char}`;
        let touchedParts: string[] = ["秘部"];
        if (gameState.flags[flagKey]) {
          try {
            touchedParts = JSON.parse(gameState.flags[flagKey] as string);
          } catch (_) {}
        }
        if (!touchedParts.includes("秘部")) {
          touchedParts.push("秘部");
        }
        // 自慰不传 partnerName，不计入初体验
        const report = settleAfterSex(gameState.player.sex, gameState.time.game_date, params.minutes, touchedParts, []);
        settlementReport = report;
        const formatted = formatSettlement(report, params.char);
        textResult += formatted;
        delete gameState.flags[flagKey];
      }

      saveState();
      return { content: [{ type: "text", text: textResult }], details: { masturbateResult: r, settlementReport } };
    },
  });

  // combat, steal, equip, build, move, door_toggle, reputation, schedule, economy
  pi.registerTool({
    name: "combat_action", label: "战斗",
    description: "攻击/防御/逃跑/死亡豁免。action: attack/defend/flee/death_save。actor 可选，默认玩家；设为 NPC 名则 NPC 发动攻击（target 应为'玩家'）。",
    parameters: Type.Object({
      action: Type.String({ description: "attack / defend / flee / death_save" }),
      target: Type.Optional(Type.String({ description: "目标名，attack/flee 时需要" })),
      actor: Type.Optional(Type.String({ description: "行动者，默认玩家。设为 NPC 名则 NPC 执行该动作" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC, damageItem } = await import("./engine/state.ts");
      const { resolveAttack, defend, attemptFlee, makeDeathSave, getRoundSummary } = await import("./engine/combat.ts");
      const allChars = (await import("./engine/router.ts")).allChars;
      const p = gameState.player;

      // Helper: 构建 NPC 战斗状态
      const buildNPCCombatant = (name: string) => {
        const npc = getOrCreateNPC(name);
        const src = allChars.find((c: any) => c.name === name);
        const npcState = {
          ...structuredClone(p),
          name,
          attributes: src?.attributes || { 力量:5,敏捷:5,体质:5,智力:5,感知:5,魅力:5 },
          skills: src?.skills || {},
          hp: src?.hp ? { ...src.hp } : { current: 10, max: 10 },
          ac: src?.ac || 10,
          equipment: npc.equipment || {},
        };
        return { name, state: npcState, cover: "无掩体" as any };
      };

      const playerCombatant = { name: p.name, state: p, cover: "无掩体" as any };
      const isNPC = params.actor && params.actor !== "玩家" && params.actor !== p.name;

      let r = "";
      if (params.action === "attack" && params.target) {
        const attacker = isNPC ? buildNPCCombatant(params.actor!) : playerCombatant;
        const defenderName = isNPC ? params.target : params.target;
        const defender = (defenderName === "玩家" || defenderName === p.name)
          ? playerCombatant
          : buildNPCCombatant(defenderName);

        const attackerEquip = isNPC ? (buildNPCCombatant(params.actor!).state as any).equipment : p.equipment;
        const weapon = Object.values(isNPC ? attackerEquip : p.equipment).find((w: any) => w?.damage)
          || { name: "拳头", damage: { dice: "1d2", damageType: "钝击" }, type: "weapon", slot: "right_hand", weight: 0, effects: [], state: "intact" };

        const result = resolveAttack(attacker, defender, weapon as any);
        r = result.narrative;

        // 实际伤害写入目标 HP
        if (result.hit && result.damage) {
          if (defender === playerCombatant) {
            p.hp.current = Math.max(0, p.hp.current - result.damage);
          }
        }

        // 玩家死亡检查
        if (p.hp.current <= 0) {
          p.alive = false;
          r += `\n⚠️ ${p.name}倒下了！需要死亡豁免检定（使用 death_save 行动）。3次成功=稳定，3次失败=死亡。`;
        }
      } else if (params.action === "death_save") {
        if (p.alive) { r = "你还活着，不需要死亡豁免。"; }
        else {
          const ds = makeDeathSave(p);
          r = ds.narrative;
          if (ds.nat20) { p.alive = true; p.hp.current = 1; r += ` ${p.name}恢复了意识！HP=1。`; }
          else if (ds.nat1) { r += ` 这是第1次失败……`; }
        }
      } else if (params.action === "defend") {
        r = defend(playerCombatant);
        r += `\n[HP] ${p.name}:${p.hp.current}/${p.hp.max}`;
      } else if (params.action === "flee") {
        const npcName = params.target || Object.keys(gameState.npcs)[0];
        if (!npcName) { r = "没有敌人可逃跑"; }
        else {
          const npcCombatant = buildNPCCombatant(npcName);
          r = attemptFlee(playerCombatant, npcCombatant).narrative;
        }
      } else r = "无效战斗动作";
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "steal_item", label: "偷窃",
    description: "从NPC偷物品或金钱。item='金钱'→摸钱包（随机偷部分现金）；其他→偷物品。失败（caught=true）→ 引擎自动扣除好感-20、写入 alert 标记。",
    parameters: Type.Object({ target: Type.String(), item: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, stealItem, stealFunds, saveState, updateRelation, updateReputation } = await import("./engine/state.ts");

      // 特殊：偷钱
      if (params.item === "金钱" || params.item === "钱") {
        const r = stealFunds(gameState.player, params.target);
        let consequence = "";
        if (r.caught) {
          updateRelation(gameState.player.relationships, params.target, -20, "偷钱被抓");
          consequence += `\n⚠️ ${params.target}好感-20`;
          gameState.flags.steal_alert = true;
          gameState.flags[`steal_caught_by_${params.target}`] = true;
          const loc = gameState.player.location;
          if (loc.includes("校") || loc.includes("班")) { updateReputation("学生", -1); consequence += `，学生声望-1`; }
          if (loc.includes("校门") || loc.includes("警")) { gameState.flags.wanted = true; consequence += `，被通报！`; }
        }
        saveState();
        return { content: [{ type: "text", text: r.narrative + consequence }], details: { ...r, flags_set: consequence } };
      }

      const r = stealItem(gameState.player, params.target, params.item);
      let consequence = "";

      if (r.caught) {
        // 自动关系惩罚
        updateRelation(gameState.player.relationships, params.target, -20, "偷窃被抓");
        consequence += `\n⚠️ ${params.target}好感-20`;

        // 写入 alert 标记
        gameState.flags.steal_alert = true;
        gameState.flags[`steal_caught_by_${params.target}`] = true;

        // 在校内 → 更新学生声望
        const loc = gameState.player.location;
        if (loc.includes("校") || loc.includes("班")) {
          updateReputation("学生", -1);
          consequence += `，学生声望-1`;
        }

        // 在校门口/有警卫的地方 → 更严重
        if (loc.includes("校门") || loc.includes("警")) {
          gameState.flags.wanted = true;
          consequence += `，被通报！`;
        }
      }

      saveState();
      return { content: [{ type: "text", text: r.narrative + consequence }], details: { ...r, flags_set: consequence } };
    },
  });

  pi.registerTool({
    name: "equip_item", label: "装备",
    description: "装备物品到指定槽位，或卸下物品。",
    parameters: Type.Object({ item: Type.String(), slot: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      const p = gameState.player;
      if (params.slot) {
        // 装备：从背包找到物品 → 放到指定槽位
        const idx = p.inventory.findIndex((i: any) => i.name === params.item);
        if (idx < 0) return { content: [{ type: "text", text: `背包里没有${params.item}` }], details: {} };
        const item = p.inventory[idx];
        const slot = params.slot as any;
        // 如果槽位已有装备，先卸到背包
        if (p.equipment[slot]) p.inventory.push(p.equipment[slot]!);
        p.equipment[slot] = item;
        p.inventory.splice(idx, 1);
        saveState();
        return { content: [{ type: "text", text: `装备了${params.item} → ${params.slot}` }], details: {} };
      } else {
        // 卸下：从装备槽找到物品 → 放回背包
        for (const [s, it] of Object.entries(p.equipment)) {
          if (it && it.name === params.item) {
            p.inventory.push(it);
            p.equipment[s as any] = null;
            saveState();
            return { content: [{ type: "text", text: `卸下了${params.item}` }], details: {} };
          }
        }
        return { content: [{ type: "text", text: `没有装备${params.item}` }], details: {} };
      }
    },
  });

  pi.registerTool({
    name: "move", label: "棋盘移动",
    description: "棋盘格移动。方向：北/南/东/西",
    parameters: Type.Object({ direction: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { movePlayer, saveState } = await import("./engine/state.ts");
      const r = movePlayer(params.direction);
      saveState();
      return { content: [{ type: "text", text: `${r.success ? "移动" : "阻挡"}: ${r.reason}` }], details: r };
    },
  });

  pi.registerTool({
    name: "move_to", label: "前往",
    description: "直接移动到棋盘坐标（同一房间内）。",
    parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getRoom, gameState, saveState } = await import("./engine/state.ts");
      const room = getRoom(gameState.player.location);
      if (!room) return { content: [{ type: "text", text: "当前位置没有地图" }], details: {} };
      const { x, y } = params;
      if (x < 0 || x >= room.width || y < 0 || y >= room.height)
        return { content: [{ type: "text", text: "坐标超出房间范围" }], details: {} };
      const cell = room.cells[y][x];
      if (cell.type === "wall") return { content: [{ type: "text", text: "那是墙壁" }], details: {} };
      if (cell.block) return { content: [{ type: "text", text: cell.furniture ? `被${cell.furniture}挡住了` : "过不去" }], details: {} };
      gameState.player.gridPos = [x, y];
      saveState();
      return { content: [{ type: "text", text: `移动到 (${x},${y})` }], details: {} };
    },
  });

  pi.registerTool({
    name: "world_interact", label: "世界交互",
    description:
      "建造/拆除/开关门。引擎内部处理坐标和校验。\n" +
      "action: place(放置家具) / remove(拆除) / build_wall(造墙) / remove_wall(拆墙) / toggle_door(开关门)\n" +
      "item: 物品名（place时必需，必须在背包里）\n" +
      "material: 材料名（build_wall时必需，必须在背包里）\n" +
      "  remove_wall时可指定工具名，不指定则需玩家力量≥5",
    parameters: Type.Object({
      action: Type.String({ description: "place / remove / build_wall / remove_wall / toggle_door" }),
      item: Type.Optional(Type.String({ description: "物品名（place时必需）" })),
      material: Type.Optional(Type.String({ description: "材料或工具名" })),
      description: Type.Optional(Type.String({ description: "放置位置描述，如'靠窗'、'门边'" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getRoom, placeFurniture, removeFurniture, editCellType, toggleDoor } = await import("./engine/state.ts");
      const p = gameState.player;
      if (!p.gridPos) {
        return { content: [{ type: "text", text: "当前玩家没有网格坐标，无法进行网格交互" }], details: {} };
      }
      const room = getRoom(p.location);
      if (!room) {
        return { content: [{ type: "text", text: `当前位置 ${p.location} 没有地图格，无法进行网格交互` }], details: {} };
      }

      const [px, py] = p.gridPos;
      const directions = [
        { dx: 0, dy: -1, label: "北" },
        { dx: 0, dy: 1, label: "南" },
        { dx: -1, dy: 0, label: "西" },
        { dx: 1, dy: 0, label: "东" }
      ];

      const targets = [];
      for (const dir of directions) {
        const nx = px + dir.dx;
        const ny = py + dir.dy;
        if (nx >= 0 && nx < room.width && ny >= 0 && ny < room.height) {
          targets.push({ x: nx, y: ny, cell: room.cells[ny][nx], dir: dir.label });
        }
      }

      let matched = null;
      if (params.action === "place") {
        if (!params.item) {
          return { content: [{ type: "text", text: "参数错误: place 动作需要指定 item" }], details: {} };
        }
        const hasItem = p.inventory.some((i: any) => i.name === params.item);
        if (!hasItem) {
          return { content: [{ type: "text", text: `背包里没有 ${params.item}，无法放置` }], details: {} };
        }
        matched = targets.find(t => t.cell.type === "floor" && !t.cell.furniture);
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有空地可以放置家具" }], details: {} };
        }
        const r = placeFurniture(matched.x, matched.y, params.item);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}` }], details: r };

      } else if (params.action === "remove") {
        matched = targets.find(t => t.cell.furniture);
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以拆除的家具" }], details: {} };
        }
        const r = removeFurniture(matched.x, matched.y);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}` }], details: r };

      } else if (params.action === "build_wall") {
        if (!params.material) {
          return { content: [{ type: "text", text: "参数错误: build_wall 动作需要指定 material" }], details: {} };
        }
        const hasMaterial = p.inventory.some((i: any) => i.name === params.material);
        if (!hasMaterial) {
          return { content: [{ type: "text", text: `背包里没有 ${params.material}，无法建造` }], details: {} };
        }
        matched = targets.find(t => t.cell.type === "floor" && !t.cell.furniture);
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以建墙的地板" }], details: {} };
        }
        const r = editCellType(matched.x, matched.y, "wall", undefined, params.material);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}` }], details: r };

      } else if (params.action === "remove_wall") {
        matched = targets.find(t => t.cell.type === "wall");
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以拆除的墙壁" }], details: {} };
        }
        const r = editCellType(matched.x, matched.y, "floor", undefined, params.material);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}` }], details: r };

      } else if (params.action === "toggle_door") {
        matched = targets.find(t => t.cell.type === "door" || t.cell.type === "exit");
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以开关的门" }], details: {} };
        }
        const r = toggleDoor(matched.x, matched.y);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y})的门: ${r.reason}` }], details: r };

      } else {
        return { content: [{ type: "text", text: `未知动作: ${params.action}` }], details: {} };
      }
    },
  });

  pi.registerTool({
    name: "settle_scene", label: "场景收口",
    description:
      "一场戏结束时的统一收口。推进时间、更新 NPC 日程、写入记忆标签。\n" +
      "替代手动调用 commit_turn + add_memory_tag 的组合。",
    parameters: Type.Object({
      summary: Type.String({ description: "本场景发生的事，如'在侍奉部和雪乃聊了一下午'" }),
      elapsed_minutes: Type.Number({ description: "经过的分钟数" }),
      memory_tags: Type.Optional(Type.Array(Type.Object({
        target: Type.String({ description: "NPC 名" }),
        tag: Type.String({ description: "记忆标签，如'接受了维的帮助'" }),
      }))),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, updateNPCSchedules, refreshWeather, addMemoryTag } = await import("./engine/state.ts");
      const { advanceMinutes } = await import("./engine/time.ts");
      const mins = params.elapsed_minutes;
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      const result = advanceMinutes(gameState.time, mins);
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      if (gameState.turn % 4 === 0) refreshWeather();
      const events = updateNPCSchedules();

      if (params.memory_tags && params.memory_tags.length > 0) {
        for (const m of params.memory_tags) {
          addMemoryTag(m.target, m.tag, 7);
        }
      }

      saveState();

      const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
      const textResult = `场景结束推进了 ${mins}分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}。\n` +
        `日程更新: ${events.length > 0 ? events.join("; ") : "无特殊事件"}\n` +
        `写入记忆: ${params.memory_tags && params.memory_tags.length > 0 ? params.memory_tags.map(m => `${m.target}(${m.tag})`).join(", ") : "无"}`;
      return { content: [{ type: "text", text: textResult }], details: { time: gameState.time, events, memory_tags: params.memory_tags } };
    },
  });

  pi.registerTool({
    name: "create_room", label: "创建房间",
    description: "在地图中创建一个新的房间区域。",
    parameters: Type.Object({ name: Type.String(), width: Type.Number(), height: Type.Number(), floor: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createRoom } = await import("./engine/state.ts");
      const r = await createRoom(params.name, params.width, params.height, params.floor);
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  });

  pi.registerTool({
    name: "update_reputation", label: "声望",
    description: "更新玩家在特定圈子的声望。",
    parameters: Type.Object({ group: Type.String(), delta: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      const g = params.group, d = params.delta;
      if (!gameState.player.reputation[g]) gameState.player.reputation[g] = 0;
      gameState.player.reputation[g] += d;
      saveState();
      return { content: [{ type: "text", text: `${g}声望 ${d >= 0 ? "+" : ""}${d} → ${gameState.player.reputation[g]}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "schedule_override", label: "日程覆盖",
    description: "临时覆盖NPC日程（生病/约定/逃课等）。",
    parameters: Type.Object({ npc: Type.String(), location: Type.String(), action: Type.String(), reason: Type.String(), until: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getOrCreateNPC, saveState } = await import("./engine/state.ts");
      const npc = getOrCreateNPC(params.npc);
      npc.pendingOverride = { location: params.location, action: params.action, reason: params.reason, expiresAt: params.until || "2099-12-31" };
      saveState();
      return { content: [{ type: "text", text: `${params.npc} 日程覆盖: ${params.location} (${params.reason})` }], details: {} };
    },
  });

  pi.registerTool({
    name: "buy_item", label: "购买",
    description: "从商店购买物品。LLM 根据市场常识定价，引擎校验价格范围。",
    parameters: Type.Object({ item: Type.String(), price: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { buyItem } = await import("./engine/state.ts");
      const r = buyItem(params.item, params.price);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "identity_check", label: "身份检定",
    description: "遇到强检查（如警察、保安）时，进行身份检定（通常使用魅力或隐藏技能）。",
    parameters: Type.Object({
      difficulty: Type.String({ description: "简单/普通/困难/极难/不可能" }),
      skillLevel: Type.Optional(Type.Number({ description: "玩家相关伪装或欺瞒技能等级" }))
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, updateReputation } = await import("./engine/state.ts");
      const { identityCheck } = await import("./engine/dice.ts");
      const r = identityCheck(params.difficulty as any, gameState.player.attributes.魅力, params.skillLevel || 0);
      let text = `[身份检定] 难度: ${params.difficulty} | 检定值: ${r.roll.total} vs DC ${r.roll.dc}\n`;

      if (r.success) {
        text += "✅ 检定成功，身份未被识破。";
      } else {
        text += "❌ 检定失败！身份被识破！";
        gameState.flags.identity_exposed = true;

        // 根据所在区域自动施加后果
        const loc = gameState.player.location;
        if (loc.includes("校") || loc.includes("班")) {
          updateReputation("学生", -1);
          text += `\n⚠️ 学生声望-1`;
        }
        if (loc.includes("校门") || loc.includes("警") || loc.includes("站") || loc.includes("厅")) {
          gameState.flags.wanted = true;
          text += `\n⚠️ 已被通报追查！`;
        }
        if (gameState.player.public_identity) {
          text += `\n⚠️ 伪装身份「${gameState.player.public_identity}」被识破`;
          gameState.player.public_identity = undefined;
        }
      }

      saveState();
      return { content: [{ type: "text", text }], details: { roll: r.roll } };
    },
  });

  pi.registerTool({
    name: "sell_item", label: "出售",
    description: "出售物品给NPC。LLM 根据市场常识定价，引擎校验价格范围。若指定 buyer，引擎校验对方资金并扣款。",
    parameters: Type.Object({ item: Type.String(), price: Type.Number(), buyer: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { sellItem } = await import("./engine/state.ts");
      const r = sellItem(params.item, params.price, params.buyer);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "monthly_growth", label: "成长",
    description: "月末发育结算。",
    parameters: Type.Object({ diet: Type.String(), exercise: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { monthlyGrowth } = await import("./engine/state.ts");
      const r = monthlyGrowth(params.diet, params.exercise);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "complete_travel", label: "完成旅行",
    description: "当长途旅行的叙事差不多完成时，调用此工具让玩家到达目的地，并扣除旅程对应的时间。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      if (!gameState.pendingTravel) return { content: [{ type: "text", text: "目前没有正在进行的旅行" }], details: {} };
      
      const pt = gameState.pendingTravel;
      gameState.pendingTravel = null;
      saveState();

      await moveTo(pt.to, _ctx, gameState, saveState);
      await advanceTimeMinutes(pt.minutes, _ctx, gameState, saveState);
      
      return { content: [{ type: "text", text: `旅行完成，已到达 ${pt.to}，耗时 ${pt.minutes} 分钟` }], details: {} };
    },
  });

  pi.registerTool({
    name: "spawn_item", label: "生成物品",
    description:
      "因剧情需要生成一件新物品并放入指定目标背包。必须提供 source（来源）和 reason（原因）。\n" +
      "引擎强制：物品必须有 name/type/weight，武器必须有 damage。\n" +
      "禁止用于绕过 buy_item 或 steal_item 的正常获取途径。",
    parameters: Type.Object({
      target: Type.String({ description: "接收者：'玩家' 或 NPC 名" }),
      item: Type.Object({
        name: Type.String(),
        type: Type.String({ description: "weapon / clothing / armor / tool / consumable" }),
        slot: Type.String({ description: "装备槽位" }),
        weight: Type.Number(),
        damage: Type.Optional(Type.Object({
          dice: Type.String({ description: "如 '1d8'" }),
          damageType: Type.String({ description: "如 '斩击'" }),
        })),
        effects: Type.Optional(Type.Array(Type.Object({
          type: Type.String(),
          value: Type.Union([Type.Number(), Type.String()]),
        }))),
        flavor: Type.Optional(Type.String({ description: "品质描述" })),
      }),
      source: Type.String({ description: "来源：谁给的/哪来的" }),
      reason: Type.String({ description: "为什么获得，如'静将祖父遗物托付给你'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("./engine/state.ts");
      const targetChar = (params.target === "玩家" || params.target === gameState.player.name)
        ? gameState.player
        : getOrCreateNPC(params.target);

      // Validate damage for weapon
      if (params.item.type === "weapon" && !params.item.damage) {
        return { content: [{ type: "text", text: "错误: weapon 类型的物品必须指定 damage 参数" }], details: {} };
      }

      const flavorSuffix = `来源: ${params.source}`;
      const itemObj: any = {
        name: params.item.name,
        type: params.item.type,
        slot: params.item.slot,
        weight: params.item.weight,
        state: "intact",
        flavor: params.item.flavor ? `${params.item.flavor}\n${flavorSuffix}` : flavorSuffix,
        effects: params.item.effects || [],
      };
      if (params.item.damage) {
        itemObj.damage = params.item.damage;
      }

      targetChar.inventory.push(itemObj);
      saveState();

      return {
        content: [{ type: "text", text: `成功生成物品 ${params.item.name} 并放入 ${params.target} 的背包。原因: ${params.reason}` }],
        details: { item: itemObj }
      };
    },
  });

  pi.registerTool({
    name: "inflict_damage", label: "造成伤害",
    description: "因环境或剧情对角色造成 HP 伤害。不经过战斗检定。target 为角色名或'玩家'。",
    parameters: Type.Object({
      target: Type.String({ description: "'玩家' 或 NPC 名" }),
      amount: Type.Number({ description: "伤害值" }),
      type: Type.String({ description: "伤害类型：'钝击'/'坠落'/'毒素'/'燃烧'/'冻伤'/'其他'" }),
      reason: Type.String({ description: "伤害原因，如'被落石砸中'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("./engine/state.ts");
      const isPlayer = params.target === "玩家" || params.target === gameState.player.name;
      const targetChar = isPlayer ? gameState.player : getOrCreateNPC(params.target);

      targetChar.hp.current = Math.max(0, targetChar.hp.current - params.amount);
      if (targetChar.hp.current === 0) {
        if (isPlayer) {
          gameState.player.alive = false;
        } else {
          targetChar.alive = false;
        }
      }

      saveState();
      const statusText = targetChar.hp.current === 0 ? "倒下了/已死亡" : `剩余 HP: ${targetChar.hp.current}/${targetChar.hp.max}`;
      return {
        content: [{ type: "text", text: `对 ${params.target} 造成 ${params.amount} 点${params.type}伤害（原因: ${params.reason}）。${params.target}当前状态: ${statusText}` }],
        details: { currentHp: targetChar.hp.current, alive: isPlayer ? gameState.player.alive : targetChar.alive }
      };
    },
  });

  pi.registerTool({
    name: "add_memory_tag", label: "记忆标签",
    description: "将关键剧情点烙印在 NPC 记忆系统中。标签会被注入后续 prompt。",
    parameters: Type.Object({
      target: Type.String({ description: "NPC 名" }),
      tag: Type.String({ description: "标签内容，如'知道玩家是杀手'" }),
      expires_days: Type.Optional(Type.Number({ description: "过期天数，默认7" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { addMemoryTag, saveState } = await import("./engine/state.ts");
      addMemoryTag(params.target, params.tag, params.expires_days || 7);
      saveState();
      return { content: [{ type: "text", text: `${params.target} 记忆: ${params.tag}` }], details: {} };
    },
  });

  // ── Commands ──
  pi.registerCommand("relations", {
    description: "查看所有NPC关系与恋爱阶段",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const lines: string[] = [];
      const rels = gameState.player.relationships;
      
      lines.push("👤 关系与恋爱状态概览");
      lines.push("────────────────────────────────────────");

      const buildBar = (val: number) => {
        const totalBar = 10;
        const filled = Math.min(totalBar, Math.max(0, Math.round(val / 10)));
        return "■".repeat(filled) + "□".repeat(totalBar - filled);
      };

      for (const [n, r] of Object.entries(rels)) {
        const rel = r as any;
        lines.push(`👥 ${n} (${rel.stage})`);
        let stageStr = `   好感: [${buildBar(rel.affection)}] ${rel.affection}/100`;
        if (rel.romance) {
          stageStr += ` | 💕 ${rel.romance}`;
        }
        lines.push(stageStr);
        if (rel.notes) {
          lines.push(`   ✍️ 评价: ${rel.notes}`);
        }
        lines.push("────────────────────────────────────────");
      }
      if (Object.keys(rels).length === 0) {
        lines.push("（目前尚未结识任何角色）");
      }
      await showPanel(ctx, "👥 关系谱", lines);
    },
  });

  pi.registerCommand("status", {
    description: "查看/管理玩家状态与装备 (主菜单)",
    handler: async (_args, ctx) => {
      await runStatus(ctx);
    },
  });

  pi.registerCommand("look", {
    description: "查看角色/物品详情。用法: /look <名>",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) { ctx.ui.notify("用法: /look <角色名或物品名>", "warning"); return; }
      const { gameState, getBodyForAge, getNpcCurrentAge, getOrCreateNPC } = await import("./engine/state.ts");
      const { allChars } = await import("./engine/router.ts");
      
      const isPlayer = name === gameState.player.name || name === "玩家" || name === "我";
      if (isPlayer) {
        const p = gameState.player;
        const lines = [
          `${p.name}  ${p.gender === "female" ? "女" : "男"}  ${p.age}岁  ${gameState.time.player_stage}`,
          `📍 位置: ${p.location}  |  💰 资金: ¥${p.funds}`,
          `❤️ HP: ${p.hp.current}/${p.hp.max}  |  🛡️ AC: ${p.ac}`,
        ];
        if (p.body) {
          const b = p.body;
          let bodyStr = `📏 身体: ${b.height_cm}cm ${b.weight_kg ? b.weight_kg + "kg " : ""}${b.build}`;
          if (b.cup) bodyStr += ` ${b.cup}cup`;
          if (b.measurements) bodyStr += ` ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`;
          lines.push(bodyStr);
        }
        if (p.attributes) {
          const a = p.attributes;
          lines.push(`📊 属性: 力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        if (p.titles && p.titles.length > 0) {
          lines.push(`🏆 称号: ${p.titles.join(", ")}`);
        }
        const skillLines = Object.entries(p.skills || {})
          .filter(([_, s]) => s.level > 0)
          .map(([sName, s]) => `${sName}:Lv.${s.level}(${s.exp}/${s.nextLevel})`);
        if (skillLines.length > 0) {
          lines.push(`🎓 技能: ${skillLines.join("  ")}`);
        }
        const repLines = Object.entries(p.reputation || {})
          .filter(([_, val]) => val !== 0)
          .map(([gName, val]) => `${gName}:${val}`);
        if (repLines.length > 0) {
          lines.push(`🏅 声望: ${repLines.join("  ")}`);
        }
        const eq = Object.entries(p.equipment).filter(([_, v]) => v);
        if (eq.length > 0) {
          lines.push(`⚔️ 装备: ${eq.map(([s, it]) => `${s}:${it!.name}`).join(" ")}`);
        }
        await showPanel(ctx, p.name, lines);
        return;
      }

      const char = allChars.find((c: any) => c.name === name || c.name.includes(name));
      if (char) {
        const age = getNpcCurrentAge(char.base_age || 16);
        const body = getBodyForAge(char, age);
        const npcState = getOrCreateNPC(char.name);
        const lines = [
          `${char.name}  ${char.gender === "female" ? "女" : "男"}  ${age}岁 (基础:${char.base_age})`,
          `🎬 作品: ${char.source}`,
          `👗 外观: ${char.appearance_brief || "无描述"}`,
          `💰 资金: ¥${npcState.funds}`,
          `🎒 背包: ${npcState.inventory && npcState.inventory.length > 0 ? npcState.inventory.map(it => it.name).join(", ") : "(空)"}`
        ];
        
        if (body) {
          let bodyStr = `📏 身体: ${body.height_cm}cm ${body.weight_kg}kg ${body.build}`;
          if (body.cup) bodyStr += ` ${body.cup}cup`;
          if (body.measurements) bodyStr += ` ${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
          lines.push(bodyStr);
        }
        
        if (char.attributes) {
          const a = char.attributes;
          lines.push(`📊 属性: 力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        
        const eq = Object.entries(npcState.equipment).filter(([_, v]) => v);
        if (eq.length > 0) {
          lines.push(`⚔️ 装备: ${eq.map(([s, it]) => `${s}:${it!.name}`).join(" ")}`);
        }
        
        if (char.anchors?.private) {
          lines.push(`✍️ 设定: ${char.anchors.private.slice(0, 120)}`);
        }
        await showPanel(ctx, char.name, lines);
        return;
      }
      
      let item = gameState.player.inventory.find((i: any) => i.name.includes(name) || name.includes(i.name));
      if (!item) {
        for (const [_, eqItem] of Object.entries(gameState.player.equipment)) {
          if (eqItem && (eqItem.name.includes(name) || name.includes(eqItem.name))) {
            item = eqItem;
            break;
          }
        }
      }
      
      if (item) {
        const lines = [
          `类型: ${item.type} | 槽位: ${item.slot} | 重量: ${item.weight}kg | 状态: ${item.state}`,
        ];
        if (item.flavor) {
          lines.push(`描述: ${item.flavor}`);
        }
        if (item.damage) {
          lines.push(`伤害: ${item.damage.dice} (${item.damage.damageType})`);
        }
        if (item.effects && item.effects.length > 0) {
          lines.push("效果:");
          item.effects.forEach((eff: any) => {
            const groupStr = eff.group ? ` (${eff.group})` : "";
            lines.push(`  - ${eff.type}: ${eff.value}${groupStr}`);
          });
        }
        await showPanel(ctx, item.name, lines);
        return;
      }
      
      ctx.ui.notify(`未找到: ${name}`, "warning");
    },
  });

  pi.registerCommand("party", {
    description: "查看当前队伍成员状态",
    handler: async (_args, ctx) => {
      const { gameState, getOrCreateNPC } = await import("./engine/state.ts");
      const { allChars } = await import("./engine/router.ts");
      const p = gameState.player;
      const lines: string[] = [];
      
      lines.push(`🛡️ 当前队伍状态 (队长: ${p.name})`);
      lines.push("────────────────────────────────────────");
      
      // 主角卡
      lines.push(`👤 [主角] ${p.name} (${p.gender}) | ${p.age}岁`);
      lines.push(`   HP: ${p.hp.current}/${p.hp.max} | AC: ${p.ac} | 位置: ${p.location}`);
      lines.push("────────────────────────────────────────");

      // 队友卡
      if (p.party && p.party.length > 0) {
        for (const name of p.party) {
          const char = allChars.find((c: any) => c.name === name);
          const npcState = getOrCreateNPC(name);
          if (char) {
            lines.push(`👥 [队友] ${char.name} (${char.gender === "female" ? "女" : "男"})`);
            lines.push(`   位置: ${npcState.currentRoom || char.default_location}`);
            if (char.attributes) {
              const a = char.attributes;
              lines.push(`   属性: 力${a.力量} 敏${a.敏捷} 体${a.体质} 智${a.智力} 感${a.感知} 魅${a.魅力}`);
            }
            if (char.appearance_brief) {
              lines.push(`   外貌: ${char.appearance_brief}`);
            }
            lines.push("────────────────────────────────────────");
          }
        }
      } else {
        lines.push("ℹ️ （队伍目前没有其他成员，你正独自一人前行）");
      }
      
      await showPanel(ctx, "👥 我的队伍", lines);
    },
  });



  pi.registerCommand("identity", {
    description: "设置或查看当前公开身份（伪装）。用法: /identity [新身份]",
    handler: async (args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const newId = args.trim();
      if (!newId) {
        ctx.ui.notify(`当前公开身份: ${gameState.player.public_identity || "总武高学生"}`, "info");
        return;
      }
      gameState.player.public_identity = newId;
      saveState();
      ctx.ui.notify(`公开身份已更新为: ${newId}`, "success");
    },
  });

  pi.registerCommand("go", {
    description: "旅行与探索导航系统 (长途旅行会触发剧情叙事)",
    handler: async (_args, ctx) => {
      await runNavigation(ctx, false);
    },
  });

  pi.registerCommand("goskip", {
    description: "旅行与探索导航系统 (跳过剧情，直接到达目的地)",
    handler: async (_args, ctx) => {
      await runNavigation(ctx, true);
    },
  });

  pi.registerCommand("save", {
    description: "存档（需在安全地点）",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const loc = gameState.player.location;
      const safe = loc.includes("自宅") || loc.includes("家") || loc.includes("公寓") || loc.includes("橘家") || loc.includes("邸") || loc.includes("教室");
      if (!safe) { ctx.ui.notify("这里不是安全地点", "warning"); return; }
      saveState(); ctx.ui.notify("💾 已存档", "info");
    },
  });

  pi.registerCommand("sleep", {
    description: "睡觉+1天+满血（需在家）",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const { advanceTime } = await import("./engine/time.ts");
      const loc = gameState.player.location;
      if (!(loc.includes("自宅")||loc.includes("家")||loc.includes("公寓")||loc.includes("橘家")||loc.includes("邸"))) {
        ctx.ui.notify("需要在家才能睡觉", "warning"); return;
      }
      gameState.time = advanceTime(gameState.time, 1);
      gameState.player.hp.current = gameState.player.hp.max;
      saveState();
      ctx.ui.notify(`😴 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日。HP恢复。`, "info");
      updateChatHUD(ctx);
    },
  });

  pi.registerCommand("layer1", {
    description: "切换模式：gal ↔ sex（自动注入对应规则）",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      gameState.mode = gameState.mode === "sex" ? "gal" : "sex";
      gameState.layer1Enabled = gameState.mode === "sex";
      saveState();
      ctx.ui.notify(gameState.mode === "sex" ? "🔞 Sex 模式（Layer1 自动启用）" : "GAL 模式（Layer1 关闭）", "info");
    },
  });

  pi.registerCommand("sex", {
    description: "Layer1 状态面板：查看所有NPC的性欲/兴奋/心里话",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const sexStates = gameState.sexStates || {};
      const keys = Object.keys(sexStates);

      const renderSexCard = async (s: SexState) => {
        const p = s.profile;
        const charName = (p as any).name || "未知";
        const lines = [
          `欲望: ${s.desire}/100  兴奋: ${s.arousal}/100`,
          `态度: ${p.attitude}  经验: ${p.experience}`,
          `周期: 第${s.cycleDay}天 ${s.cyclePhase}  高潮阈值: ${p.climaxThreshold}`,
          `高潮: ${s.climaxCount}次  潮吹: ${s.squirtCount}次`,
        ];
        // 初体验里程碑
        if (s.milestones) {
          const ml: string[] = [];
          const m = s.milestones;
          if (m.firstKiss.given) ml.push(`初吻: ${m.firstKiss.partner} (${m.firstKiss.date})`);
          else ml.push(`初吻: 未`);
          if (!m.virginity.isVirgin) ml.push(`初夜: ${m.virginity.lostTo} (${m.virginity.lostAt})`);
          else ml.push(`初夜: 未`);
          if (!m.analVirginity.isVirgin) ml.push(`菊初: ${m.analVirginity.lostTo} (${m.analVirginity.lostAt})`);
          lines.push(`💝 初体验: ${ml.join(" | ")}`);
        }
        lines.push(``);
        lines.push(`喜欢: ${p.likes.join("、")}`,
          `排斥: ${p.dislikes.join("、")}`,
        );
        if (p.female) {
          lines.push(``);
          lines.push(`胸: ${p.female.breast.cup}cup ${p.female.breast.shape} ${p.female.breast.feel}`);
          lines.push(`秘部: ${p.female.vagina.type} ${p.female.vagina.tightness} ${p.female.vagina.depth_cm}cm`);
        }
        if (s.thoughts && s.thoughts.length > 0) {
          lines.push(``);
          lines.push(`心里话:`);
          s.thoughts.slice(-3).forEach((t: any) => lines.push(`  「${t.text}」`));
        }
        await showPanel(ctx, `🔞 Layer1 - ${charName}`, lines);
      };

      if (keys.length === 0) {
        if (gameState.player.sex) {
          await renderSexCard(gameState.player.sex);
        } else {
          ctx.ui.notify("无活跃的 SexState。进入亲密场景后自动创建。", "info");
        }
      } else if (keys.length === 1) {
        await renderSexCard(sexStates[keys[0]]);
      } else {
        const menuItems: MenuItem[] = keys.map(k => {
          const s = sexStates[k];
          return {
            label: `👤 ${k}`,
            detail: `欲望:${s.desire} 兴奋:${s.arousal}`,
            action: async (done) => {
              await renderSexCard(s);
              done();
            }
          };
        });
        await showMenu(ctx, "🔞 Layer1 角色选择", menuItems);
      }
    },
  });



  pi.registerCommand("room", {
    description: "视觉观察当前场景：提取空间感、周边NPC大致高度与距离",
    handler: async (_args, ctx) => {
      const { gameState, getRoom, isSameLocation, getNpcCurrentAge, getBodyForAge } = await import("./engine/state.ts");
      const { allChars } = await import("./engine/router.ts");
      const loc = gameState.player.location;
      const room = getRoom(loc);
      const lines: string[] = [];

      lines.push(`📍 当前场景: ${loc}`);
      lines.push("────────────────────────────────────────");

      if (room) {
        // 1. 空间与微观网格
        const w = room.width;
        const h = room.height;
        const cs = room.cellSize || 1;
        let gridDesc = `📏 空间规格: ${w * cs}米 × ${h * cs}米 (${w} × ${h} 格，${cs}m/格)`;
        if (gameState.player.gridPos) {
          const [px, py] = gameState.player.gridPos;
          gridDesc += ` | 你的坐标: (${px}, ${py})`;
        }
        lines.push(gridDesc);
        
        if ((room as any).atmosphere) {
          lines.push(`✨ 氛围感知: ${(room as any).atmosphere}`);
        }
        
        const amb = (room as any).ambient;
        if (amb) {
          lines.push(`🔊 环境渗透: ${[amb.visual, amb.audio].filter(Boolean).join("，")}`);
        }
        lines.push("────────────────────────────────────────");

        // 2. 出口与家具 (玩家一瞥能看到的显著地标)
        const exits: string[] = [];
        const furniture: string[] = [];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const cell = room.cells[y]?.[x];
            if (!cell) continue;
            if (cell.type === "exit" || cell.type === "door") {
              exits.push(`${cell.exitTo || "出口"}(${x},${y})${cell.isOpen === false ? "🔒" : ""}`);
            }
            if (cell.furniture) {
              furniture.push(`${cell.furniture}(${x},${y})`);
            }
          }
        }
        if (exits.length > 0) lines.push(`🚪 显著出口: ${exits.join("  ")}`);
        if (furniture.length > 0) lines.push(`🪑 场景物件: ${furniture.join("  ")}`);
        lines.push("────────────────────────────────────────");
      }

      // 3. 👥 周边动态 (Surrounding Dynamics)
      lines.push("👥 周边动态 [场景视野]");
      
      const getRelativeDir = (px: number, py: number, nx: number, ny: number) => {
        if (nx === px && ny === py) return "身旁";
        let dir = "";
        if (ny < py) dir += "前";
        else if (ny > py) dir += "后";
        if (nx < px) dir += "左";
        else if (nx > px) dir += "右";
        return dir + "方";
      };

      const inRoomNPCs = Object.entries(gameState.npcs)
        .filter(([_, n]) => isSameLocation(n.currentRoom, loc));

      let totalNPCsCount = 0;

      if (inRoomNPCs.length > 0) {
        for (const [name, npc] of inRoomNPCs) {
          const char = allChars.find((c: any) => c.name === name);
          let heightStr = "未知";
          if (char) {
            const curAge = getNpcCurrentAge(char.base_age || 16);
            const body = getBodyForAge(char, curAge);
            if (body?.height_cm) heightStr = `${body.height_cm}cm`;
          }

          let positionStr = "处于场景中";
          if (gameState.player.gridPos && npc.gridPos) {
            const [px, py] = gameState.player.gridPos;
            const [nx, ny] = npc.gridPos;
            const dist = Math.round(Math.sqrt(Math.pow(nx - px, 2) + Math.pow(ny - py, 2)) * (room?.cellSize || 1) * 10) / 10;
            const gridDist = Math.round(Math.sqrt(Math.pow(nx - px, 2) + Math.pow(ny - py, 2)));
            positionStr = `位于你的 ${getRelativeDir(px, py, nx, ny)} 约 ${dist}米 (约 ${gridDist}格)`;
          }

          lines.push(`  |-[${name}: *${heightStr}*] ${positionStr} - *${npc.action || "目前正站立着"}*`);
          totalNPCsCount++;
        }
      }

      // Public room nameless NPCs seeding (on the fly for visual TUI)
      const namelessNPCs = getNamelessNPCs(loc, gameState.turn);
      for (const item of namelessNPCs) {
        let positionStr = "处于场景中";
        if (gameState.player.gridPos) {
          const [px, py] = gameState.player.gridPos;
          const [nx, ny] = item.gridPos;
          const dist = Math.round(Math.sqrt(Math.pow(nx - px, 2) + Math.pow(ny - py, 2)) * (room?.cellSize || 1) * 10) / 10;
          const gridDist = Math.round(Math.sqrt(Math.pow(nx - px, 2) + Math.pow(ny - py, 2)));
          positionStr = `位于你的 ${getRelativeDir(px, py, nx, ny)} 约 ${dist}米 (约 ${gridDist}格)`;
        }
        lines.push(`  |-[${item.name}: *${item.height}*] ${positionStr} - *${item.act}*`);
        totalNPCsCount++;
      }

      if (totalNPCsCount === 0) {
        lines.push("  |-[视野内]: 没有发现其他活动角色");
      }
      
      lines.push("────────────────────────────────────────");

      await showPanel(ctx, "👁️ 场景视觉观察", lines);
    },
  });

  pi.registerCommand("preset", {
    description: "切换系统提示词组装配置（标准 default / 轻量 lite）。",
    handler: async (args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      if (args && (args[0] === "default" || args[0] === "lite")) {
        gameState.preset = args[0] as "default" | "lite";
        saveState();
        ctx.ui.notify(`已切换提示词模式为: ${args[0]}`, "info");
      } else {
        // 弹窗菜单选择
        const items: MenuItem[] = [
          { label: "default (标准)", detail: "完整系统提示，含规则+输出+状态+模式", action: () => { gameState.preset = "default"; saveState(); ctx.ui.notify("模式切换为: default", "info"); } },
          { label: "lite (轻量)", detail: "省略硬规则，日常场景节省 Token", action: () => { gameState.preset = "lite"; saveState(); ctx.ui.notify("模式切换为: lite", "info"); } },
        ];
        await showMenu(ctx, "系统提示词预设", items);
      }
    },
  });



  // ── Lifecycle ──
  pi.on("session_start", async (_event, ctx) => {
    const { loadState, buildStatePrompt, saveState, resetState } = await import("./engine/state.ts");
    const restored = loadState();
    if (restored) {
      // 确保 NPC 懒初始化（恢复旧存档时补上）
      await buildStatePrompt();
      saveState();
      ctx.ui.notify(`earth-0 ${(await import("./engine/state.ts")).gameState.time.game_date}`, "info");
    } else {
      resetState();
      ctx.ui.notify("earth-0 新游戏", "info");
    }
    updateChatHUD(ctx);
  });

  pi.on("turn_end", async (event, ctx) => {
    updateChatHUD(ctx);
  });

  pi.on("session_shutdown", async () => {
    const { saveState } = await import("./engine/state.ts");
    saveState();
  });

  // 每轮组装 GM 系统提示词
  pi.on("before_agent_start", async (event) => {
    const { buildStatePrompt, gameState } = await import("./engine/state.ts");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const agentsDir = path.resolve(process.cwd(), "agents");

    // 状态简报（含 NPC 懒初始化）
    const statePrompt = await buildStatePrompt();

    // 按 mode 选叙事规则 — mode=sex 自动启用 Layer1
    if (gameState.mode === "sex") gameState.layer1Enabled = true;

    // 读取 preset.json，动态组装
    let gmPrompt = "";
    const presetPath = path.join(agentsDir, "preset.json");
    if (fs.existsSync(presetPath)) {
      try {
        const presetData = JSON.parse(fs.readFileSync(presetPath, "utf-8"));
        const presetName = gameState.preset || "default";
        const layers = presetData.assembly[presetName] || presetData.assembly["default"];
        const parts: string[] = [];
        
        for (const key of layers) {
          const layerKey = key.replace("{mode}", gameState.mode);
          const layerConfig = presetData.layers[layerKey];
          if (!layerConfig) continue;
          
          if (layerKey === "state") {
            parts.push(statePrompt);
          } else {
            const filePath = path.resolve(process.cwd(), layerConfig.file);
            const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").trim() : "";
            if (content) parts.push(content);
          }
        }
        gmPrompt = parts.filter(Boolean).join("\n\n---\n\n");
      } catch (e) {
        // fallback to default hardcoded assembly if parsing preset.json fails
        const read = (name: string) => {
          const p = path.join(agentsDir, name);
          return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
        };
        const modeFile = gameState.mode === "sex" ? "gm-mode-sex.md"
          : gameState.mode === "rpg" ? "gm-mode-rpg.md"
          : "gm-mode-gal.md";
        gmPrompt = [
          read("gm-pre.md"),
          read("gm-rules.md"),
          read("gm-contract.md"),
          statePrompt,
          read(modeFile),
        ].filter(Boolean).join("\n\n---\n\n");
      }
    } else {
      const read = (name: string) => {
        const p = path.join(agentsDir, name);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
      };
      const modeFile = gameState.mode === "sex" ? "gm-mode-sex.md"
        : gameState.mode === "rpg" ? "gm-mode-rpg.md"
        : "gm-mode-gal.md";
      gmPrompt = [
        read("gm-pre.md"),
        read("gm-rules.md"),
        read("gm-contract.md"),
        statePrompt,
        read(modeFile),
      ].filter(Boolean).join("\n\n---\n\n");
    }

    return { systemPrompt: gmPrompt };
  });
}
