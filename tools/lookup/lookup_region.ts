import { Type } from "typebox";

export default {
    name: "lookup_region", label: "查地区",
    description: "查询当前位置关联的作品和角色。",
    parameters: Type.Object({ location: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { lookupRegion } = await import("../../engine/router.ts");
      const r = lookupRegion(params.location);
      return { content: [{ type: "text", text: `地区: ${r.matched_regions.join("、")}\n角色: ${r.all_characters.join("、")}` }], details: r };
    },
  };
