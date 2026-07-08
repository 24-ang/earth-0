# earth-0 项目规则（每次会话自动加载）：尽量从玩家视角去思考，和解释

## 最高原则（2026-07-09，血泪教训）

> 这个项目最大的问题不是缺功能，是**根本不能玩**。根因：长期靠"叠加字段 / 硬编码 / 机械化 / 打补丁"偷懒解决问题，债越滚越多——连"一个角色由哪些字段构成"都没人说得清（characters/character_stages/sex_profiles 三文件漂移、`StaticCharacter` 类型是只有 4 个必填的空壳、sex_profile 双源+指针、`_if` 硬编码角色名、outfits 与 equipment_by_outfit 同一角色已自相矛盾）。

1. **先看清全貌，再动手**。碰任何系统前，先把它的完整形状查清楚：有哪些字段、谁在读、缺了引擎怎么兜底。搞不清就先查、先画地图——**不许靠猜，不许边猜边改**。
2. **修框架，不打补丁**。优先用"整理数据结构 / 补全 schema / 加校验器 / 去硬编码"根治，而不是再叠一层 workaround。动手前先自问：这是不是又一次偷懒？regex 后处理、prompt 补丁、硬编码名单——几乎永远是错的答案。
3. **长远眼光**。修 bug 和加功能都要想"三个月后这个决定会不会变成新的债"。反直觉的取舍当场记进 `docs/decisions.md`。
4. **北极星是"能玩"**。任何改动——包括重构和清理——都要朝"游戏更能玩"推进。为清理而清理、为架构而架构，同样是陷阱。

## 当前架构速览（2026-07-06）

**四阶段流水线**（`extension.ts`）：
1. **Phase 1** — 意图分类 + **场景导演**（`phase1-classifier.ts`）→ JSON → 引擎执行工具。走进空间时自行判断该有什么群演，用 `spawn_temp_npc` 填充。有 `lookup_furniture` 查可用家具/模板。
2. **Phase 2** — `autoSpawnNPCs()` **并行化**（`Promise.all`）自动 spawn 同场 NPC，统一用 `buildPresentLine` 注入在场描述（含玩家/NPC身体暴露/伤口/路人），在 `updateNPCSchedules` 之前跑
3. **Phase 3** — `buildRenderSystemPrompt()` → `generateCompletion` 裸 stream，物理零工具。`_toolsLocked` 锁防 Fallback 双重执行。
4. **Phase 4** — `agent_end` 钩子，best-effort

**提示词架构**（三层，2026-07-05 晚确认）：
- Phase 系统提示词 = 身份 + 流程 + 什么时候想到用什么（**不抄 param 细节**——那是工具 `parameters` 的事）
- 工具 description = 怎么用、参数什么含义、取值从哪查
- 数据文件 = 真相的唯一来源。工具 description 不手写会过时的枚举值，写"用 lookup_xxx 查询"

**关键新增/修复**（2026-07-05）：
- `furniture.json` 20→44 件，`room_templates.json` 53 模板全补 furniture+atmosphere
- `lookup_furniture` 工具：LLM 查家具和模板目录
- `createRoom()` 自动套模板的 atmosphere + furniture
- 身体暴露：基于装备覆盖（脱了就注入 sex_profile）
- NPC 碰撞：门关了/玩家堵门/家具堵出口 → NPC 被拦住
- 路人 zones+times 过滤：学校不出现流浪汉/主妇/外卖员
- `checkAddVolume()` 裸体不再=无限空间（min = STR×2）
- ROOMS CJS 双实例修复（`updateROOMSInPlace`）
- NPC 环境感知：天气/季节/房间家具/路人 全注入 NPC Agent prompt
- Phase 1 场景导演规则（第0条）：走进空间→判断该有什么人→spawn_temp_npc

**测试**：`npx tsx test.ts`（281）+ `npx tsx e2e-test.ts`（45）+ `npx tsx e2e-init-test.ts`（57）= **383 passed**，改完必跑，必须全绿。

## 必须先读

做任何改动前，先读 **`docs/PHILOSOPHY.md`**——这份文档回答了"为什么 earth-0 是现在这个样子"。具体决策的细节在 `docs/decisions.md`。加新模块参考 `docs/module-template.md`。

## 四条铁律

