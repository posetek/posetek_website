import { describe, expect, it, vi } from "vitest";
vi.mock("../../../lib/firebase", () => ({ db: {} }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: vi.fn() }));
import { activationParams, activePlansMatch, PERSONALIZED_ENGINE, personalizedParams, plannerLink, prescriptionSignature, previewEnabled, recentEvidence,
  createPlannerAccessGuard, isPlannerAuthorizationError, normalizeAssessment, plannerPlayerDetailsLink,
  methodologyPriorities, blockTrainingRationale, METHODOLOGY_VERSION, PLANNER_GOALS } from "./personalizedLogic";
import { DEFAULT_INTAKE } from "./planJobs";
describe("personalized preview contract", () => {
  it("uses only recent dated evidence; stale best results cannot dominate", () => {
    const now = Date.now();
    const reps = [
      { _statsDrill: "shooting", velocity: 45, createdAtMillis: now - 181 * 86400000 },
      { _statsDrill: "shooting", velocity: 25, createdAtMillis: now - 1000 },
      { _statsDrill: "shooting", velocity: 50 },
      { _statsDrill: "shooting", velocity: 50, createdAtMillis: now + 86400000 },
    ];
    expect(recentEvidence(reps, now).excluded).toBe(3);
    const params = personalizedParams(reps, { position: "CB" }, 16, DEFAULT_INTAKE);
    expect(params.engineVersion).toBe(PERSONALIZED_ENGINE);
    expect(params.statsProfile.drills[0].metrics[0].bestCanonical).toBe(25);
    expect(params.evidenceWindow).toBeDefined();
    expect(personalizedParams([], {}, null, DEFAULT_INTAKE).evidenceWindow).toBeUndefined();
  });
  it("keeps selection in both directions without an action", () => {
    for (const preview of [true, false]) {
      const url = new URL(plannerLink(preview, "org one", ["player-a", "player-b"], "team one"), "https://test.invalid");
      expect(url.searchParams.get("orgId")).toBe("org one");
      expect(url.searchParams.get("players")).toBe("player-a,player-b");
      expect(url.searchParams.get("teamId")).toBe("team one");
      expect(url.searchParams.has("activate")).toBe(false);
    }
  });
  it("fails closed for absent or malformed preview configuration", () => {
    expect(previewEnabled(null)).toBe(false);
    const config = { globalEnabled: true, programV3Enabled: true, personalizedPlannerEnabled: true,
      capabilities: { generate_personalized_plan: { enabled: true, dailyLimitPerUser: 3 } } };
    expect(previewEnabled(config)).toBe(true);
    expect(previewEnabled({ ...config, personalizedPlannerEnabled: false })).toBe(false);
    expect(previewEnabled({ ...config, globalEnabled: false })).toBe(false);
  });
  it("binds activation to a reviewed ready draft and expected active revision", () => {
    expect(() => activationParams({ status: "activated" })).toThrow();
    const expectedActivePlans = [{ planId: "active", planRevision: 7 }];
    expect(activationParams({ status: "ready", draftId: "draft", comparisonToken: "token", expectedActivePlans }))
      .toEqual({ engineVersion: PERSONALIZED_ENGINE, draftId: "draft", comparisonToken: "token", expectedActivePlans });
  });
  it("enables explicit unlimited personalized usage without a numeric quota", () => {
    const config = { globalEnabled: true, programV3Enabled: true, personalizedPlannerEnabled: true,
      capabilities: { generate_personalized_plan: { enabled: true, dailyLimitPolicy: "unlimited" } } };
    expect(previewEnabled(config)).toBe(true);
    expect(previewEnabled({ ...config, capabilities: { generate_personalized_plan: { enabled: true, dailyLimitPolicy: "unknown", dailyLimitPerUser: 3 } } })).toBe(false);
    expect(previewEnabled({ ...config, capabilities: { generate_training_plan: { enabled: true, dailyLimitPolicy: "unlimited" } } }, "generate_training_plan")).toBe(false);
  });
  it("keeps athlete goals and free text in personalized intake", () => {
    const params = personalizedParams([], {}, 16, DEFAULT_INTAKE, ["dribbling"], "  Improve my first touch  ");
    expect(params.intake.goals).toEqual(["dribbling"]);
    expect(params.intake.freeTextGoals).toBe("Improve my first touch");
    expect(params.planVersion).toBe(3);
    expect(plannerLink(true, "club", ["player"])).toBe("/admin/programs?orgId=club&players=player");
  });
  it("compares executable prescriptions rather than generated wording", () => {
    const plan = { weeks: [{ workouts: [{ title: "Old title", blocks: [{ drillId: "sprint", sets: 3, reps: 10, restSeconds: 30 }] }] }] };
    const other = structuredClone(plan); other.weeks[0].workouts[0].title = "New title";
    expect(prescriptionSignature(plan)).toBe(prescriptionSignature(other));
    other.weeks[0].workouts[0].blocks[0].reps = 11;
    expect(prescriptionSignature(plan)).not.toBe(prescriptionSignature(other));
  });
  it.each([
    ["repUnit", "seconds"], ["perSide", true], ["familiarizationReps", 2],
    ["restScope", "sets"], ["restBetweenSetsSeconds", 40], ["order", 2],
  ])("detects a changed executable %s even when numeric sets and reps match", (field, value) => {
    const block = { drillId: "drill", sets: 3, reps: 10, repUnit: "reps", perSide: false, familiarizationReps: 0, restScope: "reps", restBetweenSetsSeconds: 30, order: 1 };
    const plan = { weeks: [{ weekNumber: 1, workouts: [{ order: 1, blocks: [block] }] }] };
    const other = { weeks: [{ weekNumber: 1, workouts: [{ order: 1, blocks: [{ ...block, [field]: value }] }] }] };
    expect(prescriptionSignature(plan)).not.toBe(prescriptionSignature(other));
  });
});

