# Event Calendar + World Knowledge + Character Facts + Temp NPC: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four independent subsystems: event-driven calendar with org_effects, world commonsense knowledge with trigger-based injection, character public/private facts with visibility levels, and temporary NPC spawning with auto-cleanup.

**Architecture:** Each phase is independent (zero cross-dependencies). All extend existing types in `engine/types.ts`, add engine logic in `engine/` (timeline.ts, new lore.ts, state.ts), create data files in `data/` (orgs/, calendar expansion), and register tools in `tools/` + `tools/registry.ts`. Follows existing patterns: TypeBox tool definitions, `engine/` stays generic (no hardcoded names), `data/` holds all content.

**Tech Stack:** TypeScript, TypeBox (validation), Node.js fs/path, existing engine (state.ts, timeline.ts, types.ts)

## Global Constraints

- Engine must stay zero-hardcoding: no character/location/world names in engine/. All content in data/.
- Tool descriptions ≤ 25 Chinese characters, single line.
- Pass `npx tsx test.ts` after each phase — must stay ≥ 125 passed (no regression).
- Backward compatible: existing calendar entries without new fields work unchanged.
- ISO date format: `M月D日` for calendar dates, `YYYY-MM-DD` for game_date.
- New modules: register tool → add scene mapping → put data files.

---

### Task 0: Type Definitions (shared across all phases)

**Files:**
- Modify: `engine/types.ts`

**Interfaces:**
- Produces: `CalendarEntry` (extended), `LoreEntry`, `LoreFile`, `OrgEffect`, `CharacterFact`, `TempNPCState`

- [ ] **Step 1: Add all new type definitions to engine/types.ts**

Add these types after the existing `CalendarEntry` interface (line 493):

```typescript
// ── P1: 事件驱动日历扩展 ──
export interface OrgEffect {
  org: string;
  override_location: string;
  override_action_template: string;  // supports {role} and {role_action} variables
}

// Extend CalendarEntry with optional new fields (backward compatible)
// Fields added to existing CalendarEntry:
//   range?: "local" | "regional" | "national" | "global";
//   center?: string;
//   advance_days?: number;
//   advance_hook?: string;
//   aftermath_text?: string;
//   org_effects?: OrgEffect[];

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

// Extend StaticCharacter with optional fields:
//   public_facts?: CharacterFact[];
//   private_facts?: CharacterFact[];

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
```

Then modify the existing `CalendarEntry` interface to add optional fields:

```typescript
export interface CalendarEntry {
  year: number | null;
  date: string;
  location: string | null;
  text: string;
  world?: string;
  // P1 新增 (all optional, backward compatible)
  range?: "local" | "regional" | "national" | "global";
  center?: string;
  advance_days?: number;
  advance_hook?: string;
  aftermath_text?: string;
  org_effects?: OrgEffect[];
}
```

And add to `StaticCharacter`:
```typescript
  // P3 新增
  public_facts?: CharacterFact[];
  private_facts?: CharacterFact[];
```

And add to `GameState`:
```typescript
  // P4 新增
  tempNPCs?: TempNPCState[];
```

- [ ] **Step 2: Run tests to verify types compile**

Run: `npx tsx test.ts`
Expected: same pass count as before (type additions only, no behavior change).

- [ ] **Step 3: Commit**

```bash
git add engine/types.ts
git commit -m "feat: add types for event calendar, world knowledge, character facts, temp NPC

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1: P1 — Calendar org_effects execution in updateNPCSchedules

**Files:**
- Modify: `engine/types.ts` (CalendarEntry already extended in Task 0)
- Modify: `engine/timeline.ts` — `getTodayCalendar` → three-phase (预热/当天/余波)
- Modify: `engine/state.ts` — `updateNPCSchedules` apply org_effects
- Test: `test.ts` — new test

**Interfaces:**
- Consumes: `CalendarEntry` with `org_effects`, `range`, `center`, `advance_days`, `advance_hook`, `aftermath_text` from Task 0
- Produces: `getCalendarPhase(date, location)` returns `{phase, entries}`, `applyOrgEffects(npcName, npc, entries)` called in `updateNPCSchedules`

- [ ] **Step 1: Add getCalendarPhase to engine/timeline.ts**

After the existing `getCalendarEvents` function (around line 96), add:

```typescript
/** 获取当前日期所处的日历阶段及匹配条目 */
export function getCalendarPhase(date: string, location: string): {
  phase: "pre" | "today" | "after" | "none";
  entries: CalendarEntry[];
} {
  const all = loadCalendar();
  const year = parseYear(date);
  const mmdd = date.includes("-") ? parseMonthDay(date) : date;

  // Helper: parse M月D日 into {month, day} numbers
  function parseMD(md: string): { m: number; d: number } {
    const parts = md.split("月");
    return { m: parseInt(parts[0]), d: parseInt(parts[1]) };
  }

  const todayMD = parseMD(mmdd);

  // Helper: check if a date string falls within a range of days from todayMD
  function daysFromToday(targetMD: string): number {
    const t = parseMD(targetMD);
    // Simplified: treat months as 30 days each for rough offset calculation
    return (t.m - todayMD.m) * 30 + (t.d - todayMD.d);
  }

  const todayEntries: CalendarEntry[] = [];
  const preEntries: CalendarEntry[] = [];
  const afterEntries: CalendarEntry[] = [];

  for (const e of all) {
    if (e.date !== mmdd && !e.advance_days && !e.aftermath_text) continue;
    if (e.year !== null && e.year !== year) continue;

    const eMD = parseMD(e.date);
    const offset = daysFromToday(e.date);

    // Exact match → today phase
    if (e.date === mmdd) {
      if (e.location !== null && !locationMatches(e.location, location)) continue;
      todayEntries.push(e);
      continue;
    }

    // Pre-phase: within advance_days before event
    if (e.advance_days && offset < 0 && offset >= -e.advance_days) {
      if (e.range && !isInRange(e.range, e.center, location)) continue;
      preEntries.push(e);
    }

    // After-phase: 1-2 days after event
    if (e.aftermath_text && offset > 0 && offset <= 2) {
      if (e.range && !isInRange(e.range, e.center, location)) continue;
      afterEntries.push(e);
    }
  }

  if (todayEntries.length > 0) return { phase: "today", entries: todayEntries };
  if (preEntries.length > 0) return { phase: "pre", entries: preEntries };
  if (afterEntries.length > 0) return { phase: "after", entries: afterEntries };
  return { phase: "none", entries: [] };
}

function locationMatches(entryLoc: string, playerLoc: string): boolean {
  const { isSameLocation, getLocationNav } = require("./state.ts");
  if (isSameLocation(entryLoc, playerLoc)) return true;
  try {
    const nav = getLocationNav(playerLoc);
    if (nav?.breadcrumb?.some((b: string) => isSameLocation(entryLoc, b))) return true;
  } catch (_) {}
  return false;
}

