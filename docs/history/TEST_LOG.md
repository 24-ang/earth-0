# 地球-0 测试日志

## 2026-06-12 瘦身重构

### 删除了 ~400 行不需要的代码

| 删除项 | 行数 | 原因 |
|--------|------|------|
| `registerLabel` + 三级降级标签系统 | ~120 行 | LLM 不需要双字母缩写 |
| `moveTo` 逐格路径寻找 | ~80 行 | 方向移动 + 直接跳转就够了 |
| `isWalkable` | ~10 行 | 同上 |
| `PathResult` 接口 | ~10 行 | 同上 |
| `getRoomState` | ~25 行 | 未使用 |
| `getGridContext` 远景/渗透/窗景 | ~40 行 | 简化为核心信息 |
| 6 个 stub 工具 | - | 全部接入引擎 |
| 总计 | **~400 行** | 代码量减少 ~16% |

### 修复了 6 个空壳工具

| 工具 | 之前 | 之后 |
|------|------|------|
| `buy_item` | 只输出文本 | 调用 `buyItem()`，含价格校验 |
| `sell_item` | 只输出文本 | 调用 `sellItem()`，含价格校验 |
| `equip_item` | 只输出文本 | 实现装备/卸下逻辑 |
| `build_add` | 只输出文本 | 调用 `placeFurniture()` |
| `build_remove` | 只输出文本 | 调用 `removeFurniture()` |
| `door_toggle` | 只输出文本 | 调用 `toggleDoor()` |

### 修复了 3 个参数错误

- `/map` 命令：不再调用 `movePlayer(房间名)`（签名不匹配），改为直接设置 location
- `combat_action`：构造完整的 `Combatant` 对象（之前只传 PlayerState 和 string）
- `move_to` 工具：engine 层 pathfinding 移除后，改为直接坐标校验+跳转

### 新增 test.ts

- 33 个冒烟测试，覆盖时间/空间/骰子/经济/物品/关系/路由/NPC/天气/持久化
- 不需要 pi，不需要 LLM
- 运行：`npx tsx test.ts`（2 秒）

---

## 2026-06-12 会话1

### 问题1: 开场叙事与引擎状态脱节
- **现象**: start-game 技能只指导 LLM 交付开场叙事，没有要求调用引擎函数。导致角色在叙事中存在但引擎状态未初始化。
- **影响**: 下次会话无法恢复角色，「继续」时需要重新开始。
- **解决**: 开场叙事前必须确保引擎状态匹配。当前 engine 自动创建默认玩家（维, 6岁, 千叶_住宅区），但名字和背景需要手动对齐。
- **状态**: 已手动修正 `state/session.json`，将玩家名改为「如月维」。

### 问题2: get_status 无法查玩家
- **现象**: `get_status("如月维")` 和 `get_status("维")` 均返回「无此角色」。
- **原因**: `get_status` 工具只搜索 `characters.json`（NPC数据库），不读取 `gameState.player`。
- **解决**: 玩家状态需通过 TUI 命令 `/status` 直读。在 LLM 对话中，我可以直接读取 `state/session.json` 来获取玩家信息。
- **状态**: 已知限制，未修复 engine。

### 问题3: patch_state 的 move 动作未实际实现
- **现象**: `patch_state(target="如月维", action="move", value="千叶_住宅区")` 返回「已记录」但无实际效果。
- **原因**: `extension.ts` 中 patch_state 的 execute 函数只处理了 `add_affection` 和 `add_skill_exp`，其他 action 类型走 fallback 仅输出文本。
- **影响**: LLM 无法通过 patch_state 移动角色。
- **状态**: TODO — 需要在 engine 中实现 move 逻辑或提供替代方案。

### 问题4: 缺少显式存档命令
- **现象**: 玩家问「有没有存档的指令」，不知道进度是否已保存。
- **原因**: 引擎使用自动持久化（每次状态变化时写入 `state/session.json`），pi 也自动保存会话 JSONL。但没有给玩家的显式 `/save` 命令。
- **解决**: 告知玩家自动存档机制。将来可考虑增加 `/save` 命令作为显式确认。
- **状态**: 信息已传达。

### 问题5: start-game 技能缺少引擎调用指南
- **现象**: SKILL.md 只描述「收集信息→交付叙事」，未提及需要调用的引擎工具。
- **建议**: 技能应增加引擎调用清单（set_flags、确保 player name 匹配等）。
- **状态**: TODO

---

### 问题6: base_age 标签与实际角色数据不一致
- **现象**: 雪之下雪乃、比企谷八幡、由比滨结衣等角色的 `base_age` 被设为 6，`schedule_group` 显示「小学生」。但角色卡中的身体数据（身高162cm等）、属性（智力16等）、技能（格斗Lv3等）均为原作高中生水平。
- **影响**: 年龄标签与角色数据脱节，引擎未自动校准。叙事时 LLM 本能按角色卡数据描写（高中生），忽略年龄标签。测试沙盒中所有角色被强制拉到侍奉部，进一步放大了这个矛盾。
- **状态**: 已记录，暂未修复。

### 问题7: move 指令返回不完整 / UI 移动无响应
- **现象**: `move(direction="南")` 返回「移动:」后无内容截断。UI 端快速移动只能上下选择，点击无效果。但 `move_to(x, y)` 可以正常渲染棋盘格。
- **影响**: LLM 侧 move 返回值不可靠；UI 侧交互断裂。
- **状态**: 已记录，待排查。

### 问题8: 四个地图/移动 TUI 指令底层全部残废
- **现象**: 四个 TUI 命令（`/map` `/area` `/city` `/go`）分别画了不同的地图 UI，但底层移动全部有问题。
  - `/map`：调用 `movePlayer(房间名)`，但 `movePlayer` 签名是 `movePlayer(direction: string)`——接受方向，不接受房间名。函数用错。
  - `/area`：调用本地 `moveTo()`，只改 `player.location` 字符串 + 弹通知，不触发场景切换、不更新棋盘格、不挪 NPC。
  - `/city`：同上，调用同一个 `moveTo()`。
  - `/go`：同上，调用同一个 `moveTo()`。
- **根因**: 缺少统一的跨场景移动实现。`extension.ts` 里的本地 `moveTo` 只是 `gs.player.location = loc; save(); notify(...)` 三行。
- **状态**: 部分修复。`moveTo` 已改为 async，加入 `initPlayerGrid()` 调用。`/area` `/city` `/go` 已修复。`/map` 仍用错函数（`movePlayer(房间名)`），待修。

### 问题9: 已删除 /shop 命令
- **操作**: 从 `extension.ts` 移除 `/shop` 注册。商店系统（`buy_item`/`sell_item` 工具、`shops.json` 数据）仍保留在 engine 层，仅移除 TUI 入口。
- **状态**: 已完成。

## 待观察
- NPC 是否按日程出现在正确位置（如月真绫、如月佑应在千叶_住宅区、早上）
- commit_turn 后 NPC 行为是否正常
- 棋盘格移动是否正常
