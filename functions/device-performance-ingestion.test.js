"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, FieldValue } = require("./test-support/fake-firestore");
const contract = require("./device-performance-contract");
const {
  createDevicePerformanceIngestion, createIngestDevicePerformanceV1, storageKey, RATE_LIMIT_ROOT, RATE_LIMITS, ATTEMPT_CAPS, ATTEMPT_CAP_WIRE_CODE,
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
    stored: (record) => db.snapshot(`${contract.ROOTS[record.recordKind]}/${storageKey(record)}`),
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
    "upload-group-summary-video-unavailable.valid.json", "upload-group-summary-system.valid.json", "transfer-invocation.valid.json"].map(fixture);
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
  assert.deepEqual(h.factPaths(), records.map((record) => `${contract.ROOTS[record.recordKind]}/${storageKey(record)}`).sort());
  assert.ok(h.factPaths().includes(`devicePerformanceUploadGroups/uploadGroupSummary:system:diagnostics:${INSTALL}:${INSTALL}:${COACH}`),
    "a system group keeps the composite transition key (contract §8.6)");
  assert.ok(h.factPaths().includes(`devicePerformanceDevices/deviceStatus:${INSTALL}:${STAFF}`), "one device status per install and account");
  assert.deepEqual(h.factPaths().map((key) => key.split("/")[0]).filter((root, i, all) => all.indexOf(root) === i).sort(),
    ["devicePerformanceAttempts", "devicePerformanceDevices", "devicePerformanceRuns", "devicePerformanceTransfers", "devicePerformanceUploadGroups"]);
  for (const record of records) {
    const stored = h.stored(record);
    assert.deepEqual(stored.record, record, "the client record is stored verbatim");
    assert.equal(stored.revision, record.revision);
    assert.equal(stored.digest, contract.digest(record));
    assert.equal(stored.encodedBytes, contract.encodedBytes(record));
    assert.ok(stored.firstReceivedAtServer instanceof FakeTimestamp && stored.updatedAtServer instanceof FakeTimestamp);
    const days = record.recordKind === "transferInvocation" ? 30 : 90;
    assert.equal(stored.expiresAt.toMillis(), START + days * DAY, record.recordKind);
  }
  assert.deepEqual(h.doc("runSummary", RUN).authority, { basis: "processingAttempt", reporterUid: STAFF, attemptId: STAFF_ATTEMPT, playerDocumentID: "player" });
  assert.deepEqual(h.doc("deviceStatus", `${INSTALL}:${STAFF}`).authority, { basis: "reporter", reporterUid: STAFF, attemptId: null, playerDocumentID: null });
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
  // An exact replay of an accepted revision stays acknowledged: it is answered before access is re-checked (D-21 F6).
  assert.deepEqual(statuses(await h.ingest([run()], actor(STAFF))), [["duplicate", null]]);
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

