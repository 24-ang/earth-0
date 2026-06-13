# earth-0 完整设计回顾

> 终端文字游戏。核心对标：**博德之门3偷窃 + 模拟人生建造换装 + GTA/辐射开放世界感**。
> 同人/动漫/小说作品 → pi 终端文字游戏。

---

## 整体架构

```
data/（静态事实）→ engine/（查改状态）→ LLM（叙事）
```

### 关键原则

- **角色不写死行为规则**，用状态值（信任度/好感度）驱动有机变化
- **数据全存 engine**，LLM 按需查询，不塞满 prompt
- **反上帝视角**：玩家看到的 = 当前位置 + 当前时间 + 当前身份能知道的事
- **TUI 命令 = engine 直读**，零 LLM token
- **不要重型 pipeline**，不要独立 NPC Agent（手机端跑不动）
- **引擎用 TypeScript**，JSON 读写，零编译

### 技术路线

- **转换**：Tavern2Agent（SillyTavern 角色卡 → pi 项目，一次性）
- **引擎**：pi 原生 engine（JSON 读写，零编译）
- **不用**：AIRP（手机编译不现实）、ST 状态栏 HTML（丢弃）

---

## 一、核心引擎 (`engine/`)

所有引擎代码在 `engine/` 目录下，共 7 个文件，总约 1200 行。

### 1. `engine/types.ts` — 类型定义（~190行）

这是整个项目的类型基础。所有接口都在这里定义。

#### 六维属性（1-20）

```
力量 / 敏捷 / 体质 / 智力 / 感知 / 魅力
```

设计考虑：
- 范围 1-20，对标 D&D 但简化（无种族/职业修正）
- **小孩可以高于大人**（如山东小孩力量 12），不套现实
- `AGE_ATTR_RANGE` 年龄基准表仅用于**创建 NPC 时的参考范围**，不影响运行时
- 属性调整值 = (属性 - 10) / 2 向下取整（标准 d20 公式）

#### HP = CON × 2 + 年龄层级

- 0 HP = 倒地，进入死亡豁免
- 死亡豁免：3 失败 = 死，3 成功 = 稳住（DC 10）
- **LLM 不报数字**，只说"他受了重伤"/"他站不住了"

#### AC = 10 + 敏捷调整值 + 防具加成

- 不堆叠同类型加成（最高生效）
- 天然护甲（如怪物厚皮）和装备护甲取最高

#### 负重 = STR × 6.8 kg

设计来源：D&D 5e STR×15 lbs ≈ STR×6.8 kg
- 超过 60% → 移动速度减半 + DEX 劣势
- 超过 100% → 不能跑
- 物品带有 `weight`(kg) 字段

#### 技能系统（动态创建）

- 不预设技能列表
- `addSkillExp(name, amount)` 自动创建技能
- Lv 1-10，升级阈值 = Lv × 10（如 Lv1→2 需要 10EXP）
- 引擎只管数值，LLM 叙事时用技能名

#### 装备槽（11个）

```
inner_top | inner_bot | top | bottom | legs | feet | head | acc | left_hand | right_hand | back
```

设计考虑：
- 服装也是装备，走同一套模型（不区分服装系统 vs 装备系统）
- 内衣/内裤算独立槽位（Layer1 相关）
- 武器槽 = left_hand / right_hand

#### 物品状态（3档）

```
intact → damaged（效果减半）→ ruined（全失）
```

设计考虑：
- 品质不写"精良/普通/劣质"，用 **flavor 文字**描述
- 例：棒球棍 "握柄磨得发亮，刻着甲子园"
- flavor 只在 `/look item` 时显示，不注入每轮上下文（省 token）

#### 关系系统

```
主线：陌生 → 熟人 → 友人 → 信赖 → 至交/死敌
恋爱线：暧昧 → 恋人 → 灵魂伴侣
```

- 来源：New World (2) 世界书的七阶段关系模型
- `affection` 值 0-100，引擎自动推进（不依赖LLM判断）
- 关系阶段由 affection 阈值自动触发

#### 身体数据（BodyMeasurements）

```
height_cm / weight_kg / build / measurements(bust/waist/hips) / cup / leg_type
body_shape(chest/hips/waist) / skin(base_tone/tan/texture)
diet / exercise / plastic_surgery[]
```

设计考虑：
- `build` 用"纤细/标准/结实/丰满/偏胖"，不是数字
- `cup` 是可选字段（小学生不写，除非设定早发育且≥12岁）
- `skin` 包含晒黑程度（tan，float 0-1）
- `plastic_surgery` 数组记录整形改动（一次性事件，之后固定）

#### Layer1 性欲模块

系统完整但**默认关闭**，通过 `toggle_layer1` 工具开关。

```
SexProfile:
  baselineDesire / attitude / experience
  bodyParts: { 部位: sensitivity(1-10), development(0-4), preference }
  cycleDay / climaxThreshold / likes[] / dislikes[]
  
  性器官（启用才注入LLM）：
    female: breast / vagina / pubic_hair / clitoris
    male: penis / testicles / pubic_hair
```

