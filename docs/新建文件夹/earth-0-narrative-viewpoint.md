# 叙事视角系统 — 设计计划

> **当前状态（2026-07-01）**：本文档是 2026-06 月的原始设计稿。全部设计已落地并超出原始范围：
> - `detectInteractionMode`：已从"共位近似"升级为 **LLM mini-judge cue 检测**（交互检测精度远超 §4.2 的预期）
> - 切镜系统：全部三条触发线 + 队列/优先级/冷却已在 `engine/viewpoint.ts` 实现
> - voice 模板：`gm-voice-novel.md` / `gm-voice-turnbased.md` 已生效
> - GAL 模式自动触发：**超过原始设计**——场景边界锁，对标视觉小说
> - Phase 3 裸 stream 结构隔离：**超过原始设计**——渲染 LLM 零工具，物理硬隔离
> - 最新代码参考：`engine/detect-mode.ts` / `engine/viewpoint.ts` / `engine/phase3-render.ts` / `extension.ts` / `docs/decisions.md` #16
>
> 来源：参考计划 `0-groovy-shannon.md` §十七。优先级 🟡 本月。本模块是 5 个待开发模块中最复杂的。

## 1. 要解决什么问题

当前 earth-0 的叙事只有一个固定模板：GAL/Sex 模式第一人称「我」，RPG 模式第三人称「他」（`agents/gm-contract.md:91`）。两个问题：

**第一，叙事节奏完全交给 LLM 自由裁量。** 玩家独处（该连续记叙）和被三个 NPC 同时围住说话（该回合制聚焦），用的是同一套节奏——结果不稳定：有时该停等玩家却硬塞选项，有时群口场景写成流水账。

**第二，视角始终钉在玩家身上。** 好感度突破、声望跨越、重大事件发生——这些是传统叙事里最出彩的"切到另一个人那里看一眼"的时刻，但在 earth-0 里不存在。NPC 之间的信息差已经有了——`spawn_npc_agents` 让每人只知道自己的事——但"信息差产生的后果"从来没被展示过。读者只知道 NPC 说了什么，不知道她回去以后发生了什么。博德之门 3 里影心在营地篝火旁独自祈祷的名场面——如果团队营地里从来不允许镜头离开主角，这段戏就不存在。earth-0 的架构天然允许这段戏——多 Agent 的信息隔离已经是地基——只是引擎还没学会"把镜头切过去"。

目标：引擎判断叙事节奏和切镜时机，LLM 只执行当前模板。

## 2. 现有基础设施

### 可直接复用

| 文件 | 函数/位置 | 复用方式 |
|------|----------|---------|
| `extension.ts:47-113` | `buildSystemPrompt()` | 第 64 行 `key.replace("{mode}", gameState.mode)` 解析 layer key。完全相同的模式加 `{interactionMode}` 替换：`key.replace("{interactionMode}", gameState.interactionMode)` |
| `extension.ts:84-86` | mode 文件 fallback 逻辑 | 现按 `gameState.mode` 选 `gm-mode-{sex/rpg/gal}.md`。新增 voice 层与 mode 层并列，不替代 |
| `preset.json` | assembly 系统 | 已支持 `mode_{mode}` 动态文件名。新增 `gm-voice-novel.md` / `gm-voice-turnbased.md` 后自动加载 |
| `engine/state.ts:990-1239` | `buildStatePrompt()` | 无需改动。它已输出 `{{mode}}` 模板变量。视角逻辑不进这里——进 `buildSystemPrompt` 的 voice 层 |
| `engine/state.ts:91-103` | `isSameLocation(loc1, loc2)` | 通用共位判定。用它在结算轮数"有多少 NPC 和玩家同处一室" |
| `engine/state.ts:1704-1717` | `updateRelation(rels, name, delta, note?)` | 关系变化入口。每次好感度变化时，引擎在此检测"是否跨越关键阈值"→ 触发切镜 |
| `engine/state.ts:1719-1725` | `affectionToStage(val)` | 阈值：陌生(<20) → 熟人(<40) → 友人(<70) → 信赖(<90) → 至交。跨越任意边界 = 切镜触发 |
| `engine/state.ts:3082-3087` | `updateReputation(group, delta)` | 声望变化入口。跨越 ±1/±2/±3 时触发"上升"切镜 |
| `engine/state.ts:2697` | `getNearbyNPCs(roomName, gridPos, maxRange)` | 备选信号——网格距离 + 墙壁阻挡。NPC 计数用 `isSameLocation` 更简单直接 |
| `tools/action/settle_scene.ts:14-56` | `execute()` | 集成点：第 25 行 `gameState.turn++` 之后、`saveState()` 之前——在此运行引擎检测 |
| `tools/state/spawn_npc_agent.ts:22-112` | execute 前半段（角色数据 + P1/P2/P3 收集） | 提取为 `buildNpcAgentContext(npcName)`，切镜的"独白模式"共享此上下文收集 |
| `tools/state/spawn_npc_agent.ts:113-226` | charPrompt 构造数组 | 切镜用不同的输出格式段——其余部分（身份/外貌/身体/关系/记忆/P1/P2/P3）不变 |
| `agents/gm-contract.md:91` | 现有人称规则 | 删除此句——职责移移交引擎 voice 层 |

