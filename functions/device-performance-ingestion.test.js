"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, FieldValue } = require("./test-support/fake-firestore");
const contract = require("./device-performance-contract");
const {
  createDevicePerformanceIngestion, createIngestDevicePerformanceV1, RATE_LIMIT_ROOT, RATE_LIMITS,
} = require("./device-performance-ingestion");

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

const FIXTURES = path.join(__dirname, "contracts", "device-performance-v1", "fixtures");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
const COACH = "uidDemoCoach0001"; // attempt summaries, upload groups and transfer fixtures
const STAFF = "uidDemoStaff0002"; // run summary and device status fixtures
const COACH_ATTEMPT = "3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c";
const PREADMISSION_ATTEMPT = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const STAFF_ATTEMPT = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const RUN = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const INSTALL = "b7e2c1d4-5f6a-4b8c-9d0e-1f2a3b4c5d6e";
const BATCH_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const START = Date.parse("2026-09-29T10:00:00.000Z");
const DAY = 86400000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = (uid) => ({ uid, email: "staff@example.test", emailVerified: true, authTime: 1, isAnonymous: false });
const attemptIndex = (attemptId, reportedByUid, extra = {}) => ({
  schemaVersion: 2, scope: "attempt", reportedByUid, attemptId, playerDocumentID: "player", sequence: 1,
  manifestPath: `processing_attempts/${reportedByUid}/${attemptId}/manifest.json`, retentionState: "active", ...extra,
});
const statuses = (results) => results.map((result) => [result.status, result.errorCode]);

function harness(seed = {}) {
  let current = START;
  const db = new FakeFirestore({
    "players/player": { organizationId: "club", teamId: "team" },
    [`organizations/club/members/${COACH}`]: { userUID: COACH, status: "active", role: "coach", teamIds: ["team"] },
    [`organizations/club/members/${STAFF}`]: { userUID: STAFF, status: "active", role: "manager", teamIds: [] },
    [`processingAttempts/${COACH_ATTEMPT}`]: attemptIndex(COACH_ATTEMPT, COACH),
    [`processingAttempts/${PREADMISSION_ATTEMPT}`]: attemptIndex(PREADMISSION_ATTEMPT, COACH),
    [`processingAttempts/${STAFF_ATTEMPT}`]: attemptIndex(STAFF_ATTEMPT, STAFF),
    ...seed,
  });
  const logs = [];
  const logger = { warn: (...args) => logs.push(["warn", ...args]), error: (...args) => logs.push(["error", ...args]) };
  const api = createDevicePerformanceIngestion({ db, FieldValue, Timestamp: FakeTimestamp, HttpsError, now: () => current, logger });
  return {
    db, logs, api,
    now: () => current,
    advance(ms) { current += ms; },
    // Every response must validate against $defs/ingestResponseV1 and itemize every record.
    async ingest(records, auth, envelope = {}) {
      const response = await api.ingest({ performanceSchemaVersion: 1, batchId: BATCH_ID, records, ...envelope }, auth);
      const check = contract.validateSchema("#/$defs/ingestResponseV1", response);
      assert.ok(check.valid, check.errors.join("; "));
      assert.equal(response.batchId, BATCH_ID);
      assert.deepEqual(response.results.map((result) => result.index), records.map((_, index) => index));
      return response.results;
    },
    doc: (kind, id) => db.snapshot(`${contract.ROOTS[kind]}/${kind}:${id}`),
    factPaths: () => [...db.docs.keys()].filter((key) => key.startsWith("devicePerformance") && !key.startsWith(RATE_LIMIT_ROOT)).sort(),
    ratePaths: () => [...db.docs.keys()].filter((key) => key.startsWith(RATE_LIMIT_ROOT)),
  };
}
// Server timestamps follow the harness clock inside the callback.
async function withServerClock(h, callback) {
  const previous = FakeTimestamp.clock;
  FakeTimestamp.clock = () => h.now();
  try { return await callback(); } finally { FakeTimestamp.clock = previous; }
}
const run = (overrides = {}) => ({ ...fixture("run-summary.valid.json"), ...overrides });
const runWithBody = (overrides, body) => { const record = run(overrides); record.body = { ...record.body, ...body }; return record; };
const attempt = (overrides = {}) => ({ ...fixture("attempt-summary.valid.json"), ...overrides });
const FAILURE = { code: "decode_failed", stage: "kick.extract", disposition: "retryable", layer: "decoder" };

