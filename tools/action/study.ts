import { Type } from "typebox";

export default {
    name: "study", label: "自习",
    description: "在指定地点自习一门科目。耗时推进+智力检定。学科: 国语|数学|英语|理科|社会|世界史|日本史|物理|化学。",
    parameters: Type.Object({
      subject: Type.String({ description: "学科名：国语/数学/英语/理科/社会/世界史/日本史/物理/化学/信息" }),
      hours: Type.Number({ description: "自习时长（小时，1-4）" }),
      location: Type.Optional(Type.String({ description: "自习地点，缺省=当前位置" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { saveState, gameState } = await import("../../engine/state.ts");
      const { advanceTimeMinutes } = await import("../helpers.ts");
      const { checkDC } = await import("../../engine/dice.ts");

      const p = gameState.player;
      const subject = params.subject;
      const hours = Math.min(4, Math.max(1, params.hours));
      const location = params.location || p.location;

      // Build narrative conditions
      const conditions: string[] = [];
      let advantage: "优势" | "劣势" | "平" = "平";
      let skillBonus = 0;

      // Location bonus
      if (location.includes("图书") || location.includes("図書") || location.includes("自習")) {
        advantage = "优势";
        conditions.push("安静的图书馆——最适合集中注意力的地方");
      }

      // Subject-specific skill lookup
      const subjectSkillMap: Record<string, string> = {
        "国语": "国語", "数学": "数学", "英语": "英语",
        "理科": "理科", "社会": "社会", "世界史": "世界史",
        "日本史": "日本史", "物理": "物理", "化学": "化学", "信息": "信息"
      };
      const skillKey = subjectSkillMap[subject];
      if (skillKey && p.skills[skillKey]) {
        skillBonus = p.skills[skillKey].level || 0;
        conditions.push(`${subject}基础Lv${skillBonus}`);
      }

      // Fatigue penalty
      const fatigue = p.fatigue ?? 0;
      if (fatigue >= 50) {
        advantage = advantage === "优势" ? "平" : "劣势";
        conditions.push("疲劳感袭来，集中力下降");
      }

      // Previous study flag bonus
      const studyFlag = `studied_${subject}`;
      if (gameState.flags[studyFlag]) {
        skillBonus += 2;
        conditions.push("之前复习过——这次捡起来更快");
      }

      // DC scales with hours (more hours = harder to stay focused)
      const dc = 10 + hours * 2;

      // INT attribute
      const intAttr = p.attributes?.智力 ?? 10;

      const roll = checkDC(dc, intAttr, skillBonus, advantage);

      // Advance time
      await advanceTimeMinutes(hours * 60, _ctx, gameState, saveState);

      // Build result narrative
      let resultText = "";
      const condText = conditions.length > 0 ? conditions.join("。") + "。" : "";

      if (roll.outcome === "success") {
        gameState.flags[studyFlag] = true;
        const marginText = roll.margin >= 5 ? "状态特别好——思路异常清晰，连之前卡了很久的地方都豁然开朗。" :
                           roll.margin >= 2 ? "效果不错——该记的记了，该算的算了。" :
                           "勉强啃下来了——虽然花了比预期更长的时间。";
        resultText = `${condText}你花了${hours}小时专心复习${subject}。${marginText}`;
      } else if (roll.outcome === "success-with-cost") {
        gameState.flags[studyFlag] = true;
        resultText = `${condText}你花了${hours}小时啃${subject}。虽然大部分时间在走神——翻了三页就忍不住看手机——但最后还是硬撑着看完了一章。作用有限，总比没看强。`;
      } else {
        resultText = `${condText}你花了${hours}小时试图复习${subject}。盯着教科书发了${hours}小时的呆，各种思绪涌上心头——下周的考试、昨晚的梦、窗外的鸟叫声。合上书的那一刻，你发现一个字也没看进去。`;
      }

      // Fatigue increase
      p.fatigue = Math.min(100, fatigue + hours * 8);
      saveState();

      return {
        content: [{ type: "text", text: resultText }],
        details: {
          subject, hours, location,
          dc, roll: roll.roll, outcome: roll.outcome,
          flag_set: roll.outcome !== "failure" ? studyFlag : null
        }
      };
    },
  };
