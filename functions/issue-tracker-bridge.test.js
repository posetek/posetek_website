"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createIssueTrackerBridge, PATHS, COALESCE_MS, DAILY_ATTEMPT_LIMIT } = require("./issue-tracker-bridge");
const M = require("./issue-tracker-bridge-model");
const { createPowerAutomateTransport, createFlowTokenProvider, flowEndpoint } = require("./issue-tracker-bridge-transport");
const { createTrackerMailIngress } = require("./issue-tracker-bridge-ingress");
const AT = Date.parse("2026-10-01T22:00:00Z"), ID = "a".repeat(64), ISSUE = "b".repeat(64);
const changes = id => ({ actions: [], instances: [{ key: id, expectedMachineSha256: null, values: { Instance: "EV-001", "Occurrence ID": id } }], emails: [], dailyRows: [] });
function receipt(batch, counts = Object.fromEntries(M.GROUPS.map(group => [group, batch.changes[group].length]))) { return { schemaVersion: 1, batchId: batch.batchId, workbookKey: batch.workbookKey, payloadSha256: batch.payloadSha256, verified: true, revision: batch.expectedRevision + 1, counts,
  applied: Object.fromEntries(M.GROUPS.map(group => [group, batch.changes[group].map(row => row.key)])) }; }
function fixture({ send, schedule, normalize, preserveCounts = false } = {}) {
  let time = AT, serial = 0;
  const db = new FakeFirestore({ [PATHS.settings]: { enabled: true, seedVerified: true, connectionVerified: true, workbookKey: "shared-file-identity", mailbox: "dylank@posetek.net" },
    [PATHS.writer]: { revision: 0 }, [PATHS.seed]: { counter: 0, counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } }, [`userIssueOutbox/${ID}`]: { type: "incident", issueId: ISSUE, createdAtMillis: AT, status: "pending", attempts: 0 },
    [`userIssueOccurrences/${ID}`]: { id: ID, issueId: ISSUE, source: "client", reporterUid: "known-reporter" }, [`userIssues/${ISSUE}`]: { id: ISSUE, state: "new", occurrences: 1 } });
  const tasks = [], sent = [];
  const service = createIssueTrackerBridge({ db, now: () => time, randomId: () => `test-${++serial}`, scheduleTask: async (data, options) => { tasks.push({ data, options }); if (schedule) await schedule(data, options); },
    normalize: normalize || (async ({ outbox, seed }) => ({ changes: changes(outbox[0]?.id || "mail"), nextSeed: { counter: seed.counter + 1 } })),
    transport: { send: async batch => { sent.push(structuredClone(batch)); const answer = send ? await send(batch) : receipt(batch); if (answer?.counts && !preserveCounts) answer.counts = db.snapshot(`${PATHS.batches}/${batch.batchId}`).nextSeedMetadata.counts; return answer; } } });
  return { db, service, tasks, sent, advance: ms => { time += ms; } };
}

test("current live outbox state, not stale trigger image, drives a coalesced durable queue", async () => {
  const f = fixture(); await f.service.observeOutbox(ID);
  const initial = f.db.snapshot(`${PATHS.queue}/outbox-${ID}`);
  await f.db.doc(`userIssueOutbox/${ID}`).update({ status: "sending", attempts: 4, leaseId: "private", dueAtMillis: AT + 120000 });
  await f.service.observeOutbox(ID);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).version, initial.version);
  assert.equal(f.tasks[0].options.id, f.tasks[1].options.id);
  assert.ok(f.tasks[0].options.scheduleTime.getTime() > AT && f.tasks[0].options.scheduleTime.getTime() <= AT + COALESCE_MS);
  await f.db.doc(`userIssueOutbox/${ID}`).update({ status: "delivered", recipientDelivery: { "dylank@posetek.net": { status: "delivered", atMillis: AT } } });
  await f.service.observeOutbox(ID);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).version, initial.version + 1);
});

