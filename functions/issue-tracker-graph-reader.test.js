"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createGraphReader, PAGE_SIZE, IDENTITY_BUDGET_MS } = require("./issue-tracker-graph-reader");
const I = require("./issue-tracker-mail-identity");
const WINDOW = { since: "2026-10-02T00:00:00Z", until: "2026-10-02T01:00:00Z" };
const mail = (id, patch = {}) => ({ id, subject: "PoseTek error", receivedDateTime: "2026-10-02T00:30:00Z", internetMessageId: "<fixture@example.test>", body: { contentType: "html", content: "Recorded failure" }, ...patch });
const error = code => Object.assign(new Error(code), { code });
const TYPE = "tracker_mail_identity_source_type_mismatch";
function fixture(ids = ["R-one", "I-two"], patch = {}) {
  const calls = [], reads = [];
  const translation = async body => {
    calls.push(body);
    assert.notEqual(body.sourceIdType, body.targetIdType);
    if (body.sourceIdType === "restId" && body.inputIds.some(id => id.startsWith("I-"))) throw error(TYPE);
    if (body.sourceIdType === "restImmutableEntryId" && body.inputIds.some(id => id.startsWith("R-"))) throw error("tracker_mail_identity_translation_failed");
    return { value: body.inputIds.map(sourceId => ({ sourceId, targetId: body.sourceIdType === "restId" ? sourceId.replace(/^R-/, "I-") : sourceId.replace(/^I-/, "R-") })) };
  };
  const requestJson = async (url) => {
    reads.push(url); const last = new URL(url).pathname.split("/").at(-1);
    return last === "messages" ? { value: ids.map(id => mail(id)) } : mail(decodeURIComponent(last));
  };
  return { calls, reads, reader: createGraphReader({ requestJson, translateIds: translation, ...patch }) };
}
test("mixed untyped page resolves only authoritative attempts and preserves original records on replay", async () => {
  const f = fixture(), first = await f.reader.page(WINDOW), replay = await f.reader.page(WINDOW);
  assert.deepEqual(first, replay); assert.equal(first.complete, true);
  assert.deepEqual(first.records.map(record => record.id), ["I-one", "I-two"]);
  assert.deepEqual(first.records.map(record => record.sourceMessage.id), ["R-one", "I-two"]);
  assert.deepEqual(first.records.map(record => record.itemIdentity.sourceIdType), ["restId", "restImmutableEntryId"]);
  first.records.forEach(record => assert.equal(I.validItemIdentity(record.itemIdentity, record.id), true));
  assert.equal(f.calls.length, 10);
});
test("opaque IDs with the same prefix/length use Graph evidence, and cross-item canonical collisions fail", async () => {
  const rest = "AAMk_opaque/base64+01==", immutable = "AAMk_opaque/base64+02==", canonical = "AAMk_opaque/base64+03==", currentRest = "AAMk_opaque/base64+04==";
  const mapping = new Map([[rest, canonical], [currentRest, immutable]]);
  const f = fixture([rest, immutable], { translateIds: async body => {
    if (body.sourceIdType === "restId" && body.inputIds.some(id => !mapping.has(id))) throw error(TYPE);
    return { value: body.inputIds.map(sourceId => ({ sourceId, targetId: body.sourceIdType === "restId" ? mapping.get(sourceId) : [...mapping].find(([, id]) => id === sourceId)?.[0] })) };
  } });
  const result = await f.reader.page(WINDOW);
  assert.deepEqual(result.records.map(record => record.id), [canonical, immutable]);
  assert.deepEqual(result.records.map(record => record.itemIdentity.sourceIdType), ["restId", "restImmutableEntryId"]);
  await assert.rejects(fixture(["R-one", "I-one"]).reader.page(WINDOW), { code: "tracker_graph_invalid_translation_response" });
});
test("fifty immutable inputs remain at 151 translations and at most three concurrent requests", async () => {
  let active = 0, peak = 0, calls = 0;
  const f = fixture(Array.from({ length: PAGE_SIZE }, (_, n) => "I-" + n), { translateIds: async body => {
    calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--;
    if (body.sourceIdType === "restId" && body.inputIds.some(id => id.startsWith("I-"))) throw error(TYPE);
    return { value: body.inputIds.map(sourceId => ({ sourceId, targetId: body.sourceIdType === "restId" ? sourceId.replace(/^R-/, "I-") : sourceId.replace(/^I-/, "R-") })) };
  } });
  const result = await f.reader.page(WINDOW); assert.equal(result.records.length, 50); assert.equal(calls, 151); assert.equal(peak, 3);
});
test("generic/security/throttle/unavailable/malformed failures cannot try another declaration", async () => {
  for (const code of ["tracker_mail_identity_access_denied", "tracker_mail_identity_throttled", "tracker_mail_identity_unavailable", "tracker_mail_identity_translation_failed", "tracker_mail_identity_invalid_response", "tracker_capture_configuration_changed"]) {
    let calls = 0; const f = fixture(["I-one"], { translateIds: async () => { calls++; throw error(code); } });
    await assert.rejects(f.reader.page(WINDOW), { code }); assert.equal(calls, 1);
  }
});
test("partial, duplicate, unknown and non-bijective translation replies abort the whole page without fallback", async () => {
  for (const value of [[], [{ sourceId: "R-one", targetId: "I-one" }], [{ sourceId: "R-one", targetId: "I-one" }, { sourceId: "R-one", targetId: "I-two" }], [{ sourceId: "R-one", targetId: "I-one" }, { sourceId: "R-two", targetId: "I-one" }], [{ sourceId: "R-one", targetId: "I-one" }, { sourceId: "foreign", targetId: "I-two" }], [{ sourceId: "R-one", targetId: "I-one" }, { sourceId: "R-two", errorDetails: { code: "InvalidArgument" } }]]) {
    let calls = 0; const f = fixture(["R-one", "R-two"], { translateIds: async () => { calls++; return { value }; } });
    await assert.rejects(f.reader.page(WINDOW), { code: "tracker_graph_invalid_translation_response" }); assert.equal(calls, 1);
  }
});
test("one unavailable item in mixed-page resolution yields no complete or partial page", async () => {
  let calls = 0; const f = fixture(["R-one", "I-two"], { translateIds: async body => {
    calls++; if (body.inputIds.length > 1) throw error(TYPE);
    if (body.inputIds[0] === "I-two") throw error("tracker_mail_identity_access_denied");
    return { value: [{ sourceId: "R-one", targetId: "I-one" }] };
  } });
  await assert.rejects(f.reader.page(WINDOW), { code: "tracker_mail_identity_access_denied" }); assert.equal(calls, 3);
});
test("immutable arrivals and changed GET formats require exact source/response/canonical convergence", async () => {
  const immutable = fixture(); const result = await immutable.reader.canonicalMessage("I-two");
  assert.equal(result.id, "I-two"); assert.equal(result.itemIdentity.sourceIdType, "restImmutableEntryId");
  const changed = fixture([], { requestJson: async () => mail("I-one") });
  const legacy = await changed.reader.canonicalMessage("R-one"); assert.equal(legacy.id, "I-one"); assert.equal(legacy.sourceMessage.id, "I-one"); assert.equal(legacy.itemIdentity.sourceId, "R-one");
});
test("wrong canonical target, changed content and unsupported declaration reject arrival identity", async () => {
  const changed = fixture([], { requestJson: async url => mail(decodeURIComponent(new URL(url).pathname.split("/").at(-1)), { subject: url.includes("/I-") ? "Different item" : "PoseTek error" }) });
  await assert.rejects(changed.reader.canonicalMessage("R-one"), { code: "tracker_mail_identity_item_changed" });
  const forged = fixture([], { requestJson: async () => mail("I-foreign") });
  await assert.rejects(forged.reader.canonicalMessage("R-one"), { code: "tracker_mail_identity_item_changed" });
  await assert.rejects(fixture().reader.canonicalMessage("R-one", { sourceIdType: "entryId" }), { code: "tracker_graph_invalid_translation_request" });
});
test("immutable reverse conversion must close exactly and changed recipient headers fail arrival", async () => {
  let calls = 0;
  const badRoundtrip = fixture([], { translateIds: async body => {
    calls++; if (calls === 1) throw error(TYPE);
    return { value: [{ sourceId: body.inputIds[0], targetId: calls === 2 ? "R-current" : "I-different" }] };
  } });
  await assert.rejects(badRoundtrip.reader.canonicalMessage("I-one"), { code: "tracker_mail_identity_item_changed" }); assert.equal(calls, 3);
  const headers = fixture([], { requestJson: async url => {
    const id = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    return mail(id, { internetMessageHeaders: [{ name: "To", value: id === "R-one" ? "dylank@posetek.net" : "other@example.test" }] });
  } });
  await assert.rejects(headers.reader.canonicalMessage("R-one"), { code: "tracker_mail_identity_item_changed" });
});
test("direct Graph immutable GET certifies only returned ID, without typing the unknown supplied alias", async () => {
  const reader = createGraphReader({ getAccessToken: async () => "fixture-token", fetchImpl: async () => ({ ok: true, json: async () => mail("I-current") }) });
  const value = await reader.canonicalMessage("untyped-arrival");
  assert.equal(value.itemIdentity.sourceId, "I-current"); assert.equal(value.itemIdentity.canonicalId, "I-current"); assert.equal(value.itemIdentity.sourceIdType, "restImmutableEntryId");
});
test("oversized and duplicate source pages stop before translation; elapsed budget prevents new work", async () => {
  for (const ids of [["R-one", "R-one"], Array.from({ length: 51 }, (_, n) => "R-" + n)]) {
    const f = fixture(ids); await assert.rejects(f.reader.page(WINDOW), { code: "tracker_graph_invalid_page" }); assert.equal(f.calls.length, 0);
  }
  let now = 0, calls = 0; const f = fixture(["I-one"], { now: () => now, translateIds: async () => { calls++; now = IDENTITY_BUDGET_MS; throw error(TYPE); } });
  await assert.rejects(f.reader.page(WINDOW), { code: "tracker_mail_identity_budget_exceeded" }); assert.equal(calls, 1);
  now = 0;
  const delayedRead = fixture([], { now: () => now, requestJson: async () => { now = IDENTITY_BUDGET_MS; return { value: [mail("R-one")] }; } });
  await assert.rejects(delayedRead.reader.page(WINDOW), { code: "tracker_mail_identity_budget_exceeded" }); assert.equal(delayedRead.calls.length, 0);
});
test("deadline abort stops a hung provider, even when it ignores its cancellation signal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const f = fixture(["R-one"], { translateIds: async () => { entered(); return new Promise(() => {}); } });
  const pending = f.reader.page(WINDOW), failure = assert.rejects(pending, { code: "tracker_mail_identity_budget_exceeded" });
  await started; t.mock.timers.tick(IDENTITY_BUDGET_MS); await failure;
});
test("failed mixed identity leaves capture/publication/cursor unchanged and retries the exact frozen page", async () => {
  const { FakeFirestore } = require("./test-support/fake-firestore");
  const { createSourceCapture } = require("./issue-tracker-source-capture");
  let unavailable = true, captured = 0;
  const f = fixture(["R-one", "I-two"], { translateIds: async body => {
    if (body.inputIds.some(id => id.startsWith("I-")) && body.sourceIdType === "restId") throw error(TYPE);
    if (unavailable && body.inputIds.includes("I-two")) throw error("tracker_mail_identity_unavailable");
    return { value: body.inputIds.map(sourceId => ({ sourceId, targetId: body.sourceIdType === "restId" ? sourceId.replace(/^R-/, "I-") : sourceId.replace(/^I-/, "R-") })) };
  } });
  const db = new FakeFirestore({ "issueTrackerSettings/current": { enabled: true, seedVerified: true, connectionVerified: true, sourceRecoveryEnabled: true,
    mailReadProvider: "graph", graphMailboxVerified: true, mailAliasesVerified: true, workbookKey: "shared-fixture", mailbox: I.MAILBOX,
    sourceCheckpoints: { outlook: WINDOW.since, backend: WINDOW.since }, sourceCaptureStart: WINDOW.since } });
  const capture = createSourceCapture({ db, graph: f.reader, bridge: { wake: async () => {} }, now: () => Date.parse(WINDOW.until) + 120000,
    randomId: () => "fixture-lease", mailCapture: { capture: async record => {
      captured++; const queueId = "mail-" + record.id; await db.doc("issueTrackerQueue/" + queueId).set({ version: 1, appliedVersion: 0 });
      return { relevant: true, ticket: { queueId, version: 1 } };
    } } });
  await assert.rejects(capture.run("outlook"), { code: "tracker_mail_identity_unavailable" });
  const failed = db.snapshot("issueTrackerState/capture-outlook");
  assert.equal(captured, 0); assert.equal(failed.completedSequence, 0); assert.equal(failed.publishedSequence, 0);
  assert.equal(failed.capturedThrough, new Date(WINDOW.since).toISOString()); assert.equal(failed.publishedThrough, new Date(WINDOW.since).toISOString()); assert.equal(failed.activeWindow.pages, 0); assert.equal(failed.activeWindow.cursor, null);
  const originalUrl = f.reads[0]; unavailable = false;
  assert.equal((await capture.run("outlook")).captureComplete, true); assert.equal(f.reads[1], originalUrl);
  assert.equal(captured, 2); assert.equal(db.snapshot("issueTrackerState/capture-outlook").publishedThrough, new Date(WINDOW.since).toISOString());
});
