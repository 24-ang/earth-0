# earth-0 新模块开发模板

> 适用：赌博、季节事件、买房、或其他任何新增游戏系统。
> 遵循此模板 = 零额外优化成本。

---

## 约定 1：工具注册格式

```ts
pi.registerTool({
  name: "verb_noun",           // 小写下划线，动词在前
  label: "中文标签",            // 2-4字
  description: "做什么。action值用|分隔。何时不该用。",
  // 目标：≤40个token（约25中文字）
  parameters: Type.Object({
    // 每个参数必须有 description，≤15 tokens
    param1: Type.String({ description: "参数说明" }),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    // 1. import engine函数
    // 2. 调用
    // 3. saveState()
    // 4. return { content: [...] }
  },
});
```

### 描述模板速查

| 场景 | 模板 |
|------|------|
| 查询类 | `"查询XXX。按YYY过滤。"` |
| 动作类 | `"XXX。action: 值1\|值2\|值3。条件限制。"` |
| 生成类 | `"剧情生成XXX放入背包。须提供source和reason。禁止绕过正常获取。"` |
| 结算类 | `"YYY结算。传入参数1(选项1\|选项2)和参数2。"` |

---

## 约定 2：场景→工具映射

在 `engine/state.ts` 的 `buildStatePrompt` 函数的场景检测中（如果已存在），
为新模块的工具添加映射条目：

```ts
// 示例：新增赌博模块
gamble: ["place_bet", "check_odds", "collect_winnings"],

// 示例：新增季节事件模块
season: ["check_festival", "participate_event", "season_info"],

// 示例：新增买房模块
housing: ["browse_property", "purchase_house", "renovate_house"],
```

**作用**：buildStatePrompt 根据当前 gameState.mode 自动注入场景提示，
告诉 LLM 该优先用哪些工具。不需要 LLM 背下来全部 50+ 个工具。

---

## 约定 3：Prompt 注入块

如果新模块需要在每次 prompt 中注入上下文信息，
在 `engine/state.ts` 的 `buildStatePrompt` 函数中按以下格式添加：

```ts
// [模块名] 关键信息（最多3行）
if (gameState.xxxCondition) {
  tpl += `\n[模块名] ${info1} | ${info2}`;
}
```

### 注入块格式规则

- 标签用中文方括号：`[模块名]`
- 每块不超过 3 行
- 信息密度高（管道符分隔多个字段）
- 只有激活时才注入（用 if 条件守卫）

---

## 约定 4：数据文件位置

| 数据类型 | 位置 | 格式 |
|---------|------|------|
| **角色卡** | `worldpacks/{世界}/characters/{角色名}.json`（一人一文件，真相源，141个）。旧平面 `characters.json` 已删，`data/` 兜底为空 `[]` | 单个角色对象：name/source/outfits/equipment/body/personality_stages/`stages`/`sex_profile`/... |
| **角色阶段标签**（旧 character_stages.json） | 已内联进角色卡的 `stages` / `stages_if` 字段 | `loadActiveWorld` 从各卡投影出 `charStages`（键=角色名，`_if` 后缀=分支）；空才回退旧平面文件 |
| **性档案**（旧 sex_profiles.json） | 已内联进角色卡的 `sex_profile` 字段 | `loadActiveWorld` 投影出 `sexProfilesData`；空才回退旧平面文件 |
| 静态配置 | `data/模块名.json`（跨世界）或 `worldpacks/{世界}/模块名.json`（世界专属） | JSON 对象或数组 |
| 剧情时间线 | `worldpacks/{世界}/timelines/弧名.json`（优先）；`data/timelines/` 仅兜底模板 | 单条 TimelineEvent |
| 日历事件 | `worldpacks/{世界}/calendar.json`（优先）；`data/calendar/` 仅兜底模板 | CalendarEntry 数组 |
| 区域设定 | `worldpacks/{世界}/locations/区域名.json`（优先）；`data/region_contexts.json` 仅兜底 | 单条目 {keys, context, social_norms?} |
| 城市地图 | `worldpacks/{世界}/city_map.json` | region→landmarks + transit 线路（详见约定7） |
| 房间实体 | `worldpacks/{世界}/rooms.json` | 一地点一 grid（cells/exit/atmosphere，详见约定7） |
| 物品总表 | `worldpacks/{世界}/items.json`（改结构后 `data/items.json` 要 sync 同步，否则启动"脑裂自检"按顶层键数误报） | 5 分类桶 weapons/armor/tools/consumables/clothing。**服装一律放 clothing 桶，每条必须带 `name`+`type`**（别加顶层独立键——会被 `buildCatalogLookup` 误当容器遍历）；缺服装时引擎只合成无重量/效果的兜底，flavor 以角色卡手写为准 |
| 世界秘密 | `worldpacks/{世界}/secrets/秘密名.json`（优先）；`data/world_secrets.json` 仅兜底 | 单条目 {id, content, fromLevel, toLevel} |
| 组织常识 | `worldpacks/{世界}/orgs/组织名.json`（优先）；`data/orgs/` 仅兜底模板 | 数组，每元素含 org + match_rules + entries |
| 引擎代码 | `engine/模块名.ts` | TypeScript，export 纯函数 |

