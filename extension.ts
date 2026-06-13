/**
 * earth-0 扩展 — tools注册，LLM ↔ engine桥梁
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // ── 辅助 ──
  interface MenuItem { label: string; detail?: string; action?: () => void | Promise<void>; }

  async function moveTo(loc: string, ctx: any, gs: any, save: any) {
    gs.player.location = loc;
    if (!gs.player.known_locations) gs.player.known_locations = ["千叶_住宅区"];
    if (!gs.player.known_locations.includes(loc)) gs.player.known_locations.push(loc);
    const { initPlayerGrid } = await import("./engine/state.ts");
    initPlayerGrid();
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
      const { gameState, getBodyForAge, getNpcCurrentAge } = await import("./engine/state.ts");
      if (params.name === gameState.player.name || params.name === "玩家") {
        return { content: [{ type: "text", text: JSON.stringify(gameState.player, null, 2) }], details: { character: gameState.player } };
      }
      const { allChars } = await import("./engine/router.ts");
      const c = allChars.find((x: any) => x.name === params.name);
      if (!c) return { content: [{ type: "text", text: "无此角色" }], details: {} };
      const age = getNpcCurrentAge(c.base_age || 6);
      const body = getBodyForAge(c, age);
      return { content: [{ type: "text", text: JSON.stringify({ name: c.name, location: c.default_location, attributes: c.attributes, skills: c.skills, hp: c.hp, body: body ? `${body.height_cm}cm ${body.cup||""}` : "" }, null, 2) }], details: {} };
    },
  });

  pi.registerTool({
    name: "patch_state", label: "修改状态",
    description: "改好感/移物品/换位置/加技能/给或取物品。target=NPC名, action=add_affection|add_skill_exp|move|give_item|take_item, value=数值/地点/物品名",
    parameters: Type.Object({ target: Type.String(), action: Type.String(), value: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { updateRelation, addSkillExp, gameState, saveState, setPlayerLocation, getOrCreateNPC } = await import("./engine/state.ts");
      const p = gameState.player;
      let r = "";
      if (params.action === "add_affection" && params.value) {
        updateRelation(p.relationships, params.target, Number(params.value));
        r = `${params.target} 好感${params.value > "0" ? "+" : ""}${params.value}`;
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

  // combat, steal, equip, build, move, door_toggle, reputation, schedule, economy
  pi.registerTool({
    name: "combat_action", label: "战斗",
    description: "攻击/防御/逃跑。action: attack/defend/flee。target 为 NPC 名。",
    parameters: Type.Object({ action: Type.String(), target: Type.Optional(Type.String()) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("./engine/state.ts");
      const { resolveAttack, defend, attemptFlee } = await import("./engine/combat.ts");
      const p = gameState.player;
      const playerCombatant = { name: p.name, state: p, cover: "无掩体" as any };

      let r = "";
      if (params.action === "attack" && params.target) {
        const npc = getOrCreateNPC(params.target);
        const allChars = (await import("./engine/router.ts")).allChars;
        const src = allChars.find((c: any) => c.name === params.target);
        // 用 NPC 数据构造最小 Combatant
        const npcState = {
          ...structuredClone(p), // fallback 结构
          name: params.target,
          attributes: src?.attributes || { 力量:5,敏捷:5,体质:5,智力:5,感知:5,魅力:5 },
          skills: src?.skills || {},
          hp: src?.hp ? { ...src.hp } : { current: 10, max: 10 },
          ac: src?.ac || 10,
          equipment: npc.equipment || {},
        };
        const npcCombatant = { name: params.target, state: npcState, cover: "无掩体" as any };
        // 取玩家装备的武器，否则拳头
        const weapon = Object.values(p.equipment).find((w: any) => w?.damage)
          || { name: "拳头", damage: { dice: "1d2", damageType: "钝击" }, type: "weapon", slot: "right_hand", weight: 0, effects: [], state: "intact" };
        const result = resolveAttack(playerCombatant, npcCombatant, weapon as any);
        r = result.narrative;
      } else if (params.action === "defend") {
        r = defend(playerCombatant);
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
    description: "查看背包和装备，可选择装备/卸下",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const p = gameState.player;
      const items: MenuItem[] = [];
      items.push({ label: `💰 ¥${p.funds}`, detail: "" });
      items.push({ label: "── 装备 ──", detail: "" });
      const eq = Object.entries(p.equipment).filter(([_,v]) => v);
      if (eq.length > 0) {
        eq.forEach(([s, it]) => items.push({ label: `  [${s}] ${it!.name}`, detail: `${it!.type} ${it!.weight}kg`,
          action: () => { p.inventory.push(it!); p.equipment[s as any] = null; saveState(); ctx.ui.notify(`卸下了${it!.name}`, "info"); } }));
      } else items.push({ label: "  （无装备）", detail: "" });
      items.push({ label: "── 背包 ──", detail: "" });
      if (p.inventory.length > 0) {
        p.inventory.forEach((it: any, idx: number) => items.push({ label: `  ${it.name}`, detail: `${it.type} ${it.weight}kg ${it.state}`,
          action: () => {
            // 装备到对应槽位
            const slot = it.slot as any;
            if (slot && ["inner_top","inner_bot","top","bottom","legs","feet","head","acc","left_hand","right_hand","back"].includes(slot)) {
              if (p.equipment[slot]) p.inventory.push(p.equipment[slot]!);
              p.equipment[slot] = it;
              p.inventory.splice(idx, 1);
              saveState(); ctx.ui.notify(`装备了${it.name} → ${slot}`, "info");
            } else {
              ctx.ui.notify(`${it.name} 无法装备（槽位:${slot}）`, "warning");
            }
          } }));
      } else items.push({ label: "  （空）", detail: "" });
      await showMenu(ctx, "🎒 物品", items);
    },
  });

  pi.registerCommand("map", {
    description: "楼层房间，↑↓选择 Enter前往",
    handler: async (_args, ctx) => {
      const { gameState, saveState, initPlayerGrid } = await import("./engine/state.ts");
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
            action: here ? undefined : () => { gameState.player.location = name; initPlayerGrid(); if (!gameState.player.known_locations.includes(name)) gameState.player.known_locations.push(name); saveState(); ctx.ui.notify("→ "+name, "info"); } });
        }
        return items;
      };
      await showMenu(ctx, `📌 F${f}`, buildMenu());
    },
  });

  pi.registerCommand("go", {
    description: "前往可到达的地点（自动整合地图/区域/已探索/出行）",
    handler: async (_args, ctx) => {
      const { gameState, saveState } = await import("./engine/state.ts");
      const loc = gameState.player.location;
      const items: MenuItem[] = [];

      // ── 同楼层房间（/map） ──
      const rooms = await import("../data/rooms.json", { with: { type: "json" } });
      const curRoom = (rooms.default as any)[loc];
      const floor = curRoom?.floor ?? 0;
      let hasSection = false;
      for (const [name, room] of Object.entries(rooms.default as any)) {
        if ((room as any).floor !== floor) continue;
        if (loc === name || loc.includes(name)) continue;
        const npcs = Object.entries(gameState.npcs).filter(([_,n]:[string,any]) => n.currentRoom === name).map(([n]) => n);
        items.push({ label: "🚪 " + name, detail: npcs.length > 0 ? npcs.join(" ") : "",
          action: () => moveTo(name, ctx, gameState, saveState) });
        hasSection = true;
      }

      // ── 校园建筑（/area） ──
      try {
        const sm = (await import("../data/school_map.json", { with: { type: "json" } })).default as any;
        for (const [bname, bld] of Object.entries(sm.buildings)) {
          const b = bld as any;
          for (const rl of Object.values(b.rooms || {}) as string[][]) {
            for (const r of rl) {
              if (loc.includes(r) || r.includes(loc)) continue;
              if (items.some(it => it.label.includes(r))) continue; // 去重
              items.push({ label: "🏫 " + r, detail: bname,
                action: () => moveTo(r, ctx, gameState, saveState) });
            }
          }
        }
      } catch (_) {}

      // ── 已探索（/known） ──
      const known = gameState.player.known_locations || [];
      for (const k of known) {
        if (k === loc || loc.includes(k) || k.includes(loc)) continue;
        if (items.some(it => it.label.includes(k))) continue;
        items.push({ label: "📌 " + k, detail: "已探索",
          action: () => moveTo(k, ctx, gameState, saveState) });
      }

      // ── 城市交通（原 /go） ──
      try {
        const cm = await import("../data/city_map.json", { with: { type: "json" } });
        const regions = (cm.default as any).regions || {};
        const hasBike = gameState.player.inventory.some((i: any) => i.name.includes("自行车"));
        for (const [rname, reg] of Object.entries(regions) as [string,any][]) {
          for (const l of (reg.landmarks || [])) {
            if (loc.includes(l) || l.includes(loc)) continue;
            if (items.some(it => it.label.includes(l))) continue;
            items.push({ label: "🚶 " + l, detail: rname,
              action: () => moveTo(l, ctx, gameState, saveState) });
            if (hasBike && reg.stations) {
              for (const [sn, sd] of Object.entries(reg.stations) as [string,any][]) {
                for (const [d, m] of Object.entries(sd.time_to || {}) as [string,number][]) {
                  items.push({ label: "🚉 " + d, detail: `${sd.lines?.join("/") || ""} ${m}分`,
                    action: () => moveTo(d, ctx, gameState, saveState) });
                }
              }
            }
          }
        }
      } catch (_) {}

      if (items.length === 0) items.push({ label: "（无处可去）", detail: "" });
      await showMenu(ctx, "前往 " + loc, items);
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
    description: "Layer1 状态面板：欲望/兴奋/周期/心里话",
    handler: async (_args, ctx) => {
      const { gameState } = await import("./engine/state.ts");
      if (!gameState.player.sex) { ctx.ui.notify("无活跃 SexState。进入亲密场景后自动创建。", "info"); return; }
      const s = gameState.player.sex;
      if (!s) { ctx.ui.notify("无活跃 SexState。进入亲密场景后自动创建。", "info"); return; }
      const p = s.profile;
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
      await showPanel(ctx, "🔞 Layer1", lines);
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
    description: "查看当前房间：位置/出口/NPC/引擎约束",
    handler: async (_args, ctx) => {
      const { gameState, getRoom, getGridContext, isSameLocation } = await import("./engine/state.ts");
      const loc = gameState.player.location;
      const room = getRoom(loc);
      const lines: string[] = [];

      if (room) {
        // 房间基本信息
        const w = room.width, h = room.height, cs = room.cellSize;
        lines.push(`${loc}  F${room.floor}  ${w*(cs||1)}m×${h*(cs||1)}m  ${w}×${h}格  ${cs||1}m/格`);
        if ((room as any).atmosphere) lines.push((room as any).atmosphere);

        // 玩家位置
        if (gameState.player.gridPos) {
          const [px, py] = gameState.player.gridPos;
          lines.push(`你在 (${px},${py})`);
          // 四周
          const parts: string[] = [];
          const dirs: Record<string, [number, number]> = {"北":[0,-1],"南":[0,1],"东":[1,0],"西":[-1,0]};
          for (const [d, [dx, dy]] of Object.entries(dirs)) {
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) { parts.push(`${d}:边界`); continue; }
            const c = room.cells[ny][nx];
            if (c.type === "wall") parts.push(`${d}:墙`);
            else if (c.furniture) parts.push(`${d}:${c.furniture}`);
            else if (c.type === "exit" || c.type === "door") parts.push(`${d}:🚪${c.exitTo || "出口"}${c.isOpen===false?"🔒":""}`);
            else parts.push(`${d}:空`);
          }
          lines.push(`四周: ${parts.join("  ")}`);
        }

        // 出口
        const exits: string[] = [];
        const furniture: string[] = [];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const c = room.cells[y][x];
            if (c.type === "exit" || c.type === "door") exits.push(`${c.exitTo || "?"}(${x},${y})${c.isOpen===false?"🔒":""}`);
            if (c.furniture) furniture.push(`${c.furniture}(${x},${y})`);
          }
        }
        if (exits.length > 0) lines.push(`出口: ${exits.join("  ")}`);
        if (furniture.length > 0) lines.push(`家具: ${furniture.join("  ")}`);

        // 环境
        const amb = (room as any).ambient;
        if (amb) lines.push(`环境: ${[amb.visual, amb.audio].filter(Boolean).join("，") || "—"}`);
      } else {
        lines.push(`${loc}（无房间数据）`);
      }

      // 在场 NPC
      const npcsHere = Object.entries(gameState.npcs)
        .filter(([_, n]) => isSameLocation(n.currentRoom, loc))
        .map(([name, n]) => `${name}${n.action ? "("+n.action+")" : ""}`);
      if (npcsHere.length > 0) lines.push(`在场: ${npcsHere.join("  ")}`);

      // 引擎过滤概览（证明反上帝视角在工作）
      const npcsElsewhere = Object.entries(gameState.npcs)
        .filter(([_, n]) => !isSameLocation(n.currentRoom, loc));
      if (npcsElsewhere.length > 0) {
        lines.push(`[引擎过滤] LLM看不到的NPC: ${npcsElsewhere.map(([n, s]) => `${n}@${s.currentRoom}`).join(", ")}`);
      }

      await showPanel(ctx, loc, lines);
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
