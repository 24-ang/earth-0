import { Type } from "typebox";

export default {
    name: "post_sns", label: "发帖",
    description: "NPC或玩家发社交媒体帖。author:NPC名或'玩家'/platform:mixi|twitter/text:内容/likes:初始赞数。",
    parameters: Type.Object({
      author: Type.String({ description: "发帖人：NPC名 或 '玩家'" }),
      platform: Type.String({ description: "'mixi' 或 'twitter'" }),
      text: Type.String({ description: "帖子内容" }),
      likes: Type.Optional(Type.Number({ description: "初始赞数，默认0" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { createDefaultPhoneData, syncContactsFromRelationships } = await import("../../engine/phone.ts");
      const { gameState, saveState } = await import("../../engine/state.ts");
      // 直接扫背包+装备找手机（不靠 phone.ts 的静态 import——pi 管线里可能拿不同实例）
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
        return { content: [{ type: "text", text: "你没有手机。无法发布SNS帖。" }], details: {} };
      }
      syncContactsFromRelationships(gameState, pd);
      const post = {
        id: Date.now(),
        author: params.author,
        text: params.text,
        timestamp: gameState.time.game_date,
        platform: params.platform as "mixi" | "twitter",
        likes: params.likes || 0,
      };
      pd.snsPosts.push(post);
      saveState();
      return { content: [{ type: "text", text: `[${params.platform}] ${params.author} 发布了: "${params.text}"` }], details: { post } };
    },
  };