设计考虑：
- 关闭时 sex 相关字段完全不注入 LLM prompt（零 token 负担）
- 开启后 engine 算数值，LLM 只收**一句话描述**（如"她呼吸急促，脸颊泛红"）
- `experience` 分 4 级：未开发 → 生涩 → 熟练 → 深度开发
- 部位 `development` 0-4 级，不同级解锁不同体感/体位
- 生理周期（月经/安全期/排卵期）影响对话和情绪

#### 心里话（Thought）

```
{ text: string(30token内), timestamp, context }
```

- 每次 Sex 结束后 LLM 生成一句
- engine 存 `thoughts[]` 历史
- **不要**角色特有元素模板（用户纠正：不要固定"潘先生"、"小宝宝房间"等台词模板）
- 心里话 prompt 文件：`心里话需求-给AI的prompt.txt`

#### 事后结算（SettlementReport）

```
{ duration_minutes, climaxCount, squirtCount, partsGrowth, rating(SSS~C), thoughts[] }
```

- `/sex history` 可翻历史
- TUI 面板显示（不给 LLM，零负担）

#### 多维声望

```
reputation: Record<string, number>  // 键=圈子组名，值=-3~+5
```

圈子分类（已设计但部分待实现）：
- 日常：总武高学生 / 教师 / 邻里 / 商店街 / 家庭
- 灰色：不良圈子 / 暗网 / 赌场 / 夜店
- 官方：警察 / 学校行政 / 市政府
- level 影响对话选项解锁和 NPC 初始态度
- 秘密不自动跨圈传播（除非有目击者）

#### 棋盘格空间系统

```
CellData: type(floor/wall/door/exit/stairs) / block / furniture / label / isOpen
RoomGrid: width / height / cellSize / floor / cells[][] / atmosphere / horizon / ambient
MoveResult: success / newX / newY / newRoom / blocked / reason / distance / seconds
```

设计考虑：
- cellSize 按房间类型变化：教室 1m，操场 5m，街道 10m
- `horizon` 四方向远景描述（"远处能看到东京湾"）
- `ambient` 环境音/视觉（"蝉鸣"、"风吹树叶"）
- `outsideView` 窗户外景
- `faces` 窗户面对的房间名（跨节点感官渗透用）

#### GameState（顶级状态）

```
{
  time, weather, player, npcs: Record<string, NPCRuntimeState>,
  mode("gal"/"rpg"/"sex"), layer1Enabled, auMode,
  flags, turn
}
```

- `mode` 三模式切换，影响注入 LLM 的叙事规则
- `auMode` 控制魔改角色（AU）可见性
- `flags` 通用键值对，控制 IF 线 / 世界标记
- `npcs` 是懒初始化——只存被访问过的 NPC（不是预加载全员）

---

### 2. `engine/state.ts` — 状态引擎（~430行）

引擎的核心，所有状态读写都经过这里。

#### 核心函数

**`buildStatePrompt()`** — 组装每轮注入 LLM 的状态简报

这是整个系统提示词注入链路的关键节点。它做四件事：
1. 调用 `lookupRegion` 懒初始化当前位置的 NPC
2. 过滤在场 NPC（同 location 的）
3. 生成状态简报（时间、天气、位置、在场角色、玩家状态）
4. 附加工具使用纪律（告诉 LLM 什么场景用什么工具）

曾经出过的 bug：这个函数虽然写好了但从未被调用——因为没有 `before_agent_start` hook。后来在 extension.ts 里加了钩子才修好。

**`updateNPCSchedules()`** — NPC 日程更新

三级优先级：
1. `pendingOverride`（一次性最高优先级：生病/约定/逃课）
2. `scheduleOverrides`（角色专属覆盖：侍奉部/社团活动）
3. `schedule_group_by_age` → `schedule_templates.json`（全局模板）

按 `time_of_day` 变化触发（morning/lunch/afternoon/evening/night）

**`getOrCreateNPC(name)`** — 单个 NPC 懒初始化

只在 LLM 需要和某个角色交互时才创建。从 `characters.json` 读取静态数据，生成运行时状态（位置、装备、日程模板等）。

**`lookupRegion(location)`** — 地区路由

三层匹配：
1. 学校名精确匹配（如 "总武高"）
2. parent 城市级（如 "千叶市"）
3. 宽泛兜底

依赖 `router.ts` 的 `lookupRegion()` 和 `school_map.json`。

曾出过的 bug：学校走廊/楼梯间不在 `school_map.json` 中 → lookupRegion 返回空 → 0 个 NPC 创建。后来补了走廊和楼梯间房间。

**`movePlayer(direction) / moveTo(x, y)`** — 棋盘格移动

- 方向移动走一步（北/南/东/西）
- 坐标移动走直线逼近（路径碰撞检测）
- 墙阻挡、门（关门阻挡/开门通过）

曾出过的 bug：NPC 跨房间移动被"无直连出口"阻断。移除了该限制，NPC 允许在没有直连出口时瞬移（MVP 阶段比实现 BFS 路径寻路更实际）。

