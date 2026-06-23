import { Type } from "typebox";
import { showPanel } from "../helpers.ts";

export default {
    description: "浏览附近商店货架与打工列表",
    handler: async (_args, ctx) => {
      const { gameState, getLocationNav, getCurrency } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const loc = gameState.player.location;

      lines.push(`🏪 商店与打工`);
      lines.push("────────────────────────────────────────");
      lines.push(`📍 当前位置: ${loc}`);

      // 加载商店数据
      let shops: any = null;
      try {
        const { shopsCatalog } = await import("../../engine/state.ts");
        shops = shopsCatalog;
      } catch (e) {
        console.error("shop command shopsCatalog loading error:", e);
      }
      let economy: any = null;
      try {
        economy = (await import("../../data/economy.json", { with: { type: "json" } })).default;
      } catch (e) {
        console.error("shop command economy loading error:", e);
      }

      // 匹配附近商店
      const nav = getLocationNav(loc);
      const foundShops: any[] = [];
      if (shops?.shops) {
        for (const [sname, sdata] of Object.entries(shops.shops) as any) {
          const sloc = sdata.location || "";
          if (loc.includes(sloc) || sloc.includes(loc) ||
              nav.breadcrumb.some((b: string) => b.includes(sloc) || sloc.includes(b))) {
            foundShops.push({ name: sname, ...sdata });
          }
        }
      }

      if (foundShops.length > 0) {
        for (const shop of foundShops) {
          lines.push("");
          lines.push(`🏬 ${shop.name} (${shop.type || "杂货"})`);
          if (shop.inventory && shop.inventory.length > 0) {
            for (const item of shop.inventory.slice(0, 8)) {
              const price = item.price ? `${getCurrency()}${item.price}` : "?";
              lines.push(`  • ${item.name} — ${price}`);
            }
            if (shop.inventory.length > 8) lines.push(`  ... 还有 ${shop.inventory.length - 8} 件`);
          }
        }
      } else {
        lines.push("");
        lines.push("（附近未匹配到商店。移动到商业区试试？）");
      }

      // 打工列表
      lines.push("");
      lines.push("────────────────────────────────────────");
      lines.push("💼 可打工种 (2010千叶时薪):");
      if (economy?.job_rates) {
        for (const [job, rate] of Object.entries(economy.job_rates) as any) {
          lines.push(`  • ${job}: ${getCurrency()}${rate}/小时`);
        }
      }
      lines.push("────────────────────────────────────────");
      lines.push(`💰 你的余额: ${getCurrency()}${gameState.player.funds}`);
      lines.push("使用 buy_item / sell_item / work_job 工具进行交易。");

      await showPanel(ctx, "🏪 商店", lines);
    },
  };
