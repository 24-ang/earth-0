/**
 * 类型定义 - Earth-0 核心
 */

import type { TimeState } from "./time.ts";

// --- 六维属性 (1-20) ---
export interface Attributes {
  力量: number;
  敏捷: number;
  体质: number;
  智力: number;
  感知: number;
  魅力: number;
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
export type SlotType = "inner_top" | "inner_bot" | "shirt" | "top" | "bottom" | "legs" | "feet" | "head" | "acc" | "left_hand" | "right_hand" | "back" | "mount";
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
    penis: { length_cm: number; girth_cm: number; shape: "直"|"上翘"|"左弯"|"右弯"; head_size: "普通"|"大"; circumcised: boolean; color: "淡"|"普通"|"深" };
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
export interface StaticCharacter {
  name: string;
  source: string;
  base_age?: number;
  gender: string;
  appearance_brief: string;
  hair_color?: string;   // "黑色" | "茶色" | "橘棕色" | "银色" | ...
  hair_style?: string;   // "长直" | "波浪卷发" | "短发" | "马尾" | ...
  eye_color?: string;    // "蓝色" | "紫色" | "湖水蓝" | ...
  hair_accessories?: string; // "红色蝴蝶结丝带" | "红丝带" | ...
  appearance_by_age?: Record<string, {
    hair_color?: string;
    hair_style?: string;
    eye_color?: string;
    hair_accessories?: string;
  }>;
  body: BodyMeasurements;
  body_by_age?: Record<string, Partial<BodyMeasurements>>;
  attributes?: Attributes;
  skills?: Record<string, number>;
  hp?: { current: number; max: number };
  equipment?: EquipmentSlots;
  inventory?: Item[];
  tags?: string[];
  default_location?: string;
  grid_pos?: [number, number];
  schedule_group?: string;
  schedule_overrides?: Record<string, string>;
  schedule_group_by_age?: Record<string, string>;
  funds?: number;
  drives_by_age?: Record<string, { drives: string[]; goal: string }>;  // 自主意图（按年龄段）
  // P3 新增
  public_facts?: CharacterFact[];
  private_facts?: CharacterFact[];
}

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

export interface NPCRuntimeState {
  inventory: Item[];
  equipment: EquipmentSlots;
  currentRoom: string;            // 当前宏观位置（房间名）
  gridPos: [number, number] | null; // 当前棋盘坐标
  action: string;                  // 当前动作，LLM可更新
  scheduleGroup: string;           // 日程模板标签
  scheduleOverrides?: Record<string, string>;
  funds: number;                   // NPC 现金
  memoryTags: { tag: string; since: string; expires: number; tone?: "感激" | "愧疚" | "喜欢" | "厌恶" | "受伤" | "困惑" | "期待" | "无感" }[];
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
  items: any[];  // items inside (simplified — full ItemData for now)
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
  on_expire?: {
    narrative: string;
    effects?: { flags?: Record<string, boolean>; affection?: Record<string, number>; sex?: any };
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
  room_deltas: Record<string, any>;
  dynamic_locations: Record<string, any>;
  known_locations: string[];
  sns_feed: any[];
}

// --- 游戏状态 ---
export interface GameState {
  time: TimeState;
  weather: { type: string; temp: number };  // 天气+温度
  player: PlayerState;
  npcs: Record<string, NPCRuntimeState>;
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
  dynamicCharacters?: Record<string, any>;   // LLM 运行时创建的角色（name → StaticCharacter 字段）
  calendarEvents?: CalendarEntry[];          // 动态可写日历事件
  world_states: Record<string, WorldStateSnapshot>; // 冷冻世界线的状态快照
  shops?: Record<string, { items: string[] }>;       // 运行时货架覆盖（由restock_shop写入，优先级高于shops.json）
  // P4 新增
  tempNPCs?: TempNPCState[];
  schemaVersion?: number;      // 存档结构版本号（1=2026-06-25 初始版本化）
}

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
