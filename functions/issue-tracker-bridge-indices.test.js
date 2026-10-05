"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createIssueTrackerBridge, PATHS } = require("./issue-tracker-bridge");
const { createSeedStore, ROWS, INDEX_BASES, INDICES, INDEX_GROUPS, partitionSeed, verifyIndex } = require("./issue-tracker-bridge-seed");
const { normalizeIssueTracker } = require("./issue-tracker-normalize");
const M = require("./issue-tracker-bridge-model");
const AT = Date.parse("2026-10-04T03:00:00Z"), MAILBOX = "dylank@posetek.net";
const bytes = value => Buffer.byteLength(M.canonical(value));
const emptySeed = () => ({ schemaVersion: 1, counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } });
function legacySeed() {
  return { ...emptySeed(), outboxOccurrences: Object.fromEntries(Array.from({ length: 3714 }, (_, n) => [M.digest(["old-job", n]), M.digest(["old-occurrence", n])])) };
}
function fixture({ seed = legacySeed(), storageVersion = 2, send, normalize = normalizeIssueTracker } = {}) {
  let at = AT, sequence = 0;
  const db = new FakeFirestore({ [PATHS.settings]: { enabled: true, connectionVerified: true, seedVerified: true, seedStorageVersion: storageVersion, workbookKey: "shared", mailbox: MAILBOX }, [PATHS.writer]: { revision: 0 }, [PATHS.seed]: seed });
  const sent = [], selectedCounts = [];
  const bridge = createIssueTrackerBridge({ db, now: () => at, randomId: () => `indices-${++sequence}`, scheduleTask: async () => {}, normalize: async input => { selectedCounts.push(input.messages.length); return normalize(input); },
    transport: { send: async payload => { sent.push(structuredClone(payload)); const frozen = db.snapshot(`${PATHS.batches}/${payload.batchId}`), receipt = { schemaVersion: 1, batchId: payload.batchId, workbookKey: payload.workbookKey, payloadSha256: payload.payloadSha256, verified: true, revision: payload.expectedRevision + 1, counts: frozen.nextSeedMetadata.counts, applied: Object.fromEntries(M.GROUPS.map(group => [group, payload.changes[group].map(row => row.key)])) }; return send ? send(payload, receipt, frozen, db) : receipt; } } });
  async function queue(count, offset = 0, summarySize = 100) {
    for (let n = offset; n < offset + count; n++) await db.doc(`${PATHS.queue}/mail-${String(n).padStart(5, "0")}`).set({ source: "outlook", sourceId: `message-${n}`, version: 1, desiredHash: M.digest(n), pending: true, message: { id: `message-${n}`, mailbox: MAILBOX, receivedDateTime: new Date(AT + n).toISOString(), subject: "PoseTek recorded issue", summary: "e".repeat(summarySize) } });
  }
  return { db, bridge, queue, sent, selectedCounts, advance: () => { at += 5000; } };
}
const pending = async f => (await f.db.collection(PATHS.queue).where("pending", "==", true).get()).docs;
const metadata = f => f.db.snapshot(PATHS.seed);
const frozen = f => f.db.snapshot(`${PATHS.batches}/${f.sent.at(-1).batchId}`);
const logical = f => createSeedStore(f.db).loadMetadata(metadata(f));

test("v2 cutover is explicit, archives the original maps once and leaves the native payload/schema unchanged", async () => {
  const f = fixture({ storageVersion: 1 }); await f.queue(1); await f.bridge.drain();
  assert.equal(metadata(f).storageVersion, undefined); assert.equal((await f.db.collection(INDEX_BASES).get()).size, 0);
  const before = structuredClone(metadata(f)), actionRows = (await f.db.collection(ROWS).where("group", "==", "actions").get()).docs.map(doc => doc.data());
  await f.db.doc(PATHS.settings).update({ seedStorageVersion: 2 }); await f.queue(1, 1); f.advance(); await f.bridge.drain();
  const saved = metadata(f), batch = frozen(f), maps = await logical(f);
  assert.equal(saved.storageVersion, 2); assert.ok(bytes(saved) < 2000); assert.ok(bytes(batch) < 700000);
  assert.equal(batch.expectedSeedMetadataSha256, M.digest(before)); assert.equal((await f.db.collection(INDEX_BASES).get()).size, 1);
  assert.deepEqual(maps.outboxOccurrences, before.outboxOccurrences); assert.equal(maps.counters.email, 2);
  for (const group of INDEX_GROUPS) assert.equal(Object.hasOwn(saved, group), false);
  for (const row of actionRows) assert.deepEqual(f.db.snapshot(`${ROWS}/${row.group}-${M.digest(row.key)}`), row);
  assert.equal(f.sent[1].schemaVersion, 1); assert.deepEqual(Object.keys(f.sent[1]).sort(), Object.keys(f.sent[0]).sort());
  for (const row of f.sent[1].changes.actions) for (const column of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(row.values, column), false);
});

