/**
 * 手机引擎 — 通讯录/消息/通话/SNS/照片 物理层
 *
 * 宪法：引擎管物理约束（投递、存储、未读计数），LLM 管内容与时机。
 * 手机数据存在 Item.phoneData 上，不污染全局 GameState。
 *
 * 注意：所有函数接收 gameState 参数，避免 CJS 双实例导致静态 import 拿到旧引用。
 */

import type { Item, PhoneData, Contact, PhoneMessage, CallLogEntry, SnsPost, PhotoEntry, GameState } from "./types.ts";

const MAX_MESSAGES_PER_THREAD = 30;
const MAX_SNS_POSTS = 50;
const MAX_PHOTOS = 100;

// ── 手机定位 ──

/** 扫描玩家装备+背包，找到手机 Item（按通讯效果 + 名字兜底） */
export function getPlayerPhone(gameState: GameState): Item | null {
  const p = gameState.player;
  // 装备
  for (const item of Object.values(p.equipment)) {
    if (!item) continue;
    if (item.effects?.some((e: any) => e.type === "communication")) return item;
    if (item.name?.includes("手机")) return item;
  }
  // 背包
  for (const item of p.inventory) {
    if (!item) continue;
    if (item.effects?.some((e: any) => e.type === "communication")) return item;
    if (item.name?.includes("手机")) return item;
  }
  // 兜底：扫描所有装备+背包中 type="tool" 且带通讯关键字的物品
  for (const item of Object.values(p.equipment)) {
    if (item?.type === "tool" && (item.name?.includes("手机") || item.name?.includes("phone") || item.name?.includes("通讯"))) return item;
  }
  for (const item of p.inventory) {
    if (item?.type === "tool" && (item.name?.includes("手机") || item.name?.includes("phone") || item.name?.includes("通讯"))) return item;
  }
  return null;
}

/** 获取/懒初始化玩家手机的 phoneData。调用方负责 saveState()。 */
export function getPlayerPhoneData(gameState: GameState): PhoneData | null {
  const phone = getPlayerPhone(gameState);
  if (!phone) return null;
  if (!phone.phoneData) {
    phone.phoneData = createDefaultPhoneData(gameState.player.name);
    // 调用方负责 saveState()——本函数不再自动持久化，避免拿到错误的 saveState 闭包
  }
  return phone.phoneData;
}

export function createDefaultPhoneData(owner: string): PhoneData {
  return {
    owner,
    contacts: [],
    messages: [],
    callLog: [],
    snsPosts: [],
    photos: [],
    unreadCount: 0,
    lastCheckTime: null,
  };
}

// ── 通讯录 ──

export function addContact(gameState: GameState, pd: PhoneData, name: string, number: string, relation: string): Contact {
  const existing = pd.contacts.find(c => c.name === name);
  if (existing) return existing;
  const contact: Contact = { name, number, relation, addedAt: gameState.time.game_date };
  pd.contacts.push(contact);
  return contact;
}

/** 根据好感度自动同步通讯录：好感>=20可见，>=40可主动联系 */
export function syncContactsFromRelationships(gameState: GameState, pd: PhoneData, minAffection = 20): Contact[] {
  const added: Contact[] = [];
  if (!gameState?.player?.relationships) return added;
  for (const [npcName, rel] of Object.entries(gameState.player.relationships)) {
    if (rel.affection >= minAffection && !pd.contacts.some(c => c.name === npcName)) {
      added.push(addContact(gameState, pd, npcName, generatePhoneNumber(npcName), rel.stage || rel.notes?.slice(0, 10) || "联系人"));
    }
  }
  return added;
}

/** 检查 NPC 是否在通讯录且好感足够主动联系 */
export function canContact(gameState: GameState, pd: PhoneData, npcName: string): boolean {
  const contact = pd.contacts.find(c => c.name === npcName);
  if (!contact) return false;
  const rel = gameState.player.relationships[npcName];
  return rel ? rel.affection >= 40 : false;
}

export function generatePhoneNumber(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  const mid = String(Math.abs(hash % 10000)).padStart(4, "0");
  const suffix = String(Math.abs((hash * 7) % 10000)).padStart(4, "0");
  return `090-${mid}-${suffix}`;
}

// ── 消息 ──

export function deliverMessage(gameState: GameState, pd: PhoneData, from: string, to: string, text: string): PhoneMessage {
  const msg: PhoneMessage = {
    id: pd.messages.length + 1,
    from, to, text,
    timestamp: gameState.time.game_date,
    read: false,
    type: "sms",
  };
  pd.messages.push(msg);
  if (to === gameState.player.name) pd.unreadCount++;
  // 自动将发信人加入通讯录（如果还不在）
  if (from !== "系统" && !pd.contacts.some(c => c.name === from)) {
    const rel = gameState.player.relationships[from];
    addContact(gameState, pd, from, generatePhoneNumber(from), rel?.notes?.slice(0, 10) || rel?.stage || "联系人");
  }
  compressOldMessages(pd, from, to);
  return msg;
}

