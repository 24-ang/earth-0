import { Type } from "typebox";
import { runStatus } from "../helpers.ts";

export default {
    description: "查看/管理玩家状态与装备 (主菜单)",
    handler: async (_args, ctx) => {
      await runStatus(ctx);
    },
  };