**`stealFromNPC()`** — 偷窃

引擎从 NPC inventory 移除物品→玩家背包。已实现。

**`monthlyGrowth()`** — 生长发育结算

饮食倾向 + 运动倾向 → 微调身高/体重/三围。有基因天花板（不无限增长）。

**`refreshWeather()`** — 天气刷新

每 4 个 turn 刷新一次。从四季 pool 随机抽取。温度有 `temp` 字段。

#### 状态持久化

- `loadState()` — 从 `state/session.json` 恢复
- `saveState()` — 写入 `state/session.json`

重要：CJS `require` 解构的 `gameState` 是快照，`loadState()` 替换模块变量不会更新该引用。ESM `import` 的 live binding 能正确反映更新。

---

### 3. `engine/dice.ts` — d20 系统（80行）

#### 核心公式

```
d20 + 属性调整 + 技能Lv ≥ DC
```

#### DC 五档

| 难度 | DC | 示例 |
|------|-----|------|
| 简单 | 8 | 正常对话、基础观察 |
| 普通 | 12 | 说服、搜索、爬墙 |
| 困难 | 16 | 说谎、开锁、潜行 |
| 极难 | 20 | 大师级技能 |
| 传奇 | 25 | 超越人类极限 |

#### 优劣势

- 优势：双骰取高
- 劣势：双骰取低
- 天然 20 = 大成功（无论 DC 多高）
- 天然 1 = 大失败

#### 攻击检定

- 攻击骰 vs AC
- 命中 → `damageRoll(weaponDice) + STR调整 - 减伤`
- `attackRoll()` 函数含掩体规则：
  - 半掩 = 攻击有劣势
  - 全掩 = 不可瞄准

#### 死亡豁免

```
DC 10，无调整值
3 成功 = 稳住
3 失败 = 死
```

---

### 4. `engine/combat.ts` — 战斗系统（223行）

#### 攻击流程

```
攻击方声明目标 → 骰 d20 + STR/DEX调整 + 格斗技能Lv ≥ 目标AC
→ 命中 → 武器伤害骰 + STR调整 - 目标减伤
→ 扣 HP → HP≤0 时进入死亡豁免
```

#### 等级碾压

- 攻击方 STR 与目标 STR 差 ≥ 10 → 不用骰，直接致命一击
- 例：龙珠角色对普通人

#### 掩体

- 半掩（矮墙/桌椅后）：攻击有劣势
- 全掩（墙后/门后）：不可被瞄准，需绕路或破坏掩体

#### 其他行动

- `defend()`：防御姿态，AC+2，持续到下一轮
- `attemptFlee()`：DEX 检定，成功则逃离战斗
- `makeDeathSave()`：单次死亡豁免掷骰

#### 武器设计规则

- 武器改规则，不堆数字
- 例：拳套（不能偷窃）/ 长枪（2格攻击距离）/ 匕首（潜行优势）
- 伤害骰：`1d4`(小刀) ~ `2d6`(大剑)

---

### 5. `engine/time.ts` — 时间系统（115行）

#### 核心设计

时间轴从**出生**到**死亡**，玩家和 NPC 年龄同步推进。

```
timeline_origin = { year: 1998, age: 6 }
→ NPC 年龄 = 当前年 - 1998 + 6
```

曾出过的 bug：`timeline_origin` 原为 `{year:1992, age:0}`，导致 NPC 年龄偏移（雪乃算成 22 岁而非 16 岁）。修正后正确。

#### 时间推进

- `advanceMinutes(minutes)` — 推进行分钟。内部计算跨天，自动推导 `time_of_day`
- `minute_of_day`（0~1439）为核心字段
- 按时段映射：morning(6:00-11:59) / lunch(12:00-12:59) / afternoon(13:00-17:59) / evening(18:00-21:59) / night(22:00-5:59)

曾出过的 bug：`commit_turn` 原本只推进日期，不改变 `time_of_day`，导致子日 NPC 日程迁移不触发。引入 `minute_of_day` + `advanceMinutes()` 体系后才修好。

#### 玩家阶段

```
幼儿(0-5) → 小学(6-11) → 中学(12-14) → 高校(15-17) → 大学(18-21) → 社会人(22-44) → 中年(45-64) → 老年(65+)
```

---

### 6. `engine/router.ts` — 地区路由（76行）

#### 三层匹配

1. **学校名精确匹配**：查 `school_map.json` 房间列表，找对应学校
2. **parent 城市级**：查 `city_map.json` 区域列表
3. **宽泛兜底**：直接查 `regions.json` 键名

#### 动态构建

`getSchoolRooms()` 是函数而不是静态 Set。原因：`school_map.json` 更新后，模块缓存的 Set 不会自动刷新。改为每次调用动态构建。

#### 路由到角色

地区路由成功后 → 查 `regions.json` 中该地区的角色列表 → 逐一 `getOrCreateNPC()` 创建。

---

### 7. `engine/sex.ts` — Layer1 性欲模块（409行）

默认关闭。不启用时所有字段不注入 LLM。

#### 运行时数据

