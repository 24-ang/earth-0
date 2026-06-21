import { Type } from "typebox";
import { showPanel } from "../helpers.ts";

export default {
    description: "查看当前持有的安全屋与储物柜状态",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const { getHousingCatalog } = await import("../../engine/housing.ts");
      const lines: string[] = [];

      lines.push("🏠 安全屋与储物柜概览");
      lines.push("────────────────────────────────────────");
      lines.push(` 💰 当前资金: ${gameState.player.funds} 资金`);
      lines.push("────────────────────────────────────────");

      const props = gameState.player.properties || {};
      if (Object.keys(props).length === 0) {
        lines.push("  你当前名下没有任何房产或安全屋。");
        lines.push("  你可以使用 `manage_property` 购买或租用房产。");
      } else {
        for (const [id, prop] of Object.entries(props)) {
          const typeStr = prop.type === "own" ? "【永久产权】" : `【租赁契约 (欠费 ${prop.arrears_days}天)】`;
          lines.push(`🏠 ${prop.name} (${id}) ${typeStr}`);
          lines.push(`  • 坐落区域: ${prop.regionId}`);
          if (prop.type === "rent") {
            lines.push(`  • 租金: ${prop.rent_fee} 资金/30天 | 下次扣租: ${prop.rent_due_date}`);
          }
          
          const curVol = prop.storage.reduce((sum, i) => sum + i.volume * i.quantity, 0);
          const curWgt = prop.storage.reduce((sum, i) => sum + i.weight * i.quantity, 0);
          lines.push(`  • 储物箱体积: ${curVol.toFixed(2)}/${prop.max_volume} m³`);
          lines.push(`  • 储物箱承重: ${curWgt.toFixed(2)}/${prop.max_weight} kg`);
          
          if (prop.storage.length === 0) {
            lines.push("  • 储物箱内容: 空");
          } else {
            lines.push("  • 储物柜内物品：");
            for (const item of prop.storage) {
              lines.push(`    - ${item.name} x${item.quantity} (${(item.weight * item.quantity).toFixed(1)}kg, ${(item.volume * item.quantity).toFixed(2)}m³)`);
            }
          }
          lines.push("────────────────────────────────────────");
        }
      }
      
      await showPanel(ctx, "🏠 安全屋状态", lines);
    }
  };
