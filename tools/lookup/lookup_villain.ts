import { Type } from "typebox";

export default {
    name: "lookup_villain", label: "查恶役模板",
    description: "创建反派/NPC时参考恶役角色池。按类型查：纯粹之恶/人渣/伪善/巨婴/病娇/冷漠/双标",
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: "反派类型，如'纯粹之恶'、'伪善'、'病娇'。不填返回全部类型列表" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const filePath = path.resolve(process.cwd(), "data", "villain_templates.json");
      if (!fs.existsSync(filePath)) {
        return { content: [{ type: "text", text: "恶役模板文件不存在。" }] };
      }
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const text = data["恶役角色池"]?.text || "";

      if (params.type) {
        // Find the section matching the requested type
        const keyword = params.type;
        const sections = text.split(/\d+：【.+?】/);
        const allText = text;
        const idx = allText.indexOf(keyword);
        if (idx >= 0) {
          // Extract from the section header containing the keyword
          const sectionMatch = allText.substring(idx);
          const nextSection = sectionMatch.search(/\d+：【/);
          const result = nextSection > 0 ? sectionMatch.substring(0, nextSection) : sectionMatch.substring(0, 1500);
          return { content: [{ type: "text", text: result.trim() }] };
        }
        return { content: [{ type: "text", text: `未找到类型「${keyword}」。可用类型见全部列表。\n\n${text.substring(0, 2000)}` }] };
      }

      // Return full template (truncated)
      return { content: [{ type: "text", text: text.substring(0, 3000) || "无内容" }] };
    },
  };
