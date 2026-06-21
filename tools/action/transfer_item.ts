import { Type } from "typebox";

export default {
    name: "transfer_item", label: "转移物品",
    description: "转移物品。from/to: 角色名或'玩家'。引擎强制校验来源持有该物品。",
    parameters: Type.Object({
      from: Type.String({ description: "物品来源：角色名 或 '玩家'" }),
      to: Type.String({ description: "物品去向：角色名 或 '玩家'" }),
      item: Type.String({ description: "物品名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState, getOrCreateNPC } = await import("../../engine/state.ts");
      const p = gameState.player;

      // 检查是否为金钱/资金转移，形如 "金钱:200" 或 "¥:200"
      if (params.item.startsWith("金钱:") || params.item.startsWith("¥:")) {
        const amountStr = params.item.split(":")[1];
        const amount = parseInt(amountStr, 10);
        if (isNaN(amount) || amount <= 0) {
          return { content: [{ type: "text", text: `无效的金额: ${params.item}` }], details: {} };
        }

        const fromIsPlayer = params.from === "玩家" || params.from === p.name;
        const toIsPlayer = params.to === "玩家" || params.to === p.name;

        const fromFunds = fromIsPlayer ? p.funds : getOrCreateNPC(params.from).funds;
        if (fromFunds < amount) {
          return { content: [{ type: "text", text: `转移失败: ${params.from}金钱不够（需要 ${amount}，实际仅有 ${fromFunds}）` }], details: {} };
        }

        if (fromIsPlayer) {
          p.funds -= amount;
        } else {
          getOrCreateNPC(params.from).funds -= amount;
        }

        if (toIsPlayer) {
          p.funds += amount;
        } else {
          getOrCreateNPC(params.to).funds += amount;
        }

        saveState();
        return { content: [{ type: "text", text: `成功将 ${amount} 资金从 ${params.from} 转移给 ${params.to}。` }], details: {} };
      }

      // 解析 from 方
      const fromIsPlayer = params.from === "玩家" || params.from === p.name;
      const fromInventory: any[] = fromIsPlayer ? p.inventory : getOrCreateNPC(params.from).inventory;
      const fromEquipment: any = fromIsPlayer ? p.equipment : getOrCreateNPC(params.from).equipment;

      // 在背包找
      let idx = fromInventory.findIndex((i: any) => i.name === params.item);
      if (idx >= 0) {
        const item = fromInventory.splice(idx, 1)[0];
        // 放入 to 方
        const toIsPlayer = params.to === "玩家" || params.to === p.name;
        if (toIsPlayer) p.inventory.push(item);
        else getOrCreateNPC(params.to).inventory.push(item);
        saveState();
        return { content: [{ type: "text", text: `${params.from} → ${params.to}: ${params.item}` }], details: {} };
      }

      // 在装备槽找
      for (const [slot, item] of Object.entries(fromEquipment)) {
        if (item && (item as any).name === params.item) {
          fromEquipment[slot as any] = null;
          const toIsPlayer = params.to === "玩家" || params.to === p.name;
          if (toIsPlayer) p.inventory.push(item as any);
          else getOrCreateNPC(params.to).inventory.push(item as any);
          saveState();
          return { content: [{ type: "text", text: `${params.from} → ${params.to}: ${params.item}（从装备槽卸下）` }], details: {} };
        }
      }

      return { content: [{ type: "text", text: `${params.from}没有${params.item}` }], details: {} };
    },
  };
