---
date: 2026-06-12T13:06:31+08:00
author: pi
commit: N/A
branch: N/A
repository: earth-0
topic: "角色转换+身体分层+日程+flags系统"
tags: [character-conversion, body_by_age, schedule_by_age, flags, IF-system]
status: complete
last_updated: 2026-06-12T13:06:31+08:00
last_updated_by: pi
type: feature_development
---

# Handoff: earth-0 角色系统+flags+IF线完成

## Tasks

### 已完成 ✅
- **body_by_age** — 身体数据按年龄分层。引擎 `getBodyForAge()` 找≤当前年龄的最大键。小学生档不写cup。覆盖雪乃/詩織/陽乃/真绫/结花/小春/円香/透/绫乃/京香。
- **schedule_by_age** — 日程按年龄切换。全局模板（小学生→中学生→高校生→大学生）。15/20 角色已配。
- **character_stages 扩展** — 雪乃/詩織/真绫/结花/小春 stages 从世界书充实。IF线用 `_if` 后缀隔离（橘家_if/青梅_if）。
- **flags 系统** — `GameState.flags: Record<string,boolean>` 通用键值对。`set_flags` 工具 LLM 可调。buildStatePrompt 按 flags 注入 _if stages。
- **auMode** — 魔改角色过滤。大志 tags:["au"]，默认不可见。
- **新增 9 角色** — 绫乃/陽乃/平冢静/大志(AU)/京香/结花/小春/円香/透。总计 20 人。
- **转卡流程文档** — MEMORY.md 记了 v4 完整版（#workflow #conversion），含身材审计+日程审计+12项验证清单+常见错误。

### 待做 ❌
- **timeline 事件系统** — scratchpad 记了。data/timeline.json 按日期触发（入学/搬家/死亡/剧情事件），引擎到点注入 GM context。
- **player 家庭** — 玩家是孤儿（世界书说 `<user>家没有父母`），未创建。
- **春物配角** — 叶山/三浦/一色/材木座等 10+人未转。
- **NPC 日程模板扩充** — scratchpad 记了：主妇/医生/警察/NEET/退休/艺人 等。
- **`/identity` 预设系统** — 游戏开局选身份（小学生/如月家三子/社畜/老头等）自动设 flags，还没做。

## Critical References
- `~/.pi/agent/memory/MEMORY.md` — #workflow #conversion v4 转卡流程 + 日程速查表
- `~/projects/earth-0/PLAN.md` — 系统设计总览
- `~/SillyTavern/data/default-user/worlds/` — 源头世界书（三个核心 + 💾 系列）

## Recent Changes
- `engine/types.ts` — GameState.flags 替换 tachibanaIF
- `engine/state.ts` — getBodyForAge/getNpcCurrentAge、buildStatePrompt 按 flags 注 _if stages、schedule 年龄解析
- `extension.ts` — set_flags 工具、toggle_aumode、lookup_character 年龄过滤、sex_touch 去门控
- `data/characters.json` — 12→20 角色，body_by_age/schedule_group_by_age 全覆盖
- `data/character_stages.json` — 14→21 keys（+_if 版）
- `data/schedule_templates.json` — +小学生/中学生/高校生/大学生/海外留学/上班族
- `engine/sex.ts` — 詩織 cup F→J、真绫 G→E、雪乃 B→A、+如月真绫/雪之下绫乃

## Learnings
- 转卡必须走身材审计（多世界书冲突要列表对比）。橘家母女跳过这步导致 cup 全错。
- stages 不能预知未来：京香「收养佑之后」→删掉，改 IF 版。
- schedule 不能写死高校——6岁角色 schedule_group 必须是「小学生」+ by_age。
- IF 线不靠 LLM 自觉——引擎 flags + set_flags 工具 + buildStatePrompt 自动注入。

## Artifacts
- `~/.pi/agent/memory/MEMORY.md` — 转卡流程 v4
- `~/.pi/agent/memory/SCRATCHPAD.md` — 待办（日程模板、timeline）
- `~/projects/earth-0/data/characters.json` — 20 角色
- `~/projects/earth-0/data/character_stages.json` — 21 stages（含 _if）

## Next Steps
1. timeline 事件系统 — 按日期触发角色事件+作品剧情
2. 或继续转角色（春物配角/千叶作品）— 按 v4 流程
3. 或 `/skill:start-game` 打一把测试 20 角色沙盒

## Other Notes
- Session 因 LLM 变笨主动重启。handoff 存于 `.rpiv/artifacts/handoffs/`。
- 重开用 `/skill:resume-handoff` 加载此文件。
