"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createUserIssues } = require("./user-issues"), { createIssueSources } = require("./user-issue-sources");
const { observeSocialCallable } = require("./social-callable-observation");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const M = require("./user-issue-model"), Identity = require("./user-issue-request-identity");
const AT = Date.parse("2026-10-03T02:30:00Z"), STAFF = { uid: "staff", email: "staff@posetek.net", emailVerified: true };
function fixture() {
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: false, activatedAtMillis: AT - 1000 },
    "players/athlete-a": { authenticationUID: "different-a", firstName: "Target", lastName: "A" },
    "players/athlete-b": { authenticationUID: "different-b", firstName: "Target", lastName: "B" } });
  const service = createUserIssues({ db, HttpsError, now: () => AT, provider: { send: () => assert.fail("No mail in intake tests") } });
  return { db, service, sources: createIssueSources(service, db, () => AT) };
}
const event = patch => ({ eventId: "client-one", sessionId: "session-one", requestId: "recorded-request", operation: "getSocialFeed",
  code: "unavailable", device: "Browser", build: "web", platform: "web", ...patch });
const row = (f, value) => f.db.snapshot(`userIssueOccurrences/${value.occurrenceId}`);
const jobs = f => f.db.collection("userIssueOutbox").get();
const ingest = (f, patch = {}, who = { uid: "staff", player: null }, source = "cloudLogging", sourceEvent = "server-one") =>
  f.service.ingest(M.normalize(event({ eventId: sourceEvent, platform: "backend", ...patch }), AT, true), who, { source, sourceEvent });
