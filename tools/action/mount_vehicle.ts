import { Type } from "typebox";

export default {
    name: "mount_vehicle", label: "骑乘载具",
    description: "骑上载具(自行车/摩托车/汽车)。移动速度按倍率提升。",
    parameters: Type.Object({
      item: Type.String({ description: "载具物品名，如'自行车'、'摩托车'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { mountVehicle } = await import("../../engine/state.ts");
      const r = mountVehicle(params.item);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