test("distinct recurrence IDs stay separate; daily and admin status changes queue too", async () => {
  const f = fixture();
  for (const [id, type] of [[ID, "incident"], ["c".repeat(64), "incident"], ["d".repeat(64), "status"], ["e".repeat(64), "daily"]]) {
    await f.db.doc(`userIssueOutbox/${id}`).set({ type, status: "pending", issueId: ISSUE }); await f.service.observeOutbox(id);
  }
  assert.equal((await f.db.collection(PATHS.queue).get()).size, 4);
});

test("disabled observer creates no queue, while disabled mail ingress is retryable", async () => {
  const f = fixture(); await f.db.doc(PATHS.settings).update({ enabled: false });
  assert.deepEqual(await f.service.observeOutbox(ID), { queued: false });
  await assert.rejects(f.service.enqueueMessage({ id: "m", mailbox: "dylank@posetek.net" }), { code: "tracker_disabled" });
  assert.equal(f.tasks.length, 0);
});

test("queue survives scheduling failure; repeated trigger schedules recovery", async () => {
  let fail = true;
  const f = fixture({ schedule: async () => { if (fail) throw new Error("temporary"); } });
  await assert.rejects(f.service.observeOutbox(ID));
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).pending, true);
  fail = false; await f.service.observeOutbox(ID); assert.equal(f.tasks.length, 2);
});

test("verified receipt atomically commits seed/revision and only then acknowledges queue", async () => {
  const f = fixture(); await f.service.observeOutbox(ID); await f.service.drain();
  assert.equal(f.db.snapshot(PATHS.writer).revision, 1);
  assert.equal(f.db.snapshot(PATHS.seed).counter, 1);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).pending, false);
  assert.equal(f.db.snapshot(`userIssueOutbox/${ID}`).status, "pending");
});

test("ambiguous remote outcome retries identical frozen batch without reallocating IDs", async () => {
  let first = true;
  const f = fixture({ send: async batch => { if (first) { first = false; throw Object.assign(new Error("uncertain"), { code: "tracker_transport_uncertain" }); } return receipt(batch); } });
  await f.service.observeOutbox(ID); await assert.rejects(f.service.drain());
  assert.equal(f.db.snapshot(PATHS.seed).counter, 0); assert.equal(f.db.snapshot(PATHS.writer).revision, 0);
  f.advance(5000); await f.service.drain();
  assert.deepEqual(f.sent[0], f.sent[1]); assert.equal(f.db.snapshot(PATHS.seed).counter, 1);
});

test("new material state during remote write remains pending for next revision", async () => {
  let f;
  f = fixture({ send: async batch => { await f.db.doc(`userIssueOutbox/${ID}`).update({ status: "delivered" }); await f.service.observeOutbox(ID); return receipt(batch); } });
  await f.service.observeOutbox(ID); await f.service.drain();
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).pending, true);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).appliedVersion, 1);
  assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).version, 2);
  assert.equal(f.db.snapshot(PATHS.writer).revision, 1);
  f.advance(5000); await f.service.drain(); assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).pending, false);
});

test("competing worker cannot send while first holds the writer lease", async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture({ send: async batch => { started(); await new Promise(resolve => { release = resolve; }); return receipt(batch); } });
  await f.service.observeOutbox(ID); const first = f.service.drain(); await ready;
  await assert.rejects(f.service.drain(), { code: "tracker_writer_busy" });
  release(); await first; assert.equal(f.sent.length, 1);
});

test("wrong or incomplete remote receipt blocks publication and preserves queue/seed", async () => {
  const f = fixture({ send: async batch => ({ ...receipt(batch), applied: { actions: [], instances: [], emails: [], dailyRows: [] } }) });
  await f.service.observeOutbox(ID); await assert.rejects(f.service.drain(), { code: "tracker_incomplete_receipt" });
  assert.equal(f.db.snapshot(PATHS.writer).revision, 0); assert.equal(f.db.snapshot(PATHS.writer).blockedReason, "tracker_incomplete_receipt");
  assert.equal(f.db.snapshot(PATHS.seed).counter, 0); assert.equal(f.db.snapshot(`${PATHS.queue}/outbox-${ID}`).pending, true);
});

