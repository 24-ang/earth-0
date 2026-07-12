import { showMenu, showPanel, renderShopLines, renderGambleLines, renderHousingLines } from "../helpers.ts";

export default {
    description: "经济面板：商店打工 / 博弈黑市 / 房产储物",
    handler: async (_args, ctx) => {
      await showMenu(ctx, "💰 经济", [
        { label: "🏪 商店与打工", detail: "附近货架 + 打工时薪", action: async (_d: () => void) => { await showPanel(ctx, "🏪 商店", await renderShopLines()); } },
        { label: "🎲 博弈与黑市", detail: "赔率 + 黑市折算", action: async (_d: () => void) => { await showPanel(ctx, "🎲 博弈与黑市", await renderGambleLines()); } },
        { label: "🏠 房产与储物", detail: "安全屋 + 储物柜", action: async (_d: () => void) => { await showPanel(ctx, "🏠 安全屋状态", await renderHousingLines()); } },
      ]);
    },
  };
