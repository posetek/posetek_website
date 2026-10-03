"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const M = require("./microsoft-email-model");
const { createMicrosoftEmail, TRACE_WINDOW, RECIPIENT_BUCKET, RECIPIENT_WINDOW } = require("./microsoft-email");
const { amendRecentUnclaimed } = require("./microsoft-email-amendment");
const { createUserIssues } = require("./user-issues");
const { createTraceReader, createFlowTransport, createTokenProvider, createMicrosoftProvider, flowEndpoint } = require("./microsoft-email-transport");
const AT = Date.parse("2026-10-02T02:00:00Z"), ID = "a".repeat(64), PATH = `userIssueOutbox/${ID}`;
const config = () => ({ enabled: true, connectionVerified: true, traceEnabled: true, activatedAtMillis: AT - 1, senderMailbox: "alerts@posetek.net" });
class QueueFirestore extends FakeFirestore {
  collection(name) {
    const adapt = q => {
      const where = q.where.bind(q), limit = q.limit.bind(q), orderBy = q.orderBy.bind(q);
      q.where = (...a) => adapt(where(...a)); q.limit = (...a) => adapt(limit(...a)); q.orderBy = (...a) => adapt(orderBy(...a));
      q.matches = data => q.filters.every(([f, op, v]) => op === "==" ? data[f] === v : op === ">" ? data[f] > v : op === "<=" ? data[f] <= v : false);
      return q;
    };
    return adapt(super.collection(name));
  }
}
function fixture({ historicalClaim = false } = {}) {
  let time = AT;
  const payload = { from: "PoseTek Support <support@alerts.posetek.net>", to: [...M.RECIPIENTS], subject: "Issue observed", text: "Protected context <private>" };
  const db = new QueueFirestore({ [M.SETTINGS]: config(), "userIssueSettings/current": { enabled: true, sendEnabled: true, activatedAtMillis: AT - 1, emailProvider: "microsoft" },
    [PATH]: { id: ID, type: "incident", createdAtMillis: AT, status: "pending", dueAtMillis: AT, firstAttemptAtMillis: AT, attempts: 1, ...M.freeze("issue", ID, payload, config(), AT) } });
  if (historicalClaim) {
    const job = db.snapshot(PATH);
    db.write(PATH, { payload: { ...job.payload, to: [...M.HISTORICAL_ISSUE_RECIPIENTS] }, status: "sending", dueAtMillis: null,
      microsoft: { ...job.microsoft, claimedAtMillis: AT, runId: "run-1", claimTokenHash: M.hash("c".repeat(64)), traceUntilMillis: AT + TRACE_WINDOW } }, { merge: true });
  }
  const errors = [], traces = [];
  const service = createMicrosoftEmail({ db, now: () => time, traceReader: { read: async () => ({ rows: traces, checkedAtMillis: time }) }, logger: { error: (...a) => errors.push(a) } });
  const request = { schemaVersion: 1, kind: "issue", jobId: ID, runId: "run-1" };
  return { db, service, request, errors, traces, historicalClaim, now: () => time, advance: ms => { time += ms; }, job: () => db.snapshot(PATH) };
}
async function claimed(f) {
  if (f.historicalClaim) {
    assert.equal((await f.service.claim(f.request)).allowSend, false, "historical permission is never granted again");
    return { ...f.request, claimToken: "c".repeat(64) };
  }
  return f.service.claim(f.request);
}
const receipt = (f, c, outcome = "accepted") => ({ ...f.request, claimToken: c.claimToken, outcome });
const row = (f, to, status = "delivered", patch = {}) => ({ id: `trace-${to}`, messageId: "<single-message@posetek.net>", senderAddress: "alerts@posetek.net", recipientAddress: to,
  subject: f.job().payload.subject, receivedDateTime: new Date(AT).toISOString(), status, ...patch });

