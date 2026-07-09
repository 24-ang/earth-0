/**
 * 类型定义 - Earth-0 核心
 */

import type { TimeState } from "./time.ts";

// --- 地点层级节点 ---
export interface LocationNode {
  key: string;
  name: string;
  type: "root" | "region" | "prefecture" | "district" | "school" | "landmark" | "custom";
  children: LocationNode[];
  parent: LocationNode | null;
}

// --- 时间线到期性效果 ---
export interface SexEffect {
  npc: string;
  duration?: number;
  touched_parts?: string[];
  thoughts?: string[];
  partner?: string;
}

// --- 六维属性 (1-20) ---
export interface Attributes {
  力量: number;
  敏捷: number;
  体质: number;
  智力: number;
  感知: number;
  魅力: number;
  幸运?: number;
}

export type AttrKey = keyof Attributes;

// --- 年龄基准（创建NPC用，不影响运行时） ---
export const AGE_ATTR_RANGE: Record<string, Partial<Record<AttrKey, [number, number]>>> = {
  "幼儿": { 力量: [1,3], 敏捷: [1,4], 体质: [1,3], 智力: [1,3], 感知: [1,3], 魅力: [1,5] },
  "小学": { 力量: [2,6], 敏捷: [3,7], 体质: [2,6], 智力: [2,8], 感知: [2,7], 魅力: [3,8] },
  "中学": { 力量: [3,8], 敏捷: [4,9], 体质: [3,8], 智力: [3,12], 感知: [3,9], 魅力: [4,12] },
  "高中": { 力量: [3,10], 敏捷: [4,10], 体质: [3,10], 智力: [4,16], 感知: [4,12], 魅力: [5,17] },
  "成年": { 力量: [3,20], 敏捷: [3,20], 体质: [3,20], 智力: [3,20], 感知: [3,20], 魅力: [3,20] },
  "中年": { 力量: [2,18], 敏捷: [2,18], 体质: [2,16], 智力: [3,20], 感知: [3,20], 魅力: [3,20] },
  "老年": { 力量: [1,14], 敏捷: [1,14], 体质: [1,14], 智力: [3,20], 感知: [3,20], 魅力: [3,20] },
};

// --- 动态技能 ---
export interface Skill {
  level: number;    // 1-10
  exp: number;
  nextLevel: number; // level * 10
}

export type Skills = Record<string, Skill>;

// --- 能力（超能力/忍术/咒术等，与技能平行） ---
export interface AbilityState {
  name: string;
  level: number;          // 1-10
  exp: number;
  nextLevel: number;      // (level+1) * 10
  cooldownRemaining: number;
}

export interface ResourcePools {
  [key: string]: { current: number; max: number } | undefined;
}

// --- 物品 ---
export type ItemType = "weapon" | "clothing" | "armor" | "tool" | "consumable";
export type SlotType = "inner_top" | "inner_bot" | "shirt" | "top" | "bottom" | "legs" | "feet" | "head" | "acc" | "acc2" | "acc3" | "left_hand" | "right_hand" | "back" | "mount" | "body";
export type ItemState = "intact" | "damaged" | "ruined";

export interface ItemEffect {
  type: string;      // "damage_reduction" | "attribute_bonus" | "social_bonus" | "reputation_bonus" | "pocket" | "cold_resist"
  value: number | string;
  condition?: string;
  group?: string;     // reputation_bonus 目标群体
}

export interface Item {
  name: string;
  type: ItemType;
  slot: SlotType;
  weight: number;      // kg
  effects: ItemEffect[];
  state: ItemState;
  holding_in_hands?: boolean;  // 双手搬运重物（占双手装备槽，移动减速）
  volume?: number;     // 体积（升）
  flavor?: string;     // 品质/来由描述，/look时显示
  damage?: {           // weapon专用
    dice: string;      // "1d6" / "2d6"
    damageType: string; // "钝击" / "穿刺" / "切割" / "子弹"
  };
  phoneData?: PhoneData;  // 手机数据（懒初始化，引擎读取）
}

// --- 伤势（HP=0后使用） ---
export interface Wound {
  severity: string;
  text: string;
  source: string;
}

// --- 关系 ---
export type RelationStage = "陌生" | "熟人" | "友人" | "信赖" | "至交" | "死敌";
export type RomanceStage = "暧昧" | "恋人" | "灵魂伴侣" | null;

export interface Relationship {
  stage: RelationStage;
  affection: number;    // 0-100
  romance: RomanceStage;
  notes: string;
  history?: { delta: number; reason: string; date: string }[];  // 好感变化历史
}

