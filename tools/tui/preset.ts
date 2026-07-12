import { showMenu } from "../helpers.ts";

export default {
    description: "切换系统提示词组装配置（标准 default / 轻量 lite）。",
    handler: async (args, ctx) => {
      const { gameState, saveState } = await import("../../engine/state.ts");
      if (args === "default" || args === "lite") {
        gameState.preset = args as "default" | "lite";
        saveState();
        ctx.ui.notify(`已切换提示词模式为: ${args}`, "info");
      } else {
        // 弹窗菜单选择
        const items: MenuItem[] = [
          { label: "default (标准)", detail: "完整系统提示，含规则+输出+状态+模式", action: (done) => { gameState.preset = "default"; saveState(); ctx.ui.notify("模式切换为: default", "info"); done(); } },
          { label: "lite (轻量)", detail: "省略硬规则，日常场景节省 Token", action: (done) => { gameState.preset = "lite"; saveState(); ctx.ui.notify("模式切换为: lite", "info"); done(); } },
        ];
        await showMenu(ctx, "系统提示词预设", items);
      }
    },
  };
