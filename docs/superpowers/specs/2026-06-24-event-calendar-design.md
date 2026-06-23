# 事件驱动 + 世界常识 + 临时 NPC：设计计划书

日期：2026-06-24
状态：待审批

---

## 引子：问题全景

当前 earth-0 的 GM（主 LLM）和 NPC Agent 拥有以下能力缺口——

| # | 问题 | 表现 | 根因 |
|---|------|------|------|
| 1 | 日历事件只是文本 | 文化祭当天 NPC 不会自动去操场，GM 要手动给每个 NPC 调 `schedule_override`（做不到也不该做） | 日历条目无 `org_effects` 字段，引擎不知道事件影响哪些 NPC |
| 2 | NPC 脱离世界时间线 | 由比滨 spawn 时不知道自己报了体育祭、不知道两周后期末考 | NPC Agent prompt 不含日历事件，spawn 流程没注入 |
| 3 | GM 无法创建冲突场景 | 路人只有 `{name, act, height, gridPos}` 四个字段，不能打架/对话/产生记忆。`instantiate_npc` 太重 | 缺少「比文字素材重、比完整角色轻」的临时 NPC 层 |
| 4 | 世界常识无处存放 | 总武高偏差值排名、女子校联谊文化、千叶治安差街区、松树象征地位——GM 和 NPC 都不知道，LLM 凭训练数据脑补 → OOC | `region_contexts.json` 只管地点氛围+社会规范，不管学校/组织/区域的事实性常识 |
| 5 | 地点知识散落 | 小到店铺学校、大到国家——这些地点的常识没有结构化存储和触发机制 | 同上 |

本计划书用三个子系统解决这五个问题。

---

## 第一部分：事件驱动日历

### 解决的问题

问题 1（日历不驱动行为）和问题 2（NPC 脱离时间线）。

### 方案

扩展现有 `data/calendar/*.json` 的条目格式，新增可选字段。**向后兼容**——现有 22 条不加新字段照常工作。

#### 数据结构

```json
{
  "year": null,
  "date": "6月5日",
  "location": "总武高",
  "text": "总武高体育祭当日。操场被红白两色装扮一新，呐喊声响彻校区。",
  "range": "local",
  "center": "总武高",
  "advance_days": 10,
  "advance_hook": "体育祭临近——操场上各班级在练习接力，走廊里贴满红白对阵表",
  "aftermath_text": "操场上还在清理体育祭的装饰和器材",
  "org_effects": [
    {
      "org": "总武高",
      "override_location": "操场",
      "override_action": "参加体育祭比赛中"
    }
  ]
}
```

新增字段（全部可选，省略则退化为现有行为）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `range` | `"local"` / `"regional"` / `"national"` / `"global"` | 事件影响半径 |
| `center` | string | 事件中心地点，判断玩家/NPC 是否在影响范围内 |
| `advance_days` | number | 提前 N 天开始预热 |
| `advance_hook` | string | 预热期每天注入的文本 |
| `aftermath_text` | string | 事件后 1-2 天的简短提及 |
| `org_effects` | array | 组织级别的 NPC 行为覆盖 |

#### 三层时间线

引擎在三个时间窗口做不同的事：

| 阶段 | 时间窗口 | GM prompt 效果 | NPC 效果 |
|------|---------|---------------|----------|
| 预热期 | `date - advance_days` → `date - 1` | `advance_hook` 注入到 `[日历]` 段 | NPC spawn 时注入 `[NPC·事件感知]` 段 |
| 当天 | `date` | `text` 注入（替代旧日历文本） | `org_effects` 执行：匹配组织的 NPC 自动设 `pendingOverride`，移动到活动地点 |
| 余波 | `date + 1` → `date + 2` | `aftermath_text` 注入 | NPC 的 pendingOverride 自动过期，恢复正常日程 |

预热期 GM 和 NPC 看到的文本可以不同：
- GM 拿到原句：「体育祭临近——操场上各班级在练习接力」
- NPC 拿到人格化版本：「体育祭 3 天后——你报了借物竞走，正在找人组队」（由 GM 在 spawn context 中编写）

#### 范围规则

| range | 预热注入条件 | NPC 效果生效范围 |
|-------|------------|----------------|
| `local` | 玩家在同区域（`isSameLocation`） | 仅该组织的成员 |
| `regional` | 玩家在同城市/县 | 同地区的 NPC 都可提及 |
| `national` | 始终注入 | 全国 NPC 都可能提及 |
| `global` | 始终注入 | 所有世界 NPC |