function compressOldMessages(pd: PhoneData, partyA: string, partyB: string): void {
  const thread = pd.messages.filter(m =>
    (m.from === partyA && m.to === partyB) || (m.from === partyB && m.to === partyA)
  );
  if (thread.length <= MAX_MESSAGES_PER_THREAD) return;

  const oldest = thread.slice(0, thread.length - MAX_MESSAGES_PER_THREAD);
  const summary = oldest.map(m => `${m.from.slice(0, 4)}:${m.text.slice(0, 15)}…`).join("|");
  const compressMsg: PhoneMessage = {
    id: pd.messages.length + 1,
    from: "系统", to: partyA,
    text: `[折叠${oldest.length}条] ${summary}`,
    timestamp: oldest[oldest.length - 1].timestamp,
    read: true, type: "sms",
  };

  const oldestIds = new Set(oldest.map(m => m.id));
  pd.messages = pd.messages.filter(m => !oldestIds.has(m.id));
  const insertAt = pd.messages.findIndex(m => m.id > oldest[0].id);
  pd.messages.splice(insertAt >= 0 ? insertAt : pd.messages.length, 0, compressMsg);
}

export function markAllRead(gameState: GameState, pd: PhoneData): void {
  for (const m of pd.messages) m.read = true;
  pd.unreadCount = 0;
  pd.lastCheckTime = gameState.time.game_date;
}

// ── 通话 ──

export function initiateCall(gameState: GameState, pd: PhoneData, caller: string, callee: string): CallLogEntry {
  for (const cl of pd.callLog) {
    if (cl.status === "ongoing") {
      cl.status = "missed";
      cl.endTime = gameState.time.game_date;
    }
  }
  const call: CallLogEntry = {
    id: pd.callLog.length + 1,
    caller, callee,
    startTime: gameState.time.game_date,
    endTime: null,
    duration_seconds: 0,
    status: "ongoing",
  };
  pd.callLog.push(call);
  return call;
}

export function endCall(gameState: GameState, pd: PhoneData, status: "answered" | "missed" | "rejected"): CallLogEntry | null {
  const ongoing = pd.callLog.find(c => c.status === "ongoing");
  if (!ongoing) return null;
  ongoing.status = status;
  ongoing.endTime = gameState.time.game_date;
  ongoing.duration_seconds = 60; // 简化：默认1分钟
  return ongoing;
}

// ── SNS ──

export function addSnsPost(gameState: GameState, pd: PhoneData, author: string, text: string, platform: "mixi" | "twitter"): SnsPost {
  const post: SnsPost = {
    id: pd.snsPosts.length + 1,
    author, text,
    timestamp: gameState.time.game_date,
    platform, likes: 0,
  };
  pd.snsPosts.push(post);
  if (pd.snsPosts.length > MAX_SNS_POSTS) {
    pd.snsPosts = pd.snsPosts.slice(-MAX_SNS_POSTS);
  }
  return post;
}

// ── 照片 ──

export function addPhoto(gameState: GameState, pd: PhoneData, caption: string, location: string): PhotoEntry {
  const photo: PhotoEntry = {
    id: pd.photos.length + 1,
    filename: `photo_${String(pd.photos.length + 1).padStart(3, "0")}.png`,
    caption, location,
    takenAt: gameState.time.game_date,
  };
  pd.photos.push(photo);
  if (pd.photos.length > MAX_PHOTOS) pd.photos = pd.photos.slice(-MAX_PHOTOS);
  return photo;
}

// ── 通知注入（给 buildStatePrompt 用）──

/** 生成未读摘要，~10 token。有新消息或有未接来电时返回非 null。 */
export function getUnreadSummary(gameState: GameState, pd: PhoneData | null): string | null {
  if (!pd) return null;
  const parts: string[] = [];
  if (pd.unreadCount > 0) {
    const senders = [...new Set(
      pd.messages.filter(m => !m.read && m.to === gameState.player.name).map(m => m.from)
    )];
    const senderStr = senders.slice(0, 3).join(",") + (senders.length > 3 ? "等" : "");
    parts.push(`${pd.unreadCount}条新消息 (${senderStr})`);
  }
  const missedCalls = pd.callLog.filter(c => c.status === "ongoing" && c.callee === gameState.player.name);
  if (missedCalls.length > 0) {
    parts.push(`${missedCalls[0].caller}正在呼叫`);
  }
  return parts.length > 0 ? `[手机] ${parts.join(" | ")}` : null;
}
