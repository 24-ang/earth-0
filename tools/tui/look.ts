import { Type } from "typebox";
import { showMenu, showPanel, SLOT_NAMES, SLOT_NAMES_SHORT } from "../helpers.ts";

export default {
    description: "查看角色/物品详情。用法: /look <名>",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) { ctx.ui.notify("用法: /look <角色名或物品名>", "warning"); return; }
      const { gameState, getBodyForAge, getNpcCurrentAge, getOrCreateNPC, getNPCOutfitDesc, getAppearanceForAge, findCharacter, getCurrency } = await import("../../engine/state.ts");

      const isPlayer = name === gameState.player.name || name === "玩家" || name === "我";
      if (isPlayer) {
        const p = gameState.player;
        const lines = [
          `${p.name} | ${p.gender} | ${p.age}岁 | ${gameState.time.player_stage}`,
          `── 基本 ──`,
          `位置: ${p.location}  资金: ${getCurrency()}${p.funds}  疲劳: ${p.fatigue ?? 0}/100`,
          `HP: ${p.hp.current}/${p.hp.max}  AC: ${p.ac}`,
        ];
        if (p.body) {
          lines.push(`── 身体 ──`);
          const b = p.body;
          lines.push(`身材: ${b.height_cm}cm ${b.weight_kg}kg ${b.build}${b.cup ? " " + b.cup + "cup" : ""}`);
          if (b.measurements) lines.push(`三围: ${b.measurements.bust}-${b.measurements.waist}-${b.measurements.hips}`);
          if (b.leg_type || b.skin) {
            let feats = `特征: `;
            if (b.leg_type) feats += `${b.leg_type}腿 | `;
            if (b.skin) feats += `肤质:${b.skin.texture} | 肤色:${b.skin.base_tone}`;
            lines.push(feats.replace(/ \|\s*$/, ""));
          }
        }
        if (p.attributes) {
          lines.push(`── 属性 ──`);
          const a = p.attributes;
          lines.push(`力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        if (p.reputation && Object.keys(p.reputation).length > 0) {
          lines.push(`── 声望 ──`);
          lines.push(Object.entries(p.reputation).map(([k, v]) => `${k}(${v})`).join(" | "));
        }
        const eq = Object.entries(p.equipment).filter(([_, v]) => v);
        if (eq.length > 0) {
          lines.push(`── 装备 ──`);
          const flavorMap = new Map<string, string>();
          try {
            const { itemsCatalog } = await import("../../engine/state.ts");
            for (const cat of Object.values(itemsCatalog as any)) {
              for (const [iname, item] of Object.entries(cat as any)) {
                if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
              }
            }
          } catch (e) {
            console.error("showMenu status bar itemsCatalog flavor lookup error:", e);
          }
          eq.forEach(([s, it]) => {
            const flavor = flavorMap.get(it!.name);
            lines.push(`[${SLOT_NAMES_SHORT[s] || s}] ${flavor ? `${it!.name}（${flavor}）` : it!.name}`);
          });
        }
        await showPanel(ctx, p.name, lines);
        return;
      }

      let char = findCharacter(name);
      // 精确匹配失败 → 模糊匹配静态库
      if (!char) {
        const { allChars } = await import("../../engine/router.ts");
        char = allChars.find((c: any) => c.name === name || c.name.includes(name)) || null;
      }
      if (char) {
        const age = getNpcCurrentAge(char.base_age || 16);
        const body = getBodyForAge(char, age);
        const lines = [
          `${char.name} | ${char.gender === "female" ? "女" : "男"} | ${age}岁 (基础:${char.base_age})`,
          `── 外观 ──`
        ];
        
        const outfitRaw = getNPCOutfitDesc(char.name);
        const outfitParts = outfitRaw.split("。内: ");
        lines.push(`穿着: ${outfitParts[0]}`);
        if (outfitParts[1]) lines.push(`内衣: ${outfitParts[1]}`);

        // 结构化外貌（按年龄分层）
        const appLook = getAppearanceForAge(char, age);
        const hairEyeParts: string[] = [];
        const hairDesc = [appLook.hair_color, appLook.hair_style].filter(Boolean).join("");
        if (hairDesc) hairEyeParts.push(`💇 ${hairDesc}`);
        if (appLook.eye_color) hairEyeParts.push(`👁 ${appLook.eye_color}眼睛`);
        if (appLook.hair_accessories) hairEyeParts.push(`🎀 ${appLook.hair_accessories}`);
        if (hairEyeParts.length > 0) lines.push(hairEyeParts.join(" | "));

        if (body) {
          lines.push(`── 身体 ──`);
          lines.push(`身材: ${body.height_cm}cm ${body.weight_kg}kg ${body.build}`);
          let meas = `三围: `;
          if (body.measurements) meas += `${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
          if (body.cup) meas += ` (${body.cup}cup)`;
          if (body.body_shape) {
             const bs = body.body_shape;
             meas += ` [${bs.chest||""} ${bs.waist||""} ${bs.hips?bs.hips+"臀":""}]`;
          }
          if (meas !== `三围: `) lines.push(meas.replace(/\s+/g, ' '));
          
          let feats = `特征: `;
          if (body.leg_type) feats += `${body.leg_type}腿 | `;
          if (body.skin) feats += `肤质:${body.skin.texture} | 肤色:${body.skin.base_tone}`;
          if (feats !== `特征: `) lines.push(feats.replace(/ \|\s*$/, ''));
        }
        
        if (char.attributes) {
          lines.push(`── 属性 ──`);
          const a = char.attributes;
          lines.push(`力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
        }
        
        const npcState = getOrCreateNPC(char.name);
        
        lines.push(`── 动态 ──`);
        lines.push(`位置: ${npcState.currentRoom || "未知"}`);
        lines.push(`行为: ${npcState.action || "无"}`);
        lines.push(`日程组: ${npcState.scheduleGroup || char.schedule_group || "无"}`);

        // 与玩家的关系
        const rel = gameState.player.relationships[char.name];
        if (rel) {
          lines.push(`── 关系 ──`);
          const buildBar = (val: number) => { const f = Math.round(val / 20); return "■".repeat(f) + "□".repeat(5 - f); };
          let relLine = `好感: ${buildBar(rel.affection)} (${rel.affection}/100) | ${rel.stage}`;
          if (rel.romance) relLine += ` | 💕${rel.romance}`;
          lines.push(relLine);
          if (rel.notes) lines.push(`备注: ${rel.notes}`);
        }
        
        // 装备 flavor 速查
        const flavorMap = new Map<string, string>();
        try {
          const { itemsCatalog } = await import("../../engine/state.ts");
          for (const cat of Object.values(itemsCatalog as any)) {
            for (const [iname, item] of Object.entries(cat as any)) {
              if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
            }
          }
        } catch (e) {
          console.error("showMenu character status itemsCatalog flavor lookup error:", e);
        }

        const clothingSlots = ['top', 'shirt', 'inner_top', 'bottom', 'inner_bot', 'legs', 'feet'];
        const eq = Object.entries(npcState.equipment).filter(([k, v]) => v && !clothingSlots.includes(k));
        if (eq.length > 0) {
          lines.push(`── 携带装备 ──`);
          eq.forEach(([s, it]) => {
            const flavor = flavorMap.get(it!.name);
            lines.push(`[${SLOT_NAMES[s]||s}] ${flavor ? `${it!.name}（${flavor}）` : it!.name}`);
          });
        }
        
        if (npcState.inventory && npcState.inventory.length > 0) {
          lines.push("────────────────────────────────────────");
          lines.push(`🎒 携带物品:`);
          const items = npcState.inventory.map((i: any) => i.name);
          for (let i = 0; i < items.length; i += 3) {
            lines.push(`  ${items.slice(i, i + 3).join(" | ")}`);
          }
        }
        await showPanel(ctx, char.name, lines);
        return;
      }
      
      let item = gameState.player.inventory.find((i: any) => i.name.includes(name) || name.includes(i.name));
      if (!item) {
        for (const [_, eqItem] of Object.entries(gameState.player.equipment)) {
          if (eqItem && (eqItem.name.includes(name) || name.includes(eqItem.name))) {
            item = eqItem;
            break;
          }
        }
      }
      
      if (item) {
        const lines = [
          `类型: ${item.type} | 槽位: ${item.slot} | 重量: ${item.weight}kg | 状态: ${item.state}`,
        ];
        if (item.flavor) {
          lines.push(`描述: ${item.flavor}`);
        }
        if (item.damage) {
          lines.push(`伤害: ${item.damage.dice} (${item.damage.damageType})`);
        }
        if (item.effects && item.effects.length > 0) {
          lines.push("效果:");
          item.effects.forEach((eff: any) => {
            const groupStr = eff.group ? ` (${eff.group})` : "";
            lines.push(`  - ${eff.type}: ${eff.value}${groupStr}`);
          });
        }
        await showPanel(ctx, item.name, lines);
        return;
      }
      
      ctx.ui.notify(`未找到: ${name}`, "warning");
    },
  };
