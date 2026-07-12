/**
 * NPC 交互菜单 —— 从原始 extension.ts (d2b184d) 恢复
 * 好感门槛 + 技能解锁层级 + romance/combat/pushdown 子菜单
 */
import { showPanel, showMenu } from "../helpers.ts";

function getAffection(gameState: any, name: string): number {
  return gameState.player.relationships[name]?.affection ?? 0;
}
function isLover(gameState: any, name: string): boolean {
  return gameState.player.relationships[name]?.romance === "恋人";
}

// ── 子菜单 ──

async function showTalkMenu(name: string, done: () => void, ctx: any) {
  const items = [
    { label: "💬 聊聊日常", detail: "随意闲聊一些生活琐事", action: async () => { done(); ctx.chat.addSystemMessage(`我找 ${name} 随便聊了聊日常琐事。`); } },
    { label: "💬 聊聊自己", detail: "向对方分享一些自己的经历", action: async () => { done(); ctx.chat.addSystemMessage(`我主动向 ${name} 聊起了自己最近的一些经历和看法。`); } },
    { label: "💬 聊聊对方", detail: "询问关于对方的喜好或近况", action: async () => { done(); ctx.chat.addSystemMessage(`我关切地向 ${name} 询问起她的近况，并聊了聊她的兴趣爱好。`); } },
    { label: "💬 聊些八卦", detail: "分享学校或街区里的有趣传闻", action: async () => { done(); ctx.chat.addSystemMessage(`我神秘兮兮地和 ${name} 分享了最近在学校听到的八卦传闻。`); } },
    { label: "◀ 返回", detail: "", action: (d: () => void) => { d(); } },
  ];
  await showMenu(ctx, `💬 交流谈话: ${name}`, items);
}

async function showTouchMenu(gameState: any, saveState: () => void, name: string, done: () => void, ctx: any) {
  const { updateRelation } = await import("../../engine/state.ts");
  const aff = getAffection(gameState, name);

  function touchResult(success: boolean, label: string, reward: number, penalty: number): string {
    // 统一走 updateRelation：正确的 history 对象格式 + 阶段更新（原来手拼 push 字符串会污染 /relations 历史）
    if (success) {
      updateRelation(gameState.player.relationships, name, reward, label);
      saveState();
      return `✓ 好感+${reward}`;
    } else {
      updateRelation(gameState.player.relationships, name, -penalty, `${label}被拒`);
      saveState();
      return `✗ 被拒绝，好感-${penalty}`;
    }
  }

  const items: any[] = [
    { label: `🤝 友好握手 ${aff >= 10 ? "" : "(好感10+)"}`, detail: aff >= 10 ? "进行礼貌的肢体互动" : "关系还不够熟...", action: aff >= 10 ? async () => { done(); const r = touchResult(true, "友好握手", 2, 2); ctx.chat.addSystemMessage(`我主动跟 ${name} 握了握手。${r}`); } : undefined },
    { label: `👋 亲切摸头 ${aff >= 30 ? "" : "(好感30+)"}`, detail: aff >= 30 ? "轻轻抚摸对方的头发" : "需要更多信任...", action: aff >= 30 ? async () => { done(); const ok = Math.random() > 0.15; const r = touchResult(ok, "亲切摸头", 2, 5); ctx.chat.addSystemMessage(ok ? `我轻轻地伸手摸了摸 ${name} 的头，${name} 微微低下了头。${r}` : `我突然伸手想要摸 ${name} 的头，但${name}警惕地退后躲开了。${r}`); } : undefined },
    { label: `🤗 温暖拥抱 ${aff >= 50 ? "" : "(好感50+)"}`, detail: aff >= 50 ? "张开双臂给予拥抱" : "关系还不够亲密...", action: aff >= 50 ? async () => { done(); const ok = Math.random() > 0.2; const r = touchResult(ok, "温暖拥抱", 3, 10); ctx.chat.addSystemMessage(ok ? `我走上前张开双臂，${name}犹豫了一下，轻轻靠了过来。${r}` : `我张开双臂想抱 ${name}，但${name}伸手挡住了我。${r}`); } : undefined },
  ];

  if (gameState.layer1Enabled) {
    items.push({ label: `💆 肢体按摩 ${aff >= 60 ? "" : "(好感60+)"}`, detail: aff >= 60 ? "为对方揉捏肩膀放松身体" : "需要更深的关系...", action: aff >= 60 ? async () => { done(); const ok = Math.random() > 0.25; const r = touchResult(ok, "肢体按摩", 3, 10); ctx.chat.addSystemMessage(ok ? `我帮 ${name} 捏了捏肩膀，${name}的身体逐渐放松下来。${r}` : `我的手刚碰到 ${name} 的肩膀，${name}就躲开了。${r}`); } : undefined });
  }

  items.push({ label: `💋 深情亲吻 ${aff >= 70 || isLover(gameState, name) ? "" : "(好感70+或恋人)"}`, detail: (aff >= 70 || isLover(gameState, name)) ? "深情的一吻" : "还不是时候...", action: (aff >= 70 || isLover(gameState, name)) ? async () => { done(); const ok = Math.random() > 0.3; const r = touchResult(ok, "深情亲吻", 5, 15); ctx.chat.addSystemMessage(ok ? `我靠近 ${name}，轻轻吻了上去。${name}闭上了眼睛。${r}` : `我凑近 ${name} 想亲吻，但${name}别开了脸。「……不行。」${r}`); } : undefined });

  items.push({ label: "◀ 返回", detail: "", action: (d: () => void) => { d(); } });
  await showMenu(ctx, `🖐️ 肢体接触: ${name}`, items);
}

