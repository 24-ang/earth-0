import { Type } from "typebox";
import { generateCompletion, getNpcAgentModel, getSocialContextTagsForNPC, NPC_MOTIVATION_PROMPT, recordNpcAgentAction, buildPresentLine } from "../helpers.ts";
import { getNpcLintPatches } from "../../engine/audit/lint-rules.ts";

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
      const { gameState, getOrCreateNPC, recallRelevantMemories, getNpcCurrentAge, getBodyForAge, getNPCOutfitDesc, getAppearanceForAge, findCharacter, getVisibleBodyDescription, getNPCVisibleBodyDescription, getNamelessNPCs, getRoom, getRoomAgingLine, translateWorldState } = await import("../../engine/state.ts");
      const charStages = await import("../../data/character_stages.json", { with: { type: "json" } });

      async function runOne(npcName: string, sceneContext: string, initiative?: boolean): Promise<{response: string; outfit: string}> {
        const src = findCharacter(npcName);
        if (!src) return {response: `${npcName}（未找到）`, outfit: ""};

        const npc = getOrCreateNPC(npcName);
        const rel = gameState.player.relationships[npcName];
        const affection = rel?.affection ?? 0;
        const stage = rel?.stage ?? "陌生";
        const batchOthers = params.npcs
          .filter((n: any) => n.npcName !== npcName)
          .map((n: any) => n.npcName);
        const memories = recallRelevantMemories(npcName, {
          location: gameState.player.location,
          presentNPCs: batchOthers,
          topic: sceneContext ? sceneContext.slice(0, 50) : undefined
        });
        const curAge = getNpcCurrentAge(src.base_age || 16);
        const body = getBodyForAge(src, curAge);
        const outfit = getNPCOutfitDesc(npcName);
        const app = getAppearanceForAge(src, curAge);
        const cs = (charStages as any)[npcName];
        const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
        const personality = cs?.[stageKey] || "";

        // 社交情境 → 按 NPC 个体生成约束标签
        const socialTags = await getSocialContextTagsForNPC(npcName, params.socialContext);

        const presentLine = await buildPresentLine(gameState, body?.height_cm || 160, batchOthers);
        const wsLine = translateWorldState(gameState.worldState);
        const prompt = [
          `你是${npcName}。你现在正在${gameState.player.location}。`,
          wsLine,
          // 环境感知（天气/季节/时段）
          (() => {
            const weather = gameState.weather;
            const time = gameState.time;
            const m = parseInt((time?.game_date || "2018-04").split("-")[1]) || 4;
            const seasons = ["冬","冬","春","春","春","夏","夏","夏","秋","秋","秋","冬"];
            const timeOfDayZH: Record<string, string> = { dawn:"拂晓", morning:"上午", noon:"正午", afternoon:"下午", evening:"傍晚", night:"深夜" };
            const td = timeOfDayZH[time?.time_of_day] || time?.time_of_day || "";
            return `环境: ${seasons[m-1]}季${td}，${weather?.type || "晴"} ${weather?.temp ?? "?"}°C`;
          })(),
          // 房间感知
          (() => {
            const room = getRoom(gameState.player.location);
            if (!room) return "";
            const furniture = new Set<string>();
            for (const row of room.cells) {
              if (!row) continue;
              for (const cell of row) {
                if (cell?.furniture) furniture.add(cell.furniture);
              }
            }
            const aging = getRoomAgingLine(gameState.player.location);
            const parts: string[] = [];
            if (room.atmosphere) parts.push(`房间氛围: ${room.atmosphere}`);
            if (furniture.size > 0) parts.push(`房间里有: ${Array.from(furniture).join("、")}`);
            if (aging) parts.push(`房间状态: ${aging}`);
            return parts.join("。");
          })(),
          presentLine,
          `性格: ${personality || "（暂无）"}`,
          `外貌: ${[app?.hair_color, app?.hair_style].filter(Boolean).join("")}，${app?.eye_color ? app.eye_color + "眼睛" : ""}`,
          `穿着: ${outfit}`,
          `关系: ${stage}（好感${affection}）`,
          (() => {
            if (batchOthers.length === 0) return "";
            const textsToScan = [personality, src.personality_brief, src.anchors?.private, ...memories].filter(Boolean);
            const lines: string[] = [];
            for (const oName of batchOthers) {
              for (const txt of textsToScan) {
                if (typeof txt === "string" && txt.includes(oName)) {
                  const idx = txt.indexOf(oName);
                  const start = Math.max(0, idx - 15);
                  const end = Math.min(txt.length, idx + oName.length + 30);
                  let snippet = txt.slice(start, end).replace(/\n/g, "");
                  if (start > 0) snippet = "…" + snippet;
                  if (end < txt.length) snippet += "…";
                  lines.push(`  你认识${oName}：${snippet}`);
                  break;
                }
              }
            }
            return lines.length > 0 ? `【身份识别】在场的人中：\n${lines.join("\n")}` : "";
          })(),
          memories.length > 0 ? `过往记忆: ${memories.join("；")}` : "",
          (() => {
            try {
              const patches = getNpcLintPatches(npcName);
              if (patches.length > 0) return patches.join("\n");
            } catch { /* lint-rules not loaded */ }
            return "";
          })(),
          (() => {
            if (!npc.shortTermBuffer) return "";
            const parts = [];
            if (npc.shortTermBuffer.recentExchanges && npc.shortTermBuffer.recentExchanges.length > 0) {
              parts.push(`【即时对话历史】(供你参考刚才发生的话题，不要重复或复读)：\n${npc.shortTermBuffer.recentExchanges.join("\n")}`);
            }
            if (npc.shortTermBuffer.recentEvents && npc.shortTermBuffer.recentEvents.length > 0) {
              parts.push(`【即时事件历史】(最近场景变动)：\n${npc.shortTermBuffer.recentEvents.map(e => `  • ${e}`).join("\n")}`);
            }
            return parts.length > 0 ? parts.join("\n\n") : "";
          })(),
          "",
          `当前场景: ${sceneContext}`,
          initiative ? "【模式: 自主行动】你没有被玩家触发。基于你的性格和当前环境，主动做或说点什么。" : "",
          "",
          socialTags ? `【情境约束】以下是引擎给出的当前情境事实和禁止事项。在此约束内自由发挥，不要复述这些标签本身：\n${socialTags}\n` : "",
          NPC_MOTIVATION_PROMPT,
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

        // Build NPC Agent 今天的生活上下文
        let todayContext = "";
        try {
          const { buildTodayContext } = await import("../helpers.ts");
          todayContext = buildTodayContext(gameState, npcName, npc, src);
        } catch (e) {
          console.error("spawn_npc_agents buildTodayContext failed:", e);
        }

        try {
          const finalPrompt = todayContext ? prompt + "\n\n" + todayContext : prompt;
          const narrativeModel = await getNpcAgentModel();
          const response = await generateCompletion(finalPrompt, 512, _ctx, narrativeModel);
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
      for (let i = 0; i < filteredNPCs.length; i++) {
        const text = results[i].response;
        if (!text.includes("（沉默）") && !text.includes("（未找到）")) {
          gameState._npc_last_responses ??= {};
          gameState._npc_last_responses[filteredNPCs[i].npcName] = text;
          await recordNpcAgentAction(filteredNPCs[i].npcName, text, results[i].outfit || "", gameState.player.location);
          // 解析 schedule_intent
          try {
            const { parseScheduleIntent } = await import("../helpers.ts");
            await parseScheduleIntent(filteredNPCs[i].npcName, text);
          } catch (e) {
            console.error("spawn_npc_agents parseScheduleIntent failed:", e);
          }
          // 解析 NPC intent（Phase 2.5 反制意图 → 物理效果）
          try {
            const { parseNpcIntent } = await import("../helpers.ts");
            await parseNpcIntent(filteredNPCs[i].npcName, text);
          } catch (e) {
            console.error("spawn_npc_agents parseNpcIntent failed:", e);
          }
        }
      }
      const text = filteredNPCs.map((n, i) => `[${n.npcName}] ${results[i].response}`).join("\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  };
