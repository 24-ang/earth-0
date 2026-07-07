import { Type } from "typebox";
import { gameState, saveState } from "../../engine/state.ts";

export default {
  name: "create_organization",
  label: "创建势力组织",
  description: "动态创建玩家身边的新组织或势力（如新社团、帮派、圈子）。这支持自下而上的“身边延伸”设计，无需预配置JSON文件。",
  parameters: Type.Object({
    id: Type.String({ description: "势力唯一ID，英文小写+下划线，如 'tennis_club', 'miura_coterie'" }),
    name: Type.String({ description: "势力组织名称，如 '网球部', '三浦现充组'" }),
    type: Type.String({
      enum: ["学校", "社团", "企业", "政治", "宗教", "犯罪", "家族", "自治", "自定义"],
      description: "组织类型"
    }),
    scale: Type.String({
      enum: ["club", "local", "regional", "national"],
      description: "势力规模等级"
    }),
    sector: Type.Optional(Type.String({
      enum: ["politics", "economy", "culture", "military", "social"],
      description: "五大控制支柱：politics(政治)|economy(经济)|culture(文化/舆论)|military(武力)|social(社交/民生)"
    })),
    parentOrg: Type.Optional(Type.String({ description: "上级组织ID，用于级联干涉和声望传导" })),
    coreLocation: Type.String({ description: "核心控制区/大本营房间名称" }),
    leader: Type.Optional(Type.String({ description: "领袖NPC姓名" })),
    macroGoal: Type.Optional(Type.String({ description: "势力的宏观目标描述" })),
    currentPhaseGoal: Type.Optional(Type.String({ description: "当前的阶段性目标，这会被每日自转引擎提取并作为Drives下发给成员NPC" })),
    economicAxis: Type.Optional(Type.Number({ description: "经济立场 -5(左翼/平等/福利) ~ +5(右翼/市场/自由竞争)，默认0" })),
    politicalAxis: Type.Optional(Type.Number({ description: "政治立场 -5(进步/变革/自由) ~ +5(保守/秩序/传统)，默认0" }))
  }),
  async execute(_id, params, _s, _o, _ctx) {
    gameState.organizations ??= {};
    
    if (gameState.organizations[params.id]) {
      return {
        content: [{ type: "text", text: `❌ 势力 ID 「${params.id}」已经存在，无法重复创建。` }],
        details: { success: false }
      };
    }

    const newOrg = {
      id: params.id,
      name: params.name,
      type: params.type as any,
      scale: params.scale as any,
      sector: params.sector || "social",
      parent_org: params.parentOrg || undefined,
      wealth: 50,      // 默认中等财富
      influence: 30,   // 默认初创影响力
      cohesion: 80,    // 默认高凝聚力
      public_legitimacy: 50,
      coreLocation: params.coreLocation,
      territoryRoomKeys: [params.coreLocation],
      class_base: { "知识分子": 1.0 },
      organizationalAxes: {
        "经济立场": params.economicAxis ?? 0,
        "政治立场": params.politicalAxis ?? 0
      },
      goals: {
        macroGoal: params.macroGoal || "发展组织势力，提升社会认知度。",
        currentPhaseGoal: params.currentPhaseGoal || "招募新成员，巩固基础。",
        requiredResources: []
      },
      leader: params.leader || "",
      members: params.leader ? [{ npcName: params.leader, role: "领袖", rank: 10 }] : [],
      relations: {},
      match_rules: {
        location_contains: params.coreLocation
      },
      entries: []
    };

    gameState.organizations[params.id] = newOrg;

    // 如果 leader 是玩家自己 → 自动加 memberships
    if (params.leader && params.leader === gameState.player.name) {
      gameState.player.memberships ??= [];
      if (!gameState.player.memberships.some(m => m.orgId === params.id)) {
        gameState.player.memberships.push({ orgId: params.id, role: "领袖", rank: 10, joinedAt: gameState.time.game_date });
      }
      // 确保 player 也在 org.members 里
      if (!newOrg.members.some(m => m.npcName === gameState.player.name)) {
        newOrg.members.push({ npcName: gameState.player.name, role: "领袖", rank: 10 });
      }
    }

    saveState();

    const summary = `【势力创建成功】\n名称: ${params.name} (ID: ${params.id})\n类型: ${params.type} | 规模: ${params.scale} | 支柱: ${newOrg.sector}\n大本营: ${params.coreLocation}\n政治轴: 经济${newOrg.organizationalAxes["经济立场"]} / 政治${newOrg.organizationalAxes["政治立场"]}\n目标: ${newOrg.goals.macroGoal}`;
    return {
      content: [{ type: "text", text: summary }],
      details: { success: true, org: newOrg }
    };
  }
};
