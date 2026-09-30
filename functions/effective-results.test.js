"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createEffectiveResults, effectiveRep } = require("./effective-results");
const { createProcessingEvidenceReader } = require("./processing-evidence");
const admin = { uid: "admin", email: "admin@posetek.net", emailVerified: true };
const original = { id: "rep", repType: "dribbling", sessionNumber: 1, repNumber: 1, createdAt: FakeTimestamp.fromMillis(1000), totalTime: 12, storagePath: "player/dribbling/session1/kick1" };
const valid = { metadata: { totalTime: 12, resultsValid: true, processingStatus: "complete", failedSteps: [] }, context: { rep: { repId: "rep", playerDocId: "player", videoStoragePath: `${original.storagePath}/video.mov` }, result: { primaryMetric: 12, resultsValid: true } } };
function storage(objects = {}) {
  const calls = [];
  const map = new Map(Object.entries(objects).map(([name, value]) => [name, { bytes: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)), generation: "123" }]));
  return { name: "test", calls, map,
    file(name, options) { return {
      async getMetadata() { calls.push(["metadata", name]); const item = map.get(name); if (!item) throw Object.assign(Error("missing"), { code: 404 }); return [{ generation: item.generation, size: item.bytes.length }]; },
      async download() { calls.push(["download", name, options]); return [map.get(name).bytes]; },
      async getSignedUrl() { calls.push(["sign", name, options]); return [`https://example.invalid/${name}?generation=${options?.generation}`]; },
    }; },
    async getFiles({ prefix }) { return [[...map.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name }))]; },
  };
}
function setup({ seed = {}, evidence = valid, objects = {}, inject = true } = {}) {
  const db = new FakeFirestore({ "players/player": { userUID: "athlete" }, "players/player/reps/rep": original, ...seed });
  const bucket = storage(objects);
  const service = createEffectiveResults({ db, bucket, HttpsError, ...(inject ? { readEvidence: typeof evidence === "function" ? evidence : async () => evidence } : {}) });
  return { db, bucket, service };
}
test("effective rows null every measurement for incomplete results and duplicates, even with positive stale metadata", () => {
  const invalid = effectiveRep({ ...original, totalTime: null }, { ...valid, metadata: { ...valid.metadata, resultsValid: false } }, false);
  assert.equal(invalid.totalTime, null); assert.equal(invalid.resultStatus.qualified, false);
  const duplicate = effectiveRep(original, valid, true);
  assert.equal(duplicate.totalTime, null); assert.equal(duplicate.resultStatus.reason, "duplicateDocument");
  assert.equal(duplicate.resultStatus.duplicate, true);
});
test("a failed station attempt is flagged so readers can hide it; partial and valid reps are not", () => {
  const failed = effectiveRep({ ...original, totalTime: null, processingStatus: "failed", resultsValid: false }, {}, false);
  assert.equal(failed.failedAttempt, true); assert.equal(failed.resultStatus.qualified, false);
  assert.equal(Object.hasOwn(effectiveRep({ ...original, processingStatus: "partial", resultsValid: false }, valid, false), "failedAttempt"), false);
  assert.equal(Object.hasOwn(effectiveRep(original, valid, false), "failedAttempt"), false);
});
test("secondary broad-jump height can be unavailable while horizontal distance qualifies; legacy jump peak uses bounded original keyframes", () => {
  const broad = { ...original, repType: "broadJump", broadJumpDistance: 1.4, jumpHeight: -0.2 };
  const evidence = { metadata: { broadJumpDistance: 1.4 }, context: { result: { resultsValid: true, primaryMetric: 1.4 } } };
  assert.equal(effectiveRep(broad, evidence, false).broadJumpDistance, 1.4);
  assert.equal(effectiveRep(broad, evidence, false).jumpHeight, null);
  assert.equal(effectiveRep({ ...broad, jumpHeight: 0.2, metricValidity: { jumpHeight: false } }, evidence, false).jumpHeight, null);
  const staleAliases = effectiveRep({ ...broad, jumpHeight: null }, { ...evidence, metadata: { ...evidence.metadata, jump_height_m: 0.3, jump_height_in: 12, jump_height_inches: 12 } }, false);
  for (const key of ["jumpHeight", "jump_height_m", "jump_height_in", "jump_height_inches"]) assert.equal(staleAliases[key], null);
  const jump = { ...original, repType: "jump", jumpHeight: 0.3 };
  const jumpEvidence = { metadata: {}, context: { result: { resultsValid: true, primaryMetric: 0.3 } }, keyFrames: [10, 20, 30, 40], frameCount: 50 };
  assert.equal(effectiveRep(jump, jumpEvidence, false).peakFrame, 40);
  assert.equal(effectiveRep(jump, { ...jumpEvidence, frameCount: 40 }, false).peakFrame, null);
  assert.equal(effectiveRep({ ...jump, peakFrame: null }, jumpEvidence, false).peakFrame, null);
});
test("accepted revisions override stale failure but never revive explicitly cleared secondary measurements", () => {
  const rep = { ...original, phase1Time: null, adminRevision: { revisionId: "r1", atMillis: 2000 } };
  const row = effectiveRep(rep, { ...valid, metadata: { ...valid.metadata, phase1Time: 999, adminRevision: { revisionId: "r1" } },
    context: { result: { resultsValid: false } }, revision: { revisionId: "r1", fields: rep }, failures: [{ createdAt: 1000 }] }, false);
  assert.equal(row.resultStatus.reason, "acceptedRevision"); assert.equal(row.resultStatus.revisionId, "r1"); assert.equal(row.totalTime, 12); assert.equal(row.phase1Time, null);
  const shot = { ...rep, repType: "side_kick", velocity: 20, launch_angle: 30, launchAngle: null };
  const shotRow = effectiveRep(shot, { metadata: { velocity: 20, launch_angle: 30, launchAngle: null, resultsValid: true, processingStatus: "complete", adminRevision: { revisionId: "r1" } },
    revision: { revisionId: "r1", fields: { velocity: 20, launchAngle: null } } }, false);
  assert.equal(shotRow.resultStatus.reason, "acceptedRevision");
  assert.equal(shotRow.launch_angle, null); assert.equal(shotRow.launchAngle, null);
});
test("authenticated results allow bound owners and current club staff; stale mirrors and mismatched bindings are denied", async () => {
  const { service } = setup({ seed: {
    "players/player": { userUID: "athlete", organizationId: "club", teamId: "team" },
    "organizations/club/members/manager": { userUID: "manager", role: "manager", status: "active", teamIds: [] },
    "organizations/club/members/coach": { userUID: "coach", role: "coach", status: "active", teamIds: ["team"] },
    "coaches/outsider": { userUID: "outsider", members: ["player"] },
  } });
  for (const uid of ["athlete", "manager", "coach"]) assert.equal((await service.getResults({ playerId: "player" }, { uid })).reps[0].totalTime, 12);
  await assert.rejects(service.getResults({ playerId: "player" }, { uid: "outsider" }), { code: "permission-denied" });
  await assert.rejects(service.getResults({ playerId: "player" }, { uid: "athlete", isAnonymous: true }), { code: "unauthenticated" });
  const mismatch = setup({ seed: { "players/player": { userUID: "athlete", authenticationUID: "another" } } });
  await assert.rejects(mismatch.service.getResults({ playerId: "player" }, { uid: "athlete" }), { code: "permission-denied" });
});
test("current access is checked again after evidence work", async () => {
  let db;
  const harness = setup({ seed: { "players/player": { userUID: "athlete", organizationId: "club", teamId: "team" },
    "organizations/club/members/coach": { userUID: "coach", role: "coach", status: "active", teamIds: ["team"] } },
    evidence: async () => { await db.collection("organizations").doc("club").collection("members").doc("coach").delete(); return valid; } });
  db = harness.db;
  await assert.rejects(harness.service.getResults({ playerId: "player" }, { uid: "coach" }), { code: "permission-denied" });
});
test("results expose allowlisted data only and propagate evidence failure rather than raw numbers", async () => {
  const { service } = setup({ seed: { "players/player/reps/rep": { ...original, secretNote: "hidden", videoURL: "secret", reporterEmail: "private" } } });
  const result = await service.getResults({ playerId: "player", drill: "dribbling" }, admin);
  assert.equal(result.version, 1); assert.equal(result.reps[0].createdAtMillis, 1000);
  for (const field of ["storagePath", "secretNote", "videoURL", "reporterEmail"]) assert.equal(Object.hasOwn(result.reps[0], field), false);
  const broken = setup({ evidence: async () => { throw Error("transport failed"); } });
  await assert.rejects(broken.service.getResults({ playerId: "player" }, admin), /transport failed/);
});
test("native duplicate jump mirrors remain audit rows and carry no successful values", async () => {
  const jump = { repType: "jump", sessionNumber: 1, repNumber: 1, jumpHeight: 0.3 };
  const { service } = setup({ seed: { "players/player/reps/rep": { ...jump, storagePath: "player/jump/session1/kick1" }, "players/player/reps/mirror": jump },
    evidence: { metadata: { jumpHeight: 0.3 }, context: { result: { resultsValid: true, primaryMetric: 0.3 } } } });
  const result = await service.getResults({ playerId: "player" }, admin);
  assert.equal(result.reps.length, 2); assert.equal(result.reps.find(r => r.id === "mirror").jumpHeight, null);
  assert.equal(result.reps.find(r => r.id === "rep").jumpHeight, 0.3);
});
test("authenticated native rows expose only unambiguous validated folders; shared rows never expose paths", async () => {
  const { service } = setup();
  assert.equal((await service.getResults({ playerId: "player" }, admin)).reps[0].storageFolder, original.storagePath);
  assert.equal(Object.hasOwn((await service.listForPlayer("player")).reps[0], "storageFolder"), false);
  const conflict = setup({ evidence: { ...valid, context: { rep: { playerDocId: "player", repId: "another" } } } });
  assert.equal((await conflict.service.getResults({ playerId: "player" }, admin)).reps[0].storageFolder, null);
  const ambiguous = setup({ seed: { "players/player/reps/another": { ...original, id: "another" } }, evidence: { metadata: valid.metadata } });
  assert.ok((await ambiguous.service.getResults({ playerId: "player" }, admin)).reps.every(row => row.storageFolder === null));
});
test("server-owned cross-drill corrections suppress only the reviewed mirror in effective results", async () => {
  const { service } = setup({ seed: {
    "players/player/reps/rep": { repType: "broadJump", broadJumpDistance: 1.4 },
    "players/player/reps/mirror": { repType: "jump", jumpHeight: 0.3, duplicateOf: "rep" },
    "players/player/insightMetadata/resultCorrections": { schemaVersion: 1, repairId: "audited-repair", reviewedAtMillis: 1000, duplicateReps: { mirror: "rep" } },
  }, evidence: { metadata: { broadJumpDistance: 1.4 }, context: { result: { resultsValid: true, primaryMetric: 1.4 } } } });
  const result = await service.getResults({ playerId: "player" }, admin);
  assert.equal(result.reps.find(row => row.id === "mirror").resultStatus.reason, "duplicateDocument");
  assert.equal(result.reps.find(row => row.id === "rep").broadJumpDistance, 1.4);
});
test("normal video and artifact URLs are pinned to inspected generation and do not include diagnostic reports", async () => {
  const folder = original.storagePath;
  const { service, bucket } = setup({ evidence: { ...valid, folder }, objects: { [`${folder}/video.mov`]: "movie", [`${folder}/pose.json`]: {}, [`${folder}/metadata.json`]: valid.metadata } });
  const result = await service.getMedia({ playerId: "player", drill: "dribbling", repId: "rep" }, admin);
  assert.equal(result.source, "recording"); assert.match(result.mediaUrl, /generation=123/);
  assert.ok(result.artifactUrls["pose.json"]);
  assert.ok(bucket.calls.filter(c => c[0] === "sign").every(c => c[2].generation === "123"));
});
test("reps processed without pose sign tracking.json for replay; the sprint list names only files mobile writes", async () => {
  const { ARTIFACTS } = require("./effective-results");
  for (const drill of ["sprint", "changeOfDirection", "dribbling"]) assert.ok(ARTIFACTS[drill].includes("tracking.json"), drill);
  assert.deepEqual(ARTIFACTS.sprint.filter(name => /^com_/.test(name)), []);
  const folder = original.storagePath;
  const { service } = setup({ evidence: { ...valid, folder }, objects: { [`${folder}/metadata.json`]: { ...valid.metadata, poseComputed: false }, [`${folder}/tracking.json`]: { schemaVersion: 1, frames: [] } } });
  const result = await service.getMedia({ playerId: "player", drill: "dribbling", repId: "rep" }, admin);
  assert.ok(result.artifactUrls["tracking.json"]); assert.equal(result.artifactUrls["pose.json"], undefined);
});
test("a reused ordinary folder never exposes another attempt; exact diagnostic report enables video fallback even with stale upload pointer", async () => {
  const folder = original.storagePath;
  const { service, bucket } = setup({ seed: { "failureCases/failure": { playerDocumentID: "player", repId: "rep", storage: { reportPath: "failure_cases/failure/report.json" } } },
    evidence: { ...valid, folder, context: { rep: { playerDocId: "player", repId: "later" } }, identityConflict: true }, objects: {
      [`${folder}/video.mov`]: "wrong movie", [`${folder}/pose.json`]: {},
      "failure_cases/failure/report.json": { clip: { storagePath: `${folder}/video.mov` }, repId: "rep" }, "failure_cases/failure/video.mov": "original movie",
    } });
  const result = await service.getMedia({ playerId: "player", drill: "dribbling", repId: "rep" }, admin);
  assert.equal(result.source, "diagnostic"); assert.match(result.mediaUrl, /failure_cases\/failure\/video.mov/); assert.deepEqual(result.artifactUrls, {});
  assert.deepEqual(bucket.calls.filter(c => c[0] === "sign").map(c => c[1]), ["failure_cases/failure/video.mov"]);
});
test("diagnostic report owner and rep must both agree; client-provided media paths are never used", async () => {
  const { service, bucket } = setup({ seed: { "failureCases/failure": { playerDocumentID: "player", repId: "rep", storage: { reportPath: "failure_cases/failure/report.json", videoPath: "victim/video.mov" } } }, evidence: {}, objects: {
    "failure_cases/failure/report.json": { playerDocumentID: "victim", repId: "rep" }, "failure_cases/failure/video.mov": "private",
  } });
  const result = await service.getMedia({ playerId: "player", drill: "dribbling", repId: "rep", storagePath: "victim/video.mov" }, admin);
  assert.equal(result.source, "unavailable"); assert.deepEqual(bucket.calls.filter(c => c[0] === "sign"), []);
});
test("shared evidence reader detects explicit sidecar identity conflict and pins JSON reads", async () => {
  const folder = original.storagePath;
  const bucket = storage({ [`${folder}/metadata.json`]: valid.metadata, [`${folder}/reprocess_context.json`]: { ...valid.context, rep: { playerDocId: "player", repId: "later" } } });
  const reader = createProcessingEvidenceReader({ db: new FakeFirestore(), bucket, HttpsError });
  const evidence = await reader.readEvidence("player", original);
  assert.equal(evidence.identityConflict, true); assert.equal(effectiveRep(original, evidence, false).resultStatus.qualified, false);
  assert.ok(bucket.calls.filter(c => c[0] === "download").every(c => c[2].generation === "123"));
});
