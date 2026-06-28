import type { GameState } from "./types.ts";

export function detectInteractionMode(
  gameState: GameState, 
  nearbyNPCsCount: number
): { interactionMode: "novel" | "turn_based"; person: "first" | "third" } {
  // 锁死特定场景
  if (gameState.mode === "sex") {
    return { interactionMode: "turn_based", person: "first" };
  }
  if ((gameState.mode as any) === "combat") {
    return { interactionMode: "turn_based", person: "third" };
  }

  // 共位检测
  if (nearbyNPCsCount > 0) {
    gameState.turnsSinceLastNPCInteraction = 0;
    return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third" };
  } else {
    gameState.turnsSinceLastNPCInteraction = (gameState.turnsSinceLastNPCInteraction || 0) + 1;
    // 连续 2 回合 0 NPC 判定为独处，防抖切换到 novel 模式
    if (gameState.turnsSinceLastNPCInteraction >= 2) {
      return { interactionMode: "novel", person: gameState.mode === "gal" ? "first" : "third" };
    }
    return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third" };
  }
}
