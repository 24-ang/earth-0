import { Type } from "typebox";

export default {
    name: "set_flags", label: "IF开关",
    description: "设世界标记：tachibanaIF(橘家), osanaIF(青梅)等。",
    parameters: Type.Object({ flags: Type.Record(Type.String(), Type.Union([Type.Boolean(), Type.String()])) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      // 写入 PlayerState.flags（与 get_status 读取的是同一对象）
      if (!gameState.player.flags) gameState.player.flags = {};
      for (const [k, v] of Object.entries(params.flags)) gameState.player.flags[k] = v;
      saveState();
      return { content: [{ type: "text", text: "flags: " + JSON.stringify(gameState.player.flags) }], details: {} };
    },
  };
