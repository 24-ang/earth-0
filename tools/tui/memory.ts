import { showPanel } from "../helpers.ts";

export default {
    description: "查看NPC对你的记忆标签（他们知道你什么）",
    handler: async (_args, ctx) => {
      const { gameState, getMemoryTags, getOrCreateNPC } = await import("../../engine/state.ts");
      const lines: string[] = [];
      lines.push("🧠 NPC 记忆标签");
      lines.push("────────────────────────────────────────");

      const npcs = Object.keys(gameState.npcs);
      let found = false;
      for (const name of npcs) {
        const npc = getOrCreateNPC(name);
        const tags = getMemoryTags(name);
        if (tags.length > 0) {
          found = true;
          lines.push(`👤 ${name} (${npc.currentRoom || "未知位置"})`);
          for (const tag of tags) {
            lines.push(`  📌 ${tag}`);
          }
          lines.push("");
        }
      }
      if (!found) {
        lines.push("（尚无NPC对你留下记忆标签）");
        lines.push("");
        lines.push("记忆标签在关键剧情事件时由GM写入，");
        lines.push("会被注入后续对话的NPC上下文中。");
      }

      await showPanel(ctx, "🧠 NPC记忆", lines);
    },
  };
