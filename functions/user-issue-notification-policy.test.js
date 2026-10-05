"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createUserIssues } = require("./user-issues");
const { createMicrosoftEmail } = require("./microsoft-email");
const { reportingSummary } = require("./user-issue-summary");
const Policy = require("./user-issue-notification-policy");
const M = require("./microsoft-email-model");
const AT = Date.parse("2026-10-04T05:00:00Z"), ADMIN = { uid: "staff", email: "dylank@posetek.net", emailVerified: true };
function fixture() {
  let at = AT;
  const settings = { enabled: true, sendEnabled: true, activatedAtMillis: AT - 1000, emailProvider: "microsoft",
    notificationPolicy: { schemaVersion: 1, mode: Policy.MODE, activatedAtMillis: AT - 1 } };
  const config = { enabled: true, connectionVerified: true, activatedAtMillis: AT - 1000, senderMailbox: "alerts@posetek.net" };
  const db = new FakeFirestore({ "userIssueSettings/current": settings, [M.SETTINGS]: config,
    "players/athlete-a": { authenticationUID: "player-a-owner", firstName: "Athlete", lastName: "A" },
    "players/athlete-b": { authenticationUID: "player-b-owner", firstName: "Athlete", lastName: "B" } });
  const wakes = [], authCalls = [];
  const issues = createUserIssues({ db, HttpsError, now: () => at,
    auth: { getUser: async uid => { authCalls.push(uid); return { uid, displayName: `Account ${uid}`, email: `${uid}@example.com`, emailVerified: true }; } },
    provider: { send: async (payload, key) => { wakes.push({ payload, key }); return { pending: true }; } }, logger: { error() {} } });
  const mail = createMicrosoftEmail({ db, now: () => at, logger: { error() {} }, traceReader: { read: async () => ({ rows: [] }) } });
  let number = 0;
  const submit = (uid = "staff", patch = {}) => issues.submit({ eventId: `event-${++number}`, sessionId: "session", kind: "error",
    platform: "web", operation: "save_workout", code: "unavailable", occurredAtMillis: at, ...patch }, uid === "staff" ? ADMIN : uid ? { uid } : null);
  const claim = row => mail.claim({ schemaVersion: 1, kind: "issue", jobId: row.occurrenceId || row, runId: `run-${row.occurrenceId || row}` });
  const job = row => db.snapshot(`userIssueOutbox/${row.occurrenceId || row}`);
  return { db, issues, mail, settings, config, wakes, authCalls, submit, claim, job, now: () => at, advance: ms => { at += ms; } };
}
async function sendPermission(f, row) { await f.issues.dispatch(row.occurrenceId || row); return f.claim(row); }

test("first issue receives one permission; distinct repeated attempts remain and defer to summary", async () => {
  const f = fixture(), first = await f.submit();
  assert.equal((await sendPermission(f, first)).allowSend, true);
  const repeat = await f.submit(); await f.issues.dispatch(repeat.occurrenceId);
  assert.equal(f.job(repeat).status, "deferred_to_summary");
  assert.equal(f.job(repeat).notificationDecision.reason, "routine_repeat");
  assert.equal(f.job(repeat).notificationDecision.identityEvidence.actorUid, "staff");
  assert.equal(f.job(repeat).microsoft, undefined);
  assert.equal(f.wakes.length, 1);
  assert.equal(f.db.snapshot(`userIssues/${first.reference}`).occurrences, 2);
  assert.ok(f.db.snapshot(`userIssueOccurrences/${repeat.occurrenceId}`));
  assert.equal((await f.claim(repeat)).allowSend, false);
  assert.equal((await f.db.doc(`userIssueOutbox/${repeat.occurrenceId}`).collection("notificationPolicyAudits").get()).size, 1);
});

test("simultaneous queued flows recheck cadence transactionally before consuming permission", async () => {
  const f = fixture(), first = await f.submit(), second = await f.submit();
  await f.issues.dispatch(first.occurrenceId); await f.issues.dispatch(second.occurrenceId);
  const frozen = f.job(second).payload;
  const results = await Promise.all([f.claim(first), f.claim(second)]);
  assert.equal(results.filter(row => row.allowSend).length, 1);
  assert.equal(f.job(second).status, "deferred_to_summary");
  assert.deepEqual(f.job(second).payload, frozen);
  assert.equal(f.job(second).microsoft.claimedAtMillis, undefined);
  assert.deepEqual(f.db.snapshot("microsoftEmailState/sendBudget").recipientBuckets.map(row => row.count), [1]);
});

