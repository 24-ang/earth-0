# earth-0 下一阶段优化计划书

> 2026-06-17
> 拿去给其他 AI 审阅用。上下文自包含，不需要看对话历史。

---

## 项目简介

earth-0 是一个基于 pi 框架的终端文字 RPG。核心架构是**引擎（TypeScript）+ LLM（叙事）**：引擎负责物理世界（骰子/战斗/经济/NPC日程/地图网格），LLM 负责把所有状态变化翻译成自然叙事。

**当前规模**：9 个引擎模块、20+ 个 JSON 数据文件、45 个 LLM 工具、17 个 TUI 命令、125 个测试。

**当前分支**：`rebuild`（`e97bc5e`），125 tests 全绿。

---

## 已完成框架优化（6/17）

| 优化 | 说明 | 参考 |
|------|------|------|
| 工具描述压缩 | 45 个 LLM 工具 description 全部压缩到单行 ≤25 中文字 | [Tool Attention Is All You Need](https://arxiv.org/abs/2604.21816)（2026.4） |
| 场景工具提示 | `buildStatePrompt` 根据游戏状态动态注入场景相关工具提示（软约束） | [Looking Is Not Picking](https://arxiv.org/abs/2606.16364)（2026.6）+ [Sculptor](https://iclr.cc/virtual/2026/poster/10010394)（ICLR 2026） |
| 剧情时间线接入 | `checkTimelineEvents()` 钩入游戏循环 + 三个 LLM 工具 + prompt 三段注入 | — |
| 时间线分层管理 | `data/timelines/作品名/弧名.json` 递归加载，支持多作品分片 | — |
| 世界观设定挂载 | `lookup_lore` 工具 + `data/lore/` 目录 | — |
| 模块开发模板 | `docs/module-template.md` — 新模块的四约定 | — |
| 框架优化日志 | `docs/framework-optimization-log.md` — 每次优化的原理和设计决策 | — |
| CLAUDE.md | 项目根目录规则文件，LLM 会话自动加载 | — |

---

## 当前架构审计

### 系统提示词组装

pi 框架通过 `preset.json` 分层组装系统提示词：

```
default 顺序: pre → rules → contract → state → mode_{mode}
               ↑ 硬规则在前                  ↑ 状态数据在后
```

**评价**：已对齐 2026 最佳实践——"关键指令放 prompt 前半部分，状态数据放后半部分"。

### 已有且做得很好的

**`agents/gm-contract.md`**（输出合同）：

| 已覆盖 | 具体内容 |
|--------|---------|
| 禁止列表 | 禁止替玩家说话/行动/决定、禁止报数值、禁止分析心理 |
| 输出格式 | `---` 分割线 + `>` blockquote + `[风格]` 标签 + 数字圈号 |
| 叙事约束 | ≤2段核心叙事、身体姿态感知、微观空间定位 |
| 对答示例 | 完整的春物风格示例 |

**`agents/gm-rules.md`**（GM 规则）：

| 已覆盖 | 具体内容 |
|--------|---------|
| 核心宪法 | "任何对世界状态的改变都必须通过调用 Tool 来实现" |
| 服装纪律 | 描写前必须先调 `lookup_character`，严格按 flavor 字段描写 |
| 身份检定 | 遇到强检查必须调 `identity_check` |
| 六维/HP/AC/骰子/战斗/负重/装备/关系/时间 | 完整的规则参考 |

---

## 发现的问题与解决方案

### 问题 1：LLM 调了工具但自己不确认

**现象**：LLM 调了 `commit_turn(30)` + `adjust_relation(雪乃, +5)`，但在叙事输出中没有任何标记。从日志看工具调用了，但从输出看完全不可见。

**影响**：调试困难，无法做轨迹评估（2026 年共识：只看最终答案无法判断 Agent 是否正确使用了工具）。

**方案**：在 `gm-contract.md` 的输出格式规则中加一条——如果本轮调用了任何引擎工具，在选项分割线前加一行元信息：

```
> [系统] 已调用: commit_turn(30min), adjust_relation(雪乃, +5)
```

这行用 `>` blockquote，视觉上低调，不会干扰玩家阅读。本轮没调工具则省略。

**改动位置**：`agents/gm-contract.md`（加 3 行规则 + 示例）

---

### 问题 2："先查再写"规则不完整

**现象**：`gm-rules.md` 的"服装描写纪律"已要求先调 `lookup_character` 再描写服装。但没有覆盖其他 NPC 细节——外貌特征、性格、身体数据等。

**影响**：LLM 可能凭训练数据记忆编造 NPC 细节（如"她的红色长发"但原作是黑色）。

**方案**：将"服装描写纪律"扩展为通用的"信息获取纪律"：

```
描写任何 NPC 的身体细节、外貌特征、性格前：
1. 先调 lookup_character 获取基础数据
2. 如涉及亲密描写，先调 lookup_body
3. 如涉及世界观设定，先调 lookup_lore
```

**参考**：[Premise Verification](https://arxiv.org/abs/2504.06438)（TMLR 2026）——"先查再写，查了再生成"比事后修正幻觉有效得多。

**改动位置**：`agents/gm-contract.md`（"必须"列表中加一条）

---

### 问题 3：LLM 不理解"绕过工具"的后果

**现象**：LLM 偶尔会在叙事中描述一个物理变化（"墙上多了一扇门"）但没调 `edit_map_cell`。从 LLM 的角度看，文字描述 = 事情发生了。

**影响**：叙事与引擎状态脱节。下次 `/room` 就穿帮了。

**方案**：用 AIRP-MCP-Server 的"决策提示"哲学——不是命令"你必须调工具"，而是告知"不调的后果是什么"：

```
如果你描述了一个物理变化但没调用对应的工具：
→ 引擎里不会有这个变化。下次玩家 /room 就穿帮了。
→ 世界不会因为你的文字而改变，只会因为工具调用而改变。
→ 请确保每个物理变化都调用了对应的工具。
```

**参考**：[Constraint Drift](https://arxiv.org/abs/2605.10481)（2026.5）——纯提示词安全规则在工具可用时违反率高达 85%。告知后果 + 让 LLM 知情自选，比命令式规则更有效。

**改动位置**：`agents/gm-contract.md`（"必须"列表末尾加工具纪律）

---

### 问题 4：新玩家引导不够

**现象**：`skills/start-game/SKILL.md` 只做"收集信息→调 init_game→开场叙事"。新玩家打开游戏后没有明确的方向感。

**影响**：没有前端 UI 引导，新玩家不知道第一步该干嘛。

**方案**：重写 `start-game` skill：

```
1. 检测新玩家 / 回头客
   ├── 新玩家 → 5分钟引导流程
   │   1. 一次性问姓名/性别/年龄（全给默认值，玩家回车即可跳过）
   │   2. 玩家确认后调用 init_game
   │   3. 开场叙事直接丢进场景——季节→环境→第一句NPC对白
   │   4. 第一轮就输出选项（按 gm-contract.md 格式）
   │   5. 选项永远包含"（自己输入）"
   └── 回头客 → 恢复存档
        → 上一幕一句话摘要
        → 立刻给选项
```

**参考**：[dm20-protocol](https://github.com/Polloinfilzato/dm20-protocol/issues/119) 的 `start_session()` 规范——目标 5 分钟内进入第一次有意义的互动。

**改动位置**：`skills/start-game/SKILL.md`

---

## 改动汇总

| # | 优先级 | 文件 | 改动量 | 风险 |
|---|--------|------|--------|------|
| P0-1 | 🔴 | `agents/gm-contract.md` | +3 条规则（工具自检/先查再写/工具后果） | 极低——纯文本追加 |
| P0-2 | 🔴 | `skills/start-game/SKILL.md` | 重写引导流程 | 低——只影响开局，不影响进行中的游戏 |
| P1 | 🟡 | `skills/novel-to-data/` | 新建目录 + SKILL.md + references/ | 零——新功能，不碰现有代码 |
| P2 | 🟡 | `skills/style-oregairu/` | 新建目录 + SKILL.md | 零——新功能，不碰现有代码 |

**不改动的文件**：`engine/`、`extension.ts`、`data/`、`agents/gm-rules.md`、`agents/gm-state.md`

---

## 不做的事与原因

| 不做 | 原因 |
|------|------|
| 不重写 gm-contract.md | 现有格式已对齐 2026 最佳实践，只需补缺口 |
| 不拆分 agents/ 为 skills | preset.json 分层组装就是正确架构 |
| 不嵌入 Mem0/Letta/Zep | Python 基础设施，earth-0 是 TypeScript + pi |
| 不把数据流当工作流 | `data/lore/` 保持为数据，转换流程做成 skill |
| 不做全自动转换脚本 | LLM 辅助的半自动 skill 质量可控 |
| 不做硬工具过滤 | pi 框架暂不支持，软提示已验证有效 |

---

## 验证计划

```bash
npx tsx test.ts  # 基准：125 passed, 0 failed（改动不应减少测试数）
```

P0 完工后手动验收：
1. 开新游戏 → 新玩家 5 分钟内进入第一幕
2. 选项格式正确（`---` + `>` blockquote + `[风格]` + 数字圈号）
3. 调了工具时末尾有 `[系统]` 元信息
4. NPC 细节描写前确实调用了 `lookup_character`
5. LLM 没有冒充玩家做决定

---

## 全部参考文献

| 来源 | 类型 | 时间 | 借鉴了什么 |
|------|------|------|----------|
| [Looking Is Not Picking](https://arxiv.org/abs/2606.16364) | 论文 | 2026.6 | 工具选择失败在读出阶段，软提示有效 |
| [Tool Attention Is All You Need](https://arxiv.org/abs/2604.21816) | 论文 | 2026.4 | 工具 schema 压缩 → 95% token 削减，准确率 24%→91% |
| [Constraint Drift](https://arxiv.org/abs/2605.10481) | 论文 | 2026.5 | 提示词安全规则不敌工具可用性 → 85% 违反率 |
| [Premise Verification](https://arxiv.org/abs/2504.06438) | TMLR 2026 | 2025.4 | 先查再写比事后修正幻觉有效 |
| [Sculptor](https://iclr.cc/virtual/2026/poster/10010394) | ICLR 2026 | 2026 | LLM 自管理 context |
| [deterministic-horizon](https://github.com/bettyguo/deterministic-horizon) | 论文 | 2026 | 推理模型不再从 CoT 获益，工具委派是唯一出路 |
| [AIRP-MCP-Server](https://github.com/GhostXia/AIRP-MCP-Server) | 项目 (12⭐) | 2026 | 决策提示哲学、Token 纪律、插件体系 |
| [Story-to-Game](https://github.com/Shanyin-ai/Story-to-game) | 项目 (291⭐) | 2026 | 9 步小说→游戏转换流水线 |
| [SoloQuest v9](https://dev.to/austin_amento_860aebb9f55/prompt-architecture-for-a-reliable-ai-dungeon-master-d99) | 生产验证 | 2025 | 四层系统提示词架构 |
| [dm20-protocol](https://github.com/Polloinfilzato/dm20-protocol/issues/119) | 项目规范 | 2025 | start_session() 新手引导规范 |
| [2026 Agent 生产指南](https://futureagi.com/blog/build-llm-agents/) | 行业综述 | 2026 | 指令优先、轨迹评估、Skill 架构 |
| [SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) | 行业标准 | 持续 | 关键词触发式 lore 注入，经过数百万人验证 |

---

## 项目文件结构（供参考）

```
earth-0/
├── CLAUDE.md                           ← 每次会话自动加载的规则
├── docs/
│   ├── module-template.md              ← 新模块开发模板
│   ├── framework-optimization-log.md   ← 优化原理记录
│   └── PLAN-v1.md                      ← 本文件
├── engine/                             ← 通用引擎（零题材硬编码）
│   ├── types.ts, state.ts, time.ts, timeline.ts
│   ├── combat.ts, dice.ts, sex.ts, phone.ts, router.ts
├── data/                               ← 题材数据（换题材只改这里）
│   ├── characters.json, rooms.json, items.json
│   ├── timelines/作品名/弧名.json       ← 递归加载
│   ├── calendar/作品名.json
│   └── lore/作品名_world.json
├── agents/                             ← 系统提示词
│   ├── preset.json                     ← 组装配置
│   ├── gm-pre.md, gm-rules.md, gm-contract.md
│   ├── gm-state.md, gm-mode-*.md
├── skills/                             ← 可复用工作流
│   ├── tavern2agent/SKILL.md
│   └── start-game/SKILL.md
├── extensions/                         ← 独立扩展
└── extension.ts                        ← 45个LLM工具 + 17个TUI命令
```