// --- 身体数据 ---
export interface BodyMeasurements {
  height_cm: number;
  weight_kg: number;
  build: "纤细" | "标准" | "结实" | "丰满" | "偏胖";
  measurements?: { bust: number; waist: number; hips: number };  // 女性三围 cm
  cup?: "AA"|"A"|"B"|"C"|"D"|"E"|"F"|"G";
  leg_type: "修长" | "结实" | "运动型" | "纤细" | "肉感";
  body_shape?: {
    chest: "半球"|"水滴"|"圆盘"|"纺锤"|"吊钟"|"扁平";
    hips: "蜜桃"|"圆润"|"扁平"|"方形";
    waist: "细腰"|"直筒"|"宽骨";
  };
  skin: { base_tone: "白皙"|"普通"|"偏黄"|"小麦"|"深色"; tan: number; texture: "细腻"|"普通"|"粗糙" };
  diet?: "正常"|"丰胸食谱"|"节食"|"高蛋白";
  exercise?: "久坐"|"日常活动"|"规律运动"|"高强度训练";
  // 整形改动记录
  plastic_surgery?: string[];
}

// --- 性欲(Layer1, 可选) ---
export interface SexProfile {
  baselineDesire: number;
  attitude: "抗拒" | "顺从" | "期待" | "主动" | "沉溺";
  experience: "未开发" | "生涩" | "熟练" | "深度开发";
  bodyParts: Record<string, { sensitivity: number; development: number; preference: "喜欢" | "普通" | "排斥" }>;
  cycleDay: number;
  climaxThreshold: number;
  likes: string[];
  dislikes: string[];
  // 性器官（Layer1启用才注入）
  female?: {
    breast: { cup: string; shape: "半球"|"水滴"|"圆盘"|"纺锤"|"吊钟"|"扁平"; nipple_size: "凹陷"|"小"|"普通"|"大"|"突出"; nipple_color: "淡粉"|"粉色"|"浅褐"|"深褐"; areola_size: "小"|"普通"|"宽"|"扩散"; feel: "紧实"|"柔软"|"弹力" };
    vagina: { type: "馒头"|"蝴蝶"|"一线天"|"贝壳"|"闭合"; labia_size: "小"|"普通"|"突出"; depth_cm: number; tightness: "极紧"|"紧致"|"普通"|"宽松"; inner_color: "淡粉"|"玫瑰"|"深红"; feel: "紧致吸吮"|"紧致"|"普通"|"宽松"|"名器" };
    pubic_hair: { amount: "无"|"稀疏"|"普通"|"浓密"; color: "黑色"|"褐色"|"金色"; style: "自然"|"修剪"|"剃除" };
    clitoris: "隐藏"|"小"|"普通"|"敏感突出";
  };
  male?: {
    penis: { length_cm: number; girth_cm: number; erect_length_cm: number; erect_girth_cm: number; shape: "直"|"上翘"|"左弯"|"右弯"; head_size: "普通"|"大"; circumcised: boolean; color: "淡"|"普通"|"深" };
    testicles: { size: "小"|"普通"|"大" };
    pubic_hair: { amount: "无"|"稀疏"|"普通"|"浓密"; color: "黑色"|"褐色"; style: "自然"|"修剪"|"剃除" };
  };
}

// 心里话
export interface Thought {
  text: string;         // 30 token以内
  timestamp: string;    // gameDate
  context: string;      // "climax_after" | "scene_end"
}

// 性里程碑 — 模仿恋活，独立跟踪每项初体验
export interface SexualMilestones {
  virginity: {
    isVirgin: boolean;
    lostTo: string | null;     // 对方 NPC 名
    lostAt: string | null;     // game_date
  };
  firstKiss: {
    given: boolean;
    partner: string | null;
    date: string | null;
  };
  analVirginity: {
    isVirgin: boolean;
    lostTo: string | null;
    lostAt: string | null;
  };
}

// 事后结算报告
export interface SettlementReport {
  duration_minutes: number;
  climaxCount: number;
  squirtCount: number;
  partsGrowth: Record<string, number>;
  rating: "SSS" | "SS" | "S" | "A" | "B" | "C";
  thoughts: Thought[];
  milestonesChanged?: string[];  // 本次结算触发的里程碑变化描述
  conceived?: boolean;
}

export interface SexState {
  profile: SexProfile;
  desire: number;       // 0-100
  arousal: number;      // 0-100 实时
  cycleDay: number;     // 1-28, 0=未启用
  cyclePhase: "生理期" | "安全期" | "排卵期";
  climaxed: boolean;
  climaxCount: number;
  squirtCount: number;
  thoughts: Thought[];  // 心里话历史
  milestones?: SexualMilestones;  // 初体验追踪
  stamina?: number;       // 0-100 (男方持久度)
  contraceptionUsed?: "condom" | "pill" | "none";
  condomBroken?: boolean;
}

