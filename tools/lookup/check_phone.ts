import { Type } from "typebox";

export default {
    name: "check_phone", label: "查看手机",
    description: "查看手机未读通知+通讯录。自动同步好感联系人。",
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _o, _ctx) {
      const { getPlayerPhoneData, syncContactsFromRelationships, getUnreadSummary } =
        await import("../../engine/phone.ts");
      const pd = getPlayerPhoneData();
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