test("growing logical maps exceed the old700k limit while every document and native batch remain bounded", async () => {
  const f = fixture(); await f.queue(1500);
  while ((await pending(f)).length) { await f.bridge.drain(); f.advance(); }
  const maps = await logical(f), saved = metadata(f);
  assert.ok(bytes(maps) > 700000); assert.ok(bytes(saved) < 2000); assert.equal(saved.counts.emails, 1500);
  assert.equal(maps.counters.email, 1500); assert.equal(maps.counters.action, 1500);
  assert.equal(Object.keys(maps.emailAliases).length, 1500); assert.deepEqual(maps.outboxOccurrences, legacySeed().outboxOccurrences);
  assert.equal((await f.db.collection(INDEX_BASES).get()).size, 1); assert.ok(f.db.queries.filter(query => query.path === INDICES).length > 25);
  const emailRows = (await f.db.collection(ROWS).where("group", "==", "emails").get()).docs.map(doc => doc.data().value);
  assert.equal(new Set(emailRows.map(row => row.rowId)).size, 1500); assert.equal(emailRows.filter(row => row.rowId === "EM-1500").length, 1);
  for (const [path, document] of f.db.docs) if ([PATHS.batches, ROWS, INDICES, INDEX_BASES].some(prefix => path.startsWith(prefix + "/"))) assert.ok(bytes(document) <= 700000, path);
  for (const payload of f.sent) { const batch = f.db.snapshot(`${PATHS.batches}/${payload.batchId}`); assert.ok(batch.seedRowIds.length <= 150); assert.ok(batch.seedRowIds.length + batch.seedIndexIds.length <= 300); assert.ok(batch.selected.length <= 40); }
});

test("an uncertain first v2 write keeps v1 metadata until exact frozen replay acknowledges it", async () => {
  let fail = true;
  const f = fixture({ send: async (_payload, receipt) => { if (fail) M.fail("tracker_transport_uncertain"); return receipt; } });
  await f.queue(3); const before = structuredClone(metadata(f));
  await assert.rejects(f.bridge.drain(), { code: "tracker_transport_uncertain" });
  const first = frozen(f), selected = first.selected[0];
  assert.deepEqual(metadata(f), before); assert.equal((await f.db.collection(INDICES).get()).size, 0);
  await f.db.doc(`${PATHS.queue}/${selected.id}`).update({ version: 2, desiredHash: M.digest("newer") });
  await f.db.doc(PATHS.settings).update({ seedStorageVersion: 1 }); // Frozen replay ignores a later gate change.
  fail = false; f.advance(); await f.bridge.drain();
  assert.deepEqual(f.sent[1], f.sent[0]); assert.equal(f.selectedCounts.length, 1); assert.equal(metadata(f).storageVersion, 2);
  assert.equal(f.db.snapshot(`${PATHS.queue}/${selected.id}`).appliedVersion, 1); assert.equal(f.db.snapshot(`${PATHS.queue}/${selected.id}`).pending, true);
  f.advance(); await assert.rejects(f.bridge.drain(), { code: "tracker_storage_cutover_required" });
});

test("a frozen v1 uncertain batch stays byte-exact when v2 is enabled before replay", async () => {
  let fail = true;
  const f = fixture({ storageVersion: 1, send: async (_payload, receipt) => { if (fail) M.fail("tracker_transport_uncertain"); return receipt; } });
  await f.queue(2); await assert.rejects(f.bridge.drain(), { code: "tracker_transport_uncertain" });
  const original = frozen(f); await f.db.doc(PATHS.settings).update({ seedStorageVersion: 2 }); fail = false; f.advance(); await f.bridge.drain();
  assert.deepEqual(f.sent[0], f.sent[1]); assert.equal(metadata(f).storageVersion, undefined); assert.equal((await f.db.collection(INDEX_BASES).get()).size, 0);
  assert.deepEqual(frozen(f).nextSeedMetadata, original.nextSeedMetadata); assert.equal(frozen(f).seedIndexIds, undefined);
});

test("exact logical maps fail closed on missing/tampered base, corrupted shard, missing shard and coherent but uncommitted shard change", async () => {
  const f = fixture(); await f.queue(2); await f.bridge.drain();
  const saved = metadata(f), basePath = `${INDEX_BASES}/${saved.indexBaseSha256}`, base = f.db.snapshot(basePath), index = (await f.db.collection(INDICES).get()).docs[0], original = index.data();
  await f.db.doc(basePath).delete(); await assert.rejects(logical(f), { code: "tracker_invalid_seed_index_base" }); await f.db.doc(basePath).set(base);
  await f.db.doc(basePath).update({ schemaVersion: 2 }); await assert.rejects(logical(f), { code: "tracker_invalid_seed_index_base" }); await f.db.doc(basePath).set(base);
  await f.db.doc(index.ref.path).update({ value: "corrupted" }); await assert.rejects(logical(f), { code: "tracker_invalid_seed_index" }); await f.db.doc(index.ref.path).set(original);
  await f.db.doc(index.ref.path).delete(); await assert.rejects(logical(f), { code: "tracker_seed_index_snapshot_changed" }); await f.db.doc(index.ref.path).set(original);
  const change = { ...original, value: "changed", sha256: M.digest({ baseSha256: original.baseSha256, group: original.group, key: original.key, deleted: false, value: "changed" }) };
  await f.db.doc(index.ref.path).set(change); await assert.rejects(logical(f), { code: "tracker_seed_index_snapshot_changed" });
  await f.queue(1, 2); f.advance(); const sent = f.sent.length; await assert.rejects(f.bridge.drain(), { code: "tracker_seed_index_snapshot_changed" }); assert.equal(f.sent.length, sent); assert.equal((await pending(f)).length, 1); assert.equal(metadata(f).counts.emails, 2);
});

