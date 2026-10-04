"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const M = require("./issue-tracker-bridge-model"), I = require("./issue-tracker-mail-identity");
const { createMailCapture } = require("./issue-tracker-mail-capture");
const { createIssueTrackerBridge } = require("./issue-tracker-bridge");
const { normalizeIssueTracker: normalize } = require("./issue-tracker-normalize");
const { splitSeed } = require("./issue-tracker-bridge-seed");
const { TENANT, CLIENT, CALLER } = require("./issue-tracker-mail-read-proxy");
const AT = Date.parse("2026-10-04T20:00:00Z"), mailbox = I.MAILBOX;
const raw = (id = "historical-message", recipients = false) => ({ id, receivedDateTime: new Date(AT - 86400000).toISOString(),
  subject: "[PoseTek user issue] Recorded action failed", from: { emailAddress: { address: "alerts@posetek.net" } },
  internetMessageId: "<recorded@example.test>", body: { contentType: "text", content: "PoseTek recorded error" },
  webLink: `https://outlook.office.com/mail/item/${id}`,
  ...(recipients ? { internetMessageHeaders: [{ name: "To", value: mailbox }] } : {}) });
const queuePath = id => `issueTrackerQueue/mail-${M.digest([mailbox, id])}`;

async function fixture() {
  const db = new FakeFirestore({ "issueTrackerSettings/current": { enabled: true, sourceRecoveryEnabled: true, mailbox },
    "issueTrackerRows/manual-saved": { actionId: "ACT-saved", values: { Status: "In progress", Owner: "Nolan", "Due (Pacific)": "2026-10-08", "Fix notes": "Keep the saved fix and retest notes" } },
    "userIssueOutbox/historical-receipt": { originalRecipients: [mailbox, "nolanj@posetek.net"], status: "delivered", consumedClaim: "retained" } });
  const schedules = [], bridge = createIssueTrackerBridge({ db, normalize, now: () => AT,
    scheduleTask: async (...args) => { schedules.push(args); }, transport: { send: async () => { throw new Error("No writer transport in capture tests"); } } });
  let nextMail = raw();
  const graph = { message: async () => nextMail };
  const capture = createMailCapture({ db, bridge, graph, now: () => AT });
  await capture.capture(nextMail);
  const path = queuePath(nextMail.id), initial = db.snapshot(path);
  await db.doc(path).update({ pending: false, appliedVersion: initial.version, appliedHash: initial.desiredHash });
  return { db, bridge, capture, graph, schedules, path, initial, setMail: value => { nextMail = value; } };
}

test("recipient-only historical refresh wakes the writer once without a backend join", async () => {
  const f = await fixture(); f.setMail(raw(undefined, true));
  const notes = f.db.snapshot("issueTrackerRows/manual-saved"), history = f.db.snapshot("userIssueOutbox/historical-receipt");
  const result = await f.capture.reconcile(), after = f.db.snapshot(f.path);
  assert.equal(result.linked, 0); assert.equal(result.aliasesReconciled, 0); assert.equal(f.schedules.length, 1);
  assert.equal(after.pending, true); assert.equal(after.version, f.initial.version + 1); assert.equal(after.appliedVersion, f.initial.version);
  assert.deepEqual(after.message.receivedRecipients, [mailbox]); assert.equal(after.message.exactJoin, undefined);
  assert.equal(result.sourceCompleteThroughAdvanced, false);
  assert.equal(f.db.snapshot("issueTrackerState/mailJoinRecovery").publicationConfirmed, false);
  assert.deepEqual(f.db.snapshot("issueTrackerRows/manual-saved"), notes); assert.deepEqual(f.db.snapshot("userIssueOutbox/historical-receipt"), history);
});

test("unchanged recipient refetch with an already applied ticket does not create a wake", async () => {
  const f = await fixture(), before = f.db.snapshot(f.path);
  await f.capture.reconcile();
  assert.equal(f.schedules.length, 0); assert.deepEqual(f.db.snapshot(f.path), before);
});

test("unchanged recipient refetch still wakes an existing durable pending ticket", async () => {
  const f = await fixture(); await f.db.doc(f.path).update({ pending: true });
  const before = f.db.snapshot(f.path); await f.capture.reconcile();
  assert.equal(f.schedules.length, 1); assert.deepEqual(f.db.snapshot(f.path), before);
});

