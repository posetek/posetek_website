"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const C = require("./user-issue-contacts"), { createUserIssues } = require("./user-issues"), M = require("./user-issue-model");
const { materialOccurrence } = require("./issue-tracker-bridge-model");
const { normalizeIssueTracker: normalize } = require("./issue-tracker-normalize");
const AT = Date.parse("2026-10-02T20:00:00Z"), ID = "a".repeat(64), ISSUE = "b".repeat(64);
const input = { eventId: "event", sessionId: "session", operation: "save_workout", code: "failed", platform: "web", kind: "error", playerId: "target" };
const record = patch => ({ schemaVersion: 1, uid: "staff", source: "firebase_admin_auth", name: "Actual Staff", email: "staff@example.test", emailVerified: false, observedAtMillis: AT, disabled: false, ...patch });

test("server Auth lookup separates current contact, token snapshot and athlete; forged client contact is ignored", async () => {
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: true, activatedAtMillis: AT - 1000 }, "players/target": { authenticationUID: "athlete", firstName: "Different", lastName: "Athlete" } });
  const service = createUserIssues({ db, HttpsError, now: () => AT, provider: {}, auth: { getUser: async uid => { assert.equal(uid, "staff"); return { uid, displayName: "Actual Staff", email: "current@example.test", emailVerified: false }; } } });
  const result = await service.submit({ ...input, reporterUid: "athlete", currentContact: record({ email: "forged@example.test" }), description: "forged@example.test" }, { uid: "staff", email: "dylank@posetek.net", emailVerified: true, displayName: "Old token name" });
  const event = db.snapshot(`userIssueOccurrences/${result.occurrenceId}`), job = db.snapshot(`userIssueOutbox/${result.occurrenceId}`);
  assert.equal(event.reporterUid, "staff"); assert.equal(event.currentContact.email, "current@example.test"); assert.equal(event.authenticatedSnapshot.email, "dylank@posetek.net");
  assert.equal(event.player.name, "Different Athlete"); assert.equal(event.currentContact.emailVerified, false);
  const payload = M.payload(job, result.occurrenceId);
  assert.match(payload.text, /Account\/reporter: Actual Staff \(staff\)/); assert.match(payload.text, /Contact email: current@example.test \(email unverified\)/);
  assert.match(payload.text, /Target athlete: Different Athlete \(target\)/); assert.match(payload.text, /Attempted action: save_workout/); assert.doesNotMatch(payload.text, /Affected user|forged@example.test|Old token name/);
});

test("Auth lookup failure retains intake, retries, and never erases prior successful contact", async () => {
  let at = AT, fail = true, calls = 0;
  const db = new FakeFirestore(), service = C.createIssueContactEnrichment({ db, now: () => at, auth: { getUser: async uid => { calls++; if (fail) throw new Error("private provider body"); return { uid, email: "known@example.test", emailVerified: true }; } } });
  const first = await service.resolve("staff"); assert.equal(first.contact, null); assert.equal(first.lookup.code, "lookup_unavailable");
  await service.resolve("staff"); assert.equal(calls, 1); at += C.RETRY_MS; fail = false;
  const good = await service.resolve("staff"); assert.equal(good.contact.email, "known@example.test");
  fail = true; at += C.TTL_MS;
  const failed = await service.resolve("staff"); assert.deepEqual(failed.contact, good.contact); assert.equal(failed.lookup.status, "failed");
  const snapshot = C.occurrenceContactSnapshot({ reporterUid: "staff", currentContact: failed.contact, contactLookup: failed.lookup });
  const rendered = M.payload({ type: "incident", title: "Failure", lines: [], contactSnapshot: snapshot }, ID).text;
  assert.match(rendered, /Contact email: Unavailable as a current contact/); assert.match(rendered, /Last successful lookup evidence: known@example.test/); assert.match(rendered, /currency unconfirmed/);
  const excel = normalize({ occurrences: [{ id: ID, reporterUid: "staff", currentContact: failed.contact, contactLookup: failed.lookup }] }).changes.instances[0].values;
  assert.match(excel["User who acted / reported"], /Contact email: Unavailable as a current contact/); assert.match(excel["Identity basis"], /Last successful lookup evidence: known@example.test/);
  assert.doesNotMatch(excel["Identity basis"], /Current Auth account name|current Auth lookup/);
  assert.equal(JSON.stringify(failed).includes("private provider body"), false);
  const intakeDb = new FakeFirestore({ "userIssueSettings/current": { enabled: true, activatedAtMillis: AT - 1 } });
  const intake = createUserIssues({ db: intakeDb, HttpsError, now: () => AT, provider: {}, auth: { getUser: async () => { throw new Error("denied"); } } });
  const result = await intake.submit({ ...input, playerId: null }, { uid: "staff" }); assert.equal(result.status, "received");
  assert.equal(intakeDb.snapshot(`userIssueOccurrences/${result.occurrenceId}`).contactLookup.status, "failed");
});