---

## 约定 5：测试

```bash
# 每加一个新模块，测试数只增不减
npx tsx test.ts  # 当前基准：343 passed, 0 failed（另有 e2e-init 57 / e2e-full 31）

# 新模块至少 2 个测试：
# - 正常路径
# - 边界/错误路径
```

---

## 完整示例：新增"赌博模块"

### 1. 数据文件 `data/gamble.json`
```json
{
  "games": ["骰子", "扑克", "赛马"],
  "max_bet": 100000,
  "house_edge": 0.05
}
```

### 2. 引擎函数 `engine/gamble.ts`
```ts
export function placeBet(game: string, amount: number): string {
  // 校验余额、掷骰子、结算
}
```

### 3. 注册工具（在 `tools/action/` 或 `tools/state/` 下新建文件）

> ⚠️ **不要在 `extension.ts` 里直接 `pi.registerTool`。** 现在所有工具统一在 `tools/registry.ts` 的对应数组里注册，由 `withToolTracking()` 自动追踪工具调用到台账，加新工具只加文件 + 追加数组条目即可。

```ts
// tools/action/place_bet.ts
import { Type } from "@sinclair/typebox";
import type { Tool } from "../../types.ts";

const placeBetTool: Tool = {
  name: "place_bet", label: "下注",
  description: "赌博下注。game: 骰子|扑克|赛马。amount须≤余额。",
  parameters: Type.Object({
    game: Type.String({ description: "骰子|扑克|赛马" }),
    amount: Type.Number({ description: "下注金额" }),
  }),
  async execute(_id, params) {
    const { placeBet } = await import("../../engine/gamble.ts");
    const { saveState } = await import("../../engine/state.ts");
    const r = placeBet(params.game, params.amount);
    saveState();
    return { content: [{ type: "text", text: r }] };
  },
};

export default placeBetTool;
```

然后在 `tools/registry.ts` 的 `actionTools` 数组里追加一行：
```ts
import placeBetTool from "./action/place_bet.ts";
// ...
export const actionTools = [ ..., placeBetTool ];
```

### 4. 场景映射（在 engine/state.ts 的 buildStatePrompt 中）
```ts
gamble: ["place_bet", "dice_roll"],
```

### 5. 不需要改的东西
- `buildStatePrompt` — 如果赌博不影响 prompt 注入
- 现有工具 — 互不干扰
- 测试 — 只加不减

---

## 检查清单（新模块提 PR 前）

- [ ] 所有工具 description ≤ 40 tokens
- [ ] 所有参数有 description
- [ ] 引擎函数在 `engine/` + 数据在 `data/`
- [ ] 场景映射已添加
- [ ] `npx tsx test.ts` 测试数 ≥ 343（在原有基准上只增不减）
- [ ] 不包含任何硬编码的题材特定内容（人物名、地名、作品名）
- [ ] 如有世界设定，放入 `worldpacks/{世界}/` 对应子目录，`data/` 仅兜底。sync 两份
- [ ] **工具 description 不手写会过时的枚举值**。值多或来源在 JSON 文件 → 点 LLM 去 `lookup_xxx` 查。值少（≤10）且稳定 → 直接列
- [ ] Phase 1 需加 `spawn_temp_npc` 白名单（如果工具与场景填充相关）
- [ ] **引擎函数不用 `require()` 用 `await import()`**。ESM 模式下 `require()` 抛 ReferenceError
- [ ] **静默 catch 必打日志**：`catch (e) { console.error("函数名: 描述", e); }`
- [ ] **叙事注入优先于物理拦截**。如通勤偶遇——不建房间+不移NPC+不拦流程，纯 prompt 注入比物理机制更轻更灵活

---

## 引擎级模块模式（如 Vicky 政治经济学系统）

上面的模板适用于加单个工具。当新模块涉及引擎层面的模拟逻辑时，需额外处理：

### 模式 A：引擎自转函数（在 settlement tick 中调用）

```ts
// engine/timeline.ts — 或新建 engine/new-system.ts
export function applyNewSystemEffect(): void {
  // 遍历 gameState.xxx，根据 worldState 或时间推进自动调整数值
}

export function evaluateNewSystem(): { orgId: string; alert: string }[] {
  // 根据阈值判定状态转换 → 返回叙事告警
  // 存储告警到 (gameState as any)._lastXxxAlerts 供 Phase 3 注入
}

export function applyNewSystemDrivesToNPC(): void {
  // 将系统状态转换为 NPC 的 current_drives
}
```

