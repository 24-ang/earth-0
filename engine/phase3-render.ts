/**
 * engine/phase3-render.ts — Phase 3 渲染 prompt 组装
 *
 * 和原来 buildSystemPrompt 的区别：
 * - 不含 gm-rules.md（工具纪律规则）
 * - 不含 gm-contract.md（三段式合约——引擎强制执行，LLM 不需要知道）
 * - 不含工具提示
 * - 新增 director_note（Phase 1 产出）和 NPC 回应（Phase 2 产出）
 * - 指令改为"直接写叙事，不要调工具"
 *
 * 参考文献：PHILOSOPHY §1.3, fate-sandbox two-pass-render
 */

// ── 公开 API ──

export interface RenderContext {
  directorNote: string;
  npcResponses: string;
  summary: string;
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

  // 在场 NPC 的外观描述（渲染需要但不需要全量状态）
  const npcAppearances = await buildNpcAppearanceBlock(gameState);

  // 场景状态简报（精简版，只含渲染需要的信息）
  const sceneBrief = buildSceneBrief(gameState);

  const parts = [
    read("gm-pre.md"),

    sceneBrief,

    npcAppearances,

    // 导演单 + NPC 回应
    renderCtx.directorNote,
    renderCtx.npcResponses
      ? `\n[NPC 独立回应 — 将这些回应织入你的叙事，让每个NPC用自己的语气说话]\n${renderCtx.npcResponses}\n`
      : "",

    // Voice + Mode
    read(voiceFile),
    read(modeFile),

    // 渲染指令（替代 gm-contract.md）
    buildRenderContract(wordBudget, interactionMode),
  ];

  return parts.filter(Boolean).join("\n\n---\n\n");
}

// ── 场景简报（精简版） ──

function buildSceneBrief(gs: any): string {
  const lines: string[] = [];

  lines.push(`[场景状态]`);
  lines.push(`日期: ${gs.time?.game_date || "未知"} ${gs.time?.day_of_week || ""}`);
  lines.push(`时间: ${gs.time?.game_time || "未知"}`);
  lines.push(`地点: ${gs.player?.location || "未知"}`);
  lines.push(`天气: ${gs.weather?.type || "晴"} ${gs.weather?.temp ?? "?"}°C`);

  if (gs.interactionMode === "novel") {
    lines.push(`模式: 小说式记叙（无在场NPC，聚焦环境与内心）`);
  } else {
    lines.push(`模式: 回合制对话`);
  }

  // 空间信息
  const room = gs.rooms?.[gs.player?.location];
  if (room) {
    if (room.description) lines.push(`空间: ${room.description}`);
    if (room.grid_width && room.grid_height) {
      const pos = gs.player?.position;
      lines.push(`网格: ${room.grid_width}x${room.grid_height}${pos ? `，玩家在(${pos.x},${pos.y})` : ""}`);
    }
  }

  return lines.join("\n");
}

// ── NPC 外观块 ──

async function buildNpcAppearanceBlock(gs: any): Promise<string> {
  const loc = gs.player?.location;
  if (!loc || !gs.npcs) return "";

  const present = Object.entries(gs.npcs)
    .filter(([_, npc]: [string, any]) => npc.currentRoom === loc && npc.alive !== false)
    .map(([name]) => name);

  if (present.length === 0) return "";

  const { findCharacter, getAppearanceForAge, getNpcCurrentAge, getNPCOutfitDesc } =
    await import("./state.ts");

  const lines: string[] = ["[在场人物]"];
  for (const name of present) {
    try {
      const src = findCharacter(name);
      if (!src) { lines.push(`${name}: 未知`); continue; }
      const age = getNpcCurrentAge(src.base_age || 16);
      const app = getAppearanceForAge(src, age);
      const outfit = getNPCOutfitDesc(name);
      const brief = [
        app?.hair_color, app?.hair_style,
        app?.eye_color ? `${app.eye_color}眼睛` : "",
        outfit ? `穿着${outfit}` : "",
      ].filter(Boolean).join("，");
      lines.push(`${name}: ${brief || "外貌未知"}`);
    } catch {
      lines.push(`${name}: 数据加载失败`);
    }
  }
  return lines.join("\n");
}

// ── 渲染合约（替代 gm-contract.md）─

function buildRenderContract(wordBudget: string, interactionMode: string): string {
  return [
    "## 渲染输出合约",

    "你是渲染主笔。引擎已完成所有结算和工具操作。你唯一任务是写出面向玩家的叙事正文。",

    "### 禁止",
    "- 禁止调用任何工具（引擎已替你完成）",
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
