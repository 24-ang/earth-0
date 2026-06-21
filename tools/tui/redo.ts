export default {
    description: "回退到倒数第 N 次输入前（默认1）。保留最近 5 回合自动备份。",
    handler: async (args: string, ctx: any) => {
      const { restoreLastTurn, listBackups, saveState } = await import("../../engine/state.ts");
      const n = parseInt(args.trim()) || 1;
      const ok = restoreLastTurn(n);
      if (ok) {
        saveState();
        const backups = listBackups();
        ctx.ui.notify(`↩ 已回退 ${n} 回合 → ${backups.length} 个备份可用 (${backups.join(",")})`, "info");
      } else {
        ctx.ui.notify(`❌ 没有倒数第 ${n} 回合的备份。最多保留 5 个。`, "warning");
      }
    },
  };
