/**
 * NPC 反应式日程越权系统 (Reactive Schedule Override System)
 *
 * 设计文档: npc_reaction_schedule_design.md
 *
 * 当玩家执行恶意行为时，自动为受影响的 NPC 写入 pendingOverride，
 * 触发四种行为模式：avoid（避让）、tail（尾随）、confront（对质）、setup（设局）。
 *
 * 由 registry.ts 的 withToolTracking wrapper 自动调用。
 */

import { gameState, getOrCreateNPC, saveState } from "./state.ts";

// ── 恶意工具→反应类型映射 ──
const REACTION_TABLE: Record<string, (params: any) => ReactionEntry[]> = {
  // 偷窃 → 受害者避开玩家，若抓到则报官
  steal_item: (params: any) => {
    const target = params?.target || params?.npc || params?.targetNpc;
    if (!target) return [];
    const npc = gameState.npcs[target];
    if (!npc) return [];

    // 检查是否被抓住（感知检定）
    const playerDex = gameState.player.attributes?.敏捷 ?? 8;
    const npcPer = npc.attributes?.感知 ?? 8;
    const caught = Math.random() * npcPer > Math.random() * playerDex;

    if (caught) {
      // 被抓：NPC 去找老师/警察报官
      return [{ npcName: target, mode: "confront", reason: "偷窃被抓", durationHours: 12, targetRoom: "職員室" }];
    }
    // 没被抓但 NPC 察觉异常
    const noticed = Math.random() * npcPer * 0.5 > 0.3;
    if (noticed) {
      return [{ npcName: target, mode: "avoid", reason: "察觉异常，心生警惕", durationHours: 6 }];
    }
    return [];
  },

  // 战斗攻击 → 受害者根据战力差反击或逃跑
  combat_action: (params: any) => {
    const target = params?.target || params?.npc;
    if (!target) return [];
    const npc = gameState.npcs[target];
    if (!npc) return [];

    const playerStr = gameState.player.attributes?.力量 ?? 8;
    const npcStr = npc.attributes?.力量 ?? 8;

    if (npcStr >= playerStr) {
      // NPC 战力不低于玩家 → 对质
      return [{ npcName: target, mode: "confront", reason: "遭受攻击，正面对抗", durationHours: 4 }];
    }
    // NPC 打不过 → 避让或摇人
    const hasConnections = checkNpcConnections(target);
    if (hasConnections) {
      return [{ npcName: target, mode: "setup", reason: "战力不足，寻求靠山帮忙", durationHours: 24, callAllies: true }];
    }
    return [{ npcName: target, mode: "avoid", reason: "受到攻击，远离危险", durationHours: 8 }];
  },

  // 亲密触碰 → 非自愿时触发避让或对质
  intimate_touch: (params: any) => {
    const target = params?.target || params?.npc || params?.targetNpc;
    if (!target) return [];
    const npc = gameState.npcs[target];
    if (!npc) return [];

    // 检查关系
    const rel = gameState.player.relationships?.[target];
    const affection = rel?.affection ?? 0;

    if (affection >= 6) {
      // 好感度高，不触发负面反应
      return [];
    }
    if (affection >= 3) {
      // 好感度中等，避让
      return [{ npcName: target, mode: "avoid", reason: "不适的身体接触", durationHours: 6 }];
    }
    // 好感度低 → 对质或报官
    return [{ npcName: target, mode: "confront", reason: "抗拒亲密触碰", durationHours: 8 }];
  },

  // 背叛组织 → 组织成员生成反制
  contribute_to_org: (params: any) => {
    if (params?.action !== "betray") return [];
    const orgId = params?.orgId;
    if (!orgId) return [];
    const org = gameState.organizations?.[orgId];
    if (!org) return [];

    const reactions: ReactionEntry[] = [];
    // 组织领袖和其他核心成员反应
    for (const member of (org.members || [])) {
      if (member.rank >= 5) {
        // 高层成员：设局对质
        reactions.push({
          npcName: member.npcName,
          mode: member.rank >= 8 ? "setup" : "confront",
          reason: `组织背叛: ${params?.details || "内部泄密"}`,
          durationHours: 24,
          targetRoom: org.coreLocation || undefined
        });
      } else if (member.rank >= 2) {
        // 普通成员：避让
        reactions.push({
          npcName: member.npcName,
          mode: "avoid",
          reason: `组织遭背叛，需要重新审视立场`,
          durationHours: 8
        });
      }
    }
    return reactions;
  },

  // 揭露秘密 → 涉密者避让或设局
  reveal_secret: (params: any) => {
    const target = params?.target || params?.npc || params?.targetNpc;
    if (!target) return [];
    const npc = gameState.npcs[target];
    if (!npc) return [];

    const npcInt = npc.attributes?.智力 ?? 8;
    if (npcInt >= 12) {
      // 高智 NPC：设局反制
      return [{ npcName: target, mode: "setup", reason: "秘密被揭露，策划反击", durationHours: 36, callAllies: true }];
    }
    // 普通 NPC：避让
    return [{ npcName: target, mode: "avoid", reason: "秘密被揭露，远离尴尬", durationHours: 8 }];
  },

  // 身份检查/跟踪 → 敏锐 NPC 反跟踪
  identity_check: (params: any) => {
    const target = params?.target || params?.npc;
    if (!target) return [];
    const npc = gameState.npcs[target];
    if (!npc) return [];

    const npcPer = npc.attributes?.感知 ?? 8;
    if (npcPer >= 14) {
      // 高感知 NPC：反向尾随
      return [{ npcName: target, mode: "tail", reason: "察觉被跟踪，反制监视", durationHours: 4 }];
    }
    return [];
  },
};

