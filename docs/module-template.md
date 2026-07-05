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
| 静态配置 | `data/模块名.json`（跨世界）或 `worldpacks/{世界}/模块名.json`（世界专属） | JSON 对象或数组 |
| 剧情时间线 | `worldpacks/{世界}/timelines/弧名.json`（优先）；`data/timelines/` 仅兜底模板 | 单条 TimelineEvent |
| 日历事件 | `worldpacks/{世界}/calendar.json`（优先）；`data/calendar/` 仅兜底模板 | CalendarEntry 数组 |
| 区域设定 | `worldpacks/{世界}/locations/区域名.json`（优先）；`data/region_contexts.json` 仅兜底 | 单条目 {keys, context, social_norms?} |
| 世界秘密 | `worldpacks/{世界}/secrets/秘密名.json`（优先）；`data/world_secrets.json` 仅兜底 | 单条目 {id, content, fromLevel, toLevel} |
| 组织常识 | `worldpacks/{世界}/orgs/组织名.json`（优先）；`data/orgs/` 仅兜底模板 | 数组，每元素含 org + match_rules + entries |
| 引擎代码 | `engine/模块名.ts` | TypeScript，export 纯函数 |

---

## 约定 5：测试

```bash
# 每加一个新模块，测试数只增不减
npx tsx test.ts  # 当前基准：281 passed, 0 failed（+ npx tsx e2e-test.ts 45 + npx tsx e2e-init-test.ts 57 = 383 total）

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
- [ ] `npx tsx test.ts` 测试数 ≥ 281（+ e2e-test.ts 45 + e2e-init-test.ts 57，在原有基准上只增不减）
- [ ] 不包含任何硬编码的题材特定内容（人物名、地名、作品名）
- [ ] 如有世界设定，放入 `worldpacks/{世界}/` 对应子目录，`data/` 仅兜底。sync 两份
- [ ] **工具 description 不手写会过时的枚举值**。值多或来源在 JSON 文件 → 点 LLM 去 `lookup_xxx` 查。值少（≤10）且稳定 → 直接列
- [ ] Phase 1 需加 `spawn_temp_npc` 白名单（如果工具与场景填充相关）
