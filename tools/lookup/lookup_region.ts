import { Type } from "typebox";

export default {
    name: "lookup_region", label: "查地区",
    description: "查询地区设定：含区域情报(context/social_norms)、关联角色、天空盒(skybox)。地点名可用中文/日文。",
    parameters: Type.Object({ location: Type.String({ description: "地点名，如'日本'、'千叶县'、'总武高'、'侍奉部'" }) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { lookupRegion } = await import("../../engine/router.ts");
      const r = lookupRegion(params.location);

      // 如果有匹配的区域，合并地区设定数据
      const { getRegionContext, _regionContexts, getMergedWorldState } = await import("../../engine/state.ts");
      const regionCtx = getRegionContext(params.location);
      const worldState = getMergedWorldState(params.location);

      const regionNames = r.matched_regions.map((reg: any) => reg.name || reg);

      let output = `地区: ${regionNames.length > 0 ? regionNames.join("、") : "（未找到匹配区域）"}\n`;
      output += `角色: ${r.all_characters.length > 0 ? r.all_characters.join("、") : "（未找到关联角色）"}\n`;

      // ── 地区设定（context + social_norms）──
      if (regionCtx) {
        // 提取 context 的前 500 字符（日本 context 非常长，全量会刷屏）
        const ctxParts: string[] = [];
        if (regionCtx.includes("核心基调") || regionCtx.includes("环境氛围")) {
          // 简短摘要 + 完整 social_norms
          const lines = regionCtx.split("\n").filter(Boolean);
          const summary = lines.slice(0, 3).join("\n");
          ctxParts.push(summary + (lines.length > 3 ? "\n（完整设定较长，省略后续...）" : ""));
        } else {
          ctxParts.push(regionCtx.slice(0, 500) + (regionCtx.length > 500 ? "..." : ""));
        }
        output += `\n### 区域设定\n${ctxParts.join("\n")}\n`;
      } else {
        // 尝试从 _regionContexts 手动匹配（覆盖 router 没找到的情况）
        if (_regionContexts) {
          const locLower = params.location.toLowerCase();
          let bestCtx: string | null = null;
          let bestLen = 0;
          for (const [k, data] of Object.entries(_regionContexts)) {
            for (const key of (data?.keys || [])) {
              const kl = key.toLowerCase();
              if (locLower.includes(kl) && kl.length > bestLen) {
                bestLen = kl.length;
                bestCtx = data.context || null;
              }
            }
          }
          if (bestCtx) {
            output += `\n### 区域设定\n${bestCtx.slice(0, 500)}\n`;
          }
        }
      }

      // ── 天空盒 ──
      if (worldState) {
        output += `\n### 天空盒 (skybox)\n`;
        output += `繁荣度: ${worldState.prosperity ?? "?"} | 稳定度: ${worldState.stability ?? "?"} | 紧张度: ${worldState.tension ?? "?"}\n`;
        output += `科技: ${worldState.tech ?? "?"} | 体制: ${worldState.regime ?? "?"} | 经济: ${worldState.economy_type ?? "?"}\n`;
      }

      return { content: [{ type: "text", text: output }], details: { ...r, regionContext: regionCtx?.slice(0, 200), worldState } };
    },
  };
