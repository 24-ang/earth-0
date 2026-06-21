import { Type } from "typebox";

export default {
    name: "black_market_trade",
    label: "黑市交易",
    description: "黑市买卖违禁品。action: buy|sell。itemType: contraband|stolen。",
    parameters: Type.Object({
      action: Type.String({ description: "buy|sell" }),
      itemName: Type.String({ description: "物品名称" }),
      quantity: Type.Number({ description: "数量" }),
      itemType: Type.String({ description: "物品类别 (contraband|stolen)" })
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getBlackMarketPrice } = await import("../../engine/gambling.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      
      const rep = gameState.player.reputation?.["underworld"] ?? 0;
      const aff = gameState.player.relationships?.["underworld_merchant"]?.affection ?? 0;

      const { itemsCatalog } = await import("../../engine/state.ts");
      let itemConfig: any = null;
      for (const cat of Object.values(itemsCatalog || {})) {
        if ((cat as any)[params.itemName]) {
          itemConfig = (cat as any)[params.itemName];
          break;
        }
      }
      const basePrice = itemConfig?.price ?? 100;
      const finalPrice = getBlackMarketPrice(params.action as any, basePrice, rep, aff);
      const totalAmount = finalPrice * params.quantity;

      if (params.action === "buy") {
        if (gameState.player.funds < totalAmount) {
          return { content: [{ type: "text", text: `黑市交易失败: 资金不足。需要 ${totalAmount} 资金，当前仅有 ${gameState.player.funds}` }], details: {} };
        }
        gameState.player.funds -= totalAmount;
        for (let q = 0; q < params.quantity; q++) {
          gameState.player.inventory.push({
            name: params.itemName,
            type: itemConfig?.type ?? "consumable",
            slot: itemConfig?.slot ?? "left_hand",
            weight: itemConfig?.weight ?? 0.1,
            state: "intact",
            effects: itemConfig?.effects ?? [],
            flavor: itemConfig?.flavor ?? "从黑市购得的物品",
          });
        }
      } else {
        const matches = gameState.player.inventory.filter(i => i.name === params.itemName);
        if (matches.length < params.quantity) {
          return { content: [{ type: "text", text: `黑市交易失败: 背包中没有足够的 [${params.itemName}]` }], details: {} };
        }
        let removed = 0;
        gameState.player.inventory = gameState.player.inventory.filter(item => {
          if (item.name === params.itemName && removed < params.quantity) {
            removed++;
            return false;
          }
          return true;
        });
        gameState.player.funds += totalAmount;
      }
      saveState();
      return { content: [{ type: "text", text: `黑市交易成功！以单价 ${finalPrice} 交易了 ${params.quantity} 件 [${params.itemName}] (共计 ${totalAmount} 资金)。` }], details: { finalPrice, totalAmount } };
    }
  };
