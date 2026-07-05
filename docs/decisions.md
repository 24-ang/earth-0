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

## 12. tsconfig strict mode — 渐进收紧

**是什么**：`tsconfig.json` 设 `strict: true`，但 `noImplicitAny: false` + `noUncheckedIndexedAccess: false`（暂）。模块系统用 `Preserve`（配合 tsx 的 ESM 处理）。`noEmit: true`（tsx 负责运行，不用 tsc 编译）。

**为什么**：
- 项目之前零 tsconfig，完全依赖 tsx 宽松默认 — `args[0]` 这种 bug 如果有类型检查会在编译期被拦下
- 全开 strict 会炸（200+ 处 `as any` 转换、索引访问），不能一步到位
- `noImplicitAny`/`noUncheckedIndexedAccess` 先开 false，每轮清理一批类型后收紧一级
- `module: "Preserve"` + `moduleResolution: "bundler"` 兼容 tsx 的 ESM 处理，不改现有 import 模式

**放弃了什么**：当前不能享受 `noImplicitAny` 的保护。

**不要做**：❌ 一步全开 strict 然后修 200+ 类型错误（风险太高）。❌ 删掉 tsconfig.json。
**可以做**：→ 每清理完一批 `any` 就收紧一级。

**相关代码**：`tsconfig.json`（新建）

---

## 13. 静默 catch 必须打日志

**是什么**：`catch (_) {}` 一律替换为 `catch (e) { console.error("函数名: 描述", e); }`。预期可恢复的 catch（`fs.unlinkSync` 清理等）可以静默。

**为什么**：
- 审计发现 ~30 处静默 catch（上次声称 44→0 是错的）
- 数据加载失败 / JSON 解析失败 / 模块 import 失败被静默吞掉 → 故障不可观测
- `console.error` 不影响正常流程，但出问题时能看到日志

**放弃了什么**：无。仅加日志，不改变控制流。

**不要做**：❌ 对 `fs.unlinkSync` / 清理类操作加日志（噪音大于价值）。

**相关代码**：本轮批量修改 — engine/*.ts + tools/**/*.ts + test.ts

---

## 21. 群演/路人：引擎给数据，LLM 做叙事

**是什么**：房间群演（教室里的学生、商店的顾客）由引擎提供结构化数据（区域类型、时段、预估人数、活动标签），Phase 1 LLM 作为场景导演自行判断该创建什么群演（`spawn_temp_npc`），Phase 3 LLM 拿数据写叙事。

**为什么**：
- 2026-07-05 第一版在引擎里硬编码了集群描述文本（"教室后排5-6人在低头记笔记"）——引擎在替 LLM 写小说，违反了 PHILOSOPHY §1.2
- 回滚后改为纯数据输出：`"学生 (~28人) 在上课/课间活动 (school weekday_morning)"`——LLM 有创作自由但不是从零开始
- PHILOSOPHY §1.2 的框架已经有了（引擎给数据、LLM 做叙事），但之前没落地到 room 感知层

**放弃了什么**：引擎不做密度预测→就不做。Phase 1 有 `spawn_temp_npc` 工具 + "场景导演职责"规则（第0条）→ LLM 自己决定。

**不要做**：❌ 在引擎里拼接叙事文本（"三人躲在角落抽烟"）。❌ 用 `public_rooms` 名单限制哪些房间有路人。

**相关代码**：`engine/state.ts:3793-3830` (getNamelessNPCs 数据层), `engine/phase1-classifier.ts:254` (场景导演规则), `tools/action/spawn_temp_npc.ts`

---

## 22. CJS 双实例——写 ROOMS 永远用原地更新

**是什么**：`ROOMS` 是可变全局对象。CJS 的 `import { ROOMS } from "..."` 是值拷贝——如果后续代码做 `ROOMS = newObj`（替换引用），`state-grid.ts` 等模块会持旧引用。此后 `saveState()` 写的是旧引用，动态房间全丢。

2026-07-05 发现 `loadActiveWorld()`、`loadState()`、`resetState()`、`switchActiveWorld()` 共 5 处使用了 `ROOMS = structuredClone(x)` 替换引用。全部改为 `updateROOMSInPlace(x)` 原地更新。

