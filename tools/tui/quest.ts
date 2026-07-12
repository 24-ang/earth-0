import { showMenu } from "../helpers.ts";

export default {
    description: "查看当前正在进行的任务与剧情线",
    handler: async (_args, ctx) => {
      const { getActiveQuests } = await import("../../engine/timeline.ts");
      const { gameState } = await import("../../engine/state.ts");
      const activeQuests = getActiveQuests();
      
      const items: any[] = [];
      items.push({ label: `📋 进行中的任务: (${activeQuests.length})`, detail: "" });
      items.push({ label: "────────────────────────────────────────", detail: "" });
      
      if (activeQuests.length > 0) {
        for (const q of activeQuests) {
          items.push({ label: `▶ [${q.id}] ${q.title || ""}`, detail: "" });
        }
      } else {
        items.push({ label: "  (当前没有正在进行的任务)", detail: "" });
      }

      items.push({ label: "────────────────────────────────────────", detail: "" });
      const hooks = gameState.active_hooks || [];
      items.push({ label: `🔗 等待触发的剧情钩子: (${hooks.length})`, detail: "" });
      if (hooks.length > 0) {
        for (const h of hooks) {
          items.push({ label: `  - ${h.event_id} (${h.urgency || "?"})`, detail: (h.hook_text || "").slice(0, 40) });
        }
      }

      await showMenu(ctx, `任务与剧情`, items);
    }
  };
