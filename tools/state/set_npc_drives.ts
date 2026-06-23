import { Type } from "typebox";

export default {
    name: "set_npc_drives", label: "设置NPC意图",
    description: "更新NPC驱动力与目标，用于意图演化",
    parameters: Type.Object({
      npc_name: Type.String({ description: "NPC名" }),
      drives: Type.Array(Type.String(), { description: "新的驱动力列表" }),
      goal: Type.String({ description: "新的当前目标" }),
      reason: Type.String({ description: "变更原因，如'运动会失败后转向'" }),
    }),
    async execute(_id: any, params: any, _s: any, _o: any, _ctx: any) {
      const { gameState, getOrCreateNPC, saveState } = await import("../../engine/state.ts");
      const npc = getOrCreateNPC(params.npc_name);
      const oldDrives = npc.current_drives ? [...npc.current_drives] : [];
      const oldGoal = npc.current_goal || "";

      npc.current_drives = params.drives;
      npc.current_goal = params.goal;
      saveState();

      return {
        content: [{
          type: "text",
          text: `${params.npc_name} 意图已更新\n  旧 drives: [${oldDrives.join(", ")}]\n  新 drives: [${params.drives.join(", ")}]\n  旧 goal: ${oldGoal || "无"}\n  新 goal: ${params.goal}\n  原因: ${params.reason}`
        }],
        details: { npc: params.npc_name, drives: params.drives, goal: params.goal }
      };
    }
  };
