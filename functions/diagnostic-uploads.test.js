"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createDiagnosticUploads } = require("./diagnostic-uploads");
const actor = { uid: "staff", email: "coach@example.test", emailVerified: true };
const data = { path: "failure_cases/processing-test/report.json", contentType: "application/json", byteCount: 10, sha256: "a".repeat(64) };
function harness(record = {}, seed = {}) {
  const db = new FakeFirestore({
    "failureCases/processing-test": { schemaVersion: 2, scope: "attempt", reportedByUid: "staff",
      playerDocumentID: "player", storage: { prefix: "failure_cases/processing-test" }, ...record },
    "players/player": { organizationId: "club", teamId: "team" },
    "organizations/club/members/staff": { userUID: "staff", status: "active", role: "coach", teamIds: ["team"] },
    "testingEvents/event": { organizationId: "club", operatorUids: ["staff"], status: "closed" }, ...seed });
  const issued = [];
  const bucket = { file: path => ({ createResumableUpload: async options => {
    issued.push({ path, options }); return ["https://storage.googleapis.com/private-upload-session"];
  } }) };
  return { db, issued, api: createDiagnosticUploads({ db, bucket, FieldValue, HttpsError }) };
}
test("current assigned staff may start an upload; revoked staff and another account may not", async () => {
  const h = harness();
  await h.api.authorize(data, actor);
  assert.equal(h.issued.length, 1);
  await h.db.doc("organizations/club/members/staff").update({ status: "revoked" });
  await assert.rejects(h.api.authorize(data, actor), { code: "permission-denied" });
  await assert.rejects(h.api.authorize(data, { ...actor, uid: "other" }), { code: "permission-denied" });
  assert.equal(h.issued.length, 1);
});
test("setup remains reportable after closure but event removal and membership revocation deny new sessions", async () => {
  const h = harness({ scope: "stationSetup", testingEventId: "event", playerDocumentID: null, attemptId: null });
  await h.api.authorize(data, actor);
  await h.db.doc("testingEvents/event").update({ operatorUids: [] });
  await assert.rejects(h.api.authorize(data, actor), { code: "permission-denied" });
  await h.db.doc("testingEvents/event").update({ operatorUids: ["staff"] });
  await h.db.doc("organizations/club/members/staff").update({ status: "revoked" });
  await assert.rejects(h.api.authorize(data, actor), { code: "permission-denied" });
});
test("actor-only system uploads cannot assert athlete identity", async () => {
  const h = harness({ scope: "actor", kind: "system_diagnostic", playerDocumentID: null, attemptId: null });
  const system = { ...data, path: "failure_cases/processing-test/system_diagnostic.json" };
  await h.api.authorize(system, actor);
  await h.db.doc("failureCases/processing-test").update({ playerDocumentID: "player" });
  await assert.rejects(h.api.authorize(system, actor), { code: "permission-denied" });
});
test("cleanup claims and malformed paths, MIME, size and hash never mint sessions", async () => {
  const h = harness();
  for (const override of [{ path: "player/drill/video.mov" }, { path: "failure_cases/processing-test/../video.mov" },
    { contentType: "text/html" }, { byteCount: 3 * 1024 * 1024 }, { sha256: "bad" }]) {
    await assert.rejects(h.api.authorize({ ...data, ...override }, actor));
  }
  await h.db.doc("failureCases/processing-test").update({ retentionState: "allDeleting" });
  await assert.rejects(h.api.authorize(data, actor));
  assert.equal(h.issued.length, 0);
});
test("conflicting athlete UID bindings do not grant self access", async () => {
  const h = harness({}, { "players/player": { authenticationUID: "staff", userUID: "other" } });
  await assert.rejects(h.api.authorize(data, actor));
});

test("the run journal uploads beside the attempt manifest under the manifest's checks", async () => {
  const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const base = `processing_attempts/staff/${id}`;
  const h = harness({}, { [`processingAttempts/${id}`]: { schemaVersion: 2, scope: "attempt", reportedByUid: "staff",
    playerDocumentID: "player", attemptId: id, manifestPath: `${base}/manifest.json` } });
  const journal = { path: `${base}/log.jsonl.gz`, contentType: "application/gzip", byteCount: 1167, sha256: "c".repeat(64) };
  await h.api.authorize({ ...data, path: `${base}/manifest.json` }, actor);
  await h.api.authorize(journal, actor);
  await h.api.authorize({ ...journal, byteCount: 1024 * 1024 }, actor);
  assert.equal(h.issued.length, 3);
  assert.equal(h.issued[1].path, `${base}/log.jsonl.gz`);
  assert.equal(h.issued[1].options.metadata.contentType, "application/gzip");
  assert.equal(h.issued[1].options.metadata.contentLength, 1167);
  assert.equal(h.issued[1].options.metadata.metadata.attemptId, id);
  for (const override of [{ contentType: "application/json" }, { contentType: "application/x-ndjson" },
    { byteCount: 1024 * 1024 + 1 }, { byteCount: 0 }, { sha256: "bad" },
    { path: `${base}/log.jsonl` }, { path: `${base}/log.jsonl.gz.png` }, { path: `${base}/other.jsonl.gz` },
    { path: `processing_attempts/other/${id}/log.jsonl.gz` }]) {
    await assert.rejects(h.api.authorize({ ...journal, ...override }, actor));
  }
  await assert.rejects(h.api.authorize(journal, { ...actor, uid: "other" }), { code: "permission-denied" });
  assert.equal(h.issued.length, 3);
  // The record's manifest path binds the journal: a record pointing elsewhere mints nothing.
  await h.db.doc(`processingAttempts/${id}`).update({ manifestPath: `processing_attempts/staff/${"d".repeat(8)}/manifest.json` });
  await assert.rejects(h.api.authorize(journal, actor), { code: "permission-denied" });
  await h.db.doc(`processingAttempts/${id}`).update({ manifestPath: `${base}/manifest.json` });
  // Lost athlete access and a cleanup claim deny the journal exactly as they deny the manifest.
  await h.db.doc("organizations/club/members/staff").update({ status: "revoked" });
  await assert.rejects(h.api.authorize(journal, actor), { code: "permission-denied" });
  await h.db.doc("organizations/club/members/staff").update({ status: "active" });
  await h.db.doc(`processingAttempts/${id}`).update({ retentionState: "allDeleting" });
  await assert.rejects(h.api.authorize(journal, actor), { code: "permission-denied" });
  assert.equal(h.issued.length, 3);
});

test("only hash-bound original observations declared by this incident may upload", async () => {
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const h = harness({ calibrationObservations: { [id]: "b".repeat(64) } });
  const observation = { ...data, path: `failure_cases/processing-test/calibration_observations/${id}.png`, contentType: "image/png", sha256: "b".repeat(64) };
  await h.api.authorize(observation, actor);
  await assert.rejects(h.api.authorize({ ...observation, sha256: "a".repeat(64) }, actor));
  await assert.rejects(h.api.authorize({ ...observation, path: observation.path.replace(id, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb") }, actor));
  assert.equal(h.issued.length, 1);
});
