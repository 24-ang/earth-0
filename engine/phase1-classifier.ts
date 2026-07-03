/**
 * engine/phase1-classifier.ts — Phase 1 意图分类器
 *
 * 小 LLM 将玩家输入映射为工具调用 JSON。
 * 引擎解析 JSON → 直接执行工具。
 * JSON parse 失败 → 回退引擎兜底（runSettlement + NPC spawn）。
 *
 * 和 pi agent loop 的关键区别：
 * - LLM 输出纯 JSON，不是 tool_use blocks
 * - LLM 物理上不能写叙事——输出被 parse，失败就扔
 * - 工具执行不经过 pi 的 tool loop
 */

import { generateCompletion } from "../tools/helpers.ts";

// ── 类型 ──

export interface ClassifiedAction {
  tool: string;
  params: Record<string, any>;
  confidence: number;
}

export interface ClassificationResult {
  actions: ClassifiedAction[];
  summary: string;
  ambiguous: boolean;
}

export interface Phase1Outcome {
  directorNote: string;
  toolsExecuted: string[];
  summary: string;
  /** true if classification succeeded and tools were executed */
  classified: boolean;
}

// ── A 类工具白名单（引擎通过分类 LLM 决定执行） ──

const ACTION_WHITELIST = [
  "travel",
  "buy_item",
  "sell_item",
  "intimate_touch",
  "interact_furniture",
  "world_interact",
  "steal_item",
  "combat_action",
  "use_item",
  "equip_item",
  "adjust_relation",
  "transfer_item",
  "spawn_item",
  "restock_shop",
  "identity_check",
  "inflict_damage",
  "mount_vehicle",
  "dismount_vehicle",
  "schedule_override",
  "table_crud",
  "add_memory_tag",
  "add_calendar_event",
];

// ── 公开 API ──

/** 执行 Phase 1 分类 → 工具执行 → 或回退兜底 */
export async function runPhase1(
  playerInput: string,
  ctx: any,
): Promise<Phase1Outcome> {
  const { gameState, saveState } = await import("./state.ts");

  // 1. 组装分类 prompt
  const prompt = buildClassificationPrompt(playerInput, gameState);

  // 2. 调 LLM 获取 JSON
  let result: ClassificationResult;
  try {
    const raw = await generateCompletion(prompt, 1024, ctx, undefined,
      "你是一个JSON分类器。你的唯一任务是输出合法JSON。不要输出任何其他文字、解释、markdown或叙事。如果无法确定意图，输出空actions数组。");
    result = parseClassificationOutput(raw);
  } catch (e) {
    // LLM JSON 分类失败（DS Chat 输出叙事而非 JSON）→ 关键词回落
    console.error("Phase1: classification LLM call or parse failed, trying keyword fallback:", (e as Error).message);
    return keywordFallback(playerInput, ctx);
  }

  // 3. 执行工具
  const toolsExecuted: string[] = [];
  const executedDetails: string[] = [];

  for (const action of result.actions) {
    if (action.confidence < 0.7) continue;
    if (!ACTION_WHITELIST.includes(action.tool)) {
      console.warn(`Phase1: tool "${action.tool}" not in whitelist, skipping`);
      continue;
    }
    try {
      const detail = await executeSingleTool(action.tool, action.params, ctx);
      if (detail) {
        toolsExecuted.push(action.tool);
        executedDetails.push(detail);
      }
    } catch (e) {
      console.error(`Phase1: execute "${action.tool}" failed:`, e);
    }
  }

  saveState();

  // 4. 产出 director_note
  const directorNote = buildDirectorNote(
    result.summary,
    toolsExecuted,
    executedDetails,
    gameState,
  );

  return {
    directorNote,
    toolsExecuted,
    summary: result.summary,
    classified: true,
  };
}

// ── 分类 prompt 组装 ──

