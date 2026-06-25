import { Type } from "typebox";
import { generateCompletion } from "../helpers.ts";

export default {
    name: "spawn_npc_agents", label: "批量NPC代理",
    description: "并行派生多个NPC Agent。npcs:[{npcName,sceneContext,initiative?}]。intimacyContext批量应用于所有NPC(同一场景共享)。",
    parameters: Type.Object({
      npcs: Type.Array(Type.Object({
        npcName: Type.String({ description: "NPC 名" }),
        sceneContext: Type.String({ description: "当前场景简述" }),
        initiative: Type.Optional(Type.Boolean({ description: "是否自主发言" })),
      })),
      socialContext: Type.Optional(Type.Object({
        trigger: Type.String({ description: "触发情境: undress|seen_naked|caught_changing|accidental_exposure|wardrobe_malfunction|intimate_touch|sexual_topic|seeing_body|general_embarrassment" }),
        exposure: Type.String({ description: "穿着/暴露程度: clothed|partially_undressed|topless|underwear_only|fully_nude" }),
        setting: Type.String({ description: "场景私密性: private|semi_public|public" }),
        present: Type.Optional(Type.Array(Type.String(), { description: "在场其他人名列表，默认仅玩家" })),
        firstTime: Type.Optional(Type.Boolean({ description: "是否第一次在此情境下" })),
        worldliness: Type.Optional(Type.String({ description: "世故度: 纯真|普通|早熟|老练" })),
      })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, getOrCreateNPC, getMemoryTags, getNpcCurrentAge, getBodyForAge, getNPCOutfitDesc, getAppearanceForAge, findCharacter } = await import("../../engine/state.ts");
      const charStages = await import("../../data/character_stages.json", { with: { type: "json" } });

      async function runOne(npcName: string, sceneContext: string, initiative?: boolean): Promise<{response: string; outfit: string}> {
        const src = findCharacter(npcName);
        if (!src) return {response: `${npcName}（未找到）`, outfit: ""};

        const npc = getOrCreateNPC(npcName);
        const rel = gameState.player.relationships[npcName];
        const affection = rel?.affection ?? 0;
        const stage = rel?.stage ?? "陌生";
        const memories = getMemoryTags(npcName);
        const curAge = getNpcCurrentAge(src.base_age || 16);
        const body = getBodyForAge(src, curAge);
        const outfit = getNPCOutfitDesc(npcName);
        const app = getAppearanceForAge(src, curAge);
        const cs = (charStages as any)[npcName];
        const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
        const personality = cs?.[stageKey] || "";

        const batchOthers = params.npcs
          .filter((n: any) => n.npcName !== npcName)
          .map((n: any) => n.npcName);

        // 社交情境 → 按 NPC 个体生成约束标签
        let socialTags = "";
        if (params.socialContext) {
          try {
            const { SEX_PROFILES, getSocialContextTags } = await import("../../engine/sex.ts");
            const { getOrCreateSexState } = await import("../../engine/state.ts");
            const profile = SEX_PROFILES[npcName];
            if (profile) {
              const sState = await getOrCreateSexState(npcName);
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
            console.error("spawn_npc_agents socialTags extraction error:", e);
          }
        }

        const prompt = [
          `你是${npcName}。你现在正在${gameState.player.location}。`,
          `在场人物: 玩家${batchOthers.length > 0 ? "、" + batchOthers.join("、") : "（仅你一人）"}。`,
          `性格: ${personality || "（暂无）"}`,
          `外貌: ${[app?.hair_color, app?.hair_style].filter(Boolean).join("")}，${app?.eye_color ? app.eye_color + "眼睛" : ""}`,
          `穿着: ${outfit}`,
          `关系: ${stage}（好感${affection}）`,
          memories.length > 0 ? `记忆: ${memories.join("；")}` : "",
          `当前场景: ${sceneContext}`,
          initiative ? "【模式: 自主行动】你没有被玩家触发。基于你的性格和当前环境，主动做或说点什么。" : "",
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
          "【回应规则 — beat响应链 ≥2步】",
          "你的回应不是单步反应。按这个链条输出：",
          "第1步·本能反应: 听到/看到/被问到→身体先于大脑的反应（缩肩/愣住/手停了一下）。这是你无法控制的。",
          "第2步·消化: 你意识到自己的本能反应，迅速调整——可能掩饰、可能放大、可能放弃抵抗。",
          "第3步·有意识的回应: 你决定怎么回答/怎么做。这时候才说出台词或做出动作。",
          "例: 被夸了→先愣了一下(1)→垂下眼睛不让对方看到自己嘴角(2)→「……只是恰好会做而已。」(3)",
          "- 情绪控制: 日常在3~7分。用小反应代替大情绪。",
          "- 拒绝空洞比喻（石子入湖/惊雷）和OO句式（不是xx而是xx、一丝、不易察觉）。",
        ].filter(Boolean).join("\n");

        try {
          let narrativeModel = "deepseek/deepseek-v4-flash";
          try {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const cfgPath = path.resolve(process.cwd(), "data", "rendering.json");
            if (fs.existsSync(cfgPath)) {
              const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
              if (cfg.model_mappings?.npc_agent_model) {
                narrativeModel = cfg.model_mappings.npc_agent_model;
              } else if (cfg.model_mappings?.narrative_render_model) {
                narrativeModel = cfg.model_mappings.narrative_render_model;
              }
            }
          } catch (_) {}
          const response = await generateCompletion(prompt, 512, _ctx, narrativeModel);
          if (!response) return {response: `${npcName}（沉默）`, outfit: ""};
          return {response, outfit: outfit || ""};
        } catch (e) {
          console.error("generateCompletion error in spawn_npc_agents runOne:", e);
          return {response: `${npcName}（沉默）`, outfit: ""};
        }
      }

      const { getPlayerNameParts } = await import("../../engine/timeline.ts");
      const protagonistName = getPlayerNameParts().full;
      // 过滤掉任何与玩家名字或当前主角名字相同的 NPC，以防止分身生成
      const filteredNPCs = params.npcs.filter((n: any) => n.npcName !== gameState.player.name && n.npcName !== protagonistName);

      const results = await Promise.all(filteredNPCs.map(n => runOne(n.npcName, n.sceneContext, (n as any).initiative)));
      // 自动写入所有 NPC 的记忆 + 结构化状态表
      try {
        const { addMemoryTag, saveState } = await import("../../engine/state.ts");
        for (let i = 0; i < filteredNPCs.length; i++) {
          const text = results[i].response;
          if (!text.includes("（沉默）") && !text.includes("（未找到）")) {
            addMemoryTag(filteredNPCs[i].npcName, `[Agent自主发言] ${text.slice(0, 80)}`, 7);
            try {
              const { createRow } = await import("../../engine/scenario-tables.ts");
              createRow("角色状态表", { 角色名: filteredNPCs[i].npcName, 穿着: (results[i].outfit||"").slice(0,30), 精确动作: text.slice(0,60), 情绪: "", 精确位置: gameState.player.location });
            } catch (err) {
              console.error("createRow error in spawn_npc_agents:", err);
            }
          }
        }
        saveState();
      } catch (err) {
        console.error("addMemoryTag error in spawn_npc_agents:", err);
      }
      const text = filteredNPCs.map((n, i) => `[${n.npcName}] ${results[i].response}`).join("\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  };
