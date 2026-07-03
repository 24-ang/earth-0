import { Type } from "typebox";

export default {
    name: "send_sms", label: "发送短信",
    description: "向NPC发送短信。需在通讯录中且好感≥40。",
    parameters: Type.Object({
      to: Type.String({ description: "收信NPC名称" }),
      text: Type.String({ description: "短信内容" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getPlayerPhoneData, getPlayerPhone, createDefaultPhoneData, canContact, deliverMessage } =
        await import("../../engine/phone.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      let pd = getPlayerPhoneData();
      if (!pd) {
        const phone = getPlayerPhone();
        if (phone) {
          (phone as any).phoneData = createDefaultPhoneData(gameState.player.name);
          saveState();
          pd = (phone as any).phoneData;
        }
      }
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机。" }], details: {} };
      }
      if (!canContact(pd, params.to)) {
        const contact = pd.contacts.find(c => c.name === params.to);
        if (!contact) {
          return { content: [{ type: "text", text: `${params.to} 不在你的通讯录中。` }], details: {} };
        }
        return { content: [{ type: "text", text: `与 ${params.to} 的好感度不足（需>=40，当前通讯录可见需>=20）。` }], details: {} };
      }
      const msg = deliverMessage(pd, gameState.player.name, params.to, params.text);
      saveState();
      return {
        content: [{ type: "text", text: `已向 ${params.to} 发送短信: "${params.text}"` }],
        details: { message: msg },
      };
    },
  };