test("new Microsoft route fails closed; all attempted legacy payloads stay on Resend", () => {
  assert.equal(M.enabled(undefined, "issue", ID, AT, AT), false);
  for (const p of [{ enabled: false }, { connectionVerified: false }, { activatedAtMillis: AT + 1 }, { testJobIds: [] }, { testJobIds: [`issue:${"b".repeat(64)}`] }]) assert.equal(M.enabled({ ...config(), ...p }, "issue", ID, AT, AT), false);
  assert.equal(M.providerFor({}, { emailProvider: "microsoft" }), "microsoft");
  for (const job of [{ firstAttemptAtMillis: AT }, { attempts: 1 }, { payload: {} }, { providerId: "old" }]) assert.equal(M.providerFor(job, { emailProvider: "microsoft" }), "resend");
  assert.equal(M.providerFor({ deliveryProvider: "microsoft" }, {}), "microsoft");
  assert.equal(M.providerFor({ deliveryProvider: "other" }, {}), null);
});

test("new Microsoft issue and workout messages require Dylan alone", () => {
  const payload = { subject: "Synthetic recipient configuration", text: "Test only" };
  for (const to of [[], M.HISTORICAL_ISSUE_RECIPIENTS, [M.RECIPIENTS[0], M.RECIPIENTS[0]], [...M.RECIPIENTS, "other@posetek.net"]]) {
    assert.throws(() => M.freeze("issue", ID, { ...payload, to }, config(), AT), { code: "provider_recipient_invalid" });
  }
  assert.deepEqual(M.freeze("issue", ID, { ...payload, to: [...M.RECIPIENTS].reverse() }, config(), AT).payload.to, [...M.RECIPIENTS].reverse());
  const workoutId = `${ID}_terminal`;
  assert.throws(() => M.freeze("workout", workoutId, { ...payload, to: [...M.HISTORICAL_ISSUE_RECIPIENTS] }, config(), AT), { code: "provider_recipient_invalid" });
  assert.throws(() => M.freeze("workout", workoutId, { ...payload, to: [M.HISTORICAL_ISSUE_RECIPIENTS[1]] }, config(), AT), { code: "provider_recipient_invalid" });
  assert.deepEqual(M.freeze("workout", workoutId, { ...payload, to: [M.RECIPIENTS[0]] }, config(), AT).payload.to, [M.RECIPIENTS[0]]);
});
test("concurrent and repeated claims yield exactly one send permission, including lost-response recovery", async () => {
  const f = fixture(), results = await Promise.all([claimed(f), claimed(f), f.service.claim({ ...f.request, runId: "retry-run" })]);
  assert.equal(results.filter(r => r.allowSend).length, 1);
  const c = results.find(r => r.allowSend);
  assert.equal(c.fromMailbox, "alerts@posetek.net"); assert.equal(c.to, M.RECIPIENTS.join(";")); assert.match(c.html, /&lt;private&gt;/);
  assert.match(c.subject, /^\[PTM-[a-f0-9]{32}\]/);
  assert.equal(f.job().dueAtMillis, null);
  f.advance(24 * 3600000);
  assert.equal((await claimed(f)).allowSend, false);
});
test("claim checks current domain sending gates and pilot instead of trusting the queued flow", async () => {
  const f = fixture(); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  assert.equal((await claimed(f)).allowSend, false);
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: true, testUids: ["another"] });
  assert.equal((await claimed(f)).allowSend, false);
});
test("receipts authenticate the exact consumed claim; accepted never means delivered", async () => {
  const f = fixture(), c = await claimed(f);
  await assert.rejects(f.service.receipt({ ...receipt(f, c), runId: "wrong" }), { code: "email_claim_mismatch" });
  await assert.rejects(f.service.receipt({ ...receipt(f, c), claimToken: "f".repeat(64) }), { code: "email_claim_mismatch" });
  await assert.rejects(f.service.receipt({ ...receipt(f, c), outcome: "delivered" }), { code: "email_invalid_request" });
  await f.service.receipt(receipt(f, c)); f.advance(1000); assert.equal((await f.service.receipt(receipt(f, c))).duplicate, true);
  assert.equal(f.job().status, "accepted"); assert.equal(f.job().deliveredAtMillis, undefined);
  assert.deepEqual(Object.values(f.job().recipientDelivery).map(v => v.status), ["accepted"]);
});
test("unknown Outlook outcome holds the job; later authentic trace can resolve it", async () => {
  const f = fixture(), c = await claimed(f); await f.service.receipt(receipt(f, c, "uncertain"));
  assert.equal(f.job().status, "needs_review"); assert.equal((await claimed(f)).allowSend, false);
  f.advance(600000);
  await f.service.applyTrace("issue", ID, { rows: M.RECIPIENTS.map(to => row(f, to)), checkedAtMillis: f.now() });
  assert.equal(f.job().status, "delivered"); assert.equal(f.job().deliveryObservedAtMillis, f.now());
  assert.equal(f.job().deliveredAtMillis, undefined, "Exchange received time is not a delivery timestamp");
});
test("per-recipient trace remains partial and preserves failures; late flow receipt cannot overwrite it", async () => {
  const f = fixture({ historicalClaim: true }), c = await claimed(f); f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.RECIPIENTS[0])], checkedAtMillis: f.now() });
  assert.notEqual(f.job().status, "delivered");
  await f.service.receipt(receipt(f, c)); assert.equal(f.job().status, "accepted");
  f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.HISTORICAL_ISSUE_RECIPIENTS[1], "failed"), row(f, M.HISTORICAL_ISSUE_RECIPIENTS[2])], checkedAtMillis: f.now() });
  assert.equal(f.job().status, "failed"); assert.equal(f.job().recipientDelivery[M.RECIPIENTS[0]].status, "delivered");
});
test("trace matching requires exact subject, approved sender, destination and time", async () => {
  const f = fixture(); await claimed(f); f.advance(300000);
  const bad = [{ subject: `${f.job().payload.subject} extra` }, { senderAddress: "attacker@example.com" }, { recipientAddress: "other@posetek.net" }, { receivedDateTime: new Date(AT - 900000).toISOString() }];
  await f.service.applyTrace("issue", ID, { rows: bad.map(p => row(f, M.RECIPIENTS[0], "delivered", p)), checkedAtMillis: f.now() });
  assert.deepEqual(f.job().recipientDelivery, {}); assert.notEqual(f.job().status, "delivered");
});
test("multiple message identities with the same correlation hold instead of claiming delivery", async () => {
  const f = fixture({ historicalClaim: true }), c = await claimed(f); f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.RECIPIENTS[0]), row(f, M.HISTORICAL_ISSUE_RECIPIENTS[1], "delivered", { messageId: "<duplicate@posetek.net>" })], checkedAtMillis: f.now() });
  assert.equal(f.job().status, "needs_review"); assert.equal(f.job().microsoft.traceAmbiguous, true);
  await f.service.receipt(receipt(f, c)); assert.equal(f.job().status, "needs_review");
  assert.equal(f.job().microsoftTraceDueAtMillis, null);
});
test("missing claim receipt and missing trace eventually require review without resending", async () => {
  const f = fixture(); await claimed(f); f.advance(600000);
  assert.equal((await f.service.reconcile()).checked, 1); assert.equal(f.job().status, "needs_review");
  f.advance(TRACE_WINDOW); await f.service.reconcile();
  assert.equal(f.job().microsoftTraceDueAtMillis, null); assert.equal((await claimed(f)).allowSend, false);
});
test("trace budget uses a rolling window and competing schedulers claim once", async () => {
  const f = fixture(); await claimed(f); f.advance(300000);
  const results = await Promise.all([f.service.reconcile(), f.service.reconcile()]);
  assert.equal(results.reduce((n, r) => n + r.checked, 0), 1);
  for (let i = 0; i < 80; i++) await f.service.reserveTraceRequest();
  f.advance(299999); await assert.rejects(f.service.reserveTraceRequest(), { code: "provider_trace_budget" });
  f.advance(2); await f.service.reserveTraceRequest();
});
test("global send budget defers excess claims without consuming permission or expiring an unsent job", async () => {
  const f = fixture(), base = f.job();
  for (let i = 0; i < 21; i++) {
    const id = i.toString(16).padStart(64, "0"), path = `userIssueOutbox/${id}`;
    await f.db.doc(path).set({ ...base, id, ...M.freeze("issue", id, base.payload, config(), AT) });
    const answer = await f.service.claim({ ...f.request, jobId: id, runId: `run-${i}` });
    assert.equal(answer.allowSend, i < 20);
  }
  const id = (20).toString(16).padStart(64, "0"), path = `userIssueOutbox/${id}`;
  assert.equal(f.db.snapshot(path).microsoft.claimedAtMillis, undefined); assert.equal(f.db.snapshot(path).status, "pending");
  f.advance(24 * 3600000);
  assert.equal((await f.service.claim({ ...f.request, jobId: id, runId: "later" })).allowSend, true);
});

