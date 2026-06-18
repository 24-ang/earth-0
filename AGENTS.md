# earth-0 项目规则（每次会话自动加载）

## 必须先读

做任何改动前，先读这两个文件了解设计决策：

- `docs/framework-optimization-log.md` — 为什么这么设计（工具压缩/场景提示/时间线/世界观挂载）
- `docs/module-template.md` — 新模块开发模板（工具注册/场景映射/prompt注入/数据文件）

## 核心原则

1. **引擎零题材硬编码**：所有作品/角色/地名在 `data/`，`engine/` 只放通用算法
2. **工具 description ≤ 25 中文字**：一行说清，action 值用 `|` 分隔
3. **新模块只需三件事**：注册工具 → 加场景映射 → 放数据文件
4. **改框架层代码前**：先开新分支，在分支上实验，验证后再合并回 rebuild
5. **做任何改动后**：跑 `npx tsx test.ts`，必须 ≥ 125 passed, 0 failed

## 不要做的事

- ❌ 在 engine/ 里硬编码角色名/地名/作品名
- ❌ 绕过引擎直接叙事改变物理世界（"你造好了墙"但没调 world_interact）
- ❌ 工具描述写成多行拼接字符串
- ❌ 在没读 docs/ 的情况下质疑现有设计然后推翻重做

## 项目结构速查

```
engine/    — 通用算法（types, state, time, combat, dice, sex, phone, router, timeline）
data/      — 题材数据（characters, rooms, items, shops, timelines/, calendar/, lore/）
agents/    — LLM 系统提示词（gm-state.md, gm-rules.md, gm-*.md, preset.json）
extension.ts — 所有 LLM 工具 + TUI 命令注册
docs/      — 框架设计文档
```
