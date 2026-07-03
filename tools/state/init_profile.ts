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

/** 生成结构化缺口报告 */
function buildGapReport(gs: any, activeWorld: string, appliedProfileId?: string, charCorrected?: boolean): string {
  const lines: string[] = [];

  // ✅ 已填充
  const filled: string[] = [];
  const eqCount = Object.keys(gs.player.equipment || {}).length;
  filled.push(`装备(${eqCount}件)`);
  filled.push(`资金(¥${gs.player.funds})`);
  if (appliedProfileId) filled.push(`身份模板(${appliedProfileId})`);
  const flagCount = Object.keys(gs.flags || {}).length;
  if (flagCount > 0) filled.push(`flags(${flagCount}个)`);
  const skillCount = Object.keys(gs.player.skills || {}).length;
  if (skillCount > 0) filled.push(`技能(${skillCount}项)`);
  const abilityCount = Object.keys(gs.player.abilities || {}).length;
  if (abilityCount > 0) filled.push(`能力(${abilityCount}项)`);
  if (gs.player.resourcePools && Object.keys(gs.player.resourcePools).length > 0) {
    filled.push(`资源池(${Object.keys(gs.player.resourcePools).length}个)`);
  }
  const relCount = Object.keys(gs.player.relationships || {}).length;
  if (relCount > 0) filled.push(`社会关系(${relCount}条)`);
  const propCount = Object.keys(gs.player.properties || {}).length;
  if (propCount > 0) filled.push(`住宅(${propCount}处)`);
  lines.push(`✅ 已填充: ${filled.join(" / ")}`);

  // ⚠️ 部分填充
  const partial: string[] = [];
  if (eqCount <= 2) partial.push("装备(仅内衣，需外衣/工具)");
  if ((gs.player.inventory || []).length === 0) partial.push("背包(空)");
  if (gs.player.funds <= 1000) partial.push("资金(可能不足)");
  if (partial.length > 0) lines.push(`⚠️ 部分填充: ${partial.join(" / ")}`);

  // ❌ 未填充
  const missing: string[] = [];
  const tools: string[] = [];
  if (skillCount === 0) { missing.push("技能(0项)"); tools.push("grant_skill_exp"); }
  if (abilityCount === 0) { missing.push("能力(0项)"); }
  if (!gs.player.resourcePools || Object.keys(gs.player.resourcePools).length === 0) { missing.push("资源池(无)"); }
  if (propCount === 0) { missing.push("住宅(无)"); tools.push("instantiate_residence 或 create_room"); }
  if (relCount === 0) { missing.push("社会关系(0条)"); tools.push("adjust_relation"); }
  if (Object.keys(gs.npcs || {}).length === 0) { missing.push("通讯录/NPC(0人)"); tools.push("create_character / spawn_npc_agent"); }
  if (Object.keys(gs.flags || {}).length <= 1) { missing.push("身份flags(几乎空)"); tools.push("set_flags"); }
  if (!gs.player.public_identity) { missing.push("公开身份(无)"); }

  // 检查玩家 NPC 的记忆
  const playerNpc = gs.npcs?.[gs.player.name];
  const memCount = playerNpc?.memoryTags?.length || 0;
  if (memCount === 0) { missing.push("记忆(0条)"); tools.push("add_memory_tag"); }

  if (Object.keys(gs.quests || {}).length === 0) { missing.push("任务(0个)"); }

  if (missing.length > 0) lines.push(`❌ 未填充: ${missing.join(" / ")}`);

  const uniqueTools = [...new Set(tools)];
  if (uniqueTools.length > 0) {
    lines.push(`→ 建议工具: ${uniqueTools.join(", ")}`);
  }

  // 模板是通用起点——如果没自动合并角色数据，提醒 LLM 微调
  if (!charCorrected) {
    lines.push(`→ ⚠️ 模板仅提供通用基线。角色特有差异（体型/技能/标签/装备配件/社团/班级）需 GM 用工具微调。`);
    lines.push(`   常用微调: lookup_character(核实原作设定), spawn_item(眼镜等配件), grant_skill_exp(特有技能), set_flags(中二病/社团标签)`);
  } else {
    lines.push(`→ ✅ 角色数据库已自动修正体型/属性/技能。剩余缺口见下方 ❌ 列表。`);
  }

  // 列出可用模板
  try {
    const wpPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "init_profiles.json");
    if (fs.existsSync(wpPath)) {
      const profiles = JSON.parse(fs.readFileSync(wpPath, "utf-8"));
      const ids = Object.keys(profiles).filter(k => !k.startsWith("_"));
      if (ids.length > 0) {
        lines.push(`→ 可用身份模板: ${ids.join(", ")}`);
      }
    }
  } catch {}

  return lines.join("\n");
}

