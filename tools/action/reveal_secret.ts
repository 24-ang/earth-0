import { Type } from "typebox";

export default {
    name: "reveal_secret", label: "揭示秘密",
    description: "将秘密从隐藏级提升为可见级。id:秘密标识/content:揭示内容/fromLevel:当前级别/toLevel:目标级别。如揭露NPC秘密: fromLevel=hidden_canonical toLevel=scene_public",
    parameters: Type.Object({
      id: Type.String({ description: "秘密标识" }),
      content: Type.String({ description: "揭示的内容描述" }),
      fromLevel: Type.String({ description: "当前可见级别: hidden_canonical/protagonist_known/player_known/scene_public" }),
      toLevel: Type.String({ description: "目标可见级别" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { revealSecret, gameState } = await import("../../engine/state.ts");
      const r = revealSecret(params.id, params.content, params.fromLevel as any, params.toLevel as any);
      return { content: [{ type: "text", text: `秘密已揭示: ${r.id} (${r.fromLevel} → ${r.toLevel})` }], details: r };
    },
  };
