# NPC 记忆升级 — 设计计划

> 来源：参考计划 `0-groovy-shannon.md` §八.1（Hermes 记忆架构借鉴）。优先级 🟡 本月，~1 小时。

## 1. 要解决什么问题

NPC 的记忆现在是**扁平 tag 数组**，召回逻辑极粗：

- 类型（`engine/types.ts:346`，内联在 `NPCRuntimeState`）：`{ tag: string; since: string; expires: number; tone?: ... }[]`。
- 召回（`engine/state.ts:3075` `getMemoryTags`）：**只取末尾 5 条**，按插入顺序，**不按相关性、不看重要度、不读 expires**。

后果：NPC 上场说台词时，拿到的「过往记忆」可能是 5 条最近的鸡毛蒜皮，而真正与当前场景相关的关键记忆（比如「玩家曾在这个地点救过我」）因为不在末 5 条而被丢掉。记忆有没有用，全靠 LLM 自己临场回想——没有引擎级的精准召回。

目标：从「**全量存末 5 条**」升级到「**按场景精准召回 3 条**」。不追求存得多，追求召回得准。

## 2. 现有基础设施

| 资产 | 位置 | 现状/复用 |
|---|---|---|
| memoryTags 类型 | `engine/types.ts:346` | 内联类型，需加可选字段（向后兼容） |
| 写记忆 | `engine/state.ts:3069` `addMemoryTag(npc, tag, expiresDays=365, tone?)` | 加新字段后扩展签名（新参可选） |
| 读记忆 | `engine/state.ts:3075` `getMemoryTags(npc)` | 现取末 5 条；新增 `recallRelevantMemories` 并存或替换调用点 |
| 过期+去重+社交分享 | `engine/state.ts:3482-3577`（内联在 `updateNPCSchedules`） | `checkExpiry`/`deduplicateTags`/`isPrivateTag`/`canShareTag`——召回升级要复用过期判定 |
| 注入 NPC prompt | `tools/state/spawn_npc_agent.ts:42`（调 `getMemoryTags`）→ `:189`（拼 `过往记忆:` 行） | 召回结果替换此处 |
| NPC 事件感知 | `engine/timeline.ts:63` `getNPCEventContext()` | L3 知识记忆已有雏形 |
| 世界知识/印象 | `getNPCLore` / `getNPCCharacterImpressions` | L3/L1 已有对应物 |
| beat 写记忆 | `engine/timeline.ts:846` `applyBeatEffects()`（动态 import `addMemoryTag`） | 升级签名后此处自动受益 |

## 3. 设计方案

### 3.1 Hermes 四层 → earth-0 映射

| Hermes 层 | earth-0 落点 | 状态 |
|---|---|---|
| L1 核心记忆（基本印象） | 关系系统（好感度/阶段/tone） | **已有** |
| L2 经历记忆 | **升级 memoryTags**（本模块重点） | 待做 |
| L3 知识记忆（设定/谣言/专业） | `getNPCEventContext` + lore 条目 | 已有雏形 |
| L4 长期存储（对话史摘要） | `spawn_npc_agent` 的 turnContext 注入上次摘要 | 可选增量 |

本模块只动 **L2**，其余层维持现状。

### 3.2 类型升级（向后兼容）

给 `engine/types.ts:346` 的内联 memoryTag 元素**加可选字段**：

```
{ tag; since; expires; tone?;
  priority?       // 重要度权重：关键事件 > 日常闲聊
  emotional_valence?  // 情感效价：正面 / 负面 / 中性
  related_npcs?   // 这条记忆涉及哪些其他角色
}
```

全部 `?` 可选 → 旧存档里没有这些字段的记忆条目仍合法，召回时按缺省值处理（如 priority 缺省视为中等）。**无需 schema 迁移。**

