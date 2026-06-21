export default {
    description: "管理存档。不带参数=查看，/saves delete <名>=删除",
    handler: async (args: string, ctx: any) => {
      const { listSaves, deleteSave, createSave, loadSave, gameState, saveState } = await import("../../engine/state.ts");
      const parts = args.trim().split(/\s+/);
      if (parts[0] === "delete" && parts[1]) {
        const ok = deleteSave(parts[1]);
        ctx.ui.notify(ok ? `🗑️ 已删除: ${parts[1]}` : `❌ 未找到: ${parts[1]}`, ok ? "info" : "warning");
        return;
      }

      const saves = listSaves();
      if (saves.length === 0) {
        ctx.ui.notify("📭 暂无手动存档。用 /save <名> 创建。", "info");
        return;
      }

      const lines = ["📂 手动存档列表", "────────────────────"];
      for (const s of saves) {
        lines.push(`  ${s.name} — ${s.date} 第${s.turn}回合 @ ${s.location}`);
      }
      lines.push("────────────────────");
      lines.push("/load <名> 载入 | /saves delete <名> 删除");
      await (await import("../../extension.ts")).showPanel(ctx, "📂 存档管理", lines);
    },
  };
