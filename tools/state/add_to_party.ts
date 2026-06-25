import { Type } from "typebox";

export default {
    name: "add_to_party", label: "加入队伍",
    description: "将NPC加入玩家队伍。NPC须在场。同场景战斗/探索时自动参与。",
    parameters: Type.Object({
      npc: Type.String({ description: "要邀请加入队伍的NPC名称" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
      const npc = getOrCreateNPC(params.npc);
      if (!npc) return { content: [{ type: "text", text: `未找到NPC: ${params.npc}` }], details: {} };
      const p = gameState.player;
      p.party ??= [];
      if (p.party.includes(params.npc)) return { content: [{ type: "text", text: `${params.npc} 已在队伍中` }], details: {} };
      p.party.push(params.npc);
      saveState();
      return { content: [{ type: "text", text: `${params.npc} 加入了队伍。（当前队伍: ${p.party.join("、")}）` }], details: {} };
    },
  };
