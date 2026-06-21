import { Type } from "typebox";

export default {
  name: "restock_shop", label: "改货架",
  description: "动态修改商店货架（经济危机/进货/换季）",
  parameters: Type.Object({
    shopName: Type.String({ description: "要修改的商店名称" }),
    items: Type.Optional(Type.Array(Type.String({ description: "全新货架列表（覆盖现有）" }))),
    add: Type.Optional(Type.Array(Type.String({ description: "追加到货架的商品" }))),
    remove: Type.Optional(Type.Array(Type.String({ description: "从货架移除的商品" }))),
    clear: Type.Optional(Type.Boolean({ description: "清空货架" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, shops, saveState } = await import("../../engine/state.ts");

    // 加载当前货架：优先运行时覆盖，回退到文件数据
    if (!gameState.shops) {
      gameState.shops = {};
    }
    // 初始化目标商店（如果运行时尚未存在，则从文件货架复制）
    if (!gameState.shops[params.shopName]) {
      const fileShop = (shops as Record<string, { items: string[] }>)[params.shopName];
      gameState.shops[params.shopName] = { items: fileShop ? [...fileShop.items] : [] };
    }

    const shelf = gameState.shops[params.shopName];

    if (params.clear) {
      shelf.items = [];
    }

    if (params.items !== undefined) {
      shelf.items = [...params.items];
    }

    if (params.add) {
      for (const item of params.add) {
        if (!shelf.items.includes(item)) {
          shelf.items.push(item);
        }
      }
    }

    if (params.remove) {
      shelf.items = shelf.items.filter((i: string) => !params.remove!.includes(i));
    }

    saveState();

    const itemList = shelf.items.length > 0 ? shelf.items.join("、") : "（空）";
    return {
      content: [{ type: "text", text: `商店「${params.shopName}」货架已更新：${itemList}（共${shelf.items.length}件）` }],
      details: {},
    };
  },
};
