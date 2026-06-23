import { Type } from "typebox";

export default {
    name: "open_quest", label: "开启任务",
    description: "剧情钩子→活跃任务。仅当玩家明确接受委托后调用。",
    parameters: Type.Object({
      eventId: Type.String({ description: "事件ID，来自 active_hooks 中的 event_id" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { openQuest, getActiveQuests } = await import("../../engine/timeline.ts");
      const { saveState } = await import("../../engine/state.ts");
      const r = await openQuest(params.eventId);
      saveState();
      if (!r) return { content: [{ type: "text", text: `开启任务失败: ${params.eventId}` }], details: {} };
      const quests = getActiveQuests();
      return { content: [{ type: "text", text: `${r}\n当前活跃任务: ${quests.map(q => q.title).join("、") || "无"}` }], details: {} };
    },
  };
