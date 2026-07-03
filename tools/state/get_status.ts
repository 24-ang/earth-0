import { Type } from "typebox";

export default {
    name: "get_status", label: "状态",
    description: "获取玩家或NPC的HP/属性/位置。",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const { gameState, getBodyForAge, getNpcCurrentAge } = await import("../../engine/state.ts");
      if (params.name === gameState.player.name || params.name === "玩家") {
        return { content: [{ type: "text", text: JSON.stringify(gameState.player, null, 2) }], details: { character: gameState.player } };
      }
      const { findCharacter } = await import("../../engine/state.ts");
      const c = findCharacter(params.name);
      // 兜底：运行时 NPC（临时 NPC / 懒实例化但未在 characters.json 中）
      if (!c) {
        const npc = gameState.npcs[params.name];
        if (npc && npc.alive) {
          return { content: [{ type: "text", text: JSON.stringify({ name: params.name, location: npc.currentRoom || "未知", attributes: npc.attributes, hp: npc.hp, scheduleGroup: npc.scheduleGroup }, null, 2) }], details: {} };
        }
        return { content: [{ type: "text", text: "无此角色" }], details: {} };
      }
      const age = getNpcCurrentAge(c.base_age || 16);
      const body = getBodyForAge(c, age);
      return { content: [{ type: "text", text: JSON.stringify({ name: c.name, location: c.default_location, attributes: c.attributes, skills: c.skills, hp: c.hp, body: body ? `${body.height_cm}cm ${body.cup||""}` : "" }, null, 2) }], details: {} };
    },
  };
