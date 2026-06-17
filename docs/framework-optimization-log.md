# earth-0 框架优化日志

> 记录每次框架级优化的"为什么这么做"和"怎么做"。
> 下次想加新系统或怀疑现有设计时，先读这个，避免重复造轮子。

---

## 优化 1：工具描述压缩（2026-06-17）

### 背景问题

earth-0 有 45 个 LLM 工具（`pi.registerTool`）。每个工具的 description 字段会被 pi 框架传给 LLM，占用 context window 的 token。原来的描述存在两个问题：

1. **多行描述过长**：`world_interact` 等 6 个工具用了 4-5 行拼接字符串，消耗大量 token
2. **信息密度低**：很多描述写成自然语言段落，但 LLM 需要的是紧凑的关键信息

### 理论基础

学术界和工业界的共识（ICLR/ACL/EMNLP 2025-2026 多篇论文）：

- **[Tool Attention Is All You Need](https://arxiv.org/abs/2604.21816)**（2026.4）：工具 schema 消耗约 72% 的 context window。两阶段懒加载把 token 从 47K 降到 2.4K，准确率反而从 24% 升到 91%。**关键洞察：精简的工具描述 = 更高的选择准确率。**
- **EclipseSource 生产环境报告**（2026.1）：55,000 token 的 MCP 启动成本，大部分是冗余的工具描述。
- **Berkeley Function Calling Leaderboard**（ICML 2025）：最好的模型多轮工具调用成功率仅 47.62%，冗余描述是主要瓶颈之一。

### 做了什么

把 45 个工具的 description 全部压缩到单行，统一格式：

```
// 旧格式（多行，~130 tokens）
description:
  "建造/拆除/开关门。引擎内部处理坐标和校验。\n" +
  "action: place(放置家具) / remove(拆除) / build_wall(造墙) / remove_wall(拆墙) / toggle_door(开关门)\n" +
  ...

// 新格式（单行，~25 tokens）
description: "建造/拆除/开关门。action: place|remove|build_wall|remove_wall|toggle_door。item/material须在背包里。"
```

**模板约定：**
- 一行说清做什么（≤25中文字）
- action 值用 `|` 分隔（省字符）
- 一句话说明何时不该用

### 不应该做的事

- ❌ 把 description 删到只剩 2 个字 → LLM 无法区分工具
- ❌ 把"何时不该用"删掉 → LLM 可能滥用工具
- ❌ 一刀切所有工具用同一长度 → 简单工具可以更短，复杂工具需要多几个字

---

## 优化 2：场景工具提示（2026-06-17）

### 背景问题

45 个工具全部暴露给 LLM 后，LLM 需要从 45 个候选中选出正确的那个。研究表明：

- 工具数 >20 时准确率开始下降
- 工具数 >40 时出现严重混淆（幻觉工具名、选语义相近但错误的工具）

但是 pi 框架不支持在运行时动态隐藏工具（需要 pi 层面支持，暂无）。所以不能做硬过滤。

### 理论基础

- **[Sculptor](https://iclr.cc/virtual/2026/poster/10010394)**（ICLR 2026）：LLM 用 RL 学会管理自己的 context——主动分段、隐藏、恢复。**关键洞察：不是给更多信息，而是给对的信息。**
- **[Looking Is Not Picking](https://arxiv.org/abs/2606.16364)**（2026.6）：LLM 80% 概率看到了正确工具，但在选择阶段出错。**瓶颈不在注意力，在决策读出。软提示可以有效改善读出。**
- **attention-scoping-pattern**（生产验证）：7 行中间件 + prompt 提示，让 53 工具准确率回升。**软约束和硬过滤效果接近，但软约束零风险。**

### 做了什么

在 `buildStatePrompt`（engine/state.ts）末尾加了**软约束提示**——根据当前游戏状态自动检测场景，注入一行提示：

```
[工具提示] 战斗场景: combat_action, dice_roll, move, use_item, ... | 始终可用: lookup_character, ...
```

**核心设计决策：软约束 vs 硬过滤**

| 方案 | 做法 | 风险 | 效果 |
|------|------|------|------|
| 硬过滤 | 只传部分工具给 LLM | pi 框架不支持，需要框架改动 | 最佳 |
| **软约束（选了）** | prompt 里提示，LLM 自己选 | 零风险，LLM 可无视 | 接近硬过滤 |

选了软约束的理由：不需要改动 pi 框架、不会不小心屏蔽掉 LLM 需要的工具、LLM 仍然保有完全的灵活性。

### 场景检测逻辑

按优先级叠加（多个场景同时触发 = 全部列出）：

| 触发条件 | 注入的工具组 |
|---------|------------|
| `mode === "combat"` | combat_action, dice_roll, move, use_item, equip_item, inflict_damage |
| `layer1Enabled` 或 `mode === "sex"` | sex_touch, masturbate, lookup_body, toggle_layer1 |
| `pendingTravel` 非空 | complete_travel(必调), lookup_region |
| flags 中有 alert/wanted/exposed | identity_check, update_reputation, schedule_override |
| active_hooks 非空 | open_quest, advance_quest, abandon_quest |
| 有活跃任务 | advance_quest, set_flags, add_memory_tag |
| 位置含"店/市场/商业" | buy_item, sell_item, work_job, transfer_item |
| 位置含"校/部室/侍奉部" | adjust_relation, lookup_character, set_npc_outfit, add_memory_tag |

核心工具（lookup_character/region/lore, dice_roll, get_status, commit_turn）始终提示，不随场景变。

### 不应该做的事

- ❌ 在场景提示里列出所有 45 个工具 → 跟没做一样
- ❌ 把提示写得像命令（"你必须用这些工具"） → LLM 可能无视实际需要的工具
- ❌ 场景检测太激进（每个小场景都切） → 提示频繁变化会让 LLM 困惑

---

## 优化 3：时间线分层 + 剧情接入（2026-06-17）

### 背景问题

剧情系统存在三个脱节：

1. **引擎写了但没接入**：`engine/timeline.ts` 有完整的剧情钩子、任务系统，但 `checkTimelineEvents()` 从来没被调用过
2. **数据格式不友好**：`data/timelines/oregairu.json` 一个文件 3 条剧情线混在一起，多了不可维护
3. **LLM 看不到**：钩子生成了但没有注入 prompt

### 做了什么

**A. 引擎接入游戏循环**

在 `extension.ts` 的 `advanceTimeMinutes` 函数中钩入：

```ts
// 每次时间推进 → 自动扫描触发条件 → 生成/清理钩子
checkTimelineEvents();  // 条件满足 → 生成 Hook
expireHooks();           // 过期 → 记录后果 + 清理
```

**B. 注入 LLM prompt**

在 `buildStatePrompt`（engine/state.ts）中注入三段：

```
[剧情钩子] 雪乃提到有个一年级女生在门口张望... (urgency: low)
[日历] 今日特殊: 千叶市立总武高等学校入学式。樱花满开。
[活跃任务] 雪乃的第一次委托 (baking) — 状态: active
```

**C. 文件分片管理**

```
// 旧结构（扁平，不可扩展）
data/timelines/oregairu.json  ← 所有剧情线混在一起

// 新结构（分层，换题材只需新建目录）
data/timelines/
  oregairu/                    ← 按作品分目录
    s1_cookie_delegation.json  ← 每文件一条剧情线
    s1_zaimokuza_novel.json
    s2_summer_camp.json
  _disabled/                   ← _开头 = 自动跳过
```

引擎 `loadAllTimelines()` 改为递归扫描所有子目录，支持单条 TimelineEvent（有 `.id` 字段）和数组两种格式。

### 设计原则

- **引擎零题材硬编码**：`timeline.ts` 不写死任何作品名、角色名、地名
- **换题材 = 换 data 文件**：Fate → 放 `data/timelines/fate/` → 引擎自动加载
- **条件纯机械**：min_day、location、affection、flags——全是通用字段

---

## 优化 4：世界观设定挂载（2026-06-17）

### 背景问题

小说/百科等参考资料如何接入？全部转成时间线太费劲，不转又浪费。

### 做了什么

新增 `lookup_lore` LLM 工具 + `data/lore/` 目录：

```json
// data/lore/oregairu_world.json
{
  "春物_侍奉部": {
    "tags": ["春物", "侍奉部", "社团"],
    "text": "侍奉部是总武高的非正式社团..."
  }
}
```

LLM 需要查设定时调 `lookup_lore("侍奉部")` → 按关键词搜索所有 lore 文件 → 返回匹配条目。

**设计选择**：lore 是**被动查询**，不是自动注入 prompt。因为世界观设定量大，全量注入会撑爆 context window。按需查询是更合理的策略。对比 SillyTavern 的 World Info 系统（关键词触发自动注入），earth-0 选被动模式是因为：
- 手机端 token 更紧张
- LLM 作为 GM，知道什么时候该查设定
- 自动注入可能注入无关内容

---

## 新增模块时只需做三件事

参见 `docs/module-template.md` 的完整模板。核心原则：

1. **工具描述**：一行 ≤25 中文字，action 用 `|` 分隔
2. **场景映射**（如需要）：在 `buildStatePrompt` 的场景检测中加一个 `if` 条件
3. **数据文件**：放 `data/` 下，引擎放 `engine/` 下

**永远不需要做的事：**
- 修改 `timeline.ts`（除非加新的触发条件类型）
- 修改 `types.ts` 的基础类型（除非加新的系统级概念）
- 修改现有工具的描述（已经统一格式）

---

## 相关研究（不需要读懂，但可以告诉别人"我们参考了这些"）

| 论文 | 会议 | 一句话 |
|------|------|--------|
| Tool Attention Is All You Need | arXiv 2026.4 | 工具两阶段懒加载：先给摘要再给完整 schema，token 省 95% |
| Sculptor | ICLR 2026 | LLM 用 RL 学会管理自己的 context——分段、隐藏、恢复 |
| Looking Is Not Picking | arXiv 2026.6 | LLM 看到了正确工具但选错——提示比硬过滤更有效 |
| MEMO | ICML 2026 | 自博弈驱动的记忆 CRUD：什么时候记、记什么、什么时候忘 |
| R3Mem | ACL 2025 | 可逆压缩：虚拟记忆令牌，无限长历史 |
| EcoAct | ICLR 2025 | LLM 自己决定注册哪些工具，token 省 50%+ |