test("claim-time deferral keeps prior transport failures in its immutable audit", async () => {
  const f = fixture(), first = await f.submit(), repeat = await f.submit();
  await f.issues.dispatch(first.occurrenceId); await f.issues.dispatch(repeat.occurrenceId);
  assert.equal((await f.claim(first)).allowSend, true);
  await f.db.doc(`userIssueOutbox/${repeat.occurrenceId}`).update({ failureCode: "provider_flow_timeout", failureMessage: "Original transport acknowledgement timed out." });
  const original = f.job(repeat);
  assert.equal((await f.claim(repeat)).allowSend, false);
  const audits = await f.db.doc(`userIssueOutbox/${repeat.occurrenceId}`).collection("notificationPolicyAudits").get();
  assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].data().originalFailureCode, original.failureCode);
  assert.equal(audits.docs[0].data().originalFailureMessage, original.failureMessage);
  assert.deepEqual(f.job(repeat).payload, original.payload);
  assert.deepEqual(f.job(repeat).microsoft, original.microsoft);
  assert.equal(f.job(repeat).failureCode, null);
});

test("new account and target athletes notify separately without mixing identity", async () => {
  const f = fixture(), a = await f.submit("staff", { playerId: "athlete-a" });
  assert.equal((await sendPermission(f, a)).allowSend, true);
  const b = await f.submit("staff", { playerId: "athlete-b" });
  assert.equal((await sendPermission(f, b)).allowSend, true);
  assert.equal(f.job(b).notificationDecision.reason, "new_target_athlete");
  const c = await f.submit("another-account");
  assert.equal((await sendPermission(f, c)).allowSend, true);
  assert.equal(f.job(c).notificationDecision.reason, "new_reporting_account");
  assert.deepEqual(f.job(b).notificationDecision.identityEvidence, { actorUid: "staff", targetId: "athlete-b", accountRole: "account_reported" });
  assert.match(f.job(b).payload.text, /Account\/reporter: Account staff \(staff\)/);
  assert.match(f.job(b).payload.text, /Target athlete: Athlete B \(athlete-b\)/);
  assert.equal(f.job(b).payload.text.includes("another-account"), false);
  assert.equal(f.job(b).payload.text.includes("Occurrence reference: " + b.occurrenceId), true);
});

test("unknown service repeats have no invented account or athlete", async () => {
  const f = fixture(), first = await f.submit(null); assert.equal((await sendPermission(f, first)).allowSend, true);
  const repeat = await f.submit(null); await f.issues.dispatch(repeat.occurrenceId);
  assert.equal(f.job(repeat).status, "deferred_to_summary");
  assert.equal(f.job(repeat).notificationDecision.identityEvidence.actorUid, null);
  assert.equal(f.job(repeat).notificationDecision.identityEvidence.targetId, null);
  assert.equal((await f.db.collection("userIssueNotificationAudience").get()).size, 0);
});

test("older unconsumed Microsoft incident, status and daily jobs become audited backlog without payload edits", async () => {
  for (const type of ["incident", "status", "daily"]) {
    const f = fixture(), id = M.hash(type), original = { id, type, issueId: "a".repeat(64), actorUid: "staff", title: "Retained history", lines: ["Original wording"],
      createdAtMillis: AT - 10, firstAttemptAtMillis: AT - 5, attempts: 1, status: "pending", dueAtMillis: AT,
      ...M.freeze("issue", id, { to: ["dylank@posetek.net"], from: "PoseTek Support <support@alerts.posetek.net>", subject: "Old job", text: "Original history" }, f.config, AT - 5) };
    await f.db.doc(`userIssueOutbox/${id}`).set(original);
    const result = await f.claim(id);
    assert.equal(result.allowSend, false); assert.equal(result.deferredToSummary, true);
    const next = f.job(id);
    assert.equal(next.status, "deferred_to_summary"); assert.equal(next.notificationDecision.reason, "backlog_before_cutover");
    assert.deepEqual(next.payload, original.payload); assert.deepEqual(next.microsoft, original.microsoft);
    assert.equal(next.notificationDecision.originalPayloadDigest, M.payloadDigest(original.payload));
    assert.equal(f.db.snapshot("microsoftEmailState/sendBudget"), undefined);
  }
});

test("a consumed permission and its frozen history never become deferred or available again", async () => {
  const f = fixture(), row = await f.submit(); const permission = await sendPermission(f, row);
  const original = f.job(row);
  await f.db.doc("userIssueSettings/current").update({ notificationPolicy: { schemaVersion: 1, mode: Policy.MODE, activatedAtMillis: AT } });
  assert.equal((await f.claim(row)).allowSend, false);
  assert.deepEqual(f.job(row), original);
  assert.equal(permission.allowSend, true);
});

