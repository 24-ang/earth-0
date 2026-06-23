# LLM 世界共创者：架构升级设计文档

日期：2026-06-23
状态：待审批
目标：让 LLM 从「叙事渲染器」升级为「世界共创者」

---

## 一、问题诊断

### 1.1 根因

**LLM 被设计成「脚本播放器」，不是「世界共创者」。**

整个事件系统的设计思路是「人写 JSON → 引擎读取 → LLM 渲染」，LLM 没有入口可以把自己创造的内容注入事件循环。

### 1.2 四条症状（同一病灶的不同表现）

#### 症状 1：LLM 不能注入剧情钩子

`engine/timeline.ts` 的 `checkTimelineEvents()` 只从 `data/timelines/` 和 `worldpacks/` 读取静态 JSON 文件，创建 `Hook` 对象放入 `gameState.active_hooks`（全局上限 3 个）。LLM 没有任何工具或路径能把自创的内容写入 `active_hooks`。

后果：LLM 造了一个新角色、设了日历事件、写了情景表——什么都做了，但玩家永远看不到 `[剧情钩子]` 指向这些 LLM 创造的内容。引擎不认。

#### 症状 2：LLM 创建的角色只有骨架

对比预制角色（JSON 中手写的）和 LLM 能创建的角色：

| 字段 | 预制角色（由比滨结衣） | `create_character` 工具 |
|------|----------------------|------------------------|
| `name` / `gender` / `base_age` | ✅ | ✅ |
| `appearance_brief` | ✅ | ✅ |
| `personality_brief` | ✅ | ❌（只有一句 `personality`，存为 `personality_text`）|
| `personality_stages`（不同年龄段的性格）| ✅ | ❌ |
| `speech_style`（说话风格指令）| ✅ | ❌ |
| `anchors`（情感锚/亲密锚/私人锚，三层背景）| ✅ | ❌ |
| `likes` / `dislikes` | ✅ | ❌ |
| `outfits`（多套换装，school/casual/pe/swim/sleep）| ✅ | ❌ |
| `schedule`（精确到每天时段的行程）| ✅ | ❌（只有 `schedule_group` 一个字符串）|
| `appearance_by_age`（不同年龄的外貌变化）| ✅ | ❌ |
| `body` / `body_by_age` | ✅ | ❌（自动填默认值）|
| `sex_profile` | ✅ | ❌ |
| `equipment` / `inventory` / `skills` / `hp` | ✅ | ❌ |

LLM 即使想写好一个角色，工具也不给它参数入口。

#### 症状 3：NPC 状态变化不产生叙事出口

引擎已有多项动态追踪能力：
- **好感度系统**：`Relationship.affection`（0-100），带历史记录
- **记忆系统**：`NPCRuntimeState.memoryTags`，带情感色调
- **身体系统**：`SexState`（欲望/兴奋/周期/高潮追踪）
- **日程临时脱离**：`pendingOverride`（生病/约定）

但这些状态变化**没有一个会触发引擎产生新钩子**。好感 80 的 NPC 不会主动找玩家，高欲望的 NPC 不会采取行动，记忆里对玩家刻骨铭心的 NPC 下次见面和陌生人一样。社交系统的成果没有叙事出口。

Timeline 触发器的 `affection` 字段只是「已存在事件的门槛检查」——仍需手写 JSON 事件。不是「好感变化自动产生钩子」。

#### 症状 4：路人是文字装饰，不是可交互 NPC

引擎在公共房间生成 1-3 个路人：从 `nameless_npc_templates.json` 的 21 个模板中随机抽取，每个只有 `{name, act, height, gridPos}` 四个字段。它们被注入 GM prompt 的 `[在场路人]` 字段作为环境描写素材。

`lookup_character("路人(主妇)")` → 返回「无此角色」。路人没有角色实体，没有记忆，没有关系，不可交互。LLM 也无法将其「转正」为真正的 NPC。

---

## 二、设计原则

