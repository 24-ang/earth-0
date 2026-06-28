# Council 模式 — 设计计划 (已废弃 / Deprecated)

> [!CAUTION]
> **本模块设计已于 2026-06-28 经联合审计正式废弃，建议不予执行。**
> 
> **废弃原因**：
> 1. **功能冗余**：引擎已有的多 NPC 并行 spawn（`spawn_npc_agents`）本身就是 MoA 的 NPC 特化版，已经实现了心智隔离和多智能体并行交互。
> 2. **时序漏洞**：在结算轮提前让 NPC 给出立场，违反了三阶段流水线的时序。正确的立场融合应在角色轮之后、渲染轮之前进行（作为渲染 GM 导演单的附加内容）。
> 3. **Token 与性能刺客**：双重 spawn 会导致每回合 API 费和响应延迟翻倍，对手机 Termux 的流畅度是灾难。
> 4. **无谓复杂度**：在工具箱里增加 `council` 会直接稀释 LLM 选工具的准确率。

---

## 1. 要解决什么问题

复杂多人社交场景里，GM 目前是**上帝视角脑补**：

```
GM 遇到复杂社交场景 → 自己一个人猜所有 NPC 的心思 → 写出叙事
                          ↑ 上帝视角：一个 LLM 替所有人想
```

这违反项目的「反上帝视角」核心原则，且效果差——GM 替 NPC 猜立场时，信息差、误判、尴尬这些「多人同场」最有戏的部分都被抹平了。

目标：给 GM 一个**主动调用**的决策辅助工具。复杂场景下，让每个相关 NPC 从**自己的视角**先给一句话立场，引擎把这些立场结构化（共识/分歧/意外），再交给 GM 渲染轮去织叙事。GM 知道所有人的立场，但 NPC 之间仍互相不知道——信息差被保留。

## 2. 现有基础设施

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 批量 NPC 并行 spawn | `tools/state/spawn_npc_agents.ts` | 核心复用：内部已用 `Promise.all` 并行跑多个独立 NPC LLM 调用 |
| 单 NPC spawn | `tools/state/spawn_npc_agent.ts` | 参考其 prompt 构造（关系/记忆/印象/身体状态注入） |
| NPC 行为记录 | `recordNpcAgentAction`（spawn 工具内调用） | council 复用，自动写记忆标签 + 结构化状态表 |
| NPC 模型选取 | `tools/helpers.ts:842` `getNpcAgentModel()` | 复用，默认 `deepseek/deepseek-v4-flash` |
| 工具注册 | `tools/registry.ts:153-172` `withToolTracking()` | council 作为「会改状态」的 action 工具走 tracked 路径注册 |
| 共位/在场判定 | `engine/state.ts:91` `isSameLocation()`、`getNearbyNPCs()` | 校验参与者确实在场 |

**需新增**：`engine/council.ts`（~60 行，核心函数 `convenCouncil`）、一个注册到 registry 的工具壳（如 `tools/state/council.ts`）。

**关键认知**：Council **不是新的 LLM 通道**。它是把现有 `spawn_npc_agents` 的并行能力**换一种调用语义**——从「每回合被动 spawn 角色轮」变成「GM 在复杂场景主动调用决策辅助」。

## 3. 设计方案

### 3.1 与现有 spawn_npc_agents 的区别

| 维度 | 现有 spawn_npc_agents | Council 模式 |
|---|---|---|
| 调用时机 | 每回合角色轮被动调 | GM 主动调，**只在复杂场景** |
| NPC 响应格式 | 完整内心独白 + 言行链 | **短立场 1-2 句**（省 ~80% token） |
| 输出去向 | 直接进渲染轮 | 先被引擎**结构化分析**，再进渲染轮 |
| 多一层 | 无 | Judge/提取层（consensus/divergence/surprise） |

### 3.2 数据流与控制流

