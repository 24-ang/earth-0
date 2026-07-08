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
  if (!state?.game_date) {
    console.warn("advanceTime: game_date is undefined, using timeline_origin");
    const originYear = state.timeline_origin?.year || 2018;
    state.game_date = `${originYear}-04-07`;
  }
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
  if (!state?.game_date) {
    console.warn("advanceMinutes: game_date is undefined, using timeline_origin");
    const originYear = state.timeline_origin?.year || 2018;
    state.game_date = `${originYear}-04-07`;
  }
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

// --- 时间显示辅助 ---
export interface ClockParts {
  year: number;
  month: number;
  date: number;
  hour: number;
  minute: number;
  weekday: string;        // "月" / "火" / ...
  season: string;         // "春" / "夏" / "秋" / "冬"
  display_date: string;   // "2018年4月7日 星期土"
  display_time: string;   // "08:00"
}

/** 从 TimeState 的真实字段算出所有显示用的时间组件。
 *  TimeState 只有 game_date + minute_of_day + day_of_week，没有 year/month/hour 等独立字段。
 *  手机顶栏、台账时间戳等需要这些字段的地方，统一通过这个函数拿，不要再直接读 time.xxx。 */
export function getClockParts(t: TimeState): ClockParts {
  const [y, m, d] = t.game_date.split("-").map(Number);
  const hour = Math.floor(t.minute_of_day / 60);
  const minute = t.minute_of_day % 60;

  let season = "冬";
  if (m >= 3 && m <= 5) season = "春";
  else if (m >= 6 && m <= 8) season = "夏";
  else if (m >= 9 && m <= 11) season = "秋";

  return {
    year: y,
    month: m,
    date: d,
    hour,
    minute,
    weekday: t.day_of_week,
    season,
    display_date: `${y}年${m}月${d}日 星期${t.day_of_week}`,
    display_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** 从 minute_of_day 判定当前课节（1-6限/课间/昼休み/放課後/课前）。
 *  返回 null 表示不在上课时间段内。 */
export function getCurrentPeriod(minuteOfDay: number, dayOfWeek: string): {
  period: number | null;
  phase: "授業中" | "休み時間" | "昼休み" | "放課後" | "课前";
  minutesUntilNext: number;
} {
  const periods = [
    { p: 1, start: 8 * 60 + 40, end: 9 * 60 + 30 },
    { p: 2, start: 9 * 60 + 40, end: 10 * 60 + 30 },
    { p: 3, start: 10 * 60 + 40, end: 11 * 60 + 30 },
    { p: 4, start: 11 * 60 + 40, end: 12 * 60 + 30 },
    { p: 5, start: 13 * 60 + 20, end: 14 * 60 + 10 },
    { p: 6, start: 14 * 60 + 20, end: 15 * 60 + 10 },
  ];
  // 水曜只有1-4限
  const maxPeriod = dayOfWeek === "水" ? 4 : 6;

  // 课前
  if (minuteOfDay < periods[0].start) {
    return { period: null, phase: "课前", minutesUntilNext: periods[0].start - minuteOfDay };
  }

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (p.p > maxPeriod) break;
    if (minuteOfDay >= p.start && minuteOfDay < p.end) {
      return { period: p.p, phase: "授業中", minutesUntilNext: p.end - minuteOfDay };
    }
    // Between periods = 课间
    if (i < periods.length - 1) {
      const next = periods[i + 1];
      if (next.p > maxPeriod) break;
      if (minuteOfDay >= p.end && minuteOfDay < next.start) {
        return { period: null, phase: "休み時間", minutesUntilNext: next.start - minuteOfDay };
      }
    }
  }

  // Lunch
  if (minuteOfDay >= 12 * 60 + 30 && minuteOfDay < 13 * 60 + 20) {
    return { period: null, phase: "昼休み", minutesUntilNext: 13 * 60 + 20 - minuteOfDay };
  }

  // After school
  const lastEnd = periods[maxPeriod - 1].end;
  if (minuteOfDay >= lastEnd) {
    return { period: null, phase: "放課後", minutesUntilNext: 0 };
  }

  return { period: null, phase: "放課後", minutesUntilNext: 0 };
}

/** 清洗 class_config 中带备注的班主任名（如"羽生真由梨（副担任）"→"羽生真由梨"）。
 *  "（空缺...）"返回空字符串。 */
function cleanHomeroom(raw: string): string {
  if (!raw) return "";
  // 全角括号备注：去掉括号内容
  let s = raw.replace(/（[^）]*）/g, "").trim();
  // 半角括号
  s = s.replace(/\([^)]*\)/g, "").trim();
  // "空缺"系列 → ""
  if (s === "空缺" || s.startsWith("空缺")) return "";
  return s;
}

