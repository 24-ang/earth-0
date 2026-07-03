import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";

type ProfileMap = Record<string, any>;

function readJsonIfExists(file: string): any | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function loadProfiles(activeWorld: string): ProfileMap {
  const fallbackPath = path.resolve(process.cwd(), "data", "init_profiles.json");
  const worldPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "init_profiles.json");
  const fallback = readJsonIfExists(fallbackPath) || {};
  const worldProfiles = readJsonIfExists(worldPath);
  return worldProfiles || fallback;
}

function normalizeItem(raw: any, where: string): any {
  if (!raw || typeof raw !== "object") throw new Error(`${where} 必须是物品对象`);
  const missing: string[] = [];
  for (const key of ["name", "type", "slot"]) {
    if (!raw[key] || typeof raw[key] !== "string") missing.push(key);
  }
  for (const key of ["weight", "volume"]) {
    if (typeof raw[key] !== "number" || raw[key] < 0) missing.push(key);
  }
  if (missing.length > 0) throw new Error(`${where} 缺少必填字段: ${missing.join(", ")}`);
  return {
    ...raw,
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    state: raw.state || "intact",
  };
}

function normalizeSkill(level: any) {
  const lv = Math.max(0, Math.min(10, Number(level) || 0));
  return { level: lv, exp: 0, nextLevel: Math.max(1, lv) * 10 };
}

function normalizeAbility(name: string, value: any) {
  if (typeof value === "object" && value) {
    const level = Math.max(0, Math.min(10, Number(value.level) || 0));
    return {
      name,
      level,
      exp: Number(value.exp) || 0,
      nextLevel: Number(value.nextLevel) || Math.max(1, level + 1) * 10,
      cooldownRemaining: Number(value.cooldownRemaining) || 0,
    };
  }
  const level = Math.max(0, Math.min(10, Number(value) || 0));
  return { name, level, exp: 0, nextLevel: Math.max(1, level + 1) * 10, cooldownRemaining: 0 };
}

function normalizeResourcePools(raw: any) {
  if (!raw || typeof raw !== "object") return undefined;
  const pools: Record<string, { current: number; max: number }> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "number") {
      pools[name] = { current: value, max: value };
      continue;
    }
    if (!value || typeof value !== "object") throw new Error(`resourcePools.${name} 必须是数字或 {current,max}`);
    const current = Number((value as any).current);
    const max = Number((value as any).max);
    if (!Number.isFinite(current) || !Number.isFinite(max) || current < 0 || max < 0) {
      throw new Error(`resourcePools.${name} 缺少合法 current/max`);
    }
    pools[name] = { current, max };
  }
  return pools;
}

function validateProfile(profileId: string, profile: any) {
  if (!profile || typeof profile !== "object") throw new Error(`身份模板 ${profileId} 必须是对象`);
  if (!profile.label || !profile.description) throw new Error(`身份模板 ${profileId} 缺少 label/description`);
  if (profile.equipment) {
    for (const [slot, item] of Object.entries(profile.equipment)) normalizeItem(item, `equipment.${slot}`);
  }
  if (profile.inventory) {
    if (!Array.isArray(profile.inventory)) throw new Error("inventory 必须是数组");
    profile.inventory.forEach((item: any, idx: number) => normalizeItem(item, `inventory[${idx}]`));
  }
  normalizeResourcePools(profile.resourcePools);
}

