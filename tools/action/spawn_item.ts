import { Type } from "typebox";

export default {
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
      const { gameState, saveState, getOrCreateNPC, checkAddVolume } = await import("../../engine/state.ts");
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
  };
