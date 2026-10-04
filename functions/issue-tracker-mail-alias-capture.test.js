"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const I = require("./issue-tracker-mail-identity"), M = require("./issue-tracker-bridge-model");
const { normalizeIssueTracker: normalize } = require("./issue-tracker-normalize");
const { splitSeed, rowDocumentId } = require("./issue-tracker-bridge-seed");
const { createIssueTrackerBridge } = require("./issue-tracker-bridge");
const { createMailCapture } = require("./issue-tracker-mail-capture");
const { createSourceCapture } = require("./issue-tracker-source-capture");
const { createGraphReader } = require("./issue-tracker-graph-reader");
const { TENANT, CLIENT, CALLER } = require("./issue-tracker-mail-read-proxy");
const AT = Date.parse("2026-10-03T23:30:00Z"), UUID = "11111111-2222-4333-8444-555555555555";
const mailbox = I.MAILBOX, originalLink = id => `https://outlook.office.com/mail/item/${id}`;
const graphMail = (id, internetMessageId = "<fixture@example.test>", patch = {}) => ({ id, receivedDateTime: new Date(AT - 600000).toISOString(), subject: "PoseTek error", internetMessageId,
  from: { emailAddress: { address: "alerts@posetek.net" } }, body: { contentType: "html", content: "Recorded failed action" }, internetMessageHeaders: [{ name: "To", value: mailbox }], webLink: originalLink(id), ...patch });
const identity = (id, canonicalId) => I.itemIdentity({ sourceId: id, canonicalId, sourceIdType: id === canonicalId ? "restImmutableEntryId" : "restId", responseSha256: M.digest([id, canonicalId]) });
const envelope = id => ({ mailbox, originalId: id, receivedDateTime: graphMail(id).receivedDateTime, subject: "PoseTek error", internetMessageId: /^(?:legacy|canonical)-\d+$/.test(id) ? `<fixture-${id.split("-").at(-1)}@example.test>` : "<fixture@example.test>", from: "alerts@posetek.net", body: graphMail(id).body, webLink: originalLink(id), aliases: [], operation: "Recorded historic operation", affected: "Original label; not verified identity" });
function settings() { return { enabled: true, seedVerified: true, connectionVerified: true, sourceRecoveryEnabled: true, mailbox, workbookKey: "shared-workbook", mailAliasesVerified: true,
  mailReadProvider: "graph", graphMailboxVerified: true, sourceCheckpoints: { outlook: new Date(AT - 1800000).toISOString(), backend: new Date(AT - 1800000).toISOString() }, sourceCaptureStart: new Date(AT - 3600000).toISOString(),
  mailIdentityProvider: "power_automate", mailIdentityProxyVerified: true, mailIdentityProxyProof: { schemaVersion: 1, verified: true, authorization: "delegated_translation_route", tenantId: TENANT, clientId: CLIENT, callerObjectId: CALLER, connectionAccount: mailbox,
    flowId: UUID, connectionName: "a".repeat(32), graphResource: "https://graph.microsoft.com", targetIdType: "restImmutableEntryId", endpointSha256: "a".repeat(64), exportSha256: "b".repeat(64) } }; }
