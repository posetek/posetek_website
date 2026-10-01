"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createIssueTrackerBridge, PATHS } = require("./issue-tracker-bridge");
const { createIssueTrackerRecovery, STATE_PATH, PAGE_SIZE, MAX_PAGES, LEASE_MS } = require("./issue-tracker-recovery");
const AT = Date.parse("2026-10-01T23:00:00Z");
const id = n => n.toString(16).padStart(64, "0");

function fixture(count = 1, hooks = {}) {
  let time = AT, serial = 0;
  const db = new FakeFirestore({
    [PATHS.settings]: { enabled: true, seedVerified: true, connectionVerified: true, workbookKey: "confirmed-cloud-file", mailbox: "dylank@posetek.net" },
    [PATHS.writer]: { revision: 0 },
  });
  for (let n = 0; n < count; n++) db.write(`userIssueOutbox/${id(1000 + n)}`, { type: "incident", status: "pending", createdAtMillis: AT - 86400000 }, { create: true });
  const tasks = [], observations = [];
  const bridge = createIssueTrackerBridge({ db, now: () => time, scheduleTask: async (data, options) => {
    if (hooks.schedule) await hooks.schedule(data, options);
    tasks.push({ data, options });
  }, normalize: () => { throw new Error("Recovery must not normalize or write Excel"); }, transport: { send: () => { throw new Error("Recovery must not call Excel"); } } });
  const wrapped = { observeOutbox: async (sourceId, options) => { observations.push(sourceId); if (hooks.observe) await hooks.observe(sourceId); return bridge.observeOutbox(sourceId, options); }, wake: () => bridge.wake() };
  const recovery = createIssueTrackerRecovery({ db, bridge: wrapped, now: () => time, randomId: () => `recovery-${++serial}` });
  return { db, bridge, recovery, tasks, observations, advance: ms => { time += ms; } };
}

test("recovery stays inert until enabled, seed and connection gates all pass", async () => {
  for (const field of ["enabled", "seedVerified", "connectionVerified", "workbookKey"]) {
    const f = fixture(); await f.db.doc(PATHS.settings).update({ [field]: field === "workbookKey" ? "" : false });
    assert.deepEqual(await f.recovery.run(), { skipped: "not_configured" });
    assert.equal(f.db.snapshot(STATE_PATH), undefined); assert.equal(f.tasks.length, 0);
    assert.equal((await f.db.collection(PATHS.queue).get()).size, 0);
  }
});

test("bounded cursor resumes all pages with one original upper bound and no coverage/publication claim", async () => {
  const f = fixture(PAGE_SIZE * MAX_PAGES + 3);
  const first = await f.recovery.run();
  assert.equal(first.examined, 200); assert.equal(first.scanComplete, false); assert.equal(f.tasks.length, 1);
  const active = f.db.snapshot(STATE_PATH).activeScan;
  assert.equal(active.cursor, id(1199)); assert.equal(active.createdBeforeMillis, AT);
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan, undefined);
  f.advance(15 * 60000);
  const second = await f.recovery.run(), state = f.db.snapshot(STATE_PATH);
  assert.equal(second.examined, 3); assert.equal(second.scanComplete, true);
  assert.equal(state.activeScan, null); assert.equal(state.lastCompletedScan.documentsExamined, 203);
  assert.equal(state.lastCompletedScan.createdBeforeMillis, AT);
  assert.equal(state.lastCompletedScan.pointInTimeSnapshot, false);
  assert.equal(state.lastCompletedScan.sourceCompleteThroughAdvanced, false);
  assert.equal(state.lastCompletedScan.publicationConfirmed, false);
  assert.equal(state.completeThroughMillis, undefined);
  assert.equal((await f.db.collection(PATHS.queue).get()).size, 203);
  assert.equal(f.db.snapshot(PATHS.writer).revision, 0);
});

test("partial page failure retains durable enqueue and does not advance its cursor or leak raw error", async () => {
  let fail = true, calls = 0;
  const f = fixture(103, { observe: async () => { if (++calls === 102 && fail) throw new Error("raw private provider body"); } });
  await assert.rejects(f.recovery.run(), { code: "tracker_recovery_failed", message: "tracker_recovery_failed" });
  const failed = f.db.snapshot(STATE_PATH);
  assert.equal(failed.activeScan.cursor, id(1099)); assert.equal(failed.activeScan.documentsExamined, 100);
  assert.equal(failed.lastCompletedScan, undefined); assert.equal(failed.lastErrorCode, "tracker_recovery_failed");
  assert.equal(failed.leaseId, null); assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(1100)}`).version, 1);
  fail = false; await f.recovery.run();
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan.documentsExamined, 103);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(1100)}`).version, 1);
  assert.equal(f.tasks.length, 1);
  assert.ok(!JSON.stringify(f.db.snapshot(STATE_PATH)).includes("raw private"));
});

