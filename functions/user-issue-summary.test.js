"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { reportingSummary, deliveryReviewSummary, PAGE } = require("./user-issue-summary");
const { createUserIssues } = require("./user-issues");
const M = require("./user-issue-model");
const PERIOD = "2026-10-01", bounds = M.periodBounds(PERIOD), AT = bounds.upper + 1000;
const row = (patch = {}) => ({ source: "cloudLogging", platform: "backend", operation: "sweep", kind: "error", reporterUid: null, receivedAtMillis: bounds.lower + 1000, ...patch });
function fixture(seed = {}) {
  const db = new FakeFirestore({ "userIssueSettings/current": { enabled: true, sendEnabled: false, activatedAtMillis: bounds.lower - 1 }, ...seed });
  const service = createUserIssues({ db, HttpsError, now: () => AT, provider: { send: async () => { throw new Error("No real email"); } } });
  return { db, service };
}
test("reporting bounds are exact across both Pacific DST transitions", () => {
  assert.deepEqual(M.periodBounds("2026-03-07"), { lower: Date.parse("2026-03-07T17:00:00Z"), upper: Date.parse("2026-03-08T16:00:00Z") });
  assert.deepEqual(M.periodBounds("2026-10-31"), { lower: Date.parse("2026-10-31T16:00:00Z"), upper: Date.parse("2026-11-01T17:00:00Z") });
});
test("full pagination and fixed receipt bounds retain all occurrences with tied receipt times", async () => {
  const f = fixture();
  for (let i = 0; i < PAGE * 2 + 1; i++) await f.db.doc(`userIssueOccurrences/${M.hash(i)}`).set(row());
  await f.db.doc(`userIssueOccurrences/${M.hash("lower")}`).set(row({ receivedAtMillis: bounds.lower }));
  await f.db.doc(`userIssueOccurrences/${M.hash("too-early")}`).set(row({ receivedAtMillis: bounds.lower - 1 }));
  await f.db.doc(`userIssueOccurrences/${M.hash("upper")}`).set(row({ receivedAtMillis: bounds.upper }));
  const value = await reportingSummary(f.db, PERIOD);
  assert.equal(value.occurrences, PAGE * 2 + 2); assert.equal(value.enumerationComplete, true);
  assert.equal(f.db.queries.filter(q => q.path === "userIssueOccurrences").length, 3);
});
test("new summaries separate service scope, account evidence and all-time provider review; old frozen jobs stay unchanged", async () => {
  const events = [row(), row(), row({ source: "failureCases", platform: "ios", operation: "system_diagnostic", kind: "interrupted", reporterUid: "staff", player: { id: "other-athlete" } }), row({ source: "client", platform: "web", reporterUid: "staff" })];
  const f = fixture({ [`userIssueDays/${PERIOD}`]: { incidents: 4, affectedActors: 999, changes: 1, crashes: 100, lastAtMillis: bounds.lower + 1000 } });
  for (let i = 0; i < events.length; i++) await f.db.doc(`userIssueOccurrences/${M.hash(i)}`).set(events[i]);
  await f.db.doc(`userIssueOutbox/${M.hash("resend")}`).set({ status: "failed", deliveryProvider: "resend", payload: { to: [M.TO, "nolanj@posetek.net"] }, claimedAtMillis: 123 });
  await f.db.doc(`userIssueOutbox/${M.hash("microsoft")}`).set({ status: "needs_review", deliveryProvider: "microsoft" });
  await f.db.doc(`userIssueOutbox/${M.hash("unknown")}`).set({ status: "bounced" });
  const historical = f.db.snapshot(`userIssueOutbox/${M.hash("resend")}`);
  await f.service.daily();
  const id = M.hash(["daily", PERIOD]), job = f.db.snapshot(`userIssueOutbox/${id}`);
  assert.equal(job.summary.occurrences, 4); assert.equal(job.summary.serviceOccurrences, 2); assert.equal(job.summary.diagnostics, 1); assert.equal(job.summary.reportingAccounts, 1);
  assert.equal(job.summary.crashes, 0); assert.equal(job.summary.interruptions, 0);
  assert.deepEqual(job.deliveryReview, { total: 3, microsoft: 1, resend: 1, unassigned: 1, enumerationComplete: true, scope: "all_time_current_delivery_review" });
  assert.match(job.lines.join("\n"), /across all time: 1 Microsoft, 1 Resend, 1 unassigned provider/);
  assert.doesNotMatch(job.lines.join("\n"), /distinct user incidents|affected accounts or anonymous sessions/);
  assert.deepEqual(f.db.snapshot(`userIssueOutbox/${M.hash("resend")}`), historical);
  await f.db.doc(`userIssueOutbox/${id}`).update({ payload: { subject: "Historical summary", text: "Original wording", to: [M.TO] }, providerId: "historical", status: "delivered" });
  const frozen = f.db.snapshot(`userIssueOutbox/${id}`); await f.service.daily(); assert.deepEqual(f.db.snapshot(`userIssueOutbox/${id}`), frozen);
});
test("pagination failures and day-count drift never create a partial or misleading summary", async () => {
  const f = fixture({ [`userIssueDays/${PERIOD}`]: { incidents: 1, lastAtMillis: bounds.lower + 1000 } });
  const id = M.hash(["daily", PERIOD]);
  await assert.rejects(f.service.daily(), { code: "summary_occurrence_count_mismatch" });
  assert.equal(f.db.snapshot(`userIssueOutbox/${id}`), undefined);
  const broken = { collection: () => ({ where() { return this; }, orderBy() { return this; }, limit() { return this; }, get() { throw new Error("page denied"); } }) };
  await assert.rejects(reportingSummary(broken, PERIOD), /page denied/);
});
test("delivery review pagination uses frozen provider identity rather than current provider settings", async () => {
  const f = fixture();
  for (let i = 0; i < PAGE + 1; i++) await f.db.doc(`userIssueOutbox/${M.hash(i)}`).set({ status: "needs_review", deliveryProvider: "resend" });
  const result = await deliveryReviewSummary(f.db); assert.equal(result.total, PAGE + 1); assert.equal(result.resend, PAGE + 1); assert.equal(result.microsoft, 0);
});
test("a day change between completed enumeration and creation leaves the summary unclaimed", async () => {
  const f = fixture({ [`userIssueDays/${PERIOD}`]: { incidents: 1, changes: 0, lastAtMillis: bounds.lower + 1000 } });
  await f.db.doc(`userIssueOccurrences/${M.hash("one")}`).set(row());
  const original = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = async handler => {
    await f.db.doc(`userIssueDays/${PERIOD}`).update({ changes: 1, lastAtMillis: bounds.lower + 1001 });
    return original(handler);
  };
  await assert.rejects(f.service.daily(), { code: "summary_day_changed" });
  assert.equal(f.db.snapshot(`userIssueOutbox/${M.hash(["daily", PERIOD])}`), undefined);
});