describe("planner authorization lifecycle", () => {
  it("blocks cached callbacks and queued work immediately after revocation", () => {
    const guard = createPlannerAccessGuard(), first = guard.begin();
    expect(guard.permits(first)).toBe(false);
    guard.authorize(first);
    expect(guard.permits(first)).toBe(true);
    guard.block();
    guard.authorize(first); // A slow scope response from before revocation cannot restore access.
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.permits()).toBe(false);
    const refreshed = guard.begin();
    expect(guard.permits(refreshed)).toBe(false);
    guard.authorize(refreshed);
    expect(guard.permits(refreshed)).toBe(true);
    expect(guard.permits(first)).toBe(false);
  });
  it("does not let an older organization refresh authorize a newer selection", () => {
    const guard = createPlannerAccessGuard(), old = guard.begin(), current = guard.begin();
    guard.authorize(old);
    expect(guard.permits(current)).toBe(false);
    guard.authorize(current);
    expect(guard.permits(current)).toBe(true);
  });
  it.each(["permission-denied", "firestore/permission-denied", "functions/unauthenticated", "auth/user-token-expired"])("recognizes %s as an access failure", code => {
    expect(isPlannerAuthorizationError({ code })).toBe(true);
    expect(isPlannerAuthorizationError({ code: "unavailable" })).toBe(false);
  });
});

