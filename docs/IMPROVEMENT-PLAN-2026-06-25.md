# earth-0 改进实施方案 v3 (2026-06-26)

> 基于 fate-sandbox-master 对比分析 + 审计文档追踪 + 两轮用户讨论确认。
> 每项独立可验证，改完跑 `npx tsx test.ts` ≥225 passed。

---

## 架构确认

### 你已经做好的东西（之前分析漏掉的）

| 已有 | 位置 | 说明 |
|------|------|------|
| **三段式工作流** | `agents/gm-contract.md` Layer 5 | 结算轮(静默) → 角色轮(静默) → 渲染轮(面向玩家)。三个阶段职责边界清晰：结算轮禁止写叙事，渲染轮禁止调工具。这就是 fate 两段式在 prompt 层面的等价实现。 |
| **信息分级系统** | `engine/types.ts` + `engine/lore.ts` + `engine/state.ts` | VisibilityLevel(common/industry/hidden) × FactLevel(common/familiar/close/intimate) × RevealVisibilityLevel。`getCharacterFacts()` 按关系阶段过滤，`getNPCCharacterImpressions()` 只给 NPC 看 common 级事实。引擎级过滤，不是纯 prompt 请求。 |
| **正文 Lint 引擎** | `engine/audit/lint-rules.ts` | 10 条规则 + 秘密泄露扫描。已在 render_scene 和 /reroll 里调用。 |
| **/reroll** | `tools/tui/reroll.ts` | 保留 lastRenderParams，换叙事角度重写。不重跑结算。 |
| **/redo** | `tools/tui/redo.ts` | 回退到倒数第 N 次输入前，从 turn_backups 恢复。 |
| **场景状态表** | `engine/scenario-tables.ts` | 五张表，NPC agent 自动填角色状态表，GM 填情景表和身份表。 |
| **D6 全部修复** | 6 个工具均已加 saveState | 测试验证：toggle_layer1/spawn_npc_agent/add_calendar_event/spawn_temp_npc/reveal_secret 均已落盘。 |
| **D1/D2/D3 修复** | runWorldTick + getClockParts + 时间戳 | 剧情引擎已接入三处时间推进路径，手机顶栏无 undefined，台账时间戳正确。 |
| **P0-1 数据脑裂修复** | .active_world 已写入 oregairu | data/ 和 worldpacks/oregairu/ 的不知火舞数据已同步。 |
| **M5 家具容器持久化** | _furnitureContainerStore 纳入 saveState/loadState | 测试验证：家具容器存储往返。 |

### 不做/延后

| 项目 | 理由 |
|------|------|
| 洁净室渲染（物理信息隔离） | earth-0 的三段式已在 prompt 层面实现分离。NPC agent 输出是文学文本，渲染模型必须看全文才能正确织入叙事。物理隔离反而会导致误解 NPC agent 的潜台词。 |
| 公开/秘密状态硬拆分 | 已有三套分级系统 + 引擎级过滤，不需要物理分区。earth-0 的 D&D 哲学是"GM 全知，选择性分发"。 |
| NPC agent 情绪标注 | 内心独白已充分表达情绪，再加标签是画蛇添足。 |
| 文风锚点 | 用户另有方案。 |
| 事务性状态修改 (DomainEventToolRunner) | D6 已全修。日常使用中工具崩的概率极低（大部分是同步赋值）。在没有具体爆炸案例前做全架构重构是 premature optimization。等遇到实际 bug 时针对性修。 |
| NPC agent 结构化输出（引擎消费） | 当前链路已完整：NPC 输出 → 表格 → GM 结算轮看到 → GM 手动调 adjust_relation/create_story_hook。自动消费省掉一步手动操作，不是紧迫需求。 |
| 确定性台账压缩 (/compact) | 依赖 D4（任务 1 修完后只需 5 行代码从 turnLog 机械提取）。 |

---

## 任务清单

### 任务 1：D4 修复 — recordTurnLog 的 toolsCalled 填充

**现状**：`tools/action/record_turn_log.ts:21` — `toolsCalled: []`，注释称"引擎自动从本轮工具调用补充"，但引擎从不填充。审计文档 D4，是唯一一个还没修的 D 级问题。

**目标**：台账记录本轮实际调用的工具名。