test("historical Resend jobs retain their provider, status and retry path", async () => {
  const f = fixture(), row = await f.submit();
  await f.db.doc(`userIssueOutbox/${row.occurrenceId}`).update({ deliveryProvider: "resend", firstAttemptAtMillis: AT - 100, attempts: 1 });
  await f.issues.dispatch(row.occurrenceId);
  assert.equal(f.job(row).notificationDecision, undefined);
  assert.equal(f.job(row).deliveryProvider, "resend");
  assert.equal(f.wakes.length, 1);
});

test("severity escalation gets immediate permission based on exact occurrence evidence", async () => {
  const f = fixture(), first = await f.submit(); await sendPermission(f, first);
  const escalation = await f.submit();
  await f.db.doc(`userIssueOccurrences/${escalation.occurrenceId}`).update({ severity: "critical" });
  assert.equal((await sendPermission(f, escalation)).allowSend, true);
  assert.equal(f.job(escalation).notificationDecision.reason, "severity_escalation");
});

test("proven recurrence after fixed or verified is immediate; alert silence is not recovery", async () => {
  for (const state of ["fixed", "verified"]) {
    const f = fixture(), first = await f.submit(); await sendPermission(f, first); f.advance(1);
    await f.issues.triage({ issueId: first.reference, state, fixRef: "commit-abc", verification: "Confirmed retest", expectedUpdatedAtMillis: AT }, ADMIN);
    const recurrence = await f.submit();
    assert.equal((await sendPermission(f, recurrence)).allowSend, true);
    assert.equal(f.job(recurrence).notificationDecision.reason, "recurrence_after_resolution");
    assert.equal(f.db.snapshot(`userIssues/${first.reference}`).state, "new");
    const again = await f.submit(); await f.issues.dispatch(again.occurrenceId);
    assert.equal(f.job(again).notificationDecision.reason, "routine_repeat");
  }
});

test("confirmed recovery carries the authenticated verified transition and retest evidence", async () => {
  const f = fixture(), first = await f.submit(); f.advance(1);
  await f.issues.triage({ issueId: first.reference, state: "verified", fixRef: "commit-abc", verification: "Retest passed", expectedUpdatedAtMillis: AT }, ADMIN);
  const rows = await f.db.collection("userIssueOutbox").where("type", "==", "status").get(), id = rows.docs[0].id;
  assert.equal((await sendPermission(f, id)).allowSend, true);
  assert.equal(f.job(id).notificationDecision.reason, "confirmed_recovery");
  assert.equal(f.job(id).notificationTransition.verification, "Retest passed");
});

test("canonical exact occurrence wins over issue latest actor and target", async () => {
  const f = fixture(), first = await f.submit("staff", { playerId: "athlete-a" }), later = await f.submit("another-account");
  assert.equal((await sendPermission(f, first)).allowSend, true);
  assert.equal(f.db.snapshot(`userIssues/${first.reference}`).latestOccurrenceId, later.occurrenceId);
  assert.deepEqual(f.job(first).notificationDecision.identityEvidence, { actorUid: "staff", targetId: "athlete-a", accountRole: "account_reported" });
});

test("forged or mismatched frozen actor, target or operation is held before permission", async () => {
  for (const patch of [{ actorUid: "different" }, { player: { id: "athlete-b" } }, { operation: "other_action" }]) {
    const f = fixture(), row = await f.submit("staff", { playerId: "athlete-a" });
    await f.issues.dispatch(row.occurrenceId);
    await f.db.doc(`userIssueOutbox/${row.occurrenceId}`).update({ contactSnapshot: { ...f.job(row).contactSnapshot, ...patch } });
    assert.equal((await f.claim(row)).allowSend, false);
    assert.equal(f.job(row).status, "needs_review");
    assert.equal(f.job(row).failureCode, "provider_notification_identity_mismatch");
    assert.equal(f.job(row).microsoft.claimedAtMillis, undefined);
  }
});

test("invalid policy settings fail closed and sending pause also blocks already queued flows", async () => {
  const f = fixture(), row = await f.submit(); await f.issues.dispatch(row.occurrenceId);
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  assert.equal((await f.claim(row)).allowSend, false);
  assert.equal(f.job(row).notificationDecision, undefined);
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: true, notificationPolicy: { schemaVersion: 1, mode: "wrong", activatedAtMillis: AT - 1 } });
  assert.equal((await f.claim(row)).allowSend, false);
  assert.equal(f.job(row).failureCode, "provider_notification_policy_invalid");
});

