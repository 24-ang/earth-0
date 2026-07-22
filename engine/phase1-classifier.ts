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

export interface SceneFooterText {
  posture: string;        // 玩家当前姿态/触觉体验，如"坐在靠窗第三排的椅子上"
  location_detail: string; // 具象位置，如"千葉-出云殖民卫星-Side6-総武高校-2年F组教室"
  main_quest: string;      // 主线任务进度，如"SSS-找到返回原来世界的方法"
}

export interface Phase1Outcome {
  directorNote: string;
  toolsExecuted: string[];
  summary: string;
  /** true if classification succeeded and tools were executed */
  classified: boolean;
  sceneFooter?: SceneFooterText;
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
  "spawn_temp_npc",
  "table_crud",
  "add_memory_tag",
  "add_calendar_event",
  "replay_pov",
  "create_organization",
  "lookup_org",
  "contribute_to_org",
  "join_org",
  "leave_org",
  "promote_member",
  "org_action",
  "adjust_org_relation",
];

// ── 公开 API ──

/** 执行 Phase 1 分类 → 工具执行 → 或回退兜底
 *  @param startup turn 0 时为 true，允许初始化工具（init_game/init_profile/grant_skill_exp/set_flags/instantiate_residence）*/
export async function runPhase1(
  playerInput: string,
  ctx: any,
  startup = false,
): Promise<Phase1Outcome> {
  const { gameState, saveState } = await import("./state.ts");

  // 1. 组装分类 prompt
  const prompt = buildClassificationPrompt(playerInput, gameState, startup);

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
  const allowedTools = startup
    ? [...ACTION_WHITELIST, "init_game", "init_profile", "grant_skill_exp", "set_flags", "instantiate_residence", "settle_scene", "create_location", "create_room", "world_interact", "add_memory_tag", "create_character", "set_npc_relation", "open_quest", "create_story_hook", "add_calendar_event"]
    : [...ACTION_WHITELIST, "init_game"]; // 非 startup 也允许 init_game——否则有存档时无法开新档

  // 防刷屏：action 数上限 + 批量无效时直接回退
  const actions = result.actions.slice(0, 12);
  if (actions.length === 0) return keywordFallback(playerInput, ctx);

  const validCount = actions.filter(a => a.confidence >= 0.7 && typeof a.tool === "string" && a.tool && allowedTools.includes(a.tool)).length;
  // 超过半数无效 → 分类器在叙事而非分类，直接回退
  if (validCount === 0 || (actions.length >= 6 && validCount < actions.length * 0.3)) {
    return keywordFallback(playerInput, ctx);
  }

  for (const action of actions) {
    if (action.confidence < 0.7) continue;
    if (typeof action.tool !== "string" || !action.tool) continue;
    if (!allowedTools.includes(action.tool)) continue;
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

  // 5. 存场景页脚供 widget 显示
  gameState._sceneFooter = result.sceneFooter || null;

  return {
    directorNote,
    toolsExecuted,
    summary: result.summary,
    classified: true,
    sceneFooter: result.sceneFooter,
  };
}

// ── Phase 1.6: 玩家选项生成（引擎侧，settlement 后调用）──

export interface PlayerOption {
  text: string;
  tag?: string;
  category?: "普通" | "对话" | "行动" | "互动" | "移动" | "观察" | "特殊";
}

export async function generatePlayerOptions(ctx: any): Promise<PlayerOption[]> {
  const { gameState } = await import("./state.ts");
  const gs = gameState;
  const p = gs.player;
  if (!p) return [];

  const mode = gs.mode || "rpg";
  const loc = p.location || "???";
  const npcsHere = getPresentNPCNames(gs);
  const nearby = npcsHere.length;
  const hasTarget = nearby > 0;

  // Build context blocks per mode
  const blocks: string[] = [
    `模式: ${mode}`,
    `位置: ${loc}`,
    `在场NPC(${nearby}): ${npcsHere.length > 0 ? npcsHere.join("、") : "无人"}`,
  ];

  // NPC summaries (affections, stages)
  if (hasTarget) {
    const summaries: string[] = [];
    for (const [n, npc] of Object.entries(gs.npcs || {})) {
      if (!(npc as any).alive) continue;
      try {
        const { isSameLocation } = await import("./state.ts");
        if (!isSameLocation((npc as any).currentRoom, loc)) continue;
        const aff = p.relationships?.[n]?.affection ?? 0;
        const stage = p.relationships?.[n]?.stage || "陌生";
        const romance = p.relationships?.[n]?.romance || "";
        const label = romance === "恋人" ? "恋人" : stage;
        summaries.push(`${n}:${label}:${aff}`);
      } catch {}
    }
    if (summaries.length) blocks.push(`NPC关系: ${summaries.join(" | ")}`);
  }

  // Mode-specific context
  if (mode === "sex" && p.sex) {
    const sx = p.sex;
    blocks.push(`性状态: 兴奋${sx.arousal||0}/100 欲望${sx.desire||0}/100 高潮${sx.climaxCount||0}次`);
    if (sx.cyclePhase) blocks.push(`周期: ${sx.cyclePhase}·第${sx.cycleDay||0}天`);
  }

  // What just happened
  const summary = (gs as any)._phase1Summary || "";
  if (summary) blocks.push(`上一轮: ${summary}`);

  const prompt = [
    "你是游戏选项生成器。根据玩家当前场景自动生成4-6个可选的【扮演选项】或【行动选项】。输出纯JSON数组。",
    "",
    "## 当前状态",
    ...blocks.map(b => `- ${b}`),
    "",
    "## 生成规则",
    hasTarget && mode !== "sex"
      ? `有NPC在场。选项应混合对话和行动。每项包含text和可选的tag(普通/理智/吐槽/大胆/观察/互动/移动)。至少2个对话向、1个行动向。`
      : mode === "sex"
      ? `sex模式。选项应覆盖爱抚/亲吻/进入/挑逗/结束等sex动作。tag用相关动词。`
      : `无人。选项应是场景探索向——观察周围、移动到某处、休息、使用物品等。`,
    "",
    "## 禁止",
    "- 不要生成玩家不会做的选项（比如玩家是男高中生就不要生成'提裙行礼'）",
    "- 不要生成需要不存在物品的选项",
    hasTarget ? "" : "- 有NPC在场时不要生成对话选项——那是搭话后的内容",
    "",
    "## 输出格式",
    `[{"text":"选项文本","tag":"标签"},...]`,
    "",
    "直接输出JSON数组，不要任何解释。",
  ].filter(Boolean).join("\n");

  try {
    const raw = await generateCompletion(prompt, 512, ctx, undefined,
      "你是选项生成器。只输出JSON数组。");
    const json = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const opts: PlayerOption[] = JSON.parse(json);
    return Array.isArray(opts) ? opts.slice(0, 9) : [];
  } catch (e) {
    console.error("generatePlayerOptions: parse failed", (e as Error).message);
    return [];
  }
}

// ── 分类 prompt 组装 ──

export function buildClassificationPrompt(playerInput: string, gs: any, startup = false): string {
  const npcsHere = getPresentNPCNames(gs);
  const npcList = npcsHere.length > 0 ? npcsHere.join("、") : "（无人）";

  // 收集场景可用的商店/设施
  const location = gs.player.location || "未知";
  const roomData = gs.rooms?.[location];
  const hasShop = roomData?.shop || gs.shops?.[location];

  // 从网格格子里扫家具名（家具嵌在 cells[y][x].furniture，不在 roomData.furniture 顶层）
  let furnitureNames = "";
  if (roomData?.cells) {
    const names = new Set<string>();
    for (const row of roomData.cells) {
      if (!row) continue;
      for (const cell of row) {
        if (cell?.furniture) names.add(cell.furniture);
      }
    }
    furnitureNames = Array.from(names).join("、");
  }
  const hasFurniture = furnitureNames.length > 0;

  if (startup) {
    return buildStartupPrompt(playerInput);
  }

  // ── 学校课时标签（极简——只告诉 GM 现在是上课/课间/午休/放学）──
  let schoolLabel = "";
  if (location.includes("教室") || location.includes("体育") || location.includes("プール") ||
      (location.includes("校") && !location.includes("警察") && !location.includes("校正"))) {
    try {
      const { getCurrentPeriod } = require("./time.ts");
      const pi = getCurrentPeriod(gs.time.minute_of_day, gs.time.day_of_week);
      if (pi.phase === "授業中" && pi.period) {
        schoolLabel = `[学校] 授業中(${pi.period}限) | あと${pi.minutesUntilNext}分でチャイム`;
      } else if (pi.phase === "休み時間") {
        schoolLabel = `[学校] 休み時間 | あと${pi.minutesUntilNext}分で${pi.period ?? (gs.time.minute_of_day < 12 * 60 + 30 ? "次限" : "昼休み")}開始`;
      } else if (pi.phase === "昼休み") {
        schoolLabel = `[学校] 昼休み | あと${pi.minutesUntilNext}分`;
      } else if (pi.phase === "课前") {
        schoolLabel = `[学校] 朝·HR前 | あと${pi.minutesUntilNext}分`;
      } else if (pi.phase === "放課後") {
        schoolLabel = `[学校] 放課後`;
      }
    } catch (_e2) { /* ignore */ }
  }

  return [
    "你是意图分类器 + 场景导演。只输出 JSON，不要解释。",

    `玩家输入: "${playerInput}"`,
    `当前位置: ${location}`,
    `在场 NPC: ${npcList}`,
    schoolLabel,
    hasShop ? `注意: 此地点有商店，玩家可以买卖物品。` : "",
    hasFurniture ? `可交互家具: ${furnitureNames}` : "",

    "",
    "场景导演规则（第0优先级）:",
    "  走进任何空间时，先想——这个时间·这个地点·应该有什么人？",
    "  教室上课→同学+老师。午休→散步的学生。商店街→店员+顾客。车站→乘客。",
    "  教室人数参考：普通班~28人、特進班~30人、国際教養班~25人。spawn 3-5个有名字的群演即可，",
    "  其余学生作为'背景中的其他同学'存在于叙事中——不需要每人一个 spawn。",
    "  用 spawn_temp_npc 逐个创建群演（3-5个足够）。不要让世界空的。",
    "",
    "工具分类（不复制参数细节——参数在工具自身定义里）:",
    "  🚶 移动: travel",
    "  👥 群演: spawn_temp_npc",
    "  🏠 场景: world_interact（建造/放置/移除）, interact_furniture（与家具互动）",
    "  💬 关系: adjust_relation, transfer_item",
    "  🛒 经济: buy_item, sell_item, spawn_item, restock_shop",
    "  ⚔️ 冲突: combat_action, steal_item, intimate_touch, inflict_damage, identity_check",
    "  🎒 物品: use_item, equip_item",
    "  🚗 载具: mount_vehicle, dismount_vehicle",
    "  📖 自习: study（指定科目+小时数，自动检定+推进时间）",
"  📋 管理: schedule_override, table_crud, add_memory_tag, add_calendar_event",
    "  🏛️ 组织/势力: create_organization（动态创建社团/帮派/圈子——引擎数据驱动）, lookup_org（查势力详情，声望决定可见度）, contribute_to_org（向势力捐款/完成任务/背叛/招募成员）",
    "  🏗️ 地点: create_location（创建新地点并注入skybox属性——繁荣度/稳定度/体制/经济类型/外交立场）",
    "  🆕 新游戏: init_game（仅当玩家明确说「新游戏」「重新开始」——「我是XX」不是新游戏）",
    "  🎬 镜头: create_story_hook（剧情钩子,可带intermission幕间）, replay_pov（同场复述——某句关键台词值得慢镜头重放）",
    "",
    "幕间使用指引（引擎自动消费，你只管建钩子时带上intermission）:",
    "  - 主角干了影响辐射到当前圈子以外的事 → create_story_hook + intermission 切到相关方反应",
    "  - 任务/事件即将收尾 → create_story_hook + intermission 预设结算后的回望视角",
    "  - 某NPC的发言信息密度极高（告白/拒绝/说漏嘴/试探失败）→ replay_pov 标记该NPC",
    "  - 玩家设定了一个大事件背景（灾难/战争/全球事件）→ create_story_hook链 + intermission 从权威/组织视角展现事件规模",
    "  - 日常闲聊、普通互动、信息量低的对话 → 不需要镜头工具",
    "",
    "学校场景指引（玩家身份为学生、位置在总武高时自然适用——不需要检查flag，看位置即可）:",
    "  📖 上课时间：可以调用 create_story_hook 生成课堂mini事件——被点名、小组讨论、临时小测验、",
    "    走神注意到窗外的事。不要每次上课都生成——只在玩家输入暗示'好无聊'或有社交机会时生成1个。",
    "  📝 考试周（日历 advance_hook 提示考试临近时）：可以生成复习/补习钩子——",
    "    找NPC一起复习、被老师叫去补课、在图书馆占座。每个考试周最多1-2个钩子，不要更多。",
    "  🌙 放学后：如果玩家在图书室/教室/部室，可以生成自习钩子——",
    "    偶遇也在自习的NPC、被前辈塞参考书、发现书架上有趣的旧书。",
    "  🤝 NPC补习：如果玩家和成绩好的NPC（雪乃/桐须真冬/大森/御堂等）已有互动基础",
    "    +考试临近→可以生成该NPC主动说出'要不要一起复习'的钩子。",
    "  🚫 不要做的事：不要替玩家选文理/选课/填志愿——只提供场景，不等回应绝不自行推进。",
    "    不要逢上课就扔钩子——玩家可能只想说'我去上课'然后就推进时间。",
    "  🎒 自习动作：如果玩家说'复习/自习/看书'，用 study 工具——它会自动检定、推进时间、设flag。",
    "",
    "分类规则:",
    "  1. 理解玩家真实意图，不要机械匹配关键词",
    "  2. 玩家说了要去某地 → travel",
    "  3. 想去但放弃了的事 → 不做（例：想去便利店但太远了算了 → actions为空）",
    "  4. 和NPC聊天/交谈 → 不需要工具（引擎自动处理NPC对话）",
    "  5. 不确定 → actions 为空数组",
    "  6. 不要使用上面没列出的工具名",
    "",
    "输出纯 JSON（不要 markdown 代码块，不要其他文字）:",
    '{"actions": [...], "summary": "...", "scene_footer": {"posture": "坐在靠窗的椅子上", "location_detail": "千葉-総武高校-教室", "main_quest": "暂无"}}',
    "",
    "scene_footer 每回合更新。三条都 ≤20字、文学质感:",
    "  posture        = **玩家**当前姿态+感官细节(温度/触觉)。不要把NPC的状态写在这里",
    "  location_detail = 从给定的玩家「当前位置」展开(一层层往下)，不是NPC或其他人的位置",
    "  main_quest      = 难度:任务名。难度 SSS~E，无主线填「暂无」。",
  ].filter(Boolean).join("\n");
}

// ── 开局导演 prompt（独立函数，与意图分类语义分离）──

export function buildStartupPrompt(playerInput: string): string {
  return [
    "你是开局导演。读完玩家的描述，想象这个角色睁开眼看到的第一个画面——然后让他真的能站在那里。只输出 JSON。",

    `玩家描述: "${playerInput}"`,

    "",
    "init_game(name, gender, age, location?) 第一步。之后逐个思考:",

    "",
    "1. 穿什么？init_game 只给了内衣。",
    "   有匹配模板就 init_profile，全套解决。",
    "   没匹配就 spawn_item 给衣服+鞋+随身物。",
    "   手机 init_game 已经给了。不需要再给——除非身份不该有手机（古代人/野兽），那就别 spawn_item。",

    "",
    "2. 会什么？",
    "   init_profile 自带技能。没模板就 grant_skill_exp 按身份给 2-4 项，等级 1-5。",
    "   不是什么都要等级 5——高中生棒球 Lv1 够了，职业杀手暗杀才 Lv5。",

    "",
    "3. 住哪？在哪？",
    "   instantiate_residence 自动建房+放家具，一步搞定。模板只有 独栋_2F_4人家庭 / 公寓_3F_单身。",
    "   房子不在千叶也没关系——引擎会自动把出口连到你的 location。",
    "",
    "   如果角色不住标准日式住宅（外星飞船/白宫/安全屋/古堡）——即模板不匹配时：",
    "     ① lookup_furniture 查有哪些可用模板和家具",
    "     ② 有近似模板 → create_room(template, furniture=[调整后列表], atmosphere=[按剧情重写])",
    "          ⚠️ 模板只是起点！按角色性格/场景气氛调整 furniture 和 atmosphere",
    "          两个 NPC 的卧室不该完全一样——一个可能堆满手办，另一个干净到没有一点尘",
    "     ③ 无任何模板匹配 → create_room(width, height, furniture=[自己选], atmosphere=[自写])",
    "         先用 lookup_furniture(search='关键词') 确认每件家具在目录中存在",
    "         目录中完全没有的家具名也能用——引擎会自动兜底，只是没有专属交互",
    "     ④ furniture 直接传给 create_room，一行搞定。不再需要逐件 world_interact place",

    "",
    "4. 认识谁？手机里有谁？",
    "   通讯录不是引擎自动填的。create_character 创建 + adjust_relation 设关系 = 自动进手机通讯录。",
    "   用 notes 写清关系（父亲/母亲/恋人/搭档）。引擎读到 notes 就同步联系人标签。",
    "   正常人→至少父母。孤儿→跳过。外星人→队友或跳过。杀手→中间人/雇主。",
    "   玩家说「我是XX的弟弟」→ create_character XX + adjust_relation(70, notes:\"姐姐\")。",

    "",
    "5. 身份标记？记忆？",
    "   set_flags 打标签。不只是 {student:true}——外星人需要 {alien:true, extraterrestrial:true}，",
    "   杀手需要 {assassin:true, criminal:true}，总统需要 {us_president:true, world_leader:true}。",
    "   add_memory_tag 写入生节点——入学/觉醒/第一次任务/离开母星。",

    "",
    "6. 开局势能？玩家睁开眼第一件事做什么？",
    "   create_story_hook — 催促行动的钩子。转校生→「开学典礼在礼堂举行」。",
    "   外星人→「母星发来紧急通讯：能量核心泄漏」。总统→「幕僚长敲门：紧急会议」。",
    "   引擎自动注入 active_hooks，开局势能拉满。open_quest 等玩家接受后再用，不要同时调。",
    "",
    "   如果玩家设定了一个大事件背景（灾难/战争/怪兽/全球疫情）:",
    "     create_story_hook 挂 intermission 参数——切到权威/组织视角展现事件规模。",
    "     NOAA局长/气象厅/军方发言人/WHO——这些人不需要角色卡，一个名字+机构名+一句话反应就能构建世界真实感。",
    "     建 2-4 条钩子 → open_quest → advance_quest 走完 → 幕间自动发射，冷却后玩家看到连续的侧面烘托。",
    "     这不是序章专有——后续任何时候主角的行为影响到当前圈子以外的人，都可以用同一技法。",

    "",
    "最后 settle_scene(summary, elapsed_minutes:0)。",

    "",
    "可用工具: init_game init_profile grant_skill_exp set_flags spawn_item",
    "  instantiate_residence create_location create_room world_interact",
    "  create_character adjust_relation set_npc_relation add_memory_tag",
    "  open_quest create_story_hook add_calendar_event settle_scene",

    "",
    "默认: 名→维, 性别→男, 年龄→16。按年龄匹配模板。模板是快捷键，不匹配就自己当导演。",

    "",
    "输出 JSON 里必须带 scene_footer（开局的第一印象）:",
    '{"actions": [...], "summary": "...", "scene_footer": {"posture": "站在校门口的樱花树下", "location_detail": "千葉-総武高校-正門前", "main_quest": "暂无"}}',
    "scene_footer 三条 ≤20字: posture=当前姿态+感官细节, location_detail=地区-城市-具体位置, main_quest=难度:任务名（无主线填「暂无」）",
  ].join("\n");
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
    let sceneFooter: SceneFooterText | undefined = undefined;
    if (obj.scene_footer && typeof obj.scene_footer === "object") {
      sceneFooter = {
        posture: typeof obj.scene_footer.posture === "string" ? obj.scene_footer.posture : "",
        location_detail: typeof obj.scene_footer.location_detail === "string" ? obj.scene_footer.location_detail : "",
        main_quest: typeof obj.scene_footer.main_quest === "string" ? obj.scene_footer.main_quest : "",
      };
      // 三项任意为空则整体降级到 engine fallback
      if (!sceneFooter.posture || !sceneFooter.location_detail || !sceneFooter.main_quest) sceneFooter = undefined;
    }
    return {
      actions: Array.isArray(obj.actions) ? obj.actions : [],
      summary: typeof obj.summary === "string" ? obj.summary : "玩家进行了操作",
      ambiguous: obj.ambiguous === true,
      sceneFooter,
    };
  } catch {
    // 尝试用正则提取 JSON 对象
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      return { actions: Array.isArray(obj.actions) ? obj.actions : [], summary: typeof obj.summary === "string" ? obj.summary : "玩家进行了操作", ambiguous: obj.ambiguous === true };
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
    spawn_temp_npc: "../tools/action/spawn_temp_npc.ts",
    table_crud: "../tools/action/table_crud.ts",
    add_memory_tag: "../tools/state/add_memory_tag.ts",
    add_calendar_event: "../tools/action/add_calendar_event.ts",
    contribute_to_org: "../tools/action/contribute_to_org.ts",
    join_org: "../tools/action/join_org.ts",
    leave_org: "../tools/action/leave_org.ts",
    promote_member: "../tools/action/promote_member.ts",
    org_action: "../tools/action/org_action.ts",
    adjust_org_relation: "../tools/action/adjust_org_relation.ts",
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

  // ── 新游戏关键词（分类 LLM 失败时兜底——防 GM 不调 init_game）──
  const isStartup = gameState._newGame === true;
  if (isStartup) {
    // 尝试从玩家输入提取姓名/性别/年龄
    const nameMatch = text.match(/叫[做]?(.{1,6})[，,]|名字[是叫]?(.{1,6})[，,]|我是(.{1,6})[，,]/);
    const rawName = nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || "";
    const name = rawName.replace(/[一一个]|[男女]|[岁年紀]|\d+/g, "").trim() || "未命名";
    const gender = /女|妹|姐|娘|她/.test(text) ? "女" : "男";
    const ageMatch = text.match(/(\d{1,2})\s*[岁年紀]/);
    const age = ageMatch ? parseInt(ageMatch[1]) : 16;
    const yearMatch = text.match(/(\d{4})\s*年/);
    const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

    actions.push({
      tool: "init_game",
      params: { name, gender, age, ...(year ? { year } : {}) },
      confidence: 0.9,
    });

    // 身份模板检测
    if (/高中|学生|总武|校服/.test(text)) {
      actions.push({ tool: "init_profile", params: { profileId: "千叶市高中生" }, confidence: 0.85 });
    } else if (/小学|儿童|小[一二三四五六]|低年级/.test(text) || age <= 12) {
      actions.push({ tool: "init_profile", params: { profileId: "千叶市小学生" }, confidence: 0.85 });
    } else if (/上班|社畜|白领|OL|职员/.test(text)) {
      actions.push({ tool: "init_profile", params: { profileId: "千叶市上班族" }, confidence: 0.85 });
    } else if (/外星|宇宙|星球|飞船|异星/.test(text)) {
      actions.push({ tool: "init_profile", params: { profileId: "外星人访客" }, confidence: 0.8 });
    }

    // 身份关键词 → set_flags
    if (/外星/.test(text)) {
      actions.push({ tool: "set_flags", params: { flags: { alien: true, extraterrestrial: true } }, confidence: 0.85 });
    }

    // 身份关键词没有匹配到模板 → 尝试直接按照玩家描述给技能+flags
    const hasProfile = actions.some(a => a.tool === "init_profile");
    if (!hasProfile) {
      // 尝试匹配已知标签
      const tagMap: Record<string, string[]> = {
        "杀手|暗杀|刺客": ["assassin", "criminal"],
        "警察|刑警|警官": ["police", "law_enforcement"],
        "医生|医师|护士": ["doctor", "medical"],
        "教师|老师|教授": ["teacher", "academic"],
        "运动员|选手|球员": ["athlete", "sports"],
        "偶像|歌手|演员": ["idol", "entertainer"],
        "武士|忍者|浪人": ["samurai", "warrior"],
        "黑客|程序员|工程师": ["hacker", "tech"],
        "宅|御宅|二次元": ["otaku", "nerd"],
        "不良|ヤンキー|混混": ["delinquent", "punk"],
        "替身|スタンド": ["stand_user", "supernatural"],
        "魔法|魔女|巫师": ["mage", "magical"],
        "超能力|异能|ESP": ["psychic", "esper"],
        "中二|邪王|漆黑": ["chuunibyou", "delusional"],
      };
      const flags: Record<string, boolean> = {};
      for (const [reStr, tags] of Object.entries(tagMap)) {
        if (new RegExp(reStr).test(text)) {
          for (const t of tags) flags[t] = true;
        }
      }
      if (Object.keys(flags).length > 0) {
        actions.push({ tool: "set_flags", params: { flags }, confidence: 0.8 });
      }
    }

    // settle_scene 收尾
    actions.push({ tool: "settle_scene", params: { summary: `新角色${name}开局`, elapsed_minutes: 0 }, confidence: 0.9 });

    // 执行所有 startup 动作
    const toolsExecuted: string[] = [];
    const details: string[] = [];
    for (const action of actions) {
      try {
        const detail = await executeSingleTool(action.tool, action.params, ctx);
        if (detail) { toolsExecuted.push(action.tool); details.push(detail); }
      } catch (e) { console.error(`keywordFallback startup: ${action.tool} failed:`, e); }
    }
    saveState();

    return {
      directorNote: buildDirectorNote(text, toolsExecuted, details, gameState),
      toolsExecuted,
      summary: text,
      classified: false,
    };
  }

  // ── 常规关键词（非新游戏）──
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
  const allNPCs = Object.entries(gs.npcs)
    .filter(([_, npc]: [string, any]) => {
      if (npc.alive === false) return false;
      return npc.currentRoom === loc || npc.currentRoom?.startsWith(loc + ",") || loc.startsWith(npc.currentRoom + ",");
    })
    .map(([name]) => name);
  // ⚠️ 同地点最多 6 个有名字的 NPC，其余归入路人系统。防止教室同时显示 91 人。
  const MAX_NAMED = 6;
  if (allNPCs.length <= MAX_NAMED) return allNPCs;
  // 优先关系最深的（好感度最高的），增强叙事连贯性
  const scored = allNPCs.map(name => ({
    name,
    aff: gs.player?.relationships?.[name]?.affection ?? 0
  }));
  scored.sort((a, b) => b.aff - a.aff);
  return scored.slice(0, MAX_NAMED).map(n => n.name);
}