```
SexState:
  desire(0-100) / arousal(0-100, 实时) / cycleDay(1-28) / cyclePhase
  climaxed / climaxCount / squirtCount / thoughts[]
```

#### 核心函数

**`touchBodyPart(profile, state, part, intensity)`**

按部位+强度返回反应：
- 唇/颈/胸/腰/腿/秘部/肛
- intensity: gentle/normal/rough
- 返回：reaction 描述 + arousalChange + 是否高潮

**开发度系统**

每个部位 `development` 0-4 级。
- Lv0：未开发（碰什么都不舒服）
- Lv4：深度开发（解锁全部体位和反应）

**`recordThought(profile, text)`** — 心里话存储（L3）
**`getThoughtsSummary()`** — 心里话摘要（L2）
**`settleAfterSex(state, profile)`** — 事后结算（L1）

结算内容：
- 用时、高潮次数、潮吹次数
- 部位成长（随机提升 ≤2 个触及部位的 development）
- 评级 SSS~C（基于高潮次数 + 部位开发度）
- 心里话
- 重置 arousal 和 climax 状态

**`getAvailableActions(positionDB)`** — 接 `positions.json`

按 phase(caress/service/insertion) + 开发度过滤可用体位。

#### 自慰系统

NPC 自主行为（不依赖玩家）。引擎随机触发，消耗欲望值。

#### 性器官数据

启用时才注入 LLM。不启用时不占 prompt。

---

## 二、数据文件 (`data/`)

所有数据存 JSON，零数据库。

### `data/characters.json` — 角色数据库

每个角色包含：
- `name / gender / base_age` — 基础信息
- `body` — 默认身体数据
- `body_by_age` — 多档位身体数据（6岁/12岁/15岁/18岁+），引擎按 NPC 当前年龄取最近档位
- `attributes` — 六维（从世界书性格推理，不拍脑袋）
- `skills` — 初始技能
- `sex_profile` — 引用 `sex.ts` 中的 `SEX_PROFILES` 键名
- `anchors` — 私密信息/情感锚点（来自世界书 background/relationships）
- `appearance_brief` — 外貌简述（来自世界书，20字以内）
- `default_location / schedule_group_by_age / scheduleOverrides` — 位置和日程

**当前约 21 个角色**：雪乃/结衣/八幡/彩加/小町/陽乃/平冢静/绫乃/大志/真绫/佑/翔太/綾乃/京香/结花/小春/海梦/円香/透/詩織

### `data/character_stages.json` — 角色人生阶段描述

核心原则：**每个阶段只写该年龄该知道的事，不预知未来。**

每个角色 4 段：
```
幼儿_小学 → 中学 → 高中 → 成年
```

- 手写描述（不是自动生成）
- 引擎每轮按 NPC 当前年龄动态注入对应阶段
- IF 线内容用 `{name}_if` 隔离，通过 flags 触发

### `data/regions.json` — 地区角色路由（111条）

```
键 = 作品名 / 地区名
值 = { characters: [{name,base_age,location}] }
```

来源：`_🤖动漫角色目录.json` 世界书

### `data/school_map.json` — 总武高完整地图

```
school: "千叶市立总武高等学校"
buildings:
  教学楼: { floors:3, rooms:{ 1F:[...], 2F:[...], 3F:[...] } }
  社团楼: { floors:1, rooms:{ 1F:[...] } }
  体育馆: ...
```

包含走廊和楼梯间（曾缺失→导致 NPC 懒初始化失败→已修复）

### `data/city_map.json` — 千叶市分区

```
regions:
  稻毛区: { landmarks:[...], stations:{...} }
  海滨幕张: { ... }
  千叶中央: { ... }
```

含电车线路和时间（待实现实际跨区行驶逻辑）

### `data/rooms.json` — 16个房间棋盘格

```
每个房间:
  width / height / cellSize(1m~5m)
  floor / atmosphere
  cells: CellData[][] (墙/门/窗/家具/出口)
  horizon: { 北/南/东/西: 远景描述 }
  ambient: { audio, visual }
  outsideView: 窗户外景描述
```

当前房间：校门、操场、中庭、体育馆、社团楼、侍奉部、教室(2年F班/2年J班)、走廊、楼梯间等。

### `data/schedule_templates.json` — 日程模板

```json
"总武高学生": {
  "weekday_morning": "2年F班",
  "weekday_lunch": "中庭",
  "weekday_afternoon": "社团活动",
  "weekday_evening": "千叶_住宅区"
}
```

模板类型（7+个）：学生/教师/运动部/不良/店员/社团部员/自由人/上班族

曾出过的 bug：模板用泛名（"教室"/"高校"）→ rooms.json 无匹配 → NPC 永远留在 default_location。修复：全部换成实际房间名。

### `data/items.json` — 物品库（305行）

分类：weapon / armor / clothing / tool / consumable

每个物品含：name / type / slot / weight / effects[] / flavor

