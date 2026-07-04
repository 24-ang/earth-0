import { Type } from "typebox";

export default {
    name: "create_character", label: "创建角色",
    description: "创建新NPC，支持完整角色字段",
    parameters: Type.Object({
      name: Type.String({ description: "角色名" }),
      gender: Type.Optional(Type.String({ description: "性别: 男/女，默认女" })),
      base_age: Type.Optional(Type.Number({ description: "基础年龄，默认16" })),
      appearance_brief: Type.Optional(Type.String({ description: "外貌简述，如'金发双马尾，总戴着红色发卡'" })),
      hair_color: Type.Optional(Type.String({ description: "发色" })),
      hair_style: Type.Optional(Type.String({ description: "发型" })),
      eye_color: Type.Optional(Type.String({ description: "瞳色" })),
      personality: Type.Optional(Type.String({ description: "性格描述，如'开朗但容易紧张，说话偶尔磕巴'" })),
      personality_stages: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "不同年龄段性格，如{'6':'粘人爱哭','16':'叛逆但内心温柔'}" })),
      speech_style: Type.Optional(Type.String({ description: "说话风格指令，如'句尾常带～，自称用名字而非我'" })),
      anchors: Type.Optional(Type.Object({
        emotional: Type.Optional(Type.String({ description: "情感锚" })),
        intimate: Type.Optional(Type.String({ description: "亲密锚" })),
        private: Type.Optional(Type.String({ description: "私人锚" })),
      })),
      likes: Type.Optional(Type.Array(Type.String(), { description: "喜好列表" })),
      dislikes: Type.Optional(Type.Array(Type.String(), { description: "厌恶列表" })),
      outfits: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.String()), { description: "多套换装 {school:{top:'制服'},casual:{...},pe:{...},swim:{...},sleep:{...}}" })),
      schedule: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "精确到时段行程 {'08:00':'教室','12:00':'食堂'}" })),
      schedule_group: Type.Optional(Type.String({ description: "日程组: 学生/教师/不良/店员/自由人，默认自由人" })),
      schedule_group_by_age: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "不同年龄段日程组" })),
      default_location: Type.Optional(Type.String({ description: "默认出现地点，默认同玩家当前位置" })),
      appearance_by_age: Type.Optional(Type.Record(Type.String(), Type.Object({
        hair_color: Type.Optional(Type.String()),
        hair_style: Type.Optional(Type.String()),
        eye_color: Type.Optional(Type.String()),
        hair_accessories: Type.Optional(Type.String()),
      }), { description: "不同年龄段外貌变化" })),
      body_by_age: Type.Optional(Type.Record(Type.String(), Type.Object({
        height_cm: Type.Optional(Type.Number()),
        weight_kg: Type.Optional(Type.Number()),
        build: Type.Optional(Type.String()),
        cup: Type.Optional(Type.String()),
        measurements: Type.Optional(Type.Object({ bust: Type.Number(), waist: Type.Number(), hips: Type.Number() })),
        leg_type: Type.Optional(Type.String()),
      }), { description: "不同年龄段身材变化" })),
      sex_profile: Type.Optional(Type.String({ description: "性档案引用名（需存在于sex_profiles.json）" })),
      drives_by_age: Type.Optional(Type.Record(Type.String(), Type.Object({
        drives: Type.Array(Type.String()),
        goal: Type.String(),
      }), { description: "不同年龄段自主意图" })),
      skills: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "技能初始值" })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "标签列表" })),
      attributes: Type.Optional(Type.Object({
        力量: Type.Optional(Type.Number()), 敏捷: Type.Optional(Type.Number()), 体质: Type.Optional(Type.Number()),
        智力: Type.Optional(Type.Number()), 感知: Type.Optional(Type.Number()), 魅力: Type.Optional(Type.Number()),
      })),
      source: Type.Optional(Type.String({ description: "世界观来源，如'春物'、'原创'，默认'原创'" })),
      reason: Type.String({ description: "创建原因，如'在便利店遇到的打工学生'" }),
    }),
    async execute(_id: any, params: any, _s: any, _o: any, _ctx: any) {
      const { gameState, registerDynamicCharacter, findCharacter, saveState } = await import("../../engine/state.ts");

      const charData: any = {
        name: params.name,
        gender: params.gender || "女",
        base_age: params.base_age || 16,
        source: params.source || "原创",
        tags: params.tags || ["dynamic"],
      };

      // 基础字段
      if (params.appearance_brief) charData.appearance_brief = params.appearance_brief;
      if (params.hair_color) charData.hair_color = params.hair_color;
      if (params.hair_style) charData.hair_style = params.hair_style;
      if (params.eye_color) charData.eye_color = params.eye_color;
      if (params.schedule_group) charData.schedule_group = params.schedule_group;
      if (params.default_location) charData.default_location = params.default_location;
      if (params.attributes) charData.attributes = params.attributes;

      // 性格
      if (params.personality) charData.personality_text = params.personality;
      if (params.personality_stages) charData.personality_stages = params.personality_stages;

      // 扩展字段（与预制角色对齐）
      if (params.speech_style) charData.speech_style = params.speech_style;
      if (params.anchors) charData.anchors = params.anchors;
      if (params.likes) charData.likes = params.likes;
      if (params.dislikes) charData.dislikes = params.dislikes;
      if (params.outfits) charData.outfits = params.outfits;
      if (params.schedule) charData.schedule = params.schedule;
      if (params.schedule_group_by_age) charData.schedule_group_by_age = params.schedule_group_by_age;
      if (params.appearance_by_age) charData.appearance_by_age = params.appearance_by_age;
      if (params.body_by_age) charData.body_by_age = params.body_by_age;
      if (params.sex_profile) charData.sex_profile = params.sex_profile;
      if (params.drives_by_age) charData.drives_by_age = params.drives_by_age;
      if (params.skills) charData.skills = params.skills;

      // 兜底：无 body 数据时按年龄自动生成
      if (!charData.body && !charData.body_by_age) {
        const age = charData.base_age;
        const g = charData.gender;
        if (age <= 6) charData.body = { height_cm: 115, weight_kg: 20, build: "纤细" };
        else if (age <= 12) charData.body = { height_cm: g === "女" ? 148 : 150, weight_kg: g === "女" ? 38 : 40, build: "纤细" };
        else if (age <= 15) charData.body = { height_cm: g === "女" ? 157 : 165, weight_kg: g === "女" ? 47 : 52, build: "标准" };
        else charData.body = { height_cm: g === "女" ? 158 : 170, weight_kg: g === "女" ? 50 : 58, build: "标准" };
      }

      const r = registerDynamicCharacter(params.name, charData);
      // 立即创建运行时 NPC 状态并同步位置
      const { getOrCreateNPC } = await import("../../engine/state.ts");
      const npcState = getOrCreateNPC(params.name);
      npcState.currentRoom = params.default_location || gameState.player.location;
      saveState();

      // 汇总创建的字段列表
      const filledFields = Object.keys(charData).filter(k => k !== "name" && k !== "gender" && k !== "base_age" && k !== "source");
      return {
        content: [{ type: "text", text: `${r}\n原因: ${params.reason}\n已填充字段: ${filledFields.join("、")}\n可通过 lookup_character("${params.name}") 查看完整角色卡。` }],
        details: { character: findCharacter(params.name) }
      };
    },
  };
