# earth-0 设计哲学

> 这份文档回答一个问题：**为什么 earth-0 是现在这个样子？**
> 每个新接手这个项目的 LLM 或人类，先读这个。具体细节见链接到的子文档。

---

## 〇、这个项目从哪里来

### 最初要解决的三个根问题

**1. 上帝视角（反元游戏）**：一个 LLM 扮演所有角色 → 每个 NPC 说话时已经"知道"其他 NPC 的内心活动 → 对话没有真正的信息差、误判、尴尬。目标是像博德之门 3 那样——你可以偷任何东西、做任何事，但 NPC 的反应基于他们自己知道的信息，不是基于 GM 的全知。

**2. 空间无限大（文字空间的物理化）**：LLM 的文字房间没有边界——小教室可以放下全地球的人。目标是像模拟人生那样——房间有墙、有坐标、有家具，走到尽头就撞墙。`room` 系统和棋盘坐标就是为解决这个设计的。

**3. NPC 是死的（让他们活起来）**：LLM 叙事中的 NPC 只在被提到时才"存在"。目标是像 GTA 那样——NPC 有自己的日程，自己移动，玩家不互动他们也在过日子。日程系统、人生事件、驱动力系统都是为此。

### 一个技术约束：手机端能跑

最开始 DESIGN_REVIEW.md 明确写了"不要独立 NPC Agent（手机端跑不动）"。后来这个约束被突破了——不是因为放弃了手机端，而是找到了"临时演员制"这个折中：NPC 不常驻后台，只在被 GM 喊上场时才占用 API 调用。演完留记忆退场。token 不随 NPC 总数增长——50 个 NPC 在世界中，每回合只生成和玩家同处一室的 2-5 个。

---

## 一、核心原则

### 1.1 引擎守恒，叙事自由

> 引擎只拦截不可逆的守恒量（金钱、物品、HP、时间、位置、信息可见性）；一切可逆的、纯风味的、可由文字承载的东西，全权交给 LLM。

这个原则是从 `patch_state` 的教训中提炼出来的。最初有一个万能修改器工具，允许 LLM 绕过所有游戏系统直接改状态。这导致 LLM 学会了"偷懒"——不调 `buy_item`，直接改钱和物品。后来被拆成了三个独立工具（`transfer_item`、`adjust_relation`、`grant_skill_exp`），每个都有引擎校验。

详见 `docs/decisions.md` 决策 8 和 `docs/history/HANDOFF.md` Phase 1。

### 1.2 引擎不该替 LLM 做叙事判断

引擎的角色是**减负和防偷懒**，不是限制创造。引擎：
- ✅ 提供结构化数据（lookup_character、lookup_lore、get_status）
- ✅ 强制执行不可逆操作（钱不会凭空出现、HP 不会为负）
- ✅ 自动追踪变化（好感度变化自动记录、秘密揭示自动落 revealLog）
- ❌ 不替 LLM 决定 NPC 该说什么
- ❌ 不给 LLM 的叙事打分
- ❌ 不因为"这个故事走向不好"而拦截工具调用

### 1.3 Prompt 不是防线

来自 DESIGN_REVIEW.md / ARCHITECTURE_PLAN.md 第 14 行的第六条设计宪法：

> "不要用 prompt 长期弥补坏 interface。"

当模型经常犯某个错误时，优先把约束下沉到 schema、tool boundary、normalizer、engine invariant、migration 和测试。只补一句 prompt 骂模型等于没有修。

实际案例：LLM 曾经被 4 个底层空间工具（`edit_map_cell`、`build_add`、`build_remove`、`door_toggle`）淹没问题。解决方案不是写 prompt 让 LLM "仔细选择工具"，而是隐藏所有 4 个工具，替换为单一的 `world_interact`——引擎自己处理坐标和校验。详见 `docs/history/HANDOFF.md` Phase 3a。

### 1.4 软约束优先于硬过滤

来自 `docs/framework-optimization-log.md` 优化 2：

pi 框架不支持运行时动态隐藏工具。与其改框架做硬过滤，不如在 prompt 末尾追加一行场景提示。研究支持（Looking Is Not Picking, arXiv 2026.6）：软提示可以有效改善工具选择准确率，效果接近硬过滤但零风险。

---

## 二、架构：三段式 + 多 NPC Agent

### 2.1 每个回合走三步

```
玩家输入
    ↓
┌─────────────────────────────────────────────┐
│ 第一步：结算轮（静默，不对玩家输出）          │
│   GM 分析输入 → 查 lookup → 调引擎工具        │
│   → 写导演单 → record_turn_log 落盘          │
│   禁止输出玩家可见的叙事正文                   │
├─────────────────────────────────────────────┤
│ 第二步：角色轮（并行，不对玩家输出）            │
│   spawn_npc_agents → 每个 NPC 独立 LLM 调用  │
│   每人只拿自己的记忆+印象+身体状态              │
│   禁止输出玩家可见的叙事正文                   │
├─────────────────────────────────────────────┤
│ 第三步：渲染轮（面向玩家输出）                 │
│   读导演单 + NPC 回应 → render_scene          │
│   → 叙事正文 + 4 个扮演选项                   │
│   禁止调用任何工具                            │
└─────────────────────────────────────────────┘
```

