"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createUserIssues, RETRY } = require("./user-issues");
const { createIssueSources } = require("./user-issue-sources");
const M = require("./user-issue-model");
const { createResendProvider } = require("./workout-notifications-provider");
const AT = Date.parse("2026-09-30T18:00:00Z"), ADMIN = { uid: "admin", email: "dylank@posetek.net", emailVerified: true };
const input = (patch = {}) => ({ eventId: "event-a", sessionId: "session-a", kind: "error", platform: "web", operation: "save_workout", code: "unavailable", occurredAtMillis: AT, ...patch });
function fixture() {
  let time = AT;
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: true, activatedAtMillis: AT - 1000 },
    "players/player": { authenticationUID: "athlete", firstName: "Sample", lastName: "Player" } });
  const sends = [], errors = [];
  const provider = { send: async (payload, key) => { sends.push({ payload, key }); return { id: "email-1" }; } };
  const service = createUserIssues({ db, HttpsError, provider, now: () => time, logger: { error: (...args) => errors.push(args) } });
  return { db, service, provider, sends, errors, advance: ms => { time += ms; }, now: () => time };
}
test("disabled or future settings do not create incidents; pilot excludes unrelated users", async () => {
  for (const settings of [{}, { enabled: true, activatedAtMillis: AT + 1 }, { enabled: true, activatedAtMillis: AT - 1, testUids: [] }, { enabled: true, activatedAtMillis: AT - 1, testUids: ["other"] }]) {
    const f = fixture(); await f.db.doc("userIssueSettings/current").set(settings);
    assert.deepEqual(await f.service.submit(input(), { uid: "athlete" }), { status: "disabled" });
    assert.equal([...f.db.docs.keys()].some(p => p.startsWith("userIssues/")), false);
  }
});
test("one distinct incident per affected user; retries and client/server copies cannot duplicate mail", async () => {
  const f = fixture(), event = input({ requestId: "request-123" });
  const a = await f.service.submit(event, { uid: "athlete" }), duplicate = await f.service.submit(event, { uid: "athlete" });
  const server = await f.service.ingest(M.normalize({ ...event, platform: "backend" }, AT, true), { uid: "athlete" }, { source: "backend", sourceEvent: "different" });
  const other = await f.service.submit(event, { uid: "other" });
  assert.equal(duplicate.occurrenceId, a.occurrenceId); assert.equal(server.occurrenceId, a.occurrenceId); assert.notEqual(other.occurrenceId, a.occurrenceId);
  await Promise.all([f.service.dispatch(a.occurrenceId), f.service.dispatch(a.occurrenceId)]);
  assert.equal(f.sends.length, 1); assert.equal(f.db.snapshot(`userIssues/${a.reference}`).occurrences, 2);
});
test("another failed attempt sends separately even for same user and issue", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" }), b = await f.service.submit(input({ eventId: "event-b" }), { uid: "athlete" });
  assert.equal(a.reference, b.reference); assert.notEqual(a.occurrenceId, b.occurrenceId);
  await f.service.dispatch(a.occurrenceId); await f.service.dispatch(b.occurrenceId); assert.equal(f.sends.length, 2);
});
test("untrusted clients cannot claim another reporter, athlete or confirmed crash", async () => {
  const f = fixture(); const a = await f.service.submit(input({ kind: "crash", playerId: "player", reporterUid: "athlete" }), { uid: "stranger" });
  const record = f.db.snapshot(`userIssueOccurrences/${a.occurrenceId}`);
  assert.equal(record.reporterUid, "stranger"); assert.equal(record.player, null); assert.equal(record.kind, "error");
  const own = await f.service.submit(input({ eventId: "event-own", playerId: "player" }), { uid: "athlete" });
  assert.equal(f.db.snapshot(`userIssueOccurrences/${own.occurrenceId}`).player.name, "Sample Player");
});

test("queued reports cannot be attributed to a different signed-in account", async () => {
  const f = fixture();
  await assert.rejects(f.service.submit(input({ ownerUid: "athlete" }), { uid: "other" }), { code: "failed-precondition" });
  await assert.rejects(f.service.submit(input({ ownerUid: null }), { uid: "athlete" }), { code: "failed-precondition" });
  assert.equal((await f.service.submit(input({ ownerUid: "athlete" }), { uid: "athlete" })).status, "received");
});

