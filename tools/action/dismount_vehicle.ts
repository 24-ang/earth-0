import { Type } from "typebox";

export default {
    name: "dismount_vehicle", label: "下车",
    description: "下车上马，恢复步行速度。载具放回背包。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { dismountVehicle } = await import("../../engine/state.ts");
      const r = dismountVehicle();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