test("daily window counts retained occurrences and exact decision states without calling permission delivered", async () => {
  const f = fixture(), first = await f.submit(); await sendPermission(f, first);
  const repeat = await f.submit(); await f.issues.dispatch(repeat.occurrenceId);
  await f.submit("other");
  const summary = await reportingSummary(f.db, require("./user-issue-model").periodKey(AT));
  assert.equal(summary.occurrences, 3);
  assert.equal(summary.notificationCadence.immediateSelected, 1);
  assert.equal(summary.notificationCadence.routineRepeats, 1);
  assert.equal(summary.notificationCadence.undecided, 1);
  assert.equal(summary.notificationCadence.enumerationComplete, true);
});

test("removed recipients still stop the queued flow before cadence suppression or permission", async () => {
  const f = fixture(), row = await f.submit(); await f.issues.dispatch(row.occurrenceId);
  const original = f.job(row).payload;
  await f.db.doc(`userIssueOutbox/${row.occurrenceId}`).update({ payload: { ...original, to: [...M.HISTORICAL_ISSUE_RECIPIENTS] } });
  assert.equal((await f.claim(row)).allowSend, false);
  assert.equal(f.job(row).failureCode, "provider_recipient_removed");
  assert.equal(f.job(row).notificationDecision, undefined);
});

test("bounded maintenance pages preserve claimed and Resend work, defer old Microsoft jobs only under a hold", async () => {
  const f = fixture();
  for (let index = 0; index < 85; index++) {
    const id = M.hash(`backlog-${index}`), payload = { to: ["dylank@posetek.net"], subject: "Retained pending history", text: `Original ${index}` };
    await f.db.doc(`userIssueOutbox/${id}`).set({ id, type: index % 2 ? "status" : "daily", createdAtMillis: AT - 10,
      firstAttemptAtMillis: AT - 5, attempts: 1, status: "pending", dueAtMillis: AT, ...M.freeze("issue", id, payload, f.config, AT - 5) });
  }
  const legacyId = M.hash("legacy"), consumedId = M.hash("consumed");
  await f.db.doc(`userIssueOutbox/${legacyId}`).set({ id: legacyId, type: "incident", createdAtMillis: AT - 10, status: "pending", dueAtMillis: AT, deliveryProvider: "resend" });
  await f.db.doc(`userIssueOutbox/${consumedId}`).set({ id: consumedId, type: "incident", createdAtMillis: AT - 10, status: "sending", dueAtMillis: AT, deliveryProvider: "microsoft", microsoft: { claimedAtMillis: AT - 4 } });
  const legacy = f.job(legacyId), consumed = f.job(consumedId);
  await assert.rejects(f.issues.deferBacklogPage(), /notification_backlog_requires_send_hold/);
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  let cursor = null, total = 0, examined = 0, complete = false;
  do {
    const result = await f.issues.deferBacklogPage({ cursor }); cursor = result.cursor; total += result.deferred; examined += result.examined; complete = result.enumerationComplete;
  } while (cursor);
  assert.equal(total, 85); assert.equal(examined, 87); assert.equal(complete, true);
  assert.deepEqual(f.job(legacyId), legacy); assert.deepEqual(f.job(consumedId), consumed);
  assert.equal(f.wakes.length, 0);
  assert.equal((await f.issues.deferBacklogPage()).deferred, 0);
  assert.equal(f.db.snapshot("microsoftEmailState/sendBudget"), undefined);
});

test("cadence summary retains more than one source page and fails closed on an incomplete exact outbox read", async () => {
  const f = fixture(), Model = require("./user-issue-model");
  for (let index = 0; index < 510; index++) {
    const id = M.hash(`summary-${index}`), issueId = "a".repeat(64);
    await f.db.doc(`userIssueOccurrences/${id}`).set({ id, issueId, kind: "error", source: "cloudLogging", platform: "backend", receivedAtMillis: AT });
    await f.db.doc(`userIssueOutbox/${id}`).set({ id, issueId, type: "incident", notificationDecision: { schemaVersion: 1, source: Policy.SOURCE,
      jobId: id, issueId, occurrenceId: id, action: "daily_summary", reason: "routine_repeat" } });
  }
  const summary = await reportingSummary(f.db, Model.periodKey(AT));
  assert.equal(summary.occurrences, 510); assert.equal(summary.notificationCadence.routineRepeats, 510);
  assert.equal(f.db.bulkReads.length, 21); assert.ok(f.db.bulkReads.every(row => row.length <= 25));
  const getAll = f.db.getAll.bind(f.db); f.db.getAll = async (...refs) => (await getAll(...refs)).slice(1);
  await assert.rejects(reportingSummary(f.db, Model.periodKey(AT)), { code: "summary_notification_read_incomplete" });
});