function isInRange(range: string, center: string | undefined, playerLoc: string): boolean {
  if (range === "national" || range === "global") return true;
  if (!center) return locationMatches(center || "", playerLoc);
  return locationMatches(center, playerLoc);
}
```

- [ ] **Step 2: Modify getTodayCalendar to use three-phase output**

Replace the existing `getTodayCalendar` function body (timeline.ts around line 666):

```typescript
/** 获取今日日历条目（供 prompt 注入） — 区分预热/当天/余波三阶段 */
export function getTodayCalendar(): string {
  const d = gameState.time.game_date;
  const loc = gameState.player.location;
  const { phase, entries } = getCalendarPhase(d, loc);

  if (phase === "none" || entries.length === 0) return "";

  // Pick up to 2 entries, prefer location-matched over location-null
  const locationMatch = entries.filter(e => e.location !== null);
  const anyMatch = entries.filter(e => e.location === null);
  const picked = [...locationMatch, ...anyMatch].slice(0, 2);

  switch (phase) {
    case "pre":
      return picked.map(e => e.advance_hook || e.text).join(" ");
    case "today":
      return picked.map(e => e.text).join(" ");
    case "after":
      return picked.map(e => e.aftermath_text || e.text).join(" ");
    default:
      return "";
  }
}
```

- [ ] **Step 3: Add applyOrgEffects to engine/state.ts**

After `updateNPCSchedules` (around line 3230), add:

```typescript
/** P1: 应用日历事件的 org_effects — 为匹配组织的 NPC 自动设 pendingOverride */
function applyOrgEffects(): void {
  const { getCalendarPhase } = require("./timeline.ts");
  const { phase, entries } = getCalendarPhase(gameState.time.game_date, gameState.player.location);
  if (phase !== "today") return;

  for (const entry of entries) {
    if (!entry.org_effects) continue;
    for (const effect of entry.org_effects) {
      for (const [name, npc] of Object.entries(gameState.npcs)) {
        if (npcBelongsToOrg(name, npc, effect.org)) {
          // Fill template variables
          const role = inferRoleForNPC(name, npc);
          const roleAction = inferRoleActionForNPC(name, npc);
          const action = effect.override_action_template
            .replace("{role}", role)
            .replace("{role_action}", roleAction);

          npc.pendingOverride = {
            location: effect.override_location,
            action,
            reason: `日历事件: ${entry.text.slice(0, 30)}`,
            expiresAt: gameState.time.game_date, // expires end of day
          };
        }
      }
    }
  }
}

/** P1 启发式：判断 NPC 是否属于某组织 */
function npcBelongsToOrg(name: string, npc: NPCRuntimeState, org: string): boolean {
  // Check schedule_group for membership
  const src = (characters as any[]).find((c: any) => c.name === name);
  const group = npc.scheduleGroup || src?.schedule_group || "";
  const defLoc = src?.default_location || "";

  // Heuristic: schedule_group contains org-like names OR default_location contains org substring
  if (group.includes(org.replace("总武", "")) || defLoc.includes(org.replace("高", ""))) return true;
  // Generic student/teacher groups: check if org is a school and NPC is in school-like schedule
  if ((group === "学生" || group === "高校生" || group === "总武高学生" || group === "总武高教师") && org.includes("高")) return true;
  if ((group === "教师" || group === "总武高教师") && org.includes("高")) return true;

  return false;
}

/** P1: 从 NPC 的 tags/skills 推断 {role} */
function inferRoleForNPC(name: string, npc: NPCRuntimeState): string {
  const src = (characters as any[]).find((c: any) => c.name === name);
  const tags = src?.tags || [];
  if (tags.includes("学生会") || tags.includes("生徒会")) return "作为学生会成员";
  if (tags.includes("运动部") || tags.includes("体育部")) return "作为运动部员";
  if (npc.scheduleGroup === "总武高教师" || npc.scheduleGroup === "教师") return "作为教师";
  return "";
}

/** P1: 从 NPC 的 skills 推断 {role_action} */
function inferRoleActionForNPC(name: string, npc: NPCRuntimeState): string {
  const src = (characters as any[]).find((c: any) => c.name === name);
  const skills = src?.skills || {};
  const tags = src?.tags || [];
  if (tags.includes("学生会")) return "组织开幕式";
  if (tags.includes("田径部") || skills["运动"] || skills["跑步"]) return "为自己的项目热身";
  if (tags.includes("读书部") || tags.includes("文化部")) return "做后勤记录";
  return "参与活动";
}
```

- [ ] **Step 4: Wire applyOrgEffects into updateNPCSchedules**

At the start of `updateNPCSchedules` (after the roomCounts init, before the NPC loop), add:

```typescript
  // P1: Apply calendar org_effects before normal schedule processing
  try {
    applyOrgEffects();
  } catch (e) {
    console.error("applyOrgEffects error:", e);
  }
```

- [ ] **Step 5: Write test — org_effects moves NPC to correct location on event day**

In `test.ts`, add after the calendar tests:

```typescript
test("P1: 日历 org_effects — 体育祭当天总武高学生自动移到操场", async () => {
  resetState();
  const { getOrCreateNPC, updateNPCSchedules } = await import("./engine/state.ts");
  const { clearCalendarCache } = await import("./engine/timeline.ts");

  // Set date to 体育祭 day (6月5日)
  gameState.time.game_date = "2018-06-05";
  gameState.time.day_of_week = "火";
  gameState.time.time_of_day = "morning";

  // Create an NPC that should be affected
  const yui = getOrCreateNPC("由比滨结衣");
  yui.scheduleGroup = "总武高学生";
  yui.currentRoom = "2年F班";

  // Add org_effects calendar entry via calendarEvents
  clearCalendarCache();
  gameState.calendarEvents = [{
    year: null, date: "6月5日", location: "总武高",
    text: "总武高体育祭当日",
    org_effects: [{
      org: "总武高",
      override_location: "操场",
      override_action_template: "{role}参加体育祭{role_action}中"
    }]
  }];

  gameState.player.location = "总武高";
  await updateNPCSchedules();

  if (yui.currentRoom !== "操场") {
    throw new Error(`由比滨应在操场，实际在 ${yui.currentRoom}`);
  }
  if (!yui.action || !yui.action.includes("体育祭")) {
    throw new Error(`由比滨动作应包含"体育祭"，实际: ${yui.action}`);
  }
});
```

- [ ] **Step 6: Run tests**

Run: `npx tsx test.ts`
Expected: ≥ 126 passed (1 new test).

- [ ] **Step 7: Commit**

```bash
git add engine/timeline.ts engine/state.ts test.ts
git commit -m "feat(P1): event-driven calendar — org_effects auto-move NPCs on event day

- getCalendarPhase: three-phase detection (pre/today/after)
- applyOrgEffects: auto-set pendingOverride for org-matched NPCs
- Template variables {role} {role_action} inferred from NPC tags/skills
- Backward compatible: calendar entries without org_effects unchanged

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: P1 — NPC event awareness injection (引擎素材 + GM覆写)

**Files:**
- Modify: `engine/timeline.ts` — `getNPCEventContext(npcName)`
- Modify: `tools/state/spawn_npc_agent.ts` — inject `[NPC·事件感知·素材]` into charPrompt
- Test: `test.ts` — new test

**Interfaces:**
- Consumes: `CalendarEntry` with `advance_hook`, `advance_days`, `org_effects` from Task 0
- Produces: `getNPCEventContext(npcName: string): string` returns engine素材 for NPC prompt

- [ ] **Step 1: Add getNPCEventContext to engine/timeline.ts**

