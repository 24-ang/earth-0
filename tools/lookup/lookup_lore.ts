import { Type } from "typebox";

export default {
    name: "lookup_lore", label: "查设定",
    description: "搜索世界观设定。先查 data/lore/{ip}_world.json 关键词匹配，再查 worldpacks/{ip}/*.json 用 TF-IDF 相似度检索。如'侍奉部规则'、'英灵召唤条件'。",
    parameters: Type.Object({
      keyword: Type.String({ description: "搜索关键词，如'侍奉部'、'魔术协会'、'千叶地理'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { gameState } = await import("../../engine/state.ts");

      const LORE_DIR = path.resolve(process.cwd(), "data", "lore");
      const kw = params.keyword.toLowerCase();
      const results: { title: string; text: string; source?: string }[] = [];

      // 1. 搜索原生 lore 文件 (data/lore/{ip}_world.json)
      if (fs.existsSync(LORE_DIR)) {
        for (const f of fs.readdirSync(LORE_DIR)) {
          if (!f.endsWith(".json")) continue;
          try {
            const data = JSON.parse(fs.readFileSync(path.join(LORE_DIR, f), "utf-8"));
            for (const [title, entry] of Object.entries(data) as any) {
              const etags = (entry.tags || []).map((t: string) => t.toLowerCase());
              const etext = (entry.text || "").toLowerCase();
              if (title.toLowerCase().includes(kw) || etags.some((t: string) => t.includes(kw)) || etext.includes(kw)) {
                results.push({ title, text: entry.text?.slice(0, 500) || "", source: "lore" });
              }
            }
          } catch (e) {
            console.error(`lookup_lore failed to parse data file ${f}:`, e);
          }
        }
      }

      // 2. 搜索活跃世界包的 ST 世界书 (TF-IDF 相似度)
      try {
        const { loadActiveWorldbooks, searchWorldbook } = await import("../../engine/worldbook-search.ts");
        const wb = loadActiveWorldbooks(gameState.activeWorld || "oregairu");
        if (wb) {
          const matches = searchWorldbook(wb, params.keyword, { topK: 3, maxTokens: 1500 });
          for (const m of matches) {
            const title = m.entry.keys?.[0] || m.entry.id;
            const existing = results.find(r => r.text === m.entry.content.slice(0, 500));
            if (!existing) {
              results.push({ title, text: m.entry.content.slice(0, 500), source: "worldbook" });
            }
          }
        }
      } catch (e) {
        console.error("lookup_lore worldbooks search failed:", e);
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: `未找到与「${params.keyword}」相关的设定资料。` }], details: {} };
      }
      const output = results.map(r => `## ${r.title}${r.source === "worldbook" ? " [WB]" : ""}\n${r.text}`).join("\n\n---\n\n");
      return { content: [{ type: "text", text: output }], details: { count: results.length } };
    },
  };
