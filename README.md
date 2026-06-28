# earth-0

**A general-purpose deterministic engine + decoupled multi-agent runtime for interactive fiction.**
NPC simulation runs via isolated, on-demand LLM invocations with their own memory and knowledge.
The engine owns the physics, LLMs own the stories.

The engine handles physics — time, space, combat, economy, schedules.
LLMs handle narrative — but the engine won't let them cheat.

> Read [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) before touching the code.

---

## 这是什么 / What

A modular interactive fiction runtime built on [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent).
Not a character card. Not a prompt chain. A full deterministic engine backed by LLM-driven NPC Agents.

**The problem with normal LLM roleplay:**
- You steal an item — the LLM says you did, but no item moved. So you can steal it again.
- You're in a "room" with NPCs — but there's no grid, no walls, no physics.
- NPCs only exist when mentioned — no schedules, no independent movement.
- The GM puppets everyone, so every NPC already "knows" what every other NPC thinks.

**earth-0 fixes all of this.** The engine enforces conservation laws (money, items, HP, time, position, information visibility).
Everything else — atmosphere, dialogue, psychology — is handed to LLMs.

> 终端里的活着的小说。引擎算数字，LLM 写小说。

---

## 这是什么

一个运行在 [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) 框架上、**完全与题材解耦的通用交互式叙事沙盒引擎**。

它本身并不绑定任何特定的故事剧本。通过定义不同的 **世界数据包 (Worldpack)**（配置角色卡、物品、地图、时间线等），任何人都可以使用它轻松制作出属于自己的 AI 跑团和文字 RPG 游戏。

它包含了一整套完整的确定性规则系统（时间轴、战斗数值、经济系统、物理空间网格、日程安排、动态天气、剧情分支时间线），配合一个 LLM 驱动的虚拟游戏主持人（GM）。

### 不是 AI 聊天机器人

普通 LLM 角色扮演的问题是：
- **物品虚空生成**：你偷了一件东西，LLM 说你偷了，但下次你又能偷——因为没有“物品所有权转移”的事实落盘。
- **空间无限膨胀**：你和 NPC 在一个“房间”里，但这个房间可以挤下所有人——因为没有物理坐标和容纳上限。
- **NPC 离线即死**：NPC 只在与玩家对话时才“存在”，你不理他们时他们就是静止的——因为没有自动运作的日程与行为系统。
- **上帝视角**：GM 一个人扮演所有 NPC，所以每个 NPC 说话时实际上已经“偷看”了其他 NPC 的内心活动——因为缺乏信息物理隔离。

earth-0 解决的就是这些问题。**引擎不让 LLM 偷懒。** 偷东西必须走 `steal_item` 接口（引擎执行真背包扣除），进房间必须分配棋盘格坐标（物理撞墙拦截），NPC 按照自己的日程表在地图上自主移动，每个 NPC 采用**“临时演员制”在回合中并行派生出独立的心智上下文（独立 LLM 调用）**，确保对话时拥有真实的信息差与误判。

### 📳 移动终端友好与极致能耗设计 (Mobile-First & Low Footprint)

本项目在立项之初就将“在手机终端直接游玩”作为核心技术约束，避免让其退化为只能在昂贵服务器或云端运行的臃肿软件：
- **手机 TUI 适配**：纯文本终端 UI 设计，无缝适配手机 Termux、SSH 客户端等移动终端环境，提供纯粹、轻量、极客的移动端“文字沙盒”游玩体验。
- **临时演员制 (On-Demand Spawning)**：NPC 智能体不常驻后台进程，仅在玩家同室交互时动态派生（每回合仅生成 2~5 个 NPC 实例），这使每回合的 Token 预算和性能消耗不随世界 NPC 总数膨胀，将单轮 API 成本和资源开销压缩至极低。

---

## 核心原则

```
引擎守恒，叙事自由
```

引擎只拦截不可逆的守恒量（金钱、物品、HP、时间、位置、信息可见性）。其余一切——氛围、对话、心理描写、价格高低——全权交给 LLM。

**引擎不该替 LLM 做叙事判断。** 引擎负责减负和防偷懒，不限制创造力。

---

## 架构：三段式工作流

每个玩家回合拆成三步，职责严格分离：

```
玩家输入
    ↓
┌──────────────────────────────────────────┐
│ 第一步：结算轮（静默，不对玩家输出）       │
│  查 lookup → 调引擎工具 → 写导演单 → 落台账 │
│  "禁止输出玩家可见的叙事正文"              │
├──────────────────────────────────────────┤
│ 第二步：角色轮（并行，不对玩家输出）        │
│  每个在场 NPC 独立 LLM 调用              │
│  每人只拿自己的记忆 + 印象 + 身体状态       │
│  "禁止输出玩家可见的叙事正文"              │
├──────────────────────────────────────────┤
│ 第三步：渲染轮（面向玩家）                │
│  读导演单 + NPC 回应 → 叙事正文 + 4 扮演选项 │
│  "禁止调用任何工具"                       │
└──────────────────────────────────────────┘
```

完整的规则在 [`agents/gm-contract.md`](agents/gm-contract.md)。

---

## 它能做什么

### 世界模拟（"世界在转"）

