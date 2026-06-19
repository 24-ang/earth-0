# 参考项目清单 — earth-0 叙事引擎 vNext

> 2026-06-19
> 汇总全部候选参考项目，标注验证状态、可抄内容、接入方式、优先级。

---

## 验证等级说明

| 等级 | 含义 |
|---|---|
| ✅ 源码验证 | 读到实际代码/测试/协议文档，确认非空壳 |
| ⚠️ 结构确认 | README+文件树可靠，源码未逐行读 |
| ⏳ 待验证 | 关键文件不可达或需本地 clone |
| 📄 纯文档 | 0 可执行代码，方法论有价值 |
| ❌ 太早期/闭源 | 参考概念可以，别抄实现 |

---

## S 级 —— 同框架或架构直接可接

### 1. NeuroBook (notnotype) 🔥🔥🔥

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/notnotype/neuro-book |
| 语言 | TypeScript + Vue，**Pi 框架** |
| 协议 | PolyForm Noncommercial（学习架构，不抄代码）|
| 验证 | ✅ README+架构全文 |
| 核心 | NeuroAgentHarness（多Agent编排）、Profile系统、Sidecar Context、TSX上下文模板、Agent角色拓扑 |

**能抄什么**：
- Sidecar Context：fork 分支做检索/反思，不污染主会话 → earth-0 的渲染轮 subagent
- Profile 系统：每个 Agent 声明式行为边界+工具白名单 → earth-0 的 NPC Agent
- Agent 角色拓扑：leader/writer/retrieval/researcher/actor → earth-0 的 多Flash+Pro 架构参考
- SillyTavern 迁移流水线：inspect→unpack→import → earth-0 的 novel-to-data 技能

**怎么接**：同为 Pi 框架。Profile 和 Sidecar 的设计模式可以直接搬进 earth-0 的 skills/ 和 extension.ts。

**优先级**：P0 — 架构设计阶段必读

---

### 2. pi-stage (SDRTIO-bit) 🔥🔥

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/SDRTIO-bit/pi-stage |
| 语言 | TypeScript，**pi.dev 扩展** |
| 协议 | 待确认 |
| 验证 | ⚠️ README+文件树 |
| 核心 | 5层上下文流水线、Worldbook→Skill编译、TF-IDF触发、卡片隔离、advance_time |

**能抄什么**：
- 5 层上下文流水线：Collect→Prioritize→Schedule→Render→Trace → earth-0 的 preset.json 组装优化
- Worldbook→Skill 编译：静态 lore 转 pi Skill 文件 → earth-0 的 lore 注入方式升级
- TF-IDF 触发匹配 → earth-0 的世界条目关键词触发
- 卡片隔离 → earth-0 多角色会话独立

**怎么接**：同框架、同语言。直接看它的 collector registry 怎么写的，迁移到 earth-0 的 buildStatePrompt。

**优先级**：P0 — 流水线设计必读

---

### 3. AIRP-State-Protocol (GhostXia) 🔥

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/GhostXia/AIRP-State-Protocol |
| 语言 | TypeScript + Rust + Vue |
| 协议 | MIT OR Apache-2.0 |
| 验证 | ✅ 读到了 spec/protocol.md + store.ts 源码 |
| 核心 | Envelope 消息协议、Blueprint/State 分离、RFC 6902 Patch、Widget 注册表、AgentBus |

**能抄什么**：
- Blueprint（稳定布局）vs State（动态数据）分离 → earth-0 的 director packet（蓝图）+ turn log（状态）
- RFC 6902 JSON Patch 增量更新 → earth-0 的 turnLog 增量追加
- Widget 注册表（namespace.id 命名空间）→ earth-0 的 skills/ 注册机制
- 能力声明 + Gateway 强制执行 → earth-0 的 Layer 3 防火墙升级

**怎么接**：设计模式直接搬。Blueprint/State 分离就是 Director Packet / Turn Ledger 的理论版。

**优先级**：P0 — 状态协议设计必读

---

## A 级 —— 关键子系统可抄

### 4. deepRolePlay (howyoungchen)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/howyoungchen/deepRolePlay |
| 语言 | Python 3.12 |
| 协议 | MIT |
| 验证 | ⚠️ README+结构，源码未逐行读 |
| Stars | 120⭐，19 releases |
| 核心 | Proxy 中间件、记忆闪回 Agent、情景更新 Agent、双模型、场景压缩 80%、txt 知识挂载 |

**能抄什么**：
- 记忆闪回：自动检索历史对话+外部知识 → earth-0 的 GM 上下文自动检索
- 情景更新：结构化 JSON 表 CRUD 世界状态 → earth-0 data/ 自动更新
- 场景压缩 ~80% → earth-0 长会话 compaction
- 双模型（便宜干活/贵写文）→ earth-0 Layer 4 的结算/渲染模型分配
- 外部 .txt 知识文档挂载 → earth-0 的小说→世界观自动导入

