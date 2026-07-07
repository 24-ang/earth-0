import { Type } from "typebox";

export default {
  name: "direct_party_member",
  label: "指挥队友",
  description: "在战斗或遭遇中指挥队伍成员行动。消耗行动机会执行检定。",
  parameters: Type.Object({
    npcName: Type.String({ description: "队友名称" }),
    action: Type.String({ description: "动作类型: attack(攻击)|defend(掩护/防御)|scout(侦察/警戒)|support(支援/辅助)" }),
    difficulty: Type.Optional(Type.String({ description: "难度等级: trivial|easy|moderate|hard|very_hard|nearly_impossible，默认moderate" })),
    target: Type.Optional(Type.String({ description: "目标对象（比如敌对NPC）" })),
  }),
  async execute(_id: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
    const { gameState, saveState } = await import("../../engine/state.ts");
    const p = gameState.player;
    p.party ??= [];

    if (!p.party.includes(params.npcName)) {
      return { content: [{ type: "text", text: `${params.npcName} 不在你的队伍中。` }], details: {} };
    }

    const npc = gameState.npcs[params.npcName];
    if (!npc) {
      return { content: [{ type: "text", text: `未找到队友 ${params.npcName} 的数据。` }], details: {} };
    }

    const { isSameLocation } = await import("../../engine/state.ts");
    if (!isSameLocation(npc.currentRoom, p.location)) {
      return { content: [{ type: "text", text: `${params.npcName} 虽在队伍中，但目前不在此处（在 ${npc.currentRoom}）。` }], details: {} };
    }

    const { check } = await import("../../engine/dice.ts");

    let attrKey: "力量" | "敏捷" | "体质" | "智力" | "感知" | "魅力" = "力量";
    let skillKey = "运动";

    if (params.action === "attack") {
      attrKey = (npc.attributes?.敏捷 ?? 10) > (npc.attributes?.力量 ?? 10) ? "敏捷" : "力量";
      skillKey = "武技";
    } else if (params.action === "defend") {
      attrKey = "体质";
      skillKey = "运动";
    } else if (params.action === "scout") {
      attrKey = "感知";
      skillKey = "观察";
    } else if (params.action === "support") {
      attrKey = (npc.attributes?.魅力 ?? 10) > (npc.attributes?.智力 ?? 10) ? "魅力" : "智力";
      skillKey = "话术";
    }

    const attrVal = npc.attributes?.[attrKey] ?? 10;
    const skillLv = npc.skills?.[skillKey]?.level ?? 0;
    const diff = params.difficulty || "moderate";

    const r = check(diff as any, attrVal, skillLv, "平");

    let text = `${params.npcName} 执行指挥行动 [${params.action}]`;
    if (params.target) text += ` 针对 ${params.target}`;
    text += `: ${r.success ? "成功" : "失败"}。结果: ${r.outcome === "success" ? "大成功" : r.outcome === "success-with-cost" ? "勉强成功(有代价)" : "失败"} (投骰值: ${r.roll.kept} + 调整值: ${r.roll.mod} = ${r.roll.total} vs 难度门槛 DC ${r.roll.dc})`;

    saveState();

    return {
      content: [{ type: "text", text }],
      details: {
        npcName: params.npcName,
        action: params.action,
        success: r.success,
        outcome: r.outcome,
        roll: r.roll,
        target: params.target,
      },
    };
  },
};