### 引擎算数字，GM 编内容，NPC 有腿有心

```
引擎负责：
  时间推进 / 空间移动 / 数值比较
  钩子生命周期（创建/过期/上限 3）
  NPC 人生事件推进（纯数值状态机，不走 LLM）
  天气 / 疲劳 / 战斗 / 骰子

GM（主 LLM）负责：
  决定要不要产生新钩子
  写钩子文本
  编排叙事、协调冲突
  创建角色 / 地点 / 事件

NPC Agent 负责：
  说话（台词产出）
  写自己的记忆（memory tag）
  更新自己的状态（角色状态表）
  改自己的 pendingOverride（决定去哪）
  改变对玩家的好感
  物品给予 / 给玩家打电话
```

### Token 不随 NPC 数量膨胀

50 个 NPC 在世界上，每 turn 只 spawn 和玩家同处一室的 2-5 个。其他人的 schedule 和人生事件在引擎里纯数值跑，不走 LLM。

### 和现有架构的关系

不推翻。所有改动都是「在现有骨架上加一层」：
- 日程表仍是 NPC 移动的基础
- `pendingOverride` 仍是 NPC 脱离日程的机制（只是现在引擎可以自动设了）
- `active_hooks` 仍是事件入口（只是多了一个 LLM 可写的来源）
- 3 钩子上限不变（天然安全阀）

---

## 三、设计考量（讨论中确认的决策）

### 3.1 是否该放权给 LLM？

**决定：放权。** LLM 造钩子不等于 LLM 改引擎逻辑。三个硬约束不变：
1. 钩子上限 3 —— LLM 疯了一样调 `create_story_hook`，引擎只留 3 个
2. 引擎仍是权威 —— 触发器检查、过期清理、quest 状态机全在引擎手里
3. 世界修改仍走工具链 —— LLM 创造的事件的落地（改 flag / 加物品 / 改关系）必须通过现有校验工具

与 `add_calendar_event` 同一个模式：LLM 注入动态内容，引擎合并到循环。

### 3.2 LLM 何时产钩子？

**被动 + 主动混合：**
- 被动：玩家对 LLM 说「给我编点事件」，LLM 调 `create_story_hook`
- 主动-低调：每 turn 结束时 GM 自己判断「现在该不该生一个钩子」，静默注入（GM prompt 中有相应指令）

### 3.3 生小孩/杀人犯罪可以吗？

**可以。** 通过「NPC 人生事件系统」（改动 D）。引擎追踪事件线，状态变化自动产钩子。NPC 的自主范围划定为「可以改变自己、可以改变自愿协作的对象（如物品给予）、不可以单方面改变其他 NPC 或玩家」。

### 3.4 NPC 意图系统谁填写、谁读取？

**填写：三层来源。**
1. 预制角色 → JSON 里写 `drives_by_age`（设计者写，一次性）
2. LLM 自创角色 → `create_character` 时 GM 顺带填
3. 意图演化 → GM 或 NPC Agent 调用工具更新（目标完成了换新的，遭遇变故转向）

**读取：引擎是主读者。**
- 引擎扫描（零 tk）→ 条件满足 → 产钩子 → GM 只看到钩子
- GM 不背 50 个 NPC 的意图。drivers 对 GM 是透明的，直到变成钩子
- NPC Agent 只读自己的 drives（spawn 时注入 prompt）

### 3.5 不同年龄段的 drives 如何处理？

和 `personality_stages` / `schedule_group_by_age` / `body_by_age` 完全相同的 `_by_age` 模式：

```json
{
  "drives_by_age": {
    "6":  { "drives": ["渴望父母关注"], "goal": "考试考满分" },
    "12": { "drives": ["想被同学认可", "叛逆期萌芽"], "goal": "交到真正的朋友" },
    "16": { "drives": ["渴望摆脱家族阴影"], "goal": "在学生会证明自己" }
  }
}
```

引擎根据 NPC 当前年龄取对应 drives，6 岁的她不会想竞选学生会。

