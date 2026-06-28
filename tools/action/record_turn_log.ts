import { Type } from "typebox";

export default {
    name: "record_turn_log", label: "回合台账",
    description: "记录GM导演单到台账。settle_scene后调用。参数见字段说明。",
    parameters: Type.Object({
      playerAction: Type.String({ description: "玩家实际做了什么" }),
      resolvedChanges: Type.String({ description: "本轮工具落地的变化，无则写'无'" }),
      sceneResult: Type.String({ description: "场景结果，一句话" }),
      openHooks: Type.String({ description: "未收口的钩子，无则写'无'" }),
      nextPressure: Type.String({ description: "下轮应推动什么，无则写'无'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { recordTurnLog, drainToolCalls } = await import("../../engine/state.ts");
      const entry = recordTurnLog({
        playerAction: params.playerAction,
        resolvedChanges: params.resolvedChanges,
        sceneResult: params.sceneResult,
        openHooks: params.openHooks,
        nextPressure: params.nextPressure,
        toolsCalled: drainToolCalls(),
      });
      return { content: [{ type: "text", text: `台账已记录 (第${entry.turn}回合)` }], details: entry };
    },
  };
