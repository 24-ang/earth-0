/**
 * /sandbox — 一键填充测试数据（NPC + 选项），方便测试 HUD 面板交互
 */
export default {
  description: "在当前地点填充测试NPC和选项（不消耗回合）",
  handler: async (_args: string, ctx: any) => {
    const { gameState, saveState, getOrCreateNPC, updateRelation } = await import("../../engine/state.ts");
    const loc = gameState.player?.location || "千葉駅前";

    // 放几个测试 NPC 到当前位置
    const testNpcs = [
      { name: "雪之下雪乃", aff: 12, stage: "陌生", lw: "又一个抱无聊期待来的人…但眼神不太一样。" },
      { name: "由比滨结衣", aff: 35, stage: "熟人", lw: "小雪乃居然说了那么多话…说不定能改变她？" },
      { name: "比企谷八幡", aff: 5, stage: "陌生", lw: "这年头连行为艺术都这么卷了吗。" },
    ];
    for (const n of testNpcs) {
      const npc = getOrCreateNPC(n.name);
      npc.alive = true;
      npc.currentRoom = loc;
      npc.gridPos = [Math.floor(Math.random() * 3) + 1, Math.floor(Math.random() * 3)];
      npc.lastWords = "[内心独白] " + n.lw;
      npc.action = n.aff >= 30 ? "友好地看向这边" : "警惕地观察周围";
      npc.equipment = { left_hand: null, right_hand: n.name === "雪之下雪乃" ? { name: "文库本" } : { name: "手机" } };
      updateRelation(gameState.player.relationships, n.name, n.aff, "测试初始化");
      if (gameState.player.relationships[n.name]) {
        gameState.player.relationships[n.name].stage = n.stage;
      }
    }

    // 几条路人
    gameState._testCrowd = [
      { name: "窃窃私语的男生们", count: 3, height: "165-172cm", gridPos: [4, 1], act: "围在一起看手机，偶尔发出低笑声" },
      { name: "互相聊天的女生", count: 2, height: "158cm/162cm", gridPos: [3, 1], act: "边走边小声聊天，一人往这边瞥了一眼" },
    ];

    // 伪造一条 prose + 选项
    (gameState as any)._renderedProse = [
      "四月清晨的千叶站前，阳光还带着薄薄的凉意。",
      "",
      "---",
      "> ① [普通]: 「早上好。」",
      "> ② [理智]: 「请问这里是千叶站吗？」",
      "> ③ [吐槽]: 「新学期的第一天就这么刺激啊。」",
      "> ④ [大胆]: *径直走向雪之下*",
      "> ⑤ [观察 Lv1]: 仔细观察对方的反应",
      "> ⑥ [持有:手机]: 拿出手机查看地图",
    ].join("\n");

    saveState();
    ctx.ui.notify("✅ 沙盒就绪 — " + loc + " 已放置 " + testNpcs.length + " 名 NPC + 6 选项", "info");
  },
};
