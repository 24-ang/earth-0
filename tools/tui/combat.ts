import { showPanel } from "../helpers.ts";

export default {
    description: "查看玩家战斗状态与周边敌对NPC",
    handler: async (_args, ctx) => {
      const { gameState, getOrCreateNPC, getCurrency, isSameLocation } = await import("../../engine/state.ts");
      const lines: string[] = [];
      const p = gameState.player;

      lines.push(`⚔️ 战斗状态`);
      lines.push("────────────────────────────────────────");
      lines.push(`❤️ HP: ${p.hp.current}/${p.hp.max} | 🛡️ AC: ${p.ac}`);
      lines.push(`💪 力${p.attributes.力量} 敏${p.attributes.敏捷} 体${p.attributes.体质}`);
      lines.push(`💰 资金: ${getCurrency()}${p.funds} | 💤 疲劳: ${p.fatigue ?? 0}/100`);

      // 装备武器
      const weapon = p.equipment.right_hand || p.equipment.left_hand;
      if (weapon && weapon.type === "weapon" && weapon.damage) {
        lines.push(`🗡 武器: ${weapon.name} (${weapon.damage.dice} ${weapon.damage.damageType})`);
      } else {
        lines.push(`👊 武器: 拳头 (1d2 钝击)`);
      }

      // 死亡豁免
      lines.push("────────────────────────────────────────");
      const ds = p.deathSaves;
      lines.push(`💀 死亡豁免: ${ds?.successes || 0} 成功 / ${ds?.failures || 0} 失败${!p.alive ? " ⚠️濒死中" : ""}`);

      // 周边NPC战力
      lines.push("────────────────────────────────────────");
      lines.push("👥 周边 NPC 战力评估:");
      const nearbyNPCs = Object.entries(gameState.npcs)
        .filter(([_, n]) => isSameLocation(n.currentRoom, p.location));

      if (nearbyNPCs.length === 0) {
        lines.push("  (周围没有NPC)");
      } else {
        for (const [name, npc] of nearbyNPCs) {
          const npcHp = npc.hp || { current: 10, max: 10 };
          const npcAttr = npc.attributes || { 力量: 10, 敏捷: 10, 体质: 10 };
          const weapon = npc.equipment?.right_hand || npc.equipment?.left_hand;
          const wpnStr = weapon?.damage ? `${weapon.name}(${weapon.damage.dice})` : "徒手";
          lines.push(`  ${name}: HP${npcHp.current}/${npcHp.max} AC${10 + Math.floor(((npcAttr.敏捷 || 10) - 10) / 2)} ${wpnStr}`);
        }
      }

      lines.push("────────────────────────────────────────");
      const flags = gameState.flags || {} as any;
      if ((flags as any).steal_alert) lines.push("⚠️ 偷窃警报生效中，NPC可能敌对！");
      if ((flags as any).school_alert) lines.push("⚠️ 校园警戒中！");

      await showPanel(ctx, "⚔️ 战斗", lines);
    },
  };
