# earth-0 快速开始

> 终端文字 RPG。AI 当 GM，引擎管事实。春物同人开局即玩。

## 你需要

- [Node.js](https://nodejs.org) ≥ 18
- [pi](https://github.com/earendil-works/pi-coding-agent)（项目自带启动脚本）
- DeepSeek API key（或 兼容 Anthropic 的端点）

## 30 秒跑起来

```bash
# 1. 安装 pi
npm install -g @anthropic-ai/pi

# 2. 设 API key
#    CC+CCR 用户自动读取 ~/.claude/settings.json 的 ANTHROPIC_AUTH_TOKEN
#    或者手动 export DEEPSEEK_API_KEY=sk-...

# 3. 启动
./start.sh
# Windows 用户: bash start.sh

# 4. 输入 /start-game 开始
```

## 第一局

游戏会问四个问题——全给默认值，回车到底就行：

```
姓名: 维
性别: 男
年龄: 16 岁高中入学
家庭背景: 千叶市普通家庭
```

然后你会看到四月的千叶、总武高的校门、一个茶色头发的女生从身边走过。**直接打字就行**——你想说什么、想做什么、想去哪。

## 常用命令

| 命令 | 效果 |
|---|---|
| `/bag` | 看背包 |
| `/room` | 看地图 |
| `/phone` | 打开手机 |
| `/status` | 看自己状态 |
| `/go 地点` | 去某个地方 |
| `/help` | 全部命令 |

## 换世界观

```bash
./scripts/switch-world.sh oregairu   # 春物
./scripts/switch-world.sh list        # 查看可用世界
```

新世界放 `worldpacks/你的世界/`，写个 README.md 就行。引擎自动按 IP 名加载 `data/`。

## 从小说提取数据

```bash
node scripts/novel-to-data.mjs --input 春物卷1.txt --ip oregairu
# → 自动生成 data/characters.json / timelines/ / lore/
```

两段式 LLM 流水线：Flash 粗筛 → Pro 精提取。一本轻小说几毛钱。

## 其他玩法

- **多层叙事**：引擎追踪好感度、日程、秘密、身体状态。NPC 靠 Flash Agent 独立扮演
- **手机系统**：TUI 里的功能机。发短信、刷 Mixi/Twitter、看照片、查通讯录
- **剧情线**：时间线触发事件。接受委托→分支选择→好感变化
- **切换模式**：`/rpg` 切冒险，`/gal` 切日常，`/sex` 切亲密

## 开发

```bash
npx tsx test.ts    # 125 tests，每次改完跑
```

架构：`engine/` = 通用算法 | `data/` = 题材内容 | `agents/` = AI 提示词 | `skills/` = 可复用工作流 | `extension.ts` = 50 个 LLM 工具

## 项目状态

- ✅ 三段式并发 Agent（结算→角色并行→渲染）
- ✅ 回合台账 + 滚动压缩
- ✅ 秘密防火墙（四级可见性）
- ✅ 两段式渲染（Pro 写文，Flash 算账）
- ✅ 125 tests 全绿