test("a terminal run is frozen apart from its post-terminal allowlist, and a retry's success never replaces a failed run", async () => {
  const h = harness();
  const failed = runWithBody({}, { outcome: "failed", failure: FAILURE });
  assert.deepEqual(statuses(await h.ingest([failed], actor(STAFF))), [["accepted", null]]);
  const { totals, resources, stages } = failed.body;
  const later = (envelope, body = {}) => runWithBody({ revision: 2, ...envelope }, { outcome: "failed", failure: FAILURE, ...body });
  // Every measurement and every attribution field is frozen from the first terminal revision (D-21 F2).
  const frozen = [
    ["outcome", runWithBody({ revision: 2 }, { outcome: "valid", failure: null })],
    ["failure", later({}, { failure: { ...FAILURE, code: "model_failed" } })],
    ["stages", later({}, { stages: stages.map((stage, index) => (index === 0 ? { ...stage, elapsedMs: 3 } : stage)) })],
    // Inverted: a post-terminal change to a measurement total used to be accepted; it is refused.
    ["totals.processingMs", later({ completeness: "partial" }, { totals: { ...totals, processingMs: 1, journalFinalizeMs: 12 } })],
    ["totals.framesDecoded", later({}, { totals: { ...totals, framesDecoded: 1 } })],
    ["totals.admissionWaitMs", later({}, { totals: { ...totals, admissionWaitMs: 99 } })],
    ["passIds", later({}, { passIds: ["kick.extract"] })],
    ["resources.admitted", later({}, { resources: { ...resources, admitted: null } })],
    ["resources.sampledPeakBytes", later({}, { resources: { ...resources, sampledPeakBytes: 1 } })],
    ["poseDelegateActual", later({}, { poseDelegateActual: "gpu" })],
    ["yoloComputeUnits", later({}, { yoloComputeUnits: "cpuOnly" })],
    ["modelCacheState", later({}, { modelCacheState: "cold" })],
    ["priority", later({}, { priority: "recovery" })],
    ["executorInstallId", later({ executorInstallId: uuid(55) })],
    ["executionLaunchId", later({ executionLaunchId: "ABCDEF01-2345-4678-89AB-CDEF01234567" })],
    ["executorPlatform", later({ executorPlatform: { ...failed.executorPlatform, build: "999" } })],
    ["policyVersion", later({ policyVersion: { ...failed.policyVersion, id: "other-policy" } })],
    ["modelFingerprint", later({ modelFingerprint: "f".repeat(64) })],
    ["captureFingerprint", later({ captureFingerprint: "f".repeat(64) })],
    ["processingMode", later({ processingMode: "recovery" })],
    ["drillType", later({ drillType: "sprint" })],
    ["occurredAtClient", later({ occurredAtClient: "2026-09-29T08:20:00.000Z" })],
    ["clockQuality", later({ clockQuality: "uncertain" })],
  ];
  for (let start = 0; start < frozen.length; start += 8) {
    const chunk = frozen.slice(start, start + 8);
    const results = await h.ingest(chunk.map(([, record]) => record), actor(STAFF));
    chunk.forEach(([label], index) => assert.deepEqual([results[index].status, results[index].errorCode, results[index].acceptedRevision],
      ["rejected", "illegalTransition", 1], label));
  }
  assert.equal(h.doc("runSummary", RUN).revision, 1);
  // Only the allowlist may change after the terminal revision.
  const allowed = runWithBody(
    { revision: 2, completeness: "partial", droppedDetailCount: 2, missingReasons: [{ field: "/totals/journalFinalizeMs", reason: "interrupted" }] },
    { outcome: "failed", failure: FAILURE, totals: { ...totals, journalFinalizeMs: null }, resources: { ...resources, released: null } });
  assert.deepEqual(statuses(await h.ingest([allowed], actor(STAFF))), [["accepted", null]]);
  assert.equal(h.doc("runSummary", RUN).record.body.totals.processingMs, totals.processingMs);
  // The retry is a new run id with retry lineage; the failed run keeps its outcome.
  const retry = run({ recordId: uuid(50), processingRunId: uuid(50), retryOfRunId: RUN });
  assert.deepEqual(statuses(await h.ingest([retry], actor(STAFF))), [["accepted", null]]);
  assert.equal(h.doc("runSummary", RUN).record.body.outcome, "failed");
  assert.equal(h.doc("runSummary", uuid(50)).record.body.outcome, "valid");
  // interruptedUnknown is not terminal: while it stays interruptedUnknown any field may be revised; the
  // first terminal revision may still change everything; from then on the run is frozen.
  const interrupted = (revision, outcome, body = {}) => runWithBody({ revision, recordId: uuid(60), processingRunId: uuid(60) },
    { outcome, failure: outcome === "failed" ? FAILURE : null, ...body });
  assert.deepEqual(statuses(await h.ingest([
    interrupted(1, "interruptedUnknown"),
    interrupted(2, "interruptedUnknown", { totals: { ...totals, processingMs: 5 } }),
    interrupted(3, "failed", { totals: { ...totals, processingMs: 6 } }),
    interrupted(4, "failed", { totals: { ...totals, processingMs: 7 } }),
    interrupted(4, "valid"),
  ], actor(STAFF))), [["accepted", null], ["accepted", null], ["accepted", null], ["rejected", "illegalTransition"], ["rejected", "illegalTransition"]]);
});