async function persistSeed(db, seed) {
  const split = splitSeed(seed); await db.doc("issueTrackerState/seed").set(split.metadata);
  for (const row of split.changedRows) await db.doc(`issueTrackerRows/${row.id}`).set({ group: row.group, key: row.key, value: row.value });
}
async function fixture(ids = ["legacy", "canonical", "distinct"], patch = {}) {
  let seed = {};
  for (let index = 0; index < ids.length; index += 50) seed = normalize({ seed, messages: ids.slice(index, index + 50).map(envelope) }).nextSeed;
  const db = new FakeFirestore({ "issueTrackerSettings/current": settings() });
  await persistSeed(db, seed);
  for (const id of ids) await db.doc(`issueTrackerQueue/mail-${M.digest([mailbox, id])}`).set({ source: "outlook", sourceId: M.digest([mailbox, id]), version: 2, appliedVersion: 2, pending: false, message: envelope(id) });
  const calls = [], schedules = [];
  const target = id => id === "legacy" || id === "canonical" ? "canonical" : id;
  const graph = { canonicalMessage: async (id, options) => { calls.push({ id, options }); const canonicalId = target(id), raw = graphMail(id);
    return { ...raw, id: canonicalId, sourceMessage: raw, itemIdentity: identity(id, canonicalId) }; }, ...patch };
  const bridge = createIssueTrackerBridge({ db, normalize, now: () => AT, transport: async () => { throw new Error("No publication in capture test"); }, scheduleTask: async (...args) => { schedules.push(args); } });
  const capture = createMailCapture({ db, graph, bridge, now: () => AT });
  const current = id => ({ ...graphMail(id), id: target(id), sourceMessage: graphMail(id), itemIdentity: identity(id, target(id)) });
  return { db, seed, bridge, capture, graph, calls, schedules, current, target };
}
const canonicalTicket = (f, id = "canonical") => f.db.snapshot(`issueTrackerQueue/mail-${M.digest([mailbox, id])}`);
const proofArchives = db => [...db.docs].filter(([path, value]) => path.split("/").length === 2 && value.source === "outlook_alias_verification");
function retained(before, after) {
  assert.deepEqual(after.counters, before.counters);
  for (const [id, row] of Object.entries(before.rows.emails)) {
    assert.equal(after.rows.emails[id].rowId, row.rowId); assert.equal(after.rows.emails[id].actionId, row.actionId);
    assert.equal(after.rows.emails[id].values["Outlook message ID"], id); assert.deepEqual(after.rows.emails[id].links, row.links);
  }
  for (const row of Object.values(after.rows.actions)) for (const key of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(row.values, key), false);
}

test("collection seeded conflict archives full exact proofs and preserves all source/action IDs, links and human columns", async () => {
  const f = await fixture(), before = structuredClone(f.seed);
  await f.capture.capturePage([f.current("legacy")]);
  const queued = canonicalTicket(f).message, repair = queued.aliasReconciliation;
  assert.deepEqual(repair.retainedIds, ["canonical", "legacy"]); assert.equal(repair.primaryId, "canonical"); assert.equal(queued.operation, "Recorded historic operation"); assert.equal(queued.webLink, originalLink("canonical"));
  assert.deepEqual(f.calls.map(call => call.id).sort(), ["canonical", "distinct", "legacy"]);
  const archive = f.db.snapshot(`issueTrackerEvidence/${repair.evidenceRef}`); assert.equal(archive.complete, true); assert.equal(archive.sha256, repair.proofSha256);
  const chunks = await f.db.collection(`issueTrackerEvidence/${repair.evidenceRef}/chunks`).orderBy("__name__").get();
  const group = JSON.parse(chunks.docs.map(doc => doc.data().content).join("")); assert.deepEqual(I.verifyAliasGroup(group), group);
  assert.equal(group.items.every(item => item.mail.body.content === "Recorded failed action"), true);
  const result = normalize({ seed: f.seed, messages: [queued] }); retained(before, result.nextSeed);
  assert.equal(result.nextSeed.rows.emails.legacy.aliasOf, "canonical"); assert.deepEqual(result.nextSeed.rows.emails.distinct, before.rows.emails.distinct);
  assert.equal(f.db.snapshot("issueTrackerState/seed").emailCanonicalItems, undefined); // Queueing is not publication.
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook"), undefined); assert.equal(f.schedules.length, 0);
});

test("arrival refetch ignores forged aliases/repair/join and repairs the exact asynchronous seeded pair", async () => {
  const f = await fixture();
  await f.capture.ingress({ mailbox, originalId: "legacy", aliases: ["distinct"], aliasReconciliation: { primaryId: "distinct" }, exactJoin: { type: "occurrenceId", value: "forged" } });
  const value = canonicalTicket(f).message; assert.deepEqual(value.aliasReconciliation.retainedIds, ["canonical", "legacy"]); assert.equal(value.exactJoin, undefined);
  assert.equal(value.aliases.includes("distinct"), false); assert.equal(f.schedules.length, 1);
});

