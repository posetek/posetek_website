"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createPowerAutomateTransport, pollEndpoint, pollDelay, MAX_ASYNC_POLLS, TRANSPORT_TIMEOUT_MS } = require("./issue-tracker-bridge-transport");
const { createIssueTrackerBridge, PATHS } = require("./issue-tracker-bridge");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { sealBatch, GROUPS } = require("./issue-tracker-bridge-model");
const ENDPOINT = "https://test.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/flow-one/triggers/manual/paths/invoke?api-version=1";
const POLL = "https://test.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/flow-one/runs/run-one/operations/operation-one?api-version=1";
const AT = Date.parse("2026-10-01T23:00:00Z");
const empty = () => Object.fromEntries(GROUPS.map(group => [group, []]));
const batch = () => sealBatch({ batchId: "one-exact-batch", workbookKey: "confirmed-shared-file", expectedRevision: 0, generatedAt: new Date(AT).toISOString(), changes: empty() });
const receipt = value => ({ schemaVersion: 1, verified: true, batchId: value.batchId, workbookKey: value.workbookKey, payloadSha256: value.payloadSha256,
  revision: value.expectedRevision + 1, applied: Object.fromEntries(GROUPS.map(group => [group, value.changes[group].map(row => row.key)])), counts: Object.fromEntries(GROUPS.map(group => [group, value.changes[group].length])) });
const response = (status, body = {}, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body });
function transportFixture(handler) {
  let time = AT;
  const calls = [], waits = [];
  const transport = createPowerAutomateTransport({ endpoint: async () => ENDPOINT, getAccessToken: async () => "authorized-token", now: () => time,
    wait: async ms => { waits.push(ms); time += ms; }, fetchImpl: async (url, options) => { calls.push({ url, options }); return handler(url, options, calls.length); } });
  return { transport, calls, waits, elapsed: () => time - AT, advance: ms => { time += ms; } };
}

test("async acceptance is polled on the same workflow until the final exact200 receipt", async () => {
  const value = batch();
  const f = transportFixture((url, options, n) => n === 1 ? response(202, {}, { Location: POLL, "Retry-After": "5" }) : n === 2 ? response(202) : response(200, receipt(value)));
  assert.deepEqual(await f.transport.send(value), receipt(value));
  assert.deepEqual(f.calls.map(call => call.options.method), ["POST", "GET", "GET"]);
  assert.equal(f.calls[1].url, POLL); assert.equal(f.calls[1].options.body, undefined);
  assert.equal(f.calls[1].options.headers.Authorization, "Bearer authorized-token");
  assert.ok(f.calls.every(call => call.options.redirect === "error")); assert.deepEqual(f.waits, [5000, 5000]);
});

test("signed same-workflow polling capabilities stay out of bearer headers", async () => {
  const value = batch(), signed = `${POLL}&sig=synthetic-private-capability`;
  const f = transportFixture((url, options, n) => n === 1 ? response(202, {}, { Location: signed }) : response(200, receipt(value)));
  await f.transport.send(value);
  assert.equal(f.calls[0].options.headers.Authorization, "Bearer authorized-token");
  assert.equal(f.calls[1].url, signed); assert.equal(f.calls[1].options.headers.Authorization, undefined);
});

test("missing or unsafe async Location fails before any follow-up request", async () => {
  for (const location of [null, "https://attacker.test/runs/x", POLL.replace("flow-one", "flow-two"), POLL.replace("https:", "http:"),
    POLL.replace("test.environment", "user:pass@test.environment"), `${POLL}#fragment`, ENDPOINT,
    POLL.replace("/runs/run-one", "/runs/%2Foutside"), `${POLL}&access_token=forbidden`, "not a URL"]) {
    const f = transportFixture(() => response(202, {}, location ? { Location: location } : {}));
    await assert.rejects(f.transport.send(batch()), { code: "tracker_unverified_receipt", message: "tracker_unverified_receipt" });
    assert.equal(f.calls.length, 1);
  }
});

test("each replacement Location is validated and redirects never forward authorization", async () => {
  const f = transportFixture((url, options, n) => n === 1 ? response(202, {}, { Location: POLL }) : response(202, {}, { Location: "https://attacker.test/collect" }));
  await assert.rejects(f.transport.send(batch()), { code: "tracker_unverified_receipt" }); assert.equal(f.calls.length, 2);
  const redirected = transportFixture((url, options, n) => n === 1 ? response(202, {}, { Location: POLL }) : response(302, {}, { Location: "https://attacker.test/collect" }));
  await assert.rejects(redirected.transport.send(batch()), { code: "tracker_remote_rejected" }); assert.equal(redirected.calls.length, 2);
});

