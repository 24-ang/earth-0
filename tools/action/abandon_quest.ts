import { Type } from "typebox";

export default {
    name: "abandon_quest", label: "放弃任务",
    description: "放弃活跃任务。玩家拒绝或无法继续时调用。",
    parameters: Type.Object({
      eventId: Type.String({ description: "要放弃的任务事件ID" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { abandonQuest, getActiveQuests } = await import("../../engine/timeline.ts");
      const { saveState } = await import("../../engine/state.ts");
      const r = abandonQuest(params.eventId);
      saveState();
      return { content: [{ type: "text", text: r || `已放弃: ${params.eventId}` }], details: {} };
    },
  };
