import { Type } from "typebox";

export default {
    name: "move", label: "棋盘移动",
    description: "棋盘格移动。方向：北/南/东/西",
    parameters: Type.Object({ direction: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { movePlayer, saveState, gameState } = await import("../../engine/state.ts");
      const r = movePlayer(params.direction);
      saveState();
      if (r.success) {
        const [x, y] = gameState.player.gridPos || [r.newX, r.newY];
        const movedDir = params.direction;
        const newRoom = (r as any).newRoom ? ` → ${(r as any).newRoom}` : "";
        const text = `向${movedDir}移动到 (${x},${y})${newRoom}`;
        return { content: [{ type: "text", text }], details: r };
      }
      return { content: [{ type: "text", text: `阻挡: ${r.reason}` }], details: r };
    },
  };