范围过滤引擎侧实现：每个 turn 遍历 calendar 条目 → 按日期匹配 → 按 range 过滤 → 注入对应段。不增加 LLM token 除非范围内有事件。

#### 组织匹配

引擎怎么知道「哪些 NPC 属于总武高」？**一期用启发式推断**：

```
NPC.schedule_group ∈ {"学生", "教师"} 
  AND NPC.default_location 包含 "总武" 
  → 该 NPC 属于总武高
```

二期可加独立的组织成员表（见第二部分），但一期够用。

#### NPC 事件感知注入

NPC Agent 被 spawn 时，引擎扫描当前日期 ± advance_days 范围内的事件，过滤出该 NPC 应感知的事件，生成 `sceneContext` 的一部分注入：

```
由比滨结衣 spawn 时拿到:
  [NPC·事件感知]
    • 总武高体育祭 3天后 — 你报了借物竞走，正在找人组队
    • 期末考 14天后 — 你数学还完全没复习

雪之下雪乃 spawn 时拿到:
  [NPC·事件感知]
    • 总武高体育祭 3天后 — 作为学生会成员你要致开幕词
    • 期末考 14天后 — 你已经在复习了
```

同校不同角色对不同事件的感知不同——GM 写 `sceneContext` 时按角色身份差异化。

#### 加载规则

与现有全部数据加载一致：
```
先读 worldpacks/{activeWorld}/calendar.json
没有则回退到 data/calendar/{activeWorld}.json
```

切换到不同游戏世界时不会加载综漫地球的日历事件。

---

## 第二部分：世界常识系统（含组织、地点知识）

### 解决的问题

问题 4（常识无处存放）、问题 5（地点知识散落），以及 P1 事件日历的组织匹配需要一个更精确的数据源。

### 核心设计

**一个文件目录，按类别分文件，每条常识带可见性标签和触发条件。引擎自动在正确的时间把正确的常识注入给正确的人。**

#### 数据位置

```
data/orgs/
  schools.json          ← 学校常识（总武高偏差值、海滨综合高不良率…）
  entertainment.json    ← 娱乐圈结构（杰尼斯帝国、事务所排名…）
  families.json         ← 家族/财阀（雪之下家政治背景、迹部财阀…）
  shops.json            ← 店铺（便利店的深夜文化、MAX咖啡…）
  districts.json        ← 街区/区域（千叶治安分布、哪个区高档…）
  countries.json        ← 国家（日本社会常识、美国对日影响力…）
```

文件按**常识类别**分，不按动漫系列分。综漫地球里所有系列共享同一份常识。

#### 加载规则

```
worldpacks/{activeWorld}/orgs/  → 优先（魔兽世界覆盖综漫地球）
data/orgs/                      → 默认（综漫地球）
```

和 characters、rooms 的加载规则完全一致，不发明新规则。切换游戏世界时，引擎清缓存重建索引。

#### 单条常识结构

```json
{
  "id": "soubu_high_facts",
  "org": "总武高",
  "type": "学校",
  "entries": [
    {
      "tag": "总武高偏差值排名",
      "level": "common",
      "triggers": {
        "locations": ["总武高", "千叶_教育机构"],
        "topics": ["升学", "偏差值", "考试"],
        "orgs": ["总武高"]
      },
      "text": "总武高偏差值约68，千叶县公立校前5。偏差值低于60基本无缘。校风自由，升学实绩突出。"
    },
    {
      "tag": "教务内斗",
      "level": "industry",
      "triggers": {
        "roles": ["教师", "PTA成员", "教育委员会"],
        "orgs": ["总武高"]
      },
      "text": "平冢静和教务主任在升学方针上长期不合。教务主任推填鸭式备考，平冢坚持学生自主。"
    },
    {
      "tag": "理事长的秘密捐款",
      "level": "hidden",
      "triggers": {
        "roles": ["政治高层", "调查记者"],
        "flags": ["school_probe"]
      },
      "text": "总武高理事长通过校友会渠道接收雪之下建设的不明捐款，交换入学名额。"
    }
  ]
}
```

**组织定义 + 常识合一**：`org` 字段本身就是组织名。一个 org 的 entries 既定义了「这是一个什么组织」（通过 common 条目），也定义了「谁该知道什么」（通过 level + triggers）。