1. **世界数据只改 `worldpacks/oregairu/`**。`data/` 下同名文件是 TS 静态导入需要的兜底模板——改了也不会在游戏里生效。引擎启动时会自动检测并警告。
2. **改完代码跑 `npx tsx test.ts`，必须 230+ passed, 0 failed**。
3. **改守恒量的工具，execute 最后一行必须 `saveState()`**。不改守恒量的工具（纯查询/lookup/TUI面板）不需要。
4. **改初始化/状态相关代码（`engine/state*.ts`、`engine/settlement.ts`、`tools/state/*`），必须跑 `npx tsx e2e-init-test.ts` 且校验器全绿（`validatePlayerState().ok === true`、`warnings.length === 0`）。静默回滚（catch 后恢复快照却只在返回文本里小声说"失败"）一律改为 `console.error` 大声报错——bug 要看得见，不许藏。**

## 核心原则

1. **引擎零题材硬编码**：engine/ 下没有任何角色名、地名、作品名。题材数据在 worldpacks/。
2. **引擎守恒，叙事自由**：引擎只拦截不可逆的守恒量（钱/物/HP/时间/位置/信息可见性），其余全权交 LLM。
2.5. **住宅实例化 ≠ 玩家建造**：GM 初始化住宅用 `instantiate_residence`（免费、从模板展开、自动连接房间），玩家扩建用 `create_room`（收费施工、扣钱耗时）。不要混淆。
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
- ❌ **贴提示词补丁**。如果 NPC 输出有问题，先查数据（记忆/关系/存档污染），再查引擎注入的字段有没有缺失，最后才考虑改 prompt。regex 后处理几乎永远不是正确答案。
- ❌ **一个月改 15 个文件为一个 bug**。如果 diff 超过 5 个文件——退一步，找根因。

## 代码质量

- **tsconfig.json**：`strict: true`，`noImplicitAny`/`noUncheckedIndexedAccess` 暂为 false（渐进收紧）。提交前确保 `npx tsx test.ts` 全绿。
- **catch 规范**：数据加载/解析失败必须 `console.error`；`fs.unlinkSync` 等非关键清理可以静默。
- **死代码**：`git rm` 不要的 `.bak`/实验脚本；删掉未调用的函数；`scratch/` 和 `tmp/` 在 `.gitignore` 中。

## 项目结构速查

```
engine/          — 通用算法
  types.ts           — GameState/WorldState 类型定义
  state.ts           — 状态引擎（init/load/save/buildStatePrompt；_orgCache去硬编码；updateROOMSInPlace）
  settlement.ts      — 回合结算（M1+M2 原子写+备份补全；detectInteractionMode）
  phase1-classifier.ts — Phase 1 分类+场景导演（spawn_temp_npc群演）
  phase3-render.ts   — Phase 3 渲染 prompt 组装（含 [全球大势] 预留）
  detect-mode.ts     — 交互检测（LLM mini-judge + 关键词兜底）
  viewpoint.ts       — 切镜队列 + 幕间触发（声望切镜/余波/涟漪）
  timeline.ts        — 双轨制剧情时间线（must_cover/recommended_lore/iconic_lines）
  state-location.ts / state-grid.ts — 拆分自 state.ts（1a+1b）
  abilities.ts       — 能力系统 v2（技能树buildSkillTree + 规则系 + 社交技能）
tools/           — LLM 工具 + TUI 命令
  action/     — 世界修改工具（withToolTracking 自动 try-catch+saveState+_toolsLocked拦截）
    create_room.ts / instantiate_residence.ts / replay_pov.ts / world_interact.ts ...
  lookup/     — 只读查询 + 状态修改混合（lookup_furniture / lookup_character / self_check ...）
  state/      — 状态管理工具（spawn_npc_agent(s) / init_profile / party_management ...）
  tui/        — 终端 UI 面板（new / npc / bag / status / relations ... 34个）
  registry.ts — 工具注册中心 + withToolTracking wrapper（try-catch + saveState + _toolsLocked）
  helpers.ts  — generateCompletion / buildPresentLine / NPC_MOTIVATION_PROMPT
agents/          — LLM 系统提示词
  gm-phase1-classifier.md — Phase 1 分类+场景导演规则
  gm-intermission-contract.md — 幕间/切镜合约
  gm-pre/mode-rpg/gal/sex/voice-novel/turnbased.md — 叙事规则（Phase 3 不加载 gm-contract/rules/start）
worldpacks/      — 可切换的世界数据包（oregairu/）
  timelines/(48) locations/(3) orgs/(1) secrets/(1) — 子目录结构（§十四重组）
  init_profiles.json / residence_templates.json / room_templates.json (53模板)
  furniture.json (44件) / items.json / characters.json ...
data/            — 跨世界通用数据 + TS静态导入兜底
docs/            — PHILOSOPHY.md / decisions.md / module-template.md / AUDIT / COMPARISON
extension.ts     — pi 框架扩展入口（四阶段编排，pi退化为传输层）
e2e-test.ts (45) + e2e-init-test.ts (57) + test.ts (281) — 测试套件（383 passed）
```
