# earth-0 执行计划 v2

> 2026-06-18
> 整合 PLAN-v1.md + narrative-engineering-roadmap.md，统一追踪所有待办项。
> 历史上下文：GPT（Codex）审计 PLAN-v1 后提出四层叙事工程路线，Gemini 执行了文档同步和 Layer 1。

---

## 已完成

| 项 | 来源 | 执行者 |
|---|---|---|
| gm-contract.md 补「先查再写」「工具后果」规则 | PLAN-v1 P0-1 | Gemini |
| gm-rules.md 旧工具名 (edit_map_cell → world_interact) | GPT 审计 | Gemini |
| module-template.md 场景映射位置修正 | GPT 审计 | Gemini |
| gm-contract.md 编号错误 (④④ → ③④) | GPT 审计 | Gemini |
| AGENTS.md 创建 | GPT 审计 | Gemini |
| 通勤/建造系统规则重写 | PLAN-v1 衍生 | Gemini |
| 6 种新路人 NPC 模板 | PLAN-v1 衍生 | Gemini |
| 平冢静数据确认 | PLAN-v1 衍生 | Gemini |
| **Layer 1 导演单** 加至 gm-contract.md | roadmap | Gemini（审：CC） |
| CCR 日志关闭 + 无用插件禁用 | 成本优化 | CC |

---

## 待执行

### P0 — 叙事工程骨架（按顺序）

| 层 | 描述 | 涉及文件 | 风险 | 执行者 |
|---|---|---|---|---|
| **Layer 2** 台账系统 | state.ts 加 turnLog[] 数据结构，GM 每轮导演单自动落盘 | engine/state.ts, engine/types.ts, extension.ts（可选） | 中（动引擎） | CC |
| **Layer 3** 秘密防火墙 | 信息可见性分级 (player_known / hidden_canonical 等) | engine/state.ts, agents/gm-contract.md, data/ | 中 | CC |
| **Layer 4** 两段式渲染 | 结算轮+渲染轮分离。单模型先行版：render_scene 工具 + gm-contract 两段式工作流。双模型留待 pi 支持 | ✅ | CC |

### P1 — PLAN-v1 遗留

| 项 | 描述 | 涉及文件 | 执行者 |
|---|---|---|---|
| start-game 重写 | 5 分钟新手引导 + 新/回归角色选择 + 16岁/6岁双开场 | ✅ | CC |

### P2 — 延后（不急着做）

| 项 | 延后原因 |
|---|---|
| 赌博系统 | 玩法堆叠，等叙事骨架稳固后再加 |
| 买房系统 | 同上 |
| 季节事件 | 同上 |
| novel-to-data 技能 | 小说→数据转换，等引擎更成熟 |
| style-oregairu 技能 | 文风模板，等两段式渲染有雏形后更有价值 |
| 两段式渲染全量实现 | 等 pi 框架支持 render-model 或插件生态成熟 |

---

## 验收标准

每层完工后：

1. `npx tsx test.ts` ≥ 125 passed
2. 手动测试：开新游戏 → 玩 3 轮 → 检查导演单是否生成 → 检查台账是否落盘
3. Layer 3 额外：确认隐藏信息不出现在玩家可见输出中

---

## 不做的事

- ❌ 在叙事骨架补齐前堆新玩法
- ❌ 盲目追新论文/新架构，按项目病灶走
- ❌ 嵌入 Python 依赖（Mem0/Letta/Zep），保持 TypeScript + pi 栈
- ❌ 把数据流当工作流（data/lore/ 保持为数据）