async function showRomanceMenu(gameState: any, saveState: () => void, name: string, done: () => void, ctx: any) {
  const aff = getAffection(gameState, name);
  const items: any[] = [
    { label: `💌 告白交往 ${aff >= 70 ? "" : "(好感70+)"}`, detail: aff >= 70 ? "向对方表达心意" : "还需要更多羁绊...", action: aff >= 70 ? async () => { done(); const rel = gameState.player.relationships[name] || (gameState.player.relationships[name] = { stage: "熟人", affection: aff, history: [], notes: "" }); const ok = Math.random() > 0.25; if (ok) { rel.affection = Math.min(100, (rel.affection || 0) + 10); rel.romance = "恋人"; saveState(); ctx.chat.addSystemMessage(`我向 ${name} 告白了。${name}沉默了很久，然后轻轻点了点头。「……我也。」好感+10，成为恋人！`); } else { rel.affection = Math.max(0, (rel.affection || 0) - 10); saveState(); ctx.chat.addSystemMessage(`我向 ${name} 告白了。${name}低下了头。「……对不起。」好感-10。`); } } : undefined },
    { label: `📅 邀请约会 ${aff >= 50 ? "" : "(好感50+)"}`, detail: aff >= 50 ? "邀对方一起出去玩" : "还不够熟...", action: aff >= 50 ? async () => { done(); const ok = Math.random() > 0.2; const rel = gameState.player.relationships[name] || (gameState.player.relationships[name] = { stage: "熟人", affection: aff, history: [], notes: "" }); if (ok) { rel.affection = Math.min(100, (rel.affection || 0) + 5); saveState(); ctx.chat.addSystemMessage(`我约 ${name} 周末一起出去玩。${name}笑了笑：「好啊，去哪里？」好感+5。`); } else { rel.affection = Math.max(0, (rel.affection || 0) - 5); saveState(); ctx.chat.addSystemMessage(`我约 ${name} 出去玩，但${name}说周末有事。好感-5。`); } } : undefined },
    { label: "◀ 返回", detail: "", action: (d: () => void) => { d(); } },
  ];
  await showMenu(ctx, `💕 恋爱互动: ${name}`, items);
}

async function showPushDownMenu(gameState: any, saveState: () => void, name: string, done: () => void, ctx: any) {
  const aff = getAffection(gameState, name);
  const canPush = isLover(gameState, name) && aff >= 80;
  const items: any[] = [
    { label: `🔥 亲密求欢 ${canPush ? "" : "(需恋人+好感80+)"}`, detail: canPush ? "与恋人共度亲密时光" : "条件未满足", action: canPush ? async () => { done(); const ok = Math.random() > 0.2; if (ok) { gameState.mode = "sex"; gameState.layer1Enabled = true; saveState(); ctx.chat.addSystemMessage(`${name}红着脸点了点头。我把${name}拉到了身边……`); } else { const rel = gameState.player.relationships[name]; if (rel) rel.affection = Math.max(0, (rel.affection || 0) - 15); saveState(); ctx.chat.addSystemMessage(`我刚想靠近，${name}一巴掌甩了过来。「……你把我当什么了？」好感-15。`); } } : undefined },
    { label: "◀ 返回", detail: "", action: (d: () => void) => { d(); } },
  ];
  await showMenu(ctx, `🔥 亲密: ${name}`, items);
}

