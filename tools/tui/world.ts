import { showPanel } from "../helpers.ts";

export default {
    description: "切换世界观。用法: /world load [世界名] 或 /world list",
    handler: async (args, ctx) => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { loadActiveWorld, saveState } = await import("../../engine/state.ts");

      const parts = args ? args.split(/\s+/) : ["list"];
      const action = parts[0] || "list";
      const targetWorld = parts[1];
      const dataDir = path.resolve(process.cwd(), "data");

      if (action === "list") {
        const lines: string[] = ["🌍 可用世界观列表："];
        lines.push("────────────────────────────────────────");
        const wpDir = path.resolve(process.cwd(), "worldpacks");
        if (fs.existsSync(wpDir)) {
          for (const d of fs.readdirSync(wpDir)) {
            const readme = path.join(wpDir, d, "README.md");
            if (fs.existsSync(readme)) {
              lines.push(`  • ${d}`);
            }
          }
        }
        lines.push("────────────────────────────────────────");
        const activeFile = path.join(dataDir, ".active_world");
        const current = fs.existsSync(activeFile) ? fs.readFileSync(activeFile, "utf-8").trim() : "oregairu";
        lines.push(`当前活跃世界观: ${current}`);
        await showPanel(ctx, "🌍 世界观", lines);
        return;
      }

      if (action === "load") {
        if (!targetWorld) {
          ctx.ui.notify("错误: 必须指定世界观名称，如 /world load oregairu", "error");
          return;
        }

        const wpDir = path.resolve(process.cwd(), "worldpacks", targetWorld);
        if (!fs.existsSync(wpDir)) {
          ctx.ui.notify(`错误: 世界观 ${targetWorld} 不存在`, "error");
          return;
        }

        // 写入 active_world 并加载
        fs.writeFileSync(path.join(dataDir, ".active_world"), targetWorld);
        loadActiveWorld(targetWorld);
        saveState();
        ctx.ui.notify(`✅ 成功切换世界观为: ${targetWorld}。刷新存档完毕。`, "info");
      }
    },
  };