### 需要改的文件

| 文件 | 改动量 | 改什么 |
|------|--------|------|
| `engine/types.ts:664` | 1 行 | `GameState.mode` 类型不变。新增 `interactionMode` / `turnsSinceLastNPCInteraction` / `_cutaway_queue` 字段 |
| `extension.ts:64` | ~3 行 | layer key 解析加 `{interactionMode}` 替换 |
| `preset.json` | ~6 行 | 加两个 voice 层的 layer 定义 |
| `agents/gm-contract.md:91` | ~1 行 | 删除人称句 |
| `tools/state/spawn_npc_agent.ts:22-112` | ~30 行 | 提取 `buildNpcAgentContext(npcName)` 为 export 函数（纯搬代码，不改变逻辑） |
| `tools/action/settle_scene.ts:25-48` | ~10 行 | 集成检测点 + 切镜队列消费 |

### 新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `engine/detect-mode.ts` | ~60 | `detectInteractionMode(gs, nearbyNPCs)` 纯函数 → `{ interactionMode, person }` |
| `engine/viewpoint.ts` | ~150 | 切镜触发判定 + 队列管理 + 优先级 + 冷却 + NPC 加权选择 |
| `agents/gm-voice-novel.md` | ~30 | 小说模式 GM 行为合同 |
| `agents/gm-voice-turnbased.md` | ~25 | 回合制 GM 行为合同 |
| `agents/gm-cutaway-contract.md` | ~35 | 切镜独白模式 NPC Agent 合同（第三人称旁白 ~100-150 字） |

## 3. 设计方案

### 3.1 三轴分层

```
  mode (内容类别)     →  interactionMode (叙事结构)   →  person (POV)
  gal/rpg/sex/combat     novel / turn_based             派生，不独立存储
  决定游戏规则           引擎每回合检测                  由 (mode, interactionMode) 推出
        │                      │                              │
  sex/combat 可硬覆盖     MVP 只有这两态                  从不写进存档
```

- **mode**：内容类别。维持现状——决定哪套游戏规则生效。
- **interactionMode**：叙事结构。**引擎检测**，新增。`novel`（连续记叙）和 `turn_based`（回合聚焦）。
- **person**：POV。**从前两者派生、绝不独立存储**。

### 3.2 组合规则（顺序即优先级）

| 序 | 条件 | interactionMode | person | 说明 |
|---|---|---|---|---|
| 1 | `mode === "sex"` | turn_based | 第一人称「我」 | 亲密场景 POV 完全由引擎锁死 |
| 2 | `mode === "combat"` | turn_based | 第三人称「他」 | 战斗需要回合制聚焦 |
| 3 | 否则按 NPC 数检测 | novel / turn_based | gal →「我」/ rpg →「他」 | person 仍由 mode 决定，结构由引擎定 |

**关于 gal + novel 的人称**：GAL 模式本质是"玩家成为角色"的代入。如果日常场景里从第一人称对话突然跳到第三人称独处叙述，玩家会出戏。**gal 始终第一人称（含 novel）**——与 `0-groovy-shannon.md` 原文不同但更安全。rpg 始终第三人称。这保持了一个 session 内 POV 的一致性。

### 3.3 控制流：检测 → 注入 → 渲染