export function buildClassificationPrompt(playerInput: string, gs: any): string {
  const npcsHere = getPresentNPCNames(gs);
  const npcList = npcsHere.length > 0 ? npcsHere.join("、") : "（无人）";

  // 收集场景可用的商店/设施
  const location = gs.player.location || "未知";
  const roomData = gs.rooms?.[location];
  const hasShop = roomData?.shop || gs.shops?.[location];
  const hasFurniture = roomData?.furniture && Object.keys(roomData.furniture).length > 0;
  const furnitureNames = hasFurniture ? Object.keys(roomData.furniture).join("、") : "";

  return [
    "你是意图分类器。将玩家输入映射为动作列表。只输出 JSON，不要解释。",

    `玩家输入: "${playerInput}"`,
    `当前位置: ${location}`,
    `在场 NPC: ${npcList}`,
    hasShop ? `注意: 此地点有商店，玩家可以买卖物品。` : "",
    hasFurniture ? `可交互家具: ${furnitureNames}` : "",

    "",
    "可用动作:",
    "- travel: 移动去另一个地点。param: destination(地点名)。玩家当前在别处要去某地时必须调",
    "- buy_item: 购买物品。param: item(物品名), price(日元)",
    "- sell_item: 出售物品。param: item(物品名)",
    "- intimate_touch: 亲密接触（仅sex模式）。param: part(身体部位), intensity(轻/中/重)",
    "- interact_furniture: 与家具交互（桌椅床柜等物理物件）。param: furniture(家具名), action(坐/躺/开/关/拿/放)",
    "- world_interact: 建造/放置/移除。param: action(place/build/remove/destroy), target(目标物)",
    "- steal_item: 偷窃。param: item(物品名), target_npc(目标NPC)",
    "- combat_action: 战斗。param: action(attack/defend/flee), target(目标)",
    "- use_item: 使用背包物品。param: item(物品名)",
    "- equip_item: 装备/卸下物品。有slot=装备到该槽位；无slot=卸下该物品放入背包。param: item(物品名), slot(可选)",
    "- adjust_relation: 好感增减。param: npc(NPC名), delta(数值)",
    "",

    "规则:",
    "1. 理解玩家真实意图，不要机械匹配关键词",
    "2. 玩家说了要去某地 → 加 travel",
    '3. "想去但放弃了的事" → 不做（例："想去便利店但太远了算了" → actions为空）',
    "4. 和NPC聊天/交谈 → 不需要工具（引擎会自动处理NPC对话）",
    "5. 不确定时不要输出。没有任何需要做的 → actions 为空数组",
    "6. 不要使用不在上面列表中的动作名",
    "",
    "输出纯 JSON（不要 markdown 代码块，不要其他文字）:",
    '{"actions": [{"tool": "...", "params": {...}, "confidence": 0.9}], "summary": "玩家意图的一句话"}',
  ].filter(Boolean).join("\n");
}

// ── JSON 解析 ──

function parseClassificationOutput(raw: string): ClassificationResult {
  // 去除 markdown 代码块
  let text = raw.trim();
  if (text.startsWith("```")) {
    const end = text.lastIndexOf("```");
    text = text.slice(text.indexOf("\n") + 1, end > 0 ? end : text.length).trim();
  }

  try {
    const obj = JSON.parse(text);
    return {
      actions: Array.isArray(obj.actions) ? obj.actions : [],
      summary: typeof obj.summary === "string" ? obj.summary : "玩家进行了操作",
      ambiguous: obj.ambiguous === true,
    };
  } catch {
    // 尝试用正则提取 JSON 对象
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      return {
        actions: Array.isArray(obj.actions) ? obj.actions : [],
        summary: typeof obj.summary === "string" ? obj.summary : "玩家进行了操作",
        ambiguous: obj.ambiguous === true,
      };
    }
    throw new Error("Failed to parse classification JSON");
  }
}

// ── 工具执行 ──