// --- 装备槽 ---
export interface PropertyState {
  propertyId: string;
  name: string;
  regionId: string;
  type: "rent" | "own";
  rent_fee?: number;
  rent_due_date?: string;
  arrears_days: number;
  storage: Array<{
    name: string;
    quantity: number;
    volume: number;
    weight: number;
  }>;
  max_volume: number;
  max_weight: number;
}

export type EquipmentSlots = Partial<Record<SlotType, Item | null>>;

// --- 玩家 ---
export interface PlayerState {
  name: string;
  gender: string;
  age: number;
  location: string;
  body: BodyMeasurements;
  attributes: Attributes;
  skills: Skills;
  abilities: Record<string, AbilityState>;    // 超能力/忍术等 (Layer B)
  resourcePools?: ResourcePools;              // 查克拉/魔力等，世界包激活时注入
  hp: { current: number; max: number };
  ac: number;
  equipment: EquipmentSlots;
  inventory: Item[];
  wounds: Wound[];
  relationships: Record<string, Relationship>;
  sex?: SexState;
  funds: number;
  flags: Record<string, boolean>;
  alive: boolean;
  party: string[];
  gridPos: [number, number] | null;
  reputation: Record<string, number>;  // 多维声望，键=日程模板组名
  known_locations: string[];           // 已探索地点
  titles: string[];                    // 引擎自动授予的称号（只加不删）
  public_identity?: string;            // 伪装身份/公开身份
  properties: Record<string, PropertyState>; // 拥有的房产
  social_class?: string;
  personal_axes?: Record<string, number>;
  memberships?: OrgMembership[];         // 玩家所属的组织及职位
  vehicle?: {                          // 当前载具
    type: "bicycle" | "motorcycle" | "car";
    name: string;                      // 物品名
    speedMul: number;                  // 速度倍率（相对步行1.0）
  };
  fatigue: number;                      // 疲劳值 0-100（0=精力充沛，100=筋疲力尽）
  deathSaves?: { successes: number; failures: number };  // 死亡豁免累积（3成功=稳定，3失败=死亡）
  concealed?: boolean;                   // 躲藏状态（视觉察觉自动失败）
  hiding_in?: string;                    // 躲藏的家具名
}


// --- 静态角色数据结构 ---
/** 一套服装：槽位→Item名字（引擎 getNPCOutfitDesc 读 slot 短名，desc/hair 跳过不渲染）。
 *  slot 值必须 ≤10 字（长描述进 desc）。 */
export interface OutfitDef {
  hair?: string;   // 这套对应的发型（10-20字），getNPCOutfitDesc 跳过
  desc?: string;   // 整套搭配感（80-150字），供 lookup_character，getNPCOutfitDesc 跳过
  [slot: string]: string | undefined;  // top/bottom/legs/feet/inner_top/inner_bot/shirt/acc/back → Item 名字
}

/**
 * 角色卡：139 个 NPC 的唯一真相来源。
 *
 * 字段分层（覆盖率见 docs/decisions.md #30/#32 及校验器输出）：
 * - 必填（100%，人人都有）：name/source/base_age/gender/appearance_brief/body/attributes/
 *   default_location/schedule_group/social_class/personal_axes
 * - 其余全部可选，注释标明"缺了引擎怎么兜底"。校验器 validate-characters.ts 负责扫描缺件/矛盾/孤儿。
 *
 * ⚠️ 两条易混淆的独立链路（#32，内容不应相同）：
 * - personality_stages（年龄键"6"/"16"）→ NPC Agent 内心独白（state.ts:866→924）
 * - stages（阶段键"高中"）→ Phase 3 场景标签（state.ts:1296，源自 character_stages.json）
 */
export interface StaticCharacter {
  // ── 必填：核心身份（100% 覆盖）──
  name: string;
  source: string;                        // 出处作品
  base_age: number;                      // 设定基准年龄，引擎按玩家开局年龄缩放
  gender: string;
  appearance_brief: string;              // 一句话外观（outfits 缺失时的兜底描述）
  body: BodyMeasurements;
  attributes: Attributes;
  default_location: string;              // 默认所在地
  schedule_group: string;                // 日程组名，必须 ∈ schedule_templates.json 组名
  social_class: string;
  personal_axes: Record<string, number>; // { 经济立场, 政治立场 } -5~+5