describe("restored planner context", () => {
  it("keeps a historical assessment readable without inventing a missing schedule", () => {
    const assessment = normalizeAssessment({ assessedAt: "2026-09-16T12:00:00Z", findings: [null, { domain: "shooting", statement: "Historical finding" }], focusSplit: { final: { shooting: 30, passing: 20 } } });
    expect(assessment?.schedule).toBeNull();
    expect(assessment?.findings).toHaveLength(1);
    expect(assessment?.findings[0].confidence).toBe("unavailable");
    expect(assessment?.focusSplit).toEqual({ shooting: 30, passing: 20 });
    expect(normalizeAssessment({ findings: {}, evidencePolicy: null })?.findings).toEqual([]);
    expect(normalizeAssessment(null)).toBeNull();
  });
  it("retains a complete assessed schedule and rejects a partial one", () => {
    const intake = { sessionsPerWeek: 2, minutesPerSession: 30, setting: "solo" };
    expect(normalizeAssessment({ intake })?.schedule).toEqual(intake);
    expect(normalizeAssessment({ intake: { ...intake, setting: null } })?.schedule).toBeNull();
  });
  it("preserves organization, team and coach context in details navigation", () => {
    const player = { id: "player", organizationId: "current-club", teamId: "current-team", coachId: "coach" };
    const url = new URL(plannerPlayerDetailsLink("admin", player, "orgId=current-club&teamId=old-team&coachId=context-coach&activate=true"), "https://test.invalid");
    expect(url.pathname).toBe("/admin/accounts/player/player");
    expect(Object.fromEntries(url.searchParams)).toEqual({ orgId: "current-club", teamId: "current-team", coachId: "context-coach" });
    const staff = new URL(plannerPlayerDetailsLink("staff", player, ""), "https://test.invalid");
    expect(staff.pathname).toBe("/athlete");
    expect(staff.searchParams.get("player")).toBe("player");
    expect(staff.searchParams.get("orgId")).toBe("current-club");
    expect(staff.searchParams.has("coachId")).toBe(false);
  });
  it("returns coach details to the selected workspace window without carrying generation actions", () => {
    const returnTo = "/insights?view=player&playerId=old&start=2026-09-01&end=2026-09-29&rosterSearch=Taylor";
    const url = new URL(plannerPlayerDetailsLink("staff", { id: "player", organizationId: "club", teamId: "team" }, new URLSearchParams({ returnTo, activate: "true" }).toString()), "https://test.invalid");
    expect(url.searchParams.get("start")).toBe("2026-09-01");
    expect(url.searchParams.get("rosterSearch")).toBe("Taylor");
    expect(url.searchParams.get("playerId")).toBe("player");
    expect(url.searchParams.has("activate")).toBe(false);
  });
  it("never converts a canonical player's legacy coach pointer into return navigation", () => {
    const player = { id: "player", organizationId: "club", teamId: "team", coachId: "legacy-manager" };
    for (const search of ["orgId=club&teamId=team", "orgId=other-club&coachId=other-coach"]) {
      const url = new URL(plannerPlayerDetailsLink("admin", player, search), "https://test.invalid");
      expect(url.searchParams.has("coachId")).toBe(false);
      expect(url.searchParams.get("orgId")).toBe("club");
      expect(url.searchParams.get("teamId")).toBe("team");
    }
    expect(plannerPlayerDetailsLink("admin", { id: "legacy", coachId: "legacy-coach" }, "")).toContain("coachId=legacy-coach");
  });
});

describe("draft review active-plan comparison", () => {
  const current = [{ id: "active", status: "active", planRevision: 7 }];

  it("accepts Firestore maps whose revision field precedes the plan ID", () => {
    expect(activePlansMatch([{ planRevision: 7, planId: "active" }], current)).toBe(true);
  });

  it("matches multiple active plans without depending on array order or locale sorting", () => {
    const expected = [{ planId: "Z-plan", planRevision: 2 }, { planId: "a-plan", planRevision: 3 }];
    const plans = [{ id: "a-plan", status: "active", planRevision: 3 }, { id: "Z-plan", status: "active", planRevision: 2 }];
    expect(activePlansMatch(expected, plans)).toBe(true);
  });

  it("still rejects changed revisions, replacement plans, and added or removed active plans", () => {
    for (const expected of [[], [{ planId: "active", planRevision: 6 }], [{ planId: "replaced", planRevision: 7 }],
      [{ planId: "active", planRevision: 7 }, { planId: "other", planRevision: 1 }]]) {
      expect(activePlansMatch(expected, current)).toBe(false);
    }
  });

  it("ignores superseded plans and defaults absent legacy revisions to one", () => {
    expect(activePlansMatch([{ planId: "legacy", planRevision: 1 }], [
      { id: "legacy", status: "active" }, { id: "old", status: "superseded", planRevision: 5 },
    ])).toBe(true);
    expect(activePlansMatch([], [{ id: "old", status: "superseded" }])).toBe(true);
  });

  it("rejects malformed or duplicate baseline entries", () => {
    for (const expected of [undefined, null, {}, [null], [{ planRevision: 7 }], [{ planId: "active" }],
      [{ planId: "active", planRevision: "7" }], [{ planId: "active", planRevision: 7 }, { planId: "active", planRevision: 7 }]]) {
      expect(activePlansMatch(expected, current)).toBe(false);
    }
  });
});

