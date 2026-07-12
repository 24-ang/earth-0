import { showPanel } from "../helpers.ts";

export default {
    description: "查看当前生效的警报状态（通缉/暴露/警戒）",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const f = gameState.flags || {} as any;
      const alerts: { flag: string; icon: string; desc: string }[] = [];

      if ((f as any).steal_alert) alerts.push({ flag: "steal_alert", icon: "🚨", desc: "偷窃警报生效中" });
      if ((f as any).school_alert) alerts.push({ flag: "school_alert", icon: "🏫", desc: "校园警戒中" });
      if ((f as any).identity_exposed) alerts.push({ flag: "identity_exposed", icon: "🎭", desc: "身份已暴露" });
      if ((f as any).wanted) alerts.push({ flag: "wanted", icon: "👮", desc: "已被通缉" });
      const stealCaughtFlags = Object.keys(f as any).filter(k => k.startsWith("steal_caught_by_"));
      if (stealCaughtFlags.length > 0) {
        const names = stealCaughtFlags.map(k => k.replace("steal_caught_by_", ""));
        alerts.push({ flag: "steal_caught", icon: "👀", desc: `偷窃目击者: ${names.join("、")}` });
      }

      lines.push("🚨 当前警报状态");
      lines.push("────────────────────────────────────────");
      if (alerts.length === 0) {
        lines.push("✅ 一切正常，无活跃警报");
      } else {
        for (const a of alerts) {
          lines.push(`${a.icon} ${a.desc}`);
        }
      }
      lines.push("────────────────────────────────────────");
      lines.push(`当前身份: ${gameState.player.public_identity || "未公开"}`);
      const { getDisguiseIdentity } = await import("../../engine/state.ts");
      const disguise = getDisguiseIdentity(gameState.player);
      if (disguise) lines.push(`🎭 装备伪装: ${disguise}`);

      await showPanel(ctx, "🚨 警报", lines);
    },
  };