export default {
  name: "init_profile", label: "身份模板",
  description: "应用初始身份模板。装备/资金/能力。",
  parameters: Type.Object({
    profileId: Type.String({ description: "模板ID，如 千叶市高中生" }),
  }),
  async execute(_id, params) {
    const stateMod = await import("../../engine/state.ts");
    const { gameState, saveState, setPlayerLocation, initPlayerGrid, calcAC } = stateMod;
    const activeWorld = gameState.activeWorld || "oregairu";
    let profiles: ProfileMap;
    try {
      profiles = loadProfiles(activeWorld);
    } catch (e: any) {
      return { content: [{ type: "text", text: `读取身份模板失败: ${e.message || String(e)}` }], details: {} };
    }

    const profile = profiles[params.profileId];
    if (!profile) {
      return { content: [{ type: "text", text: `未找到身份模板: ${params.profileId}` }], details: {} };
    }

    try {
      validateProfile(params.profileId, profile);
    } catch (e: any) {
      return { content: [{ type: "text", text: `身份模板无效: ${e.message || String(e)}` }], details: {} };
    }

    const playerSnapshot = structuredClone(gameState.player);
    const flagsSnapshot = structuredClone(gameState.flags);
    try {
      if (typeof profile.funds === "number") gameState.player.funds = profile.funds;
      if (profile.public_identity) gameState.player.public_identity = profile.public_identity;
      if (Array.isArray(profile.titles)) gameState.player.titles = [...profile.titles];
      if (profile.flags && typeof profile.flags === "object") {
        for (const [k, v] of Object.entries(profile.flags)) gameState.flags[k] = v as any;
      }
      if (profile.equipment) {
        gameState.player.equipment = {};
        for (const [slot, item] of Object.entries(profile.equipment)) {
          gameState.player.equipment[slot as any] = normalizeItem(item, `equipment.${slot}`);
        }
        gameState.player.ac = calcAC(gameState.player.attributes.敏捷, gameState.player.equipment);
      }
      if (profile.inventory) {
        gameState.player.inventory = profile.inventory.map((item: any, idx: number) => normalizeItem(item, `inventory[${idx}]`));
      }
      if (profile.skills && typeof profile.skills === "object") {
        gameState.player.skills = {};
        for (const [name, level] of Object.entries(profile.skills)) {
          gameState.player.skills[name] = normalizeSkill(level);
        }
      }
      if (profile.abilities && typeof profile.abilities === "object") {
        gameState.player.abilities = {};
        for (const [name, value] of Object.entries(profile.abilities)) {
          gameState.player.abilities[name] = normalizeAbility(name, value);
        }
      }
      const resourcePools = normalizeResourcePools(profile.resourcePools);
      if (resourcePools) gameState.player.resourcePools = resourcePools as any;

      let hasResidence = false;
      if (profile.residenceTemplate && profile.residenceName) {
        const { instantiateResidence } = await import("../../engine/state-grid.ts");
        const r = instantiateResidence(profile.residenceTemplate, profile.residenceName);
        if (!r.success) throw new Error(r.reason);
        hasResidence = true;
        // 注册导航
        if (!gameState.player.known_locations) gameState.player.known_locations = [];
        for (const roomName of r.rooms) {
          if (!gameState.player.known_locations.includes(roomName)) {
            gameState.player.known_locations.push(roomName);
          }
        }
        if (!gameState.player.known_locations.includes(profile.residenceName)) {
          gameState.player.known_locations.push(profile.residenceName);
        }
        // 注册房产
        const { residenceTemplates } = await import("../../engine/state.ts");
        const tmpl = residenceTemplates[profile.residenceTemplate];
        gameState.player.properties[profile.residenceName] = {
          propertyId: profile.residenceName,
          name: profile.residenceName,
          regionId: tmpl?.region || gameState.player.location,
          type: "own",
          arrears_days: 0,
          storage: [],
        };
        if (profile.playerRoomInResidence) {
          setPlayerLocation(`${profile.residenceName}${profile.playerRoomInResidence}`);
        }
      }
      // location 只在没有住宅时生效，避免覆盖 instantiateResidence 设定的房间位置
      if (!hasResidence && profile.location) setPlayerLocation(profile.location);
      initPlayerGrid();
      saveState();

      const summary = [
        `已应用身份模板: ${params.profileId} (${profile.label})`,
        `装备${Object.keys(gameState.player.equipment || {}).length}件`,
        `背包${gameState.player.inventory.length}件`,
        `flags${Object.keys(profile.flags || {}).length}个`,
        ``,
        `GM提示: 玩家当前通讯录为空、关系为空、记忆为空——这些是叙事内容，需由GM根据身份描述构建。`,
        `可用工具: create_character(创建角色), lookup_character(查阅已有角色), spawn_npc_agent(激活NPC), adjust_relation(建立关系), add_memory_tag(添加记忆)。`,
        `世界包中已有角色无需重建——不存在于数据库的角色可以自由创建。`,
      ].join("\n");
      return { content: [{ type: "text", text: summary }], details: { profileId: params.profileId } };
    } catch (e: any) {
      gameState.player = playerSnapshot;
      gameState.flags = flagsSnapshot;
      saveState();
      return { content: [{ type: "text", text: `应用身份模板失败: ${e.message || String(e)}` }], details: {} };
    }
  },
};
