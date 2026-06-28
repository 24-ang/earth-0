# 叙事视角系统 — 设计计划

> **来源**：参考计划 `0-groovy-shannon.md` §十七。本模块是 5 个待开发模块中逻辑与叙事结合最紧密的一个。

---

## 1. 要解决什么问题

当前 earth-0 的叙事面临两个核心瓶颈：

1. **叙事人称与节奏完全与叙事结构脱节**：
   目前的叙事节奏和人称是一条粗暴的 Prompt 约定：GAL/Sex 模式第一人称「我」，RPG 模式第三人称「他」。这导致一个尴尬的情况：玩家独处（本该像小说一样连续渲染环境与心理）与被三个 NPC 围住对话（本该是快节奏的回合制交锋），用的是同一套节奏和模板，全部交给 LLM 自由裁量，经常导致对话场景写成流水账，独处场景写成对话。
2. **视角完全锁定在玩家身体上，缺乏宏大的世界反馈**：
   玩家做出了重大事件改变、好感度跨越阈值，或者远端势力正在密谋针对玩家的行动。这些“玩家角色（主角）不知道，但读者非常想看到”的经典轻小说“幕间”场景，目前在引擎里无法呈现。

**目标**：由**引擎**自动判定场景结构并分配最合理的“叙事模式”（小说制、回合制、幕间制），严格控制字数和人称，同时在引擎层提供安全的“只读故事播放通道”实现**轻小说幕间系统**，让 LLM 专注于写作，不负责做逻辑判断。

---

## 2. 现有基础设施

| 资产 | 位置 | 复用/修改方式 |
|---|---|---|
| 系统提示词组装 | `extension.ts:buildSystemPrompt()` | 类比 `{mode}` 替换，新增 `{interactionMode}` 动态文件名加载 |
| 模式加载 | `preset.json` | 增加 `gm-voice-novel.md` 和 `gm-voice-turnbased.md` 层 |
| 共位判定 | `engine/state.ts:isSameLocation()` | 用来在结算轮计算“同室在场 NPC 人数”作为主信号 |
| 关系变化监测点 | `engine/state.ts:updateRelation()` | 在此监测“好感度阶段跨越”，作为自动触发短幕间的源头 |
| 声望变化监测点 | `engine/state.ts:updateReputation()` | 在此监测“声望阶梯跨越”，作为自动触发社会性短幕间的源头 |
| 剧情推进结算点 | `tools/action/settle_scene.ts` | 挂载 detect 逻辑与幕间队列消费的终点 |
| 角色上下文构建 | `tools/state/spawn_npc_agent.ts` | 提取 `buildNpcAgentContext(npcName)`，供幕间单次生成重用数据 |

---

## 3. 设计方案

### 3.1 三种叙事尺度的终极区隔

本项目将叙事结构划分为以下三个正交轨道，在人称、字数和生成管道上实行物理隔离：

| 维度 | turn_based (回合制) | novel (小说制) | 幕间 (Intermission) |
|---|---|---|---|
| **定位** | 一对一的回合交锋 | 段落连续叙述与观察 | 独立的旁白与侧面描写章节 |
| **字数限制** | 200 - 400 字 | 400 - 800 字 | 短幕间：200-500 字 / 长幕间：800-2000 字 |
| **生成方式** | NPC Agent 独立 spawn + GM 缝合 | NPC Agent 独立 spawn + GM 缝合 | **单次长文本生成（无信息隔离约束）** |
| **触发机制** | 在场 NPC 数 > 0，或有人 cue 玩家 | 连续 2 回合在场 NPC 数为 0（防抖） | 事件 flag 触发（长） / 关系声望跨越（短） |
| **人称规则** | GAL:「我」/ RPG:「他」，GM 第二人称 | GAL:「我」/ RPG:「他」，GM 第三人称限制 | 视角锁定为被切镜的 NPC（第一或第三人称） |
| **时间轴影响** | 是（正常消耗游戏分钟） | 是（正常消耗游戏分钟） | **否（时间静止，镜头插播）** |
| **状态影响** | 是（修改 HP、背包等守恒量） | 是（修改 HP、背包等守恒量） | **否（只读，不允许在幕间内修改gameState）** |
| **读者体感** | “我接下来要如何回应” | “我置身于环境中观察着一切” | “这是一段我（读者）知道但主角不知道的剧情” |

---

### 3.2 模式切换与防抖检测（detectInteractionMode）

新增 `engine/detect-mode.ts` 提供纯函数检测逻辑：

```typescript
export function detectInteractionMode(
  gameState: GameState, 
  nearbyNPCsCount: number
): { interactionMode: "novel" | "turn_based"; person: "first" | "third" } {
  // 锁死特定场景
  if (gameState.mode === "sex") return { interactionMode: "turn_based", person: "first" };
  if (gameState.mode === "combat") return { interactionMode: "turn_based", person: "third" };

  // 共位检测
  if (nearbyNPCsCount > 0) {
    gameState.turnsSinceLastNPCInteraction = 0;
    return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third" };
  } else {
    gameState.turnsSinceLastNPCInteraction++;
    // 连续 2 回合 0 NPC 判定为独处，防抖切换到 novel 模式
    if (gameState.turnsSinceLastNPCInteraction >= 2) {
      return { interactionMode: "novel", person: gameState.mode === "gal" ? "first" : "third" };
    }
    return { interactionMode: "turn_based", person: gameState.mode === "gal" ? "first" : "third" };
  }
}
```

