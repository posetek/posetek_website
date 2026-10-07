"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createInsightsV2, periodOf, midnight, summarizeWorkouts, verifiedProgress } = require("./insights-v2");
const { createInsightProjection, completeQuery } = require("./insights-v2-projection");
const NOW = Date.UTC(2026, 8, 17, 16);
const admin = { uid: "admin", email: "admin@posetek.net", emailVerified: true };
const emptyUsage = { complete: true, collected: false, webCollected: false, iosCollected: false, collectionStartedAtMillis: null,
  totalMillis: 0, webMillis: 0, iosMillis: 0, overlapMillis: 0, featureMillis: {}, activeDays: 0, returning: false, latestAtMillis: null, days: [] };
const seed = {
  "organizations/club": { schemaVersion: 2, name: "Club" }, "organizations/other": { schemaVersion: 2, name: "Other" },
  "organizations/legacy": { name: "Legacy" }, "teams/a": { organizationId: "club", name: "A" }, "teams/b": { organizationId: "club", name: "B" },
  "teams/foreign": { organizationId: "other", name: "Foreign" },
  "organizations/club/members/manager": { userUID: "manager", role: "manager", status: "active", teamIds: [] },
  "organizations/club/members/coach": { userUID: "coach", role: "coach", status: "active", teamIds: ["a", "foreign"] },
  "players/a": { firstName: "Ada", organizationId: "club", teamId: "a", age: 14, ageRecordedAt: NOW },
  "players/a/insightMetadata/reporting": { division: "girls", include: true },
  "players/a/reps/r": { repType: "sprint", max_velocity: 8, createdAt: NOW - 1000 },
  "players/b": { firstName: "Ben", organizationId: "club", teamId: "b" },
  "players/u": { firstName: "Unassigned", organizationId: "club" },
  "players/x": { firstName: "Excluded", organizationId: "club", teamId: "a" },
  "players/x/insightMetadata/reporting": { include: false },
  "players/f": { firstName: "Foreign", organizationId: "other", teamId: "foreign" },
  "players/l": { firstName: "Independent", teamId: "a" },
  "players/old": { firstName: "Old", organizationId: "legacy", teamId: "a" },
};
const verified = async () => ({ metadata: { resultsValid: true, processingStatus: "complete" }, context: { result: { resultsValid: true, primaryMetric: 8 } } });
function setup(extra = {}, options = {}) {
  const db = new FakeFirestore({ ...seed, ...extra });
  const service = createInsightsV2({ db, HttpsError, now: () => NOW, usageReader: async () => ({ ...emptyUsage }), readEvidence: verified, ...options });
  return { db, ...service };
}
const orgRequest = { scope: { kind: "organization", organizationId: "club" } };

test("default local 56-date range and DST boundaries are exact", () => {
  const fail = (_, message) => { throw Error(message); };
  const period = periodOf({}, NOW, fail);
  assert.equal(period.timeZone, "America/Los_Angeles"); assert.equal(period.endDate, "2026-09-17");
  assert.equal((Date.parse(period.endDate) - Date.parse(period.startDate)) / 86400000, 55);
  assert.equal(midnight("2026-03-09", "America/Los_Angeles") - midnight("2026-03-08", "America/Los_Angeles"), 23 * 3600000);
  assert.equal(midnight("2026-11-02", "America/Los_Angeles") - midnight("2026-11-01", "America/Los_Angeles"), 25 * 3600000);
  assert.throws(() => periodOf({ startDate: "2026-02-30" }, NOW, fail));
  assert.throws(() => periodOf({ timeZone: "invented" }, NOW, fail));
});

test("global includes canonical organizations only and full aggregates ignore page size", async () => {
  const service = setup();
  const result = await service.getClubInsightsV2({ scope: { kind: "global" }, pageSize: 1 }, admin);
  assert.deepEqual(result.roster, { total: 5, included: 4, excluded: 1, filtered: 4 });
  assert.equal(result.players.length, 1); assert.equal(result.testing.qualifyingTests, 1);
  assert.equal(result.pagination.total, 4); assert.ok(result.pagination.nextCursor);
  const page = await service.getClubInsightsV2({ scope: { kind: "global" }, pageSize: 1, cursor: result.pagination.nextCursor }, admin);
  assert.notEqual(page.players[0].id, result.players[0].id); assert.deepEqual(page.testing, result.testing);
  assert.equal(result.usage.notCollectedPlayers, 4); assert.equal(result.usage.iosCollectedPlayers, 0);
  assert.ok(!JSON.stringify(result).includes("Independent")); assert.ok(!JSON.stringify(result).includes("storagePath"));
});

