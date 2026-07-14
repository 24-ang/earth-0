import { lastRenderedProse, showMenu, MenuItem } from "../helpers.ts";
import { parseRoleOptions } from "../../engine/parse-options.ts";

export default {
    description: "从上轮叙事中解析扮演选项并渲染为可点击菜单。点击选项自动发送到聊天框。",
    handler: async (_args: string, ctx: any) => {
      if (!lastRenderedProse) {
        ctx.ui.notify("还没有可解析的叙事输出。请先在游戏中进行一轮。", "warning");
        return;
      }

      const { options } = parseRoleOptions(lastRenderedProse);
      if (options.length === 0) {
        ctx.ui.notify("上轮叙事中未找到扮演选项。", "info");
        return;
      }

      const items: MenuItem[] = options.map((opt, i) => ({
        label: `${String.fromCodePoint(0x2460 + i)} ${opt.tag ? `[${opt.tag}] ` : ""}${opt.text}`,
        detail: "点击发送",
        action: (_done: () => void) => {
          ctx.chat.addSystemMessage(`玩家选择了: ${opt.text}`);
          ctx.ui.notify(`已选择: ${opt.text.slice(0,30)}`, "info");
          _done();
        },
      }));

      await showMenu(ctx, "🎭 扮演选项", items);
    },
  };
