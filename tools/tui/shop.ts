import { showPanel } from "../helpers.ts";

export default {
    description: "浏览附近商店货架与打工列表",
    handler: async (_args, ctx) => {
      const { gameState, getLocationNav, getCurrency, getRoom, shopsCatalog, economyConfig } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const loc = gameState.player.location;

      lines.push(`🏪 商店与打工`);
      lines.push("────────────────────────────────────────");
      lines.push(`📍 当前位置: ${loc}`);

      // shops.json 是平铺结构 { 店类型: { items:[...] } }
      const shopTypes = shopsCatalog && typeof shopsCatalog === "object" ? Object.keys(shopsCatalog) : [];

      // 匹配"附近商店"：当前房间的家具名 或 位置/面包屑名 命中某个店类型
      const nav = getLocationNav(loc);
      const room = getRoom(loc);
      const furnitureNames: string[] = [];
      if (room?.cells) for (const row of room.cells) for (const c of (row || [])) if (c?.furniture) furnitureNames.push(c.furniture);
      const locText = [loc, ...(nav.breadcrumb || [])].join(" ");
      const matched = shopTypes.filter(t =>
        furnitureNames.some(f => f.includes(t) || t.includes(f)) || locText.includes(t)
      );

      if (matched.length > 0) {
        for (const t of matched) {
          const items = (shopsCatalog as any)[t]?.items || [];
          lines.push("");
          lines.push(`🏬 ${t} (${items.length}种)`);
          for (const it of items.slice(0, 12)) lines.push(`  • ${it}`);
          if (items.length > 12) lines.push(`  ... 还有 ${items.length - 12} 种`);
        }
      } else {
        lines.push("");
        lines.push("（这附近没有可直接光顾的货架）");
        if (shopTypes.length > 0) lines.push(`世界内已知店类型: ${shopTypes.join("、")}（走到对应场所或找到相应家具再逛）`);
      }

      // 打工列表（用引擎已加载的 economyConfig，不读 data/ 兜底）
      lines.push("");
      lines.push("────────────────────────────────────────");
      lines.push("💼 可打工种 (时薪):");
      const jobRates = (economyConfig as any)?.job_rates;
      if (jobRates && Object.keys(jobRates).length > 0) {
        for (const [job, rate] of Object.entries(jobRates) as any) lines.push(`  • ${job}: ${getCurrency()}${rate}/小时`);
      } else {
        lines.push("  （暂无可打工种数据）");
      }
      lines.push("────────────────────────────────────────");
      lines.push(`💰 你的余额: ${getCurrency()}${gameState.player.funds}`);
      lines.push("使用 buy_item / sell_item / work_job 工具进行交易。");

      await showPanel(ctx, "🏪 商店", lines);
    },
  };