test("manager includes unassigned; coach intersects assigned canonical teams", async () => {
  const service = setup();
  const manager = await service.getClubInsightsV2(orgRequest, { uid: "manager" });
  assert.deepEqual(manager.players.map(r => r.id), ["a", "b", "u"]);
  const coach = await service.getClubInsightsV2(orgRequest, { uid: "coach" });
  assert.deepEqual(coach.players.map(r => r.id), ["a"]); assert.equal(coach.scope.assignedTeamsOnly, true);
  assert.deepEqual(coach.choices.organizations[0].teams.map(t => t.id), ["a"]);
  await assert.rejects(service.getClubInsightsV2({ scope: { kind: "global" } }, { uid: "manager" }), { code: "permission-denied" });
  await assert.rejects(service.getClubInsightsV2({ scope: { kind: "team", organizationId: "club", teamId: "b" } }, { uid: "coach" }), { code: "permission-denied" });
});

test("forged, inactive and malformed memberships grant no access", async () => {
  for (const patch of [{ status: "inactive" }, { userUID: "other" }, { teamIds: ["a", 42] }]) {
    const service = setup({ "organizations/club/members/coach": { ...seed["organizations/club/members/coach"], ...patch } });
    await assert.rejects(service.getClubInsightsV2(orgRequest, { uid: "coach" }), { code: "permission-denied" });
  }
  await assert.rejects(setup().getClubInsightsV2(orgRequest, { uid: "a" }), { code: "permission-denied" });
  await assert.rejects(setup().getClubInsightsV2(orgRequest, {}), { code: "unauthenticated" });
  await assert.rejects(setup().getClubInsightsV2(orgRequest, { ...admin, emailVerified: false }), { code: "permission-denied" });
});

test("ownership and role revocation during history reads cannot leak cached reports", async () => {
  const service = setup({}, { usageReader: async () => {
    service.db.docs.set("organizations/club/members/manager", { ...seed["organizations/club/members/manager"], status: "inactive" });
    return emptyUsage;
  } });
  await assert.rejects(service.getClubInsightsV2(orgRequest, { uid: "manager" }), { code: "permission-denied" });
  const moved = setup({}, { usageReader: async (_db, id) => { if (id === "a") moved.db.docs.set("players/a", { organizationId: "other", teamId: "foreign" }); return emptyUsage; } });
  await assert.rejects(moved.getClubInsightsV2(orgRequest, { uid: "manager" }), { code: "aborted" });
});

test("server filters apply to complete summaries and cursors are scope bound", async () => {
  const service = setup();
  const result = await service.getClubInsightsV2({ ...orgRequest, filters: { division: "girls", ageBand: "13-15", testingStatus: "partiallyTested" } }, admin);
  assert.equal(result.roster.filtered, 1); assert.deepEqual(result.players[0].testing.exerciseKeys, ["sprint"]);
  assert.equal(result.players[0].testing.missingExerciseKeys.length, 5);
  const unassigned = await service.getClubInsightsV2({ ...orgRequest, filters: { teamAssignment: "unassigned" } }, admin);
  assert.deepEqual(unassigned.players.map(p => p.id), ["u"]);
  const first = await service.getClubInsightsV2({ ...orgRequest, pageSize: 1 }, admin);
  await assert.rejects(service.getClubInsightsV2({ ...orgRequest, filters: { division: "unknown" }, cursor: first.pagination.nextCursor }, admin), { code: "failed-precondition" });
});

test("cumulative coverage differs from period and future or undated docs stay separate", async () => {
  const service = setup({ "players/a/reps/old": { repType: "sprint", max_velocity: 8, createdAt: NOW - 100 * 86400000 },
    "players/a/reps/future": { repType: "sprint", max_velocity: 8, createdAt: NOW + 1000 },
    "players/a/reps/undated": { repType: "sprint", max_velocity: 8 } });
  const cumulative = await service.getClubInsightsV2(orgRequest, admin), period = await service.getClubInsightsV2({ ...orgRequest, testingMode: "period" }, admin);
  assert.equal(cumulative.testing.qualifyingTests, 2); assert.equal(period.testing.qualifyingTests, 1);
  assert.equal(cumulative.testing.undatedDocuments, 1); assert.equal(cumulative.testing.futureDatedDocuments, 1);
  assert.equal(cumulative.testing.days.reduce((n, d) => n + d.qualifyingTests, 0), 1);
});