export default {
  name: "init_profile", label: "身份模板",
  description: "应用初始身份模板。装备/资金/技能/关系/联系人/记忆/住宅。",
  parameters: Type.Object({
    profileId: Type.String({ description: "模板ID，如 千叶市高中生。不传则列出可用模板" }),
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
      // 无匹配模板 → 列出可用模板 + 缺口报告
      const availableIds = Object.keys(profiles).filter(k => !k.startsWith("_"));
      const gapReport = buildGapReport(gameState, activeWorld);
      const lines = [
        `未找到身份模板: ${params.profileId}`,
        availableIds.length > 0 ? `可用模板: ${availableIds.join(", ")}` : "当前世界包无身份模板",
        ``,
        `当前角色缺口:`,
        gapReport,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
    }

    try {
      validateProfile(params.profileId, profile);
    } catch (e: any) {
      return { content: [{ type: "text", text: `身份模板无效: ${e.message || String(e)}` }], details: {} };
    }

    const playerSnapshot = structuredClone(gameState.player);
    const flagsSnapshot = structuredClone(gameState.flags);
    try {
      // ── 兜底：init_profile 独立使用时，确保玩家至少有内衣+手机 ──
      if (!gameState.player.equipment.inner_top && !gameState.player.equipment.inner_bot) {
        const defaultUnderwear = (await import("../../engine/state.ts")).defaultUnderwear;
        if (defaultUnderwear) {
          const uw = defaultUnderwear(gameState.player.gender || "男");
          if (uw.inner_top) gameState.player.equipment.inner_top = uw.inner_top;
          if (uw.inner_bot) gameState.player.equipment.inner_bot = uw.inner_bot;
        }
      }
      // 确保手机存在
      const hasPhone = gameState.player.inventory.some((i: any) =>
        i.name?.includes("手机") || i.effects?.some((e: any) => e.type === "communication")
      );
      if (!hasPhone) {
        gameState.player.inventory.push({
          name: "手机", type: "tool", slot: "right_hand", weight: 0.2, volume: 0.2,
          effects: [{ type: "communication" }], state: "intact",
        });
      }

      // ── 资金 / 身份 / 头衔 / flags ──
      if (typeof profile.funds === "number") gameState.player.funds = profile.funds;
      if (profile.public_identity) gameState.player.public_identity = profile.public_identity;
      if (Array.isArray(profile.titles)) gameState.player.titles = [...profile.titles];
      if (profile.flags && typeof profile.flags === "object") {
        for (const [k, v] of Object.entries(profile.flags)) gameState.flags[k] = v as any;
      }

      // ── 装备 ──（叠加而非覆盖——保留 init_game 的兜底内衣）
      if (profile.equipment) {
        for (const [slot, item] of Object.entries(profile.equipment)) {
          gameState.player.equipment[slot as any] = normalizeItem(item, `equipment.${slot}`);
        }
        gameState.player.ac = calcAC(gameState.player.attributes.敏捷, gameState.player.equipment);
      }

      // ── 背包 ──（叠加不覆盖——保留 init_game 的兜底物品如手机）
      if (profile.inventory) {
        const existingNames = new Set(gameState.player.inventory.map((i: any) => i.name));
        for (const [idx, item] of (profile.inventory as any[]).entries()) {
          if (!existingNames.has(item.name)) {
            gameState.player.inventory.push(normalizeItem(item, `inventory[${idx}]`));
          }
        }
      }

      // ── 技能 ──
      if (profile.skills && typeof profile.skills === "object") {
        gameState.player.skills = {};
        for (const [name, level] of Object.entries(profile.skills)) {
          gameState.player.skills[name] = normalizeSkill(level);
        }
      }

      // ── 能力 + 资源池 ──
      if (profile.abilities && typeof profile.abilities === "object") {
        gameState.player.abilities = {};
        for (const [name, value] of Object.entries(profile.abilities)) {
          gameState.player.abilities[name] = normalizeAbility(name, value);
        }
      }
      const resourcePools = normalizeResourcePools(profile.resourcePools);
      if (resourcePools) gameState.player.resourcePools = resourcePools as any;

      // ── 社会关系 ──
      if (profile.relationships && typeof profile.relationships === "object") {
        gameState.player.relationships = {};
        for (const [npcName, relData] of Object.entries(profile.relationships)) {
          const rel = relData as any;
          gameState.player.relationships[npcName] = {
            stage: rel.stage || "熟人",
            affection: typeof rel.affection === "number" ? Math.max(0, Math.min(100, rel.affection)) : 20,
            romance: rel.romance || null,
            notes: rel.notes || rel.tag || "",
            history: [],
          };
        }
      }

      // ── 通讯录 ──
      try {
        const { getPlayerPhoneData, createDefaultPhoneData, syncContactsFromRelationships } = await import("../../engine/phone.ts");
        let pd = getPlayerPhoneData();
        // phoneData 可能还没初始化——懒创建
        if (!pd) {
          const phone = gameState.player.inventory.find((i: any) =>
            i.name?.includes("手机") || i.effects?.some((e: any) => e.type === "communication")
          );
          if (phone) {
            const { createDefaultPhoneData: cdp } = await import("../../engine/phone.ts");
            (phone as any).phoneData = cdp(gameState.player.name);
            pd = (phone as any).phoneData;
          }
        }
        if (pd) {
          // 从关系同步
          syncContactsFromRelationships(pd, 0);
          // 再从模板 contacts 补（避免只有关系、没灌模板联系人的盲区）
          if (Array.isArray(profile.contacts)) {
            for (const cname of profile.contacts) {
              if (!pd.contacts.some(c => c.name === cname)) {
                pd.contacts.push({ name: cname, relation: "同学", number: `090-${1000 + Math.floor(Math.random() * 9000)}-${1000 + Math.floor(Math.random() * 9000)}`, addedAt: gameState.time.game_date });
              }
            }
          }
          saveState();
        }
      } catch (e: any) {
        console.error("init_profile: 通讯录初始化失败", e.message || String(e));
      }

      // ── 记忆 ──
      if (profile.memories && Array.isArray(profile.memories)) {
        try {
          const { addMemoryTag } = stateMod;
          for (const mem of profile.memories) {
            if (mem && typeof mem.tag === "string") {
              addMemoryTag(
                gameState.player.name,
                mem.tag,
                typeof mem.expires === "number" ? mem.expires : 365,
                mem.tone,
                mem.priority,
                mem.emotional_valence,
                mem.related_npcs,
                mem.category
              );
            }
          }
        } catch (e: any) {
          console.error("init_profile: 记忆初始化失败", e.message || String(e));
        }
      }

      // ── 住宅 ──（走权威函数 instantiateResidenceAndIntegrate，与 instantiate_residence 工具同源）
      let hasResidence = false;
      if (profile.residenceTemplate && profile.residenceName) {
        const { instantiateResidenceAndIntegrate } = await import("../../engine/state-grid.ts");
        const r = instantiateResidenceAndIntegrate(profile.residenceTemplate, profile.residenceName, {
          movePlayerIn: true,
          playerRoom: profile.playerRoomInResidence,
        });
        if (!r.success) throw new Error(r.reason);
        hasResidence = true;
      }
      if (!hasResidence && profile.location) setPlayerLocation(profile.location);

      // ── 角色数据库自动合并：玩家名匹配世界包角色时，用原作数据覆盖模板 ──
      let charCorrections = "";
      try {
        const char = stateMod.findCharacter(gameState.player.name);
        if (char) {
          const corrections: string[] = [];
          // 体型——角色数据是权威源
          if (char.body && typeof char.body === "object") {
            const old = `${gameState.player.body.height_cm}cm/${gameState.player.body.weight_kg}kg/${gameState.player.body.build}`;
            gameState.player.body = { ...gameState.player.body, ...char.body };
            const b = gameState.player.body;
            const nu = `${b.height_cm}cm/${b.weight_kg}kg/${b.build}`;
            if (old !== nu) corrections.push(`体型: ${old} → ${nu}`);
          }
          // 属性
          if (char.attributes && typeof char.attributes === "object") {
            gameState.player.attributes = { ...gameState.player.attributes, ...char.attributes };
            corrections.push(`属性已按角色数据覆盖`);
          }
          // 技能合并（角色技能优先）
          if (char.skills && typeof char.skills === "object") {
            for (const [name, level] of Object.entries(char.skills)) {
              gameState.player.skills[name] = normalizeSkill(level);
            }
            corrections.push(`技能合并: ${Object.keys(char.skills).join(", ")}`);
          }
          // 标签→flags
          if (Array.isArray(char.tags)) {
            for (const tag of char.tags) {
              if (typeof tag === "string") gameState.flags[tag] = true;
            }
            corrections.push(`标签→flags: ${char.tags.join(", ")}`);
          }
          // 角色特有装备（不覆盖模板已设的槽位，跳过校验失败的装备）
          if (char.equipment && typeof char.equipment === "object") {
            const added: string[] = [];
            for (const [slot, item] of Object.entries(char.equipment)) {
              if (!gameState.player.equipment[slot as any] && item && typeof item === "object") {
                try {
                  gameState.player.equipment[slot as any] = normalizeItem(item, `character.equipment.${slot}`);
                  added.push(`${slot}:${(item as any).name || slot}`);
                } catch (e: any) {
                  corrections.push(`⚠️ 角色装备 ${slot} 数据不完整，跳过: ${e.message}`);
                }
              }
            }
            if (added.length > 0) corrections.push(`装备补全: ${added.join(", ")}`);
          }
          // 班级/社团→记忆
          const { addMemoryTag } = stateMod;
          if (char.schedule?.weekday_morning) {
            addMemoryTag(gameState.player.name, `班级: ${char.schedule.weekday_morning}`, 365, undefined, 2, "neutral", [], "fact");
          }
          if (char.schedule?.weekday_afternoon) {
            addMemoryTag(gameState.player.name, `社团: ${char.schedule.weekday_afternoon}`, 365, undefined, 2, "neutral", [], "fact");
          }
          if (char.personality_brief) {
            addMemoryTag(gameState.player.name, `性格: ${char.personality_brief.slice(0, 100)}`, 365, undefined, 2, "neutral", [], "fact");
          }
          // 重算 AC
          gameState.player.ac = calcAC(gameState.player.attributes.敏捷, gameState.player.equipment);

          if (corrections.length > 0) {
            charCorrections = `\n\n🔧 角色数据库自动修正 (${gameState.player.name}):\n  ` + corrections.join("\n  ");
          }
        }
      } catch (e: any) {
        console.error("init_profile: 角色数据自动合并失败", e.message || String(e));
      }

      saveState();

      // ── 生成报告 ──
      const wasCharCorrected = charCorrections.length > 0;
      const gapReport = buildGapReport(gameState, activeWorld, params.profileId, wasCharCorrected);
      const summary = [
        `已应用身份模板: ${params.profileId} (${profile.label})`,
        ``,
        gapReport,
        charCorrections,
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: summary }], details: { profileId: params.profileId } };
    } catch (e: any) {
      console.error("init_profile: 应用身份模板失败，已回滚玩家状态", e?.message || String(e), e?.stack);
      gameState.player = playerSnapshot;
      gameState.flags = flagsSnapshot;
      saveState();
      return { content: [{ type: "text", text: `应用身份模板失败: ${e.message || String(e)}` }], details: {} };
    }
  },
};
