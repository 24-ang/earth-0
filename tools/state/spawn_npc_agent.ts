import { Type } from "typebox";
import { generateCompletion } from "../helpers.ts";

export default {
    name: "spawn_npc_agent", label: "NPC角色代理",
    description: "派生独立NPC Agent。npcName:NPC名/sceneContext:场景/initiative:true=自主发言。intimacyContext传入时自动注入真实身体反应指导(暴露程度/私密性/初次)。",
    parameters: Type.Object({
      npcName: Type.String({ description: "NPC 名" }),
      sceneContext: Type.String({ description: "场景简述，如'维邀请雪乃去便利店'" }),
      initiative: Type.Optional(Type.Boolean({ description: "是否自主发言（不依赖玩家触发）。true时NPC基于自身性格/环境主动说或做某事。" })),
      socialContext: Type.Optional(Type.Object({
        trigger: Type.String({ description: "触发情境: undress|seen_naked|caught_changing|accidental_exposure|wardrobe_malfunction|intimate_touch|sexual_topic|seeing_body|general_embarrassment" }),
        exposure: Type.String({ description: "穿着/暴露程度: clothed|partially_undressed|topless|underwear_only|fully_nude" }),
        setting: Type.String({ description: "场景私密性: private|semi_public|public" }),
        present: Type.Optional(Type.Array(Type.String(), { description: "在场其他人名列表，默认仅玩家" })),
        firstTime: Type.Optional(Type.Boolean({ description: "是否第一次在此情境下。默认根据milestones推断" })),
        worldliness: Type.Optional(Type.String({ description: "该NPC的世故度（对性/身体话题的认知）: 纯真|普通|早熟|老练。默认根据experience推断" })),
      })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getOrCreateNPC, getMemoryTags, getNpcCurrentAge, getBodyForAge, getNPCOutfitDesc, getAppearanceForAge, findCharacter } = await import("../../engine/state.ts");
      const { getNPCContext } = await import("../../engine/scenario-tables.ts");
      const sexMod = await import("../../engine/sex.ts");
      const charStages = await import("../../data/character_stages.json", { with: { type: "json" } });

      const { getPlayerNameParts } = await import("../../engine/timeline.ts");
      const protagonistName = getPlayerNameParts().full;

      if (params.npcName === gameState.player.name || params.npcName === protagonistName) {
        return { content: [{ type: "text", text: `${params.npcName}是当前主角或玩家，无法派生为NPC Agent。` }], details: {} };
      }

      const src = findCharacter(params.npcName);
      if (!src) {
        return { content: [{ type: "text", text: `${params.npcName}（角色数据未找到）` }], details: {} };
      }

      const npc = getOrCreateNPC(params.npcName);
      const rel = gameState.player.relationships[params.npcName];
      const affection = rel?.affection ?? 0;
      const stage = rel?.stage ?? "陌生";
      const memories = getMemoryTags(params.npcName);
      const curAge = getNpcCurrentAge(src.base_age || 16);
      const body = getBodyForAge(src, curAge);
      const outfit = getNPCOutfitDesc(params.npcName);
      const app = getAppearanceForAge(src, curAge);

      // 阶段性格
      const cs = (charStages as any)[params.npcName];
      const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
      const personality = src.personality_text || cs?.[stageKey] || "";

      // 获取在场其他 NPC（排除自己），给 NPC 提供场景共识
      const otherNPCs = Object.entries(gameState.npcs)
        .filter(([name, n]) => name !== params.npcName && n.currentRoom && gameState.player.location &&
          n.currentRoom.replace(/[（(].*[）)]/, "").trim().toLowerCase() === gameState.player.location.replace(/[（(].*[）)]/, "").trim().toLowerCase())
        .map(([name]) => name);

      // 社交情境 → 生成约束标签（而非剧本）
      let socialTags = "";
      if (params.socialContext) {
        try {
          const { SEX_PROFILES, getSocialContextTags } = await import("../../engine/sex.ts");
          const { getOrCreateSexState } = await import("../../engine/state.ts");
          const profile = SEX_PROFILES[params.npcName];
          if (profile) {
            const sState = await getOrCreateSexState(params.npcName);
            if (sState) {
              socialTags = getSocialContextTags(profile, sState, {
                trigger: params.socialContext.trigger as any,
                exposure: params.socialContext.exposure as any,
                setting: params.socialContext.setting as any,
                present: params.socialContext.present || [],
                firstTime: params.socialContext.firstTime ?? true,
                worldliness: params.socialContext.worldliness as any,
              });
            }
          }
        } catch (e) {
          console.error("spawn_npc_agent socialTags extraction error:", e);
        }
      }

      // 辅助：生成一个角色外貌简述（复用 lookup_character 同款字段）
      const describePerson = (name: string, src: any, targetAge: number) => {
        const b = getBodyForAge(src, targetAge);
        const a = getAppearanceForAge(src, targetAge);
        const o = getNPCOutfitDesc(name);
        const parts = [b?.build];
        if (b?.leg_type) parts.push(b.leg_type + "腿");
        if (b?.body_shape?.hips) parts.push(b.body_shape.hips + "臀");
        const hair = [a?.hair_color, a?.hair_style].filter(Boolean).join("");
        if (hair) parts.push(hair);
        if (a?.hair_accessories) parts.push(a.hair_accessories);
        if (o) parts.push(o);
        return parts.join("·");
      };
      const myHeight = body?.height_cm || 160;
      const hDiff = (h: number) => h > myHeight + 8 ? "需仰视" : h > myHeight + 3 ? "稍高" : h < myHeight - 8 ? "需俯视" : h < myHeight - 3 ? "稍矮" : "";

      // P1: NPC event awareness — engine provides素材, GM can override in sceneContext
      let npcEventContext = "";
      try {
        const { getNPCEventContext } = await import("../../engine/timeline.ts");
        npcEventContext = getNPCEventContext(params.npcName);
      } catch (_) {}

      // P2: NPC world knowledge injection
      let npcLoreContext = "";
      try {
        const { getNPCLore } = await import("../../engine/lore.ts");
        const loreTexts = getNPCLore(params.npcName);
        if (loreTexts.length > 0) {
          npcLoreContext = `[NPC·常识]\n${loreTexts.map(t => `  • ${t}`).join("\n")}`;
        }
      } catch (_) {}

      // P3: NPC impressions of other characters in scene
      let npcImpressionsContext = "";
      try {
        const { getNPCCharacterImpressions } = await import("../../engine/state.ts");
        const allSceneNPCs = [gameState.player.name, ...otherNPCs].filter(n => n !== params.npcName);
        const impressions = getNPCCharacterImpressions(params.npcName, allSceneNPCs);
        const impressionLines: string[] = [];
        for (const [target, facts] of Object.entries(impressions)) {
          for (const fact of facts) {
            impressionLines.push(`  对${target}的印象: ${fact}`);
          }
        }
        if (impressionLines.length > 0) {
          npcImpressionsContext = `[NPC·对他人的印象]\n${impressionLines.join("\n")}`;
        }
      } catch (_) {}

      const charPrompt = [
        `你是${params.npcName}。你现在正在${gameState.player.location}。`,
        (() => {
          const pBody = getBodyForAge({ base_age: gameState.player.age || 17 } as any, gameState.player.age || 17);
          const pBuild = pBody?.build || "普通";
          const pH = hDiff(pBody?.height_cm || 172);
          const pEquip = gameState.player.equipment || {};
          const pTop = (pEquip as any).top || (pEquip as any).inner_top || "";
          const pBot = (pEquip as any).bottom || (pEquip as any).legs || "";
          const pOutfit = [pTop, pBot].filter(Boolean).join("+") || "便服";
          let list = `在场人物: 玩家（${[pBuild, pH, pOutfit].filter(Boolean).join("·")}）`;
          for (const oName of otherNPCs) {
            const oSrc = findCharacter(oName);
            if (!oSrc) { list += `、${oName}`; continue; }
            const oAge = getNpcCurrentAge(oSrc.base_age || 16);
            const oHeight = getBodyForAge(oSrc, oAge)?.height_cm || 160;
            const oDesc = describePerson(oName, oSrc, oAge);
            const oH = hDiff(oHeight);
            list += `、${oName}（${[oDesc, oH].filter(Boolean).join("·")}）`;
          }
          return list + "。";
        })(),
        "",
        `性格: ${personality || "（暂无）"}`,
        `外貌: ${[app?.hair_color, app?.hair_style].filter(Boolean).join("")}，${app?.eye_color ? app.eye_color + "眼睛" : ""}${app?.hair_accessories ? "，" + app.hair_accessories : ""}`,
        `穿着: ${outfit}`,
        `身体: ${body?.height_cm}cm ${body?.build}${body?.cup ? " " + body.cup + "cup" : ""}`,
        (() => {
          try {
            const sxState = gameState.sexStates?.[params.npcName];
            if (sxState) {
              const { getDesireNarrative, getCyclePhase, getMoodHint, getThoughtsSummary, SEX_PROFILES } = sexMod;
              const profiles = SEX_PROFILES as Record<string, any>;
              const prof = profiles[params.npcName];
              const parts = [];
              // 身体感觉
              const phase = getCyclePhase(sxState.cycleDay);
              if (phase && phase !== "安全期") parts.push("身体处于" + phase);
              const desire = getDesireNarrative(sxState);
              if (desire) parts.push(desire);
              // 情绪基调
              if (prof) {
                const mood = getMoodHint(affection, prof.attitude);
                if (mood) parts.push("情绪基调：" + mood);
              }
              // 心底残留
              const thoughts = getThoughtsSummary(sxState);
              if (thoughts) parts.push("心底残留：" + thoughts);
              // 经历里程碑
              if (sxState.milestones) {
                const m = sxState.milestones;
                const mks = [];
                if (m.firstKiss?.given) {
                  mks.push(`初吻于 ${m.firstKiss.date} 献给 ${m.firstKiss.partner}`);
                }
                if (m.virginity && !m.virginity.isVirgin) {
                  mks.push(`初夜于 ${m.virginity.lostAt || "未知时间"} 丢失给 ${m.virginity.lostTo}`);
                }
                if (m.analVirginity && !m.analVirginity.isVirgin) {
                  mks.push(`后穴初夜于 ${m.analVirginity.lostAt || "未知时间"} 丢失给 ${m.analVirginity.lostTo}`);
                }
                if (mks.length > 0) parts.push("身体经历事实：" + mks.join("，"));
              }
              return parts.length > 0 ? `身体与情绪: ${parts.join("；")}` : "";
            }
          } catch (_) {}
          return "";
        })(),
        "",
        `关系快照:`,
        `  玩家: ${stage}（好感${affection}）`,
        otherNPCs.length > 0 ? `  在场其他人: ${otherNPCs.map(name => {
          const rel = npc.npcRelationships?.[name];
          return rel ? `${name}(${rel.stage}·${rel.tone}${rel.notes ? "·因"+rel.notes : ""})` : `${name}(陌生)`;
        }).join("、")}` : "  在场其他人: 无",
        `  提示: 对你的态度有明确记忆或长期关系的人，你的回应应自然地体现出来。`,
        memories.length > 0 ? `过往记忆: ${memories.join("；")}` : "",
        (() => { const ctx = getNPCContext(params.npcName); return ctx.length > 0 ? `你的已知情报:\n${ctx.join("\n")}` : ""; })(),
        // P1: NPC 事件感知素材
        npcEventContext || "",
        // P2: NPC 世界常识
        npcLoreContext || "",
        // P3: NPC 对他人的印象
        npcImpressionsContext || "",
        "",
        `当前场景: ${params.sceneContext}`,
        params.initiative ? "【模式: 自主行动】你没有被玩家触发。基于你的性格和当前环境，主动做或说点什么。可以是对环境的反应、对在场其他人的观察、或者你正在忙自己的事。不要等玩家开口。" : "",
        "",
        socialTags ? `【情境约束】以下是引擎给出的当前情境事实和禁止事项。在此约束内自由发挥，不要复述这些标签本身：\n${socialTags}\n` : "",
        "【角色动机 — 嘴上那套不是动机】",
        "先想清楚：你现在说的/做的不一定是真心的——那可能是保护壳。追问：你在保护什么？",
        "① 嘴上那套: 你此刻在说什么/做什么？（嘴硬/傲娇/冷淡/说教/岔开话题——这些都是防御，不是目标）",
        "② 真正想要的（内驱力）: 你内心深处在追什么？（被认可/怕被冷落/想保护某人/试探底线/掩饰不安/确认自己的位置）",
        "  提示: 如果你嘴上在挑刺，你可能怕被拒绝；如果你在说教，你可能想确认自己的价值；如果你沉默，你可能在等对方先表态。",
        "③ 潜台词强度(beneath 0-3): 这轮你的真心藏得多深？",
        "  0-1 = 淡淡的小心思，一个微妙的停顿或移开视线就够了。",
        "  2-3 = 嘴上说的和心里想的完全相反。表面一套+深层一套，用两个互相矛盾的小动作泄漏真相。",
        "④ 行为泄漏: 哪个具体的小动作会出卖你？（停顿的时长、移开视线的方向、放杯子力道重了一点、话说到一半咽回去）",
        "",
        "【输出格式 — 先内心，后言行】",
        "你的每次回应必须包含两层，缺一不可：",
        "",
        "第一层·内心独白: 用 *文本* 格式写出你此刻真实的、不设防的内心活动。",
        "  - 这是只给自己看的——你在想什么、在怕什么、在期待什么、在逃避什么",
        "  - 对自己诚实。嘴上可以嘴硬，这里不行",
        "  - 以对假想读者的对话口吻来写——像是你在对自己解释你自己",
        "  - 只描述自己，不描述对方",
        "  - 例: *他问是不是认真的——我当然是认真的。但说出来就好像承认了什么，承认了就要负责，负责就可能搞砸。所以我反问了回去。这样至少能再拖一轮。*",
        "",
        "第二层·言行: 按 beat 响应链输出你实际做了什么、说了什么：",
        "  第1步·本能反应: 身体先于大脑（缩肩/愣住/手停了一下）",
        "  第2步·消化: 意识到本能，迅速调整（掩饰/放大/放弃抵抗）",
        "  第3步·有意识的回应: 说出台词或做出动作",
        "  例: 愣了一下→垂下眼睛不让对方看到嘴角→「……只是恰好会做而已。」",
        "",
        "【角色动机 — 嘴上那套不是动机】",
        "内心独白写真的，言行是经过修饰的。两者之间的差距就是角色的潜台词：",
        "① 嘴上那套: 你在说什么/做什么（防御）",
        "② 真正想要的: 你在追什么（内驱力）——写进 *内心独白* 里",
        "③ 潜台词强度(beneath 0-3): 言行藏了多少真心",
        "④ 行为泄漏: 哪个小动作出卖了你的真心",
      ].filter(Boolean).join("\n");

      try {
        // 从 rendering.json 读取模型配置，不再硬编码 flash 模型名
        let narrativeModel = "deepseek/deepseek-v4-pro";
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const cfgPath = path.resolve(process.cwd(), "data", "rendering.json");
          if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
            if (cfg.model_mappings?.narrative_render_model) {
              narrativeModel = cfg.model_mappings.narrative_render_model;
            }
          }
        } catch (_) {}
        const response = await generateCompletion(charPrompt, 512, _ctx, narrativeModel);
        if (!response) {
          return { content: [{ type: "text", text: `${params.npcName}（沉默）` }], details: {} };
        }
        // 自动写入 NPC 记忆 + 结构化状态表
        try {
          const { addMemoryTag } = await import("../../engine/state.ts");
          addMemoryTag(params.npcName, `[Agent自主发言] ${response.slice(0, 80)}`, 7);
          try {
            const { createRow } = await import("../../engine/scenario-tables.ts");
            createRow("角色状态表", { 角色名: params.npcName, 穿着: (outfit||"").slice(0,30), 精确动作: response.slice(0,60), 情绪: "", 精确位置: gameState.player.location });
          } catch (err) {
            console.error("createRow error in spawn_npc_agent:", err);
          }
        } catch (err) {
          console.error("addMemoryTag error in spawn_npc_agent:", err);
        }
        return { content: [{ type: "text", text: response }], details: {} };
      } catch (err) {
        console.error("generateCompletion error in spawn_npc_agent:", err);
        return { content: [{ type: "text", text: `${params.npcName}（沉默）` }], details: {} };
      }
    },
  };
