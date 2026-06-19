# earth-0 Agent 沙盒四层架构重构计划

> 目标：通用 LLM 叙事驱动的物理引擎。换题材只需换 data，不碰 engine。

---

## 零、设计宪法（来自 Tavern2Agent）

1. **入口宽，核心严**：LLM 用自然语义调用工具。引擎内部严格校验。
2. **不让模型背工作流**：高频动作有 macro。LLM 选命令，引擎补内部字段。
3. **按叙事决策单位建模**：工具对应 GM 动作，不是数据库字段。
4. **四层 API**：Scene/Action → Turn Commit → Domain → Primitive。LLM 优先用高层。
5. **patch 只能 debug**。常规玩法不暴露万能修改器。
6. **不要用 prompt 长期弥补坏 interface**。

---

## 一、四层 API 架构（目标态）

```
Layer 1: Scene/Action   ← LLM 日常入口
  settle_purchase, settle_rest, complete_travel, start_confrontation,
  world_interact, social_interact

Layer 2: Turn Commit    ← 多状态原子提交
  commit_turn (推进时间 + 日程更新 + 天气 + 事件结算)

Layer 3: Domain         ← 单领域操作，有校验
  transfer_item, adjust_relation, grant_skill_exp,
  steal_item, combat_action, identity_check,
  spawn_item, inflict_damage, add_memory_tag

Layer 4: Primitive      ← 仅查询和 debug
  lookup_character, lookup_region, get_status, dice_roll
```

**当前状态：只有 Layer 3 + 4。Layer 1 完全空白。Layer 2 只有时间推进没有事务语义。**

---

## 二、分步实施

### Phase 1: 斩后门（优先，1 commit）

删除 `patch_state`，替换为三个独立工具：

```
删：patch_state(target, action, value)

换：
  transfer_item(from, to, item_name)
    → 引擎校验 from 的背包/装备有该物品
    → 转移并记录来源

  adjust_relation(npc, delta, reason)
    → 自动 0-100 clamp
    → reason 写入 relation.notes
    → 单次 Δ ≤ 20（硬上限）

  grant_skill_exp(skill, amount)
    → 走现有 addSkillExp 公式
    → 单次 ≤ 5 EXP
```

不创建 `social_interact` 宏——留到 Phase 4，因为公式设计需要更多讨论。

---

### Phase 2: 接后果（2 commits）

**2a. `steal_item` 失败 → 真实后果**
```
caught=true 时引擎自动：
  → adjust_relation(target, -20, "偷窃被抓")
  → 若 NPC 有 combat 能力，写入 flags.steal_alert
  → 若 location 包含 "校"，写入 flags.school_alert
```

**2b. `identity_check` 失败 → 真实后果**
```
失败时引擎自动：
  → 写入 flags.identity_exposed
  → 若在受控区域（校门/警察局等），NPC 敌对
  → reputation[当前区域所属群体] -= 1
```

**2c. `combat_action` 支持 NPC 为 actor**
```
参数加 actor: Type.Optional(Type.String())
→ actor=玩家: 现有逻辑
→ actor=NPC名: 以该 NPC 属性掷骰，目标为玩家
→ LLM 叙事决定 NPC 是否还手，engine 只算数学
```

---

### Phase 3: Scene Macro 层（2 commits）

**3a. `world_interact` — 隐藏坐标**
```
world_interact({
  location: "侍奉部",      // 可选，默认当前房间
  action: "place" | "remove" | "build_wall" | "remove_wall" | "toggle_door",
  item: "床",              // 可选
  material: "砖",          // build_wall 时必需
  description: "靠窗的位置" // LLM 自然语言，引擎忽略或做 best-effort 匹配
})
→ 引擎内部：找合法坐标、扣背包、更新网格
→ 隐藏 edit_map_cell, build_add, build_remove, door_toggle
```

**3b. `settle_scene` — 场景收口**
```
settle_scene({
  summary: "在侍奉部和雪乃聊了一个下午",
  elapsed_minutes: 90,
  outcomes: ["雪乃接受了帮忙的提议", "关系增进"],
  memory_tags: [{ target: "雪之下雪乃", tag: "接受了维的帮助" }]
})
→ 引擎内部：推进时间 + 刷新日程 + 写入 memory + 天气检查
→ 替代 LLM 手动调 commit_turn + add_memory_tag 的组合
```

---

### Phase 4: 数据解耦（最后做）

不是因为不重要，而是因为**架构必须先对，数据才能抽对**。

```
engine/state.ts 硬编码 → data/ 文件：

  checkAndGrantTitles()     → data/title_rules.json
  getNamelessNPCs traits    → data/nameless_npc_templates.json
  FALLBACK_ROOMS            → data/regions.json 加 fallback 字段
  updateNPCSchedules 公共房间 → data/regions.json 加 is_public 字段
  SEX_PROFILES              → data/sex_profiles.json
  PRICE_RANGE               → data/economy.json
  FALLBACK_ROOMS            → 删掉，改用 regions.json 的 fallback_room
```

原则：**一切 game-specific 数据都在 data/。engine/ 只留通用算法。**

---

### Phase 5: 缺失系统（按需）

| 系统 | 新工具 | 依赖 |
|------|--------|------|
| 环境伤害 | `inflict_damage(target, amount, type, reason)` | Phase 2 |
| 剧情刻痕 | `add_memory_tag(target, tag, expires_days)` | engine 已有函数 |
| 合法造物 | `spawn_item(item_spec, target, source, reason)` | Phase 1 |
| 日程覆盖 | `set_schedule_override(npc, location, reason, hours)` | engine 已有函数 |

---

## 三、不做的事

- ❌ 不重命名 `patch_state` 为 `apply_narrative_consequence`——换皮不换药
- ❌ 不做 `social_interact` 宏——公式设计需要实际 gameplay 验证，先用手动 `adjust_relation`
- ❌ 不在 engine 写死任何题材相关内容
- ❌ 不让引擎自动决定 NPC 行为——LLM 通过 `combat_action(actor=NPC)` 主动指挥

---

## 四、实施顺序

```
Phase 1 (1h)  → 删 patch_state，换 3 工具
Phase 2 (2h)  → 接后果系统
Phase 3 (2h)  → Scene Macro
Phase 5 (1h)  → 补齐工具（spawn/inflict/memory/schedule）
Phase 4 (3h)  → 数据解耦
```

每 phase 独立 commit，`npx tsx test.ts` 全绿才提交。

---

## 五、成功标准

1. LLM 不能绕过任何游戏系统——取物品必须走 transfer/steal，加好感只能走 adjust_relation
2. 换题材只需改 data/ 文件 + agents/ 提示词，不碰 engine/
3. 62 现有测试不退化 + 每 phase 新增测试覆盖新工具
4. `grep -r "春物\|总武高\|千叶" engine/` 返回空
