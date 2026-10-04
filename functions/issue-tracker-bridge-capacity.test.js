"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createIssueTrackerBridge, PATHS } = require("./issue-tracker-bridge");
const { ROWS, splitSeed, rowDocumentId } = require("./issue-tracker-bridge-seed");
const { normalizeIssueTracker } = require("./issue-tracker-normalize");
const M = require("./issue-tracker-bridge-model");
const AT = Date.parse("2026-10-03T22:00:00Z"), MAILBOX = "dylank@posetek.net";
const bytes = value => Buffer.byteLength(M.canonical(value));
const groups = () => Object.fromEntries(M.GROUPS.map(group => [group, []]));
const emptySeed = () => ({ schemaVersion: 1, counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } });
function metadataAtExistingScale() {
  const seed = emptySeed();
  seed.outboxOccurrences = Object.fromEntries(Array.from({ length: 3714 }, (_, index) => [M.digest(["historical-job", index]), M.digest(["historical-occurrence", index])]));
  assert.ok(bytes(seed) > 497000 && bytes(seed) < 499000);
  return seed;
}
function message(index, length = 6000) { return { id: `source-${String(index).padStart(3, "0")}`, mailbox: MAILBOX, subject: "PoseTek recorded issue", receivedDateTime: new Date(AT + index).toISOString(), summary: "e".repeat(length) }; }
function fixture({ seed = metadataAtExistingScale(), normalize = normalizeIssueTracker, send } = {}) {
  let time = AT, serial = 0;
  const db = new FakeFirestore({ [PATHS.settings]: { enabled: true, seedVerified: true, connectionVerified: true, workbookKey: "shared-workbook", mailbox: MAILBOX }, [PATHS.writer]: { revision: 0 }, [PATHS.seed]: seed });
  const sent = [], tasks = [], attempts = [], reads = new Map();
  const originalRead = db.read.bind(db); db.read = path => { reads.set(path, (reads.get(path) || 0) + 1); return originalRead(path); };
  const service = createIssueTrackerBridge({ db, now: () => time, randomId: () => `capacity-${++serial}`, scheduleTask: async (data, options) => { tasks.push({ data, options }); },
    normalize: async input => { attempts.push({ selected: input.messages.length + input.outbox.length + input.occurrences.filter(row => !input.outbox.some(job => job.id === row.id)).length, counters: structuredClone(input.seed.counters || {}), hydrated: Object.fromEntries(M.GROUPS.map(group => [group, Object.keys(input.seed.rows[group])])) }); return normalize(input); },
    transport: { send: async payload => { sent.push(structuredClone(payload)); const answer = { schemaVersion: 1, batchId: payload.batchId, workbookKey: payload.workbookKey, payloadSha256: payload.payloadSha256, verified: true, revision: payload.expectedRevision + 1, counts: db.snapshot(`${PATHS.batches}/${payload.batchId}`).nextSeedMetadata.counts, applied: Object.fromEntries(M.GROUPS.map(group => [group, payload.changes[group].map(row => row.key)])) }; return send ? send(payload, answer) : answer; } } });
  async function queue(count, length = 6000) {
    // Deliberately reverse adapter order; the chosen bounded page must have a
    // deterministic document-ID prefix, independent of this test adapter.
    for (let i = count - 1; i >= 0; i--) await db.doc(`${PATHS.queue}/mail-${String(i).padStart(3, "0")}`).set({ source: "outlook", sourceId: `source-${i}`, message: message(i, length), version: 1, desiredHash: M.digest([i, length]), appliedVersion: 0, pending: true });
  }
  return { db, service, sent, tasks, attempts, reads, queue, advance: ms => { time += ms; } };
}
function frozen(f) { return f.db.snapshot(`${PATHS.batches}/${f.sent.at(-1).batchId}`); }
async function pending(f) { return (await f.db.collection(PATHS.queue).where("pending", "==", true).get()).docs; }
async function storeSeed(f, logical) {
  const { metadata, changedRows } = splitSeed(logical);
  await f.db.doc(PATHS.seed).set(metadata);
  for (const row of changedRows) await f.db.doc(`${ROWS}/${row.id}`).set({ group: row.group, key: row.key, value: row.value });
}
function syntheticNormalize({ chars = 0, shardsPerTicket = 1, shardChars = 0, extraMetadata = 0 } = {}) {
  return async ({ messages, seed }) => {
    const changes = groups(), nextSeed = structuredClone(seed);
    nextSeed.rows ||= Object.fromEntries(M.GROUPS.map(group => [group, {}]));
    nextSeed.counter = (seed.counter || 0) + messages.length;
    if (extraMetadata) nextSeed.padding = "m".repeat(extraMetadata);
    for (const mail of messages) {
      changes.emails.push({ key: mail.id, expectedMachineSha256: null, values: { Evidence: "p".repeat(chars) } });
      for (let i = 0; i < shardsPerTicket; i++) nextSeed.rows.emails[`${mail.id}-${i}`] = { hash: "a".repeat(64), rowId: mail.id, values: { Evidence: "s".repeat(shardChars) }, links: {} };
    }
    return { changes, nextSeed };
  };
}

