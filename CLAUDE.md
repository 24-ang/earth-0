# earth-0 项目规则（每次会话自动加载）

## 快速参考——你只需要记住这三条

1. **角色/物品/商店等世界数据只改 `worldpacks/oregairu/`**，不能改 `data/` 下的同名文件。改了也不会生效。改错了引擎启动时会警告。
2. **改完代码跑 `npx tsx test.ts`，必须 225+ passed**。现在有 11 条集成测试兜着接线层，手机顶栏 undefined / 工具不存档 / prompt 有脏值这类 bug 穿不过去了。
3. **做了反直觉的设计决定 → 马上记到 `docs/decisions.md`**。一句话够。不然下次 AI 审计会当成 bug 删掉。

## 必须先读

做任何改动前，先读这两个文件了解设计决策：

- `docs/framework-optimization-log.md` — 为什么这么设计（工具压缩/场景提示/时间线/世界观挂载）
- `docs/module-template.md` — 新模块开发模板（工具注册/场景映射/prompt注入/数据文件）
- `docs/decisions.md` — 反直觉的设计决策（容易被当成 bug 删掉的东西）

## 核心原则

1. **引擎零题材硬编码**：所有作品/角色/地名在 `data/`，`engine/` 只放通用算法
2. **工具 description ≤ 25 中文字**：一行说清，action 值用 `|` 分隔
3. **新模块只需三件事**：注册工具 → 加场景映射 → 放数据文件
4. **改框架层代码前**：先开新分支，在分支上实验，验证后再合并回 rebuild
5. **做任何改动后**：跑 `npx tsx test.ts`，必须 ≥ 225 passed, 0 failed
6. **每次改动后记录决策**：加了新工具/修了坑/做了反直觉取舍 → 在 `docs/decisions.md` 末尾补一条（一句话够）。新增工具还要在 `docs/tools-list.md` 登记一行。改动前先和用户商量，确认后再写代码和记录。

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
