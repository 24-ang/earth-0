import { Type } from "typebox";
import { showPanel } from "../helpers.ts";

export default {
    description: "查看博弈赔率与灰色交易状态",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const { getHousingCatalog } = await import("../../engine/housing.ts");
      const { getBlackMarketPrice } = await import("../../engine/gambling.ts");
      const lines: string[] = [];
      
      lines.push("🎲 灰色博弈与黑市状态");
      lines.push("────────────────────────────────────────");
      lines.push(` 💰 当前资金: ${gameState.player.funds} 资金`);
      const rep = gameState.player.reputation?.["underworld"] ?? 0;
      const aff = gameState.player.relationships?.["underworld_merchant"]?.affection ?? 0;
      lines.push(` 💀 地下声望: ${rep}/10  |  🤝 黑市商人好感: ${aff}/100`);
      lines.push("────────────────────────────────────────");
      lines.push("📈 可用博弈项目：");
      const catalog = (await import("../../engine/state.ts")).economyConfig;
      const games = catalog.gambling?.games || {
        "dice_2d6": { label: "掷双骰", payout_multiplier: 2.0, difficulty_class: 12 },
        "blackjack": { label: "二十一点", payout_multiplier: 2.0, difficulty_class: 14 }
      };

      for (const [key, config] of Object.entries(games) as any) {
        lines.push(`  • [${key}] ${config.label}: 赔率 x${config.payout_multiplier} | 判定DC: ${config.difficulty_class}`);
      }

      lines.push("────────────────────────────────────────");
      lines.push("⚖️ 黑市交易折扣预测：");
      const buyRate = getBlackMarketPrice("buy", 100, rep, aff);
      const sellRate = getBlackMarketPrice("sell", 100, rep, aff);
      lines.push(`  • 购入违禁品折算比率: ${buyRate}% (原价100 -> 黑市售价 ${buyRate})`);
      lines.push(`  • 出售赃物折算比率: ${sellRate}% (原价100 -> 黑市回收价 ${sellRate})`);
      lines.push("────────────────────────────────────────");
      
      await showPanel(ctx, "🎲 博弈与黑市", lines);
    }
  };
