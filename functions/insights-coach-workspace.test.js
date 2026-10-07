"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError, FakeTimestamp } = require("./test-support/fake-firestore");
const { createInsightsV2 } = require("./insights-v2");
const { demographics, primary } = require("./insights-v2-qualification");
const { measuredAxes, measuredMetrics, comparePlayer } = require("./insights-axis-scoring");
const { effectiveRep } = require("./effective-rep");
const NOW = Date.UTC(2026, 8, 29, 16);
const coach = { uid: "independent" }, staff = { uid: "staff" };
const scope = { kind: "coachRoster" }, team = { kind: "team", organizationId: "club", teamId: "a" };
const emptyUsage = { complete: true, collected: false, webCollected: false, iosCollected: false, collectionStartedAtMillis: null,
  totalMillis: 0, webMillis: 0, iosMillis: 0, overlapMillis: 0, featureMillis: {}, activeDays: 0, returning: false, latestAtMillis: null, days: [] };
function evidence(_id, rep) { return { metadata: { resultsValid: true, processingStatus: "complete" }, context: { result: { resultsValid: true, primaryMetric: primary(rep)?.value } } }; }
const seed = {
  "organizations/club": { schemaVersion: 2, name: "Club" },
  "organizations/club/members/staff": { userUID: "staff", role: "coach", status: "active", teamIds: ["a"] },
  "teams/a": { organizationId: "club", name: "A" }, "teams/b": { organizationId: "club", name: "B" },
  "coaches/legacy": { userUID: "independent", members: ["one", "missing", "transferred"] },
  "players/one": { firstName: "Ada", lastName: "Alpha", birthDate: "2011-09-29", coachDocId: "legacy" },
  "players/two": { firstName: "Ben", coachUID: "independent", coachDocId: "legacy" },
  "players/three": { firstName: "Cam", coachId: "independent" },
  "players/unrelated": { firstName: "Private", coachUID: "other" },
  "players/transferred": { firstName: "Transferred", organizationId: "club", teamId: "b", coachUID: "independent" },
  "players/a": { firstName: "Team A", organizationId: "club", teamId: "a" },
  "players/b": { firstName: "Team B", organizationId: "club", teamId: "a" },
  "players/one/reps/r": { repType: "sprint", max_velocity: 8, createdAt: NOW - 1000 },
  "players/two/reps/r": { repType: "sprint", max_velocity: 6, createdAt: NOW - 1000 },
  "players/three/reps/r": { repType: "sprint", max_velocity: 10, createdAt: NOW - 1000 },
  "players/a/reps/r": { repType: "sprint", max_velocity: 8, createdAt: NOW - 1000 },
  "players/b/reps/r": { repType: "sprint", max_velocity: 6, createdAt: NOW - 1000 },
};
function setup(extra = {}, options = {}) {
  const db = new FakeFirestore({ ...seed, ...extra });
  return { db, ...createInsightsV2({ db, HttpsError, now: () => NOW, usageReader: async () => emptyUsage, readEvidence: evidence, ...options }) };
}
const speed = result => result.axes.find(axis => axis.key === "speed");

test("independent Insights includes complete current legacy authority but never transferred or unrelated players", async () => {
  const result = await setup().getClubInsightsV2({ scope, pageSize: 1 }, coach);
  assert.deepEqual(result.scope, { kind: "coachRoster", coachId: "legacy", label: "My roster", access: "coach", assignedTeamsOnly: false });
  assert.deepEqual(result.choices, { global: false, organizations: [], coachRoster: { coachId: "legacy", label: "My roster" } });
  assert.equal(result.pagination.total, 3); assert.equal(result.testing.qualifyingTests, 3);
  assert.equal(result.players[0].age, 15); assert.equal(result.players[0].organizationId, "");
  assert.equal(result.players[0].registered, false);
  assert.ok(!JSON.stringify(result).includes('"members"'));
});

test("independent access refuses managed, inactive, malformed and ambiguous staff identities", async () => {
  const denials = [
    { "coaches/legacy": { ...seed["coaches/legacy"], organizationId: "removed-club" } },
    { "coaches/legacy": { ...seed["coaches/legacy"], organizationRole: "coach" } },
    { "organizations/club/members/independent": { userUID: "independent", status: "inactive", role: "coach", teamIds: [] } },
    { "organizations/club/members/independent": { userUID: "wrong", status: "active", role: "coach", teamIds: ["a"] } },
    { "coaches/second": { userUID: "independent", members: ["one"] } },
  ];
  for (const extra of denials) await assert.rejects(setup(extra).getClubInsightsV2({ scope }, coach), { code: "permission-denied" });
  await assert.rejects(setup().getClubInsightsV2({ scope }, { uid: "unrelated" }), { code: "permission-denied" });
  await assert.rejects(setup().getClubInsightsV2({ scope }, { ...coach, isAnonymous: true }), { code: "unauthenticated" });
  await assert.rejects(setup().getClubInsightsV2({ scope: { ...scope, coachId: "other" } }, coach), { code: "invalid-argument" });
});

