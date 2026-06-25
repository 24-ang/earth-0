import { Type } from "typebox";

export default {
    name: "toggle_layer1", label: "Layer1",
    description: "开关性欲模块。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _o, _ctx) {
      const { toggleLayer1, gameState, saveState } = await import("../../engine/state.ts");
      const on = toggleLayer1(gameState);
      saveState();
      return { content: [{ type: "text", text: on ? "Layer1 on" : "Layer1 off" }], details: {} };
    },
  };
