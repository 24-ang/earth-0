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
    const { initPlayerGrid, stampRoom } = await import("./engine/state.ts");
    initPlayerGrid();
    stampRoom(loc);
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
    const events = await updateNPCSchedules();
    const { tickSexStates } = await import("./engine/state.ts");
    await tickSexStates(result.daysAdvanced, mins);
    // 剧情时间线：扫描触发条件 → 生成钩子 → 清理过期钩子
    const { checkTimelineEvents, expireHooks } = await import("./engine/timeline.ts");
    checkTimelineEvents();
    expireHooks();
    gs.player.fatigue = Math.min(100, (gs.player.fatigue ?? 0) + Math.round(mins / 12));
    save();

    const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
    ctx.ui.notify(`⏱️ 时间推进了 ${mins} 分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}`, "info");
    if (events.length > 0) {
      ctx.ui.notify(`📢 事件: ${events.join("; ")}`, "info");
    }
    updateChatHUD(ctx);
  }

  async function runNavigation(ctx: any, fastTravel = false) {
    const { gameState, saveState, isSameLocation, getLocationNav, getRoom } = await import("./engine/state.ts");

    const doMove = async (to: string, mins: number, subDone: () => void, parentDone: () => void) => {
      // 载具加速
      const actualMins = Math.max(1, Math.round(mins / vehicleMul));

      if (!fastTravel && mins >= 15) {
        // 长途旅行 → LLM 叙事旅程
        gameState.pendingTravel = {
          from: gameState.player.location,
          to,
          route: vehicleName ? `${vehicleName}（约${actualMins}分钟）` : `步行/短途（约${mins}分钟）`,
          minutes: actualMins,
          timeOfDay: gameState.time.time_of_day
        };
        saveState();
        ctx.ui.notify(`[旅行中] 正在前往 ${to}，行程 ${actualMins} 分钟。引擎已暂停移动。`, "info");
        const vehicleHint = vehicleName ? `骑${vehicleName}，预计${actualMins}分钟到达。` : `步行约${mins}分钟。`;
        ctx.chat.addSystemMessage(`玩家已出发前往 ${to}。${vehicleHint}不要立即让他们到达目的地！请描述路上的见闻、风景。等剧情差不多了，再调用 complete_travel 工具。`);
        updateChatHUD(ctx);
      } else {
        // 短途 → 直接移动 + 时间对齐提示
        await moveTo(to, ctx, gameState, saveState);
        await advanceTimeMinutes(actualMins, ctx, gameState, saveState);
        // 注入移动时间让 LLM 知道过了多久
        if (mins >= 2) {
          const vHint = vehicleName ? `（骑${vehicleName}）` : "";
          ctx.chat.addSystemMessage(`[移动] ${gameState.player.location} → ${to}，耗时 ${actualMins} 分钟${vHint}。`);
        }
      }
      subDone();
      parentDone();
    };

    const loc = gameState.player.location;
    const known = gameState.player.known_locations || [];
    const nav = getLocationNav(loc);
    const vehicleMul = gameState.player.vehicle?.speedMul || 1;
    const vehicleName = gameState.player.vehicle?.name;

    // 步行距离估算（现实向校准）
    const estTravel = (from: string, to: string): number => {
      const fromRoom = getRoom(from);
      const toRoom = getRoom(to);

      // 同层有网格 → 真实坐标距离 ÷ 1.5m/s 步行速度
      if (fromRoom && toRoom && fromRoom.floor === toRoom.floor) {
        const toOrigin = toRoom.origin;
        const fromPos = gameState.player.gridPos || fromRoom.origin;
        const dx = fromPos[0] - toOrigin[0];
        const dy = fromPos[1] - toOrigin[1];
        const cells = Math.sqrt(dx * dx + dy * dy);
        return Math.max(1, Math.round(cells * fromRoom.cellSize / 1.5));
      }
      // 同校不同层 → 坐标距离 + 每层差额外1分
      if (fromRoom && toRoom) {
        const toOrigin = toRoom.origin;
        const fromOrigin = fromRoom.origin;
        const dx = fromOrigin[0] - toOrigin[0];
        const dy = fromOrigin[1] - toOrigin[1];
        const cells = Math.sqrt(dx * dx + dy * dy);
        const floorPenalty = Math.abs(fromRoom.floor - toRoom.floor);
        return Math.max(2, Math.round(cells * fromRoom.cellSize / 1.5) + floorPenalty);
      }

      // 无网格 → 按层级深度估算（自适应任意地区层级数）
      const fromNav = getLocationNav(from);
      const toNav = getLocationNav(to);
      const sharePrefix = fromNav.breadcrumb.filter(b => toNav.breadcrumb.includes(b)).length;
      const maxDepth = Math.max(fromNav.breadcrumb.length, toNav.breadcrumb.length, 5);
      // shareRatio: 0~1，1=完全相同路径，0=毫无关系
      const shareRatio = sharePrefix / maxDepth;

      // 根据重合比例判定距离档位
      if (shareRatio >= 0.9) return 1 + hashDist(from, to, 0, 5);   // 几乎同地点→1-5分
      if (shareRatio >= 0.7) return 2 + hashDist(from, to, 0, 6);   // 同校/同建筑→2-8分
      if (shareRatio >= 0.5) return 3 + hashDist(from, to, 0, 27);  // 同市/区→3-30分
      if (shareRatio >= 0.3) return 30 + hashDist(from, to, 0, 60); // 同省/县→30-90分
      return 60 + hashDist(from, to, 0, 120);                        // 远距离→60-180分
    };

    const hashDist = (a: string, b: string, min: number, range: number): number => {
      const h = (a + b).split("").reduce((s, c) => s + c.charCodeAt(0), 0);
      return min + (h % range);
    };

    const buildNavMenu = (parentDone: () => void): MenuItem[] => {
      const items: MenuItem[] = [];

      // ── 上层 ──
      if (nav.parent) {
        items.push({
          label: `🔼 返回 ${nav.parent}`,
          action: async (subDone) => { await doMove(nav.parent!, estTravel(loc, nav.parent!), subDone, parentDone); }
        });
      }

      // ── 学校内部结构（建筑→楼层→房间）──
      if (nav.schoolTree && nav.schoolTree.length > 0) {
        items.push({ label: `── 校内建筑 ──` });
        for (const bld of nav.schoolTree) {
          items.push({
            label: `  🏫 ${bld.name}`,
            detail: `${bld.children.length} 层`,
            action: async (subDone) => {
              // 楼层子菜单
              const floorItems: MenuItem[] = [];
              for (const fl of bld.children) {
                floorItems.push({
                  label: `  📶 ${fl.name}`,
                  detail: `${fl.children.length} 个房间`,
                  action: async (floorDone) => {
                    // 房间子菜单
                    const roomItems: MenuItem[] = [];
                    for (const rm of fl.children) {
                      const rmName = rm.name;
                      const here = isSameLocation(loc, rmName);
                      const rmKnown = known.some(k => isSameLocation(k, rmName));
                      const npcs = Object.entries(gameState.npcs).filter(([_, n]: any) => isSameLocation(n.currentRoom, rmName)).map(([n]) => n);
                      if (rmKnown) {
                        roomItems.push({
                          label: `  ${here ? "📍" : "🚪"} ${rmName}`,
                          detail: npcs.length > 0 ? `👥 ${npcs.join(" ")}` : "",
                          action: here ? undefined : async (roomDone) => { await doMove(rmName, 2, roomDone, floorDone); }
                        });
                      } else {
                        roomItems.push({ label: `  ❓ ${rmName}`, detail: "未探索" });
                      }
                    }
                    await showMenu(ctx, `${bld.name} ${fl.name}`, roomItems);
                  }
                });
              }
              await showMenu(ctx, bld.name, floorItems);
            }
          });
        }
      }

      // ── 平级房间（不在学校内部时）──
      if (nav.rooms.length > 0) {
        items.push({ label: `── 同层房间 ──` });
        for (const r of nav.rooms) {
          if (!known.some(k => isSameLocation(k, r))) continue;
          const here = isSameLocation(loc, r);
          const npcs = Object.entries(gameState.npcs).filter(([_, n]: any) => isSameLocation(n.currentRoom, r)).map(([n]) => n);
          items.push({
            label: `  🚪 ${r}`,
            detail: (here ? "📍当前" : "") + (npcs.length > 0 ? ` 👥 ${npcs.join(" ")}` : ""),
            action: here ? undefined : async (subDone) => { await doMove(r, 2, subDone, parentDone); }
          });
        }
      }

      // ── 下属地点（非学校）──
      if (nav.children.length > 0 && !nav.schoolTree) {
        items.push({ label: `── 下属地点 ──` });
        for (const c of nav.children) {
          if (!known.some(k => isSameLocation(k, c))) continue;
          items.push({
            label: `  📂 ${c}`,
            action: async (subDone) => { await doMove(c, estTravel(loc, c), subDone, parentDone); }
          });
        }
        const unknownKids = nav.children.filter(c => !known.some(k => isSameLocation(k, c)));
        if (unknownKids.length > 0) {
          items.push({ label: `  ❓ ${unknownKids.length} 个未探索`, detail: "LLM 可以带你去" });
        }
      }

      // ── 其他地区（prefecture 级以上） ──
      if (nav.level === "prefecture" || nav.level === "region") {
        items.push({ label: `── 其他地区 ──` });
        const allKnown = known.filter(k => {
          const kn = getLocationNav(k);
          return kn.breadcrumb.length > 0 && !nav.breadcrumb.some(b => isSameLocation(b, k));
        });
        for (const k of allKnown.slice(0, 6)) {
          items.push({
            label: `  🗺️ ${k}`,
            action: async (subDone) => { await doMove(k, estTravel(loc, k), subDone, parentDone); }
          });
        }
      }

      // ── 电车（在站内或附近时显示）──
      if (nav.stations && nav.stations.length > 0) {
        for (const st of nav.stations) {
          items.push({ label: `── 🚃 ${st.name} | ${st.lines.join("/")} ──` });
          for (const d of st.destinations) {
            items.push({
              label: `  🚃 → ${d.name}`,
              detail: `${d.minutes}分钟`,
              action: async (subDone) => { await doMove(d.name, d.minutes, subDone, parentDone); }
            });
          }
        }
      }

      // ── 周边 ──
      const nearbyClose = (nav.nearby || []).filter(n => n.minutes <= 8);
      if (nearbyClose.length > 0) {
        const modeIcon = vehicleName ? "🚲" : "🚶";
        const modeLabel = vehicleName ? ` | ${vehicleName}` : "";
        const speedLabel = vehicleMul > 1 ? `×${vehicleMul}` : "";
        items.push({ label: `── 周边${modeLabel} ${speedLabel} ──` });
        for (const n of nearbyClose) {
          const nKnown = known.some(k => isSameLocation(k, n.name));
          // 有车载显示车载时间，没车显示步行
          const displayMins = vehicleMul > 1 ? Math.max(1, Math.round(n.minutes / vehicleMul)) : n.minutes;
          const unit = vehicleMul > 1 ? "分" : "分钟";
          items.push({
            label: `  ${modeIcon} ${n.name}`,
            detail: `${displayMins}${unit}`,
            action: nKnown ? async (subDone) => { await doMove(n.name, n.minutes, subDone, parentDone); } : undefined
          });
        }
      }

      if (items.length === 0) {
        items.push({ label: "  （当前没有可导航的地点——LLM 可以用 create_location 扩展世界）" });
      }

      return items;
    };

    await showMenu(ctx, `🗺️ ${nav.breadcrumb.join(" ▸ ")}`, () => buildNavMenu(() => {}));
  }


  // ── 手机 TUI（引擎存储 + phone_apps.json 驱动，无硬编码）──
  async function showPhoneTUI(ctx: any, phoneItem: any) {
    const { getPlayerPhoneData, syncContactsFromRelationships, markAllRead } =
      await import("./engine/phone.ts");
    const phoneApps: any[] = (await import("./data/phone_apps.json", { with: { type: "json" } })).default;
    const { gameState } = await import("./engine/state.ts");

    const pd = getPlayerPhoneData();
    if (!pd) { ctx.ui.notify("没有手机数据", "warning"); return; }

    // 同步通讯录
    syncContactsFromRelationships(pd);

    // 按 era/region 过滤可见 app
    const gameYear = parseInt(gameState.time.game_date.split("-")[0]) || 2018;
    const isJP = true;

    function eraMatches(era: string): boolean {
      if (era === "all") return true;
      if (era === "2004-2014") return gameYear >= 2004 && gameYear <= 2014;
      if (era === "2011+") return gameYear >= 2011;
      return true;
    }
    function regionMatches(region: string): boolean {
      if (region === "all") return true;
      if (region === "jp") return isJP;
      return true;
    }

    const visibleApps = phoneApps.filter(
      (app: any) => eraMatches(app.era) && regionMatches(app.region)
    );

    // ── 泛型渲染器 ──
    function buildMessagingPanel(): MenuItem[] {
      const items: MenuItem[] = [];
      const msgs = pd.messages;
      const unread = msgs.filter(m => !m.read && m.to === gameState.player.name);
      if (unread.length > 0) {
        items.push({ label: `🆕 ${unread.length} 条未读消息`, detail: "" });
        items.push({ label: "── 收件箱 ──" });
      }
      if (msgs.length > 0) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          items.push({
            label: `${m.read ? "📩" : "🆕"}「${m.from}」${m.text}`,
            detail: m.timestamp,
          });
        }
      } else {
        items.push({ label: "📩 （收件箱是空的）" });
      }
      markAllRead(pd);
      return items;
    }

    function buildContactsPanel(): MenuItem[] {
      const items: MenuItem[] = [];
      if (pd.contacts.length > 0) {
        for (const c of pd.contacts) {
          items.push({
            label: `👤 ${c.name}`,
            detail: `${c.number} | ${c.relation}`,
          });
        }
      } else {
        items.push({ label: "（通讯录是空的）" });
      }
      return items;
    }

    function buildBoardPanel(appId: string): MenuItem[] {
      const items: MenuItem[] = [];
      if (appId === "call_log") {
        if (pd.callLog.length > 0) {
          for (let i = pd.callLog.length - 1; i >= 0; i--) {
            const cl = pd.callLog[i];
            const icon = cl.status === "missed" ? "🔴" : cl.status === "answered" ? "✅" : "📞";
            items.push({
              label: `${icon} ${cl.caller} → ${cl.callee}`,
              detail: `${cl.status} | ${cl.startTime}`,
            });
          }
        } else {
          items.push({ label: "（无通话记录）" });
        }
      } else if (appId === "bbs") {
        const flags = gameState.flags;
        if (flags.wanted) items.push({ label: "💬 【警视厅通告】您已被列为重要参考人。" });
        if (flags.steal_alert) items.push({ label: "💬 【学校通知】近期校内发生盗窃事件。" });
        if (flags.identity_exposed) items.push({ label: "💬 【匿名】有人已经知道你是谁了。" });
        if (items.length === 0) items.push({ label: "💬 【掲示板】今天没有新帖子。" });
      }
      return items;
    }

    function buildTimelinePanel(appId: string): MenuItem[] {
      const items: MenuItem[] = [];
      const platformFilter = appId === "twitter" ? "twitter" : "mixi";
      const posts = pd.snsPosts.filter(p => p.platform === platformFilter);
      if (posts.length > 0) {
        for (let i = posts.length - 1; i >= 0; i--) {
          const p = posts[i];
          items.push({
            label: `${p.author}: ${p.text}`,
            detail: `❤️${p.likes} | ${p.timestamp}`,
          });
        }
      } else {
        items.push({ label: "（时间线是空的——LLM 可以用 browse_sns 填充内容）" });
      }
      return items;
    }

    function buildGalleryPanel(): MenuItem[] {
      const items: MenuItem[] = [];
      if (pd.photos.length > 0) {
        for (const p of pd.photos) {
          items.push({
            label: `📷 ${p.caption || p.filename}`,
            detail: `${p.location} | ${p.takenAt}`,
          });
        }
      } else {
        items.push({ label: "（相册是空的）" });
      }
      return items;
    }

    // ── 主菜单：从 phone_apps.json 动态生成 ──
    const phoneMenu: MenuItem[] = [];
    
    // --- Add Time and Weather Widget ---
    const { time, weather } = gameState;
    const { getTodayCalendar } = await import("./engine/calendar.ts");
    const todayEvents = getTodayCalendar(gameState.time.game_date, gameState.player.location);
    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
    const dayStr = dayNames[time.day];
    
    phoneMenu.push({ label: `📅 ${time.year}年${time.month}月${time.date}日 星期${dayStr} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`, detail: "" });
    phoneMenu.push({ label: `⛅ ${time.season}季 | ${weather.type} (${weather.temp}°C)`, detail: "" });
    if (todayEvents) {
      phoneMenu.push({ label: `📌 今日提醒: ${todayEvents}`, detail: "" });
    }
    phoneMenu.push({ label: "────────────────────────────────────────", detail: "" });

    for (const app of visibleApps) {
      phoneMenu.push({
        label: `${app.icon} ${app.label}`,
        detail: app.type,
        action: async (_done: () => void) => {
          let items: MenuItem[];
          switch (app.type) {
            case "messaging":  items = buildMessagingPanel(); break;
            case "contacts":   items = buildContactsPanel(); break;
            case "board":      items = buildBoardPanel(app.id); break;
            case "timeline":   items = buildTimelinePanel(app.id); break;
            case "gallery":    items = buildGalleryPanel(); break;
            default:           items = [{ label: "未支持的应用类型" }];
          }
          await showMenu(ctx, `📱 ${phoneItem.name} - ${app.label}`, items);
        },
      });
    }

    const unreadStr = pd.unreadCount > 0 ? ` (${pd.unreadCount}条未读)` : "";
    await showMenu(ctx, `📱 ${phoneItem.name}${unreadStr}`, phoneMenu);
  }

  async function runStatus(ctx: any) {
    const { gameState, saveState, calcMaxCarry, calcCurrentWeight, isOverburdened, calcPocketVolume, calcInventoryVolume } = await import("./engine/state.ts");
    const p = gameState.player;

    const maxC = calcMaxCarry(p.attributes.力量);
    const curW = calcCurrentWeight(p.inventory, p.equipment);
    const burden = isOverburdened(curW, maxC);
    const pocketVol = calcPocketVolume(p.equipment);
    const invVol = calcInventoryVolume(p.inventory, p.equipment);

    const SLOT_NAMES: Record<string, string> = {
      top: "外套大衣",
      shirt: "内搭衬衫",
      inner_top: "胸罩/裹胸",
      bottom: "下装/裙子",
      inner_bot: "内裤/胖次",
      legs: "丝袜/连裤袜",
      feet: "脚部鞋子",
      head: "头部/发饰",
      acc: "配饰/挂件",
      left_hand: "副手/左手",
      right_hand: "主手/右手",
      back: "背部/背包"
    };

    const buildMenu = () => {
      const items: MenuItem[] = [];
      
      // 1. 玩家基本状态
      const identityStr = p.public_identity ? ` | 🎭 伪装: ${p.public_identity}` : "";
      items.push({ label: `👤 角色: ${p.name} (${p.gender}) | 年龄: ${p.age}岁${identityStr}`, detail: "" });
      items.push({ label: `❤️ HP: ${p.hp.current}/${p.hp.max} | 🛡️ AC: ${p.ac} | 💰 资金: ¥${p.funds} | 💤 疲劳: ${p.fatigue ?? 0}/100`, detail: "" });
      items.push({ label: `🏋️ 负重: ${curW}/${maxC}kg${burden.overloaded ? " ⚠️超重!" : burden.encumbered ? " 📦较重" : ""} | 📦 体积: ${invVol}${pocketVol > 0 ? `/${pocketVol}` : ""}L`, detail: "" });
      items.push({ label: `📊 属性: 力${p.attributes.力量} 敏${p.attributes.敏捷} 体${p.attributes.体质} 智${p.attributes.智力} 感${p.attributes.感知} 魅${p.attributes.魅力}`, detail: "" });
      const woundStr = p.wounds && p.wounds.length > 0 
        ? p.wounds.map(w => `${w.severity}: ${w.text}`).join(", ")
        : "健康";
      items.push({ label: `🩸 伤势: ${woundStr}`, detail: "" });

      // 身体数据
      if (p.body) {
        const b = p.body;
        let bodyStr = `📏 ${b.height_cm}cm ${b.weight_kg}kg ${b.build}`;
        if (b.cup) bodyStr += ` ${b.cup}cup`;
        if (b.measurements) bodyStr += ` 三围${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`;
        if (b.leg_type) bodyStr += ` ${b.leg_type}腿`;
        if (b.skin) bodyStr += ` 肤${b.skin.texture}·${b.skin.base_tone}`;
        items.push({ label: bodyStr, detail: "" });
      }

      // 声望展示
      items.push({ label: "── 🌟 声望与派系 ──", detail: "" });
      const reps = Object.entries(p.reputation || {});
      if (reps.length > 0) {
        items.push({ label: `  ${reps.map(([k, v]) => `${k}(${v})`).join(" | ")}`, detail: "" });
      } else {
        items.push({ label: `  (无)`, detail: "" });
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
              const isPhone = it.name.includes("手机") || it.effects?.some((e: any) => e.type === "communication");
              const subItems: MenuItem[] = [
                {
                  label: "🔍 查看详情",
                  action: (subDone) => {
                    const lines = [
                      `名称: ${it.name}`,
                      `类型: ${it.type} | 重量: ${it.weight}kg | 体积: ${(it as any).volume ?? "?"}L | 状态: ${it.state}`,
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

              if (isPhone) {
                subItems.push({
                  label: "📱 打开手机",
                  action: async (subDone) => {
                    await showPhoneTUI(ctx, it);
                    subDone();
                  }
                });
              }

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
    description: "查询角色属性/装备(含flavor)/技能/身体。描写服装细节前务必调用。",
    parameters: Type.Object({ name: Type.String({ description: "角色名" }) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { allChars } = await import("./engine/router.ts");
      const { getBodyForAge, getNpcCurrentAge, gameState } = await import("./engine/state.ts");
      const itemsCatalog = (await import("./data/items.json", { with: { type: "json" } })).default;
      const c = allChars.find((x: any) => x.name === params.name);
      if (!c) return { content: [{ type: "text", text: "无此角色" }], details: {} };
      const age = getNpcCurrentAge(c.base_age || 16);
      const aged = { ...c, body: getBodyForAge(c, age) };

      // 构建装备物品的 flavor 速查表
      const flavorMap = new Map<string, string>();
      for (const cat of Object.values(itemsCatalog as any)) {
        for (const [iname, item] of Object.entries(cat as any)) {
          if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
        }
      }

      // 当前穿着物品及flavor
      const equipLines: string[] = [];
      const npc = gameState.npcs?.[params.name];
      if (npc) {
        const key = npc.currentOutfit || "school";
        const outfit = c.outfits?.[key];
        if (outfit) {
          const outer: string[] = [];
          const inner: string[] = [];
          for (const [slot, itemName] of Object.entries(outfit)) {
            const name = itemName as string;
            const flavor = flavorMap.get(name);
            const line = flavor ? `${name}（${flavor}）` : name;
            if (slot.startsWith("inner_")) inner.push(line);
            else outer.push(line);
          }
          if (outer.length > 0) equipLines.push(`穿着: ${outer.join("、")}`);
          if (inner.length > 0) equipLines.push(`内衣: ${inner.join("、")}`);
        }
        // 非服装装备（武器等）
        const nonClothing = Object.entries(npc.equipment)
          .filter(([slot, item]: [string, any]) => item && !["inner_top", "inner_bot", "top", "bottom", "legs", "feet", "head", "shirt"].includes(slot));
        for (const [slot, item] of nonClothing) {
          const it = item as any;
          const flavor = flavorMap.get(it.name);
          equipLines.push(`${slot}: ${it.name}${flavor ? `（${flavor}）` : ""}`);
        }
      }

      const equipStr = equipLines.length > 0 ? `\n\n[当前装备]\n${equipLines.join("\n")}` : "";
      return { content: [{ type: "text", text: JSON.stringify(aged, null, 2) + equipStr }], details: { character: aged } };
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
    name: "transfer_item", label: "转移物品",
    description: "转移物品。from/to: 角色名或'玩家'。引擎强制校验来源持有该物品。",
    parameters: Type.Object({
      from: Type.String({ description: "物品来源：角色名 或 '玩家'" }),
      to: Type.String({ description: "物品去向：角色名 或 '玩家'" }),
      item: Type.String({ description: "物品名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("./engine/state.ts");
      const p = gameState.player;

      // 解析 from 方
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
    description: "调整好感度。单次≤±20，自动0-100 clamp。reason写入备注。",
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

      if (delta > 0) {
        try {
          const sState = await getOrCreateSexState(params.npc);
          if (sState) {
            const desireDelta = Math.max(1, Math.round(delta * 0.5));
            sState.desire = Math.min(100, sState.desire + desireDelta);
            r += `，欲望+${desireDelta}`;
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
    description: "技能经验。单次≤5 EXP。引擎自动升级(Lv×10)。",
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
    description: "初始化新游戏。重置时间和位置，保留玩家设定。",
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
      const { gameState, saveState, updateNPCSchedules, refreshWeather, stampRoom } = await import("./engine/state.ts");
      const { advanceMinutes } = await import("./engine/time.ts");
      const mins = params.minutes;
      // 初始化 legacy session 没有 minute_of_day
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      const result = advanceMinutes(gameState.time, mins);
      // 同步玩家年龄（time.player_age → player.age），确保 NPC 年龄同步
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      if (gameState.turn % 4 === 0) refreshWeather();
      const events = await updateNPCSchedules();
      stampRoom();
      // 疲劳累积：每推进1小时+5疲劳
      gameState.player.fatigue = Math.min(100, (gameState.player.fatigue ?? 0) + Math.round(mins / 12));
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
    description: "自慰以增加兴奋度，甚至达到高潮。",
    parameters: Type.Object({
      char: Type.String({ description: "角色名" }),
      minutes: Type.Number({ description: "持续时间(分钟)" }),
      thoughts: Type.Optional(Type.Array(Type.String({ description: "此轮自慰产生的心里话（30字内/条）" })))
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState, getOrCreateSexState } = await import("./engine/state.ts");
      
      // 自动对齐或懒加载当前 SexState
      if (!gameState.player.sex || (gameState.player.sex.profile as any).name !== params.char) {
        const sState = await getOrCreateSexState(params.char);
        if (!sState) return { content: [{ type: "text", text: `无该角色sex档案: ${params.char}` }], details: {} };
        gameState.player.sex = sState;
      }

      const { masturbate, settleAfterSex, formatSettlement, recordThought } = await import("./engine/sex.ts");
      const r = masturbate(gameState.player.sex, params.minutes);

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
    description: "攻击|防御|逃跑|死亡豁免。actor可选NPC名(以NPC攻击)。",
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
    description: "偷NPC物品。失败→好感-20+alert标记。不可替代正常获取。",
    parameters: Type.Object({ target: Type.String(), item: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, stealItem, saveState, updateRelation, updateReputation } = await import("./engine/state.ts");
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
    description: "装备/卸下物品到指定槽位。",
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
    name: "use_item", label: "使用物品",
    description: "使用背包中消耗品。引擎自动结算效果(回血/提神)后物品消失。",
    parameters: Type.Object({
      item: Type.String({ description: "要使用的物品名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      const p = gameState.player;

      // 在背包找
      const idx = p.inventory.findIndex((i: any) => i.name === params.item);
      if (idx < 0) {
        return { content: [{ type: "text", text: `背包里没有${params.item}` }], details: {} };
      }

      const item = p.inventory[idx];
      if (!item.effects || item.effects.length === 0) {
        return { content: [{ type: "text", text: `${params.item}没有可用效果` }], details: {} };
      }

      const results: string[] = [];
      for (const eff of item.effects) {
        if (eff.type === "heal") {
          // 解析治疗量：支持 "1d4", "2d6", 纯数字
          let healAmount = 0;
          if (typeof eff.value === "string" && (eff.value as string).includes("d")) {
            const [count, sides] = (eff.value as string).split("d").map(Number);
            for (let i = 0; i < count; i++) {
              healAmount += Math.floor(Math.random() * sides) + 1;
            }
          } else {
            healAmount = Number(eff.value);
          }
          const beforeHP = p.hp.current;
          p.hp.current = Math.min(p.hp.max, p.hp.current + healAmount);
          const actualHeal = p.hp.current - beforeHP;
          results.push(`回复了 ${actualHeal} 点HP（${p.hp.current}/${p.hp.max}）`);
        } else if (eff.type === "energy") {
          // 提神效果：清除疲劳相关标记，注入叙事提示
          const strength = eff.value as string;
          const reduce = strength === "强提神" ? 40 : 20;
          const before = p.fatigue;
          p.fatigue = Math.max(0, before - reduce);
          results.push(before > 50 ? "疲劳一扫而空，精力充沛！" : before > 20 ? "精神恢复了些许" : "本来也不太累——精神更好了");
        } else {
          results.push(`${eff.type}: ${eff.value}`);
        }
      }

      // 消耗物品
      p.inventory.splice(idx, 1);
      saveState();

      return {
        content: [{ type: "text", text: `使用了${params.item}：${results.join("；")}` }],
        details: { item: item.name, effects: results }
      };
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
    description: "建造/拆除/开关门。action: place|remove|build_wall|remove_wall|toggle_door。item/material须在背包里。",
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
    description: "场景收口：推进时间+更新NPC日程+写入记忆标签。替代commit_turn+add_memory_tag。NPC换装请用set_npc_outfit。",
    parameters: Type.Object({
      summary: Type.String({ description: "本场景发生的事，如'在侍奉部和雪乃聊了一下午'" }),
      elapsed_minutes: Type.Number({ description: "经过的分钟数" }),
      memory_tags: Type.Optional(Type.Array(Type.Object({
        target: Type.String({ description: "NPC 名" }),
        tag: Type.String({ description: "记忆标签，如'接受了维的帮助'" }),
      }))),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, updateNPCSchedules, refreshWeather, addMemoryTag, stampRoom } = await import("./engine/state.ts");
      const { advanceMinutes } = await import("./engine/time.ts");
      const mins = params.elapsed_minutes;
      if (gameState.time.minute_of_day === undefined) gameState.time.minute_of_day = 480;
      const result = advanceMinutes(gameState.time, mins);
      gameState.player.age = gameState.time.player_age;
      gameState.turn++;
      if (gameState.turn % 4 === 0) refreshWeather();
      const events = await updateNPCSchedules();
      // 疲劳累积
      gameState.player.fatigue = Math.min(100, (gameState.player.fatigue ?? 0) + Math.round(mins / 12));

      if (params.memory_tags && params.memory_tags.length > 0) {
        for (const m of params.memory_tags) {
          addMemoryTag(m.target, m.tag, 7);
        }
      }

      stampRoom();
      saveState();

      const dayInfo = result.daysAdvanced > 0 ? ` 跨${result.daysAdvanced}天` : "";
      const textResult = `场景结束推进了 ${mins}分钟 → ${result.newDate} ${result.dayOfWeek}曜日 ${result.timeOfDay}${dayInfo}。\n` +
        `日程更新: ${events.length > 0 ? events.join("; ") : "无特殊事件"}\n` +
        `写入记忆: ${params.memory_tags && params.memory_tags.length > 0 ? params.memory_tags.map(m => `${m.target}(${m.tag})`).join(", ") : "无"}`;
      return { content: [{ type: "text", text: textResult }], details: { time: gameState.time, events, memory_tags: params.memory_tags } };
    },
  });

  // ── Layer 2 回合台账 ──
  pi.registerTool({
    name: "record_turn_log", label: "回合台账",
    description: "记录GM导演单到回合台账。settle_scene后调用。playerAction:玩家做了什么/resolvedChanges:工具落地的变化/sceneResult:场景结果一句话/openHooks:未收口钩子(无则'无')/nextPressure:下轮推动(无则'无')",
    parameters: Type.Object({
      playerAction: Type.String({ description: "玩家实际做了什么" }),
      resolvedChanges: Type.String({ description: "本轮工具落地的变化，无则写'无'" }),
      sceneResult: Type.String({ description: "场景结果，一句话" }),
      openHooks: Type.String({ description: "未收口的钩子，无则写'无'" }),
      nextPressure: Type.String({ description: "下轮应推动什么，无则写'无'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { recordTurnLog } = await import("./engine/state.ts");
      const entry = recordTurnLog({
        playerAction: params.playerAction,
        resolvedChanges: params.resolvedChanges,
        sceneResult: params.sceneResult,
        openHooks: params.openHooks,
        nextPressure: params.nextPressure,
        toolsCalled: [], // 引擎自动从本轮工具调用补充
      });
      return { content: [{ type: "text", text: `台账已记录 (第${entry.turn}回合)` }], details: entry };
    },
  });

  // ── Layer 3 秘密揭示 ──
  pi.registerTool({
    name: "reveal_secret", label: "揭示秘密",
    description: "将秘密从隐藏级提升为可见级。id:秘密标识/content:揭示内容/fromLevel:当前级别/toLevel:目标级别。如揭露NPC秘密: fromLevel=hidden_canonical toLevel=scene_public",
    parameters: Type.Object({
      id: Type.String({ description: "秘密标识" }),
      content: Type.String({ description: "揭示的内容描述" }),
      fromLevel: Type.String({ description: "当前可见级别: hidden_canonical/protagonist_known/player_known/scene_public" }),
      toLevel: Type.String({ description: "目标可见级别" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { revealSecret, gameState } = await import("./engine/state.ts");
      const r = revealSecret(params.id, params.content, params.fromLevel as any, params.toLevel as any);
      return { content: [{ type: "text", text: `秘密已揭示: ${r.id} (${r.fromLevel} → ${r.toLevel})` }], details: r };
    },
  });

  // ── Layer 4 两段式渲染 ──
  pi.registerTool({
    name: "render_scene", label: "渲染场景",
    description: "结算轮完成后调用。传入导演单，引擎调用渲染模型（Flash）产出纯叙事正文。调用后直接输出返回值，禁止再调任何工具。",
    parameters: Type.Object({
      playerAction: Type.String({ description: "玩家实际做了什么" }),
      resolvedChanges: Type.String({ description: "本轮工具落地的变化，无则写'无'" }),
      sceneResult: Type.String({ description: "场景结果，一句话" }),
      openHooks: Type.String({ description: "未收口的钩子，无则写'无'" }),
      nextPressure: Type.String({ description: "下轮推动方向，无则写'无'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getRecentTurnLogContext } = await import("./engine/state.ts");
      const recentContext = getRecentTurnLogContext(3);
      const renderPrompt = [
        "你是 earth-0 的渲染 GM。结算已完成。",
        "",
        "导演单：",
        `玩家行动: ${params.playerAction}`,
        `状态变化: ${params.resolvedChanges}`,
        `场景结果: ${params.sceneResult}`,
        `开放钩子: ${params.openHooks || "无"}`,
        `推动方向: ${params.nextPressure || "无"}`,
        "",
        recentContext ? `前情摘要: ${recentContext}\n` : "",
        "规则：≤2段叙事+≤5句对白。融入身体触觉（支撑点）。微观空间定位准确。对话用「」或『』。结尾输出4个扮演选项（按gm-contract格式: ---分割线+> blockquote+[风格]+圈号）。绝对不分析心理。不替玩家说话。",
        "",
        "现在输出纯叙事正文：",
      ].join("\n");

      try {
        const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
        const res = await fetch("https://api.deepseek.com/anthropic/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": DEEPSEEK_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "deepseek-v4-pro", max_tokens: 4096, messages: [{ role: "user", content: renderPrompt }] }),
        });
        if (!res.ok) {
          // 降级：返回渲染提示给 GM 自己写
          return { content: [{ type: "text", text: renderPrompt + "\n(渲染模型调用失败，请GM自行输出叙事)" }], details: {} };
        }
        const data = await res.json() as any;
        const prose = data?.content?.[0]?.text ?? "";
        if (!prose) {
          return { content: [{ type: "text", text: renderPrompt + "\n(渲染模型返回为空，请GM自行输出叙事)" }], details: {} };
        }
        return { content: [{ type: "text", text: prose }], details: {} };
      } catch {
        return { content: [{ type: "text", text: renderPrompt + "\n(渲染模型调用失败，请GM自行输出叙事)" }], details: {} };
      }
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
    name: "set_npc_outfit", label: "NPC换装",
    description: "切换NPC服装卡。outfit: school|pe|swim|casual|sleep。引擎自动注入服装上下文。",
    parameters: Type.Object({
      npc: Type.String({ description: "NPC 名" }),
      outfit: Type.String({ description: "服装卡：school / pe / swim / casual / sleep" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { setNPCOutfit, saveState } = await import("./engine/state.ts");
      const r = setNPCOutfit(params.npc, params.outfit);
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "mount_vehicle", label: "骑乘载具",
    description: "骑上载具(自行车/摩托车/汽车)。移动速度按倍率提升。",
    parameters: Type.Object({
      item: Type.String({ description: "载具物品名，如'自行车'、'摩托车'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { mountVehicle } = await import("./engine/state.ts");
      const r = mountVehicle(params.item);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "dismount_vehicle", label: "下车",
    description: "下车上马，恢复步行速度。载具放回背包。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { dismountVehicle } = await import("./engine/state.ts");
      const r = dismountVehicle();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "board_train", label: "乘电车",
    description: "从当前所在车站乘电车。读city_map.json时刻表，触发旅行叙事模式。",
    parameters: Type.Object({
      from: Type.String({ description: "出发站名" }),
      to: Type.String({ description: "目的站名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      // 查时刻表
      const cityMap = await import("./data/city_map.json", { with: { type: "json" } });
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
      const { gameState, saveState } = await import("./engine/state.ts");
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
  });

  pi.registerTool({
    name: "create_location", label: "创建地点",
    description: "创建新地点（如新咖啡店、秘密基地）。引擎自动加入导航层级。parent: 上级地名。",
    parameters: Type.Object({
      parent: Type.String({ description: "上级地名，如'千叶县'、'东京都'、'千叶市'" }),
      name: Type.String({ description: "新地点名称" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createDynamicLocation } = await import("./engine/state.ts");
      const r = createDynamicLocation(params.parent, params.name);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "buy_item", label: "购买",
    description: "购买物品。LLM定价，引擎校验价格范围(economy.json)。",
    parameters: Type.Object({ item: Type.String(), price: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { buyItem } = await import("./engine/state.ts");
      const r = buyItem(params.item, params.price);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "identity_check", label: "身份检定",
    description: "身份检定(魅力/隐藏技能)。警察/保安等强检查时调用。",
    parameters: Type.Object({
      difficulty: Type.String({ description: "简单/普通/困难/极难/不可能" }),
      skillLevel: Type.Optional(Type.Number({ description: "玩家相关伪装或欺瞒技能等级" }))
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, updateReputation, getEquipmentBonus } = await import("./engine/state.ts");
      const { identityCheck } = await import("./engine/dice.ts");
      const loc = gameState.player.location;
      // 装备加成: 魅力属性加成 + 社交加成（校内穿制服等）
      const attrBonus = getEquipmentBonus(gameState.player.equipment, "attribute_bonus", "魅力");
      const socialBonus = getEquipmentBonus(gameState.player.equipment, "social_bonus", loc);
      const effectiveCha = gameState.player.attributes.魅力 + attrBonus;
      const effectiveSkill = (params.skillLevel || 0) + socialBonus;
      const r = identityCheck(params.difficulty as any, effectiveCha, effectiveSkill);
      let text = `[身份检定] 难度: ${params.difficulty} | 检定值: ${r.roll.total} vs DC ${r.roll.dc}\n`;

      if (r.success) {
        text += "✅ 检定成功，身份未被识破。";
      } else {
        text += "❌ 检定失败！身份被识破！";
        gameState.flags.identity_exposed = true;

        // 根据所在区域自动施加后果（loc 已在上方声明）
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
    description: "出售物品。LLM定价，引擎校验价格范围(economy.json)。",
    parameters: Type.Object({ item: Type.String(), price: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { sellItem } = await import("./engine/state.ts");
      const r = sellItem(params.item, params.price);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "monthly_growth", label: "成长",
    description: "月末发育结算。传入diet(普通|节食|高蛋白|丰胸)和exercise(普通|规律|高强度)。",
    parameters: Type.Object({ diet: Type.String(), exercise: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { monthlyGrowth } = await import("./engine/state.ts");
      const r = monthlyGrowth(params.diet, params.exercise);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "work_job", label: "打工",
    description: "打工赚钱。jobName: 便利店|送报纸|家教|餐厅|发传单。引擎推进时间+扣疲劳。",
    parameters: Type.Object({
      jobName: Type.String({ description: "工作名称：便利店/送报纸/家教/餐厅/发传单" }),
      hours: Type.Number({ description: "工作时长（小时）" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { workJob, saveState } = await import("./engine/state.ts");
      const r = workJob(params.jobName, params.hours);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "complete_travel", label: "完成旅行",
    description: "完成旅行叙事：玩家到达目的地+推进时间+清除pendingTravel。",
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
    description: "剧情生成物品放入背包。须提供source和reason。禁止绕过buy_item/steal_item正常获取。",
    parameters: Type.Object({
      target: Type.String({ description: "接收者：'玩家' 或 NPC 名" }),
      item: Type.Object({
        name: Type.String(),
        type: Type.String({ description: "weapon / clothing / armor / tool / consumable" }),
        slot: Type.String({ description: "装备槽位" }),
        weight: Type.Number(),
        volume: Type.Number({ description: "体积（升）" }),
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
      const { gameState, saveState, getOrCreateNPC, checkAddVolume } = await import("./engine/state.ts");
      const targetChar = (params.target === "玩家" || params.target === gameState.player.name)
        ? gameState.player
        : getOrCreateNPC(params.target);

      // Validate damage for weapon
      if (params.item.type === "weapon" && !params.item.damage) {
        return { content: [{ type: "text", text: "错误: weapon 类型的物品必须指定 damage 参数" }], details: {} };
      }
      if (!params.item.volume || params.item.volume < 0) {
        return { content: [{ type: "text", text: "错误: 物品必须指定 volume（体积，升）" }], details: {} };
      }

      // 体积校验（仅玩家）
      if (params.target === "玩家" || params.target === gameState.player.name) {
        const volCheck = checkAddVolume(
          gameState.player.inventory,
          gameState.player.equipment,
          { volume: params.item.volume, name: params.item.name }
        );
        if (!volCheck.ok && volCheck.severity !== "bulging") {
          return { content: [{ type: "text", text: volCheck.narrative }], details: volCheck };
        }
      }

      const flavorSuffix = `来源: ${params.source}`;
      const itemObj: any = {
        name: params.item.name,
        type: params.item.type,
        slot: params.item.slot,
        weight: params.item.weight,
        volume: params.item.volume,
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
    description: "环境/剧情HP伤害。不经战斗检定。target: 玩家|NPC名。",
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
    name: "lookup_body", label: "查身体",
    description: "查询角色身体数据(三围/cup/体型)及性器官档案。type: basic|full。按需调用，避免默认注入浪费token。",
    parameters: Type.Object({
      name: Type.String({ description: "角色名" }),
      type: Type.Optional(Type.String({ description: "basic(仅身体数据) / full(含器官档案)，默认 full" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, getBodyForAge, getNpcCurrentAge, getOrCreateSexState } = await import("./engine/state.ts");
      const { allChars } = await import("./engine/router.ts");
      const isPlayer = params.name === gameState.player.name || params.name === "玩家";

      // 身体数据
      let body: any = null;
      if (isPlayer) {
        body = gameState.player.body;
      } else {
        const c = allChars.find((x: any) => x.name === params.name);
        if (!c) return { content: [{ type: "text", text: `无此角色: ${params.name}` }], details: {} };
        const age = getNpcCurrentAge(c.base_age || 16);
        body = getBodyForAge(c, age);
      }

      const result: any = { name: params.name, body };

      // 器官档案（仅 full 模式）
      if (params.type !== "basic") {
        try {
          let profile: any = null;
          if (isPlayer && gameState.player.sex) {
            profile = gameState.player.sex.profile;
          } else {
            const sState = await getOrCreateSexState(params.name);
            if (sState) profile = sState.profile;
          }
          if (profile) {
            const safe: any = {};
            if (profile.female) {
              safe.female = {
                breast: profile.female.breast,
                vagina: profile.female.vagina,
                pubic_hair: profile.female.pubic_hair,
                clitoris: profile.female.clitoris,
              };
            }
            if (profile.male) {
              safe.male = {
                penis: profile.male.penis,
                testicles: profile.male.testicles,
                pubic_hair: profile.male.pubic_hair,
              };
            }
            safe.bodyParts = profile.bodyParts;
            safe.attitude = profile.attitude;
            safe.experience = profile.experience;
            result.sex_profile = safe;
          }
        } catch (_) {}
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerTool({
    name: "lookup_lore", label: "查设定",
    description: "搜索世界观设定(data/lore/)。按关键词匹配。如'侍奉部规则'、'英灵召唤条件'。",
    parameters: Type.Object({
      keyword: Type.String({ description: "搜索关键词，如'侍奉部'、'魔术协会'、'千叶地理'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const LORE_DIR = path.resolve(process.cwd(), "data", "lore");
      const kw = params.keyword.toLowerCase();
      const results: { title: string; text: string }[] = [];

      if (fs.existsSync(LORE_DIR)) {
        for (const f of fs.readdirSync(LORE_DIR)) {
          if (!f.endsWith(".json")) continue;
          try {
            const data = JSON.parse(fs.readFileSync(path.join(LORE_DIR, f), "utf-8"));
            for (const [title, entry] of Object.entries(data) as any) {
              const etags = (entry.tags || []).map((t: string) => t.toLowerCase());
              const etext = (entry.text || "").toLowerCase();
              if (title.toLowerCase().includes(kw) || etags.some((t: string) => t.includes(kw)) || etext.includes(kw)) {
                results.push({ title, text: entry.text?.slice(0, 500) || "" });
              }
            }
          } catch (_) {}
        }
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: `未找到与「${params.keyword}」相关的设定资料。` }], details: {} };
      }
      const output = results.map(r => `## ${r.title}\n${r.text}`).join("\n\n---\n\n");
      return { content: [{ type: "text", text: output }], details: { count: results.length } };
    },
  });

  pi.registerTool({
    name: "add_memory_tag", label: "记忆标签",
    description: "写入NPC记忆标签。注入后续prompt。默认7天过期。",
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

  // ── 剧情任务工具（timeline.ts）──

  pi.registerTool({
    name: "open_quest", label: "开启任务",
    description: "剧情钩子→活跃任务。仅当玩家明确接受委托后调用。",
    parameters: Type.Object({
      eventId: Type.String({ description: "事件ID，来自 active_hooks 中的 event_id" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { openQuest, getActiveQuests } = await import("./engine/timeline.ts");
      const { saveState } = await import("./engine/state.ts");
      const r = openQuest(params.eventId);
      saveState();
      if (!r) return { content: [{ type: "text", text: `开启任务失败: ${params.eventId}` }], details: {} };
      const quests = getActiveQuests();
      return { content: [{ type: "text", text: `${r}\n当前活跃任务: ${quests.map(q => q.title).join("、") || "无"}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "advance_quest", label: "推进任务",
    description: "推进任务节拍。可选outcomeKey指定玩家选择的分支。",
    parameters: Type.Object({
      eventId: Type.String({ description: "任务事件ID" }),
      outcomeKey: Type.Optional(Type.String({ description: "玩家选择的分支key，如'一起指导做曲奇'" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { advanceQuest, getActiveQuests } = await import("./engine/timeline.ts");
      const { saveState } = await import("./engine/state.ts");
      const r = advanceQuest(params.eventId, params.outcomeKey);
      saveState();
      if (!r) return { content: [{ type: "text", text: `推进任务失败: ${params.eventId}` }], details: {} };
      return { content: [{ type: "text", text: r }], details: {} };
    },
  });

  pi.registerTool({
    name: "abandon_quest", label: "放弃任务",
    description: "放弃活跃任务。玩家拒绝或无法继续时调用。",
    parameters: Type.Object({
      eventId: Type.String({ description: "要放弃的任务事件ID" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { abandonQuest, getActiveQuests } = await import("./engine/timeline.ts");
      const { saveState } = await import("./engine/state.ts");
      const r = abandonQuest(params.eventId);
      saveState();
      return { content: [{ type: "text", text: r || `已放弃: ${params.eventId}` }], details: {} };
    },
  });

  // ── 手机工具（使用 phone.ts 引擎）──

  pi.registerTool({
    name: "check_phone", label: "查看手机",
    description: "查看手机未读通知+通讯录。自动同步好感联系人。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { getPlayerPhoneData, syncContactsFromRelationships, getUnreadSummary } =
        await import("./engine/phone.ts");
      const pd = getPlayerPhoneData();
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机或手机数据未初始化。" }], details: {} };
      }
      syncContactsFromRelationships(pd);
      const summary = getUnreadSummary(pd);
      const contactList = pd.contacts.map(c => `${c.name} (${c.relation})`).join("、");
      const text = [
        summary || "[手机] 没有新通知。",
        `通讯录(${pd.contacts.length}人): ${contactList || "空"}`,
      ].join("\n");
      return { content: [{ type: "text", text }], details: { unreadCount: pd.unreadCount, contacts: pd.contacts.length } };
    },
  });

  pi.registerTool({
    name: "send_sms", label: "发送短信",
    description: "向NPC发送短信。需在通讯录中且好感≥40。",
    parameters: Type.Object({
      to: Type.String({ description: "收信NPC名称" }),
      text: Type.String({ description: "短信内容" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getPlayerPhoneData, canContact, deliverMessage } =
        await import("./engine/phone.ts");
      const { gameState, saveState } = await import("./engine/state.ts");
      const pd = getPlayerPhoneData();
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机。" }], details: {} };
      }
      if (!canContact(pd, params.to)) {
        const contact = pd.contacts.find(c => c.name === params.to);
        if (!contact) {
          return { content: [{ type: "text", text: `${params.to} 不在你的通讯录中。` }], details: {} };
        }
        return { content: [{ type: "text", text: `与 ${params.to} 的好感度不足（需>=40，当前通讯录可见需>=20）。` }], details: {} };
      }
      const msg = deliverMessage(pd, gameState.player.name, params.to, params.text);
      saveState();
      return {
        content: [{ type: "text", text: `已向 ${params.to} 发送短信: "${params.text}"` }],
        details: { message: msg },
      };
    },
  });

  pi.registerTool({
    name: "browse_sns", label: "浏览社交",
    description: "浏览社交时间线(mixi/Twitter)。了解角色动态。",
    parameters: Type.Object({
      platform: Type.Optional(Type.String({ description: "'mixi' 或 'twitter'，不传则返回全部" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getPlayerPhoneData } = await import("./engine/phone.ts");
      const pd = getPlayerPhoneData();
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机。" }], details: {} };
      }
      let posts = pd.snsPosts;
      if (params.platform) {
        posts = posts.filter(p => p.platform === params.platform);
      }
      if (posts.length === 0) {
        return { content: [{ type: "text", text: "时间线上没有帖子。" }], details: {} };
      }
      const recent = posts.slice(-10).reverse();
      const text = recent.map(p =>
        `[${p.platform}] ${p.author}: ${p.text}  ❤️${p.likes}  ${p.timestamp}`
      ).join("\n");
      return { content: [{ type: "text", text }], details: { posts: recent } };
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

      const nextThreshold = (aff: number): string => {
        if (aff < 20) return `距「熟人」(20) 还差 ${20 - aff}`;
        if (aff < 40) return `距「友人」(40) 还差 ${40 - aff}`;
        if (aff < 70) return `距「信赖」(70) 还差 ${70 - aff}`;
        if (aff < 90) return `距「至交」(90) 还差 ${90 - aff}`;
        return `已满 (100)`;
      };

      const romanceCondition = (rel: any): string => {
        if (!rel.romance) {
          if (rel.affection >= 60) return "💕 可触发「暧昧」(好感≥60，需特殊事件)";
          return `💕 暧昧需好感≥60 (当前${rel.affection})`;
        }
        if (rel.romance === "暧昧") return `💕 → 恋人: 需好感≥80 + 告白事件`;
        if (rel.romance === "恋人") return `💕 → 灵魂伴侣: 需好感≥95 + 深度事件`;
        return `💕 已达最高`;
      };

      for (const [n, r] of Object.entries(rels)) {
        const rel = r as any;
        lines.push(`👥 ${n}`);
        lines.push(`  |-[好感]: ${buildBar(rel.affection)} (${rel.affection}/100) | ${rel.stage}`);
        lines.push(`  |-[进阶]: ${nextThreshold(rel.affection)}`);
        lines.push(`  |-[恋爱]: ${romanceCondition(rel)}`);
        if (rel.romance) lines.push(`  |-[关系]: 💕${rel.romance}`);
        if (rel.notes) lines.push(`  |-[备注]: ${rel.notes}`);
        // 变化历史（最近5条）
        if (rel.history && rel.history.length > 0) {
          const recent = rel.history.slice(-5);
          lines.push(`  |-[最近变动]:`);
          for (const h of recent.reverse()) {
            const sign = h.delta >= 0 ? "+" : "";
            lines.push(`      ${h.date} ${sign}${h.delta}: ${h.reason}`);
          }
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
      const { gameState, getBodyForAge, getNpcCurrentAge, getOrCreateNPC, getNPCOutfitDesc, getAppearanceForAge } = await import("./engine/state.ts");
      const { allChars } = await import("./engine/router.ts");
      
      const isPlayer = name === gameState.player.name || name === "玩家" || name === "我";
      if (isPlayer) {
        const p = gameState.player;
        const lines = [
          `${p.name} | ${p.gender} | ${p.age}岁 | ${gameState.time.player_stage}`,
          `── 基本 ──`,
          `位置: ${p.location}  资金: ¥${p.funds}  疲劳: ${p.fatigue ?? 0}/100`,
          `HP: ${p.hp.current}/${p.hp.max}  AC: ${p.ac}`,
        ];
        if (p.body) {
          lines.push(`── 身体 ──`);
          const b = p.body;
          lines.push(`身材: ${b.height_cm}cm ${b.weight_kg}kg ${b.build}${b.cup ? " " + b.cup + "cup" : ""}`);
          if (b.measurements) lines.push(`三围: ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`);
          if (b.leg_type || b.skin) {
            let feats = `特征: `;
            if (b.leg_type) feats += `${b.leg_type}腿 | `;
            if (b.skin) feats += `肤质:${b.skin.texture} | 肤色:${b.skin.base_tone}`;
            lines.push(feats.replace(/ \|\s*$/, ""));
          }
        }
        if (p.attributes) {
          lines.push(`── 属性 ──`);
          const a = p.attributes;
          lines.push(`力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        if (p.reputation && Object.keys(p.reputation).length > 0) {
          lines.push(`── 声望 ──`);
          lines.push(Object.entries(p.reputation).map(([k, v]) => `${k}(${v})`).join(" | "));
        }
        const eq = Object.entries(p.equipment).filter(([_, v]) => v);
        if (eq.length > 0) {
          lines.push(`── 装备 ──`);
          const flavorMap = new Map<string, string>();
          try {
            const itemsCatalog = (await import("./data/items.json", { with: { type: "json" } })).default;
            for (const cat of Object.values(itemsCatalog as any)) {
              for (const [iname, item] of Object.entries(cat as any)) {
                if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
              }
            }
          } catch (_) {}
          const SLOT_NAMES: Record<string, string> = {
            top: "外套", shirt: "内搭", inner_top: "胸罩", bottom: "下装", inner_bot: "内裤",
            legs: "袜", feet: "鞋", head: "头饰", acc: "配饰", left_hand: "副手", right_hand: "主手", back: "背"
          };
          eq.forEach(([s, it]) => {
            const flavor = flavorMap.get(it!.name);
            lines.push(`[${SLOT_NAMES[s] || s}] ${flavor ? `${it!.name}（${flavor}）` : it!.name}`);
          });
        }
        await showPanel(ctx, p.name, lines);
        return;
      }

      const char = allChars.find((c: any) => c.name === name || c.name.includes(name));
      if (char) {
        const age = getNpcCurrentAge(char.base_age || 16);
        const body = getBodyForAge(char, age);
        const lines = [
          `${char.name} | ${char.gender === "female" ? "女" : "男"} | ${age}岁 (基础:${char.base_age})`,
          `── 外观 ──`
        ];
        
        const outfitRaw = getNPCOutfitDesc(char.name);
        const outfitParts = outfitRaw.split("。内: ");
        lines.push(`穿着: ${outfitParts[0]}`);
        if (outfitParts[1]) lines.push(`内衣: ${outfitParts[1]}`);

        // 结构化外貌（按年龄分层）
        const appLook = getAppearanceForAge(char, age);
        const hairEyeParts: string[] = [];
        const hairDesc = [appLook.hair_color, appLook.hair_style].filter(Boolean).join("");
        if (hairDesc) hairEyeParts.push(`💇 ${hairDesc}`);
        if (appLook.eye_color) hairEyeParts.push(`👁 ${appLook.eye_color}眼睛`);
        if (appLook.hair_accessories) hairEyeParts.push(`🎀 ${appLook.hair_accessories}`);
        if (hairEyeParts.length > 0) lines.push(hairEyeParts.join(" | "));

        if (body) {
          lines.push(`── 身体 ──`);
          lines.push(`身材: ${body.height_cm}cm ${body.weight_kg}kg ${body.build}`);
          let meas = `三围: `;
          if (body.measurements) meas += `${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
          if (body.cup) meas += ` (${body.cup}cup)`;
          if (body.body_shape) {
             const bs = body.body_shape;
             meas += ` [${bs.chest||""} ${bs.waist||""} ${bs.hips?bs.hips+"臀":""}]`;
          }
          if (meas !== `三围: `) lines.push(meas.replace(/\s+/g, ' '));
          
          let feats = `特征: `;
          if (body.leg_type) feats += `${body.leg_type}腿 | `;
          if (body.skin) feats += `肤质:${body.skin.texture} | 肤色:${body.skin.base_tone}`;
          if (feats !== `特征: `) lines.push(feats.replace(/ \|\s*$/, ''));
        }
        
        if (char.attributes) {
          lines.push(`── 属性 ──`);
          const a = char.attributes;
          lines.push(`力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        
        const npcState = getOrCreateNPC(char.name);
        
        lines.push(`── 动态 ──`);
        lines.push(`位置: ${npcState.currentRoom || "未知"}`);
        lines.push(`行为: ${npcState.action || "无"}`);
        lines.push(`日程组: ${npcState.scheduleGroup || char.schedule_group || "无"}`);

        // 与玩家的关系
        const rel = gameState.player.relationships[char.name];
        if (rel) {
          lines.push(`── 关系 ──`);
          const buildBar = (val: number) => { const f = Math.round(val / 20); return "■".repeat(f) + "□".repeat(5 - f); };
          let relLine = `好感: ${buildBar(rel.affection)} (${rel.affection}/100) | ${rel.stage}`;
          if (rel.romance) relLine += ` | 💕${rel.romance}`;
          lines.push(relLine);
          if (rel.notes) lines.push(`备注: ${rel.notes}`);
        }
        
        // 装备 flavor 速查
        const flavorMap = new Map<string, string>();
        try {
          const itemsCatalog = (await import("./data/items.json", { with: { type: "json" } })).default;
          for (const cat of Object.values(itemsCatalog as any)) {
            for (const [iname, item] of Object.entries(cat as any)) {
              if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
            }
          }
        } catch (_) {}

        const clothingSlots = ['top', 'shirt', 'inner_top', 'bottom', 'inner_bot', 'legs', 'feet'];
        const eq = Object.entries(npcState.equipment).filter(([k, v]) => v && !clothingSlots.includes(k));
        if (eq.length > 0) {
          lines.push(`── 携带装备 ──`);
          const SLOT_NAMES: Record<string, string> = {
            head: "头部/发饰", acc: "配饰/挂件", left_hand: "副手/左手", right_hand: "主手/右手", back: "背部/背包"
          };
          eq.forEach(([s, it]) => {
            const flavor = flavorMap.get(it!.name);
            lines.push(`[${SLOT_NAMES[s]||s}] ${flavor ? `${it!.name}（${flavor}）` : it!.name}`);
          });
        }
        
        if (npcState.inventory && npcState.inventory.length > 0) {
          lines.push("────────────────────────────────────────");
          lines.push(`🎒 携带物品:`);
          const items = npcState.inventory.map((i: any) => i.name);
          for (let i = 0; i < items.length; i += 3) {
            lines.push(`  ${items.slice(i, i + 3).join(" | ")}`);
          }
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
            if (char.appearance_brief || char.hair_color || char.hair_style || char.eye_color) {
              const hairDesc = [char.hair_color, char.hair_style].filter(Boolean).join("");
              const appearanceParts: string[] = [];
              if (hairDesc) appearanceParts.push(hairDesc);
              if (char.eye_color) appearanceParts.push(`${char.eye_color}眼睛`);
              if (char.hair_accessories) appearanceParts.push(char.hair_accessories);
              const appearanceStr = appearanceParts.length > 0 ? appearanceParts.join("、") : char.appearance_brief;
              lines.push(`   外貌: ${appearanceStr}`);
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
        const { getDisguiseIdentity } = await import("./engine/state.ts");
        const disguise = getDisguiseIdentity(gameState.player);
        const manual = gameState.player.public_identity || "总武高学生";
        const info = disguise ? `${manual} | 🎭 装备伪装: ${disguise}` : manual;
        ctx.ui.notify(`当前公开身份: ${info}`, "info");
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
          lines.push(`阴蒂: ${p.female.clitoris}`);
        } else if (p.male) {
          lines.push(``);
          const circum = p.male.penis.circumcised ? "已割" : "未割";
          lines.push(`阴茎: ${p.male.penis.length_cm}cm × ${p.male.penis.girth_cm}cm ${p.male.penis.shape} ${p.male.penis.head_size}头 ${circum} ${p.male.penis.color}色`);
          lines.push(`睾丸: ${p.male.testicles.size}`);
        }
        // 可用体位
        try {
          const { getAvailableActions } = await import("./engine/sex.ts");
          let posDB: any = null;
          try { posDB = (await import("./data/positions.json", { with: { type: "json" } })).default; } catch (_) {}
          const avail = getAvailableActions(p, s, posDB);
          if (avail.actions.length > 0 || avail.positions.length > 0) {
            lines.push(``);
            lines.push(`可用动作: ${avail.actions.join("、")}`);
            if (avail.positions.length > 0) lines.push(`可用体位: ${avail.positions.join("、")}`);
            if (avail.locked.length > 0) lines.push(`🔒 锁定: ${avail.locked.join("、")}`);
            if (avail.lockedPositions.length > 0) lines.push(`🔒 体位解锁: ${avail.lockedPositions.join("、")}`);
          }
        } catch (_) {}
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

      const timeOfDayZH: Record<string, string> = { dawn: "拂晓", morning: "上午", noon: "正午", afternoon: "下午", evening: "傍晚", night: "深夜" };
      lines.push(`📍 当前场景: ${loc}`);
      lines.push(`🕐 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${timeOfDayZH[gameState.time.time_of_day] || gameState.time.time_of_day}`);
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

        const agingLine = getRoomAgingLine(loc);
        if (agingLine) {
          lines.push(`🕸️ 久置痕迹: ${agingLine}`);
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
              const lockTag = cell.locked ? "🔐" : cell.isOpen === false ? "🔒" : "";
              exits.push(`${cell.exitTo || "出口"}(${x},${y})${lockTag}`);
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

  // ── /train 通勤面板 ──
  pi.registerCommand("train", {
    description: "电车通勤：查看当前区域车站，购票乘车",
    handler: async (_args, ctx) => {
      const { gameState, saveState, getLocationNav } = await import("./engine/state.ts");
      const loc = gameState.player.location;
      const nav = getLocationNav(loc);

      // 加载车站数据
      let cityMap: any = null;
      try { cityMap = (await import("./data/city_map.json", { with: { type: "json" } })).default; } catch (_) {}

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
            detail: `约${mins}分钟 | ¥${Math.round(mins * 20)}`,
            action: async (destDone) => {
              const fare = Math.round(mins * 20);
              if (gameState.player.funds < fare) {
                ctx.ui.notify(`资金不足！需要 ¥${fare}，当前 ¥${gameState.player.funds}`, "warning");
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
              ctx.ui.notify(`🚃 从 ${s.stationName} 出发，前往 ${dest}。¥${fare}`, "info");
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
  });

  // ── /bag 背包交互面板 ──
  pi.registerCommand("bag", {
    description: "背包管理：查看/筛选/使用物品",
    handler: async (_args, ctx) => {
      const { gameState, saveState, checkAddVolume } = await import("./engine/state.ts");
      const p = gameState.player;

      const rerender = (filter: string, sort: string, done: any) => {
        let items = [...p.inventory];
        // 过滤
        if (filter === "weapon") items = items.filter((i: any) => i.type === "weapon");
        else if (filter === "consumable") items = items.filter((i: any) => i.type === "consumable");
        else if (filter === "clothing") items = items.filter((i: any) => i.type === "clothing" || i.type === "armor");
        else if (filter === "equipped") {
          items = Object.values(p.equipment).filter(Boolean) as any[];
        }
        // 排序
        if (sort === "weight") items.sort((a: any, b: any) => (b.weight || 0) - (a.weight || 0));
        else if (sort === "name") items.sort((a: any, b: any) => a.name.localeCompare(b.name, "zh"));

        const lines: string[] = [];
        const volUsed = p.inventory.reduce((s: number, i: any) => s + (i.volume || 0), 0);
        const volMax = 30; // 默认背包容量
        lines.push(`🎒 背包 (${p.inventory.length}件 | ${volUsed.toFixed(1)}/${volMax}L) | 资金 ¥${p.funds}`);
        lines.push(`筛选: ${filter === "all" ? "全部" : filter} | 排序: ${sort === "name" ? "名称" : sort === "weight" ? "重量" : "默认"}`);
        lines.push("────────────────────────────────────────");

        if (items.length === 0) {
          lines.push("（空）");
        } else {
          const display = items.slice(0, 30); // 最多显示30件
          display.forEach((item: any, idx: number) => {
            const tag = item.type ? `[${item.type.slice(0, 2)}]` : "";
            const wt = item.weight ? `${item.weight}kg` : "";
            const vol = item.volume ? `${item.volume}L` : "";
            const state = item.state === "damaged" ? "⚠️" : item.state === "ruined" ? "💀" : "";
            lines.push(`${idx + 1}. ${tag} ${item.name} ${wt} ${vol} ${state}`);
            if (item.effects?.length > 0) {
              const effStr = item.effects.map((e: any) => `${e.type}:${e.value}`).join(" ");
              lines.push(`   效果: ${effStr}`);
            }
          });
          if (items.length > 30) lines.push(`  ... 还有 ${items.length - 30} 件`);
        }

        lines.push("────────────────────────────────────────");
        lines.push("按键: [A]全部 [W]武器 [C]消耗品 [T]服装 [E]已装备 | [N]名称排序 [G]重量排序");
        lines.push("[U]使用消耗品 [D]丢弃物品 | [Q]退出");

        ctx.ui.custom(
          (tui: any, _theme: any, _kb: any, doneCb: any) => {
            return {
              render(_termW: number): string[] { return lines; },
              handleInput(d: string) {
                const key = d.toLowerCase();
                if (key === "q") { doneCb(); done(); }
                else if (key === "a") rerender("all", sort, done);
                else if (key === "w") rerender("weapon", sort, done);
                else if (key === "c") rerender("consumable", sort, done);
                else if (key === "t") rerender("clothing", sort, done);
                else if (key === "e") rerender("equipped", sort, done);
                else if (key === "n") rerender(filter, "name", done);
                else if (key === "g") rerender(filter, "weight", done);
                else if (key === "u") {
                  // 使用消耗品：列出可用的 consumable 物品
                  const consumables = p.inventory.filter((i: any) => i.type === "consumable");
                  if (consumables.length === 0) {
                    ctx.ui.notify("没有可用的消耗品", "warning");
                    return;
                  }
                  // 简单版：使用第一个消耗品（完整实现应用菜单选择）
                  const item = consumables[0];
                  const idx = p.inventory.indexOf(item);
                  if (idx >= 0) {
                    let healed = false;
                    for (const eff of item.effects || []) {
                      if (eff.type === "heal") {
                        let amt = typeof eff.value === "string" ? parseInt(eff.value) || 5 : Number(eff.value);
                        p.hp.current = Math.min(p.hp.max, p.hp.current + amt);
                        healed = true;
                      }
                    }
                    p.inventory.splice(idx, 1);
                    saveState();
                    ctx.ui.notify(`使用了 ${item.name}${healed ? `，HP ${p.hp.current}/${p.hp.max}` : ""}`, "info");
                    rerender(filter, sort, done);
                  }
                }
                else if (key === "d") {
                  if (items.length > 0) {
                    const last = items[items.length - 1];
                    const idx = p.inventory.indexOf(last);
                    if (idx >= 0) {
                      const name = p.inventory[idx].name;
                      p.inventory.splice(idx, 1);
                      saveState();
                      ctx.ui.notify(`丢弃了 ${name}`, "info");
                      rerender(filter, sort, done);
                    }
                  }
                }
              },
              invalidate() {},
            };
          },
          { overlay: true }
        );
        done();
      };

      rerender("all", "name", () => {});
    },
  });

  pi.registerCommand("quest", {
    description: "查看当前正在进行的任务与剧情线",
    handler: async (_args, ctx) => {
      const { getActiveQuests } = await import("./engine/timeline.ts");
      const { gameState } = await import("./engine/state.ts");
      const activeQuests = getActiveQuests();
      
      const items: any[] = [];
      items.push({ label: `📋 进行中的任务: (${activeQuests.length})`, detail: "" });
      items.push({ label: "────────────────────────────────────────", detail: "" });
      
      if (activeQuests.length > 0) {
        for (const q of activeQuests) {
          items.push({ label: `▶ [${q.eventId}] ${q.description || ""}`, detail: "" });
        }
      } else {
        items.push({ label: "  (当前没有正在进行的任务)", detail: "" });
      }
      
      items.push({ label: "────────────────────────────────────────", detail: "" });
      items.push({ label: `🔗 等待触发的剧情钩子: (${gameState.timeline_events?.length || 0})`, detail: "" });
      if (gameState.timeline_events && gameState.timeline_events.length > 0) {
        for (const ev of gameState.timeline_events) {
          items.push({ label: `  - ${ev.eventId} (优先级: ${ev.priority}, ${ev.type})`, detail: "" });
        }
      }
      
      const { showMenu } = await import("./engine/router.ts");
      await showMenu(ctx, `任务与剧情`, items);
    }
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



  // ── /calendar 日历事件 ──
  pi.registerCommand("calendar", {
    description: "查看今日日历事件与近期大事",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const { getTodayCalendar, getActiveQuests } = await import("./engine/timeline.ts");
      const items: MenuItem[] = [];
      items.push({ label: `📅 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日`, detail: "" });
      items.push({ label: "────────────────────────────────────────", detail: "" });

      const todayEvent = getTodayCalendar();
      if (todayEvent) {
        items.push({ label: "📌 今日事件", detail: "" });
        items.push({ label: `  ${todayEvent}`, detail: "" });
      } else {
        items.push({ label: "📌 今日: 无特殊事件", detail: "" });
      }

      items.push({ label: "────────────────────────────────────────", detail: "" });
      const quests = getActiveQuests();
      items.push({ label: `📋 进行中的任务 (${quests.length})`, detail: "" });
      if (quests.length > 0) {
        for (const q of quests) {
          items.push({ label: `  ▶ ${q.eventId}`, detail: q.description || "" });
        }
      } else {
        items.push({ label: "  (无)", detail: "" });
      }

      items.push({ label: "────────────────────────────────────────", detail: "" });
      items.push({ label: `🔗 待触发事件: ${gameState.timeline_events?.length || 0}`, detail: "" });
      if (gameState.timeline_events && gameState.timeline_events.length > 0) {
        for (const ev of gameState.timeline_events.slice(0, 10)) {
          items.push({ label: `  • ${ev.eventId}`, detail: `优先级:${ev.priority} ${ev.type}` });
        }
      }

      const { showMenu } = await import("./engine/router.ts");
      await showMenu(ctx, "📅 日历与事件", items);
    },
  });

  // ── /weather 天气预报 ──
  pi.registerCommand("weather", {
    description: "查看当前天气与未来趋势",
    handler: async (_args, ctx) => {
      const { gameState, refreshWeather } = await import("./engine/state.ts");
      const lines: string[] = [];
      const t = gameState.time;

      lines.push(`🌈 天气面板`);
      lines.push("────────────────────────────────────────");
      lines.push(`📅 ${t.game_date} ${t.day_of_week}曜日 ${t.time_of_day}`);
      lines.push(`🌤 当前: ${t.weather || gameState.flags?.weather || "晴"}`);
      lines.push(`🌡 季节: ${t.season || "春"} | 温度: ${t.temperature ?? "?"}°C`);
      lines.push("────────────────────────────────────────");
      lines.push(`下次天气更新: 游戏内约4小时后`);
      lines.push("────────────────────────────────────────");
      lines.push("提示: 天气影响移动速度、NPC出没、事件触发。");
      lines.push("暴雨天NPC倾向待在室内，下雪天操场不可用。");

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "🌈 天气", lines);
    },
  });

  // ── /alerts 警报面板 ──
  pi.registerCommand("alerts", {
    description: "查看当前生效的警报状态（通缉/暴露/警戒）",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const lines: string[] = [];
      const f = gameState.flags || {} as any;
      const alerts: { flag: string; icon: string; desc: string }[] = [];

      if ((f as any).steal_alert) alerts.push({ flag: "steal_alert", icon: "🚨", desc: `偷窃警报: ${(f as any).steal_alert}` });
      if ((f as any).school_alert) alerts.push({ flag: "school_alert", icon: "🏫", desc: `校园警戒: ${(f as any).school_alert}` });
      if ((f as any).identity_exposed) alerts.push({ flag: "identity_exposed", icon: "🎭", desc: `身份暴露: ${(f as any).identity_exposed}` });
      if ((f as any).wanted) alerts.push({ flag: "wanted", icon: "👮", desc: `被通缉: ${(f as any).wanted}` });
      if ((f as any).steal_caught_by) {
        const caught = (f as any).steal_caught_by;
        const names = Array.isArray(caught) ? caught.join("、") : String(caught);
        alerts.push({ flag: "steal_caught", icon: "👀", desc: `偷窃目击者: ${names}` });
      }

      lines.push("🚨 当前警报状态");
      lines.push("────────────────────────────────────────");
      if (alerts.length === 0) {
        lines.push("✅ 一切正常，无活跃警报");
      } else {
        for (const a of alerts) {
          lines.push(`${a.icon} ${a.desc}`);
        }
      }
      lines.push("────────────────────────────────────────");
      lines.push(`当前身份: ${gameState.player.public_identity || "未公开"}`);
      const { getDisguiseIdentity } = await import("./engine/state.ts");
      const disguise = getDisguiseIdentity(gameState.player);
      if (disguise) lines.push(`🎭 装备伪装: ${disguise}`);

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "🚨 警报", lines);
    },
  });

  // ── /memory NPC记忆标签 ──
  pi.registerCommand("memory", {
    description: "查看NPC对你的记忆标签（他们知道你什么）",
    handler: async (_args, ctx) => {
      const { gameState, getMemoryTags, getOrCreateNPC } = await import("./engine/state.ts");
      const lines: string[] = [];
      lines.push("🧠 NPC 记忆标签");
      lines.push("────────────────────────────────────────");

      const npcs = Object.keys(gameState.npcs);
      let found = false;
      for (const name of npcs) {
        const npc = getOrCreateNPC(name);
        const tags = getMemoryTags(name);
        if (tags.length > 0) {
          found = true;
          lines.push(`👤 ${name} (${npc.currentRoom || "未知位置"})`);
          for (const tag of tags) {
            lines.push(`  📌 ${tag}`);
          }
          lines.push("");
        }
      }
      if (!found) {
        lines.push("（尚无NPC对你留下记忆标签）");
        lines.push("");
        lines.push("记忆标签在关键剧情事件时由GM写入，");
        lines.push("会被注入后续对话的NPC上下文中。");
      }

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "🧠 NPC记忆", lines);
    },
  });

  // ── /growth 发育面板 ──
  pi.registerCommand("growth", {
    description: "查看玩家身体发育状态与历史",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const lines: string[] = [];
      const p = gameState.player;

      lines.push(`📈 ${p.name} 发育面板 | ${p.age}岁 ${gameState.time.player_stage}`);
      lines.push("────────────────────────────────────────");
      if (p.body) {
        const b = p.body;
        lines.push(`📏 身高: ${b.height_cm}cm | 体重: ${b.weight_kg}kg | 体型: ${b.build}`);
        if (b.measurements) {
          lines.push(`📐 三围: ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}${b.cup ? ` (${b.cup}cup)` : ""}`);
        }
        if (b.skin) {
          lines.push(`🖐 肤色: ${b.skin.base_tone} | 肤质: ${b.skin.texture}`);
        }
      }
      lines.push("────────────────────────────────────────");
      lines.push(`🍽 饮食方案: ${p.diet || "普通"}`);
      lines.push(`🏃 运动方案: ${p.exercise || "普通"}`);
      lines.push("────────────────────────────────────────");
      lines.push("方案说明:");
      lines.push("  饮食: 普通 | 节食 | 高蛋白 | 丰胸食谱");
      lines.push("  运动: 普通 | 规律运动 | 高强度训练");
      lines.push("每月末自动结算发育（/sleep 到月末触发）");
      lines.push("或调用 monthly_growth 工具手动结算。");

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "📈 发育", lines);
    },
  });

  // ── /combat 战斗面板 ──
  pi.registerCommand("combat", {
    description: "查看玩家战斗状态与周边敌对NPC",
    handler: async (_args, ctx) => {
      const { gameState, getOrCreateNPC } = await import("./engine/state.ts");
      const lines: string[] = [];
      const p = gameState.player;

      lines.push(`⚔️ 战斗状态`);
      lines.push("────────────────────────────────────────");
      lines.push(`❤️ HP: ${p.hp.current}/${p.hp.max} | 🛡️ AC: ${p.ac}`);
      lines.push(`💪 力${p.attributes.力量} 敏${p.attributes.敏捷} 体${p.attributes.体质}`);
      lines.push(`💰 资金: ¥${p.funds} | 💤 疲劳: ${p.fatigue ?? 0}/100`);

      // 装备武器
      const weapon = p.equipment.right_hand || p.equipment.left_hand;
      if (weapon && weapon.type === "weapon" && weapon.damage) {
        lines.push(`🗡 武器: ${weapon.name} (${weapon.damage.dice} ${weapon.damage.damageType})`);
      } else {
        lines.push(`👊 武器: 拳头 (1d2 钝击)`);
      }

      // 死亡豁免
      lines.push("────────────────────────────────────────");
      lines.push(`💀 死亡豁免: ${p.deathSaves?.successes || 0} 成功 / ${p.deathSaves?.failures || 0} 失败`);

      // 周边NPC战力
      lines.push("────────────────────────────────────────");
      lines.push("👥 周边 NPC 战力评估:");
      const { isSameLocation } = await import("./engine/state.ts");
      const nearbyNPCs = Object.entries(gameState.npcs)
        .filter(([_, n]) => isSameLocation(n.currentRoom, p.location));

      if (nearbyNPCs.length === 0) {
        lines.push("  (周围没有NPC)");
      } else {
        for (const [name, npc] of nearbyNPCs) {
          const npcState = getOrCreateNPC(name);
          const hp = npcState.hp || { current: 10, max: 10 };
          const attr = npcState.attributes || { 力量: 10, 敏捷: 10, 体质: 10 };
          const weapon = npcState.equipment?.right_hand || npcState.equipment?.left_hand;
          const wpnStr = weapon?.damage ? `${weapon.name}(${weapon.damage.dice})` : "徒手";
          lines.push(`  ${name}: HP${hp.current}/${hp.max} AC${10 + Math.floor((attr.敏捷 - 10) / 2)} ${wpnStr}`);
        }
      }

      lines.push("────────────────────────────────────────");
      const flags = gameState.flags || {} as any;
      if ((flags as any).steal_alert) lines.push("⚠️ 偷窃警报生效中，NPC可能敌对！");
      if ((flags as any).school_alert) lines.push("⚠️ 校园警戒中！");

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "⚔️ 战斗", lines);
    },
  });

  // ── /shop 商店面板 ──
  pi.registerCommand("shop", {
    description: "浏览附近商店货架与打工列表",
    handler: async (_args, ctx) => {
      const { gameState, getLocationNav } = await import("./engine/state.ts");
      const lines: string[] = [];
      const loc = gameState.player.location;

      lines.push(`🏪 商店与打工`);
      lines.push("────────────────────────────────────────");
      lines.push(`📍 当前位置: ${loc}`);

      // 加载商店数据
      let shops: any = null;
      try { shops = (await import("./data/shops.json", { with: { type: "json" } })).default; } catch (_) {}
      let economy: any = null;
      try { economy = (await import("./data/economy.json", { with: { type: "json" } })).default; } catch (_) {}

      // 匹配附近商店
      const nav = getLocationNav(loc);
      const foundShops: any[] = [];
      if (shops?.shops) {
        for (const [sname, sdata] of Object.entries(shops.shops) as any) {
          const sloc = sdata.location || "";
          if (loc.includes(sloc) || sloc.includes(loc) ||
              nav.breadcrumb.some((b: string) => b.includes(sloc) || sloc.includes(b))) {
            foundShops.push({ name: sname, ...sdata });
          }
        }
      }

      if (foundShops.length > 0) {
        for (const shop of foundShops) {
          lines.push("");
          lines.push(`🏬 ${shop.name} (${shop.type || "杂货"})`);
          if (shop.inventory && shop.inventory.length > 0) {
            for (const item of shop.inventory.slice(0, 8)) {
              const price = item.price ? `¥${item.price}` : "?";
              lines.push(`  • ${item.name} — ${price}`);
            }
            if (shop.inventory.length > 8) lines.push(`  ... 还有 ${shop.inventory.length - 8} 件`);
          }
        }
      } else {
        lines.push("");
        lines.push("（附近未匹配到商店。移动到商业区试试？）");
      }

      // 打工列表
      lines.push("");
      lines.push("────────────────────────────────────────");
      lines.push("💼 可打工种 (2010千叶时薪):");
      if (economy?.job_rates) {
        for (const [job, rate] of Object.entries(economy.job_rates) as any) {
          lines.push(`  • ${job}: ¥${rate}/小时`);
        }
      }
      lines.push("────────────────────────────────────────");
      lines.push(`💰 你的余额: ¥${gameState.player.funds}`);
      lines.push("使用 buy_item / sell_item / work_job 工具进行交易。");

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "🏪 商店", lines);
    },
  });

  // ── /schedule NPC日程面板 ──
  pi.registerCommand("schedule", {
    description: "查看周边NPC的日程安排与当前位置",
    handler: async (_args, ctx) => {
      const { gameState, getOrCreateNPC, getMemoryTags } = await import("./engine/state.ts");
      const lines: string[] = [];
      const t = gameState.time;

      lines.push(`📋 NPC 日程一览 | ${t.game_date} ${t.day_of_week}曜日 ${t.time_of_day}`);
      lines.push("────────────────────────────────────────");

      const npcs = Object.entries(gameState.npcs);
      if (npcs.length === 0) {
        lines.push("（尚未追踪任何NPC日程）");
      } else {
        // 按位置分组
        const byLocation: Record<string, string[]> = {};
        for (const [name, npc] of npcs) {
          const loc = npc.currentRoom || "未知";
          if (!byLocation[loc]) byLocation[loc] = [];
          const npcState = getOrCreateNPC(name);
          const tags = getMemoryTags(name);
          const override = npc.scheduleOverride;
          let info = name;
          if (override) info += ` [🔶${override.location}]`;
          if (tags.length > 0) info += ` 🏷${tags.length}`;
          info += ` | ${npc.action || npc.scheduleGroup || "?"} | ${npcState.action || ""}`;
          byLocation[loc].push(info);
        }

        for (const [loc, names] of Object.entries(byLocation)) {
          const isHere = loc === gameState.player.location;
          lines.push(`${isHere ? "📍" : "  "} ${loc} (${names.length}人)`);
          for (const n of names.slice(0, 8)) {
            lines.push(`    ${n}`);
          }
          if (names.length > 8) lines.push(`    ... 还有 ${names.length - 8} 人`);
        }
      }

      lines.push("────────────────────────────────────────");
      lines.push("🔶 = 日程覆盖中 | 🏷 = 有记忆标签");
      lines.push("📍 = 当前位置");

      const { showPanel } = await import("./engine/router.ts");
      await showPanel(ctx, "📋 NPC日程", lines);
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
