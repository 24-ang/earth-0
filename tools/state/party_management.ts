import { Type } from "typebox";

export default {
    name: "party_management", label: "队伍管理",
    description: "管理玩家队伍。action: add|remove",
    parameters: Type.Object({
      action: Type.String({ description: "add|remove" }),
      npc: Type.String({ description: "NPC名称" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
      const p = gameState.player;
      p.party ??= [];

      if (params.action === "add") {
        const { findCharacter } = await import("../../engine/state.ts");
        const isKnown = findCharacter(params.npc) !== null;
        const rel = p.relationships[params.npc];
        if (!isKnown && !rel) {
          return { content: [{ type: "text", text: `无法邀请陌生人 ${params.npc} 加入队伍。` }], details: {} };
        }

        const npc = getOrCreateNPC(params.npc);
        if (!npc) return { content: [{ type: "text", text: `未找到NPC: ${params.npc}` }], details: {} };
        if (p.party.includes(params.npc)) return { content: [{ type: "text", text: `${params.npc} 已在队伍中` }], details: {} };
        p.party.push(params.npc);
        saveState();
        return { content: [{ type: "text", text: `${params.npc} 加入了队伍。（当前队伍: ${p.party.join("、")}）` }], details: {} };
      }

      if (params.action === "remove") {
        const idx = p.party.indexOf(params.npc);
        if (idx < 0) return { content: [{ type: "text", text: `${params.npc} 不在队伍中` }], details: {} };
        p.party.splice(idx, 1);
        saveState();
        return { content: [{ type: "text", text: `${params.npc} 离开了队伍。（当前队伍: ${p.party.join("、") || "空"}）` }], details: {} };
      }

      return { content: [{ type: "text", text: `未知 action: ${params.action}。可用: add|remove` }], details: {} };
    },
  };