  // ── 外观细节（缺 → 用 appearance_brief / body 兜底）──
  hair_color?: string;
  hair_style?: string;
  eye_color?: string;
  hair_accessories?: string;
  appearance_by_age?: Record<string, {
    hair_color?: string;
    hair_style?: string;
    eye_color?: string;
    hair_accessories?: string;
  }>;
  body_by_age?: Record<string, Partial<BodyMeasurements>>;  // 缺 → ageGap>3 时走通用兜底文字

  // ── 人格与台词（两条独立链路，见上方注释）──
  personality_brief?: string;            // 一句话人格（personality_stages 缺失时的 fallback）
  personality_stages?: Record<string, string>;  // 年龄键 → 内心独白；缺 → fallback personality_brief
  stages?: Record<string, string>;       // 阶段键 → Phase 3 场景标签（原 character_stages.json）；缺 → 无标签
  stages_if?: Record<string, string>;    // if 线剧情人格变体；由 flag 触发（原 {name}_if）
  speech_style?: string;                 // 说话风格
  likes?: string[];
  dislikes?: string[];
  anchors?: Record<string, string>;      // { emotional, intimate, private } 关系锚点

  // ── 数值与装备 ──
  skills?: Record<string, number>;
  hp?: { current: number; max: number };
  ac?: number;
  equipment?: EquipmentSlots;            // 手写装备（含专属 flavor）；引擎 fillEffectsFromCatalog 补属性
  inventory?: Item[];
  funds?: number;

  // ── 服装 ──
  outfits?: Record<string, OutfitDef>;   // 场景服装集；缺 → getNPCOutfitDesc 回退 appearance_brief
  outfits_by_age?: Record<string, string>;  // 年龄→outfit key；缺且 ageGap>3 → 通用兜底文字
  /** @deprecated 只雪乃1人，Phase 2 迁入 items.json 后删除。与 outfits 已产生矛盾。 */
  equipment_by_outfit?: Record<string, Record<string, any>>;

  // ── 日程与位置 ──
  grid_pos?: [number, number];
  schedule?: any;                        // 少数角色的自定义日程（5/139）
  schedule_overrides?: Record<string, string>;
  schedule_group_by_age?: Record<string, string>;
  default_location_by_age?: Record<string, string>;  // 住址随年龄变化
  drives_by_age?: Record<string, { drives: string[]; goal: string }>;

  // ── 学校（校园角色）──
  grade?: number;
  homeroom?: string;

  // ── 性档案（原为指向自身名字的字符串指针；Phase 1 后存完整对象）──
  sex_profile?: SexProfile;

  // ── 事实分级（P3）──
  public_facts?: CharacterFact[];
  private_facts?: CharacterFact[];

  tags?: string[];
}

/** 玩家在组织中的身份 */
export interface OrgMembership {
  orgId: string;
  role: string;       // 职位名（自由文本，如"部长""普通部员"）
  rank: number;       // 1-10: 1-3=边缘 → 4-6=普通 → 7-9=核心 → 10=领袖
  joinedAt: string;   // game_date
}

/** 四层职位的权力边界 */
 = {
  enter_headquarters: { minRank: 1, description: "进入大本营不被拦" },
  view_restricted:    { minRank: 4, description: "查看受限信息和阶段性目标" },
  recruit_member:     { minRank: 7, description: "招募新成员" },
  use_funds:          { minRank: 7, description: "动用组织资金（有限额）" },
  represent_org:      { minRank: 7, description: "代表组织对外谈判/签条约" },
  set_goals:          { minRank: 10, description: "修改组织宏观目标" },
  appoint_core:       { minRank: 10, description: "任免核心成员" },
  expel_member:       { minRank: 7, description: "开除成员" },
};

// --- NPC运行时状态（lazy init，只存被修改过的NPC） ---
// --- 场景服装集（每套衣服的各槽物品名） ---
export type OutfitKey = "school" | "pe" | "swim" | "casual" | "sleep";
export type NPCOutfitSet = Record<OutfitKey, Partial<Record<string, string>>>;

// --- NPC 人生事件（纯引擎状态机） ---
export interface IllnessState {
  type: string;           // "感冒" | "流感" | "重病" 等
  severity: "轻" | "中" | "重";
  day_started: number;    // 发病日
  contagious: boolean;
}

export interface PregnancyState {
  day_conceived: number;
  father: string;
  stage: "early" | "visible" | "due";
  child_name?: string;    // 分娩后由 LLM 设定
}

export interface LifeEvent {
  id: string;
  type: "illness" | "pregnancy" | "criminal" | "conflict";
  data: IllnessState | PregnancyState | { type: string; victim: string; day: number; witness?: string } | { npc1: string; npc2: string; cause: string; day: number };
  day_started: number;
}

