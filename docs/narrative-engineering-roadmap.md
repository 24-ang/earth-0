# Narrative Engineering Roadmap

> 本文档记录了 `earth-0` 从“事件驱动沙盒”走向“长跑叙事工程”的战略路线图。
> 灵感来源于 fate-sandbox 等专业级 Agent 叙事项目，旨在解决长会话中 LLM 状态漂移、秘密泄露和提示词臃肿的问题。

---

## 核心认知：我们处于哪个阶段？

目前的 earth-0 已经是一个合格的 **Evented Runtime（事件驱动运行时）**：
- 引擎管事实，LLM 管叙事
- 物理状态（位置、物品、时间）已经完全通过 Tool 工具化
- 数据实现了分层（`data/`, `engine/`, `agents/`）
- 100+ 测试用例保证了底盘的稳固

但 earth-0 距离 **Narrative Runtime（长跑叙事工程）** 仍有差距。我们目前更像是一个“全能主持人”，一个大模型在一轮对话里要同时兼顾：算账、查资料、控节奏、写文。长跑下来，模型会累，状态会漂。我们要走向“专业片场”模式，引入场记、结算、渲染等更专业的分工。

---

## 升级路线图：分四层逐步推进

为了避免“步子迈得太大扯到蛋”，我们不一步到位切换双模型，而是分 4 个层级稳扎稳打：

### 第 1 层：导演单 (Direction Packet Lite)
**目标**：不碰引擎底座，仅在 Prompt 层面确立结构化的“场记单”。

**做法**：要求 GM 在输出面向玩家的文字前或后（或者仅在内部日志记录），生成一个结构化的状态摘要（Direction Packet）：
```text
[导演单]
player_action: 玩家实际做了什么
resolved_changes: 本轮工具实际落地的变化
scene_result: 场景结果
open_hooks: 还没收口的钩子
next_pressure: 下一轮应推动什么
```

**解决的问题**：
- 为以后的上下文压缩（Compaction）提供高信息密度的锚点。
- 解决“长会话每轮发生了什么”的追踪难题。

### 第 2 层：台账系统 (Turn Ledger / Event Ledger)
**目标**：将“导演单”物理落盘，变成确定的数据结构。

**做法**：将 Packet 写入 `state.ts` 或 Session History 中：
```ts
turnLog: [
  {
    turn: 42,
    playerAction: "...",
    toolsCalled: ["commit_turn", "adjust_relation"],
    resolvedChanges: ["时间+30分钟", "雪乃好感+5"],
    hooksOpened: [],
    hooksClosed: []
  }
]
```

**解决的问题**：
- 明确旧聊天压缩时不丢事实。
- 面对 LLM 幻觉时有确定的账本可以对账。

### 第 3 层：秘密与揭示防火墙 (Secret / Reveal Firewall)
**目标**：解决长会话中容易出现的信息泄露（Metagaming）问题。

**做法**：给内存标签、物品说明和设定数据加上可视性级别：
```ts
visibility: "player_known" | "protagonist_known" | "scene_public" | "hidden_canonical"
```

| 信息类型 | 处理策略 |
|---|---|
| **玩家知道但角色不知道** | 不注入角色的公开记忆 |
| **NPC 秘密** | 不注入普通叙事提示，或明确标注禁止泄露 |
| **已揭示秘密** | 走 reveal log，转为公开事实 |
| **未触发剧情** | 对玩家不可见 |

### 第 4 层：两段式渲染 (Two-Pass Rendering)

**当前状态**（2026-06-26）：✅ 单模型先行版已落地。gm-contract.md 定义了三段式工作流（结算轮→角色轮→渲染轮），三个阶段职责边界清晰（结算轮禁写叙事，渲染轮禁调工具）。纯代码拼接 `<directors_note>` 零 Token 成本。双模型物理分离（结算用便宜模型、渲染用贵模型）的基建已预留（`rendering.json` 的 `logic_engine_model` 字段），待 pi 框架支持或用户需求驱动时激活。

**目标**：将工具纪律与文笔剥离，达到顶级的叙事体验与逻辑稳定性。

**做法**：利用 `pi` 框架未来的插件或脚本，将一个回合拆分为两次调用：
1. **结算轮 (Settlement Pass)**：低成本、高推理模型（如 DeepSeek V4 Pro），专注调用工具、算账，并产出 Direction Packet。
2. **渲染轮 (Render Pass)**：高成本、高文笔模型（如 Claude Opus 4.5 / Gemini 3.1 Pro），仅读取 Packet 和文风历史，写出面向玩家的纯粹小说正文，不碰任何工具。

**解决的问题**：
- 完美解决“逻辑强的模型文笔干，文笔好的模型乱发散”问题。
- 结算端工具调用失败可在幕后重试，对玩家 100% 透明。

---

## 执行优先级

**当前应做的：**
1. 文档/规则同步（已完成：修旧工具名、统一 AGENTS.md、修复契约）。
2. 在 `start-game` 等模块试水 Direction Packet Lite 的概念（仅作为内部逻辑）。

**延后（不急着做）的特性：**
- 赌博系统
-买房系统
- 季节事件
- 大规模小说抓取脚本
- 两段式渲染引擎重构

**记住：** 不要在没打好台账地基的情况下堆叠新玩法，先让叙事引擎具备稳定的骨架。