test("usage failures propagate and platform/feature filters do not call uncollected zero", async () => {
  const service = setup({}, { usageReader: async (_db, id) => id === "a" ? { ...emptyUsage, collected: true, webCollected: true,
    totalMillis: 60000, webMillis: 60000, activeDays: 1, featureMillis: { workout: 60000 }, latestAtMillis: NOW } : emptyUsage });
  const result = await service.getClubInsightsV2({ ...orgRequest, filters: { usagePlatform: "web", usageFeature: "workout" } }, admin);
  assert.equal(result.roster.filtered, 1); assert.equal(result.usage.activeMinutes, 1); assert.equal(result.usage.iosCollectedPlayers, 0);
  const failed = setup({}, { usageReader: async () => ({ ...emptyUsage, complete: false }) });
  await assert.rejects(failed.getClubInsightsV2(orgRequest, admin), { code: "failed-precondition" });
});

test("complete internal pagination works and operational bounds never return a partial report", async () => {
  const db = new FakeFirestore(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`items/${i}`, { value: i }])));
  assert.equal((await completeQuery(db.collection("items"), 7, HttpsError, 2)).length, 7);
  await assert.rejects(completeQuery(db.collection("items"), 6, HttpsError, 2), { code: "resource-exhausted" });
  await assert.rejects(setup({}, { maxPlayers: 2 }).getClubInsightsV2(orgRequest, admin), { code: "resource-exhausted" });
});

test("bounded automatic rebuild advances on retries and dirty rebuild changes cursor", async () => {
  const service = setup({}, { maxRebuilds: 1 });
  await assert.rejects(service.getClubInsightsV2(orgRequest, admin), { code: "failed-precondition" });
  await assert.rejects(service.getClubInsightsV2(orgRequest, admin), { code: "failed-precondition" });
  const result = await service.getClubInsightsV2({ ...orgRequest, pageSize: 1 }, admin);
  assert.equal(result.roster.included, 3);
  await service.invalidateInsightPlayer("a");
  await assert.rejects(service.getClubInsightsV2({ ...orgRequest, pageSize: 1, cursor: result.pagination.nextCursor }, admin), { code: "failed-precondition" });
  assert.equal((await service.getClubInsightsV2(orgRequest, admin)).freshness.complete, true);
});

test("projection mutation during rebuild cannot publish stale current manifest", async () => {
  const db = new FakeFirestore(seed);
  let projection;
  projection = createInsightProjection({ db, HttpsError, now: () => NOW, readEvidence: async () => {
    await projection.invalidateInsightPlayer("a"); return verified();
  } });
  await assert.rejects(projection.rebuildInsightPlayer("a"), { code: "aborted" });
  assert.equal(db.snapshot("players/a/insightSummaries/current"), undefined);
});

test("workout malformed/future endings never inflate completions or time", () => {
  const period = { startMillis: NOW - 10000, endMillis: NOW + 1000 };
  const summary = summarizeWorkouts([{ at: NOW - 1000, end: NOW + 1, status: "completed", timerMinutes: 500 }], period, NOW);
  assert.equal(summary.completed, 0); assert.equal(summary.timerMinutes, 0); assert.equal(summary.unknownEnding, 1);
});

test("workout completions and starts use their respective actual dates", () => {
  const period = { startMillis: NOW - 10000, endMillis: NOW + 1 };
  const summary = summarizeWorkouts([{ at: NOW - 20000, end: NOW - 1000, status: "completed", timerMinutes: 2 }], period, NOW);
  assert.equal(summary.started, 0); assert.equal(summary.completed, 1); assert.equal(summary.timerMinutes, 2);
});

test("historical usage days remain null before platform collection began", async () => {
  const service = setup({}, { usageReader: async (_db, id) => id === "a" ? { ...emptyUsage, collected: true, webCollected: true,
    collectionStartedAtMillis: NOW, webCollectionStartedAtMillis: NOW, iosCollectionStartedAtMillis: null,
    totalMillis: 60000, webMillis: 60000, activeDays: 1, days: [{ date: "2026-09-17", activeMillis: 60000, webMillis: 60000, iosMillis: 0 }] } : emptyUsage });
  const result = await service.getClubInsightsV2(orgRequest, admin);
  assert.equal(result.usage.days[0].activeMinutes, null); assert.equal(result.usage.days[0].webMinutes, null);
  assert.equal(result.usage.days.at(-1).webMinutes, 1); assert.equal(result.usage.days.at(-1).iosMinutes, null);
  assert.equal(result.usage.webCollectionStartedAtMillis, NOW);
});