**为什么**：和 07-04 修复的 `phone.ts` CJS 双实例是同一个根因。ESM live binding 无此问题——但 tsx 在处理跨文件 import 时实际走的是 CJS 路径。

**不要做**：❌ 任何地方做 `ROOMS = xxx`（替换引用）。✅ 只用 `updateROOMSInPlace()` 或逐个 key 的 `ROOMS[key] = value`。

**相关代码**：`engine/state.ts:64-67` (updateROOMSInPlace), `state.ts` 多处修复

---

> 最后更新：2026-07-05。新决策随时追加。

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

---

## 9. toolsCalled 追踪：registry wrapper 不改 55 个工具文件

**是什么**：`registry.ts` 用 `withToolTracking()` 包裹所有 action/state 工具（不含 lookup/TUI），在 execute 前自动调 `pushToolCall()`。工具文件本身不需要改动。

**为什么**：
- 如果改 55 个工具文件，每个加一行 `pushToolCall(this.name)`，维护负担大，未来新工具容易忘
- registry wrapper 集中管理——加新工具时只要放进 `trackedTools` 数组就自动追踪
- lookup 工具不追踪（纯查询不改状态），TUI 命令不追踪（用户操作不走工具流）

**放弃了什么**：wrapper 在每个工具调用时多一次 lazy import → 有微小性能开销（<1ms）。

**不要做**：❌ 在每个工具文件里手动加 `pushToolCall`。❌ 把 lookup 类工具放进 trackedTools。

**相关代码**：`tools/registry.ts:116-123` (withToolTracking), `engine/state.ts:161-175` (pushToolCall/drainToolCalls)

---

## 10. Lint retry：最多 3 次，只重试 block 规则

**是什么**：`render_scene` 和 `/reroll` 在 lint 发现 `needsRetry=true` 时，把违规片段 + 规则名拼成纠正 prompt，让模型重写全文。最多 3 次，3 次后标记 `retryExhausted` 并返回最后结果。

**为什么**：
- warn 级别的规则（感知报告、模糊镜头、禁止词汇）只记录不打断——这些是风格偏好，不值得重试
- block 级别的规则（伪菜单、报告句、面板值泄露、秘密泄露）必须拦截——这是硬伤，prompt 骂模型没用，只有 machine lint + retry 才能根治
- 3 次是经验上限（fate-sandbox 用 6 次，earth-0 保守用 3 次——多次 retry 可能陷入 LLM 自激振荡）

**放弃了什么**：retry 是全文重写（不是局部修复），token 消耗翻倍。但 block 命中本身很少见（<5% 回合），所以实际代价不大。

**不要做**：❌ 对 warn 规则触发 retry（浪费 token）。❌ 无限 retry（会死循环）。

**相关代码**：`tools/action/render_scene.ts:107-151`, `tools/tui/reroll.ts:70-91`, `engine/audit/lint-rules.ts`

---

## 11. /choice 作为 TUI 命令而非内联按钮

**是什么**：`/choice` 是一个 TUI 命令，解析最近一次 render_scene 输出的扮演选项，渲染为可点击菜单。点击选项后通过 `ctx.chat.addSystemMessage()` 发送到聊天框。

**为什么**：
- pi 框架的 content item 不支持 button 类型——无法在正文中嵌入可点击按钮
- TUI 命令是 pi 框架的标准 UI 扩展方式，与其他面板（/status、/bag）一致
- 保留完全自由输入——用户可以不调 /choice，自己打字

**放弃了什么**：不是 fate 式的 "正文输出后自动弹按钮"。需要用户主动输入 `/choice`。

**可以做**：如果 pi 框架未来支持 content button，改为自动弹出。

**相关代码**：`tools/tui/choice.ts`, `engine/parse-options.ts`, `tools/action/render_scene.ts:151,167`

---

## 14. 叙事视角与双轨幕间系统