for (const extra of [["third"], ["third", "fourth"]]) test(`collection-first repair proves all ${extra.length + 2} seeded aliases before freezing; later recovery retains the complete group`, async () => {
  const f = await fixture(["legacy", "canonical", ...extra, "distinct"]);
  f.graph.canonicalMessage = async id => { f.calls.push({ id }); const canonicalId = id === "distinct" ? id : "canonical", raw = graphMail(id); return { ...raw, id: canonicalId, sourceMessage: raw, itemIdentity: identity(id, canonicalId) }; };
  await f.capture.capture(f.current("legacy"));
  const initial = canonicalTicket(f).message.aliasReconciliation; assert.deepEqual(initial.retainedIds, ["canonical", "legacy", ...extra].sort());
  assert.ok(f.calls.some(value => value.id === "third")); assert.ok(f.calls.some(value => value.id === "distinct"));
  const next = normalize({ seed: f.seed, messages: [canonicalTicket(f).message] }); await persistSeed(f.db, next.nextSeed);
  await f.capture.reconcile(); assert.deepEqual(canonicalTicket(f).message.aliasReconciliation, initial);
  retained(f.seed, next.nextSeed); assert.equal(next.nextSeed.rows.emails.third.aliasOf, initial.primaryId); assert.equal(next.nextSeed.rows.emails.distinct.aliasOf, undefined);
});

test("historical pass finds canonical-only aliases outside overlap; same Internet-ID distinct copies remain independent", async () => {
  const f = await fixture(), result = await f.capture.reconcile();
  assert.ok(result.aliasesReconciled >= 1); assert.equal(result.sourceCompleteThroughAdvanced, false);
  assert.equal(canonicalTicket(f, "distinct").message.aliasReconciliation, undefined); assert.equal(proofArchives(f.db).length, 1);
  const next = normalize({ seed: f.seed, messages: [canonicalTicket(f).message] }); retained(f.seed, next.nextSeed);
  const counts = I.emailRecordCounts({ ...next.nextSeed, counts: { emails: 3, actions: 3 } }); assert.equal(counts.canonicalEmailRecords, 2); assert.equal(counts.provenAliasGroups, 1);
  assert.equal(f.db.snapshot("issueTrackerState/mailJoinRecovery").publicationConfirmed, false);
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook"), undefined);
});

test("Internet-ID candidates without exact item proof or with changed full recipient/body evidence cannot reconcile", async () => {
  for (const patch of [
    { canonicalMessage: async id => graphMail(id) },
    { canonicalMessage: async id => ({ ...graphMail("canonical", undefined, { internetMessageHeaders: [{ name: "To", value: "other@example.test" }] }), itemIdentity: identity(id, "canonical") }) },
    { canonicalMessage: async id => ({ ...graphMail("canonical", undefined, { body: { contentType: "html", content: "Different original body" } }), itemIdentity: identity(id, "canonical") }) }
  ]) {
    const f = await fixture(["legacy", "canonical"], patch);
    await assert.rejects(f.capture.capture(f.current("legacy")), /tracker_mail_identity_unverified|tracker_alias_group_changed/);
    assert.equal(proofArchives(f.db).length, 0); assert.equal(canonicalTicket(f).pending, false);
  }
});

test("21st candidate sentinel refuses truncation before Graph reads or cursor/checkpoint changes", async () => {
  const f = await fixture(Array.from({ length: 21 }, (_, n) => `candidate-${n}`));
  await assert.rejects(f.capture.reconcile(), { code: "tracker_mail_alias_candidates_exceeded" });
  assert.equal(f.calls.length, 0); assert.equal(proofArchives(f.db).length, 0); assert.equal(f.db.snapshot("issueTrackerState/mailJoinRecovery"), undefined);
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook"), undefined);
});

test("unavailable/security/throttled historical identity retains the prior recovery cursor and every original row", async () => {
  for (const code of ["tracker_graph_access_denied", "tracker_graph_message_unavailable", "tracker_graph_throttled", "tracker_mail_identity_translation_failed"]) {
    const f = await fixture(["legacy", "canonical"], { canonicalMessage: async () => { throw Object.assign(new Error(code), { code }); } });
    const prior = { cursor: null, lastCheckedAtMillis: AT - 1000, sourceCompleteThroughAdvanced: false }; await f.db.doc("issueTrackerState/mailJoinRecovery").set(prior);
    await assert.rejects(f.capture.reconcile(), { code }); assert.deepEqual(f.db.snapshot("issueTrackerState/mailJoinRecovery"), prior);
    assert.deepEqual(f.db.snapshot("issueTrackerState/seed"), splitSeed(f.seed).metadata); assert.equal(proofArchives(f.db).length, 0);
  }
});

