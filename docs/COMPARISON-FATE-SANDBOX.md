# earth-0 vs fate-sandbox 诚实的对比分析 (2026-06-26)

> 不美化，不贬低。哪些是 fate 做得更好的，哪些是 earth-0 做得更好的，哪些是二者故意不同。

---

## 一、fate-sandbox 确实比 earth-0 做得更好的

### 1. 工程纪律（TypeScript 层）

| 维度 | fate | earth-0 |
|------|------|---------|
| 类型安全 | `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`，零 `any` | 大量 `any` 类型断言、`as any` |
| Lint/格式 | oxlint + oxfmt，CI 强制零错误 | 无 |
| 状态迁移 | 线性 vN→vN+1，每个迁移函数只处理相邻版本 | `loadState` 里 10 段累积 if 补丁 |
| 死代码 | 零容忍 | 有 3 个 .bak 文件入库，有未使用的函数 |
| 测试 | 领域测试 + 审计测试，不依赖 LLM | 230 测试，不依赖 LLM（这点持平） |

这是纯粹的技术债差距。fate 用了一个更严格的 TypeScript 配置和一个"不改就删"的维护哲学。earth-0 更快地迭代出了功能，但积累了类型债务。

**要不要追**：看你的优先级。启用 `strict` + `noUncheckedIndexedAccess` 会炸几百个类型错误，修它们要几天时间，但修完之后未来 LLM 生成的代码不容易出类型 bug。

### 2. 事务性状态修改（DomainEventToolRunner）

fate 的工具执行走 clone→execute→validate→commit 四步。失败不提交。这保证了"工具调一半崩了不会留脏数据"。

earth-0 的 20 个工具直接写 `gameState.player.xxx = yyy`，依靠"最后调 saveState"兜底。D6（6 个工具不调 saveState）虽然已修，但本质问题没变：没有统一的 state write path。

**为什么没做**：需要重写所有 55 个工具的 execute 函数，把赋值操作搬到 draft 对象上。D6 修完后，日常使用中工具崩的概率极低（大部分是同步赋值），所以优先级被推后了。

### 3. 存档基础设施

| 维度 | fate | earth-0 |
|------|------|---------|
| 原子性 | 写 `.tmp` → `renameSync`（同盘原子） | 4 个文件顺序 `writeFileSync` |
| 版本号 | `schemaVersion` 线性迁移 | 有 `schemaVersion`，但迁移靠累积 if |
| /fuck 回退 | 物理删除废弃分支的 session 记录 | /redo 从备份恢复（功能相似，实现更简单） |

### 4. 两段式渲染（真正的双模型）

fate 用 `FATE_RENDER_MODEL` 环境变量指定的**不同模型**来做渲染趟——算账用 DeepSeek，写文用 Claude/Gemini。两个调用之间只有结构化 Direction Packet JSON 传递。

earth-0 的三段式（结算→角色→渲染）是**同一个模型**靠 prompt contract 约束行为。也能工作，但：
- 不能省钱（贵的模型也在算账）
- 不能防呆（模型可能犯规写叙事或调不该调的工具）
- rendering.json 的 `logic_engine_model` 字段声明了但从未使用

**为什么没做**：pi 框架目前不支持在工具内部启动第二个独立的 agent loop 并指定不同模型。render_scene 的 `generateCompletion` 是野路子——自己调 API 而不是走 pi 的 agent loop。真正的双模型需要框架支持或大规模 hack。

### 5. Session Audit CLI

fate 有 `pnpm run audit:session` 命令，解析 session JSONL 文件产出结构化指标：时间覆盖率、工具使用分布、get_status 冗余调用、无成本 streak、lint 违规分布、parallel-line 触发率。

earth-0 没有 session 级别的分析工具。

**为什么没做**：earth-0 的 session 格式和 pi 框架绑定，不是独立的 JSONL。要做需要先理解 pi 的 session 存储格式。

---

## 二、earth-0 比 fate-sandbox 做得更好的

### 1. 世界模拟的丰富度

| 维度 | earth-0 | fate |
|------|---------|------|
| 物理空间 | 区域→建筑→楼层→房间，家具可放置/交互/做容器 | 抽象的 scene presence 列表 |
| NPC 日常 | schedule 系统 + 日程覆盖 + 按年龄段分组 | 无 |
| 天气 | 马尔可夫链季节转移 + 温度模型 + 疲劳乘数 | 无 |
| 日历 | 按日期触发事件 + 预热/当天/余波三阶段 + 组织效果 | 无 |
| 人生事件 | 疾病/怀孕/犯罪/冲突状态机 | 无 |
| 手机/SNS | 消息/联系人/通话/BBS/SNS时间线/照片 | 无 |
| 交通工具 | 步行/自行车/公交/电车，有速度和路线 | 无 |
| 房地产 | 租赁/自有/欠款/存储 | 有 economy 但无 housing |

