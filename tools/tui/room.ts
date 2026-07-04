import { showPanel, showMenu, updateChatHUD } from "../helpers.ts";

export default {
    description: "观察当前场景并交互家具。列出视野内的NPC、出口和可互动的家具。",
    handler: async (_args, ctx) => {
      const { gameState, getRoom, isSameLocation, getNpcCurrentAge, getBodyForAge, findCharacter, saveState, getContainersAt, transferBetweenContainers } = await import("../../engine/state.ts");
      const { interactFurniture, findFurnitureDef, getAvailableActions } = await import("../../engine/furniture.ts");
      const loc = gameState.player.location;
      const room = getRoom(loc);

      // ── 静态面板 ──
      const lines: string[] = [];
      const timeOfDayZH: Record<string, string> = { dawn: "拂晓", morning: "上午", noon: "正午", afternoon: "下午", evening: "傍晚", night: "深夜" };
      lines.push(`📍 ${loc}`);
      lines.push(`🕐 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日 ${timeOfDayZH[gameState.time.time_of_day] || gameState.time.time_of_day}`);

      const inRoomNPCs = Object.entries(gameState.npcs || {}).filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, loc));

      if (room) {
        const w = room.width, h = room.height, cs = room.cellSize || 1;
        lines.push(`📏 ${w * cs}m × ${h * cs}m | 你: (${gameState.player.gridPos?.[0]??"?"},${gameState.player.gridPos?.[1]??"?"})`);
        if ((room as any).atmosphere) lines.push(`✨ ${(room as any).atmosphere}`);

        if (inRoomNPCs.length > 0) {
          lines.push("────────────────");
          for (const [name, npc] of inRoomNPCs) {
            const char = findCharacter(name);
            let hStr = ""; if (char) { const b = getBodyForAge(char, getNpcCurrentAge(char.base_age||16)); if (b?.height_cm) hStr = ` ${b.height_cm}cm`; }
            lines.push(`👤 ${name}${hStr} · ${npc.action || "站立"}`);
          }
        }
        lines.push("────────────────");
      }

      await showPanel(ctx, "👁️ 场景观察", lines);

      // ── 交互菜单 ──
      if (!room) return;

      const menuItems: { label: string; detail?: string; action?: (done: () => void) => Promise<void> | void }[] = [];

      // ── NPC 交互入口 ──
      const { showNPCInteractionMenu } = await import("./npc.ts");
      for (const [name, npc] of inRoomNPCs) {
        const char = findCharacter(name);
        const age = getNpcCurrentAge(char?.base_age || 16);
        const body = char ? getBodyForAge(char, age) : null;
        const hStr = body?.height_cm ? ` ${body.height_cm}cm` : "";
        menuItems.push({
          label: `👤 ${name}${hStr}`,
          detail: `${npc.action || "站立"} | ▶ 互动`,
          action: async (done) => {
            await showNPCInteractionMenu(name, ctx);
            done();
          },
        });
      }
      if (inRoomNPCs.length > 0) {
        menuItems.push({ label: "────────────────", detail: "", action: undefined });
      }

      const containers = getContainersAt(loc, gameState.player.gridPos as [number,number]|undefined);
      const playerConcealed = !!(gameState.player as any).concealed;

      for (let y = 0; y < room.height; y++) {
        for (let x = 0; x < room.width; x++) {
          const cell = room.cells[y]?.[x];
          if (!cell) continue;

          if (cell.type === "exit" || cell.type === "door") {
            const dest = cell.exitTo || "出口";
            const locked = cell.locked || cell.isOpen === false;
            menuItems.push({
              label: `${locked ? "🔐" : "🚪"} → ${dest}`,
              detail: locked ? "锁着" : `前往 ${dest}`,
              action: locked ? undefined : async (done) => {
                const { moveTo } = await import("../helpers.ts");
                await moveTo(dest, ctx, gameState, saveState);
                done();
              },
            });
          }

          if (cell.furniture) {
            const fname = cell.furniture;
            const inline = (cell as any).furniture_actions;
            const def = inline ? { actions: inline } : findFurnitureDef(fname);
            const actions = getAvailableActions(def, fname);
            const pos = `(${x},${y})`;

            // 状态标签
            const stateTags: string[] = [];
            if (def?.state?.locked || def?.state?.["locked_抽屉"]) stateTags.push("🔒");
            if (def?.state?.isOn === true) stateTags.push("💡");
            if (def?.state?.isOn === false) stateTags.push("⚫");
            if (def?.containers?.some(c => (c as any).can_hold_person)) stateTags.push("🫥");
            const stateTag = stateTags.length > 0 ? ` ${stateTags.join("")}` : "";

            // 容器内容预览
            const furnContainers = containers.filter(c => c.ownerType === "furniture" && c.ownerId === fname);
            const contentPreview: string[] = [];
            for (const fc of furnContainers) {
              if (fc.def.visible && fc.items.length > 0) {
                contentPreview.push(`${fc.def.id}:${fc.items.map((i:any) => i.name).join(",")}`);
              } else if (fc.def.locked) {
                contentPreview.push(`${fc.def.id}:🔒已锁`);
              } else if (!fc.def.visible) {
                contentPreview.push(`${fc.def.id}:关闭`);
              }
            }
            const contentStr = contentPreview.length > 0 ? ` [${contentPreview.join(" | ")}]` : "";

            const detail = `${actions.slice(0,5).join("/")}${stateTag}${contentStr}`;

            menuItems.push({
              label: `${stateTags.length > 0 ? "🔧" : "📦"} ${fname} ${pos}`,
              detail,
              action: async (done) => {
                const subItems: { label: string; detail?: string; action?: () => Promise<void> | void }[] = [];

                // 基础动作
                for (const act of actions) {
                  const actDef = def?.actions?.[act];
                  subItems.push({
                    label: act,
                    detail: actDef?.narrative || "",
                    action: async () => {
                      const inlineActions = (cell as any).furniture_actions || null;
                      const result = await interactFurniture(fname, act, gameState, gameState.player.gridPos as [number, number] | null, room.cells, inlineActions);
                      saveState();
                      if (result.effects.includes("时间推进") || result.effects.includes("HP恢复")) updateChatHUD(ctx);
                      ctx.ui.notify(result.message, "info");
                    },
                  });
                }

                // 容器浏览（如果家具有容器定义）
                if (furnContainers.length > 0) {
                  subItems.push({ label: "── 容器 ──", detail: "", action: () => {} });
                  for (const fc of furnContainers) {
                    const locked = !!(fc.def.locked);
                    const itemList = fc.items.map((i:any) => `${i.name}(${i.weight}kg)`).join(", ") || "空";
                    subItems.push({
                      label: `${locked ? "🔒" : "📂"} ${fc.def.id} (${fc.current_volume}/${fc.def.max_volume}L)`,
                      detail: locked ? "已锁" : itemList,
                      action: locked ? undefined : async () => {
                        // 从容器取物
                        if (fc.items.length === 0) { ctx.ui.notify(`${fc.def.id}是空的`, "info"); return; }
                        const takeItems = fc.items.map((item: any) => ({
                          label: `📤 取出 ${item.name}`,
                          action: async () => {
                            const r = transferBetweenContainers(fc.id, "backpack", item.name);
                            ctx.ui.notify(r, "info");
                            saveState();
                          },
                        }));
                        takeItems.push({ label: "↩ 返回", action: () => {} });
                        await showMenu(ctx, `${fname} · ${fc.def.id}`, takeItems);
                      },
                    });
                  }
                  // 放入物品
                  const playerItems = gameState.player.inventory.filter((i: any) => i.type !== "weapon" || !gameState.player.equipment?.right_hand || gameState.player.equipment.right_hand.name !== i.name);
                  if (playerItems.length > 0) {
                    subItems.push({
                      label: "📥 放入物品...",
                      action: async () => {
                        const putItems = playerItems.map((item: any) => ({
                          label: `${item.name} (${item.weight}kg)`,
                          action: async () => {
                            const targetContainer = furnContainers.find(c => !c.def.locked);
                            if (!targetContainer) { ctx.ui.notify("没有可用的未锁容器", "warn"); return; }
                            const r = transferBetweenContainers("backpack", targetContainer.id, item.name);
                            ctx.ui.notify(r, "info");
                            saveState();
                          },
                        }));
                        putItems.push({ label: "↩ 返回", action: () => {} });
                        await showMenu(ctx, `${fname} · 放入`, putItems);
                      },
                    });
                  }
                }

                // 躲藏（can_hold_person）
                if (def?.containers?.some(c => (c as any).can_hold_person)) {
                  subItems.push({ label: "── 躲藏 ──", detail: "", action: () => {} });
                  if (playerConcealed && (gameState.player as any).hiding_in === fname) {
                    subItems.push({
                      label: "👁️ 出来",
                      action: async () => {
                        const result = await interactFurniture(fname, "出来", gameState, gameState.player.gridPos as [number,number]|null, room.cells);
                        saveState(); ctx.ui.notify(result.message, "info");
                      },
                    });
                  } else {
                    subItems.push({
                      label: "🫥 躲进去",
                      action: async () => {
                        const result = await interactFurniture(fname, "躲进去", gameState, gameState.player.gridPos as [number,number]|null, room.cells);
                        saveState(); ctx.ui.notify(result.message, "info");
                      },
                    });
                  }
                }

                subItems.push({ label: "↩ 返回", action: () => {} });
                await showMenu(ctx, `${fname} ${pos}`, subItems);
                done();
              },
            });
          }
        }
      }

      if (menuItems.length === 0) {
        menuItems.push({ label: "（空无一物）", detail: "" });
      } else {
        menuItems.push({ label: "↩ 关闭", detail: "" });
      }

      await showMenu(ctx, "🔧 场景交互", menuItems);
    },
  };