export interface MemoryTag {
  tag: string;
  since: string;
  expires: number;
  tone?: "感激" | "愧疚" | "喜欢" | "厌恶" | "受伤" | "困惑" | "期待" | "无感";
  priority?: number;                                        // 重要度：1=日常, 2=重要, 3=核心机密（默认 1）
  emotional_valence?: "positive" | "negative" | "neutral";  // 情感效价（默认 neutral）
  related_npcs?: string[];                                  // 记忆关联人物（默认空数组）
  category?: "fact" | "emotion" | "milestone" | "general";  // 记忆类型（默认 general）
}

export interface NPCRuntimeState {
  inventory: Item[];
  equipment: EquipmentSlots;
  currentRoom: string;            // 当前宏观位置（房间名）
  gridPos: [number, number] | null; // 当前棋盘坐标
  action: string;                  // 当前动作，LLM可更新
  scheduleGroup: string;           // 日程模板标签
  scheduleOverrides?: Record<string, string>;
  cash: number;                    // NPC 随身现金（钱包里揣的，能被偷，几千~几万）
  wealth: number;                  // NPC 总流动资产（含银行存款，偷不走，买大件用）
  memoryTags: MemoryTag[];
  shortTermBuffer?: {
    recentExchanges: string[];   // 最近的原始对话流缓存（上限 10 条）
    recentEvents: string[];      // 最近发生的场景事件简述（上限 5 条）
  };
  currentOutfit: OutfitKey;        // 当前激活的服装卡（默认 school）
  pendingOverride?: {              // 一次性最高优先级（生病/约定等）
    location: string;
    action: string;
    reason: string;
    expiresAt: string;            // game_date，过期自动清除
  } | null;
  npcRelationships?: Record<string, { stage: string; tone: string; notes: string }>;  // 此NPC对其他NPC的关系
  hp: { current: number; max: number };
  alive: boolean;
  attributes: Attributes;
  skills: Record<string, Skill>;
  abilities: Record<string, AbilityState>;
  resourcePools?: ResourcePools;
  current_drives?: string[];           // 当前驱动力（引擎从 drives_by_age 初始化，GM/NPC Agent 可更新）
  current_goal?: string;               // 当前目标（引擎从 drives_by_age 初始化）
  lifeEvents?: LifeEvent[];            // 进行中的人生事件（引擎追踪状态变化）
}

// --- 空间系统（棋盘格） ---
export interface CellData {
  type: "floor" | "wall" | "door" | "exit" | "stairs";
  block: boolean;
  furniture: string | null;
  label: string;
  exitTo?: string;
  exitFloor?: number;
  height?: number;
  isOpen?: boolean;
  outsideView?: string;
  faces?: string;            // 窗户面对的房间名（跨节点感知）
  locked?: boolean;          // 门是否锁着（需要匹配钥匙 unlock 值）
  tags?: string[];
}

export interface RoomGrid {
  width: number;
  height: number;
  cellSize: number;       // 每格边长（米），教室1m，操场5m，街道10m
  floor: number;          // 楼层 0=地面 1=二楼
  cells: CellData[][];
  origin: [number, number];
  atmosphere?: string;
  horizon?: Record<string, string>;
  ambient?: { audio?: string; visual?: string };  // 外部环境渗透
  capacity?: number;      // 房间最大承载NPC容量，超出分流
  controlled_by?: string; // 控制该地点的组织 ID
}

export interface MoveResult {
  success: boolean;
  newX: number;
  newY: number;
  newRoom?: string;
  blocked: boolean;
  reason: string;
  distance: number;       // 移动距离（米）
  seconds: number;        // 耗时（秒）
}

// --- 容器系统 ---
export interface ContainerDef {
  id: string;
  visible: boolean;
  lockable?: boolean;
  locked?: boolean;
  key_id?: string;
  max_volume: number;
  max_weight: number;
  can_hold_person?: boolean;
}

export interface ContainerState {
  id: string;
  ownerType: "furniture" | "room" | "player" | "npc" | "vehicle";
  ownerId: string;
  def: ContainerDef;
  items: Item[];
  current_volume: number;
  current_weight: number;
}

// --- 旅行系统 ---
export interface PendingTravel {
  from: string;
  to: string;
  route: string;       // "步行" | "京叶线" | "公交" 等
  minutes: number;
  timeOfDay: string;   // "傍晚" | "上午" 等
}

// --- 偷窃结果 ---
export interface StealResult {
  success: boolean;
  item?: Item;
  caught: boolean;
  narrative: string;
  roll: { kept: number; mod: number; total: number; dc: number };
}