describe("versioned training methodology", () => {
  const priority = { id: "agility-turn", rank: 1, domain: "agility", objectiveId: "controlled-turn", label: "Control the turn",
    role: "primary", evidenceBasis: "conditionalEstimate", confidence: "low", reason: "A reviewed estimate supports investigating the return phase.",
    limitation: "The finish is missing.", metricIds: ["totalTime"], targetPct: 25, weeklyTargetMinutes: 30,
    progressCheck: "Record a complete shuttle under the same setup.", eligibleDrillCount: 2 };
  it("retains explicit estimate status and links time and progress without interpreting estimates as measurements", () => {
    const result = methodologyPriorities({ methodologyVersion: METHODOLOGY_VERSION, priorities: [priority] });
    expect(result).toEqual([priority]);
    expect(normalizeAssessment({ methodologyVersion: METHODOLOGY_VERSION, priorities: [priority] })?.priorities).toEqual(result);
  });
  it("keeps historical plans and unknown methodology versions readable without invented priorities", () => {
    expect(methodologyPriorities({ findings: [{ domain: "speed" }], priorities: [priority] })).toEqual([]);
    expect(methodologyPriorities({ methodologyVersion: "future-v2", priorities: [priority] })).toEqual([]);
    expect(blockTrainingRationale({ whyIncluded: "Historical reason" })).toBeNull();
  });
  it("rejects malformed or ambiguous priority rows and never turns missing timing into zero", () => {
    const result = methodologyPriorities({ methodologyVersion: METHODOLOGY_VERSION, priorities: [
      null, { ...priority, id: "unsupported", evidenceBasis: "probablyMeasured" }, priority, priority,
      { ...priority, id: "later", rank: 2, weeklyTargetMinutes: undefined, targetPct: NaN, eligibleDrillCount: -1 },
    ] });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ weeklyTargetMinutes: null, targetPct: null, eligibleDrillCount: null });
    expect(methodologyPriorities({ methodologyVersion: METHODOLOGY_VERSION, priorities: {} })).toEqual([]);
  });
  it("reads only versioned exercise explanations and retains their source priority", () => {
    const trainingRationale = { methodologyVersion: METHODOLOGY_VERSION, objectiveId: "controlled-turn", priorityId: "agility-turn",
      evidenceBasis: "conditionalEstimate", confidence: "low", reason: "Practice a controlled turn.", progressCheck: "Review controlled repetitions." };
    expect(blockTrainingRationale({ trainingRationale })).toMatchObject({ priorityId: "agility-turn", evidenceBasis: "conditionalEstimate", progressCheck: "Review controlled repetitions." });
    expect(blockTrainingRationale({ trainingRationale: { ...trainingRationale, methodologyVersion: undefined } })).toBeNull();
  });
  it("keeps speed and agility distinct while supporting historical combined goals", () => {
    expect(PLANNER_GOALS.map(goal => goal.id)).toContain("speed");
    expect(PLANNER_GOALS.map(goal => goal.id)).toContain("agility");
    expect(personalizedParams([], {}, 16, DEFAULT_INTAKE, ["speed", "agility"], "Coach input", [], [], true)).toMatchObject({
      useProvisionalEstimates: true, intake: { goals: ["speed", "agility"], freeTextGoals: "Coach input" },
    });
    expect(personalizedParams([], {}, 16, DEFAULT_INTAKE, ["speedAgility"]).intake.goals).toEqual(["speedAgility"]);
  });
});