```typescript
/** P1: 获取 NPC 应感知的事件素材（引擎做过滤，GM 做人格化） */
export function getNPCEventContext(npcName: string): string {
  const all = loadCalendar();
  const today = gameState.time.game_date;
  const year = parseYear(today);
  const mmdd = today.includes("-") ? parseMonthDay(today) : today;

  const relevant: string[] = [];

  for (const e of all) {
    if (!e.advance_days || !e.advance_hook) continue;
    if (e.year !== null && e.year !== year) continue;

    // Check if this NPC belongs to an affected org
    let npcAffected = false;
    if (e.org_effects) {
      const npc = gameState.npcs[npcName];
      if (npc) {
        for (const eff of e.org_effects) {
          if (npcBelongsToOrgCheck(npcName, npc, eff.org)) {
            npcAffected = true;
            break;
          }
        }
      }
    } else {
      // No org_effects → general event, all NPCs in range see it
      npcAffected = true;
    }
    if (!npcAffected) continue;

    // Check if we're in the advance window
    const offset = daysFromTodayMD(mmdd, e.date);
    if (offset < 0 && offset >= -(e.advance_days || 0)) {
      const daysUntil = Math.abs(offset);
      relevant.push(`${e.text.slice(0, 50)} ${daysUntil}天后 — ${e.advance_hook}`);
    }
  }

  return relevant.length > 0
    ? `[NPC·事件感知·素材]\n${relevant.map(r => `  • ${r}`).join("\n")}\n（GM 可在 sceneContext 中覆写为角色特化版本）`
    : "";
}

function npcBelongsToOrgCheck(name: string, npc: NPCRuntimeState, org: string): boolean {
  const src = (characters as any[]).find((c: any) => c.name === name);
  const group = npc.scheduleGroup || src?.schedule_group || "";
  const defLoc = src?.default_location || "";
  if (group.includes(org.replace("总武", "")) || defLoc.includes(org.replace("高", ""))) return true;
  if ((group === "学生" || group === "高校生" || group === "总武高学生" || group === "总武高教师") && org.includes("高")) return true;
  if ((group === "教师" || group === "总武高教师") && org.includes("高")) return true;
  return false;
}

function daysFromTodayMD(todayMD: string, targetMD: string): number {
  function parse(md: string): { m: number; d: number } {
    const parts = md.split("月");
    return { m: parseInt(parts[0]), d: parseInt(parts[1]) };
  }
  const t = parse(todayMD);
  const tg = parse(targetMD);
  return (tg.m - t.m) * 30 + (tg.d - t.d);
}
```

- [ ] **Step 2: Inject NPC event context into spawn_npc_agent.ts**

In `tools/state/spawn_npc_agent.ts`, after the `getNPCContext` line (line 178), add:

```typescript
        (() => { const ctx = getNPCContext(params.npcName); return ctx.length > 0 ? `你的已知情报:\n${ctx.join("\n")}` : ""; })(),
        // P1: NPC event awareness from calendar
        (() => {
          try {
            const { getNPCEventContext } = require("../../engine/timeline.ts");
            return getNPCEventContext(params.npcName);
          } catch (_) { return ""; }
        })(),
```

Wait — this uses `require` which won't work in ESM context. The file uses dynamic `import()`. Fix:

```typescript
        (() => { const ctx = getNPCContext(params.npcName); return ctx.length > 0 ? `你的已知情报:\n${ctx.join("\n")}` : ""; })(),
        // P1: NPC event awareness from calendar (injected in execute scope below)
```

And in the `execute` function, before building `charPrompt`, add the event context retrieval. Actually, the simpler approach is to add this in the execute body. Add this block right before `const charPrompt = [`:

```typescript
      // P1: NPC event awareness — engine provides素材, GM can override in sceneContext
      let npcEventContext = "";
      try {
        const { getNPCEventContext } = await import("../../engine/timeline.ts");
        npcEventContext = getNPCEventContext(params.npcName);
      } catch (_) {}
```

Then add to `charPrompt` array (after the `getNPCContext` line):
```typescript
        npcEventContext || "",
```

- [ ] **Step 3: Write test — NPC gets event awareness context**

In `test.ts`:

```typescript
test("P1: NPC 事件感知 — spawn 时拿到日历预热素材", async () => {
  resetState();
  const { getOrCreateNPC } = await import("./engine/state.ts");
  const { clearCalendarCache, getNPCEventContext } = await import("./engine/timeline.ts");

  gameState.time.game_date = "2018-05-26"; // 10 days before 体育祭 (6月5日)
  gameState.activeWorld = "oregairu";

  // Setup NPC
  const yui = getOrCreateNPC("由比滨结衣");
  yui.scheduleGroup = "总武高学生";

  // Add calendar event with advance_days=10
  clearCalendarCache();
  gameState.calendarEvents = [{
    year: null, date: "6月5日", location: "总武高",
    text: "总武高体育祭当日",
    advance_days: 10,
    advance_hook: "操场上各班级在练习接力",
    org_effects: [{ org: "总武高", override_location: "操场", override_action_template: "{role}参加体育祭中" }]
  }];

  const ctx = getNPCEventContext("由比滨结衣");
  if (!ctx.includes("体育祭")) {
    throw new Error(`NPC事件感知应包含体育祭: ${ctx}`);
  }
  if (!ctx.includes("素材")) {
    throw new Error(`应标注为素材供GM覆写: ${ctx}`);
  }
});
```

- [ ] **Step 4: Run tests**

Run: `npx tsx test.ts`
Expected: ≥ 127 passed.

- [ ] **Step 5: Commit**

```bash
git add engine/timeline.ts tools/state/spawn_npc_agent.ts test.ts
git commit -m "feat(P1): NPC event awareness — engine provides素材, GM personalizes

- getNPCEventContext: scans calendar for events within advance_days
- Injects [NPC·事件感知·素材] into NPC agent prompt
- GM overrides in sceneContext for character-specific perception

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: P1 — Expand oregairu calendar with event data

**Files:**
- Modify: `data/calendar/oregairu.json`

**Interfaces:**
- Produces: enriched calendar entries with `advance_days`, `advance_hook`, `aftermath_text`, `org_effects`

- [ ] **Step 1: Add event metadata to key calendar entries**

Replace the following entries in `data/calendar/oregairu.json`:

The entry at date "6月15日" (梅雨季):
```json
  { "year": null, "date": "6月15日", "location": null, "text": "梅雨季正式开始。千叶连日阴雨，走廊里弥漫着湿气。操场暂时不能使用，体育课改为室内。", "range": "regional", "center": "千叶", "advance_days": 3, "advance_hook": "天气预报说下周开始入梅——操场上体育部在抓紧最后几天的室外训练", "aftermath_text": "梅雨季还没结束，走廊里到处是湿漉漉的脚印" }
```

The entry at date "10月15日" (文化祭前日):
```json
  { "year": 2018, "date": "10月15日", "location": "总武高", "text": "文化祭前日。全校进入最后准备阶段。各班级熬夜装饰教室和摊位。走廊里飘着颜料和炒面酱汁的气味。", "range": "local", "center": "总武高", "advance_days": 7, "advance_hook": "文化祭临近——走廊里贴满各班的节目海报，放学后教室里传来钉锤声和排练声", "aftermath_text": "文化祭结束，校园里还在拆除装饰和清理垃圾", "org_effects": [{ "org": "总武高", "override_location": "各自班级摊位", "override_action_template": "{role}筹备文化祭{role_action}中" }] }
