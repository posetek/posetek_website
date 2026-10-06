"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const C = require("./user-issue-classification"), M = require("./user-issue-model");
const { createIssueSources } = require("./user-issue-sources");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { HttpsError } = require("./test-support/fake-firestore");
const { createUserIssues } = require("./user-issues");
const AT = Date.parse("2026-10-02T18:00:00Z");
test("generic system uploads retain diagnostic/unknown scope without crash or interruption claims", () => {
  for (const input of [{ kind: "system_diagnostic" }, { kind: "system_diagnostic", diagnosticSubtype: "crash", crashed: true }]) {
    assert.deepEqual(C.documentKind("failureCases", input), { kind: "diagnostic", diagnosticSubtype: "unknown", reason: "generic_system_diagnostic" });
  }
  const historical = { source: "failureCases", operation: "system_diagnostic", kind: "interrupted", reporterUid: "staff", player: { id: "other-athlete" } };
  const corrected = C.classifyOccurrence(historical);
  assert.equal(corrected.effectiveKind, "diagnostic"); assert.equal(corrected.diagnosticSubtype, "unknown");
  assert.equal(corrected.scope, "account_reported"); assert.equal(historical.kind, "interrupted");
  assert.match(C.occurrenceTitle(historical), /^Diagnostic uploaded:/);
  assert.equal(C.documentKind("failureCases", { kind: "launch_interrupted" }).kind, "interrupted");
  assert.equal(C.documentKind("failureCases", { kind: "system_monitor" }).kind, "error");
});
test("clients cannot supply trusted diagnostic, crash, actor or classification evidence", () => {
  for (const kind of ["crash", "diagnostic", "interrupted"]) {
    const value = M.normalize({ eventId: "event", sessionId: "session", kind, diagnosticSubtype: "metrics", classification: { source: C.SOURCE, effectiveKind: "crash" }, reporterUid: "someone-else" }, AT);
    assert.equal(value.kind, "error"); assert.equal(value.classification, undefined); assert.equal(value.diagnosticSubtype, undefined); assert.equal(value.reporterUid, undefined);
  }
  assert.equal(C.classifyOccurrence({ source: "client", kind: "error", platform: "backend" }).scope, "unknown_actor", "a client-supplied platform cannot invent a service occurrence");
});
test("server adapter retains original diagnostic identity and uses neutral upload wording", async () => {
  const db = new FakeFirestore({ "failureCases/system-test": { kind: "system_diagnostic", scope: "actor", reportedByUid: "staff", playerDocumentID: null, createdAt: AT } });
  let received;
  const sources = createIssueSources({ ingest: async (...args) => { received = args; } }, db, () => AT);
  await sources.document("failureCases", await db.doc("failureCases/system-test").get(), { timestamp: new Date(AT).toISOString() });
  assert.equal(received[0].kind, "diagnostic"); assert.equal(received[0].severity, "diagnostic");
  assert.equal(received[1].uid, "staff"); assert.equal(received[1].player, null); assert.equal(received[2].reference, "failureCases/system-test");
});
test("595 mixed occurrences do not become 548 affected user accounts", () => {
  const events = Array.from({ length: 578 }, (_, i) => ({ source: "cloudLogging", platform: "backend", kind: "error", operation: "sweep", sessionId: `trace-${i}` }));
  for (let i = 0; i < 10; i++) events.push({ source: "failureCases", platform: "ios", kind: "interrupted", operation: "system_diagnostic", reporterUid: `reporter-${i % 4}` });
  for (let i = 0; i < 5; i++) events.push({ source: "aiIncidents", platform: "backend", kind: "error", operation: "training", reporterUid: `reporter-${i % 4}` });
  for (let i = 0; i < 2; i++) events.push({ source: "client", platform: "web", kind: "error", operation: "save", reporterUid: `reporter-${i}` });
  const counts = C.summarizeOccurrences(events);
  assert.equal(counts.occurrences, 595); assert.equal(counts.serviceOccurrences, 578); assert.equal(counts.accountOccurrences, 17);
  assert.equal(counts.reportingAccounts, 4); assert.equal(counts.noAccountOccurrences, 578); assert.equal(counts.diagnostics, 10);
  assert.equal(counts.crashes, 0); assert.equal(counts.interruptions, 0); assert.equal(counts.otherOccurrences, 7);
  assert.match(counts.top[0].title, /^Service error:/);
});
test("server-owned verified metric evidence stays neutral and does not name the target athlete as actor", () => {
  const classification = { schemaVersion: 1, source: C.SOURCE, effectiveKind: "diagnostic", diagnosticSubtype: "metrics", scope: "unknown_actor", reason: "verified_metric_payload" };
  assert.equal(C.validClassification(classification), true);
  const counts = C.summarizeOccurrences([{ source: "failureCases", operation: "system_diagnostic", kind: "interrupted", classification, player: { id: "target" } }]);
  assert.equal(counts.diagnostics, 1); assert.equal(counts.unknownDiagnosticSubtype, 0); assert.equal(counts.reportingAccounts, 0); assert.equal(counts.noAccountOccurrences, 1);
  assert.equal(counts.crashes, 0); assert.equal(counts.interruptions, 0);
});
test("corrected diagnostic uploads preserve historical issue identity and recurrence state", async () => {
  const issueId = M.hash(["ios", "system_diagnostic", "failureCases", "interrupted"]);
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: false, activatedAtMillis: AT - 1000 },
    [`userIssues/${issueId}`]: { state: "verified", title: "Interrupted session — cause unknown: system_diagnostic", kind: "interrupted", occurrences: 5, firstReceivedAtMillis: AT - 10000, updatedAtMillis: AT - 1000, fixRef: "historical-fix", verification: "historical-check" },
    "failureCases/system-new": { kind: "system_diagnostic", reportedByUid: "staff", createdAt: AT } });
  const service = createUserIssues({ db, HttpsError, now: () => AT }), sources = createIssueSources(service, db, () => AT);
  const result = await sources.document("failureCases", await db.doc("failureCases/system-new").get(), { timestamp: new Date(AT).toISOString() });
  assert.equal(result.reference, issueId); assert.equal(db.snapshot(`userIssueOccurrences/${result.occurrenceId}`).kind, "diagnostic");
  const issue = db.snapshot(`userIssues/${issueId}`);
  assert.equal(issue.state, "new"); assert.equal(issue.occurrences, 6); assert.equal(issue.fixRef, "historical-fix"); assert.equal(issue.verification, "historical-check");
  assert.match(issue.title, /^Diagnostic uploaded:/); assert.equal((await db.collection("userIssues").get()).size, 1);
});
