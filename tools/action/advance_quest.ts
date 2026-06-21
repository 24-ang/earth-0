import { Type } from "typebox";

export default {
    name: "advance_quest", label: "推进任务",
    description: "推进任务节拍。可选outcomeKey指定玩家选择的分支。",
    parameters: Type.Object({
      eventId: Type.String({ description: "任务事件ID" }),
      outcomeKey: Type.Optional(Type.String({ description: "玩家选择的分支key，如'一起指导做曲奇'" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { advanceQuest, getActiveQuests } = await import("../../engine/timeline.ts");
      const { saveState } = await import("../../engine/state.ts");
      const r = advanceQuest(params.eventId, params.outcomeKey);
      saveState();
      if (!r) return { content: [{ type: "text", text: `推进任务失败: ${params.eventId}` }], details: {} };
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
