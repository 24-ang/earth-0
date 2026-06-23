import { showMenu, type MenuItem } from "../helpers.ts";
import fs from "node:fs";
import path from "node:path";

export default {
  description: "查看已解锁与未解锁的成就列表",
  handler: async (_args, ctx) => {
    const { gameState } = await import("../../engine/state.ts");

    // 加载成就定义
    const achievementsPath = path.resolve(process.cwd(), "data", "achievements.json");
    let achievementRules: { id: string; name: string; description: string }[] = [];
    try {
      achievementRules = JSON.parse(fs.readFileSync(achievementsPath, "utf-8"));
    } catch (e) {
      console.error("Failed to load achievements.json:", e);
    }

    const flags = gameState.flags || {};
    const unlockedList = achievementRules.filter(r => !!flags[r.id]);
    const lockedList = achievementRules.filter(r => !flags[r.id]);

    const items: MenuItem[] = [];
    items.push({
      label: `🏆 成就系统 (已解锁: ${unlockedList.length} / ${achievementRules.length})`,
      detail: ""
    });
    items.push({ label: "────────────────────────────────────────", detail: "" });

    if (unlockedList.length > 0) {
      items.push({ label: `✨ 已解锁 (${unlockedList.length})`, detail: "" });
      for (const ach of unlockedList) {
        items.push({
          label: `  🏆 【${ach.name}】`,
          detail: ach.description
        });
      }
    } else {
      items.push({ label: "✨ 已解锁 (无)", detail: "" });
    }

    items.push({ label: "────────────────────────────────────────", detail: "" });

    if (lockedList.length > 0) {
      items.push({ label: `🔒 未解锁 (${lockedList.length})`, detail: "" });
      for (const ach of lockedList) {
        items.push({
          label: `  🔒 【${ach.name}】`,
          detail: ach.description
        });
      }
    } else {
      items.push({ label: "🔒 所有成就已全部解锁！", detail: "" });
    }

    await showMenu(ctx, "🏆 达成成就", items);
  }
};
