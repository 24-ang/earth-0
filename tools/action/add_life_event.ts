import { Type } from "typebox";

export default {
    name: "add_life_event", label: "添加人生事件",
    description: "为NPC添加人生事件（疾病/怀孕等），引擎自动追踪",
    parameters: Type.Object({
      npc_name: Type.String({ description: "NPC名" }),
      event_type: Type.String({ description: "事件类型: illness|pregnancy" }),
      event_id: Type.String({ description: "事件唯一ID，如 illness_yui_flu" }),
      details: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "事件详情: illness→{type,severity,contagious} / pregnancy→{father,child_name?}" })),
      reason: Type.String({ description: "原因描述" }),
    }),
    async execute(_id: any, params: any, _s: any, _o: any, _ctx: any) {
      const { addLifeEvent } = await import("../../engine/life-events.ts");
      const { currentDay } = await import("../../engine/timeline.ts");
      const day = currentDay();

      let data: any = {};
      if (params.event_type === "illness") {
        data = {
          type: params.details?.type || "感冒",
          severity: params.details?.severity || "轻",
          day_started: day,
          contagious: params.details?.contagious ?? false,
        };
      } else if (params.event_type === "pregnancy") {
        data = {
          day_conceived: day,
          father: params.details?.father || "未知",
          stage: "early" as const,
          child_name: params.details?.child_name,
        };
      }

      const event = {
        id: params.event_id,
        type: params.event_type as "illness" | "pregnancy",
        data,
        day_started: day,
      };

      const result = addLifeEvent(params.npc_name, event);
      return {
        content: [{ type: "text", text: `${result}\n原因: ${params.reason}\n详情: ${JSON.stringify(data)}` }],
        details: { npc: params.npc_name, event },
      };
    }
  };