test("rolling recipient budget counts mixed issue/workout recipients globally and preserves denied work", async () => {
  const f = fixture(), budgetRef = f.db.doc("microsoftEmailState/sendBudget");
  await budgetRef.set({ claimTimes: [], recipientBuckets: [{ start: AT, count: 8998 }] });
  const issue = await claimed(f); assert.equal(issue.allowSend, true); // Dylan only: 8999.
  const workoutId = `${"b".repeat(64)}_terminal`, logPath = "players/synthetic/workoutLogs/synthetic";
  const log = { completed: true, activeSeconds: 5 };
  await f.db.doc(logPath).set(log);
  await f.db.doc("workoutNotificationSettings/current").set({ enabled: true, sendEnabled: true, activatedAtMillis: AT - 1 });
  const workout = { id: workoutId, eventType: "terminal", playerId: "synthetic", source: "workoutLogs", logId: "synthetic",
    createdAtMillis: AT, status: "pending", firstAttemptAtMillis: AT, dispatchAfterMillis: AT,
    ...M.freeze("workout", workoutId, { to: [M.RECIPIENTS[0]], subject: "Synthetic workout", text: "Test only" }, config(), AT,
      { logPath, fingerprint: require("./workout-notifications").savedFingerprint(log) }) };
  await f.db.doc(`workoutNotificationOutbox/${workoutId}`).set(workout);
  const request = { schemaVersion: 1, kind: "workout", jobId: workoutId, runId: "single-recipient" };
  assert.equal((await f.service.claim(request)).allowSend, true); // One recipient: 9000.
  const id = "c".repeat(64), before = { ...fixture().job(), id, ...M.freeze("issue", id, fixture().job().payload, config(), AT) };
  await f.db.doc(`userIssueOutbox/${id}`).set(before);
  const budgetBefore = f.db.snapshot("microsoftEmailState/sendBudget");
  const denied = await f.service.claim({ ...f.request, jobId: id });
  assert.deepEqual(denied, { schemaVersion: 1, allowSend: false, deferred: true });
  assert.deepEqual(f.db.snapshot(`userIssueOutbox/${id}`), before);
  assert.deepEqual(f.db.snapshot("microsoftEmailState/sendBudget"), budgetBefore, "denied claim consumes neither quota nor permission");
  assert.equal((await f.service.claim(request)).allowSend, false);
  assert.deepEqual(f.db.snapshot("microsoftEmailState/sendBudget"), budgetBefore, "duplicate claims consume no extra recipients");
});

