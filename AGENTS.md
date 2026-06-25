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
4. **新模块只需三件事**：注册工具 → 加场景映射 → 放数据文件。详见 `docs/module-template.md`。
5. **做了反直觉的设计决定 → 马上记到 `docs/decisions.md`**。格式照搬现有条目。
6. **改框架层代码前先开分支**，验证后再合并回 master。

## 不要做的事

- ❌ 在 engine/ 里硬编码角色名/地名/作品名
- ❌ 绕过引擎工具直接叙事改变物理世界（"你造好了墙"但没调 world_interact）
- ❌ 工具描述写成多行拼接字符串
- ❌ 在没读 PHILOSOPHY.md 和 decisions.md 的情况下质疑现有设计然后推翻重做
- ❌ 改 `data/characters.json` 或 `data/items.json` 等世界专属数据——改 worldpacks/oregairu/ 下的同名文件

## 项目结构速查

```
engine/       — 通用算法（types, state, time, combat, dice, sex, phone, router, timeline, weather, lore, housing, ...）
tools/        — LLM 工具 + TUI 命令
  action/     — 世界修改工具（35 个）
  lookup/     — 只读查询工具（16 个）
  state/      — 状态管理工具（18 个）
  tui/        — 终端 UI 面板（34 个）
  registry.ts — 所有工具和命令的注册中心 + toolsCalled 追踪 wrapper
agents/       — LLM 系统提示词（gm-state.md, gm-rules.md, gm-contract.md, ...）
worldpacks/   — 可切换的世界数据包（oregairu/ 当前活跃）
data/         — 跨世界通用数据（abilities, achievements, economy, lore, ...）+ TS 静态导入兜底
docs/         — 设计文档
  PHILOSOPHY.md              ← 先读这个
  decisions.md               ← 具体设计决策
  AUDIT-2026-06-25.md        ← 最新审计
  COMPARISON-FATE-SANDBOX.md ← 与 fate-sandbox 的诚实对比
state/        — 运行时存档（git ignored）
extension.ts  — pi 框架扩展入口
```
