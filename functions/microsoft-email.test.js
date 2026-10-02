"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const M = require("./microsoft-email-model");
const { createMicrosoftEmail, TRACE_WINDOW, RECIPIENT_BUCKET, RECIPIENT_WINDOW } = require("./microsoft-email");
const { createUserIssues } = require("./user-issues");
const { createTraceReader, createFlowTransport, createTokenProvider, flowEndpoint } = require("./microsoft-email-transport");
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
function fixture() {
  let time = AT;
  const payload = { from: "PoseTek Support <support@alerts.posetek.net>", to: [...M.RECIPIENTS], subject: "Issue observed", text: "Protected context <private>" };
  const db = new QueueFirestore({ [M.SETTINGS]: config(), "userIssueSettings/current": { enabled: true, sendEnabled: true, activatedAtMillis: AT - 1, emailProvider: "microsoft" },
    [PATH]: { id: ID, type: "incident", createdAtMillis: AT, status: "pending", dueAtMillis: AT, firstAttemptAtMillis: AT, attempts: 1, ...M.freeze("issue", ID, payload, config(), AT) } });
  const errors = [], traces = [];
  const service = createMicrosoftEmail({ db, now: () => time, traceReader: { read: async () => ({ rows: traces, checkedAtMillis: time }) }, logger: { error: (...a) => errors.push(a) } });
  const request = { schemaVersion: 1, kind: "issue", jobId: ID, runId: "run-1" };
  return { db, service, request, errors, traces, now: () => time, advance: ms => { time += ms; }, job: () => db.snapshot(PATH) };
}
async function claimed(f) { return f.service.claim(f.request); }
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

test("new Microsoft issue messages require all three teammates and workout messages require only Dylan", () => {
  const payload = { subject: "Synthetic recipient configuration", text: "Test only" };
  for (const to of [M.RECIPIENTS.slice(0, 1), M.RECIPIENTS.slice(0, 2), [M.RECIPIENTS[0], M.RECIPIENTS[0], M.RECIPIENTS[2]], [...M.RECIPIENTS, "other@posetek.net"]]) {
    assert.throws(() => M.freeze("issue", ID, { ...payload, to }, config(), AT), { code: "provider_recipient_invalid" });
  }
  assert.deepEqual(M.freeze("issue", ID, { ...payload, to: [...M.RECIPIENTS].reverse() }, config(), AT).payload.to, [...M.RECIPIENTS].reverse());
  const workoutId = `${ID}_terminal`;
  assert.throws(() => M.freeze("workout", workoutId, { ...payload, to: [...M.RECIPIENTS] }, config(), AT), { code: "provider_recipient_invalid" });
  assert.throws(() => M.freeze("workout", workoutId, { ...payload, to: [M.RECIPIENTS[1]] }, config(), AT), { code: "provider_recipient_invalid" });
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
  assert.deepEqual(Object.values(f.job().recipientDelivery).map(v => v.status), ["accepted", "accepted", "accepted"]);
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
  const f = fixture(), c = await claimed(f); f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.RECIPIENTS[0])], checkedAtMillis: f.now() });
  assert.notEqual(f.job().status, "delivered");
  await f.service.receipt(receipt(f, c)); assert.equal(f.job().status, "accepted");
  f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.RECIPIENTS[1], "failed"), row(f, M.RECIPIENTS[2])], checkedAtMillis: f.now() });
  assert.equal(f.job().status, "failed"); assert.equal(f.job().recipientDelivery[M.RECIPIENTS[0]].status, "delivered");
});
test("trace matching requires exact subject, approved sender, destination and time", async () => {
  const f = fixture(); await claimed(f); f.advance(300000);
  const bad = [{ subject: `${f.job().payload.subject} extra` }, { senderAddress: "attacker@example.com" }, { recipientAddress: "other@posetek.net" }, { receivedDateTime: new Date(AT - 900000).toISOString() }];
  await f.service.applyTrace("issue", ID, { rows: bad.map(p => row(f, M.RECIPIENTS[0], "delivered", p)), checkedAtMillis: f.now() });
  assert.deepEqual(f.job().recipientDelivery, {}); assert.notEqual(f.job().status, "delivered");
});
test("multiple message identities with the same correlation hold instead of claiming delivery", async () => {
  const f = fixture(), c = await claimed(f); f.advance(300000);
  await f.service.applyTrace("issue", ID, { rows: [row(f, M.RECIPIENTS[0]), row(f, M.RECIPIENTS[1], "delivered", { messageId: "<duplicate@posetek.net>" })], checkedAtMillis: f.now() });
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
  await budgetRef.set({ claimTimes: [], recipientBuckets: [{ start: AT, count: 8996 }] });
  const issue = await claimed(f); assert.equal(issue.allowSend, true); // Three recipients: 8999.
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
  await f.db.doc("microsoftEmailState/sendBudget").set({ claimTimes: [], recipientBuckets: [{ start: bucket, count: 8998 }] });
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
test("Graph trace completes pages before returning and never sends bearer credentials to another origin", async () => {
  const f = fixture(); await claimed(f); f.advance(300000);
  const requests = [];
  const next = "https://graph.microsoft.com/v1.0/admin/exchange/tracing/messageTraces?$skiptoken=page2";
  const reader = createTraceReader({ now: f.now, getAccessToken: async () => "private-token", fetchImpl: async (url, opts) => {
    requests.push({ url, opts }); return { ok: true, json: async () => requests.length === 1 ? { value: [row(f, M.RECIPIENTS[0])], "@odata.nextLink": next } : { value: [row(f, M.RECIPIENTS[1])] } };
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
