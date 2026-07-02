/**
 * engine/phase3-render.ts — Phase 3 渲染 prompt 组装
 *
 * 和原来 buildSystemPrompt 的区别：
 * - 不含 gm-rules.md（工具纪律规则）
 * - 不含 gm-contract.md（三段式合约——引擎强制执行，LLM 不需要知道）
 * - 不含工具提示
 * - 新增 director_note（Phase 1 产出）和 NPC 回应（Phase 2 产出）
 * - 指令改为"直接写叙事，不要调工具"
 * - 信息密度对齐旧版 buildStatePrompt：含空间网格/区域设定/玩家装备/身体状态/疲劳
 *
 * 参考文献：PHILOSOPHY §1.3, fate-sandbox two-pass-render
 */

// ── 公开 API ──

export interface RenderContext {
  directorNote: string;
  npcResponses: string;
  viewpointText?: string;
  summary: string;
  /** 正在 cue 玩家的 NPC 名列表（Part 1 交互检测产出） */
  activeNPCs?: string[];
}

/** 组装渲染轮的系统提示词 */
export async function buildRenderSystemPrompt(
  gameState: any,
  renderCtx: RenderContext,
): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const agentsDir = path.resolve(process.cwd(), "agents");

  const read = (name: string): string => {
    const p = path.join(agentsDir, name);
    if (!fs.existsSync(p)) return "";
    let content = fs.readFileSync(p, "utf-8").trim();
    const isFirstPerson = gameState.mode === "gal" || gameState.mode === "sex";
    const personText = isFirstPerson
      ? "第一人称「我」"
      : "第三人称「他」（镜头需钉在主角身边，采用第三人称限知视角）";
    return content.replace(/\{\{person\}\}/g, personText);
  };

  // 加载 voice/mode 文件
  const voiceFile = gameState.interactionMode === "novel"
    ? "gm-voice-novel.md"
    : "gm-voice-turnbased.md";

  const modeFile = gameState.mode === "sex" ? "gm-mode-sex.md"
    : gameState.mode === "rpg" ? "gm-mode-rpg.md"
    : "gm-mode-gal.md";

  const interactionMode = gameState.interactionMode || "turn_based";
  const wordBudget = interactionMode === "novel" ? "400-800" : "200-400";

  // 场景渲染上下文（空间网格/区域设定/房间氛围/玩家装备/身体状态——对齐旧版 buildStatePrompt）
  const sceneBrief = buildSceneBrief(gameState);
  const renderStateCtx = await buildRenderStateContext(gameState);

  // 在场 NPC 的外观描述
  const npcAppearances = await buildNpcAppearanceBlock(gameState);

  const parts = [
    read("gm-pre.md"),

    sceneBrief,
    renderStateCtx,

    npcAppearances,

    // 导演单 + NPC 回应
    renderCtx.directorNote,
    renderCtx.npcResponses
      ? `\n[NPC 独立回应 — 以下台词由NPC独立生成，必须原文引用，不得改写、提炼或替换措辞]\n${renderCtx.npcResponses}\n`
      : "",
    renderCtx.viewpointText
      ? `\n[切镜/幕间 — 以下为引擎自动生成的侧面描写，直接追加到正文末尾、「[/切镜]」或「[/幕间]」标记之后不要加任何内容]\n${renderCtx.viewpointText}\n`
      : "",

    // Voice + Mode
    read(voiceFile),
    read(modeFile),

    // 渲染指令（替代 gm-contract.md）
    buildRenderContract(wordBudget, interactionMode),
  ];

  return parts.filter(Boolean).join("\n\n---\n\n");
}

// ── 场景简报（基础时间/地点/天气） ──

