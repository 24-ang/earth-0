import { Type } from "typebox";

export default {
    name: "interact_furniture", label: "家具交互",
    description: "与场景中的家具互动。furniture:家具名。action:坐/躺/睡/查看/使用...。不在目录的家具也可交互(泛用效果)。不限制LLM叙事。",
    parameters: Type.Object({
      furniture: Type.String({ description: "家具名称，如'床'、'椅子'" }),
      action: Type.String({ description: "动作，如'睡觉'、'坐下'。不填则列出可选动作。" }),
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

      // 列出可选动作
      if (!params.action || params.action === "?" || params.action === "查看") {
        let actions: string[];
        if (inlineActions) {
          actions = Object.keys(inlineActions);
        } else {
          const def = findFurnitureDef(params.furniture, gameState.activeWorld);
          actions = getAvailableActions(def, params.furniture);
        }
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
