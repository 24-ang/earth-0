# Earth-0 下一步工作计划

> 最后更新: 2026-06-14

---

## 分工总览

| 谁 | 做什么 | 文件 |
|----|--------|------|
| **Claude** | 叙事旅行系统 + 引擎建筑约束 + 测试 | engine/types.ts, engine/state.ts, extension.ts, test.ts |
| **Gemini** | GM规则更新 + 平冢静NPC + 更多路人 | agents/gm-rules.md, agents/gm-state.md, data/characters.json, data/character_stages.json, data/regions.json |

---

## 一、Claude：叙事旅行 `/go` + `/go skip`

### 1.1 新增 `PendingTravel` 类型 (`engine/types.ts`)

```ts
export interface PendingTravel {
  from: string;
  to: string;
  route: string;       // "步行" | "京叶线" | "公交" 等
  minutes: number;
  timeOfDay: string;   // "傍晚" | "上午" 等
}
```

加入 `GameState`，字段名 `pendingTravel: PendingTravel | null`。

### 1.2 改造 `/go` 命令 (`extension.ts`)

在 `runNavigation` 中，移动动作根据距离分级：

| 距离 | 行为 |
|------|------|
| 同层/同校（≤5分钟） | **直接移动**，不写 pendingTravel |
| 跨区（≥15分钟） | **不直接移动**。写 `pendingTravel` 到 state → saveState → 通知玩家"旅程已记录，GM 将叙述" |

关键：跨区移动不调用 `moveTo`，只写 `pendingTravel`。

### 1.3 新增 `/go skip` 命令 (`extension.ts`)

```ts
pi.registerCommand("go skip", { ... })
```

跟现在的 `/go` 完全一样，但**无论距离多远都直接移动**，不写 pendingTravel。用于玩家不想浪费 token 的时候。

### 1.4 新增 `complete_travel` LLM 工具 (`extension.ts`)

```ts
pi.registerTool({
  name: "complete_travel",
  description: "GM 完成通勤叙述后调用。引擎执行实际移动+时间推进，清除 pendingTravel。",
  parameters: Type.Object({ summary: Type.Optional(Type.String()) }),
  execute: async (params) => {
    // 1. 读 gameState.pendingTravel
    // 2. 调用 moveTo(pendingTravel.to)
    // 3. 调用 advanceTimeMinutes(pendingTravel.minutes)
    // 4. 清除 pendingTravel
    // 5. 返回确认信息
  }
})
```

### 1.5 `buildStatePrompt` 注入通勤上下文 (`engine/state.ts`)

如果 `gameState.pendingTravel` 不为 null，在 state prompt 中注入：

```
[通勤] 玩家正从{from}前往{to}
路线: {route}  预计耗时: {minutes}分钟  时段: {timeOfDay}
请叙述这段旅程。到达后必须调用 complete_travel 工具完成移动。
```

### 1.6 验收标准

- [ ] `/go` 选同层房间 → 直接移动，无 pendingTravel（现状不变）
- [ ] `/go` 选跨区目的地 → 不移动，写 pendingTravel，GM 收到通勤上下文
- [ ] `/go skip` 选任意目的地 → 直接移动 + 推进时间
- [ ] `complete_travel` 工具 → 移动玩家 + 推进时间 + 清除 pendingTravel
- [ ] 玩家自由叙事旅行不受影响（GM 可随时调 complete_travel）
- [ ] 测试 ≥ 3 个（pendingTravel 写入/清除/注入）

---

## 二、Claude：引擎建筑约束

### 设计原则：物理归引擎，经济归 GM

```
引擎只管物理事实:
  ✅ 背包里有没有这个东西？
  ✅ 施工要不要时间？
  ✅ 这个位置能不能放？

GM 管经济/世界观:
  ✅ 这个东西在废土值多少瓶盖？
  ✅ 现代日本买房要什么手续？
  ✅ 剑与魔法世界用什么材料？
```

引擎**永远不硬编码价格或材料名**。材料名由 GM 在 tool call 时传入，引擎只查背包里有没有。

### 2.1 `placeFurniture` 查背包 (`engine/state.ts`)

**改前**: 只检查坐标/墙上/门口/重复
**改后**: 增加——

```
// 物理约束：必须有实物才能放置
if (玩家背包中没有名为 itemName 的物品) {
  return { success: false, reason: `背包里没有${itemName}。需要先获取。` }
}
// 从背包扣除该物品
const idx = player.inventory.findIndex(i => i.name === itemName)
player.inventory.splice(idx, 1)
// 然后放置到网格...
```

**不查价格。** GM 决定物品怎么来的——购买（什么价格？什么货币？）、拾荒、偷窃、自制。引擎只看物理事实：背包里有没有。

### 2.2 `edit_map_cell` 加材料参数 (`engine/state.ts` + `extension.ts`)

LLM 工具签名新增 `material` 参数（可选）：

```
edit_map_cell(x, y, type, targetRoom?, material?)
```

