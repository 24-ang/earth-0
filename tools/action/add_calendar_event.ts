import { Type } from "typebox";

export default {
    name: "add_calendar_event", label: "添加日程事件",
    description: "动态添加一个未来的日程日历事件。LLM用于规划相约、生日或期限限制。",
    parameters: Type.Object({
      year: Type.Optional(Type.Number({ description: "年份，缺省则任意年份生效" })),
      date: Type.String({ description: "日期，格式如：'4月7日'" }),
      location: Type.Optional(Type.String({ description: "地点，缺省则任意地点生效" })),
      text: Type.String({ description: "日程说明内容" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { clearCalendarCache } = await import("../../engine/timeline.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      if (!gameState.calendarEvents) {
        gameState.calendarEvents = [];
      }
      
      const newEvent = {
        year: params.year ?? null,
        date: params.date,
        location: params.location ?? null,
        text: params.text,
        world: gameState.activeWorld || "oregairu",
      };
      
      gameState.calendarEvents.push(newEvent);
      clearCalendarCache();
      return { content: [{ type: "text", text: `已成功在日历中添加日程: ${params.date} [${params.location || "任意地点"}] ${params.text}` }], details: { event: newEvent } };
    }
  };