#### 三层可见性

| level | 含义 | GM 注入条件 | NPC 注入条件 |
|-------|------|-----------|------------|
| `common` | 普通人常识 | 触发条件满足 → 自动注入 `[常识]` 段 | 触发条件满足 + NPC 在相关组织/地点 → 注入 `[NPC·常识]` |
| `industry` | 圈内人才知道 | 不自动注入。`lookup_lore` 主动查询时返回 | 不自动注入。NPC Agent 可通过 `lookup_lore` 主动查 |
| `hidden` | 被掩盖的秘密 | 不自动注入。需特定 flag + role → `lookup_lore` 返回 | 同 GM |

#### 触发条件

条目在**任一条件**满足时触发（OR 关系）：

| 触发器 | 匹配方式 | 例子 |
|--------|---------|------|
| `locations` | `isSameLocation` | 玩家进入总武高 → 触发总武高常识 |
| `topics` | 关键词包含 | 对话提到"偏差值"→ 触发学校排名常识 |
| `roles` | GM或NPC的身份标签 | 教师身份的 NPC → 触发教务内斗 |
| `orgs` | 角色所属组织名匹配 | 总武高学生 NPC spawn → 触发总武高常识 |
| `flags` | gameState 全局 flag | `school_probe` 设为 true → 解锁隐藏条目 |

#### 注入格式（GM prompt）

在现有 `[区域设定]` 之后插入：

```
[常识] 
  • 总武高偏差值约68，千叶县公立校前5。
  • 校园内不可吸烟，平冢静只能在停车场角落偷偷抽。
```

多条常识按触发匹配度排序，最多注入 5 条（避免膨胀）。

#### 注入格式（NPC Agent prompt）

```
[NPC·常识]
  • 你在总武高读二年级，偏差值勉强够线。
  • 你知道隔壁海滨综合高是出名的不良学校——放学绕路走。
```

#### 和 Layer 3 秘密防火墙的关系

两个系统正交运行：

| | Layer 3（秘密防火墙） | orgs level（常识天花板） |
|---|---|---|
| 管什么 | 剧情秘密的揭示过程 | 世界常识的可见范围 |
| 谁控制 | GM 调 `reveal_secret` 推进 | 引擎按触发条件自动判断 |
| 例子 | 雪之下议员的受贿记录被揭示给玩家 | 受贿记录是 `hidden` 级别——玩家不查不知道 |

同一事实可以同时受两者保护——`level: hidden` + Layer 3 的 `hidden_canonical` = 双重保险。

#### 组织匹配（从 P1 升级）

P1 用 schedule_group + default_location 启发式推断组织归属。P2 实现后，引擎可以直接查 `data/orgs/`：

- `data/orgs/schools.json` 中定义 `"org": "总武高"`，其 `members` 字段列出 NPC 名（或匹配规则）
- P1 的 `org_effects` 直接引用 org 名 → 精确匹配 → 更可靠

一期仍用启发式推断，P2 完成后升级为精确匹配。

---

## 第三部分：临时 NPC

### 解决的问题

问题 3（GM 无法创建冲突场景）。

### 方案

新增 `spawn_temp_npc` 工具——创建只活在当前场景的临时角色。可以对话、战斗、产生一次性记忆。场景结束自动回收。不污染角色库。

#### 工具签名