**边界**：只记录 action/state 类工具，不含 lookup 和 TUI。同工具多次调用只记一次。窗口：上次 commit_turn → 本次 record_turn_log。

**做法**：
1. `engine/state.ts` 加 `_turnToolCalls: string[]`，导出 `pushToolCall(name)` + `drainToolCalls()`
2. 所有 action/state 工具的 execute 开头调 `pushToolCall(this.name)`
3. `recordTurnLog` 里 `toolsCalled: drainToolCalls()`
4. `commit_turn` 开头 drain 一次防残留

**验收**：调 buy_item → record_turn_log → toolsCalled 含 "buy_item"。调 lookup 类 → 不含。225+ tests。

**工作量**：小（~30 行）

---

### 任务 2：正文 Lint 自动 Retry

**现状**：`lintProse()` 正确返回 `needsRetry`，但 `render_scene.ts` 和 `reroll.ts` 只用它打日志——block 命中后没有自动让模型重写。

**目标**：block 级别（pseudo-menu-ending / report-sentence / panel-value-leak / secret-leak-*）命中时，自动喂违规片段给模型重写，最多 3 次。

**边界**：warn 级别仅 log 不 retry。最大 3 次。3 次后仍 block → 返回最后结果 + `retryExhausted`。同时适用 `/reroll`。

**做法**：
1. `render_scene.ts` 加 `while (needsRetry && retries < 3)` 循环
2. 同理改 `reroll.ts`
3. `buildRetryPrompt(prose, findings)` 从 findings 提取违规片段拼纠正 prompt

**验收**：含 `好感度 50` 的正文 → lint needsRetry=true → retry 触发。3 次后 retryExhausted。225+ tests。

**工作量**：中（~60 行）

---

### 任务 3：批量版 NPC Agent 穿着字段 bug 修

**现状**：`spawn_npc_agent`（单数）正确传了 `穿着: (outfit||"").slice(0,30)`，但 `spawn_npc_agents`（批量）第 142 行 `穿着: ""` 永远是空字符串。批量版的 `runOne` 内部已有 `const outfit = getNPCOutfitDesc(npcName)`，只是没传给 createRow。

**目标**：批量版与单数版行为一致。

**做法**：`spawn_npc_agents.ts` 的 `runOne` 里 `穿着: ""` → `穿着: (outfit||"").slice(0,30)`。改 1 行。

**验收**：批量版 createRow 穿着字段非空。225+ tests。

**工作量**：极小（1 行）

---

### 任务 4：`/choice` — 扮演选项可点击按钮

**现状**：render_scene 要求 LLM 输出 4 个扮演选项（`---` 分割线 + `> ① [风格]: "..."`），用户看到后手动输入。

**目标**：正文输出后，自动解析选项渲染为可点击按钮。点击 = 自动发送该选项文本。同时保留完全自由输入。

**做法**：
1. `tools/helpers.ts` 加 `parseRoleOptions(prose)` — 分离正文和选项
2. 调查 pi 框架是否支持 content button 类型
3. 不支持就走 `/choice` TUI 命令：`showMenu` 渲染可选面板
4. render_scene 的 details 里附带 options 数组

**验收**：parseRoleOptions 正确分离正文和 4 个选项。不含选项的正文返回空数组。225+ tests。

**工作量**：中（~50 行 + pi 框架调研）

---

### 任务 5：render_scene 描述修正

**现状**：描述声称"两段式"但 logicModel 变量从未使用。审计 D5。

**目标**：描述与实现一致。不删 logicModel 配置读取（未来可能有用）。

**做法**：改描述和注释（3 行文字）。roadmap Layer 4 ✅ → 🔶。

**验收**：描述不含误导措辞。225+ tests。

**工作量**：极小（3 行）

---

## 执行顺序

```
任务 5 (文档修正)         → 2 分钟
    ↓
任务 1 (D4 toolsCalled)  → 30 分钟
    ↓
任务 3 (批量版穿着 bug)    → 2 分钟
    ↓
任务 2 (Lint retry)      → 40 分钟
    ↓
任务 4 (/choice)        → 40 分钟
    ↓
npx tsx test.ts → ≥225 passed
    ↓
提交
```

总计约 2 小时。5 个任务，零架构改动。
