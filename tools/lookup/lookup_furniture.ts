import { Type } from "typebox";

export default {
    name: "lookup_furniture", label: "查家具与模板",
    description: "浏览家具目录(templates)和场景模板(room_templates)。查有哪些可用、匹配关键词、或看某件的属性。",
    parameters: Type.Object({
      category: Type.Optional(Type.String({ description: "分类。furniture=查家具目录, room_template=查场景模板, all=都查" })),
      search: Type.Optional(Type.String({ description: "关键词。如'卫浴'、'拉面'、'床'。不传=列出分类概览" })),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { gameState } = await import("../../engine/state.ts");
      const { loadFurnitureCatalog, getAvailableActions, getActionsFromPhysical } = await import("../../engine/furniture.ts");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const world = gameState.activeWorld || "oregairu";
      const cat = loadFurnitureCatalog(world);
      const furnitureEntries = Object.entries(cat);

      // 读 room_templates
      let templates: any = {};
      const tmplPath = path.resolve(process.cwd(), "worldpacks", world, "room_templates.json");
      if (fs.existsSync(tmplPath)) {
        try { templates = JSON.parse(fs.readFileSync(tmplPath, "utf-8")); }
        catch (e) { console.error("lookup_furniture: 解析 room_templates 失败", e); }
      }

      const catFilter = params.category || "all";
      const keyword = params.search?.toLowerCase() || "";

      const lines: string[] = [];
      const furnitureCounts: Record<string, number> = {};

      // ── 家具目录查询 ──
      if (catFilter === "furniture" || catFilter === "all") {
        if (!keyword) {
          // 概览模式：列出分类和数量
          const classifiers: Record<string, string[]> = {
            "🛏️ 卧室家具": ["床","单人床","双人床","布団","衣柜","梳妆台","床头柜"],
            "🛋️ 客厅家具": ["沙发","茶几","电视","椅子","长凳","小桌"],
            "🍳 厨房家具": ["冰箱","灶台","餐桌","碗柜","微波炉","电饭煲","咖啡机"],
            "🛁 卫浴家具": ["浴缸","洗脸台","洗衣机"],
            "📚 学习办公": ["课桌","书桌","书架","靠墙的书架","电脑","讲台","黑板"],
            "🏪 商业设施": ["储物柜","吧台","收银台","货架","冰柜","食券机","点歌机","自动贩卖机"],
            "🔧 其他": ["保险箱","电灯","鞋柜","舞台","空调外机","侍奉部茶桌","窗台下的旧课桌"],
          };
          lines.push("【家具目录概览】");
          lines.push(`总计: ${furnitureEntries.length} 件 | 世界线: ${world}`);
          for (const [group, names] of Object.entries(classifiers)) {
            const count = names.filter(n => cat[n]).length;
            if (count > 0) lines.push(`  ${group}: ${count}件`);
          }
          lines.push("");
          lines.push('用 search=“关键词” 精确查找（如 search=“卫浴” 查看所有卫浴相关家具的交互属性）');
        } else {
          // 搜索模式：模糊匹配家具名并返回物理属性和交互动作
          const matches = furnitureEntries.filter(([name]) =>
            name.toLowerCase().includes(keyword) || keyword.includes(name.toLowerCase())
          );
          // 模糊匹配不够 → 尝试按分类关键词匹配
          if (matches.length === 0) {
            const catMappings: Record<string, string[]> = {
              "卫浴":    ["浴缸","洗脸台","洗衣机"],
              "浴室":    ["浴缸","洗脸台","洗衣机"],
              "厨房":    ["冰箱","灶台","餐桌","碗柜","微波炉","电饭煲"],
              "卧室":    ["床","单人床","双人床","布団","衣柜","梳妆台"],
              "客厅":    ["沙发","茶几","电视","椅子","长凳"],
              "家电":    ["电视","冰箱","洗衣机","微波炉","电饭煲","咖啡机","电脑"],
              "储物":    ["储物柜","衣柜","保险箱","鞋柜","碗柜"],
              "商业":    ["吧台","收银台","货架","冰柜","食券机","点歌机","自动贩卖机"],
              "学校":    ["课桌","讲台","黑板","储物柜","椅子","长凳","靠墙的书架","电灯"],
            };
            const catNames = catMappings[keyword] || [];
            const catMatches = furnitureEntries.filter(([name]) => catNames.includes(name));
            if (catMatches.length > 0) {
              lines.push(`【家具目录】关键词 "${params.search}" → 匹配 ${catMatches.length} 件`);
              for (const [name, def] of catMatches) {
                const physical = (def as any).physical?.join("|") || "";
                const actions = getAvailableActions(def as any, name).join("、");
                const containers = (def as any).containers?.length ? ` [${(def as any).containers.length}个容器]` : "";
                const hideTag = (def as any).containers?.some((c: any) => c.can_hold_person) ? " 🫥可躲人" : "";
                lines.push(`  ${name}${containers}${hideTag} → ${physical} → 可: ${actions}`);
              }
            } else {
              lines.push(`【家具目录】未找到匹配 "${params.search}" 的家具。`);
              lines.push(`可用分类关键词: 卫浴、厨房、卧室、客厅、家电、储物、商业、学校`);
              lines.push(`或传 search=具体家具名（如 search="床"）`);
            }
            furnitureEntries.filter(([_, d]) => catNames.includes((d as any).name)).forEach(([n]) => { furnitureCounts[n] = 1; });
            return { content: [{ type: "text", text: lines.join("\n") }], details: { matches: matches.length } };
          }
          lines.push(`【家具目录】关键词 "${params.search}" → 匹配 ${matches.length} 件`);
          for (const [name, def] of matches) {
            const physical = (def as any).physical?.join("|") || "";
            const actions = getAvailableActions(def as any, name).join("、");
            const containers = (def as any).containers?.length ? ` [${(def as any).containers.length}个容器]` : "";
            const hideTag = (def as any).containers?.some((c: any) => c.can_hold_person) ? " 🫥可躲人" : "";
            lines.push(`  ${name}${containers}${hideTag} → ${physical} → 可: ${actions}`);
          }
        }
      }

      // ── 场景模板查询 ──
      if (catFilter === "room_template" || catFilter === "all") {
        if (lines.length > 0) lines.push("");
        if (!keyword) {
          lines.push("【场景模板概览】");
          for (const [catName, catTmpls] of Object.entries(templates)) {
            if (catName.startsWith("_")) continue;
            if (typeof catTmpls !== "object" || !catTmpls) continue;
            const count = Object.keys(catTmpls as object).length;
            const categoryEmoji: Record<string, string> = { school: "🏫", commercial: "🏪", residential: "🏠", outdoor: "🌳", transport: "🚃" };
            const emoji = categoryEmoji[catName] || "📦";
            const firstFew = Object.keys(catTmpls as object).slice(0, 4).join("、");
            lines.push(`  ${emoji} ${catName}: ${count}个 (${firstFew}…)`);
          }
          lines.push("");
          lines.push('用 search="关键词" 查找匹配模板（如 search="店"）');
        } else {
          // 搜索模式
          const matches: string[] = [];
          for (const [catName, catTmpls] of Object.entries(templates)) {
            if (catName.startsWith("_") || typeof catTmpls !== "object" || !catTmpls) continue;
            for (const [tname, tdef] of Object.entries(catTmpls as object)) {
              if (tname.toLowerCase().includes(keyword) || (tdef as any).desc?.toLowerCase().includes(keyword)) {
                const t = tdef as any;
                const furnitureList = t.furniture?.length > 0 ? ` [家具: ${t.furniture.join("、")}]` : "";
                const atmosphereHint = t.atmosphere ? ` ${t.atmosphere.slice(0, 40)}…` : "";
                matches.push(`  ${catName}/${tname} (${t.width}×${t.height})${furnitureList}${atmosphereHint}`);
              }
            }
          }
          lines.push(matches.length > 0
            ? `【场景模板】关键词 "${params.search}" → ${matches.length}个匹配` + "\n" + matches.join("\n")
            : `【场景模板】未找到匹配 "${params.search}" 的模板`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }], details: { matches: lines.length } };
    },
  };
