/**
 * /sandbox — 一键填充测试数据，方便测 HUD 全部面板。
 * 不会改变玩家位置，只在当前地点撒 NPC、物品、SexState、任务、Flag。
 */
export default {
  description: "填充测试数据（NPC/物品/任务/Flag/SexState），不消耗回合",
  handler: async (_args: string, ctx: any) => {
    const { gameState, saveState, getOrCreateNPC, updateRelation } = await import("../../engine/state.ts");
    const loc = gameState.player?.location || "千葉駅前";
    const p = gameState.player;

    // ═══ 玩家装备 + 技能 ═══
    if (!p.skills) p.skills = {};
    p.skills["潜行"] = { level: 2, exp: 0, nextLevel: 20 };
    p.skills["洞察"] = { level: 3, exp: 0, nextLevel: 30 };
    p.skills["心理"] = { level: 1, exp: 0, nextLevel: 10 };
    p.skills["国語"] = { level: 2, exp: 0, nextLevel: 20 };
    p.skills["运动"] = { level: 1, exp: 0, nextLevel: 10 };
    if (!p.equipment) p.equipment = {};
    if (!p.equipment.right_hand) {
      p.equipment.right_hand = { name: "铁管", type: "weapon", slot: "right_hand", damage: { dice: "1d6", damageType: "钝击" }, weight: 2, volume: 2, effects: [], state: "intact", flavor: "冷冰冰的，敲上去有闷响。" };
    }
    if (!p.equipment.top) {
      p.equipment.top = { name: "校服外套", type: "clothing", slot: "top", weight: 0.8, volume: 1, effects: [{ type: "cold_resist", value: 1 }], state: "intact" };
    }
    if (!p.equipment.feet) {
      p.equipment.feet = { name: "运动鞋", type: "clothing", slot: "feet", weight: 0.6, volume: 1, effects: [], state: "damaged", flavor: "鞋底磨得快穿了。" };
    }

    // ═══ 背包（分类测试：we/cl/co/to/ar 全覆盖 + consumable 供常驻动作"吃"） ═══
    if (!p.inventory || !Array.isArray(p.inventory)) p.inventory = [];
    const bagPool = [
      { name: "木刀", type: "weapon", slot: "right_hand", weight: 1.5, effects: [{ type: "attribute_bonus", value: 1, condition: "装备时力量+1" }], state: "intact" },
      { name: "运动衫", type: "clothing", slot: "shirt", weight: 0.4, effects: [], state: "intact" },
      { name: "绷带", type: "consumable", slot: "acc", weight: 0.1, effects: [{ type: "heal", value: 5 }], state: "intact" },
      { name: "饭团", type: "consumable", slot: "acc", weight: 0.1, effects: [{ type: "heal", value: 3 }], state: "intact" },
      { name: "手电筒", type: "tool", slot: "left_hand", weight: 0.3, effects: [{ type: "pocket", value: 1 }], state: "intact" },
      { name: "防刺背心", type: "armor", slot: "shirt", weight: 3, effects: [{ type: "damage_reduction", value: 3 }], state: "intact" },
    ];
    for (const it of bagPool) {
      if (!p.inventory.some((i: any) => i.name === it.name)) p.inventory.push(it);
    }

    // ═══ 玩家 SexState + layer1（方便测双方面板和性征行） ═══
    gameState.layer1Enabled = true;
    if (!p.sex) {
      p.sex = {
        profile: {
          attitude: "主动", experience: "初体验后",
          male: {
            penis: { length_cm: 14, erect_length_cm: 17, erect_girth_cm: 13, shape: "直", circumcised: false },
            testicles: { size: "中等" },
            pubic_hair: { amount: "中等", color: "黑", style: "自然" },
          },
          climaxThreshold: 60,
        },
        desire: 30, arousal: 15, cycleDay: 0, cyclePhase: "安全期",
        climaxed: false, climaxCount: 0, squirtCount: 0,
        contraceptionUsed: "condom",
        thoughts: [],
      };
    }

    // ═══ NPC + 关系 + SexState ═══
    const testNpcs = [
      { name: "雪之下雪乃", aff: 88, stage: "恋人", romance: "恋人", hp: 12, cash: 450,
        lw: "又一个抱无聊期待来的人…但眼神不太一样。",
        sexDesire: 70, sexArousal: 45, sexClimax: 1, sexSquirt: 1, sexPhase: "排卵期", sexDay: 14 },
      { name: "由比滨结衣", aff: 55, stage: "好朋友", hp: 14, cash: 320,
        lw: "小雪乃居然说了那么多话…说不定能改变她？" },
      { name: "比企谷八幡", aff: 5, stage: "陌生", hp: 16, cash: 200,
        lw: "这年头连行为艺术都这么卷了吗。" },
    ];
    if (!(gameState as any).sexStates) (gameState as any).sexStates = {};
    for (const n of testNpcs) {
      const npc = getOrCreateNPC(n.name);
      npc.alive = true;
      npc.currentRoom = loc;
      npc.gridPos = [Math.floor(Math.random() * 3) + 1, Math.floor(Math.random() * 3)];
      npc.lastWords = "[内心独白] " + n.lw;
      npc.action = n.aff >= 80 ? "温柔地注视着你" : n.aff >= 30 ? "友好地看向这边" : "警惕地观察周围";
      npc.hp = { current: n.hp, max: n.hp };
      npc.funds = n.cash;
      npc.equipment = { left_hand: null, right_hand: n.name === "雪之下雪乃" ? { name: "文库本" } : { name: "手机" } };
      updateRelation(gameState.player.relationships, n.name, n.aff, "测试初始化");
      if (gameState.player.relationships[n.name]) {
        gameState.player.relationships[n.name].stage = n.stage;
        if ((n as any).romance) gameState.player.relationships[n.name].romance = (n as any).romance;
      }
      if ((n as any).sexDesire !== undefined) {
        (gameState as any).sexStates[n.name] = {
          profile: {}, desire: (n as any).sexDesire, arousal: (n as any).sexArousal,
          cycleDay: (n as any).sexDay || 1, cyclePhase: (n as any).sexPhase || "安全期",
          climaxed: false, climaxCount: (n as any).sexClimax || 0, squirtCount: (n as any).sexSquirt || 0, thoughts: [],
        };
      }
    }

    // ═══ 路人 ═══
    gameState._testCrowd = [
      { name: "窃窃私语的男生们", count: 3, height: "165-172cm", gridPos: [4, 1], act: "围在一起看手机，偶尔发出低笑声" },
      { name: "互相聊天的女生", count: 2, height: "158cm/162cm", gridPos: [3, 1], act: "边走边小声聊天，一人往这边瞥了一眼" },
    ];

    // ═══ 选项（行动 Tab） ═══
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

    // ═══ 场景页脚 ═══
    gameState._sceneFooter = {
      posture: "站在站前广场的自动贩卖机旁",
      location_detail: "千葉-千葉駅前-東口ロータリー",
      main_quest: "B-找到返回原来世界的方法",
    };

    // ═══ Flag（情报摘要行 + 警报段测试） ═══
    if (!gameState.flags) (gameState as any).flags = {};
    (gameState.flags as any).wanted = true;

    // ═══ 任务（情报摘要行计数 + 任务段） ═══
    if (!gameState.quests) (gameState as any).quests = {};
    (gameState.quests as any)["find_home"] = { title: "找到回家的方法", status: "active", type: "main" };
    (gameState.quests as any)["yukino_favor"] = { title: "雪乃的委托", status: "active", type: "side", progress: "2/3" };

    saveState();
    const modeInfo = gameState.mode === "sex" ? " 🔞sex" : "";
    ctx.ui.notify(`✅ 沙盒就绪${modeInfo} — ${loc}: ${testNpcs.length}NPC + 李箱6件 + 任务2 + Flag通缉`, "info");
  },
};
