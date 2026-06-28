# state.ts 渐进拆分 — 设计计划

> 来源：参考计划 `0-groovy-shannon.md` §七。优先级 🟡 本月，每模块 30 分钟–1 小时，分 4–5 轮。

## 1. 要解决什么问题

`engine/state.ts` 是一个 **4181 行、约 136 个导出、横跨 9 个领域**的「神对象」文件：单例、持久化、NPC 运行时、网格移动、地点层级、经济、日程、记忆、声望……全挤在一个文件里。

- 改一处怕崩全局，新人接手成本极高。
- 但好消息：依赖图是 **DAG（零循环依赖）**——`state.ts` 与 `timeline.ts` 之间已用动态 `import()` 破环（`timeline.ts` 静态 import state.ts，state.ts 反向全用 `await import("./timeline.ts")`）。拆分的结构基础已经存在。

目标：**渐进式**把 state.ts 按领域拆成多个 `state-xxx.ts`，用 barrel 重导出保证所有既有 import 站点零改动。一次抽一个、每轮跑测试，**绝不一次大重构**。

## 2. 现有基础设施

| 资产 | 位置 | 说明 |
|---|---|---|
| 神对象本体 | `engine/state.ts`（4181 行，~136 导出） | 待拆 |
| 破环机制 | state.ts ↔ timeline.ts 动态 import | 拆后必须维持：子模块对 timeline 仍走 `await import` |
| 类型集中地 | `engine/types.ts`（745 行） | 拆分不动类型，子模块都 import 它 |
| 对等模块 | `engine/timeline.ts`（923 行） | 静态 import state.ts 的 6 个符号（gameState/getOrCreateNPC/updateRelation/getLocationNav/isSameLocation/findCharacter）——拆后这些 import 仍指向 barrel，零改动 |
| 下游 import 站点 | ~40 个工具文件 `await import("../../engine/state.ts")` | barrel 保证全部不动 |

**附带可做**：`engine/dice.ts` 只为 `attrMod`（纯数学 `(val-10)/2` 取整）依赖 state.ts。把 `attrMod` 移到 `dice.ts` 或新建 `math-utils.ts`，可让 dice.ts 完全独立于 state.ts。

## 3. 设计方案

### 3.1 核心模式：Barrel 重导出 + 单一根模块

```
engine/
  state-core.ts        ← 根模块：gameState 单例 + 模块级可变数据 + 基础工具
  state-persistence.ts ─┐
  state-location.ts     │  各领域子模块
  state-grid.ts         │  只从 state-core 静态 import
  state-economy.ts      │  子模块之间【不】互相静态 import
  state-npc.ts          │
  state-schedule.ts     │
  state-memory.ts      ─┘
  state.ts             ← barrel：export * from "./state-core.ts" + 各子模块
```

**两条铁律保证无环**：

1. **单一所有者与不可变容器 (`stateHolder`)**：
   在 `state.ts` 原本的顶层设计中，有许多像 `gameState`、`characters` 等被 `export let` 导出的全局可变变量，它们会在 `loadState()` 或 `resetState()` 时被重新赋值。在多文件拆分中，通过 Barrel 重新导出这些会被重新赋值的 `let` 活绑定，在复杂的 CJS/ESM 混用或 tsx 运行时下极易导致其他子模块**丢失引用（Hold住旧的gameState内存地址不放）**。
   
   因此，所有模块级可变变量必须全部收拢进 **`state-core.ts`** 的一个**不可变的状态容器对象**中，各子模块静态 import 该容器，严禁在模块级直接重新赋值变量：
   ```typescript
   // state-core.ts
   export const stateHolder = {
     gameState: null as unknown as GameState,
     characters: {} as Record<string, NPCRuntimeState>,
     rooms: {} as Record<string, RoomGrid>,
     shops: {} as Record<string, any>,
     // ... 其余 locationsDelta/dynamicCharacters 等模块级可变数据
   };
   ```
   *   所有子模块与外部工具均通过 `stateHolder.gameState` 读取或修改属性。
   *   在 `loadState()` 载入新存档时，我们不重新赋值变量本身，而是更新容器内的对象引用：`stateHolder.gameState = parsedState`。这能确保所有子模块拿到的对象地址永远稳定一致。
   *   基础工具（`getRoomKey`/`isSameLocation`/`normalizeLocationName`）同样住进 `state-core.ts`。