| 操作 | 引擎物理约束 | GM 职责 |
|------|------------|--------|
| floor→wall | 背包必须有 `material` 指定的物品，扣除1个 | 决定材料名（砖/废铁板/魔法石），通过叙事让玩家获取 |
| floor→door | 同上，需要 `material` | 决定门框材料（木材/铁框/破木板） |
| floor→exit | 同上 + 必须指定 `targetRoom` | 决定通往哪里 |
| wall→floor | STR≥5 或 背包有 `material`（锤/镐/撬棍），扣除1个 | 决定拆墙需要什么工具 |
| wall/floor→stairs | 无材料要求 | 决定是否合理（多层建筑才可能有楼梯） |

**引擎不硬编码"砖"、"木板"、"¥5000"。** 废土世界用"废铁板"造墙、剑与魔法用"魔法石"——同一套引擎全支持。

`material` 为可选参数。造墙/门时如果不传 → 引擎拒绝（"缺少材料"）。拆墙时不传 → 默认检查 STR ≥ 5。

### 2.3 `create_room` 只加时间约束 (`engine/state.ts`)

```
// 引擎只检查:
if (房间名已存在) return 错误
if (width < 1 || height < 1) return 错误
if (width * height > 10000) return 错误  // 防止 LLM 恶意建巨型房间

// 物理约束：施工需要时间
时间推进 = width × height × 5 分钟

// 注册房间到 ROOMS[...]
```

**引擎不查钱、不查材料。** GM 根据世界观判断：
- 现代日本：有没有找承包商？有没有建筑许可？钱够不够？
- 废土：有没有清理废墟？有没有足够的人手？
- 奇幻：有没有魔法能量？有没有领地权？

GM 在叙事中处理这些，玩家满足条件后 GM 才调 `create_room`。

### 2.4 验收标准

- [ ] `placeFurniture` 背包无物品 → 拒绝，提示缺少实物
- [ ] `placeFurniture` 背包有物品 → 扣除 + 放置到网格
- [ ] 拆除家具不归还物品（引擎不知物品该不该归还，GM 可通过 `patch_state take_item` 单独处理）
- [ ] `edit_map_cell` 造墙不传 material → 拒绝
- [ ] `edit_map_cell` 造墙传 material="废铁板" 背包有 → 扣除 + 造墙
- [ ] `edit_map_cell` 造墙传 material="砖" 背包无 → 拒绝
- [ ] `edit_map_cell` 拆墙不传 material 且 STR<5 → 拒绝
- [ ] `edit_map_cell` 拆墙传 material="撬棍" 背包有 → 扣除 + 拆墙
- [ ] `create_room` 同名 → 拒绝
- [ ] `create_room` 时间正确推进
- [ ] 测试 ≥ 10 个，覆盖废土/现代/奇幻三种材料名

---

## 三、Gemini：GM 规则更新

### 3.1 `agents/gm-rules.md`

**新增章节：通勤系统**

```markdown
## 通勤系统

玩家可通过 `/go` 命令触发叙事旅行。当 state prompt 中出现 `[通勤]` 标记时：
- 你必须为玩家描写这段旅程（车厢场景、窗外风景、邻座人物、心理活动）
- 叙述结束后，**必须**调用 `complete_travel` 工具
- 如果你的叙述中有剧情发展（偶遇、事件），在调 complete_travel 前处理

玩家也可使用 `/go skip` 跳过叙事直接到达。此时 state prompt 中无 `[通勤]` 标记，你直接从新位置开始叙事。

玩家也可能直接说"我坐电车去千叶站"而不使用命令——此时你需自行调用 `move` 或 `move_to` 工具。
```

**更新：建造系统（物理归引擎，经济归 GM）**

将现有的"经济与建造"章节替换为——

```markdown
## 建造系统

引擎只执行物理检查，经济/物价/材料种类由你根据当前世界观判断。

### 引擎硬约束（不可绕过）

| 操作 | 引擎强制要求 |
|------|------------|
| 放置家具 | 玩家背包必须有同名实物。没有 → 引擎拒绝。 |
| 造墙/安门 | edit_map_cell 的 material 参数指定的物品必须在背包里。 |
| 拆墙 | 玩家 STR≥5 或背包有 material 参数指定的工具。 |
| 建新房间 | 自动推进施工时间（面积×5分钟），同名房间拒绝。 |

### 你的职责（世界观判断）

- **物品获取**：玩家如何获得"床"、"砖"、"门框"？由你根据当前世界决定——
  - 现代日本：去商店买（你设价格，你调 buy_item）
  - 废土：废墟里翻（你叙事发现，你调 patch_state give_item）
  - 奇幻：铁匠打造（你叙事制作过程）
- **材料名由你定**：edit_map_cell 的 material 参数你传什么，引擎就查什么。
  - 现代传 `"砖"`，废土传 `"废铁板"`，奇幻传 `"魔法石"`
- **创建房间的前置条件**：引擎只管时间和重名。钱够不够？材料够不够？
  位置合不合理？有没有建筑许可？——全部由你根据世界观判断。
  满足条件后再调 create_room。

**核心纪律**：引擎拒了就是拒了。不要绕过引擎直接叙事"你造好了墙"——
如果没有调 edit_map_cell，墙上就没有那堵墙。物理世界不会因为你的描述而改变。
```

