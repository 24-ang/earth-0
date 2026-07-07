import { Type } from "typebox";

export default {
  name: "take_contraceptive_pill",
  label: "服用紧急避孕药",
  description: "事后72小时（3天）内服用紧急避孕药，有99%概率避孕或终止早期孕事。",
  parameters: Type.Object({
    charName: Type.String({ description: "服药的女性角色姓名，可为主角自己" })
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { gameState, saveState, getOrCreateNPC, findCharacter } = await import("../../engine/state.ts");
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
      return { content: [{ type: "text", text: `${params.charName}不是女性，无需服用避孕药。` }], details: {} };
    }

    if (actor.funds < 50) {
      return { content: [{ type: "text", text: `资金不足，购买紧急避孕药需要 50 元，当前仅有 ${actor.funds} 元。` }], details: {} };
    }

    // Check if pregnant (within 3 days) — life events live on npcs table, not player
    const lifeEvents = actor.lifeEvents || gameState.npcs[params.charName]?.lifeEvents || [];
    const pregnancy = lifeEvents.find((e: any) => e.type === "pregnancy");
    if (!pregnancy) {
      actor.funds -= 50;
      saveState();
      return { content: [{ type: "text", text: `${params.charName}购买并服用了紧急避孕药（扣除50元）。当前未处于受孕状态，避孕药提供了常规防御。` }], details: { success: true } };
    }

    const data = pregnancy.data as any;
    const day = currentDay();
    const daysElapsed = day - data.day_conceived;

    if (daysElapsed > 3) {
      return { content: [{ type: "text", text: `${params.charName}受孕已达 ${daysElapsed} 天，已超出紧急避孕药 72 小时（3天）的黄金窗口期，服药无效。` }], details: { success: false } };
    }

    // 99% probability of terminating pregnancy
    const success = Math.random() < 0.99;
    actor.funds -= 50;
    
    if (success) {
      removeLifeEvent(params.charName, pregnancy.id);
      saveState();
      return { content: [{ type: "text", text: `${params.charName}服用了紧急避孕药（扣除50元），药物成功见效，终止了早期受孕胚胎。` }], details: { success: true, terminated: true } };
    } else {
      saveState();
      return { content: [{ type: "text", text: `${params.charName}服用了紧急避孕药（扣除50元），但极小概率下药物避孕失败，受孕状态仍然保留。` }], details: { success: true, terminated: false } };
    }
  }
};