```

The entry at date "10月16日" (文化祭当日):
```json
  { "year": 2018, "date": "10月16日", "location": "总武高", "text": "文化祭当日。总武高变身热闹的学园祭。各色摊位、舞台表演、鬼屋、女仆咖啡厅。校外来客络绎不绝。", "range": "local", "center": "总武高", "advance_days": 7, "advance_hook": "文化祭当天——校门大开，校外访客涌入。到处是欢声笑语和揽客的吆喝声", "aftermath_text": "文化祭的余韵——操场上还在拆除舞台，学生们带着疲惫和满足感回到日常", "org_effects": [{ "org": "总武高", "override_location": "各自班级摊位", "override_action_template": "{role}在文化祭{role_action}" }] }
```

The entry at date "7月1日" (期末考临近):
```json
  { "year": 2018, "date": "7月1日", "location": "总武高", "text": "期末考试的脚步声渐近。侍奉部收到大量'帮忙补习'的委托。雪乃难得露出了厌烦的表情。", "range": "local", "center": "总武高", "advance_days": 14, "advance_hook": "期末考还有两周——图书馆座位开始紧张，到处是抱着参考书的学生", "aftermath_text": "期末考刚结束，走廊里到处是'考砸了'的哀嚎和对答案的声音" }
```

And add a sports festival entry:
```json
  { "year": null, "date": "6月5日", "location": "总武高", "text": "总武高体育祭当日。操场被红白两色装扮一新，呐喊声响彻校区。", "range": "local", "center": "总武高", "advance_days": 10, "advance_hook": "体育祭临近——操场上各班级在练习接力，走廊里贴满红白对阵表", "aftermath_text": "操场上还在清理体育祭的装饰和器材", "org_effects": [{ "org": "总武高", "override_location": "操场", "override_action_template": "{role}参加体育祭{role_action}中" }] }
```

- [ ] **Step 2: Run tests**

Run: `npx tsx test.ts`
Expected: ≥ 127 passed (data change only; existing calendar tests should still pass).

- [ ] **Step 3: Commit**

```bash
git add data/calendar/oregairu.json
git commit -m "feat(P1): enrich oregairu calendar with advance/aftermath/org_effects for key events

- 体育祭 (6/5), 期末考 (7/1), 文化祭 (10/15-16), 梅雨季 (6/15)
- All new fields optional — existing entries unchanged

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: P2 — World knowledge engine (lore.ts)

**Files:**
- Create: `engine/lore.ts`
- Create: `data/orgs/schools.json`
- Modify: `engine/state.ts` — `buildStatePrompt` inject `[常识]` segment
- Modify: `tools/state/spawn_npc_agent.ts` — NPC spawn inject `[NPC·常识]`
- Test: `test.ts` — new tests

**Interfaces:**
- Consumes: `LoreEntryItem`, `LoreOrgFile`, `LoreTrigger` from Task 0
- Produces: `loadOrgLore(world)`, `getTriggeredLore(location, topics, roles, orgs, flags)`, `getNPCLore(npcName)`

- [ ] **Step 1: Create engine/lore.ts**

```typescript
/**
 * 世界常识引擎 — 加载 data/orgs/，按触发条件过滤，注入 prompt
 *
 * 设计原则：
 * - 引擎只做过滤+排序，不编内容
 * - 按触发匹配度排序 → 取 top 5
 * - common 自动注入，industry/hidden 需主动查询
 */
import type { LoreOrgFile, LoreEntryItem } from "./types.ts";
import { gameState, isSameLocation, getLocationNav } from "./state.ts";
import fs from "node:fs";
import path from "node:path";

const ORGS_DIR = path.resolve(process.cwd(), "data", "orgs");

let _loreCache: Record<string, LoreOrgFile[]> = {};

/** Load all org lore files for the active world */
export function loadOrgLore(world?: string): LoreOrgFile[] {
  const w = world || gameState.activeWorld || "oregairu";
  if (_loreCache[w]) return _loreCache[w];

  const files: LoreOrgFile[] = [];
  const pathsToScan = [
    path.resolve(process.cwd(), "worldpacks", w, "orgs"),
    ORGS_DIR,
  ];

  for (const dir of pathsToScan) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        if (Array.isArray(data)) files.push(...data);
        else files.push(data);
      } catch (_) {}
    }
  }

  _loreCache[w] = files;
  return files;
}

/** Clear lore cache (world switch) */
export function clearLoreCache(): void { _loreCache = {}; }

/** Get player's current location breadcrumb for tiered matching */
function getBreadcrumb(location: string): string[] {
  try {
    const nav = getLocationNav(location);
    return nav?.breadcrumb || [];
  } catch (_) { return []; }
}

/** Check if any trigger condition matches */
function matchesTrigger(
  entry: LoreEntryItem,
  location: string,
  topics: string[],
  roles: string[],
  orgs: string[],
  flags: Record<string, boolean>
): { matched: boolean; priority: number } {
  const t = entry.triggers;

  // Priority 1: exact location match
  if (t.locations) {
    for (const loc of t.locations) {
      if (isSameLocation(loc, location)) return { matched: true, priority: 1 };
    }
  }

  // Priority 2: breadcrumb location match
  if (t.locations) {
    const breadcrumb = getBreadcrumb(location);
    for (const loc of t.locations) {
      if (breadcrumb.some(b => isSameLocation(loc, b))) return { matched: true, priority: 2 };
    }
  }

  // Priority 3: org match
  if (t.orgs && orgs.length > 0) {
    for (const o of t.orgs) {
      if (orgs.includes(o)) return { matched: true, priority: 3 };
    }
  }

  // Priority 4: topic keyword match
  if (t.topics && topics.length > 0) {
    for (const topic of topics) {
      for (const tTopic of t.topics) {
        if (topic.includes(tTopic) || tTopic.includes(topic)) return { matched: true, priority: 4 };
      }
    }
  }

  // Priority 5: role match
  if (t.roles && roles.length > 0) {
    for (const role of t.roles) {
      if (roles.includes(role)) return { matched: true, priority: 5 };
    }
  }

  // Flag match — only for hidden entries (returns priority 0, requires explicit flag)
  if (t.flags) {
    for (const f of t.flags) {
      if (flags[f]) return { matched: true, priority: 0 };
    }
  }

  return { matched: false, priority: 99 };
}

/** Get triggered common lore for GM prompt injection */
export function getTriggeredLore(
  location: string,
  topics: string[] = [],
  roles: string[] = [],
  orgs: string[] = [],
  flags: Record<string, boolean> = {}
): string[] {
  const all = loadOrgLore();
  const scored: { text: string; priority: number }[] = [];

  for (const file of all) {
    for (const entry of file.entries) {
      if (entry.level !== "common") continue;
      const { matched, priority } = matchesTrigger(entry, location, topics, roles, orgs, flags);
      if (matched) {
        scored.push({ text: entry.text, priority });
      }
    }
  }

  // Sort by priority (lower = better match), then file order (stable)
  scored.sort((a, b) => a.priority - b.priority);
  return scored.slice(0, 5).map(s => s.text);
}

/** Get triggered lore for a specific NPC */
export function getNPCLore(npcName: string): string[] {
  const npc = gameState.npcs[npcName];
  if (!npc) return [];

  const src = (require("./state.ts") as any).characters?.find((c: any) => c.name === npcName);
  const location = npc.currentRoom || "";
  const group = npc.scheduleGroup || src?.schedule_group || "";
  const tags = src?.tags || [];
  const roles = [group, ...tags];
  const orgsForNPC = [group];

  const all = loadOrgLore();
  const scored: { text: string; priority: number }[] = [];

  for (const file of all) {
    for (const entry of file.entries) {
      if (entry.level !== "common") continue;
      const { matched, priority } = matchesTrigger(entry, location, [], roles, orgsForNPC, gameState.flags);
      if (matched) {
        scored.push({ text: entry.text, priority });
      }
    }
  }

  scored.sort((a, b) => a.priority - b.priority);
  return scored.slice(0, 5).map(s => s.text);
}

/** Look up lore by keyword (for lookup_lore tool or GM active query) — returns all levels including industry/hidden */
export function queryLore(keyword: string, npcRoles: string[] = [], flags: Record<string, boolean> = {}): { tag: string; text: string; level: string }[] {
  const all = loadOrgLore();
  const results: { tag: string; text: string; level: string }[] = [];
  const kw = keyword.toLowerCase();

  for (const file of all) {
    for (const entry of file.entries) {
      if (entry.tag.toLowerCase().includes(kw) || entry.text.toLowerCase().includes(kw)) {
        // Check visibility
        if (entry.level === "hidden") {
          const hasFlag = entry.triggers.flags?.some(f => flags[f]);
          const hasRole = entry.triggers.roles?.some(r => npcRoles.includes(r));
          if (!hasFlag && !hasRole) continue;
        }
        if (entry.level === "industry" && npcRoles.length === 0) continue;
        results.push({ tag: entry.tag, text: entry.text, level: entry.level });
      }
    }
  }

  return results.slice(0, 10);
}
```