test("an entity's identity cannot be taken over or rewritten by a later revision", async () => {
  const h = harness({ [`processingAttempts/${uuid(70)}`]: attemptIndex(uuid(70), STAFF) });
  await h.ingest([run(), fixture("device-status.valid.json")], actor(STAFF));
  const moved = run({ revision: 2, attemptId: uuid(70) });
  const relinked = run({ revision: 2, retryOfRunId: uuid(71) });
  const mismatches = await h.ingest([moved, relinked], actor(STAFF));
  assert.deepEqual(statuses(mismatches), [["rejected", "identityMismatch"], ["rejected", "identityMismatch"]]);
  assert.deepEqual(mismatches.map((result) => result.acceptedRevision), [null, null]);
  assert.equal(h.doc("runSummary", RUN).revision, 1);
  // Another account cannot overwrite an install's status: the install id is not authority, the
  // id names its account (v1.2, D-18), and the refusal reveals no stored revision (D-21 F5).
  const hijack = { ...fixture("device-status.valid.json"), revision: 42, originReporterUid: COACH };
  const [takeover] = await h.ingest([hijack], actor(COACH));
  assert.deepEqual([takeover.status, takeover.errorCode, takeover.acceptedRevision], ["rejected", "identityMismatch", null]);
  assert.equal(h.doc("deviceStatus", `${INSTALL}:${STAFF}`).record.originReporterUid, STAFF);
  // A second account on the same (shared Station) phone reports its own status, which the
  // projection merges per install; the first account's status is untouched (D-18).
  const shared = { ...fixture("device-status.valid.json"), revision: 1, originReporterUid: COACH, recordId: `${INSTALL}:${COACH}` };
  assert.deepEqual(statuses(await h.ingest([shared], actor(COACH))), [["accepted", null]]);
  assert.equal(h.doc("deviceStatus", `${INSTALL}:${COACH}`).record.originReporterUid, COACH);
  assert.equal(h.doc("deviceStatus", `${INSTALL}:${STAFF}`).revision, 41);
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

test("rate limits bound calls per caller first, then per executing install, per minute", async () => {
  const h = harness();
  const status = (revision, executorInstallId = INSTALL, reporter = STAFF) => ({
    ...fixture("device-status.valid.json"), revision, executorInstallId, originReporterUid: reporter, recordId: `${executorInstallId}:${reporter}`,
  });
  for (let call = 0; call < RATE_LIMITS.callsPerInstall; call++) {
    assert.deepEqual(statuses(await h.ingest([status(100 + call)], actor(STAFF))), [["accepted", null]]);
  }
  const [limited] = await h.ingest([status(500)], actor(STAFF));
  assert.deepEqual([limited.status, limited.errorCode, limited.retryable, limited.acceptedRevision], ["retryLater", "rateLimited", true, null]);
  assert.equal(h.doc("deviceStatus", `${INSTALL}:${STAFF}`).revision, 100 + RATE_LIMITS.callsPerInstall - 1);
  // The install counter is per account (D-23): another account on the same phone keeps its own budget.
  assert.deepEqual(statuses(await h.ingest([status(1, INSTALL, COACH)], actor(COACH))), [["accepted", null]]);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${COACH}`).count, 1);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${STAFF}`).count, RATE_LIMITS.callsPerInstall);
  // A batch the validator refuses outright needs no Firestore work and is answered.
  assert.deepEqual(statuses(await h.ingest([fixture("run-summary-negative-duration.invalid.json")], actor(STAFF))), [["rejected", "invalidSchema"]]);
  // The caller was charged for every call that reached Firestore, including the install-limited one.
  const charged = h.db.snapshot(`${RATE_LIMIT_ROOT}/caller:${STAFF}`).count;
  assert.equal(charged, RATE_LIMITS.callsPerInstall + 1);
  // Other installs still report until the caller's own bound.
  for (let n = 1; n <= RATE_LIMITS.callsPerCaller - charged; n++) {
    assert.deepEqual(statuses(await h.ingest([status(1, uuid(1000 + n))], actor(STAFF))), [["accepted", null]]);
  }
  assert.deepEqual(statuses(await h.ingest([status(1, uuid(5000))], actor(STAFF))), [["retryLater", "rateLimited"]]);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${uuid(5000)}:${STAFF}`), undefined, "a caller-limited call charges no install");
  // Another caller is independent; the next window resets both bounds.
  assert.deepEqual(statuses(await h.ingest([attempt({ executorInstallId: uuid(6000) })], actor(COACH))), [["accepted", null]]);
  h.advance(RATE_LIMITS.windowMs);
  assert.deepEqual(statuses(await h.ingest([status(500)], actor(STAFF))), [["accepted", null]]);
  const rate = h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${STAFF}`);
  assert.equal(rate.count, 1);
  assert.equal(rate.expiresAt.toMillis(), h.now() + DAY);
});

