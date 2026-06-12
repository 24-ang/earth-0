# 地球-0 测试日志

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

## 待观察
- NPC 是否按日程出现在正确位置（如月真绫、如月佑应在千叶_住宅区、早上）
- commit_turn 后 NPC 行为是否正常
- 棋盘格移动是否正常
