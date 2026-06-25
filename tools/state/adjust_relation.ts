import { Type } from "typebox";

export default {
    name: "adjust_relation", label: "调整关系",
    description: "调整好感度。单次≤±20，自动0-100 clamp。reason写入备注。",
    parameters: Type.Object({
      npc: Type.String({ description: "NPC 名称" }),
      delta: Type.Number({ description: "好感变化量，范围 [-20, 20]" }),
      reason: Type.String({ description: "变化原因，如'聊得很投机'、'偷窃被抓'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { updateRelation, gameState, saveState, getOrCreateSexState } = await import("../../engine/state.ts");
      const delta = Math.max(-20, Math.min(20, params.delta));
      const p = gameState.player;

      updateRelation(p.relationships, params.npc, delta, params.reason);
      let r = `${params.npc} 好感${delta > 0 ? "+" : ""}${delta}（${params.reason}）`;

      if (delta > 0) {
        try {
          const sState = await getOrCreateSexState(params.npc);
          if (sState) {
            const desireDelta = Math.max(1, Math.round(delta * 0.5));
            sState.desire = Math.min(100, sState.desire + desireDelta);
            r += `，欲望+${desireDelta}`;
          }
        } catch (e) {
          console.error("adjust_relation desire update error:", e);
        }
      }

      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