test("receipt full row counts must match verified seed counts plus exact additions", async () => {
  const f = fixture({ preserveCounts: true, send: async batch => receipt(batch, { actions: 7, instances: 500, emails: 4, dailyRows: 0 }) });
  await f.service.observeOutbox(ID); await assert.rejects(f.service.drain(), { code: "tracker_invalid_receipt_counts" });
  assert.equal(f.db.snapshot(PATHS.writer).revision, 0);
  assert.equal(f.db.snapshot(PATHS.writer).blockedReason, "tracker_invalid_receipt_counts");
});

test("historical snapshots exceeding one MiB stay in row shards and only selected rows hydrate", async () => {
  const { createSeedStore, splitSeed, ROWS } = require("./issue-tracker-bridge-seed");
  const db = new FakeFirestore(), rows = {};
  for (let i = 0; i < 523; i++) rows[`source-${i}`] = { rowId: `EV-${i + 1}`, hash: "a".repeat(64), values: { evidence: "Reviewed evidence ".repeat(230) }, links: {} };
  const logical = { schemaVersion: 1, counters: { instance: 523 }, counts: { actions: 0, instances: 523, emails: 0, dailyRows: 0 }, rows: { actions: {}, instances: rows, emails: {}, dailyRows: {} } };
  assert.ok(Buffer.byteLength(JSON.stringify(logical)) > 1048576);
  const split = splitSeed(logical);
  assert.ok(Buffer.byteLength(JSON.stringify(split.metadata)) < 1000);
  for (const row of split.changedRows) await db.doc(`${ROWS}/${row.id}`).set(row);
  const store = createSeedStore(db), partial = await store.load(split.metadata);
  assert.equal(Object.keys(partial.rows.instances).length, 0);
  await store.hydrate(partial, "instances", "source-522");
  assert.equal(Object.keys(partial.rows.instances).length, 1);
  assert.equal(partial.rows.instances["source-522"].values.evidence, rows["source-522"].values.evidence);
});

test("candidate entrypoints remain task-authenticated and self-exclude from incident log intake", async () => {
  const { createIssueTrackerBridgeEntrypoints } = require("./issue-tracker-bridge-entrypoints");
  const functions = require("firebase-functions");
  const previousProject = process.env.GCLOUD_PROJECT; process.env.GCLOUD_PROJECT = "candidate-test-only";
  try {
    const entries = createIssueTrackerBridgeEntrypoints(functions, { firestore: () => new FakeFirestore() }, { normalize: () => ({}), taskQueue: { enqueue: async () => {} } });
    assert.equal(entries.drainUserIssueTracker.__endpoint.taskQueueTrigger.invoker[0], "private");
    assert.equal(entries.drainUserIssueTracker.__endpoint.taskQueueTrigger.rateLimits.maxConcurrentDispatches, 1);
    let ingested = 0;
    const source = require("./user-issue-sources").createIssueSources({ ingest: async () => { ingested++; } }, new FakeFirestore());
    for (const name of Object.keys(entries)) await source.log({ json: { logName: "projects/kickai-69dd0/logs/run.googleapis.com%2Fstderr", severity: "ERROR", insertId: "new-error", resource: { type: "cloud_function", labels: { function_name: name.toLowerCase() } } } });
    assert.equal(ingested, 0);
  } finally { if (previousProject === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = previousProject; }
});

test("daily transport attempts include failures; exhaustion schedules next UTC day with frozen batch", async () => {
  const f = fixture(); await f.db.doc(PATHS.writer).update({ attemptDay: "2026-10-01", dailyAttempts: DAILY_ATTEMPT_LIMIT });
  await f.service.observeOutbox(ID);
  assert.deepEqual(await f.service.drain(), { applied: false, deferred: "daily_attempt_budget" });
  assert.equal(f.sent.length, 0); assert.equal(f.tasks.at(-1).options.scheduleTime.toISOString(), "2026-10-02T00:01:30.000Z");
  const batchId = f.db.snapshot(PATHS.writer).activeBatchId;
  f.advance(86400000); await f.service.drain();
  assert.equal(f.sent[0].batchId, batchId); assert.equal(f.db.snapshot(PATHS.writer).dailyAttempts, 1);
});

test("backlog continuations cannot exceed one transport attempt per five seconds", async () => {
  let first = true;
  const f = fixture({ send: async batch => { if (first) { first = false; throw Object.assign(new Error("uncertain"), { code: "tracker_transport_uncertain" }); } return receipt(batch); } });
  await f.service.observeOutbox(ID); await assert.rejects(f.service.drain());
  assert.deepEqual(await f.service.drain(), { applied: false, deferred: "call_spacing" });
  assert.equal(f.sent.length, 1); assert.equal(f.db.snapshot(PATHS.writer).dailyAttempts, 1);
  f.advance(5000); await f.service.drain(); assert.equal(f.sent.length, 2);
});

test("real normalizer produces a machine-only frozen batch and replay updates same stable instance", async () => {
  const { normalizeIssueTracker } = require("./issue-tracker-normalize");
  const f = fixture({ normalize: normalizeIssueTracker });
  await f.db.doc(PATHS.seed).set({ schemaVersion: 1, counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } });
  await f.service.observeOutbox(ID); await f.service.drain();
  const batch = f.sent[0];
  assert.equal(batch.changes.instances[0].values.Instance, "EV-001");
  for (const forbidden of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(batch.changes.actions[0].values, forbidden), false);
  const instanceKey = batch.changes.instances[0].key;
  await f.db.doc(`userIssueOutbox/${ID}`).update({ status: "accepted", providerId: "provider-exact-id" });
  await f.service.observeOutbox(ID); f.advance(5000); await f.service.drain();
  assert.equal(f.sent[1].changes.instances[0].key, instanceKey);
  assert.equal(f.sent[1].changes.instances[0].values.Instance, "EV-001");
  assert.match(f.sent[1].changes.instances[0].expectedMachineSha256, /^[a-f0-9]{64}$/);
});