### 3.6 要不要加饥饿/疲劳/如厕等生理数值？

**决定：不追踪。** 日程表已经是生理需求的抽象层——`schedule` 说了「12:00 食堂」就不需要再追踪「饥饿值从 70 降到 30」。加生理条只是多数字要维护，不产生新叙事。

NPC 的真实感来自 LLM 从已有上下文（时间、地点、天气、schedule、性格）自己推断身体感受，不需要引擎塞提示。

---

## 四、七条改动

### 改动 A：LLM 注入钩子 —— `create_story_hook` 工具

**负责方：** GM（主 LLM）+ 引擎

**功能：** GM 调用 `create_story_hook(hook_text, source_npc, urgency, title?, expires_days?, trigger_conditions?)`，引擎创建一个动态事件存入 `gameState.dynamicEvents`，并立刻在 `gameState.active_hooks` 中创建对应的 `Hook`。

**新文件：** `tools/action/create_story_hook.ts`

**引擎改动：** `engine/timeline.ts` 新增 `injectDynamicHook()` 函数

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `hook_text` | string | ✅ | 钩子文本，注入 `[剧情钩子]` |
| `source_npc` | string | ✅ | 发起 NPC（或 "世界"） |
| `urgency` | "low" \| "medium" \| "high" | ✅ | 排序优先级 |
| `title` | string | ❌ | 事件标题 |
| `expires_days` | number | ❌ | 默认 2 天 |
| `trigger` | object | ❌ | 触发条件（location/time_of_day/affection/flags），用于 `checkTimelineEvents` 自动扫描 |

**tk 成本：** 每次调用 ~200 tk（工具调用 + 钩子文本）。全局钩子上限 3 不变。

---

### 改动 B：动态事件注册表

**负责方：** 引擎

**功能：** `gameState.dynamicEvents` 存储 LLM 创建的动态事件。`checkTimelineEvents()` 同时扫描此注册表（不再只读 JSON 文件）。事件被打开/过期后从注册表移除。

**引擎改动：**
- `engine/types.ts`：新增 `DynamicEvent` 类型（轻量版 `TimelineEvent`，无需预定义 beats）
- `engine/state.ts`：`GameState` 新增 `dynamicEvents: DynamicEvent[]`，并持久化到 `session.json`
- `engine/timeline.ts`：`checkTimelineEvents()` 在扫描 JSON 文件后也扫描 `dynamicEvents`

**tk 成本：** 零。纯引擎逻辑。

---

### 改动 C：好感自动产生钩子

**负责方：** 引擎

**功能：** 每次 `updateNPCSchedules()` 或 `checkTimelineEvents()` 时，引擎遍历玩家的 `relationships`：
- 好感 > 70 且该 NPC 三日内未被 spawn（玩家没见到她）
- 该 NPC 的 schedule 和玩家位置在同一区域
- → 自动创建一条 Hook：「XX 好像想见你」，urgency = low

**参数化：** 阈值和冷却期可配置（`data/config.json` 或常量定义）。

**引擎改动：** `engine/timeline.ts` 或 `engine/state.ts` 新增 `checkAffectionDrivenHooks()` 函数

**tk 成本：** 零。纯引擎逻辑。

---

### 改动 D：NPC 人生事件系统

**负责方：** 引擎

**功能：** 引擎追踪 NPC 的跨回合人生事件线，状态变化时自动产钩子。

**第一期支持的事件类型：**

| 事件 | 引擎追踪什么 | 钩子触发时机 |
|------|-------------|-------------|
| 疾病 | `illness: { type, severity, day_started, contagious }` | NPC 连续 3 天没去学校 → 产 hook「XX 好像病了」，severity 高 → 自动 pendingOverride 去医院 |
| 怀孕 | `pregnancy: { day_conceived, father, visible_month }` | 可见月份 → NPC 身体变化 → 产 hook，分娩 → 产 hook「XX 生了一个孩子」+ 新角色自动创建 |
| 犯罪/冲突 | `criminal_record: { type, victim, day, witness }` | 若玩家认识 victim → 产 hook，若 witness 认识玩家 → 产 hook「有人找你问话」 |
| NPC-NPC 冲突 | NPC 关系 tone 变为 "敌视" → 引擎检测两方是否在同一地点 → 产 hook 或 flag | 冲突可能升级 |

