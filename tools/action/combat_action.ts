import { Type } from "typebox";

export default {
    name: "combat_action", label: "战斗",
    description: "攻击|防御|逃跑|死亡豁免。actor可选NPC名。skill可选(默认格斗)。",
    parameters: Type.Object({
      action: Type.String({ description: "attack / defend / flee / death_save" }),
      target: Type.Optional(Type.String({ description: "目标名，attack/flee 时需要" })),
      actor: Type.Optional(Type.String({ description: "行动者，默认玩家。设为 NPC 名则 NPC 执行该动作" })),
      skill: Type.Optional(Type.String({ description: "攻击技能名，默认格斗。如剑术/射击/拳法" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC, damageItem, calcAC } = await import("../../engine/state.ts");
      const { resolveAttack, defend, attemptFlee, makeDeathSave, getRoundSummary } = await import("../../engine/combat.ts");
      const { findCharacter } = await import("../../engine/state.ts");
      const p = gameState.player;

      // Helper: 构建 NPC 战斗状态
      const buildNPCCombatant = (name: string) => {
        const npc = getOrCreateNPC(name);
        const src = findCharacter(name);
        const attributes = npc.attributes || src?.attributes || { 力量: 8, 敏捷: 10, 体质: 9, 智力: 10, 感知: 10, 魅力: 10 };
        const hp = npc.hp || src?.hp || { current: 10, max: 10 };

        const skills: Record<string, any> = {};
        const sourceSkills = npc.skills || src?.skills || {};
        for (const [sName, sVal] of Object.entries(sourceSkills)) {
          if (sVal && typeof sVal === "object" && "level" in sVal) {
            skills[sName] = sVal;
          } else {
            skills[sName] = {
              level: Number(sVal),
              exp: 0,
              nextLevel: Number(sVal) * 10
            };
          }
        }

        const npcState = {
          ...structuredClone(p),
          name,
          attributes,
          skills,
          hp: { ...hp },
          ac: calcAC(attributes.敏捷, npc.equipment),
          equipment: npc.equipment || {},
        };
        return { name, state: npcState as any, cover: "无掩体" as any };
      };

      const playerCombatant = { name: p.name, state: p, cover: "无掩体" as any };
      const isNPC = params.actor && params.actor !== "玩家" && params.actor !== p.name;

      let r = "";
      if (params.action === "attack" && params.target) {
        const attacker = isNPC ? buildNPCCombatant(params.actor!) : playerCombatant;
        const defenderName = isNPC ? params.target : params.target;
        const defender = (defenderName === "玩家" || defenderName === p.name)
          ? playerCombatant
          : buildNPCCombatant(defenderName);

        const attackerEquip = isNPC ? (buildNPCCombatant(params.actor!).state as any).equipment : p.equipment;
        const weapon = Object.values(isNPC ? attackerEquip : p.equipment).find((w: any) => w?.damage)
          || { name: "拳头", damage: { dice: "1d2", damageType: "钝击" }, type: "weapon", slot: "right_hand", weight: 0, effects: [], state: "intact" };

        const result = resolveAttack(attacker, defender, weapon as any, "平", params.skill || "格斗");
        r = result.narrative;

        // 实际伤害写入目标 HP
        // 注意: resolveAttack 已直接修改 defender.state.hp.current
        // 玩家: defender.state === p 同一引用 → p.hp.current 已更新，不需重复
        // NPC: defender.state 是 clone → 需回写到 gameState.npcs
        if (result.hit && result.damage) {
          if (defender !== playerCombatant) {
            const npc = getOrCreateNPC(defender.name);
            npc.hp.current = defender.state.hp.current;
            if (npc.hp.current <= 0) {
              npc.alive = false;
            }
          }
        }

        // 玩家死亡检查
        if (p.hp.current <= 0) {
          p.alive = false;
          r += `\n⚠️ ${p.name}倒下了！需要死亡豁免检定（使用 death_save 行动）。3次成功=稳定，3次失败=死亡。`;
        }
      } else if (params.action === "death_save") {
        if (p.alive) { r = "你还活着，不需要死亡豁免。"; }
        else {
          const ds = makeDeathSave(p);
          r = ds.narrative;
          if (ds.nat20) { p.alive = true; p.hp.current = 1; p.deathSaves = undefined; r += ` ${p.name}恢复了意识！HP=1。`; }
          else if (p.deathSaves && p.deathSaves.failures >= 3) {
            r += `\n💀 三次死亡豁免失败。${p.name}的生命走到了尽头。`;
          }
          else if (p.deathSaves && p.deathSaves.successes >= 3) {
            p.alive = true; p.hp.current = 1; p.deathSaves = undefined;
            r += `\n✅ 三次死亡豁免成功。${p.name}稳定了下来。HP=1。`;
          }
        }
      } else if (params.action === "defend") {
        const defender = isNPC ? buildNPCCombatant(params.actor!) : playerCombatant;
        r = defend(defender);
        r += `\n[HP] ${defender.name}:${defender.state.hp.current}/${defender.state.hp.max}`;
      } else if (params.action === "flee") {
        const fleer = isNPC ? buildNPCCombatant(params.actor!) : playerCombatant;
        const npcName = params.target || Object.keys(gameState.npcs).find(n => n !== params.actor);
        if (!npcName) { r = "没有敌人可逃跑"; }
        else {
          const npcCombatant = buildNPCCombatant(npcName);
          r = attemptFlee(fleer, npcCombatant).narrative;
        }
      } else r = "无效战斗动作";
      saveState();
      return { content: [{ type: "text", text: r }], details: {} };
    },
  };