test("independent occurrence capture persists missing-outbox incidents and later attaches exact delivery without reallocating", async () => {
  const f = fixture({ normalize: require("./issue-tracker-normalize").normalizeIssueTracker });
  await f.db.doc(PATHS.seed).set({ schemaVersion: 1, counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } });
  await f.db.doc(`userIssueOutbox/${ID}`).delete();
  const ticket = await f.service.observeOccurrence(ID); assert.equal(ticket.ticket.version, 1);
  await f.service.drain(); assert.match(f.sent[0].changes.instances[0].values["Email delivery"], /delivery unknown/);
  await f.db.doc(`userIssues/${ISSUE}`).update({ state: "fix_proposed" }); await f.service.observeOccurrence(ID); f.advance(5000); await f.service.drain();
  assert.equal(f.sent[1].changes.instances[0].values.Instance, "EV-001");
  await f.db.doc(`userIssueOutbox/${ID}`).set({ type: "incident", issueId: ISSUE, status: "accepted", createdAtMillis: AT });
  await f.service.observeOutbox(ID); f.advance(5000); await f.service.drain();
  assert.equal(f.sent[2].changes.instances[0].values.Instance, "EV-001"); assert.match(f.sent[2].changes.instances[0].values["Email delivery"], /accepted/);
  assert.equal((await f.db.collection(PATHS.queue).get()).size, 1);
});

test("mailbox sweep does not erase arrival-discovered aliases or churn unchanged queue versions", async () => {
  const f = fixture(), message = { id: "immutable", immutableId: "immutable", mailbox: "dylank@posetek.net", aliases: ["old-id"] };
  await f.service.enqueueMessage(message, { schedule: false });
  await f.service.enqueueMessage({ ...message, aliases: [] }, { schedule: false });
  const key = `mail-${M.digest([message.mailbox, message.id])}`, state = f.db.snapshot(`${PATHS.queue}/${key}`);
  assert.equal(state.version, 1); assert.deepEqual(state.message.aliases, ["old-id"]); assert.equal(f.tasks.length, 0);
});

