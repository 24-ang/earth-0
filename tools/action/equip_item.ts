import { Type } from "typebox";

export default {
    name: "equip_item", label: "装备",
    description: "装备/卸下物品到指定槽位。",
    parameters: Type.Object({ item: Type.String({ description: "物品名" }), slot: Type.Optional(Type.String({ description: "装备槽位: head/body/hands/legs/feet/accessory" })) }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const p = gameState.player;
      if (params.slot) {
        // 装备：从背包找到物品 → 放到指定槽位
        const idx = p.inventory.findIndex((i: any) => i.name === params.item);
        if (idx < 0) return { content: [{ type: "text", text: `背包里没有${params.item}` }], details: {} };
        const item = p.inventory[idx];
        const slot = params.slot as any;
        // 如果槽位已有装备，先卸到背包
        if (p.equipment[slot]) p.inventory.push(p.equipment[slot]!);
        p.equipment[slot] = item;
        p.inventory.splice(idx, 1);
        saveState();
        return { content: [{ type: "text", text: `装备了${params.item} → ${params.slot}` }], details: {} };
      } else {
        // 卸下：从装备槽找到物品 → 放回背包
        for (const [s, it] of Object.entries(p.equipment)) {
          if (it && it.name === params.item) {
            p.inventory.push(it);
            p.equipment[s as any] = null;
            saveState();
            return { content: [{ type: "text", text: `卸下了${params.item}` }], details: {} };
          }
        }
        return { content: [{ type: "text", text: `没有装备${params.item}` }], details: {} };
      }
    },
  };
