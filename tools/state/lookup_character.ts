import { Type } from "typebox";

export default {
    name: "lookup_character", label: "查角色",
    description: "查询角色属性/装备(含flavor)/技能/身体。描写服装细节前务必调用。",
    parameters: Type.Object({ name: Type.String({ description: "角色名" }) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { findCharacter, getBodyForAge, getNpcCurrentAge, gameState } = await import("../../engine/state.ts");
      const { itemsCatalog } = await import("../../engine/state.ts");
      const c = findCharacter(params.name);
      // 查不到静态角色但可能是玩家自身
      if (!c) {
        if (params.name === gameState.player.name) {
          const p = gameState.player;
          const body = p.body || getBodyForAge({ base_age: p.age, gender: p.gender, body: p.body }, p.age);
          return { content: [{ type: "text", text: JSON.stringify({
            name: p.name, gender: p.gender, age: p.age,
            body, attributes: p.attributes, skills: p.skills,
            abilities: p.abilities, equipment: p.equipment,
            inventory: p.inventory.map((i: any) => i.name),
            hp: p.hp, ac: p.ac, funds: p.funds,
            titles: p.titles, flags: p.flags,
            note: "此为你自己的角色信息（非 NPC）"
          }, null, 2) }], details: {} };
        }
        return { content: [{ type: "text", text: "无此角色" }], details: {} };
      }
      const age = getNpcCurrentAge(c.base_age || 16);
      const npc = gameState.npcs?.[params.name];
      const aged = { ...c, body: getBodyForAge(c, age), schedule_group: npc?.scheduleGroup || c.schedule_group };

      // 构建装备物品的 flavor 速查表
      const flavorMap = new Map<string, string>();
      for (const cat of Object.values(itemsCatalog as any)) {
        for (const [iname, item] of Object.entries(cat as any)) {
          if ((item as any).flavor) flavorMap.set(iname, (item as any).flavor);
        }
      }

      // 当前穿着物品及flavor（年龄感知：ageGap>3 用通用描述，与 getNPCOutfitDesc 一致）
      const equipLines: string[] = [];
      if (npc) {
        const baseAge = c.base_age || 16;
        const curAge = age;
        const ageGap = Math.abs(curAge - baseAge);
        let outfit: any = null;
        if (c.outfits_by_age) {
          const keys = Object.keys(c.outfits_by_age).map(Number).sort((a,b) => a-b);
          let best = keys[0]!;
          for (const k of keys) { if (k <= curAge) best = k; else break; }
          outfit = c.outfits[c.outfits_by_age[String(best)]];
        }
        if (!outfit && ageGap <= 3) {
          const key = npc.currentOutfit || "school";
          outfit = c.outfits?.[key];
        }
        if (outfit) {
          const outer: string[] = [];
          const inner: string[] = [];
          for (const [slot, itemName] of Object.entries(outfit)) {
            const name = itemName as string;
            const flavor = flavorMap.get(name);
            const line = flavor ? `${name}（${flavor}）` : name;
            if (slot.startsWith("inner_")) inner.push(line);
            else outer.push(line);
          }
          if (outer.length > 0) equipLines.push(`穿着: ${outer.join("、")}`);
          if (inner.length > 0) equipLines.push(`内衣: ${inner.join("、")}`);
        } else if (ageGap > 3) {
          // 年龄差距过大，无适配 outfit → 通用描述
          const body = aged.body;
          const h = body?.height_cm || "?";
          if (curAge <= 6) equipLines.push(`穿着: ${h}cm儿童便服`);
          else if (curAge <= 12) equipLines.push(`穿着: ${h}cm小学生校服`);
          else if (curAge <= 15) equipLines.push(`穿着: ${h}cm中学生校服`);
        }
        // 非服装装备（武器等）
        const nonClothing = Object.entries(npc.equipment)
          .filter(([slot, item]: [string, any]) => item && !["inner_top", "inner_bot", "top", "bottom", "legs", "feet", "head", "shirt"].includes(slot));
        for (const [slot, item] of nonClothing) {
          const it = item as any;
          const flavor = flavorMap.get(it.name);
          equipLines.push(`${slot}: ${it.name}${flavor ? `（${flavor}）` : ""}`);
        }
      }

      const equipStr = equipLines.length > 0 ? `\n\n[当前装备]\n${equipLines.join("\n")}` : "";

      // P3: Include character facts filtered by relationship level
      const rel = gameState.player.relationships[params.name];
      const stage = rel?.stage || "陌生";
      const { getCharacterFacts } = await import("../../engine/state.ts");
      const facts = getCharacterFacts(params.name, stage, params.name === gameState.player.name);
      let factStr = "";
      if (facts.public.length > 0) {
        factStr += `\n\n[公开背景·${stage}级可见]`;
        for (const f of facts.public) {
          factStr += `\n  ${f.level}: ${f.text}`;
        }
      }
      if (facts.private.length > 0 && stage !== "陌生") {
        factStr += `\n\n[私下了解·${stage}级可见]`;
        for (const f of facts.private) {
          factStr += `\n  ${f.level}: ${f.text}`;
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(aged, null, 2) + equipStr + factStr }], details: { character: aged } };
    },
  };