test("an install is charged only for records that pass actor binding", async () => {
  const h = harness();
  // Another account naming STAFF's install, with records it may not report, never spends that install's budget (D-21 F4).
  const refused = [
    run({ originReporterUid: STAFF }), // fact claims another reporter
    run({ attemptId: uuid(40), recordId: uuid(41), processingRunId: uuid(41), originReporterUid: COACH }), // no attempt index yet
    run({ originReporterUid: COACH }), // the attempt was reported by STAFF
  ];
  for (let call = 0; call < RATE_LIMITS.callsPerInstall + 5; call++) {
    assert.deepEqual(statuses(await h.ingest(refused, actor(COACH))),
      [["rejected", "unauthorizedReporter"], ["retryLater", "dependencyPending"], ["rejected", "unauthorizedReporter"]]);
  }
  assert.deepEqual(h.ratePaths().filter((key) => key.includes("install:")), []);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/caller:${COACH}`).count, RATE_LIMITS.callsPerInstall + 5, "the caller counter stays first");
  assert.deepEqual(statuses(await h.ingest([run()], actor(STAFF))), [["accepted", null]]);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${STAFF}`).count, 1);
  // Even a record another account may report on its own behalf (a reporter-basis device status naming
  // STAFF's install) is charged to that account's own install counter, never to STAFF's (D-23).
  h.advance(RATE_LIMITS.windowMs);
  const foreign = { ...fixture("device-status.valid.json"), originReporterUid: COACH, recordId: `${INSTALL}:${COACH}` };
  for (let call = 0; call < RATE_LIMITS.callsPerInstall + 3; call++) await h.ingest([{ ...foreign, revision: call + 1 }], actor(COACH));
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${COACH}`).count, RATE_LIMITS.callsPerInstall, "the coach exhausts only its own counter");
  assert.deepEqual(statuses(await h.ingest([run({ revision: 2, completeness: "partial" })], actor(STAFF))), [["accepted", null]]);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${STAFF}`).count, 1, "STAFF's budget on its own phone is untouched");
});

test("a malformed rate-limit counter fails closed for the current minute only", async () => {
  const window = Math.floor(START / RATE_LIMITS.windowMs);
  const h = harness({
    [`${RATE_LIMIT_ROOT}/caller:${STAFF}`]: { window: "not-a-window", count: 0 },
    [`${RATE_LIMIT_ROOT}/install:${INSTALL}:${COACH}`]: { window, count: "7" },
  });
  assert.deepEqual(statuses(await h.ingest([run()], actor(STAFF))), [["retryLater", "rateLimited"]]);
  assert.deepEqual(h.db.snapshot(`${RATE_LIMIT_ROOT}/caller:${STAFF}`), { window, count: RATE_LIMITS.callsPerCaller,
    expiresAt: FakeTimestamp.fromMillis(START + DAY) });
  // The coach's own caller counter is sound, but its install counter is not.
  assert.deepEqual(statuses(await h.ingest([attempt()], actor(COACH))), [["retryLater", "rateLimited"]]);
  assert.equal(h.db.snapshot(`${RATE_LIMIT_ROOT}/install:${INSTALL}:${COACH}`).count, RATE_LIMITS.callsPerInstall);
  assert.deepEqual(h.factPaths(), []);
  h.advance(RATE_LIMITS.windowMs);
  assert.deepEqual(statuses(await h.ingest([run()], actor(STAFF))), [["accepted", null]]);
  assert.deepEqual(statuses(await h.ingest([attempt()], actor(COACH))), [["accepted", null]]);
});

