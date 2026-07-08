import { Type } from "typebox";
import { generateCompletion, getNpcAgentModel, getSocialContextTagsForNPC, NPC_MOTIVATION_PROMPT, recordNpcAgentAction, buildPresentLine } from "../helpers.ts";
import { getNpcLintPatches } from "../../engine/audit/lint-rules.ts";

export async function buildNpcAgentContext(
  npcName: string,
  otherNPCs?: string[],
  socialContext?: any,
  sceneContext?: string
) {
  const { gameState, getOrCreateNPC, recallRelevantMemories, getNpcCurrentAge, getBodyForAge, getNPCOutfitDesc, getAppearanceForAge, findCharacter } = await import("../../engine/state.ts");
  const charStages = await import("../../data/character_stages.json", { with: { type: "json" } });

  const src = findCharacter(npcName);
  if (!src) return null;

  const npc = getOrCreateNPC(npcName);
  const rel = gameState.player.relationships[npcName];
  const affection = rel?.affection ?? 0;
  const stage = rel?.stage ?? "陌生";
  const memories = recallRelevantMemories(npcName, {
    location: gameState.player.location,
    presentNPCs: otherNPCs || [],
    topic: sceneContext ? sceneContext.slice(0, 50) : undefined
  });
  const curAge = getNpcCurrentAge(src.base_age || 16);
  const body = getBodyForAge(src, curAge);
  const outfit = getNPCOutfitDesc(npcName);
  const app = getAppearanceForAge(src, curAge);

  // 阶段性格
  const cs = (charStages as any)[npcName];
  const stageKey = curAge <= 11 ? "幼儿_小学" : curAge <= 14 ? "中学" : curAge <= 17 ? "高中" : "成年";
  const personality = src.personality_text || cs?.[stageKey] || "";

  // 社交情境标签
  const socialTags = await getSocialContextTagsForNPC(npcName, socialContext);

  // P1: NPC event awareness
  let npcEventContext = "";
  try {
    const { getNPCEventContext } = await import("../../engine/timeline.ts");
    npcEventContext = getNPCEventContext(npcName);
  } catch (e) { console.error("buildNpcAgentContext: getNPCEventContext error", e); }

  // P2: NPC world knowledge
  let npcLoreContext = "";
  try {
    const { getNPCLore } = await import("../../engine/lore.ts");
    const loreTexts = getNPCLore(npcName);
    if (loreTexts.length > 0) {
      npcLoreContext = `[NPC·常识]\n${loreTexts.map(t => `  • ${t}`).join("\n")}`;
    }
  } catch (e) { console.error("buildNpcAgentContext: getNPCLore error", e); }

  // P3: NPC impressions of other characters
  let npcImpressionsContext = "";
  try {
    const { getNPCCharacterImpressions } = await import("../../engine/state.ts");
    const allSceneNPCs = [gameState.player.name, ...(otherNPCs || [])].filter(n => n !== npcName);
    const impressions = getNPCCharacterImpressions(npcName, allSceneNPCs);
    const impressionLines: string[] = [];
    for (const [target, facts] of Object.entries(impressions)) {
      for (const fact of facts) {
        impressionLines.push(`  对${target}的印象: ${fact}`);
      }
    }
    if (impressionLines.length > 0) {
      npcImpressionsContext = `[NPC·对他人的印象]\n${impressionLines.join("\n")}`;
    }
  } catch (e) { console.error("buildNpcAgentContext: getNPCCharacterImpressions error", e); }

  return {
    src,
    npc,
    rel,
    affection,
    stage,
    memories,
    curAge,
    body,
    outfit,
    app,
    personality,
    socialTags,
    npcEventContext,
    npcLoreContext,
    npcImpressionsContext
  };
}

