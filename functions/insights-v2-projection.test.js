"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createInsightProjection, failureMatchesRep, REBUILD_LEASE_MS } = require("./insights-v2-projection");
const NOW = Date.UTC(2026, 8, 17);
function bucketFixture(values) {
  const reads = [];
  return { name: "example.test", reads, file(name, options) { return {
    async getMetadata() { reads.push({ name, operation: "metadata" }); if (!Object.hasOwn(values, name)) throw Object.assign(Error("missing"), { code: 404 }); return [{ generation: "7", size: Buffer.byteLength(JSON.stringify(values[name])) }]; },
    async download() { assert.equal(options.generation, "7"); reads.push({ name, operation: "download" }); return [Buffer.from(JSON.stringify(values[name]))]; },
  }; } };
}
function fixture(extra = {}, files = {}) {
  const db = new FakeFirestore({ "players/p": { organizationId: "club" }, "players/p/reps/r": {
    repType: "sprint", max_velocity: 8, sessionNumber: 1, repNumber: 1, createdAt: NOW - 1, storagePath: "p/sprint/session1/kick1" }, ...extra });
  const bucket = bucketFixture({ "p/sprint/session1/kick1/metadata.json": { resultsValid: true, processingStatus: "complete" },
    "p/sprint/session1/kick1/reprocess_context.json": { result: { resultsValid: true, primaryMetric: 8 } }, ...files });
  return { db, bucket, ...createInsightProjection({ db, bucket, HttpsError, now: () => NOW }) };
}

test("projection verifies generation-pinned Storage evidence and publishes only safe event facts", async () => {
  const service = fixture();
  const result = await service.loadInsightPlayer("p");
  assert.equal(result.testing[0].qualified, 1); assert.equal(result.summary.recordedDocuments, 1);
  assert.equal(service.bucket.reads.filter(r => r.operation === "download").length, 2);
  const json = JSON.stringify(result);
  for (const forbidden of ["storagePath", "repArtifactFolder", "metadata.json", "reprocess_context", "byEmail", "note"]) assert.ok(!json.includes(forbidden));
  const before = service.bucket.reads.length;
  await service.loadInsightPlayer("p"); assert.equal(service.bucket.reads.length, before);
});

test("foreign recording paths cannot trigger Storage reads or qualification", async () => {
  const service = fixture({ "players/p/reps/r": { repType: "sprint", max_velocity: 8, storagePath: "victim/sprint/session1/kick1" } });
  const result = await service.loadInsightPlayer("p");
  assert.equal(result.testing[0].qualified, 0); assert.equal(service.bucket.reads.length, 0);
});

test("personal workout collection joins reporting without merging an assigned workout", async () => {
  const common = { workoutId: "same", startedAt: NOW - 60000, endedAt: NOW - 1,
    activeSeconds: 45, endReason: "completed", workoutSnapshot: { blocks: [] }, blocks: [] };
  const service = fixture({
    "players/p/workoutLogs/same": { ...common, source: "plan", planId: "assigned" },
    "players/p/personalWorkoutLogs/same": { ...common, source: "plan", endReason: "pain" },
  });
  const result = await service.loadInsightPlayer("p");
  assert.equal(result.summary.workoutLogs, 2);
  assert.equal(result.workouts.length, 2);
  assert.deepEqual(result.workouts.map(row => row.status).sort(), ["completed", "endedEarly"]);
  assert.ok(result.workouts.every(row => row.timerMinutes === 0.75));
  assert.ok(service.db.queries.some(query => query.path === "players/p/personalWorkoutLogs"));
});

test("missing recording coordinates never borrow session one evidence", async () => {
  const service = fixture({ "players/p/reps/r": { repType: "sprint", max_velocity: 8 } });
  const result = await service.loadInsightPlayer("p");
  assert.equal(result.testing[0].qualified, 0); assert.equal(service.bucket.reads.length, 0);
});

test("failure links require exact rep, artifact folder or drill/session/number tuple", () => {
  const rep = { id: "r", repType: "sprint", sessionNumber: 2, repNumber: 3, sessionId: "session" };
  assert.equal(failureMatchesRep({ repId: "r" }, rep, []), true);
  assert.equal(failureMatchesRep({ repId: "older", storage: { repArtifactFolder: "p/sprint/session2/kick3" } }, rep, ["p/sprint/session2/kick3"]), false);
  assert.equal(failureMatchesRep({ storage: { repArtifactFolder: "p/sprint/session2/kick3/" } }, rep, ["p/sprint/session2/kick3"]), true);
  assert.equal(failureMatchesRep({ drillType: "sprint", sessionNumber: 2, repNumber: 3 }, rep, []), true);
  assert.equal(failureMatchesRep({ repId: null, sessionDocId: "older-session", drillType: "sprint", sessionNumber: 2, repNumber: 3 }, rep, []), false);
  assert.equal(failureMatchesRep({ repId: "r", sessionDocId: "older-session" }, rep, []), true);
  assert.equal(failureMatchesRep({ drillType: "jump", sessionNumber: 2, repNumber: 3 }, rep, []), false);
  assert.equal(failureMatchesRep({ repNumber: 3 }, rep, []), false);
});

