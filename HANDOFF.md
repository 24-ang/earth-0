# Gemini 移交清单 — earth-0 Phase 3~5

> DS 上下文已满，剩余工作移交 Gemini。
> 已完成：Phase 1（删 patch_state + 3 新工具）+ Phase 2（后果系统）。72 测试全过。
> 架构文档：`ARCHITECTURE_PLAN.md`

---

## 铁律（不准偷懒）

1. **每个 phase 独立 commit。** 不准混在一起。
2. **`npx tsx test.ts` 全绿才提交。** 不准 "测试稍后补"。
3. **不准新增硬编码。** 题材相关数据必须放 `data/`。
4. **不准重命名来充数。** `patch_state → apply_narrative_consequence` 这种事 DS 已经毙了。
5. **所有新工具参数必须有 `description`。** LLM 没有 LSP。

---

## Phase 3: Scene Macro 层

### 3a. `world_interact` — 语义化世界交互

**目标：** 隐藏 `edit_map_cell`、`build_add`、`build_remove`、`door_toggle` 四个底层工具。LLM 用 `world_interact` 一个入口。

**注册新工具后，从 `pi.registerTool` 中删除上面四个。**

```typescript
pi.registerTool({
  name: "world_interact", label: "世界交互",
  description:
    "建造/拆除/开关门。引擎内部处理坐标和校验。\n" +
    "action: place(放置家具) / remove(拆除) / build_wall(造墙) / remove_wall(拆墙) / toggle_door(开关门)\n" +
    "item: 物品名（place时必需，必须在背包里）\n" +
    "material: 材料名（build_wall时必需，必须在背包里）\n" +
    "  remove_wall时可指定工具名，不指定则需玩家力量≥5",
  parameters: Type.Object({
    action: Type.String({ description: "place / remove / build_wall / remove_wall / toggle_door" }),
    item: Type.Optional(Type.String({ description: "物品名（place时必需）" })),
    material: Type.Optional(Type.String({ description: "材料或工具名" })),
    description: Type.Optional(Type.String({ description: "放置位置描述，如'靠窗'、'门边'" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    // 获取当前房间和玩家坐标
    // action=place → 找相邻空地 → placeFurniture(x, y, item)
    //   → 必须先校验背包有 item
    // action=remove → 找相邻家具 → removeFurniture(x, y)
    // action=build_wall → 找相邻空地 → editCellType(x, y, 'wall', undefined, material)
    //   → 必须先校验背包有 material
    // action=remove_wall → 找相邻墙 → editCellType(x, y, 'floor', undefined, material)
    // action=toggle_door → 找相邻门 → toggleDoor(x, y)
    //
    // "相邻" = 玩家 gridPos 四周一格（上下左右）
    // 找不到合法目标时返回明确错误 + 候选
  },
});
```

**实现要点：**
- 遍历玩家四周四格 `[[0,-1],[0,1],[-1,0],[1,0]]`
- 根据 action 找对应类型的格子（空地/有家具/墙/门）
- 找第一个匹配的，找不到就报错
- `description` 参数当前忽略（引擎不解析自然语言位置），但保留给未来

**测试要求（至少 3 个）：**
```
world_interact place 有物品 → 放置成功，背包扣除
world_interact place 无物品 → 引擎拒绝
world_interact build_wall 无材料 → 引擎拒绝
```

### 3b. `settle_scene` — 场景收口

**目标：** LLM 一个工具完成 "推进时间 + 日程更新 + 天气 + 记忆标签" 的组合，替代手动调 `commit_turn` + `add_memory_tag`。

```typescript
pi.registerTool({
  name: "settle_scene", label: "场景收口",
  description:
    "一场戏结束时的统一收口。推进时间、更新 NPC 日程、写入记忆标签。\n" +
    "替代手动调用 commit_turn + add_memory_tag 的组合。",
  parameters: Type.Object({
    summary: Type.String({ description: "本场景发生的事，如'在侍奉部和雪乃聊了一下午'" }),
    elapsed_minutes: Type.Number({ description: "经过的分钟数" }),
    memory_tags: Type.Optional(Type.Array(Type.Object({
      target: Type.String({ description: "NPC 名" }),
      tag: Type.String({ description: "记忆标签，如'接受了维的帮助'" }),
    }))),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    // 1. 推进时间 (advanceMinutes + updateNPCSchedules + refreshWeather)
    // 2. 写入 memory tags (addMemoryTag)
    // 3. saveState
    // 返回：时间变化摘要 + 日程事件 + 写入的标签
  },
});
```

