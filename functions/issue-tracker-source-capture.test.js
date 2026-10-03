"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createGraphReader, createGraphTokenProvider, MAILBOX } = require("./issue-tracker-graph-reader");
const { createEvidenceArchive } = require("./issue-tracker-evidence");
const { createMailCapture, relevance, trustedMailJoin, receivedRecipients } = require("./issue-tracker-mail-capture");
const { createSourceCapture, createBackendSourceReader } = require("./issue-tracker-source-capture");
const { digest } = require("./issue-tracker-bridge-model");
const AT = Date.parse("2026-10-02T02:00:00Z"), INITIAL = "2026-10-02T00:00:00.000Z";
const id = n => n.toString(16).padStart(64, "0");
const mail = (key = "immutable-1", patch = {}) => ({ id: key, receivedDateTime: "2026-10-02T01:00:00Z", subject: "PoseTek error", from: { emailAddress: { address: "alerts@posetek.net" } }, body: { contentType: "html", content: "<p>Recorded failure</p>" }, ...patch });
const ok = body => ({ ok: true, status: 200, json: async () => body });

test("whole-mailbox Graph reader follows opaque full nextLink and immutable preference on every page", async () => {
  const urls = [], next = "https://graph.microsoft.com/v1.0/users/dylank@posetek.net/messages?$skiptoken=opaque%2Bvalue%2Fone";
  const reader = createGraphReader({ getAccessToken: async () => "private", fetchImpl: async (url, options) => {
    urls.push(url); assert.match(options.headers.Prefer, /IdType="ImmutableId"/); assert.equal(options.redirect, "error");
    return ok(urls.length === 1 ? { value: [mail()], "@odata.nextLink": next } : { value: [mail("immutable-2")] });
  } });
  const window = { since: INITIAL, until: "2026-10-02T02:00:00Z" };
  const first = await reader.page(window), second = await reader.page({ ...window, cursor: first.cursor });
  assert.equal(first.complete, false); assert.equal(second.complete, true); assert.equal(urls[1], next);
  const start = new URL(urls[0]); assert.match(start.pathname, /\/users\/.*\/messages$/); assert.doesNotMatch(start.pathname, /mailFolders/);
  assert.equal(start.searchParams.get("$orderby"), "receivedDateTime asc");
  assert.equal(start.searchParams.get("$filter"), `receivedDateTime ge ${INITIAL} and receivedDateTime lt ${window.until}`);
  assert.doesNotMatch(start.searchParams.get("$filter"), /isRead|subject/);
});