async function showCombatMenu(gameState: any, saveState: () => void, name: string, done: () => void, ctx: any) {
  const items: any[] = [
    { label: "⚔️ 切磋武艺", detail: "友好切磋，点到为止", action: async () => { done(); gameState.mode = "rpg"; saveState(); ctx.chat.addSystemMessage(`我对 ${name} 抱拳行礼：「请赐教。」${name}摆出了架势。切磋开始！`); } },
    { label: "💀 发起死斗", detail: "以命相搏，关系降为死敌", action: async () => { done(); const rel = gameState.player.relationships[name] || (gameState.player.relationships[name] = { stage: "熟人", affection: 0, history: [], notes: "" }); rel.affection = Math.max(0, (rel.affection || 0) - 50); rel.stage = "死敌"; gameState.mode = "rpg"; saveState(); ctx.chat.addSystemMessage(`我向 ${name} 发起了死斗！一场你死我活的战斗即将展开……`); } },
    { label: "◀ 返回", detail: "", action: (d: () => void) => { d(); } },
  ];
  await showMenu(ctx, `⚔️ 战斗: ${name}`, items);
}

async function showStealMenu(name: string, done: () => void, ctx: any) {
  const { gameState, getOrCreateNPC, stealFunds, stealItem, updateRelation, updateReputation, saveState, isSameLocation } = await import("../../engine/state.ts");
  const npcState = getOrCreateNPC(name);
  const items: any[] = [];

  items.push({
    label: `💰 钱包 (现金: ¥${npcState.cash ?? 0})`, detail: "尝试摸钱包",
    action: async (d: () => void) => {
      const r = stealFunds(gameState.player, name);
      let consequence = "";
      if (r.caught) {
        updateRelation(gameState.player.relationships, name, -20, "偷钱被抓");
        consequence += `\n⚠️ ${name}好感-20`;
        gameState.flags.steal_alert = true;
        gameState.flags[`steal_caught_by_${name}`] = true;
        const loc = gameState.player.location;
        if (loc.includes("校") || loc.includes("班")) { updateReputation("学生", -1); consequence += "，学生声望-1"; }
        if (loc.includes("校门") || loc.includes("警")) { gameState.flags.wanted = true; consequence += "，被通报！"; }
      }
      saveState(); d(); done();
      ctx.chat.addSystemMessage([r.narrative, consequence].filter(Boolean).join(" "));
    }
  });

  if (npcState.inventory) {
    for (const it of npcState.inventory) {
      items.push({
        label: `🎒 [物品] ${it.name} (重: ${it.weight}kg)`, detail: "尝试偷取",
        action: async (d: () => void) => {
          const r = stealItem(gameState.player, name, it.name);
          let consequence = "";
          if (r.caught) { updateRelation(gameState.player.relationships, name, -20, "偷窃被抓"); consequence += `\n⚠️ ${name}好感-20`; gameState.flags.steal_alert = true; gameState.flags[`steal_caught_by_${name}`] = true; const loc = gameState.player.location; if (loc.includes("校") || loc.includes("班")) { updateReputation("学生", -1); consequence += "，学生声望-1"; } if (loc.includes("校门") || loc.includes("警")) { gameState.flags.wanted = true; consequence += "，被通报！"; } }
          saveState(); d(); done();
          ctx.chat.addSystemMessage([r.narrative, consequence].filter(Boolean).join(" "));
        }
      });
    }
  }

  const eq = Object.entries(npcState.equipment).filter(([_, v]) => v);
  for (const [slot, eqItem] of eq) {
    if (eqItem) {
      items.push({
        label: `🛡️ [装备] ${eqItem.name} (${slot})`, detail: "尝试偷取",
        action: async (d: () => void) => {
          const r = stealItem(gameState.player, name, eqItem.name);
          let consequence = "";
          if (r.caught) { updateRelation(gameState.player.relationships, name, -20, "偷窃被抓"); consequence += `\n⚠️ ${name}好感-20`; gameState.flags.steal_alert = true; gameState.flags[`steal_caught_by_${name}`] = true; const loc = gameState.player.location; if (loc.includes("校") || loc.includes("班")) { updateReputation("学生", -1); consequence += "，学生声望-1"; } if (loc.includes("校门") || loc.includes("警")) { gameState.flags.wanted = true; consequence += "，被通报！"; } }
          saveState(); d(); done();
          ctx.chat.addSystemMessage([r.narrative, consequence].filter(Boolean).join(" "));
        }
      });
    }
  }

  items.push({ label: "◀ 返回", detail: "", action: (d: () => void) => { d(); } });
  await showMenu(ctx, `💰 窃取: ${name}`, items);
}