这三个阶段跑在**同一个 LLM 模型**上，靠 prompt contract 约束行为边界。详见 `agents/gm-contract.md`。

### 2.3 叙事节奏：引擎控制，不是 LLM 自由裁量

earth-0 在 A 模块（叙事视角与双轨幕间）中确立了一条重要原则：**叙事节奏（模式、字数、人称）必须由引擎决定，不能交给 LLM 自由裁量。**

原因：
- LLM 会漂移——前三回合写 200 字第二人称，第七回合忽然冒出 800 字第三人称全景旁白，玩家体验断裂。
- 叙事模式的切换是**有业务语义的**：在场 NPC 为 0 时切 Novel 模式（环境沉浸）、在场 NPC ≥ 1 时切 Turn-based 模式（回合对话）。这种判断是确定性的，引擎能做到，不需要 LLM 猜。
- 幕间（Intermission）对 `gameState` 守恒量**必须零修改**——这是引擎级约束，LLM 不被信任自己维持这个不变量。

**实现**：
- `engine/detect-mode.ts` —— 依据在场 NPC 数量和防抖计数器，输出 `novel` | `turn_based` 切换决策
- `engine/viewpoint.ts` —— 管理切镜队列（`_cutaway_queue`）和幕间触发条件
- `agents/gm-voice-novel.md` / `agents/gm-voice-turnbased.md` —— 两套语气合同，引擎把对应合同注入 prompt

这也是"Prompt 不是防线"原则（§1.3）的具体落地——节奏控制下沉到引擎，不靠 prompt 请求 LLM "记住当前模式"。

### 2.2 为什么不是双模型（fate 式的洁净室渲染）

fate 的渲染模型**物理上接触不到游戏状态**——只收到结构化 JSON Direction Packet。这是绝对防泄密，但前提是 Packet 里的信息已经足够让渲染模型写出好文章。

earth-0 的 NPC agent 输出是**文学文本**（内心独白 + 言行）。如果渲染模型看不到 NPC agent 的完整回应，它会误解潜台词——NPC 说"随便你"，内心写的是"我怕被拒绝"，渲染模型只看到 Packet 上写"NPC 冷淡回应"→ 写成"不耐烦地转过头去"——丢了"嘴硬心软"的潜台词。

**选择：两个模型看到同样的上下文，通过 contract 约束行为。** 防泄密靠 lint 引擎 + GM 纪律。

详见 `docs/COMPARISON-FATE-SANDBOX.md`。

---

## 三、 为什么需要心智隔离的 NPC 模拟（独立心智上下文）

### 3.1 单 LLM 扮演所有角色的根缺陷

如果 GM 一个人扮演所有 NPC，他"知道"每个 NPC 的内心活动、秘密、对其他人的看法。这导致 NPC 之间的对话没有真正的信息差——而这是现实社交中最有味道的东西。

### 3.2 方案：临时演员制

NPC 不常驻后台。GM 需要时喊 `spawn_npc_agents`，拉几个临时演员上场。每人只拿自己的：
- 记忆（`memoryTags`）
- 对他人的印象（`getNPCCharacterImpressions`——只给 common 级事实）
- 身体状态（周期、欲望、情绪基调）
- 关系快照（好感度阶段、tone、notes）

演完退场，自动写一条记忆摘要。下次被喊时从上次停下的地方继续。

**token 不随 NPC 总数增长。** 50 个 NPC 在世界中，每回合只生成同处一室的 2-5 个。

### 3.3 NPC 在单次调用中输出什么

两层结构：
1. **内心独白**（`*文本*` 格式）：真实的、不设防的内心活动——对自己诚实
2. **言行**（beat 响应链：本能反应→消化→有意识的回应）：嘴上说的可以和心里想的完全相反

引擎存进 `memoryTags` + `角色状态表`，但不自动解析来驱动状态变化——GM 在结算轮看到后自己决定要不要调 `adjust_relation` 或 `create_story_hook`。

---

## 四、三权分立：引擎 / GM / NPC Agent

来自 `docs/superpowers/specs/2026-06-23-llm-world-co-creator-design.md` 第 69-91 行：