test("bounded enrichment updates exact source only; material changes queue once and reviewed tracker prose survives", async () => {
  const event = { id: ID, issueId: ISSUE, reporterUid: "staff", reporterName: "Stored historical label", source: "failureCases", code: "system_diagnostic", operation: "upload_diagnostic", kind: "interrupted", receivedAtMillis: AT, occurredAtMillis: AT, player: { id: "target", name: "Other Athlete" } };
  const db = new FakeFirestore({ [`userIssueOccurrences/${ID}`]: event, "issueTrackerSettings/current": { enabled: true, sourceRecoveryEnabled: true } });
  const service = C.createIssueContactEnrichment({ db, now: () => AT, auth: { getUser: async uid => ({ uid, displayName: "Actual Staff", email: "staff@example.test", emailVerified: true }) } });
  const original = normalize({ occurrences: [event] }), before = materialOccurrence(event);
  assert.equal((await service.reconcile()).changed, 1);
  const current = db.snapshot(`userIssueOccurrences/${ID}`); assert.notDeepEqual(materialOccurrence(current), before);
  const enriched = normalize({ occurrences: [{ ...current, id: ID }], seed: original.nextSeed });
  const row = enriched.changes.instances[0]; assert.equal(row.values.Instance, "EV-001"); assert.equal(row.values["Action ID"], original.changes.instances[0].values["Action ID"]);
  assert.ok(row.values["User who acted / reported"].startsWith(original.changes.instances[0].values["User who acted / reported"]));
  assert.match(row.values["User who acted / reported"], /Current outreach contact[\s\S]*staff@example.test/); assert.match(row.values["Identity basis"], /original operator remains unconfirmed/);
  assert.equal(row.values["Target athlete"], "Other Athlete (target)");
  assert.equal((await service.reconcile()).changed, 0);
  const replay = normalize({ occurrences: [{ ...current, id: ID }], seed: enriched.nextSeed }); assert.equal(replay.changes.instances.length, 0);
});

test("changed Auth email is separate current contact; unknown/deleted actors and UID mismatch never borrow athlete details", async () => {
  const db = new FakeFirestore(), service = C.createIssueContactEnrichment({ db, now: () => AT, auth: { getUser: async uid => ({ uid: "wrong", email: "wrong@example.test" }) } });
  const mismatch = await service.resolve("staff"); assert.equal(mismatch.contact, null); assert.equal(mismatch.lookup.status, "failed");
  const unknown = normalize({ occurrences: [{ id: ID, source: "cloudLogging", player: { id: "target", name: "Target Athlete" } }] });
  assert.match(unknown.changes.instances[0].values["User who acted / reported"], /^Unknown actor/); assert.doesNotMatch(unknown.changes.instances[0].values["Identity basis"], /Target Athlete/);
  assert.throws(() => normalize({ occurrences: [{ id: ID, reporterUid: "staff", currentContact: record({ uid: "other" }) }] }), /UID mismatch/);
  const event = { id: ID, reporterUid: "staff", currentContact: record({ email: "new@example.test" }), authenticatedSnapshot: { schemaVersion: 1, uid: "staff", source: "authenticated_token", email: "old@example.test", emailVerified: true, observedAtMillis: AT - 1000 } };
  const row = normalize({ occurrences: [event] }).changes.instances[0].values;
  assert.match(row["User who acted / reported"], /new@example.test/); assert.match(row["Identity basis"], /occurrence-token snapshot: old@example.test/);
});

test("strict structured contact is the only email redaction bypass; historic mixed line is replaced in amended render only", () => {
  const snapshot = C.occurrenceContactSnapshot({ reporterUid: "staff", currentContact: record(), player: { id: "target", name: "forged@example.test" }, operation: "save" });
  const job = { type: "incident", title: "Problem", lines: ["Affected user: old athlete (staff)", "private [email]"], contactSnapshot: snapshot };
  assert.match(M.payload(job, ID).text, /staff@example.test/); assert.doesNotMatch(M.payload(job, ID).text, /forged@example.test|Affected user/); assert.match(job.lines[0], /Affected user/);
  assert.equal(C.validContact(record({ email: "bad@example.test\nBcc: other@example.test" }), "staff"), false);
});