---

### 3.3 幕间与切镜的统一管道设计（One-Shot Intermission Pipeline）

我们将“切镜（近场视点翻转/小黑屋独白）”与“宏大幕间”合并为同一个生成技术管道——**单次长文本生成**。幕间不是“世界模拟”，而是“故事写作”，它不需要信息隔离约束。因此采用**单一 LLM 生成整段散文，不走复杂的并行 spawn 和 GM 结算流程**。这既杜绝了状态污染，也将 API 开销压到最低。

#### 1. 自动触发源与队列管理
在 `GameState` 中新增字段：
```typescript
interface GameState {
  interactionMode: "novel" | "turn_based";
  turnsSinceLastNPCInteraction: number;
  _cutaway_queue: IntermissionDirective[]; // 待播幕间队列
  _cutaway_cooldown: number;              // 冷却回合数，每次切镜后设为 3
}
```

#### 2. 三条触发线
*   **触发线 A：关系阶梯突破（短幕间，200-500字）**
    当 `updateRelation()` 检测到 NPC 的好感度阶段升级（例如 `陌生 → 熟人` 或 `友人 → 信赖`）时，自动向队列推送一条 `他者之眼` 短幕间，权重 100（最高优）。
*   **触发线 B：剧情里程碑（长幕间，800-2000字）**
    Timeline Event JSON 执行完 Outcomes 时，如果 Outcomes 中手写标注了 `intermission` 字段，则直接读取并塞入队列，权重 80。
*   **触发线 C：物理共位脱离（短幕间，200-500字）**
    在 `settle_scene` 时，若上一轮在场 NPC ≥ 2 且本轮 = 0，表示对话散场。通过好感度与当前剧情权重加权计算，挑出得分最高的一个 NPC 推送 `余波` 短幕间，权重 30。

#### 3. 消费机制（安全插入点）
切镜幕间的执行必须在 `interactionMode === "novel"` 且 `_cutaway_cooldown === 0` 时才会出队执行。在回合制对话或战斗中，幕间会在队列中静默等待，绝对不会打断玩家的实时交互闭环。

---

### 3.4 幕间数据协议（Timeline JSON Schema 扩展）

对于手写剧情的长幕间，我们允许在 timeline outcomes 中使用以下协议进行定义：

```json
"intermission": {
  "npc": "雪之下雪乃",
  "setting": "独自走在夜晚回家的商业街天桥上，寒风凛冽。",
  "topic": "今天在侍奉部比企谷突然对她说的那句‘我想要真物’。",
  "other_npcs": [
    { "name": "平冢静", "entrance": "在天桥转角偶遇，平冢静递给她一罐热红茶。" }
  ],
  "length": "long",
  "tone": "清冷、挣扎与隐秘的动摇",
  "must_cover": [
    "雪之下雪乃对‘真物’一词产生的剧烈心理震荡",
    "平冢静对她的开导与旁观视角",
    "暗示她内心紧锁的防线开始松动"
  ]
}
```

---

### 3.5 玩家超游（Metagaming）的天然防御机制

本视角系统在底层做出了一个重要的安全策略：**不对玩家输入（Input）做引擎层拦截，而是利用 NPC Agent 的“信息隔离”进行天然应对。**

*   **逻辑**：如果玩家通过在屏幕上观看幕间，得知了“阳乃在密谋害我”的场外信息，并直接输入对话：“雪之下，你姐姐在策划阴谋。”
*   **引擎反应**：引擎不跳出报错弹窗，而是原样将输入送给雪乃。
*   **心智隔离**：由于雪乃当前的心智上下文里**绝对没有**阳乃在策划阴谋的记忆（该秘密被防火墙隔离在隐藏状态里），雪乃的 LLM 只能以角色的本能反应感到困惑与抗拒：“什么？你在胡说什么？姐姐怎么可能……”
*   **效果**：这种戏剧性的信息不对称和角色自然反应，远比系统强制报错拦截更具有沉浸感和戏剧张力。

---

## 4. 争议点/未决问题

1. **同场 NPC 视角复述的生成开销**：
   对于玩家身边 NPC 的“近场视点翻转”（即用雪乃视角重写上一回合的对话细节），由于需要喂给 LLM 刚发生的原文，单次调用的输入 Context 较大。但因为不需要并行 spawn 且字数较短（200-500字），在 DeepSeek 的缓存定价体系下，其性能和费用处于极低水平，完全可接受。
2. **防抖计数器的微调**：
   目前设定为 2 回合 0 NPC 切换到 novel 模式。如果测试中发现切换不够敏感，可下调为 1 回合；若发现抖动频繁，可上调为 3 回合。

---

## 5. 验收标准

- **测试套件**：运行 `npx tsx test.ts` → ≥230 passed, 0 failed。
- **零题材硬编码**：`detect-mode.ts` 和 `viewpoint.ts` 源码中不包含任何具体角色名、地名或作品名称。
- **小说模式切换验证**：独处连续 2 回合后，系统提示词成功加载 `gm-voice-novel.md`，正文末尾显示 `[继续阅读] [介入对话]`，且字数落在 400-800 字区间。
- **幕间执行隔离验证**：幕间文本由 `[/切镜]` 闭合，阅读过程中不扣除 HP、不改变金钱背包，不改变游戏时钟分钟，不把场外信息写入玩家的 `memoryTags`。