async function logFailure(f, endpoint, requestId, insertId) {
  const logs = [], observed = observeSocialCallable({ endpoint, requireCaller: c => c.auth, HttpsError, now: () => AT,
    logger: { info: () => {}, error: value => logs.push(value) }, handler: async () => { throw new HttpsError("unavailable", "Temporary"); } });
  await assert.rejects(observed({ requestId }, { auth: STAFF }), { code: "unavailable" });
  return f.sources.log({ json: { logName: "projects/kickai-69dd0/logs/cloudfunctions.googleapis.com%2Fcloud-functions", insertId,
    severity: "ERROR", timestamp: new Date(AT).toISOString(), receiveTimestamp: new Date(AT).toISOString(),
    resource: { type: "cloud_function", labels: { function_name: endpoint } }, jsonPayload: logs[0] } });
}
test("two actual callable endpoints sharing a caller request reference produce separate attempts with stable replays", async () => {
  const f = fixture(), a = await logFailure(f, "getSocialFeed", "recorded-request", "log-feed"), b = await logFailure(f, "saveSocialComment", "recorded-request", "log-comment");
  assert.notEqual(a.occurrenceId, b.occurrenceId); assert.equal(row(f, b).operation, "saveSocialComment");
  assert.equal(row(f, b).requestCorrelation.reason, "attempted_action_conflict");
  const replay = await logFailure(f, "saveSocialComment", "recorded-request", "log-comment");
  assert.equal(replay.duplicate, true); assert.equal(replay.occurrenceId, b.occurrenceId); assert.equal((await jobs(f)).size, 2);
});
test("all fourteen supported callable endpoints retain exact actor/request server-client correlation", async () => {
  const endpoints = ["getSocialAdminDirectory", "getSocialContext", "getSocialFeed", "getSocialActivity", "saveSocialPreferences", "setSocialVisibility",
    "getSocialPeople", "socialConnection", "setSocialKudos", "getSocialComments", "saveSocialComment", "reportSocialActivity", "moderateSocialActivity", "getSocialMedia"];
  for (const endpoint of endpoints) {
    const f = fixture(), a = await logFailure(f, endpoint, "recorded-request", "log-one"),
      b = await f.service.submit(event({ operation: endpoint, playerId: "athlete-a" }), STAFF);
    assert.equal(b.occurrenceId, a.occurrenceId, endpoint); assert.equal(b.duplicate, true, endpoint);
    assert.equal(row(f, a).sourceObservationSummary.count, 2, endpoint); assert.equal((await jobs(f)).size, 1, endpoint);
  }
});
for (const serverFirst of [true, false]) test(`exact endpoint actor/request client-server corroboration remains one attempt (${serverFirst ? "server" : "client"} first)`, async () => {
  const f = fixture(), actions = [() => ingest(f), () => f.service.submit(event({ playerId: "athlete-a" }), STAFF)];
  const a = await actions[serverFirst ? 0 : 1](), b = await actions[serverFirst ? 1 : 0]();
  assert.equal(b.duplicate, true); assert.equal(b.occurrenceId, a.occurrenceId); assert.equal((await jobs(f)).size, 1);
  assert.equal(row(f, a).sourceObservationSummary.count, 2);
  const catalog = f.db.snapshot(`userIssueRequestIdentities/${a.occurrenceId}`);
  assert.equal(catalog.branches[0].targetId, "athlete-a");
});
test("initial unknown server target binds to the first known athlete; a different known athlete and later unknown source stay separate", async () => {
  const f = fixture(), server = await ingest(f), a = await f.service.submit(event({ playerId: "athlete-a" }), STAFF),
    b = await f.service.submit(event({ eventId: "client-two", playerId: "athlete-b" }), STAFF), unknown = await ingest(f, {}, undefined, "cloudLogging", "server-later");
  assert.equal(a.occurrenceId, server.occurrenceId); assert.notEqual(b.occurrenceId, a.occurrenceId);
  assert.equal(row(f, b).requestCorrelation.reason, "target_athlete_conflict");
  assert.notEqual(unknown.occurrenceId, a.occurrenceId); assert.notEqual(unknown.occurrenceId, b.occurrenceId);
  assert.equal(row(f, unknown).player, null); assert.equal(row(f, unknown).requestCorrelation.reason, "target_ambiguous");
  assert.equal((await jobs(f)).size, 3);
  // Durable source claims preserve earlier attachments after ambiguity appears.
  for (const action of [() => ingest(f), () => f.service.submit(event({ playerId: "athlete-a" }), STAFF),
    () => f.service.submit(event({ eventId: "client-two", playerId: "athlete-b" }), STAFF), () => ingest(f, {}, undefined, "cloudLogging", "server-later")]) assert.equal((await action()).duplicate, true);
  const nextA = await f.service.submit(event({ eventId: "client-three", playerId: "athlete-a" }), STAFF);
  assert.equal(nextA.occurrenceId, a.occurrenceId); assert.equal((await jobs(f)).size, 3);
});
test("known targets against the same endpoint remain separate without altering historical payloads or consumed send claims", async () => {
  const f = fixture(), a = await f.service.submit(event({ playerId: "athlete-a" }), STAFF), out = `userIssueOutbox/${a.occurrenceId}`;
  await f.db.doc(out).update({ payload: { ...M.payload(f.db.snapshot(out), a.occurrenceId), subject: "Frozen historical" }, status: "delivered",
    microsoft: { claimedAtMillis: AT - 1, runId: "consumed-send", claimDigest: "a".repeat(64) }, recipientDelivery: { "staff@posetek.net": { status: "delivered" } } });
  const before = f.db.snapshot(out), raw = row(f, a), b = await f.service.submit(event({ eventId: "second", playerId: "athlete-b" }), STAFF);
  assert.notEqual(a.occurrenceId, b.occurrenceId); assert.equal(row(f, b).player.id, "athlete-b");
  assert.deepEqual(f.db.snapshot(out), before); assert.deepEqual(row(f, a), raw);
  assert.equal((await f.service.submit(event({ playerId: "athlete-a" }), STAFF)).occurrenceId, a.occurrenceId);
  assert.equal(f.db.snapshot(`userIssueDays/${M.periodKey(AT)}`).incidents, 2);
});
test("anonymous diagnostics need the same recorded session and source; a mismatched source is retained rather than dropped", async () => {
  const f = fixture(), who = { uid: null, player: { id: "athlete-a", name: "Target A" } };
  const a = await ingest(f, { kind: "diagnostic", operation: "system_diagnostic", sessionId: "launch-a" }, who, "failureCases", "case-a"),
    b = await ingest(f, { kind: "diagnostic", operation: "system_diagnostic", sessionId: "launch-b" }, who, "failureCases", "case-b"),
    differentSource = await ingest(f, { kind: "diagnostic", operation: "system_diagnostic", sessionId: "launch-a" }, who, "fieldReports", "case-c");
  assert.equal(new Set([a.occurrenceId, b.occurrenceId, differentSource.occurrenceId]).size, 3);
  for (const value of [a, b, differentSource]) {
    assert.equal(row(f, value).reporterUid, null); assert.equal(row(f, value).sourceObservationSummary.count, 1);
    assert.equal((await f.db.collection(`userIssueOccurrences/${value.occurrenceId}/observations`).get()).size, 1);
  }
  const same = await ingest(f, { kind: "diagnostic", operation: "system_diagnostic", sessionId: "launch-b" }, who, "failureCases", "case-b-extra");
  assert.equal(same.occurrenceId, b.occurrenceId); assert.equal(same.duplicate, true); assert.equal(row(f, b).sourceObservationSummary.count, 2);
  assert.equal((await jobs(f)).size, 3);
});
test("actual legacy diagnostic documents with two launches retain both original source records", async () => {
  const f = fixture(), values = [];
  for (const [id, launchId] of [["case-a", "launch-a"], ["case-b", "launch-b"]]) {
    const ref = f.db.doc(`failureCases/${id}`);
    await ref.set({ playerId: "athlete-a", kind: "system_diagnostic", requestId: "recorded-request", launchId, createdAt: AT });
    values.push(await f.sources.document("failureCases", await ref.get(), { timestamp: new Date(AT).toISOString() }));
  }
  assert.notEqual(values[0].occurrenceId, values[1].occurrenceId); assert.equal((await jobs(f)).size, 2);
  assert.deepEqual(values.map(value => row(f, value).sourceReference), ["failureCases/case-a", "failureCases/case-b"]);
  assert.deepEqual(values.map(value => row(f, value).reporterUid), [null, null]);
});
test("legacy primary IDs and original observations survive registry initialization; conflicting historical summaries are not guessed", async () => {
  const f = fixture(), a = await f.service.submit(event({ playerId: "athlete-a" }), STAFF), expected = M.hash([STAFF.uid, "request:recorded-request"]);
  assert.equal(a.occurrenceId, expected);
  const primary = row(f, a), originalJob = f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`);
  await f.db.doc(`userIssueRequestIdentities/${a.occurrenceId}`).delete();
  for (const doc of (await f.db.collection("userIssueSourceClaims").get()).docs) await doc.ref.delete();
  await f.db.doc(`userIssueOccurrences/${a.occurrenceId}`).update({ sourceObservationSummary: { ...primary.sourceObservationSummary, count: 2,
    evidence: [...primary.sourceObservationSummary.evidence, { ...primary.sourceObservationSummary.evidence[0], player: { id: "athlete-b", name: "Target B" } }] } });
  const historical = row(f, a), replay = await f.service.submit(event({ playerId: "athlete-a" }), STAFF);
  assert.equal(replay.occurrenceId, expected); assert.equal(replay.duplicate, true);
  const fresh = await f.service.submit(event({ eventId: "fresh-a", playerId: "athlete-a" }), STAFF);
  assert.notEqual(fresh.occurrenceId, expected); assert.equal(row(f, fresh).requestCorrelation.reason, "historical_request_conflict");
  assert.deepEqual(row(f, a), historical); assert.deepEqual(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`), originalJob);
});
test("different authenticated accounts never share a request branch, and source replay cannot change its frozen identity", async () => {
  const f = fixture(), a = await f.service.submit(event(), STAFF), b = await f.service.submit(event(), { uid: "other" });
  assert.notEqual(a.occurrenceId, b.occurrenceId);
  const prior = row(f, a), changedReplay = await f.service.submit(event({ operation: "saveSocialComment", playerId: "athlete-b" }), STAFF);
  assert.equal(changedReplay.occurrenceId, a.occurrenceId); assert.equal(changedReplay.duplicate, true); assert.deepEqual(row(f, a), prior);
});
test("registry storage remains bounded; overflow retains uncertain sources separately and exact replays consume no new job", async () => {
  const f = fixture(), first = await ingest(f, { operation: "op-0" }, undefined, "cloudLogging", "log-0");
  for (let i = 1; i < Identity.LIMIT + 3; i++) await ingest(f, { operation: `op-${i}` }, undefined, "cloudLogging", `log-${i}`);
  const catalog = f.db.snapshot(`userIssueRequestIdentities/${first.occurrenceId}`);
  assert.equal(catalog.branches.length, Identity.LIMIT); assert.equal(catalog.overflow, true);
  const extra = await ingest(f, { operation: "op-0" }, undefined, "cloudLogging", "new-uncertain-source");
  assert.notEqual(extra.occurrenceId, first.occurrenceId); assert.equal(row(f, extra).requestCorrelation.reason, "registry_capacity_reached");
  const before = (await jobs(f)).size, replay = await ingest(f, { operation: "op-0" }, undefined, "cloudLogging", "new-uncertain-source");
  assert.equal(replay.occurrenceId, extra.occurrenceId); assert.equal(replay.duplicate, true); assert.equal((await jobs(f)).size, before);
});
test("generic application operations without exact action evidence are not automatically correlated", async () => {
  const f = fixture(), a = await ingest(f, { operation: "application" }, undefined, "cloudLogging", "generic-one"), b = await ingest(f, { operation: "application" }, undefined, "cloudLogging", "generic-two");
  assert.notEqual(a.occurrenceId, b.occurrenceId); assert.equal(row(f, b).requestCorrelation.reason, "request_evidence_unconfirmed");
});
test("concurrent retries create one source claim, occurrence and send job", async () => {
  const f = fixture(), results = await Promise.all([f.service.submit(event(), STAFF), f.service.submit(event(), STAFF)]);
  assert.equal(results[0].occurrenceId, results[1].occurrenceId); assert.equal((await jobs(f)).size, 1);
  assert.equal((await f.db.collection("userIssueSourceClaims").get()).size, 1);
});
test("routing and corroboration perform every transaction read before its writes", async () => {
  const f = fixture(), run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = handler => run(async tx => {
    let written = false;
    for (const method of ["create", "set", "update", "delete"]) {
      const original = tx[method].bind(tx); tx[method] = (...args) => { written = true; return original(...args); };
    }
    for (const method of ["get", "getAll"]) {
      const original = tx[method].bind(tx); tx[method] = (...args) => { assert.equal(written, false, "Firestore transactions require reads before writes"); return original(...args); };
    }
    return handler(tx);
  });
  await ingest(f); await f.service.submit(event({ playerId: "athlete-a" }), STAFF);
  await f.service.submit(event({ eventId: "other-target", playerId: "athlete-b" }), STAFF);
  await ingest(f, {}, undefined, "cloudLogging", "unknown-source");
  await f.service.submit(event({ playerId: "athlete-a" }), STAFF);
});
