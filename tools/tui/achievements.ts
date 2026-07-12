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

    // 无成就定义时诚实提示，别显示自相矛盾的"全部解锁"
    if (achievementRules.length === 0) {
      await showMenu(ctx, "🏆 达成成就", [
        { label: "🏆 成就系统", detail: "" },
        { label: "────────────────────────────────────────", detail: "" },
        { label: "（成就系统尚未配置）", detail: "data/achievements.json 为空" },
        { label: "  暂无成就定义，也没有解锁记录。", detail: "" },
      ]);
      return;
    }

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