test("matched email-only updates hydrate current backend snapshots through durable aliases", async () => {
  const { normalizeIssueTracker } = require("./issue-tracker-normalize");
  const f = fixture({ normalize: normalizeIssueTracker });
  await f.db.doc(PATHS.seed).set({ schemaVersion: 1, counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } });
  await f.service.observeOutbox(ID); await f.service.drain();
  const first = { id: "mail-original", mailbox: "dylank@posetek.net", receivedDateTime: "2026-10-01T22:01:00Z", subject: "Issue notification", exactJoin: { type: "occurrenceId", value: ID, evidence: "Trusted internal exact correlation" } };
  await f.service.enqueueMessage(first); f.advance(5000); await f.service.drain();
  assert.equal(f.sent[1].changes.emails[0].values["Linked instance"], "EV-001");
  await f.service.enqueueMessage({ id: "mail-moved", aliases: ["mail-original"], mailbox: first.mailbox, subject: first.subject, webLink: "https://outlook.office.com/mail/item/moved", receivedDateTime: first.receivedDateTime });
  f.advance(5000); await f.service.drain();
  assert.equal(f.sent[2].changes.emails[0].key, "mail-original");
  assert.equal(f.sent[2].changes.emails[0].values["Linked instance"], "EV-001");
});

test("mail normalization preflight rejects deterministic poison before durable acknowledgement", async () => {
  const { normalizeIssueTracker } = require("./issue-tracker-normalize");
  const f = fixture({ normalize: normalizeIssueTracker });
  await assert.rejects(f.service.enqueueMessage({ id: "long-mail", mailbox: "dylank@posetek.net", summary: "x".repeat(15000) }), { code: "tracker_invalid_message" });
  assert.equal((await f.db.collection(PATHS.queue).get()).size, 0);
});

test("source disappearance, missing seed or unverified bootstrap never produces a blank successful update", async () => {
  for (const mutate of [f => f.db.doc(`userIssueOccurrences/${ID}`).delete(), f => f.db.doc(PATHS.seed).delete(), f => f.db.doc(PATHS.settings).update({ seedVerified: false })]) {
    const f = fixture(); await f.service.observeOutbox(ID); await mutate(f); await assert.rejects(f.service.drain()); assert.equal(f.sent.length, 0);
  }
});

test("Outlook messages are mailbox scoped, distinct messages retained, same identity idempotent", async () => {
  const f = fixture();
  await assert.rejects(f.service.enqueueMessage({ id: "x", mailbox: "other@posetek.net" }), { code: "tracker_wrong_mailbox" });
  const m = { id: "x", internetMessageId: "<stable-one>", mailbox: "dylank@posetek.net", subject: "Cloud alert" };
  await f.service.enqueueMessage(m); await f.service.enqueueMessage(m); await f.service.enqueueMessage({ ...m, id: "y", internetMessageId: "<stable-two>" });
  assert.equal((await f.db.collection(PATHS.queue).get()).size, 2);
});

test("canonical hashes are key-order independent and receipt cannot omit or duplicate keys", () => {
  assert.equal(M.digest({ z: [1, 2], a: "x" }), M.digest({ a: "x", z: [1, 2] }));
  const batch = M.sealBatch({ batchId: "b", workbookKey: "w", expectedRevision: 0, generatedAt: "2026-10-01T00:00:00Z", changes: changes(ID) });
  assert.equal(M.verifyReceipt(batch, receipt(batch)).revision, 1);
  assert.throws(() => M.verifyReceipt(batch, { ...receipt(batch), payloadSha256: "wrong" }));
  assert.throws(() => M.sealBatch({ ...batch, changes: { ...batch.changes, instances: [batch.changes.instances[0], batch.changes.instances[0]] } }));
});

