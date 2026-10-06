"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createDiagnosticRetention } = require("./diagnostic-retention");
const admin = { uid: "admin", email: "nolan@posetek.net", emailVerified: true };
const time = 1800000000000;
function harness(extra = {}, fail = false) {
  const db = new FakeFirestore({ "failureCases/processing-test": { schemaVersion: 2,
    storage: { prefix: "failure_cases/processing-test" }, artifactUploadState: "complete",
    artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 31 * 86400000), ...extra } });
  const deleted = [];
  const bucket = { file: path => ({ delete: async options => {
    assert.equal(options.ignoreNotFound, true);
    if (fail && path.endsWith("report.json")) { fail = false; throw new Error("temporary storage failure"); }
    deleted.push(path);
  } }) };
  const api = createDiagnosticRetention({ db, bucket, FieldValue, HttpsError, now: () => time });
  return { db, api, deleted };
}
test("retention is disabled until explicitly enabled", async () => {
  const h = harness(); assert.deepEqual(await h.api.sweep(), { disabled: true }); assert.equal(h.deleted.length, 0);
});
test("hold, references and partial uploads preserve all evidence", async () => {
  for (const state of [{ investigationHold: true }, { artifactReferences: ["normal-archive-reference"] },
    { artifactUploadState: "partial" }, { artifactsAcknowledgedAt: null }]) {
    const h = harness(state); assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true }); assert.equal(h.deleted.length, 0);
  }
});
test("video expires after seven days while metadata remains an audit tombstone", async () => {
  const h = harness({ artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 8 * 86400000) });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "videoExpired" });
  assert.deepEqual(h.deleted, ["failure_cases/processing-test/video.mov"]);
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
});
test("cleanup death resumes idempotently and never visits ordinary athlete archives", async () => {
  const h = harness({}, true);
  await assert.rejects(h.api.cleanIncident("processing-test"));
  await assert.rejects(h.api.protect({ incidentId: "processing-test", hold: true, references: [] }, admin), { code: "failed-precondition" });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "expired" });
  assert.ok(h.deleted.every(p => p.startsWith("failure_cases/processing-test/")));
  assert.equal((await h.db.collection("failureCases").doc("processing-test").get()).exists, true);
});
test("only verified administrators may hold or release evidence", async () => {
  const h = harness();
  await assert.rejects(h.api.protect({ incidentId: "processing-test", hold: true, references: [] }, { uid: "coach" }), { code: "permission-denied" });
  await h.api.protect({ incidentId: "processing-test", hold: true, references: [] }, admin);
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
  await h.api.protect({ incidentId: "processing-test", hold: false, references: [] }, admin);
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "expired" });
});
test("forged prefixes cannot target another incident", async () => {
  const h = harness({ storage: { prefix: "player/drill/session1" } });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
  assert.equal(h.deleted.length, 0);
});

test("an outstanding resumable session delays cleanup until its safety window expires", async () => {
  const h = harness({ uploadSessionIssuedAt: FakeTimestamp.fromMillis(time - 86400000) });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
  assert.equal(h.deleted.length, 0);
  await h.db.doc("failureCases/processing-test").update({ uploadSessionIssuedAt: FakeTimestamp.fromMillis(time - 9 * 86400000) });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "expired" });
});

test("bundle expiry deletes only declared original observations", async () => {
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const h = harness({ calibrationObservations: { [id]: "a".repeat(64), "../../player": "bad" } });
  await h.api.cleanIncident("processing-test");
  assert.ok(h.deleted.includes(`failure_cases/processing-test/calibration_observations/${id}.png`));
  assert.ok(h.deleted.every(path => !path.includes("..")));
});

test("terminal acknowledged attempts expire only when no incident or hold references them", async () => {
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const h = harness();
  const target = h.db.doc(`processingAttempts/${id}`);
  await target.set({ schemaVersion: 2, lifecycle: "committed", artifactUploadState: "complete",
    reportedByUid: "reporter", manifestPath: `processing_attempts/reporter/${id}/manifest.json`,
    artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 31 * 86400000) });
  await h.api.protect({ attemptId: id, hold: true, references: [] }, admin);
  assert.deepEqual(await h.api.cleanAttempt(id), { skipped: true });
  await h.api.protect({ attemptId: id, hold: false, references: [] }, admin);
  await h.db.doc("failureCases/linked").set({ attemptId: id });
  assert.deepEqual(await h.api.cleanAttempt(id), { skipped: true });
  await h.db.doc("failureCases/linked").delete();
  assert.deepEqual(await h.api.cleanAttempt(id), { state: "expired" });
  assert.ok(h.deleted.includes(`processing_attempts/reporter/${id}/manifest.json`));
  assert.ok(h.deleted.includes(`processing_attempts/reporter/${id}/log.jsonl.gz`));
  assert.ok(h.deleted.every(path => path.startsWith(`processing_attempts/reporter/${id}/`)));
  assert.equal(h.deleted.length, 2);
  assert.equal((await target.get()).data().retentionState, "expired");
});
test("a failed journal deletion keeps the attempt claim and the retry finishes both objects", async () => {
  const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const db = new FakeFirestore({ [`processingAttempts/${id}`]: { schemaVersion: 2, lifecycle: "committed",
    artifactUploadState: "complete", reportedByUid: "reporter", manifestPath: `processing_attempts/reporter/${id}/manifest.json`,
    artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 31 * 86400000) } });
  let fail = true;
  const deleted = [];
  const bucket = { file: path => ({ delete: async () => {
    if (fail && path.endsWith("log.jsonl.gz")) { fail = false; throw new Error("temporary storage failure"); }
    deleted.push(path);
  } }) };
  const api = createDiagnosticRetention({ db, bucket, FieldValue, HttpsError, now: () => time });
  await assert.rejects(api.cleanAttempt(id));
  assert.equal((await db.doc(`processingAttempts/${id}`).get()).data().retentionState, "allDeleting");
  assert.deepEqual(await api.cleanAttempt(id), { state: "expired" });
  assert.deepEqual(deleted.sort(), [`processing_attempts/reporter/${id}/log.jsonl.gz`, `processing_attempts/reporter/${id}/manifest.json`]);
});
test("pending attempts and recent upload sessions cannot expire", async () => {
  const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  for (const extra of [{ lifecycle: "processingStarted" }, { uploadSessionIssuedAt: FakeTimestamp.fromMillis(time) }]) {
    const h = harness();
    await h.db.doc(`processingAttempts/${id}`).set({ schemaVersion: 2, lifecycle: "committed", artifactUploadState: "complete",
      reportedByUid: "reporter", manifestPath: `processing_attempts/reporter/${id}/manifest.json`,
      artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 31 * 86400000), ...extra });
    assert.deepEqual(await h.api.cleanAttempt(id), { skipped: true });
    assert.equal(h.deleted.length, 0);
  }
});