| 系统 | 说明 |
|------|------|
| 🕐 **时间** | 分钟级推进 + 跨天结算 + NPC 年龄/人生阶段同步 |
| 🗺️ **物理空间** | 区域→建筑→楼层→房间，棋盘坐标 + 家具放置，走到尽头撞墙 |
| 🚶 **NPC 日程** | 每个 NPC 有日程模板，按年龄段和星期自动移动。玩家不互动他们也在过日子 |
| 🌤️ **天气** | 马尔可夫链季节转移 + 温度模型 + 疲劳乘数 |
| 📅 **日历** | 日期触发事件 + 预热/当天/余波三阶段，文化祭当天 NPC 自动去操场 |
| 📱 **手机/SNS** | 消息、联系人、通话记录、BBS、SNS 时间线、照片 |

### 角色深度

| 特性 | 说明 |
|------|------|
| 🎭 **心智隔离的 NPC 模拟** | 每个 NPC 在对话中派生独立的 LLM 上下文，仅基于自身的记忆、对外印象及状态响应，实现天然的社交信息差 |
| 💬 **内心独白 + 言行** | NPC 嘴上说的和心里想的可以完全相反。嘴上嘴硬，内心写"我怕被拒绝" |
| 🧬 **身体系统** | 多年龄段体型发育、服装集（5 套可切换）、生理状态引擎 |
| 🧠 **信息分级** | 角色常识按关系程度可见——陌生人只看 common 级，至交看到 intimate 级 |

### 叙事引擎

| 特性 | 说明 |
|------|------|
| 📜 **剧情时间线** | 49 个 JSON 事件 + 触发条件（年龄、地点、好感度、flag），每回合自动扫描 |
| 🪝 **剧情钩子** | 引擎和 LLM 都可以创建钩子，最多同时 3 个，有过期机制 |
| 🔒 **秘密防火墙** | 四级可见性 + `reveal_secret` 工具 + reveal 日志 |
| ✍️ **正文质量门** | 渲染后机器扫描硬伤（好感度数值泄露、伪菜单结尾、废话开头），命中自动让模型重写 |
| 🎭 **叙事视角与双轨幕间** | 引擎依据在场 NPC 数量自动在回合对话（`turn_based`）与小说记叙（`novel`）间防抖切换；关系突变/剧情触发时播放只读幕间（他者之眼/宏大故事），完美展现信息差与世界反应 |


### 开放式世界

| 特性 | 说明 |
|------|------|
| 👤 **运行时创建角色** | `create_character` 支持预制角色的完整字段（性格阶段、说话风格、日程、驱动力等） |
| 🏗️ **运行时创建地点** | `create_location` + 家具系统 |
| 🎭 **临时 NPC** | `spawn_temp_npc` 创建只活在当前场景的角色（混混、醉汉、星探），场景结束自动回收。有潜力就 `instantiate_npc` 转正 |
| 🔄 **多世界包** | 换个世界观只需改一个文件。现成：oregairu（春物）, wasteland（开发中） |

### 🌐 关于 Web 前端与页面扩展

本引擎目前专注于打造纯文本、高鲁棒性的终端运行核心（TUI）。虽然我们的长期路线图包含开发 Web 可视化前端，但现阶段为了保持底层逻辑与测试覆盖的精纯度，我们优先将精力集中于终端引擎。
- **推荐前端合作项目**：如果你希望在现阶段为本引擎制作 Web 页面或开发可视化前端，强烈推荐参考或结合 [tavernlike](https://github.com/ariespo/tavernlike) 项目。它提供了与本引擎架构高度契合的网页端对话与 UI 渲染思路。

---

## 快速开始

```bash
# 前置：安装 pi-coding-agent 框架
# 参考 https://github.com/mariozechner/pi-coding-agent

# 克隆并启动
cd earth-0
bash start.sh

# 跑测试（不需要 LLM，2 秒完成）
npx tsx test.ts
```

**配置模型**：编辑 `data/rendering.json`：
```json
{
  "model_mappings": {
    "logic_engine_model": "deepseek/deepseek-v4-pro",
    "narrative_render_model": "deepseek/deepseek-v4-pro",
    "npc_agent_model": "deepseek/deepseek-v4-flash"
  }
}
```

---

## 项目结构

```
earth-0/
├── engine/          # 确定性引擎（20+ 模块，零题材硬编码）
├── tools/           # LLM 工具 + TUI 命令
│   ├── action/      # 世界修改（35 工具）
│   ├── lookup/      # 只读查询（16 工具）
│   ├── state/       # 状态管理（18 工具）
│   └── tui/         # 终端 UI 面板（34 命令）
├── agents/          # LLM 系统提示词
├── worldpacks/      # 可切换的世界数据包
│   ├── oregairu/    # 我的青春恋爱物语果然有问题（活跃）
│   └── wasteland/   # 后末日生存（开发中）
├── data/            # 跨世界通用数据
├── docs/            # 设计文档
└── state/           # 运行时存档（git ignored）
```

---

## 文档索引

| 读这个 | 如果你想 |
|--------|---------|
| [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) | 理解"为什么 earth-0 是现在这个样子" |
| [`docs/decisions.md`](docs/decisions.md) | 查看每个具体设计决策的取舍理由 |
| [`docs/COMPARISON-FATE-SANDBOX.md`](docs/COMPARISON-FATE-SANDBOX.md) | 和 fate-sandbox 的诚实对比 |
| [`docs/AUDIT-2026-06-25.md`](docs/AUDIT-2026-06-25.md) | 最新一次全面审计 |
| [`docs/module-template.md`](docs/module-template.md) | 学习怎么加新模块 |

---

## 测试

```bash
npx tsx test.ts
```

230+ 测试，2 秒跑完，不依赖 LLM。覆盖引擎算法、工具落盘验证、集成管线（包括剧情引擎接线、手机顶栏无脏值、lint 引擎、toolsCalled 追踪）。