**是什么**：
1. **节奏自适应**：引擎依据在场 NPC 数量，自动在 `turn_based`（回合对话，200-400字）与 `novel`（小说式记叙，400-800字）间防抖切换。
2. **只读双轨幕间**：合并切镜（Cutaway）与幕间为单一“单次长文本生成管道”。支持关系突破/共位脱离自动触发的短幕间（200-500字）与 timeline 触发的长剧情幕间（800-2000字）。

**为什么**：
- **节奏确定性**：人称和段落结构必须由引擎确定，不能交给 LLM 自由裁量，以保障叙事体验和人称（POV）一致性。
- **免除状态污染**：幕间（Intermission）是“只读的故事展示帧”，如果用 Step-by-Step 模拟 NPC 对话，会引发严重的地理、时间轴、背包状态污染与大量的 API 重复调用。单次长文本写作实现“零状态修改、时间轴静止”，最为干净安全。
- **自然信息差应对超游**：不对玩家的超游（Metagaming）输入做引擎层面的正则拦截，而是利用 NPC 心智中缺乏该秘密记忆（信息差隔离）这一本能，让 NPC 自然产生困惑和抗拒反应。

**放弃了什么**：
- 放弃了在幕间中的交互权与物品操作，幕间对玩家是纯粹的“只读播放”。

**不要做**：
- ❌ 在幕间生成时调用 `advanceMinutes()` 推进时间，或在幕间内修改 `gameState` 守恒量。
- ❌ 将切镜与幕间拆成两个独立的数据生成管道。

**相关代码**：`engine/detect-mode.ts`（模式检测）, `engine/viewpoint.ts`（切镜队列管理）, `tools/action/settle_scene.ts:25-48`（结算轮触发）

---

## 15. 多 NPC 社交心智隔离与广播机制

**是什么**：
1. **心智硬隔离**：每个 NPC 在并行角色轮只读取自己私有的长期记忆（Heuristic Memory Tags）和短期对话/事件缓冲（Short-term Buffer），彻底防止超游与脑回路共用。
2. **本地启发式打分**：在引擎层用纯 TypeScript 计算权重：
   $$\text{Score} = \text{priority} \times 10 + \text{在场人物命中} \times 8 + \text{地点命中} \times 5 + \text{新近度衰减} - \text{过期排除}$$
   替代消耗 Token 和高时延的 LLM 记忆过滤，返回前 3 条最相关的长期记忆。
3. **即时社交广播**：当任意 NPC 说话时，该发言会通过广播函数自动同步追加到**自身及所有周边在场 NPC** 的 `shortTermBuffer.recentExchanges` 对话槽中，确保多智能体间共享即时物理听觉。

**为什么**：
- **物理听觉保真**：避免多角色交谈时，未轮到的角色“失聪”或遗忘上一秒的台词，进而产生答非所问或对话断代。
- **性能与开销纪律**：在 buildStatePrompt 和角色轮状态拼装时，禁止任何检索式的 LLM 预处理，保证毫秒级拼装。

**放弃了什么**：
- 放弃了在每次回合开始前调用 LLM 对 NPC 记忆进行向量检索或自动生成摘要的做法。

**不要做**：
- ❌ 在打分或广播逻辑中硬编码角色名/地名，应保持引擎的通用化和动态运行时驱动。
- ❌ 在短期 buffer 中无限制追加记录，严格执行 10 对话 / 5 事件的滑动窗口先进先出（FIFO）截断。

**相关代码**：`engine/types.ts` (`MemoryTag`, `shortTermBuffer`), `engine/state.ts` (`addMemoryTag`, `recallRelevantMemories`, `appendShortTermBuffer`), `tools/helpers.ts` (`recordNpcAgentAction`)

---

## 16. 三段式实体化 + 结构性隔离：从 prompt 合约到硬分段

**是什么**：将三段式工作流从 gm-contract.md 的 prompt 合约改为四个引擎强制执行的独立阶段，Phase 3 从 pi agent loop 彻底拆出走裸 stream：

