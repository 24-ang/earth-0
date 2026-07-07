// Test: Org Scale Evolution + Lifecycle System
// Run: npx tsx test-org-lifecycle.ts

import { gameState, loadActiveWorld, resetState, saveState } from "./engine/state.ts";
import { evaluateOrgGoals } from "./engine/timeline.ts";

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

function mkOrg(id: string, overrides: Partial<any> = {}) {
  return {
    id, name: id, type: "社团", scale: overrides.scale ?? "club",
    wealth: overrides.wealth ?? 50, influence: overrides.influence ?? 50,
    cohesion: overrides.cohesion ?? 50, public_legitimacy: overrides.public_legitimacy ?? 50,
    coreLocation: "", territoryRoomKeys: [], class_base: {},
    organizationalAxes: { "经济立场": 0, "政治立场": 0 },
    goals: { macroGoal: "", currentPhaseGoal: "" },
    leader: "", members: [], relations: {}, match_rules: {}, entries: [],
    lifecycle_stage: undefined as any, ticks_at_stage: undefined as any, ticks_at_scale: undefined as any,
    ...overrides
  } as any;
}

test("lifecycle - seed auto-detected for new org", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["new_club"] = mkOrg("new_club", { wealth: 10, influence: 5, cohesion: 80 });

  const alerts = evaluateOrgGoals();

  // First call: initializes lifecycle
  if (gameState.organizations["new_club"].lifecycle_stage !== "萌芽") {
    throw new Error(`New low-resource org should be 萌芽, got ${gameState.organizations["new_club"].lifecycle_stage}`);
  }
  // Should produce alert about lifecycle init
  if (alerts.length === 0) throw new Error("Should produce lifecycle alert");
});

test("lifecycle - seed → startup progression", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["growing"] = mkOrg("growing", { wealth: 25, influence: 30, cohesion: 70 });

  // First call: detects as 初创
  evaluateOrgGoals();
  if (gameState.organizations["growing"].lifecycle_stage !== "初创") {
    throw new Error(`Should be 初创, got ${gameState.organizations["growing"].lifecycle_stage}`);
  }

  // Advance to 成长 territory
  gameState.organizations["growing"].wealth = 50;
  gameState.organizations["growing"].influence = 55;

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["growing"].lifecycle_stage !== "成长") {
    throw new Error(`Should progress to 成长, got ${gameState.organizations["growing"].lifecycle_stage}`);
  }
  // Should have transition alert
  const transitionAlert = alerts.find(a => a.alert.includes("初创") || a.alert.includes("成长"));
  if (!transitionAlert) throw new Error("Should have transition alert");
});

test("lifecycle - growth → mature", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["powerhouse"] = mkOrg("powerhouse", {
    wealth: 80, influence: 85, cohesion: 75
  });

  evaluateOrgGoals();
  if (gameState.organizations["powerhouse"].lifecycle_stage !== "成熟") {
    throw new Error(`Should be 成熟, got ${gameState.organizations["powerhouse"].lifecycle_stage}`);
  }
});

test("lifecycle - mature → decline", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["fading"] = mkOrg("fading", {
    wealth: 80, influence: 80, cohesion: 80, lifecycle_stage: "成熟" as any
  });

  // First tick: still mature
  evaluateOrgGoals();
  if (gameState.organizations["fading"].lifecycle_stage !== "成熟") {
    throw new Error("Should still be 成熟");
  }

  // Then collapse cohesion:
  gameState.organizations["fading"].cohesion = 30;

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["fading"].lifecycle_stage !== "衰退") {
    throw new Error(`Should decline, got ${gameState.organizations["fading"].lifecycle_stage}`);
  }
  // Should have decline alert
  const declineAlert = alerts.find(a => a.alert.includes("衰退"));
  if (!declineAlert) throw new Error("Should have decline transition alert");
});

test("lifecycle - decline → recovery (growth)", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["recovering"] = mkOrg("recovering", {
    wealth: 60, influence: 55, cohesion: 80, lifecycle_stage: "衰退" as any
  });

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["recovering"].lifecycle_stage !== "成长") {
    throw new Error(`Should recover to 成长, got ${gameState.organizations["recovering"].lifecycle_stage}`);
  }
});