effects 类型：
- `damage_reduction` — 减伤
- `attribute_bonus` — 属性加成
- `social_bonus` — 社交加成（CHA+1 等）
- `reputation_bonus` — 声望加成（穿校服→学生圈+1）
- `pocket` — 口袋（增加携带容量）
- `cold_resist` — 抗寒

### `data/positions.json` — 体位百科（17个）

```json
{
  "name": "正常位",
  "phase": "insertion",
  "devRequired": 0,
  "scene": ["bed", "floor"],
  "tags": ["基本", "面对"],
  "desc": "..."
}
```

按 phase(caress/service/insertion) + 开发度解锁。肛交需开发≥2且好感高。

### `data/world_rules.json` — 世界观规则

```
骰子: d20+DC、关系七阶段+恋爱线、六维1-20
```

### `data/shops.json` — 商店数据

物品列表 + 价格。`buy_item` / `sell_item` 工具用。

### `data/locations.json` — 日本地理

城市/区域坐标。

---

## 三、Agent 提示词系统 (`agents/`)

### 文件列表

| 文件 | 作用 |
|------|------|
| `gm-pre.md` | GM 开场白、世界背景概述 |
| `gm-rules.md` | 完整硬规则（骰子/战斗/偷窃/交涉等所有系统规则） |
| `gm-contract.md` | 输出合同（叙事风格/格式/口吻约束） |
| `gm-state.md` | 状态简报模板（含 `{{weather}}` 等变量占位符） |
| `gm-mode-rpg.md` | RPG 模式叙事规则（战斗/冒险/SL） |
| `gm-mode-gal.md` | GAL 模式叙事规则（恋爱/日常/事件） |
| `gm-mode-sex.md` | Sex 模式叙事规则（亲密互动） |
| `preset.json` | prompt 模块配置（定义组装顺序和模板层） |

### 组装链路

```
gm-pre → gm-rules → gm-contract → buildStatePrompt() → gm-mode-{mode}
```

在 `extension.ts` 的 `before_agent_start` hook 中完成组装，每轮都重新生成（状态简报会变化）。

### 心里话生成规则

LLM 生成心里话的 prompt 规则已写入 `gm-mode-sex.md`。但用户明确要求：
- **不要**角色特有元素模板（潘先生/猫/小宝宝房间/热牛奶等）
- 用角色方式说话即可
- 可爱优先

更详细的需求 prompt 在 `心里话需求-给AI的prompt.txt`。

### 认知隔离

4 个 NPC subagent 文件在 `.pi/agents/`：
- `yukinoshita.md` — 雪之下雪乃
- `yuigahama.md` — 由比滨结衣
- `hikigaya.md` — 比企谷八幡
- `kitagawa.md` — 喜多川海梦

这些 subagent 是**年龄中立**的——只写核心性格，不写具体时间线信息。人生阶段信息在 `character_stages.json` 中，由引擎按当前年龄动态注入。

### 文风系统

- 用 pi Skills 做文风，不塞在世界书/JSON 里
- 直接用名著作家名（海明威、村上春树、托尔斯泰等），LLM 训练数据里有
- 不在 JSON 里手写风格描述（效果差且占 token）
- 按场景切换：战斗用海明威、心理用村上、群像用托尔斯泰

---

## 四、扩展系统 (`extension.ts`)

所有 LLM 工具和 TUI 命令都在这里注册。

### LLM 可调工具（26个）

按功能分组：

**核心查询**
- `lookup_character` — 查询角色属性/身体/装备
- `lookup_region` — 查询当前位置关联的角色
- `get_status` — 获取玩家/NPC 状态
- `dice_roll` — d20 检定

**状态修改**
- `patch_state` — 改好感/移物品/换位置/加技能
- `commit_turn` — 推进时间（分钟），触发 NPC 日程更新
- `set_flags` — 设世界标记（IF 线切换）

**交互**
- `sex_touch` — 触碰部位（Layer1 启用时才生效）
- `combat_action` — 攻击/防御/逃跑
- `steal_item` — 从 NPC 偷东西
- `equip_item` — 装备/卸下物品

**空间**
- `move` — 棋盘格方向移动
- `move_to` — 棋盘格坐标移动
- `build_add` — 建造物品
- `build_remove` — 拆除物品
- `door_toggle` — 开关门

**社交/NPC**
- `update_reputation` — 更新声望
- `schedule_override` — 临时覆盖 NPC 日程

**经济**
- `buy_item` — 购买
- `sell_item` — 出售
- `monthly_growth` — 月末发育结算

**模式**
- `toggle_layer1` — 开关性欲模块
- `toggle_aumode` — 开关魔改角色

### TUI 命令（12个）

这些命令直接读 engine 数据，不经 LLM，零 token 消耗：

| 命令 | 功能 |
|------|------|
| `/status` | 查看玩家完整状态（属性/HP/身体/装备） |
| `/look <名>` | 查看角色或物品详情 |
| `/party` | 查看队伍成员 |
| `/inventory` | 查看背包和装备 |
| `/map` | 同层房间连接图（▶当前位置 + NPC房间分布） |
| `/go` | 出行菜单（步行/骑车/电车） |
| `/room` | 当前房间信息（大小/层数/氛围） |
| `/area` | 校园地图（建筑列表，选择前往） |
| `/city` | 千叶市地图（仅显示已探索） |
| `/relations` | 查看所有 NPC 关系 |
| `/sleep` | 睡觉 +1天 + 回满血（需在家） |
| `/save` | 存档（需在安全地点） |
| `/known` | 已探索地点列表 |