1. **Phase 1 — 分类 LLM + 引擎执行**：LLM 输出 JSON → 引擎解析 → 引擎调工具。JSON parse 失败 → 关键词回落 → 引擎兜底。Phase 1 也负责预取描写信息（`lookup_region`/`lookup_character`/`dice_roll`）给 Phase 3。
2. **Phase 2 — NPC Agent**：引擎自动检测同场 NPC → spawn 独立 LLM（带性格/记忆/关系上下文）。输出独立的 `[NPC名] 回应文本`，Phase 3 原文引用不改写。
3. **交互检测**：Phase 2 后引擎分析每个 NPC 回应 → LLM mini-judge 判断哪些 NPC 在 cue 玩家。沉默 NPC 不强制切 turn_based。
4. **GAL 场景边界锁**：一对一 + 女性 + 亲密/sex 经历 → 自动激活 GAL 第一人称。场景中锁定，人称切换只在场景边界（离开地点/时间跳跃）。
5. **Phase 3 — 裸 stream 渲染（零工具）**：`generateCompletion` 直接调 API，物理上没有 tool definitions。pi agent loop 只负责 echo 预生成叙事。附带 lint + retry（最多 3 次）。
6. **Phase 4 — 创意层**（可选，best-effort）：触发条件满足时调一次 LLM 做剧情判断。

**为什么**：
- DS Chat 的"写作本能"永远压倒"操作纪律"。prompt 改三版、加检查清单、加处罚条款——全没用（PHILOSOPHY §1.3）
- Phase 1 分类 LLM 输出 JSON → 引擎执行。LLM 物理上不能写叙事（输出被 parse，失败就扔）
- Phase 3 裸 stream 物理上没有工具列表——结构性硬隔离，不再靠 prompt 软约束
- 交互检测替代共位近似：三个 NPC 在场但都在发呆 → novel 继续，不打断
- GAL 场景边界锁对标真实小说/视觉小说的场景管理，人称切换不出现在对话回合边界

**放弃了什么**：
- 放弃了同一 LLM 在一次调用中完成三段式的架构
- 放弃了 gm-contract.md 作为行为约束（引擎代码替代）
- 放弃了 pi agent loop 做 Phase 3 渲染（改为裸 stream）
- Phase 1 多了一次 LLM 调用（但 prompt 很小 ~3KB，失败有兜底）

**不要做**：
- ❌ 在 Phase 3 渲染 prompt 里加回工具提示或 gm-rules/gm-contract
- ❌ 让 GAL 模式在对话回合边界切换人称
- ❌ Phase 1 分类改为纯关键词匹配
- ❌ 删掉 render_scene 工具（/reroll 命令依赖它）

**相关代码**：
- `engine/phase1-classifier.ts` — Phase 1 分类 LLM + JSON 解析 + 工具执行 + 回退兜底
- `engine/detect-mode.ts` — 交互检测（LLM mini-judge + 关键词兜底）+ interactionMode 判定
- `engine/phase3-render.ts` — Phase 3 渲染 prompt 组装 + 渲染合约 + 状态上下文注入
- `engine/phase4-creative.ts` — Phase 4 创意层触发条件 + LLM 调用
- `extension.ts` — 四阶段编排 + 交互检测 + GAL 场景边界 + Phase 3 裸 stream
- `agents/gm-phase1-classifier.md` — Phase 1 分类器系统提示词
- `agents/gm-mode-*.md` — 各模式叙事规则（RPG/GAL/Sex），已清除残留工具指令

---

> 最后更新：2026-07-01。新决策随时追加。

---

## 17. 存档原子写 + 子目录备份（M1+M2）

**是什么**：
1. `saveState()` 改用 `atomicWrite()` — 先写 `.tmp`，再 `fs.renameSync()`（原子操作）。写一半崩溃不损坏主文件。
2. `backupBeforeTurn()` 改为子目录结构 — 每个 turn 的 5 个文件（session + rooms_delta + dynamic_characters + locations_delta + furniture_containers）全进 `turn_backups/turn_N/` 子目录。`restoreLastTurn()` 从子目录恢复全部 5 个文件。

**为什么**：
- M1: `fs.writeFileSync` 非原子，写一半崩溃=存档损坏。temp+rename 是 POSIX 的标准做法
- M2: 旧备份只写 `turn_N.json` 进 `TURN_BACKUP_DIR/`，4 个 delta 文件读的是 `STATE_DIR/` 当前版本→回退只能回主档、delta 回不去
- 子目录方案：一个子目录 = 一份完整快照，数据和代码分离清晰