test("legacy roster rows must also have canonical Firestore permission to open profile and workouts", async () => {
  const service = setup({
    "coaches/legacy": { userUID: "independent", members: ["one", "member-only"] },
    "players/member-only": { firstName: "Member mirror only" },
    "players/doc-alias-only": { firstName: "Document alias only", coachId: "legacy" },
    "players/doc-link-only": { firstName: "Unlisted document link", coachDocId: "legacy" },
  });
  assert.deepEqual((await service.getClubInsightsV2({ scope }, coach)).players.map(player => player.id), ["one", "two", "three"]);
  for (const playerId of ["member-only", "doc-alias-only", "doc-link-only"]) await assert.rejects(service.getCoachPlayerComparison({ scope, playerId }, coach), { code: "permission-denied" });
  const direct = setup({ "coaches/legacy": { userUID: "other" }, "coaches/independent": { userUID: "independent", members: ["member-only"] }, "players/member-only": { firstName: "Current UID mirror" } });
  assert.ok((await direct.getClubInsightsV2({ scope }, coach)).players.some(player => player.id === "member-only"));
});

test("independent identity, membership and roster are rechecked after async history reads", async () => {
  for (const mutate of [
    db => db.docs.set("coaches/legacy", { userUID: "other", members: ["one"] }),
    db => db.docs.set("organizations/club/members/independent", { userUID: "independent", status: "inactive", role: "coach", teamIds: [] }),
  ]) {
    const service = setup({}, { usageReader: async () => { mutate(service.db); return emptyUsage; } });
    await assert.rejects(service.getClubInsightsV2({ scope }, coach), { code: "permission-denied" });
  }
  const moved = setup({}, { usageReader: async () => { moved.db.docs.set("players/one", { organizationId: "club", teamId: "b" }); return emptyUsage; } });
  await assert.rejects(moved.getCoachPlayerComparison({ scope, playerId: "one" }, coach), { code: "aborted" });
});

test("roster name search paginates matching names while reporting totals stay complete", async () => {
  const service = setup();
  const report = await service.getClubInsightsV2({ scope, nameSearch: "ADA" }, coach);
  assert.equal(report.nameSearch, "ADA"); assert.equal(report.roster.matched, 1);
  assert.equal(report.testing.qualifyingTests, 3); assert.equal(report.roster.filtered, 3);
  assert.equal(report.pagination.total, 1); assert.deepEqual(report.players.map(row => row.id), ["one"]);
  const page = await service.getClubInsightsV2({ scope, pageSize: 1 }, coach);
  await assert.rejects(service.getClubInsightsV2({ scope, pageSize: 1, nameSearch: "Ben", cursor: page.pagination.nextCursor }, coach), { code: "failed-precondition" });
  await assert.rejects(service.getClubInsightsV2({ scope, nameSearch: 123 }, coach), { code: "invalid-argument" });
});

test("player comparison uses the complete cohort independent of table filters/search/page", async () => {
  const result = await setup().getCoachPlayerComparison({ scope, playerId: "one", filters: { ageBand: "unknown" }, nameSearch: "Ada", pageSize: 1 }, coach);
  assert.equal(result.schemaVersion, 1); assert.equal(result.player.id, "one"); assert.equal(result.player.age, 15);
  assert.equal(speed(result).sampleCount, 3); assert.equal(speed(result).percentile, 50); assert.equal(speed(result).status, "measured");
  assert.ok(speed(result).measuredScore > 100); assert.equal(result.roster.included, 3); assert.equal(result.freshness.projectionVersion, 4);
  assert.equal(result.axes.find(axis => axis.key === "agility").status, "unmeasured");
  assert.ok(!JSON.stringify(result).includes("profileMetrics"));
});