2. **子模块不互相静态 import**——若 A 需要 B 的函数，要么该函数其实属于 core，要么用动态 import。子模块只依赖 core → 依赖图是「core 为根的星形」，天然无环。

**barrel 的 state.ts 只含 `export * from`**，无任何定义。这样：
- 所有既有 `import { X } from "../../engine/state.ts"` 原样解析到 barrel，再转发到真正的子模块——**调用方零改动**（均改由 barrel 指向 `stateHolder` 下的活数据）。
- `timeline.ts` 静态 import barrel 的符号同样不动；只要 barrel 自身不静态 import timeline.ts，就无静态环。


### 3.2 抽取顺序（小→大，每轮跑 test.ts）

**阶段 1 — 纯函数、零/弱依赖，最低风险**：

| 轮次 | 抽出 | 源行段 | 备注 |
|---|---|---|---|
| 1a | `state-location.ts` | 2231-2598 | 地点层级树、`getLocationNav`、`createDynamicLocation` |
| 1b | `state-grid.ts` | 2659-3066 + 3692-3776 | `getRoom`/`getNearbyNPCs`/`movePlayer`/`getGridContext` 等，被 7 个工具用 |
| 1c | `state-economy.ts` | 3122-3273 + 3818-3927 | 商店/经济/声望 + 偷窃 |

**检查点**：每轮 `npx tsx test.ts` → ≥230 passed, 0 failed。barrel 转发，import 站点不破。

**阶段 2 — 触及 timeline.ts / 含复杂内联逻辑**：

| 轮次 | 抽出 | 源行段 | 风险点 |
|---|---|---|---|
| 2a | `state-memory.ts` | 3068-3079 + 从 updateNPCSchedules 提取的过期/去重/分享纯函数 | 见 3.3 最难接缝 |
| 2b | `state-npc.ts` | 1727-2229 | 含被 timeline.ts 静态 import 的 `getOrCreateNPC`/`findCharacter`——barrel 转发后 timeline 的 import 仍有效 |
| 2c | `state-schedule.ts` | 3275-3624 + 3626-3690 | `updateNPCSchedules` + 日历 org effects；import `state-memory.ts` |
| 2d | `state-persistence.ts` | 276-538 | 纯 I/O，零游戏逻辑，安全但冗长；注意 `saveState` 被众多子模块调用，留在 core 或让子模块从 core 导入 |

**阶段 3 — 可选**：`state-briefing.ts`(541-668+990-1239 的 buildStatePrompt)、`state-collectors.ts`(670-976)、`state-combat.ts`(1241-1295)。buildStatePrompt 动态 import 多、与 collectors 耦合紧，建议整组一起抽或最后再动。

### 3.3 最难接缝：updateNPCSchedules 里的记忆逻辑

`updateNPCSchedules`（3275-3624）内联了四块逻辑：路由(3309-3461)、公共区填充(3463-3478)、**记忆过期+社交分享(3482-3577)**、短信投递(3579-3621)。其中记忆过期+分享逻辑（`checkExpiry`/`deduplicateTags`/`isPrivateTag`/`canShareTag`）**逻辑上属于记忆系统**（3068-3079 的 addMemoryTag/getMemoryTags），却物理上嵌在日程函数里。

**推荐**：
1. 阶段 2a 先把记忆的纯函数（含从 updateNPCSchedules 抽出的清理/去重/分享判定）提进 `state-memory.ts`。
2. 阶段 2c 抽 `state-schedule.ts` 时，让它 `import { cleanupExpiredTags, canShareTag, ... } from "./state-memory.ts"`，`updateNPCSchedules` 调用这些导入的函数。
3. 短信投递保持其内部 `await import("./phone.ts")` 不变（依赖图里的额外叶子）。

> 注意：`socialShareMemoryTags` 这类函数依赖整个 `roomNPCs` 映射 + 关系 + game_date，不是无状态小函数——抽取时连同它需要的入参一起搬，别强行无状态化。这是为什么记忆逻辑与 C 模块（NPC 记忆升级）要协调：C 的 `recallRelevantMemories` 也该落在 `state-memory.ts`。

### 3.4 存量硬编码（顺手标注，本模块不强制修）

拆分时会路过这些违反「引擎零硬编码」的存量问题，**记录在案、可选顺手修**：

