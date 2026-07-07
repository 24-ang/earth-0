import { Type } from "typebox";

export default {
  name: "end_broadcast",
  label: "结束广播观影",
  description: "主动或被动退出平行世界观影，销毁临时隔离数据，并进行好感/记忆的退场结算与穿透。",
  parameters: Type.Object({}),
  async execute(_id, _params, _s, _o, _ctx) {
    const { settleTheaterExit } = await import("../../engine/theater-exit.ts");
    const summary = await settleTheaterExit();
    return {
      content: [{ type: "text", text: `【系统广播结束】屏幕关闭，你的意识重回现实世界。\n${summary}` }],
      details: {}
    };
  }
};
