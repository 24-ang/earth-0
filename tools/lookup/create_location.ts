import { Type } from "typebox";

export default {
    name: "create_location", label: "创建地点",
    description: "创建新地点（如新咖啡店、秘密基地、黑市据点）。支持skybox属性注入——繁荣/稳定/体制/经济/外交。引擎自动加入导航层级。",
    parameters: Type.Object({
      parent: Type.String({ description: "上级地名，如'千叶县'、'东京都'、'千叶市'" }),
      name: Type.String({ description: "新地点名称，如'猫咖啡·猫爪', '废弃仓库黑市'" }),
      context: Type.Optional(Type.String({ description: "环境氛围描述（local context），LLM渲染时的叙事基底。如：'昏暗的仓库改造空间，铁皮墙上贴着赏金令，空气里混着机油和咖啡味'" })),
      socialNorms: Type.Optional(Type.String({ description: "该地点的社交规范，如：'这里是黑市，只要有钱什么都买得到。警察不会来，但帮派间的规矩比法律更严厉'" })),
      prosperity: Type.Optional(Type.Number({ description: "局部繁荣度 (-5~5)，覆盖上级值。0=正常，正=景气，负=萧条" })),
      stability: Type.Optional(Type.Number({ description: "局部稳定度 (-3~3)，覆盖上级值。0=正常，正=高压秩序，负=失序" })),
      tension: Type.Optional(Type.Number({ description: "局部紧张度 (0~5)，覆盖上级值。0=安逸，5=人人自危" })),
      tech: Type.Optional(Type.Number({ description: "局部科技水平 (0~5)，覆盖上级值" })),
      regime: Type.Optional(Type.String({ description: "该地点的统治/治理类型，如：'帮派自治', '自由市场', '学园自治领地'" })),
      economyType: Type.Optional(Type.String({ description: "经济类型，如：'地下黑市', '学生服务经济', '创意产业孵化'" })),
      diplomacyStance: Type.Optional(Type.String({ description: "对外态度/地缘定位，如：'法外之地——警方不介入', '对千叶市开放'" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createDynamicLocation } = await import("../../engine/state.ts");

      // 先创建基础地点
      const r = createDynamicLocation(params.parent, params.name);

      // 如果有 skybox 字段，写入 _regionContexts 供级联引擎使用
      if (params.prosperity !== undefined || params.stability !== undefined || params.tension !== undefined ||
          params.regime || params.economyType || params.diplomacyStance || params.context || params.socialNorms || params.tech !== undefined) {
        const { _regionContexts } = await import("../../engine/state.ts");
        if (_regionContexts) {
          _regionContexts[params.name] = {
            keys: [params.name],
            ...(params.context ? { context: params.context } : {}),
            ...(params.socialNorms ? { social_norms: params.socialNorms } : {}),
            skybox_defaults: {
              ...(params.prosperity !== undefined ? { prosperity: params.prosperity } : {}),
              ...(params.stability !== undefined ? { stability: params.stability } : {}),
              ...(params.tension !== undefined ? { tension: params.tension } : {}),
              ...(params.tech !== undefined ? { tech: params.tech } : {}),
              ...(params.regime ? { regime: params.regime } : {}),
              ...(params.economyType ? { economy_type: params.economyType } : {}),
              ...(params.diplomacyStance ? { diplomacy_stance: params.diplomacyStance } : {}),
            }
          };
        }
      }

      const skyboxHint = (params.regime || params.economyType || params.prosperity !== undefined)
        ? `\n天空盒注入: ${[params.regime, params.economyType, params.prosperity !== undefined ? '繁荣度'+params.prosperity : '', params.stability !== undefined ? '稳定度'+params.stability : ''].filter(Boolean).join(' | ')}`
        : "";

      return { content: [{ type: "text", text: r + skyboxHint }], details: {} };
    },
  };