```
玩家输入
  └─► GM 结算轮 settle_scene.execute()           [tools/action/settle_scene.ts]
        ├─ drainToolCalls()
        ├─ 数在场 NPC：
        │    nearbyNPCs = npcs 中 alive 且 isSameLocation(n.currentRoom, player.location) 的个数
        ├─ interactionMode = detectInteractionMode(gameState, nearbyNPCs)
        │    [engine/detect-mode.ts 纯函数]
        ├─ 更新 gameState.interactionMode
        ├─ 更新防抖计数 turnsSinceLastNPCInteraction
        ├─ advanceMinutes() ... saveState()
        │  (中间不碰切镜——切镜在当前回合结束后单独处理)
        ▼
下一回合 buildSystemPrompt()                      [extension.ts]
  └─ 读 gameState.interactionMode
     → layer key 替换 "{interactionMode}" → 加载 gm-voice-{novel/turnbased}.md
     → 注入系统提示词

渲染轮 render_scene                               [tools/action/render_scene.ts]
  └─ 导演单加 <interaction_mode>novel|turn_based</interaction_mode>
```

### 3.4 detectInteractionMode 纯函数

```typescript
// engine/detect-mode.ts (~60行)

// 输入: gameState, nearbyNPCs (number)
// 输出: { interactionMode: "novel" | "turn_based", person: "first" | "third" }

// 逻辑:
//   if (gameState.mode === "sex")    → { turn_based, first }
//   if (gameState.mode === "combat") → { turn_based, third }
// 
//   if (nearbyNPCs > 0)
//     → turnsSinceLastNPCInteraction = 0
//     → { turn_based, person由mode定 }
// 
//   if (nearbyNPCs === 0)
//     → turnsSinceLastNPCInteraction++
//     → if turnsSinceLastNPCInteraction >= 2  → { novel, person由mode定 }
//     → else → { turn_based, person由mode定 }  // 防抖：临时走开不算
```

**为什么是 2 回合防抖**：NPC 临时走开（去厕所、去走廊拿东西）不应造成模板抖动。连续 2 回合 0 NPC = 确认独处。

**为什么不用"上一段叙事里有多少 NPC cue 你"**：这是主信号——但 MVP 不依赖它。原因：从叙事正文中正则检测"谁在对你说话"不可靠（"你觉得呢"没有玩家名字但确实在 cue 你）。先做 NPC 共位检测（引擎可精确计算），后续可以加 GM 在结算轮设 flag 的辅助信号（`_npc_cueing_player: ["雪之下雪乃"]`）。

### 3.5 模板注入：替换而非追加

走 `preset.json` assembly 的 layer 机制，新增 voice 层排在 mode 层之前：

```
最终系统提示词顺序：
[gm-pre] → [gm-rules] → [gm-contract] → [statePrompt] → [gm-voice-{interactionMode}] → [gm-mode-{mode}]
                                                           ↑ 设叙事结构              ↑ 设游戏规则 + 人称终裁
```

- voice 模板第一行写 `[模式：小说式]` / `[模式：回合式]`，作为不可忽略的硬标记。
- voice 层在前、mode 层在后 → mode 模板对人称有**最终决定权**。
- LLM 全程不知道模式可以切换——voice 模板里没有任何"另一种模式"的描述。

### 3.6 novel 模式渲染格式

```
侍奉部的午后光线偏西。由比滨趴在桌上，下巴搁在交叠的手臂上，
正在给手机里的照片加贴纸——不自觉地加了太多猫耳朵。八幡缩在
角落椅子上，手里举着文库本，但眼睛没在字上。

"下周体育祭。你们有人报接力吗？"由比滨没抬头。

"不。"雪之下翻了一页。"那种场合只会让人出丑。"

"就是因为大家都怕出丑才要参加吧……"由比滨的声音小了下去。

门开着一条缝。走廊里的脚步声渐远。

───

[继续阅读] [介入对话]
```

格式规则：人称由 mode 决定（gal=「我」/rpg=「他」）/ NPC 对话来自 NPC Agent 回应 / 3-5 段 ~200-400 字 / 禁止代玩家说话。

### 3.7 turn_based 模式渲染格式

```
"你总是这样。"雪之下合上了书。"明明做不到，却先答应了。"
她没看你。但她的语气里有一种你以前没听过的东西——
不是生气。比生气更安静。

> ① [普通]: "我只是不想让你一个人扛。"
> ② [理智]: "那你答应的事就都做得到？"
> ③ [吐槽]: "雪之下同学的语文水平果然一流。"
> ④ [默然]: *不说，站起来走到窗边。*
```

格式规则：第二人称「你」/ 2-4 句 NPC 言行 + 4 个扮演选项 / 选项是具体话头 / 危机触发时迫选。