test("recipient limit uses a conservative partial boundary bucket, not a midnight reset", async () => {
  const f = fixture(), bucket = AT - RECIPIENT_WINDOW;
  await f.db.doc("microsoftEmailState/sendBudget").set({ claimTimes: [], recipientBuckets: [{ start: bucket, count: 9000 }] });
  f.advance(60000); // The oldest minute expired, but this 15-minute bucket still overlaps the day.
  assert.equal((await claimed(f)).allowSend, false);
  f.advance(RECIPIENT_BUCKET - 60001);
  assert.equal((await claimed(f)).allowSend, false);
  f.advance(1);
  assert.equal((await claimed(f)).allowSend, true, "a complete old bucket expires at its exact end plus 24h");
  const midnight = fixture(); midnight.advance(22 * 3600000); // Exactly midnight UTC the following day.
  await midnight.db.doc("microsoftEmailState/sendBudget").set({ claimTimes: [], recipientBuckets: [{ start: AT, count: 9000 }] });
  assert.equal((await claimed(midnight)).allowSend, false, "midnight does not refresh an unfinished rolling day");
});

test("recipient-budget corruption fails closed rather than forgetting previously consumed quota", async () => {
  const f = fixture(); await f.db.doc("microsoftEmailState/sendBudget").set({ recipientBuckets: [{ start: AT, count: "8999" }] });
  await assert.rejects(claimed(f), { code: "provider_send_budget_invalid" });
  assert.equal(f.job().microsoft.claimedAtMillis, undefined);
});
test("flow wakeups carry only job references; HTTP 202 never synthesizes a provider acceptance", async () => {
  let request;
  const endpoint = "https://unit.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/flow/triggers/manual/paths/invoke?api-version=1";
  const flow = createFlowTransport({ endpoint: () => endpoint, getAccessToken: async () => "private-token", fetchImpl: async (url, options) => { request = { url, options }; return { status: 202 }; } });
  assert.deepEqual(await flow.send({ text: "private athlete" }, "key", { kind: "issue", id: ID, deliveryProvider: "microsoft" }), { pending: true });
  assert.equal(request.options.redirect, "error"); assert.equal(request.options.body.includes("private athlete"), false);
  assert.deepEqual(JSON.parse(request.options.body), { schemaVersion: 1, kind: "issue", jobId: ID });
  for (const url of ["http://unit.logic.azure.com/workflows/x/triggers/manual/paths/invoke", endpoint + "&sig=secret", "https://evil.example/workflows/x/triggers/manual/paths/invoke"]) assert.throws(() => flowEndpoint(url));
});
test("real Microsoft provider requests the exact slash-terminated Flow audience before its reference-only wakeup", async t => {
  const values = { MICROSOFT_EMAIL_TENANT_ID: "11111111-1111-1111-1111-111111111111", MICROSOFT_EMAIL_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
    MICROSOFT_EMAIL_CLIENT_SECRET: "fixture-only-client-secret", MICROSOFT_EMAIL_FLOW_ENDPOINT: "https://unit.logic.azure.com/workflows/test/triggers/manual/paths/invoke" };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])), calls = [];
  try {
    Object.assign(process.env, values);
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/oauth2/v2.0/token")) {
        const parameters = new URLSearchParams(options.body), scope = parameters.get("scope");
        assert.equal(parameters.get("grant_type"), "client_credentials");
        assert.equal(scope, "https://service.flow.microsoft.com//.default");
        assert.equal(scope.slice(0, -"/.default".length), "https://service.flow.microsoft.com/");
        return { ok: true, json: async () => ({ token_type: "Bearer", access_token: "fixture-flow-token-long-enough", expires_in: 3600 }) };
      }
      assert.equal(url, values.MICROSOFT_EMAIL_FLOW_ENDPOINT);
      assert.deepEqual(JSON.parse(options.body), { schemaVersion: 1, kind: "issue", jobId: ID });
      return { status: 202 };
    });
    const provider = createMicrosoftProvider();
    for (let i = 0; i < 2; i++) assert.deepEqual(await provider.send({}, "unused", { kind: "issue", id: ID, deliveryProvider: "microsoft" }), { pending: true });
    assert.equal(calls.filter(call => call.url.endsWith("/oauth2/v2.0/token")).length, 1, "cache keeps the same correctly scoped token");
  } finally { for (const key of Object.keys(values)) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } }
});
test("Graph trace completes pages before returning and never sends bearer credentials to another origin", async () => {
  const f = fixture(); await claimed(f); f.advance(300000);
  const requests = [];
  const next = "https://graph.microsoft.com/v1.0/admin/exchange/tracing/messageTraces?$skiptoken=page2";
  const reader = createTraceReader({ now: f.now, getAccessToken: async () => "private-token", fetchImpl: async (url, opts) => {
    requests.push({ url, opts }); return { ok: true, json: async () => requests.length === 1 ? { value: [row(f, M.RECIPIENTS[0])], "@odata.nextLink": next } : { value: [row(f, M.HISTORICAL_ISSUE_RECIPIENTS[1])] } };
  } });
  assert.equal((await reader.read(f.job())).rows.length, 2);
  assert.match(new URL(requests[0].url).searchParams.get("$filter"), /receivedDateTime ge .* and receivedDateTime le .*senderAddress eq 'alerts@posetek.net'/);
  let calls = 0;
  const hostile = createTraceReader({ now: f.now, getAccessToken: async () => "private-token", fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ value: [], "@odata.nextLink": "https://evil.example/" }) }; } });
  await assert.rejects(hostile.read(f.job()), { code: "provider_trace_invalid_page" }); assert.equal(calls, 1);
  const incomplete = createTraceReader({ now: f.now, getAccessToken: async () => "private-token", fetchImpl: async () => ({ ok: true, json: async () => ({ value: [row(f, M.RECIPIENTS[0])], "@odata.nextLink": next }) }) });
  await assert.rejects(incomplete.read(f.job()), { code: "provider_trace_incomplete" });
});
test("credential and provider failures expose no response bodies or tokens", async () => {
  const token = createTokenProvider({ credentials: () => ({ tenantId: "1".repeat(8) + "-1111-1111-1111-111111111111", clientId: "2".repeat(8) + "-2222-2222-2222-222222222222", clientSecret: "private-client-secret" }), scope: "https://graph.microsoft.com/.default",
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => "private-client-secret" }) });
  await assert.rejects(token(), error => error.code === "provider_oauth_auth" && !error.message.includes("private-client-secret"));
  assert.equal(M.authenticate("x".repeat(32), "x".repeat(32)), true); assert.equal(M.authenticate("x", "x"), false);
});
test("actual issue dispatcher holds a disabled route, freezes provider, and preserves legacy retries", async () => {
  const f = fixture(); const old = f.job();
  await f.db.doc(PATH).set({ id: ID, type: "incident", createdAtMillis: AT, title: "Test issue", lines: [], status: "pending", dueAtMillis: AT, attempts: 0 });
  await f.db.doc(M.SETTINGS).update({ enabled: false });
  const sent = [], issues = createUserIssues({ db: f.db, HttpsError, now: f.now, logger: { error: () => {} }, provider: { send: async (payload, key, job) => { sent.push({ payload, key, job }); return { pending: true }; } } });
  await issues.dispatch(ID); assert.equal(sent.length, 0); assert.equal(f.job().firstAttemptAtMillis, undefined);
  await f.db.doc(M.SETTINGS).update({ enabled: true }); await issues.dispatch(ID);
  assert.equal(sent[0].job.deliveryProvider, "microsoft"); assert.equal(f.job().status, "pending"); assert.equal(f.job().acceptedAtMillis, undefined);
  await claimed(f); f.advance(300000); await issues.dispatch(ID); assert.equal(sent.length, 1);
  await f.db.doc(PATH).set({ ...old, deliveryProvider: "resend", payload: { from: "old", to: [M.RECIPIENTS[0]], subject: "frozen", text: "frozen" }, dueAtMillis: f.now() });
  await issues.dispatch(ID); assert.equal(sent[1].job.deliveryProvider, "resend"); assert.deepEqual(sent[1].payload.to, [M.RECIPIENTS[0]]);
});
test("Resend callback cannot settle a Microsoft job even with matching tag and provider ID", async () => {
  const f = fixture(), issues = createUserIssues({ db: f.db, HttpsError, now: f.now });
  await issues.webhook({ id: "old-webhook", event: { type: "email.delivered", created_at: new Date(AT).toISOString(), data: { email_id: "old", from: "support@alerts.posetek.net", to: [M.RECIPIENTS[0]], tags: { posetek_issue_outbox: ID } } } });
  assert.equal(f.job().status, "pending");
});

