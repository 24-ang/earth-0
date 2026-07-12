# earth-0 TUI 系统概览

> 2026-07-12 首次整理。回答：TUI 有哪些面板、谁能推动正文、菜单控件怎么用、哪里能整合。
> 面板代码在 `tools/tui/*.ts`，渲染/交互工具在 `tools/helpers.ts`。

---

## 1. 注册与调用

- TUI 命令通过 `pi.registerCommand(name, cmd)` 注册（`tools/registry.ts`），命令对象形状是 `{ description, handler: (args, ctx) => Promise<void> }`——**和普通工具（`{name,parameters,execute}` + `pi.registerTool`）不同**。
- **TUI 命令不经过 `withToolTracking`**：不自动 `saveState()`、不记回合日志、不受渲染阶段 `_toolsLocked` 拦截。要改守恒量的面板必须自己调 `saveState()`。
- 用户以斜杠命令调用：`/bag`、`/go`、`/status`…；部分带参数：`/sleep 3`、`/preset lite`、`/look 雪之下雪乃`、`/world load oregairu`。`/ach` 是 `/achievements` 别名。

## 2. 渲染与交互（`tools/helpers.ts`）

| 工具 | 作用 |
|------|------|
| `showPanel(ctx, title, lines)` | **只读**面板（所有行无 `action`），滚动查看，`q`/ESC 退出 |
| `showMenu(ctx, title, items)` | **交互**菜单，`item.action(done)` 是点击回调；不调 `done()` 则菜单保持打开并重渲染 |
| `ctx.ui.notify(text, level)` | 顶部 toast 提示，**不推动叙事** |
| `ctx.ui.custom(render, opts)` | 自定义 TUI 覆盖层（`bag.ts` 用键式界面） |
| `ctx.chat.addSystemMessage(text)` | 往对话历史注入系统消息（排队，见下） |
| `pi.sendMessage(ctx, text)` | 模拟玩家输入并**立即触发**四阶段流水线 |

### showMenu 的坑（2026-07-12 已修）

`showMenu` 里，回车落在一个**没有 `action` 的项**上时，逻辑曾是直接 `done()` **关闭整个菜单**。于是灰选项（`action: 条件 ? 真动作 : undefined`）一被回车，整个 `/room`（锁着的门）或 `/npc`（好感不够的选项）菜单就当场关掉，非常挫败。

**修法（治根，改控件本身）**：只有当**整屏都没有可点项**（纯信息面板）时回车才关闭；只要菜单里还有别的可点项，落在无动作项上就保持打开、什么都不做。所以现在灰选项用 `action: undefined` 是安全的。见 `helpers.ts` 的 `showMenu` → `handleInput` 回车分支。

## 3. 【关键】哪些面板点了会推动正文叙事

四阶段流水线只在 `before_agent_start` 钩子里跑，**而这个钩子只在玩家提交文本时触发**（`extension.ts`）。所以：

| 模式 | 机制 | 面板 | 点了会立刻出正文吗 |
|------|------|------|--------------------|
| **立即触发** | `pi.sendMessage` | `/npc`（交流/接触/恋爱/战斗/偷窃…） | **会** |
| **排队等待** | `ctx.chat.addSystemMessage` | `/go`、`/goskip`、`/train`、`/choice` | **不会**——消息排队，等玩家下次打字才被消费 |
| **无输入** | 仅 `saveState`+`notify` 或纯只读 | 其余绝大多数 | **不会** |

**这是当前 TUI 最大的结构不一致**：真正把故事推着走的只有 `/npc`；`/go`/`/choice` 这类明明该推进的，却是"点了先记下、等再打字才生效"。是否统一是设计决策。

`/reroll` 特殊：重新生成了一段叙事，却只 `showPanel` 展示、不注入对话，无法成为正史——设计层面残缺。

## 4. 面板全景（34 命令 + 1 别名）

- **纯只读显示**：`look` `relations` `combat` `quest` `calendar` `weather` `alerts` `memory` `growth` `schedule` `shop` `achievements` `housing` `gamble` `party` `sex` `saves`
- **改状态但不推正文**：`bag` `status` `identity` `preset` `layer1` `world` `save` `load` `new` `redo` `sleep` `room`
- **改状态 + 排队消息**：`go` `goskip` `train` `choice`
- **改状态 + 立即推正文**：`npc`
- **其他**：`reroll`（重渲染，不进对话）