---

## 3.8 切镜系统（Cutaway）

### 核心理念

切镜的本质：**引擎自动插入一段"同一时刻、另一个地方、某个 NPC 独自一人"的旁白画面。** 玩家不在场——但看到了。引擎推演 NPC 的这一刻，写进她的记忆，然后镜头回来。

切镜和三段式的关系：切镜不替代 GM——切镜是渲染轮的**附加内容**。主线叙事照常产出（GM 缝合 NPC 回应），切镜段落附加在主线末尾。玩家读完后打下一轮的字——不需要显式的"按任意键"。

### 切镜的时空规则（铁律）

| 规则 | 说明 |
|------|------|
| **时间同步** | 切镜永远和 `gameState.time` 同步。"第二天走廊里"不是切镜——那是时间推进后的正常叙事。切镜 = "同一时刻，另一个地方" |
| **地点独立** | 切镜 NPC 的地点 = `gameState.npcs[npcName].currentRoom`（日程系统已维护），不是 `player.location` |
| **不推进时间** | 切镜不调 `advanceMinutes`。镜头回来后，游戏时钟不变 |
| **不改变世界状态** | 切镜 NPC 可以想、可以感受、可以做一个微小的动作——但不能改变任何守恒量（位置/物品/金钱/HP） |
| **安全插入点** | 只在 `interactionMode === "novel"` 时执行。turn_based/combat/sex 时队列等待 |

### 为什么不写在 turn_based 时插切镜

玩家刚选了一个选项，等着 NPC 的反应——此刻打断，破坏交互闭环。novel 模式玩家处于"阅读"状态，没有未完成的交互承诺。切镜就像影视剧里"画面短暂切到另一个人那里，然后切回来"——读者/观众在被动接收画面，不是主动等待回应。这是切镜唯一安全的插入时机。

### 三条触发线

#### 触发线 A：关系阶段突破（他者之眼）

**判定**：`updateRelation`（`engine/state.ts:1704`）在更新好感度后，检查 stage 是否跨越边界。

```
updateRelation(rels, name, delta, note):
  oldStage = rels[name]?.stage || "陌生"
  rels[name].affection = ...
  newStage = affectionToStage(rels[name].affection)
  
  if (oldStage !== newStage && newStage !== "陌生")  // 跨越任意边界且不是从无到有
    → pushCutaway({ type: "他者之眼", npc: name,
        trigger: `玩家与她/他的关系从${oldStage}变为${newStage}: ${note || "未记录原因"}` })
```

**为什么不只是"跨越阈值"**：首次建立关系（陌生→熟人）也非常有切镜价值——NPC 第一次把玩家当成"值得记住的人"。跨越 50（友人→信赖）和跨越 20（陌生→熟人）的情感强度不同——但都有切镜价值。全阶段跨越都触发，靠优先级控制频率。

#### 触发线 B：事件 flag 触发（涟漪/后果）

**判定**：`checkTimelineEvents`（`engine/timeline.ts`）完成一个 beat 后，检查该 beat 定义中的 `cutaway` 字段。

timeline JSON 加可选字段：
```json
{
  "id": "summer_camp_opening",
  "beats": [{
    "prompt": "...",
    "outcomes": [{
      "flags": ["camp_started"],
      "cutaway": { "npc": "平冢静", "type": "涟漪",
        "reason": "合宿开始了——作为班主任，她比任何人都清楚这意味着什么" }
    }]
  }]
}
```

`cutaway` 字段由 timeline JSON 作者手写。不需要 LLM 判断——beat 完成 = 条件满足。MVP 手写 5-10 条关键 timeline 的 cutaway 标注。不填 `cutaway` 的 beat 不触发切镜——完全向后兼容。

#### 触发线 C：物理共位脱离（余波）

**判定**：settle_scene 时，检测"上一轮在场 NPC ≥2，本轮在场 NPC = 0"——即一场多人对话刚散场。

```
if (previousRoundNPCs >= 2 && currentRoundNPCs === 0 && turnsInConversation >= 3)
  → 加权选择 1 个 NPC
  → pushCutaway({ type: "余波", npc: selected,
      trigger: "刚才的对话结束了——她/他独自离开" })
```

