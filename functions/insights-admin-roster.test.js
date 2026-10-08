"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createInsightsV2 } = require("./insights-v2");
const NOW = Date.UTC(2026, 9, 6, 16);
const admin = { uid: "admin", email: "admin@posetek.net", emailVerified: true, isAnonymous: false };
const request = { scope: { kind: "organization", organizationId: "club" } };
const emptyUsage = { complete: true, collected: false, webCollected: false, iosCollected: false, collectionStartedAtMillis: null,
  totalMillis: 0, webMillis: 0, iosMillis: 0, overlapMillis: 0, featureMillis: {}, activeDays: 0, returning: false, latestAtMillis: null, days: [] };
const seed = {
  "organizations/club": { schemaVersion: 2, name: "Club" }, "organizations/other": { schemaVersion: 2, name: "Other" },
  "organizations/legacy": { name: "Legacy" }, "teams/a": { organizationId: "club", name: "A" },
  "teams/b": { organizationId: "club", name: "B" }, "teams/foreign": { organizationId: "other", name: "Foreign" },
  "organizations/club/members/manager": { userUID: "manager", role: "manager", status: "active", teamIds: [] },
  "organizations/club/members/coach": { userUID: "coach", role: "coach", status: "active", teamIds: ["a"] },
  "players/a": { firstName: "Ada", organizationId: "club", teamId: "a", age: 14, ageRecordedAt: NOW,
    userUID: "private-auth-id", email: "private@example.test", coachNote: "private-note", signupCode: "PRIVATE-CODE", signupInvitationReady: true },
  "players/a/insightMetadata/reporting": { division: "girls" },
  "players/a/reps/recent": { repType: "sprint", max_velocity: 8, createdAt: NOW - 1000 },
  "players/a/reps/old": { repType: "sprint", max_velocity: 8, createdAt: NOW - 100 * 86400000 },
  "players/a/workoutLogs/w": { workoutId: "w", source: "plan", planId: "private-plan", startedAt: NOW - 60000,
    endedAt: NOW - 1, activeSeconds: 45, endReason: "completed", workoutSnapshot: { blocks: [] }, blocks: [] },
  "players/b": { firstName: "Ben", organizationId: "club", teamId: "b" },
  "players/x": { firstName: "Excluded", organizationId: "club", teamId: "a" },
  "players/x/insightMetadata/reporting": { include: false },
  "players/x/reps/private": { repType: "sprint", max_velocity: 999, createdAt: NOW - 1000 },
  "players/f": { firstName: "Foreign", organizationId: "other", teamId: "foreign" },
  "players/l": { firstName: "Legacy", organizationId: "legacy" },
};
function setup(extra = {}, options = {}) {
  const db = new FakeFirestore({ ...seed, ...extra });
  return { db, ...createInsightsV2({ db, HttpsError, now: () => NOW, usageReader: async () => ({ ...emptyUsage }),
    readEvidence: async () => ({ metadata: { resultsValid: true, processingStatus: "complete" }, context: { result: { resultsValid: true, primaryMetric: 8 } } }), ...options }) };
}
const lookup = ids => ({ ...request, rosterPlayerIds: ids });

test("roster lookup returns the identical allowlisted row independently of report filters, search and page", async () => {
  const service = setup();
  const baseline = await service.getClubInsightsV2(request, admin);
  const queried = await service.getClubInsightsV2({ ...request, rosterPlayerIds: ["b", "a"],
    filters: { division: "unknown" }, nameSearch: "nobody", pageSize: 1 }, admin);
  assert.deepEqual(queried.players, []); assert.equal(queried.roster.filtered, 1); assert.equal(queried.pagination.total, 0);
  assert.equal(queried.testing.qualifyingTests, 0); assert.equal(queried.workouts.completed, 0);
  assert.deepEqual(queried.rosterMetrics, ["b", "a"].map(playerId => ({ playerId, status: "included", player: baseline.players.find(row => row.id === playerId) })));
  const text = JSON.stringify(queried.rosterMetrics);
  for (const secret of ["private-auth-id", "private@example.test", "private-note", "PRIVATE-CODE", "private-plan", "history", "profileMetrics", "workoutSnapshot", "storagePath"]) assert.ok(!text.includes(secret), secret);
});

