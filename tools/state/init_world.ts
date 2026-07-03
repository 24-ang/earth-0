import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";

function readJsonIfExists(file: string): any | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/** 规范化日期：月日 → MM-DD */
function normalizeDate(raw: string): string {
  const m = raw.match(/(\d+)月(\d+)日/);
  if (m) return `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return raw;
}

export default {
  name: "init_world", label: "世界落地",
  description: "按身份 scheduleGroup 自动匹配角色→生成通讯录/关系/声望/记忆。在 init_profile 之后调用。",
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

    const scheduleGroup: string = profile.scheduleGroup || "";
    if (!scheduleGroup) {
      return { content: [{ type: "text", text: "该身份模板未定义 scheduleGroup，世界落地跳过" }], details: {} };
    }

    const results: string[] = [];

    // ── 加载角色池 ──
    const charsPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "characters.json");
    const allChars: any[] = readJsonIfExists(charsPath) || [];

    // ── 匹配角色 ──
    const matched: any[] = [];
    const groupPrefix = scheduleGroup.replace(/[学生教师员工社员]$/, ""); // "总武高学生" → "总武高"
    for (const ch of allChars) {
      const sg = ch.schedule_group || "";
      if (!sg) continue;
      // 精确匹配同 scheduleGroup → 核心社交圈
      if (sg === scheduleGroup) { matched.push({ ...ch, matchTier: "core" }); continue; }
      // 同前缀（同组织不同组，如 总武高教师 vs 总武高学生）→ 扩展社交圈
      if (groupPrefix && sg.startsWith(groupPrefix)) { matched.push({ ...ch, matchTier: "extended" }); }
    }

    if (matched.length === 0) {
      results.push(`该世界包中无 scheduleGroup="${scheduleGroup}" 的角色，社交网络为空`);
      saveState();
      return { content: [{ type: "text", text: results.join("。") }], details: { profileId: params.profileId } };
    }

    // ── 推导 relation 标签 ──
    const STUDENT_SGS = new Set(["高校生", "中学生", "小学生", "大学生"]);
    const WORKER_SGS = new Set(["上班族", "社会人"]);
    const TEACHER_SGS = new Set(["教师", "教职员"]);
    function deriveRelation(sg: string, tier: string): string {
      if (STUDENT_SGS.has(sg)) return "同学";
      if (TEACHER_SGS.has(sg)) return tier === "core" ? "同事" : "师长";
      if (WORKER_SGS.has(sg)) return "同僚";
      if (sg === "格斗家") return "同门";
      return tier === "core" ? "同伴" : "知人";
    }

    // ── 推导声望组 ──
    function deriveRepGroups(chars: any[]): string[] {
      const groups = new Set<string>();
      for (const ch of chars) {
        const sg = ch.schedule_group || "";
        if (STUDENT_SGS.has(sg)) { groups.add("学生"); groups.add("教职员"); }
        if (WORKER_SGS.has(sg)) groups.add("职场");
        if (sg === "格斗家") groups.add("武道");
      }
      if (groups.size === 0) groups.add("社会");
      return [...groups];
    }
    const repGroups = deriveRepGroups(matched);

    // ── 写入通讯录 ──
    let contactCount = 0;
    try {
      const { getPlayerPhoneData } = await import("../../engine/phone.ts");
      const pd = getPlayerPhoneData();
      if (pd) {
        for (const ch of matched) {
          if (pd.contacts.some((ec: any) => ec.name === ch.name)) continue;
          pd.contacts.push({
            name: ch.name,
            number: `090-${String(1000 + contactCount).padStart(4, "0")}-${String(5000 + contactCount).padStart(4, "0")}`,
            relation: deriveRelation(ch.schedule_group || "", ch.matchTier),
            addedAt: gameState.time.game_date,
          });
          contactCount++;
        }
        results.push(`通讯录 +${contactCount}人`);
      }
    } catch (e: any) {
      results.push(`通讯录初始化失败: ${e.message}`);
    }

    // ── 写入 NPC 关系 ──
    let relCount = 0;
    for (const ch of matched) {
      getOrCreateNPC(ch.name);
      const affection = ch.matchTier === "core" ? 10 : 5;
      gameState.player.relationships[ch.name] = {
        stage: "acquaintance",
        affection,
        romance: "none",
        notes: deriveRelation(ch.schedule_group || "", ch.matchTier),
      };
      relCount++;
    }
    results.push(`关系 +${relCount}人`);

    // ── 写入声望 ──
    for (const g of repGroups) {
      if (!(g in gameState.player.reputation)) gameState.player.reputation[g] = 0;
    }
    results.push(`声望: ${[...repGroups].join("、")}`);

    // ── 初始记忆：取日历中 game_date 前后 3 天的事件 ──
    const calPath = path.resolve(process.cwd(), "worldpacks", activeWorld, "calendar.json");
    const calendar: any[] = readJsonIfExists(calPath) || [];
    if (calendar.length > 0) {
      const gd = gameState.time.game_date; // "2018-04-07"
      const gdMMDD = gd.slice(5); // "04-07"
      let memCount = 0;
      for (const ev of calendar) {
        const evMMDD = normalizeDate(ev.date);
        if (!evMMDD) continue;
        if (evMMDD >= gdMMDD && evMMDD <= gdMMDD) {
          // 当天事件
          getOrCreateNPC(scheduleGroup);
          addMemoryTag(scheduleGroup, ev.text.slice(0, 60), 365, "期待", 2, "positive", undefined, "milestone");
          memCount++;
        }
      }
      if (memCount > 0) results.push(`记忆 +${memCount}条`);
    }

    saveState();

    return {
      content: [{ type: "text", text: `世界落地完成: ${results.join("，")}` }],
      details: { profileId: params.profileId, matchedCount: matched.length, scheduleGroup },
    };
  },
};
