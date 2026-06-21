/**
 * 家具交互引擎 — 数据驱动，零硬编码。
 * 新家具只需在 data/furniture.json 加条目，新效果在 applyEffect switch 加分支。
 *
 * 物理属性系统：定义家具的物理属性（surface/seat/container/lockable/switchable/readable/concealable），
 * LLM 从物理属性推断可执行的动作，而非依赖硬编码动作列表。
 */

import fs from "node:fs";
import path from "node:path";
import type { GameState } from "./types.ts";

// ── 类型 ──

export interface FurnitureActionDef {
  effect: string;
  hours?: number;
  fatigue_reduction?: number;
  restore_hp?: "full" | number;
  restore_fatigue?: "full" | number;
  skill?: string;
  exp?: number;
  shop_type?: string;
  narrative?: string;
  /** toggle 效果用的 state key */
  stateKey?: string;
  /** lock/unlock 效果用的钥匙 ID */
  key_id?: string;
  /** study 效果用的所需物品名 */
  requires_item?: string;
  /** craft 效果：消耗材料列表 */
  consumes?: string[];
  /** craft 效果：产物物品名 */
  produces?: string;
  /** climb DC 覆盖 */
  climb_dc?: number;
}

export interface ContainerDef {
  id: string;
  visible: boolean;
  max_volume: number;
  max_weight: number;
  lockable?: boolean;
}

export interface FurnitureDef {
  /** 物理属性列表，LLM 据此推断可执行动作 */
  physical?: string[];
  /** 容器定义（抽屉、柜格等） */
  containers?: ContainerDef[];
  /** 可变状态（运行时读写） */
  state?: Record<string, any>;
  /** 动作定义（保留向后兼容，物理属性优先） */
  actions?: Record<string, FurnitureActionDef>;
}

export type FurnitureCatalog = Record<string, FurnitureDef>;

export interface FurnitureResult {
  message: string;
  narrative: string;
  effects: string[];
}

// ── 物理属性 → 动作映射 ──

/** 从 physical 数组推断可由 LLM 自由使用的动作列表 */
export function getActionsFromPhysical(physical: string[]): string[] {
  const actions = new Set<string>();

  const mapping: Record<string, string[]> = {
    surface: ["放东西", "查看"],
    seat: ["坐下"],
    bed: ["睡觉", "躺下", "坐下"],
    container: ["打开", "放东西", "取东西", "查看"],
    lockable: ["锁上", "解锁"],
    switchable: ["打开", "关闭"],
    readable: ["阅读", "浏览", "查看"],
    concealable: ["藏东西", "查看"],
    interface: ["使用", "查看", "操作"],
    table: ["放东西", "坐下"],
    storage: ["打开", "放东西", "取东西"],
    display: ["查看"],
    machine: ["使用", "查看"],
    light_source: ["打开", "关闭"],
    climbable: ["爬"],
    craftable: ["制作"],
    pickupable: ["捡起"],
  };

  for (const attr of physical) {
    const mapped = mapping[attr];
    if (mapped) {
      for (const a of mapped) actions.add(a);
    }
  }

  return Array.from(actions);
}

// ── 加载 ──

let _catalog: FurnitureCatalog | null = null;
let _catalogWorld: string = "";

export function loadFurnitureCatalog(worldName?: string): FurnitureCatalog {
  // 缓存：同世界线不重读文件（支持运行时状态修改持久化）
  const world = worldName || "oregairu";
  if (_catalog && _catalogWorld === world) return _catalog;

  const wpPath = path.resolve(process.cwd(), "worldpacks", world, "furniture.json");
  if (fs.existsSync(wpPath)) {
    try { _catalog = JSON.parse(fs.readFileSync(wpPath, "utf-8")); _catalogWorld = world; return _catalog!; }
    catch (_) {}
  }

  // 默认
  const defaultPath = path.resolve(process.cwd(), "data", "furniture.json");
  try { _catalog = JSON.parse(fs.readFileSync(defaultPath, "utf-8")); _catalogWorld = world; }
  catch (_) { _catalog = {}; _catalogWorld = world; }
  return _catalog!;
}

