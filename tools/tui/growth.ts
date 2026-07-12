import { showPanel } from "../helpers.ts";

export default {
    description: "查看玩家身体发育状态与历史",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const p = gameState.player;

      lines.push(`📈 ${p.name} 发育面板 | ${p.age}岁 ${gameState.time.player_stage}`);
      lines.push("────────────────────────────────────────");
      if (p.body) {
        const b = p.body;
        lines.push(`📏 身高: ${b.height_cm}cm | 体重: ${b.weight_kg}kg | 体型: ${b.build}`);
        if (b.measurements) {
          lines.push(`📐 三围: ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}${b.cup ? ` (${b.cup}cup)` : ""}`);
        }
        if (b.skin) {
          lines.push(`🖐 肤色: ${b.skin.base_tone} | 肤质: ${b.skin.texture}`);
        }
      }
      lines.push("────────────────────────────────────────");
      lines.push(`🍽 饮食方案: ${p.body?.diet || "普通"}`);
      lines.push(`🏃 运动方案: ${p.body?.exercise || "普通"}`);
      lines.push("────────────────────────────────────────");
      lines.push("方案说明:");
      lines.push("  饮食: 普通 | 节食 | 高蛋白 | 丰胸食谱");
      lines.push("  运动: 普通 | 规律运动 | 高强度训练");
      lines.push("每月末自动结算发育（/sleep 到月末触发）");
      lines.push("或调用 monthly_growth 工具手动结算。");

      await showPanel(ctx, "📈 发育", lines);
    },
  };
