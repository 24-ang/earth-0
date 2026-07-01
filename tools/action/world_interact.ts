import { Type } from "typebox";

export default {
    name: "world_interact", label: "世界交互",
    description: "建造/拆除/拾取/丢弃/开关门。action: place|remove|pick_up|drop|build_wall|remove_wall|toggle_door",
    parameters: Type.Object({
      action: Type.String({ description: "place / remove / pick_up / drop / build_wall / remove_wall / toggle_door" }),
      item: Type.Optional(Type.String({ description: "物品名（place时必需）" })),
      material: Type.Optional(Type.String({ description: "材料或工具名" })),
      description: Type.Optional(Type.String({ description: "放置位置描述，如'靠窗'、'门边'" })),
      furniture_actions: Type.Optional(Type.Record(Type.String(), Type.Object({
        effect: Type.String({ description: "rest|sleep|train|shop|storage|narrative" }),
        hours: Type.Optional(Type.Number()),
        fatigue_reduction: Type.Optional(Type.Number()),
        restore_hp: Type.Optional(Type.String()),
        restore_fatigue: Type.Optional(Type.String()),
        skill: Type.Optional(Type.String()),
        exp: Type.Optional(Type.Number()),
        shop_type: Type.Optional(Type.String()),
        narrative: Type.Optional(Type.String()),
      }))),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getRoom, placeFurniture, removeFurniture, editCellType, toggleDoor } = await import("../../engine/state.ts");
      const p = gameState.player;
      if (!p.gridPos) {
        return { content: [{ type: "text", text: "当前玩家没有网格坐标，无法进行网格交互" }], details: {} };
      }
      const room = getRoom(p.location);
      if (!room) {
        return { content: [{ type: "text", text: `当前位置 ${p.location} 没有地图格，无法进行网格交互` }], details: {} };
      }

      // 所有权校验
      const { lookupRegion } = await import("../../engine/router.ts");
      const matchedRegions = lookupRegion(p.location).matched_regions;
      const isOwned = matchedRegions.some(r =>
        Object.values(p.properties || {}).some(prop => prop.regionId === r.name)
      ) || Object.values(p.properties || {}).some(prop => prop.regionId === p.location);

      let wantedWarning = "";
      if (!isOwned && ["place", "build_wall", "remove_wall"].includes(params.action)) {
        // 察觉统一检定：附近 NPC 是否看到非法改造
        const { getNearbyNPCs } = await import("../../engine/state.ts");
        const { perceptionCheck } = await import("../../engine/perception.ts");
        const nearbyNPCs = getNearbyNPCs(p.location, p.gridPos!, 10);
        const actor = {
          attributes: p.attributes as Record<string, number>,
          skills: p.skills as Record<string, { level: number }>,
          equipment: p.equipment,
          concealed: p.concealed ?? false,
        };
        for (const npc of nearbyNPCs) {
          const npcState = gameState.npcs[npc.name];
          if (!npcState) continue;
          const observer = {
            attributes: npcState.attributes as Record<string, number>,
            skills: npcState.skills as Record<string, { level: number }>,
            equipment: npcState.equipment,
          };
          const context = {
            distance_m: npc.distance,
            noise: "loud" as const,  // 建造/拆除噪声大
            light: "dim" as const,
            walls_between: npc.walls,
          };
          const result = perceptionCheck(actor, observer, context);
          if (result.seen || result.heard) {
            gameState.flags.exposed = true;
            gameState.flags.wanted = true;
            wantedWarning = ` (此区域非你所有，${npc.name}目击/听到了你的非法改造行为并被通缉！)`;
            break;
          }
        }
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
        const r = placeFurniture(matched.x, matched.y, params.item, (params as any).furniture_actions);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}${wantedWarning}` }], details: r };

      } else if (params.action === "remove") {
        matched = targets.find(t => t.cell.furniture);
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以拆除的家具" }], details: {} };
        }
        const r = removeFurniture(matched.x, matched.y);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}` }], details: r };

      } else if (params.action === "pick_up") {
        matched = targets.find(t => t.cell.furniture);
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以拾取的家具" }], details: {} };
        }
        const furnitureName = matched.cell.furniture!;
        // 查物品模板获取重量
        let itemWeight = 1.0; // 默认1kg
        const { itemsCatalog } = await import("../../engine/state.ts");
        for (const cat of Object.values(itemsCatalog)) {
          if ((cat as any)[furnitureName]) {
            itemWeight = (cat as any)[furnitureName].weight || 1.0;
            break;
          }
        }
        const str = p.attributes.力量;
        const maxLift = str * 3;

        if (itemWeight > maxLift) {
          return { content: [{ type: "text", text: `${furnitureName}太重了（${itemWeight}kg > 力量上限${maxLift}kg），无法拾取` }], details: {} };
        }

        // 获取物品模板
        const { getItemTemplate } = await import("../../engine/state.ts");
        const template = getItemTemplate(furnitureName);

        if (itemWeight > str * 1.5) {
          // 中等重量：双手搬运
          template.holding_in_hands = true;
          const r = removeFurniture(matched.x, matched.y);
          gameState.player.inventory.push(template);
          return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): 双手搬起了${furnitureName}（${itemWeight}kg，占双手装备槽，移动减速）` }], details: r };
        }

        // 轻量：正常拾取
        const r = removeFurniture(matched.x, matched.y);
        gameState.player.inventory.push(template);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): 拾取了${furnitureName}（${itemWeight}kg）` }], details: r };

      } else if (params.action === "drop") {
        if (!params.item) {
          return { content: [{ type: "text", text: "参数错误: drop 动作需要指定 item（要丢弃的物品名）" }], details: {} };
        }
        const invIdx = p.inventory.findIndex((i: any) => i.name === params.item);
        if (invIdx < 0) {
          return { content: [{ type: "text", text: `背包里没有 ${params.item}` }], details: {} };
        }
        matched = targets.find(t => t.cell.type === "floor" && !t.cell.furniture);
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有空地可以放置" }], details: {} };
        }
        const dropped = p.inventory.splice(invIdx, 1)[0];
        const wasHolding = !!(dropped as any).holding_in_hands;
        if (wasHolding) {
          (dropped as any).holding_in_hands = false;
        }
        // placeFurniture 会从背包扣除，但我们已经手动移除了。直接设置格子。
        matched.cell.furniture = (dropped as any).name;
        matched.cell.label = (dropped as any).name.slice(0, 4);
        matched.cell.block = true;
        const { saveState } = await import("../../engine/state.ts");
        saveState();
        const extraMsg = wasHolding ? "，双手解放" : "";
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): 放下了${(dropped as any).name}${extraMsg}` }], details: { success: true, reason: `放下了${(dropped as any).name}` } };

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
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}${wantedWarning}` }], details: r };

      } else if (params.action === "remove_wall") {
        matched = targets.find(t => t.cell.type === "wall");
        if (!matched) {
          return { content: [{ type: "text", text: "附近没有可以拆除的墙壁" }], details: {} };
        }
        const r = editCellType(matched.x, matched.y, "floor", undefined, params.material);
        return { content: [{ type: "text", text: `在${matched.dir}边(${matched.x},${matched.y}): ${r.reason}${wantedWarning}` }], details: r };

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
  };