test("real normalization at the existing metadata scale shrinks40 and drains every retained ticket without allocation gaps", async () => {
  const f = fixture(); await f.queue(40);
  const before = new Map((await pending(f)).map(row => [row.id, row.data()]));
  await f.service.drain();
  assert.equal(f.attempts[0].selected, 40); assert.ok(f.attempts.length > 1 && f.attempts.length <= 6);
  const batch = frozen(f), applied = batch.selected.length;
  assert.ok(applied > 0 && applied < 40); assert.ok(bytes(batch) <= 700000);
  assert.deepEqual(batch.selected.map(row => row.id), [...before.keys()].sort().slice(0, applied));
  for (const row of await pending(f)) assert.deepEqual(row.data(), before.get(row.id));
  assert.equal((await pending(f)).length, 40 - applied);
  for (const attempt of f.attempts) { assert.deepEqual(attempt.counters, {}); assert.equal(attempt.hydrated.emails.length, 0); }
  assert.equal(f.db.snapshot(PATHS.seed).counters.email, applied);
  while ((await pending(f)).length) { f.advance(5000); await f.service.drain(); }
  const emailRows = (await f.db.collection(ROWS).where("group", "==", "emails").get()).docs.map(row => row.data().value);
  assert.equal(emailRows.length, 40); assert.equal(new Set(emailRows.map(row => row.rowId)).size, 40);
  assert.deepEqual(emailRows.map(row => Number(row.rowId.slice(3))).sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.equal(f.db.snapshot(PATHS.seed).counts.emails, 40);
  for (const payload of f.sent) for (const row of payload.changes.actions) for (const field of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(row.values, field), false);
});

test("reduced frozen batch replays byte-exactly; newer selected versions and unselected tickets remain pending", async () => {
  let fail = true;
  const f = fixture({ send: async (_payload, answer) => { if (fail) throw Object.assign(new Error("unknown"), { code: "tracker_transport_uncertain" }); return answer; } });
  await f.queue(40); await assert.rejects(f.service.drain(), { code: "tracker_transport_uncertain" });
  const batch = frozen(f), count = f.attempts.length, first = batch.selected[0];
  const untouched = new Map((await pending(f)).filter(row => !batch.selected.some(selected => selected.id === row.id)).map(row => [row.id, row.data()]));
  await f.db.doc(`${PATHS.queue}/${first.id}`).update({ version: 2, desiredHash: M.digest("new-version") });
  // Replay must not attempt normalization or a new size calculation against a
  // newer seed; its complete payload/selection was frozen before first send.
  fail = false; f.advance(5000); await f.service.drain();
  assert.deepEqual(f.sent[1], f.sent[0]); assert.equal(f.attempts.length, count);
  assert.equal(f.db.snapshot(`${PATHS.queue}/${first.id}`).pending, true);
  assert.equal(f.db.snapshot(`${PATHS.queue}/${first.id}`).appliedVersion, 1);
  for (const [id, old] of untouched) assert.deepEqual(f.db.snapshot(`${PATHS.queue}/${id}`), old);
});

test("seed row count guard shrinks independently and no rejected rows or metadata survive", async () => {
  const f = fixture({ seed: emptySeed(), normalize: syntheticNormalize({ shardsPerTicket: 5 }) }); await f.queue(40, 1);
  await f.service.drain(); assert.deepEqual(f.attempts.map(row => row.selected), [40, 20]);
  assert.equal(frozen(f).seedRowIds.length, 100); assert.equal(f.db.snapshot(PATHS.seed).counter, 20);
  assert.equal((await pending(f)).length, 20); assert.equal((await f.db.collection(ROWS).get()).size, 100);
});

test("six-megabyte transaction guard shrinks while keeping each document and batch below700k", async () => {
  const f = fixture({ seed: emptySeed(), normalize: syntheticNormalize({ shardChars: 180000 }) }); await f.queue(40, 1);
  await f.service.drain(); assert.deepEqual(f.attempts.map(row => row.selected), [40, 20]);
  const batch = frozen(f); assert.ok(bytes(batch) < 700000);
  const total = batch.seedRowIds.reduce((sum, id) => sum + bytes(f.db.snapshot(`${PATHS.batches}/${batch.payload.batchId}/rows/${id}`)), bytes(batch));
  assert.ok(total <= 6000000); assert.equal((await pending(f)).length, 20);
});

test("single oversized ticket remains pending with no batch, transport or allocation", async () => {
  const f = fixture({ seed: emptySeed(), normalize: syntheticNormalize({ chars: 701000 }) }); await f.queue(40, 1);
  const seed = f.db.snapshot(PATHS.seed), queue = new Map((await pending(f)).map(row => [row.id, row.data()]));
  await assert.rejects(f.service.drain(), { code: "tracker_batch_capacity" });
  assert.deepEqual(f.attempts.map(row => row.selected), [40, 20, 10, 5, 2, 1]);
  assert.equal(f.sent.length, 0); assert.equal((await f.db.collection(PATHS.batches).get()).size, 0);
  assert.deepEqual(f.db.snapshot(PATHS.seed), seed); assert.equal(f.db.snapshot(PATHS.writer).activeBatchId, undefined);
  for (const [id, old] of queue) assert.deepEqual(f.db.snapshot(`${PATHS.queue}/${id}`), old);
});

test("global metadata or individual row oversize remains explicit and never bypasses original seed caps", async () => {
  for (const normalize of [syntheticNormalize({ extraMetadata: 701000 }), syntheticNormalize({ shardChars: 701000 })]) {
    const f = fixture({ seed: emptySeed(), normalize }); await f.queue(2, 1);
    await assert.rejects(f.service.drain(), { code: "tracker_seed_capacity" });
    assert.deepEqual(f.attempts.map(row => row.selected), [2, 1]); assert.equal(f.sent.length, 0); assert.equal((await pending(f)).length, 2);
  }
});

test("noncapacity normalization or evidence failures do not hide a rejected tail behind smaller prefixes", async () => {
  for (const code of ["tracker_alias_group_changed", "tracker_invalid_join", "tracker_source_unavailable"]) {
    const f = fixture({ normalize: async () => M.fail(code) }); await f.queue(40, 1);
    await assert.rejects(f.service.drain(), { code }); assert.equal(f.attempts.length, 1);
    assert.equal(f.sent.length, 0); assert.equal((await pending(f)).length, 40);
  }
});

test("hydrated join reads are reused across candidates and rejected prefix rows never leak into the fitting seed", async () => {
  const id = M.digest("joined-job"), issueId = M.digest("joined-issue");
  const f = fixture(); await f.queue(40);
  await f.db.doc(`userIssueOutbox/${id}`).set({ type: "incident", issueId, providerId: "exact-provider", status: "delivered", createdAtMillis: AT });
  await f.db.doc(`userIssueOccurrences/${id}`).set({ id, issueId, kind: "error", source: "client", reporterUid: "account", operation: "recorded-action", occurredAtMillis: AT });
  await f.db.doc(`userIssues/${issueId}`).set({ state: "new" });
  // Put the backend-linked message in the excluded tail: the large rejected
  // attempt may hydrate it, but the fitting prefix cannot publish its instance.
  await f.db.doc(`${PATHS.queue}/mail-039`).update({ message: { ...message(39), exactJoin: { type: "providerId", value: "exact-provider", evidence: "backend-proven" } } });
  await f.service.drain(); assert.ok(f.attempts.length > 1);
  assert.equal(f.sent[0].changes.instances.length, 0); assert.equal(f.db.snapshot(PATHS.seed).outboxOccurrences[id], undefined);
  assert.equal(f.reads.get(`userIssueOutbox/${id}`), 1); assert.equal(f.reads.get(`userIssueOccurrences/${id}`), 1);
  assert.equal(f.db.queries.filter(query => query.path === "userIssueOutbox").length, 1);
  while ((await pending(f)).length) { f.advance(5000); await f.service.drain(); }
  const row = f.db.snapshot(`${ROWS}/${rowDocumentId("emails", message(39).id)}`).value;
  assert.equal(row.values["Linked instance"], "EV-001"); assert.equal(f.db.snapshot(PATHS.seed).outboxOccurrences[id], id);
});

test("late exact aliases retain historical cell prose, stable IDs and machine-only action updates after reduction", async () => {
  const original = { ...message(0, 100), id: "mail-original", subject: "Historical alert", webLink: "https://outlook.office.com/mail/item/original", summary: "Reviewed historical diagnosis and original evidence." };
  const baseline = normalizeIssueTracker({ messages: [original], seed: metadataAtExistingScale() });
  baseline.nextSeed.counts = Object.fromEntries(M.GROUPS.map(group => [group, baseline.changes[group].length]));
  const f = fixture({ seed: emptySeed() }); await storeSeed(f, baseline.nextSeed); await f.queue(40);
  await f.db.doc(`${PATHS.queue}/mail-000`).update({ message: { ...original, id: "mail-moved", aliases: [original.id], webLink: "https://outlook.office.com/mail/item/moved" } });
  const old = f.db.snapshot(`${ROWS}/${rowDocumentId("emails", original.id)}`).value;
  await f.service.drain(); assert.ok(f.attempts.length > 1);
  const next = f.db.snapshot(`${ROWS}/${rowDocumentId("emails", original.id)}`).value;
  assert.equal(next.rowId, old.rowId); assert.equal(next.actionId, old.actionId);
  const diagnosis = "Message / linked diagnosis";
  assert.ok(next.values[diagnosis].startsWith(old.values[diagnosis] + "\n\n[Preserved source links]\n"));
  assert.deepEqual({ ...next.values, [diagnosis]: old.values[diagnosis] }, old.values); assert.deepEqual(next.links, old.links);
  assert.equal(f.db.snapshot(`${ROWS}/${rowDocumentId("emails", "mail-moved")}`), undefined);
  for (const payload of f.sent) for (const row of payload.changes.actions) for (const field of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(row.values, field), false);
});

test("missing referenced backend record fails closed before any prefix is frozen", async () => {
  const f = fixture(); await f.queue(40);
  await f.db.doc(`${PATHS.queue}/mail-039`).update({ message: { ...message(39), exactJoin: { type: "occurrenceId", value: M.digest("missing"), evidence: "record disappeared" } } });
  await assert.rejects(f.service.drain(), { code: "tracker_source_unavailable" });
  assert.equal(f.attempts.length, 0); assert.equal(f.sent.length, 0); assert.equal((await pending(f)).length, 40);
});