const ENDPOINT = "https://test.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/flow-id/triggers/manual/paths/invoke?api-version=1";
test("Power Automate transport requires OAuth, rejects SAS/redirect destinations and 202 acknowledgements", async () => {
  for (const url of ["http://test.logic.azure.com/workflows/f/triggers/manual/paths/invoke", "https://attacker.test/workflows/f/triggers/manual/paths/invoke", `${ENDPOINT}&sig=secret`]) assert.throws(() => flowEndpoint(url));
  const batch = M.sealBatch({ batchId: "b", workbookKey: "w", expectedRevision: 0, generatedAt: "now", changes: changes(ID) });
  const calls = [];
  const transport = createPowerAutomateTransport({ endpoint: async () => ENDPOINT, getAccessToken: async () => "delegated-trigger-token", fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { ok: true, status: 200, json: async () => receipt(batch) };
  } });
  await transport.send(batch); assert.equal(calls[0].options.redirect, "error"); assert.equal(calls[0].options.headers.Authorization, "Bearer delegated-trigger-token");
  const accepted = createPowerAutomateTransport({ endpoint: async () => ENDPOINT, getAccessToken: async () => "token", fetchImpl: async () => ({ ok: true, status: 202 }) });
  await assert.rejects(accepted.send(batch), { code: "tracker_unverified_receipt" });
});

test("token provider is tenant scoped, cached, refreshes and never exposes provider error body", async () => {
  let time = AT, calls = 0;
  const token = createFlowTokenProvider({ now: () => time, credentials: async () => ({ tenantId: "11111111-1111-1111-1111-111111111111", clientId: "22222222-2222-2222-2222-222222222222", clientSecret: "fixture-only-secret-value" }),
    fetchImpl: async (url, options) => { calls++; assert.match(url, /^https:\/\/login.microsoftonline.com\/111/); assert.match(options.body, /client_credentials/);
      const scope = new URLSearchParams(options.body).get("scope");
      assert.equal(scope, "https://service.flow.microsoft.com//.default");
      assert.equal(scope.slice(0, -"/.default".length), "https://service.flow.microsoft.com/", "v2 resource extraction must retain the HTTP trigger audience's trailing slash");
      return { ok: true, json: async () => ({ access_token: "example-token-1234567890", expires_in: 3600, token_type: "Bearer" }) }; } });
  await token(); await token(); assert.equal(calls, 1); time += 3600000; await token(); assert.equal(calls, 2);
});

test("mail ingress rejects missing/wrong credentials, other mailbox and disabled queues", async () => {
  const f = fixture(), secret = "fixture-only-long-secret-at-least-32-characters";
  const handler = createTrackerMailIngress({ bridge: f.service, secret: async () => secret });
  async function request(key, body = { schemaVersion: 1, mailbox: "dylank@posetek.net", message: { id: "m" } }) {
    const response = { code: 0, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ method: "POST", body, headers: { "content-type": "application/json", "x-posetek-tracker-key": key } }, response); return response;
  }
  assert.equal((await request(undefined)).code, 401); assert.equal((await request("wrong")).code, 401);
  assert.equal((await request(secret, { schemaVersion: 1, mailbox: "other@posetek.net", message: { id: "m" } })).code, 400);
  assert.equal((await request(secret, { schemaVersion: 1, mailbox: "dylank@posetek.net", message: { id: "sender-mail", from: "support@alerts.posetek.net", sender: "support@alerts.posetek.net" } })).code, 200);
  assert.equal((await request(secret)).code, 200);
  assert.equal((await request(secret, { schemaVersion: 1, mailbox: "dylank@posetek.net", message: { id: "m", exactJoin: { type: "occurrenceId", value: ID, evidence: "unverified" } } })).code, 400);
  for (const message of [{ id: "   " }, { id: "bad\nkey" }, { id: "m", immutableId: "  " }, { id: "m", aliases: ["\t"] }, { id: "m", monitoring: { project: " ", incidentId: "incident" } }]) {
    assert.equal((await request(secret, { schemaVersion: 1, mailbox: "dylank@posetek.net", message })).code, 400);
    await assert.rejects(f.service.enqueueMessage({ ...message, mailbox: "dylank@posetek.net" }), { code: "tracker_invalid_message" });
  }
  await f.db.doc(PATHS.settings).update({ enabled: false }); assert.equal((await request(secret)).code, 503);
});