test("owner-scoped failure without repId can link through explicit recording coordinates", async () => {
  const service = fixture({ "failureCases/f": { playerDocumentID: "p", repId: null, drillType: "sprint", sessionNumber: 1, repNumber: 1, createdAt: NOW } });
  assert.equal((await service.loadInsightPlayer("p")).testing[0].qualified, 0);
  assert.ok(service.db.queries.some(q => q.path === "failureCases" && q.filters[0][0] === "playerDocumentID"));
});

const fs = require("node:fs"), path = require("node:path");
const privateDirectory = path.resolve(__dirname, "../.netlify/vacaville-sep16-repair");
test("private full projection and scoped API reconcile approved history including linked failures", {
  skip: !["completion-evidence.json", "audit-input.json"].every(name => fs.existsSync(path.join(privateDirectory, name))),
}, async () => {
  const { createInsightsV2 } = require("./insights-v2");
  const evidence = JSON.parse(fs.readFileSync(path.join(privateDirectory, "completion-evidence.json")));
  const audit = JSON.parse(fs.readFileSync(path.join(privateDirectory, "audit-input.json")));
  const seed = { "organizations/fixture": { schemaVersion: 2, name: "Fixture" } }, files = {};
  for (const player of evidence.roster) seed[`players/${player.id}`] = { organizationId: "fixture" };
  for (const rep of evidence.reps) {
    seed[`players/${rep.playerId}/reps/${rep.id}`] = rep;
    if (rep.adminRevision) seed[`players/${rep.playerId}/reps/${rep.id}/revisions/${rep.adminRevision.revisionId}`] = { revisionId: rep.adminRevision.revisionId, fields: rep };
  }
  for (const failure of audit.failureCases) seed[`failureCases/${failure.id}`] = { ...failure, playerDocumentID: failure.canonicalPlayerId || failure.playerDocumentID };
  for (const artifact of Object.values(evidence.artifacts)) for (const value of Object.values(artifact)) {
    if (value.state === "read" && value.value !== null) files[value.objectName] = value.value;
  }
  const bucket = bucketFixture(files); bucket.name = evidence.bucket;
  const service = createInsightsV2({ db: new FakeFirestore(seed), bucket, HttpsError, now: () => Date.parse(evidence.cutoffExclusive),
    usageReader: async () => ({ complete: true, collected: false, webCollected: false, iosCollected: false, totalMillis: 0, webMillis: 0,
      iosMillis: 0, overlapMillis: 0, featureMillis: {}, days: [], activeDays: 0, returning: false, latestAtMillis: null }) });
  for (const player of evidence.roster) await service.rebuildInsightPlayer(player.id);
  const result = await service.getClubInsightsV2({ scope: { kind: "global" } }, { uid: "fixture-admin", email: "fixture@posetek.net", emailVerified: true });
  assert.equal(result.roster.included, 36); assert.equal(result.testing.recordedDocuments, 325);
  assert.equal(result.testing.distinctAttempts, 298); assert.equal(result.testing.qualifyingTests, 244);
  assert.equal(result.testing.duplicateDocuments, 27); assert.equal(result.testing.noResultDocuments, 54); assert.equal(result.testing.needsReview, 0);
  assert.equal(result.testing.failureReports, 23);
  assert.equal(result.testing.linkedFailureReports + result.testing.unmatchedFailureReports, 23);
  assert.deepEqual(result.testing.statuses.map(row => row.count), [10, 24, 0, 2]);
});

const diagnosisPath = path.resolve(__dirname, "../.netlify/expanded-insights-control-plane/qualification-diagnosis.json");
test("private live calibration failures from different session documents never invalidate current success", { skip: !fs.existsSync(diagnosisPath) }, () => {
  const { qualifyRep, drillOf } = require("./insights-v2-qualification");
  const { storageFolderCandidates } = require("./athlete-storage-paths");
  const diagnosis = JSON.parse(fs.readFileSync(diagnosisPath));
  let reports = 0, successes = 0;
  for (const row of diagnosis.candidates) {
    const folders = storageFolderCandidates(row.playerId, drillOf(row.rep), row.rep, "kickai-69dd0.firebasestorage.app");
    const failures = row.evidence.failures.filter(failure => failureMatchesRep(failure, row.rep, folders));
    reports += row.evidence.failures.length;
    assert.equal(failures.length, 0, "Prior sessions must not link through reused recording coordinates");
    successes += qualifyRep(row.rep, { ...row.evidence, failures }).qualified;
  }
  assert.equal(reports, 7); assert.equal(successes, 5);
});