**新增类型：**
- `engine/types.ts`：`LifeEvent`、`IllnessState`、`PregnancyState`、`CriminalRecord`
- `engine/state.ts`：`NPCRuntimeState` 新增 `lifeEvents: LifeEvent[]`
- `engine/life-events.ts`：新文件，人生事件状态机（纯引擎，不走 LLM）

**引擎自动解决：** 疾病严重 → 引擎自动设 `pendingOverride { location: "医院" }`。怀孕后期 → schedule 优先权变化。犯罪 → NPC 可能自动迁到新城市（引擎改 default_location + pendingOverride）。

**tk 成本：** 零。纯引擎逻辑。

---

### 改动 E：路人实例化 —— `instantiate_npc` 工具

**负责方：** GM + 引擎

**功能：** GM 调用 `instantiate_npc(nameless_name, reason)` → 引擎从 `nameless_npc_templates.json` 中取模板，调用 `create_character` 流程（自动填默认值），将路人注册为 `StaticCharacter` → 加入 `DYNAMIC_CHARACTERS` 注册表 → 此后该角色可通过 `lookup_character` 查询、可互动、有记忆、可建立关系。

**自动推断（引擎从模板推断）：**
- `act` 如「边打电话边赶路」→ 推断 `schedule_group = "上班族"`
- `height` → 推断大致 body
- 其余字段填合理默认值

**新文件：** `tools/action/instantiate_npc.ts`

**引擎改动：** `engine/state.ts` 新增 `instantiateNamelessNPC(name)` 函数

**tk 成本：** 每次调用 ~500 tk（GM 决定实例化 + 工具调用）。实例化后该 NPC 和预制角色一致。

---

### 改动 F：丰满 `create_character`

**负责方：** 引擎

**功能：** 给 `create_character` 工具增加以下可选参数，不再只产出骨架：

| 新增参数 | 类型 | 说明 |
|---------|------|------|
| `personality_stages` | `Record<string, string>` | 不同年龄段性格 |
| `speech_style` | string | 说话风格指令 |
| `anchors` | `{ emotional, intimate, private }` | 三层背景锚 |
| `likes` | string[] | 喜好 |
| `dislikes` | string[] | 厌恶 |
| `outfits` | `NPCOutfitSet` | 多套换装 |
| `schedule` | `Record<string, string>` | 精确到时段 |
| `schedule_group_by_age` | `Record<string, string>` | 不同年龄段日程 |
| `appearance_by_age` | `Record<string, object>` | 年龄外貌变化 |
| `body_by_age` | `Record<string, Partial<BodyMeasurements>>` | 年龄身材变化 |
| `sex_profile` | string | 性档案引用 |
| `drives_by_age` | `Record<string, { drives: string[], goal: string }>` | 自主意图（配合改动 G） |
| `skills` | `Record<string, number>` | 技能 |
| `tags` | string[] | 标签 |
| `default_location` | string | 默认位置（已有） |

**引擎改动：** `tools/state/create_character.ts` 加参数，`engine/state.ts` 的 `registerDynamicCharacter()` 接收更多字段并写入 `StaticCharacter`

**tk 成本：** 和已有预制角色持平。创建时多消耗一次工具调用（~3k tk 用于填充这些字段），此后该角色每次出现在场景中注入 prompt 的成本和预制角色完全相同。

---

### 改动 G：NPC 自主意图系统

**负责方：** 引擎 + GM + NPC Agent