async function executeSingleTool(
  toolName: string,
  params: Record<string, any>,
  ctx: any,
): Promise<string | null> {
  const { pushToolCall } = await import("./state.ts");

  // 懒加载工具模块
  const tool = await loadTool(toolName);
  if (!tool) {
    console.warn(`Phase1: unknown tool "${toolName}"`);
    return null;
  }

  const dummySignal = { aborted: false };
  const dummyOnUpdate = () => {};

  const result = await tool.execute(
    `phase1_${toolName}`,
    params,
    dummySignal,
    dummyOnUpdate,
    ctx,
  );

  pushToolCall(toolName);

  // 提取文本描述
  if (result?.content) {
    const texts = result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
    return texts || `${toolName}: 已执行`;
  }
  return `${toolName}: 已执行`;
}

// ── 工具懒加载 ──

const toolCache: Record<string, any> = {};

async function loadTool(toolName: string): Promise<any | null> {
  if (toolCache[toolName]) return toolCache[toolName];

  const toolPaths: Record<string, string> = {
    travel: "../tools/lookup/travel.ts",
    buy_item: "../tools/action/buy_item.ts",
    sell_item: "../tools/action/sell_item.ts",
    intimate_touch: "../tools/action/sex_touch.ts",
    interact_furniture: "../tools/action/interact_furniture.ts",
    world_interact: "../tools/action/world_interact.ts",
    steal_item: "../tools/action/steal_item.ts",
    combat_action: "../tools/action/combat_action.ts",
    use_item: "../tools/action/use_item.ts",
    equip_item: "../tools/action/equip_item.ts",
    adjust_relation: "../tools/state/adjust_relation.ts",
    transfer_item: "../tools/action/transfer_item.ts",
    spawn_item: "../tools/action/spawn_item.ts",
    restock_shop: "../tools/action/restock_shop.ts",
    identity_check: "../tools/action/identity_check.ts",
    inflict_damage: "../tools/action/inflict_damage.ts",
    mount_vehicle: "../tools/action/mount_vehicle.ts",
    dismount_vehicle: "../tools/action/dismount_vehicle.ts",
    schedule_override: "../tools/action/schedule_override.ts",
    table_crud: "../tools/action/table_crud.ts",
    add_memory_tag: "../tools/state/add_memory_tag.ts",
    add_calendar_event: "../tools/action/add_calendar_event.ts",
  };

  const relPath = toolPaths[toolName];
  if (!relPath) return null;

  try {
    // sex_touch / intimate_touch 始终走 import（ESM 兼容）
    if (toolName === "intimate_touch") {
      const mod = await import("../tools/action/sex_touch.ts");
      toolCache[toolName] = mod.default;
    } else {
      toolCache[toolName] = (await import(relPath)).default;
    }
    return toolCache[toolName];
  } catch (e) {
    console.error(`Phase1: failed to load tool "${toolName}" from ${relPath}:`, e);
    return null;
  }
}

// ── director_note 组装 ──

function buildDirectorNote(
  summary: string,
  toolsExecuted: string[],
  details: string[],
  gs: any,
): string {
  const lines = [
    `<directors_note>`,
    `  <player_action>${summary}</player_action>`,
    `  <resolved_changes>${toolsExecuted.length > 0 ? details.join("; ") : "无"}</resolved_changes>`,
    `  <tools_called>${toolsExecuted.length > 0 ? toolsExecuted.join(", ") : "无"}</tools_called>`,
    `  <scene_result>玩家在${gs.player.location || "未知地点"}，turn ${gs.turn}</scene_result>`,
    `</directors_note>`,
  ];
  return lines.join("\n");
}

// ── 关键词回落 ──

