import { Type } from "typebox";

export default {
    name: "steal_item", label: "偷窃",
    description: "偷NPC物品。她有没有交你判断(引擎会合成)。偷钱包填cash。失败→好感-20+alert。",
    parameters: Type.Object({ target: Type.String({ description: "偷窃目标 NPC 名" }), item: Type.String({ description: "要偷的物品名" }), cash: Type.Optional(Type.Number({ description: "若偷钱包/含现金容器，估计里面有多少现金；引擎封顶在对方实际金钱" })) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, stealItem, saveState, updateRelation, updateReputation, getNearbyNPCs, getRoom } = await import("../../engine/state.ts");
      const { perceptionCheck } = await import("../../engine/perception.ts");
      const r = stealItem(gameState.player, params.target, params.item, params.cash);
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
      }

      // 偷窃成功后，察觉检定：附近 NPC 是否看到/听到
      if (r.success && !r.caught) {
        const p = gameState.player;
        const room = getRoom(p.location);
        if (room && p.gridPos) {
          const nearbyNPCs = getNearbyNPCs(p.location, p.gridPos, 10);

          // 构建 actor（玩家/偷窃者）
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

            // 偷窃是 quiet 动作，光照从房间/环境推断
            const context = {
              distance_m: npc.distance,
              noise: "quiet" as const,
              light: "dim" as const,  // 默认 dim，室内场景
              walls_between: npc.walls,
            };

            const result = perceptionCheck(actor, observer, context);
            if (result.seen || result.heard) {
              gameState.flags.wanted = true;
              if (result.seen && result.heard) {
                consequence += `\n⚠️ ${npc.name}看到了你的偷窃动作并听到了动静！被通缉！`;
              } else if (result.seen) {
                consequence += `\n⚠️ ${npc.name}目击了你的偷窃行为！被通缉！`;
              } else {
                consequence += `\n⚠️ ${npc.name}听到了你偷窃的动静！被通缉！`;
              }
              break;
            }
          }
        }
      }

      saveState();
      return { content: [{ type: "text", text: r.narrative + consequence }], details: { ...r, flags_set: consequence } };
    },
  };
