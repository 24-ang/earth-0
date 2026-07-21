# 春物 Worldpack

> やはり俺の青春ラブコメはまちがっている。
> 最后更新: 2026-07-21

## 规模

| 类别 | 数量 |
|------|------|
| 角色卡 | 141 文件 |
| 时间线 | 56 条 |
| 组织 | 17 个 |
| 房间 (棋盘格) | ~35 间 |
| 日历事件 | ~40 条 |
| 家具 | 44 件 |
| 地点文件 | 5 个 (japan/chiba/mihama/soubu_high/shiranui_dojo) |

## 目录结构

```
worldpacks/oregairu/
├── characters/          — 141 角色 JSON（跨十多部作品）
├── timelines/           — 56 条双轨剧情时间线
├── orgs/                — 17 组织（含总武高校章程/class_config）
├── locations/           — 5 分层地点文件（国家→县→区→学校）
│
├── calendar.json         — 全年学校日历（advance_hook/aftermath/org_effects）
├── city_map.json         — 千叶城市地图（landmark/区域/车站）
├── school_map.json       — 总武高校内地图
├── rooms.json            — 棋盘格房间（教室/走廊/住宅/街景）
├── room_templates.json   — 53 房间模板
├── residence_templates.json — 住宅模板
├── furniture.json        — 44 家具定义（容器/动作/属性）
│
├── items.json            — 物品总表（武器/防具/工具/消耗品/服装）
├── shops.json            — 商店定义
├── economy.json          — 经济配置（打工时薪/物价范围/博弈）
├── positions.json        — 体位数据
├── phone_apps.json       — 手机应用定义
├── timetable.json        — 总武高课程表（按班主任索引）
├── schedule_templates.json — NPC 日程模板（13 组）
├── nameless_npc_templates.json — 路人模板
├── init_profiles.json    — 开局身份模板
├── protagonist.json      — 主角替换规则
├── title_rules.json      — 称号触发规则
├── regions.json          — 区域属性定义
│
└── secrets/              — 秘密防火墙数据
```

## 修改指南

- **所有数据文件优先读 worldpacks/oregairu/**。`data/` 下同名文件是 TS 静态导入需要的兜底模板。
- **brain-split 检测**：引擎启动时自动对比 `data/` 和 `worldpacks/oregairu/` 的键数差异，控制台会警告。
- **角色卡质量不一致**：约 65 张为"薄壳"卡（缺技能/HP/驱力），引擎有数值兜底，LLM 首次遇到时按需生成。
- **教室只建了 2年F班 和 2年J班**，其余班级学生通过 `resolveLocationToRegion` 路由到区域/中庭/走廊。