export async function keywordFallback(playerInput: string, ctx: any): Promise<Phase1Outcome> {
  const { gameState, saveState } = await import("./state.ts");
  const { runSettlement } = await import("./settlement.ts");

  const actions: ClassifiedAction[] = [];
  const text = playerInput;

  // 否定检测：如果关键词前后有否定词，跳过
  const isNegated = (keyword: string): boolean => {
    const idx = text.indexOf(keyword);
    if (idx === -1) return true; // 没找到就算否定
    // 检查关键词前后 15 字范围内有无否定/放弃词
    const before = text.slice(Math.max(0, idx - 15), idx);
    const endIdx = idx + keyword.length;
    const after = text.slice(endIdx, Math.min(text.length, endIdx + 15));
    return /不|没|算了|太远|放弃了|不去了|还是算|下次|改天/.test(before + after);
  };

  // 移动检测 — 支持多目的地（不用 break）
  const hasMoveIntent = /去|走|到|前往|出发|回家|回/.test(text);
  if (hasMoveIntent) {
    const locKeywords: [RegExp, string][] = [
      [/学校|总武/, "千叶市立总武高等学校"],
      [/侍奉部|活动室|奉仕部/, "侍奉部"],
      [/便利|711|罗森/, "便利店"],
      [/车站|駅/, "千叶站"],
      [/海|公园/, "稻毛海滨公园"],
      [/商店街/, "千叶中央商店街"],
      [/教室/, "2年F班"],
    ];
    for (const [re, loc] of locKeywords) {
      const matched = text.match(re);
      if (matched && !isNegated(matched[0])) {
        actions.push({ tool: "travel", params: { destination: loc }, confidence: 0.85 });
      }
    }
  }

  // 购买检测
  if (/买|购买|付钱/.test(text) && !isNegated("买") && !isNegated("购买")) {
    const itemMatch = text.match(/买[一|两|三|几]?(?:瓶|盒|份|个|本)?(.{1,6})/);
    const item = itemMatch?.[1]?.trim() || "饮料";
    actions.push({ tool: "buy_item", params: { item, price: 100 }, confidence: 0.75 });
  }

  await runSettlement({ elapsed_minutes: 5, ctx });
  saveState();

  // 执行关键词动作
  const toolsExecuted: string[] = [];
  const details: string[] = [];
  for (const action of actions) {
    if (!ACTION_WHITELIST.includes(action.tool)) continue;
    try {
      const detail = await executeSingleTool(action.tool, action.params, ctx);
      if (detail) { toolsExecuted.push(action.tool); details.push(detail); }
    } catch (e) { console.error(`keywordFallback: ${action.tool} failed:`, e); }
  }
  saveState();

  return {
    directorNote: buildDirectorNote(text, toolsExecuted, details, gameState),
    toolsExecuted,
    summary: text,
    classified: false,
  };
}

// ── 引擎兜底 ──

async function engineFallback(ctx: any): Promise<Phase1Outcome> {
  const { gameState, saveState } = await import("./state.ts");
  const { runSettlement } = await import("./settlement.ts");

  try {
    await runSettlement({
      elapsed_minutes: 5,
      _autoSettled: true,
      ctx,
    });
  } catch (e) {
    console.error("Phase1 fallback: runSettlement failed:", e);
  }

  saveState();

  return {
    directorNote: `<directors_note>
  <player_action>玩家进行了操作（引擎自动结算）</player_action>
  <resolved_changes>时间推进5分钟，turn ${gameState.turn}</resolved_changes>
  <scene_result>玩家在${gameState.player.location || "未知地点"}</scene_result>
</directors_note>`,
    toolsExecuted: ["settle_scene"],
    summary: "引擎自动结算",
    classified: false,
  };
}

// ── 辅助 ──

function getPresentNPCNames(gs: any): string[] {
  if (!gs.npcs) return [];
  const loc = gs.player?.location;
  if (!loc) return [];
  // 简单字符串匹配：Phase 1 分类器的 NPC 在场提示不需要精确到子房间
  return Object.entries(gs.npcs)
    .filter(([_, npc]: [string, any]) => {
      if (npc.alive === false) return false;
      // isSameLocation 语义：支持层级位置匹配
      return npc.currentRoom === loc || npc.currentRoom?.startsWith(loc + ",") || loc.startsWith(npc.currentRoom + ",");
    })
    .map(([name]) => name);
}
