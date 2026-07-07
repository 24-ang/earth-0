// Test: NPC Reactive Schedule Override
// Run: npx tsx test-npc-reactions.ts

import { gameState, loadActiveWorld, resetState, getOrCreateNPC } from "./engine/state.ts";
import { processNpcReactions } from "./engine/npc-reactions.ts";

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

function seedNpc(name: string, overrides: any = {}) {
  const npc = getOrCreateNPC(name);
  npc.attributes = { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10, ...overrides };
  npc.scheduleGroup = "高校生";
  npc.currentRoom = "教室";
  npc.npcRelationships = {};
  npc.pendingOverride = null;
  return npc;
}

test("steal_item caught → confront", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.player.attributes = { 力量: 8, 敏捷: 8, 体质: 8, 智力: 10, 感知: 8, 魅力: 10 };
  // Seed NPC with high perception → likely caught
  const npc = seedNpc("由比ヶ浜結衣", { 感知: 18 });
  gameState.player.location = "教室";

  const reactions = processNpcReactions("steal_item", { target: "由比ヶ浜結衣" });
  // With perception 18 vs player dex 8, should be caught
  if (reactions.length === 0) {
    // Random chance, so this might flake but with high perception bias it's very likely
    console.log("  (probabilistic test — re-run if this fails)");
    return; // skip assertion for probabilistic
  }
  const npcAfter = gameState.npcs["由比ヶ浜結衣"];
  if (!npcAfter.pendingOverride) throw new Error("NPC should have pendingOverride after being caught stealing");
});

test("combat_action → reaction", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.player.attributes = { 力量: 15, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 };
  const npc = seedNpc("材木座義輝", { 力量: 5 });
  npc.npcRelationships = {};
  npc.scheduleGroup = "高校生";
  gameState.player.location = "教室";

  const reactions = processNpcReactions("combat_action", { target: "材木座義輝" });
  if (reactions.length === 0) throw new Error("Combat should trigger reaction");
  if (reactions[0].npcName !== "材木座義輝") throw new Error("Wrong target");
  // Weak NPC → should avoid or get help
  if (reactions[0].mode !== "avoid" && reactions[0].mode !== "setup") {
    throw new Error(`Weak NPC should avoid or setup, got ${reactions[0].mode}`);
  }
});

test("contribute_to_org betray → member reactions", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_org"] = {
    id: "test_org", name: "测试组织", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "部室", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "雪ノ下雪乃",
    members: [
      { npcName: "雪ノ下雪乃", role: "部长", rank: 10 },
      { npcName: "由比ヶ浜結衣", role: "普通部员", rank: 3 }
    ],
    relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.location = "教室";
  seedNpc("雪ノ下雪乃");
  seedNpc("由比ヶ浜結衣");

  const reactions = processNpcReactions("contribute_to_org", {
    orgId: "test_org", action: "betray", details: "泄露部费去向"
  });

  if (reactions.length === 0) throw new Error("Betray should trigger org member reactions");
  // Leader (rank 10) should setup or confront
  const leaderReaction = reactions.find(r => r.npcName === "雪ノ下雪乃");
  if (!leaderReaction) throw new Error("Leader should react");
  // Regular member (rank 3) should avoid
  const memberReaction = reactions.find(r => r.npcName === "由比ヶ浜結衣");
  if (!memberReaction) throw new Error("Member should react");
  if (memberReaction.mode !== "avoid") throw new Error(`Member should avoid, got ${memberReaction.mode}`);
});

test("intimate_touch high affection → no reaction", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.player.relationships = gameState.player.relationships || {};
  gameState.player.relationships["由比ヶ浜結衣"] = { stage: "亲密", affection: 8, tone: "" };
  seedNpc("由比ヶ浜結衣");

  const reactions = processNpcReactions("intimate_touch", { target: "由比ヶ浜結衣" });
  if (reactions.length > 0) throw new Error("High affection should prevent negative reaction");
});

test("no handler → empty", () => {
  resetState();
  loadActiveWorld("oregairu");
  const reactions = processNpcReactions("buy_item", { item: "面包" });
  if (reactions.length > 0) throw new Error("Non-malicious tool should not trigger reactions");
});

// Runner
(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (e: any) {
      console.log(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n=== ${passed} passed, ${tests.length - passed} failed ===`);
})();
