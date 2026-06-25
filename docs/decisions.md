# 设计决策日志 (Lightweight ADR)

> 每一条都回答"为什么这么选"和"不要做什么"。
> 反直觉的决策记录在这里，防止未来执行者（人或 AI）当成 bug 删掉。

---

## 1. NPC 外观全量注入 / 回合

**是什么**：每回合 `buildStatePrompt` 把场景内每个 NPC 的完整外观（体型/发色/瞳色/发饰/服装）重新注入系统提示。

**为什么**：
- DeepSeek 预训练缺乏春物/不知火舞等角色的外观知识，不喂就瞎编
- 怕 LLM 不主动调 `lookup_character` —— DS 的工具调用纪律弱（Berkeley 榜多轮成功率仅 47%）
- 外观一致性错了立刻穿帮，属于不可逆损失，主动注入比被动查询稳

**放弃了什么**：每 NPC 额外 ~1-2KB/回合。日常场景 1-3 人，总量在规则手册面前是小头。

**不要做**：❌ 改成"让 LLM 自己调 lookup"或"只注入名字"。外观不一致是角色扮演游戏的致命 bug。

**相关代码**：`engine/state.ts:818-853` (NPC details collector)

---

## 2. 三段式分层：GM(Pro) → NPC×N(Flash) → 渲染(Pro)

**是什么**：每回合拆三步 ——
1. **结算轮**：GM(Pro) 处理玩家输入，调用引擎工具，产出导演单
2. **角色轮**：并行派生 1-N 个 NPC Agent(Flash)，每个只看自己的知识图谱
3. **渲染轮**：GM(Pro) 把导演单 + NPC 回应织成连贯叙事

**为什么（反上帝视角）**：
- 单 LLM 扮演所有角色 = 信息全知 = 每个 NPC 说话时已经"知道"其他 NPC 的内心活动
- 拆成独立 Flash 调用 → 每个 NPC 只有自己的记忆/印象/身体状态 → 对话出现自然的信息差、误判、尴尬
- GM(Pro) 只负责世界结算和最终叙事编织，不替 NPC 说话

**放弃了什么**：
- 多一次 API 调用（3-5 个 NPC 并行，延迟 ≈ 最慢那一个）
- 省 token 的空间（单 GM 扮演所有人更便宜），但换来了叙事真实感

**不要做**：❌ 合并为单 GM 调用。❌ 让 NPC 共享同一个 prompt。 
**可以做**：调整每层的模型（Flash→Haiku→Sonnet 按预算）。

**相关代码**：
- `agents/gm-contract.md:14-75` (三段式合同)
- `tools/state/spawn_npc_agent.ts` (单个 NPC 代理)
- `tools/state/spawn_npc_agents.ts` (批量 NPC 代理)
- `tools/action/render_scene.ts` (渲染轮)
- `data/rendering.json` → `npc_agent_model` (NPC 模型配置)

---

## 3. NPC Agent 是临时演员，不是常驻角色

**是什么**：NPC Agent 不绑定具体角色。场景需要时，GM 喊 `spawn_npc_agents`，拉几个临时演员上场。每人拿一张角色卡（自己的记忆+对外貌的印象+身体状态），演完这场的戏就退场。下次再需要，下次再喊。

**为什么**：
- 一个角色的台词不需要知道所有角色的内心活动——每人只拿自己的剧本，自然产生信息差和误判
- 不需要让每个 NPC 24 小时在后台"活着"——只在被喊上场时才占用 API 调用
- 演完后自动写一条记忆摘要（`memoryTags`），下次被喊时能从上次停下的地方继续

**不要做**：❌ 把 NPC Agent 改成绑定角色的常驻后台进程。

**相关代码**：`tools/state/spawn_npc_agent.ts`, `tools/state/spawn_npc_agents.ts`, `engine/state.ts:3064-3067`

---

## 4. lore 被动查询，不自动注入 prompt

**是什么**：世界观设定(`data/lore/`)不是每回合灌进 prompt，而是 LLM 需要时调 `lookup_lore` 自己查。

**为什么**：
- 世界观设定量大，全量注入会撑爆 context window
- LLM 作为 GM，应该知道什么时候需要查设定
- SillyTavern World Info 那种关键词自动触发 → 可能注入无关内容

**放弃了什么**：LLM 有时候不知道某个设定存在，就不会去查 → 可能写出和设定冲突的内容。

