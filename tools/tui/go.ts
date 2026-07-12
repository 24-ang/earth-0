import { runNavigation } from "../helpers.ts";

export default {
    description: "旅行导航。默认长途触发叙事；/go skip 跳过剧情直达",
    handler: async (args, ctx) => {
      const skip = /skip|fast|跳过|直达/i.test((args || "").trim());
      await runNavigation(ctx, skip);
    },
  };
