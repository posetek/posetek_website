"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createUserIssues } = require("./user-issues"), { createMicrosoftEmail } = require("./microsoft-email");
const F = require("./user-issue-send-frontier"), M = require("./microsoft-email-model"), U = require("./user-issue-model");
const T = Date.parse("2026-10-05T12:00:00Z"), key = n => n.toString(16).padStart(64, "0"), ROOT = "userIssueOutbox/";
function fixture(at = T + 10000) {
  let time = at;
  const settings = { enabled: true, sendEnabled: true, activatedAtMillis: T - 86400000, sendFromMillis: T, emailProvider: "microsoft",
    notificationPolicy: { schemaVersion: 1, mode: "first_and_daily", activatedAtMillis: T - 3600000 } };
  const config = { enabled: true, connectionVerified: true, activatedAtMillis: T - 86400000, senderMailbox: "alerts@posetek.net" };
  const db = new FakeFirestore({ "userIssueSettings/current": settings, [M.SETTINGS]: config });
  const wakes = [], authReads = [];
  const issues = createUserIssues({ db, HttpsError, now: () => time, logger: { error() {} },
    auth: { getUser: async uid => { authReads.push(uid); return { uid, displayName: "Actual reporter", email: "reporter@example.com", emailVerified: false }; } },
    provider: { send: async (payload, id) => { wakes.push({ payload, id }); return { pending: true }; } } });
  const mail = createMicrosoftEmail({ db, now: () => time, randomToken: () => "b".repeat(64), traceReader: { read: async () => ({ rows: [] }) } });
  const put = async (n, patch = {}) => { const id = key(n), job = { id, type: "status", actorUid: "staff", title: "Current change", lines: ["Current evidence"],
    issueId: key(99999), createdAtMillis: T, dueAtMillis: T, status: "pending", attempts: 0, ...patch }; await db.doc(ROOT + id).set(job); return job; };
  const claim = id => mail.claim({ schemaVersion: 1, kind: "issue", jobId: id, runId: "test-" + id });
  return { db, settings, config, issues, mail, wakes, authReads, put, claim, now: () => time, time: value => { time = value; } };
}
test("frontier includes exact lower bound and rejects invalid/future controls or malformed new job times", () => {
  for (const from of [null, 0, -1, T + 1, "1", 1.5]) assert.equal(F.allows({ sendFromMillis: from }, { type: "status", createdAtMillis: T }, T), false);
  assert.equal(F.allows({ sendFromMillis: T }, { type: "status", createdAtMillis: T }, T), true);
  for (const createdAtMillis of [T - 1, T + 1, undefined, "bad"]) assert.equal(F.allows({ sendFromMillis: T }, { type: "incident", createdAtMillis }, T), false);
  assert.equal(F.allows({}, { type: "status", createdAtMillis: T - 1 }, T), true);
});
test("all historical types/providers are skipped without any job, audit, claim or budget write", async () => {
  const f = fixture(); let n = 1;
  for (const type of ["incident", "status", "daily"]) for (const provider of [null, "resend", "microsoft"]) {
    const payload = { to: [U.TO], subject: "Retained history", text: "Original" }, id = key(n);
    await f.put(n++, { type, createdAtMillis: T - 1, firstAttemptAtMillis: T - 1, attempts: 1,
      ...(provider === "microsoft" ? M.freeze("issue", id, payload, f.config, T - 1) : { deliveryProvider: provider, payload }) });
  }
  const before = M.canonical([...f.db.docs]);
  for (let id = 1; id < n; id++) { await f.issues.dispatch(key(id)); assert.equal((await f.claim(key(id))).allowSend, false); }
  assert.equal(M.canonical([...f.db.docs]), before); assert.equal(f.wakes.length, 0);
});
test("a queued pre-frontier flow is refused even after it froze and before policy or budget writes", async () => {
  const f = fixture(), job = await f.put(1); await f.issues.dispatch(job.id);
  await f.db.doc("userIssueSettings/current").update({ sendFromMillis: T + 1 });
  const before = M.canonical([...f.db.docs]); assert.equal((await f.claim(job.id)).allowSend, false);
  assert.equal(M.canonical([...f.db.docs]), before);
});
test("current first issue names exact reporter, separates target, and routine repeats keep the existing cadence namespace", async () => {
  const f = fixture(), input = { eventId: "first", sessionId: "session", kind: "error", operation: "save_workout", code: "unavailable", playerId: "other" };
  await f.db.doc("players/other").set({ authenticationUID: "someone-else", firstName: "Not", lastName: "Reporter" });
  const first = await f.issues.submit(input, { uid: "reporter" }); await f.issues.dispatch(first.occurrenceId);
  const permission = await f.claim(first.occurrenceId);
  assert.equal(permission.allowSend, true); assert.equal(permission.to, U.TO);
  assert.match(permission.html, /Actual reporter.*reporter/); assert.match(permission.html, /reporter@example.com.*unverified/);
  assert.match(permission.html, /Target athlete: Unknown/); assert.doesNotMatch(permission.html, /Not Reporter/);
  const second = await f.issues.submit({ ...input, eventId: "repeat" }, { uid: "reporter" }); await f.issues.dispatch(second.occurrenceId);
  assert.equal(f.db.snapshot(ROOT + second.occurrenceId).status, "deferred_to_summary");
  assert.deepEqual(f.db.snapshot("userIssueSettings/current"), f.settings); assert.deepEqual(f.authReads, ["reporter"]);
});
test("bounded sweep rotates over post-frontier history and never reads old due jobs or starves new retries", async () => {
  const f = fixture();
  for (let n = 1; n <= 50; n++) await f.put(n, { createdAtMillis: T - 1 });
  const old = [...f.db.docs].filter(([p]) => p.startsWith(ROOT));
  for (let n = 51; n <= 2050; n++) await f.put(n, { status: "accepted", createdAtMillis: T, dueAtMillis: null });
  await f.put(2051, { createdAtMillis: T + 1 });
  const first = await f.issues.sweep(); assert.equal(first.examined, 2000); assert.equal(first.checked, 0); assert.equal(first.complete, false);
  const next = await f.issues.sweep(); assert.equal(next.checked, 1); assert.equal(f.wakes.length, 1); assert.equal(next.complete, true);
  for (const [p, value] of old) assert.deepEqual(f.db.snapshot(p), value);
  for (const query of f.db.queries.filter(q => q.path === "userIssueOutbox")) assert(query.filters.every(([field]) => field === "createdAtMillis"));
});
test("forty eligible sweep limit resumes at the exact tie-breaker without losing remaining jobs", async () => {
  const f = fixture(); for (let n = 1; n <= 55; n++) await f.put(n);
  assert.equal((await f.issues.sweep()).checked, 40); assert.equal((await f.issues.sweep()).checked, 15);
  assert.equal(new Set(f.wakes.map(x => x.id)).size, 55);
});
test("partial first daily window includes only new occurrences/statuses and does not enumerate historical delivery review", async () => {
  const f = fixture(T + 1000), oldId = key(1), issueId = key(99999);
  await f.db.doc(`userIssueOccurrences/${oldId}`).set({ id: oldId, issueId, reporterUid: null, source: "cloudLogging", kind: "error", receivedAtMillis: T - 1 });
  const current = await f.issues.submit({ eventId: "new", sessionId: "session", kind: "error", operation: "save", code: "unavailable" }, { uid: "reporter" });
  await f.put(2, { createdAtMillis: T - 1, status: "failed", deliveryProvider: "resend" }); await f.put(3, { createdAtMillis: T });
  const period = U.periodKey(T), bounds = U.periodBounds(period), historicalId = U.hash(["daily", period]);
  await f.db.doc(`userIssueDays/${period}`).set({ incidents: 2, changes: 2, lastAtMillis: T + 1000 });
  await f.db.doc(ROOT + historicalId).set({ type: "daily", createdAtMillis: T - 1, status: "pending", payload: { text: "Historical" } });
  const old = f.db.snapshot(ROOT + historicalId); f.time(bounds.upper + 1000); await f.issues.daily();
  const id = U.hash(["daily", period, "send-from", T]), job = f.db.snapshot(ROOT + id);
  assert.equal(job.summary.lower, T); assert.equal(job.summary.occurrences, 1); assert.equal(job.summary.statusChanges, 1);
  assert.equal(job.deliveryReview, null); assert.doesNotMatch(job.lines.join("\n"), /across all time|currently await resolution/);
  assert.deepEqual(f.db.snapshot(ROOT + historicalId), old); assert.equal(f.db.snapshot(ROOT + current.occurrenceId).createdAtMillis, T + 1000);
  assert.equal(f.db.queries.some(q => q.path === "userIssueOutbox" && q.filters.some(([field]) => field === "status")), false);
  const before = f.db.snapshot(ROOT + id); await f.issues.daily(); assert.deepEqual(f.db.snapshot(ROOT + id), before);
});
test("daily skips an entirely pre-frontier reporting period and invalid configured frontier", async () => {
  for (const sendFromMillis of [T, T + 1000, null]) {
    const f = fixture(T); await f.db.doc("userIssueSettings/current").update({ sendFromMillis });
    await f.db.doc(`userIssueDays/${U.previousPeriod(T)}`).set({ incidents: 3, changes: 2 });
    const before = M.canonical([...f.db.docs]); await f.issues.daily(); assert.equal(M.canonical([...f.db.docs]), before); assert.equal(f.wakes.length, 0);
  }
});
test("consumed old claim still accepts its genuine receipt; workout permission does not use issue frontier", async () => {
  const f = fixture(), id = key(1), payload = { to: [U.TO], subject: "Historical claimed", text: "Evidence" };
  const old = await f.put(1, { createdAtMillis: T - 1, firstAttemptAtMillis: T - 1, ...M.freeze("issue", id, payload, f.config, T - 1) });
  await f.db.doc(ROOT + id).update({ microsoft: { ...old.microsoft, claimedAtMillis: T - 1, runId: "old-run", claimTokenHash: M.hash("b".repeat(64)) } });
  assert.equal((await f.mail.receipt({ schemaVersion: 1, kind: "issue", jobId: id, runId: "old-run", claimToken: "b".repeat(64), outcome: "accepted" })).recorded, true);
  const workoutId = key(2) + "_terminal", logPath = "players/person/workoutLogs/log", log = { completed: true, activeSeconds: 5 };
  await f.db.doc(logPath).set(log); await f.db.doc("workoutNotificationSettings/current").set({ enabled: true, sendEnabled: true, activatedAtMillis: T - 86400000 });
  await f.db.doc("workoutNotificationOutbox/" + workoutId).set({ eventType: "terminal", playerId: "person", source: "workoutLogs", logId: "log", createdAtMillis: T - 1, firstAttemptAtMillis: T - 1, status: "pending",
    ...M.freeze("workout", workoutId, payload, f.config, T - 1, { logPath, fingerprint: require("./workout-notifications").savedFingerprint(log) }) });
  assert.equal((await f.mail.claim({ schemaVersion: 1, kind: "workout", jobId: workoutId, runId: "workout-run" })).allowSend, true);
});
