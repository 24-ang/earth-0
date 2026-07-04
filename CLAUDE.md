# earth-0 项目规则（每次会话自动加载）

## 当前架构速览（2026-07-05）

**四阶段流水线**（`extension.ts`，确认全部在运行）：
1. **Phase 1** — 分类 LLM（`phase1-classifier.ts`）→ JSON → 引擎执行工具。终端有 `Phase1: tool "xxx" not in whitelist` 日志
2. **Phase 2** — `autoSpawnNPCs()` 自动 spawn 同场 NPC（在 `updateNPCSchedules` 之前跑）
3. **交互检测** — `detectInteractionMode()`（settlement.ts:108）+ `analyzeNpcResponses()`（extension.ts:221）
4. **Phase 3** — `buildRenderSystemPrompt()` → `generateCompletion` 裸 stream（deepseek-v4-pro），物理零工具
5. **Phase 4** — `agent_end` 钩子，best-effort，ctx stale 时静默跳过

**幕间/切镜**（`viewpoint.ts`）：`processViewpointTriggers()` 在 settlement.ts:113 每回合跑。余波触发需 `previousNPCs >= 2 && currentNPCs === 0`。消费需 `interactionMode === "novel"`（默认已改为 novel）。
**模式默认**：`interactionMode: "novel"`, `turnsSinceLastNPCInteraction: 2`。有 NPC cue 时切 turn_based。

**测试**：`npx tsx test.ts`（274）+ `npx tsx e2e-test.ts`（45）+ `npx tsx e2e-init-test.ts`（开局管线冒烟，护栏），改完必跑，必须全绿。

**参考文档**：`docs/decisions.md` #16（三段式演变）、`docs/新建文件夹/earth-0-E-state拆分.md`（拆分进度）。
`0-groovy-shannon.md` 仅作历史参考——很多条目已过时。做了的事翻 git log 确认文件存在。

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
  types.ts           — GameState 类型定义
  state.ts           — 状态引擎（init/load/save/buildStatePrompt；O6 _orgCache 去硬编码）
  settlement.ts      — 回合结算（M1+M2 原子写+备份补全）
  detect-mode.ts     — 交互检测（LLM mini-judge cue 检测 + 关键词兜底）
  phase1-classifier.ts — Phase 1 分类 LLM + 工具执行 + 回退兜底
  phase3-render.ts   — Phase 3 渲染 prompt 组装
  phase4-creative.ts — Phase 4 创意层（可选）
  viewpoint.ts       — 切镜队列 + 幕间触发
  timeline.ts        — 双轨制剧情时间线（轻量强化：must_cover/recommended_lore/iconic_lines）
  state-location.ts / state-grid.ts — 拆分自 state.ts（1a+1b）
  abilities.ts       — 能力系统 v2（技能树 + 规则系 + 社交技能）
  sex.ts, combat.ts, dice.ts, phone.ts, weather.ts, lore.ts, housing.ts, ...
tools/           — LLM 工具 + TUI 命令
  action/     — 世界修改工具（O8 withToolTracking 自动 try-catch + saveState）
    create_room.ts       — 玩家建造房间（收费施工，支持 template/exitFrom/atmosphere）
    instantiate_residence.ts — GM免费用住宅实例化（读 residence_templates 蓝图）
  lookup/     — 只读查询工具
  state/      — 状态管理工具
  tui/        — 终端 UI 面板
  registry.ts — 工具注册中心 + withToolTracking wrapper（O8）
agents/          — LLM 系统提示词
  gm-phase1-classifier.md — Phase 1 分类器规则
  gm-pre/mode-rpg/gal/sex/voice-novel/turnbased.md — 叙事规则（Phase 3 不加载 gm-contract/rules/start）
worldpacks/      — 可切换的世界数据包（oregairu/）
  timelines/(48) locations/(3) orgs/(1) secrets/(1) — 子目录结构（§十四重组）
  residence_templates.json — 住宅模板（独栋_2F_4人家庭 / 公寓_3F_单身）
  room_templates.json      — 单体房间模板（5大类31种）
data/            — 跨世界通用数据（abilities v2: 18 能力含技能树/规则系/社交）
  residence_templates.json — 兜底空文件
docs/            — PHILOSOPHY.md / decisions.md / AUDIT / COMPARISON
extension.ts     — pi 框架扩展入口（四阶段编排，pi 退化为传输层）
e2e-test.ts (45) + test.ts (266) — 测试套件
```
