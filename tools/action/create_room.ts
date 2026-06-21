import { Type } from "typebox";

export default {
    name: "create_room", label: "创建房间",
    description: "在地图中创建一个新的房间区域。",
    parameters: Type.Object({ name: Type.String(), width: Type.Number(), height: Type.Number(), floor: Type.Number() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createRoom } = await import("../../engine/state.ts");
      const r = await createRoom(params.name, params.width, params.height, params.floor);
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  };