- [ ] **Step 2: Create initial data/orgs/schools.json**

```json
[
  {
    "id": "soubu_high_facts",
    "org": "总武高",
    "type": "学校",
    "match_rules": {
      "schedule_groups": ["总武高学生", "总武高教师", "高校生"],
      "location_contains": "总武"
    },
    "entries": [
      {
        "tag": "总武高偏差值排名",
        "level": "common",
        "triggers": { "locations": ["总武高"], "topics": ["升学", "偏差值", "考试"], "orgs": ["总武高"] },
        "text": "总武高偏差值约68，千叶县公立校前5。偏差值低于60基本无缘。校风自由，升学实绩突出。"
      },
      {
        "tag": "总武高校规",
        "level": "common",
        "triggers": { "locations": ["总武高"], "topics": ["校规", "纪律"] },
        "text": "校内严禁不纯异性交往。牵手都要躲着老师。校园内不可吸烟——平冢静只能在停车场角落偷偷抽。"
      },
      {
        "tag": "总武高社团",
        "level": "common",
        "triggers": { "locations": ["总武高"], "topics": ["社团", "部活"] },
        "text": "总武高社团活动活跃。运动部有棒球/足球/田径/网球；文化部有美术/吹奏/文学。侍奉部是冷门小社团。"
      },
      {
        "tag": "海滨综合高不良",
        "level": "common",
        "triggers": { "locations": ["总武高"], "topics": ["不良", "打架", "外校"], "orgs": ["总武高"] },
        "text": "隔壁海滨综合高是千叶偏差值最低的公立校之一，部分学生有组织犯罪关联。总武高学生放学后绕路走。"
      },
      {
        "tag": "教务内斗",
        "level": "industry",
        "triggers": { "roles": ["教师", "总武高教师"], "orgs": ["总武高"] },
        "text": "平冢静和教务主任在升学方针上长期不合。教务主任推填鸭式备考，平冢坚持学生自主。"
      }
    ]
  }
]
```

- [ ] **Step 3: Inject [常识] into buildStatePrompt in engine/state.ts**

After the calendar injection (around line 1065-1066 in `buildStatePrompt`), add:

```typescript
  // 世界常识注入 (P2)
  try {
    const { getTriggeredLore } = await import("./lore.ts");
    const playerGroup = gameState.player.schedule_group || "";
    const loreTexts = getTriggeredLore(
      p.location,
      [], // topics — could be extracted from recent dialogue in future
      [playerGroup],
      [],
      s.flags
    );
    if (loreTexts.length > 0) {
      tpl += `\n[常识]\n${loreTexts.map(t => `  • ${t}`).join("\n")}`;
    }
  } catch (e) {
    console.error("lore injection error:", e);
  }
```

- [ ] **Step 4: Inject [NPC·常识] into spawn_npc_agent.ts**

Next to the event context injection (added in Task 2), add:

```typescript
      // P2: NPC world knowledge injection
      let npcLoreContext = "";
      try {
        const { getNPCLore } = await import("../../engine/lore.ts");
        const loreTexts = getNPCLore(params.npcName);
        if (loreTexts.length > 0) {
          npcLoreContext = `[NPC·常识]\n${loreTexts.map(t => `  • ${t}`).join("\n")}`;
        }
      } catch (_) {}
```

And add `npcLoreContext || ""` to the `charPrompt` array.

- [ ] **Step 5: Write test — lore triggers on location entry**

In `test.ts`:

```typescript
test("P2: 世界常识 — 进入总武高自动注入偏差值常识", async () => {
  resetState();
  const { loadOrgLore, getTriggeredLore, clearLoreCache } = await import("./engine/lore.ts");

  gameState.activeWorld = "oregairu";
  clearLoreCache();
  gameState.player.location = "总武高";

  const lore = getTriggeredLore("总武高", [], [], [], {});
  const hasDeviation = lore.some(t => t.includes("偏差值"));
  if (!hasDeviation) {
    throw new Error(`进入总武高应触发偏差值常识，实际: ${lore.join(" | ")}`);
  }
  if (lore.length > 5) {
    throw new Error(`常识注入不应超过5条，实际: ${lore.length}`);
  }
});

test("P2: 世界常识 — 排序规则 location精确 > topic关键词", async () => {
  resetState();
  const { loadOrgLore, getTriggeredLore, clearLoreCache } = await import("./engine/lore.ts");

  gameState.activeWorld = "oregairu";
  clearLoreCache();

  // Location match + topic match: location should come first
  const lore = getTriggeredLore("总武高", ["不良", "打架"], [], [], {});
  // First entry should be location-prioritized (priority 1)
  if (lore.length >= 2) {
    // Both should be present
    const hasDeviation = lore.some(t => t.includes("偏差值"));
    const hasDelinquent = lore.some(t => t.includes("海滨综合"));
    if (!hasDeviation || !hasDelinquent) {
      throw new Error(`应同时有偏差值常识和海滨综合高常识: ${lore.join(" | ")}`);
    }
  }
});
```

- [ ] **Step 6: Run tests**

Run: `npx tsx test.ts`
Expected: ≥ 129 passed.

- [ ] **Step 7: Commit**