test("malformed filter objects return a deliberate callable validation error", async () => {
  await assert.rejects(setup().getClubInsightsV2({ ...orgRequest, filters: { constructor: "x" } }, admin), { code: "invalid-argument" });
});

test("new canonical player during loading forces a retry instead of a falsely complete total", async () => {
  const service = setup({}, { usageReader: async () => { service.db.docs.set("players/new", { organizationId: "club", teamId: "a" }); return emptyUsage; } });
  await assert.rejects(service.getClubInsightsV2(orgRequest, admin), { code: "aborted" });
});

test("undated attempts are review markers, never no recorded tests or dated success", async () => {
  const service = setup({ "players/b/reps/undated": { repType: "sprint", max_velocity: 8 } });
  const result = await service.getClubInsightsV2({ ...orgRequest, testingMode: "period" }, admin);
  const row = result.players.find(p => p.id === "b");
  assert.equal(row.testing.status, "noSuccessfulTests"); assert.equal(row.testing.hasDateUnknownAttempts, true);
  assert.equal(row.testing.dateUnknownAttempts, 1); assert.equal(row.testing.qualifyingTests, 0);
});

test("verified weekly progress clips partial local weeks and counts unique athletes", () => {
  const period = periodOf({ startDate: "2026-09-16", endDate: "2026-09-17" }, NOW, (_, message) => { throw Error(message); });
  const event = (at, value, patch = {}) => ({ at, qualified: 1, drill: "sprint", metric: { value, unit: "m/s" }, ...patch });
  const result = verifiedProgress([
    { id: "a", history: { testing: [event(Date.parse("2026-09-16T06:59:59Z"), 99), // still prior local day
      event(Date.parse("2026-09-16T07:00:00Z"), 8), event(NOW - 1, 9), event(NOW + 1, 100),
      event(NOW - 2, 50, { qualified: 0 }), event(null, 100), event(NOW - 2, 1, { drill: "jump", metric: { value: 20, unit: "in" } })] } },
    { id: "b", history: { testing: [event(NOW - 3, 10)] } },
  ], period, NOW);
  assert.deepEqual(result, [{ drill: "sprint", unit: "m/s", lowerIsBetter: false, samples: 3, players: 2,
    weeks: [{ weekStart: "2026-09-14", best: 10, samples: 3, players: 2 }] }]);
});

test("time-based progress uses minimum, keeps empty weeks and never adds weekly athlete counts", () => {
  const period = periodOf({ startDate: "2026-09-01", endDate: "2026-09-17" }, NOW, (_, message) => { throw Error(message); });
  const events = ["2026-09-01T12:00:00Z", "2026-09-15T12:00:00Z", "2026-09-16T12:00:00Z"].map((at, index) => ({ at: Date.parse(at), qualified: 1, drill: "dribbling", metric: { value: 8 - index, unit: "s" } }));
  const [series] = verifiedProgress([{ id: "one", history: { testing: events } }], period, NOW);
  assert.equal(series.lowerIsBetter, true); assert.equal(series.players, 1); assert.equal(series.samples, 3);
  assert.deepEqual(series.weeks.map(week => week.best), [8, null, 6]);
  assert.deepEqual(series.weeks.map(week => week.players), [1, 0, 1]);
});

test("API progress honors filtered complete scope and period despite cumulative testing", async () => {
  const service = setup({ "players/b/reps/recent": { repType: "sprint", max_velocity: 20, createdAt: NOW - 1 },
    "players/a/reps/old": { repType: "sprint", max_velocity: 30, createdAt: NOW - 100 * 86400000 } }, {
    readEvidence: async (_id, rep) => ({ metadata: { resultsValid: true, processingStatus: "complete" }, context: { result: { resultsValid: true, primaryMetric: rep.max_velocity } } }),
  });
  const result = await service.getClubInsightsV2({ ...orgRequest, testingMode: "cumulative", filters: { division: "girls" }, pageSize: 1 }, admin);
  assert.equal(result.testing.qualifyingTests, 2);
  assert.equal(result.testing.progress[0].samples, 1); assert.equal(result.testing.progress[0].players, 1);
  assert.equal(result.testing.progress[0].weeks.at(-1).best, 8);
});