earth-0 是一个**世界模拟器**，fate 是一个**叙事引擎**。前者更擅长"世界在转"的感觉，后者更擅长"故事在推进"的感觉。

### 2. NPC 角色深度

earth-0 的 NPC 有：多年龄段性格阶段、身体发育曲线、服装系统（5 套可切换）、性状态机（周期/欲望/唤起/高潮/开发度/事后结算）、社交情境标签系统、自主意图（drives_by_age）、关系快照。

fate 的 NPC（Actor）更抽象：身份/状态/印象/议程/秘密槽——服务于叙事，但不模拟人的物理和生理维度。

### 3. 多世界包架构

earth-0 可以切到 `wasteland/` 世界包，所有角色/物品/房间/时间线全换，引擎不改。fate 的 20+ campaign preset 都在同一个型月宇宙里，没有世界观切换机制。

### 4. TUI 面板丰富度

28 个 TUI 面板 vs fate 的 4 个（/status /inventory /choice /compact）。

### 5. 开放式世界观

fate 是型月宇宙模拟器，所有数据（角色/从者/地点/时间线）都是预定义的。earth-0 的 GM 可以运行时创建角色（`create_character`）、创建地点（`create_location`）、创建剧情钩子（`create_story_hook`）、临时角色转正（`instantiate_npc`）——世界是可以生长和扩展的。

---

## 三、故意不同的设计选择

这些不是谁好谁坏，是两个项目从一开始要解决不同的问题。

| 维度 | fate 的选择 | earth-0 的选择 | 原因 |
|------|-----------|---------------|------|
| 状态可见性 | 公开/秘密状态物理拆分 | 三套分级系统（VisibilityLevel / FactLevel / RevealVisibilityLevel），引擎级过滤 | fate 的型月题材严重依赖"秘密"（真名/宝具），泄露即毁。earth-0 的 D&D 哲学是"GM 全知，选择性分发信息" |
| 渲染信息隔离 | 洁净室渲染（渲染模型接触不到状态） | 渲染模型看到完整上下文（gameState + NPC 回应原文） | fate 的 Direction Packet 是结构化 JSON（npcStances: {bindingMove, ...}），不含文学文本。earth-0 的 NPC agent 输出是自然语言，渲染模型必须看全文才能正确织入 |
| NPC 控制 | GM 决定 NPC 行为，通过 structured packet 约束 | 每个 NPC 有独立 LLM agent，GM 不能直接控制 NPC 的言行 | earth-0 追求"角色自发性"——NPC 可以有自己的心事和误判 |
| 世界规模 | 单一型月宇宙，结构化数据 | 多世界包 + 运行时创建角色/地点/钩子 | earth-0 追求的是"世界可以生长"的沙盒感 |

---

## 四、纯粹没来得及做的

这些不是设计选择，是优先级排在了后面：

1. **TypeScript strict mode + 清 any**：工程债务
2. **Session 分析工具**：长时间不玩回来不知道发生了什么
3. **/compact 确定性压缩**：D4 修好后，5 行代码的事
4. **存档原子化**：temp+rename
5. **整理想法记录文档**：你提到的最重要的一项——设计决策散落在各个模块和对话里，没有统一索引

---

## 五、你刚才说的：想法记录的问题

你说得对，这是最大的瓶颈。earth-0 的设计思路散落在：

- `docs/decisions.md`（8 条决策，现在 11 条）
- `docs/framework-optimization-log.md`
- `docs/narrative-engineering-roadmap.md`
- `docs/AUDIT-2026-06-25.md`
- `docs/PLAN-v2.md`
- `docs/history/` 下 10 个历史文档
- 各个 ai 的对话记录
- `agents/gm-contract.md`（实际包含了很多架构级设计，如三段式工作流）

没有一个文档能回答"这个项目为什么这样设计"。当一个新 LLM（或人类）接手时，它要先读完上面所有东西才能理解——而我们自己都没读完。

**我能帮你做的是**：趁这次上下文还热，把我对 earth-0 设计思路的理解写成一份 `docs/PHILOSOPHY.md`，作为"为什么这样设计"的单一入口。里面不写代码细节，只写设计原则、核型取舍、和 fate 的差异选择及理由。以后每次加新功能时，先对照这个文档看是否符合既有设计哲学，不符合就主动讨论要不要更新哲学。

你觉得要不要写这份文档？如果写，我大概需要 15 分钟直接在对话里完成。