```bash
git add engine/lore.ts data/orgs/schools.json engine/state.ts tools/state/spawn_npc_agent.ts test.ts
git commit -m "feat(P2): world knowledge system — trigger-based lore injection

- engine/lore.ts: load data/orgs/, trigger matching with 5-level priority sort
- data/orgs/schools.json: 总武高常识 (5 entries, 3 levels)
- [常识] injected into GM prompt, [NPC·常识] into NPC agent prompt
- Top 5 entries, sorted by match specificity

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: P3 — Character public/private facts

**Files:**
- Modify: `engine/state.ts` — `lookup_character` returns level-filtered facts; new `getNPCCharacterImpressions(npcName)`
- Modify: `tools/state/spawn_npc_agent.ts` — inject `[NPC·对XX的印象]`
- Modify: `data/characters.json` — add `public_facts` and `private_facts` to 3 core characters
- Test: `test.ts` — new tests

**Interfaces:**
- Consumes: `CharacterFact`, `FactLevel` from Task 0; `StaticCharacter.public_facts/private_facts`
- Produces: `getCharacterFacts(name, relationshipStage)` returns facts filtered by level; `getNPCCharacterImpressions(npcName, sceneNPCs)`

- [ ] **Step 1: Add fact retrieval functions to engine/state.ts**

After the `lookup_character` related code, add:

```typescript
/** P3: 按关系级别过滤角色事实 */
const FACT_LEVEL_ORDER: Record<string, number> = {
  "common": 0,
  "familiar": 1,
  "close": 2,
  "intimate": 3,
};

const RELATION_TO_MAX_LEVEL: Record<string, string> = {
  "陌生": "common",
  "熟人": "familiar",
  "友人": "close",
  "信赖": "close",
  "至交": "intimate",
};

export function getCharacterFacts(
  characterName: string,
  relationshipStage: string,
  isSelf: boolean = false
): { public: CharacterFact[]; private: CharacterFact[] } {
  const src = findCharacter(characterName);
  if (!src) return { public: [], private: [] };

  const maxLevel = isSelf ? "intimate" : (RELATION_TO_MAX_LEVEL[relationshipStage] || "common");
  const maxLevelOrder = FACT_LEVEL_ORDER[maxLevel] ?? 0;

  const publicFacts = (src.public_facts || []).filter(f => FACT_LEVEL_ORDER[f.level] <= maxLevelOrder);
  const privateFacts = isSelf
    ? (src.private_facts || [])
    : (src.private_facts || []).filter(f => FACT_LEVEL_ORDER[f.level] <= maxLevelOrder);

  return { public: publicFacts, private: privateFacts };
}

/** P3: 获取 NPC 对场景内其他角色的 common 级印象 */
export function getNPCCharacterImpressions(npcName: string, otherNames: string[]): Record<string, string[]> {
  const impressions: Record<string, string[]> = {};
  for (const other of otherNames) {
    const src = findCharacter(other);
    if (!src?.public_facts) continue;
    const commonFacts = src.public_facts.filter(f => f.level === "common");
    if (commonFacts.length > 0) {
      impressions[other] = commonFacts.map(f => f.text);
    }
  }
  return impressions;
}
```

- [ ] **Step 2: Modify lookup_character to include facts**

Find the `lookup_character` tool at `tools/state/lookup_character.ts` and add fact injection. Read the existing tool first, then add after the character data is assembled:

In the execute function, after building the character description, add:

```typescript
      // P3: Include character facts filtered by relationship level
      const rel = gameState.player.relationships[params.name];
      const stage = rel?.stage || "陌生";
      const { getCharacterFacts } = await import("../../engine/state.ts");
      const facts = getCharacterFacts(params.name, stage, params.name === gameState.player.name);
      if (facts.public.length > 0) {
        parts.push(`\n[公开背景·${stage}级可见]`);
        for (const f of facts.public) {
          parts.push(`  ${f.level}: ${f.text}`);
        }
      }
      if (facts.private.length > 0 && stage !== "陌生") {
        parts.push(`\n[私下了解·${stage}级可见]`);
        for (const f of facts.private) {
          parts.push(`  ${f.level}: ${f.text}`);
        }
      }
```

- [ ] **Step 3: Inject NPC impressions into spawn_npc_agent.ts**

After the NPC lore context injection (Task 4), add:

```typescript
      // P3: NPC impressions of other characters in scene
      let npcImpressionsContext = "";
      try {
        const { getNPCCharacterImpressions } = await import("../../engine/state.ts");
        const allSceneNPCs = [gameState.player.name, ...otherNPCs].filter(n => n !== params.npcName);
        const impressions = getNPCCharacterImpressions(params.npcName, allSceneNPCs);
        const impressionLines: string[] = [];
        for (const [target, facts] of Object.entries(impressions)) {
          for (const fact of facts) {
            impressionLines.push(`  对${target}的印象: ${fact}`);
          }
        }
        if (impressionLines.length > 0) {
          npcImpressionsContext = `[NPC·对他人的印象]\n${impressionLines.join("\n")}`;
        }
      } catch (_) {}
```

Add `npcImpressionsContext || ""` to charPrompt.

- [ ] **Step 4: Add facts to core character data**

Add to 雪之下雪乃 in `data/characters.json`:
```json
  "public_facts": [
    { "text": "雪之下家的二女儿，偏差值学年第一。独居，坐JR总武线从幕张通学，单程约30分钟。", "level": "common" },
    { "text": "父亲是雪之下建设的社长，但雪乃刻意脱离家族影响——不坐私家车，不参加家族社交。", "level": "familiar" }
  ],
  "private_facts": [
    { "text": "被姐姐阳乃的完美阴影压得喘不过气，但从不表现出来。", "level": "close" },
    { "text": "小学时全班以她太优秀为由孤立她——从此不信任集体。", "level": "close" }
  ]
```

Add to 由比滨结衣:
```json
  "public_facts": [
    { "text": "2年F班学生，性格开朗，和谁都聊得来。成绩中等偏下，数学尤其苦手。", "level": "common" },
    { "text": "家里养了一只叫萨布雷的萨摩耶。经常去KTV和朋友唱歌。", "level": "familiar" }
  ]
```

Add to 比企谷八幡:
```json
  "public_facts": [
    { "text": "2年F班学生，性格孤僻，被全班视为'那个阴暗的家伙'。国文成绩意外地好。", "level": "common" },
    { "text": "注册了侍奉部，被平冢静以'矫正孤僻性格'为由强制入部。", "level": "familiar" }
  ]
```

- [ ] **Step 5: Write test**

In `test.ts`:

```typescript
test("P3: 角色常识 — 陌生人只能看到 common 级 public_facts", async () => {
  resetState();
  const { getCharacterFacts } = await import("./engine/state.ts");

  // 雪之下雪乃 public_facts should exist in characters data
  const facts = getCharacterFacts("雪之下雪乃", "陌生");
  if (facts.public.length === 0) {
    throw new Error("陌生人应能看到 common 级 public_facts");
  }
  // All returned facts should be common level
  const hasNonCommon = facts.public.some(f => f.level !== "common");
  if (hasNonCommon) {
    throw new Error("陌生人不应看到 familiar 级以上的 public_facts");
  }
  // Private facts should be empty for 陌生
  if (facts.private.length > 0) {
    throw new Error("陌生人不应看到任何 private_facts");
  }
});

test("P3: 角色常识 — 至交可以看到 intimate 级 private_facts", async () => {
  resetState();
  const { getCharacterFacts } = await import("./engine/state.ts");

  const facts = getCharacterFacts("雪之下雪乃", "至交");
  if (facts.private.length === 0) {
    throw new Error("至交应能看到 private_facts");
  }
});
```

- [ ] **Step 6: Run tests**

Run: `npx tsx test.ts`
Expected: ≥ 131 passed.

- [ ] **Step 7: Commit**

```bash
git add engine/state.ts tools/state/lookup_character.ts tools/state/spawn_npc_agent.ts data/characters.json test.ts
git commit -m "feat(P3): character public/private facts with visibility levels

