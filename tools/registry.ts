import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setPi } from "./helpers.ts";
import lookupCharacterTool from "./state/lookup_character.ts";
import lookupRegionTool from "./lookup/lookup_region.ts";
import diceRollTool from "./lookup/dice_roll.ts";
import getStatusTool from "./state/get_status.ts";
import transferItemTool from "./action/transfer_item.ts";
import adjustRelationTool from "./state/adjust_relation.ts";
import grantSkillExpTool from "./state/grant_skill_exp.ts";
import initGameTool from "./state/init_game.ts";
import initProfileTool from "./state/init_profile.ts";
import setFlagsTool from "./state/set_flags.ts";
import toggleLayer1Tool from "./state/toggle_layer1.ts";
import toggleAumodeTool from "./state/toggle_aumode.ts";
// Conditional imports — files may not exist in public repo (private_extras/)
let _sexTouchTool: any = null;
let _masturbateTool: any = null;
try {
  _sexTouchTool = require("./action/sex_touch.ts").default;
  _masturbateTool = require("./action/masturbate.ts").default;
} catch { /* private_extras not present */ }
import combatActionTool from "./action/combat_action.ts";
import stealItemTool from "./action/steal_item.ts";
import equipItemTool from "./action/equip_item.ts";
import useItemTool from "./action/use_item.ts";
import moveTool from "./lookup/move.ts";
import moveToTool from "./lookup/move_to.ts";
import worldInteractTool from "./action/world_interact.ts";
import settleSceneTool from "./action/settle_scene.ts";
import recordTurnLogTool from "./action/record_turn_log.ts";
import revealSecretTool from "./action/reveal_secret.ts";
// render_scene removed — Phase 3 auto pipeline handles rendering (PHILOSOPHY §2.1)
import spawnNpcAgentTool from "./state/spawn_npc_agent.ts";
import spawnNpcAgentsTool from "./state/spawn_npc_agents.ts";
import createRoomTool from "./action/create_room.ts";
import updateReputationTool from "./state/update_reputation.ts";
import scheduleOverrideTool from "./action/schedule_override.ts";
import createCharacterTool from "./state/create_character.ts";
import setNpcOutfitTool from "./state/set_npc_outfit.ts";
import mountVehicleTool from "./action/mount_vehicle.ts";
import dismountVehicleTool from "./action/dismount_vehicle.ts";
import boardTrainTool from "./lookup/board_train.ts";
import createLocationTool from "./lookup/create_location.ts";
import buyItemTool from "./action/buy_item.ts";
import identityCheckTool from "./action/identity_check.ts";
import sellItemTool from "./action/sell_item.ts";
import monthlyGrowthTool from "./action/monthly_growth.ts";
import workJobTool from "./action/work_job.ts";
import studyTool from "./action/study.ts";
import completeTravelTool from "./lookup/complete_travel.ts";
import travelTool from "./lookup/travel.ts";
import goToLocationTool from "./lookup/go_to_location.ts";
import spawnItemTool from "./action/spawn_item.ts";
import instantiateResidenceTool from "./action/instantiate_residence.ts";
import inflictDamageTool from "./action/inflict_damage.ts";
import lookupBodyTool from "./state/lookup_body.ts";
import lookupLoreTool from "./lookup/lookup_lore.ts";
import lookupVillainTool from "./lookup/lookup_villain.ts";
import addMemoryTagTool from "./state/add_memory_tag.ts";
import setNpcDrivesTool from "./state/set_npc_drives.ts";
import setNpcRelationTool from "./state/set_npc_relation.ts";
import tableCrudTool from "./action/table_crud.ts";
import openQuestTool from "./action/open_quest.ts";
import advanceQuestTool from "./action/advance_quest.ts";
import abandonQuestTool from "./action/abandon_quest.ts";
import partyManagementTool from "./state/party_management.ts";
import checkPhoneTool from "./lookup/check_phone.ts";
import sendSmsTool from "./lookup/send_sms.ts";
import browseSnsTool from "./lookup/browse_sns.ts";
import postSnsTool from "./lookup/post_sns.ts";
import makeCallTool from "./lookup/make_call.ts";
import addCalendarEventTool from "./action/add_calendar_event.ts";
import createStoryHookTool from "./action/create_story_hook.ts";
import instantiateNpcTool from "./action/instantiate_npc.ts";
import addLifeEventTool from "./action/add_life_event.ts";
import gambleBetTool from "./action/gamble_bet.ts";
import blackMarketTradeTool from "./action/black_market_trade.ts";
import managePropertyTool from "./action/manage_property.ts";
import housingStorageTool from "./action/housing_storage.ts";
import lookupWeatherTool from "./lookup/lookup_weather.ts";
import lookupFurnitureTool from "./lookup/lookup_furniture.ts";
import travelIntercityTool from "./lookup/travel_intercity.ts";
import interactFurnitureTool from "./action/interact_furniture.ts";
import restockShopTool from "./action/restock_shop.ts";
import useAbilityTool from "./action/use_ability.ts";
import debugSexHeatTool from "./action/debug_sex_heat.ts";
import spawnTempNpcTool from "./action/spawn_temp_npc.ts";
import directPartyMemberTool from "./action/direct_party_member.ts";
import switchCharacterTool from "./action/switch_character.ts";
import replayPovTool from "./action/replay_pov.ts";
import takeContraceptivePillTool from "./action/take_contraceptive_pill.ts";
import performAbortionTool from "./action/perform_abortion.ts";
import socialCheckTool from "./action/social_check.ts";
import lookupAbilityTool from "./lookup/lookup_ability.ts";
import lookupOrgTool from "./lookup/lookup_org.ts";
import startBroadcastTool from "./action/start_broadcast.ts";
import endBroadcastTool from "./action/end_broadcast.ts";
import createOrganizationTool from "./action/create_organization.ts";
import contributeToOrgTool from "./action/contribute_to_org.ts";
import joinOrgTool from "./action/join_org.ts";
import leaveOrgTool from "./action/leave_org.ts";
import promoteMemberTool from "./action/promote_member.ts";
import orgActionTool from "./action/org_action.ts";
import adjustOrgRelationTool from "./action/adjust_org_relation.ts";
import gambleCommand from "./tui/gamble.ts";
import housingCommand from "./tui/housing.ts";
import relationsCommand from "./tui/relations.ts";
import statusCommand from "./tui/status.ts";
import lookCommand from "./tui/look.ts";
import partyCommand from "./tui/party.ts";
import identityCommand from "./tui/identity.ts";
import goCommand from "./tui/go.ts";
import goskipCommand from "./tui/goskip.ts";
import saveCommand from "./tui/save.ts";
import loadCommand from "./tui/load.ts";
import savesCommand from "./tui/saves.ts";
import newCommand from "./tui/new.ts";
import redoCommand from "./tui/redo.ts";
import sleepCommand from "./tui/sleep.ts";
import layer1Command from "./tui/layer1.ts";
import sexCommand from "./tui/sex.ts";
import roomCommand from "./tui/room.ts";
import trainCommand from "./tui/train.ts";
import bagCommand from "./tui/bag.ts";
import questCommand from "./tui/quest.ts";
import presetCommand from "./tui/preset.ts";
import calendarCommand from "./tui/calendar.ts";
import weatherCommand from "./tui/weather.ts";
import alertsCommand from "./tui/alerts.ts";
import memoryCommand from "./tui/memory.ts";
import growthCommand from "./tui/growth.ts";
import combatCommand from "./tui/combat.ts";
import shopCommand from "./tui/shop.ts";
import scheduleCommand from "./tui/schedule.ts";
import rerollCommand from "./tui/reroll.ts";
import worldCommand from "./tui/world.ts";
import achievementsCommand from "./tui/achievements.ts";
import choiceCommand from "./tui/choice.ts";

