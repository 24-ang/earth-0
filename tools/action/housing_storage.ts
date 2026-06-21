import { Type } from "typebox";

export default {
    name: "housing_storage",
    label: "房产存储",
    description: "在房产内存储或取出物品。action: store|retrieve。数量须大于0。",
    parameters: Type.Object({
      propertyId: Type.String({ description: "房产唯一 ID" }),
      action: Type.String({ description: "store|retrieve" }),
      itemName: Type.String({ description: "物品名称" }),
      quantity: Type.Number({ description: "数量" })
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { transferHousingStorage } = await import("../../engine/housing.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      const msg = transferHousingStorage(params.propertyId, params.action as any, params.itemName, params.quantity, gameState);
      saveState();
      return { content: [{ type: "text", text: msg }], details: {} };
    }
  };