test("every valid field fact is stored once, under its contract root and document id", async () => {
  const h = harness();
  const coachRecords = ["attempt-summary.valid.json", "attempt-summary-pre-admission-failure.valid.json", "upload-group-summary.valid.json",
    "upload-group-summary-video-unavailable.valid.json", "transfer-invocation.valid.json"].map(fixture);
  const staffRecords = [fixture("run-summary.valid.json"), fixture("device-status.valid.json")];
  const coachResults = await h.ingest(coachRecords, actor(COACH));
  const staffResults = await h.ingest(staffRecords, actor(STAFF));
  const records = [...coachRecords, ...staffRecords];
  [...coachResults, ...staffResults].forEach((result, index) => {
    const record = records[index];
    assert.deepEqual({ ...result, index: 0 }, {
      index: 0, recordKind: record.recordKind, recordId: record.recordId, revision: record.revision, status: "accepted",
      retryable: false, acceptedRevision: record.revision, digest: contract.digest(record), errorCode: null,
    });
  });
  assert.deepEqual(h.factPaths(), records.map((record) => `${contract.ROOTS[record.recordKind]}/${record.recordKind}:${record.recordId}`).sort());
  assert.deepEqual(h.factPaths().map((key) => key.split("/")[0]).filter((root, i, all) => all.indexOf(root) === i).sort(),
    ["devicePerformanceAttempts", "devicePerformanceDevices", "devicePerformanceRuns", "devicePerformanceTransfers", "devicePerformanceUploadGroups"]);
  for (const record of records) {
    const stored = h.doc(record.recordKind, record.recordId);
    assert.deepEqual(stored.record, record, "the client record is stored verbatim");
    assert.equal(stored.revision, record.revision);
    assert.equal(stored.digest, contract.digest(record));
    assert.equal(stored.encodedBytes, contract.encodedBytes(record));
    assert.ok(stored.firstReceivedAtServer instanceof FakeTimestamp && stored.updatedAtServer instanceof FakeTimestamp);
    const days = record.recordKind === "transferInvocation" ? 30 : 90;
    assert.equal(stored.expiresAt.toMillis(), START + days * DAY, record.recordKind);
  }
  assert.deepEqual(h.doc("runSummary", RUN).authority, { basis: "processingAttempt", reporterUid: STAFF, attemptId: STAFF_ATTEMPT, playerDocumentID: "player" });
  assert.deepEqual(h.doc("deviceStatus", INSTALL).authority, { basis: "reporter", reporterUid: STAFF, attemptId: null, playerDocumentID: null });
  assert.equal(h.logs.length, 0);
});

test("evaluation traffic is refused permanently and never reaches any fleet root", async () => {
  const h = harness();
  const evaluation = { ...fixture("run-summary-evaluation-origin.valid.json"), originReporterUid: STAFF };
  const results = await h.ingest([evaluation], actor(STAFF));
  assert.deepEqual(results[0], {
    index: 0, recordKind: "runSummary", recordId: evaluation.recordId, revision: evaluation.revision, status: "rejected",
    retryable: false, acceptedRevision: null, digest: contract.digest(evaluation), errorCode: "evaluationOriginRejected",
  });
  assert.deepEqual(h.factPaths(), []);
  assert.deepEqual(h.ratePaths(), [], "a refused-only batch does no Firestore work");
});