test("contradictory athlete ownership cannot add another athlete's identity", async () => {
  const f = fixture();
  await f.db.doc("players/player").update({ userUID: "different-user" });
  const row = await f.service.submit(input({ playerId: "player" }), { uid: "athlete" });
  assert.equal(f.db.snapshot(`userIssueOccurrences/${row.occurrenceId}`).player, null);
});

test("same-clock triage changes still reject a stale update", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" });
  await f.service.triage({ issueId: a.reference, expectedUpdatedAtMillis: AT, state: "investigating" }, ADMIN);
  await assert.rejects(f.service.triage({ issueId: a.reference, expectedUpdatedAtMillis: AT, state: "dismissed" }, ADMIN), { code: "aborted" });
});

test("the log adapter ignores its own pipeline and requires fresh receipt evidence", async () => {
  const f = fixture(), source = createIssueSources(f.service, f.db, f.now);
  await source.log({ json: { logName: "projects/kickai-69dd0/logs/stderr", resource: { type: "cloud_function", labels: { function_name: "observeIssueLog" } }, severity: "ERROR", insertId: "log-1" } });
  const crash = { logName: "projects/kickai-69dd0/logs/firebasecrashlytics.googleapis.com%2Fevents", jsonPayload: { eventId: "crash-1", sessionId: "session", platform: "IOS", threads: [{ crashed: true }], customKeys: { reporter_uid: "athlete" } } };
  await source.log({ json: crash });
  assert.equal([...f.db.docs.keys()].some(p => p.startsWith("userIssues/")), false);
  crash.jsonPayload.receivedTime = new Date(AT).toISOString();
  const result = await source.log({ json: crash });
  assert.equal(f.db.snapshot(`userIssueOccurrences/${result.occurrenceId}`).kind, "crash");
  await source.log({ json: crash });
  assert.equal(f.db.snapshot(`userIssues/${result.reference}`).occurrences, 1);
});
test("manual report evidence is private and excluded from mail; forged screenshots rejected", async () => {
  const f = fixture(); const a = await f.service.submit(input({ kind: "report", description: "My private account detail: athlete@example.com" }), { uid: "athlete" });
  await f.service.dispatch(a.occurrenceId);
  assert.equal(JSON.stringify(f.sends[0]).includes("My private account"), false);
  assert.deepEqual(f.sends[0].payload.to, M.RECIPIENTS); assert.equal(f.sends[0].payload.from, M.FROM);
  await assert.rejects(f.service.submit(input({ kind: "report", description: "A screenshot", screenshot: "data:image/svg+xml;base64,PHN2Zz4=" }), { uid: "athlete" }), { code: "invalid-argument" });
  await assert.rejects(f.service.list({}, { uid: "athlete" }), { code: "permission-denied" });
  await assert.rejects(f.service.list({ evidenceId: a.occurrenceId }, null), { code: "permission-denied" });
});
test("anonymous intake uses server-side limits; retrying same event consumes no extra quota", async () => {
  const f = fixture(); for (let i = 0; i < 15; i++) await f.service.submit(input({ eventId: `event-${i}` }), null, "test-ip");
  assert.equal((await f.service.submit(input({ eventId: "event-0" }), null, "test-ip")).duplicate, true);
  await assert.rejects(f.service.submit(input({ eventId: "event-over" }), null, "test-ip"), { code: "resource-exhausted" });
});
test("ambiguous retries preserve exact payload and key; never retry after provider window", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" });
  f.provider.send = async (payload, key) => { f.sends.push({ payload, key }); throw Object.assign(new Error("uncertain"), { permanent: false }); };
  await f.service.dispatch(a.occurrenceId); f.advance(60001); await f.service.dispatch(a.occurrenceId);
  assert.deepEqual(f.sends[0], f.sends[1]); f.advance(RETRY); await f.service.dispatch(a.occurrenceId);
  assert.equal(f.sends.length, 2); assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "needs_review");
});
test("signed delivery callback can beat send acknowledgement and is idempotent", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" });
  const event = { type: "email.delivered", created_at: new Date(AT).toISOString(), data: { email_id: "email-1", from: M.FROM, to: [M.TO], tags: { posetek_issue_outbox: a.occurrenceId } } };
  f.provider.send = async () => {
    for (const to of M.RECIPIENTS) await f.service.webhook({ id: `receipt-${to}`, event: { ...event, data: { ...event.data, to: [to] } } });
    return { id: "email-1" };
  };
  await f.service.dispatch(a.occurrenceId); await f.service.webhook({ id: "receipt", event });
  assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "delivered");
  await f.service.webhook({ id: "sent", event: { ...event, type: "email.sent", created_at: new Date(AT + 1).toISOString() } });
  assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "delivered");
});
test("historical three-recipient sends keep separate delivery evidence after recipient removal", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" });
  const jobRef = f.db.doc(`userIssueOutbox/${a.occurrenceId}`);
  await jobRef.update({ deliveryProvider: "resend", payload: { ...M.payload(f.db.snapshot(jobRef.path), a.occurrenceId),
    to: [M.TO, "nolanj@posetek.net", "taiyow@posetek.net"] }, status: "accepted", firstAttemptAtMillis: AT,
    attempts: 1, acceptedAtMillis: AT, providerId: "email-1", dueAtMillis: null });
  const deliver = async (to, type, millis) => f.service.webhook({ id: `${to}-${type}-${millis}`, event: {
    type, created_at: new Date(millis).toISOString(), data: { email_id: "email-1", from: M.FROM, to: [to], tags: { posetek_issue_outbox: a.occurrenceId } },
  } });
  await deliver(M.TO, "email.delivered", AT + 300);
  assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "accepted");
  // A late-arriving event for another recipient must not be discarded by Dylan's later clock.
  await deliver("nolanj@posetek.net", "email.bounced", AT + 100);
  await deliver("taiyow@posetek.net", "email.delivered", AT + 200);
  await deliver("nolanj@posetek.net", "email.sent", AT + 400);
  const job = f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`);
  assert.equal(job.status, "bounced"); assert.equal(job.recipientDelivery[M.TO].status, "delivered");
  assert.equal(job.recipientDelivery["nolanj@posetek.net"].status, "bounced");
  assert.equal(job.recipientDelivery["taiyow@posetek.net"].status, "delivered");
  assert.equal(f.sends.length, 0, "historical callbacks do not replay an old send");
});
test("old frozen Dylan-only sends retain payload/key and accept only their original recipient", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" });
  const frozen = { ...M.payload(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`), a.occurrenceId), to: [M.TO] };
  await f.db.doc(`userIssueOutbox/${a.occurrenceId}`).update({ payload: frozen });
  await f.service.dispatch(a.occurrenceId);
  assert.deepEqual(f.sends[0], { payload: frozen, key: `posetek-user-issue/${a.occurrenceId}` });
  const event = { type: "email.delivered", created_at: new Date(AT).toISOString(), data: { email_id: "email-1", from: M.FROM, to: ["nolanj@posetek.net"], tags: { posetek_issue_outbox: a.occurrenceId } } };
  await f.service.webhook({ id: "not-original", event });
  assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "accepted");
  event.data.to = [M.TO]; await f.service.webhook({ id: "original", event });
  assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "delivered");
});
test("issue provider allows only approved recipients and leaves workout provider Dylan-only", async () => {
  let calls = 0;
  const options = { apiKey: () => "fixture-only", fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ id: "email-test" }) }; } };
  const issue = createResendProvider({ ...options, from: M.FROM, recipients: M.RECIPIENTS });
  const payload = M.payload({ title: "Sample", lines: [] }, "fixture");
  await issue.send(payload, "new"); await issue.send({ ...payload, to: [M.TO] }, "legacy");
  for (const bad of [{ to: [...M.RECIPIENTS, "other@example.com"] }, { to: [M.TO, M.TO] }, { cc: ["other@example.com"] }, { bcc: ["other@example.com"] }]) {
    await assert.rejects(issue.send({ ...payload, ...bad }, "invalid"), { code: "recipient_invalid" });
  }
  const workout = createResendProvider(options);
  await assert.rejects(workout.send({ ...payload, to: ["nolanj@posetek.net"], from: "PoseTek Workouts <workouts@alerts.posetek.net>" }, "workout"), { code: "recipient_invalid" });
  assert.equal(calls, 2);
});
test("a wrong recipient delivery event cannot settle a queued message", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" }); await f.service.dispatch(a.occurrenceId);
  await f.service.webhook({ id: "receipt", event: { type: "email.delivered", created_at: new Date(AT).toISOString(), data: { email_id: "email-1", from: M.FROM, to: ["other@example.com"], tags: { posetek_issue_outbox: a.occurrenceId } } } });
  assert.equal(f.db.snapshot(`userIssueOutbox/${a.occurrenceId}`).status, "accepted");
});
test("triage requires evidence and concurrency token, sends status change, recurrence reopens", async () => {
  const f = fixture(), a = await f.service.submit(input(), { uid: "athlete" }); f.advance(1);
  await assert.rejects(f.service.triage({ issueId: a.reference, state: "verified", expectedUpdatedAtMillis: AT }, ADMIN), { code: "invalid-argument" });
  await f.service.triage({ issueId: a.reference, state: "verified", fixRef: "commit-abc", verification: "Replayed save on release abc", expectedUpdatedAtMillis: AT }, ADMIN);
  await assert.rejects(f.service.triage({ issueId: a.reference, state: "investigating", expectedUpdatedAtMillis: AT }, ADMIN), { code: "aborted" });
  f.advance(1); await f.service.submit(input({ eventId: "recurrence" }), { uid: "athlete" });
  assert.equal(f.db.snapshot(`userIssues/${a.reference}`).state, "new");
});
test("daily summaries are idempotent, skip empty reporting periods and use Pacific DST boundaries", async () => {
  assert.equal(M.periodKey(Date.parse("2026-03-08T15:59:00Z")), "2026-03-07");
  assert.equal(M.periodKey(Date.parse("2026-03-08T16:00:00Z")), "2026-03-08");
  assert.equal(M.periodKey(Date.parse("2026-11-01T16:59:00Z")), "2026-10-31");
  assert.equal(M.periodKey(Date.parse("2026-11-01T17:00:00Z")), "2026-11-01");
  const f = fixture(); await f.service.daily(); assert.equal(f.sends.length, 0);
  await f.service.submit(input(), { uid: "athlete" }); f.advance(86400000); await f.service.daily(); await f.service.daily(); assert.equal(f.sends.length, 1);
});
test("old server receipts cannot backfill while delayed new receipts keep actual occurrence time", async () => {
  const f = fixture(), event = M.normalize(input({ occurredAtMillis: AT - 86400000 }), AT, true);
  assert.equal((await f.service.ingest(event, { uid: "athlete" }, { source: "test", sourceEvent: "old", receivedAtMillis: AT - 2000 })).status, "disabled");
  const a = await f.service.ingest(event, { uid: "athlete" }, { source: "test", sourceEvent: "new", receivedAtMillis: AT });
  assert.equal(f.db.snapshot(`userIssueOccurrences/${a.occurrenceId}`).occurredAtMillis, AT - 86400000);
});
test("AI projection is covered; correlated phone halves and tests are not mailed twice", async () => {
  const f = fixture(), sources = createIssueSources(f.service, f.db, f.now);
  const doc = { requestedByUid: "athlete", playerId: "player", kind: "failure", requestId: "job-a", jobId: "job-a", code: "internal", capability: "training" };
  await f.db.doc("aiIncidents/job-a").set(doc);
  await sources.document("aiIncidents", await f.db.doc("aiIncidents/job-a").get(), { timestamp: new Date(AT).toISOString() });
  await f.db.doc("aiIncidents/client-a").set(doc);
  await sources.document("aiIncidents", await f.db.doc("aiIncidents/client-a").get(), { timestamp: new Date(AT).toISOString() });
  assert.equal((await f.db.collection("userIssueOutbox").get()).size, 1);
});
