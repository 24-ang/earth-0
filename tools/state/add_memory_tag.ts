import { Type } from "typebox";

export default {
    name: "add_memory_tag", label: "记忆标签",
    description: "写入NPC记忆。注入后续prompt。tone:感激/愧疚/喜欢/厌恶/受伤/困惑/期待/无感。默认7天过期。",
    parameters: Type.Object({
      target: Type.String({ description: "NPC 名" }),
      tag: Type.String({ description: "标签内容，如'知道玩家是杀手'" }),
      tone: Type.Optional(Type.String({ description: "情绪色彩: 感激/愧疚/喜欢/厌恶/受伤/困惑/期待/无感" })),
      expires_days: Type.Optional(Type.Number({ description: "过期天数，默认7" })),
      priority: Type.Optional(Type.Number({ description: "重要度: 1=日常, 2=重要, 3=核心" })),
      emotional_valence: Type.Optional(Type.Union([Type.Literal("positive"), Type.Literal("negative"), Type.Literal("neutral")], { description: "情感效价" })),
      related_npcs: Type.Optional(Type.Array(Type.String(), { description: "关联NPC名字" })),
      category: Type.Optional(Type.Union([Type.Literal("fact"), Type.Literal("emotion"), Type.Literal("milestone"), Type.Literal("general")], { description: "记忆类型" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { addMemoryTag, saveState } = await import("../../engine/state.ts");
      addMemoryTag(
        params.target,
        params.tag,
        params.expires_days || 7,
        params.tone,
        params.priority,
        params.emotional_valence,
        params.related_npcs,
        params.category
      );
      saveState();
      return { content: [{ type: "text", text: `${params.target} 记忆: ${params.tag}${params.tone ? ` [${params.tone}]` : ""}` }], details: {} };
    },
  };
