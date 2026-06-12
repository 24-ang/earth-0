/**
 * earth-0 扩展 — tools注册，LLM ↔ engine桥梁
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // ── 辅助 ──
  interface MenuItem { label: string; detail?: string; action?: () => void | Promise<void>; }

  function moveTo(loc: string, ctx: any, gs: any, save: any) {
    gs.player.location = loc;
    if (!gs.player.known_locations) gs.player.known_locations = ["千叶_住宅区"];
    if (!gs.player.known_locations.includes(loc)) gs.player.known_locations.push(loc);
    save(); ctx.ui.notify("📍 " + loc, "info");
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
            out.push(("┌─" + title + " " + "─".repeat(Math.max(0,w-4-title.length))).slice(0,w) + "┐");
            const start = Math.max(0, sel - 5), end = Math.min(items.length, start + 10);
            for (let i = start; i < end; i++) {
              const it = items[i];
              const line = (i === sel ? "▶ " : "  ") + it.label + (it.detail ? "  " + it.detail : "");
              const t = tui.truncateToWidth ? tui.truncateToWidth(line, w-2) : line.slice(0, w-2);
              const pad = Math.max(0, (w-4) - [...t].length);
              out.push(("│ " + t + " ".repeat(pad) + " │").slice(0, w));
            }
            out.push(("└" + "─".repeat(w-2) + "┘").slice(0, w));
            out.push((sel+1 + "/" + items.length + " 方向键选择 Enter确认 q退出").slice(0, w));
            return out;
          },
          handleInput(d: string) {
            if (d === "\x1b" || d === "q") { done(); return; }
            if (d === "\x1b[A" || d === "k") sel = Math.max(0, sel-1);
            else if (d === "\x1b[B" || d === "j") sel = Math.min(items.length-1, sel+1);
            else if (d === "\r" || d === "\n") {
              const it = items[sel];
              if (it?.action) Promise.resolve(it.action()).then(() => { items = getItems(); sel = Math.min(sel, items.length-1); });
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
      const age = getNpcCurrentAge(c.base_age || 6);
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
      const { allChars } = await import("./engine/router.ts");
      const { getBodyForAge, getNpcCurrentAge } = await import("./engine/state.ts");
      const c = allChars.find((x: any) => x.name === params.name);
      if (!c) return { content: [{ type: "text", text: "无此角色" }], details: {} };
      const age = getNpcCurrentAge(c.base_age || 6);
      const body = getBodyForAge(c, age);
      return { content: [{ type: "text", text: JSON.stringify({ name: c.name, location: c.default_location, attributes: c.attributes, skills: c.skills, hp: c.hp, body: body ? `${body.height_cm}cm ${body.cup||""}` : "" }, null, 2) }], details: {} };
    },
  });

  pi.registerTool({
    name: "patch_state", label: "修改状态",
    description: "改好感/移物品/换位置/加技能。move时value=地点名。",
    parameters: Type.Object({ target: Type.String(), action: Type.String(), value: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { updateRelation, addSkillExp, gameState, saveState, setPlayerLocation } = await import("./engine/state.ts");
      let r = "";
      if (params.action === "add_affection" && params.value) {
        updateRelation(gameState.player.relationships, params.target, Number(params.value));
        r = `${params.target} 好感${params.value}`;
      } else if (params.action === "add_skill_exp" && params.value) {
        const [sk, exp] = params.value.split(":");
        addSkillExp(gameState.player.skills, sk, Number(exp));
        r = `${sk} +${exp}EXP`;
      } else if (params.action === "move" && params.value) {
        setPlayerLocation(params.value);
        r = `移动到 ${params.value}`;
      } else { r = `操作 ${params.action} → ${params.target}`; }
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
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
      const { gameState, saveState } = await import("./engine/state.ts");
      if (!gameState.layer1Enabled) return { content: [{ type: "text", text: "Layer1未启用" }], details: {} };
      if (!gameState.player.sex) return { content: [{ type: "text", text: "无活跃SexState" }], details: {} };
      const { SEX_PROFILES, touchBodyPart } = await import("./engine/sex.ts");
      const p = SEX_PROFILES[params.char];
      if (!p) return { content: [{ type: "text", text: "无该角色sex档案" }], details: {} };
      const r = touchBodyPart(p, gameState.player.sex, params.part, params.intensity as any);
      saveState();
      return { content: [{ type: "text", text: `[${params.part}] ${r.reaction} arousal ${r.arousalChange >= 0 ? "+" : ""}${r.arousalChange}` }], details: r };
    },
  });

  // combat, steal, equip, build, move, door_toggle, reputation, schedule, economy — keep existing
  pi.registerTool({
    name: "combat_action", label: "战斗",
    description: "攻击/防御/逃跑。action: attack/defend/flee",
    parameters: Type.Object({ action: Type.String(), target: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      const { resolveAttack, defend, attemptFlee } = await import("./engine/combat.ts");
      let r = "";
      if (params.action === "attack" && params.target) {
        r = resolveAttack(gameState.player, params.target);
      } else if (params.action === "defend") {
        r = defend(gameState.player);
      } else if (params.action === "flee") {
        r = attemptFlee(gameState.player);
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
      const { gameState, stealFromNPC, saveState } = await import("./engine/state.ts");
      const r = stealFromNPC(params.target, params.item);
      saveState();
      return { content: [{ type: "text", text: r.narrative }], details: r };
    },
  });

  pi.registerTool({
    name: "equip_item", label: "装备",
    description: "装备/卸下物品。",
    parameters: Type.Object({ item: Type.String(), slot: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      const r = params.slot ? `装备 ${params.item} → ${params.slot}` : `卸下 ${params.item}`;
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
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
    description: "移动到棋盘坐标。",
    parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { moveTo, gameState, saveState } = await import("./engine/state.ts");
      const r = moveTo(gameState.player.location, gameState.player.gridPos || [0,0], [params.x, params.y]);
      saveState();
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  });

  pi.registerTool({
    name: "build_add", label: "建造",
    description: "在棋盘格建造物品。",
    parameters: Type.Object({ item: Type.String(), x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      saveState();
      return { content: [{ type: "text", text: `建造 ${params.item} 于 (${params.x},${params.y})` }], details: {} };
    },
  });

  pi.registerTool({
    name: "build_remove", label: "拆除",
    description: "拆除棋盘格物品。",
    parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      saveState();
      return { content: [{ type: "text", text: `拆除 (${params.x},${params.y})` }], details: {} };
    },
  });

  pi.registerTool({
    name: "door_toggle", label: "开关门",
    description: "开关当前位置的门。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      saveState();
      return { content: [{ type: "text", text: "门状态切换" }], details: {} };
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
    description: "从商店购买物品。",
    parameters: Type.Object({ item: Type.String(), shop: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      saveState();
      return { content: [{ type: "text", text: `购买 ${params.item}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "sell_item", label: "出售",
    description: "出售物品。",
    parameters: Type.Object({ item: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("./engine/state.ts");
      saveState();
      return { content: [{ type: "text", text: `出售 ${params.item}` }], details: {} };
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
    description: "查看所有NPC关系",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const lines: string[] = [];
      const rels = gameState.player.relationships;
      for (const [n, r] of Object.entries(rels)) {
        lines.push(`${n}: ${(r as any).stage} (好感${(r as any).affection})${(r as any).notes ? " - " + (r as any).notes : ""}`);
      }
      if (lines.length === 0) lines.push("（暂无关系）");
      await showPanel(ctx, "关系", lines);
    },
  });

  pi.registerCommand("status", {
    description: "查看玩家完整状态",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const p = gameState.player, w = gameState.weather;
      const lines = [
        `${p.name}  ${p.gender}  ${p.age}岁  ${gameState.time.player_stage}`,
        `位置: ${p.location}  ${w.type} ${w.temp}°C`,
        `资金: ¥${p.funds}  HP: ${p.hp.current}/${p.hp.max}  AC: ${p.ac}`,
        `属性: 力${p.attributes.力量} 敏${p.attributes.敏捷} 体${p.attributes.体质} 智${p.attributes.智力} 感${p.attributes.感知} 魅${p.attributes.魅力}`,
      ];
      if (Object.keys(p.skills).length > 0) lines.push(`技能: ${Object.entries(p.skills).map(([k,v]:any) => `${k} Lv${v.level}`).join(" ")}`);
      if (p.body) {
        const b = p.body;
        let bl = `${b.height_cm}cm ${b.build}`;
        if (b.cup) bl += ` ${b.cup}cup`;
        if (b.measurements) bl += ` ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`;
        lines.push(`身体: ${bl}`);
      }
      const eq = Object.entries(p.equipment).filter(([_,v]) => v);
      if (eq.length > 0) lines.push(`装备: ${eq.map(([s,it]) => `${s}:${it!.name}`).join(" ")}`);
      await showPanel(ctx, p.name, lines);
    },
  });

  pi.registerCommand("look", {
    description: "查看角色/物品详情。用法: /look <名>",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) { ctx.ui.notify("用法: /look <角色名或物品名>", "warning"); return; }
      const { gameState } = await import("./engine/state.ts");
      const { allChars } = await import("./engine/router.ts");
      const char = allChars.find((c: any) => c.name === name || c.name.includes(name));
      if (char) {
        const lines = [`${char.name}  ${char.gender}  base_age:${char.base_age}`, `来源: ${char.source}`, char.appearance_brief || ""];
        if (char.anchors?.private) lines.push(char.anchors.private.slice(0, 120));
        await showPanel(ctx, char.name, lines); return;
      }
      const item = gameState.player.inventory.find((i: any) => i.name.includes(name));
      if (item) { await showPanel(ctx, item.name, [`${item.type} ${item.slot} ${item.weight}kg ${item.state}`]); return; }
      ctx.ui.notify(`未找到: ${name}`, "warning");
    },
  });

  pi.registerCommand("party", {
    description: "查看队伍成员",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const lines = gameState.player.party.length > 0 ? gameState.player.party.map((n: string) => `- ${n}`) : ["（独自一人）"];
      await showPanel(ctx, "👥 队伍", lines);
    },
  });

  pi.registerCommand("inventory", {
    description: "查看背包和装备",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      const p = gameState.player;
      const lines: string[] = [`💰 ¥${p.funds}`, ""];
      const eq = Object.entries(p.equipment).filter(([_,v]) => v);
      if (eq.length > 0) { lines.push("【装备】"); eq.forEach(([s, it]) => lines.push(`  [${s}] ${it!.name}`)); }
      if (p.inventory.length > 0) {
        if (eq.length > 0) lines.push("");
        lines.push("【背包】"); p.inventory.forEach((it: any) => lines.push(`  ${it.name}  ${it.type}  ${it.weight}kg`));
      }
      if (eq.length === 0 && p.inventory.length === 0) lines.push("（空）");
      await showPanel(ctx, "🎒 物品", lines);
    },
  });

  pi.registerCommand("map", {
    description: "楼层房间，↑↓选择 Enter前往",
    handler: async (_args, ctx) => {
      const { gameState, movePlayer, saveState } = await import("./engine/state.ts");
      const rooms = await import("../data/rooms.json", { with: { type: "json" } });
      const cur = (rooms.default as any)[gameState.player.location];
      const f = cur?.floor ?? 0;
      const buildMenu = () => {
        const items: MenuItem[] = [];
        for (const [name, room] of Object.entries(rooms.default as any)) {
          if ((room as any).floor !== f) continue;
          const here = gameState.player.location === name || gameState.player.location.includes(name);
          const npcs = Object.entries(gameState.npcs).filter(([_,n]:[string,any]) => n.currentRoom === name).map(([n]) => n);
          items.push({ label: name, detail: (here ? "📍" : "") + (npcs.length > 0 ? " " + npcs.join(" ") : ""),
            action: here ? undefined : () => { movePlayer(name); saveState(); ctx.ui.notify("→ "+name, "info"); } });
        }
        return items;
      };
      await showMenu(ctx, `📌 F${f}`, buildMenu());
    },
  });

  pi.registerCommand("go", {
    description: "出行：步行/骑车/电车",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const cm = await import("../data/city_map.json", { with: { type: "json" } });
      const regions = (cm.default as any).regions || {};
      let curR: any = null, curName = "";
      for (const [n, r] of Object.entries(regions) as [string,any][]) {
        if (r.landmarks?.some((l:string) => gameState.player.location.includes(l) || l.includes(gameState.player.location))) { curR = r; curName = n; break; }
      }
      if (!curR) {
        for (const [n, r] of Object.entries(regions) as [string,any][]) {
          if (gameState.player.location.includes(n) || n.includes(gameState.player.location)) { curR = r; curName = n; break; }
        }
      }
      const hasBike = gameState.player.inventory.some((i: any) => i.name.includes("自行车"));
      const atStation = curR?.stations && Object.keys(curR.stations).some((s: string) => gameState.player.location.includes(s));
      const buildMenu = () => {
        const items: MenuItem[] = [];
        if (curR) for (const l of (curR.landmarks||[]).filter((l:string) => !gameState.player.location.includes(l))) {
          items.push({ label: "🚶 " + l, detail: curName, action: () => moveTo(l, ctx, gameState, saveState) });
        }
        if (hasBike && curR) for (const [n, r] of Object.entries(regions) as [string,any][]) {
          if (n === curName) continue;
          for (const l of r.landmarks||[]) items.push({ label: "🚲 " + l, detail: n, action: () => moveTo(l, ctx, gameState, saveState) });
        }
        if (atStation && curR?.stations) for (const [sn, sd] of Object.entries(curR.stations) as [string,any][]) {
          if (!gameState.player.location.includes(sn)) continue;
          for (const [d, m] of Object.entries(sd.time_to||{}) as [string,number][]) items.push({ label: "🚉 " + d, detail: `${sd.lines?.join("/")||""} ${m}分`, action: () => moveTo(d, ctx, gameState, saveState) });
        }
        return items.length > 0 ? items : [{ label: "（无可用交通）", detail: "" }];
      };
      await showMenu(ctx, "出行 " + gameState.player.location, buildMenu());
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
    },
  });

  pi.registerCommand("known", {
    description: "已探索地点，选择前往",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const known = gameState.player.known_locations || [];
      if (known.length === 0) { ctx.ui.notify("还没有探索过任何地点", "info"); return; }
      await showMenu(ctx, `已探索(${known.length})`, known.map((l: string) => ({
        label: l, detail: l === gameState.player.location ? "📍" : "", action: l === gameState.player.location ? undefined : () => moveTo(l, ctx, gameState, saveState)
      })));
    },
  });

  pi.registerCommand("shop", {
    description: "商店，↑↓选择 Enter购买",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const shops = await import("../data/shops.json", { with: { type: "json" } });
      const buildMenu = () => {
        const items: MenuItem[] = [];
        items.push({ label: `💰 ¥${gameState.player.funds}`, detail: "" });
        for (const [sname, pool] of Object.entries(shops.default as any)) {
          const loc = (pool as any).location || "";
          if (loc && !gameState.player.location.includes(loc)) continue;
          const all = Object.entries((pool as any).items).sort(() => Math.random()-0.5).slice(0, (pool as any).daily||6);
          if (all.length === 0) continue;
          items.push({ label: "── " + sname + " ──", detail: "" });
          for (const [name, spec] of all) {
            const price = (spec as any).base + Math.floor((Math.random()-0.5)*(spec as any).range*2);
            const can = gameState.player.funds >= price;
            items.push({ label: (can ? "🛒" : "💸") + " " + name, detail: "¥"+price,
              action: can ? () => { gameState.player.funds -= price; gameState.player.inventory.push({ name, type:"consumable", slot:"back", weight:0.5, effects:[], state:"intact" }); saveState(); ctx.ui.notify(`购买 ${name} ¥${price}`, "info"); } : undefined });
          }
        }
        return items.length > 1 ? items : [{ label: "（此处没有商店）", detail: "" }];
      };
      await showMenu(ctx, "🛍️ 商店", buildMenu());
    },
  });

  pi.registerCommand("city", {
    description: "千叶市地图（仅显示已探索）",
    handler: async (_args, ctx) => {
      const cm = await import("../data/city_map.json", { with: { type: "json" } });
      const c = cm.default as any;
      const { gameState, saveState } = await import("./engine/state.ts");
      const known = new Set(gameState.player.known_locations || []);
      const buildMenu = () => {
        const items: MenuItem[] = [];
        for (const [name, reg] of Object.entries(c.regions)) {
          const r = reg as any;
          const visible = r.landmarks.some((l: string) => known.has(l));
          if (!visible) continue;
          const here = r.landmarks.some((l: string) => gameState.player.location.includes(l));
          items.push({ label: (here ? "📍 " : "  ") + name + " [" + (r.label||"") + "]", detail: "" });
          for (const l of r.landmarks) { if (known.has(l)) items.push({ label: "  → " + l, detail: "", action: () => moveTo(l, ctx, gameState, saveState) }); }
        }
        if (items.length === 0) items.push({ label: "（尚未探索）", detail: "" });
        return items;
      };
      await showMenu(ctx, "🗺️ 千叶市", buildMenu());
    },
  });

  pi.registerCommand("area", {
    description: "校园地图，选择前往",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const sm = (await import("../data/school_map.json", { with: { type: "json" } })).default as any;
      const buildMenu = () => {
        const items: MenuItem[] = [];
        items.push({ label: "📍 " + sm.school, detail: "" });
        for (const [name, bld] of Object.entries(sm.buildings)) {
          const b = bld as any;
          const here = gameState.player.location.includes(name) || Object.values(b.rooms||{}).flat().some((r: string) => gameState.player.location.includes(r));
          items.push({ label: (here ? "📍 " : "  ") + name + (b.floors ? " F1-F"+b.floors : ""), detail: "" });
          if (b.rooms) for (const [fn, rl] of Object.entries(b.rooms)) for (const r of rl as string[]) {
            items.push({ label: "  → " + r, detail: fn, action: () => moveTo(r, ctx, gameState, saveState) });
          }
        }
        return items;
      };
      await showMenu(ctx, "🏫 " + sm.school, buildMenu());
    },
  });

  pi.registerCommand("room", {
    description: "方向键走格子",
    handler: async (_args, ctx) => {
      const { gameState, getRoomState, saveState } = await import("./engine/state.ts");
      const state = getRoomState(gameState.player.location);
      if (!state?.grid) { ctx.ui.notify("无地图数据", "warning"); return; }
      const g = state.grid;
      let px = state.playerPos?.[0] ?? g.origin?.[0] ?? 0;
      let py = state.playerPos?.[1] ?? g.origin?.[1] ?? 0;
      const chars = await import("../data/characters.json", { with: { type: "json" } });
      const dirs: Record<string,[number,number]> = { "\x1b[A": [0,-1], "\x1b[B": [0,1], "\x1b[D": [-1,0], "\x1b[C": [1,0], k: [0,-1], j: [0,1], h: [-1,0], l: [1,0] };
      ctx.ui.custom(
        (tui: any, _t: any, _k: any, done: any) => ({
          render(w: number): string[] {
            const out: string[] = [];
            const mw = Math.min(w, tui.visibleWidth?.()??w) - 1;
            const cols = "ABCDEFGHIJK";
            out.push(("┌ " + gameState.player.location + " F" + g.floor).padEnd(mw).slice(0,mw) + "┐");
            const npcs: Record<string,string> = {};
            for (const c of chars.default as any[]) {
              const n = gameState.npcs[c.name]; if (!n?.gridPos) continue;
              if (n.currentRoom === gameState.player.location || n.currentRoom?.includes(gameState.player.location))
                npcs[n.gridPos[0]+","+n.gridPos[1]] = c.name.slice(0,2).toUpperCase();
            }
            let hdr = "   "; for (let x=0;x<g.width;x++) hdr += "["+cols[x]+"]"; out.push(hdr.slice(0,mw));
            for (let y=0;y<g.height;y++) {
              let row = String(y).padStart(2,"0")+" ";
              for (let x=0;x<g.width;x++) {
                const isP = x===px&&y===py, npc = npcs[x+","+y];
                if (isP) row += "[PL]";
                else if (npc) row += "["+npc+"]";
                else { const cell = g.cells[y][x];
                  if ((cell.type==="door"||cell.type==="exit")&&cell.isOpen===false) row += "["+cell.label+"]";
                  else if (cell.type==="door"||cell.type==="exit") row += "["+(cell.label||"dr").toLowerCase()+"]";
                  else row += "["+(cell.label||"  ")+"]";
                }
              }
              out.push(row.slice(0,mw));
            }
            const cell = g.cells[py]?.[px], npcH = npcs[px+","+py];
            let info = "·";
            if (cell?.type==="wall") info = "墙";
            else if (cell?.type==="door"||cell?.type==="exit") info = (cell.isOpen?"门(开)":"门(关)")+(cell.exitTo?"→"+cell.exitTo:"");
            else if (cell?.type==="stairs") info = "楼梯→"+(cell.exitTo||"");
            else if (cell?.furniture) info = cell.furniture;
            if (npcH) info += " ["+npcH+"]";
            out.push(("│ "+info).padEnd(mw).slice(0,mw)+"│");
            out.push(("└"+"─".repeat(mw-2)+"┘").slice(0,mw));
            out.push("方向键移动 q退出".slice(0,mw));
            return out;
          },
          handleInput(d: string) {
            if (d==="\x1b"||d==="q") { done(); return; }
            const dir = dirs[d]; if (!dir) return;
            const nx=px+dir[0], ny=py+dir[1];
            if (nx<0||nx>=g.width||ny<0||ny>=g.height) return;
            const cell = g.cells[ny][nx];
            if (cell.block && cell.type!=="door"&&cell.type!=="exit") return;
            if ((cell.type==="door"||cell.type==="exit") && cell.isOpen===false) { ctx.ui.notify("门关着","warning"); return; }
            px=nx; py=ny; gameState.player.gridPos=[px,py];
            if (cell.type==="exit" && cell.exitTo) { gameState.player.location=cell.exitTo; saveState(); done(); ctx.ui.notify("→ "+cell.exitTo,"info"); }
          },
          invalidate() {},
        }),
        { overlay: true }
      );
    },
  });

  // ── Lifecycle ──
  pi.on("session_start", async (_event, ctx) => {
    const { loadState, buildStatePrompt, saveState } = await import("./engine/state.ts");
    const restored = loadState();
    if (restored) {
      // 确保 NPC 懒初始化（恢复旧存档时补上）
      buildStatePrompt();
      saveState();
      ctx.ui.notify(`earth-0 ${(await import("./engine/state.ts")).gameState.time.game_date}`, "info");
    } else {
      ctx.ui.notify("earth-0 新游戏", "info");
    }
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

    const read = (name: string) => {
      const p = path.join(agentsDir, name);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : "";
    };

    // 状态简报（含 NPC 懒初始化）
    const statePrompt = buildStatePrompt();

    // 按 mode 选叙事规则
    const modeFile = gameState.layer1Enabled ? "gm-mode-sex.md"
      : gameState.mode === "rpg" ? "gm-mode-rpg.md"
      : "gm-mode-gal.md";

    // 组装完整 GM 提示词
    const gmPrompt = [
      read("gm-pre.md"),
      read("gm-rules.md"),
      read("gm-contract.md"),
      statePrompt,
      read(modeFile),
    ].filter(Boolean).join("\n\n---\n\n");

    return { systemPrompt: gmPrompt };
  });
}