- `state.ts:102` `isSameLocation` 里 `c1.includes("总武") && c2.includes("总武")`
- `state.ts:1218` 场景工具提示 `if (p.location.includes("侍奉部"))`
- `state.ts:3664-3678` `npcBelongsToOrg`/`inferRoleForNPC` 里的「总武高学生/教师」
- `timeline.ts:252` 默认主角名 `比企谷八幡`、`timeline.ts:111-113` 与 state.ts 重复的同款启发式

其中 state.ts 与 timeline.ts 的「总武高」启发式**完全重复、无共享工具**——拆分时可抽进一个通用 helper（由 worldpack 配置驱动，不写死校名），一并消除重复与硬编码。

## 4. 争议点/未决问题

1. **barrel 文件位置** —— ⓐ（推荐）保持 `engine/state.ts` 作 barrel，~40 个 import 站点零改动；ⓑ 移到 `engine/state/index.ts`，架构更干净但需 codemod 全库改路径。**取舍**：ⓐ 零风险但留隐患（新人可能往 barrel 里加新定义）；ⓑ 更正但一次性改动大。
2. **导出可见性** —— ⓐ（推荐）只 `export` 跨模块需要的，模块内 helper 不导出，强制边界；ⓑ 全导出图省事。**取舍**：ⓐ 边界清晰利于后续重构；ⓑ 易导致职责扩散。
3. **updateNPCSchedules 是否整块搬 vs 先拆内联记忆逻辑** —— ⓐ 阶段 2 整块搬进 state-schedule，内部分解留后；ⓑ（推荐）先把记忆清理/分享抽成纯函数进 state-memory，再搬日程。**取舍**：ⓐ 风险低但留技术债；ⓑ 更清晰但改内联逻辑稍有引入 bug 风险。倾向 ⓑ，因与 C 模块协同收益大。
4. **模块级可变单例的重赋值与引用传递** —— ⓐ（推荐）抛弃直接 reassign 模块级 `let` 变量，将其统一收拢至不可变 `stateHolder` 容器并做内部属性重定向；ⓑ 继续用裸 `export let` 变量并动态赋值。**取舍**：ⓑ 在 CJS/ESM 混用、打包和 tsx 复杂运行时下，活绑定极易在重新赋值时丢失指针，导致其他文件依然捏着旧的单例对象；ⓐ 额外做了一层指针容器中转，容器对象引用地址永恒不变，100% 物理稳定。
5. **buildStatePrompt 何时抽** —— ⓐ（推荐）留到阶段 3，与 collectors/briefing 整组抽，因其动态 import 多、耦合紧；ⓑ 早抽独立 state-prompt.ts。**取舍**：ⓐ 谨慎；ⓑ 激进、易把大函数与其深嵌 helper 拆散。
6. **是否顺手修存量硬编码** —— ⓐ 本模块只标注、不修，保持「纯拆分」单一目的；ⓑ 拆到哪顺手修到哪（尤其重复的「总武高」启发式）。**取舍**：ⓐ 改动可控、易 review；ⓑ 一次清完但混入逻辑改动、增大回归面。倾向 ⓐ，硬编码另开任务。

## 5. 验收标准

- **每轮回归**：每抽出一个子模块后立即 `npx tsx test.ts` → ≥230 passed, 0 failed。任一轮挂则回滚该轮。
- **import 零破坏**：所有既有 `import { X } from ".../engine/state.ts"` 与 `timeline.ts` 的静态 import 无需修改即通过编译。
- **无循环依赖**：拆后 `state.ts` barrel 只含 `export * from`，无定义；子模块只静态 import `state-core.ts`，不互相静态 import；对 timeline.ts 的引用仍全为动态 import。（可用依赖检查工具或 `npx tsc --noEmit` 验证无环报错。）
- **行数下降**：state.ts 从 4181 行降至 barrel 的几十行；各 state-xxx.ts 单文件控制在数百行量级。
- **类型检查**：阶段性目标 `npx tsc --noEmit` → 0 errors（与项目 strict 渐进收紧同步）。
- **dice 独立性（若做附带项）**：`attrMod` 移出后 `engine/dice.ts` 不再 import state.ts。
- **零新硬编码**：拆分过程不向 engine/ 引入任何新的角色名/地名/作品名；存量违规已在文档 §3.4 标注。