**加权选择算法**（不是随机）：
```
weight(npc) = baseWeight(10)
  + affectionWeight：玩家好感度越高，越可能被选中 (0-30)
  + memoryTagWeight：该 NPC 与玩家之间的记忆标签数量 × 5 (0-25)
  + timelineWeight：该 NPC 是否在活跃 timeline 中 +15 (0-15)
  + recentCutawayPenalty：上次被切镜是几回合前？<3 回合 → -50

从在场 NPC 中选 weight 最高的 1 个。
```

这避免了"随机切到路人"的问题——和玩家关系最深、最有旧账、正在经历剧情的人，最可能被选中。

### 属性与队列限制

- **不随机触发**。"每天晚上 NPC 回家时 10% 概率切镜"——不做。没有叙事动机的切镜回答的是一个没人问的问题。
- **当天有 pending event 的 NPC 除外**：如果 NPC 当天有 calendar event 预热期、lifeEvent 进行中、或 timeline beat 今天触发——引擎在日终结算时有机会触发一次"回顾切镜"。这是事件驱动，不是随机。

### 队列 + 优先级 + 冷却

```
回合结算后
  ├─ updateRelation → 跨越阈值 → pushCutaway({ type: "他者之眼", weight: 100, ... })
  ├─ updateReputation → 跨越±1 → pushCutaway({ type: "上升", weight: 50, ... })
  ├─ completeTimelineBeat → flag cutaway → pushCutaway({ type: "涟漪", weight: 70, ... })
  └─ 共位脱离 → pushCutaway({ type: "余波", weight: 30, ... })
         │
         ▼
_queue 按 weight 降序排列。同 NPC 多条 → 合并为一条。
         │
         ▼
检测 interactionMode === "novel"？
  ├─ 是 → 取 queue[0] → 执行切镜 → coolingTurns = 3
  └─ 否 → 队列保留，等下一个 novel 回合
```

**优先级权重**：

| 类型 | 权重 | 理由 |
|------|------|------|
| 他者之眼（好感度阶段突破） | 100 | 最有力的切镜——玩家和 NPC 的关系改变了 |
| 后果（玩家分支性选择） | 90 | 选择产生的涟漪 |
| 涟漪（timeline beat完成） | 70 | 剧情事件的影响 |
| 回忆（记忆标签触发 + 独处） | 60 | NPC 自发回想 |
| 上升（声望跨越阈值） | 50 | 社会性涟漪 |
| 群像（大型事件结束） | 40 | 多方视角汇集，冷却最长 |
| 余波（共位脱离） | 30 | 价值最低——只是"刚才在场" |

**队列规则**：
- 队列上限 3。超过时保留权重最高的 3 条。
- 同 NPC 合并：多条 queued → 合并触发原因。
- 冷却：真实切镜执行后，最少隔 3 回合。不是 5——5 在活跃 session 里会导致永远排队。
- 队列在 saveState 时落盘（`gameState._cutaway_queue`）。

### 执行流：独白模式（第三种 spawn 模板）

现有的 spawn_npc_agent 有两种模式。切镜需要第三种。三种模式的差异不在"上下文收集"——在"给 NPC 的指令"。

| | 场景互动模式 | Council 模式 | **独白模式（切镜）** |
|---|---|---|---|
| 触发方 | GM 角色轮 | GM 结算轮 | **引擎自动** |
| NPC 在哪 | `player.location` | `player.location` | **`npc.currentRoom`**（日程） |
| 在场人物 | 玩家 + 其他 NPC | 无 | **NPC 独自（或日程中的人）** |
| NPC 任务 | 回应玩家 | 给一句立场 | **存在。只是存在。** |
| 输出格式 | 内心独白 + beat 链 | 1-2 句立场 | **第三人称旁白 ~100-150 字** |
| 记忆落库 | `[Agent自主发言]` | `[Council发言]` | **`[切镜·{type}]` + 触发原因** |

**独白模式 prompt 核心差异**：

```
你是{npcName}。
你现在在{currentRoom}。{scheduleAction}（如"你正在图书馆整理书架"）。
时间: {gameDate} {timeOfDay}。

引擎记录了一件与你有关的事: {triggerDescription}

你不是要"对此做出反应"。你只是继续做着手里的事——
但刚才发生的事在你脑子里停了一瞬间。

输出格式: 第三人称旁白，100~150字。
- 描写这个画面：你在哪、在做什么、周围什么样子
- 如果那件事在你脑子里留下了什么——一个停顿、一个动作慢了半拍、一个你立刻改掉的表情
- 不要内心独白。不要对话。不要分析。
- 你是画面——不是声音。
```

