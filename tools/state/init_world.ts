import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";

function readJsonIfExists(file: string): any | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export default {
  name: "init_world", label: "世界落地",
  description: "按身份模板初始化软状态（通讯录/关系/声望/记忆/校历）。在 init_profile 之后调用。",
  parameters: Type.Object({
    profileId: Type.String({ description: "身份模板ID，如 千叶市高中生" }),
  }),
  async execute(_id, params) {
    const stateMod = await import("../../engine/state.ts");
    const { gameState, saveState, addMemoryTag, getOrCreateNPC } = stateMod;
    const activeWorld = gameState.activeWorld || "oregairu";

    // 加载 profile
    const fallbackPath = path.resolve(process.cwd(), "data", "init_profiles.json");
    const worldPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "init_profiles.json");
    const fallback = readJsonIfExists(fallbackPath) || {};
    const worldProfiles = readJsonIfExists(worldPath);
    const profiles = worldProfiles || fallback;
    const profile = profiles[params.profileId];
    if (!profile) {
      return { content: [{ type: "text", text: `未找到身份模板: ${params.profileId}` }], details: {} };
    }

    const results: string[] = [];

    // ── 通讯录 ──
    if (Array.isArray(profile.contacts) && profile.contacts.length > 0) {
      try {
        const { getPlayerPhoneData } = await import("../../engine/phone.ts");
        const pd = getPlayerPhoneData();
        if (pd) {
          for (const c of profile.contacts) {
            if (pd.contacts.some((ec: any) => ec.name === c.name)) continue;
            pd.contacts.push({
              name: c.name,
              number: c.number || "090-0000-0000",
              relation: c.relation || "未知",
              addedAt: gameState.time.game_date,
            });
          }
          results.push(`通讯录 +${profile.contacts.length}人`);
        }
      } catch (e: any) {
        results.push(`通讯录初始化失败: ${e.message}`);
      }
    }

    // ── NPC 关系 ──
    if (profile.relationships && typeof profile.relationships === "object") {
      let count = 0;
      for (const [npcName, rel] of Object.entries(profile.relationships)) {
        const r = rel as any;
        // 确保 NPC 存在
        getOrCreateNPC(npcName);
        gameState.player.relationships[npcName] = {
          stage: r.stage || "acquaintance",
          affection: Math.max(0, Math.min(100, Number(r.affection) || 0)),
          romance: r.romance || "none",
          notes: r.notes || "",
        };
        count++;
      }
      results.push(`关系 +${count}人`);
    }

    // ── 声望 ──
    if (profile.reputation && typeof profile.reputation === "object") {
      for (const [group, val] of Object.entries(profile.reputation)) {
        gameState.player.reputation[group] = Number(val) || 0;
      }
      results.push(`声望 +${Object.keys(profile.reputation).length}组`);
    }

    // ── 初始记忆 ──
    if (Array.isArray(profile.memories) && profile.memories.length > 0) {
      for (const mem of profile.memories) {
        const npcName = mem.npc || params.profileId; // 挂在身份模板名下
        getOrCreateNPC(npcName);
        addMemoryTag(npcName, mem.tag, mem.expiresDays || 365, mem.tone, mem.priority, mem.emotional_valence, mem.related_npcs, mem.category || "general");
      }
      results.push(`记忆 +${profile.memories.length}条`);
    }

    saveState();

    const summary = results.length > 0
      ? `世界落地完成: ${results.join("，")}`
      : "该模板无软状态配置，世界落地跳过";
    return { content: [{ type: "text", text: summary }], details: { profileId: params.profileId } };
  },
};