// --- 剧情事件系统 ---
export interface TimelineEvent {
  id: string;
  title: string;
  source: string;
  trigger: {
    min_age?: number;
    max_age?: number;
    player_stage?: string;
    min_day?: number;
    max_day?: number;
    location?: string;
    affection?: Record<string, number>;
    time_of_day?: string[];
    flags?: Record<string, boolean>;
    min_skills?: Record<string, number>;
    calendar_event?: string;
  };
  expires_days: number;
  repeatable: boolean;
  hook?: {
    source_npc: string;
    hook_text: string;
    urgency: "low" | "medium" | "high";
  };
  beats: TimelineBeat[];
  /** 此事件必须覆盖的关键情节点（GM 必须推进到这些 beat label） */
  must_cover?: string[];
  /** 标志性台词（高优先级注入 NPC 生成上下文） */
  iconic_lines?: string[];
  /** 推荐预加载的 lore 标签（自动触发 queryLore） */
  recommended_lore?: string[];
  on_expire?: {
    narrative: string;
    effects?: { flags?: Record<string, boolean>; affection?: Record<string, number>; sex?: SexEffect };
  };
}

export interface TimelineBeat {
  id: string;
  label: string;
  prompt: string;
  outcomes?: {
    pick: string;
    effects?: { flags?: Record<string, boolean>; affection?: Record<string, number> };
    next_beat?: string;
    auto_if?: {
      /** NPC名 → 必须匹配的romance stage (如 "恋人") */
      romance?: Record<string, string>;
      /** flag名 → 必须匹配的值 */
      flags?: Record<string, boolean>;
      /** NPC名 → 最低好感度 */
      affection?: Record<string, number>;
    };
  }[];
  effects?: { flags?: Record<string, boolean>; affection?: Record<string, number> };
  expires_quest?: boolean;
}

export interface QuestState {
  id: string;
  title: string;
  status: "active" | "completed" | "abandoned" | "expired";
  current_beat: string | null;
  started_day: number;
  outcomes: Record<string, string>;
}

export interface CalendarEntry {
  year: number | null;       // null = 任意年份均生效
  date: string;              // "M月D日" 格式，如 "4月7日"
  location: string | null;   // null = 任意地点均生效
  text: string;              // 叙事风味文本
  world?: string;            // 关联的世界观，如 'oregairu'
  // P1 新增 (all optional, backward compatible)
  range?: "local" | "regional" | "national" | "global";
  center?: string;
  advance_days?: number;
  advance_hook?: string;
  aftermath_text?: string;
  org_effects?: OrgEffect[];
  // 多日假期: 覆盖某段时间内特定日程组的模板
  schedule_override?: Record<string, string>;
  duration_days?: number;
}

// ── P1: 事件驱动日历扩展 ──
export interface OrgEffect {
  org: string;
  override_location: string;
  override_action_template: string;  // supports {role} and {role_action} variables
}

// ── P2: 世界常识 ──
export type VisibilityLevel = "common" | "industry" | "hidden";

export interface LoreTrigger {
  locations?: string[];
  topics?: string[];
  roles?: string[];
  orgs?: string[];
  flags?: string[];
}

export interface LoreEntryItem {
  tag: string;
  level: VisibilityLevel;
  triggers: LoreTrigger;
  text: string;
}

export interface LoreOrgFile {
  id: string;
  org: string;
  type: string;
  members?: string[];         // NPC names for precise org matching (P2 upgrade)
  match_rules?: {             // fallback heuristic matching
    schedule_groups?: string[];
    location_contains?: string;
  };
  entries: LoreEntryItem[];
}

// ── P3: 角色常识 ──
export type FactLevel = "common" | "familiar" | "close" | "intimate";

export interface CharacterFact {
  text: string;
  level: FactLevel;
}

// ── P4: 临时 NPC ──
export interface TempNPCState {
  name: string;
  act: string;
  hostility: "友好" | "中立" | "敌对";
  body_hint?: string;
  reason: string;
  created_at_turn: number;
  created_at_date: string;
}

export interface Hook {
  event_id: string;
  source_npc: string;
  hook_text: string;
  urgency: "low" | "medium" | "high";
  created_day: number;
  expires_day: number;
  seen_count: number;
  novelty?: string;
  /** 标志性台词（高优先级注入 NPC 生成上下文） */
  iconic_lines?: string[];
}