**独白模式不产内心独白。** 切镜是镜头在看角色，不是角色在说话。把"画面"和"声音"分开，读者才不会混淆——"这到底是她在想，还是叙述者在描述她？"

**切镜 NPC 在 spawn 时可能在日程中有其他 NPC 在场**（如"和由比滨一起在走廊"）。此时切镜里会出现另一个人——但引擎不需要额外 spawn 那个 NPC。渲染 GM 从角色卡里拿外观摘要即可。重点是被切的那个——其他人是背景。

### 渲染与接回

```
主线叙事（novel 模式，~300字）
  ───
  [继续阅读] [介入对话]

  · · · · · · · · · · · · · · · · · · · · · · · · ·
  【另一边 · 雪之下的公寓】
  
  暖气没有开。雪之下将膝盖埋在宽大的毛衣里，
  手里的红茶已经没有了热气。
  她看着手机上那条来自由比滨的简讯——看了很久。
  然后锁屏，把手机翻过来扣在桌上。
  
  [/切镜]
  · · · · · · · · · · · · · · · · · · · · · · · · ·
```

- 切镜段落附加在主线末尾，用分割线 + `【另一边 · {地点}】` 标记
- `[/切镜]` 闭合。无选项——这不是交互，是播放
- 玩家读完直接打下一轮的字——pi 框架不支持"按任意键继续"，但这没关系。切镜就是正文的一部分
- 如果在 Web 前端（tavernlike）：切镜用独立卡片/淡入动画——`[/切镜组件]` 闭合

---

## 3.9 倒叙/闪回：不做引擎，做素材注入

引擎不判断"该不该倒叙"。引擎做的事：从 `gameState.flags` 中提取已完成的事件摘要，在渲染轮导演单里追加：

```
[已完成事件]
  • Day3: 合宿第一晚——雪之下在篝火旁说了什么
  • Day7: 侍奉部室——由比滨哭了
```

LLM 自己判断当前场景是否与某个过去事件有情感共鸣。如果 NPC 能自然地想起它——一句闪回就够了。不是"第 7 章插一段三年前的回忆"，是"篝火之夜，雪之下想起开学那天说过的话"。

---

## 3.10 动作描写强化：降低优先级，不独立做

参考计划建议引擎检测关键动作 → 设 `ACTION_FOCUS` flag → 渲染模板多一行注入。这本质是 prompt 级补丁——违反哲学 §1.3 "不用 prompt 弥补坏 interface"。

**替代方案**：如果动作描写不足，改的是"导演单给渲染模型的场景指令"，而非加一个 flag。渲染模型在 `<scene_directives>` 段里已有 `<atmosphere>` 和 `<action_outcome>`——把动作描写的提醒放进这里、而非另起一个 flag 系统。工作量：1 行改动（`render_scene.ts:80`），不是 40 行新文件。

---

## 3.11 Council 模式：不独立做

详见 `earth-0-council-mode.md`。结论：Council 的三段式位置是错的——Phase 1 的 GM 不应提前知道 Phase 2 的 NPC 会说什么。正确的做法是在 Phase 2.5（角色轮后、渲染轮前）从 NPC 回应中提取渲染提示，作为渲染轮导演单的附加内容。这不是独立模块——是渲染轮的增强。

---

## 3.12 GameState 新增字段（兼容旧存档）

```typescript
// engine/types.ts — GameState 加:
{
  interactionMode: "novel" | "turn_based";  // 引擎检测，每回合更新
  turnsSinceLastNPCInteraction: number;      // 防抖计数器
  _cutaway_queue: CutawayDirective[];        // 切镜队列（_ 前缀 = 不保证持久化，但 saveState 时落盘）
  _cutaway_cooldown: number;                 // 剩余冷却回合数
}
```

`createInitialState()`（`state.ts:116`）给默认值。读取处一律 `??` 降级，旧存档无字段安全启动。

---

## 3.13 实施步骤（按风险递增）