function buildSceneBrief(gs: any): string {
  const lines: string[] = [];

  lines.push(`[场景状态]`);
  lines.push(`日期: ${gs.time?.game_date || "未知"} ${gs.time?.day_of_week || ""}`);
  
  let timeStr = gs.time?.game_time;
  if (!timeStr && gs.time?.minute_of_day !== undefined) {
    const hour = Math.floor(gs.time.minute_of_day / 60);
    const minute = gs.time.minute_of_day % 60;
    timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  lines.push(`时间: ${timeStr || "未知"}`);
  // 季节推导：硬约束防止 LLM 自由发挥
  const m = parseInt((gs.time?.game_date || "2018-04").split("-")[1]) || 4;
  const seasons = ["冬", "春", "春", "夏", "夏", "夏", "秋", "秋", "秋", "冬", "冬", "冬"];
  const season = seasons[m - 1] || "春";
  lines.push(`季节: ${season}（硬约束——当前是${m}月，禁止描写其他季节的气候/景物/节日）`);
  lines.push(`地点: ${gs.player?.location || "未知"}`);
  lines.push(`天气: ${gs.weather?.type || "晴"} ${gs.weather?.temp ?? "?"}°C`);

  // 模式行：结合 activeNPCs 提供更精确的描述
  const activeNPCs = gs._activeNPCs;
  if (gs.interactionMode === "novel") {
    lines.push(`模式: 小说式记叙`);
  } else {
    if (activeNPCs && activeNPCs.length > 0) {
      lines.push(`模式: 回合制对话（${activeNPCs.join("、")}正在与你互动）`);
    } else {
      lines.push(`模式: 回合制对话`);
    }
  }

  // 空间基础信息（详细网格/家具/墙壁由 buildRenderStateContext 注入）
  const room = gs.rooms?.[gs.player?.location];
  if (room?.description) {
    lines.push(`空间概况: ${room.description}`);
  }

  return lines.join("\n");
}

// ── 渲染状态上下文（对齐旧版 buildStatePrompt 的信息密度） ──
// 包含：空间网格/区域设定/房间氛围/玩家装备/身体状态/疲劳/在场NPC动作
// 不含：工具提示/剧情钩子/任务机制（Phase 3 不需要）

async function buildRenderStateContext(gs: any): Promise<string> {
  const { getGridContext, getRegionContext, getRoomAgingLine, getPlayerStatusNarrative, hasEquipmentEffect, isSameLocation } = await import("./state.ts");
  const parts: string[] = [];

  // ── 空间网格上下文（墙/家具/门窗/出口/四周） ──
  const gridCtx = getGridContext();
  if (gridCtx) parts.push(gridCtx);

  // ── 区域设定（地方色彩/社交规范） ──
  const regionCtx = getRegionContext(gs.player?.location);
  if (regionCtx) parts.push(`[区域设定] ${regionCtx}`);

  // ── 房间氛围（首次进入注入一次） ──
  gs.roomTimestamps ??= {};
  const { getRoomKey } = await import("./state.ts");
  const roomKey = getRoomKey(gs.player?.location) || gs.player?.location;
  const room = gs.rooms?.[gs.player?.location];
  if (!gs.roomTimestamps[roomKey] && room?.atmosphere) {
    parts.push(`[环境初感] ${room.atmosphere}`);
  }

  // ── 房间时间痕迹（脏污/灰尘） ──
  const agingLine = getRoomAgingLine(gs.player?.location);
  if (agingLine) parts.push(`[场景氛围] ${agingLine}`);

  // ── 玩家装备 ──
  const p = gs.player;
  if (p) {
    const SLOT_LABELS: Record<string, string> = {
      top: "外套", shirt: "内搭", inner_top: "胸衣", bottom: "下装", inner_bot: "内裤",
      legs: "袜", feet: "鞋", head: "头饰", acc: "配饰",
      left_hand: "左手", right_hand: "右手", back: "背"
    };
    const wornParts: string[] = [];
    const emptySlots: string[] = [];
    let mountItem: string | null = null;
    for (const [slot, item] of Object.entries(p.equipment || {})) {
      if (!item) {
        if (slot !== "mount" && SLOT_LABELS[slot]) emptySlots.push(SLOT_LABELS[slot]);
        continue;
      }
      if (slot === "mount") { mountItem = (item as any).name; continue; }
      const label = SLOT_LABELS[slot] || slot;
      if ((slot === "inner_top" || slot === "inner_bot") && !gs.layer1Enabled) {
        wornParts.push(`${label}:有`);
      } else {
        wornParts.push(`${label}:${(item as any).name}`);
      }
    }
    const eqSummary = wornParts.length > 0 ? wornParts.join(" | ") : "（全裸）";
    parts.push(`[玩家装备] ${eqSummary}`);
    if (emptySlots.length > 0 && emptySlots.length <= 6) {
      parts.push(`[装备空槽] ${emptySlots.join("、")}`);
    }
    if (mountItem) {
      const speedStr = p.vehicle ? ` ×${p.vehicle.speedMul}` : "";
      parts.push(`[载具] ${mountItem}${speedStr}`);
    }

    // ── 玩家身体状态 ──
    parts.push(getPlayerStatusNarrative(p));

    // ── 疲劳状态 ──
    const f = p.fatigue ?? 0;
    if (f >= 80) parts.push(`[状态] 你已经筋疲力尽，急需休息或提神饮品。`);
    else if (f >= 50) parts.push(`[状态] 你感到明显的疲劳，动作开始变慢。`);
    else if (f >= 25) parts.push(`[状态] 你有一丝倦意。`);

    // ── 寒冷天气装备提示 ──
    if (gs.weather?.temp < 5 && hasEquipmentEffect(p.equipment, "cold_resist")) {
      parts.push(`[装备效果] 厚实的衣物抵御着寒风——你并不觉得冷。`);
    }

    // ── 身份伪装提示 ──
    const { getDisguiseIdentity } = await import("./state.ts");
    const disguise = getDisguiseIdentity(p);
    if (disguise) {
      parts.push(`[身份认知] 你被认知为: ${disguise}`);
    } else if (p.public_identity) {
      parts.push(`[身份认知] 公开身份: ${p.public_identity}`);
    }

    // ── 称号 ──
    if (p.titles && p.titles.length > 0) {
      parts.push(`[称号] ${p.titles.join(" | ")}`);
    }
  }

  // ── 在场 NPC（含当前动作） ──
  const loc = gs.player?.location;
  if (loc && gs.npcs) {
    const inRoom = Object.entries(gs.npcs)
      .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, loc))
      .map(([name, n]: [string, any]) => `${name}${(n as any).action ? "(" + (n as any).action + ")" : ""}`);
    if (inRoom.length > 0) {
      parts.push(`[在场NPC] ${inRoom.join("、")}`);
    } else {
      parts.push(`[在场NPC] 无`);
    }
  } else {
    parts.push(`[在场NPC] 无`);
  }

  // ── 导演提示：沉默 NPC 不插话（仅当有 NPC 在场但无人 cue 玩家时） ──
  if (gs._activeNPCs && gs._activeNPCs.length === 0 && gs.npcs) {
    const loc2 = gs.player?.location;
    const presentNames = Object.entries(gs.npcs)
      .filter(([_, n]: [string, any]) => isSameLocation(n.currentRoom, loc2))
      .map(([name]) => name);
    if (presentNames.length > 0) {
      parts.push(`[导演提示] 当前在场的 NPC（${presentNames.join("、")}）并未主动与你互动，请不要让他们突然插入对话。如果他们应该注意到玩家，通过环境细节暗示（如视线移动、动作停顿）而非直接对话。`);
    }
  }

  return parts.filter(Boolean).join("\n");
}

