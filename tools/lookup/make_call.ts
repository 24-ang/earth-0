import { Type } from "typebox";

export default {
    name: "make_call", label: "打电话",
    description: "NPC或玩家拨打/接听/挂断电话。caller:拨打方姓名/callee:接听方姓名/action:dial(拨打)|answer(接听)|decline(拒接)|hangup(挂断)。",
    parameters: Type.Object({
      caller: Type.String({ description: "拨打方姓名（例如：'玩家'，或 NPC 名字）" }),
      callee: Type.String({ description: "接听方姓名（例如：'玩家'，或 NPC 名字）" }),
      action: Type.String({ description: "操作类型：dial(拨打) | answer(接听) | decline(拒接) | hangup(挂断)" }),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getPlayerPhoneData, initiateCall, endCall, canContact, getPlayerPhone, createDefaultPhoneData } = await import("../../engine/phone.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      // 直接扫背包+装备找手机，不依赖 phone.ts 的静态 gameState 缓存
      const p = gameState.player;
      let phone: any = null;
      for (const item of Object.values(p.equipment)) {
        if (item?.effects?.some((e: any) => e.type === "communication") || item?.name?.includes("手机")) { phone = item; break; }
      }
      if (!phone) phone = p.inventory.find((i: any) => i.effects?.some((e: any) => e.type === "communication") || i.name?.includes("手机")) || null;
      let pd = phone?.phoneData || null;
      if (!pd && phone) {
        phone.phoneData = createDefaultPhoneData(p.name);
        saveState();
        pd = phone.phoneData;
      }
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机。无法进行通话操作。" }], details: {} };
      }

      const action = params.action.toLowerCase();
      if (action === "dial") {
        if (params.caller === "玩家" || params.caller === pd.owner) {
          const { syncContactsFromRelationships } = await import("../../engine/phone.ts");
          syncContactsFromRelationships(gameState, pd);
          if (!canContact(gameState, pd, params.callee)) {
            return { content: [{ type: "text", text: `你与 ${params.callee} 关系不够亲密，无法主动拨打电话。` }], details: {} };
          }
        }
        
        const call = initiateCall(gameState, pd, params.caller, params.callee);
        saveState();
        return { content: [{ type: "text", text: `${params.caller} 拨打了 ${params.callee} 的电话...` }], details: { call } };
      } 
      
      if (action === "answer") {
        const call = endCall(gameState, pd, "answered");
        if (!call) {
          return { content: [{ type: "text", text: "当前没有正在呼叫的电话。" }], details: {} };
        }
        saveState();
        return { content: [{ type: "text", text: `通话接通。${call.caller} 与 ${call.callee} 开始通话。` }], details: { call } };
      }

      if (action === "decline") {
        const call = endCall(gameState, pd, "rejected");
        if (!call) {
          return { content: [{ type: "text", text: "当前没有正在呼叫的电话。" }], details: {} };
        }
        saveState();
        return { content: [{ type: "text", text: `已拒接 ${call.caller} 的来电。` }], details: { call } };
      }

      if (action === "hangup") {
        const ongoing = pd.callLog.find(c => c.status === "ongoing");
        if (ongoing) {
          const call = endCall(gameState, pd, "missed");
          saveState();
          return { content: [{ type: "text", text: `通话已结束（未接听，挂断）。` }], details: { call } };
        }
        
        const lastCall = pd.callLog[pd.callLog.length - 1];
        if (lastCall && lastCall.status === "answered") {
          return { content: [{ type: "text", text: `通话已挂断。` }], details: { call: lastCall } };
        }
        
        return { content: [{ type: "text", text: "当前没有活跃的通话。" }], details: {} };
      }

      return { content: [{ type: "text", text: `未知的通话动作: ${params.action}` }], details: {} };
    }
  };