/** 通过学生所在班级解析课程表key（班主任名）。持ち上がり制対応。
 *  classConfig = soubu_high.json 的 class_config.grades */
export function resolveStudentTimetableKey(
  grade: number | undefined,
  homeroom: string | undefined,
  classConfig: any
): string | null {
  if (!grade || !homeroom || !classConfig) return null;
  const yearKey = `${grade}年`;
  const yearData = classConfig[yearKey];
  if (!yearData?.classes?.[homeroom]) return null;
  const raw = yearData.classes[homeroom].homeroom;
  if (!raw) return null;
  return cleanHomeroom(raw) || null;
}

/** 查课程表，返回[現在]和[次]两行文本（供 Phase 2/3 注入）。
 *  timetableKey = 班主任名（如"平冢静"）。v2: 按教师索引，持ち上がり制対応。
 *  返回空字符串表示当前不在上课或无课表。 */
export function buildPeriodLines(
  timetableKey: string,
  minuteOfDay: number,
  dayOfWeek: string,
  timetable: any
): string {
  if (!timetable || !timetable.timetables) return "";
  const classData = timetable.timetables[timetableKey];
  if (!classData) return timetable.fallback?.text || "";

  const dayTimetable = classData[dayOfWeek];
  if (!dayTimetable) return "";

  const periodInfo = getCurrentPeriod(minuteOfDay, dayOfWeek);
  const labels = timetable.change_labels || {};
  const size = classData.class_size || "?";

  let lines = "";

  // 当前课节
  if (periodInfo.phase === "授業中" && periodInfo.period) {
    const current = dayTimetable.find((p: any) => p.period === periodInfo.period);
    if (current) {
      const teacher = current.teacher || "（担当教員）";
      const room = current.room || "教室";
      // 计算距离下课还有多少分钟
      const remaining = periodInfo.minutesUntilNext;
      const timeHint = remaining <= 5 ? "（まもなくチャイム）" :
                       remaining <= 10 ? `（あと${remaining}分）` : "";
      lines += `[現在] ${periodInfo.period}限 ${current.subject} | ${teacher} | ${room} | ${size}人${timeHint}`;
    }
  } else if (periodInfo.phase === "休み時間") {
    // 课间：显示下一节
    lines += `[現在] 休み時間（あと${periodInfo.minutesUntilNext}分）`;
  } else if (periodInfo.phase === "昼休み") {
    lines += `[現在] 昼休み（あと${periodInfo.minutesUntilNext}分）`;
  } else if (periodInfo.phase === "课前") {
    lines += `[現在] 朝·HR前（あと${periodInfo.minutesUntilNext}分でチャイム）`;
  } else if (periodInfo.phase === "放課後") {
    lines += `[現在] 放課後（部活·帰宅）`;
  }

  // 下一节（上课中时显示下节；课间/午休不重复显示——因为课间的"次"就是马上要上的那节）
  if (periodInfo.phase === "授業中" && periodInfo.period) {
    const nextPeriod = periodInfo.period! + 1;
    const next = dayTimetable.find((p: any) => p.period === nextPeriod);
    if (next) {
      const label = labels[next.subject] || "";
      const labelStr = label ? ` | ${label}` : "";
      lines += lines ? " " : "";
      lines += `次:${nextPeriod}限 ${next.subject} | ${next.teacher || "?"}${labelStr}`;
    }
  }

  if (periodInfo.phase === "休み時間" || periodInfo.phase === "昼休み" || periodInfo.phase === "课前") {
    // Find what's coming next
    const targetPeriod = periodInfo.phase === "昼休み" ? 5 :
                         periodInfo.phase === "课前" ? 1 :
                         (getCurrentPeriod(minuteOfDay + periodInfo.minutesUntilNext, dayOfWeek).period || 1);
    if (targetPeriod) {
      const next = dayTimetable.find((p: any) => p.period === targetPeriod);
      if (next) {
        const label = labels[next.subject] || "";
        const labelStr = label ? ` | ${label}` : "";
        const sep = lines ? " " : "";
        lines += `${sep}次:${targetPeriod}限 ${next.subject} | ${next.teacher || "?"}${labelStr}`;
      }
    }
  }

  return lines;
}

/** 初始时间状态 */
export const INITIAL_TIME_STATE: TimeState = {
  game_date: "2018-04-07",
  day_of_week: "土",
  time_of_day: "morning",
  minute_of_day: 480,
  player_age: 16,
  player_stage: "youth",
  timeline_origin: {
    year: 2018,
    age: 16
  }
};
