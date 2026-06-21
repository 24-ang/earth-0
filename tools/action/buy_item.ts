import { Type } from "typebox";

export default {
    name: "buy_item", label: "购买",
    description: "购买物品。LLM定价，引擎校验价格范围+商店货架。",
    parameters: Type.Object({
      item: Type.String(),
      price: Type.Number(),
      shop: Type.Optional(Type.String({ description: "商店名。不传则只校验价格；传了额外校验该店货架是否有此物品。" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { buyItem } = await import("../../engine/state.ts");
      const r = buyItem(params.item, params.price, params.shop);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
