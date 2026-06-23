/**
 * NPC 自主意图引擎 — 扫描 drives，产钩子/设 pendingOverride
 *
 * 设计原则：
 * - 纯引擎逻辑，零 tk
 * - 引擎不编故事——只产钩子，GM 决定叙事
 * - 和 checkAffectionDrivenHooks 同模式
 */

import { gameState, getOrCreateNPC, findCharacter, getNpcCurrentAge, isSameLocation } from "./state.ts";
import { injectDynamicEvent, removeDynamicEvent } from "./timeline.ts";
import { lookupRegion } from "./router.ts";

/** 判断 NPC 和玩家是否在同一区域（通过 region router 的 character 列表判断） */
function sameRegionAsPlayer(npcName: string): boolean {
  const p = gameState.player;
  const r = lookupRegion(p.location);
  return r.all_characters.includes(npcName);
}

/** 扫描所有 NPC 的 drives，条件满足时自动产钩子 */
export function checkDriveDrivenHooks(): void {
  const p = gameState.player;
  gameState.dynamicEvents ??= [];

  for (const [npcName, npc] of Object.entries(gameState.npcs)) {
    // 初始化 drives（如果还没有）
    if (!npc.current_drives || !npc.current_goal) {
      const src = findCharacter(npcName);
      if (src?.drives_by_age) {
        const age = getNpcCurrentAge(src.base_age || 16);
        const keys = Object.keys(src.drives_by_age).map(Number).sort((a, b) => a - b);
        let best = keys[0];
        for (const k of keys) { if (k <= age) best = k; else break; }
        const ageDrives = src.drives_by_age[String(best)];
        if (ageDrives) {
          npc.current_drives = [...ageDrives.drives];
          npc.current_goal = ageDrives.goal;
        }
      }
      if (!npc.current_drives) npc.current_drives = [];
      if (!npc.current_goal) npc.current_goal = "";
    }

    const drives = npc.current_drives || [];
    const eventId = `drive_${npcName}`;

    // 空 drives + 空 goal → 目标完成后的迷茫
    if (drives.length === 0 && !npc.current_goal && sameRegionAsPlayer(npcName)) {
      injectDynamicEvent({
        id: eventId,
        source: "engine",
        expires_days: 3,
        repeatable: false,
        hook: {
          source_npc: npcName,
          hook_text: `${npcName}最近好像没什么目标，有点迷茫`,
          urgency: "low",
        },
      });
      continue;
    }

    if (drives.length === 0) continue;

    // 检查是否应该产钩子
    let shouldHook = false;
    let hookText = "";

    for (const drive of drives) {
      // 驱动力需要玩家参与
      const playerKeywords = ["玩家", "朋友", "恋人", "同伴", "认可", "关注", "帮助", "证明", "复仇", "竞争"];
      const needsPlayer = playerKeywords.some(kw => drive.includes(kw));

      if (needsPlayer) {
        const rel = p.relationships[npcName];
        const affection = rel?.affection ?? 0;

        // 好感足够 + 同区域 → 产钩子
        if (affection >= 30 && sameRegionAsPlayer(npcName)) {
          shouldHook = true;
          hookText = `${npcName}似乎因为「${drive}」而有所行动——她/他当前的目标是「${npc.current_goal || drive}」`;
          break;
        }
      }

      // 驱动力涉及 NPC-NPC 互动
      for (const [otherName, otherNpc] of Object.entries(gameState.npcs)) {
        if (otherName === npcName) continue;
        if (drive.includes(otherName) && isSameLocation(npc.currentRoom, otherNpc.currentRoom)) {
          shouldHook = true;
          hookText = `${npcName}和${otherName}之间似乎有事要发生——「${drive}」`;
          break;
        }
      }
      if (shouldHook) break;
    }

    if (shouldHook) {
      injectDynamicEvent({
        id: eventId,
        source: "engine",
        expires_days: 4,
        repeatable: true,
        hook: {
          source_npc: npcName,
          hook_text: hookText,
          urgency: "low",
        },
      });
    } else {
      // 条件不满足 → 清理旧事件
      removeDynamicEvent(eventId);
    }
  }

  // 清理已消失 NPC 或空 drives 的事件
  for (const ev of [...gameState.dynamicEvents]) {
    if (ev.id.startsWith("drive_") && ev.source === "engine") {
      const name = ev.id.replace("drive_", "");
      const npc = gameState.npcs[name];
      if (!npc || (npc.current_drives || []).length === 0) {
        removeDynamicEvent(ev.id);
      }
    }
  }
}
