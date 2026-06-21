import { Type } from "typebox";

export default {
    description: "背包管理：查看/筛选/使用物品",
    handler: async (_args, ctx) => {
      const { gameState, saveState, checkAddVolume } = await import("../../engine/state.ts");
      const p = gameState.player;

      const rerender = (filter: string, sort: string, done: any) => {
        let items = [...p.inventory];
        // 过滤
        if (filter === "weapon") items = items.filter((i: any) => i.type === "weapon");
        else if (filter === "consumable") items = items.filter((i: any) => i.type === "consumable");
        else if (filter === "clothing") items = items.filter((i: any) => i.type === "clothing" || i.type === "armor");
        else if (filter === "equipped") {
          items = Object.values(p.equipment).filter(Boolean) as any[];
        }
        // 排序
        if (sort === "weight") items.sort((a: any, b: any) => (b.weight || 0) - (a.weight || 0));
        else if (sort === "name") items.sort((a: any, b: any) => a.name.localeCompare(b.name, "zh"));

        const lines: string[] = [];
        const volUsed = p.inventory.reduce((s: number, i: any) => s + (i.volume || 0), 0);
        const volMax = 30; // 默认背包容量
        lines.push(`🎒 背包 (${p.inventory.length}件 | ${volUsed.toFixed(1)}/${volMax}L) | 资金 ${getCurrency()}${p.funds}`);
        lines.push(`筛选: ${filter === "all" ? "全部" : filter} | 排序: ${sort === "name" ? "名称" : sort === "weight" ? "重量" : "默认"}`);
        lines.push("────────────────────────────────────────");

        if (items.length === 0) {
          lines.push("（空）");
        } else {
          const display = items.slice(0, 30); // 最多显示30件
          display.forEach((item: any, idx: number) => {
            const tag = item.type ? `[${item.type.slice(0, 2)}]` : "";
            const wt = item.weight ? `${item.weight}kg` : "";
            const vol = item.volume ? `${item.volume}L` : "";
            const state = item.state === "damaged" ? "⚠️" : item.state === "ruined" ? "💀" : "";
            lines.push(`${idx + 1}. ${tag} ${item.name} ${wt} ${vol} ${state}`);
            if (item.effects?.length > 0) {
              const effStr = item.effects.map((e: any) => `${e.type}:${e.value}`).join(" ");
              lines.push(`   效果: ${effStr}`);
            }
          });
          if (items.length > 30) lines.push(`  ... 还有 ${items.length - 30} 件`);
        }

        lines.push("────────────────────────────────────────");
        lines.push("按键: [A]全部 [W]武器 [C]消耗品 [T]服装 [E]已装备 | [N]名称排序 [G]重量排序");
        lines.push("[U]使用消耗品 [D]丢弃物品 | [Q]退出");

        ctx.ui.custom(
          (tui: any, _theme: any, _kb: any, doneCb: any) => {
            return {
              render(_termW: number): string[] { return lines; },
              handleInput(d: string) {
                const key = d.toLowerCase();
                if (key === "q") { doneCb(); done(); }
                else if (key === "a") rerender("all", sort, done);
                else if (key === "w") rerender("weapon", sort, done);
                else if (key === "c") rerender("consumable", sort, done);
                else if (key === "t") rerender("clothing", sort, done);
                else if (key === "e") rerender("equipped", sort, done);
                else if (key === "n") rerender(filter, "name", done);
                else if (key === "g") rerender(filter, "weight", done);
                else if (key === "u") {
                  // 使用消耗品：列出可用的 consumable 物品
                  const consumables = p.inventory.filter((i: any) => i.type === "consumable");
                  if (consumables.length === 0) {
                    ctx.ui.notify("没有可用的消耗品", "warning");
                    return;
                  }
                  // 简单版：使用第一个消耗品（完整实现应用菜单选择）
                  const item = consumables[0];
                  const idx = p.inventory.indexOf(item);
                  if (idx >= 0) {
                    let healed = false;
                    for (const eff of item.effects || []) {
                      if (eff.type === "heal") {
                        let amt = typeof eff.value === "string" ? parseInt(eff.value) || 5 : Number(eff.value);
                        p.hp.current = Math.min(p.hp.max, p.hp.current + amt);
                        healed = true;
                      }
                    }
                    p.inventory.splice(idx, 1);
                    saveState();
                    ctx.ui.notify(`使用了 ${item.name}${healed ? `，HP ${p.hp.current}/${p.hp.max}` : ""}`, "info");
                    rerender(filter, sort, done);
                  }
                }
                else if (key === "d") {
                  if (items.length > 0) {
                    const last = items[items.length - 1];
                    const idx = p.inventory.indexOf(last);
                    if (idx >= 0) {
                      const name = p.inventory[idx].name;
                      p.inventory.splice(idx, 1);
                      saveState();
                      ctx.ui.notify(`丢弃了 ${name}`, "info");
                      rerender(filter, sort, done);
                    }
                  }
                }
              },
              invalidate() {},
            };
          },
          { overlay: true }
        );
        done();
      };

      rerender("all", "name", () => {});
    },
  };
