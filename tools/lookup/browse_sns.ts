import { Type } from "typebox";

export default {
    name: "browse_sns", label: "浏览社交",
    description: "浏览社交时间线(mixi/Twitter)。了解角色动态。",
    parameters: Type.Object({
      platform: Type.Optional(Type.String({ description: "'mixi' 或 'twitter'，不传则返回全部" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { getPlayerPhone, getPlayerPhoneData, createDefaultPhoneData } = await import("../../engine/phone.ts");
      let pd = getPlayerPhoneData();
      if (!pd) {
        const phone = getPlayerPhone();
        if (phone) {
          const { gameState, saveState } = await import("../../engine/state.ts");
          phone.phoneData = createDefaultPhoneData(gameState.player.name);
          saveState();
          pd = phone.phoneData;
        }
      }
      if (!pd) {
        return { content: [{ type: "text", text: "你没有手机。" }], details: {} };
      }
      let posts = pd.snsPosts;
      if (params.platform) {
        posts = posts.filter(p => p.platform === params.platform);
      }
      if (posts.length === 0) {
        return { content: [{ type: "text", text: "时间线上没有帖子。" }], details: {} };
      }
      const recent = posts.slice(-10).reverse();
      const text = recent.map(p =>
        `[${p.platform}] ${p.author}: ${p.text}  ❤️${p.likes}  ${p.timestamp}`
      ).join("\n");
      return { content: [{ type: "text", text }], details: { posts: recent } };
    },
  };
