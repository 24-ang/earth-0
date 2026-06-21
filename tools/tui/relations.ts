import { Type } from "typebox";
import { showPanel } from "../helpers.ts";

export default {
    description: "查看所有NPC关系与恋爱阶段",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const rels = gameState.player.relationships;
      
      lines.push("👤 关系与恋爱状态概览");
      lines.push("────────────────────────────────────────");

      const buildBar = (val: number) => {
        const filled = Math.round(val / 20);
        return "■".repeat(filled) + "□".repeat(5 - filled);
      };

      const nextThreshold = (aff: number): string => {
        if (aff < 20) return `距「熟人」(20) 还差 ${20 - aff}`;
        if (aff < 40) return `距「友人」(40) 还差 ${40 - aff}`;
        if (aff < 70) return `距「信赖」(70) 还差 ${70 - aff}`;
        if (aff < 90) return `距「至交」(90) 还差 ${90 - aff}`;
        return `已满 (100)`;
      };

      const romanceCondition = (rel: any): string => {
        if (!rel.romance) {
          if (rel.affection >= 60) return "💕 可触发「暧昧」(好感≥60，需特殊事件)";
          return `💕 暧昧需好感≥60 (当前${rel.affection})`;
        }
        if (rel.romance === "暧昧") return `💕 → 恋人: 需好感≥80 + 告白事件`;
        if (rel.romance === "恋人") return `💕 → 灵魂伴侣: 需好感≥95 + 深度事件`;
        return `💕 已达最高`;
      };

      for (const [n, r] of Object.entries(rels)) {
        const rel = r as any;
        lines.push(`👥 ${n}`);
        lines.push(`  |-[好感]: ${buildBar(rel.affection)} (${rel.affection}/100) | ${rel.stage}`);
        lines.push(`  |-[进阶]: ${nextThreshold(rel.affection)}`);
        lines.push(`  |-[恋爱]: ${romanceCondition(rel)}`);
        if (rel.romance) lines.push(`  |-[关系]: 💕${rel.romance}`);
        if (rel.notes) lines.push(`  |-[备注]: ${rel.notes}`);
        // 变化历史（最近5条）
        if (rel.history && rel.history.length > 0) {
          const recent = rel.history.slice(-5);
          lines.push(`  |-[最近变动]:`);
          for (const h of recent.reverse()) {
            const sign = h.delta >= 0 ? "+" : "";
            lines.push(`      ${h.date} ${sign}${h.delta}: ${h.reason}`);
          }
        }
        lines.push("────────────────────────────────────────");
      }
      if (Object.keys(rels).length === 0) {
        lines.push("（目前尚未结识任何角色）");
      }
      await showPanel(ctx, "👥 关系谱", lines);
    },
  };
