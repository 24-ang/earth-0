import { showPanel } from "../helpers.ts";

export default {
    description: "查看当前队伍成员状态",
    handler: async (_args, ctx) => {
      const { gameState, getOrCreateNPC, findCharacter } = await import("../../engine/state.ts");
      const p = gameState.player;
      const lines: string[] = [];
      
      lines.push(`🛡️ 当前队伍状态 (队长: ${p.name})`);
      lines.push("────────────────────────────────────────");
      
      // 主角卡
      lines.push(`👤 [主角] ${p.name} (${p.gender}) | ${p.age}岁`);
      lines.push(`   HP: ${p.hp.current}/${p.hp.max} | AC: ${p.ac} | 位置: ${p.location}`);
      lines.push("────────────────────────────────────────");

      // 队友卡
      if (p.party && p.party.length > 0) {
        for (const name of p.party) {
          const char = findCharacter(name);
          const npcState = getOrCreateNPC(name);
          if (char) {
            lines.push(`👥 [队友] ${char.name} (${char.gender === "female" ? "女" : "男"})`);
            lines.push(`   位置: ${npcState.currentRoom || char.default_location}`);
            if (char.attributes) {
              const a = char.attributes;
              lines.push(`   属性: 力${a.力量} 敏${a.敏捷} 体${a.体质} 智${a.智力} 感${a.感知} 魅${a.魅力}`);
            }
            if (char.appearance_brief || char.hair_color || char.hair_style || char.eye_color) {
              const hairDesc = [char.hair_color, char.hair_style].filter(Boolean).join("");
              const appearanceParts: string[] = [];
              if (hairDesc) appearanceParts.push(hairDesc);
              if (char.eye_color) appearanceParts.push(`${char.eye_color}眼睛`);
              if (char.hair_accessories) appearanceParts.push(char.hair_accessories);
              const appearanceStr = appearanceParts.length > 0 ? appearanceParts.join("、") : char.appearance_brief;
              lines.push(`   外貌: ${appearanceStr}`);
            }
            lines.push("────────────────────────────────────────");
          }
        }
      } else {
        lines.push("ℹ️ （队伍目前没有其他成员，你正独自一人前行）");
      }
      
      await showPanel(ctx, "👥 我的队伍", lines);
    },
  };
