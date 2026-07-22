import { Type } from "typebox";

export default {
    name: "schedule_override", label: "日程覆盖",
    description: "覆盖NPC日程。不填until=永久(穿越/生存/定居)。填until=临时(看病/逃课)。",
    parameters: Type.Object({
      npc: Type.String({ description: "NPC名称" }),
      location: Type.String({ description: "覆盖后的目的地" }),
      action: Type.String({ description: "做什么" }),
      reason: Type.String({ description: "原因" }),
      until: Type.Optional(Type.String({ description: "到期日YYYY-MM-DD。不填=永久有效。不准填假永久。" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getOrCreateNPC, saveState } = await import("../../engine/state.ts");
      const npc = getOrCreateNPC(params.npc);
      npc.pendingOverride = { location: params.location, action: params.action, reason: params.reason, expiresAt: params.until || "" };
      saveState();
      return { content: [{ type: "text", text: `${params.npc} 日程覆盖${params.until ? "" : "（永久）"} : ${params.location} (${params.reason})` }], details: {} };
    },
  };