## 5. 整合建议（尚未实施）

| 整合项 | 操作 | 减少文件 | 风险 |
|--------|------|---------|------|
| `goskip` → `go fast` | `go.ts` 加参数解析，删 `goskip.ts` | 1 | 低 |
| `status` 收编 `growth`/`combat`/`party` | 做标签页子菜单 | 3 | 中 |
| `room` 解耦 `npc` | `showNPCInteractionMenu` 移到 `helpers.ts` | 0 | 低 |
| 信息面板合并（`calendar`/`quest`/`alerts`/`schedule`/`weather`/`memory` → `/info` 标签页） | 新建 `info.ts` | 6 | 高（数据量大） |
| `shop`/`gamble`/`housing` → `/economy` 标签页 | 新建 | 2 | 中 |

`save`/`load`/`saves` 三件套功能正交，不必合并。

## 6. 已修的交互 bug（2026-07-12 收口）

**崩溃/空反应类**：`showMenu` 菜单误关（治根）、家具动作空消息（`applyEffect` 返回 `message:narrative`，narrative/storage 效果留空 → `notify("")` 什么都不显示）、家具"阅读"崩溃（`addSkillExp(skill,exp)` 少传 skills 参数，严格模式抛异常）。
**读错数据类（见 §7）**：`/room` 家具容器打不开、`/shop` 货架永远空、`/schedule` 覆盖标记不显示、`/achievements` 死功能。
**其它**：`/preset`（`args[0]`→`args`）、`/look` 只读副作用、`/train` 读 `data/` 改用引擎 `CITY_MAP`+车费 `NaN` 兜底、`/save`·`/sleep` 家判定改世界无关、`/relations`·`/housing`·`/quest`·`/sex` 缺字段防御、`/npc` 静默 catch、`/alerts` 显示 true、`/status` "阻合"错别字、死导入清理。门禁 test 343 / e2e-init 57 / e2e-full 31 全绿。

## 7. 静默失效的数据流坑（扫一眼看不出，必须走到底）

TUI 最坑的一类 bug：**代码在跑、不崩、甚至打印了字符串，但产出对玩家是空/是废话/是死路**。审代码只看"崩不崩、调没调函数"会全部漏掉，必须核对**读侧字段名/形状 vs 写侧实际产出**。已踩中的：

- **`/room` 家具容器（ownerId 前缀）**：`getContainersAt` 给子容器的 `ownerId` 是 `"书桌·抽屉"`，room.ts 却按 `ownerId === "书桌"` 过滤 → 永不命中 → **有抽屉/柜的家具全程开不了、取放不了**。修：`ownerId===fname || ownerId.startsWith(fname+"·")`，标签用 `·` 后的子名而非内部 id。（另注：`getContainersAt` 只对玩家四邻格的家具生成容器，得走近。）
- **`/shop` 货架（读错形状）**：`shops.json` 是平铺 `{便利店:{items:[…]}}`，shop.ts 却读 `shopsCatalog.shops[x].inventory`（`.shops`/`.inventory`/`.location`/`price` 全不存在）→ **货架永远空**。修：读平铺 `shopsCatalog[类型].items`，按当前房间家具名/地名匹配店类型。
- **`/schedule` 覆盖标记（读没人写的字段）**：读 `npc.scheduleOverride`，引擎实际写的是 `npc.pendingOverride` → 🔶 标记永远不显示（死代码）。
- **`/achievements` 死功能**：`data/achievements.json` 空 [] + 全项目无解锁代码（没有 `flags[成就id]=` 的写侧）→ 永远 0 解锁。修：0 定义时诚实提示"尚未配置"，别显示自相矛盾的"全部解锁"。真做成系统需要"定义 + 解锁逻辑"两侧都补。
- **直接读 `data/` 兜底**：`/train`（已修用 `CITY_MAP`）、`/shop`·`/achievements` 曾读 `data/` 而非当前 worldpack → 和实际世界脱节。TUI 里凡 `import ../../data/xxx.json` 都要警惕。

**判定尺（审 TUI 面板时每个数据源过一遍）**：这个字段/形状，写侧真的会产出吗？过滤/匹配条件真的会命中吗？只读面板别调有副作用的函数（如 `getOrCreateNPC` 会创建 NPC）。