// ── NPC 外观块 ──

async function buildNpcAppearanceBlock(gs: any): Promise<string> {
  const loc = gs.player?.location;
  if (!loc || !gs.npcs) return "[在场人物] 无";

  const { isSameLocation: npcIsSame } = await import("./state.ts");
  const present = Object.entries(gs.npcs)
    .filter(([_, npc]: [string, any]) => npcIsSame(npc.currentRoom, loc) && npc.alive !== false)
    .map(([name]) => name);

  if (present.length === 0) return "[在场人物] 无";

  const { findCharacter, getAppearanceForAge, getNpcCurrentAge, getNPCOutfitDesc } =
    await import("./state.ts");

  const isGAL = gs.mode === "gal";
  const lines: string[] = ["[在场人物]"];
  for (const name of present) {
    try {
      const src = findCharacter(name);
      if (!src) { lines.push(`${name}: 未知`); continue; }
      const age = getNpcCurrentAge(src.base_age || 16);
      const app = getAppearanceForAge(src, age);

      // getNPCOutfitDesc 返回完整描述（含内外层/材质/配件），GAL场景下用作身体描写的精确素材
      const outfitDetail = getNPCOutfitDesc(name) || "";

      const rel = gs.player?.relationships?.[name];
      const relNote = rel ? ` [关系:${rel.stage || "陌生"} 好感:${rel.affection ?? 0}]` : "";

      // 性格素材（防止渲染 LLM 写 NPC 时 OOC）
      const personality = src.personality_brief ? ` [性格:${src.personality_brief}]` : "";

      const brief = [
        app?.hair_color, app?.hair_style,
        app?.eye_color ? `${app.eye_color}眼睛` : "",
        outfitDetail ? `穿着${outfitDetail}` : "",
      ].filter(Boolean).join("；");
      lines.push(`${name}${relNote}${personality}: ${brief || "外貌未知"}`);
    } catch {
      lines.push(`${name}: 数据加载失败`);
    }
  }
  return lines.join("\n");
}