test("lifecycle - collapse (archived)", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["doomed"] = mkOrg("doomed", {
    wealth: 5, cohesion: 5, public_legitimacy: 5
  });

  const alerts = evaluateOrgGoals();
  if (!gameState.organizations["doomed"].archived) throw new Error("Should be archived");
  if (gameState.organizations["doomed"].lifecycle_stage !== "消亡") throw new Error("Should be 消亡");
});

test("scale - upgrade club → local", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["rising"] = mkOrg("rising", {
    scale: "club", influence: 75, cohesion: 80, ticks_at_scale: 5
  });

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["rising"].scale !== "local") {
    throw new Error(`Should upgrade to local, got ${gameState.organizations["rising"].scale}`);
  }
  // ticks should reset
  if (gameState.organizations["rising"].ticks_at_scale !== 0) throw new Error("ticks_at_scale should reset");
});

test("scale - no upgrade if ticks insufficient", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["impatient"] = mkOrg("impatient", {
    scale: "club", influence: 80, cohesion: 80, ticks_at_scale: 3
  });

  evaluateOrgGoals();
  // ticks_at_scale was 3, not enough for upgrade (need 5)
  if (gameState.organizations["impatient"].scale !== "club") {
    throw new Error("Should not upgrade with only 3 ticks");
  }
  // ticks should increment
  if (gameState.organizations["impatient"].ticks_at_scale !== 4) {
    throw new Error("ticks_at_scale should be 4 (was 3 + 1)");
  }
});

test("scale - downgrade on low cohesion", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["crumbling"] = mkOrg("crumbling", {
    scale: "regional", cohesion: 15, ticks_at_scale: 3
  });

  const alerts = evaluateOrgGoals();
  if (gameState.organizations["crumbling"].scale !== "local") {
    throw new Error(`Should downgrade to local, got ${gameState.organizations["crumbling"].scale}`);
  }
});

test("scale - no downgrade below club", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["minimum"] = mkOrg("minimum", {
    scale: "club", cohesion: 5, ticks_at_scale: 5
  });

  evaluateOrgGoals();
  if (gameState.organizations["minimum"].scale !== "club") {
    throw new Error("Club should be floor, cannot go below");
  }
});

test("scale - no upgrade beyond national", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["superpower"] = mkOrg("superpower", {
    scale: "national", influence: 100, cohesion: 100, ticks_at_scale: 10
  });

  evaluateOrgGoals();
  if (gameState.organizations["superpower"].scale !== "national") {
    throw new Error("National should be ceiling, cannot go above");
  }
});

test("archived orgs are skipped in evaluation", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["gone"] = mkOrg("gone", {
    wealth: 0, cohesion: 0, public_legitimacy: 0, archived: true, lifecycle_stage: "消亡" as any
  });

  const alerts = evaluateOrgGoals();
  // Should not produce any alert for archived org
  const goneAlerts = alerts.filter(a => a.orgId === "gone");
  if (goneAlerts.length > 0) throw new Error("Archived org should produce no alerts");
});

test("ticks_at_stage increments when stage unchanged", () => {
  resetState();
  loadActiveWorld("oregairu");
  gameState.organizations = {};
  gameState.organizations["stable"] = mkOrg("stable", {
    wealth: 50, influence: 55, cohesion: 60
  });
  // First eval:
  evaluateOrgGoals();
  const after1 = gameState.organizations["stable"].ticks_at_stage ?? 0;
  // Second eval: should increment
  evaluateOrgGoals();
  const after2 = gameState.organizations["stable"].ticks_at_stage ?? 0;
  if (after2 !== after1 + 1) {
    throw new Error(`ticks_at_stage should increment: ${after1} → ${after2}`);
  }
});

// Runner
(async () => {
  let passed = 0;
  const failed: string[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (e: any) {
      console.log(`  ✗ ${t.name}: ${e.message}`);
      failed.push(t.name);
    }
  }
  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.join(", ")}`);
  }
  console.log(`\n=== ${passed} passed, ${tests.length - passed} failed ===`);
})();
