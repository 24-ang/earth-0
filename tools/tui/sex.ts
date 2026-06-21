import { Type } from "typebox";
import { showMenu, showPanel } from "../helpers.ts";

export default {
    description: "Layer1 状态面板：查看所有NPC的性欲/兴奋/心里话",
    handler: async (_args, ctx) => {
      const { gameState } = await import("../../engine/state.ts");
      const sexStates = gameState.sexStates || {};
      const keys = Object.keys(sexStates);

      const renderSexCard = async (s: SexState) => {
        const p = s.profile;
        const charName = (p as any).name || "未知";
        const lines = [
          `欲望: ${s.desire}/100  兴奋: ${s.arousal}/100`,
          `态度: ${p.attitude}  经验: ${p.experience}`,
          `周期: 第${s.cycleDay}天 ${s.cyclePhase}  高潮阈值: ${p.climaxThreshold}`,
          `高潮: ${s.climaxCount}次  潮吹: ${s.squirtCount}次`,
        ];
        // 初体验里程碑
        if (s.milestones) {
          const ml: string[] = [];
          const m = s.milestones;
          if (m.firstKiss.given) ml.push(`初吻: ${m.firstKiss.partner} (${m.firstKiss.date})`);
          else ml.push(`初吻: 未`);
          if (!m.virginity.isVirgin) ml.push(`初夜: ${m.virginity.lostTo} (${m.virginity.lostAt})`);
          else ml.push(`初夜: 未`);
          if (!m.analVirginity.isVirgin) ml.push(`菊初: ${m.analVirginity.lostTo} (${m.analVirginity.lostAt})`);
          lines.push(`💝 初体验: ${ml.join(" | ")}`);
        }
        lines.push(``);
        lines.push(`喜欢: ${p.likes.join("、")}`,
          `排斥: ${p.dislikes.join("、")}`,
        );
        if (p.female) {
          lines.push(``);
          lines.push(`胸: ${p.female.breast.cup}cup ${p.female.breast.shape} ${p.female.breast.feel}`);
          lines.push(`秘部: ${p.female.vagina.type} ${p.female.vagina.tightness} ${p.female.vagina.depth_cm}cm`);
          lines.push(`阴蒂: ${p.female.clitoris}`);
        } else if (p.male) {
          lines.push(``);
          const circum = p.male.penis.circumcised ? "已割" : "未割";
          lines.push(`阴茎: ${p.male.penis.length_cm}cm × ${p.male.penis.girth_cm}cm ${p.male.penis.shape} ${p.male.penis.head_size}头 ${circum} ${p.male.penis.color}色`);
          lines.push(`睾丸: ${p.male.testicles.size}`);
        }
        // 可用体位
        try {
          const { getAvailableActions } = await import("../../engine/sex.ts");
          let posDB: any = null;
          try {
            const { positionsCatalog } = await import("../../engine/state.ts");
            posDB = positionsCatalog;
          } catch (e) {
            console.error("positionsCatalog lookup error in showMenu status:", e);
          }
          const avail = getAvailableActions(p, s, posDB);
          if (avail.actions.length > 0 || avail.positions.length > 0) {
            lines.push(``);
            lines.push(`可用动作: ${avail.actions.join("、")}`);
            if (avail.positions.length > 0) lines.push(`可用体位: ${avail.positions.join("、")}`);
            if (avail.locked.length > 0) lines.push(`🔒 锁定: ${avail.locked.join("、")}`);
            if (avail.lockedPositions.length > 0) lines.push(`🔒 体位解锁: ${avail.lockedPositions.join("、")}`);
          }
        } catch (e) {
          console.error("getAvailableActions error in showMenu status:", e);
        }
        if (s.thoughts && s.thoughts.length > 0) {
          lines.push(``);
          lines.push(`心里话:`);
          s.thoughts.slice(-3).forEach((t: any) => lines.push(`  「${t.text}」`));
        }
        await showPanel(ctx, `🔞 Layer1 - ${charName}`, lines);
      };

      if (keys.length === 0) {
        if (gameState.player.sex) {
          await renderSexCard(gameState.player.sex);
        } else {
          ctx.ui.notify("无活跃的 SexState。进入亲密场景后自动创建。", "info");
        }
      } else if (keys.length === 1) {
        await renderSexCard(sexStates[keys[0]]);
      } else {
        const menuItems: MenuItem[] = keys.map(k => {
          const s = sexStates[k];
          return {
            label: `👤 ${k}`,
            detail: `欲望:${s.desire} 兴奋:${s.arousal}`,
            action: async (done) => {
              await renderSexCard(s);
              done();
            }
          };
        });
        await showMenu(ctx, "🔞 Layer1 角色选择", menuItems);
      }
    },
  };
