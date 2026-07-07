/**
 * 状态完整性校验器 —— 烟雾报警器，不是修理工。
 *
 * 设计约束（不可违背）：
 * - 只报告，不修复。修复是工具的责任。函数内绝不写 gameState.xxx = ...。
 * - 区分 ERROR 和 WARNING：ERROR=破坏游戏/init后绝不能出现；WARNING=可疑但能活。
 * - 同步函数。用 require() 懒加载 helper 避免循环依赖。
 *
 * 调用时机：
 * - init 阶段（init_game 末尾 saveState 之后）：errors+warnings 全大声 console.error
 * - turn 阶段（settlement 每回合末尾 saveState 之后）：仅 errors 大声，warnings 静默（防刷屏）
 */

import type { GameState, Item } from "./types.ts";

// ── 公开接口 ──

export interface ValidationOptions {
  /** "init" = 初始化后全面检查（错误+警告都 console.error 大声报）；
   *  "turn" = 每回合检查（只有 ERROR 才 console.error，warning 静默只进返回值）。
   *  默认 "turn"（安全：不刷屏） */
  phase?: "init" | "turn";
}

export interface ValidationResult {
  /** errors.length === 0 时为 true */
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ── 辅助判定 ──

/** 只有真正的 Item 对象才算已装备。null=显式脱下，undefined=槽位不存在。 */
function isEquipped(v: unknown): v is Item {
  return v !== null && v !== undefined && typeof v === "object";
}

/** 检查单件 Item 必填字段（对齐 init_profile.ts normalizeItem 要求）。
 *  返回缺失字段名数组；空数组=合法。 */
function itemFieldProblems(it: Record<string, unknown>, slotLabel: string): string[] {
  const bad: string[] = [];
  if (typeof it.name !== "string" || !it.name) bad.push(`name[${String(it.name)}]`);
  if (typeof it.type !== "string" || !it.type) bad.push(`type[${String(it.type)}]`);
  if (typeof it.slot !== "string" || !it.slot) bad.push(`slot[${String(it.slot)}]`);
  for (const k of ["weight", "volume"]) {
    const n = (it as any)[k];
    if (typeof n !== "number" || Number.isNaN(n) || n < 0) bad.push(k);
  }
  if (!Array.isArray((it as any).effects)) bad.push("effects");
  if (typeof (it as any).state !== "string") bad.push("state");
  return bad;
}

// ── 性系统门控 ──

let _sexAvailabilityCache: boolean | null = null;

/** 公开 repo 不含 engine/sex.ts。性系统不存在时跳过生殖器档案检查。 */
function sexSystemAvailable(): boolean {
  if (_sexAvailabilityCache !== null) return _sexAvailabilityCache;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    _sexAvailabilityCache = fs.existsSync(path.resolve(process.cwd(), "engine", "sex.ts"));
  } catch {
    _sexAvailabilityCache = false;
  }
  return _sexAvailabilityCache;
}

// ── 主函数 ──

