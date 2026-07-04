import { Type } from "typebox";

export default {
    name: "move", label: "棋盘移动",
    description: "棋盘格移动。方向：北/南/东/西",
    parameters: Type.Object({ direction: Type.String() }),
    async execute(_id, params, _s, _o, _ctx) {
      const { movePlayer, saveState, gameState } = await import("../../engine/state.ts");
      const { initPlayerGrid } = await import("../../engine/state-grid.ts");
      const r = movePlayer(params.direction);
      // 强制修复：movePlayer 在某些网格中不写 gridPos → 用 initPlayerGrid 兜底
      if (r.success && !gameState.player.gridPos) {
        initPlayerGrid();
        if (!gameState.player.gridPos) {
          gameState.player.gridPos = [r.newX, r.newY];
        }
      }
      saveState();
      if (r.success) {
        const [x, y] = gameState.player.gridPos;
        const movedDir = params.direction;
        const newRoom = (r as any).newRoom ? ` → ${(r as any).newRoom}` : "";
        const text = `向${movedDir}移动到 (${x},${y})${newRoom}`;
        return { content: [{ type: "text", text }], details: r };
      }
      return { content: [{ type: "text", text: `阻挡: ${r.reason}` }], details: r };
    },
  };