test("pending202 and terminal200 status metadata never stand in for a workbook receipt", async () => {
  const f = transportFixture((url, options, n) => n === 1 ? response(202, { verified: true }, { Location: POLL }) : response(200, { status: "Succeeded" }));
  await assert.rejects(f.transport.send(batch()), { code: "tracker_unverified_receipt" });
  const wrong = batch(); wrong.workbookKey = "another-workbook";
  const g = transportFixture((url, options, n) => n === 1 ? response(202, {}, { Location: POLL }) : response(200, receipt(wrong)));
  await assert.rejects(g.transport.send(batch()), { code: "tracker_unverified_receipt" });
});

test("poll count and total deadline bound perpetual pending without acknowledging it", async () => {
  const f = transportFixture(() => response(202, {}, { Location: POLL }));
  await assert.rejects(f.transport.send(batch()), { code: "tracker_transport_uncertain" });
  assert.equal(f.calls.length, MAX_ASYNC_POLLS + 1); assert.ok(f.elapsed() < TRANSPORT_TIMEOUT_MS);
  const g = transportFixture(() => response(202, {}, { Location: POLL, "Retry-After": "120" }));
  await assert.rejects(g.transport.send(batch()), { code: "tracker_transport_uncertain" });
  assert.equal(g.calls.length, 2); assert.deepEqual(g.waits, [120000]);
});

test("Retry-After supports seconds and HTTP date with a five-second minimum", () => {
  assert.equal(pollDelay("30", AT), 30000);
  assert.equal(pollDelay(new Date(AT + 20000).toUTCString(), AT), 20000);
  for (const value of [null, "", "invalid", "0", new Date(AT - 1000).toUTCString()]) assert.equal(pollDelay(value, AT), 5000);
  assert.equal(pollEndpoint(new URL(POLL).pathname, ENDPOINT), POLL.split("?")[0]);
});

test("polling failures preserve sanitized retry/auth/conflict classifications", async () => {
  for (const [status, code] of [[401, "tracker_remote_auth"], [403, "tracker_remote_auth"], [423, "tracker_remote_conflict"], [429, "tracker_transport_retry"], [503, "tracker_transport_retry"]]) {
    const f = transportFixture((url, options, n) => n === 1 ? response(202, {}, { Location: POLL }) : response(status, { private: "must not log" }));
    await assert.rejects(f.transport.send(batch()), { code, message: code });
  }
  const f = transportFixture((url, options, n) => { if (n === 1) return response(202, {}, { Location: POLL }); throw new Error(`raw secret URL ${POLL}&sig=secret`); });
  await assert.rejects(f.transport.send(batch()), { code: "tracker_transport_uncertain", message: "tracker_transport_uncertain" });
});

test("bounded polling timeout leaves the identical frozen batch for serialized flow replay", async () => {
  const sourceId = "a".repeat(64), sourceIssue = "b".repeat(64);
  const db = new FakeFirestore({ [PATHS.settings]: { enabled: true, seedVerified: true, connectionVerified: true, workbookKey: "confirmed-shared-file" },
    [PATHS.writer]: { revision: 0 }, [PATHS.seed]: { counts: { actions: 0, instances: 0, emails: 0, dailyRows: 0 } },
    [`userIssueOutbox/${sourceId}`]: { type: "incident", issueId: sourceIssue, createdAtMillis: AT - 1, status: "pending" },
    [`userIssueOccurrences/${sourceId}`]: { issueId: sourceIssue }, [`userIssues/${sourceIssue}`]: { state: "new" } });
  let accepted, succeed = false, serial = 0;
  const posted = [];
  const f = transportFixture((url, options) => {
    if (options.method === "POST") { accepted = JSON.parse(options.body); posted.push(accepted); return response(202, {}, { Location: POLL }); }
    return succeed ? response(200, receipt(accepted)) : response(202, {}, { Location: POLL });
  });
  const bridge = createIssueTrackerBridge({ db, now: () => AT + f.elapsed(), randomId: () => `frozen-${++serial}`, scheduleTask: async () => {}, transport: f.transport,
    normalize: async () => ({ changes: empty(), nextSeed: {} }) });
  await bridge.observeOutbox(sourceId);
  await assert.rejects(bridge.drain(), { code: "tracker_transport_uncertain" });
  const frozenId = db.snapshot(PATHS.writer).activeBatchId;
  assert.equal(db.snapshot(PATHS.writer).revision, 0); assert.equal(db.snapshot(`${PATHS.queue}/outbox-${sourceId}`).pending, true);
  succeed = true; f.advance(90000); await bridge.drain();
  assert.deepEqual(posted[1], posted[0]); assert.equal(posted[1].batchId, frozenId);
  assert.equal(db.snapshot(PATHS.writer).revision, 1); assert.equal(db.snapshot(`${PATHS.queue}/outbox-${sourceId}`).pending, false);
});
