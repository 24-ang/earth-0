import { Type } from "typebox";

export default {
    name: "replay_pov", label: "同场复述",
    description: "标记某个NPC的上一次发言值得换个视角重放。引擎在下一回合自动消费：取该NPC最后回复→从听众内心视角重写一遍。用于告白/说漏嘴/关键台词的慢镜头回放。",
    parameters: Type.Object({
      npcName: Type.String({ description: "要复述的NPC名——刚才那句有份量的话是谁说的" }),
    }),
    async execute(_id, params) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const npc = gameState.npcs[params.npcName];
      if (!npc) return { content: [{ type: "text", text: `未找到NPC: ${params.npcName}` }], details: {} };
      const lastResponse = gameState._npc_last_responses?.[params.npcName];
      if (!lastResponse) return { content: [{ type: "text", text: `${params.npcName} 最近没有发言记录——请在该NPC发言后的同一回合内使用。` }], details: {} };
      gameState._replay_pov = params.npcName;
      saveState();
      return { content: [{ type: "text", text: `已标记 ${params.npcName} 的发言待同场复述。下回合将切到听众视角重放这段对话。` }], details: {} };
    },
  };