**已存在的建造相关 section 删除"你可以创建房间"等鼓励 LLM 无中生有的文字。**

### 3.2 `agents/gm-state.md`（如果存在通勤相关内容则更新）

在状态简报模板中加通勤占位符说明。

### 3.3 验收标准

- [ ] gm-rules.md 含通勤系统章节
- [ ] gm-rules.md 含建造约束章节（准确列出每项引擎要求）
- [ ] 不包含鼓励 LLM 绕开约束的文字
- [ ] `/go skip` 和 `/go` 的区别已说明

---

## 四、Gemini：平冢静 NPC 数据

### 4.1 `data/characters.json`

新增角色条目。参考现有角色的字段结构：

```json
{
  "name": "平冢静",
  "gender": "female",
  "base_age": 25,
  "body": {
    "height_cm": 168,
    "weight_kg": 55,
    "build": "标准",
    "measurements": { "bust": 88, "waist": 62, "hips": 90 },
    "cup": "D",
    "skin": { "base_tone": "白皙", "tan": 0.1, "texture": "光滑" }
  },
  "body_by_age": { ... 至少3档 },
  "attributes": { "力量": 7, "敏捷": 8, "体质": 9, "智力": 14, "感知": 12, "魅力": 16 },
  "skills": { "格斗": 2, "教育学": 3, "驾驶": 2 },
  "anchors": ["单身焦虑", "喜欢少年漫画", "爱喝酒", "暴力倾向（对学生用铁拳）"],
  "appearance_brief": "高挑美女教师，常穿白大褂，抽烟",
  "default_location": "2年F班",
  "schedule_group_by_age": { "15": "总武高教师" },
  "scheduleOverrides": { "weekday_afternoon": "侍奉部" }
}
```

### 4.2 `data/character_stages.json`

分 4 段，按年龄：

```
平冢静_小学: "活泼好动的女孩，喜欢和男生打架..."
平冢静_中学: "开始收敛，但骨子里还是不服输..."
平冢静_高中: "总武高学生时期，加入文学部..."
平冢静_成年: "总武高国语教师兼生活指导。表面干练，私下为单身焦虑。
          喜欢看少年漫画，烟酒不离手。对问题学生用铁拳管教，
          同时也是侍奉部的顾问老师。开车技术很烂。"
```

**约束**：
- body_by_age 各档位递增合理
- 成年档位 ≥25 岁
- stages 不预知未来信息

### 4.3 `data/regions.json`

在"春物"条目中加 `{ "name": "平冢静", "base_age": 25, "location": "2年F班" }`

### 4.4 `data/schedule_templates.json`

如果需要，加"总武高教师"模板类型。检查是否已存在。

### 4.5 验收标准

- [ ] characters.json 平冢静条目完整（含 body_by_age ≥3档）
- [ ] character_stages.json 平冢静 4 段描述
- [ ] regions.json 已注册
- [ ] schedule_templates.json 教师模板存在（如果之前没有）
- [ ] 用 `npx tsx test.ts` 验证 44 测试仍全过（不会，因为测试不遍历 NPC 数据——但至少 buildStatePrompt 不崩溃）

---

## 五、额外：更多路人类型（Gemini，可选）

### 5.1 `engine/state.ts` `getNamelessNPCs` 函数

当前有 6 种路人。增加到 12 种：

```
新增:
{ name: "路人(上班族)", act: "拎着公文包神情疲惫", height: "172cm" },
{ name: "路人(老奶奶)", act: "慢悠悠地推着购物车", height: "155cm" },
{ name: "路人(小学生二人组)", act: "背着书包一边走一边打闹", height: "145/148cm" },
{ name: "路人(便利店店员)", act: "在门口抽烟休息", height: "170cm" },
{ name: "路人(跑步的运动服)", act: "戴着耳机沿着街道慢跑", height: "175cm" },
{ name: "路人(遛狗)", act: "牵着柴犬在散步", height: "165cm" },
```

### 5.2 验收标准

- [ ] `getNamelessNPCs` 共 12 种路人
- [ ] `updateNPCSchedules` 公共区域路人 traits 也同步扩充
- [ ] `npx tsx test.ts` 测试全过

---

## 六、不在此次范围内的

- 身份检定/伪装（v0.3，留到下次）
- 电车实际线路数据（city_map.json 已有结构，缺少线路时刻表）
- 称号系统
- 赌博/灰色交易
- CodeAct 真正的 sandbox（node:vm）
- 两段式渲染（two-pass rendering）

---

## 执行顺序

```
1. Claude: 引擎建筑约束 (state.ts)      ← 先做，改动独立
2. Claude: 叙事旅行系统 (types + extension + state)
3. Claude: 测试 (test.ts)               ← 验证 1+2
4. Gemini: 平冢静 NPC + 路人            ← 数据文件，独立
5. Gemini: gm-rules.md 更新             ← 依赖 1+2 的 API 确定后才能写
```

Gemini 应等待 Claude 的改动提交后再开始步骤 5（避免 API 描述不一致）。