**测试要求（至少 2 个）：**
```
settle_scene 推进时间+日程 → game_date变化，NPC移动
settle_scene 写入记忆标签 → NPC memoryTags 包含新标签
```

---

## Phase 4: 补齐工具闭环

### 4a. `spawn_item` — 合法造物

```typescript
pi.registerTool({
  name: "spawn_item", label: "生成物品",
  description:
    "因剧情需要生成一件新物品并放入指定目标背包。必须提供 source（来源）和 reason（原因）。\n" +
    "引擎强制：物品必须有 name/type/weight，武器必须有 damage。\n" +
    "禁止用于绕过 buy_item 或 steal_item 的正常获取途径。",
  parameters: Type.Object({
    target: Type.String({ description: "接收者：'玩家' 或 NPC 名" }),
    item: Type.Object({
      name: Type.String(),
      type: Type.String({ description: "weapon / clothing / armor / tool / consumable" }),
      slot: Type.String({ description: "装备槽位" }),
      weight: Type.Number(),
      damage: Type.Optional(Type.Object({
        dice: Type.String({ description: "如 '1d8'" }),
        damageType: Type.String({ description: "如 '斩击'" }),
      })),
      effects: Type.Optional(Type.Array(Type.Object({
        type: Type.String(),
        value: Type.Union([Type.Number(), Type.String()]),
      }))),
      flavor: Type.Optional(Type.String({ description: "品质描述" })),
    }),
    source: Type.String({ description: "来源：谁给的/哪来的" }),
    reason: Type.String({ description: "为什么获得，如'静将祖父遗物托付给你'" }),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    // 1. 构造完整 Item 对象（默认 state: "intact"）
    // 2. 放入 target 的 inventory
    // 3. 在 item.flavor 追加来源："来源: ${source}"
    // 4. saveState
    // 返回：生成的物品详情
  },
});
```

**测试要求（至少 2 个）：**
```
spawn_item 武器 → target背包有该武器，含damage属性
spawn_item 记录来源 → item.flavor 包含来源信息
```

### 4b. `inflict_damage` — 环境/剧情伤害

```typescript
pi.registerTool({
  name: "inflict_damage", label: "造成伤害",
  description: "因环境或剧情对角色造成 HP 伤害。不经过战斗检定。target 为角色名或'玩家'。",
  parameters: Type.Object({
    target: Type.String({ description: "'玩家' 或 NPC 名" }),
    amount: Type.Number({ description: "伤害值" }),
    type: Type.String({ description: "伤害类型：'钝击'/'坠落'/'毒素'/'燃烧'/'冻伤'/'其他'" }),
    reason: Type.String({ description: "伤害原因，如'被落石砸中'" }),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    // 1. 找到 target（玩家或 NPC）
    // 2. target.hp.current = Math.max(0, target.hp.current - amount)
    // 3. 如果 hp.current === 0，target.alive = false（玩家）或标记 NPC 死亡
    // 4. saveState
    // 返回：剩余 HP
  },
});
```

**测试要求（至少 2 个）：**
```
inflict_damage 玩家 → HP减少
inflict_damage 致死 → alive=false
```

### 4c. `add_memory_tag` — 剧情刻痕

**engine 已有 `addMemoryTag()` 函数（state.ts:800），只需注册为 LLM 工具。**

```typescript
pi.registerTool({
  name: "add_memory_tag", label: "记忆标签",
  description: "将关键剧情点烙印在 NPC 记忆系统中。标签会被注入后续 prompt。",
  parameters: Type.Object({
    target: Type.String({ description: "NPC 名" }),
    tag: Type.String({ description: "标签内容，如'知道玩家是杀手'" }),
    expires_days: Type.Optional(Type.Number({ description: "过期天数，默认7" })),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { addMemoryTag, saveState } = await import("./engine/state.ts");
    addMemoryTag(params.target, params.tag, params.expires_days || 7);
    saveState();
    return { content: [{ type: "text", text: `${params.target} 记忆: ${params.tag}` }], details: {} };
  },
});
```