test("recipient refresh and a newly verified backend join share the one wake", async () => {
  const f = await fixture(), id = "a".repeat(64), issueId = "b".repeat(64); f.setMail(raw(undefined, true));
  await f.db.doc(`userIssueOutbox/${id}`).set({ type: "incident", issueId, deliveryProvider: "microsoft",
    payload: { to: [mailbox], subject: raw().subject }, microsoft: { senderMailbox: "alerts@posetek.net", claimedAtMillis: AT - 86401000,
      traceCheckedAtMillis: AT, internetMessageId: raw().internetMessageId },
    recipientDelivery: { [mailbox]: { evidence: "microsoft_trace", traceId: "actual-fixture-trace", status: "delivered" } } });
  await f.db.doc(`userIssueOccurrences/${id}`).set({ issueId });
  const result = await f.capture.reconcile();
  assert.equal(result.linked, 1); assert.equal(f.schedules.length, 1); assert.equal(f.db.snapshot(f.path).message.exactJoin.value, id);
});

test("recipient refresh and verified historical alias work share the one wake", async () => {
  const f = await fixture();
  await f.db.doc(f.path).update({ source: "excluded_fixture" });
  const identity = (id, canonicalId) => I.itemIdentity({ sourceId: id, canonicalId, sourceIdType: id === canonicalId ? "restImmutableEntryId" : "restId", responseSha256: M.digest([id, canonicalId]) });
  const envelope = id => ({ mailbox, originalId: id, receivedDateTime: raw(id).receivedDateTime, subject: raw(id).subject,
    internetMessageId: raw(id).internetMessageId, from: "alerts@posetek.net", body: raw(id).body, webLink: raw(id).webLink, aliases: [] });
  const seed = normalize({ seed: {}, messages: ["legacy", "canonical"].map(envelope) }).nextSeed, split = splitSeed(seed);
  await f.db.doc("issueTrackerState/seed").set(split.metadata);
  for (const row of split.changedRows) await f.db.doc(`issueTrackerRows/${row.id}`).set({ group: row.group, key: row.key, value: row.value });
  await f.db.doc("issueTrackerSettings/current").update({ mailIdentityProvider: "power_automate", mailIdentityProxyVerified: true,
    mailIdentityProxyProof: { schemaVersion: 1, verified: true, authorization: "delegated_translation_route", tenantId: TENANT, clientId: CLIENT,
      callerObjectId: CALLER, connectionAccount: mailbox, flowId: "11111111-2222-4333-8444-555555555555", connectionName: "a".repeat(32),
      graphResource: "https://graph.microsoft.com", targetIdType: "restImmutableEntryId", endpointSha256: "a".repeat(64), exportSha256: "b".repeat(64) } });
  for (const id of ["legacy", "canonical"]) await f.db.doc(queuePath(id)).set({ source: "outlook", sourceId: M.digest([mailbox, id]),
    pending: false, version: 1, appliedVersion: 1, message: envelope(id) });
  const capture = createMailCapture({ db: f.db, bridge: f.bridge, now: () => AT, graph: { canonicalMessage: async id => {
    const original = raw(id, true), canonicalId = "canonical";
    return { ...original, id: canonicalId, sourceMessage: original, itemIdentity: identity(id, canonicalId) };
  } } });
  const notes = f.db.snapshot("issueTrackerRows/manual-saved"), result = await capture.reconcile();
  assert.ok(result.aliasesReconciled >= 1); assert.equal(f.schedules.length, 1);
  assert.equal(f.db.snapshot(queuePath("canonical")).pending, true);
  assert.deepEqual(f.db.snapshot(queuePath("canonical")).message.aliasReconciliation.retainedIds, ["canonical", "legacy"]);
  assert.deepEqual(f.db.snapshot("issueTrackerState/seed"), split.metadata); assert.deepEqual(f.db.snapshot("issueTrackerRows/manual-saved"), notes);
});

