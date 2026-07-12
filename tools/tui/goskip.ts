import { runNavigation } from "../helpers.ts";

export default {
    description: "旅行与探索导航系统 (跳过剧情，直接到达目的地)",
    handler: async (_args, ctx) => {
      await runNavigation(ctx, true);
    },
  };