// ── 主入口 ──

export async function showNPCInteractionMenu(name: string, ctx: any) {
  const { gameState, getOrCreateNPC, saveState, getNpcCurrentAge, getBodyForAge, isSameLocation } = await import("../../engine/state.ts");
  const { allChars } = await import("../../engine/router.ts");

  const pSkills = gameState.player.skills || {};
  const obsLv = Math.max(0, ...Object.entries(pSkills as any)
    .filter(([k]) => /察|侦|感/.test(k as string))
    .map(([, v]) => (v as any).level ?? 0));
  const psychLv = Math.max(0, ...Object.entries(pSkills as any)
    .filter(([k]) => /心理|暗示|催眠|心/.test(k as string))
    .map(([, v]) => (v as any).level ?? 0));

  const subItems: any[] = [
    {
      label: "🔍 观察详情",
      detail: obsLv > 0 ? `洞察Lv${obsLv}·部分信息可见` : "查看基础外观",
      action: async (done: () => void) => {
        const char = allChars.find((c: any) => c.name === name || c.name.includes(name));
        if (char) {
          const age = getNpcCurrentAge(char.base_age || 16);
          const body = getBodyForAge(char, age);
          const npcState = getOrCreateNPC(char.name);
          const lines = [`${char.name}  ${char.gender === "female" ? "女" : "男"}  ${age}岁`, `🎬 作品: ${char.source}`, `👗 外观: ${char.appearance_brief || "无描述"}`];
          if (body) { let bodyStr = `📏 身体: ${body.height_cm}cm ${body.build}`; if (body.cup) bodyStr += ` ${body.cup}cup`; lines.push(bodyStr); }
          const rel = gameState.player.relationships[name];
          const rawAff = rel?.affection ?? 0;
          if (obsLv >= 1 || psychLv >= 1) { lines.push(`💕 好感: ${rawAff}/100 (${rel?.stage ?? "陌生"})${rel?.romance ? " " + rel.romance : ""}`); }
          else { lines.push(`💕 关系: ${rel?.stage ?? "陌生"}${rel?.romance ? " " + rel.romance : ""}`); }
          if (obsLv >= 2 || psychLv >= 2) { lines.push(`💰 总身家: ¥${(npcState.cash ?? 0) + (npcState.wealth ?? 0)} (现金¥${npcState.cash ?? 0})`); const eq = Object.entries(npcState.equipment).filter(([_, v]) => v); if (eq.length > 0) lines.push(`⚔️ 装备: ${eq.map(([s, it]) => `${s}:${it!.name}`).join(" ")}`); lines.push(`🎒 背包: ${npcState.inventory?.length > 0 ? npcState.inventory.map((it: any) => it.name).join(", ") : "(空)"}`); }
          if (obsLv >= 3 || psychLv >= 2) { if (char.attributes) { const a = char.attributes; lines.push(`📊 属性: 力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`); } if (body?.measurements) { lines.push(`📐 三围: ${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips} / ${body.cup || "?"}cup`); } if (char.anchors?.private && obsLv >= 3) { lines.push(`✍️ 设定: ${char.anchors.private.slice(0, 120)}`); } }
          if (psychLv >= 2 && gameState.layer1Enabled) { try { const { getOrCreateSexState } = await import("../../engine/state.ts"); const sState = await getOrCreateSexState(name); if (sState) { lines.push(`💓 欲望: ${sState.desire}/100`); lines.push(`🔥 兴奋: ${sState.arousal}/100`); if (sState.thoughts?.length > 0) { lines.push(`💭 心里话: ${sState.thoughts.slice(-2).map((t: any) => t.text).join(" | ")}`); } } } catch (e) { console.error("npc观察详情: getOrCreateSexState 失败", e); } }
          await showPanel(ctx, char.name, lines);
        } else {
          const lines = [`${name} (临时角色)`, `👗 外观: 普通的路人`];
          const ns = getOrCreateNPC(name);
          const rel = gameState.player.relationships[name];
          if (obsLv >= 1 && rel) lines.push(`💕 好感: ${rel.affection}/100`);
          if (obsLv >= 2) { lines.push(`💰 总身家: ¥${(ns.cash ?? 0) + (ns.wealth ?? 0)} (现金¥${ns.cash ?? 0})`); lines.push(`🎒 背包: ${ns.inventory?.length > 0 ? ns.inventory.map((it: any) => it.name).join(", ") : "(空)"}`); }
          await showPanel(ctx, name, lines);
        }
      }
    },
    { label: "💬 交流搭话", detail: "与对方交流闲聊", action: async (done: () => void) => { await showTalkMenu(name, done, ctx); } },
    { label: "🖐️ 肢体接触", detail: "摸头、握手、拥抱或按摩", action: async (done: () => void) => { await showTouchMenu(gameState, saveState, name, done, ctx); } },
  ];

  const isInParty = gameState.player.party?.includes(name);
  const aff = getAffection(gameState, name);
  if (isInParty) {
    subItems.push({ label: "👥 移出队伍", detail: "将对方移出当前队伍", action: async (done: () => void) => { gameState.player.party = gameState.player.party.filter((n: string) => n !== name); saveState(); done(); ctx.chat.addSystemMessage(`我把 ${name} 移出了队伍。`); } });
  } else {
    const canInvite = aff >= 40 || isLover(gameState, name);
    subItems.push({ label: `👥 邀请组队 ${canInvite ? "" : "(好感40+或恋人)"}`, detail: canInvite ? "邀请对方加入你的队伍" : "关系还不够铁...", action: canInvite ? async (done: () => void) => { gameState.player.party ??= []; gameState.player.party.push(name); saveState(); done(); ctx.chat.addSystemMessage(`我邀请 ${name} 加入了我的队伍。${name}点了点头，跟了上来。`); } : undefined });
  }

  subItems.push({ label: "💕 恋爱互动", detail: "告白、约会", action: async (done: () => void) => { await showRomanceMenu(gameState, saveState, name, done, ctx); } });
  subItems.push({ label: `🔥 亲密求欢 ${(isLover(gameState, name) && aff >= 80) ? "" : "(需恋人+好感80+)"}`, detail: (isLover(gameState, name) && aff >= 80) ? "与恋人共度亲密时光" : "条件未满足", action: async (done: () => void) => { await showPushDownMenu(gameState, saveState, name, done, ctx); } });
  subItems.push({ label: "⚔️ 战斗交战", detail: "切磋或死斗", action: async (done: () => void) => { await showCombatMenu(gameState, saveState, name, done, ctx); } });
  subItems.push({ label: "💰 窃取财物", detail: `摸钱包或偷物品 (潜行 Lv.${gameState.player.skills["潜行"]?.level ?? 0})`, action: async (done: () => void) => { await showStealMenu(name, done, ctx); } });

  // 技能驱动交互
  for (const [sName, sv] of Object.entries(gameState.player.skills || {}) as [string, any][]) {
    const lvl = sv?.level ?? 0;
    if (lvl <= 0) continue;
    if (sName === "医疗" || sName === "治疗") { subItems.push({ label: "🩹 医疗包扎", detail: `使用${sName}技能 (Lv.${lvl})`, action: async (done: () => void) => { done(); ctx.chat.addSystemMessage(`我使用${sName}技能对 ${name} 进行伤势包扎治疗。`); } }); }
    else if (sName === "说服" || sName === "口才" || sName === "话术") { subItems.push({ label: "🗣️ 尝试劝说", detail: `使用${sName}技能 (Lv.${lvl})`, action: async (done: () => void) => { done(); ctx.chat.addSystemMessage(`我施展${sName}技巧，试图说服 ${name}。`); } }); }
    else if (sName === "暗示" || sName === "催眠") { subItems.push({ label: "🌀 潜意识暗示", detail: `使用${sName}技能 (Lv.${lvl})`, action: async (done: () => void) => { done(); ctx.chat.addSystemMessage(`我凝视着 ${name} 的眼睛，尝试施加${sName}。。。`); } }); }
  }

  subItems.push({ label: "↩ 返回", detail: "", action: (done: () => void) => { done(); } });
  await showMenu(ctx, `👤 ${name}`, subItems);
}