**不要做**：❌ 把 lore 全量注入每回合。 
**可以做**：给 lore 条目加场景触发规则（类似 timeline 的 min_day/location），在特定场景自动注入高相关条目。

**相关代码**：`engine/lore.ts:110-135` (lookupLore), `tools/lookup/lookup_lore.ts` (工具注册)

---

## 5. 软约束场景提示，不硬过滤工具

**是什么**：`buildStatePrompt` 末尾根据游戏状态（战斗/色情/校园/商业区）注入工具提示，但不是从工具列表里硬删除不相关的。

**为什么**：
- pi 框架不支持运行时动态隐藏工具，硬过滤需要改框架
- 软约束零风险 —— LLM 可以选择无视提示
- 研究支持（Looking Is Not Picking, arXiv 2026.6）：软提示可有效改善工具选择的读出准确率

**放弃了什么**：token 省得没有硬过滤多；LLM 偶尔会用错工具。

**不要做**：❌ 在没改 pi 框架的前提下强行硬过滤。❌ 把场景提示写成命令句（"你必须用这些"）。

**相关代码**：`engine/state.ts:1086-1116` (场景检测 + 工具提示注入)

---

## 6. Layer1 只在 sex 模式开

**是什么**：`extension.ts:40` —— 切到 sex 模式时自动开 Layer1。非 sex 模式时开关跟 `preset.json` 走（默认关 = 省 token）。

**为什么**：sex 模式就是要开 Layer1，不用玩家手动切换。非 sex 模式不需要，省 token。

**不要做**：❌ 删掉这行自动开启逻辑。 
**可以做**：`preset.json` 里的 `layer1.enabled` 改名叫 `layer1.always_on` 或加行注释说明"非 sex 模式下有效"。

**相关代码**：`extension.ts:40`, `preset.json:33-35`

---

## 7. 工具描述一行制：≤25中文字 + action 用 `|` 分隔

**是什么**：所有工具的 `description` 字段压到单行，action 候选值用 `|` 分隔不换行。

**为什么**：
- 工具 schema 消耗约 72% context window（Tool Attention Is All You Need, arXiv 2026.4）
- 精简工具描述 → 更高选择准确率，不是更省 token
- 一行便于 LLM 快速扫描区分工具

**不要做**：❌ 把描述删到只剩 2 个字。❌ 删掉"何时不该用"的限定句。❌ 又改回多行拼接。

**相关代码**：`extension.ts` (所有 `pi.registerTool` 调用), `docs/framework-optimization-log.md` 优化①

---

## 8. 所有世界专属数据只改 worldpacks/<世界>/，不改 data/

**是什么**：角色、物品、房间、商店、日程、sex_profiles 等世界专属数据，真正的"活数据"在 `worldpacks/<世界>/` 下面。`data/` 下的同名文件只是 TS 静态导入需要的兜底模板——**改了也不会在游戏里生效**。

**为什么**：
- 引擎的 `loadJSON()` 逻辑是：worldpack 有这个文件 → 用它；没有 → 回退读 `data/`
- 每次启动都跑 `loadJSON()`，永远覆盖掉 `data/` 的静态导入版本
- `data/` 保留这些文件是因为 TypeScript 的 `import ... with { type: "json" }` 必须在编译时找到文件，删了启动炸

**怎么知道自己改对了没有**：引擎启动时会自动比较 `data/` 和 `worldpacks/<世界>/` 的条目数。如果 data/ 比 worldpack 多，会打印明确的警告。

**不要做**：❌ 在 `data/` 下改角色卡、改物品、改商店——改了你白干。❌ 删掉 `data/` 下的世界专属文件——启动会炸。
**可以做**：跨世界通用的（achievements、housing、villain_templates、world_secrets、rendering）留在 `data/`，这些都是没有 worldpack 对应文件的。

**相关代码**：`engine/state.ts:4050-4070`（loadJSON 加载逻辑）, `state.ts:1118-1144`（脑裂检测警告）

---

## 模板

新决策用这个格式：

```
## N. 决策标题

**是什么**：一句话
**为什么**：1-3 句，说清取舍
**放弃了什么**：
**不要做**：❌ 
**可以做**：→ 
**相关代码**：file:line
```

---

> 最后更新：2026-06-25。新决策随时追加。
