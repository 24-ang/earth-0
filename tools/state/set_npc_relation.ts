import { Type } from "typebox";

export default {
    name: "set_npc_relation", label: "NPC关系",
    description: "记录NPC之间的态度。from:谁对谁/to:目标/stage:关系阶段/tone:情绪色彩/notes:备注。只在有实际交互时记录。",
    parameters: Type.Object({
      from: Type.String({ description: "发起方NPC名" }),
      to: Type.String({ description: "目标NPC名" }),
      stage: Type.String({ description: "关系阶段: 陌生/熟人/朋友/亲密/对立/仇敌" }),
      tone: Type.String({ description: "情绪色彩: 喜欢/信任/尊重/嫉妒/厌恶/恐惧/无感" }),
      notes: Type.Optional(Type.String({ description: "备注，如'因为同桌三年'" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
      const npc = getOrCreateNPC(params.from);
      npc.npcRelationships ??= {};
      npc.npcRelationships[params.to] = { stage: params.stage, tone: params.tone, notes: params.notes || "" };
      saveState();
      return { content: [{ type: "text", text: `${params.from} → ${params.to}: ${params.stage}·${params.tone}${params.notes ? " (" + params.notes + ")" : ""}` }], details: {} };
    },
  };