### 生命周期钩子

```
session_start:
  loadState() → buildStatePrompt() → saveState()
  （懒初始化 NPC，确保恢复旧存档时补上）

before_agent_start:
  组装完整 GM 提示词
  gm-pre → gm-rules → gm-contract → buildStatePrompt → gm-mode-{mode}

session_shutdown:
  saveState()
```

### 曾出过的关键 bug

1. **`buildStatePrompt()` 存在但从未被调用** — 没有 `before_agent_start` hook → GM 系统提示词完全缺失 → LLM 以代码助手口吻回复而非 GM 口吻
2. **CJS require 解构快照问题** — `require` 解构的 `gameState` 是快照，`loadState()` 后不更新 → 需注意引用方式
3. **日程模板泛名不匹配** — "教室"vs"2年F班" → rooms.json 无匹配 → NPC 永远不动
4. **走廊/楼梯间未录入 school_map.json** — lookupRegion 返回空 → NPC 懒初始化链路断裂
5. **跨房间移动被"无直连出口"阻断** — 移除此限制，NPC 允许瞬移（MVP 更实际）
6. **`timeline_origin` age=0** — NPC 年龄计算偏移（16→22）

---

## 五、角色转换系统（Tavern2Agent）

把 SillyTavern 角色卡/世界书转换为 earth-0 数据。

### 源头世界书

1. `New World (2).json` (1MB) — 主要规则和角色数据
2. `！💾⭐动漫角色百科.json` (1.3MB) — 动漫角色详情
3. `_🤖动漫角色目录.json` (394KB) — 角色路由目录

### 完整转卡步骤（v4）

```
1. 审计 — 读世界书 enabled 条目，列 key/comment/摘要
   → 只看 disable:false，不读禁用的条目和世界书
   → 多本世界书时每本分别审计

2. 身材审计 — 逐条提取身高/cup/三围/体型/发色瞳色
   → 多本世界书有冲突时列表对比，融合取中
   → ⚠️ 最容易漏的一步！橘家母女就是教训

3. 日程审计 — 提取原作日程/学校/职业
   → 学生年龄→匹配小学生/中学生/高校生模板
   → 成人→匹配上班族/教师/自由人
   → 特殊行程（侍奉部）→留空，由GM动态设

4. 分类写入：
   ├─ 身材/外貌 → characters.json body + body_by_age
   ├─ 属性/技能 → characters.json attributes/skills
   ├─ 性格/经历 → character_stages.json（4阶段，不混入未来）
   ├─ 私密/情感 → characters.json anchors
   ├─ 日程 → schedule_group_by_age（走全局模板）
   ├─ 性数据 → sex.ts SEX_PROFILES（cup必须和body一致！）
   ├─ 地区注册 → regions.json（确认条目存在，无则补）
   ├─ IF线内容 → character_stages 的 {name}_if 版本
   └─ 丢弃 → 宏/HTML/淫乱版设定/禁用条目

5. 写入后验证清单：
   □ body cup 和 sex_profile cup 一致
   □ body_by_age 各档位递增合理
   □ 小学生档位无 cup（除非≥12岁早发育）
   □ stages 无预知信息
   □ schedule 走全局模板
   □ appearance_brief/anchors 来自世界书
   □ attributes/skills 符合角色设定
   □ regions.json 已注册
   □ 角色总数 +1
```

### 常见错误

- ❌ 跳过身材审计直接写 body（cup/身高对不上世界书）
- ❌ sex_profile cup 和 body cup 不一致
- ❌ stages 里混入未来信息（如"收养佑之后"出现在高中阶段）
- ❌ schedule 写死学校名但角色还是小学生
- ❌ appearance_brief 凭记忆写（不查世界书）
- ❌ 新角色忘加 regions.json
- ❌ 读禁用的世界书条目

### 已转换作品

- 春物：雪乃/结衣/八幡/彩加/小町/陽乃/平冢静/绫乃/大志(AU)
- 如月家：真绫/佑/翔太/綾乃
- 橘家：京香/结花/小春（+橘家IF线）
- 更衣人偶：海梦
- 偶像大师SC：円香/透（+青梅IF线）
- 原创：詩織

---

## 六、空间系统设计

### 四级地图

| 级别 | 命令 | 功能 |
|------|------|------|
| `/room` | 棋盘格微地图 | 当前位置的 ASCII 网格，含 NPC/门/窗/家具 |
| `/map` | 同层房间连接图 | 当前位置高亮 + 该层各房间 NPC 分布 |
| `/area` | 校园宏观地图 | 建筑列表 + 楼层，可导航 |
| `/city` | 千叶城市地图 | 已探索区域 + 地标，可跨区导航 |

