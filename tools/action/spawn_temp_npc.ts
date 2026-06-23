import { Type } from "typebox";

export default {
    name: "spawn_temp_npc", label: "临时NPC",
    description: "创建临时角色。敌对可交战。场景结束自动回收。用于混混堵门/偶遇/街头冲突",
    parameters: Type.Object({
      name: Type.String({ description: "临时NPC名" }),
      act: Type.String({ description: "当前动作描述，如'握着棒球棍逼近'" }),
      hostility: Type.Optional(Type.String({ description: "友好|中立|敌对，默认中立" })),
      body_hint: Type.Optional(Type.String({ description: "身材描述，如'175cm瘦削'" })),
      reason: Type.String({ description: "出现原因，写入事件日志" }),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { spawnTempNPC } = await import("../../engine/state.ts");
      const result = spawnTempNPC({
        name: params.name,
        act: params.act,
        hostility: params.hostility as any,
        body_hint: params.body_hint,
        reason: params.reason,
      });
      return {
        content: [{ type: "text", text: result }],
        details: { tempNPC: params.name },
      };
    }
  };
