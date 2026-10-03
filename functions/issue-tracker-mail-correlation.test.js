"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createMailCapture, receivedRecipients, trustedMailJoin } = require("./issue-tracker-mail-capture");
const AT = Date.parse("2026-10-02T20:00:00Z"), ID = "a".repeat(64), ISSUE = "b".repeat(64);
const message = patch => ({ mailbox: "dylank@posetek.net", originalId: "immutable-1", immutableId: "immutable-1", receivedDateTime: new Date(AT).toISOString(),
  subject: "[PoseTek user issue] Recorded action failed", from: "alerts@posetek.net", internetMessageId: "<verified@example.test>", receivedRecipients: ["dylank@posetek.net"], body: { contentType: "text", content: "PoseTek error" }, ...patch });
const job = patch => ({ id: ID, type: "incident", issueId: ISSUE, deliveryProvider: "microsoft", payload: { to: ["dylank@posetek.net"], subject: message().subject },
  microsoft: { claimedAtMillis: AT - 1000, traceCheckedAtMillis: AT, senderMailbox: "alerts@posetek.net", internetMessageId: "<verified@example.test>" },
  recipientDelivery: { "dylank@posetek.net": { evidence: "microsoft_trace", traceId: "verified-trace", status: "delivered" } }, ...patch });
const event = { id: ID, issueId: ISSUE };
const authoritativeMail = patch => ({ id: "immutable-1", receivedDateTime: new Date(AT).toISOString(), subject: message().subject,
  from: { emailAddress: { address: "alerts@posetek.net" } }, internetMessageId: "<verified@example.test>", internetMessageHeaders: [{ name: "To", value: "Dylan <dylank@posetek.net>" }],
  body: { contentType: "text", content: "PoseTek recorded error" }, ...patch });

test("durable backend Internet ID joins only with full sender/subject/recipient/trace and exact occurrence evidence", () => {
  assert.equal(trustedMailJoin(message(), job(), event).value, ID);
  for (const patch of [{ subject: "Similar subject" }, { from: "spoof@example.test" }, { receivedRecipients: ["nolanj@posetek.net"] }, { internetMessageId: "<other@example.test>" }, { receivedRecipients: [] }]) assert.equal(trustedMailJoin(message(patch), job(), event), null);
  for (const patch of [{ type: "daily" }, { microsoft: { ...job().microsoft, traceAmbiguous: true } }, { recipientDelivery: {} }]) assert.equal(trustedMailJoin(message(), job(patch), event), null);
  assert.equal(trustedMailJoin(message(), job(), { ...event, id: "c".repeat(64) }), null);
  assert.deepEqual(receivedRecipients(authoritativeMail()), ["dylank@posetek.net"]);
  assert.deepEqual(receivedRecipients(authoritativeMail({ internetMessageHeaders: [{ name: "To", value: "Dylan" }] })), []);
});

test("capture keeps every immutable item, rejects ambiguous backend matches and never joins from issue URL/body", async () => {
  const db = new FakeFirestore({ [`userIssueOutbox/${ID}`]: job(), [`userIssueOccurrences/${ID}`]: event });
  const queued = [], bridge = { enqueueMessage: async value => { queued.push(value); return { ticket: { queueId: value.originalId, version: 1 } }; } };
  const capture = createMailCapture({ db, bridge, graph: {} });
  await capture.capture(authoritativeMail()); await capture.capture(authoritativeMail({ id: "immutable-copy" }));
  assert.equal(queued.length, 2); assert.notEqual(queued[0].originalId, queued[1].originalId); assert.equal(queued[0].exactJoin.value, ID); assert.equal(queued[1].exactJoin.value, ID);
  await db.doc(`userIssueOutbox/${"c".repeat(64)}`).set(job({ id: "c".repeat(64) }));
  await capture.capture(authoritativeMail({ id: "ambiguous" })); assert.equal(queued.at(-1).exactJoin, undefined);
  await capture.capture(authoritativeMail({ id: "body-only", internetMessageId: "<unmatched@example.test>", body: { contentType: "text", content: `PoseTek error https://posetek.net/admin/user-issues?issue=${ISSUE}; ${ID}` } }));
  assert.equal(queued.at(-1).exactJoin, undefined);
});

test("a long verified Internet ID retains its full source value while compact join evidence stays within ingress bounds", () => {
  const internetMessageId = `<${"x".repeat(980)}@example.test>`;
  const joined = trustedMailJoin(message({ internetMessageId }), job({ microsoft: { ...job().microsoft, internetMessageId } }), event);
  assert.ok(internetMessageId.length < 1000); assert.ok(joined.evidence.length < 1024); assert.match(joined.evidence, /Internet-Message-ID SHA256 [a-f0-9]{64}/);
  assert.doesNotMatch(joined.evidence, /x{100}/);
});

test("late trace reconciliation revisits stored messages beyond overlap and advances no source/publication checkpoint", async () => {
  const db = new FakeFirestore({ "issueTrackerSettings/current": { enabled: true, sourceRecoveryEnabled: true }, [`userIssueOutbox/${ID}`]: job(), [`userIssueOccurrences/${ID}`]: event,
    "issueTrackerQueue/mail-old": { source: "outlook", message: message(), pending: false } });
  let wakes = 0, enqueues = 0;
  const bridge = { enqueueMessage: async value => { enqueues++; await db.doc("issueTrackerQueue/mail-old").update({ message: value, pending: true }); return { ticket: { queueId: "mail-old", version: 2 } }; }, wake: async () => { wakes++; } };
  const capture = createMailCapture({ db, bridge, graph: {}, now: () => AT + 86400000 });
  const result = await capture.reconcile(); assert.equal(result.linked, 1); assert.equal(wakes, 1); assert.equal(result.sourceCompleteThroughAdvanced, false);
  assert.equal(db.snapshot("issueTrackerState/mailJoinRecovery").publicationConfirmed, false);
  assert.equal(db.snapshot("issueTrackerQueue/mail-old").message.exactJoin.value, ID);
  await capture.reconcile(); assert.equal(enqueues, 1);
});

test("late read failure leaves reconciliation cursor and original stored email intact", async () => {
  const original = message({ receivedRecipients: undefined }); delete original.receivedRecipients;
  const db = new FakeFirestore({ "issueTrackerSettings/current": { enabled: true, sourceRecoveryEnabled: true }, "issueTrackerState/mailJoinRecovery": { cursor: "mail-before" },
    "issueTrackerQueue/mail-old": { source: "outlook", message: original } });
  const capture = createMailCapture({ db, bridge: {}, graph: { message: async () => { throw Object.assign(new Error("denied"), { code: "tracker_graph_access_denied" }); } } });
  await assert.rejects(capture.reconcile(), { code: "tracker_graph_access_denied" });
  assert.equal(db.snapshot("issueTrackerState/mailJoinRecovery").cursor, "mail-before"); assert.deepEqual(db.snapshot("issueTrackerQueue/mail-old").message, original);
});
