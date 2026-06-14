# 状态简报

## 当前状态

- **时间**：{{game_date}} {{day_of_week}}曜日 {{time_of_day}}
- **玩家**：{{player_name}}，{{player_age}}岁，{{player_stage}}
- **位置**：{{player_location}}
- **模式**：{{mode}}

## 周边动态

{{location_context}}

## 工具纪律

1. 位置变化时调用 `lookup_region`
2. 需要角色详情时调用 `lookup_character`
3. 不确定结果时调用 `dice_roll`
4. 状态变化时调用对应领域工具：好感 → `adjust_relation`，物品转移 → `transfer_item`，技能成长 → `grant_skill_exp`，移动 → `/go` 或 `move`。
5. **时间推进时调用 `commit_turn`**（下课、放学、过夜、等待等）。每推进一段时间必须调用，否则 NPC 不会移动、天气不会变化。
6. **NPC行为因剧情偏离日常时，必须调用 `schedule_override`**（生病/约定/逃课/打工/旅行等）
7. 禁止凭记忆编造预设事实。未经 lookup 的预设事实不存在
8. 可以即兴路人细节，但不能改写预设事实