**调用链**：settlement tick → `applyWorldStateToOrgs` → `evaluateOrgGoals` → `applyOrgDrivesToNPC`（均为同步，不需要 await）

### 模式 B：lookup table 反应系统（不调 LLM）

```ts
// engine/npc-reactions.ts
const REACTION_TABLE: Record<string, (params: any) => ReactionEntry[]> = {
  tool_name: (params) => { /* lookup → decide mode → return entries */ },
};

export function processNpcReactions(toolName: string, params: any): ReactionEntry[] {
  // 查表 → 写 pendingOverride → saveState()
}
```

**注入点**：`tools/registry.ts` 的 `withToolTracking` wrapper（工具执行成功后自动调用）

### 模式 C：Phase 2 / Phase 3 注入

| 注入位置 | 文件 | 方法 |
|---------|------|------|
| Phase 2 NPC context | `tools/helpers.ts` `buildTodayContext` | 读取 gameState 字段 → 拼 strings 注入 NPC prompt |
| Phase 2 NPC intent | `tools/helpers.ts` `parseNpcIntent` / `parseScheduleIntent` | 从 NPC 回应末尾提取 JSON → 写 gameState |
| Phase 3 render | `engine/phase3-render.ts` `buildRenderSystemPrompt` | 读 gameState 字段 → 拼 parts[] → 注入渲染 prompt |
| Phase 1 classifier | `engine/phase1-classifier.ts` | ACTION_WHITELIST + prompt 行 + toolPaths |

### 模式 D：类型扩展

新引擎字段添加到 `engine/types.ts` 的对应 interface（Organization / GameState / NPCRuntimeState）。运行时加载时在 `engine/state.ts` 的对应加载函数中自动初始化缺失字段（`.??=` 或 `??`）。

**示例**：`lifecycle_stage` / `ticks_at_stage` / `ticks_at_scale` / `archived` 添加到 `Organization`，在 `loadActiveWorld` 中自动推断。

### 模式 E：注册 Phase 1 工具（三步）

```ts
// 1. engine/phase1-classifier.ts — ACTION_WHITELIST 数组
"contribute_to_org",

// 2. engine/phase1-classifier.ts — buildClassificationPrompt 的提示词
"  🏛️ 组织/势力: contribute_to_org（向势力捐款|完成任务|背叛|招募成员）",

// 3. engine/phase1-classifier.ts — loadTool 的 toolPaths
contribute_to_org: "../tools/action/contribute_to_org.ts",
```

**缺失任何一步 → LLM 不知道该工具存在 → 永远不会调用。**

---

## 约定 6：角色卡字段规范 (characters/*.json)

角色卡是 141 个 NPC 的唯一真相来源（`worldpacks/{世界}/characters/` 下一人一文件）。校验器：`npx tsx engine/validate-characters.ts`。以下字段规格直接影响引擎渲染、状态面板和 LLM 行为。

### 6.1 服装两层描述

| 层级 | 字段 | 读的人 | 粒度 | 引擎行为 |
|------|------|--------|------|---------|
| `outfits.work.desc` | outfits 每套下 | LLM（lookup_character） | 整套搭配感（80-150字） | `getNPCOutfitDesc()` 自动跳过 → 不费 tk |
| `equipment.top.flavor` | equipment 每件下 | 玩家（TUI 状态面板） | 单件质感（20-60字） | 状态面板直接显示 `[上衣] 名称 — flavor` |
| `outfits.work.hair` | outfits 每套下 | LLM | 这套对应的发型（10-20字） | `getNPCOutfitDesc()` 跳过 → 跟 desc 一样 |

```json
{
  "outfits": {
    "work": {
      "hair": "棕色高马尾，利落束在脑后",
      "top": "白色POLO衫",
      "bottom": "运动长裤",
      "desc": "POLO衫下摆扎进紧身运动裤中，因极其突出的巨乳使衣料紧绷…"
    }
  },
  "equipment": {
    "top": {
      "name": "白色POLO衫",
      "flavor": "高透气速干面料。胸前因尺码过饱满有明显拉扯紧绷感。"
    }
  }
}
```

**每件 equipment 的 flavor 跟装备走**——脱了那件就看不到 flavor。outfit 的 desc 是全套一体的。

### 6.2 outfits_by_age：按年龄切换服装

角色 base_age=16 穿校服，玩家 6 岁开局时引擎把 NPC 降龄为 6 岁——穿什么？

```json
"outfits_by_age": {
  "6": "child",
  "12": "teen",
  "16": "school"
},
"outfits": {
  "child": { "hair": "双马尾红色发圈", "top": "小学校服" },
  "teen":  { "hair": "黑长直无蝴蝶结", "top": "中学制服" },
  "school": { "hair": "黑长直披散红丝带", "top": "总武高制服" }
}
```