test("dirty rebuild cleans only previous published pages and player deletion clears projections", async () => {
  const service = fixture();
  const first = await service.rebuildInsightPlayer("p");
  await service.invalidateInsightPlayer("p");
  const second = await service.rebuildInsightPlayer("p");
  assert.notEqual(first.revisionId, second.revisionId);
  for (const id of first.dayIds) assert.equal(service.db.snapshot(`players/p/insightSummaryDays/${id}`), undefined);
  for (const id of second.dayIds) assert.ok(service.db.snapshot(`players/p/insightSummaryDays/${id}`));
  service.db.docs.delete("players/p");
  assert.equal((await service.rebuildInsightPlayer("p")).deleted, true);
  assert.ok(![...service.db.docs.keys()].some(key => key.includes("insightSummary")));
});

test("missing immutable page is repaired rather than returning a partial or endlessly failing report", async () => {
  const service = fixture();
  const first = await service.rebuildInsightPlayer("p");
  service.db.docs.delete(`players/p/insightSummaryDays/${first.dayIds[0]}`);
  const recovered = await service.loadInsightPlayer("p");
  assert.notEqual(recovered.summary.revisionId, first.revisionId);
  assert.equal(recovered.testing.length, 1);
});

test("metadata transport failure cannot publish an unverified partial summary", async () => {
  const service = fixture();
  service.bucket.file = () => ({ async getMetadata() { throw Object.assign(Error("unavailable"), { code: 503 }); } });
  await assert.rejects(service.rebuildInsightPlayer("p"), /unavailable/);
  assert.equal(service.db.snapshot("players/p/insightSummaries/current"), undefined);
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function coalescingFixture(readEvidence, now = () => NOW, extra = {}) {
  const db = new FakeFirestore({ "players/p": { organizationId: "club" },
    "players/p/reps/r": { repType: "sprint", max_velocity: 8, createdAt: NOW - 1 }, ...extra });
  const evidence = { metadata: { resultsValid: true, processingStatus: "complete" }, context: { result: { resultsValid: true, primaryMetric: 8 } } };
  return { db, evidence, ...createInsightProjection({ db, HttpsError, now, readEvidence: async (...args) => readEvidence ? readEvidence(evidence, ...args) : evidence }) };
}

test("source replay retains its dirty token and reuses a complete published manifest", async () => {
  let reads = 0;
  const service = coalescingFixture(evidence => { reads++; return evidence; });
  const source = { sourceKind: "failure", eventId: "source-event-one" };
  const firstDirty = await service.invalidateInsightPlayer("p", source);
  const summary = await service.rebuildInsightPlayer("p", source);
  assert.equal(reads, 1);
  assert.equal((await service.invalidateInsightPlayer("p", source)).invalidated, false);
  assert.deepEqual(await service.rebuildInsightPlayer("p", source), summary);
  assert.equal(service.db.snapshot("players/p/insightSummaries/state").token, firstDirty.token);
  assert.equal(reads, 1);
  const eventRecords = [...service.db.docs].filter(([path]) => path.includes("/insightSummaries/event_"));
  assert.equal(eventRecords.length, 1);
  assert.ok(!JSON.stringify(eventRecords).includes(source.eventId));
});

test("one rebuild owner coalesces a racing dirty revision and busy invocation stays retryable", async () => {
  const entered = deferred(), continueRead = deferred(); let reads = 0;
  const service = coalescingFixture(async evidence => { if (++reads === 1) { entered.resolve(); await continueRead.promise; } return evidence; });
  const first = { sourceKind: "record", eventId: "source-one" }, second = { sourceKind: "failure", eventId: "source-two" };
  await service.invalidateInsightPlayer("p", first);
  const owner = service.rebuildInsightPlayer("p", first);
  await entered.promise;
  const latest = await service.invalidateInsightPlayer("p", second);
  await assert.rejects(service.rebuildInsightPlayer("p", second), error => error.code === "aborted" && error.details.reason === "insights-rebuild-busy");
  assert.equal(reads, 1);
  assert.equal(service.db.snapshot("players/p/insightSummaries/current"), undefined);
  continueRead.resolve();
  const result = await owner;
  assert.equal(result.token, latest.token); assert.equal(reads, 2);
  assert.equal(service.db.snapshot("players/p/insightSummaries/state").rebuildLease, null);
  assert.equal((await service.invalidateInsightPlayer("p", second)).invalidated, false);
  assert.deepEqual(await service.rebuildInsightPlayer("p", second), result);
  assert.equal(reads, 2);
});

test("continuous changes hit a bounded retryable continuation and retain the latest dirty token", async () => {
  let reads = 0, latest;
  const service = coalescingFixture(async evidence => { latest = await service.invalidateInsightPlayer("p", { sourceKind: "record", eventId: `new-source-${++reads}` }); return evidence; });
  await assert.rejects(service.rebuildInsightPlayer("p"), error => error.code === "aborted" && error.details.reason === "insights-rebuild-continuation-required");
  assert.equal(reads, 3);
  assert.equal(service.db.snapshot("players/p/insightSummaries/current"), undefined);
  assert.equal(service.db.snapshot("players/p/insightSummaries/state").token, latest.token);
  assert.equal(service.db.snapshot("players/p/insightSummaries/state").rebuildLease, null);
});

test("expired owner cannot publish or release its successor lease", async () => {
  let clock = NOW, reads = 0; const entered = deferred(), release = deferred();
  const service = coalescingFixture(async evidence => { if (++reads === 1) { entered.resolve(); await release.promise; } return evidence; }, () => clock);
  const abandoned = service.rebuildInsightPlayer("p");
  await entered.promise;
  clock += REBUILD_LEASE_MS + 1;
  const latest = await service.rebuildInsightPlayer("p");
  release.resolve();
  await assert.rejects(abandoned, error => error.details.reason === "insights-rebuild-lease-lost");
  assert.deepEqual(service.db.snapshot("players/p/insightSummaries/current"), latest);
  assert.equal(service.db.snapshot("players/p/insightSummaries/state").rebuildLease, null);
});

test("actual evidence failures propagate and retrying the same event does not redirty the player", async () => {
  let fail = true;
  const unavailable = Object.assign(Error("storage unavailable"), { code: 503 });
  const service = coalescingFixture(evidence => { if (fail) throw unavailable; return evidence; });
  const source = { sourceKind: "artifact", eventId: "one-generation" };
  const dirty = await service.invalidateInsightPlayer("p", source);
  await assert.rejects(service.rebuildInsightPlayer("p", source), error => error === unavailable);
  assert.equal(service.db.snapshot("players/p/insightSummaries/state").rebuildLease, null);
  assert.equal(service.db.snapshot("players/p/insightSummaries/current"), undefined);
  fail = false;
  assert.equal((await service.invalidateInsightPlayer("p", source)).invalidated, false);
  const summary = await service.rebuildInsightPlayer("p", source);
  assert.equal(summary.token, dirty.token);
});

test("lease cleanup failure cannot replace the original evidence error", async () => {
  const unavailable = Object.assign(Error("storage unavailable"), { code: 503 });
  const service = coalescingFixture(() => { throw unavailable; });
  const original = service.db.runTransaction.bind(service.db); let transactions = 0;
  service.db.runTransaction = handler => ++transactions === 2 ? Promise.reject(Error("cleanup unavailable")) : original(handler);
  await assert.rejects(service.rebuildInsightPlayer("p"), error => error === unavailable);
  assert.equal(service.db.snapshot("players/p/insightSummaries/current"), undefined);
  assert.ok(service.db.snapshot("players/p/insightSummaries/state").rebuildLease);
});

test("player deletion and deadline guards have distinct source-correlated reasons", async () => {
  const source = { sourceKind: "failure", eventId: "private-source-event" };
  const deletion = coalescingFixture(async evidence => { await deletion.db.doc("players/p").delete(); return evidence; });
  await assert.rejects(deletion.rebuildInsightPlayer("p", source), error => error.details.reason === "insights-player-deleted"
    && error.details.sourceKind === "failure" && /^[a-f0-9]{64}$/.test(error.details.sourceEventHash)
    && !JSON.stringify(error.details).includes(source.eventId));
  assert.equal((await deletion.rebuildInsightPlayer("p", source)).deleted, true);
  let clock = NOW;
  const timeout = coalescingFixture(evidence => { clock += 10 * 60000 + 1; return evidence; }, () => clock);
  await assert.rejects(timeout.rebuildInsightPlayer("p", source), error => error.details.reason === "insights-rebuild-deadline-exceeded");
  assert.equal(timeout.db.snapshot("players/p/insightSummaries/current"), undefined);
});