test("pending archived proof is reused without Graph calls; frozen published group survives replay and mutable read metadata", async () => {
  const f = await fixture(["legacy", "canonical"]); await f.capture.capture(f.current("legacy"));
  const initial = canonicalTicket(f).message.aliasReconciliation, count = f.calls.length;
  f.graph.canonicalMessage = async () => { throw new Error("Should reuse pending proof"); };
  await f.capture.capture({ ...f.current("legacy"), sourceMessage: graphMail("legacy", undefined, { isRead: true }) });
  assert.equal(f.calls.length, count); assert.deepEqual(canonicalTicket(f).message.aliasReconciliation, initial); assert.equal(proofArchives(f.db).length, 1);
  const next = normalize({ seed: f.seed, messages: [canonicalTicket(f).message] }); await persistSeed(f.db, next.nextSeed);
  await f.capture.capture(f.current("canonical")); assert.deepEqual(canonicalTicket(f).message.aliasReconciliation, initial);
  retained(f.seed, normalize({ seed: next.nextSeed, messages: [canonicalTicket(f).message] }).nextSeed);
});

for (const published of [false, true]) test(`proof ${published ? "published" : "queued"} during Graph reads is reused exactly before enqueue`, async () => {
  const f = await fixture(["legacy", "canonical"]); await f.capture.capture(f.current("legacy"));
  const prior = structuredClone(canonicalTicket(f)), next = normalize({ seed: f.seed, messages: [prior.message] }).nextSeed;
  await f.db.doc(`issueTrackerQueue/mail-${M.digest([mailbox, "canonical"])}`).set({ source: "outlook", message: envelope("canonical"), pending: false, version: 2, appliedVersion: 2 });
  let anchored = false;
  f.graph.canonicalMessage = async id => {
    if (!anchored) { anchored = true; if (published) await persistSeed(f.db, next); else await f.db.doc(`issueTrackerQueue/mail-${M.digest([mailbox, "canonical"])}`).set(prior); }
    const raw = graphMail(id); return { ...raw, id: "canonical", sourceMessage: raw, itemIdentity: { ...identity(id, "canonical"), responseSha256: "e".repeat(64) } };
  };
  await f.capture.capture(f.current("legacy")); assert.deepEqual(canonicalTicket(f).message.aliasReconciliation, prior.message.aliasReconciliation);
  const after = normalize({ seed: published ? next : f.seed, messages: [canonicalTicket(f).message] }).nextSeed; retained(f.seed, after);
});

test("incomplete pending proof and an unrelated seeded alias cannot bypass the frozen group guard", async () => {
  const f = await fixture(["legacy", "canonical"]); await f.capture.capture(f.current("legacy"));
  const repair = canonicalTicket(f).message.aliasReconciliation; await f.db.doc(`issueTrackerEvidence/${repair.evidenceRef}`).update({ complete: false });
  await assert.rejects(f.capture.capture(f.current("canonical")), { code: "tracker_alias_group_unverified" });
  assert.equal(f.db.snapshot("issueTrackerState/seed").emailCanonicalItems, undefined);
});

test("prior verified backend join must still pass the fresh exact sender/subject/recipient/trace gate", async () => {
  const f = await fixture(["legacy", "canonical"]), ref = f.db.doc(`issueTrackerQueue/mail-${M.digest([mailbox, "legacy"])}`);
  await ref.update({ "message.exactJoin": { type: "occurrenceId", value: "a".repeat(64), evidence: "Previously verified join" } });
  await assert.rejects(f.capture.capture(f.current("legacy")), { code: "tracker_mail_join_changed" });
  assert.equal(canonicalTicket(f).pending, false); assert.equal(f.db.snapshot("issueTrackerState/capture-outlook"), undefined);
});

