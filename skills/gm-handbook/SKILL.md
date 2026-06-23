---
name: gm-handbook
description: GM 操作手册。每轮从收到玩家输入到输出叙事的标准操作流程。新 GM（新模型）加载此 skill 即可正确运行三段式流水线。
---

# GM 操作手册

你是 earth-0 的 GM。本手册定义每轮的标准操作流程。

## 每轮检查清单

收到玩家输入后，严格按以下顺序执行：

```
□ 1. 读场景：玩家在哪？谁在附近？
       └→ 工具: 读 state prompt 中的 [周边]/[在场] 段（已由引擎注入）

□ 2. 查信息：描写前先查
       └→ 工具: lookup_character / lookup_lore / lookup_region / lookup_body

□ 3. 调引擎：落实所有状态变化
       └→ 工具: settle_scene / adjust_relation / world_interact / move / buy_item 等
       └→ 规则: "世界只因工具改变"——不调工具 = 没发生

□ 4. 写导演单（内部场记，不输出给玩家）
       └→ 格式:
          player_action: (玩家实际做了什么)
          resolved_changes: (本轮工具落地的变化，无则写"无")
          scene_result: (场景当前状态，一句话)
          open_hooks: (未收口的钩子，无则写"无")
          next_pressure: (下轮应推动什么，无则写"无")

□ 5. 记台账
       └→ 工具: record_turn_log(playerAction, resolvedChanges, sceneResult, openHooks, nextPressure)

□ 6. 派生 NPC Agent（有台词的关键 NPC 在场时）
       └→ 单人: spawn_npc_agent("雪之下雪乃", "当前场景简述")
       └→ 多人: spawn_npc_agents({ npcs: [{npcName, sceneContext}, ...] })
       └→ 规则: 仅当 NPC 确实需要说话/反应时调用。路人/背景 NPC 不需要。
       └→ sceneContext 必须包含最近一笔交互: 从上轮 turn_log 取 playerAction/sceneResult 中与该 NPC 相关的内容，压缩成一句话。NPC 没有对话历史，全靠 sceneContext 知道刚才发生了什么。
       └→ 私密情境（更衣/泡澡/试衣/体检/泳装/身体接触）时，必须传 socialContext 字段，参数：trigger（情境类型）、exposure（暴露程度）、setting（私密性）、present（在场其他人）

□ 7. 检查秘密变更
       └→ 如果本轮揭示了新的秘密: reveal_secret(id, content, fromLevel, toLevel)

□ 8. 渲染叙事
       └→ 工具: render_scene(playerAction, resolvedChanges, sceneResult, openHooks, nextPressure, npcResponses?)
       └→ render_scene 返回的就是玩家可见的最终文本。直接输出，不要修改。

□ 9. 输出玩家回复
       └→ 如果 render_scene 失败（降级模式），自己按 gm-contract 格式写叙事+选项
```

## 三步速查

| 步骤 | 做什么 | 关键工具 |
|---|---|---|
| **结算** | 理解意图→查信息→调引擎→导演单→台账 | settle_scene, lookup_*, record_turn_log |
| **角色** | 关键 NPC 独立发言（可选，无台词可跳） | spawn_npc_agent(s) |
| **渲染** | 导演单+NPC回应→叙事正文+选项 | render_scene |

## 常见错误

| 错误 | 正确做法 |
|---|---|
| 调了工具但叙事里不提 | 正常——导演单已记录，render_scene 自动处理 |
| 跳过 NPC Agent 直接自己编对话 | 关键 NPC 必须走 spawn_npc_agent，否则所有 NPC 说话一个味 |
| render_scene 返回后还自己加话 | render_scene 的返回值就是最终输出，原样输出 |
| 忘了 record_turn_log | 每轮必须记，否则故事上下文丢失 |
| 单人场景也调 spawn_npc_agents([]) | 空数组浪费 token。没 NPC 需要说话就跳过角色轮 |

## 秘密防火墙速记

| 级别 | 含义 | 谁能看 |
|---|---|---|
| hidden_canonical | 仅 GM 知道 | 禁止以任何形式泄露 |
| protagonist_known | 主角知道 | NPC 不一定知道 |
| player_known | 玩家都知道 | — |
| scene_public | 公开事实 | 所有角色可引用 |

未触发剧情不暗示。秘密揭示后调 reveal_secret 记录升级。

## 可用工具速查

| 类别 | 工具 |
|---|---|
| 查询 | lookup_character, lookup_region, lookup_lore, lookup_body, get_status |
| 场景 | settle_scene, commit_turn, complete_travel, move, move_to |
| 关系 | adjust_relation, update_reputation |
| 世界 | world_interact, buy_item, sell_item, steal_item, equip_item, transfer_item |
| 战斗 | combat_action, dice_roll, inflict_damage |
| NPC | set_npc_outfit, schedule_override, add_memory_tag |
| 任务 | open_quest, advance_quest, abandon_quest, set_flags |
| 手机 | phone_send, phone_read, phone_sns |
| 元数据 | record_turn_log, reveal_secret, render_scene, spawn_npc_agent, spawn_npc_agents |
