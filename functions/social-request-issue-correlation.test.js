"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { observeSocialCallable } = require("./social-callable-observation");
const { createUserIssues } = require("./user-issues");
const { createIssueSources } = require("./user-issue-sources");
const AT = Date.parse("2026-10-03T01:00:00Z");
test("the actual correlated server log and client queue copy are one attempt; a new request stays distinct", async () => {
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, activatedAtMillis: AT - 1000 },
    "players/target-player": { authenticationUID: "different-athlete", firstName: "Target", lastName: "Athlete" } });
  const service = createUserIssues({ db, HttpsError, now: () => AT });
  const sources = createIssueSources(service, db, () => AT), logs = [];
  const observed = observeSocialCallable({ endpoint: "getSocialFeed", requireCaller: c => c.auth, HttpsError, now: () => AT,
    logger: { info: () => {}, error: payload => logs.push(payload) }, handler: async () => { throw new HttpsError("unavailable", "Retry later"); } });
  await assert.rejects(observed({ requestId: "request-one", reporterUid: "forged-athlete" }, { auth: { uid: "exact-staff" } }), { code: "unavailable" });
  const ingest = (payload, insertId) => sources.log({ json: { logName: "projects/kickai-69dd0/logs/cloudfunctions.googleapis.com%2Fcloud-functions",
    insertId, severity: "ERROR", timestamp: new Date(AT).toISOString(), receiveTimestamp: new Date(AT).toISOString(),
    resource: { type: "cloud_function", labels: { function_name: "getSocialFeed" } }, jsonPayload: payload } });
  const first = await ingest(logs[0], "log-one");
  const client = { eventId: "web-error-one", sessionId: "web-session", platform: "web", kind: "error", operation: "getSocialFeed", code: "functions/unavailable",
    requestId: "request-one", playerId: "target-player", device: "Safari iPhone", route: "/feed", build: "source-build", occurredAtMillis: AT };
  const copy = await service.submit(client, { uid: "exact-staff", email: "dylank@posetek.net", emailVerified: true });
  assert.equal(copy.duplicate, true); assert.equal(copy.occurrenceId, first.occurrenceId);
  const canonical = db.snapshot(`userIssueOccurrences/${first.occurrenceId}`);
  assert.equal(canonical.reporterUid, "exact-staff"); assert.equal(canonical.player, null); assert.equal(canonical.device, "server");
  assert.equal(canonical.sourceObservationSummary.count, 2); assert.equal(canonical.sourceObservationSummary.truncated, false);
  const browserEvidence = canonical.sourceObservationSummary.evidence.find(item => item.source === "client");
  assert.deepEqual({ actor: browserEvidence.actorUid, target: browserEvidence.player.id, build: browserEvidence.build, device: browserEvidence.device, route: browserEvidence.route },
    { actor: "exact-staff", target: "target-player", build: "source-build", device: "Safari iPhone", route: "/feed" });
  assert.deepEqual(browserEvidence.conflictsWithCanonical, []);
  assert.deepEqual(browserEvidence.additionalContext, ["target_athlete"]);
  const observations = await db.collection(`userIssueOccurrences/${first.occurrenceId}/observations`).get();
  assert.equal(observations.size, 2); assert.deepEqual(observations.docs.map(doc => doc.data().source).sort(), ["client", "cloudLogging"]);
  assert.equal((await db.collection("userIssueOutbox").get()).size, 1);
  // Repeated acknowledgements cannot add observations, overwrite their private
  // evidence, alter the canonical athlete, or create another permission to send.
  const before = JSON.stringify(observations.docs.map(doc => doc.data()));
  await service.submit({ ...client, device: "changed-on-replay" }, { uid: "exact-staff", email: "dylank@posetek.net", emailVerified: true });
  assert.equal(JSON.stringify((await db.collection(`userIssueOccurrences/${first.occurrenceId}/observations`).get()).docs.map(doc => doc.data())), before);
  assert.equal(db.snapshot(`userIssueOccurrences/${first.occurrenceId}`).sourceObservationSummary.count, 2);
  const next = await ingest({ ...logs[0], requestId: "request-two" }, "log-two");
  assert.notEqual(next.occurrenceId, first.occurrenceId);
  assert.equal((await db.collection("userIssueOccurrences").get()).size, 2);
  assert.equal((await db.collection("userIssueOutbox").get()).size, 2);
});