test("lookup retains the period, testing mode and usage definitions of the ordinary player row", async () => {
  const service = setup({}, { usageReader: async (_db, id) => id === "a" ? { ...emptyUsage, collected: true, webCollected: true,
    collectionStartedAtMillis: NOW - 60000, webCollectionStartedAtMillis: NOW - 60000, totalMillis: 120000, webMillis: 90000,
    iosMillis: 60000, overlapMillis: 30000, activeDays: 2, returning: true, latestAtMillis: NOW, iosCollected: true } : emptyUsage });
  const cumulative = await service.getClubInsightsV2(lookup(["a", "b"]), admin);
  const period = await service.getClubInsightsV2({ ...lookup(["a"]), testingMode: "period", startDate: "2026-10-06", endDate: "2026-10-06" }, admin);
  const a = cumulative.rosterMetrics[0].player;
  assert.equal(a.testing.qualifyingTests, 2); assert.equal(period.rosterMetrics[0].player.testing.qualifyingTests, 1);
  assert.equal(a.workouts.completed, 1); assert.equal(a.workouts.timerMinutes, 0.75);
  assert.deepEqual(a.usage, { status: "returning", collected: true, webCollected: true, iosCollected: true,
    activeMinutes: 2, webMinutes: 1.5, iosMinutes: 1, activeDays: 2 });
  assert.equal(cumulative.rosterMetrics[1].player.usage.collected, false);
  assert.equal(cumulative.rosterMetrics[1].player.usage.status, "notCollected");
});

test("excluded scoped players return no row or private history and are not rebuilt", async () => {
  const loadedUsage = [];
  const service = setup({}, { usageReader: async (_db, id) => { loadedUsage.push(id); return { ...emptyUsage }; } });
  const result = await service.getClubInsightsV2(lookup(["x"]), admin);
  assert.deepEqual(result.rosterMetrics, [{ playerId: "x", status: "excluded" }]);
  assert.ok(!loadedUsage.includes("x"));
  assert.ok(!service.db.queries.some(query => query.path.startsWith("players/x/")));
  assert.equal(service.db.snapshot("players/x/insightSummaries/current"), undefined);
  assert.equal(result.testing.qualifyingTests, 2); assert.equal(result.roster.excluded, 1);
});

test("old callers omit rosterMetrics and all existing fields including pagination remain identical", async () => {
  const service = setup();
  const old = await service.getClubInsightsV2({ ...request, pageSize: 1 }, admin);
  assert.equal(Object.hasOwn(old, "rosterMetrics"), false);
  const added = await service.getClubInsightsV2({ ...request, pageSize: 1, rosterPlayerIds: ["b"] }, admin);
  const { rosterMetrics, ...unchanged } = added;
  assert.deepEqual(unchanged, old); assert.equal(rosterMetrics[0].playerId, "b");
  const next = await service.getClubInsightsV2({ ...request, pageSize: 1, cursor: old.pagination.nextCursor, rosterPlayerIds: ["a"] }, admin);
  const oldNext = await service.getClubInsightsV2({ ...request, pageSize: 1, cursor: old.pagination.nextCursor }, admin);
  const { rosterMetrics: nextMetrics, ...nextUnchanged } = next;
  assert.deepEqual(nextUnchanged, oldNext); assert.equal(nextMetrics[0].playerId, "a");
});

test("twenty unique player IDs are accepted in input order", async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `p_${index}`);
  const extra = Object.fromEntries(ids.map(id => [`players/${id}`, { organizationId: "club", firstName: id }]));
  const result = await setup(extra).getClubInsightsV2(lookup(ids.toReversed()), admin);
  assert.deepEqual(result.rosterMetrics.map(row => row.playerId), ids.toReversed());
});

test("empty, duplicate, oversized, malformed and sparse lookups fail before directory reads", async () => {
  const values = [[], ["a", "a"], Array.from({ length: 21 }, (_, index) => `p${index}`), "a", null, undefined,
    [""], [42], ["a/b"], ["diagnostics"], [" a"], ["a%2Fb"], ["a".repeat(129)], Array(1)];
  for (const value of values) {
    const service = setup();
    await assert.rejects(service.getClubInsightsV2(lookup(value), admin), { code: "invalid-argument" });
    assert.deepEqual(service.db.queries, []);
  }
});

test("lookup is denied to managers, coaches, unverified admins and non-PoseTek identities before any reads", async () => {
  for (const caller of [{ uid: "manager" }, { uid: "coach" }, { ...admin, emailVerified: false },
    { ...admin, email: "admin@example.test" }, { ...admin, email: "admin@posetek.net.example.test" }]) {
    const service = setup();
    await assert.rejects(service.getClubInsightsV2(lookup(["a"]), caller), { code: "permission-denied" });
    assert.deepEqual(service.db.queries, []);
  }
  for (const caller of [{ ...admin, isAnonymous: true }, { ...admin, uid: "" }, {}]) {
    await assert.rejects(setup().getClubInsightsV2(lookup(["a"]), caller), { code: "unauthenticated" });
  }
});

test("player comparison rejects the lookup field for admins and coaches without loading evidence", async () => {
  for (const caller of [admin, { uid: "coach" }]) {
    const service = setup();
    await assert.rejects(service.getCoachPlayerComparison({ scope: { kind: "team", organizationId: "club", teamId: "a" }, playerId: "a", rosterPlayerIds: ["a"] }, caller), { code: "invalid-argument" });
    assert.deepEqual(service.db.queries, []);
  }
});

