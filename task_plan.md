# 最后三个系统补齐 — 实施计划

## 目标
1. 察觉统一检定 (engine/perception.ts)
2. 接入潜行动作 (steal_item, world_interact, furniture unlock/pickup)
3. 藏人系统 (hide/unhide effects)
4. 容器打通 (getContainersAt + transferBetweenContainers)

## 阶段

### 阶段 1: 基础层 (dice.ts, types.ts, perception.ts)
- [complete] 1.1 dice.ts: 添加 checkDC 函数（接受数字 DC）
- [complete] 1.2 types.ts: PlayerState 加 concealed/hiding_in 字段
- [complete] 1.3 perception.ts: 创建 perceptionCheck 函数
- [complete] 1.4 state.ts: 添加 getNearbyNPCs 辅助函数

### 阶段 2: 察觉接入 (tools)
- [complete] 2.1 steal_item.ts: 用 perceptionCheck 替代硬编码 caught
- [complete] 2.2 world_interact.ts: 用 perceptionCheck 替代 Math.random()
- [complete] 2.3 furniture.ts unlock: 撬锁成功时用 perceptionCheck 可能引来 NPC
- [complete] 2.4 furniture.ts pickup: 搬东西时用 perceptionCheck

### 阶段 3: 藏人系统 (furniture.ts)
- [complete] 3.1 inferActionDefFromPhysical: hide / unhide 动作
- [complete] 3.2 applyEffect: hide + unhide 效果

### 阶段 4: 容器打通 (state.ts)
- [complete] 4.1 getContainersAt: 读取 furniture.json containers
- [complete] 4.2 transferBetweenContainers: 支持家具容器 + locked 检查

### 阶段 5: 测试
- [complete] 5.1 添加 11 新测试
- [complete] 5.2 npx tsx test.ts = 165 passed, 0 failed

## 改动文件
- engine/dice.ts — 新增 checkDC()
- engine/types.ts — PlayerState 加 concealed/hiding_in
- engine/perception.ts — 新文件，察觉统一检定
- engine/state.ts — getNearbyNPCs, getContainersAt 读家具容器, transferBetweenContainers 支持家具
- engine/furniture.ts — 修复 loadFurnitureCatalog 缓存, 解锁+搬运察觉检定, hide/unhide 效果
- tools/action/steal_item.ts — 偷窃后察觉检定
- tools/action/world_interact.ts — 非法改造察觉检定
- test.ts — 11 新测试 + 修复 housing 测试

## 错误记录
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| housing 测试 Math.random 失效 | 1 | 改为 spawn NPC 目击者触发察觉检定 |
| loadFurnitureCatalog 每次重读文件 | 1 | 添加 _catalogWorld 缓存 |
| unhide 动作匹配不上物理属性 | 2 | 添加特殊 case 拦截 |
| getContainersAt lock naming 不一致 | 1 | 兼容 locked 和 locked_${sub.id} |