// --- 动态事件（LLM/引擎运行时创建，不入 JSON 文件） ---
export interface DynamicEvent {
  id: string;
  title?: string;
  source: "llm" | "engine";
  trigger?: {
    min_age?: number;
    max_age?: number;
    player_stage?: string;
    min_day?: number;
    max_day?: number;
    location?: string;
    affection?: Record<string, number>;
    time_of_day?: string[];
    flags?: Record<string, boolean>;
    min_skills?: Record<string, number>;
    calendar_event?: string;
  };
  expires_days: number;
  repeatable: boolean;
  hook: {
    source_npc: string;
    hook_text: string;
    urgency: "low" | "medium" | "high";
  };
  /** 可选：任务完成时触发幕间。LLM建钩子时预设——结算后从委托人视角回顾这件事 */
  intermission?: {
    npc?: string;
    setting?: string;
    topic?: string;
    tone?: string;
    weight?: number;
    length?: "short" | "long";
    must_cover?: string[];
    trigger?: string;
  };
}

// --- 回合台账 (Layer 2) ---
export interface TurnLogEntry {
  turn: number;
  playerAction: string;
  resolvedChanges: string;
  sceneResult: string;
  openHooks: string;
  nextPressure: string;
  toolsCalled: string[];
  timestamp: string; // gameDate
}

// --- 秘密防火墙 (Layer 3) ---
export type RevealVisibilityLevel = "player_known" | "protagonist_known" | "scene_public" | "hidden_canonical";

export interface RevealEntry {
  id: string;           // 秘密标识
  content: string;       // 揭示内容
  fromLevel: RevealVisibilityLevel;
  toLevel: RevealVisibilityLevel;
  revealedAt: string;    // gameDate
  turn: number;
}

export interface WorldStateSnapshot {
  npcs: Record<string, NPCRuntimeState>;
  room_deltas: Record<string, Partial<CellData>>;
  dynamic_locations: Record<string, LocationNode>;
  known_locations: string[];
  sns_feed: SnsPost[];
}

export interface CutawayDirective {
  type: "他者之眼" | "余波" | "同场复述" | "幕间";
  npc: string;
  weight: number;
  trigger?: string;
  npcs?: string[];
  setting?: string;
  topic?: string;
  length?: "short" | "long";
  tone?: string;
  must_cover?: string[];
  reveal_level?: string;
}

export interface WorldState {
  tech: number;       // 0~5
  stability: number;  // -3~3
  tension: number;    // 0~5
  prosperity: number; // -5~5
  regime?: string;
  economy_type?: string;
  diplomacy_stance?: string;
  globalFlags: Record<string, boolean>;
}

// --- 游戏状态 ---
export interface GameState {
  time: TimeState;
  weather: { type: string; temp: number };  // 天气+温度
  player: PlayerState;
  npcs: Record<string, NPCRuntimeState>;
  worldState?: WorldState;
  sexStates?: Record<string, SexState>;      // 记录各个 NPC 的运行时 SexState，支持持久化
  mode: "gal" | "rpg" | "sex";
  layer1Enabled: boolean;
  auMode: boolean;
  flags: Record<string, boolean>;
  turn: number;
  preset?: "default" | "lite";
  pendingTravel?: PendingTravel | null;
  quests: Record<string, QuestState>;          // 剧情任务状态
  academic_year_offset: number;              // 学年偏移（0=默认时间线，+1=全员升一年级，教师不变）
  active_hooks: Hook[];                        // 活跃钩子账本（上限 3）
  completed_events: string[];                  // 已完成/已过期的事件 ID（防重复触发）
  dynamicEvents: DynamicEvent[];               // LLM/引擎动态创建的事件（不入 JSON）
  roomTimestamps: Record<string, string>;  // 房间名 → game_date，场景时间戳脏污
  activeWorld: string;                     // 当前活跃世界观（用于过滤时间线/日历/lore）
  turnLog: TurnLogEntry[];                 // Layer 2 回合台账
  storySoFar: string;                      // 前情滚动摘要（旧回合压缩）
  revealLog: RevealEntry[];                // Layer 3 秘密揭示日志
  dynamicCharacters?: Record<string, Partial<StaticCharacter>>;
  calendarEvents?: CalendarEntry[];          // 动态可写日历事件
  world_states: Record<string, WorldStateSnapshot>; // 冷冻世界线的状态快照
  shops?: Record<string, { items: string[] }>;       // 运行时货架覆盖（由restock_shop写入，优先级高于shops.json）
  // P4 新增
  tempNPCs?: TempNPCState[];
  schemaVersion?: number;      // 存档结构版本号（1=2026-06-25 初始版本化）
  