export default {
    name: "spawn_npc_agent", label: "NPC角色代理",
    description: "派生独立NPC Agent发言。npcName:角色名/sceneContext:场景简述。",
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
      const { gameState, getOrCreateNPC, getMemoryTags, getNpcCurrentAge, getBodyForAge, getNPCOutfitDesc, getAppearanceForAge, findCharacter, getVisibleBodyDescription, getNPCVisibleBodyDescription, getNamelessNPCs, getRoom, getRoomAgingLine, translateWorldState, getOutfitChangesThisTurn } = await import("../../engine/state.ts");
      const { getNPCContext } = await import("../../engine/scenario-tables.ts");
      const sexMod: any = await import("../../engine/sex.ts").catch(() => null);

      const { getPlayerNameParts } = await import("../../engine/timeline.ts");
      const protagonistName = getPlayerNameParts().full;

      if (params.npcName === gameState.player.name || params.npcName === protagonistName) {
        return { content: [{ type: "text", text: `${params.npcName}是当前主角或玩家，无法派生为NPC Agent。` }], details: {} };
      }

      const otherNPCs = Object.entries(gameState.npcs)
        .filter(([name, n]) => name !== params.npcName && n.currentRoom && gameState.player.location &&
          n.currentRoom.replace(/[（(].*[）)]/, "").trim().toLowerCase() === gameState.player.location.replace(/[（(].*[）)]/, "").trim().toLowerCase())
        .map(([name]) => name);

      const context = await buildNpcAgentContext(params.npcName, otherNPCs, params.socialContext, params.sceneContext);
      if (!context) {
        return { content: [{ type: "text", text: `${params.npcName}（角色数据未找到）` }], details: {} };
      }

      const { src, npc, rel, affection, stage, memories, curAge, body, outfit, app, personality, socialTags, npcEventContext, npcLoreContext, npcImpressionsContext } = context;

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
      const presentLine = await buildPresentLine(gameState, myHeight, otherNPCs);
      const wsLine = translateWorldState(gameState.worldState);

      const charPrompt = [
        `你是${params.npcName}。你现在正在${gameState.player.location}。`,
        wsLine,
        // 环境感知（天气/季节/时段——NPC也是人，能感知冷暖昼夜）
        (() => {
          const weather = gameState.weather;
          const time = gameState.time;
          const m = parseInt((time?.game_date || "2018-04").split("-")[1]) || 4;
          const seasons = ["冬","冬","春","春","春","夏","夏","夏","秋","秋","秋","冬"];
          const timeOfDayZH: Record<string, string> = { dawn:"拂晓", morning:"上午", noon:"正午", afternoon:"下午", evening:"傍晚", night:"深夜" };
          const td = timeOfDayZH[time?.time_of_day] || time?.time_of_day || "";
          return `环境: ${seasons[m-1]}季${td}，${weather?.type || "晴"} ${weather?.temp ?? "?"}°C`;
        })(),
        // 房间感知（这个房间长什么样、有什么家具）
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
          } catch (e) { console.error("spawn_npc_agent: sexState narrative error", e); }
          return "";
        })(),
        "",
        `关系快照:`,
        `  玩家: ${stage}（好感${affection}）`,
        otherNPCs.length > 0 ? `  在场其他人: ${otherNPCs.map(name => {
          const rel = npc.npcRelationships?.[name];
          return rel ? `${name}(${rel.stage}·${rel.tone}${rel.notes ? "·因"+rel.notes : ""})` : `${name}(陌生)`;
        }).join("、")}` : "  在场其他人: 无",
        (() => {
          // 身份匹配：从 stage 描述/记忆/anchors 中识别在场其他人的身份
          if (otherNPCs.length === 0) return "";
          const textsToScan = [personality, src.personality_brief, src.anchors?.private, ...memories].filter(Boolean);
          const lines: string[] = [];
          for (const oName of otherNPCs) {
            for (const txt of textsToScan) {
              if (typeof txt === "string" && txt.includes(oName)) {
                // 取名字前后各 30 字的上下文
                const idx = txt.indexOf(oName);
                const start = Math.max(0, idx - 15);
                const end = Math.min(txt.length, idx + oName.length + 30);
                let snippet = txt.slice(start, end).replace(/\n/g, "");
                if (start > 0) snippet = "…" + snippet;
                if (end < txt.length) snippet += "…";
                lines.push(`  你认识${oName}：${snippet}`);
                break; // 只取第一个命中
              }
            }
          }
          return lines.length > 0 ? `【身份识别】在场的人中：\n${lines.join("\n")}` : "";
        })(),
        `  提示: 对你的态度有明确记忆或长期关系的人，你的回应应自然地体现出来。`,
        memories.length > 0 ? `过往记忆: ${memories.join("；")}` : "",
        (() => {
          try {
            const patches = getNpcLintPatches(npcName);
            return patches.length > 0 ? patches.join("\n") : "";
          } catch { return ""; }
        })(),
        (() => { const ctx = getNPCContext(params.npcName); return ctx.length > 0 ? `你的已知情报:\n${ctx.join("\n")}` : ""; })(),
        // P1: NPC 事件感知素材
        npcEventContext || "",
        // P2: NPC 世界常识
        npcLoreContext || "",
        // P3: NPC 对他人的印象
        npcImpressionsContext || "",
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
        (() => {
          const changes = getOutfitChangesThisTurn();
          if (changes.length === 0) return "";
          const myChange = changes.find(c => c.npc === params.npcName);
          const otherChanges = changes.filter(c => c.npc !== params.npcName);
          const lines: string[] = [];
          if (myChange) lines.push(`你刚换上了${myChange.to}服装（${myChange.desc}）。之前穿的是${myChange.from}。思考或说话时自然提及换装动作，不要假装衣服一直穿着。`);
          for (const oc of otherChanges) lines.push(`${oc.npc}刚换上了${oc.to}服装（${oc.desc}）。`);
          return lines.length > 0 ? `[换装] ${lines.join(" ")}` : "";
        })(),
        `当前场景: ${params.sceneContext}`,
        params.initiative ? "【模式: 自主行动】你没有被玩家触发。基于你的性格和当前环境，主动做或说点什么。可以是对环境的反应、对在场其他人的观察、或者你正在忙自己的事。不要等玩家开口。" : "",
        "",
        socialTags ? `【情境约束】以下是引擎给出的当前情境事实和禁止事项。在此约束内自由发挥，不要复述这些标签本身：\n${socialTags}\n` : "",
        NPC_MOTIVATION_PROMPT,
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

      // Build NPC Agent 今天的生活上下文
      let todayContext = "";
      try {
        const { buildTodayContext } = await import("../helpers.ts");
        const npc = getOrCreateNPC(params.npcName);
        const src = findCharacter(params.npcName);
        todayContext = buildTodayContext(gameState, params.npcName, npc, src);
      } catch (e) {
        console.error("spawn_npc_agent buildTodayContext failed:", e);
      }

      try {
        const finalPrompt = todayContext ? charPrompt + "\n\n" + todayContext : charPrompt;
        const narrativeModel = await getNpcAgentModel();
        const response = await generateCompletion(finalPrompt, 512, _ctx, narrativeModel);
        if (!response) {
          return { content: [{ type: "text", text: `${params.npcName}（沉默）` }], details: {} };
        }
        gameState._npc_last_responses ??= {};
        gameState._npc_last_responses[params.npcName] = response;
        await recordNpcAgentAction(params.npcName, response, outfit || "", gameState.player.location);
        // 解析 schedule_intent
        try {
          const { parseScheduleIntent } = await import("../helpers.ts");
          await parseScheduleIntent(params.npcName, response);
        } catch (e) {
          console.error("spawn_npc_agent parseScheduleIntent failed:", e);
        }
        // 解析 NPC intent（Phase 2.5 反制意图 → 物理效果）
        try {
          const { parseNpcIntent } = await import("../helpers.ts");
          await parseNpcIntent(params.npcName, response);
        } catch (e) {
          console.error("spawn_npc_agent parseNpcIntent failed:", e);
        }
        return { content: [{ type: "text", text: response }], details: {} };
      } catch (err) {
        console.error("generateCompletion error in spawn_npc_agent:", err);
        return { content: [{ type: "text", text: `${params.npcName}（沉默）` }], details: {} };
      }
    },
  };
