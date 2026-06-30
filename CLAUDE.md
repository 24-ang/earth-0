# earth-0 项目规则（每次会话自动加载）

## 必须先读

做任何改动前，先读 **`docs/PHILOSOPHY.md`**——这份文档回答了"为什么 earth-0 是现在这个样子"。具体决策的细节在 `docs/decisions.md`。加新模块参考 `docs/module-template.md`。

## 三条铁律

1. **世界数据只改 `worldpacks/oregairu/`**。`data/` 下同名文件是 TS 静态导入需要的兜底模板——改了也不会在游戏里生效。引擎启动时会自动检测并警告。
2. **改完代码跑 `npx tsx test.ts`，必须 230+ passed, 0 failed**。
3. **改守恒量的工具，execute 最后一行必须 `saveState()`**。不改守恒量的工具（纯查询/lookup/TUI面板）不需要。

## 核心原则

1. **引擎零题材硬编码**：engine/ 下没有任何角色名、地名、作品名。题材数据在 worldpacks/。
2. **引擎守恒，叙事自由**：引擎只拦截不可逆的守恒量（钱/物/HP/时间/位置/信息可见性），其余全权交 LLM。
3. **工具 description ≤ 25 中文字**：一行说清，action 值用 `|` 分隔。
   **每个参数必须有 `description`**：`Type.Number({ description: "..." })`，不要裸 `Type.Number()`。
4. **新模块只需三件事**：注册工具 → 加场景映射 → 放数据文件。详见 `docs/module-template.md`。
5. **做了反直觉的设计决定 → 马上记到 `docs/decisions.md`**。格式照搬现有条目。
6. **改框架层代码前先开分支**，验证后再合并。

## 不要做的事

- ❌ 在 engine/ 里硬编码角色名/地名/作品名
- ❌ 绕过引擎工具直接叙事改变物理世界（"你造好了墙"但没调 world_interact）
- ❌ 工具描述写成多行拼接字符串
- ❌ 工具参数用裸 `Type.Number()` 不加 description
- ❌ 在没读 PHILOSOPHY.md 和 decisions.md 的情况下质疑现有设计然后推翻重做
- ❌ 改 `data/characters.json` 或 `data/items.json` 等世界专属数据——改 worldpacks/oregairu/ 下的同名文件
- ❌ 写静默 `catch (_) {}` — 至少加 `console.error("函数名: 失败原因", e)`

## 代码质量

- **tsconfig.json**：`strict: true`，`noImplicitAny`/`noUncheckedIndexedAccess` 暂为 false（渐进收紧）。提交前确保 `npx tsx test.ts` 全绿。
- **catch 规范**：数据加载/解析失败必须 `console.error`；`fs.unlinkSync` 等非关键清理可以静默。
- **死代码**：`git rm` 不要的 `.bak`/实验脚本；删掉未调用的函数；`scratch/` 和 `tmp/` 在 `.gitignore` 中。

## 项目结构速查

```
engine/          — 通用算法
  types.ts           — GameState 类型定义
  state.ts           — 状态引擎（init/load/save/buildStatePrompt/buildStatePrompt）
  settlement.ts      — 回合结算（时间/NPC日程/interactionMode/viewpoint）
  detect-mode.ts     — 交互检测（LLM mini-judge cue 检测 + 关键词兜底） ← 新增
  phase1-classifier.ts — Phase 1 分类 LLM + 工具执行 + 回退兜底
  phase3-render.ts   — Phase 3 渲染 prompt 组装 + 渲染合约 + 状态上下文注入 ← 新增
  phase4-creative.ts — Phase 4 创意层（可选）
  viewpoint.ts       — 切镜队列 + 幕间触发
  timeline.ts        — 双轨制剧情时间线
  sex.ts, combat.ts, dice.ts, phone.ts, weather.ts, lore.ts, housing.ts, ...
tools/           — LLM 工具 + TUI 命令
  action/     — 世界修改工具（36 个，含 intimate_touch/combat_action/...）
  lookup/     — 只读查询工具（16 个，含 lookup_region/dice_roll/...）
  state/      — 状态管理工具（18 个，含 spawn_npc_agent/...）
  tui/        — 终端 UI 面板（34 个，含 /reroll/...）
  registry.ts — 所有工具和命令的注册中心 + toolsCalled 追踪 wrapper
  helpers.ts  — generateCompletion / setPi / lastRenderedProse
agents/          — LLM 系统提示词
  gm-phase1-classifier.md — Phase 1 分类器规则 ← 新增
  gm-pre.md       — 世界观 + 核心原则（已清除残留工具指令）
  gm-mode-rpg.md  — RPG 模式叙事规则（检定/战斗/探索的叙事呈现）
  gm-mode-gal.md  — GAL 模式叙事规则（丸户史明式第一人称）
  gm-mode-sex.md  — Sex 模式叙事规则（引擎返回 NPC 生理反应文字）
  gm-voice-novel.md      — novel 模式叙事结构
  gm-voice-turnbased.md  — turn_based 模式叙事结构
  gm-contract.md  — 旧三段式合约（Phase 3 不加载，测试用）
  gm-rules.md     — 规则手册（Phase 3 不加载，测试用）
  gm-start.md     — 开局流程（第一回合后跳过）
  preset.json     — 旧版 prompt 组装配置（向后兼容）
worldpacks/      — 可切换的世界数据包（oregairu/ 当前活跃）
data/            — 跨世界通用数据 + TS 静态导入兜底
docs/            — 设计文档
  PHILOSOPHY.md              ← 先读这个
  decisions.md               ← 具体设计决策
  AUDIT-2026-06-25.md        ← 最新审计
  COMPARISON-FATE-SANDBOX.md ← 与 fate-sandbox 的诚实对比
state/           — 运行时存档（git ignored）
extension.ts     — pi 框架扩展入口（四阶段编排 + 裸 stream + GAL 管理）
e2e-test.ts      — 端到端测试（45 项） ← 新增
test.ts          — 单元/集成测试（244 项）
```
