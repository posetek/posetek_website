"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { observeSocialCallable } = require("./social-callable-observation");
const { createIssueSources } = require("./user-issue-sources");
const { createUserIssues } = require("./user-issues");
const C = require("./user-issue-classification"), M = require("./user-issue-model");
const O = require("./user-issue-observations"), Bridge = require("./issue-tracker-bridge-model");
const { normalizeIssueTracker } = require("./issue-tracker-normalize");
const { reportingSummary } = require("./user-issue-summary");
const AT = Date.parse("2026-10-03T04:20:00Z");
const STAFF = { uid: "synthetic-staff", email: "synthetic-staff@posetek.net", emailVerified: true };
function fixture() {
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: false, activatedAtMillis: AT - 1000 },
    "players/synthetic-target": { authenticationUID: "different-athlete", firstName: "Synthetic", lastName: "Athlete" } });
  const lookups = [];
  const service = createUserIssues({ db, HttpsError, now: () => AT,
    auth: { getUser: async uid => { lookups.push(uid); return { uid, displayName: "Synthetic Staff", email: "synthetic-staff@example.test", emailVerified: true }; } },
    provider: { send: () => assert.fail("No emails in source tests") } });
  return { db, service, lookups, sources: createIssueSources(service, db, () => AT) };
}
function entry(payload, patch = {}) {
  return { logName: "projects/kickai-69dd0/logs/cloudfunctions.googleapis.com%2Fcloud-functions", insertId: "synthetic-log",
    severity: "ERROR", timestamp: new Date(AT).toISOString(), receiveTimestamp: new Date(AT).toISOString(),
    resource: { type: "cloud_function", labels: { function_name: "getSocialFeed" } }, jsonPayload: payload, ...patch };
}
// These are the existing index.js caller checks. Rejection leaves no accepted
// caller even when the rejected credential is a Firebase anonymous account.
function requireCaller(context) {
  if (!context.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") throw new HttpsError("permission-denied", "A registered account is required.");
  return context.auth;
}
async function failure(f, context = {}, code = "unavailable", requestId = "synthetic-request") {
  const logs = [], info = [];
  const wrapper = observeSocialCallable({ endpoint: "getSocialFeed", requireCaller, HttpsError, now: () => AT,
    logger: { info: value => info.push(value), error: value => logs.push(value) },
    handler: async () => { throw new HttpsError(code, "Synthetic failure"); } });
  await assert.rejects(wrapper({ requestId, reporterUid: "forged", viewAsPlayerId: "synthetic-target" }, context));
  const log = logs.length ? entry(logs[0]) : entry(info[0], { severity: "INFO" });
  const result = await f.sources.log({ json: log });
  return { result, log, logs, info };
}
const occurrence = (f, result) => f.db.snapshot(`userIssueOccurrences/${result.occurrenceId}`);
const job = (f, result) => f.db.snapshot(`userIssueOutbox/${result.occurrenceId}`);
function native(event, outbox) {
  return normalizeIssueTracker({ occurrences: [event], outbox: outbox ? [outbox] : [] });
}

test("actual unauthenticated and rejected-anonymous callable failures retain unknown-actor request evidence end to end", async () => {
  for (const context of [{}, { auth: { uid: "synthetic-anonymous", token: { firebase: { sign_in_provider: "anonymous" } } } }]) {
    const f = fixture(), { result, log } = await failure(f, context), event = occurrence(f, result), outbox = job(f, result);
    assert.equal(event.reporterUid, null); assert.equal(event.player, null); assert.equal(event.currentContact, null); assert.deepEqual(f.lookups, []);
    assert.equal(event.classification.scope, "unknown_actor"); assert.equal(C.validCallableOutcome(event.callableOutcome, event), true);
    assert.equal(event.callableOutcome.errorCategory, "request_failure"); assert.equal(event.callableOutcome.code, log.jsonPayload.code);
    assert.match(outbox.title, /^Action failed: getSocialFeed$/); assert.doesNotMatch(outbox.lines.join("\n"), /Automated service/);
    const payload = M.payload(outbox, outbox.id);
    assert.match(payload.text, /Account\/reporter: Unknown actor/); assert.match(payload.text, /Contact email: Unavailable/);
    assert.match(payload.text, /no accepted authenticated reporter is recorded/); assert.doesNotMatch(payload.text, /Service error|synthetic-anonymous|forged/);
    const observations = await f.db.collection(`userIssueOccurrences/${event.id}/observations`).get();
    assert.equal(observations.size, 1); assert.deepEqual(observations.docs[0].data().callableOutcome, event.callableOutcome);
    assert.deepEqual(event.sourceObservationSummary.evidence[0].callableOutcome, event.callableOutcome);
    assert.deepEqual(Bridge.materialOccurrence(event).callableOutcome, event.callableOutcome);
    const model = native(event, outbox), values = model.changes.instances[0].values;
    assert.match(values["User who acted / reported"], /^Unknown actor/); assert.equal(values["Recorded actor UID"], "");
    assert.match(values["Correlation / limits"], /Server-verified failed callable request/); assert.match(values["Correlation / limits"], /actor and contact remain unknown/);
    assert.doesNotMatch(values["Correlation / limits"], /Automated service occurrence/);
    const summary = await reportingSummary(f.db, M.periodKey(AT));
    assert.equal(summary.occurrences, 1); assert.equal(summary.serviceOccurrences, 0); assert.equal(summary.otherOccurrences, 1);
    assert.equal(summary.reportingAccounts, 0); assert.equal(summary.noAccountOccurrences, 1);
    assert.match(summary.top[0].title, /^Action failed:/);
    const before = structuredClone(event); await f.sources.log({ json: log });
    assert.deepEqual(occurrence(f, result), before); assert.equal((await f.db.collection("userIssueOutbox").get()).size, 1);
  }
});

test("wrong resource, operation, event, outcome, category, code or request cannot certify a callable log", async () => {
  const f = fixture(), { log } = await failure(f);
  const cases = [
    { resource: { type: "cloud_function", labels: { function_name: "unrelatedService" } } },
    { resource: { type: "cloud_run_revision", labels: { service_name: "getSocialFeed" } } },
    { jsonPayload: { ...log.jsonPayload, operation: "unrelatedService" } },
    { jsonPayload: { ...log.jsonPayload, event: "other_event" } },
    { jsonPayload: { ...log.jsonPayload, outcome: "succeeded" } },
    { jsonPayload: { ...log.jsonPayload, errorCategory: "unknown" } },
    { jsonPayload: { ...log.jsonPayload, code: "ok" } },
    { jsonPayload: { ...log.jsonPayload, code: "unauthenticated", errorCategory: "action_validation" } },
    { jsonPayload: { ...log.jsonPayload, requestId: "bad/ref" } },
    { jsonPayload: { ...log.jsonPayload, requestId: "r".repeat(161) } },
  ];
  for (const [index, patch] of cases.entries()) {
    const input = { ...log, ...patch, insertId: `bad-marker-${index}` };
    assert.equal(C.callableOutcomeEvidence(input), null);
    const other = fixture(), result = await other.sources.log({ json: input }), event = occurrence(other, result);
    assert.equal(event.callableOutcome, undefined); assert.equal(event.classification.scope, "automated_service");
  }
  assert.equal(C.callableOutcomeEvidence({ ...log, logName: "projects/other/logs/example" }), null);
  assert.equal(await fixture().sources.log({ json: { ...log, logName: "projects/other/logs/example" } }), undefined);
});

test("a fully shaped forged client marker and malformed direct-ingest marker are stripped", async () => {
  const trusted = fixture(), { result } = await failure(trusted), marker = occurrence(trusted, result).callableOutcome;
  const f = fixture(), input = { eventId: "synthetic-client", sessionId: "synthetic-session", requestId: marker.requestId,
    operation: marker.operation, code: marker.code, platform: "backend", callableOutcome: marker,
    source: "cloudLogging", reporterUid: "victim", playerId: "synthetic-target", classification: { scope: "automated_service" } };
  assert.equal(M.normalize(input, AT).callableOutcome, undefined);
  const reported = await f.service.submit(input, null), event = occurrence(f, reported);
  assert.equal(event.callableOutcome, undefined); assert.equal(event.source, "client"); assert.equal(event.classification.scope, "unknown_actor");
  assert.equal(event.reporterUid, null); assert.equal(event.player, null); assert.equal(event.currentContact, null);
  const direct = fixture(), invalid = { ...M.normalize(input, AT), callableOutcome: { ...marker, resourceFunction: "different" } };
  const ingested = await direct.service.ingest(invalid, { uid: null, player: null }, { source: "cloudLogging", sourceEvent: "malformed-marker" });
  assert.equal(occurrence(direct, ingested).callableOutcome, undefined); assert.equal(occurrence(direct, ingested).classification.scope, "automated_service");
  const wrongOrigin = fixture(), wrong = await wrongOrigin.service.ingest({ ...M.normalize(input, AT), callableOutcome: marker }, { uid: null, player: null }, { source: "client", sourceEvent: "wrong-origin" });
  assert.equal(occurrence(wrongOrigin, wrong).callableOutcome, undefined);
});

test("generic historical cloud and AI service evidence is unchanged; free text and codes cannot imply an actor request", async () => {
  const generic = Array.from({ length: 1017 }, () => ({ source: "cloudLogging", kind: "error", platform: "backend",
    operation: "getSocialFeed", code: "unauthenticated", requestId: "generic-request", message: "Callable request failed (unauthenticated; request_failure).", reporterUid: null }));
  const totals = C.summarizeOccurrences(generic);
  assert.equal(totals.serviceOccurrences, 1017); assert.equal(totals.reportingAccounts, 0); assert.equal(totals.otherOccurrences, 0);
  for (const source of ["cloudLogging", "aiIncidents", "backend"]) assert.equal(C.classifyOccurrence({ ...generic[0], source }).scope, "automated_service");
  const f = fixture(), result = await f.sources.log({ json: entry({ operation: "getSocialFeed", requestId: "generic-request",
    code: "unauthenticated", message: generic[0].message }) }), event = occurrence(f, result);
  assert.equal(event.callableOutcome, undefined); assert.equal(event.classification.scope, "automated_service");
  assert.match(job(f, result).title, /^Service error:/);
  assert.match(native(event, job(f, result)).changes.instances[0].values["Correlation / limits"], /Automated service occurrence/);
});

test("authenticated callable and client target corroboration retain exact account separately from the other athlete", async () => {
  const f = fixture(), { result } = await failure(f, { auth: STAFF }), original = occurrence(f, result), frozen = structuredClone(job(f, result));
  assert.equal(original.classification.scope, "account_reported"); assert.equal(original.reporterUid, STAFF.uid); assert.equal(original.player, null);
  const client = await f.service.submit({ eventId: "browser-source", sessionId: "browser-session", operation: "getSocialFeed",
    requestId: original.requestId, code: "functions/unavailable", playerId: "synthetic-target", platform: "web", device: "Synthetic browser" }, STAFF);
  assert.equal(client.occurrenceId, original.id); assert.equal(client.duplicate, true);
  const event = occurrence(f, result), sources = await f.db.collection(`userIssueOccurrences/${event.id}/observations`).get();
  assert.equal(sources.size, 2); assert.equal(event.reporterUid, STAFF.uid); assert.equal(event.player, null);
  const browser = event.sourceObservationSummary.evidence.find(item => item.source === "client");
  assert.equal(browser.actorUid, STAFF.uid); assert.equal(browser.player.id, "synthetic-target"); assert.equal(browser.callableOutcome, undefined);
  assert.deepEqual(event.sourceObservationSummary.evidence.find(item => item.source === "cloudLogging").callableOutcome, event.callableOutcome);
  assert.deepEqual(job(f, result), frozen);
  const values = native(event, job(f, result)).changes.instances[0].values;
  assert.match(values["User who acted / reported"], /Synthetic Staff/); assert.equal(values["Target player ID"], "");
  assert.match(values["Correlation / limits"], /Synthetic Athlete \(synthetic-target\)/); assert.match(values["Correlation / limits"], /account remains separate from the target athlete/);
  const summary = await reportingSummary(f.db, M.periodKey(AT));
  assert.equal(summary.occurrences, 1); assert.equal(summary.accountOccurrences, 1); assert.equal(summary.reportingAccounts, 1); assert.equal(summary.serviceOccurrences, 0);
});

test("all fourteen actual wrappers can certify a failed unauthenticated request; validation categories stay exact", async () => {
  const endpoints = ["getSocialAdminDirectory", "getSocialContext", "getSocialFeed", "getSocialActivity", "saveSocialPreferences",
    "setSocialVisibility", "getSocialPeople", "socialConnection", "setSocialKudos", "getSocialComments", "saveSocialComment",
    "reportSocialActivity", "moderateSocialActivity", "getSocialMedia"];
  for (const endpoint of endpoints) {
    const f = fixture(), logs = [];
    const wrapper = observeSocialCallable({ endpoint, requireCaller, HttpsError, now: () => AT,
      logger: { info: () => {}, error: value => logs.push(value) }, handler: () => assert.fail("Rejected caller must not run handler") });
    await assert.rejects(wrapper({ requestId: `synthetic-${endpoint}` }, {}), { code: "unauthenticated" });
    const result = await f.sources.log({ json: entry(logs[0], { resource: { type: "cloud_function", labels: { function_name: endpoint } } }) });
    const event = occurrence(f, result);
    assert.equal(event.callableOutcome.operation, endpoint); assert.equal(event.classification.scope, "unknown_actor");
    assert.equal(event.reporterUid, null); assert.equal(job(f, result).title, `Action failed: ${endpoint}`);
  }
  for (const code of ["invalid-argument", "failed-precondition", "out-of-range", "already-exists"]) {
    const f = fixture(), { result } = await failure(f, { auth: STAFF }, code), event = occurrence(f, result);
    assert.equal(event.callableOutcome.errorCategory, "action_validation"); assert.equal(event.callableOutcome.code, code);
    assert.equal(event.classification.scope, "account_reported"); assert.equal(event.reporterUid, STAFF.uid);
  }
});

test("valid UID and request bounds are distinct, and explicit cancellation creates no incident", async () => {
  for (const length of [128, 129]) {
    const f = fixture(), { result } = await failure(f, { auth: { uid: "u".repeat(length) } }, "unavailable", "r".repeat(160)), event = occurrence(f, result);
    assert.equal(event.reporterUid, length === 128 ? "u".repeat(length) : null);
    assert.equal(event.classification.scope, length === 128 ? "account_reported" : "unknown_actor");
    assert.equal(event.callableOutcome.requestId.length, 160); assert.equal(f.lookups.length, length === 128 ? 1 : 0);
  }
  const f = fixture(), { result, logs, info } = await failure(f, { auth: STAFF }, "cancelled");
  assert.equal(result, undefined); assert.equal(logs.length, 0); assert.equal(info[0].outcome, "cancelled");
  assert.equal((await f.db.collection("userIssueOccurrences").get()).size, 0); assert.equal((await f.db.collection("userIssueOutbox").get()).size, 0);
});

test("marker changes are material and native annotations preserve stable rows, schema and independent observation evidence", async () => {
  const f = fixture(), { result } = await failure(f), event = occurrence(f, result), outbox = job(f, result);
  const { callableOutcome, sourceObservationSummary, ...withoutMarker } = event;
  const historical = { ...withoutMarker, classification: C.classifyOccurrence(withoutMarker) };
  const before = native(historical, outbox), after = normalizeIssueTracker({ seed: before.nextSeed, occurrences: [event], outbox: [outbox] });
  assert.notEqual(Bridge.digest(Bridge.materialOccurrence(event)), Bridge.digest(Bridge.materialOccurrence(historical)));
  assert.equal(after.changes.instances.length, 1); assert.equal(after.changes.instances[0].values.Instance, before.changes.instances[0].values.Instance);
  assert.equal(after.changes.instances[0].values["Action ID"], before.changes.instances[0].values["Action ID"]);
  assert.match(after.changes.instances[0].values["Correlation / limits"], /Server-verified failed callable request/);
  assert.doesNotMatch(after.changes.instances[0].values["Correlation / limits"], /Automated service occurrence/);
  for (const human of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(after.changes.instances[0].values, human), false);
  const bad = structuredClone(event); bad.sourceObservationSummary.evidence[0].callableOutcome.resourceFunction = "other";
  assert.throws(() => native(bad, outbox), /invalid server callable-outcome evidence/);
  assert.deepEqual(O.evidence(event).callableOutcome, callableOutcome);
  const invalid = { ...event, callableOutcome: { ...callableOutcome, code: "ok" } };
  assert.equal(O.evidence(invalid).callableOutcome, undefined);
});