test("corrupted frozen metadata delta rejects acknowledgement without advancing seed, revision or source tickets", async () => {
  const f = fixture({ send: async (payload, receipt, batch, db) => { const path = `${PATHS.batches}/${payload.batchId}/indices/${batch.seedIndexIds[0]}`, original = db.snapshot(path), value = "altered"; await db.doc(path).set({ ...original, value, sha256: M.digest({ baseSha256: original.baseSha256, group: original.group, key: original.key, deleted: false, value }) }); return receipt; } });
  await f.queue(1); const before = metadata(f);
  await assert.rejects(f.bridge.drain(), { code: "tracker_invalid_frozen_seed_indices" });
  assert.deepEqual(metadata(f), before); assert.equal(f.db.snapshot(PATHS.writer).revision, 0); assert.equal(f.db.snapshot(PATHS.writer).blockedReason, "tracker_invalid_frozen_seed_indices"); assert.equal((await pending(f)).length, 1); assert.equal((await f.db.collection(INDICES).get()).size, 0);
});

test("v2 seals all frozen machine row snapshots before send and rejects changed row metadata under an otherwise valid receipt", async () => {
  const f = fixture({ send: async (payload, receipt, batch, db) => { const path = `${PATHS.batches}/${payload.batchId}/rows/${batch.seedRowIds[0]}`; await db.doc(path).update({ value: { ...db.snapshot(path).value, rowId: "changed-after-freeze" } }); return receipt; } });
  await f.queue(1); const before = metadata(f);
  await assert.rejects(f.bridge.drain(), { code: "tracker_invalid_frozen_seed_indices" });
  assert.deepEqual(metadata(f), before); assert.equal(f.db.snapshot(PATHS.writer).revision, 0); assert.equal((await pending(f)).length, 1);
});

test("index tombstones and arbitrary source keys preserve exact own properties without prototype mutation", async () => {
  const previous = emptySeed(); Object.defineProperty(previous, "emailAliases", { value: JSON.parse('{"__proto__":"old","keep":"retained"}'), enumerable: true });
  const next = structuredClone(previous); delete next.emailAliases.keep; Object.defineProperty(next.emailAliases, "__proto__", { value: "new", enumerable: true, writable: true, configurable: true });
  const split = partitionSeed(next, previous), db = new FakeFirestore({ [`${INDEX_BASES}/${split.metadata.indexBaseSha256}`]: split.indexBase });
  for (const row of split.changedIndices) { verifyIndex(row); const { id, ...value } = row; await db.doc(`${INDICES}/${id}`).set(value); }
  const loaded = await createSeedStore(db).loadMetadata(split.metadata);
  assert.equal(Object.hasOwn(loaded.emailAliases, "keep"), false); assert.equal(Object.hasOwn(loaded.emailAliases, "__proto__"), true); assert.equal(loaded.emailAliases.__proto__, "new"); assert.equal(Object.getPrototypeOf(loaded.emailAliases), Object.prototype);
});

test("combined index and row write count shrinks the selected prefix before freezing any rejected deltas", async () => {
  const normalize = ({ messages, seed }) => {
    const nextSeed = structuredClone(seed), changes = Object.fromEntries(M.GROUPS.map(group => [group, []])); nextSeed.emailAliases ||= {};
    for (const message of messages) for (let n = 0; n < 20; n++) nextSeed.emailAliases[`${message.id}-${n}`] = message.id;
    return { changes, nextSeed };
  };
  const f = fixture({ seed: emptySeed(), normalize }); await f.queue(40); await f.bridge.drain();
  assert.deepEqual(f.selectedCounts, [40, 20, 10]); assert.equal(frozen(f).seedIndexIds.length, 200); assert.equal((await pending(f)).length, 30); assert.equal((await f.db.collection(INDICES).get()).size, 200);
});

test("publication pause does not acquire a lease, call transport or prevent independent source capture", async () => {
  const f = fixture(); await f.db.doc(PATHS.settings).update({ publicationPaused: true }); await f.queue(1);
  const before = f.db.snapshot(PATHS.writer); assert.deepEqual(await f.bridge.drain(), { applied: false, paused: true });
  assert.deepEqual(f.db.snapshot(PATHS.writer), before); assert.equal(f.sent.length, 0); assert.equal((await pending(f)).length, 1);
  const id = M.digest("new-occurrence"); await f.db.doc(`userIssueOccurrences/${id}`).set({ issueId: M.digest("issue"), source: "client", kind: "error" });
  assert.equal((await f.bridge.observeOccurrence(id, { schedule: false })).queued, true); assert.equal((await pending(f)).length, 2);
});
