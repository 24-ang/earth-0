/**
 * 时间引擎 - Earth-0 核心
 * 
 * 管理游戏时间推进和 NPC 年龄同步。
 * 解决 ST 时间机器的根本问题：engine 算，LLM 只叙事。
 */

// --- 时间阶段定义 ---
export const LIFE_STAGES = {
  infant:    { min: 0,  max: 5,   label: "幼儿" },
  child:     { min: 6,  max: 11,  label: "小学" },
  teen:      { min: 12, max: 14,  label: "中学" },
  youth:     { min: 15, max: 17,  label: "高中" },
  adult:     { min: 18, max: 21,  label: "大学/社会" },
  working:   { min: 22, max: 39,  label: "社会人" },
  middle:    { min: 40, max: 59,  label: "中年" },
  elder:     { min: 60, max: 999, label: "老年" }
};

// --- State 类型 ---
export interface TimeState {
  game_date: string;       // "2008-04-01"
  day_of_week: string;     // "月/火/水/木/金/土/日"
  time_of_day: string;     // "morning/lunch/afternoon/evening/night"
  minute_of_day: number;   // 当日累计分钟 (0~1439)
  player_age: number;      // 当前年龄
  player_stage: string;    // 当前人生阶段
  timeline_origin: {
    year: number;          // 玩家起始年份
    age: number;           // 玩家起始年龄
  };
}

// --- NPC 年龄计算 ---
export interface NpcAgeResult {
  name: string;
  base_age: number;        // 原作年龄
  current_age: number;     // 当前计算年龄
  stage: string;           // 当前人生阶段
  offset: number;          // 相对玩家的年龄差
}

/** 根据玩家当前年龄计算 NPC 的年龄 */
export function computeNpcAge(
  npcName: string,
  npcBaseAge: number,
  playerState: TimeState
): NpcAgeResult {
  const ageDelta = playerState.player_age - playerState.timeline_origin.age;
  const currentAge = Math.max(0, npcBaseAge + ageDelta);
  const stage = getLifeStage(currentAge);
  
  return {
    name: npcName,
    base_age: npcBaseAge,
    current_age: currentAge,
    stage: stage,
    offset: currentAge - playerState.player_age
  };
}

/** 根据年龄判定人生阶段 */
export function getLifeStage(age: number): string {
  for (const [key, range] of Object.entries(LIFE_STAGES)) {
    if (age >= range.min && age <= range.max) return key;
  }
  return "elder";
}

/** 获取阶段对应的描述 */
export function getStageDescription(stage: string): string {
  const map: Record<string, string> = {
    infant: "幼儿期，由家人照料",
    child: "小学，背书包上学，开始交朋友",
    teen: "中学，青春期，社团活动",
    youth: "高中，升学压力，青春恋爱",
    adult: "大学或初入社会",
    working: "社会人，工作，生活",
    middle: "中年，家庭和事业",
    elder: "老年"
  };
  return map[stage] || "";
}

/** 推进时间（以天为单位） */
export function advanceTime(state: TimeState, days: number): TimeState {
  // 简单实现：按天推进，后续可加周/月/年
  const [y, m, d] = state.game_date.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  
  const newYear = date.getFullYear();
  const newAge = newYear - (state.timeline_origin.year - state.timeline_origin.age);
  
  const days_jp = ["日", "月", "火", "水", "木", "金", "土"];
  
  return {
    ...state,
    game_date: `${newYear}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`,
    day_of_week: days_jp[date.getDay()],
    player_age: newAge,
    player_stage: getLifeStage(newAge)
  };
}

/** 推进行时间（分钟），返回新的 time_of_day */
export function advanceMinutes(state: TimeState, minutes: number): { newDate: string; dayOfWeek: string; timeOfDay: string; daysAdvanced: number } {
  const totalMinutes = state.minute_of_day + minutes;
  const daysAdvanced = Math.floor(totalMinutes / 1440);
  const newMinuteOfDay = totalMinutes % 1440;
  
  state.minute_of_day = newMinuteOfDay;
  
  // 推进日期
  const [y, m, d] = state.game_date.split("-").map(Number);
  const date = new Date(y, m - 1, d + daysAdvanced);
  const days_jp = ["日", "月", "火", "水", "木", "金", "土"];
  const newDate = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const dayOfWeek = days_jp[date.getDay()];
  
  // 更新年份相关
  if (daysAdvanced > 0) {
    state.game_date = newDate;
    state.day_of_week = dayOfWeek;
    const newYear = date.getFullYear();
    state.player_age = newYear - (state.timeline_origin.year - state.timeline_origin.age);
    state.player_stage = getLifeStage(state.player_age);
  }
  
  // 根据分钟数确定时段
  // 6:00-8:59 = morning, 9:00-11:59 = morning, 12:00-12:59 = lunch, 13:00-16:59 = afternoon, 17:00-20:59 = evening, 21:00-5:59 = night
  let tod: string;
  const m2 = newMinuteOfDay;
  if (m2 >= 6*60 && m2 < 9*60) tod = "morning";
  else if (m2 >= 9*60 && m2 < 12*60) tod = "morning";
  else if (m2 >= 12*60 && m2 < 13*60) tod = "lunch";
  else if (m2 >= 13*60 && m2 < 17*60) tod = "afternoon";
  else if (m2 >= 17*60 && m2 < 21*60) tod = "evening";
  else tod = "night";
  
  state.time_of_day = tod;
  
  return { newDate, dayOfWeek, timeOfDay: tod, daysAdvanced };
}

/** 初始时间状态 */
export const INITIAL_TIME_STATE: TimeState = {
  game_date: "2008-04-07",
  day_of_week: "月",
  time_of_day: "morning",
  minute_of_day: 480,
  player_age: 6,
  player_stage: "child",
  timeline_origin: {
    year: 2008,
    age: 6
  }
};
