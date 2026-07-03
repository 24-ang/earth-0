import { Type } from "typebox";

export default {
    name: "check_phone", label: "查看手机",
    description: "查看手机未读通知+通讯录。自动同步好感联系人。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { syncContactsFromRelationships, getUnreadSummary, createDefaultPhoneData } =
        await import("../../engine/phone.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      // 直接扫背包+装备找手机，不依赖 phone.ts 的静态 gameState 缓存
      const p = gameState.player;
      let phone: any = null;
      for (const item of Object.values(p.equipment)) {
        if (item?.effects?.some((e: any) => e.type === "communication") || item?.name?.includes("手机")) {
          phone = item; break;
        }
      }
      if (!phone) {
        phone = p.inventory.find((i: any) =>
          i.effects?.some((e: any) => e.type === "communication") || i.name?.includes("手机")
        );
      }
      let pd = null;
      if (phone) {
        if (!phone.phoneData) {
          phone.phoneData = createDefaultPhoneData(p.name);
          saveState();
        }
        pd = phone.phoneData;
      }
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机或手机数据未初始化。" }], details: {} };
      }
      syncContactsFromRelationships(pd);
      const summary = getUnreadSummary(pd);
      const contactList = pd.contacts.map(c => `${c.name} (${c.relation})`).join("、");
      const text = [
        summary || "[手机] 没有新通知。",
        `通讯录(${pd.contacts.length}人): ${contactList || "空"}`,
      ].join("\n");
      return { content: [{ type: "text", text }], details: { unreadCount: pd.unreadCount, contacts: pd.contacts.length } };
    },
  };