test("system upload groups: system:<category>:<originInstallId>, stored under the composite transition key (v1.2, D-21)", async () => {
  const h = harness();
  const systemGroup = (overrides = {}) => {
    const install = overrides.originInstallId ?? INSTALL;
    const record = { ...fixture("upload-group-summary-system.valid.json"), ...overrides, recordId: `system:diagnostics:${install}` };
    record.body = { ...record.body, groupId: record.recordId, category: "diagnostics" };
    return record;
  };
  const secondInstall = uuid(90);
  const results = [
    ...await h.ingest([systemGroup()], actor(COACH)),
    ...await h.ingest([systemGroup({ originReporterUid: STAFF })], actor(STAFF)),
    ...await h.ingest([systemGroup({ originInstallId: secondInstall, executorInstallId: secondInstall })], actor(COACH)),
  ];
  assert.deepEqual(statuses(results), Array(3).fill(["accepted", null]));
  assert.deepEqual(results.map((result) => result.recordId), [`system:diagnostics:${INSTALL}`, `system:diagnostics:${INSTALL}`, `system:diagnostics:${secondInstall}`],
    "the response echoes the client id");
  const key = (install, uid) => `devicePerformanceUploadGroups/uploadGroupSummary:system:diagnostics:${install}:${install}:${uid}`;
  assert.deepEqual(h.factPaths(), [key(INSTALL, COACH), key(INSTALL, STAFF), key(secondInstall, COACH)].sort());
  // The v1.1 install-less id and a group naming another install are refused.
  const legacy = systemGroup();
  legacy.recordId = legacy.body.groupId = "system:diagnostics";
  const foreign = fixture("upload-group-summary-system-foreign-install.invalid.json");
  assert.deepEqual(statuses(await h.ingest([legacy, foreign], actor(COACH))), [["rejected", "invalidSchema"], ["rejected", "identityMismatch"]]);
  // Each scope keeps its own revision history; no account can squat another's group.
  const base = fixture("upload-group-summary-system.valid.json").revision;
  assert.deepEqual(statuses(await h.ingest([systemGroup(), systemGroup({ revision: base + 1 })], actor(COACH))), [["duplicate", null], ["accepted", null]]);
  assert.equal(h.db.snapshot(key(INSTALL, COACH)).revision, base + 1);
  assert.equal(h.db.snapshot(key(INSTALL, STAFF)).revision, base);
  assert.equal(h.db.snapshot(key(secondInstall, COACH)).revision, base);
  assert.equal(h.db.snapshot(key(INSTALL, STAFF)).record.originReporterUid, STAFF);
  // Attempt-linked groups keep the contract's plain key.
  assert.deepEqual(statuses(await h.ingest([fixture("upload-group-summary.valid.json")], actor(COACH))), [["accepted", null]]);
  assert.ok(h.doc("uploadGroupSummary", `${COACH_ATTEMPT}:resultFiles`));
});

test("per-attempt caps: a 33rd run or 513th transfer is refused permanently; revisions and replays never count (D-31)", async () => {
  assert.deepEqual(ATTEMPT_CAPS, { runSummary: 32, transferInvocation: 512 });
  const seed = {};
  for (let n = 1; n < ATTEMPT_CAPS.runSummary; n++) seed[`devicePerformanceRuns/runSummary:${uuid(300 + n)}`] = { storageVersion: 1, attemptId: STAFF_ATTEMPT };
  for (let n = 1; n < ATTEMPT_CAPS.transferInvocation; n++) seed[`devicePerformanceTransfers/transferInvocation:${uuid(1000 + n)}`] = { storageVersion: 1, attemptId: COACH_ATTEMPT };
  const h = harness(seed);
  // The 32nd run and the 512th transfer of an attempt still fit.
  assert.deepEqual(statuses(await h.ingest([run()], actor(STAFF))), [["accepted", null]]);
  const transferFixture = fixture("transfer-invocation.valid.json");
  assert.deepEqual(statuses(await h.ingest([transferFixture], actor(COACH))), [["accepted", null]]);
  // The next new entity of either kind is a permanent refusal.
  const extraRun = run({ recordId: uuid(400), processingRunId: uuid(400) });
  const extraTransfer = { ...transferFixture, recordId: uuid(2000), body: { ...transferFixture.body, invocationId: uuid(2000) } };
  const [runRefusal] = await h.ingest([extraRun], actor(STAFF));
  const [transferRefusal] = await h.ingest([extraTransfer], actor(COACH));
  // v1.2.2 (D-36): the typed, permanent attemptCapExceeded code (the response schema validates it).
  assert.equal(ATTEMPT_CAP_WIRE_CODE, "attemptCapExceeded");
  for (const refusal of [runRefusal, transferRefusal]) {
    assert.deepEqual([refusal.status, refusal.retryable, refusal.errorCode, refusal.acceptedRevision], ["rejected", false, "attemptCapExceeded", null]);
  }
  assert.equal(h.doc("runSummary", uuid(400)), undefined);
  assert.equal(h.doc("transferInvocation", uuid(2000)), undefined);
  // The reason is also logged with the record kind and the cap.
  assert.deepEqual(h.logs.filter(([level]) => level === "warn").map(([, , detail]) => [detail.errorCode, detail.recordKind, detail.cap]),
    [["attemptCapExceeded", "runSummary", 32], ["attemptCapExceeded", "transferInvocation", 512]]);
  // Revisions and replays of a stored entity never count against the cap.
  assert.deepEqual(statuses(await h.ingest([run(), run({ revision: 2, completeness: "partial" })], actor(STAFF))), [["duplicate", null], ["accepted", null]]);
  // Another attempt is unaffected.
  await h.db.doc(`processingAttempts/${uuid(500)}`).set(attemptIndex(uuid(500), STAFF));
  assert.deepEqual(statuses(await h.ingest([run({ attemptId: uuid(500), recordId: uuid(501), processingRunId: uuid(501) })], actor(STAFF))), [["accepted", null]]);
});

