# 设计反馈

## 2008-04-07
- city 和 known_locations 冲突，功能重叠，感觉一模一样
- shop 系统没用，不现实
- school_map.json 和 rooms.json 房间命名不一致（带括号描述 vs 纯名称），导致 getRoom() 精确匹配失败。已修 engine 加 fallback，但根源是命名规范问题——后续加房间必须两边对齐
- initPlayerGrid() 把玩家放在房间 origin（永远是左上角墙壁坐标），应改为扫描 cells 找到入口(exit/door)或地板作为出生点