> 实现提示：当前是内联匿名类型，加字段后建议抽成命名 interface（如 `MemoryTag`），便于 `recallRelevantMemories` 的签名引用——但这属实现细节，与 E 模块的 `state-memory.ts` 抽取协调。

### 3.3 核心新增：recallRelevantMemories

```
recallRelevantMemories(npcName, context) → 最相关的 3 条记忆
   context = { location, presentNPCs, topic? }   // 当前场景信号
```

**召回打分（引擎级，不走 LLM）**，对该 NPC 每条未过期记忆算一个相关性分，取 Top 3：

```
score(memory) =
    priority 权重
  + 命中 context.presentNPCs ∩ memory.related_npcs（在场的人涉及的记忆更相关）
  + 命中 context.location（同地点发生过的记忆更相关）
  + 命中 context.topic 关键词（可选）
  + 新近度（since 越近轻微加分，作平局打破）
  − 过期/接近过期 减分（复用 checkExpiry 的日期逻辑）
```

打分是纯启发式、可调权重、零额外 LLM 调用。

### 3.4 数据流：召回怎么进 NPC prompt

```
角色轮：spawn_npc_agent(npcName, sceneContext)        [tools/state/spawn_npc_agent.ts]
  ├─ 旧：memories = getMemoryTags(npcName)             // 末 5 条
  ├─ 新：memories = recallRelevantMemories(npcName, {  // 相关 3 条
  │        location: gameState.player.location,
  │        presentNPCs: <在场其他 NPC>,                // 复用现有「在场其他 NPC」识别
  │        topic: <从 sceneContext 提取，可选>
  │     })
  ▼
  prompt 第 189 行 `过往记忆: ${memories.join("；")}`   // 注入点不变，喂的内容更准
  ▼
  generateCompletion(... npc_agent_model ...)
```

`spawn_npc_agents`（批量版）同样替换其记忆注入处，保持单/批量两条路径一致。

### 3.5 写入侧的完整改造链路 (补全数据写入闭环)

为了让升级后的字段（`priority` / `emotional_valence` / `related_npcs`）在运行时有真实的数据源，必须对以下四个写入入口进行改造：

#### 1. 剧情引擎层 (`engine/timeline.ts` & `timeline JSON`)
在 Timeline Outcomes 解析器中升级 `memory_tags` 对象的 JSON 解析逻辑：
*   **支持 JSON 定义**：
    ```json
    "memory_tags": [
      {
        "target": "雪之下雪乃",
        "tag": "关于猫咪与玩家的亲密讨论",
        "expires": 365,
        "priority": 3,
        "emotional_valence": "positive",
        "related_npcs": ["由比滨结衣"]
      }
    ]
    ```
*   **代码升级**：`timeline.ts` 在循环调用 `addMemoryTag` 时，从 outcomes 数组元素中提取 `t.priority`、`t.emotional_valence`、`t.related_npcs`（均设为可选 fallback），传给升级后的 `addMemoryTag`。

#### 2. 工具动作结算层 (`tools/action/settle_scene.ts` & `tool outcomes`)
*   在结算轮，解析所有工具运行所产生或规则转换所生成的 `memory_tags`（如偷窃被抓、关系降温等自动标签）。
*   解析器在调用 `addMemoryTag` 时，同样匹配并传入可选的扩展参数。

#### 3. LLM/TUI 动作命令层 (`tools/action/add_memory_tag.ts`)
*   修改 `add_memory_tag` 工具的 TypeBox 参数定义，暴露这三个新增字段：
    ```typescript
    export const AddMemoryTagSchema = Type.Object({
      target: Type.String({ description: "目标 NPC 名字" }),
      tag: Type.String({ description: "记忆标签内容" }),
      expires_days: Type.Optional(Type.Number({ description: "过期天数，默认 365" })),
      tone: Type.Optional(Type.String({ description: "情感语气" })),
      priority: Type.Optional(Type.Number({ description: "优先级：1=普通/日常，2=重要，3=核心/不可遗忘" })),
      emotional_valence: Type.Optional(Type.Union([Type.Literal("positive"), Type.Literal("negative"), Type.Literal("neutral")], { description: "情感效价" })),
      related_npcs: Type.Optional(Type.Array(Type.String(), { description: "此记忆关联的其他在场 NPC 名字" }))
    });
    ```