test("task scheduling failure preserves unfinished scan and retries pending frozen work", async () => {
  let fail = true;
  const f = fixture(1, { schedule: async () => { if (fail) throw new Error("temporary queue failure"); } });
  await assert.rejects(f.recovery.run());
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan, undefined);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(1000)}`).pending, true);
  fail = false; f.advance(900000); await f.recovery.run();
  assert.equal(f.tasks.length, 1); assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan.documentsExamined, 1);
});

test("fresh sweep wakes a stranded frozen batch even with no pending source rows", async () => {
  const f = fixture(0); await f.db.doc(PATHS.writer).update({ activeBatchId: "frozen-exact-retry", dailyAttempts: 1200 });
  assert.equal((await f.recovery.run()).pendingWorkObserved, true);
  assert.equal(f.tasks.length, 1); assert.equal(f.db.snapshot(PATHS.writer).activeBatchId, "frozen-exact-retry");
  assert.equal(f.db.snapshot(PATHS.writer).dailyAttempts, 1200);
});

test("previously acknowledged old delivery changes are found without an updatedAt field", async () => {
  const f = fixture(); await f.recovery.run();
  const key = `${PATHS.queue}/outbox-${id(1000)}`, before = f.db.snapshot(key);
  await f.db.doc(key).update({ pending: false, appliedHash: before.desiredHash });
  await f.db.doc(`userIssueOutbox/${id(1000)}`).update({ status: "bounced", recipientDelivery: { "dylank@posetek.net": { status: "bounced", at: AT + 100 } } });
  f.advance(900000); await f.recovery.run();
  const after = f.db.snapshot(key); assert.equal(after.version, 2); assert.equal(after.pending, true);
  assert.notEqual(after.desiredHash, before.desiredHash);
});

test("blocked writer remains blocked and recovery records the condition without a new task", async () => {
  const f = fixture(); await f.db.doc(PATHS.writer).update({ blockedReason: "tracker_remote_conflict", activeBatchId: "preserve-this" });
  const answer = await f.recovery.run();
  assert.equal(answer.writerBlocked, true); assert.equal(f.tasks.length, 0);
  assert.equal(f.db.snapshot(STATE_PATH).writerBlockedReason, "tracker_remote_conflict");
  assert.equal(f.db.snapshot(PATHS.writer).blockedReason, "tracker_remote_conflict");
  assert.equal(f.db.snapshot(PATHS.writer).activeBatchId, "preserve-this");
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(1000)}`).pending, true);
});

test("concurrent recovery cannot share a live lease and expired lease resumes the same scan", async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  let once = true;
  const f = fixture(1, { observe: async () => { if (once) { once = false; started(); await new Promise(resolve => { release = resolve; }); } } });
  const running = f.recovery.run(); await ready;
  assert.deepEqual(await f.recovery.run(), { skipped: "recovery_busy" });
  release(); await running;
  await f.db.doc(STATE_PATH).update({ leaseId: "expired", leaseUntilMillis: AT + LEASE_MS,
    activeScan: { ...f.db.snapshot(STATE_PATH).lastCompletedScan, cursor: null } });
  f.advance(LEASE_MS + 1); await f.recovery.run();
  assert.equal(f.db.snapshot(STATE_PATH).leaseId, null);
});

test("creation upper bound excludes newer rows and a later pass catches them", async () => {
  const f = fixture(1); await f.db.doc(`userIssueOutbox/${id(1001)}`).set({ type: "daily", status: "pending", createdAtMillis: AT + 1 });
  await f.recovery.run();
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan.skippedNewerDocuments, 1);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(1001)}`), undefined);
  f.advance(900000); await f.recovery.run();
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(1001)}`).pending, true);
});

test("concurrent insertion behind cursor is recovered on next enumeration without false coverage", async () => {
  const f = fixture(201); await f.recovery.run();
  await f.db.doc(`userIssueOutbox/${id(500)}`).set({ type: "incident", status: "pending", createdAtMillis: AT - 1 });
  await f.recovery.run();
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(500)}`), undefined);
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan.pointInTimeSnapshot, false);
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan.sourceCompleteThroughAdvanced, false);
  f.advance(900000); await f.recovery.run();
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${id(500)}`).pending, true);
});

test("gate changes during enumeration retain old cursor and refuse completion", async () => {
  let f;
  f = fixture(1, { observe: async () => { await f.db.doc(PATHS.settings).update({ enabled: false }); } });
  await assert.rejects(f.recovery.run(), { code: "tracker_recovery_configuration_changed" });
  assert.equal(f.db.snapshot(STATE_PATH).activeScan.cursor, null);
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan, undefined);
  assert.equal(f.tasks.length, 0);
});

test("unknown creation times remain visible and mismatched workbook configuration cannot reuse cursor", async () => {
  const f = fixture(); await f.db.doc(`userIssueOutbox/${id(1000)}`).set({ type: "status", status: "pending" });
  await f.recovery.run();
  assert.equal(f.db.snapshot(STATE_PATH).lastCompletedScan.unknownTimeDocuments, 1);
  await f.db.doc(PATHS.settings).update({ workbookKey: "different-file" });
  await assert.rejects(f.recovery.run(), { code: "tracker_recovery_workbook_changed" });
});

test("isolated recovery is a scheduled Pub/Sub endpoint with bounded runtime and no flow secrets", () => {
  const { createIssueTrackerBridgeEntrypoints } = require("./issue-tracker-bridge-entrypoints");
  const previous = process.env.GCLOUD_PROJECT; process.env.GCLOUD_PROJECT = "candidate-test-only";
  try {
    const entries = createIssueTrackerBridgeEntrypoints(require("firebase-functions"), { firestore: () => new FakeFirestore() }, { normalize: () => ({}), taskQueue: { enqueue: async () => {} } });
    const endpoint = entries.recoverUserIssueTracker.__endpoint;
    assert.equal(endpoint.scheduleTrigger.schedule, "every 15 minutes");
    assert.equal(endpoint.scheduleTrigger.timeZone, "Etc/UTC");
    assert.equal(endpoint.timeoutSeconds, 180); assert.equal(endpoint.maxInstances, 1);
    assert.equal(endpoint.httpsTrigger, undefined); assert.equal(endpoint.secretEnvironmentVariables, undefined);
    assert.equal(entries.drainUserIssueTracker.__endpoint.taskQueueTrigger.invoker[0], "private");
  } finally { if (previous === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = previous; }
});
