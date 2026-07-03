import { Type } from "typebox";

export default {
    name: "spawn_item", label: "生成物品",
    description: "剧情生成物品放入背包。须提供source和reason。",
    parameters: Type.Object({
      target: Type.String({ description: "接收者：'玩家' 或 NPC 名" }),
      item: Type.Object({
        name: Type.String(),
        type: Type.String({ description: "weapon / clothing / armor / tool / consumable / furniture" }),
        is_furniture: Type.Optional(Type.Boolean({ description: "是否家具（放入背包但标记为家具，需用 world_interact place 部署）" })),
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
      const { gameState, saveState, getOrCreateNPC, checkAddVolume } = await import("../../engine/state.ts");
      const targetChar = (params.target === "玩家" || params.target === gameState.player.name)
        ? gameState.player
        : getOrCreateNPC(params.target);

      // 同名物品去重
      const existing = targetChar.inventory.find((i: any) => i.name === params.item.name);
      if (existing) {
        // 合并 effects — 同名物品叠加效果
        if (params.item.effects && params.item.effects.length > 0) {
          existing.effects = [...(existing.effects || []), ...params.item.effects];
        }
        if (params.item.flavor) existing.flavor = [existing.flavor, params.item.flavor].filter(Boolean).join("\n");
        saveState();
        return {
          content: [{ type: "text", text: `${params.target}已有${params.item.name}，已合并新效果/描述（未创建重复物品）。原因: ${params.reason}` }],
          details: { item: existing.name, merged: true }
        };
      }

      // Validate damage for weapon
      if (params.item.type === "weapon" && !params.item.damage) {
        return { content: [{ type: "text", text: "错误: weapon 类型的物品必须指定 damage 参数" }], details: {} };
      }
      if (!params.item.volume || params.item.volume < 0) {
        return { content: [{ type: "text", text: "错误: 物品必须指定 volume（体积，升）" }], details: {} };
      }

      // 负重校验（仅玩家）
      if (params.target === "玩家" || params.target === gameState.player.name) {
        const { calcCurrentWeight, calcMaxCarry } = await import("../../engine/state.ts");
        const currentWt = calcCurrentWeight(gameState.player.inventory, gameState.player.equipment);
        const maxCarry = calcMaxCarry(gameState.player.attributes.力量 || 10);
        if (currentWt + (params.item.weight || 0) > maxCarry) {
          return {
            content: [{ type: "text", text: `负重超限：当前 ${currentWt.toFixed(1)}kg + ${params.item.name}(${params.item.weight}kg) 超过最大负重 ${maxCarry.toFixed(1)}kg。请丢弃部分物品后再试。` }],
            details: { currentWeight: currentWt, maxCarry, itemWeight: params.item.weight }
          };
        }
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
        effects: params.item.effects && params.item.effects.length > 0 ? params.item.effects : [{ type: "narrative", value: "纯叙事物品——无预设机械效果，效果由GM自由演绎" }],
      };
      if (params.item.damage) {
        itemObj.damage = params.item.damage;
      }
      if (params.item.is_furniture) {
        itemObj.is_furniture = true;
      }

      targetChar.inventory.push(itemObj);
      saveState();

      return {
        content: [{ type: "text", text: `成功生成物品 ${params.item.name} 并放入 ${params.target} 的背包。原因: ${params.reason}` }],
        details: { item: itemObj }
      };
    },
  };
