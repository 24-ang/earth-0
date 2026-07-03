import { Type } from "typebox";

export default {
    name: "create_story_hook", label: "创建剧情钩子",
    description: "GM创建动态剧情钩子，注入事件循环",
    parameters: Type.Object({
      hook_text: Type.String({ description: "钩子文本，自然叙事，不朗读" }),
      source_npc: Type.String({ description: "发起NPC（或'世界'）" }),
      urgency: Type.String({ description: "low|medium|high", default: "medium" }),
      title: Type.Optional(Type.String({ description: "事件标题" })),
      expires_days: Type.Optional(Type.Number({ description: "过期天数，默认3" })),
      trigger_location: Type.Optional(Type.String({ description: "触发地点限制" })),
      trigger_time_of_day: Type.Optional(Type.Array(Type.String(), { description: "触发时间段限制" })),
      trigger_affection: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "触发好感度要求 {NPC名: 最低值}" })),
      trigger_flags: Type.Optional(Type.Record(Type.String(), Type.Boolean(), { description: "触发flag要求" })),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { injectDynamicEvent } = await import("../../engine/timeline.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");

      // 自动生成唯一 ID
      const n = (gameState.dynamicEvents || []).filter((e: any) => e.source === "llm").length;
      const eventId = `llm_${gameState.turn}_${n}`;

      // 组装可选的 trigger 对象
      const trigger: any = {};
      if (params.trigger_location) trigger.location = params.trigger_location;
      if (params.trigger_time_of_day?.length) trigger.time_of_day = params.trigger_time_of_day;
      if (params.trigger_affection) trigger.affection = params.trigger_affection;
      if (params.trigger_flags) trigger.flags = params.trigger_flags;

      const event = {
        id: eventId,
        title: params.title,
        source: "llm" as const,
        trigger: Object.keys(trigger).length > 0 ? trigger : undefined,
        expires_days: params.expires_days ?? 3,
        repeatable: false,
        hook: {
          source_npc: params.source_npc,
          hook_text: params.hook_text,
          urgency: (["low", "medium", "high"].includes(params.urgency) ? params.urgency : "medium") as "low" | "medium" | "high",
        },
      };

      const result = injectDynamicEvent(event);
      // 立即扫描注入的钩子，使其在 active_hooks 中立即可见
      const { checkTimelineEvents } = await import("../../engine/timeline.ts");
      checkTimelineEvents();
      saveState();
      return {
        content: [{ type: "text", text: `${result}\n钩子文本: ${params.hook_text}\n优先级: ${event.hook.urgency} | 过期: ${event.expires_days}天后` }],
        details: { eventId, event },
      };
    }
  };
