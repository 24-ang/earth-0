import { showPanel } from "../helpers.ts";

export default {
    description: "查看周边NPC的日程安排与当前位置",
    handler: async (_args, ctx) => {
      const { gameState, getMemoryTags } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const t = gameState.time;

      lines.push(`📋 NPC 日程一览 | ${t.game_date} ${t.day_of_week}曜日 ${t.time_of_day}`);
      lines.push("────────────────────────────────────────");

      const npcs = Object.entries(gameState.npcs);
      if (npcs.length === 0) {
        lines.push("（尚未追踪任何NPC日程）");
      } else {
        // 按位置分组
        const byLocation: Record<string, string[]> = {};
        for (const [name, npc] of npcs) {
          const loc = npc.currentRoom || "未知";
          if (!byLocation[loc]) byLocation[loc] = [];
          const tags = getMemoryTags(name);
          const override = npc.pendingOverride;
          let info = name;
          if (override) info += ` [🔶${override.location}]`;
          if (tags.length > 0) info += ` 🏷${tags.length}`;
          info += ` | ${npc.action || npc.scheduleGroup || "?"}`;
          byLocation[loc].push(info);
        }

        for (const [loc, names] of Object.entries(byLocation)) {
          const isHere = loc === gameState.player.location;
          lines.push(`${isHere ? "📍" : "  "} ${loc} (${names.length}人)`);
          for (const n of names.slice(0, 8)) {
            lines.push(`    ${n}`);
          }
          if (names.length > 8) lines.push(`    ... 还有 ${names.length - 8} 人`);
        }
      }

      lines.push("────────────────────────────────────────");
      lines.push("🔶 = 日程覆盖中 | 🏷 = 有记忆标签");
      lines.push("📍 = 当前位置");

      await showPanel(ctx, "📋 NPC日程", lines);
    },
  };
