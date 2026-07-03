import { Type } from "typebox";

export default {
    name: "instantiate_residence", label: "实例化住宅",
    description: "实例化住宅并接入导航。movePlayerIn=true玩家入住。",
    parameters: Type.Object({
      template: Type.String({ description: "模板ID，如 独栋_2F_4人家庭 / 公寓_3F_单身" }),
      name: Type.String({ description: "住宅名，如 秋月家 / 雪之下公寓" }),
      movePlayerIn: Type.Optional(Type.Boolean({ description: "玩家是否入住该宅。给玩家建家传true，给NPC建房传false。默认false" })),
      playerRoom: Type.Optional(Type.String({ description: "玩家入住房间，如 主卧/子女房A。不传用模板默认" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { instantiateResidenceAndIntegrate } = await import("../../engine/state-grid.ts");
      const r = instantiateResidenceAndIntegrate(params.template, params.name, {
        movePlayerIn: params.movePlayerIn ?? false,
        playerRoom: params.playerRoom,
      });
      const extra = r.playerLocation ? `\n玩家已入住: ${r.playerLocation}` : "\n（房间已可导航，用 go_to_location 前往）";
      return { content: [{ type: "text", text: r.reason + extra }], details: r };
    },
  };