  // 叙事视角系统
  interactionMode?: "novel" | "turn_based";
  turnsSinceLastNPCInteraction?: number;
  turnsInConversation?: number;
  _cutaway_queue?: CutawayDirective[];
  _cutaway_cooldown?: number;
  _replay_pov?: string;
  _npc_last_responses?: Record<string, string>;
  _pending_viewpoint_text?: { text: string; turn: number };
  _activeNPCs?: string[];          // 当前回合 cue 玩家的 NPC 名列表（Phase 2 后检测）
  _galSceneActive?: boolean;       // GAL 场景锁（场景中不退出，只在场景边界切换）
  lastReviewFindings?: string[];
  _lastTurnToolsCalled?: string[];
  _turnAtLastCheck?: number;
  _locationMismatchWarning?: string | null;
  _prevMode?: "rpg" | "gal" | "sex";
  _toolsLocked?: boolean;
  _playerSnapshot?: any | null;
  _npcSnapshot?: any | null;
  _originalPlayerName?: string | null;
  _lastCommuteEncounter?: string;

  // Step 4: 观影替换与广播时空
  _theaterActive?: boolean;
  _theaterBackup?: string;
  _theaterScriptId?: string;
  _theaterPhase?: "adaptation" | "immersion" | "climax" | "exit";
  _danmakuCooldown?: number;
  _commentaryCooldown?: number;
  _theaterActions?: string[];

  // Step 7: 势力与组织系统
  organizations?: Record<string, Organization>;
}

export interface Organization {
  id: string;                     // e.g., "soubu_service_club"
  name: string;                   // e.g., "侍奉部"
  type: "学校" | "社团" | "企业" | "政治" | "宗教" | "犯罪" | "家族" | "自治" | "自定义" | string;
  scale: "club" | "local" | "regional" | "national";
  sector: "politics" | "economy" | "culture" | "military" | "social";
  parent_org?: string;            // 上级组织 ID，用于嵌套与级联干涉
  
  // ── 核心资源与属性 ──
  wealth: number;                 // 0-100
  influence: number;              // 0-100
  cohesion: number;               // 0-100
  public_legitimacy: number;      // 社会公信力/合法性 (0-100)
  coreLocation: string;           // 大本营
  territoryRoomKeys: string[];    // 控制范围 (roomKey 数组)
  
  // ── 阶级基本盘 ──
  class_base: Record<string, number>; // { "无产阶级": 0.8, ... }
  
  // ── 政治/经济双轴 ──
  organizationalAxes: {
    "经济立场": number;           // -5 (左派) 至 +5 (右派)
    "政治立场": number;           // -5 (自由进步) 至 +5 (保守秩序)
  };
  
  // ── 组织自转与驱动力 ──
  goals: {
    macroGoal: string;
    currentPhaseGoal: string;
    requiredResources?: { type: string; value: number }[];
  };
  
  // ── 成员与阶层（扁平化） ──
  leader: string;                 // rank 最高者快捷引用
  members: { npcName: string; role: string; rank: number }[];
  
  relations: Record<string, number>; // 组织间关系
  match_rules?: {
    schedule_groups?: string[];
    location_contains?: string;
  };
  entries?: any[];                // facts entries

  // ── 生命周期与规模演化 ──
  lifecycle_stage?: LifecycleStage;   // 六阶段生命周期，引擎自动推断
  ticks_at_scale?: number;            // 当前 scale 已持续的 ticks 数
  ticks_at_stage?: number;            // 当前 lifecycle_stage 已持续的 ticks 数
  archived?: boolean;                 // 标记为已消亡（不下发 LLM）
}

export type LifecycleStage = "萌芽" | "初创" | "成长" | "成熟" | "衰退" | "消亡";
export const SCALE_LADDER: readonly string[] = ["club", "local", "regional", "national"] as const;

// ── 手机数据（存储在 Item.phoneData）──

export interface Contact {
  name: string;
  number: string;
  relation: string;
  addedAt: string;
}

export interface PhoneMessage {
  id: number;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  read: boolean;
  type: "sms" | "system";
}

export interface CallLogEntry {
  id: number;
  caller: string;
  callee: string;
  startTime: string;
  endTime: string | null;
  duration_seconds: number;
  status: "ongoing" | "answered" | "missed" | "rejected";
}

export interface SnsPost {
  id: number;
  author: string;
  text: string;
  timestamp: string;
  platform: "mixi" | "twitter";
  likes: number;
}

export interface PhotoEntry {
  id: number;
  filename: string;
  caption: string;
  location: string;
  takenAt: string;
}

export interface PhoneData {
  owner: string;
  contacts: Contact[];
  messages: PhoneMessage[];
  callLog: CallLogEntry[];
  snsPosts: SnsPost[];
  photos: PhotoEntry[];
  unreadCount: number;
  lastCheckTime: string | null;
}
