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
      const { getPlayerPhoneData, getPlayerPhone, createDefaultPhoneData, syncContactsFromRelationships } = await import("../../engine/phone.ts");
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
        return { content: [{ type: "text", text: "你没有手机。无法发布SNS帖。" }], details: {} };
      }
      syncContactsFromRelationships(pd);
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