**测试要求（至少 1 个）：**
```
add_memory_tag → NPC memoryTags 包含标签
```

### 4d. `schedule_override` — 检查是否已注册

搜索 `extension.ts` 确认 `schedule_override` 工具已存在。如果已存在，跳过。如果不存在，注册它（engine 已有 `setScheduleOverride` 函数，state.ts:836）。

---

## Phase 5: 数据解耦

### 原则

```
grep -r "总武高\|千叶\|春物\|校园\|学生" engine/
```
结果必须为空。所有题材相关内容移入 `data/`。

### 5a. 称号规则 → `data/title_rules.json`

当前 `checkAndGrantTitles()` 硬编码在 `engine/state.ts:224-242`。

```json
// data/title_rules.json
[
  {
    "title": "年级第一",
    "condition": { "type": "reputation", "group": "学生", "min": 4 }
  },
  {
    "title": "差生",
    "condition": { "type": "reputation_max", "group": "学生", "max": 0 },
    "location_filter": ["班", "校"]
  },
  {
    "title": "校园偶像",
    "condition": { "type": "attribute", "attr": "魅力", "min": 16 }
  }
  // ... 7 条全部
]
```

改写 `checkAndGrantTitles()` 读取 JSON，逐条 eval。JSON 中 `title` 字段即称号名——引擎不写死任何一个称号名。

**测试要求：** 现有 5 个称号测试全部通过（称号逻辑不变）。

### 5b. 路人模板 → `data/nameless_npc_templates.json`

当前 12 个路人 hardcode 在 `engine/state.ts:1360-1371`。

```json
// data/nameless_npc_templates.json
{
  "public_rooms": ["中庭", "1F南走廊", "2F南走廊-J班前", "2F南走廊-F班前", "操场", "校门", "自行车棚"],
  "traits": [
    { "name": "路人(戴耳机)", "act": "戴着耳机闭目听歌", "height": "168cm" }
    // ... 12 条
  ]
}
```

**注意：** `public_rooms` 中的房间名仍然是春物题材的。这是可以接受的——换题材时改 JSON 就行。

**测试要求：** 现有 `getNamelessNPCs helper and LLM prompt integration` 测试通过。

### 5c. Sex 档案 → `data/sex_profiles.json`

当前 `SEX_PROFILES` 硬编码在 `engine/sex.ts:16-508`。

移到 `data/sex_profiles.json`。`engine/sex.ts` 从 JSON 加载。

**测试要求：** 所有现有测试通过（sex 逻辑不变）。

### 5d. Fallback 房间 → `data/regions.json`

当前 `FALLBACK_ROOMS` 硬编码在 `engine/state.ts:970-976`。

在 `regions.json` 中为每个区域加 `fallback_room` 字段。没有的默认 `"1F南走廊"`。

**测试要求：** `updateNPCSchedules` 测试通过。

### 5e. 价格范围 → `data/economy.json`

当前 `PRICE_RANGE` 硬编码在 `engine/state.ts:857-863`。

```json
// data/economy.json
{
  "price_ranges": {
    "consumable": [80, 800],
    "tool": [50, 5000],
    "weapon": [500, 50000],
    "armor": [500, 30000],
    "clothing": [500, 30000]
  },
  "job_rates": {
    "便利店": 900, "送报纸": 500, "家教": 1500, "餐厅": 1000, "发传单": 850
  }
}
```

**测试要求：** buyItem/sellItem/workJob 测试通过。

---

## 验收标准

每个 phase 完成后：

```bash
npx tsx test.ts
# 必须: === N passed, 0 failed ===
# N 只能增加，不能减少

git log --oneline -1
# 必须: 对应 phase 的独立 commit
```

全部完成后，确认：
```bash
grep -rn "总武高\|千叶\|校园偶像\|年级第一\|差生\|怪力\|小富豪\|打架高手\|潜行大师" engine/
# 应该只在 title_rules.json 引用中出现，不在 engine/ 硬编码中出现
```

---

## 当前状态

```
Phase 1 ✅ 1f43de6 (删 patch_state，3 新工具，69 tests)
Phase 2 ✅ 8e8e9f2 (后果系统，72 tests)
Phase 3 ⏳ world_interact + settle_scene
Phase 4 ⏳ spawn_item + inflict_damage + add_memory_tag + schedule_override
Phase 5 ⏳ 数据解耦
```