**放弃了什么**：原子写的 try-catch 兜底路径（rename 跨卷失败→copyFile+unlink）。

**不要做**：❌ 回退到旧平面文件名备份。

**相关代码**：`engine/state.ts:307-328` (saveState + atomicWrite), `engine/state.ts:540-576` (backupBeforeTurn + restoreLastTurn)

---

## 18. 引擎零硬编码（O6）+ wrapTool 自动保护（O8）

**是什么**：
1. O6: `isSameLocation()` 不再硬编码 `"总武"` — 改为从 `worldpacks/{w}/orgs/` 读 `match_rules.location_contains`。`npcBelongsToOrg()` 使用 org 的 `match_rules.schedule_groups` 通用匹配。`timeline.ts` 默认主角名改为 `gameState.player.name`。
2. O8: `withToolTracking()` 包装器增强 — 自动 `try-catch`（报错不崩）+ 自动 `saveState()`（工具成功执行后确保状态落盘）。

**为什么**：
- 引擎零题材硬编码是核心铁律。旧代码里的 `"总武"` `"总武高学生"` `"侍奉部"` `"比企谷八幡"` 违反该原则
- 40+ action 工具的 execute 无 try-catch，新增工具易忘 saveState。wrapper 集中保护根治 N7

**放弃了什么**：O2（state.ts↔timeline.ts 循环依赖打破）— 当前 ESM 模式合法无环，118 处引用全改风险>收益。

**不要做**：❌ 在 engine/ 里填回新的硬编码。❌ 绕过 withToolTracking 注册工具。

**相关代码**：`engine/state.ts:100-122` (_orgCache + isSameLocation), `engine/state.ts:3085-3107` (npcBelongsToOrg), `tools/registry.ts:121-133` (withToolTracking with try-catch+saveState)

---

## 19. 设定文件扁平→目录结构（§十四）

**是什么**：5 类世界数据从 `data/` 搬到 `worldpacks/oregairu/`，其中 `region_contexts.json` 和 `world_secrets.json` 从平面文件拆为独立目录：
- `locations/` — soubu_high / shiranui_dojo / japan（3 文件）
- `secrets/` — japan_entertainment_underworld（1 文件）
- `orgs/` — soubu_high（1 文件）
- `timelines/` — 48 文件
- `calendar.json` — 单文件

引擎新增 `loadWorldpackDirRecursive(dirName, flatFileName)` — 优先扫目录→回退平面文件→兜底 data/。`getRegionContext()` 和 `createInitialState()` 统一走此接口。

**为什么**：新增区域设定或秘密只需往对应目录扔一个 JSON 文件，不必编辑巨型平面文件。

**不要做**：❌ 删掉 `data/` 下的世界专属文件（TS 静态导入需要兜底模板）。

**相关代码**：`engine/state.ts:116-139` (loadWorldpackDirRecursive), `engine/state.ts:3098` (getRegionContext), `engine/state.ts:150` (createInitialState)

---

## 20. 能力系统 v2 — 技能树 + 规则系 + 社交

**是什么**：`AbilityDef` 扩展 7 个可选字段（type/derives_from/rules/limitations/social_effect/meta_type）。能力从 6 个扁平条目扩展到 18 个带技能树结构：
- 6 styles → 7 techniques (derives_from 链)
- 1 stand（规则系：黄金体验 rules + limitations）
- 1 social（社交技能：心理战·読み合い social_effect）
- 旧 6 条目完全向后兼容

`buildSkillTree()` → `getTechniquesForStyle()` / `getStyleForTechnique()`。`useAbility()` 注入 rules/limitations/social_effect 到叙事输出。

**为什么**：原扁平数组不支持流派→招式的父子关系，也不支持规则系能力（替身、结界）和社交技能（心理战）。

**不要做**：❌ 把现有 6 个能力的 name 改掉（测试依赖）。

**相关代码**：`engine/abilities.ts:18-36` (AbilityDef), `engine/abilities.ts:79-103` (skill tree), `data/abilities/abilities.json`
