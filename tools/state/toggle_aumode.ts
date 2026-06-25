import { Type } from "typebox";

export default {
    name: "toggle_aumode", label: "魔改",
    description: "开关魔改模式（AU角色可见）。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _o, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      gameState.auMode = !gameState.auMode; saveState();
      return { content: [{ type: "text", text: gameState.auMode ? "魔改 on" : "魔改 off" }], details: {} };
    },
  };