test("workout outcome, duration and prescription denominators exclude outside-period endings", () => {
  const base = { at: 20000, end: 40000, timerMinutes: 0, estimatedMinutes: 0, unknownPrescription: 0, allPrescribedSetsCompleted: 0 };
  const result = summarizeWorkouts([
    { ...base, status: "completed", durationSource: "timer", allPrescribedSetsCompleted: 1 },
    { ...base, status: "endedEarly", durationSource: "estimate", estimatedMinutes: 2, unknownPrescription: 1 },
    { ...base, end: null, status: "inProgress", durationSource: "unknown", unknownPrescription: 1 },
    { ...base, status: "abandoned", durationSource: "timer", timerMinutes: 4 },
    { ...base, end: 100001, status: "completed", durationSource: "timer", timerMinutes: 10 },
    { ...base, at: 50000, end: 95000, status: "completed", durationSource: "timer", timerMinutes: 99, setsCompleted: 99 },
  ], { startMillis: 0, endMillis: 90000 }, 100000);
  assert.equal(result.started, 6); assert.equal(result.outcomeEvents, 5);
  assert.equal(result.completed + result.endedEarly + result.inProgress + result.abandoned + result.unknownEnding, 5);
  assert.equal(result.timerRecords, 2); assert.equal(result.estimatedRecords, 1); assert.equal(result.unknownDuration, 2);
  assert.equal(result.knownPrescription, 3); assert.equal(result.unknownPrescription, 2);
  assert.equal(result.timerMinutes, 4); assert.equal(result.estimatedMinutes, 2); assert.equal(result.setsCompleted, 0);
});

test("failure reports retain overlap with recordings without becoming additional attempts", async () => {
  const service = setup({
    "failureCases/linked": { playerDocumentID: "a", repId: "r", createdAt: NOW - 10 },
    "failureCases/unmatched": { playerDocumentID: "a", repId: null, drillType: "jump", createdAt: NOW - 10 },
  });
  // Use the real production evidence reader so failure linkage is exercised;
  // missing artifacts cannot alter the fact that a recording document exists.
  const projection = createInsightProjection({ db: service.db, HttpsError, now: () => NOW,
    bucket: { name: "example.test", file() { return { async getMetadata() { throw Object.assign(Error("missing"), { code: 404 }); } }; } } });
  const result = await createInsightsV2({ db: service.db, HttpsError, now: () => NOW, projection,
    usageReader: async () => emptyUsage }).getClubInsightsV2(orgRequest, admin);
  assert.equal(result.testing.recordedDocuments, 1); assert.equal(result.testing.distinctAttempts, 1);
  assert.equal(result.testing.failureReports, 2); assert.equal(result.testing.linkedFailureReports + result.testing.unmatchedFailureReports, 2);
  assert.equal(result.testing.linkedFailureReports, 1); assert.equal(result.testing.unmatchedFailureReports, 1);
  assert.equal(result.testing.days.at(-1).failureReports, 2);
});

test("recent participation counts full filtered scope and unions testing with actual workouts", async () => {
  const service = setup({
    "players/a/workoutLogs/actual": { startedAt: NOW - 1000 },
    "players/b/workoutLogs/actual": { startedAt: NOW - 100 * 86400000, endedAt: NOW - 1000, endReason: "completed" },
    "players/u/plannedWorkouts/planned": { createdAt: NOW - 1000 },
  });
  const result = await service.getClubInsightsV2({ ...orgRequest, pageSize: 1 }, admin);
  assert.equal(result.players.length, 1);
  assert.deepEqual(result.participation, { testingPlayers: 1, workoutPlayers: 2, anyPlayers: 2 });
  const filtered = await service.getClubInsightsV2({ ...orgRequest, filters: { division: "girls" } }, admin);
  assert.deepEqual(filtered.participation, { testingPlayers: 1, workoutPlayers: 1, anyPlayers: 1 });
});


test("roster cursors reject changed training targets and follow-up ordering", async () => {
  const planPath = "players/a/trainingPlans/plan";
  const plan = { status: "active", startDate: "2026-09-01", activatedAt: NOW - 10 * 86400000, sessionsPerWeek: 2 };
  const service = setup({ [planPath]: plan });
  const first = await service.getClubInsightsV2({ ...orgRequest, pageSize: 1 }, admin);
  assert.ok(first.pagination.nextCursor);
  service.db.docs.set(planPath, { ...plan, sessionsPerWeek: 3 });
  await assert.rejects(service.getClubInsightsV2({ ...orgRequest, pageSize: 1, cursor: first.pagination.nextCursor }, admin), { code: "failed-precondition" });
  const next = await service.getClubInsightsV2({ ...orgRequest, pageSize: 1 }, admin);
  service.db.docs.set("players/a", { ...seed["players/a"], lastLogin: NOW });
  await assert.rejects(service.getClubInsightsV2({ ...orgRequest, pageSize: 1, cursor: next.pagination.nextCursor }, admin), { code: "failed-precondition" });
});
