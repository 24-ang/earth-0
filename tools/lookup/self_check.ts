import { Type } from "typebox";

export default {
    name: "self_check", label: "自检",
    description: "引擎自检：验证 module 实例一致性",
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _s: any, _o: any, _ctx: any) {
      const s = await import("../../engine/state.ts");
      const sg = await import("../../engine/state-grid.ts");
      const ph = await import("../../engine/phone.ts");
      const gs1 = s.gameState;

      // 这个 gs1 的引用在别的模块里是不是同一个对象
      const phone = gs1.player.inventory.find((i: any) => i.name?.includes("手机"))
        || Object.values(gs1.player.equipment).find((i: any) => i?.name?.includes("手机"));

      const lines = [
        `state.ts gameState === state-grid.ts gameState? ${(s.gameState as any) === (sg as any).gameState}`,
        `player.name = ${gs1.player.name}`,
        `player.gender = ${gs1.player.gender}`,
        `player.location = ${gs1.player.location}`,
        `gridPos = ${JSON.stringify(gs1.player.gridPos)}`,
        `flags = ${JSON.stringify(gs1.player.flags)}`,
        `phone in inventory = ${phone ? phone.name : "NONE"}`,
        `phone has phoneData = ${!!phone?.phoneData}`,
        `phone in equipment = ${Object.values(gs1.player.equipment).filter((i: any) => i?.name?.includes("手机")).map((i: any) => i.name).join(",") || "NONE"}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
    },
  };