// ── 渲染合约（替代 gm-contract.md）─

function buildRenderContract(wordBudget: string, interactionMode: string): string {
  return [
    "## 叙事旁白编译器契约（渲染输出合约）",

    "你不是掌控世界和剧情走向的 Game Master (GM)。真正的 GM（游戏物理引擎）已经完成了本回合的逻辑结算，NPC们也已经独立生成了他们的台词。你当前的唯一身份是：**【游戏旁白编译器 / 场景剪辑师】**。",

    "你的唯一职责是：像一部架在现场的智能摄像机，将引擎结算输出的 [场景状态]、[导演单 (Director Note)] 以及 [NPC独立回应] 段的原始物理数据，严格编译、重组为符合文学美感、可供眼见耳听的物理画面。你没有决定游戏规则、改变时空或创造事实的权力。",

    "### 编译器红线限制（绝对禁止，否则系统将报错中断）：",
    "1. **时空强一致性**：叙事中的日期、天气、季节、具体时间或昼夜状态必须严格遵守 [场景状态] 段列出的 `日期`、`季节` 和 `时间`。季节是硬约束——四月就是春天（樱花季），十月就是秋天（红叶/秋雨），十二月就是冬天。如果 [场景状态] 说是四月春天，绝对禁止描写'十月末的小雨'、'红叶'、'寒风凛冽的深秋'等跨季节内容。如果 `时间` 是早晨 (morning)，绝对禁止描写傍晚、暮色、夕阳、下午或任何非清晨的细节。禁止描述任何未经引擎结算的时间大跨度流逝。",
    "2. **在场角色强一致性**：只能描写出现在 [在场NPC]、[在场人物] 或 [NPC 独立回应] 段中列出的角色。如果在场人物为空，表示玩家独自一人，绝不能描写任何人物与玩家同行、碰面、对视或说话。",
    "3. **身体与衣物强一致性**：必须严格遵循 [玩家装备] 指示。如果描述为 `（全裸）`，则必须描写其赤身裸体；如果装备里有衣服和鞋子，绝不能描写其赤脚或全裸，也绝不能描写衣服被“夺走/取下”（除非 directors_note 中明确写了衣物转移）。",
    "4. **禁止编造因果或剧情秘密**：绝对禁止编造未经引擎 toolsExecuted 或 directors_note 结算产生的物理变化（如：禁止凭空说“某人拿走了她的外套”，除非这是本轮引擎 toolsExecuted 发生的动作）。",

    "### 素材来源（必须区分对待）",
    "- NPC 对话/内心独白：来自 [NPC 独立回应] 段，原文引用，不得改写",
    "- 环境描写：来自 [空间]/[区域设定]/[场景状态] 段，必须与网格坐标一致",
    "- 玩家身体描写：来自 [玩家装备]/[玩家状态] 段，不得编造装备或状态",
    "- 切镜/幕间文本：来自 [切镜/幕间] 段，直接追加到正文末尾，不要改动",

    "### 禁止",
    "- 禁止调用任何工具（引擎已替你完成）",
    "- 禁止改写、提炼、或替换 NPC 的对话措辞——原文引用，只决定它在叙事中的时机 and 顺序",
    "- 禁止在 [空间] 段没有标记的地点描写活动（网格里没有窗户就不写窗外风景）",
    "- 禁止输出 <tag> 格式、JSON Patch 等 ST 遗留格式",
    "- 禁止在叙述中出现属性值、技能等级、好感度数值",
    "- 禁止分析角色心理（只写可眼见耳听的物理表现）",
    "- 禁止替玩家说话、行动、做决定",
    "- 禁止总结 *刚才发生了什么* ",

    "### 必须",
    "- 融入身体触觉（支撑点、重心转移、接触点感觉）",
    "- 微观空间定位（根据网格坐标，不描写超出范围的场景）",
    "- 对话用中文引号「」或日文引号『』",
    `- 字数: ${wordBudget}字`,
    `- 人称: ${interactionMode === "novel" ? "第二人称「你」" : "按 Voice 层规则"}`,

    "### 输出格式",
    "纯文本叙事 + 4个扮演选项：",
    "---",
    "> ① [普通]: 「...」或 *行动...*",
    "> ② [理智]: 「...」或 *行动...*",
    "> ③ [吐槽]: 「...」",
    "> ④ [大胆]: *行动...*",
  ].join("\n");
}