### 棋盘格核心

- cellSize 1m~5m（教室1m、操场5m、街道10m）
- 地板/墙/门(maxHeight)/楼梯(上下楼)/家具
- 门：`isOpen` → 大写 DR 关 / 小写 dr 开 + block 联动
- 路径碰撞：`moveTo` 直线逼近 + 障碍检测

### 远景与感官

- `horizon` — 四方向远景（如"南边能看到东京湾"）
- `outsideView` — 窗户外景描述
- `ambient` — 环境音/视觉（蝉鸣、风吹、远处喧哗）
- `faces` — 窗户面对的房间名（跨节点感官渗透）

### 建造

- `build_add` — 建造物品（简单的如椅子、桌子）
- `build_remove` — 拆除
- 建造后动态标签 4 级降级注册

### 宏观名册

`school_map.json` 防无限画廊——房间列表有限，不会让 LLM 无中生有造房间。

---

## 七、NPC 系统设计

### 日程系统

每个 NPC 有三个层级的日程控制：

1. **`schedule_group_by_age`** — 全局模板（按年龄自动切换）
   - 例如 `{ 6: "小学生", 12: "中学生", 15: "总武高学生", 18: "大学生" }`
2. **`scheduleOverrides`** — 角色专属覆盖（如 `weekday_afternoon: "侍奉部"`）
3. **`pendingOverride`** — LLM 设置的临时最高优先级（生病/约定/逃课），有过期时间

### 碰面检测

玩家进入房间 → engine 扫同室 NPC 列表 → 注入 GM 上下文：谁在场、在做什么、状态如何

### 后台事件

NPC 日程重叠 → 检测共同熟人/关系 → 生成社交事件（标记交换、好感变化）

### 记忆标签

NPC 之间自动传染标签（如"这人偷我钱包"），3 天过期。影响 NPC 对玩家的态度。

### 公共路人

走廊/中庭随机填充路人（带随机属性标签），不持久化（不存进 session.json）。

### 认知隔离

- 4 个 NPC subagent（年龄中立，只写核心性格）
- 人生阶段信息从 `character_stages.json` 按年龄动态注入
- NPC 只知道各自该知道的信息

---

## 八、经济与成长系统

### 经济

- 货币：日元 ¥，2010 年千叶物价水平
- `buy_item` / `sell_item` → LLM 定价，engine 校验
- `workJob` — 打工（便利店/家教等，按千叶时薪）
- 商店数据在 `shops.json`

### 服装声望联动

- 穿校服 → 学生圈 reputation +1
- 穿特定服装 → 相关圈子反应

### 生长发育

- `monthly_growth()` — 月末结算
- 饮食(diet) + 运动(exercise) → 微调身高/体重/三围
- 有基因天花板（不无限增长）
- 整形是一次性事件，之后固定（`plastic_surgery[]`）

### 天气系统

- 四季 weather pool
- 每 4 turn 随机刷新
- `temp` 温度字段
- 影响 NPC 对话和行为（"天气真冷啊"）

### 服装尺寸匹配（已设计未完全实现）

身体尺寸 vs 衣服尺寸，每个部位单独比较：
- 太紧 → CHA -1
- 穿不下 → 不能装备

---

## 九、版本路线图

```
v0.1 ✅ 核心引擎
  六维/骰子/战斗/HP/AC/负重/偷窃/装备/Layer1性欲/Sex/心里话
  棋盘格空间/三级地图/门窗/建造/远景/环境音/快速移动

v0.2 ✅ 沙盒自然运转
  NPC日程/碰面/后台事件/声誉系统/认知隔离/路由三层
  经济/发育/天气/服装声望/跨节点渗透/城市地图/学校名册

v0.3 待做
  身份检定/伪装（d20+魅力 vs DC）
  电车跨区移动逻辑
  平冢静 NPC
  更多房间网格（商店街/千叶站/体育馆内部）
  更多路人类型
  更多日程模板（主妇/医生/警察/NEET/退休老人/艺人等） ← scratchpad 待办

v0.5 城市级
  城市分区（独立地图）
  交通网络（电车站枢纽/跨区移动/末班车）
  财富特权（私家车/直升机/私人房产）

v1.0 完全体
  更多作品角色/地区（东京秋叶原/京都/大阪）
  赛季事件（学园祭/修学旅行/过年）
  多层生活模拟（打工/升学/结婚/买房/育儿）
```

---

## 十、待实现系统（已充分讨论）

### 称号系统

- 跨全部模块，engine 自动判定条件授予
- 存 `titles[]` 数组
- 每轮注入 LLM（~10 token）
- NPC 可反应称号
- 示例：年级第一/格斗初心者/神偷/一拳超人/后宫王/处刑人/浪子回头

### 声誉系统

- 分圈子，每组独立 level(-3~+5)+trend+known
- 代码层面 `Reputation: Record<string,number>` 已预留
- `update_reputation` 工具已可用
- 圈子分类已有：学生/教师/邻里/商店街/家庭/不良/警察/行政
- level 影响对话选项解锁、NPC 初始态度
- 秘密不自动在圈间传播（除非有目击者）
- 未来叠加：咒术圈/魔术协会/圣杯战争关系者/龙珠战士等