**怎么接**：不是同一个语言栈。抄架构设计，TypeScript 重写。

**优先级**：P1 — 场景压缩和知识挂载最直接可用

---

### 5. rpg-roleplay-platform (felixchaos) ✅

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/felixchaos/rpg-roleplay-platform |
| 语言 | Python FastAPI + React 18 |
| 协议 | AGPL-3.0 |
| 验证 | ✅ 374 commits，~1k pytest，读到架构全文 |
| 核心 | 吃进 485 万字小说→产出可玩 RPG，Phase 0-4 流水线，GM Agent，SillyTavern V2/V3 导入 |

**能抄什么**：
- Phase 0-4 流水线设计（上下文→代理→提取→验证→响应）
- SillyTavern 角色卡→结构化数据导入
- Postgres + pgvector 知识索引
- 分支存档（Git 风格 commit/ref/checkout）

**怎么接**：不支持 TypeScript/pi。抄流水线设计，earth-0 已有更好的数据层。

**优先级**：P1 — 流水线和导入设计参考

---

### 6. Fabula (brandburner) ✅

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/brandburner/fabula |
| 语言 | Python + Cypher (Neo4j) |
| 协议 | 待确认 |
| 验证 | ✅ 读到多个 .py 源文件和测试文件 |
| 核心 | 两次 LLM Pass 实体提取、BAML 结构化 schema、Neo4j 知识图谱、GraphRAG 查询 |

**能抄什么**：
- BAML 结构化 LLM 输出 → earth-0 的 novel-to-data 提取 schema
- 两次 Pass（粗提取→精提取+去重）→ earth-0 的自动化流水线
- 实体模糊匹配+LLM去重 → earth-0 角色数据合并

**怎么接**：BAML 概念可以直接用在 earth-0 的 SKILL.md 里定义提取 schema。

**优先级**：P1 — BAML 提取模式值得学

---

## B 级 —— 概念参考，不直接抄代码

### 7. Story-to-Game (Shanyin-ai)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/Shanyin-ai/Story-to-game |
| Stars | 291⭐ |
| 验证 | ⏳ SKILL.md 404，但 PLAN-v1 已引用 |
| 参考 | 9 步小说→游戏转换流水线、13 项自动验证、分支剧情生成 |

**优先级**：P2 — 等读到 SKILL.md 后再定

---

### 8. works-dna-extractor (Shiaoming123)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/Shiaoming123/works-dna-extractor |
| 验证 | ⏳ 纯文档，0 可执行代码 |
| 参考 | 16 层作品 DNA 分析框架：叙事引擎/POV/场景架构/语言纹理/对话系统/情感算法等 |

**优先级**：P2 — 分析方法论可以，但没有代码可抄

---

### 9. AI-Reader-V2 (mouseart2025)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/mouseart2025/AI-Reader-V2 |
| 验证 | ⚠️ 根目录结构确认，子目录源码未读 |
| 参考 | 角色关系图谱、多泳道时间线、百科全书、Ollama+10 云端 LLM |

**优先级**：P2 — 可视化方案参考，earth-0 用 TUI 不需要前端

---

### 10. PlotPilot (shenminglinyi)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/shenminglinyi/PlotPilot |
| Stars | 970⭐ |
| 验证 | ⚠️ README |
| 参考 | Plot Tracker、知识图谱、Autopilot 自动章节生成 |

**优先级**：P2

---

### 11. NovelWriter (EdwardAThomson)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/EdwardAThomson/NovelWriter |
| Stars | 57⭐ |
| 验证 | ⚠️ README |
| 参考 | Lore 生成器 8 类型、一致性 Agent、多 Agent 编排 |

**优先级**：P2

---

### 12. Storyteller (johannhartmann)

| 项 | 内容 |
|---|---|
| 链接 | https://github.com/johannhartmann/storyteller |
| 验证 | ⚠️ README |
| 参考 | Plot Thread Tracker——伏笔埋设→推进→收束 |

**优先级**：P2

---

## 学术论文

