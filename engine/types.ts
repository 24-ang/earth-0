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

// --- 物品 ---
export type ItemType = "weapon" | "clothing" | "armor" | "tool" | "consumable";
export type SlotType = "inner_top" | "inner_bot" | "top" | "bottom" | "legs" | "feet" | "head" | "acc" | "left_hand" | "right_hand" | "back" | "mount";
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
  vehicle?: {                          // 当前载具
    type: "bicycle" | "motorcycle" | "car";
    name: string;                      // 物品名
    speedMul: number;                  // 速度倍率（相对步行1.0）
  };
  fatigue: number;                      // 疲劳值 0-100（0=精力充沛，100=筋疲力尽）
}

// --- 静态角色数据结构 ---
export interface StaticCharacter {
  name: string;
  source: string;
  base_age?: number;
  gender: string;
  appearance_brief: string;
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
}

// --- NPC运行时状态（lazy init，只存被修改过的NPC） ---
// --- 场景服装集（每套衣服的各槽物品名） ---
export type OutfitKey = "school" | "pe" | "swim" | "casual" | "sleep";
export type NPCOutfitSet = Record<OutfitKey, Partial<Record<string, string>>>;

export interface NPCRuntimeState {
  inventory: Item[];
  equipment: EquipmentSlots;
  currentRoom: string;            // 当前宏观位置（房间名）
  gridPos: [number, number] | null; // 当前棋盘坐标
  action: string;                  // 当前动作，LLM可更新
  scheduleGroup: string;           // 日程模板标签
  scheduleOverrides?: Record<string, string>;
  funds: number;                   // NPC 现金
  memoryTags: { tag: string; since: string; expires: number }[];
  currentOutfit: OutfitKey;        // 当前激活的服装卡（默认 school）
  pendingOverride?: {              // 一次性最高优先级（生病/约定等）
    location: string;
    action: string;
    reason: string;
    expiresAt: string;            // game_date，过期自动清除
  } | null;
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
    min_day?: number;
    max_day?: number;
    location?: string;
    affection?: Record<string, number>;
    time_of_day?: string[];
    flags?: Record<string, boolean>;
  };
  expires_days: number;
  repeatable: boolean;
  hook: {
    source_npc: string;
    hook_text: string;
    urgency: "low" | "medium" | "high";
  };
  beats: TimelineBeat[];
  on_expire?: {
    narrative: string;
    effects?: { flags?: Record<string, boolean>; affection?: Record<string, number> };
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
  active_hooks: Hook[];                        // 活跃钩子账本（上限 3）
  completed_events: string[];                  // 已完成/已过期的事件 ID（防重复触发）
  roomTimestamps: Record<string, string>;  // 房间名 → game_date，场景时间戳脏污
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