**降级**：无 `outfits_by_age` 且 ageGap > 3 → 引擎输出 `"115cm，穿着儿童便服（6岁）"` 兜底文字 (`state.ts:2732-2737`)。

### 6.3 卡内 `stages` 字段 vs `personality_stages` 字段

旧 `character_stages.json` 已废，内容内联为每卡的 `stages` 字段，引擎 `loadActiveWorld` 投影成 `charStages`。卡内两个阶段字段各司其职：

| | 卡内 `stages`（旧 character_stages.json） | 卡内 `personality_stages` |
|---|---|---|
| **键格式** | 阶段标签 `"幼儿_小学"` `"中学"` `"高中"` `"成年"` | 年龄数字 `"6"` `"12"` `"16"` `"25"` |
| **注入目标** | Phase 3 场景 NPC 标签（一句话） | NPC Agent 内心独白（多段） |
| **内容特征** | 短标签 "死鱼眼。被强制加入侍奉部。" | 多段心理 "软糯呆板…内心敏感脆弱…" |

**两套独立运行，内容不应相同**。`stages_if`（分支阶段）投影为 `charStages` 的 `{角色名}_if` 键。

### 6.4 equipment.effects

`effects` 是引擎属性系统——不是装饰：

| 效果类型 | 引擎用途 |
|---------|---------|
| `ac_bonus` | `calcAC()` 加护甲值 |
| `damage_reduction` | `combat.ts` 减伤 |
| `unlock` | `state-grid.ts` 钥匙开门 |
| `disguise_tag` | `state.ts:1104` 伪装身份 |
| `communication` | `phone.ts` 判断有没有手机 |
| `pocket` | `state.ts:1951` 衣服口袋加容量 |

普通衣服 `effects: []` 没问题。有游戏功能的装备（防弹衣、钥匙、手机）必须填对。

### 6.5 生成提示词

- 新建角色：`docs/角色卡生成提示词.md`（300+ 字段完整版，发给 LLM 带图）
- 修补服装细节：`docs/角色卡服装装备修正提示词.md`（只输出 outfits+equipment 补丁）

---

## 约定 7：新增可行走地点（地图扩建）

地点数据有**两套并存的系统**，别混：

| 系统 | 文件 | 喂给谁 | 作用 |
|------|------|--------|------|
| 城市地图 | `worldpacks/{世界}/city_map.json` | `_landmarkToRegion`（`resolveLocationToRegion`）+ 车站/区域显示 | region→landmarks 列表、transit 线路 |
| 房间实体 | `worldpacks/{世界}/rooms.json` | `ROOMS`（`getRoom`）+ 棋盘渲染 | 一地点一 grid（cells/exit/furniture/atmosphere） |
| 导航树 | `worldpacks/{世界}/locations/*.json`（约定4 的"区域设定"） | `buildLocationTree`（面包屑/兄弟/子节点显示） | 层级导航展示，**不是移动硬门槛** |

**能不能走进去，取决于 `go_to_location`**（`tools/lookup/go_to_location.ts`）：目的地满足其一即可——① 是 city_map 某 region 的 landmark；② `getRoom(dest)` 命中 rooms.json；③ 在 `known_locations`；④ school_map 教室。命中后设 `pendingTravel` → `complete_travel` → `moveTo`（`setPlayerLocation`+`stampRoom`）→ `getRoom` 渲染 grid。

**加一个可行走城市地点的最小步骤：**
1. `rooms.json` 加一条 room（grid + `atmosphere` + 一个 `type:"exit"` 格子 `exitTo` 回枢纽 `千葉駅前`）。**光加 city_map landmark 不够**——没 room 实体走进去不渲染 grid（现有"稲毛海岸"就只是住宅街 grid）。
2. `city_map.json` 对应 region 的 `landmarks[]` 追加地点名。新区就在 `regions` 加一条 `{label, parent, landmarks[], feel, stations?}`。
3. 若要 grid 内互通（街道↔店内），两边各放一个 `exitTo` 对方的 exit 格子（双向）。

**卫星地点的现状模式（照抄，别自作主张）**：稲毛海岸/苏我/栄町等只**单向** `exitTo` 回 `千葉駅前`，进来靠 `go_to_location`；枢纽里**没有**到它们的反向格子。别去改枢纽加反向格子——不符合现状也没必要。

**分寸（守"引擎守恒"）**：room 只写空间骨架 + `atmosphere` 氛围文字；里面有谁、发生什么交 LLM 现编（场景导演 `spawn_temp_npc`）。**不在 rooms.json 硬编码 NPC 或剧情。**

**验证**：改世界数据跑 `npx tsx e2e-init-test.ts`（含导航链）；`getRoom(新地点)` 应非空；每个新 exit 的 `exitTo` 必须命中已存在的 room key（否则走进去出不来）。