| 论文 | 会议 | 要点 | 和 earth-0 关系 |
|---|---|---|---|
| **Orchestrated Reality** | arXiv 2026.6 | PDVA 流水线、POMDP 形式化、JSON 实体树 | Layer 2+3 的理论版，WorldLines 的实现基础 |
| **Role-Play→Rewrite** | ACL 2025 | 角色 Agent 先演→文笔 Agent 改写 | Layer 5 多角色 Agent 的理论版 |
| **BOOKWORLD** | ACL 2025 | 小说→多 Agent 社会、75% 胜率 | novel-to-data 的学术验证 |
| **StoryBox** | AAAI 2026 | 自底向上多 Agent 涌现、万词以上连贯 | 多 Agent 交互涌现 |
| **CASCADE** | ACM 2026.4 | 三层级联、O(1) 成本、标签路由 | 多 NPC 成本控制 |
| **Co-DIRECT** | ESWA 2025 | Director-in-the-Loop、Writer/Actor/Critic 三 Agent | Agent 角色分工 |

---

## 太早期/闭源/纯文档

| 项目 | 原因 |
|---|---|
| **WorldLines** (LudicDynamics) | 13 commits，引擎闭源（neonrp），但示例和论文有价值 |
| **TinyWorld** (3121455692atou-sudo) | 16⭐，概念验证阶段 |
| **output-phrasing-engineering** | 纯文档，0 代码，但九种空洞变体方法论有价值 |
| **tavernlike** (ariespo) | raw 文件 404，无法验证 |

---

## 执行优先级总结

```
P0 (设计阶段必读):
  NeuroBook      → 同 Pi 框架，Profile+Sidecar 架构
  pi-stage       → 同 Pi 框架，5层上下文流水线+Worldbook编译
  AIRP-State     → Blueprint/State 分离协议

P1 (引擎 vNext 直接参考):
  deepRolePlay   → 场景压缩+知识挂载+双模型
  rpg-platform   → Phase 0-4 流水线+SillyTavern导入
  Fabula         → BAML 结构化提取

P2 (后续参考):
  Story-to-Game, works-dna-extractor, AI-Reader-V2,
  PlotPilot, NovelWriter, Storyteller
```

---

---

## 源码级发现（2026-06-19 已读）

以下模式从实际 TypeScript/Python 源码中提取，非 README 级别。

### 直接能用的模式

| 模式 | 来源 | 怎么用 |
|---|---|---|
| **5 阶段上下文流水线** | pi-stage `context/pipeline.ts` | Collect→Prioritize→Schedule→Render→Trace，每阶段独立 try-catch。直接搬到 buildStatePrompt |
| **双预算调度器** | pi-stage `context/scheduler.ts` | target(24KB)/hard(40KB) 双预算 + drop/compress/truncate/summarize 四策略。纯函数，可抄 |
| **知识/技能分离** | pi-stage `skill-writer.ts` | `reclassifyKnowledge()` 把世界知识从技能里拆出来，防止 system prompt 膨胀 |
| **TF-IDF 中文检索** | pi-stage `worldbook/index.ts` | 纯 JS 实现，bigram 分词 + 余弦相似度。可替换 earth-0 现在的关键词匹配 |
| **Blueprint/State 分离** | AIRP `protocol.md` | 静态蓝图(布局/主题)只发一次 + 动态状态走 RFC 6902 Patch。earth-0 的 preset.json 缺 version cache |
| **三阶段流水线** | deepRolePlay `fast_scenario_workflow.py` | 记忆检索(Flash)→情景更新(Flash)→主动对话(Pro)。每阶段 max_iterations=1，不无限循环 |
| **JSON 表格 CRUD** | deepRolePlay `scenario_table_tools.py` | 五个表(情景/角色属性/角色状态/关键实体/世界观)，A1/B1 行号。earth-0 data/ 可以变成可写版本 |
| **Sidecar Context** | NeuroBook `neuro-agent-harness.ts` | fork 分支跑检索/反思，结果 merge 回主会话。`runtimeMessages`(临时) vs `persistedMessages`(永久) 分离 |
| **Profile 注册模式** | NeuroBook `define-agent-profile.ts` | 单一 gatekeeper 函数，注册时验证所有不变量。profile key 决定角色，不需要 OOP 类型层级 |
| **外部知识挂载** | deepRolePlay `external_knowledge_manager.py` | 启动时加载 txt→缓存→注入到检索步骤(非最终 prompt)。earth-0 的 novel-to-data 可以这样挂原文 |

### 不值得抄的

| 项目 | 原因 |
|---|---|
| WorldLines 核心引擎 | 闭源二进制，看不到 |
| TinyWorld | 太简单，无游戏引擎 |
| output-phrasing-engineering | 纯文档，0 代码。但九种空洞变体方法论好 |
| tavernlike | raw 文件仍不可达 |

### 执行建议

下一步不是全抄。是先做**一个能跑的东西**——novel-to-data CLI 脚本：

```bash
node scripts/novel-to-data.mjs --input 春物卷1.txt --ip oregairu
```

抄 Fabula 的 BAML 提取思路 + deepRolePlay 的表结构 + NeuroBook 的三阶段流水线。不动框架，一个独立脚本。
