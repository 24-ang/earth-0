# 项目结构 + 做新 worldpack 操作手册

> 回答两个问题：(1) earth-0 由哪些部分构成？(2) 我要做一个新 worldpack 还原一部作品，该动哪些文件？
> 顺带记录：还有哪些大单文件该像 characters 一样拆成目录。
> 生成日期：2026-07-09（基于当天真实文件扫描，非记忆）。数字会过时，结构不会。

---

## 一、三层结构

```
数据层   worldpacks/<世界名>/   ← 做新作品只动这里，纯 JSON，不碰代码
         data/                  ← 跨世界通用数据 + TypeScript 静态 import 编译兜底
引擎层   engine/                ← 通用算法，零题材硬编码（没有任何角色名/地名/作品名）
工具层   tools/                 ← LLM 工具 + TUI 命令，共 134 个
                                  action 57（改世界）/ lookup 22（查询）/ state 20（状态管理）/ tui 35（终端面板）
编排     extension.ts           ← 四阶段流水线（Phase 1 分类→2 NPC→3 渲染→4 创意）
```

**铁律**：世界专属数据只改 `worldpacks/<世界名>/`。`data/` 下的同名文件是编译兜底，改了不在游戏里生效（引擎启动时读的是 worldpack 版）。

---

## 二、做新 worldpack：该动哪些文件

按「角色 / 剧情 / 设定」分类，对应关系如下。✅ = 已经是"一个文件一条目"的目录结构，加新内容只需扔一个 JSON 进去，引擎自动扫描。⚠️ = 还是单个大文件，改起来相对痛苦。

| 你要做的 | 动的文件 | 形态 |
|---|---|---|
| **角色**（人设 / 身体 / 服装 / 性格 / 性档案 / 阶段人格） | `characters/{角色名}.json` 一人一文件 | ✅ 目录（139 个，本轮成果） |
| **剧情 / 时间线**（必经事件 / 触发条件 / 标志性台词） | `timelines/{弧名}.json` 一事件一文件 | ✅ 目录（56 个） |
| **组织 / 势力**（阵营 / 阶级 / 生命周期） | `orgs/{组织名}.json` | ✅ 目录（17 个） |
| **地区设定**（氛围 / 社会规范 / 天空盒） | `locations/{区域名}.json` | ✅ 目录（5 个） |
| **世界秘密**（分级揭示） | `secrets/{秘密名}.json` | ✅ 目录（1 个） |
| **物品**（武器 / 服装 / 消耗品） | `items.json` | ⚠️ 单文件 ~1300 行 |
| **房间 / 建筑内部** | `rooms.json` | ⚠️ 大单文件 ~6400 行 |
| **地区 / 地图** | `regions.json` | ⚠️ 大单文件 ~4800 行 |
| **世界书**（TF-IDF 可检索 lore，供 LLM 查设定） | `动漫角色.json`（名字有误导，其实是 lore 检索库） | ⚠️ 巨型单文件 ~8000 行 |
| 日历 / 课表 / 日程模板 / 商店 / 家具 / 称呼规则 / 手机应用 … | 各自的小 json | 小文件，够用 |

**结论**：最高频改的三样——角色、剧情、组织——已经全部目录化。做新作品的主干路径已经顺了。

### 做新作品的最小步骤
1. 复制 `worldpacks/oregairu/` 为 `worldpacks/<新世界>/`。
2. 往 `characters/`、`timelines/`、`orgs/`、`locations/` 各目录塞你的 JSON（参考现有文件的字段；角色卡字段规范见 `StaticCharacter` 类型定义 + `docs/module-template.md` §6）。
3. 重写 `items.json`、`rooms.json`、`regions.json`（大单文件，暂时只能整个改）。
4. 把 `data/.active_world` 的值改成 `<新世界>`。
5. 启动，看控制台：角色校验器会报缺件/非法值；脑裂检测会报 data/ 与 worldpack 不一致。

---

## 三、还没优化、该像角色一样拆的候选（下一批体力活）

这些是"和 characters.json 当初同一个病"的大单文件。拆它们**不是难题，是确定性的体力活**——套路已验证、加载器现成。

### 数据层（影响做新作品的体验）

| 候选 | 现状 | 拆成 | 加载器 |
|---|---|---|---|
| `rooms.json` ~6400 行 | 单文件（键值对象：房间名→数据） | `rooms/{地点}.json` | **现成**：`loadWorldpackDirRecursive("rooms", "rooms.json")` 直接可用 |
| `regions.json` ~4800 行 | 单文件（键值对象） | `regions/{区域}.json` | 同上，现成 |
| `动漫角色.json` ~8000 行 | 单文件（世界书 lore 库） | `worldbook/{条目}.json` | 需小改 worldbook-search.ts 支持目录 |
| `items.json` ~1300 行 | 单文件 | 中等，不急 | — |

> **关键**：`loadWorldpackDirRecursive(目录名, 兜底平面文件名)` 用 `Object.assign` 合并每个文件，**天然适合 rooms/regions 这种"键值对象"数据**（每个文件写成 `{"房间名": {...}}`）。只有 characters 那种"数组"结构才需要像 `loadCharactersFromDir` 那样单独写加载器。所以拆 rooms/regions 比拆 characters 更省事。

### 代码层（影响维护，与做 worldpack 无关）

- **`engine/state.ts` ~4960 行** —— 引擎的怪兽模块，init / load / save / NPC 水合 / 服装 / 暴露 / 买卖 / 偷窃全塞在一起。已拆过一点（`state-grid.ts` / `state-location.ts`）。这是"改一个东西要在近 5000 行里找"的痛苦来源，值得继续按职责拆分。其余大模块：`timeline.ts` ~1440、`furniture.ts` ~715、`phase1-classifier.ts` ~695。

---

## 四、已知小债（不急，记在案）

- **`data/characters.json` 等已 stale**：目录版是 139 个角色，`data/characters.json` 还是旧的 138 条。它只是编译兜底、不影响运行，但留着 2 万行死数据 + 潜在困惑。真要干净，可减成 `[]`（静态 import 只要文件存在即可）。同理 `data/sex_profiles.json`、`data/character_stages.json`。属"收尾洁癖"。

---

## 五、一句话现状

**离"整个项目完成"不算很近，但离"数据层可维护"很近了。** 最高频改的角色/剧情/组织已全部目录化，做新作品的主干顺了。剩下的大单文件（rooms/regions/worldbook）是"下一批同样的活"，套路验证过、有现成加载器。

三条最高工作原则见 `CLAUDE.md` 顶部：① 先看清全貌再动手、修框架不打补丁；② 引擎只守恒，不判断合理性；③ 缺数据靠 LLM 生成一次 + 引擎固化，别造兜底公式。