### 跨节点感官渗透

- 窗户的 `faces` 字段指向目标房间
- 玩家经过窗户 → 可听到/看到目标房间的实时 ambient
- 例：走过走廊时听到教室里的讲课声、操场传来的喧哗

### 身份检定/伪装

- d20 + 魅力 vs DC
- 服装标签可覆盖（穿校服=被当学生、穿制服=被当警察）

### 时间线事件系统（scratchpad 待办）

- `data/timeline.json` 按日期触发角色事件（入学/搬家/死亡）
- 作品剧情（侍奉部创立等）
- 引擎到点注入 GM context
- 让 LLM 不需要背原作剧情

### 工具纪律映射表（scratchpad 待办）

- `gm-state.md` 工具纪律只提了 6 个
- 其余 20+ 个工具（steal/combat/build/door/economy/etc）LLM 可能跳过引擎直接叙事
- 需要扩展工具纪律映射表

---

## 十一、AI 协作经验教训

1. **心里话等创意文本**：Claude 不适合写微妙创意文本。用 Gemini/Claude 官网直接对话 → 拿回结果后 pi agent 工程化接入。需求 prompt 文件在 `心里话需求-给AI的prompt.txt`。

2. **角色 prompt 时空混乱**：所有 subagent 改为年龄中立，人生阶段信息通过 `character_stages.json` + 引擎按年龄动态注入。不能把全部时间线信息揉在一个文件里。

3. **日程模板必须匹配实际房间名**：泛名（"教室"）→ rooms.json 无匹配 → NPC 永远不动。

4. **走廊/楼梯间也是房间**：不录入 school_map.json → lookupRegion 返回空 → 0 NPC。

5. **跨房间移动允许瞬移**：MVP 阶段比 BFS 路径寻路更实际。

6. **`timeline_origin` 的 age**：设 0=年龄计算全错。正确做法是设初始年龄（如 6）。

---

## 十二、文件清单

```
engine/
  types.ts        — 全部类型定义（六维/技能/物品/关系/身体/Layer1/棋盘格）
  state.ts        — 状态引擎（buildStatePrompt/日程/移动/偷窃/发育）
  dice.ts         — d20系统（检定/攻击/伤害/死亡豁免）
  combat.ts       — 战斗系统（攻击/防御/逃跑/死亡豁免/等级碾压/掩体）
  time.ts         — 时间系统（出生到死/分钟推进/子日时段）
  router.ts       — 地区路由（三层匹配/学校/城市）
  sex.ts          — Layer1性欲（欲望/高潮/心里话/体位/结算/自慰）

data/
  characters.json         — 角色数据库（21个角色，含body_by_age多档位）
  character_stages.json   — 角色人生阶段描述（4阶段，反上帝视角）
  regions.json            — 地区角色路由（111条）
  school_map.json         — 总武高完整建筑
  city_map.json           — 千叶市分区+电车
  rooms.json              — 16个房间棋盘格
  schedule_templates.json — 日程模板（7+个）
  items.json              — 物品库（武器/防具/工具/食物/服装）
  positions.json          — 体位百科（17个）
  world_rules.json        — 世界观规则
  shops.json              — 商店数据
  locations.json          — 日本地理

agents/
  gm-pre.md        — GM开场白/世界背景
  gm-rules.md      — 完整硬规则
  gm-contract.md   — 输出合同
  gm-state.md      — 状态简报模板
  gm-mode-rpg.md   — RPG模式叙事规则
  gm-mode-gal.md   — GAL模式叙事规则
  gm-mode-sex.md   — Sex模式叙事规则
  preset.json      — prompt模块配置

.pi/agents/
  yukinoshita.md   — 雪乃认知隔离（年龄中立）
  yuigahama.md     — 结衣认知隔离
  hikigaya.md      — 八幡认知隔离
  kitagawa.md      — 海梦认知隔离

extension.ts       — 工具注册+命令注册+生命周期钩子
start.sh           — 启动脚本

根目录
  PLAN.md          — 系统设计总览（本文的缩写版）
  REBUILD.md       — 重建计划（MVP步骤+Git工作流）
  TEST_LOG.md      — 测试记录
```

---

## 十三、当前技术状态

- **API 反代**：`api.meow61.my/v1`
- **推荐模型**：Claude Opus 4.6（最强RP）> Claude Sonnet 4.6 > Gemini 3.1 Pro
- **Git 分支**：`rebuild`
- **最近提交**：`682dad6`（系统提示词注入链路修复 + 日程模板适配 + NPC移动 + timeline修正）
- **当前会话状态**：玩家 16 岁男 @ 校门，周一 morning，NPC=0（等 session_start 懒初始化）
- **端到端验证**：早晨雪乃从稻毛小学校→2年F班；下午→侍奉部；八幡/结衣正确迁移 ✅
- **GM Prompt**：3683 字符，含世界规则+状态简报+在场列表+工具纪律 ✅