| 步 | 内容 | 工时 | 新增文件 | 风险 |
|----|------|------|---------|------|
| 1 | 提取 `buildNpcAgentContext(npcName)` | 30 分钟 | 无 | 极低——纯搬代码 |
| 2 | `detectInteractionMode` + `interactionMode` 字段 + 防抖 | 30 分钟 | `engine/detect-mode.ts` | 低 |
| 3 | voice 模板 + preset.json + extension.ts 接入 | 20 分钟 | `gm-voice-novel.md` `gm-voice-turnbased.md` | 低 |
| 4 | 切镜队列 + 优先级 + 冷却（`engine/viewpoint.ts`） | 1 小时 | `engine/viewpoint.ts` | 中 |
| 5 | 独白模式 spawn（`buildNpcAgentContext` + 切镜 prompt 段） | 30 分钟 | `gm-cutaway-contract.md` | 中 |
| 6 | settle_scene 集成（检测点 + 队列消费） | 15 分钟 | 无 | 中 |
| 7 | `updateRelation` 内嵌触发线 A | 10 分钟 | 无 | 低 |
| 8 | timeline JSON cutaway 字段支持 | 15 分钟 | 无（纯数据） | 低 |
| 9 | 跑 `npx tsx test.ts` | 每步后 | — | — |

总工时 ~3.5 小时。每步后跑测试。

---

## 4. 争议点/未决问题

### 4.1 gal + novel 的人称

ⓐ（推荐）gal 恒第一人称，与 interactionMode 无关。ⓑ novel 强制第三人称（参考计划原案）。**取舍**：ⓐ 安全——代入感不断。ⓑ 更纯粹但日常切换会让玩家出戏。

### 4.2 交互检测精度

当前用 `isSameLocation` 数 NPC 人数作主信号——0 NPC = 独处 = novel。但存在"玩家在教室里有 3 个 NPC 在场，但 NPC 在闲聊、没人 cue 你"——引擎会判定 turn_based（因为在场 > 0）。这是可接受的近似——"有人在场 → 可能需要回应"是安全的默认。后续加 GM 结算轮设 `_npc_cueing_player` flag 作辅助信号。

### 4.3 切镜队列落盘 vs 内存

`_cutaway_queue` 前缀 `_` 表示"非关键状态"。saveState 时落盘——玩家保存/加载不丢排队中的切镜。但加载旧存档时队列为空——不会凭空生成切镜。

### 4.4 timeline JSON 的 cutaway 标注成本

手写每条 timeline beat 的 cutaway 字段——49 条 timeline 全部标注不现实。MVP 手写 5-10 条关键场景的 cutaway。其余不填则不做切镜——非破坏性。后续可以 LLM 辅助补全。

### 4.5 队列 3 条上限是否够

活跃 session 中，每 2-3 回合可能触发一条新切镜。队列 3 + 冷却 3 意味着积压 > 3 时丢弃低优先级的。这是有意为之——切镜多了读者麻木。宁可漏一条，不可连续轰炸。

---

## 5. 验收标准

- **回归**：`npx tsx test.ts` → 230+ passed, 0 failed。
- **零硬编码**：`detect-mode.ts`、`viewpoint.ts` 不含角色名/地名/作品名。NPC 计数走 `isSameLocation`。`grep -rE '总武|侍奉部|比企谷|雪之下' engine/detect-mode.ts engine/viewpoint.ts` 为空。
- **检测正确性**（单测）：
  - 0 NPC + 防抖 ≥2 → `novel`
  - 0 NPC + 防抖 <2 → 仍 `turn_based`
  - 1+ NPC → `turn_based`，防抖归零
  - mode=sex → 恒 `turn_based` + first
  - mode=combat → 恒 `turn_based` + third
- **切镜触发**：
  - updateRelation 跨越 50 → `_cutaway_queue` 含他者之眼条目（权重 100）
  - updateReputation 跨越 → `_cutaway_queue` 含上升条目（权重 50）
  - timeline beat 完成且含 cutaway 字段 → 入队
  - 同 NPC 多条 → 合并
  - 冷却期内 → 排队不执行
- **切镜执行**：
  - interactionMode=novel 时 → 队列非空 → spawn NPC"独白模式" → NPC 在 currentRoom（非 player.location）
  - 切镜段落第三人称、无内心独白、`[/切镜]` 闭合
  - 切镜不推进时间、不改变游戏状态
  - 切镜 NPC 的记忆新增 `[切镜·{type}]` tag
- **切镜不执行于 unsafe 时机**：
  - interactionMode=turn_based/combat/sex → 队列等待
- **存档兼容**：旧存档无新字段 → 默认值降级，不报错。
- **voice 模板生效**：novel → 系统提示词含 `[模式：小说式]`，输出连续记叙、`[继续阅读] [介入对话]` 结尾。turn_based → 含 `[模式：回合式]`，输出 NPC 言行 + 4 选项。
