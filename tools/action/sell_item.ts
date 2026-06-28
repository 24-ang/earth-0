import { Type } from "typebox";

export default {
    name: "sell_item", label: "出售",
    description: "出售物品。LLM定价，引擎校验价格+商店收货范围。可指定buyer卖给NPC（扣NPC资金）。",
    parameters: Type.Object({
      item: Type.String({ description: "要出售的物品名" }),
      price: Type.Number({ description: "售价（日元）" }),
      buyer: Type.Optional(Type.String({ description: "买家NPC名。不传则卖给系统商店。" })),
      shop: Type.Optional(Type.String({ description: "商店名。不传则只校验价格；传了额外校验该店货架是否收此物品。" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { sellItem } = await import("../../engine/state.ts");
      const r = sellItem(params.item, params.price, params.buyer, params.shop);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
