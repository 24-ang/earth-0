import { Type } from "typebox";

export default {
    name: "inflict_damage", label: "造成伤害",
    description: "环境/剧情HP伤害。不经战斗检定。target: 玩家|NPC名。",
    parameters: Type.Object({
      target: Type.String({ description: "'玩家' 或 NPC 名" }),
      amount: Type.Number({ description: "伤害值" }),
      type: Type.String({ description: "伤害类型：'钝击'/'坠落'/'毒素'/'燃烧'/'冻伤'/'其他'" }),
      reason: Type.String({ description: "伤害原因，如'被落石砸中'" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
      const isPlayer = params.target === "玩家" || params.target === gameState.player.name;
      const targetChar = isPlayer ? gameState.player : getOrCreateNPC(params.target);

      targetChar.hp.current = Math.max(0, targetChar.hp.current - params.amount);
      // 写入伤口记录
      targetChar.wounds ??= [];
      targetChar.wounds.push({
        severity: params.type,
        text: params.reason,
        date: gameState.date || new Date().toISOString().slice(0, 10)
      });
      if (targetChar.hp.current === 0) {
        if (isPlayer) {
          gameState.player.alive = false;
        } else {
          targetChar.alive = false;
        }
      }

      saveState();
      const statusText = targetChar.hp.current === 0 ? "倒下了/已死亡" : `剩余 HP: ${targetChar.hp.current}/${targetChar.hp.max}`;
      return {
        content: [{ type: "text", text: `对 ${params.target} 造成 ${params.amount} 点${params.type}伤害（原因: ${params.reason}）。${params.target}当前状态: ${statusText}` }],
        details: { currentHp: targetChar.hp.current, alive: isPlayer ? gameState.player.alive : targetChar.alive }
      };
    },
  };
