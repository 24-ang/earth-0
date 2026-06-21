import { Type } from "typebox";

export default {
    name: "identity_check", label: "身份检定",
    description: "身份检定(魅力/隐藏技能)。警察/保安等强检查时调用。",
    parameters: Type.Object({
      difficulty: Type.String({ description: "简单/普通/困难/极难/不可能" }),
      skillLevel: Type.Optional(Type.Number({ description: "玩家相关伪装或欺瞒技能等级" }))
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, updateReputation, getEquipmentBonus } = await import("../../engine/state.ts");
      const { identityCheck } = await import("../../engine/dice.ts");
      const loc = gameState.player.location;
      // 装备加成: 魅力属性加成 + 社交加成（校内穿制服等）
      const attrBonus = getEquipmentBonus(gameState.player.equipment, "attribute_bonus", "魅力");
      const socialBonus = getEquipmentBonus(gameState.player.equipment, "social_bonus", loc);
      const effectiveCha = gameState.player.attributes.魅力 + attrBonus;
      const effectiveSkill = (params.skillLevel || 0) + socialBonus;
      const r = identityCheck(params.difficulty as any, effectiveCha, effectiveSkill);
      let text = `[身份检定] 难度: ${params.difficulty} | 检定值: ${r.roll.total} vs DC ${r.roll.dc}\n`;

      if (r.success) {
        text += "✅ 检定成功，身份未被识破。";
      } else {
        text += "❌ 检定失败！身份被识破！";
        gameState.flags.identity_exposed = true;

        // 根据所在区域自动施加后果（loc 已在上方声明）
        if (loc.includes("校") || loc.includes("班")) {
          updateReputation("学生", -1);
          text += `\n⚠️ 学生声望-1`;
        }
        if (loc.includes("校门") || loc.includes("警") || loc.includes("站") || loc.includes("厅")) {
          gameState.flags.wanted = true;
          text += `\n⚠️ 已被通报追查！`;
        }
        if (gameState.player.public_identity) {
          text += `\n⚠️ 伪装身份「${gameState.player.public_identity}」被识破`;
          gameState.player.public_identity = undefined;
        }
      }

      saveState();
      return { content: [{ type: "text", text }], details: { roll: r.roll } };
    },
  };
