import { Type } from "typebox";

export default {
    name: "remove_from_party", label: "移出队伍",
    description: "将NPC移出玩家队伍。",
    parameters: Type.Object({
      npc: Type.String({ description: "要移出队伍的NPC名称" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const p = gameState.player;
      p.party ??= [];
      const idx = p.party.indexOf(params.npc);
      if (idx < 0) return { content: [{ type: "text", text: `${params.npc} 不在队伍中` }], details: {} };
      p.party.splice(idx, 1);
      saveState();
      return { content: [{ type: "text", text: `${params.npc} 离开了队伍。（当前队伍: ${p.party.join("、") || "空"}）` }], details: {} };
    },
  };