async function legacyUnclaimed(f) {
  await f.db.doc(PATH).update({ title: "Synthetic old issue", lines: ["Affected user: Target Athlete (staff)", "Operation: test_operation"],
    payload: { ...f.job().payload, to: [...M.HISTORICAL_ISSUE_RECIPIENTS] }, failureCode: "provider_flow_http_502", failureMessage: "Original frozen failure", leaseUntilMillis: 0 });
  f.advance(2);
}
const amendmentInput = f => ({ jobId: ID, expectedOriginalDigest: M.payloadDigest(f.job().payload), authorizationId: "approved-refinement-test",
  lowerBoundMillis: AT - 1, upperBoundMillis: AT + 1 });
test("pre-send recipient removal holds an old unconsumed envelope before any quota or send permission", async () => {
  const f = fixture(); await legacyUnclaimed(f);
  const before = f.job();
  assert.equal((await claimed(f)).allowSend, false);
  assert.equal(f.job().status, "needs_review"); assert.equal(f.job().failureCode, "provider_recipient_removed");
  assert.deepEqual(f.job().payload, before.payload); assert.equal(f.job().microsoft.claimedAtMillis, undefined);
  assert.equal(f.db.snapshot("microsoftEmailState/sendBudget"), undefined);
});
test("issue dispatcher holds frozen removed recipients before a provider wakeup or Resend API call", async () => {
  for (const deliveryProvider of ["microsoft", "resend"]) {
    const f = fixture(); await legacyUnclaimed(f); await f.db.doc(PATH).update({ deliveryProvider });
    let sends = 0; const issues = createUserIssues({ db: f.db, HttpsError, now: f.now, logger: { error: () => {} }, provider: { send: async () => { sends++; return { id: "should-not-send" }; } } });
    const original = f.job().payload; await issues.dispatch(ID);
    assert.equal(sends, 0); assert.equal(f.job().failureCode, "provider_recipient_removed"); assert.deepEqual(f.job().payload, original);
    assert.equal(f.job().attempts, 1); assert.equal(f.job().microsoft.claimedAtMillis, undefined);
  }
});
test("audited recent unsent amendment is idempotent, keeps originals, and consumes exactly one recipient", async () => {
  const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  const before = f.job(), input = amendmentInput(f);
  const dry = await amendRecentUnclaimed({ db: f.db, input, now: f.now });
  assert.equal(dry.eligible, true); assert.equal(dry.applied, false); assert.deepEqual(f.job(), before);
  const results = await Promise.all([amendRecentUnclaimed({ db: f.db, input, now: f.now, dryRun: false }), amendRecentUnclaimed({ db: f.db, input, now: f.now, dryRun: false })]);
  assert.equal(results.filter(result => result.applied).length, 1); assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.deepEqual(f.job().payload, before.payload); assert.equal(f.job().attempts, before.attempts); assert.equal(f.job().firstAttemptAtMillis, before.firstAttemptAtMillis);
  assert.equal(f.job().deliveryAmendment.previousDeliveryState.failureCode, "provider_flow_http_502");
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: true });
  const c = await claimed(f); assert.equal(c.to, M.RECIPIENTS[0]); assert.equal(f.job().microsoft.claimRecipients.length, 1);
  assert.equal(f.db.snapshot("microsoftEmailState/sendBudget").recipientBuckets.reduce((sum, bucket) => sum + bucket.count, 0), 1);
  await f.service.receipt(receipt(f, c));
  assert.deepEqual(Object.keys(f.job().recipientDelivery), M.RECIPIENTS);
  f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.RECIPIENTS[0]), row(f, "nolanj@posetek.net", "failed")], checkedAtMillis: f.now() });
  assert.equal(f.job().status, "delivered"); assert.equal(f.job().recipientDelivery["nolanj@posetek.net"], undefined);
  const completed = f.job(); assert.equal((await amendRecentUnclaimed({ db: f.db, input, now: f.now, dryRun: false })).duplicate, true);
  assert.deepEqual(f.job(), completed); assert.equal((await claimed(f)).allowSend, false);
});
test("recent amendment regenerates an audited exact-account body without changing the original envelope", async () => {
  const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  await f.db.doc(PATH).update({ issueId: "synthetic-issue", actorUid: "staff" });
  await f.db.doc(`userIssueOccurrences/${ID}`).set({ issueId: "synthetic-issue", reporterUid: "staff", operation: "test_operation",
    source: "application", player: { id: "athlete-id", name: "Target Athlete" },
    currentContact: { schemaVersion: 1, uid: "staff", source: "firebase_admin_auth", name: "Account Staff", email: "staff@example.com", emailVerified: true, observedAtMillis: AT } });
  const original = f.job().payload, result = await amendRecentUnclaimed({ db: f.db, input: amendmentInput(f), now: f.now, dryRun: false });
  assert.equal(result.applied, true); assert.deepEqual(f.job().payload, original);
  const payload = M.effectiveDeliveryPayload(f.job()); assert.equal(payload.subject, original.subject); assert.equal(payload.from, original.from);
  assert.match(payload.text, /Account\/reporter: Account Staff \(staff\)/); assert.match(payload.text, /Contact email: staff@example\.com \(email verified\)/);
  assert.match(payload.text, /Target athlete: Target Athlete \(athlete-id\)/); assert.doesNotMatch(payload.text, /Affected user:/);
  assert.equal(f.job().deliveryAmendment.renderSource.occurrenceId, ID);
});
test("amendment refuses every consumed-send signal, original conflict, other provider, receipt or outside-window job", async () => {
  for (const patch of [{ acceptedAtMillis: AT }, { providerId: "receipt" }, { recipientDelivery: { "nolanj@posetek.net": { status: "accepted" } } },
    { microsoft: { runId: "already-run" } }, { microsoft: { claimTokenHash: "a".repeat(64) } }, { microsoft: { claimedAtMillis: AT } },
    { microsoft: { receiptUncertainAtMillis: AT } }, { microsoft: { internetMessageId: "<sent@posetek.net>" } }, { microsoft: { traceCheckedAtMillis: AT } }]) {
    const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
    await f.db.doc(PATH).update({ ...patch, ...(patch.microsoft ? { microsoft: { ...f.job().microsoft, ...patch.microsoft } } : {}) });
    const before = f.job(), answer = await amendRecentUnclaimed({ db: f.db, input: amendmentInput(f), now: f.now, dryRun: false });
    assert.equal(answer.reason, "amendment_send_evidence_present"); assert.deepEqual(f.job(), before);
  }
  for (const patch of [{ deliveryProvider: "resend" }, { createdAtMillis: AT - 2 }, { status: "delivered" }, { leaseUntilMillis: AT + 1000 }]) {
    const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false }); await f.db.doc(PATH).update(patch);
    const before = f.job(), answer = await amendRecentUnclaimed({ db: f.db, input: amendmentInput(f), now: f.now, dryRun: false });
    assert.equal(answer.applied, false); assert.ok(answer.reason); assert.deepEqual(f.job(), before);
  }
  const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  await f.db.doc(`${PATH}/receipts/original`).set({ type: "sent" });
  assert.equal((await amendRecentUnclaimed({ db: f.db, input: amendmentInput(f), now: f.now, dryRun: false })).reason, "amendment_send_evidence_present");
  await assert.rejects(amendRecentUnclaimed({ db: f.db, input: { ...amendmentInput(f), expectedOriginalDigest: "f".repeat(64) }, now: f.now, dryRun: false }), { code: "amendment_original_changed" });
});
test("a consumed amendment keeps its frozen body when a later formatter changes", async () => {
  const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  await f.db.doc(PATH).update({ issueId: "synthetic-issue", actorUid: "staff" });
  await f.db.doc(`userIssueOccurrences/${ID}`).set({ issueId: "synthetic-issue", reporterUid: "staff", operation: "test_operation", source: "application" });
  await amendRecentUnclaimed({ db: f.db, input: amendmentInput(f), now: f.now, dryRun: false });
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: true });
  const c = await claimed(f), frozen = M.effectiveDeliveryPayload(f.job());
  const formatter = require("./user-issue-model"), saved = formatter.payload;
  formatter.payload = () => { throw Error("A future formatter must not run for an already consumed permission"); };
  try { assert.deepEqual(M.effectiveDeliveryPayload(f.job()), frozen); await f.service.receipt(receipt(f, c)); }
  finally { formatter.payload = saved; }
  assert.deepEqual(Object.keys(f.job().recipientDelivery), M.RECIPIENTS);
});
test("invalid amended body holds without permission; historical consumed recipients and claim snapshots cannot be rewritten", async () => {
  const f = fixture(); await legacyUnclaimed(f); await f.db.doc("userIssueSettings/current").update({ sendEnabled: false });
  await amendRecentUnclaimed({ db: f.db, input: amendmentInput(f), now: f.now, dryRun: false });
  const amendment = f.job().deliveryAmendment, forged = { ...amendment.payload, text: "Forged body" };
  const effectivePayloadDigest = M.payloadDigest(forged);
  await f.db.doc(PATH).update({ deliveryAmendment: { ...amendment, payload: forged, effectivePayloadDigest,
    id: M.deliveryAmendmentId(amendment.jobId, amendment.originalPayloadDigest, effectivePayloadDigest, amendment.approvedFromMillis, amendment.approvedCutoffMillis, amendment.authorizationId) } });
  await f.db.doc("userIssueSettings/current").update({ sendEnabled: true });
  assert.equal((await claimed(f)).allowSend, false); assert.equal(f.job().failureCode, "provider_delivery_amendment_invalid");
  const old = fixture({ historicalClaim: true }), c = await claimed(old), originalTo = [...old.job().payload.to];
  await old.service.receipt(receipt(old, c)); assert.deepEqual(Object.keys(old.job().recipientDelivery), originalTo);
  await old.service.applyTrace("issue", ID, { rows: [row(old, originalTo[0])], checkedAtMillis: old.now() });
  assert.notEqual(old.job().status, "delivered", "removing recipients never converts historical partial delivery into all delivered");
});