test("Graph refuses mailbox escape, bad pagination, inaccessible account and receipt-window violations", async () => {
  assert.throws(() => createGraphReader({ mailbox: "other@posetek.net" }), { code: "tracker_wrong_mailbox" });
  for (const next of ["https://attacker.test/v1.0/users/dylank%40posetek.net/messages", "https://graph.microsoft.com/v1.0/users/other%40posetek.net/messages", "https://graph.microsoft.com/v1.0/me/messages"]) {
    const reader = createGraphReader({ getAccessToken: async () => "private", fetchImpl: async () => ok({ value: [], "@odata.nextLink": next }) });
    await assert.rejects(reader.page({ since: INITIAL, until: "2026-10-02T02:00:00Z" }), { code: "tracker_graph_invalid_page" });
  }
  const denied = createGraphReader({ getAccessToken: async () => "private", fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(denied.message("old-id"), { code: "tracker_graph_access_denied" });
  const outOfWindow = createGraphReader({ getAccessToken: async () => "private", fetchImpl: async () => ok({ value: [mail("later", { receivedDateTime: "2026-10-02T02:00:00Z" })] }) });
  await assert.rejects(outOfWindow.page({ since: INITIAL, until: "2026-10-02T02:00:00Z" }), { code: "tracker_graph_window_violation" });
});

test("Graph application token is scope-specific, cached and unavailable credentials fail closed", async () => {
  let requests = 0;
  const provider = createGraphTokenProvider({ now: () => AT, credentials: async () => ({ tenantId: "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12), clientId: "b".repeat(8) + "-bbbb-bbbb-bbbb-" + "b".repeat(12), clientSecret: "private" }), fetchImpl: async (url, request) => {
    requests++; assert.equal(new URLSearchParams(request.body).get("scope"), "https://graph.microsoft.com/.default"); return ok({ access_token: "private-token", expires_in: 3600 });
  } });
  assert.equal(await provider(), "private-token"); await provider(); assert.equal(requests, 1);
  const missing = createGraphTokenProvider({ credentials: async () => ({}) });
  await assert.rejects(missing(), { code: "tracker_graph_not_configured" });
});

test("Google notices are considered without subject/read filters; ordinary mail is excluded explicitly", () => {
  assert.equal(relevance(mail("g", { subject: "", isRead: true, from: { emailAddress: { address: "notify@google.com" } }, body: { contentType: "text", content: "Project kickai-69dd0 budget changed" } })).relevant, true);
  assert.equal(relevance(mail("bug", { subject: "Bug report", body: { content: "Button failed" } })).relevant, true);
  assert.deepEqual(relevance(mail("other", { subject: "Lunch", from: { emailAddress: { address: "friend@example.test" } }, body: { content: "Tomorrow?" } })), { relevant: false, reason: "no_relevant_incident_evidence" });
});

test("raw evidence is immutable and complete only after all chunks, with idempotent replay", async () => {
  const db = new FakeFirestore(), archive = createEvidenceArchive(db), original = { body: "😀".repeat(130000), subject: "Synthetic" };
  const proof = await archive("outlook", "message-1", original), again = await archive("outlook", "message-1", original);
  assert.equal(proof.id, again.id); assert.equal(db.snapshot(`issueTrackerEvidence/${proof.id}`).chunks, 3);
  const chunks = await db.collection(`issueTrackerEvidence/${proof.id}/chunks`).orderBy("__name__").get();
  // Model the real Firestore UTF-8 serialization boundary for EACH chunk, so a
  // surrogate pair accidentally split between docs cannot pass this test.
  assert.deepEqual(JSON.parse(chunks.docs.map(d => Buffer.from(d.data().content, "utf8").toString("utf8")).join("")), original);
  const changed = await archive("outlook", "message-1", { ...original, subject: "Changed" }); assert.notEqual(changed.id, proof.id);
  await assert.rejects(archive("outlook", "oversize", { body: "x".repeat(12000001) }), { code: "tracker_evidence_capacity" });
});

test("intake refetches authoritative immutable item, keeps original body privately and never trusts supplied joins", async () => {
  const db = new FakeFirestore(), queued = [], lookups = [];
  await db.doc("issueTrackerSettings/current").set({ enabled: true, mailReadProvider: "graph", graphMailboxVerified: true, mailAliasesVerified: true, mailbox: MAILBOX });
  const service = createMailCapture({ db, graph: { canonicalMessage: async old => { lookups.push(old); return mail("immutable", { body: { contentType: "HTML", content: "PoseTek failed " + "x".repeat(40000) }, itemIdentity: require("./issue-tracker-mail-identity").itemIdentity({ sourceId: old, canonicalId: "immutable", sourceIdType: "restId", responseSha256: "a".repeat(64) }) }); } },
    bridge: { enqueueMessage: async (message, options) => { queued.push({ message, options }); return { ticket: { queueId: "mail", version: 1 } }; } } });
  await service.ingress({ id: "movable-old", mailbox: MAILBOX, subject: "Untrusted replacement", exactJoin: { type: "occurrenceId", value: id(1) } });
  assert.deepEqual(lookups, ["movable-old"]); assert.equal(queued[0].message.immutableId, "immutable");
  assert.deepEqual(queued[0].message.aliases, ["movable-old"]); assert.equal(queued[0].message.subject, "PoseTek error");
  assert.equal(queued[0].message.exactJoin, undefined); assert.equal(queued[0].options.schedule, true);
  assert.ok(queued[0].message.body.content.length < 21000);
  const archived = db.snapshot(`issueTrackerEvidence/${queued[0].message.evidenceRef}`); assert.ok(archived.bytes > 40000); assert.equal(archived.complete, true);
});

test("arrival intake cannot run before direct mailbox and historical alias verification", async () => {
  let fetched = false;
  const service = createMailCapture({ db: new FakeFirestore(), bridge: {}, graph: { message: async () => { fetched = true; } } });
  await assert.rejects(service.ingress({ id: "existing", mailbox: MAILBOX }), { code: "tracker_mail_not_configured" });
  assert.equal(fetched, false);
});

test("long Google messages retain exact incident links after display excerpting without a backend join", async () => {
  let queued;
  const service = createMailCapture({ db: new FakeFirestore(), graph: {}, bridge: { enqueueMessage: async message => { queued = message; return { ticket: { queueId: "q", version: 1 } }; } } });
  const original = mail("monitor", { subject: "Cloud Monitoring", from: { emailAddress: { address: "notify@google.com" } }, body: { contentType: "html", content: "Google Cloud " + "x".repeat(25000) + '<a href="https://console.cloud.google.com/monitoring/alerting/alerts/incident-1?channel=x&amp;project=kickai-69dd0">Incident</a>' } });
  await service.capture(original);
  assert.equal(queued.exactJoin, undefined); assert.equal(queued.links.length, 1); assert.doesNotMatch(queued.links[0], /&amp;/);
  const row = require("./issue-tracker-normalize").normalizeIssueTracker({ messages: [queued] }).changes.emails[0];
  assert.equal(row.values["Monitoring incident ID"], "incident-1"); assert.equal(row.values["Linked instance"], "Service incident; user unknown");
});

test("historical alias migration proves each old ID directly and refuses unavailable or conflicting originals", async () => {
  const canonical = (old, target) => mail(target, { itemIdentity: require("./issue-tracker-mail-identity").itemIdentity({ sourceId: old, canonicalId: target, sourceIdType: "restId", responseSha256: "a".repeat(64) }) });
  const service = createMailCapture({ db: new FakeFirestore(), bridge: {}, graph: { canonicalMessage: async old => canonical(old, old === "one" ? "immutable-one" : "immutable-two") } });
  const aliases = await service.verifiedAliases(["one", "two"]);
  assert.equal(aliases.emailAliases[digest([MAILBOX, "immutable-one"])], "one"); assert.equal(aliases.checked, 2);
  const conflict = createMailCapture({ db: new FakeFirestore(), bridge: {}, graph: { canonicalMessage: async old => canonical(old, "same") } });
  await assert.rejects(conflict.verifiedAliases(["one", "two"]), { code: "tracker_alias_migration_conflict" });
  const missing = createMailCapture({ db: new FakeFirestore(), bridge: {}, graph: { canonicalMessage: async () => { throw Object.assign(new Error("unavailable"), { code: "tracker_graph_message_unavailable" }); } } });
  await assert.rejects(missing.verifiedAliases(["one"]), { code: "tracker_graph_message_unavailable" });
});

function captureFixture({ pages = [{ records: [], cursor: null, complete: true }], capture, maxPages = 2, backend } = {}) {
  let time = AT, serial = 0, wakes = 0;
  const db = new FakeFirestore({ "issueTrackerSettings/current": { enabled: true, seedVerified: true, connectionVerified: true, sourceRecoveryEnabled: true,
    mailReadProvider: "graph", graphMailboxVerified: true, mailAliasesVerified: true, workbookKey: "shared-file", mailbox: MAILBOX, sourceCheckpoints: { outlook: INITIAL, backend: INITIAL }, sourceCaptureStart: "2026-10-01T07:00:00Z" } });
  const requests = [];
  const graph = { page: async window => { requests.push(structuredClone(window)); const page = pages[window.cursor == null ? 0 : Number(window.cursor)]; if (page instanceof Error) throw page; return structuredClone(page); } };
  const mailCapture = { capture: async record => {
    if (capture) return capture(record, db);
    const queueId = "mail-" + record.id, old = db.snapshot(`issueTrackerQueue/${queueId}`);
    if (!old) await db.doc(`issueTrackerQueue/${queueId}`).set({ version: 1, appliedVersion: 0, pending: true });
    return { relevant: true, ticket: { queueId, version: 1 } };
  } };
  const bridge = { wake: async () => { wakes++; } };
  const service = createSourceCapture({ db, bridge, graph, mailCapture, backend: backend || { page: async () => ({ records: [], cursor: null, complete: true }), capture: mailCapture.capture }, now: () => time, randomId: () => `lease-${++serial}`, maxPages });
  return { db, service, requests, bridge, advance: ms => { time += ms; }, wakes: () => wakes };
}

test("bounded capture resumes fixed upper bound with overlap and separates capture from publication", async () => {
  const f = captureFixture({ pages: [0, 1, 2].map(n => ({ records: [{ id: n }], cursor: n === 2 ? null : String(n + 1), complete: n === 2 })) });
  assert.equal((await f.service.run("outlook")).captureComplete, false);
  const partial = f.db.snapshot("issueTrackerState/capture-outlook"); assert.equal(partial.capturedThrough, INITIAL); assert.equal(partial.publishedThrough, INITIAL);
  assert.equal(partial.activeWindow.since, "2026-10-01T23:30:00.000Z"); assert.equal(partial.activeWindow.until, "2026-10-02T01:58:00.000Z");
  f.advance(300000); await f.service.run("outlook");
  const complete = f.db.snapshot("issueTrackerState/capture-outlook"); assert.equal(complete.capturedThrough, partial.activeWindow.until); assert.equal(complete.publishedThrough, INITIAL);
  assert.equal(f.requests[2].until, f.requests[0].until); assert.equal(complete.activeWindow, null); assert.equal(complete.lastErrorCode, null);
  for (let n = 0; n < 3; n++) await f.db.doc(`issueTrackerQueue/mail-${n}`).update({ appliedVersion: 1 });
  await f.service.run("outlook");
  assert.equal(f.db.snapshot("issueTrackerCaptureWindows/outlook-1").verifiedPages, 2);
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook").publishedThrough, INITIAL);
  await f.service.run("outlook");
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook").publishedThrough, partial.activeWindow.until);
  assert.equal(f.db.snapshot("issueTrackerCaptureWindows/outlook-1").publicationConfirmed, true);
});

test("partial page queue failure retries exact cursor without advancing either completeness checkpoint", async () => {
  let fail = true;
  const f = captureFixture({ pages: [{ records: [{ id: 1 }, { id: 2 }], cursor: null, complete: true }], capture: async (record, db) => {
    if (record.id === 2 && fail) throw new Error("private failure and raw body");
    const queueId = `mail-${record.id}`; await db.doc(`issueTrackerQueue/${queueId}`).set({ version: 1, appliedVersion: 0 }); return { relevant: true, ticket: { queueId, version: 1 } };
  } });
  await assert.rejects(f.service.run("outlook"), { code: "tracker_source_capture_failed" });
  const failed = f.db.snapshot("issueTrackerState/capture-outlook"); assert.equal(failed.capturedThrough, INITIAL); assert.equal(failed.activeWindow.pages, 0); assert.equal(failed.leaseId, null);
  assert.equal(failed.lastErrorCode, "tracker_source_capture_failed"); assert.doesNotMatch(JSON.stringify(failed), /private failure/);
  assert.equal(f.db.snapshot("issueTrackerQueue/mail-1").version, 1);
  fail = false; await f.service.run("outlook"); assert.equal(f.requests[0].until, f.requests[1].until); assert.equal(f.db.snapshot("issueTrackerState/capture-outlook").completedSequence, 1);
});

test("Outlook access failure cannot erase independent backend progress and neither source claims successful publication", async () => {
  const f = captureFixture({ pages: [Object.assign(new Error("private access response"), { code: "tracker_graph_access_denied" })] });
  const results = await Promise.allSettled([f.service.run("outlook"), f.service.run("backend")]);
  assert.equal(results[0].status, "rejected"); assert.equal(results[1].status, "fulfilled");
  const mailState = f.db.snapshot("issueTrackerState/capture-outlook"), backend = f.db.snapshot("issueTrackerState/capture-backend");
  assert.equal(mailState.capturedThrough, INITIAL); assert.equal(mailState.publishedThrough, INITIAL); assert.equal(mailState.lastErrorCode, "tracker_graph_access_denied");
  assert.equal(backend.capturedThrough, "2026-10-02T01:58:00.000Z"); assert.equal(backend.publishedThrough, backend.capturedThrough); // No relevant new rows; confirmed seed already covers prior history.
});

test("source gates prevent unverified alias/mailbox migration; backend continues independently", async () => {
  for (const field of ["graphMailboxVerified", "mailAliasesVerified"]) {
    const f = captureFixture(); await f.db.doc("issueTrackerSettings/current").update({ [field]: false });
    assert.deepEqual(await f.service.run("outlook"), { skipped: "not_configured" });
    assert.equal(f.db.snapshot("issueTrackerState/capture-outlook"), undefined); assert.equal((await f.service.run("backend")).captureComplete, true);
  }
  const f = captureFixture(); await f.db.doc("issueTrackerSettings/current").update({ sourceRecoveryEnabled: false });
  assert.deepEqual(await f.service.run("backend"), { skipped: "not_configured" });
});

test("provider proof change during a page cannot advance either completeness checkpoint", async () => {
  const f = captureFixture({ pages: [{ records: [{ id: 1 }], cursor: null, complete: true }], capture: async (_, db) => {
    await db.doc("issueTrackerSettings/current").update({ mailReadProvider: "missing" });
    return { relevant: false, reason: "excluded" };
  } });
  await assert.rejects(f.service.run("outlook"), { code: "tracker_capture_configuration_changed" });
  const state = f.db.snapshot("issueTrackerState/capture-outlook");
  assert.equal(state.capturedThrough, INITIAL); assert.equal(state.publishedThrough, INITIAL);
  assert.equal(state.activeWindow.pages, 0); assert.equal(state.leaseId, null);
});

test("resumed Outlook window refuses a different verified authorization route without consuming its cursor", async () => {
  const f = captureFixture({ maxPages: 1, pages: [{ records: [], cursor: "1", complete: false }, { records: [], cursor: null, complete: true }] });
  await f.service.run("outlook");
  const before = f.db.snapshot("issueTrackerState/capture-outlook");
  const { TENANT, CLIENT, CALLER } = require("./issue-tracker-mail-read-proxy");
  await f.db.doc("issueTrackerSettings/current").update({ mailReadProvider: "power_automate", graphMailboxVerified: false, mailReadProxyVerified: true,
    mailReadProxyProof: { schemaVersion: 1, verified: true, authorization: "delegated_proxy_route", tenantId: TENANT, clientId: CLIENT, callerObjectId: CALLER,
      connectionAccount: MAILBOX, flowId: "11111111-2222-4333-8444-555555555555", connectionName: "shared-office365-11111111-2222-4333-8444-555555555555", endpointSha256: "a".repeat(64), exportSha256: "b".repeat(64) } });
  await assert.rejects(f.service.run("outlook"), { code: "tracker_capture_provider_changed" });
  assert.deepEqual(f.db.snapshot("issueTrackerState/capture-outlook"), before); assert.equal(f.requests.length, 1);
  assert.equal((await f.service.run("backend")).captureComplete, true);
});

test("queued newer versions do not erase confirmed older publication receipts", async () => {
  const f = captureFixture({ pages: [{ records: [{ id: 1 }], cursor: null, complete: true }] });
  await f.service.run("outlook");
  await f.db.doc("issueTrackerQueue/mail-1").update({ appliedVersion: 1, version: 2, pending: true });
  await f.service.run("outlook"); assert.equal(f.db.snapshot("issueTrackerCaptureWindows/outlook-1").publicationConfirmed, true);
  assert.equal(f.db.snapshot("issueTrackerQueue/mail-1").pending, true);
});

test("large missed interval catches up in contiguous fixed daily windows", async () => {
  const f = captureFixture(); f.advance(4 * 86400000);
  await f.service.run("outlook"); assert.equal(f.requests[0].until, "2026-10-03T00:00:00.000Z");
  await f.service.run("outlook"); assert.equal(f.requests[1].since, "2026-10-02T23:30:00.000Z"); assert.equal(f.requests[1].until, "2026-10-04T00:00:00.000Z");
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook").publishedThrough, "2026-10-04T00:00:00.000Z");
});

test("pagination loops and changed workbook gates retain the last completed page", async () => {
  const f = captureFixture({ pages: [{ records: [], cursor: "1", complete: false }, { records: [], cursor: "1", complete: false }], maxPages: 3 });
  await assert.rejects(f.service.run("outlook"), { code: "tracker_capture_pagination_loop" });
  assert.equal(f.db.snapshot("issueTrackerState/capture-outlook").capturedThrough, INITIAL);
  await f.db.doc("issueTrackerSettings/current").update({ workbookKey: "changed" });
  await assert.rejects(f.service.run("outlook"), { code: "tracker_capture_workbook_changed" });
});

test("concurrent runs hold one source lease while separate source remains available", async () => {
  let release, ready;
  const entered = new Promise(resolve => { ready = resolve; });
  const f = captureFixture({ pages: [{ records: [{ id: 1 }], cursor: null, complete: true }], capture: async () => { ready(); await new Promise(resolve => { release = resolve; }); return { relevant: false, reason: "not_relevant" }; } });
  const first = f.service.run("outlook"); await entered;
  assert.deepEqual(await f.service.run("outlook"), { skipped: "capture_busy" }); assert.equal((await f.service.run("backend")).captureComplete, true);
  release(); await first;
});

test("backend independent reader pages every occurrence and outbox by receipt time plus document ID", async () => {
  const source = { userIssueOccurrences: Array.from({ length: 101 }, (_, n) => ({ id: id(n + 1), data: { receivedAtMillis: AT - 1000, operation: "unknown" } })), userIssueOutbox: [{ id: id(500), data: { type: "daily", createdAtMillis: AT - 1000 } }] };
  const queries = [];
  const db = { collection(name) { const state = { name, filters: [], orders: [], after: null, limit: 0 }; const q = {
    where(field, op, value) { state.filters.push([field, op, value]); return q; }, orderBy(field) { state.orders.push(field); return q; }, limit(n) { state.limit = n; return q; }, startAfter(...after) { state.after = after; return q; },
    async get() { queries.push(structuredClone(state)); const docs = source[name].filter(r => state.filters.every(([field, op, value]) => op === ">=" ? r.data[field] >= value : r.data[field] < value)).filter(r => !state.after || r.data[state.orders[0]] > state.after[0] || r.data[state.orders[0]] === state.after[0] && r.id > state.after[1]).slice(0, state.limit).map(r => ({ id: r.id, data: () => r.data })); return { docs, size: docs.length }; },
  }; return q; } };
  const seen = [], archive = async (source, key) => { seen.push([source, key]); return { id: key }; };
  const bridge = { observeOccurrence: async key => ({ ticket: { queueId: key, version: 1 } }), observeOutbox: async key => ({ ticket: { queueId: key, version: 1 } }) };
  const reader = createBackendSourceReader({ db, bridge, archive }), window = { since: INITIAL, until: new Date(AT).toISOString() };
  const first = await reader.page(window), second = await reader.page({ ...window, cursor: first.cursor }), third = await reader.page({ ...window, cursor: second.cursor });
  assert.equal(first.records.length, 100); assert.equal(second.records.length, 1); assert.equal(third.records.length, 1); assert.equal(third.complete, true);
  assert.deepEqual(queries[0].orders, ["receivedAtMillis", "__name__"]); assert.deepEqual(queries[2].orders, ["createdAtMillis", "__name__"]);
  for (const record of [...first.records, ...second.records, ...third.records]) await reader.capture(record);
  assert.equal(seen.length, 102); assert.equal(seen[0][0], "backend-occurrence");
});
