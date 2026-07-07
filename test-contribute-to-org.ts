// Test: contribute_to_org tool
// Run: npx tsx test-contribute-to-org.ts

import { gameState, loadActiveWorld, resetState } from "./engine/state.ts";

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

test("contribute_to_org - donate", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.reputation["test_club"] = 0;
  gameState.player.funds = 10000;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "donate", amount: 1000, details: "测试"
  }, null, null, null);

  if (!result.details.success) throw new Error("Donate failed");
  if (gameState.organizations["test_club"].wealth <= 50) throw new Error("Wealth should increase, got " + gameState.organizations["test_club"].wealth);
  if (gameState.player.reputation["test_club"] <= 0) throw new Error("Rep should increase, got " + gameState.player.reputation["test_club"]);
  if (gameState.player.funds >= 10000) throw new Error("Funds should decrease");
});

test("contribute_to_org - complete_quest", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.reputation["test_club"] = 0;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "complete_quest", details: "筹备文化祭"
  }, null, null, null);

  if (!result.details.success) throw new Error("Quest failed");
  const org = gameState.organizations["test_club"];
  if (org.cohesion <= 50) throw new Error("Cohesion should increase, got " + org.cohesion);
  if (org.influence <= 50) throw new Error("Influence should increase, got " + org.influence);
  if (gameState.player.reputation["test_club"] !== 3) throw new Error("Rep should be 3, got " + gameState.player.reputation["test_club"]);
});

test("contribute_to_org - betray", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  const mkOrg = (id: string, name: string) => ({
    id, name, type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any);
  gameState.organizations["test_club"] = mkOrg("test_club", "测试社团");
  gameState.organizations["test_club"].relations = { "rival_club": -3 };
  gameState.organizations["rival_club"] = mkOrg("rival_club", "敌对社团");
  gameState.player.reputation["test_club"] = 0;
  gameState.player.reputation["rival_club"] = 0;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "betray", details: "泄露情报"
  }, null, null, null);

  if (!result.details.success) throw new Error("Betray failed");
  const org = gameState.organizations["test_club"];
  if (org.cohesion >= 50) throw new Error("Cohesion should decrease, got " + org.cohesion);
  if (org.public_legitimacy >= 50) throw new Error("Legitimacy should decrease, got " + org.public_legitimacy);
  if (gameState.player.reputation["test_club"] >= 0) throw new Error("Rep should go negative, got " + gameState.player.reputation["test_club"]);
  if (gameState.player.reputation["rival_club"] <= 0) throw new Error("Rival should gain rep, got " + gameState.player.reputation["rival_club"]);
});

test("contribute_to_org - recruit_member", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.reputation["test_club"] = 0;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "recruit_member",
    targetNpc: "材木座義輝", details: "宣传干事"
  }, null, null, null);

  if (!result.details.success) throw new Error("Recruit failed");
  const org = gameState.organizations["test_club"];
  if (org.cohesion <= 50) throw new Error("Cohesion should increase, got " + org.cohesion);
  if (!org.members.some((m: any) => m.npcName === "材木座義輝")) throw new Error("Member should be added");
  if (gameState.player.reputation["test_club"] !== 2) throw new Error("Rep should be 2, got " + gameState.player.reputation["test_club"]);
});

test("contribute_to_org - insufficient funds", async () => {
  resetState();
  loadActiveWorld("oregairu");

  gameState.organizations = gameState.organizations || {};
  gameState.organizations["test_club"] = {
    id: "test_club", name: "测试社团", type: "社团", scale: "club",
    wealth: 50, influence: 50, cohesion: 50, public_legitimacy: 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: []
  } as any;
  gameState.player.funds = 10;

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "test_club", action: "donate", amount: 1000
  }, null, null, null);

  if (result.details.success) throw new Error("Should fail when funds insufficient");
});

test("contribute_to_org - org not found", async () => {
  resetState();
  loadActiveWorld("oregairu");

  const tool = await import("./tools/action/contribute_to_org.ts");
  const result = await tool.default.execute(null, {
    orgId: "nonexistent_org", action: "donate", amount: 100
  }, null, null, null);

  if (result.details.success) throw new Error("Should fail for nonexistent org");
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