test("failed repair on a later page item keeps exact receipt cursor/capture/publication checkpoints unchanged", async () => {
  const f = await fixture(["legacy", "canonical"]); f.graph.canonicalMessage = async () => { throw Object.assign(new Error("Unavailable"), { code: "tracker_graph_access_denied" }); };
  const initial = settings().sourceCheckpoints.outlook, graph = { page: async () => ({ records: [f.current("legacy")], cursor: null, complete: true }) };
  const source = createSourceCapture({ db: f.db, graph, mailCapture: f.capture, bridge: f.bridge, now: () => AT, randomId: () => "test-lease" });
  await assert.rejects(source.run("outlook"), { code: "tracker_graph_access_denied" });
  const state = f.db.snapshot("issueTrackerState/capture-outlook"); assert.equal(state.capturedThrough, initial); assert.equal(state.publishedThrough, initial); assert.equal(state.activeWindow.pages, 0); assert.equal(state.activeWindow.cursor, null);
  assert.equal(f.db.snapshot("issueTrackerCaptureWindows/outlook-1").captureComplete, false);
});

test("full50-pair page is bounded to40 unique proof reads per attempt and progresses safely through pending-proof reuse", async () => {
  const ids = Array.from({ length: 50 }, (_, n) => [`legacy-${n}`, `canonical-${n}`]).flat(), f = await fixture(ids);
  let active = 0, peak = 0, calls = 0;
  f.graph.canonicalMessage = async id => { calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--;
    const canonicalId = id.replace(/^legacy-/, "canonical-"), raw = graphMail(id, `<fixture-${id.split("-").at(-1)}@example.test>`); return { ...raw, id: canonicalId, sourceMessage: raw, itemIdentity: identity(id, canonicalId) }; };
  const records = Array.from({ length: 50 }, (_, n) => { const raw = graphMail(`legacy-${n}`, `<fixture-${n}@example.test>`); return { ...raw, id: `canonical-${n}`, sourceMessage: raw, itemIdentity: identity(raw.id, `canonical-${n}`) }; });
  await assert.rejects(f.capture.capturePage(records), { code: "tracker_mail_alias_lookups_exceeded" }); assert.equal(calls, 40);
  await assert.rejects(f.capture.capturePage(records), { code: "tracker_mail_alias_lookups_exceeded" }); assert.equal(calls, 80);
  const results = await f.capture.capturePage(records); assert.equal(results.length, 50); assert.equal(calls, 100); assert.ok(peak <= 3);
  assert.equal(proofArchives(f.db).length, 50); assert.equal(f.db.snapshot("issueTrackerState/capture-outlook"), undefined);
  const messages = [...f.db.docs].filter(([path, value]) => path.startsWith("issueTrackerQueue/") && value.message?.aliasReconciliation).map(([, value]) => value.message);
  let next = f.seed;
  for (let index = 0; index < messages.length; index += 25) next = normalize({ seed: next, messages: messages.slice(index, index + 25) }).nextSeed;
  retained(f.seed, next); assert.equal(Object.keys(next.emailCanonicalItems).length, 50);
});

test("shared60-second repair budget aborts hung provider and propagates its signal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let begin; const entered = new Promise(resolve => { begin = resolve; }); let signal;
  const f = await fixture(["legacy", "canonical"], { canonicalMessage: async (_, options) => { signal = options.signal; begin(); return new Promise(() => {}); } });
  const pending = f.capture.capture(f.current("legacy")), rejected = assert.rejects(pending, { code: "tracker_mail_alias_budget_exceeded" });
  await entered; t.mock.timers.tick(60000); await rejected; assert.equal(signal.aborted, true); assert.equal(canonicalTicket(f).pending, false);
});

test("shared parent abort closes actual Graph GET/translation work before a second identity deadline", async () => {
  const controller = new AbortController(); let entered, providerSignal; const started = new Promise(resolve => { entered = resolve; });
  const reader = createGraphReader({ requestJson: async (_, options) => { providerSignal = options.signal; entered(); return new Promise(() => {}); }, translateIds: async () => { throw new Error("Must not translate after abort"); } });
  const pending = reader.canonicalMessage("legacy", { signal: controller.signal }), rejected = assert.rejects(pending, { code: "tracker_mail_identity_budget_exceeded" });
  await started; controller.abort(); await rejected; assert.equal(providerSignal.aborted, true);
});