test("one bad record never blocks the others: every item gets its own typed result", async () => {
  const h = harness();
  const records = [
    run(),
    fixture("run-summary-negative-duration.invalid.json"),
    fixture("run-summary-oversized.invalid.json"),
    { ...fixture("run-summary-evaluation-origin.valid.json"), originReporterUid: STAFF },
    run({ performanceSchemaVersion: 2, recordId: uuid(2), processingRunId: uuid(2) }),
    run({ recordId: STAFF_ATTEMPT }),
    run({ originReporterUid: COACH, recordId: uuid(3), processingRunId: uuid(3) }),
    run({ attemptId: uuid(9), recordId: uuid(4), processingRunId: uuid(4) }),
    "not a record",
  ];
  const results = await h.ingest(records, actor(STAFF));
  assert.deepEqual(statuses(results), [
    ["accepted", null], ["rejected", "invalidSchema"], ["rejected", "oversizedRecord"], ["rejected", "evaluationOriginRejected"],
    ["retryLater", "unsupportedVersion"], ["rejected", "identityMismatch"], ["rejected", "unauthorizedReporter"],
    ["retryLater", "dependencyPending"], ["rejected", "invalidSchema"],
  ]);
  assert.deepEqual(results.map((result) => result.retryable), [false, false, false, false, true, false, false, true, false]);
  assert.deepEqual(results[8], { index: 8, recordKind: null, recordId: null, revision: null, status: "rejected", retryable: false,
    acceptedRevision: null, digest: null, errorCode: "invalidSchema" });
  assert.deepEqual(h.factPaths(), [`devicePerformanceRuns/runSummary:${RUN}`]);
  // Refusals are logged by error path only, never by value.
  const warnings = h.logs.filter(([level]) => level === "warn").map(([, , detail]) => detail.errorCode).sort();
  assert.deepEqual(warnings, ["identityMismatch", "invalidSchema", "invalidSchema", "oversizedRecord"]);
});

test("a missing attempt index is a retryable pending dependency, never a forged identity", async () => {
  const h = harness();
  const pendingAttempt = uuid(7);
  const record = run({ attemptId: pendingAttempt, recordId: uuid(8), processingRunId: uuid(8) });
  const first = await h.ingest([record], actor(STAFF));
  assert.deepEqual(first[0], { index: 0, recordKind: "runSummary", recordId: uuid(8), revision: 1, status: "retryLater", retryable: true,
    acceptedRevision: null, digest: contract.digest(record), errorCode: "dependencyPending" });
  assert.deepEqual(h.factPaths(), []);
  await h.db.doc(`processingAttempts/${pendingAttempt}`).set(attemptIndex(pendingAttempt, STAFF));
  assert.deepEqual(statuses(await h.ingest([record], actor(STAFF))), [["accepted", null]]);
});