// ── 类型 ──
interface ReactionEntry {
  npcName: string;
  mode: "avoid" | "tail" | "confront" | "setup";
  reason: string;
  durationHours: number;
  targetRoom?: string;
  callAllies?: boolean;
}

// ── NPC 关系网检查 ──
function checkNpcConnections(npcName: string): boolean {
  // 检查 NPC 是否有高关系的好友或所属组织
  const npc = gameState.npcs[npcName];
  if (!npc) return false;

  // 检查组织隶属
  if (gameState.organizations) {
    for (const org of Object.values(gameState.organizations)) {
      if (org.members?.some((m: any) => m.npcName === npcName && m.rank >= 3)) {
        return true;
      }
    }
  }

  // 检查 NPC 关系网
  if (npc.npcRelationships) {
    for (const [, rel] of Object.entries(npc.npcRelationships)) {
      if (rel.stage === "好友" || rel.stage === "依赖") return true;
    }
  }

  return false;
}

// ── 核心入口 ──

/**
 * 处理玩家恶意行为后 NPC 的反应式日程越权。
 * 由 registry.ts 的 withToolTracking wrapper 在工具执行成功后调用。
 *
 * @param toolName 工具名（如 steal_item, combat_action, contribute_to_org）
 * @param params 工具参数
 * @returns 触发的反应条目列表（用于日志）
 */
export function processNpcReactions(toolName: string, params: any): ReactionEntry[] {
  const handler = REACTION_TABLE[toolName];
  if (!handler) return [];

  const reactions = handler(params || {});
  if (reactions.length === 0) return [];

  const applied: ReactionEntry[] = [];

  for (const entry of reactions) {
    try {
      const npc = getOrCreateNPC(entry.npcName);
      if (!npc) continue;

      const now = new Date(gameState.time.game_date);
      now.setHours(now.getHours() + entry.durationHours);
      const expiresAt = now.toISOString().slice(0, 10);

      // 确定 NPC 的目的地
      let location: string;
      switch (entry.mode) {
        case "avoid":
          // 避让：去离玩家远的地方
          location = findSafeHaven(entry.npcName, gameState.player.location);
          break;
        case "tail":
          // 尾随：去玩家所在或相邻房间
          location = gameState.player.location;
          break;
        case "confront":
          // 对质：去 targetRoom 或玩家所在地
          location = entry.targetRoom || gameState.player.location;
          break;
        case "setup":
          // 设局：去 targetRoom 或自己家
          location = entry.targetRoom || findNpcHome(entry.npcName) || gameState.player.location;
          break;
        default:
          location = entry.targetRoom || gameState.player.location;
      }

      const actionText: Record<string, string> = {
        avoid: "远离玩家",
        tail: "跟踪玩家",
        confront: "找玩家对质",
        setup: "策划反击/寻求帮助"
      };

      npc.pendingOverride = {
        location,
        action: actionText[entry.mode] || entry.reason,
        reason: `[NPC反应] ${entry.reason}`,
        expiresAt
      };

      // 如果有 callAllies，给关系好的 NPC 也发通知
      if (entry.callAllies) {
        callAlliesForNpc(entry.npcName, entry.reason);
      }

      applied.push(entry);
    } catch (e) {
      console.error(`processNpcReactions: failed for ${entry.npcName}:`, e);
    }
  }

  if (applied.length > 0) {
    saveState();
  }

  return applied;
}

// ── 辅助函数 ──

/** 找一个安全的避让地点 */
function findSafeHaven(npcName: string, playerLocation: string): string {
  const home = findNpcHome(npcName);
  if (home && home !== playerLocation) return home;

  // 尝试找一个不在场的地点
  const safeLocations = ["自宅", "職員室", "図書館", "コンビニ", "公園", "商店街"];
  for (const loc of safeLocations) {
    if (loc !== playerLocation) return loc;
  }
  return "自宅";
}

/** 查找 NPC 的"家" */
function findNpcHome(npcName: string): string | null {
  const npc = gameState.npcs[npcName];
  if (npc?.scheduleGroup?.includes("学生")) return "自宅";
  return null;
}

/** 通知 NPC 的好友们来帮忙 */
function callAlliesForNpc(npcName: string, reason: string): void {
  const npc = gameState.npcs[npcName];
  if (!npc?.npcRelationships) return;

  for (const [allyName, rel] of Object.entries(npc.npcRelationships) as [string, any][]) {
    if (rel.stage === "好友" || rel.stage === "依赖" || rel.stage === "信任") {
      try {
        const ally = getOrCreateNPC(allyName);
        if (!ally || ally.pendingOverride) continue; // 已有安排的跳过

        const now = new Date(gameState.time.game_date);
        now.setHours(now.getHours() + 8);
        ally.pendingOverride = {
          location: gameState.player.location,
          action: `帮助 ${npcName}: ${reason}`,
          reason: `[NPC反应-盟友支援] ${npcName} 需要帮助`,
          expiresAt: now.toISOString().slice(0, 10)
        };
      } catch (_) {}
    }
  }
}

/**
 * 获取最近触发的 NPC 反应摘要（供 Phase 3 渲染注入）
 */
export function getReactionSummary(): string {
  // 检查是否有 NPC 因为 reaction 被覆盖了日程
  const affected: string[] = [];
  for (const [name, npc] of Object.entries(gameState.npcs)) {
    if (npc.pendingOverride?.reason?.startsWith("[NPC反应]")) {
      affected.push(`${name}: ${npc.pendingOverride.action}（${npc.pendingOverride.reason}）`);
    }
  }
  if (affected.length === 0) return "";
  return `[NPC反应日志]\n${affected.join("\n")}`;
}
