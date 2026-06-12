# earth-0 系统设计

## 已完成 ✅ v0.1 → v0.2

### 核心引擎
| 系统 | 文件 | 功能 |
|------|------|------|
| 六维/技能/HP/AC/负重 | types.ts, state.ts | 角色全部属性 |
| d20检定 | dice.ts | 攻击/难度/优劣势/掩体 |
| 战斗 | combat.ts | 攻击/防御/逃跑/死亡豁免 |
| 时间/年龄同步 | time.ts | NPC年龄随玩家成长 |
| 地区路由 | router.ts | 111条作品→位置，三层匹配 |
| Layer1 性欲 | sex.ts | 欲望/高潮/心里话/体位/结算 |
| 物品 | items.json, state.ts | 武器/防具/工具/食物/服装 |

### 空间系统
| 功能 | 实现 |
|------|------|
| 棋盘格 | cellSize 1m~5m，16房间 |
| 三级地图 | /room /map /area /city |
| 远景/窗景/环境音 | horizon + outsideView + ambient |
| 路径碰撞 | moveTo 直线逼近 + 障碍检测 |
| 建造/拆除 | build_add / build_remove + 动态标签 |
| 门窗开关 | isOpen → 大写[DR]关/小写[dr]开 + block |
| 跨节点渗透 | faces字段 → 读目标房间实时ambient |
| 宏观名册 | school_map.json 防无限画廊 |

### NPC 系统
| 功能 | 实现 |
|------|------|
| 日程模板 | 7个(学生/教师/不良/店员等)，群体+个人覆盖 |
| 碰面检测 | 同室NPC → 自动注入GM上下文 |
| 后台事件 | schedule重叠 → 标签交换 + 社交事件 |
| 日程覆盖 | pendingOverride → LLM可临时改变NPC行为 |
| 认知隔离 | 4个subagent(雪乃/结衣/八幡/海梦) |
| 记忆标签 | NPC间自动传染，3天过期 |
| 公共路人 | 随机属性路人填充走廊/中庭 |

### 经济/成长
| 功能 | 实现 |
|------|------|
| 购买/出售 | buy_item / sell_item（LLM定价，引擎校验） |
| 打工 | workJob（便利店/家教等，2010千叶时薪） |
| 服装声望 | reputation_bonus → 穿校服学生圈+1 |
| 生长发育 | monthly_growth（饮食+运动→身高/体重/三围） |
| 天气 | 四季pool + 随机刷新 |

### agent prompts
preset.json / gm-*.md（7个，含心里话规则）/ gm-state.md（含`{{weather}}`）

### TUI
/status /look /party /inventory /room /map /area /city /go /shop

### 工具（LLM可调）
lookup_character / lookup_region / dice_roll / get_status / patch_state / commit_turn / sex_touch / toggle_layer1 / combat_action / move / move_to / build_add / build_remove / door_toggle / steal_item / equip_item / update_reputation / schedule_override / buy_item / sell_item / work_job / monthly_growth

---

## 待实现 ❌

### v0.3
- 身份检定/伪装（d20+魅力 vs DC，服装标签覆盖）
- 电车跨区移动逻辑（目前 /go 只估算，无实际电车流程）
- 赌博/灰色交易

### 待补数据
- 平冢静 NPC
- 更多房间网格（商店街/千叶站/体育馆内部）
- 更多路人类型

### v0.5+
- 季节事件（学园祭/修学旅行/过年）
- 东京/秋叶原/京都扩展
- 打工→买房→阶层跨越

---

## 文件清单
```
engine/   types.ts state.ts dice.ts time.ts router.ts sex.ts combat.ts
data/     characters.json rooms.json items.json locations.json positions.json
          regions.json world_rules.json school_map.json city_map.json
          schedule_templates.json shops.json
agents/   preset.json gm-*.md (7个)
.pi/agents/  yukinoshita.md yuigahama.md hikigaya.md kitagawa.md
extension.ts
start.sh
```