/** 查家具在某世界线是否存在 */
export function findFurnitureDef(furnitureName: string, worldName?: string): FurnitureDef | null {
  const cat = loadFurnitureCatalog(worldName);
  // 精确匹配
  if (cat[furnitureName]) return cat[furnitureName];
  // 模糊匹配（"床" 匹配 "木质床"）
  for (const [key, def] of Object.entries(cat)) {
    if (furnitureName.includes(key) || key.includes(furnitureName)) return def;
  }
  return null;
}

/** 获取家具的所有可用动作（物理属性推断 + 显式 actions） */
export function getAvailableActions(def: FurnitureDef | null, furnitureName: string): string[] {
  if (!def) return ["查看", "坐下", "使用"];
  const actions = new Set<string>();

  // 物理属性推断
  if (def.physical && def.physical.length > 0) {
    for (const a of getActionsFromPhysical(def.physical)) actions.add(a);
  }

  // 显式 actions（向后兼容）
  if (def.actions) {
    for (const key of Object.keys(def.actions)) actions.add(key);
  }

  if (actions.size === 0) {
    return ["查看", "使用"];
  }
  return Array.from(actions);
}

// ── 核心 ──

export async function interactFurniture(
  furnitureName: string,
  action: string,
  gameState: GameState,
  playerGridPos: [number, number] | null,
  roomCells: any[][] | null,
  /** 格子上存储的内联动作定义（优先于 furniture.json） */
  inlineActions?: Record<string, FurnitureActionDef> | null
): Promise<FurnitureResult> {
  // 优先级: 1. 内联动作(格子数据) 2. furniture.json 3. 泛用 fallback
  let def: FurnitureDef | null = null;

  if (inlineActions && Object.keys(inlineActions).length > 0) {
    def = { actions: inlineActions };
  } else {
    def = findFurnitureDef(furnitureName, gameState.activeWorld);
  }
  if (!def) {
    // 泛用 fallback：不在目录里的家具也能交互
    // LLM 可以自由叙事，引擎提供基础"休息"效果
    if (action === "查看" || action === "检查" || action === "?" || action === "" || !action) {
      return { message: `你看了看${furnitureName}。`, narrative: `你打量着${furnitureName}。`, effects: [] };
    }
    // 泛用"使用/坐下/躺下"→ 轻度休息效果
    const genericRest = /坐|躺|靠|趴|睡|休息|使用|用/.test(action);
    if (genericRest) {
      const reduction = /躺|睡|趴/.test(action) ? 10 : 5;
      gameState.player.fatigue = Math.max(0, (gameState.player.fatigue ?? 0) - reduction);
      return { message: `你${action}在${furnitureName}上，疲劳 -${reduction}。`, narrative: `你${action}在${furnitureName}上，稍微缓了口气。`, effects: [`疲劳 -${reduction}`] };
    }
    // 其他动作：纯叙事，LLM 自由发挥
    return { message: `你${action}了${furnitureName}。`, narrative: `你${action}了${furnitureName}。`, effects: [] };
  }

  // 匹配 action（精确 → 物理属性推断 → 显式actions模糊匹配）
  let actionDef: FurnitureActionDef | undefined;

  // 先查显式 actions
  if (def.actions) {
    actionDef = def.actions[action];
    if (!actionDef) {
      for (const [key, val] of Object.entries(def.actions)) {
        if (action.includes(key) || key.includes(action)) { actionDef = val; break; }
      }
    }
  }

  // 如果显式 actions 没匹配到，尝试从物理属性推断
  if (!actionDef && def.physical && def.physical.length > 0) {
    const inferred = getActionsFromPhysical(def.physical);
    const matched = inferred.find(a => action.includes(a) || a.includes(action));
    if (matched) {
      actionDef = inferActionDefFromPhysical(def, matched);
    }
  }

  // 特殊：出来/不藏了 → unhide（任何家具都可用，玩家在躲藏时使用）
  if (!actionDef && (action === "出来" || action === "不藏了")) {
    actionDef = { effect: "unhide" };
  }

  // 特殊：躲进去/藏进去 → hide（容器可藏人时）
  if (!actionDef && (action === "躲进去" || action === "藏进去") && def.containers?.some(c => c.can_hold_person)) {
    actionDef = { effect: "hide" };
  }

  if (!actionDef) {
    const available = getAvailableActions(def, furnitureName).join("、");
    return { message: `不能这样操作${furnitureName}。可以：${available}`, narrative: "", effects: [] };
  }

  // 距离校验
  if (playerGridPos && roomCells) {
    const [px, py] = playerGridPos;
    let found = false;
    for (let y = Math.max(0, py - 1); y <= Math.min(roomCells.length - 1, py + 1); y++) {
      for (let x = Math.max(0, px - 1); x <= Math.min((roomCells[y]?.length || 0) - 1, px + 1); x++) {
        if (roomCells[y]?.[x]?.furniture === furnitureName) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) {
      return { message: `你离${furnitureName}太远了，走近一点再操作。`, narrative: "", effects: [] };
    }
  }

  return await applyEffect(actionDef, gameState, def);
}

/** 从物理属性 + 动作名推断 FurnitureActionDef */
function inferActionDefFromPhysical(def: FurnitureDef, action: string): FurnitureActionDef {
  // 坐/躺 → rest
  if (action === "坐下" || action === "躺下" || action === "睡觉") {
    const reduction = action === "睡觉" ? 25 : action === "躺下" ? 15 : 8;
    return {
      effect: action === "睡觉" ? "sleep" : "rest",
      fatigue_reduction: reduction,
      hours: action === "睡觉" ? 8 : undefined,
      restore_hp: action === "睡觉" ? "full" : undefined,
      restore_fatigue: action === "睡觉" ? "full" : undefined,
    };
  }
  // 打开/关闭 → toggle（如果有 switchable 属性）或 storage
  if ((action === "打开" || action === "关闭") && def.physical?.includes("switchable")) {
    return { effect: "toggle", stateKey: "isOn" };
  }
  if (action === "打开" && (def.physical?.includes("container") || def.physical?.includes("storage") || def.containers)) {
    return { effect: "storage" };
  }
  if (action === "关闭" && (def.physical?.includes("container"))) {
    return { effect: "toggle", stateKey: "isOpen" };
  }
  // 锁上/解锁 → lock/unlock
  if (action === "锁上" && def.physical?.includes("lockable")) {
    return { effect: "lock", key_id: def.state?.key_id };
  }
  if (action === "解锁" && def.physical?.includes("lockable")) {
    return { effect: "unlock", key_id: def.state?.key_id };
  }
  // 阅读/浏览 → study
  if ((action === "阅读" || action === "浏览") && def.physical?.includes("readable")) {
    return { effect: "study", skill: "智力", exp: 2, hours: 1 };
  }
  // 使用/操作 → narrative（interface/machine）
  if ((action === "使用" || action === "操作") && (def.physical?.includes("interface") || def.physical?.includes("machine"))) {
    return { effect: "narrative" };
  }
  // 藏东西 → toggle
  if (action === "藏东西" && def.physical?.includes("concealable")) {
    return { effect: "narrative", narrative: "你把东西藏好了。" };
  }
  // 爬 → climb
  if (action === "爬" && def.physical?.includes("climbable")) {
    return { effect: "climb", climb_dc: 12 };
  }
  // 捡起 → pickup
  if (action === "捡起" && def.physical?.includes("pickupable")) {
    return { effect: "pickup" };
  }
  // 放东西/取东西 → storage（container/surface/storage）
  if ((action === "放东西" || action === "取东西") && (def.physical?.includes("container") || def.physical?.includes("surface") || def.physical?.includes("storage"))) {
    return { effect: "storage" };
  }
  // 制作 → craft
  if (action === "制作" && def.physical?.includes("craftable")) {
    return { effect: "craft" };
  }
  // 躲进去/藏进去 → hide（容器 can_hold_person）
  if ((action === "躲进去" || action === "藏进去") && def.containers?.some(c => c.can_hold_person)) {
    return { effect: "hide" };
  }
  // 出来/不藏了 → unhide
  if ((action === "出来" || action === "不藏了")) {
    return { effect: "unhide" };
  }
  // fallback: narrative
  return { effect: "narrative" };
}

async function applyEffect(def: FurnitureActionDef, gs: GameState, furnitureDef?: FurnitureDef | null): Promise<FurnitureResult> {
  const effects: string[] = [];
  let narrative = def.narrative || "";

  switch (def.effect) {
    case "rest": {
      const reduction = def.fatigue_reduction || 10;
      gs.player.fatigue = Math.max(0, (gs.player.fatigue ?? 0) - reduction);
      effects.push(`疲劳 -${reduction}`);
      if (!narrative) narrative = "你休息了一会儿，感觉好多了。";
      break;
    }
    case "sleep": {
      const hours = def.hours || 8;
      const { advanceTime } = await import("./time.ts");
      gs.time = advanceTime(gs.time, Math.ceil(hours / 24) || 1);
      if (def.restore_hp === "full") gs.player.hp.current = gs.player.hp.max;
      else if (typeof def.restore_hp === "number") gs.player.hp.current = Math.min(gs.player.hp.max, gs.player.hp.current + def.restore_hp);
      if (def.restore_fatigue === "full") gs.player.fatigue = 0;
      else if (typeof def.restore_fatigue === "number") gs.player.fatigue = Math.max(0, (gs.player.fatigue ?? 0) - def.restore_fatigue);
      const { stampRoom } = await import("./state.ts");
      stampRoom();
      effects.push(`时间推进`, `HP恢复`, `体力恢复`);
      if (!narrative) narrative = `睡了 ${hours} 小时后醒来，精力充沛。`;
      break;
    }
    case "train": {
      if (def.skill && def.exp) {
        const { addSkillExp } = await import("./state.ts");
        addSkillExp(def.skill, def.exp);
        effects.push(`${def.skill} 经验 +${def.exp}`);
      }
      if (!narrative) narrative = "练习了一会儿。";
      break;
    }
    case "shop": {
      // 连接 shops.json：返回货架物品列表供 LLM 调 buy_item
      // 优先级：runtime覆盖(gameState.shops) > worldpack文件 > data/默认
      const shopType = def.shop_type || "便利店";
      let itemList: string[] = [];

      // 1. 先查运行时货架（restock_shop 写入的）
      if ((gs as any).shops?.[shopType]) {
        itemList = (gs as any).shops[shopType].items || [];
      }
      // 2. runtime 里没有精确匹配，模糊匹配
      if (itemList.length === 0 && (gs as any).shops) {
        const runtimeMatch = Object.entries((gs as any).shops).find(([k]) =>
          shopType.includes(k) || (k as string).includes(shopType)
        );
        if (runtimeMatch) itemList = (runtimeMatch[1] as any).items || [];
      }
      // 3. 回退到 shops 变量（worldpack 或 data/shops.json）
      if (itemList.length === 0) {
        try {
          const { shops } = await import("./state.ts");
          const shelf = shops[shopType] || Object.entries(shops).find(([k]) =>
            shopType.includes(k as string) || (k as string).includes(shopType)
          )?.[1] || shops["便利店"];
          itemList = shelf?.items || [];
        } catch (_) {}
      }
      const itemStr = itemList.length > 0 ? `货架: ${itemList.join("、")}` : "货架空";
      if (!narrative) narrative = itemStr;
      effects.push(`打开商店: ${shopType} (${itemList.length}种商品)`);
      break;
    }
    case "storage": {
      // 如果家具有 containers 定义，列出容器信息
      if (furnitureDef?.containers && furnitureDef.containers.length > 0) {
        const containerDescs = furnitureDef.containers.map(c => {
          const locked = (furnitureDef.state?.[`locked_${c.id}`] ?? furnitureDef.state?.locked) ? "🔒" : "";
          return `${locked}${c.id}(${c.max_volume}L/${c.max_weight}kg)`;
        });
        effects.push(`容器: ${containerDescs.join(", ")}`);
      } else {
        effects.push("打开储物界面");
      }
      break;
    }
    case "narrative": {
      break;
    }

    // ── 7 种新效果类型（物理属性系统）──

    case "toggle": {
      const key = def.stateKey || "isOn";
      const current = furnitureDef?.state?.[key] ?? false;
      const newVal = !current;
      if (furnitureDef?.state) {
        furnitureDef.state[key] = newVal;
      }
      const stateWord = newVal ? "打开" : "关闭";
      effects.push(`${key}: ${!current} → ${newVal}`);
      if (!narrative) narrative = `你${stateWord}了开关。`;
      break;
    }

    case "lock": {
      const keyId = def.key_id || furnitureDef?.state?.key_id;
      if (!furnitureDef?.state) {
        return { message: "这个家具没有可锁的部件。", narrative: "", effects: [] };
      }
      // 检查玩家是否有匹配钥匙
      const hasKey = keyId ? gs.player.inventory.some((i: any) => i.name === keyId || i.effects?.some((e: any) => e.type === "key" && e.value === keyId)) : true;
      if (!hasKey && keyId) {
        return { message: `你没有${keyId}，无法上锁。`, narrative: "钥匙不匹配。", effects: [] };
      }
      furnitureDef.state.locked = true;
      effects.push("已上锁");
      if (!narrative) narrative = "咔哒一声，锁上了。";
      break;
    }

    case "unlock": {
      const keyId = def.key_id || furnitureDef?.state?.key_id;
      if (!furnitureDef?.state) {
        return { message: "这个家具没有可锁的部件。", narrative: "", effects: [] };
      }
      if (!furnitureDef.state.locked) {
        return { message: "已经是解锁状态。", narrative: "", effects: [] };
      }
      // 检查钥匙匹配
      const hasKey = keyId ? gs.player.inventory.some((i: any) => i.name === keyId || i.effects?.some((e: any) => e.type === "key" && e.value === keyId)) : true;
      if (hasKey) {
        furnitureDef.state.locked = false;
        effects.push("已解锁（钥匙）");
        if (!narrative) narrative = "钥匙一转，锁开了。";
      } else {
        // DEX 技能检定（撬锁）—— 装备加成 + 技能
        const { check } = await import("./dice.ts");
        const { getEquipmentBonus } = await import("./state.ts");
        const dex = gs.player.attributes.敏捷 + getEquipmentBonus(gs.player.equipment, "attribute_bonus", "敏捷");
        const lockpickLv = (gs.player.skills["开锁"]?.level || 0) + getEquipmentBonus(gs.player.equipment, "skill_bonus", "开锁");
        const dc = 14;
        const result = check("普通", dex, lockpickLv, dc);
        if (result.success) {
          furnitureDef.state.locked = false;
          effects.push(`已解锁（撬锁 DC${dc} 成功）`);
          if (!narrative) narrative = "你小心翼翼地撬开了锁。";

          // 察觉检定：撬锁有声音，可能被附近 NPC 听到
          const { getNearbyNPCs, gameState: gs2 } = await import("./state.ts");
          const { perceptionCheck } = await import("./perception.ts");
          const nearby = getNearbyNPCs(gs2.player.location, gs2.player.gridPos || [0, 0], 10);
          for (const npc of nearby) {
            const npcState = gs2.npcs[npc.name];
            if (!npcState) continue;
            const obs = {
              attributes: npcState.attributes as Record<string, number>,
              skills: npcState.skills as Record<string, { level: number }>,
              equipment: npcState.equipment,
            };
            const act = {
              attributes: gs2.player.attributes as Record<string, number>,
              skills: gs2.player.skills as Record<string, { level: number }>,
              equipment: gs2.player.equipment,
              concealed: gs2.player.concealed ?? false,
            };
            const ctx = { distance_m: npc.distance, noise: "quiet" as const, light: "dim" as const, walls_between: npc.walls };
            const pcr = perceptionCheck(act, obs, ctx);
            if (pcr.heard) {
              effects.push(`⚠️ ${npc.name}听到了撬锁声`);
              narrative += ` 但${npc.name}似乎听到了什么动静...`;
              break;
            }
          }
        } else {
          effects.push(`撬锁失败（DC${dc}）`);
          if (!narrative) narrative = "锁纹丝不动，可能需要钥匙或者更高的开锁技能。";
        }
      }
      break;
    }

    case "study": {
      const hours = def.hours || 1;
      const skill = def.skill || "智力";
      const exp = def.exp || 2;
      const requiredItem = def.requires_item;

      // 检查是否需要特定物品（如教科书）
      if (requiredItem) {
        const hasItem = gs.player.inventory.some((i: any) => i.name === requiredItem || i.name.includes(requiredItem));
        if (!hasItem) {
          return { message: `你需要${requiredItem}才能学习。`, narrative: "没有合适的学习材料。", effects: [] };
        }
      }

      // 推进时间
      const { advanceMinutes } = await import("./time.ts");
      gs.time = advanceMinutes(gs.time, hours * 60);
      const { addSkillExp } = await import("./state.ts");
      addSkillExp(skill, exp);
      effects.push(`时间 +${hours}h`, `${skill} 经验 +${exp}`);
      if (!narrative) narrative = `你专注学习了 ${hours} 小时，${skill}经验增加了。`;
      break;
    }

    case "craft": {
      const consumes = def.consumes || [];
      const produces = def.produces;
      if (!produces) {
        return { message: "制作配方没有指定产物。", narrative: "", effects: [] };
      }

      // 检查材料
      const missing: string[] = [];
      const invNames = gs.player.inventory.map((i: any) => i.name);
      for (const mat of consumes) {
        if (!invNames.some((n: string) => n === mat || n.includes(mat))) {
          missing.push(mat);
        }
      }
      if (missing.length > 0) {
        return { message: `缺少材料: ${missing.join("、")}`, narrative: "材料不足。", effects: [] };
      }

      // 消耗材料
      for (const mat of consumes) {
        const idx = gs.player.inventory.findIndex((i: any) => i.name === mat || i.name.includes(mat));
        if (idx >= 0) gs.player.inventory.splice(idx, 1);
      }

      // 添加产物
      gs.player.inventory.push({
        name: produces,
        type: "tool",
        slot: "back",
        weight: 1,
        effects: [],
        state: "intact",
      });
      effects.push(`消耗: ${consumes.join("、")}`, `获得: ${produces}`);
      if (!narrative) narrative = `你制作了${produces}。`;
      break;
    }

    case "pickup": {
      // 计算物品重量（从家具定义推断或用默认值）
      const itemWeight = furnitureDef?.state?.weight ?? 5;
      const maxCarry = gs.player.attributes.力量 * 3; // STR*3 简单负重上限
      const { calcCurrentWeight } = await import("./state.ts");
      const curWeight = calcCurrentWeight(gs.player.inventory, gs.player.equipment);
      if (curWeight + itemWeight > maxCarry) {
        return {
          message: `你的负重不足（当前 ${curWeight.toFixed(1)}kg / 上限 ${maxCarry}kg），无法捡起此物品（重 ${itemWeight}kg）。`,
          narrative: "太重了，拿不动。",
          effects: []
        };
      }

      // 从格子移除家具，加入背包
      gs.player.inventory.push({
        name: furnitureDef?.state?.itemName || "捡起的物品",
        type: "tool",
        slot: "back",
        weight: itemWeight,
        effects: [],
        state: "intact",
      });

      effects.push(`获得物品`, `负重 +${itemWeight}kg`);
      if (!narrative) narrative = `你捡起了物品，放进了背包。`;

      // 察觉检定：搬东西是大动作，可能被附近 NPC 看到
      const { getNearbyNPCs: gn2, gameState: gs3 } = await import("./state.ts");
      const { perceptionCheck: pc2 } = await import("./perception.ts");
      const nearby2 = gn2(gs3.player.location, gs3.player.gridPos || [0, 0], 10);
      for (const npc of nearby2) {
        const npcState = gs3.npcs[npc.name];
        if (!npcState) continue;
        const obs = {
          attributes: npcState.attributes as Record<string, number>,
          skills: npcState.skills as Record<string, { level: number }>,
          equipment: npcState.equipment,
        };
        const act = {
          attributes: gs3.player.attributes as Record<string, number>,
          skills: gs3.player.skills as Record<string, { level: number }>,
          equipment: gs3.player.equipment,
          concealed: gs3.player.concealed ?? false,
        };
        const ctx = { distance_m: npc.distance, noise: "normal" as const, light: "dim" as const, walls_between: npc.walls };
        const pcr = pc2(act, obs, ctx);
        if (pcr.seen) {
          effects.push(`⚠️ ${npc.name}看到你搬东西`);
          narrative += ` ${npc.name}注意到了你的动作。`;
          break;
        }
      }
      break;
    }

    case "climb": {
      const dc = def.climb_dc || 12;
      const { check } = await import("./dice.ts");
      const { getEquipmentBonus } = await import("./state.ts");
      const str = gs.player.attributes.力量 + getEquipmentBonus(gs.player.equipment, "attribute_bonus", "力量");
      const athleticsLv = (gs.player.skills["运动"]?.level || gs.player.skills["攀爬"]?.level || 0) + getEquipmentBonus(gs.player.equipment, "skill_bonus", "运动");
      const result = check("普通", str, athleticsLv, dc);
      if (result.success) {
        effects.push(`攀爬 DC${dc} 成功`);
        if (!narrative) narrative = "你成功爬了上去。";
      } else {
        effects.push(`攀爬 DC${dc} 失败`);
        if (!narrative) narrative = "你没能爬上去，可能需要更多力量或技巧。";
      }
      break;
    }

    case "hide": {
      // 检查容器是否能装人（≈70L 最小容积）
      const personContainer = furnitureDef?.containers?.find(c => c.can_hold_person);
      if (!personContainer) {
        return { message: "这个容器不能藏人。", narrative: "空间不够，藏不进去。", effects: [] };
      }
      if (personContainer.max_volume < 70) {
        return { message: `这个容器容积只有${personContainer.max_volume}L，藏不了一个人（需≈70L）。`, narrative: "空间太小了，藏不进去。", effects: [] };
      }
      // 检查是否已锁（锁着的容器不能从外部进入）
      const lockedVal = furnitureDef?.state?.[`locked_${personContainer.id}`] ?? furnitureDef?.state?.locked;
      if (lockedVal) {
        return { message: "容器是锁着的，不能躲进去。", narrative: "锁着进不去。", effects: [] };
      }
      gs.player.concealed = true;
      gs.player.hiding_in = furnitureDef?.state?.itemName || "藏身容器";
      effects.push("躲藏状态: ON");
      if (!narrative) narrative = "你悄悄地躲了进去，把自己藏好了。";
      break;
    }

    case "unhide": {
      if (!gs.player.concealed) {
        return { message: "你本来就没有躲藏。", narrative: "你不在躲藏状态。", effects: [] };
      }
      gs.player.concealed = false;
      gs.player.hiding_in = undefined;
      effects.push("躲藏状态: OFF");
      if (!narrative) narrative = "你从藏身处出来了。";
      break;
    }

    default:
      break;
  }

  return { message: narrative, narrative, effects };
}