function withToolTracking(tool: any) {
  const origExec = tool.execute;
  return {
    ...tool,
    async execute(id: string, params: any, signal: any, onUpdate: any, ctx: any) {
      // lazy-import to avoid circular deps at module load time
      const { pushToolCall, saveState, gameState } = await import("../engine/state.ts");
      // 只拦截修改状态的动作工具，不拦只读查询和死锁救急工具
      const BYPASS_LOCK = new Set([
        "init_game", "settle_scene", "get_status", "complete_travel",
        "lookup_character", "lookup_region", "lookup_lore", "lookup_weather",
        "lookup_furniture", "lookup_ability", "lookup_org",
        "dice_roll", "self_check", "check_phone", "browse_sns",
      ]);
      if (gameState?._toolsLocked === true && !BYPASS_LOCK.has(tool.name)) {
        console.warn(`[tool:${tool.name}] blocked: tools are locked during rendering phase`);
        return { content: [{ type: "text", text: `[引擎已拦截] 渲染/降级阶段禁止调用工具。` }], details: {} };
      }
      pushToolCall(tool.name);
      try {
        const result = await origExec(id, params, signal, onUpdate, ctx);
        // 自动落盘：工具成功执行后确保状态持久化
        try { saveState(); } catch (_) {}
        return result;
      } catch (e: any) {
        const loc = e.stack?.split("\n")?.[1]?.trim() || "";
        console.error(`[tool:${tool.name}] execute failed:`, e.message || e, loc);
        return { content: [{ type: "text", text: `❌ ${tool.name} 执行失败: ${e.message || String(e)}${loc ? " (" + loc + ")" : ""}` }], details: {} };
      }
    },
  };
}

