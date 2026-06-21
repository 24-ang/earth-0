import { Type } from "typebox";
import { showMenu } from "../helpers.ts";

export default {
    description: "查看今日日历事件与近期大事",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const { getTodayCalendar, getActiveQuests } = await import("../../engine/timeline.ts");
      const items: MenuItem[] = [];
      items.push({ label: `📅 ${gameState.time.game_date} ${gameState.time.day_of_week}曜日`, detail: "" });
      items.push({ label: "────────────────────────────────────────", detail: "" });

      const todayEvent = getTodayCalendar();
      if (todayEvent) {
        items.push({ label: "📌 今日事件", detail: "" });
        items.push({ label: `  ${todayEvent}`, detail: "" });
      } else {
        items.push({ label: "📌 今日: 无特殊事件", detail: "" });
      }

      items.push({ label: "────────────────────────────────────────", detail: "" });
      const quests = getActiveQuests();
      items.push({ label: `📋 进行中的任务 (${quests.length})`, detail: "" });
      if (quests.length > 0) {
        for (const q of quests) {
          items.push({ label: `  ▶ ${q.id}`, detail: q.title || "" });
        }
      } else {
        items.push({ label: "  (无)", detail: "" });
      }

      items.push({ label: "────────────────────────────────────────", detail: "" });
      const hooks = gameState.active_hooks || [];
      items.push({ label: `🔗 待触发事件: ${hooks.length}`, detail: "" });
      if (hooks.length > 0) {
        for (const h of hooks.slice(0, 10)) {
          items.push({ label: `  • ${h.event_id}`, detail: `${h.urgency} | ${h.source_npc}` });
        }
      }

      await showMenu(ctx, "📅 日历与事件", items);
    },
  };