**功能：** 每个 NPC 有 `drives` 和 `current_goal`。引擎据此：
1. 判断 NPC 是否应该主动接触玩家（好感够 + 目标与玩家相关）→ 自动产 hook
2. 判断 NPC-NPC 互动概率（同室 + drives 兼容/冲突）→ 可能产 hook 或 flag
3. 判断 NPC 是否采取异常行动（pendingOverride）

**数据存储：**
- 预制角色：`data/characters.json` 中加 `drives_by_age` 字段
- 动态角色：`create_character` 工具加 `drives_by_age` 参数（改动 F 的一部分）
- 运行时：`NPCRuntimeState` 加 `current_drives: string[]` 和 `current_goal: string`

**意图演化：**
- 新工具 `set_npc_drives(npcName, drives, goal, reason)` — GM 或 NPC Agent 调用
- NPC Agent 被 spawn 时，可以把「更新自己的 drives/goal」作为可选行动
- 目标完成 → `current_goal` 清空 → 引擎检测到空 goal → 自动产 hook「XX 最近好像没什么目标，有点迷茫」

**新增文件：**
- `tools/state/set_npc_drives.ts`
- `engine/drives.ts`（引擎扫描逻辑）

**引擎扫描伪代码：**
```
for each NPC:
    drives = NPC.current_drives (根据年龄取)
    for each drive:
        if drive 需要玩家在场 and NPC 和玩家在同一区域 and 好感 > 阈值:
            create hook
        if drive 涉及另一个 NPC and 两者同室:
            create flag or hook
        if drive 需要位置变化 and 概率通过:
            set pendingOverride
```

**tk 成本：**
- 引擎扫描：零（纯数值）
- NPC Agent prompt 增量：每个被 spawn 的 NPC 多 ~100 字（自己的 drives/goal）
- `set_npc_drives` 工具调用：~200 tk，偶发

---

## 五、Token 成本汇总

| 改动 | 每 turn 增量 | 每事件/创建 增量 | 说明 |
|------|-------------|-----------------|------|
| A: LLM 注入钩子 | 0 | ~200 tk/次 | 仅在 GM 决定创建时 |
| B: 动态事件注册表 | 0 | 0 | 纯引擎，无 LLM 参与 |
| C: 好感→钩子 | 0 | 0 | 纯引擎，引擎产 hook（hook 文本 ~50 字） |
| D: 人生事件 | 0 | 0 | 纯引擎状态机 |
| E: 路人实例化 | 0 | ~500 tk/次 | 仅在 GM 决定实例化时 |
| F: 丰满角色创建 | 0 | ~3k tk/次 | 创建时一次性成本 |
| G: 自主意图 | 0 | ~200 tk/次 | 引擎扫描零 tk；意图演化工具偶发 |

**关键结论：七条改动中，五条的运行时 LLM tk 成本为零。** A 和 E 仅在 GM 主动调用时消耗。F 仅在创建角色时消耗。开销大头在所有改动完成之前就已经存在且不会被放大。

---

## 六、不改变的东西

- `active_hooks` 全局上限 3，不变
- `open_quest` / `advance_quest` / `abandon_quest` 接口不变
- 日程表仍是 NPC 移动的基础
- `render_scene` 两阶段渲染管线不变
- `spawn_npc_agent` 的基本流程不变
- `saveState()` / `loadState()` 持久化机制不变
- 125 个已有测试不变（新改动需要新测试覆盖）

---

## 七、实现顺序建议

```
第一阶段：引擎基础设施（B + C）
  不涉及新工具，纯引擎改动，改动范围最小
  → B: 动态事件注册表
  → C: 好感自动产钩子

第二阶段：LLM 共创入口（A + E + F）
  给 LLM 工具，让 LLM 能创造新内容
  → A: create_story_hook 工具
  → E: instantiate_npc 工具
  → F: 丰满 create_character

第三阶段：NPC 自主（G + D）
  最复杂，依赖前两阶段的基础
  → G: NPC 自主意图系统
  → D: NPC 人生事件系统
```
