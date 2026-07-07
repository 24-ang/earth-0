import { Type } from "typebox";

export default {
  name: "perform_abortion",
  label: "进行人工流产",
  description: "在医院进行人工流产手术，仅限受孕90天内（visible期前）的女性NPC/玩家。",
  parameters: Type.Object({
    charName: Type.String({ description: "进行手术的女性角色姓名，可为主角自己" })
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState, getOrCreateNPC, addMemoryTag, findCharacter } = await import("../../engine/state.ts");
    const { currentDay } = await import("../../engine/timeline.ts");
    const { removeLifeEvent } = await import("../../engine/life-events.ts");

    // Resolve target actor
    let actor: any = null;
    let gender = "female";
    if (params.charName === gameState.player.name) {
      actor = gameState.player;
      gender = gameState.player.gender;
    } else {
      actor = getOrCreateNPC(params.charName);
      gender = findCharacter(params.charName)?.gender || "female";
    }

    if (gender !== "female") {
      return { content: [{ type: "text", text: `${params.charName}不是女性，无法进行人流手术。` }], details: {} };
    }

    if (actor.funds < 500) {
      return { content: [{ type: "text", text: `资金不足，流产手术需要 500 元，当前仅有 ${actor.funds} 元。` }], details: {} };
    }

    // Resolve location (must be at hospital to do this)
    const loc = actor.location || "千叶_住宅区";
    if (!loc.includes("医院") && !loc.includes("诊所") && loc !== "千叶_住宅区") {
      return { content: [{ type: "text", text: `${params.charName}目前不在医院或诊所，无法进行手术。请先前往医院。` }], details: {} };
    }

    // Check if pregnant — life events live on npcs table, not player
    const lifeEvents = actor.lifeEvents || gameState.npcs[params.charName]?.lifeEvents || [];
    const pregnancy = lifeEvents.find((e: any) => e.type === "pregnancy");
    if (!pregnancy) {
      return { content: [{ type: "text", text: `${params.charName}并未怀孕，无需进行人流手术。` }], details: {} };
    }

    const data = pregnancy.data as any;
    const day = currentDay();
    const daysElapsed = day - data.day_conceived;

    if (daysElapsed >= 90) {
      return { content: [{ type: "text", text: `${params.charName}怀孕天数已达 ${daysElapsed} 天（visible期或更晚），胚胎已发育成型，流产手术风险极高，医生拒绝了手术。` }], details: {} };
    }

    // Perform abortion
    actor.funds -= 500;
    removeLifeEvent(params.charName, pregnancy.id);

    // Apply physical effects
    if (actor.hp) {
      actor.hp.current = Math.max(5, actor.hp.current - 50);
    }
    actor.fatigue = 90;

    // Add memory tag
    addMemoryTag(params.charName, "进行了人工流产手术，身体和心理都感到虚弱", 365, "受伤");

    saveState();
    return { content: [{ type: "text", text: `${params.charName}在医院成功进行了人流手术（扣除500元）。手术对身体造成了较大消耗（HP减少，疲劳升至90%），并且留下了一道沉重的心灵阴影。` }], details: { success: true } };
  }
};
