"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createUserIssues } = require("./user-issues"), M = require("./user-issue-model");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { LIMIT } = require("./user-issue-observations");
const AT = Date.parse("2026-10-02T18:00:00Z");
function fixture() {
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: false, activatedAtMillis: AT - 1000 } });
  const service = createUserIssues({ db, HttpsError, now: () => AT, provider: { send: async () => { throw new Error("No email"); } } });
  const event = patch => M.normalize({ eventId: "client-event", sessionId: "client-session", requestId: "same-request", operation: "submitFeedback", code: "invalid-argument", platform: "web", device: "Desktop browser", build: "web-v1", route: "/admin/athletes?token=secret", ...patch }, AT, true);
  return { db, service, event };
}
test("conflicting action and athlete sharing a request reference remain separate while the original frozen job is preserved", async () => {
  const f = fixture(), who = { uid: "staff", name: null, player: { id: "athlete-a", name: "Original athlete" } };
  const first = await f.service.ingest(f.event(), who, { source: "client", sourceEvent: "client-event" });
  const out = `userIssueOutbox/${first.occurrenceId}`, frozen = { ...M.payload(f.db.snapshot(out), first.occurrenceId), subject: "Original frozen body" };
  await f.db.doc(out).update({ payload: frozen, deliveryProvider: "microsoft", status: "delivered", microsoft: { claimedAtMillis: AT, runId: "consumed" } });
  const originalJob = f.db.snapshot(out), original = f.db.snapshot(`userIssueOccurrences/${first.occurrenceId}`);
  const server = f.event({ eventId: "server-event", platform: "backend", device: "server", build: "server-v2", operation: "submitFeedback-validation" });
  let second;
  for (let i = 0; i < 2; i++) {
    const duplicate = await f.service.ingest(server, { ...who, player: { id: "athlete-b", name: "Other athlete" } }, { source: "cloudLogging", sourceEvent: "insert-one", reference: "logs/insert-one" });
    assert.notEqual(duplicate.occurrenceId, first.occurrenceId);
    if (i === 0) { assert.equal(duplicate.duplicate, undefined); second = duplicate; }
    else { assert.equal(duplicate.duplicate, true); assert.equal(duplicate.occurrenceId, second.occurrenceId); }
  }
  const current = f.db.snapshot(`userIssueOccurrences/${first.occurrenceId}`);
  assert.equal((await f.db.collection("userIssueOccurrences").get()).size, 2); assert.equal((await f.db.collection("userIssueOutbox").get()).size, 2);
  assert.equal((await f.db.doc(`userIssueOccurrences/${first.occurrenceId}`).collection("observations").get()).size, 1);
  assert.deepEqual(current.player, original.player); assert.equal(current.operation, original.operation); assert.equal(current.device, original.device);
  assert.equal(current.sourceObservationSummary.count, 1); assert.equal(current.sourceObservationSummary.evidence[0].route, "/admin/athletes");
  const separate = f.db.snapshot(`userIssueOccurrences/${second.occurrenceId}`);
  assert.equal(separate.operation, "submitFeedback-validation"); assert.equal(separate.player.id, "athlete-b");
  assert.equal(separate.requestCorrelation.primaryOccurrenceId, first.occurrenceId); assert.equal(separate.requestCorrelation.reason, "attempted_action_conflict");
  assert.deepEqual(f.db.snapshot(out), originalJob); assert.equal(f.db.snapshot(`userIssueDays/${M.periodKey(AT)}`).incidents, 2);
});
test("a historical canonical row gains corroboration while its raw evidence stays intact", async () => {
  const f = fixture(), who = { uid: "staff", name: null }, first = await f.service.ingest(f.event(), who, { source: "client", sourceEvent: "client-event" });
  const ref = f.db.doc(`userIssueOccurrences/${first.occurrenceId}`), raw = f.db.snapshot(ref.path);
  delete raw.sourceObservationSummary;
  await ref.set(raw);
  await f.service.ingest(f.event({ eventId: "server", platform: "backend", device: "server" }), who, { source: "cloudLogging", sourceEvent: "insert-two" });
  const value = f.db.snapshot(ref.path);
  assert.equal(value.sourceObservationSummary.count, 2); assert.equal(value.sourceObservationSummary.evidence[0].evidenceType, "historical_canonical");
  const { sourceObservationSummary, ...retained } = value; assert.deepEqual(retained, raw);
});
test("summary is bounded but every distinct source observation remains privately durable", async () => {
  const f = fixture(), who = { uid: "staff", name: null }, first = await f.service.ingest(f.event(), who, { source: "client", sourceEvent: "client-event" });
  for (let i = 0; i < LIMIT + 4; i++) await f.service.ingest(f.event({ eventId: `server-${i}`, platform: "backend" }), who, { source: "cloudLogging", sourceEvent: `insert-${i}` });
  const summary = f.db.snapshot(`userIssueOccurrences/${first.occurrenceId}`).sourceObservationSummary;
  assert.equal(summary.count, LIMIT + 5); assert.equal(summary.evidence.length, LIMIT); assert.equal(summary.truncated, true);
  assert.equal(summary.evidence[0].source, "client"); assert.equal(summary.evidence.at(-1).eventId, `server-${LIMIT + 3}`);
  assert.equal((await f.db.doc(`userIssueOccurrences/${first.occurrenceId}`).collection("observations").get()).size, LIMIT + 5);
});
test("different actors and uncorrelated requests remain separate occurrences", async () => {
  const f = fixture();
  const a = await f.service.ingest(f.event(), { uid: "one", name: null }, { source: "client", sourceEvent: "one" });
  const b = await f.service.ingest(f.event(), { uid: "two", name: null }, { source: "cloudLogging", sourceEvent: "two" });
  const c = await f.service.ingest(f.event({ eventId: "three", requestId: null }), { uid: "one", name: null }, { source: "client", sourceEvent: "three" });
  assert.equal(new Set([a.occurrenceId, b.occurrenceId, c.occurrenceId]).size, 3);
});