test("a system transfer is accepted only when its group names the record's own install (v1.2.2, D-36)", async () => {
  const h = harness();
  const system = fixture("transfer-invocation-system.valid.json");
  const foreign = fixture("transfer-invocation-system-foreign-install.invalid.json");
  const noInstall = { ...system, recordId: uuid(700), originInstallId: null, body: { ...system.body, invocationId: uuid(700) } };
  const results = await h.ingest([system, foreign, noInstall], actor(COACH));
  assert.deepEqual(statuses(results), [["accepted", null], ["rejected", "identityMismatch"], ["rejected", "identityMismatch"]]);
  assert.deepEqual(h.factPaths(), [`devicePerformanceTransfers/transferInvocation:${system.recordId}`]);
  assert.deepEqual(h.stored(system).authority, { basis: "reporter", reporterUid: COACH, attemptId: null, playerDocumentID: null });
});

test("a stored fact from a newer storage version keeps the record pending", async () => {
  const future = { storageVersion: 2, revision: 1, digest: contract.digest(run()), shape: "newer" };
  const h = harness({ [`devicePerformanceRuns/runSummary:${RUN}`]: future });
  const results = await h.ingest([run(), run({ revision: 2 })], actor(STAFF));
  assert.deepEqual(statuses(results), [["retryLater", "unsupportedVersion"], ["retryLater", "unsupportedVersion"]]);
  assert.deepEqual(results.map((result) => [result.retryable, result.acceptedRevision]), [[true, null], [true, null]]);
  assert.deepEqual(h.db.snapshot(`devicePerformanceRuns/runSummary:${RUN}`), future);
});

test("an attempt-linked fact may not contradict the drill, rep or capture launch its attempt index records", async () => {
  const base = run();
  const h = harness({ [`processingAttempts/${STAFF_ATTEMPT}`]: attemptIndex(STAFF_ATTEMPT, STAFF,
    { drillType: base.drillType, repId: base.repId, originLaunchId: base.originLaunchId }) });
  const sibling = (n, overrides) => run({ recordId: uuid(n), processingRunId: uuid(n), ...overrides });
  const results = await h.ingest([
    base,
    sibling(95, { drillType: "sprint" }),
    sibling(96, { repId: "0".repeat(32) }),
    sibling(97, { originLaunchId: "11111111-2222-4333-8444-555555555555" }),
    sibling(98, { repId: null }), // a null value makes no claim
  ], actor(STAFF));
  assert.deepEqual(statuses(results), [["accepted", null], ["rejected", "identityMismatch"], ["rejected", "identityMismatch"],
    ["rejected", "identityMismatch"], ["accepted", null]]);
  assert.deepEqual(results.map((result) => result.acceptedRevision), [1, null, null, null, 1]);
});

test("refusal logs name client-chosen keys only by hash", async () => {
  const h = harness();
  const record = run();
  record.coachJaneDoeEmail = null;
  assert.deepEqual(statuses(await h.ingest([record], actor(STAFF))), [["rejected", "invalidSchema"]]);
  const logged = JSON.stringify(h.logs);
  assert.doesNotMatch(logged, /JaneDoe/);
  assert.match(logged, new RegExp(contract.clientKey("coachJaneDoeEmail")));
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