```
GM 判断当前是复杂社交场景
  └─► 调用工具 council(question, participants)        [tools/state/council.ts 壳]
        │   question:      "雪之下和由比滨同时表白，两人都不知道对方心意"
        │   participants:  ["NPC-A", "NPC-B", "旁观者-C"]
        ▼
      convenCouncil(question, participants)            [engine/council.ts 核心]
        ├─ 校验 participants 都在场（isSameLocation / 存在于 npcs）
        ├─ 并行 spawn 所有参与者                        ← 复用 spawn_npc_agents 的并行逻辑
        │    每人 prompt 末尾要求：只回一句话立场，不写完整叙事
        ├─ 收集每人短立场（1-2 句）
        ├─ 提取结构化结果：
        │    consensus  共识点：哪些立场趋同
        │    divergence 分歧点：哪些立场冲突
        │    surprise   意外视角：旁观者或反直觉的立场
        ├─ recordNpcAgentAction（每位参与者，照常写记忆）
        ▼
      返回结构化结果给 GM
        └─► GM 渲染轮用 {consensus, divergence, surprise} 织叙事
            （GM 知道全部立场，NPC 之间不知道 → 信息差保留）
```

### 3.3 结构化提取怎么做

三个字段（consensus / divergence / surprise）的提取有两条路线，**推荐先用轻量启发式**：

- **路线 ⓐ（推荐，MVP）**：直接把 N 个短立场原样打包成结构（`positions: [{npc, stance}]`），再附一个「请 GM 注意分歧」的提示，由**渲染轮 GM 自己**在织叙事时消化共识/分歧。引擎不额外起 LLM。——零额外 token、零延迟。
- **路线 ⓑ（Phase 2）**：引擎再起一次极小 LLM 调用做 Judge，显式产出 consensus/divergence/surprise 三段。更结构化，但多一次调用、多一层延迟。

MVP 选 ⓐ：引擎只负责「并行收集短立场 + 打包」，分析留给已经在场的 GM 渲染轮。这样 council 真正的增量只有「并行短立场收集」这 ~60 行。

### 3.4 注册

- 工具壳 `tools/state/council.ts`：`default` 导出，`name: "council"`，`label` 人类可读，`description ≤25 中文字`（如「复杂场景召集NPC给短立场」需压到 25 字内，例如「召集NPC给一句话立场辅助决策」——实际定稿再数字数）。
- 参数 schema（TypeBox）：`question: string`、`participants: string[]`，每个 field 带 `description`。
- 经 `registry.ts` 的 `withToolTracking()` 注册（它会写状态——记忆标签）。
- **GM 合约**：在 `gm-contract.md` 角色轮一节加一句「复杂多人僵局时可选调 council 辅助决策」，但不强制——不影响简单场景的每回合主流程。

## 4. 争议点/未决问题

1. **结构化提取放引擎还是放 GM** —— ⓐ（推荐 MVP）引擎只打包短立场，consensus/divergence/surprise 由 GM 渲染轮消化，零额外 LLM；ⓑ 引擎起 Judge LLM 显式产三段。**取舍**：ⓐ 省 token/延迟、够用；ⓑ 更结构化但多一次调用。
2. **短立场的「短」如何强制** —— ⓐ（推荐）prompt 要求 + schema 无约束，靠模板话术压住；ⓑ 引擎对返回做长度截断/校验。**取舍**：ⓐ 简单但偶尔超长，ⓑ 硬保证但可能截断语义。倾向 ⓐ 起步，超长再加 ⓑ。
3. **participants 由谁定** —— ⓐ（推荐）GM 在调用时显式传入；ⓑ 引擎按共位自动拉全部在场 NPC。**取舍**：ⓐ GM 可控、可纳入「旁观者」这种关键意外视角；ⓑ 省事但可能拉进无关 NPC、稀释信号。
4. **是否写记忆** —— ⓐ（推荐）照常 `recordNpcAgentAction`，council 也是真实发生的互动；ⓑ council 仅供 GM 参考、不落记忆。**取舍**：ⓐ 与现有 spawn 一致、NPC 记得自己表过态；ⓑ 更轻但可能造成「NPC 表了态却没记住」的不一致。

## 5. 验收标准

- **回归**：`npx tsx test.ts` → ≥230 passed, 0 failed。
- **零硬编码**：`engine/council.ts` 不含角色名/地名/作品名，参与者全部由参数传入。`grep -rE '总武|侍奉部|比企谷' engine/council.ts` 为空。
- **工具约束**：`council` 的 description ≤25 中文字、单行；所有参数有 `description`；经 `withToolTracking` 注册。
- **行为观察**：给定一个 3 人僵局场景调用 council，返回包含每位参与者的短立场（各 1-2 句，明显短于普通 spawn_npc_agent 的完整独白）；GM 渲染轮能据此写出体现「分歧」的叙事；NPC 各自记忆里有本次表态记录。
- **不回归主流程**：不调用 council 的普通回合行为与改动前完全一致（council 是纯增量可选工具）。