| 角色 | 职责 | 不能做什么 |
|------|------|-----------|
| **引擎** | 时间推进、空间移动、数值比较、钩子生命周期、NPC 人生事件推进（纯数值状态机，不走 LLM）、天气、疲劳、战斗、骰子 | 不写叙事文字，不开 JSON 以外的输入入口 |
| **GM（主 LLM）** | 决定是否产生新钩子、编写钩子文本、编排叙事、协调冲突、创建角色/地点/事件 | 不能直接写死 NPC 说什么（那是 NPC Agent 的事） |
| **NPC Agent** | 说话、写入自己的记忆、更新自己的 pendingOverride、改变好感度、给予物品、打电话 | 不能单方面改变其他 NPC 或玩家 |

### NPC 自主权的边界

NPC 可以：改变自己、改变自愿协作的对象（如给物品）
NPC 不可以：单方面改变其他 NPC 或玩家

---

## 五、世界模拟的丰富度

earth-0 是一个**世界模拟器**，不只是叙事引擎。系统全景：

| 系统 | 一句话 | 对标 |
|------|--------|------|
| 时间 | 分钟级推进 + 跨天结算 + 年龄/人生阶段计算 | — |
| 物理空间 | 区域→建筑→楼层→房间，棋盘坐标 + 家具放置 | 模拟人生 |
| 日程 | NPC 按模板移动 + 覆盖 + 按年龄段分组 | GTA |
| 天气 | 马尔可夫链季节转移 + 温度模型 + 疲劳乘数 | — |
| 日历 | 日期触发 + 预热/当天/余波三阶段 + 组织效果 | — |
| 剧情时间线 | 49 个 JSON 事件 + 触发条件 + 钩子生命周期 | fate-sandbox 参考 |
| NPC 驱动力 | 按年龄段的目标/驱动力，引擎扫描产生钩子 | — |
| 人生事件 | 疾病/怀孕/犯罪/冲突状态机（纯引擎，不走 LLM） | — |
| 手机/SNS | 消息/联系人/通话/BBS/SNS时间线/照片 | — |
| 战斗 | 回合制 AC/D100/伤害计算/NPC AI | 博德之门 |
| 性 | 欲望/唤起/高潮/开发度/体位/事后结算 | — |
| 房地产 | 租赁/自有/欠款/存储 | — |
| 家具 | 放置/移除/交互/做容器 | 模拟人生 |
| 盗窃 | 引擎校验 + 失败自动触发关系惩罚 + 告警 flag | 博德之门 |
| 伪装 | identity_check → 暴露写入 flag.identity_exposed + 声望降 | — |

这些系统是**"世界在转"**的骨架。fate 更擅长**"故事在推进"**，earth-0 更擅长**"世界在转"**。

---

## 六、信息可见性

### 6.1 设计哲学：D&D 式 GM 全知 + 选择性分发

GM 知道模组的全部秘密，但选择性地给玩家和 NPC 信息。不是物理分区（fate 式），而是**分散过滤**——每个数据字段有自己的可见性标签，代码按场景消费。

### 6.2 三套分级系统

| 系统 | 等级 | 适用对象 | 引擎行为 |
|------|------|---------|---------|
| **VisibilityLevel** | `common` / `industry` / `hidden` | 世界常识（lore） | common 自动注入 prompt；industry 需角色匹配；hidden 需 flag 触发 |
| **FactLevel** | `common` / `familiar` / `close` / `intimate` | 角色信息 | `getCharacterFacts()` 按关系阶段过滤 |
| **RevealVisibilityLevel** | `player_known` / `protagonist_known` / `scene_public` / `hidden_canonical` | 秘密揭示 | `reveal_secret` 工具 + `revealLog` 追踪 |

**这不是纯 prompt 请求——是引擎级过滤。** 代码在 `engine/types.ts`、`engine/lore.ts`、`engine/state.ts:1979-2010`。

### 6.3 知识与秘密正交

同样的信息可以同时受两层保护：`level: hidden`（常识天花板）+ Layer 3 的 `hidden_canonical`（秘密防火墙）= 双重保险。详见 `docs/superpowers/specs/2026-06-24-event-calendar-design.md` 第 303-309 行。

---

## 七、工具设计：不是数据库字段，是 GM 动作

### 7.1 四层 API 设计

来自 `docs/history/ARCHITECTURE_PLAN.md` 第 20-35 行：

```
Layer 1: Scene/Action   ← LLM 日常入口（高层宏观，少参数）
Layer 2: Turn Commit    ← 多状态原子提交
Layer 3: Domain         ← 单领域操作，有引擎校验
Layer 4: Primitive      ← 仅查询和 debug
```

LLM 优先用高层。高层工具内部补全细节字段，LLM 不需要关心。

### 7.2 描述压缩的理论依据

来自 `docs/framework-optimization-log.md` 优化 1：

- Tool Attention Is All You Need (arXiv 2026.4)：工具 schema 消耗约 72% context window。两阶段懒加载省 95% token，准确率反而从 24% 升到 91%。
- Berkeley Function Calling Leaderboard (ICML 2025)：最好模型的多轮工具调用成功率仅 47.62%，冗余描述是主要瓶颈。

