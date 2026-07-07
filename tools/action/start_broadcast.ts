import { Type } from "typebox";

export default {
  name: "start_broadcast",
  label: "开启广播观影",
  description: "启动指定剧本（如 test_broadcast）的平行时空观测。隔离主存档，玩家可操作。限制在非观影模式下触发。",
  parameters: Type.Object({
    scriptId: Type.String({ description: "广播世界包ID，例如 'test_broadcast'" })
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { startParallelWorld } = await import("../../engine/parallel-world.ts");
    await startParallelWorld(params.scriptId);
    return {
      content: [{ type: "text", text: `【系统广播开启】空中降下巨大的屏幕，开始播放平行时空「${params.scriptId}」的切片……\n你感到自己的心神被吸入了屏幕中。` }],
      details: { scriptId: params.scriptId }
    };
  }
};
