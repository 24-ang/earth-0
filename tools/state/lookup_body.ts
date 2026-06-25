import { Type } from "typebox";

export default {
    name: "lookup_body", label: "查身体",
    description: "查询角色身体数据(三围/cup/体型)及性器官档案。type: basic|full。按需调用，避免默认注入浪费token。",
    parameters: Type.Object({
      name: Type.String({ description: "角色名" }),
      type: Type.Optional(Type.String({ description: "basic(仅身体数据) / full(含器官档案)，默认 full" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, getBodyForAge, getNpcCurrentAge, getOrCreateSexState, findCharacter } = await import("../../engine/state.ts");
      const isPlayer = params.name === gameState.player.name || params.name === "玩家";

      // 身体数据
      let body: any = null;
      if (isPlayer) {
        body = gameState.player.body;
      } else {
        const c = findCharacter(params.name);
        if (!c) return { content: [{ type: "text", text: `无此角色: ${params.name}` }], details: {} };
        const age = getNpcCurrentAge(c.base_age || 16);
        body = getBodyForAge(c, age);
      }

      const result: any = { name: params.name, body };

      // 器官档案（仅 full 模式）
      if (params.type !== "basic") {
        try {
          let profile: any = null;
          if (isPlayer) {
            // 玩家：用玩家自身性别构建默认 profile，防止读到 NPC 的 SexState（player.sex 在亲密场景中指向对方）
            const pGender = gameState.player.gender;
            const SEX_PROFILES = (await import("../../engine/sex.ts")).SEX_PROFILES;
            profile = SEX_PROFILES[gameState.player.name];
            if (!profile) {
              // 为玩家按性别构建基础 profile
              profile = {
                attitude: "期待",
                experience: "熟练",
                likes: [], dislikes: [],
                baselineDesire: 30,
                cycleDay: 0,
                climaxThreshold: 60,
                bodyParts: {},
              };
              if (pGender === "女") {
                (profile as any).female = { breast: { cup: "B", shape: "半球", feel: "柔软" }, vagina: { type: "闭合", tightness: "普通", depth_cm: 10 }, pubic_hair: { amount: "普通", color: "黑色", style: "自然" }, clitoris: "普通" };
              } else {
                (profile as any).male = { penis: { length_cm: 14, girth_cm: 10, shape: "直", head_size: "普通", circumcised: false, color: "普通" }, testicles: { size: "普通" }, pubic_hair: { amount: "普通", color: "黑色", style: "自然" } };
              }
            }
          } else {
            const sState = await getOrCreateSexState(params.name);
            if (sState) profile = sState.profile;
          }
          if (profile) {
            const safe: any = {};
            if (profile.female) {
              safe.female = {
                breast: profile.female.breast,
                vagina: profile.female.vagina,
                pubic_hair: profile.female.pubic_hair,
                clitoris: profile.female.clitoris,
              };
            }
            if (profile.male) {
              safe.male = {
                penis: profile.male.penis,
                testicles: profile.male.testicles,
                pubic_hair: profile.male.pubic_hair,
              };
            }
            safe.bodyParts = profile.bodyParts;
            safe.experience = profile.experience;
            safe.attitude = profile.attitude;
            result.sex_profile = safe;
          }
        } catch (e) {
          console.error("get_partner_state profile extraction error:", e);
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
