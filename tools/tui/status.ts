import { runStatus } from "../helpers.ts";

export default {
    description: "查看/管理玩家状态与装备",
    handler: async (_args, ctx) => {
      await runStatus(ctx);
    },
  };
