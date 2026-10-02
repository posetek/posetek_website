"use strict";
// Local Admin SDK acceptance only. No cloud project or provider can be selected.
const assert = require("node:assert/strict");
const { describe, test, beforeEach, after } = require("node:test");
const PROJECT = "demo-microsoft-email", HOST = "127.0.0.1:8193";
if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || process.env.GCLOUD_PROJECT !== PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) throw new Error("Dedicated loopback emulator and demo project are required");
const { Firestore } = require("@google-cloud/firestore");
const { HttpsError } = require("firebase-functions/v1/https");
const { createMicrosoftEmail } = require("./microsoft-email");
const { createUserIssues } = require("./user-issues");
const M = require("./microsoft-email-model");
const db = new Firestore({ projectId: PROJECT, host: HOST, ssl: false });
const ID = "a".repeat(64), path = `userIssueOutbox/${ID}`;
const roots = ["microsoftEmailSettings", "microsoftEmailState", "userIssueSettings", "userIssueOutbox", "workoutNotificationOutbox"];
let at, service, input, traces;
async function clear() { assert.equal(db.projectId, PROJECT); for (const root of roots) await db.recursiveDelete(db.collection(root)); }
async function seed(id = ID) {
  const config = (await db.doc(M.SETTINGS).get()).data();
  await db.doc(`userIssueOutbox/${id}`).set({ id, type: "incident", title: "Synthetic issue", lines: [], status: "pending", createdAtMillis: at, dueAtMillis: at, attempts: 1, firstAttemptAtMillis: at,
    ...M.freeze("issue", id, { from: "legacy", to: [...M.RECIPIENTS], subject: "Synthetic issue", text: "Synthetic context" }, config, at) });
}
describe("Microsoft email actual Firestore transactions", { concurrency: false, timeout: 120000 }, () => {
  beforeEach(async () => {
    await clear(); at = Date.now(); traces = [];
    await db.doc(M.SETTINGS).set({ enabled: true, connectionVerified: true, traceEnabled: true, senderMailbox: "alerts@posetek.net", activatedAtMillis: at - 1 });
    await db.doc("userIssueSettings/current").set({ enabled: true, sendEnabled: true, activatedAtMillis: at - 1, emailProvider: "microsoft" });
    await seed(); input = { schemaVersion: 1, kind: "issue", jobId: ID, runId: "synthetic-run" };
    service = createMicrosoftEmail({ db, now: () => at, traceReader: { read: async () => ({ rows: traces, checkedAtMillis: at }) }, logger: { error: () => {} } });
  });
  after(async () => { try { await clear(); } finally { await db.terminate(); } });
  test("competing real transactions return exactly one permission, even after losing its response", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => service.claim({ ...input, runId: `run-${i}` })));
    assert.equal(results.filter(result => result.allowSend).length, 1);
    assert.equal((await service.claim(input)).allowSend, false);
    assert.equal((await db.doc(path).get()).data().dueAtMillis, null);
  });
  test("20 rolling claims across different jobs defer the 21st without deleting pending work", async () => {
    for (let i = 0; i < 21; i++) {
      const id = i.toString(16).padStart(64, "0"); await seed(id);
      assert.equal((await service.claim({ ...input, jobId: id, runId: `run-${i}` })).allowSend, i < 20);
    }
    const id = (20).toString(16).padStart(64, "0");
    assert.equal((await db.doc(`userIssueOutbox/${id}`).get()).data().status, "pending");
    at += 300001; assert.equal((await service.claim({ ...input, jobId: id, runId: "later" })).allowSend, true);
  });
  test("concurrent different jobs cannot overrun the last three daily recipient units", async () => {
    const other = "b".repeat(64); await seed(other);
    const { RECIPIENT_BUCKET } = require("./microsoft-email");
    await db.doc("microsoftEmailState/sendBudget").set({ claimTimes: [], recipientBuckets: [{ start: Math.floor(at / RECIPIENT_BUCKET) * RECIPIENT_BUCKET, count: 8997 }] });
    const results = await Promise.all([service.claim(input), service.claim({ ...input, jobId: other, runId: "other-run" })]);
    assert.equal(results.filter(result => result.allowSend).length, 1);
    const heldId = results[0].allowSend ? other : ID, held = (await db.doc(`userIssueOutbox/${heldId}`).get()).data();
    assert.equal(held.status, "pending"); assert.equal(held.microsoft.claimedAtMillis, undefined);
    assert.equal((await db.doc("microsoftEmailState/sendBudget").get()).data().recipientBuckets[0].count, 9000);
  });
  test("authenticated claim/receipt can beat a lost dispatcher response without rollback or another send", async () => {
    let sends = 0;
    const issues = createUserIssues({ db, HttpsError, now: () => at, logger: { error: () => {} }, provider: { send: async () => {
      sends++; const c = await service.claim(input); assert.equal(c.allowSend, true);
      await service.receipt({ ...input, claimToken: c.claimToken, outcome: "accepted" }); throw new Error("Synthetic lost HTTP response");
    } } });
    await issues.dispatch(ID); at += 300000; await issues.dispatch(ID);
    assert.equal(sends, 1); assert.equal((await db.doc(path).get()).data().status, "accepted");
    const job = (await db.doc(path).get()).data();
    traces = M.RECIPIENTS.map(to => ({ id: `trace-${to}`, messageId: "<synthetic@posetek.net>", senderAddress: "alerts@posetek.net", recipientAddress: to,
      subject: job.payload.subject, status: "delivered", receivedDateTime: new Date(job.microsoft.claimedAtMillis).toISOString() }));
    const result = await service.reconcile(); assert.equal(result.checked, 1);
    const delivered = (await db.doc(path).get()).data(); assert.equal(delivered.status, "delivered");
    assert.equal(delivered.deliveryObservedAtMillis, at); assert.equal(delivered.deliveredAtMillis, undefined);
    await issues.dispatch(ID); assert.equal(sends, 1);
  });
  test("reconciler lease prevents competing schedules and missing receipts become reviewable", async () => {
    await service.claim(input); at += 600000;
    const results = await Promise.all([service.reconcile(), service.reconcile()]);
    assert.equal(results.reduce((sum, row) => sum + row.checked, 0), 1);
    assert.equal((await db.doc(path).get()).data().status, "needs_review");
    assert.equal((await service.claim(input)).allowSend, false);
  });
});