test("only the attempt's original reporter, with current athlete access, may report its facts", async () => {
  const h = harness({
    [`processingAttempts/${uuid(20)}`]: attemptIndex(uuid(20), STAFF, { scope: "actor" }),
    [`processingAttempts/${uuid(21)}`]: attemptIndex(uuid(21), STAFF, { schemaVersion: 1 }),
    [`processingAttempts/${uuid(22)}`]: attemptIndex(uuid(22), STAFF, { retentionState: "expired" }),
    [`processingAttempts/${uuid(23)}`]: attemptIndex(uuid(23), STAFF, { playerDocumentID: "someoneElse" }),
    "players/someoneElse": { organizationId: "otherClub", teamId: "team" },
  });
  const under = (attemptId, n) => run({ attemptId, recordId: uuid(100 + n), processingRunId: uuid(100 + n) });
  const results = await h.ingest([
    under(COACH_ATTEMPT, 1), // the coach reported this attempt
    run({ originReporterUid: COACH }), // the fact claims another reporter
    under(uuid(20), 2), // an actor-scoped diagnostic is not an attempt
    under(uuid(21), 3), // pre-schema-2 index cannot bind a reporter
    under(uuid(22), 4), // artifact expiry never invalidates an authorized identity
    under(uuid(23), 5), // reporter without current access to the athlete
  ], actor(STAFF));
  assert.deepEqual(statuses(results), [["rejected", "unauthorizedReporter"], ["rejected", "unauthorizedReporter"],
    ["rejected", "identityMismatch"], ["rejected", "unauthorizedReporter"], ["accepted", null], ["rejected", "unauthorizedReporter"]]);
  // Revoked club membership takes effect on the next delivery (shared diagnostics helper).
  assert.deepEqual(statuses(await h.ingest([run()], actor(STAFF))), [["accepted", null]]);
  await h.db.doc(`organizations/club/members/${STAFF}`).update({ status: "revoked" });
  const revised = runWithBody({ revision: 2, completeness: "partial" }, {});
  assert.deepEqual(statuses(await h.ingest([revised], actor(STAFF))), [["rejected", "unauthorizedReporter"]]);
  assert.equal(h.doc("runSummary", RUN).revision, 1);
  // A verified @posetek.net admin passes the athlete check, but still only for attempts they reported.
  const admin = { uid: "adminUid", email: "ops@posetek.net", emailVerified: true, isAnonymous: false };
  await h.db.doc(`processingAttempts/${uuid(30)}`).set(attemptIndex(uuid(30), "adminUid"));
  const adminRecord = run({ attemptId: uuid(30), recordId: uuid(31), processingRunId: uuid(31), originReporterUid: "adminUid" });
  assert.deepEqual(statuses(await h.ingest([adminRecord, { ...run(), originReporterUid: "adminUid" }], admin)),
    [["accepted", null], ["rejected", "unauthorizedReporter"]]);
});

test("anonymous and unregistered callers are refused before any work", async () => {
  const h = harness();
  const batch = { performanceSchemaVersion: 1, batchId: BATCH_ID, records: [run()] };
  for (const auth of [undefined, null, {}, { uid: STAFF, isAnonymous: true }, { uid: "a/b" }, { uid: "diagnostics" }]) {
    await assert.rejects(h.api.ingest(batch, auth), { code: "permission-denied" });
  }
  assert.equal([...h.db.docs.keys()].filter((key) => key.startsWith("devicePerformance")).length, 0);
});

