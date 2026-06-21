import { Type } from "typebox";
import { runNavigation } from "../helpers.ts";

export default {
    description: "旅行与探索导航系统 (长途旅行会触发剧情叙事)",
    handler: async (_args, ctx) => {
      await runNavigation(ctx, false);
    },
  };
