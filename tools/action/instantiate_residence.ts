import { Type } from "typebox";

export default {
    name: "instantiate_residence", label: "实例化住宅",
    description: "根据住宅模板免费创建一组互连房间。GM初始化场景用，不扣钱。",
    parameters: Type.Object({
      template: Type.String({ description: "模板ID，如 独栋_2F_4人家庭 / 公寓_3F_单身" }),
      name: Type.String({ description: "住宅名，如 比企谷家 / 雪之下公寓" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { instantiateResidence } = await import("../../engine/state-grid.ts");
      const r = instantiateResidence(params.template, params.name);
      return { content: [{ type: "text", text: r.reason }], details: r };
    },
  };
