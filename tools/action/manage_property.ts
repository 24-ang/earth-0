import { Type } from "typebox";

export default {
    name: "manage_property",
    label: "房产交易",
    description: "购买或租用房产。action: buy|rent|terminate。propertyId须存在于房产名录。",
    parameters: Type.Object({
      propertyId: Type.String({ description: "房产唯一 ID" }),
      action: Type.String({ description: "buy|rent|terminate" })
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { purchaseOrRentProperty } = await import("../../engine/housing.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      const msg = purchaseOrRentProperty(params.propertyId, params.action as any, gameState);
      saveState();
      return { content: [{ type: "text", text: msg }], details: {} };
    }
  };
