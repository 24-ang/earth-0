import { Type } from "typebox";

export default {
    name: "settle_scene", label: "场景收口",
    description: "场景收口：推进时间+更新NPC日程+写入记忆标签。替代commit_turn+add_memory_tag。NPC换装请用set_npc_outfit。",
    parameters: Type.Object({
      summary: Type.String({ description: "本场景发生的事，如'在侍奉部和雪乃聊了一下午'" }),
      elapsed_minutes: Type.Number({ description: "经过的分钟数" }),
      memory_tags: Type.Optional(Type.Array(Type.Object({
        target: Type.String({ description: "NPC 名" }),
        tag: Type.String({ description: "记忆标签，如'接受了维的帮助'" }),
        tone: Type.Optional(Type.String({ description: "情绪色彩" })),
        priority: Type.Optional(Type.Number({ description: "重要度: 1=日常, 2=重要, 3=核心" })),
        emotional_valence: Type.Optional(Type.Union([Type.Literal("positive"), Type.Literal("negative"), Type.Literal("neutral")], { description: "情感效价" })),
        related_npcs: Type.Optional(Type.Array(Type.String(), { description: "关联NPC名字" })),
        category: Type.Optional(Type.Union([Type.Literal("fact"), Type.Literal("emotion"), Type.Literal("milestone"), Type.Literal("general")], { description: "记忆类型" })),
      }))),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { runSettlement } = await import("../../engine/settlement.ts");
      const { gameState } = await import("../../engine/state.ts");
      const { resultText, events } = await runSettlement({
        elapsed_minutes: params.elapsed_minutes,
        summary: params.summary,
        memory_tags: params.memory_tags,
        ctx: _ctx,
      });
      gameState._toolsLocked = false; // 场景收口后解锁——安全：Phase 1 流程中 extension.ts:162 会重新上锁
      return {
        content: [{ type: "text", text: resultText }],
        details: { time: gameState.time, events, memory_tags: params.memory_tags },
      };
    },
  };