**结论：精简的工具描述 = 更高的选择准确率，不只是省 token。**
所以所有工具的 description ≤25 中文字，action 值用 `|` 分隔。

### 7.3 工具分三层注册（registry 设计）

来自 `tools/registry.ts`：

- **lookup 工具不追踪**：纯查询不改状态，不在台账的 toolsCalled 中出现
- **action/state 工具追踪**：通过 `withToolTracking()` wrapper 自动记录
- **TUI 命令不追踪**：用户操作不走工具流

加新工具时只要放进对应的数组，追踪自动生效。不需要在每个工具文件里手动加 `pushToolCall`。

详见 `docs/decisions.md` 决策 9。

---

## 八、引擎零题材硬编码

`engine/` 下**没有任何**角色名、地名、作品名。

- **`worldpacks/oregairu/`** — 活跃世界包（角色、物品、房间、时间线等 18 类数据），引擎启动时加载
- **`data/`** — 跨世界通用数据（abilities、achievements、economy、lore 等）+ TS 静态导入兜底

切换世界观只需改 `data/.active_world` 的值。验证标准：`grep -r '春物\|总武高\|千叶' engine/` 返回空。

详见 `docs/decisions.md` 决策 8。

---

## 九、信息流：Collector 分层降级 + Token 预算纪律

### 9.1 Collector 三层

| 层 | 降级策略 | 内容 |
|----|---------|------|
| 生存层 | **从不降级** | 模板变量（日期、位置、天气） |
| 稳定层 | 保留 | 玩家状态、疲劳、声望、队伍、秘密 |
| 增强层 | drop/truncate/compress | NPC 详情、关系、Layer1、场景表 |

详见 `engine/collectors.ts` 和 `docs/decisions.md` 决策 1。

### 9.2 Token 约束是硬性设计标准

来自两份 superpowers spec 的成本分析方法论：

- 新功能的运行时 LLM token 成本是设计决策的核心因素
- 只要能用引擎做到（扫描、过滤、比较），就不费 LLM token
- 日历范围过滤、org 成员匹配、lore 触发扫描——全部纯引擎，零 token
- 加一个新系统时，先统计"这个系统每回合会增加多少 token"，超过 200 字要重新考虑

---

## 十、不要做的事（以及理由）

| 不做的事 | 理由 |
|---------|------|
| 公开/秘密状态物理拆分 | 已有引擎级分散过滤，D&D 式 GM 全知哲学 |
| 洁净室渲染 | NPC agent 输出是文学文本，渲染模型必须看全文 |
| NPC 常驻后台进程 | 临时演员制更省 API 调用 |
| 工具硬过滤 | pi 框架不支持，软约束零风险 |
| lore 全量注入 | 量太大，LLM 应主动查 |
| 追踪 NPC 饥饿/疲劳/如厕数值 | 日程表已经是生理需求的抽象层，"12:00 食堂"不需要"饥饿值 70→30" |
| 把 social_interact 抽象成宏 | 公式设计需要实际 gameplay 验证，先用手动工具 |
| 重命名 patch_state 来保留后门 | 后门本身是问题，不是名字的问题（"DS 已经毙了"） |
| TypeScript strict mode | 功能优先，类型债务累积但没爆炸 |
| 让 LLM 自由决定叙事人称/字数/模式 | 叙事节奏是引擎级确定性决策（见 §2.3）；LLM 会漂移，模式不一致是体验硬伤 |

---

## 十一、关键文件索引

| 你想知道什么 | 读这个 |
|-------------|--------|
| **每个具体设计决策的取舍理由** | `docs/decisions.md` |
| **和 fate-sandbox 的诚实差距** | `docs/COMPARISON-FATE-SANDBOX.md` |
| **最新一次全面审计的发现** | `docs/AUDIT-2026-06-25.md` |
| **框架优化的历史和理论依据** | `docs/framework-optimization-log.md` |
| **叙事工程长远路线图** | `docs/narrative-engineering-roadmap.md` |
| 新模块怎么加 | `docs/module-template.md` |
| 参考项目清单 | `docs/reference-projects.md` |
| 三段式工作流完整规则 | `agents/gm-contract.md` |
| 早期设计评审（v0.1/v0.2 快照） | `docs/history/DESIGN_REVIEW.md` |
| 四层 API 架构原案 | `docs/history/ARCHITECTURE_PLAN.md` |
| 世界共创者功能设计 | `docs/superpowers/specs/` |
| 所有类型定义 | `engine/types.ts` |
| 游戏状态管理 | `engine/state.ts` |

---

> 最后更新：2026-06-29。新设计决策追加到 `docs/decisions.md`，大方向变化更新本文。