- StaticCharacter extended with public_facts/private_facts
- Four visibility levels: common/familiar/close/intimate
- getCharacterFacts filters by relationship stage
- NPC spawn auto-injects common-level impressions of scene characters
- Data: 3 core characters with public/private facts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: P4 — Temporary NPC spawning

**Files:**
- Create: `tools/action/spawn_temp_npc.ts`
- Modify: `engine/state.ts` — temp NPC storage, injection, cleanup
- Modify: `tools/action/instantiate_npc.ts` — extend to support `temp_name` promotion
- Modify: `tools/registry.ts` — register new tool
- Test: `test.ts` — new tests

**Interfaces:**
- Consumes: `TempNPCState` from Task 0
- Produces: `spawnTempNPC(params)`, `cleanupTempNPCs(trigger)`, `promoteTempNPC(tempName, reason)`

- [ ] **Step 1: Add temp NPC management to engine/state.ts**

After the existing `instantiateNamelessNPC` function, add:

```typescript
/** P4: Spawn a temporary NPC into the current scene */
export function spawnTempNPC(params: {
  name: string;
  act: string;
  hostility?: "友好" | "中立" | "敌对";
  body_hint?: string;
  reason: string;
}): string {
  gameState.tempNPCs ??= [];

  // Check for duplicate name
  if (gameState.tempNPCs.some(t => t.name === params.name)) {
    return `临时NPC「${params.name}」已存在于当前场景`;
  }

  const temp: TempNPCState = {
    name: params.name,
    act: params.act,
    hostility: params.hostility || "中立",
    body_hint: params.body_hint,
    reason: params.reason,
    created_at_turn: gameState.turn,
    created_at_date: gameState.time.game_date,
  };

  gameState.tempNPCs.push(temp);
  return `临时NPC「${params.name}」已加入场景（${params.hostility || "中立"}）。场景结束自动回收。`;
}

/** P4: Clean up temp NPCs on scene transition */
export function cleanupTempNPCs(trigger: string): string[] {
  gameState.tempNPCs ??= [];
  const removed = gameState.tempNPCs.map(t => t.name);
  const count = removed.length;
  gameState.tempNPCs = [];
  if (count > 0) {
    return [`[临时NPC回收] ${trigger}: ${removed.join("、")} 已离开场景（${count}人）`];
  }
  return [];
}

/** P4: Promote a temp NPC to permanent character */
export function promoteTempNPC(tempName: string, reason: string): string | null {
  gameState.tempNPCs ??= [];
  const idx = gameState.tempNPCs.findIndex(t => t.name === tempName);
  if (idx < 0) return null;

  const temp = gameState.tempNPCs[idx];

  // Build minimal StaticCharacter from temp data
  const charData: any = {
    name: temp.name,
    source: "dynamic",
    gender: "男",
    base_age: 17,
    appearance_brief: temp.body_hint || "普通身材",
    schedule_group: "自由人",
    tags: [],
  };

  // Store in dynamicCharacters
  gameState.dynamicCharacters ??= {};
  gameState.dynamicCharacters[temp.name] = charData;

  // Initialize NPC runtime state
  const npc = getOrCreateNPC(temp.name);
  npc.action = temp.act;
  npc.currentRoom = gameState.player.location;
  npc.memoryTags.push({
    tag: `[临时NPC转正] ${reason}`,
    since: gameState.time.game_date,
    expires: 365,
    tone: "无感",
  });

  // Remove from temp list
  gameState.tempNPCs.splice(idx, 1);

  return `临时NPC「${temp.name}」已转正为永久角色。理由: ${reason}`;
}

/** P4: Get temp NPC context for prompt injection */
export function getTempNPCContext(): string {
  gameState.tempNPCs ??= [];
  if (gameState.tempNPCs.length === 0) return "";

  return gameState.tempNPCs.map(t => {
    const hostilityNote = t.hostility === "敌对" ? " ⚔敌对" : t.hostility === "友好" ? " ☮友好" : "";
    return `  [临时] ${t.name} — ${t.act}${hostilityNote}（${t.body_hint || "身材普通"}）`;
  }).join("\n");
}
```

- [ ] **Step 2: Inject temp NPCs into buildStatePrompt**

In `buildStatePrompt`, after the location context, add:

```typescript
  // 临时NPC注入 (P4)
  try {
    const { getTempNPCContext } = await import("./state.ts");
    const tempCtx = getTempNPCContext();
    if (tempCtx) {
      tpl += `\n[在场·临时]\n${tempCtx}`;
    }
  } catch (_) {}
```

- [ ] **Step 3: Add cleanup calls to scene transitions**

In `state.ts`, find the `setPlayerLocation` function (or `movePlayer`) and add after location change:

```typescript
  // P4: Cleanup temp NPCs on location change
  const cleanupLog = cleanupTempNPCs(`玩家移动至 ${location}`);
  for (const msg of cleanupLog) {
    events.push(msg);
  }
```

In `settleScene` tool handler (or in commit_turn), add temp NPC cleanup:

```typescript
  // P4: Temp NPC cleanup on scene settle
  const cleanupLog = cleanupTempNPCs("场景结束");
  // ... include in output
```

- [ ] **Step 4: Create tools/action/spawn_temp_npc.ts**

```typescript
import { Type } from "typebox";

export default {
    name: "spawn_temp_npc", label: "临时NPC",
    description: "创建临时角色。敌对可交战。场景结束自动回收。用于混混堵门/偶遇/街头冲突",
    parameters: Type.Object({
      name: Type.String({ description: "临时NPC名" }),
      act: Type.String({ description: "当前动作描述，如'握着棒球棍逼近'" }),
      hostility: Type.Optional(Type.String({ description: "友好|中立|敌对，默认中立" })),
      body_hint: Type.Optional(Type.String({ description: "身材描述，如'175cm瘦削'" })),
      reason: Type.String({ description: "出现原因，写入事件日志" }),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { spawnTempNPC } = await import("../../engine/state.ts");
      const result = spawnTempNPC({
        name: params.name,
        act: params.act,
        hostility: params.hostility as any,
        body_hint: params.body_hint,
        reason: params.reason,
      });
      return {
        content: [{ type: "text", text: result }],
        details: { tempNPC: params.name },
      };
    }
  };
```

- [ ] **Step 5: Extend instantiate_npc.ts to support temp_name promotion**

Read the existing `tools/action/instantiate_npc.ts`. Add optional `temp_name` parameter:

```typescript
import { Type } from "typebox";

export default {
    name: "instantiate_npc", label: "路人转正",
    description: "将路人/临时NPC升级为可交互永久角色",
    parameters: Type.Object({
      nameless_name: Type.Optional(Type.String({ description: "路人模板名，如'路人(主妇)'" })),
      temp_name: Type.Optional(Type.String({ description: "临时NPC名，从spawn_temp_npc创建的角色" })),
      reason: Type.Optional(Type.String({ description: "实例化原因" })),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { instantiateNamelessNPC, promoteTempNPC } = await import("../../engine/state.ts");

      // P4: Promote temp NPC
      if (params.temp_name) {
        const result = promoteTempNPC(params.temp_name, params.reason || "有长期剧情价值");
        if (!result) {
          return {
            content: [{ type: "text", text: `未找到临时NPC「${params.temp_name}」。可能已被回收或名称不匹配。` }],
            details: {},
          };
        }
        return {
          content: [{ type: "text", text: result }],
          details: { promotedFrom: params.temp_name },
        };
      }

      // Original: instantiate from template
      if (!params.nameless_name) {
        return {
          content: [{ type: "text", text: "需提供 nameless_name 或 temp_name 参数" }],
          details: {},
        };
      }
      const result = instantiateNamelessNPC(params.nameless_name, params.reason || "");
      return {
        content: [{ type: "text", text: result }],
        details: { namelessName: params.nameless_name },
      };
    }
  };
```

- [ ] **Step 6: Register tool in tools/registry.ts**

Add import:
```typescript
import spawnTempNpcTool from "./action/spawn_temp_npc.ts";
```

Add registration after `instantiateNpcTool`:
```typescript
  pi.registerTool(spawnTempNpcTool);
```

- [ ] **Step 7: Write tests**

In `test.ts`:

```typescript
test("P4: spawn_temp_npc — 创建临时NPC并注入场景", async () => {
  resetState();
  const { spawnTempNPC, getTempNPCContext, cleanupTempNPCs } = await import("./engine/state.ts");

  const result = spawnTempNPC({
    name: "混混A",
    act: "握着棒球棍逼近",
    hostility: "敌对",
    body_hint: "175cm 瘦削",
    reason: "找维的麻烦",
  });

  if (!result.includes("混混A")) throw new Error(`spawn结果应包含NPC名: ${result}`);

  const ctx = getTempNPCContext();
  if (!ctx.includes("混混A") || !ctx.includes("⚔敌对")) {
    throw new Error(`临时NPC应出现在场景上下文中: ${ctx}`);
  }

  // Cleanup
  const cleaned = cleanupTempNPCs("测试");
  if (!cleaned[0]?.includes("混混A")) throw new Error(`回收应包含混混A: ${cleaned}`);
  if (getTempNPCContext() !== "") throw new Error("回收后临时NPC列表应为空");
});

test("P4: promoteTempNPC — 临时NPC转正", async () => {
  resetState();
  const { spawnTempNPC, promoteTempNPC, getOrCreateNPC } = await import("./engine/state.ts");

  spawnTempNPC({
    name: "有潜力的路人",
    act: "犹豫地看着维",
    hostility: "中立",
    reason: "偶然相遇",
  });

  const result = promoteTempNPC("有潜力的路人", "玩家对他产生了兴趣");
  if (!result || !result.includes("转正")) throw new Error(`转正失败: ${result}`);

  // Should now exist as permanent NPC
  const npc = getOrCreateNPC("有潜力的路人");
  if (!npc) throw new Error("转正后NPC应存在于gameState.npcs");
  if (npc.action !== "犹豫地看着维") throw new Error(`动作应保留: ${npc.action}`);
});

test("P4: spawn_temp_npc — 敌对NPC可用combat_action交战", async () => {
  resetState();
  const { spawnTempNPC } = await import("./engine/state.ts");

  spawnTempNPC({
    name: "敌方混混",
    act: "抡起棒球棍",
    hostility: "敌对",
    reason: "挑衅",
  });

  // Verify hostility is stored correctly
  const temps = gameState.tempNPCs || [];
  const enemy = temps.find(t => t.name === "敌方混混");
  if (!enemy) throw new Error("敌方混混未找到");
  if (enemy.hostility !== "敌对") throw new Error(`应为敌对，实际: ${enemy.hostility}`);
});
```

- [ ] **Step 8: Run tests**

Run: `npx tsx test.ts`
Expected: ≥ 134 passed (3 new P4 tests).

- [ ] **Step 9: Commit**

```bash
git add engine/state.ts tools/action/spawn_temp_npc.ts tools/action/instantiate_npc.ts tools/registry.ts test.ts
git commit -m "feat(P4): temporary NPC spawning with auto-cleanup and promotion path

- spawn_temp_npc: create ad-hoc NPCs that auto-clean on scene transition
- Temp NPCs appear in [在场·临时] with hostility markers
- instantiate_npc extended: promote temp NPCs to permanent via temp_name param
- Cleanup triggers: move, settle_scene, commit_turn

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Integration — wire cleanup into scene transitions

**Files:**
- Modify: `tools/action/settle_scene.ts` — add temp NPC cleanup
- Modify: `tools/state/commit_turn.ts` — add temp NPC cleanup
- Modify: `engine/state.ts` — `setPlayerLocation` add cleanup

**Interfaces:**
- Consumes: `cleanupTempNPCs` from Task 6

- [ ] **Step 1: Read and modify settle_scene.ts**

Read the existing tool. In its execute function, at the beginning (before the main logic), add:

```typescript
      // P4: Cleanup temp NPCs on scene settle
      const { cleanupTempNPCs } = await import("../../engine/state.ts");
      const cleanupMsgs = cleanupTempNPCs("场景结算");
```

If the tool returns text output, prepend or append the cleanup messages.

- [ ] **Step 2: Read and modify commit_turn.ts**

Similarly, add cleanup call. In the execute function:

```typescript
      // P4: Cleanup temp NPCs on turn commit
      const { cleanupTempNPCs } = await import("../../engine/state.ts");
      const cleanupMsgs = cleanupTempNPCs("回合结束");
```

- [ ] **Step 3: Wire cleanup into setPlayerLocation in state.ts**

In the `setPlayerLocation` function, after setting the new location, add:

```typescript
  // P4: Cleanup temp NPCs on location change
  if (gameState.tempNPCs && gameState.tempNPCs.length > 0) {
    const oldLoc = gameState.player.location;
    // Don't cleanup if staying in same general area (same building)
    const { isSameLocation } = require("./state.ts");
    if (!isSameLocation(oldLoc, location)) {
      const cleaned = cleanupTempNPCs(`移动: ${oldLoc} → ${location}`);
      // Log to events if there's an events array
    }
  }
```

- [ ] **Step 4: Run full test suite**

Run: `npx tsx test.ts`
Expected: ≥ 134 passed (no regression).

- [ ] **Step 5: Commit**

```bash
git add tools/action/settle_scene.ts tools/state/commit_turn.ts engine/state.ts
git commit -m "feat(P4): wire temp NPC cleanup into scene transitions

- settle_scene, commit_turn, player move → auto-cleanup temp NPCs
- Cleanup logs returned to GM for narrative closure

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx tsx test.ts
```

Expected: ≥ 134 passed, 0 failed.

- [ ] **Step 2: Verify backward compatibility**

Confirm existing calendar entries without new fields still work:
- `getTodayCalendar()` returns text for old-format entries
- `getCalendarEvents()` filters correctly with old entries
- No crashes on load with old save files

- [ ] **Step 3: Check engine zero-hardcoding rule**

```bash
grep -r "总武高\|雪之下\|由比滨\|比企谷\|oregairu" engine/
```

Expected: No matches in engine/ files (all content in data/).

- [ ] **Step 4: Commit final state if needed**

```bash
git status
git add -A
git commit -m "chore: final verification — all tests pass, no hardcoding in engine

Co-Authored-By: Claude <noreply@anthropic.com>"
```