export function validatePlayerState(
  gs: GameState,
  options: ValidationOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const phase = options.phase ?? "turn";

  // ── 0. 最外层保护 ──
  const p = (gs as any).player;
  if (!p || typeof p !== "object") {
    errors.push("gs.player 不存在或不是对象");
    if (phase === "init") console.error("[validate-state][ERROR] gs.player 不存在或不是对象");
    else console.error("[validate-state][ERROR] gs.player 不存在或不是对象");
    return { ok: false, errors, warnings };
  }

  // ── 1. player.name 非空字符串（ERROR） ──
  if (typeof p.name !== "string" || p.name.trim() === "") {
    errors.push("玩家名称为空");
  }

  // ── 2. 幽灵默认名"维"检测（WARNING——仅同时无内衣才报警，避免误伤合法"维"） ──
  if (p.name === "维") {
    const hasUnderwear =
      isEquipped(p.equipment?.inner_top) && isEquipped(p.equipment?.inner_bot);
    if (!hasUnderwear) {
      warnings.push(
        `玩家名称为默认值"维"且缺少内衣——可能未正确运行 init_game。若确为合法命名请忽略`,
      );
    }
  }

  // ── 3. alive === true（ERROR） ──
  if (p.alive !== true) {
    errors.push(`玩家已死亡 (alive=${String(p.alive)})`);
  }

  // ── 4. funds 非负数字（ERROR） ──
  if (typeof p.funds !== "number" || Number.isNaN(p.funds)) {
    errors.push(`玩家资金类型非法: ${String(p.funds)}`);
  } else if (p.funds < 0) {
    errors.push(`玩家资金为负: ${p.funds}`);
  }

  // ── 5. hp.max > 0（ERROR） ──
  if (!p.hp || typeof p.hp.max !== "number" || Number.isNaN(p.hp.max) || p.hp.max <= 0) {
    errors.push(`玩家 HP 上限非法: ${JSON.stringify(p.hp)}`);
  } else {
    // ── 6. 0 ≤ hp.current ≤ hp.max（ERROR） ──
    const cur = p.hp.current;
    if (typeof cur !== "number" || Number.isNaN(cur)) {
      errors.push(`玩家 HP 当前值非法: ${String(cur)}`);
    } else if (cur < 0) {
      errors.push(`玩家 HP 当前值为负: current=${cur}`);
    } else if (cur > p.hp.max) {
      errors.push(`玩家 HP 越界: current=${cur} > max=${p.hp.max}`);
    }
  }

  // ── 7. inventory 是数组（ERROR） ──
  if (!Array.isArray(p.inventory)) {
    errors.push(`玩家背包不是数组: ${typeof p.inventory}`);
  }

  // ── 8. equipment 是对象（ERROR） ──
  if (!p.equipment || typeof p.equipment !== "object") {
    errors.push(`玩家装备栏不是对象: ${typeof p.equipment}`);
  } else {
    // ── 11. 至少两件内衣 inner_top + inner_bot（WARNING） ──
    const it = isEquipped(p.equipment.inner_top);
    const ib = isEquipped(p.equipment.inner_bot);
    if (!it) warnings.push("缺少内衣上 (inner_top)");
    if (!ib) warnings.push("缺少内衣下 (inner_bot)");

    // ── 12. 每件已装备物品字段完整（WARNING，逐件单独一条） ──
    const SLOT_TYPES = [
      "inner_top", "inner_bot", "shirt", "top", "bottom",
      "legs", "feet", "head", "acc", "acc2", "acc3",
      "left_hand", "right_hand", "back", "mount",
    ] as const;
    for (const slot of SLOT_TYPES) {
      const item = (p.equipment as Record<string, unknown>)[slot];
      if (!isEquipped(item)) continue;
      const problems = itemFieldProblems(item as Record<string, unknown>, slot);
      if (problems.length > 0) {
        const itemName = (item as any).name || "未知物品";
        warnings.push(`装备物品 "${itemName}"(槽位 ${slot}) 缺少必填字段: ${problems.join(", ")}`);
      }
    }
  }

  // ── 9. location 非空字符串（ERROR） ──
  if (typeof p.location !== "string" || p.location.trim() === "") {
    errors.push(`玩家位置为空: ${String(p.location)}`);
  }

  // ── 10. fatigue 在 [0,100]（WARNING） ──
  if (typeof p.fatigue !== "number" || Number.isNaN(p.fatigue)) {
    warnings.push(`玩家疲劳值非法: ${String(p.fatigue)}`);
  } else if (p.fatigue < 0 || p.fatigue > 100) {
    warnings.push(`玩家疲劳值越界: ${p.fatigue} (应在 [0,100])`);
  }

  // ── 13 & 14. 网格位置 + 幽灵地点检测 ──
  // 懒加载 getRoom（require 同步，匹配 state-grid.ts:392 的写法；失败 fallback 顶部 import）
  let getRoom: ((roomName: string) => unknown) | null = null;
  try {
    getRoom = require("./state-grid.ts").getRoom;
  } catch {
    try { getRoom = require("./state.ts").getRoom; } catch { /* 都不行就跳过网格检查 */ }
  }

  let roomExists = false;
  if (getRoom && typeof p.location === "string" && p.location.trim() !== "") {
    const room = getRoom(p.location);
    roomExists = room !== null;
    // ── 13. gridPos non-null 当房间存在时（WARNING） ──
    if (roomExists && p.gridPos === null) {
      warnings.push(`gridPos 为 null 但房间 "${p.location}" 存在 (getRoom 返回了网格)`);
    }
    // ── 14. 幽灵地点（WARNING——两者都空才是真幽灵，减少户外/旅行误报） ──
    if (!roomExists && p.gridPos === null) {
      warnings.push(
        `位置 "${p.location}" 在房间网格中找不到 (getRoom 返回 null 且 gridPos 也为 null)`,
      );
    }
  }

  // ── 15. 世界 flag 存在（WARNING） ──
  const activeWorld = (gs as any).activeWorld;
  if (activeWorld) {
    const worldFlagKey = `worldpack_${activeWorld}`;
    if (!(gs.flags && gs.flags[worldFlagKey] === true)) {
      warnings.push(`缺少世界包 flag: ${worldFlagKey}`);
    }
    if (activeWorld === "oregairu" && !(gs.flags && gs.flags["oregairu"] === true)) {
      warnings.push(`缺少世界 flag: oregairu`);
    }
  } else {
    warnings.push("gameState.activeWorld 未设置");
  }

  // ── 16. 手机 phoneData（WARNING，仅 init 阶段——turn 跳过因 phoneData 懒初始化无害） ──
  if (phase === "init") {
    let getPlayerPhone: (() => unknown) | null = null;
    try {
      getPlayerPhone = require("./phone.ts").getPlayerPhone;
    } catch { /* phone 模块不存在则跳过 */ }
    if (getPlayerPhone) {
      const phone = getPlayerPhone(gs) as Record<string, unknown> | null;
      if (phone && !phone.phoneData) {
        warnings.push("手机存在但 phoneData 尚未初始化（将在首次访问时懒初始化）");
      }
    }
  }

  // ── 17. 生殖器档案（WARNING，仅性系统存在时；公开 repo 完全跳过） ──
  if (sexSystemAvailable()) {
    const sexStates = (gs as any).sexStates;
    if (!sexStates || !sexStates[p.name]) {
      warnings.push(`性系统可用但 sexStates[${p.name}] 缺失（玩家没有生殖器档案）`);
    }
  }

  // ── 18. 房产链完整性：每个 property 应在 known_locations（WARNING——否则导航找不到自己家）──
  const props = p.properties && typeof p.properties === "object" ? p.properties : {};
  for (const propName of Object.keys(props)) {
    if (Array.isArray(p.known_locations) && !p.known_locations.includes(propName)) {
      warnings.push(`房产 "${propName}" 未注册进 known_locations（导航将找不到）`);
    }
  }

  // ── 19. 玩家当前位置可导航（WARNING）──
  if (typeof p.location === "string" && p.location.trim() !== "") {
    const inKnown = Array.isArray(p.known_locations) && p.known_locations.some((l: string) => l === p.location);
    if (!inKnown && getRoom && getRoom(p.location) === null) {
      warnings.push(`玩家位置 "${p.location}" 既不在 known_locations 也无法 getRoom 解析`);
    }
  }

  // ── 20. 关系无自引用（WARNING）──
  if (p.relationships && typeof p.relationships === "object" && p.relationships[p.name]) {
    warnings.push(`关系表含玩家自身条目 "${p.name}"（自引用脏数据）`);
  }
  // ── 21. init 阶段默认名检测（WARNING——GM 可能传参错）──
  if (phase === "init" && p.name === "维") {
    warnings.push(`玩家名为默认值"维"——若非有意命名，检查 init_game 是否传对了 name`);
  }

  // ── Vicky 政治经济学系统自检（仅 init 阶段跑一次，turn 阶段跳过防刷屏）──
  if (phase === "init" && gs.organizations) {
    const orgs = gs.organizations;
    const TIERS = ["global", "national", "regional", "local", "site"];
    const SECTORS = ["politics", "economy", "culture", "military", "social"];
    const SCALES = ["club", "local", "regional", "national"];
    const AXES = ["经济立场", "政治立场"];
    let orgCount = 0, oldFormatCount = 0, missingTierCount = 0;
    let missingClassBaseCount = 0, brokenParentCount = 0, brokenAxesCount = 0;
    let missingSectorCount = 0, badScaleCount = 0, badGovRefs = 0;

    for (const [id, org] of Object.entries(orgs)) {
      orgCount++;
      if (!org.scale || !SCALES.includes(org.scale)) badScaleCount++;
      if (!org.sector || !SECTORS.includes(org.sector)) missingSectorCount++;
      if (!org.class_base || Object.keys(org.class_base).length === 0) missingClassBaseCount++;
      if (!org.organizationalAxes ||
          AXES.some(a => org.organizationalAxes[a] === undefined)) brokenAxesCount++;
      if (org.parent_org && !orgs[org.parent_org]) brokenParentCount++;
    }

    // 检查旧格式残党（soubu_high 等从旧数组格式升级失败会触发）
    for (const [id, org] of Object.entries(orgs)) {
      if (!org.name || !org.scale || !org.sector) {
        oldFormatCount++;
        errors.push(`组织 "${id}" 疑似旧格式：缺少 name/scale/sector（soubu_high.json 可能未升级？）`);
      }
    }

    // 检查 location tier 标记
    if ((globalThis as any)._regionContextsCache || (globalThis as any)._regionContexts) {
      const ctx = (globalThis as any)._regionContexts || {};
      for (const [key, data] of Object.entries(ctx)) {
        if ((data as any)?.skybox_defaults && !(data as any).skybox_defaults.tier) {
          missingTierCount++;
          warnings.push(`地点 "${key}" 有 skybox_defaults 但缺少 tier 标记——级联保护不会生效`);
        }
        // 检查 governing_orgs 引用的 orgId 是否存在
        if ((data as any)?.governing_orgs) {
          for (const gov of (data as any).governing_orgs) {
            if (gov.orgId && !orgs[gov.orgId]) {
              badGovRefs++;
              warnings.push(`地点 "${key}" 的 governing_orgs 引用了一个不存在的组织: "${gov.orgId}"`);
            }
          }
        }
      }
    }

    // 检查角色数据完整性
    const { characters } = require("./state.ts");
    let missingClassCount = 0, missingAxesCount = 0;
    if (characters) {
      for (const ch of (characters as any[])) {
        if (!ch.social_class) missingClassCount++;
        if (!ch.personal_axes) missingAxesCount++;
      }
    }
    if (missingClassCount > 0) {
      warnings.push(`${missingClassCount} 个角色缺少 social_class——部分 NPC 将无法触发阶级内心冲突`);
    }
    if (missingAxesCount > 0) {
      warnings.push(`${missingAxesCount} 个角色缺少 personal_axes——组织-个人理念轴比较将失效`);
    }

    // 汇总报告
    if (oldFormatCount > 0) {
      errors.push(`Vicky系统: ${oldFormatCount} 个组织仍为旧格式（缺少新字段），请升级 org JSON 文件`);
    }
    if (brokenParentCount > 0) {
      errors.push(`Vicky系统: ${brokenParentCount} 个 parent_org 引用不存在——声望传导链条断裂`);
    }
    if (badGovRefs > 0) {
      warnings.push(`Vicky系统: ${badGovRefs} 个 governing_orgs 引用不存在的组织——Phase 3 活跃势力列表会出现缺口`);
    }
    if (missingTierCount > 0) {
      warnings.push(`Vicky系统: ${missingTierCount} 个 location 缺少 tier 标记——天空盒级联保护不完整`);
    }

    const okCount = orgCount - oldFormatCount - brokenParentCount;
    if (orgCount > 0 && okCount === orgCount) {
      // 全部 OK，不刷屏，只记一条
    }
  }

  // ── 报告 ──
  if (phase === "init") {
    // init 阶段：错误+警告全部大声报（烟雾报警器，及时抓）
    for (const e of errors) console.error("[validate-state][ERROR]", e);
    for (const w of warnings) console.error("[validate-state][WARN] ", w);
  } else {
    // turn 阶段（默认）：只有 ERROR 大声，warning 静默（防每回合持久警告刷屏）
    for (const e of errors) console.error("[validate-state][ERROR]", e);
  }

  return { ok: errors.length === 0, errors, warnings };
}