test("identical replays are acknowledged as duplicates without a write", async () => {
  const h = harness();
  await withServerClock(h, async () => {
    const record = run();
    assert.deepEqual(statuses(await h.ingest([record], actor(STAFF))), [["accepted", null]]);
    const before = h.doc("runSummary", RUN);
    h.advance(60000);
    const reordered = JSON.parse(JSON.stringify(record, (key, value) => (contract.isPlainObject(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value)));
    const replays = await h.ingest([record, reordered], actor(STAFF));
    for (const result of replays) {
      assert.deepEqual(result, { ...result, status: "duplicate", retryable: false, acceptedRevision: 1, digest: contract.digest(record), errorCode: null });
    }
    assert.deepEqual(h.doc("runSummary", RUN), before, "a duplicate never rewrites the stored fact");
  });
});

test("the same revision with different content is a permanent conflict", async () => {
  const h = harness();
  await h.ingest([run()], actor(STAFF));
  const changed = runWithBody({}, { totals: { ...run().body.totals, processingMs: 17000 } });
  const [result] = await h.ingest([changed], actor(STAFF));
  assert.deepEqual(result, { index: 0, recordKind: "runSummary", recordId: RUN, revision: 1, status: "conflict", retryable: false,
    acceptedRevision: 1, digest: contract.digest(changed), errorCode: "revisionConflict" });
  assert.equal(h.doc("runSummary", RUN).digest, contract.digest(run()));
});

test("higher revisions supersede, late lower revisions are acknowledged and never applied, first receipt never resets", async () => {
  const h = harness();
  await withServerClock(h, async () => {
    const revision = (n) => { const record = attempt({ revision: n }); record.body = { ...record.body, lifecycleTransitionCount: n }; return record; };
    assert.deepEqual(statuses(await h.ingest([revision(1)], actor(COACH))), [["accepted", null]]);
    const first = h.doc("attemptSummary", COACH_ATTEMPT);
    h.advance(5 * 60000);
    const results = await h.ingest([revision(3), revision(2), revision(1), revision(3)], actor(COACH));
    assert.deepEqual(statuses(results), [["accepted", null], ["superseded", "staleRevision"], ["superseded", "staleRevision"], ["duplicate", null]]);
    assert.deepEqual(results.map((result) => result.acceptedRevision), [3, 3, 3, 3]);
    assert.deepEqual(results.map((result) => result.retryable), [false, false, false, false]);
    const stored = h.doc("attemptSummary", COACH_ATTEMPT);
    assert.equal(stored.revision, 3);
    assert.equal(stored.record.body.lifecycleTransitionCount, 3);
    assert.equal(stored.firstReceivedAtServer.toMillis(), first.firstReceivedAtServer.toMillis());
    assert.equal(stored.updatedAtServer.toMillis(), START + 5 * 60000);
    assert.equal(stored.expiresAt.toMillis(), START + 5 * 60000 + 90 * DAY, "retention follows the latest accepted write");
  });
  // Offline reordering on another entity: 3, 1, 2 settles to 3.
  const other = (n) => attempt({ revision: n, recordId: PREADMISSION_ATTEMPT, attemptId: PREADMISSION_ATTEMPT });
  assert.deepEqual(statuses(await h.ingest([other(3), other(1), other(2)], actor(COACH))),
    [["accepted", null], ["superseded", "staleRevision"], ["superseded", "staleRevision"]]);
  assert.equal(h.doc("attemptSummary", PREADMISSION_ATTEMPT).revision, 3);
});

test("terminal run outcomes are immutable, and a retry's success never replaces a failed run", async () => {
  const h = harness();
  const failed = runWithBody({}, { outcome: "failed", failure: FAILURE });
  assert.deepEqual(statuses(await h.ingest([failed], actor(STAFF))), [["accepted", null]]);
  const stages = failed.body.stages.map((stage, index) => (index === 0 ? { ...stage, elapsedMs: 3 } : stage));
  const results = await h.ingest([
    runWithBody({ revision: 2 }, { outcome: "valid", failure: null }),
    runWithBody({ revision: 2 }, { outcome: "failed", failure: { ...FAILURE, code: "model_failed" } }),
    runWithBody({ revision: 2 }, { outcome: "failed", failure: FAILURE, stages }),
    runWithBody({ revision: 2, completeness: "partial" }, { outcome: "failed", failure: FAILURE, totals: { ...failed.body.totals, journalFinalizeMs: 12 } }),
  ], actor(STAFF));
  assert.deepEqual(statuses(results), [["rejected", "illegalTransition"], ["rejected", "illegalTransition"], ["rejected", "illegalTransition"], ["accepted", null]]);
  assert.deepEqual(results.map((result) => result.acceptedRevision), [1, 1, 1, 2]);
  // The retry is a new run id with retry lineage; the failed run keeps its outcome.
  const retry = run({ recordId: uuid(50), processingRunId: uuid(50), retryOfRunId: RUN });
  assert.deepEqual(statuses(await h.ingest([retry], actor(STAFF))), [["accepted", null]]);
  assert.equal(h.doc("runSummary", RUN).record.body.outcome, "failed");
  assert.equal(h.doc("runSummary", uuid(50)).record.body.outcome, "valid");
  // interruptedUnknown is not terminal: it may resolve once, then it is fixed.
  const interrupted = (revision, outcome) => runWithBody({ revision, recordId: uuid(60), processingRunId: uuid(60) },
    { outcome, failure: outcome === "failed" ? FAILURE : null });
  assert.deepEqual(statuses(await h.ingest([interrupted(1, "interruptedUnknown"), interrupted(2, "failed"), interrupted(3, "valid")], actor(STAFF))),
    [["accepted", null], ["accepted", null], ["rejected", "illegalTransition"]]);
});

test("an entity's identity cannot be taken over or rewritten by a later revision", async () => {
  const h = harness({ [`processingAttempts/${uuid(70)}`]: attemptIndex(uuid(70), STAFF) });
  await h.ingest([run(), fixture("device-status.valid.json")], actor(STAFF));
  const moved = run({ revision: 2, attemptId: uuid(70) });
  const relinked = run({ revision: 2, retryOfRunId: uuid(71) });
  assert.deepEqual(statuses(await h.ingest([moved, relinked], actor(STAFF))), [["rejected", "identityMismatch"], ["rejected", "identityMismatch"]]);
  assert.equal(h.doc("runSummary", RUN).revision, 1);
  // Another account cannot overwrite an install's status: the install id is not authority.
  const hijack = { ...fixture("device-status.valid.json"), revision: 42, originReporterUid: COACH };
  const [takeover] = await h.ingest([hijack], actor(COACH));
  assert.deepEqual([takeover.status, takeover.errorCode, takeover.acceptedRevision], ["rejected", "identityMismatch", 41]);
  assert.equal(h.doc("deviceStatus", INSTALL).record.originReporterUid, STAFF);
  // Origin facts: unknown may be filled in once, never rewritten.
  const origin = fixture("attempt-summary.valid.json").originPlatform;
  const results = await h.ingest([
    attempt({ revision: 1, originPlatform: null }),
    attempt({ revision: 2, originPlatform: origin }),
    attempt({ revision: 3, originPlatform: { ...origin, build: "213" } }),
    attempt({ revision: 3, originInstallId: uuid(72) }),
    attempt({ revision: 3, captureOccurredAtClient: "2026-09-29T08:15:31.000Z" }),
  ], actor(COACH));
  assert.deepEqual(statuses(results), [["accepted", null], ["accepted", null], ["rejected", "identityMismatch"],
    ["rejected", "identityMismatch"], ["rejected", "identityMismatch"]]);
  // Only a run's lineage is fixed; an attempt summary may name a later retry run.
  assert.deepEqual(statuses(await h.ingest([attempt({ revision: 4, originPlatform: origin, processingRunId: uuid(73), retryOfRunId: RUN })], actor(COACH))),
    [["accepted", null]]);
});

test("an oversized batch keeps each within-limit record pending for a smaller batch", async () => {
  const h = harness();
  const big = (n) => runWithBody({ recordId: uuid(200 + n), processingRunId: uuid(200 + n) }, {
    stages: Array.from({ length: 25 }, (_, i) => ({ ...run().body.stages[0], stageId: `s${i}${"x".repeat(80)}`, lastDurableStage: `s${i}${"y".repeat(80)}` })),
  });
  const records = [...Array.from({ length: 11 }, (_, n) => big(n)), fixture("run-summary-oversized.invalid.json")];
  assert.ok(records.slice(0, 11).every((record) => contract.encodedBytes(record) <= contract.LIMITS.recordBytes));
  assert.ok(records.slice(0, 11).reduce((sum, record) => sum + contract.encodedBytes(record), 0) > contract.LIMITS.batchBytes);
  const results = await h.ingest(records, actor(STAFF));
  assert.deepEqual(statuses(results), [...Array(11).fill(["retryLater", "oversizedBatch"]), ["rejected", "oversizedRecord"]]);
  assert.ok(results.slice(0, 11).every((result) => result.retryable && result.digest));
  assert.deepEqual(h.factPaths(), []);
  assert.deepEqual(h.ratePaths(), []);
  assert.deepEqual(statuses(await h.ingest(records.slice(0, 5), actor(STAFF))), Array(5).fill(["accepted", null]));
});

test("more than 16 records or a malformed envelope is refused without rejecting any record", async () => {
  const h = harness();
  const cases = [
    [{ performanceSchemaVersion: 1, batchId: BATCH_ID, records: Array.from({ length: 17 }, () => run()) }, "oversizedBatch"],
    [{ performanceSchemaVersion: 1, batchId: "not-a-uuid", records: [run()] }, "invalidSchema"],
    [{ performanceSchemaVersion: 1, batchId: BATCH_ID, records: [] }, "invalidSchema"],
    [{ performanceSchemaVersion: 1, batchId: BATCH_ID, records: [run()], signedUrl: "x" }, "invalidSchema"],
    [null, "invalidSchema"],
  ];
  for (const [data, errorCode] of cases) {
    await assert.rejects(h.api.ingest(data, actor(STAFF)), (error) => error.code === "invalid-argument" && error.details?.errorCode === errorCode);
  }
  assert.deepEqual([...h.db.docs.keys()].filter((key) => key.startsWith("devicePerformance")), []);
});

test("a newer batch version keeps every record pending", async () => {
  const h = harness();
  const results = await h.ingest([run(), "anything"], actor(STAFF), { performanceSchemaVersion: 2, capabilities: ["future"] });
  assert.deepEqual(statuses(results), [["retryLater", "unsupportedVersion"], ["retryLater", "unsupportedVersion"]]);
  assert.deepEqual(results.map((result) => result.retryable), [true, true]);
  assert.equal(results[0].digest, contract.digest(run()));
  assert.deepEqual([...h.db.docs.keys()].filter((key) => key.startsWith("devicePerformance")), []);
});

test("rate limits bound calls per executing install and per caller, per minute", async () => {
  const h = harness();
  const status = (revision, executorInstallId = INSTALL) => ({ ...fixture("device-status.valid.json"), revision, executorInstallId, recordId: executorInstallId });
  for (let call = 0; call < RATE_LIMITS.callsPerInstall; call++) {
    assert.deepEqual(statuses(await h.ingest([status(100 + call)], actor(STAFF))), [["accepted", null]]);
  }
  const [limited] = await h.ingest([status(500)], actor(STAFF));
  assert.deepEqual([limited.status, limited.errorCode, limited.retryable, limited.acceptedRevision], ["retryLater", "rateLimited", true, null]);
  assert.equal(h.doc("deviceStatus", INSTALL).revision, 100 + RATE_LIMITS.callsPerInstall - 1);
  // A batch the validator refuses outright needs no Firestore work and is answered.
  assert.deepEqual(statuses(await h.ingest([fixture("run-summary-negative-duration.invalid.json")], actor(STAFF))), [["rejected", "invalidSchema"]]);
  // Other installs still report until the caller's own bound.
  let accepted = RATE_LIMITS.callsPerInstall;
  for (let n = 1; accepted < RATE_LIMITS.callsPerCaller; n++, accepted++) {
    assert.deepEqual(statuses(await h.ingest([status(1, uuid(1000 + n))], actor(STAFF))), [["accepted", null]]);
  }
  assert.deepEqual(statuses(await h.ingest([status(1, uuid(5000))], actor(STAFF))), [["retryLater", "rateLimited"]]);
  // Another caller is independent; the next window resets both bounds.
  assert.deepEqual(statuses(await h.ingest([attempt({ executorInstallId: uuid(6000) })], actor(COACH))), [["accepted", null]]);
  h.advance(RATE_LIMITS.windowMs);
  assert.deepEqual(statuses(await h.ingest([status(500)], actor(STAFF))), [["accepted", null]]);
  const rate = h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}`);
  assert.equal(rate.count, 1);
  assert.equal(rate.expiresAt.toMillis(), h.now() + DAY);
});

test("concurrent deliveries settle to exactly one stored revision", async () => {
  const h = harness();
  const pair = await Promise.all([h.ingest([run()], actor(STAFF)), h.ingest([run()], actor(STAFF))]);
  assert.deepEqual(pair.map((results) => results[0].status).sort(), ["accepted", "duplicate"]);
  const later = (revision) => runWithBody({ revision }, { totals: { ...run().body.totals, journalFinalizeMs: revision } });
  const race = await Promise.all([h.ingest([later(3)], actor(STAFF)), h.ingest([later(2)], actor(STAFF)), h.ingest([later(3)], actor(STAFF))]);
  assert.equal(h.doc("runSummary", RUN).revision, 3);
  assert.equal(h.doc("runSummary", RUN).record.body.totals.journalFinalizeMs, 3);
  const outcomes = race.map((results) => results[0].status);
  assert.equal(outcomes.filter((value) => value === "accepted").length >= 1, true);
  assert.ok(outcomes.every((value) => ["accepted", "duplicate", "superseded"].includes(value)));
});

test("an internal failure is itemized as retryable and the other records still land", async () => {
  const h = harness({ [`processingAttempts/${uuid(80)}`]: attemptIndex(uuid(80), STAFF) });
  const original = h.db.doc.bind(h.db);
  h.db.doc = (docPath) => (docPath === `processingAttempts/${uuid(80)}` ? { get: async () => { throw new Error("UNAVAILABLE"); } } : original(docPath));
  const broken = run({ attemptId: uuid(80), recordId: uuid(81), processingRunId: uuid(81) });
  const results = await h.ingest([broken, run()], actor(STAFF));
  assert.deepEqual(statuses(results), [["retryLater", "internal"], ["accepted", null]]);
  assert.equal(results[0].retryable, true);
  assert.equal(h.logs.filter(([level]) => level === "error").length, 1);
});

test("a client date in the future is marked by the server without touching the client record", async () => {
  const h = harness();
  const future = new Date(START + 60 * 60000).toISOString();
  const near = new Date(START + 60000).toISOString();
  assert.deepEqual(statuses(await h.ingest([run({ occurredAtClient: future })], actor(STAFF))), [["accepted", null]]);
  assert.deepEqual(statuses(await h.ingest([attempt({ occurredAtClient: near })], actor(COACH))), [["accepted", null]]);
  assert.equal(h.doc("runSummary", RUN).serverClockQuality, "future");
  assert.equal(h.doc("runSummary", RUN).record.clockQuality, "reliable");
  assert.equal(h.doc("attemptSummary", COACH_ATTEMPT).serverClockQuality, "reliable");
});

test("the callable is an explicit 1st-gen export: 512MB, 120 s, default region, requireCaller, no App Check enforcement", async () => {
  const db = new FakeFirestore({
    "players/player": { organizationId: "club", teamId: "team" },
    [`organizations/club/members/${STAFF}`]: { userUID: STAFF, status: "active", role: "manager", teamIds: [] },
    [`processingAttempts/${STAFF_ATTEMPT}`]: attemptIndex(STAFF_ATTEMPT, STAFF),
  });
  const runWith = [];
  const functions = {
    https: { HttpsError, onCall: () => { throw new Error("runWith is required"); } },
    region: () => { throw new Error("the codebase uses the default region"); },
    runWith(options) { runWith.push(options); return { https: { onCall: (handler) => ({ handler }) } }; },
  };
  const admin = { firestore: Object.assign(() => db, { FieldValue, Timestamp: FakeTimestamp }) };
  const requireCaller = (context) => {
    if (!context.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
    return { uid: context.auth.uid, email: null, emailVerified: false, isAnonymous: false };
  };
  const exported = createIngestDevicePerformanceV1(functions, admin, requireCaller);
  assert.deepEqual(runWith, [{ timeoutSeconds: 120, memory: "512MB" }]);
  const batch = { performanceSchemaVersion: 1, batchId: BATCH_ID, records: [run()] };
  // firebase-functions wraps the handler, so a synchronous requireCaller throw becomes the callable error.
  await assert.rejects(async () => exported.handler(batch, {}), { code: "unauthenticated" });
  const response = await exported.handler(batch, { auth: { uid: STAFF } });
  assert.deepEqual(statuses(response.results), [["accepted", null]]);
  const index = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  const wiring = index.split("\n").filter((line) => line.includes("device-performance-ingestion"));
  assert.deepEqual(wiring, ["exports.ingestDevicePerformanceV1 = require(\"./device-performance-ingestion\").createIngestDevicePerformanceV1(functions, admin, requireCaller);"]);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "device-performance-ingestion.js"), "utf8"), /enforceAppCheck|consumeAppCheckToken/);
});