test("failed authoritative recipient refetch keeps its cursor, original records and retry path", async () => {
  const f = await fixture(), prior = { cursor: "mail-before", lastCheckedAtMillis: AT - 1000 }, before = f.db.snapshot(f.path);
  await f.db.doc("issueTrackerState/mailJoinRecovery").set(prior);
  const notes = f.db.snapshot("issueTrackerRows/manual-saved"), history = f.db.snapshot("userIssueOutbox/historical-receipt");
  const failed = createMailCapture({ db: f.db, bridge: f.bridge, now: () => AT, graph: { message: async () => { throw Object.assign(new Error("Lookup unavailable"), { code: "tracker_graph_message_unavailable" }); } } });
  await assert.rejects(failed.reconcile(), { code: "tracker_graph_message_unavailable" });
  assert.deepEqual(f.db.snapshot("issueTrackerState/mailJoinRecovery"), prior); assert.deepEqual(f.db.snapshot(f.path), before); assert.equal(f.schedules.length, 0);
  assert.deepEqual(f.db.snapshot("issueTrackerRows/manual-saved"), notes); assert.deepEqual(f.db.snapshot("userIssueOutbox/historical-receipt"), history);
  f.setMail(raw(undefined, true)); await f.capture.reconcile();
  assert.equal(f.schedules.length, 1); assert.equal(f.db.snapshot(f.path).pending, true);
});

test("earlier queued refetch wakes once when a later lookup fails without advancing the cursor", async () => {
  const f = await fixture(); let laterId = "later-0";
  for (let n = 1; queuePath(laterId) <= f.path; n++) laterId = `later-${n}`;
  await f.capture.capture(raw(laterId));
  const laterPath = queuePath(laterId), laterInitial = f.db.snapshot(laterPath);
  await f.db.doc(laterPath).update({ pending: false, appliedVersion: laterInitial.version, appliedHash: laterInitial.desiredHash });
  const cursor = { cursor: null, lastCheckedAtMillis: AT - 1000 }; await f.db.doc("issueTrackerState/mailJoinRecovery").set(cursor);
  const laterBefore = f.db.snapshot(laterPath), notes = f.db.snapshot("issueTrackerRows/manual-saved"), history = f.db.snapshot("userIssueOutbox/historical-receipt");
  const lookupError = Object.assign(new Error("Later lookup unavailable"), { code: "tracker_graph_message_unavailable" });
  f.graph.message = async id => { if (id === raw().id) return raw(undefined, true); throw lookupError; };
  await assert.rejects(f.capture.reconcile(), error => error === lookupError);
  assert.equal(f.schedules.length, 1); assert.equal(f.db.snapshot(f.path).pending, true);
  assert.deepEqual(f.db.snapshot(laterPath), laterBefore); assert.deepEqual(f.db.snapshot("issueTrackerState/mailJoinRecovery"), cursor);
  assert.deepEqual(f.db.snapshot("issueTrackerRows/manual-saved"), notes); assert.deepEqual(f.db.snapshot("userIssueOutbox/historical-receipt"), history);
});

test("a wake failure does not hide an earlier retryable lookup failure", async () => {
  const f = await fixture(); let laterId = "later-0";
  for (let n = 1; queuePath(laterId) <= f.path; n++) laterId = `later-${n}`;
  await f.capture.capture(raw(laterId));
  const prior = { cursor: null, lastCheckedAtMillis: AT - 1000 }; await f.db.doc("issueTrackerState/mailJoinRecovery").set(prior);
  const lookupError = Object.assign(new Error("Later lookup unavailable"), { code: "tracker_graph_message_unavailable" }), wakeError = new Error("Wake unavailable");
  f.graph.message = async id => { if (id === raw().id) return raw(undefined, true); throw lookupError; };
  let wakes = 0; f.bridge.wake = async () => { wakes++; throw wakeError; };
  await assert.rejects(f.capture.reconcile(), error => error instanceof AggregateError && error.cause === lookupError
    && error.code === lookupError.code && error.errors[0] === lookupError && error.errors[1] === wakeError);
  assert.equal(wakes, 1); assert.equal(f.db.snapshot(f.path).pending, true);
  assert.deepEqual(f.db.snapshot("issueTrackerState/mailJoinRecovery"), prior);
});

test("a wake-only failure remains visible and cannot claim publication", async () => {
  const f = await fixture(); f.setMail(raw(undefined, true));
  const wakeError = new Error("Wake unavailable"); let wakes = 0;
  f.bridge.wake = async () => { wakes++; throw wakeError; };
  await assert.rejects(f.capture.reconcile(), error => error === wakeError);
  assert.equal(wakes, 1); assert.equal(f.db.snapshot(f.path).pending, true);
  assert.equal(f.db.snapshot("issueTrackerState/mailJoinRecovery").publicationConfirmed, false);
});