export function registerAll(pi: ExtensionAPI) {
  setPi(pi);
  // Register Flags
  pi.registerFlag("render-model", {
    description: "渲染场景所用的模型，如 'deepseek/deepseek-v4-pro' 或 'anthropic/claude-3-5-sonnet'",
    type: "string",
  });

  // Lookup tools: NOT tracked (pure queries that don't modify state)
  // post_sns/send_sms/make_call moved here — withToolTracking wrapper
  // creates module instance mismatch that breaks gameState reads
  const lookupTools = [
    lookupRegionTool, diceRollTool, createLocationTool, lookupLoreTool,
    lookupVillainTool, checkPhoneTool, browseSnsTool, lookupWeatherTool, lookupFurnitureTool,
    lookupAbilityTool, postSnsTool, sendSmsTool, makeCallTool, lookupOrgTool,
  ];
  for (const t of lookupTools) if (t) pi.registerTool(t);

  // Action + State tools: track for turn log (modify game state)
  const trackedTools = [
    lookupCharacterTool, getStatusTool, transferItemTool, adjustRelationTool,
    grantSkillExpTool, initGameTool, initProfileTool, setFlagsTool, toggleLayer1Tool,
    toggleAumodeTool, _sexTouchTool, _masturbateTool, combatActionTool, stealItemTool,
    equipItemTool, useItemTool, worldInteractTool, settleSceneTool, recordTurnLogTool,
    revealSecretTool, spawnNpcAgentTool, spawnNpcAgentsTool,
    createRoomTool, updateReputationTool, scheduleOverrideTool, createCharacterTool,
    setNpcOutfitTool, mountVehicleTool, dismountVehicleTool, buyItemTool,
    identityCheckTool, sellItemTool, monthlyGrowthTool, workJobTool, studyTool, spawnItemTool,
    instantiateResidenceTool,
    inflictDamageTool, lookupBodyTool, addMemoryTagTool, setNpcDrivesTool,
    setNpcRelationTool, tableCrudTool, openQuestTool, advanceQuestTool,
    abandonQuestTool, partyManagementTool, addCalendarEventTool, createStoryHookTool, instantiateNpcTool,
    spawnTempNpcTool, directPartyMemberTool, switchCharacterTool, replayPovTool, addLifeEventTool, gambleBetTool, blackMarketTradeTool,
    managePropertyTool, housingStorageTool, interactFurnitureTool, restockShopTool,
    useAbilityTool, takeContraceptivePillTool, performAbortionTool, socialCheckTool,
    travelTool, // P2: 统一旅行（合并 go_to_location + travel_intercity + complete_travel）
    startBroadcastTool, endBroadcastTool, createOrganizationTool, contributeToOrgTool,
    joinOrgTool, leaveOrgTool, promoteMemberTool, orgActionTool, adjustOrgRelationTool,
    // 8 lookup tools that mutate game state (moved from lookupTools — fix Layer 2 audit blindness)
    moveTool, moveToTool, boardTrainTool, completeTravelTool, goToLocationTool,
    sendSmsTool, postSnsTool, makeCallTool, travelIntercityTool,
  ];
  for (const t of trackedTools) if (t) pi.registerTool(withToolTracking(t));

  // Register Commands
  pi.registerCommand("gamble", gambleCommand);
  pi.registerCommand("housing", housingCommand);
  pi.registerCommand("relations", relationsCommand);
  pi.registerCommand("status", statusCommand);
  pi.registerCommand("look", lookCommand);
  pi.registerCommand("party", partyCommand);
  pi.registerCommand("identity", identityCommand);
  pi.registerCommand("go", goCommand);
  pi.registerCommand("goskip", goskipCommand);
  pi.registerCommand("save", saveCommand);
  pi.registerCommand("load", loadCommand);
  pi.registerCommand("saves", savesCommand);
  pi.registerCommand("new", newCommand);
  pi.registerCommand("redo", redoCommand);
  pi.registerCommand("sleep", sleepCommand);
  pi.registerCommand("layer1", layer1Command);
  pi.registerCommand("sex", sexCommand);
  pi.registerCommand("room", roomCommand);
  pi.registerCommand("train", trainCommand);
  pi.registerCommand("bag", bagCommand);
  pi.registerCommand("quest", questCommand);
  pi.registerCommand("preset", presetCommand);
  pi.registerCommand("calendar", calendarCommand);
  pi.registerCommand("weather", weatherCommand);
  pi.registerCommand("alerts", alertsCommand);
  pi.registerCommand("memory", memoryCommand);
  pi.registerCommand("growth", growthCommand);
  pi.registerCommand("combat", combatCommand);
  pi.registerCommand("shop", shopCommand);
  pi.registerCommand("schedule", scheduleCommand);
  pi.registerCommand("reroll", rerollCommand);
  pi.registerCommand("world", worldCommand);
  pi.registerCommand("achievements", achievementsCommand);
  pi.registerCommand("ach", achievementsCommand);
  pi.registerCommand("choice", choiceCommand);
}