test("team comparison is scoped to the selected currently assigned team, including during revocation", async () => {
  const result = await setup().getCoachPlayerComparison({ scope: team, playerId: "a" }, staff);
  assert.equal(speed(result).sampleCount, 2); assert.equal(speed(result).percentile, 100);
  await assert.rejects(setup().getCoachPlayerComparison({ scope: team, playerId: "transferred" }, staff), { code: "permission-denied" });
  await assert.rejects(setup().getCoachPlayerComparison({ scope: { ...team, teamId: "b" }, playerId: "transferred" }, staff), { code: "permission-denied" });
  await assert.rejects(setup().getCoachPlayerComparison({ scope: { kind: "organization", organizationId: "club" }, playerId: "a" }, staff), { code: "invalid-argument" });
  const revoked = setup({}, { usageReader: async () => { revoked.db.docs.delete("organizations/club/members/staff"); return emptyUsage; } });
  await assert.rejects(revoked.getCoachPlayerComparison({ scope: team, playerId: "a" }, staff), { code: "permission-denied" });
});

test("comparison honors testing windows and ignores unqualified, duplicate, undated, future and provisional values", async () => {
  const extra = {
    "players/one/reps/r": { repType: "sprint", max_velocity: 8, createdAt: NOW - 100 * 86400000 },
    "players/one/reps/failed": { repType: "sprint", max_velocity: 20, createdAt: NOW - 1000, processingStatus: "failed", resultsValid: false },
    "players/one/reps/future": { repType: "sprint", max_velocity: 20, createdAt: NOW + 1000 },
    "players/one/reps/undated": { repType: "sprint", max_velocity: 20 },
    "players/one/provisionalEstimates/current": { sprint: 100 },
    "players/three/insightMetadata/reporting": { include: false },
  };
  const service = setup(extra);
  const cumulative = await service.getCoachPlayerComparison({ scope, playerId: "one" }, coach);
  assert.equal(speed(cumulative).sampleCount, 2); assert.equal(speed(cumulative).percentile, 100);
  const period = await service.getCoachPlayerComparison({ scope, playerId: "one", testingMode: "period" }, coach);
  assert.equal(speed(period).sampleCount, 1); assert.equal(speed(period).status, "unmeasured"); assert.equal(speed(period).percentile, null);
  const ben = await service.getCoachPlayerComparison({ scope, playerId: "two", testingMode: "period" }, coach);
  assert.equal(speed(ben).status, "insufficientComparison"); assert.equal(speed(ben).percentile, null);
  await assert.rejects(service.getCoachPlayerComparison({ scope, playerId: "three" }, coach), { code: "permission-denied" });
});

test("percentiles use average tied ranks, all equal is 50, absent axes are not zeros", () => {
  const row = (id, value) => ({ id, selected: [{ qualified: 1, drill: "sprint", profileMetrics: { sprintMaxSpeed: value } }] });
  let result = comparePlayer([row("a", 8), row("b", 8), row("c", 10)], "a");
  assert.equal(result.find(axis => axis.key === "speed").percentile, 25);
  result = comparePlayer([row("a", 8), row("b", 8), row("c", 8)], "a");
  assert.equal(result.find(axis => axis.key === "speed").percentile, 50);
  assert.equal(result.find(axis => axis.key === "power").measuredScore, null);
});

test("axis scores use best metric observations, lower-is-better times and canonical secondary null precedence", () => {
  const rep = { id: "r", repType: "sprint", max_velocity: 8, totalTime: null, createdAt: NOW };
  const resolved = effectiveRep(rep, { ...evidence("one", rep), metadata: { resultsValid: true, processingStatus: "complete", totalTime: 1 } }, false);
  const values = measuredMetrics(resolved);
  assert.equal(values.sprintMaxSpeed, 8); assert.equal(values.sprintCompletionTime, undefined);
  const axes = measuredAxes([
    { qualified: 1, drill: "changeOfDirection", profileMetrics: { codTotalTime: 4.68 } },
    { qualified: 1, drill: "changeOfDirection", profileMetrics: { codTotalTime: 9.36 } },
    { qualified: 0, drill: "changeOfDirection", profileMetrics: { codTotalTime: 0.1 } },
  ]);
  assert.equal(axes.find(axis => axis.key === "agility").measuredScore, 100);
  assert.deepEqual(measuredMetrics({ ...resolved, resultStatus: { qualified: true, duplicate: true } }), {});
});

test("recorded age supports stored birth formats and declines stale or invented dates", () => {
  const born = Date.UTC(2011, 8, 30), expected = 14;
  for (const input of ["2011-09-30", new Date(born), { _seconds: born / 1000 }, { seconds: born / 1000 }, new FakeTimestamp(born), { toDate: () => new Date(born) }]) {
    assert.equal(demographics({ birthDate: input }, {}, NOW).age, expected);
  }
  for (const field of ["birthDate", "dateOfBirth", "dob", "birthdate", "birthday"]) assert.equal(demographics({ [field]: "2011-09-29" }, {}, NOW).age, 15);
  assert.equal(demographics({ birthDate: "2011-02-30", age: 15, ageRecordedAt: NOW }, {}, NOW).age, 15);
  assert.equal(demographics({ age: 15, ageRecordedAt: NOW - 366 * 86400000, division: "U15" }, {}, NOW).age, null);
  assert.equal(demographics({ age: 15, ageRecordedAt: NOW + 1 }, {}, NOW).age, null);
  assert.equal(demographics({ teamName: "U15", trainingContext: { age: 15 } }, {}, NOW).age, null);
});

