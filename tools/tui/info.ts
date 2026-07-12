import { showMenu, showPanel, renderCalendarLines, renderQuestLines, renderAlertsLines, renderScheduleLines, renderWeatherLines, renderMemoryLines } from "../helpers.ts";

export default {
    description: "信息面板：日历/任务/警报/日程/天气/记忆",
    handler: async (_args, ctx) => {
      await showMenu(ctx, "📖 信息", [
        { label: "📅 日历与事件", detail: "今日事件+近期大事", action: async (_d: () => void) => { await showPanel(ctx, "📅 日历与事件", await renderCalendarLines()); } },
        { label: "📋 任务与剧情", detail: "进行中任务+剧情钩子", action: async (_d: () => void) => { await showPanel(ctx, "任务与剧情", await renderQuestLines()); } },
        { label: "🚨 警报状态", detail: "通缉/暴露/警戒", action: async (_d: () => void) => { await showPanel(ctx, "🚨 警报", await renderAlertsLines()); } },
        { label: "📋 NPC 日程", detail: "周边NPC按位置分组", action: async (_d: () => void) => { await showPanel(ctx, "📋 NPC日程", await renderScheduleLines()); } },
        { label: "🌈 天气", detail: "当前天气+季节", action: async (_d: () => void) => { await showPanel(ctx, "🌈 天气", await renderWeatherLines()); } },
        { label: "🧠 NPC 记忆", detail: "NPC对你的记忆标签", action: async (_d: () => void) => { await showPanel(ctx, "🧠 NPC记忆", await renderMemoryLines()); } },
      ]);
    },
  };
