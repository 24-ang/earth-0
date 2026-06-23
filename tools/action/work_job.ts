import { Type } from "typebox";

export default {
    name: "work_job", label: "打工",
    description: "打工赚钱。jobName: 便利店|送报纸|家教|餐厅|发传单。引擎推进时间+扣疲劳。",
    parameters: Type.Object({
      jobName: Type.String({ description: "工作名称：便利店/送报纸/家教/餐厅/发传单" }),
      hours: Type.Number({ description: "工作时长（小时）" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { workJob, saveState, gameState } = await import("../../engine/state.ts");
      const { advanceTimeMinutes } = await import("../helpers.ts");
      const r = workJob(params.jobName, params.hours);
      await advanceTimeMinutes(params.hours * 60, _ctx, gameState, saveState);
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
