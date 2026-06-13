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
        
        const statusBarText = `🕐 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${timeOfDayZH[gameState.time.time_of_day] || gameState.time.time_of_day} | 📍 ${loc} | 👥 周边 ${totalCount} 人活动中`;
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
    const finalLines: string[] = [];
    for (const line of lines) {
      finalLines.push(...wrapLine(line, 65));
    }
    const items: MenuItem[] = finalLines.map(l => ({ label: l, detail: "", action: undefined }));
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
            
            // TUI HUD Status Bar
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
                const statusBarText = `🕐 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${timeOfDayZH[gameState.time.time_of_day] || gameState.time.time_of_day} | 📍 ${loc} | 👥 周边 ${totalCount} 人活动中`;
                const barTrunc = truncateToWidth(statusBarText, w - 4);
                const barPad = Math.max(0, (w - 4) - getStringWidth(barTrunc));
                out.push("│ " + barTrunc + " ".repeat(barPad) + " │");
                out.push("├" + "─".repeat(w - 2) + "┤");
              }
            } catch (_) {}

            const start = Math.max(0, sel - 5), end = Math.min(items.length, start + 10);
            for (let i = start; i < end; i++) {
              const it = items[i];
              const line = (i === sel ? "▶ " : "  ") + it.label + (it.detail ? "  " + it.detail : "");
              const t = tui.truncateToWidth ? tui.truncateToWidth(line, w - 2) : truncateToWidth(line, w - 2);
              const pad = Math.max(0, (w - 4) - getStringWidth(t));
              out.push("│ " + t + " ".repeat(pad) + " │");
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

  async function runNavigation(ctx: any) {
    const { gameState, saveState, isSameLocation } = await import("./engine/state.ts");
    const roomsData = (await import("./data/rooms.json", { with: { type: "json" } })).default as any;
    
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
            await moveTo(name, ctx, gameState, saveState);
            await advanceTimeMinutes(2, ctx, gameState, saveState);
            subDone();
            parentDone();
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
                  await moveTo(r, ctx, gameState, saveState);
                  await advanceTimeMinutes(5, ctx, gameState, saveState);
                  subDone();
                  parentDone();
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
              await moveTo(r, ctx, gameState, saveState);
              await advanceTimeMinutes(5, ctx, gameState, saveState);
              subDone();
              parentDone();
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
              await moveTo(r, ctx, gameState, saveState);
              await advanceTimeMinutes(5, ctx, gameState, saveState);
              subDone();
              parentDone();
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
              await moveTo(l, ctx, gameState, saveState);
              await advanceTimeMinutes(mins, ctx, gameState, saveState);
              subDone();
              parentDone();
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
                await moveTo(sn, ctx, gameState, saveState);
                await advanceTimeMinutes(mins, ctx, gameState, saveState);
                subDone();
                parentDone();
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
            await moveTo(k, ctx, gameState, saveState);
            await advanceTimeMinutes(mins, ctx, gameState, saveState);
            subDone();
            parentDone();
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
      items.push({ label: `📊 属性: 力${p.attributes.力量} 敏${p.attributes.敏捷} 体${p.attributes.体质} 智${p.attributes.智力} 感${p.attributes.感知} 魅${p.attributes.魅力}`, detail: "" });
      const woundStr = p.wounds && p.wounds.length > 0 
        ? p.wounds.map(w => `${w.severity}: ${w.text}`).join(", ")
        : "健康";
      items.push({ label: `🩸 伤势: ${woundStr}`, detail: "" });
      
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

  pi.registerTool({
    name: "patch_state", label: "修改状态",
    description: "改好感/移物品/换位置/加技能/给或取物品。target=NPC名, action=add_affection|add_skill_exp|move|give_item|take_item, value=数值/地点/物品名",
    parameters: Type.Object({ target: Type.String(), action: Type.String(), value: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { updateRelation, addSkillExp, gameState, saveState, setPlayerLocation, getOrCreateNPC, getOrCreateSexState } = await import("./engine/state.ts");
      const p = gameState.player;
      let r = "";
      if (params.action === "add_affection" && params.value) {
        const delta = Number(params.value);
        updateRelation(p.relationships, params.target, delta);
        r = `${params.target} 好感${delta > 0 ? "+" : ""}${delta}`;
        if (delta > 0) {
          const sState = await getOrCreateSexState(params.target);
          if (sState) {
            const desireDelta = Math.max(1, Math.round(delta * 0.5));
            sState.desire = Math.min(100, sState.desire + desireDelta);
            r += `，欲望+${desireDelta} (当前欲望: ${sState.desire}/100)`;
          }
        }
      } else if (params.action === "add_skill_exp" && params.value) {
        const [sk, exp] = params.value.split(":");
        addSkillExp(p.skills, sk, Number(exp));
        r = `${sk} +${exp}EXP`;
      } else if (params.action === "move" && params.value) {
        setPlayerLocation(params.value);
        r = `移动到 ${params.value}`;
      } else if (params.action === "give_item" && params.value) {
        // 玩家给 NPC 物品
        const idx = p.inventory.findIndex((i: any) => i.name === params.value);
        if (idx < 0) { r = `背包里没有${params.value}`; }
        else {
          const item = p.inventory.splice(idx, 1)[0];
          const npc = getOrCreateNPC(params.target);
          npc.inventory.push(item);
          r = `把${params.value}给了${params.target}`;
        }
      } else if (params.action === "take_item" && params.value) {
        // 玩家从 NPC 拿物品（背包或装备）
        const npc = getOrCreateNPC(params.target);
        // 先查背包
        let idx = npc.inventory.findIndex((i: any) => i.name === params.value);
        if (idx >= 0) {
          const item = npc.inventory.splice(idx, 1)[0];
          p.inventory.push(item);
          r = `从${params.target}的背包拿到了${params.value}`;
        } else {
          // 再查装备槽
          let found = false;
          for (const [slot, item] of Object.entries(npc.equipment)) {
            if (item && item.name === params.value) {
              p.inventory.push(item);
              npc.equipment[slot as any] = null;
              found = true;
              r = `从${params.target}身上取下了${params.value}`;
              break;
            }
          }
          if (!found) r = `${params.target}身上没有${params.value}`;
        }
      } else { r = `未知操作: ${params.action}`; }
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
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
      gameState.time.timeline_origin.year = 2018 - (16 - params.age); // 例如 6岁时是 2008年，16岁时是 2018年
      // 根据年龄段设置阶段
      gameState.time.player_stage = params.age <= 6 ? "小学生" : params.age <= 12 ? "小学生" : params.age <= 15 ? "中学生" : "高中生";
      
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
    parameters: Type.Object({ char: Type.String(), part: Type.String(), intensity: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateSexState } = await import("./engine/state.ts");
      if (!gameState.layer1Enabled) return { content: [{ type: "text", text: "Layer1未启用" }], details: {} };
      
      // 自动对齐或懒加载当前 SexState
      if (!gameState.player.sex || (gameState.player.sex.profile as any).name !== params.char) {
        const sState = await getOrCreateSexState(params.char);
        if (!sState) return { content: [{ type: "text", text: `无该角色sex档案: ${params.char}` }], details: {} };
        gameState.player.sex = sState;
      }

      const { SEX_PROFILES, touchBodyPart, checkClimax, triggerClimax, settleAfterSex, formatSettlement } = await import("./engine/sex.ts");
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

      // Check climax
      if (checkClimax(gameState.player.sex)) {
        triggerClimax(gameState.player.sex);
        textResult += `\n检测到高潮！${params.char}达到了高潮！`;
        
        // Settle sex session
        const report = settleAfterSex(gameState.player.sex, gameState.time.game_date, 30, touchedParts, []);
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
    description: "自慰以增加兴奋度，甚至达到高潮。",
    parameters: Type.Object({
      char: Type.String({ description: "角色名" }),
      minutes: Type.Number({ description: "持续时间(分钟)" })
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState, getOrCreateSexState } = await import("./engine/state.ts");
      
      // 自动对齐或懒加载当前 SexState
      if (!gameState.player.sex || (gameState.player.sex.profile as any).name !== params.char) {
        const sState = await getOrCreateSexState(params.char);
        if (!sState) return { content: [{ type: "text", text: `无该角色sex档案: ${params.char}` }], details: {} };
        gameState.player.sex = sState;
      }

      const { masturbate, settleAfterSex, formatSettlement } = await import("./engine/sex.ts");
      const r = masturbate(gameState.player.sex, params.minutes);

      // 防御旧存档 null 值
      if (gameState.player.sex.arousal == null) gameState.player.sex.arousal = 0;
      if (gameState.player.sex.climaxCount == null) gameState.player.sex.climaxCount = 0;
      if (gameState.player.sex.squirtCount == null) gameState.player.sex.squirtCount = 0;

      let textResult = `${params.char}进行了 ${params.minutes} 分钟的自慰。兴奋度 +${r.arousalChange} (当前兴奋度: ${gameState.player.sex.arousal}/100)`;
      let settlementReport: any = null;

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
    description: "攻击/防御/逃跑/死亡豁免。action: attack/defend/flee/death_save。target 为 NPC 名。",
    parameters: Type.Object({ action: Type.String(), target: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC, damageItem } = await import("./engine/state.ts");
      const { resolveAttack, defend, attemptFlee, makeDeathSave, getRoundSummary } = await import("./engine/combat.ts");
      const p = gameState.player;
      const playerCombatant = { name: p.name, state: p, cover: "无掩体" as any };

      let r = "";
      if (params.action === "attack" && params.target) {
        const npc = getOrCreateNPC(params.target);
        const allChars = (await import("./engine/router.ts")).allChars;
        const src = allChars.find((c: any) => c.name === params.target);
        const npcState = {
          ...structuredClone(p),
          name: params.target,
          attributes: src?.attributes || { 力量:5,敏捷:5,体质:5,智力:5,感知:5,魅力:5 },
          skills: src?.skills || {},
          hp: src?.hp ? { ...src.hp } : { current: 10, max: 10 },
          ac: src?.ac || 10,
          equipment: npc.equipment || {},
        };
        const npcCombatant = { name: params.target, state: npcState, cover: "无掩体" as any };
        const weapon = Object.values(p.equipment).find((w: any) => w?.damage)
          || { name: "拳头", damage: { dice: "1d2", damageType: "钝击" }, type: "weapon", slot: "right_hand", weight: 0, effects: [], state: "intact" };
        const result = resolveAttack(playerCombatant, npcCombatant, weapon as any);
        r = result.narrative;

        // 物品损坏：攻击命中后武器有 10% 几率受损
        if (result.hit && weapon.state === "intact" && Math.random() < 0.1) {
          damageItem(weapon);
          r += ` ${weapon.name}出现了损伤。`;
        }

        // 战斗摘要
        const summary = getRoundSummary(
          [playerCombatant, npcCombatant],
          [{ actor: p.name, narrative: `攻击${params.target}` }]
        );
        r += `\n[HP] ${summary.stateSnapshots.map(s => `${s.name}:${s.hp.current}/${s.hp.max}`).join(" | ")}`;

        // 死亡豁免检查
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
          const npc = getOrCreateNPC(npcName);
          const allChars = (await import("./engine/router.ts")).allChars;
          const src = allChars.find((c: any) => c.name === npcName);
          const npcState = {
            ...structuredClone(p),
            name: npcName,
            attributes: src?.attributes || { 力量:5,敏捷:5,体质:5,智力:5,感知:5,魅力:5 },
            skills: src?.skills || {},
            hp: src?.hp ? { ...src.hp } : { current: 10, max: 10 },
            ac: src?.ac || 10,
            equipment: npc.equipment || {},
          };
          const npcCombatant = { name: npcName, state: npcState, cover: "无掩体" as any };
          r = attemptFlee(playerCombatant, npcCombatant).narrative;
        }
      } else r = "无效战斗动作";
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "steal_item", label: "偷窃",
    description: "从NPC偷物品。",
    parameters: Type.Object({ target: Type.String(), item: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, stealItem, saveState } = await import("./engine/state.ts");
      const r = stealItem(gameState.player, params.target, params.item);
      saveState();
      return { content: [{ type: "text", text: r.narrative }], details: r };
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
    name: "build_add", label: "建造",
    description: "在棋盘格建造物品。需要指定放置的格子坐标。",
    parameters: Type.Object({ item: Type.String(), x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { placeFurniture } = await import("./engine/state.ts");
      const r = placeFurniture(params.x, params.y, params.item);
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  });

  pi.registerTool({
    name: "build_remove", label: "拆除",
    description: "拆除棋盘格物品。",
    parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { removeFurniture } = await import("./engine/state.ts");
      const r = removeFurniture(params.x, params.y);
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  });

  pi.registerTool({
    name: "door_toggle", label: "开关门",
    description: "开关指定坐标的门/窗。",
    parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { toggleDoor } = await import("./engine/state.ts");
      const r = toggleDoor(params.x, params.y);
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
    name: "sell_item", label: "出售",
    description: "出售物品。LLM 根据市场常识定价，引擎校验价格范围。",
    parameters: Type.Object({ item: Type.String(), price: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { sellItem } = await import("./engine/state.ts");
      const r = sellItem(params.item, params.price);
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
        const filled = Math.round(val / 20);
        return "■".repeat(filled) + "□".repeat(5 - filled);
      };

      for (const [n, r] of Object.entries(rels)) {
        const rel = r as any;
        lines.push(`👥 ${n}`);
        let stageStr = `  |-[好感阶段-${rel.stage}]: ${buildBar(rel.affection)} (${rel.affection}/100)`;
        if (rel.romance) {
          stageStr += ` | [关系: 💕${rel.romance}]`;
        }
        lines.push(stageStr);
        if (rel.notes) {
          lines.push(`  |-[评价/便签]: ${rel.notes}`);
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
    description: "查看/管理玩家状态与装备",
    handler: async (_args, ctx) => {
      await runStatus(ctx);
    },
  });

  pi.registerCommand("menu", {
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
          `${p.name}  ${p.gender}  ${p.age}岁  ${gameState.time.player_stage}`,
          `位置: ${p.location}  资金: ¥${p.funds}`,
          `HP: ${p.hp.current}/${p.hp.max}  AC: ${p.ac}`,
        ];
        if (p.body) {
          const b = p.body;
          let bodyStr = `身体: ${b.height_cm}cm ${b.weight_kg ? b.weight_kg + "kg " : ""}${b.build}`;
          if (b.cup) bodyStr += ` ${b.cup}cup`;
          if (b.measurements) bodyStr += ` ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`;
          lines.push(bodyStr);
        }
        if (p.attributes) {
          const a = p.attributes;
          lines.push(`属性: 力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        const eq = Object.entries(p.equipment).filter(([_, v]) => v);
        if (eq.length > 0) {
          lines.push(`装备: ${eq.map(([s, it]) => `${s}:${it!.name}`).join(" ")}`);
        }
        await showPanel(ctx, p.name, lines);
        return;
      }

      const char = allChars.find((c: any) => c.name === name || c.name.includes(name));
      if (char) {
        const age = getNpcCurrentAge(char.base_age || 16);
        const body = getBodyForAge(char, age);
        const lines = [
          `${char.name}  ${char.gender === "female" ? "女" : "男"}  ${age}岁 (基础:${char.base_age})`,
          `作品: ${char.source}`,
          `外观: ${char.appearance_brief || "无描述"}`
        ];
        
        if (body) {
          let bodyStr = `身体: ${body.height_cm}cm ${body.weight_kg}kg ${body.build}`;
          if (body.cup) bodyStr += ` ${body.cup}cup`;
          if (body.measurements) bodyStr += ` ${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
          lines.push(bodyStr);
        }
        
        if (char.attributes) {
          const a = char.attributes;
          lines.push(`属性: 力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        
        const npcState = getOrCreateNPC(char.name);
        const eq = Object.entries(npcState.equipment).filter(([_, v]) => v);
        if (eq.length > 0) {
          lines.push(`装备: ${eq.map(([s, it]) => `${s}:${it!.name}`).join(" ")}`);
        }
        
        if (char.anchors?.private) {
          lines.push(`设定: ${char.anchors.private.slice(0, 120)}`);
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



  pi.registerCommand("go", {
    description: "旅行与探索导航系统",
    handler: async (_args, ctx) => {
      await runNavigation(ctx);
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
          ``,
          `喜欢: ${p.likes.join("、")}`,
          `排斥: ${p.dislikes.join("、")}`,
        ];
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

  pi.registerCommand("build_room", {
    description: "创建新房间 /build_room <名字> <宽> <高> <楼层>",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 4) { ctx.ui.notify("用法: /build_room <名字> <宽> <高> <楼层>", "warning"); return; }
      const { createRoom } = await import("./engine/state.ts");
      const r = createRoom(parts[0], parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]));
      ctx.ui.notify(r.reason, r.success ? "success" : "warning");
    }
  });

  pi.registerCommand("dig_wall", {
    description: "将指定坐标变为地板 /dig_wall <x> <y>",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) { ctx.ui.notify("用法: /dig_wall <x> <y>", "warning"); return; }
      const { editCellType } = await import("./engine/state.ts");
      const r = editCellType(parseInt(parts[0]), parseInt(parts[1]), "floor");
      ctx.ui.notify(r.reason, r.success ? "success" : "warning");
    }
  });

  pi.registerCommand("build_wall", {
    description: "将指定坐标变为墙壁 /build_wall <x> <y>",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) { ctx.ui.notify("用法: /build_wall <x> <y>", "warning"); return; }
      const { editCellType } = await import("./engine/state.ts");
      const r = editCellType(parseInt(parts[0]), parseInt(parts[1]), "wall");
      ctx.ui.notify(r.reason, r.success ? "success" : "warning");
    }
  });

  pi.registerCommand("place_door", {
    description: "将指定坐标变为门或出口 /place_door <x> <y> [目标房间]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) { ctx.ui.notify("用法: /place_door <x> <y> [目标房间]", "warning"); return; }
      const { editCellType } = await import("./engine/state.ts");
      const r = editCellType(parseInt(parts[0]), parseInt(parts[1]), parts[2] ? "exit" : "door", parts[2]);
      ctx.ui.notify(r.reason, r.success ? "success" : "warning");
    }
  });

  pi.registerCommand("place_furniture", {
    description: "放置家具 /place_furniture <x> <y> <家具名>",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 3) { ctx.ui.notify("用法: /place_furniture <x> <y> <家具名>", "warning"); return; }
      const { placeFurniture } = await import("./engine/state.ts");
      const r = placeFurniture(parseInt(parts[0]), parseInt(parts[1]), parts.slice(2).join(" "));
      ctx.ui.notify(r.reason, r.success ? "success" : "warning");
    }
  });

  pi.registerCommand("remove_furniture", {
    description: "拆除家具 /remove_furniture <x> <y>",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) { ctx.ui.notify("用法: /remove_furniture <x> <y>", "warning"); return; }
      const { removeFurniture } = await import("./engine/state.ts");
      const r = removeFurniture(parseInt(parts[0]), parseInt(parts[1]));
      ctx.ui.notify(r.reason, r.success ? "success" : "warning");
    }
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
