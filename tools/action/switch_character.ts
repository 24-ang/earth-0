import { Type } from "typebox";

export default {
  name: "switch_character",
  label: "视角切换",
  description: "切换玩家控制视角（POV）到目标队友，或者恢复为主角色视角。",
  parameters: Type.Object({
    action: Type.String({ description: "switch|restore" }),
    targetNpc: Type.Optional(Type.String({ description: "目标NPC名称（switch动作时必填）" })),
  }),
  async execute(_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
    const { gameState, saveState, getOrCreateSexState, findCharacter, getNpcCurrentAge } = await import("../../engine/state.ts");
    const p = gameState.player;

    if (params.action === "switch") {
      if (!params.targetNpc) {
        return { content: [{ type: "text", text: "切换视角需要指定 targetNpc 目标。" }], details: {} };
      }
      if (gameState._playerSnapshot) {
        return { content: [{ type: "text", text: "当前已经处于视角切换状态下，不支持嵌套切换。" }], details: {} };
      }

      const npcName = params.targetNpc;
      if (npcName === p.name) {
        return { content: [{ type: "text", text: "无法切换到自身POV。" }], details: {} };
      }

      const npc = gameState.npcs[npcName];
      if (!npc) {
        return { content: [{ type: "text", text: `未找到目标 NPC: ${npcName}，无法执行视角切换。` }], details: {} };
      }

      if (npc.alive === false) {
        return { content: [{ type: "text", text: `目标 NPC: ${npcName} 已经死亡，无法执行视角切换。` }], details: {} };
      }

      const origName = p.name;
      const src = findCharacter(npcName);
      const age = src ? getNpcCurrentAge(src.base_age || 16) : 16;
      const gender = src?.gender || "女";

      // 1. 深拷贝备份原玩家与目标 NPC 运行时状态
      gameState._playerSnapshot = JSON.parse(JSON.stringify(p));
      gameState._npcSnapshot = JSON.parse(JSON.stringify(npc));
      gameState._originalPlayerName = origName;

      // 2. 原玩家作为 NPC 发送至当前场景
      gameState.npcs[origName] = {
        inventory: JSON.parse(JSON.stringify(p.inventory || [])),
        equipment: JSON.parse(JSON.stringify(p.equipment || {})),
        currentRoom: p.location,
        gridPos: p.gridPos ? [...p.gridPos] : null,
        action: "发呆中",
        scheduleGroup: "自由人",
        memoryTags: [],
        funds: p.funds ?? 0,
        hp: JSON.parse(JSON.stringify(p.hp || { current: 100, max: 100 })),
        alive: p.hp?.current > 0,
        attributes: JSON.parse(JSON.stringify(p.attributes)),
        skills: JSON.parse(JSON.stringify(p.skills || {})),
        abilities: JSON.parse(JSON.stringify(p.abilities || {})),
      };

      // 3. 将新控制的 NPC 数据覆盖到 player 结构，并彻底重置/重载无关的主角专属字段防止污染
      p.name = npcName;
      p.age = age;
      p.gender = gender as any;
      p.hp = JSON.parse(JSON.stringify(npc.hp || { current: 100, max: 100 }));
      p.attributes = JSON.parse(JSON.stringify(npc.attributes));
      p.skills = JSON.parse(JSON.stringify(npc.skills || {}));
      p.abilities = JSON.parse(JSON.stringify(npc.abilities || {}));
      p.inventory = JSON.parse(JSON.stringify(npc.inventory || []));
      p.equipment = JSON.parse(JSON.stringify(npc.equipment || {}));
      p.funds = npc.funds ?? 0;
      p.location = npc.currentRoom;
      p.gridPos = npc.gridPos ? [...npc.gridPos] : null;

      // 重载身体数据与 active sex 状态
      p.body = JSON.parse(JSON.stringify(src?.body || { height_cm: 160, weight_kg: 50, build: "标准", leg_type: "标准", skin: { base_tone: "普通", tan: 0, texture: "普通" } }));
      
      const sState = await getOrCreateSexState(npcName);
      p.sex = sState || undefined;

      // 重置声望、房产、队伍、疲劳度、隐藏、状态绑定
      p.reputation = {};
      p.properties = [];
      p.party = [];
      p.fatigue = (npc as any).fatigue ?? 0;
      p.wounds = (npc as any).wounds || [];
      p.titles = src?.titles || [];
      p.public_identity = src?.public_identity || null;
      p.deathSaves = { success: 0, failure: 0 };
      p.concealed = false;
      p.hiding_in = null;

      // 4. 置换关系网
      const rels: any = {};
      for (const [k, v] of Object.entries(npc.npcRelationships || {})) {
        rels[k] = {
          stage: v.stage,
          romance: (v as any).romance || null,
          affection: (v as any).affection ?? 0,
          notes: v.notes || "",
          history: (v as any).history || []
        };
      }
      // 镜像加入原玩家关系
      const origRel = gameState._playerSnapshot.relationships[npcName];
      rels[origName] = {
        stage: origRel?.stage || "陌生",
        romance: origRel?.romance || null,
        affection: origRel?.affection ?? 0,
        notes: origRel?.notes || "",
        history: origRel?.history || []
      };
      p.relationships = rels;

      // 5. 从 npcs 列表删除该 NPC (已经被置换为主角)
      delete gameState.npcs[npcName];

      saveState();
      return { content: [{ type: "text", text: `已成功将视角切换到: ${npcName}。原主角 ${origName} 已暂时成为NPC在场。` }], details: { switched: true, targetNpc: npcName } };
    }

    if (params.action === "restore") {
      if (!gameState._playerSnapshot) {
        return { content: [{ type: "text", text: "当前不处于视角切换状态，无需恢复。" }], details: {} };
      }

      const curNpcName = p.name;
      const origName = gameState._originalPlayerName;
      const npcOriginalState = gameState._npcSnapshot || {};

      // 1. 将被控 NPC 当前状态写回 npcs 列表（完美保留所有原始运行时字段，防止记忆等重要数据丢失）
      const npcRels: any = {};
      for (const [k, v] of Object.entries(p.relationships || {})) {
        if (origName && k === origName) continue;
        npcRels[k] = {
          stage: v.stage,
          tone: (v as any).tone || "平",
          notes: v.notes || "",
          affection: (v as any).affection ?? 0,
          romance: (v as any).romance || null,
          history: (v as any).history || []
        };
      }

      gameState.npcs[curNpcName] = {
        ...npcOriginalState, // 保存原有 memoryTags, currentOutfit, shortTermBuffer, schedules, lifeEvents 等
        inventory: JSON.parse(JSON.stringify(p.inventory || [])),
        equipment: JSON.parse(JSON.stringify(p.equipment || {})),
        currentRoom: p.location,
        gridPos: p.gridPos ? [...p.gridPos] : null,
        hp: JSON.parse(JSON.stringify(p.hp || { current: 100, max: 100 })),
        alive: p.hp?.current > 0,
        attributes: JSON.parse(JSON.stringify(p.attributes)),
        skills: JSON.parse(JSON.stringify(p.skills || {})),
        abilities: JSON.parse(JSON.stringify(p.abilities || {})),
        funds: p.funds ?? 0,
        npcRelationships: npcRels,
        fatigue: p.fatigue ?? 0,
        wounds: JSON.parse(JSON.stringify(p.wounds || [])),
      };

      // 写回被控 NPC 的 SexState 变更（如高潮次数、安全周期、受孕等）
      if (p.sex) {
        gameState.sexStates ??= {};
        gameState.sexStates[curNpcName] = p.sex;
      }

      // 2. 从快照恢复原玩家
      const snapshot = gameState._playerSnapshot;
      if (!snapshot || typeof snapshot !== "object") {
        return { content: [{ type: "text", text: "快照损坏，还原失败。" }], details: {} };
      }

      // 双向好感写回：更新原玩家与该 NPC 的双向好感关系
      const updatedRel = p.relationships[origName || ""];
      if (updatedRel && snapshot.relationships && origName) {
        snapshot.relationships[curNpcName] = {
          ...(snapshot.relationships[curNpcName] || {}),
          affection: updatedRel.affection ?? 0,
          stage: updatedRel.stage || "陌生",
          romance: updatedRel.romance || null,
          notes: updatedRel.notes || "",
          history: updatedRel.history || []
        };
      }

      // 用 snapshot 重置玩家属性 (加入异常拦截防护)
      for (const k of Object.keys(p)) {
        try {
          delete (p as any)[k];
        } catch {
          // ignore non-deletable properties
        }
      }
      Object.assign(p, snapshot);

      // 3. 从 npcs 列表销毁原玩家临时 NPC 条目
      if (origName) {
        delete gameState.npcs[origName];
      }

      // 4. 清空状态
      gameState._playerSnapshot = null;
      gameState._npcSnapshot = null;
      gameState._originalPlayerName = null;

      saveState();
      return { content: [{ type: "text", text: `已成功将视角还原回主角: ${p.name}。` }], details: { restored: true } };
    }

    return { content: [{ type: "text", text: `未知 action: ${params.action}` }], details: {} };
  },
};