test("complete comparison bounds fail without silently ranking a partial cohort", async () => {
  await assert.rejects(setup({}, { maxPlayers: 2 }).getCoachPlayerComparison({ scope, playerId: "one" }, coach), { code: "resource-exhausted" });
  const service = setup({}, { maxRebuilds: 1 });
  await assert.rejects(service.getCoachPlayerComparison({ scope, playerId: "one" }, coach), { code: "failed-precondition" });
  await assert.rejects(service.getCoachPlayerComparison({ scope, playerId: "one" }, coach), { code: "failed-precondition" });
  assert.equal(speed(await service.getCoachPlayerComparison({ scope, playerId: "one" }, coach)).sampleCount, 3);
});

test("comparison performance exactly matches the roster and adds only safe selected-player test summaries", async () => {
  const day = 86400000;
  const service = setup({
    "players/one/reps/r": { repType: "sprint", max_velocity: 8, createdAt: NOW - 3 * day },
    "players/one/reps/later": { repType: "sprint", max_velocity: 4, createdAt: NOW - day },
    "players/one/reps/after-end": { repType: "sprint", max_velocity: 20, createdAt: NOW - 1000 },
    "players/one/trainingPlans/private-plan": { status: "active", startDate: "2026-09-20", sessionsPerWeek: 2,
      activatedAt: NOW - 9 * day, timezone: "UTC", coachNote: "PRIVATE-NOTE", intake: { private: "PRIVATE-INTAKE" },
      weeks: [{ workouts: [{ workoutId: "private-workout", title: "PRIVATE-WORKOUT" }] }] },
    "players/one/workoutLogs/private-plan_private-workout": { planId: "private-plan", workoutId: "private-workout",
      startedAt: NOW - day - 60000, endedAt: NOW - day, endReason: "completed", private: "PRIVATE-LOG" },
  });
  const input = { scope, startDate: "2026-09-28", endDate: "2026-09-28", timeZone: "UTC", testingMode: "period" };
  const report = await service.getClubInsightsV2(input, coach);
  const result = await service.getCoachPlayerComparison({ ...input, playerId: "one" }, coach);
  assert.deepEqual(result.performance, report.players.find(player => player.id === "one").performance);
  assert.equal(result.schemaVersion, 1);
  const score = result.testScores.find(value => value.drill === "sprint");
  assert.equal(result.performance.d1, 2 * score.score); // Earlier better score remains standing.
  assert.equal(result.performance.change, score.change);
  assert.equal(score.lastTestDate, "2026-09-28"); assert.equal(score.previousTestDate, "2026-09-26");
  assert.equal(speed(result).measuredScore, score.score); // Percentile obeys selected period.
  assert.equal(result.performance.sessionsDone, 1); assert.equal(result.performance.sessionsPlanned, 3);
  assert.deepEqual(result.testScores.map(value => value.drill), ["shooting", "sprint", "jump", "broadJump", "changeOfDirection", "dribbling"]);
  const text = JSON.stringify(result);
  for (const secret of ["PRIVATE-NOTE", "PRIVATE-INTAKE", "PRIVATE-WORKOUT", "PRIVATE-LOG", "private-plan", "private-workout",
    "history", "profileMetrics", "fingerprint", "plansQuery", "logsQuery"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(Object.keys(score).sort(), ["drill", "score", "change", "lastTestDate", "previousTestDate"].sort());
});

test("comparison loads and rechecks training only for its selected player", async () => {
  const service = setup({
    "players/one/trainingPlans/active": { status: "active", activatedAt: NOW - 86400000, startDate: "2026-09-28", sessionsPerWeek: 2 },
    "players/two/trainingPlans/other": { status: "active", timezone: "broken", coachNote: "OTHER-PRIVATE-PLAN" },
  });
  await service.getCoachPlayerComparison({ scope, playerId: "one" }, coach);
  const planReads = service.db.queries.filter(query => query.path.endsWith("/trainingPlans"));
  assert.equal(planReads.length, 2); // Initial snapshot and response transaction.
  assert.ok(planReads.every(query => query.path === "players/one/trainingPlans"));
  const trainingLogReads = service.db.queries.filter(query => query.path.endsWith("/workoutLogs") && query.filters.some(([field, operator]) => field === "endedAt" && operator === ">="));
  assert.equal(trainingLogReads.length, 2);
  assert.ok(trainingLogReads.every(query => query.path === "players/one/workoutLogs"));
});

test("comparison test summaries honor report-local midnight and exclude future, undated, unqualified and reviewed duplicates", async () => {
  const service = setup({
    "players/one/reps/r": { repType: "sprint", max_velocity: 8, createdAt: Date.UTC(2026, 8, 28, 6, 59) },
    "players/one/reps/midnight": { repType: "sprint", max_velocity: 4, createdAt: Date.UTC(2026, 8, 28, 7) },
    "players/one/reps/future": { repType: "sprint", max_velocity: 100, createdAt: NOW + 1 },
    "players/one/reps/undated": { repType: "sprint", max_velocity: 100 },
    "players/one/reps/unqualified": { repType: "sprint", max_velocity: 100, createdAt: NOW - 1, resultsValid: false },
    "players/one/reps/jump-original": { repType: "jump", jumpHeight: 0.2, createdAt: NOW - 1000,
      sessionNumber: 1, repNumber: 1, storagePath: "players/one/jump.mp4" },
    "players/one/reps/jump-mirror": { repType: "jump", jumpHeight: 10, createdAt: NOW - 1, sessionNumber: 1, repNumber: 1 },
  });
  const local = await service.getCoachPlayerComparison({ scope, playerId: "one", timeZone: "America/Los_Angeles" }, coach);
  const sprintScore = local.testScores.find(row => row.drill === "sprint");
  assert.equal(sprintScore.previousTestDate, "2026-09-27"); assert.equal(sprintScore.lastTestDate, "2026-09-28");
  assert.ok(sprintScore.change < 0);
  assert.ok(local.testScores.find(row => row.drill === "jump").score < 50);
  const utc = await service.getCoachPlayerComparison({ scope, playerId: "one", timeZone: "UTC" }, coach);
  assert.equal(utc.testScores.find(row => row.drill === "sprint").change, null);
  assert.equal(utc.testScores.find(row => row.drill === "sprint").previousTestDate, null);
  const historical = await service.getCoachPlayerComparison({ scope, playerId: "one", timeZone: "America/Los_Angeles", endDate: "2026-09-27" }, coach);
  assert.equal(historical.testScores.find(row => row.drill === "sprint").lastTestDate, "2026-09-27");
  assert.equal(historical.testScores.find(row => row.drill === "sprint").change, null);
});

test("invalid plan timezone preserves complete comparison and roster with unavailable training targets", async () => {
  const service = setup({
    "players/one/trainingPlans/active": { status: "active", activatedAt: NOW - 10 * 86400000,
      startDate: "2026-09-20", sessionsPerWeek: 2, timezone: "unusable", weeks: [{ workouts: [{ workoutId: "slot" }] }] },
    "players/one/workoutLogs/active_slot": { planId: "active", workoutId: "slot", endedAt: NOW - 1000, endReason: "completed" },
  });
  const comparison = await service.getCoachPlayerComparison({ scope, playerId: "one" }, coach);
  const report = await service.getClubInsightsV2({ scope }, coach);
  assert.deepEqual(comparison.performance, report.players.find(player => player.id === "one").performance);
  assert.equal(comparison.performance.sessionsPlanned, null); assert.equal(comparison.performance.sessionsDone, 1);
  assert.ok(!comparison.performance.needsYouReasons.includes("Behind on training"));
  assert.equal(report.freshness.complete, true); assert.equal(report.overview.planPlayers, 0);
});

test("comparison rejects current training changes and ownership changes before returning its new summary", async () => {
  const planPath = "players/one/trainingPlans/active", logPath = "players/one/workoutLogs/active_slot";
  const plan = { status: "active", startDate: "2026-09-20", sessionsPerWeek: 2, activatedAt: NOW - 9 * 86400000 };
  for (const mutate of [
    db => db.docs.set(planPath, { ...plan, sessionsPerWeek: 3 }),
    db => db.docs.set(logPath, { planId: "active", workoutId: "slot", endedAt: NOW - 1000, endReason: "completed" }),
    db => db.docs.set("players/one", { organizationId: "club", teamId: "b" }),
  ]) {
    const service = setup({ [planPath]: plan }), original = service.db.runTransaction.bind(service.db);
    service.db.runTransaction = (handler, options) => {
      if (options?.readOnly) mutate(service.db);
      return original(handler, options);
    };
    await assert.rejects(service.getCoachPlayerComparison({ scope, playerId: "one" }, coach), { code: "aborted" });
  }
});
