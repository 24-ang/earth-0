export default {
    description: "创建命名存档（需在安全地点）。用法: /save <存档名> 或 /save (默认=quick)",
    handler: async (args: string, ctx: any) => {
      const { gameState, createSave } = await import("../../engine/state.ts");
      const loc = gameState.player.location;
      // 世界无关：当前位置属于任一自有房产即视为安全地；通用建筑词作兜底（不含角色专属地名）
      const ownsHere = Object.values(gameState.player.properties || {}).some((p: any) => p?.name && (loc.includes(p.name) || p.name.includes(loc)));
      const safe = ownsHere || loc.includes("家") || loc.includes("公寓") || loc.includes("邸") || loc.includes("教室") || loc.includes("部室");
      if (!safe) {
        ctx.ui.notify("⚠ 这里不是安全地点。在安全地点（家/公寓/教室/部室）才能存档。\n用 /redo 可以随时回退最近几回合。", "warning");
        return;
      }
      const name = args.trim() || "quick";
      const saved = createSave(name);
      ctx.ui.notify(`💾 已存档: ${saved}`, "info");
    },
  };