#### 4. NPC 角色轮自主发言记录 (`recordNpcAgentAction`)
在 NPC Agent 扮演结束记录日志时，引擎自动补充上下文环境，进行智能默认回填：
*   `related_npcs`：自动扫描当前场景在场的所有其他 NPC 名字（通过 `isSameLocation` 计算）。
*   `priority`：默认填 `1`（因为普通的单轮对话属于日常，除非 Review Agent 升级其权重）。
*   `emotional_valence`：读取 NPC 角色当前 runtime state 的 `tone`（语气）进行简单的正负映射，无法映射则缺省为 `neutral`。


## 4. 争议点/未决问题

1. **召回数量 3 vs 5** —— ⓐ（推荐）召回 3 条精准记忆，token 省、信噪比高；ⓑ 保持 5 条但改成按相关性排序。**取舍**：ⓐ 更聚焦但可能漏；ⓑ 更全但稀释。倾向 3，可配置。
2. **打分纯启发式 vs 轻量 LLM 召回** —— ⓐ（推荐）引擎启发式打分，零额外调用、可解释；ⓑ 用嵌入/小 LLM 做语义召回，更准但引入新依赖+延迟+成本。**取舍**：项目在 DeepSeek 价格下仍倾向 ⓐ，避免给每个 NPC 每回合加一次召回 LLM。
3. **getMemoryTags 是替换还是并存** —— ⓐ（推荐）新增 `recallRelevantMemories`，spawn 调用点改用它，`getMemoryTags` 保留给其他只需「最近几条」的场景；ⓑ 直接改 `getMemoryTags` 内部逻辑，调用点不动。**取舍**：ⓐ 不破坏其他调用方、语义清晰；ⓑ 改动小但可能影响未知调用点。
4. **新字段何时回填** —— ⓐ（推荐）类型先上、写入点逐步填、召回对缺省值鲁棒；ⓑ 一次性给所有写入点补齐字段。**取舍**：ⓐ 平滑、风险低；ⓑ 彻底但改动面大、易引入 bug。
5. **与 E 模块的 state-memory.ts 抽取顺序** —— 记忆相关函数（addMemoryTag/getMemoryTags/recall + 过期/分享）逻辑上应同住一个 `state-memory.ts`。**未决**：先做 C（在现 state.ts 里加 recall）再让 E 整体搬走，还是先等 E 抽出 `state-memory.ts` 再在新文件里加 recall。倾向「先 C 后 E」——C 的增量小，E 搬运时一起带走。

## 5. 验收标准

- **回归**：`npx tsx test.ts` → ≥230 passed, 0 failed。
- **向后兼容**：旧存档（memoryTags 无新字段）加载不报错；`recallRelevantMemories` 对缺 priority/related_npcs 的条目按缺省值正常打分。
- **召回正确性**（建议加单测）：构造一个 NPC，给它 ① 一条「与在场 NPC-B 相关的高 priority 记忆」②若干低 priority 闲聊记忆 + 一条过期记忆；调 `recallRelevantMemories(npc, {presentNPCs:[B], location:L})` → 返回 Top 3 含 ① 那条、不含过期那条。
- **零硬编码**：召回逻辑由 context 运行时驱动，不含角色名/地名/作品名。
- **行为观察**：同一 NPC 在「与某人有旧账的地点再遇到此人」时，注入 prompt 的 `过往记忆:` 行包含那段旧账，而非最近 5 条无关闲聊。
- **工具约束**：若新增任何工具，description ≤25 中文字（本模块主要是引擎函数，预计不新增 LLM 可见工具）。
