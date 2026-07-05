import { Type } from "typebox";

export default {
    name: "interact_furniture", label: "家具交互",
    description: "与家具互动。action自由发挥，引擎兜底——未定义的动作也会正常执行。",
    parameters: Type.Object({
      furniture: Type.String({ description: "家具名称，如'床'、'椅子'、'课桌'" }),
      action: Type.Optional(Type.String({ description: "动作。不限于预定义列表，任意动词均可（翻/爬/摸/钉/写/躲/蹭/靠/修/踢/搬...），引擎自动兜底" })),
      custom_action: Type.Optional(Type.Object({
        effect: Type.Optional(Type.String({ description: "效果类型: rest|sleep|train|shop|storage|narrative|climb|toggle|hide|unhide" })),
        fatigue_reduction: Type.Optional(Type.Number({ description: "疲劳减少量（rest/sleep效果时）" })),
        hours: Type.Optional(Type.Number({ description: "耗时（sleep/study效果时）" })),
        skill: Type.Optional(Type.String({ description: "技能名（train效果时）" })),
        exp: Type.Optional(Type.Number({ description: "经验值（train效果时）" })),
        narrative: Type.Optional(Type.String({ description: "自定义叙事文本，不填则引擎自动生成" })),
      }, { description: "自定义动作效果。不填则引擎自动推断。让LLM自由定义新交互" })),
    }),
    async execute(_id: string, params: any, _s: any, _o: any, _ctx: any) {
      const { gameState, saveState, getRoom } = await import("../../engine/state.ts");
      const { interactFurniture, findFurnitureDef, getAvailableActions, getActionsFromPhysical } = await import("../../engine/furniture.ts");

      const loc = gameState.player.location;
      const room = getRoom(loc);
      const gridPos = gameState.player.gridPos as [number, number] | null;
      const cells = room?.cells ?? null;

      // 查找格子上的内联动作定义
      let inlineActions: Record<string, any> | null = null;
      if (cells && gridPos) {
        for (const row of cells) {
          for (const c of row) {
            if (c?.furniture === params.furniture && (c as any).furniture_actions) {
              inlineActions = (c as any).furniture_actions;
              break;
            }
          }
          if (inlineActions) break;
        }
      }

      // LLM 自定义动作：合入 inlineActions
      if (params.custom_action) {
        const ca = params.custom_action;
        inlineActions = inlineActions || {};
        inlineActions[params.action || "自定义"] = {
          effect: ca.effect || "narrative",
          fatigue_reduction: ca.fatigue_reduction,
          hours: ca.hours,
          skill: ca.skill,
          exp: ca.exp,
          narrative: ca.narrative,
        };
      }

      // 列出可选动作
      if (!params.action || params.action === "?") {
        let actions: string[];
        if (inlineActions) {
          actions = Object.keys(inlineActions);
        } else {
          const def = findFurnitureDef(params.furniture, gameState.activeWorld);
          actions = getAvailableActions(def, params.furniture);
        }
        // 加一句提示 LLM 可以自定义
        actions.push("...（任意动词均可，引擎兜底）");
        return {
          content: [{ type: "text", text: `【${params.furniture}】可以：${actions.join("、")}。` }],
          details: { available: actions },
        };
      }

      const result = await interactFurniture(params.furniture, params.action, gameState, gridPos, cells, inlineActions);
      saveState();
      return {
        content: [{ type: "text", text: result.message }],
        details: { effects: result.effects },
      };
    },
  };
