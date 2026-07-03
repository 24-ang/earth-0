import { Type } from "typebox";

export default {
    name: "use_item", label: "使用物品",
    description: "使用背包中消耗品。引擎自动结算效果(回血/提神)后物品消失。",
    parameters: Type.Object({
      item: Type.String({ description: "要使用的物品名" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState, saveState } = await import("../../engine/state.ts");
      const p = gameState.player;

      // 在背包找
      const idx = p.inventory.findIndex((i: any) => i.name === params.item);
      if (idx < 0) {
        return { content: [{ type: "text", text: `背包里没有${params.item}` }], details: {} };
      }

      const item = p.inventory[idx];

      // 无 effects 或纯叙事物品 → 不消耗，返回描述让 LLM 自行演绎
      if (!item.effects || item.effects.length === 0) {
        return {
          content: [{ type: "text", text: `${params.item}：${item.flavor || "无特殊效果"}。此物品无预设机械效果，叙事效果由GM自由演绎（不消耗物品）。` }],
          details: { item: item.name, narrativeOnly: true }
        };
      }

      const results: string[] = [];
      for (const eff of item.effects) {
        if (eff.type === "heal") {
          // 解析治疗量：支持 "1d4", "2d6", 纯数字
          let healAmount = 0;
          if (typeof eff.value === "string" && (eff.value as string).includes("d")) {
            const [count, sides] = (eff.value as string).split("d").map(Number);
            for (let i = 0; i < count; i++) {
              healAmount += Math.floor(Math.random() * sides) + 1;
            }
          } else {
            healAmount = Number(eff.value);
          }
          const beforeHP = p.hp.current;
          p.hp.current = Math.min(p.hp.max, p.hp.current + healAmount);
          const actualHeal = p.hp.current - beforeHP;
          results.push(`回复了 ${actualHeal} 点HP（${p.hp.current}/${p.hp.max}）`);
        } else if (eff.type === "energy") {
          // 提神效果：清除疲劳相关标记，注入叙事提示
          const strength = eff.value as string;
          const reduce = strength === "强提神" ? 40 : 20;
          const before = p.fatigue;
          p.fatigue = Math.max(0, before - reduce);
          results.push(before > 50 ? "疲劳一扫而空，精力充沛！" : before > 20 ? "精神恢复了些许" : "本来也不太累——精神更好了");
        } else {
          results.push(`${eff.type}: ${eff.value}`);
        }
      }

      // 消耗物品（type:tool 或 communication 效果物品不消耗）
      const isTool = item.type === "tool";
      const isCommunication = item.effects?.some((e: any) => e.type === "communication");
      if (!isTool && !isCommunication) {
        p.inventory.splice(idx, 1);
      }
      saveState();

      const consumedNote = (isTool || isCommunication) ? "（此物品不被消耗）" : "";

      return {
        content: [{ type: "text", text: `使用了${params.item}：${results.join("；")}` }],
        details: { item: item.name, effects: results }
      };
    },
  };
