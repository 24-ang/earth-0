import { showPanel } from "../helpers.ts";

export default {
    description: "查看当前天气与未来趋势",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const t = gameState.time;
      const m = Number(t.game_date.split("-")[1]);
      const season = m >= 3 && m <= 5 ? "春" : m >= 6 && m <= 8 ? "夏" : m >= 9 && m <= 11 ? "秋" : "冬";

      lines.push(`🌈 天气面板`);
      lines.push("────────────────────────────────────────");
      lines.push(`📅 ${t.game_date} ${t.day_of_week}曜日 ${t.time_of_day}`);
      lines.push(`🌤 当前: ${gameState.weather?.type || "晴"}`);
      lines.push(`🌡 季节: ${season} | 温度: ${gameState.weather?.temp ?? "?"}°C`);
      lines.push("────────────────────────────────────────");
      lines.push(`下次天气更新: 游戏内约4小时后`);
      lines.push("────────────────────────────────────────");
      lines.push("提示: 天气影响移动速度、NPC出没、事件触发。");
      lines.push("暴雨天NPC倾向待在室内，下雪天操场不可用。");

      await showPanel(ctx, "🌈 天气", lines);
    },
  };