```
spawn_temp_npc({
  name: "混混A",
  act: "握着棒球棍逼近",
  hostility: "敌对",
  body_hint: "175cm 瘦削",
  reason: "上个月维打了他们的人"
})
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 临时 NPC 名 |
| `act` | string | ✅ | 当前动作描述，注入场景上下文 |
| `hostility` | `"友好"` / `"中立"` / `"敌对"` | ❌ | 默认中立。敌对 → 可用 combat_action 交战 |
| `body_hint` | string | ❌ | 简要身材描述，如 `"170cm 微胖"`。不填则默认值 |
| `reason` | string | ✅ | 出现原因，写入事件日志 |

#### 引擎行为

1. GM 调用 → 引擎创建运行时实体，注入当前场景的 NPC 列表
2. 临时 NPC 出现在 `[在场]` 段（标注 `[临时]`）
3. 可被 `lookup_character` 查询（返回简要卡片）
4. 可与玩家对话/战斗/产生一次性记忆
5. `settle_scene` 或 `commit_turn` 时自动清理

#### 和完整 NPC 对比

| | `create_character` | `spawn_temp_npc` |
|---|---|---|
| 持久化 | 永久在 DYNAMIC_CHARACTERS | 场景结束回收 |
| tk 成本 | ~3,000 | ~200 |
| 可查询 | `lookup_character` 永久可用 | 仅当前场景有效 |
| 互动能力 | 全部 | 对话/战斗/一次性记忆 |
| 可转正 | — | GM 调 `instantiate_npc(name)` 转正 |

#### 回收时机

触发条件：
- 玩家离开当前场景（`move` / `move_to`）
- `commit_turn` 被调用
- `settle_scene` 被调用

保留规则：如果 GM 在回收前调用了 `instantiate_npc(temp_name, reason="有长期剧情价值")`，该 NPC 转正为永久角色并跳过回收。

---

## 四、实现顺序

```
第一阶段：事件日历引擎（P1）
  目标：让 NPC 在活动当天自动移到正确地点
  改动：
    1. engine/types.ts — CalendarEntry 加 range/center/advance_days/advance_hook/aftermath_text/org_effects
    2. engine/timeline.ts — getTodayCalendar 区分预热/当天/余波三阶段
    3. engine/state.ts — updateNPCSchedules 加 org_effects 执行逻辑
    4. 第一批数据：扩写 oregairu 日历（体育祭/文化祭/修学旅行/期末考）
  依赖：无

第二阶段：世界常识系统（P2）
  目标：GM 和 NPC 在正确的时候自动获得正确的世界常识
  改动：
    1. engine/types.ts — LoreEntry/LoreFile/VisibilityLevel 类型
    2. engine/lore.ts — 新文件，加载 data/orgs/ + 触发匹配 + 注入
    3. engine/state.ts — buildStatePrompt 加 [常识] 段注入
    4. tools/state/spawn_npc_agent.ts — NPC spawn 时注入 [NPC·常识]
    5. 第一批数据：schools.json（千叶各学校）+ entertainment.json（娱乐圈结构）
  依赖：无（可独立实现）

第三阶段：临时 NPC（P3）
  目标：GM 可以即兴创建冲突/偶遇角色，场景结束自动回收
  改动：
    1. engine/types.ts — TempNPCState 类型
    2. engine/state.ts — 临时 NPC 存储 + 注入 + 回收逻辑
    3. tools/action/spawn_temp_npc.ts — 工具文件
    4. tools/registry.ts — 注册
  依赖：无（可独立实现）
```

三个阶段相互独立，可并行开发。

---

## 五、预期效果

实现后，以下场景成为可能：

> 10 月 15 日。玩家走在总武高走廊上，GM prompt 自动出现「文化祭前日——走廊里飘着颜料和炒面酱汁的气味」。总武高的所有学生 NPC 自动移到各自班级摊位。PC 去 2 年 F 班找由比滨，由比滨 spawn 时拿到「你负责女仆咖啡厅的接待，正在被材料短缺搞得焦头烂额」。
>
> GM 决定在文化祭加入冲突——调 `spawn_temp_npc` 创建两个海滨综合高的不良，蹲在校门口找茬。PC 可以选择无视、对峙、或叫老师。对峙时引擎正常处理 combat_action。事件结束，两个不良被回收。
>
> 场景中 GM 拿到 `[常识]` 段自动注入：「海滨综合高是千叶偏差值最低的公立校之一，部分学生有组织犯罪关联」。GM 据此描写不良的言行——不是脑补，是世界设定。

---

## 六、tk 成本汇总

| 功能 | 每 turn 增量 | 每 spawn 增量 | 触发条件 |
|------|-------------|-------------|---------|
| 事件日历扫描 | 0 tk | — | 每次 commmit_turn |
| 预热文本注入（GM） | ~50 字 | — | 范围内有预热事件 |
| NPC 事件感知 | — | ~50 字 | NPC 被 spawn |
| 常识条目扫描 | 0 tk | — | 每次 buildStatePrompt |
| 常识注入（GM） | ~80 字 | — | 触发条件满足时 |
| 常识注入（NPC） | — | ~60 字 | NPC spawn + 触发条件满足 |
| org_effects 执行 | 0 tk | — | 事件当天 |
| spawn_temp_npc | — | ~200 tk | GM 调用时 |