test("missing, foreign, legacy and wrong-team IDs share the same generic denial without history reads", async () => {
  const errors = [];
  for (const [scope, id] of [[request.scope, "missing"], [request.scope, "f"], [request.scope, "l"],
    [{ kind: "team", organizationId: "club", teamId: "a" }, "b"]]) {
    const service = setup();
    try { await service.getClubInsightsV2({ scope, rosterPlayerIds: [id] }, admin); assert.fail("Lookup should fail"); }
    catch (error) { assert.equal(error.code, "permission-denied"); errors.push(error.message); }
    assert.ok(!service.db.queries.some(query => query.path.startsWith("players/")));
  }
  assert.equal(new Set(errors).size, 1); assert.equal(errors[0], "Roster metrics are unavailable in the selected scope.");
});

test("global lookup includes only current canonical organizations", async () => {
  const service = setup();
  const result = await service.getClubInsightsV2({ scope: { kind: "global" }, rosterPlayerIds: ["f", "a"] }, admin);
  assert.deepEqual(result.rosterMetrics.map(row => row.player.organizationId), ["other", "club"]);
  await assert.rejects(service.getClubInsightsV2({ scope: { kind: "global" }, rosterPlayerIds: ["l"] }, admin), { code: "permission-denied" });
});

test("transfers, deletion and an excluded player's transfer during loading cannot leak lookup metrics", async () => {
  for (const mutate of [
    db => db.docs.set("players/a", { organizationId: "other", teamId: "foreign" }),
    db => db.docs.delete("players/a"),
    db => db.docs.set("players/x", { organizationId: "other", teamId: "foreign" }),
  ]) {
    const service = setup({}, { usageReader: async () => { mutate(service.db); return { ...emptyUsage }; } });
    await assert.rejects(service.getClubInsightsV2(lookup(["a", "x"]), admin), { code: "permission-denied", message: "Roster metrics are unavailable in the selected scope." });
  }
});

test("within-scope team transfers use current ownership labels; team-scope transfers are denied", async () => {
  for (const kind of ["organization", "team"]) {
    const service = setup({}, { usageReader: async (_db, id) => {
      if (id === "a") service.db.docs.set("players/a", { ...seed["players/a"], teamId: "b" });
      return { ...emptyUsage };
    } });
    const input = { scope: { ...request.scope, kind, ...(kind === "team" ? { teamId: "a" } : {}) }, rosterPlayerIds: ["a"] };
    if (kind === "team") await assert.rejects(service.getClubInsightsV2(input, admin), { code: "permission-denied" });
    else assert.equal((await service.getClubInsightsV2(input, admin)).rosterMetrics[0].player.teamId, "b");
  }
});

test("fresh inclusion changes hide a newly excluded player, and newly included history requires retry", async () => {
  const excluded = setup({}, { usageReader: async (_db, id) => {
    if (id === "a") excluded.db.docs.set("players/a/insightMetadata/reporting", { include: false });
    return { ...emptyUsage };
  } });
  assert.deepEqual((await excluded.getClubInsightsV2(lookup(["a"]), admin)).rosterMetrics, [{ playerId: "a", status: "excluded" }]);
  const included = setup({}, { usageReader: async () => {
    included.db.docs.set("players/x/insightMetadata/reporting", { include: true }); return { ...emptyUsage };
  } });
  await assert.rejects(included.getClubInsightsV2(lookup(["x"]), admin), { code: "aborted" });
});

test("admin authorization and scope are revalidated before lookup serialization", async () => {
  const caller = { ...admin };
  const service = setup({}, { usageReader: async () => { caller.emailVerified = false; return { ...emptyUsage }; } });
  await assert.rejects(service.getClubInsightsV2(lookup(["a"]), caller), { code: "permission-denied" });
  const removed = setup({}, { usageReader: async () => {
    removed.db.docs.set("organizations/club", { schemaVersion: 1, name: "Legacy" }); return { ...emptyUsage };
  } });
  await assert.rejects(removed.getClubInsightsV2(lookup(["a"]), admin), { code: "permission-denied" });
});

test("projection invalidation and unrelated roster changes retain existing complete-report retries", async () => {
  let invalidate = false;
  const invalidated = setup({}, { usageReader: async (_db, id) => {
    if (invalidate && id === "a") await invalidated.invalidateInsightPlayer("a"); return { ...emptyUsage };
  } });
  await invalidated.getClubInsightsV2(request, admin);
  invalidate = true;
  await assert.rejects(invalidated.getClubInsightsV2(lookup(["a"]), admin), { code: "aborted" });
  const added = setup({}, { usageReader: async () => { added.db.docs.set("players/new", { organizationId: "club" }); return { ...emptyUsage }; } });
  await assert.rejects(added.getClubInsightsV2(lookup(["a"]), admin), { code: "aborted" });
});

test("validated lookup IDs are copied before asynchronous work", async () => {
  const ids = ["a"];
  const service = setup({}, { usageReader: async () => { ids[0] = "f"; return { ...emptyUsage }; } });
  const result = await service.getClubInsightsV2(lookup(ids), admin);
  assert.deepEqual(result.rosterMetrics.map(row => row.playerId), ["a"]);
});
