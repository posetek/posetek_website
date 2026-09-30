"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore } = require("./test-support/fake-firestore");
const { createPerformanceTestBooking, REQUESTS, LIMITS, LEASE_MS, RETRY_WINDOW_MS, RATE_WINDOW_MS, RATE_LIMIT, MAX_ATTEMPTS } = require("./performance-test-booking");
const { createBookingEmailProvider, RECIPIENT, FROM } = require("./performance-test-booking-provider");
const { createPerformanceTestBookingEntrypoints } = require("./performance-test-booking-entrypoints");

const NOW = Date.parse("2026-09-30T18:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const uuid = n => `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;
const body = (extra = {}) => ({ requestId: ID, fullName: "Test Contact", email: "contact@example.com", appointmentDate: "2026-10-02",
  timeSlot: "flexible", timezone: "America/Los_Angeles", bookingType: "individual", notes: "Please discuss location.", website: "", ...extra });
const request = { ip: "192.0.2.11" };
function fixture() {
  const db = new FakeFirestore(), sends = [];
  let time = NOW, lease = 0;
  const provider = { async send(payload, key) { sends.push({ payload, key }); return { id: "message-one" }; } };
  const service = createPerformanceTestBooking({ db, provider, now: () => time, randomId: () => `lease-${++lease}` });
  return { db, sends, provider, service, advance(ms) { time += ms; }, setTime(ms) { time = ms; }, record(id = ID) { return db.snapshot(`${REQUESTS}/${id}`); } };
}
async function http(f, changes = {}) {
  const req = { method: "POST", headers: { origin: "https://posetek.net", "content-type": "application/json" }, body: body(), ...request, ...changes };
  const response = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; }, send(data) { this.body = data; return this; } };
  await f.service.handler(req, response); return response;
}
const rejectsCode = (work, code) => assert.rejects(work, error => error.code === code);

test("request is durable before provider acceptance, uses fixed routing and truthful content", async () => {
  const f = fixture();
  f.provider.send = async (payload, key) => {
    assert.equal(f.record().deliveryStatus, "sending");
    assert.equal(f.record().request.email, "contact@example.com");
    f.sends.push({ payload, key }); return { id: "accepted-one" };
  };
  const response = await http(f);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { requestId: ID, status: "received" });
  const { payload, key } = f.sends[0];
  assert.equal(payload.from, FROM); assert.deepEqual(payload.to, [RECIPIENT]); assert.equal(payload.reply_to, "contact@example.com");
  assert.equal(key, `performance-test-booking/${ID}`);
  assert.match(payload.text, /request for confirmation, not a reserved appointment/);
  assert.match(payload.text, /Flexible \(Pacific time; America\/Los_Angeles\)/);
  assert.match(payload.text, /Please discuss location/);
  assert.equal(f.record().deliveryStatus, "accepted");
  assert.equal(f.record().providerMessageId, "accepted-one");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.ok(!JSON.stringify(response.body).includes("contact@example.com"));
});

test("accepted same-key retries do not send again or consume a second new-request allowance", async () => {
  const f = fixture();
  await f.service.submit(body(), request);
  await Promise.all(Array.from({ length: 8 }, () => f.service.submit(body({ fullName: " Test Contact " }), request)));
  assert.equal(f.sends.length, 1); assert.equal(f.record().attempts, 1);
  assert.equal([...f.db.docs].find(([path]) => path.startsWith(LIMITS + "/"))[1].count, 1);
  f.advance(5 * 86400000); // Date is now in the past; a prior acceptance remains a valid receipt.
  assert.equal((await f.service.submit(body(), request)).status, "received");
});

test("same request ID with changed details conflicts without writing or sending", async () => {
  const f = fixture(); await f.service.submit(body(), request);
  const before = f.record();
  for (const changed of [{ email: "someone@example.com" }, { appointmentDate: "2026-10-03" }, { notes: "changed" }, { timeSlot: "09:00" }]) {
    await rejectsCode(() => f.service.submit(body(changed), request), "request_conflict");
  }
  assert.deepEqual(f.record(), before); assert.equal(f.sends.length, 1);
});

test("simultaneous identical requests share one send lease", async () => {
  const f = fixture(); let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.provider.send = async (payload, key) => { f.sends.push({ payload, key }); entered(); await new Promise(resolve => { release = resolve; }); return { id: "one" }; };
  const first = f.service.submit(body(), request); await waiting;
  await rejectsCode(() => f.service.submit(body(), request), "delivery_unconfirmed");
  assert.equal(f.sends.length, 1); release(); await first;
  assert.equal(f.record().deliveryStatus, "accepted");
});

test("transient provider failure returns 503 and retries the exact frozen payload and key", async () => {
  const f = fixture(); let failing = true;
  f.provider.send = async (payload, key) => { f.sends.push({ payload, key }); if (failing) throw Object.assign(new Error("private provider detail"), { code: "provider_network" }); return { id: "retry-one" }; };
  const response = await http(f);
  assert.equal(response.statusCode, 503); assert.equal(response.body.error.code, "delivery_unconfirmed");
  assert.match(response.body.error.message, /couldn’t confirm delivery/); assert.ok(!JSON.stringify(response).includes("private provider"));
  assert.equal(f.record().deliveryStatus, "pending");
  assert.equal((await http(f)).statusCode, 503); assert.equal(f.sends.length, 1);
  f.advance(30001); failing = false;
  assert.equal((await http(f)).statusCode, 200);
  assert.deepEqual(f.sends[0], f.sends[1]); assert.equal(f.record().deliveryStatus, "accepted");
});

test("a duplicate cannot revoke an active final send at the attempt or retry-window boundary", async () => {
  for (const boundary of ["attempts", "window"]) {
    const f = fixture();
    f.provider.send = async () => { throw new Error("uncertain"); };
    await http(f); f.advance(30001);
    await f.db.doc(`${REQUESTS}/${ID}`).update(boundary === "attempts" ? { attempts: MAX_ATTEMPTS - 1 } : { firstAttemptAtMillis: NOW + 30001 - RETRY_WINDOW_MS + 10000 });
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    f.provider.send = async () => { entered(); await new Promise(resolve => { release = resolve; }); return { id: "final-attempt" }; };
    const finalAttempt = http(f); await waiting;
    if (boundary === "window") f.advance(10001);
    assert.equal((await http(f)).statusCode, 503);
    assert.equal(f.record().deliveryStatus, "sending");
    release(); assert.equal((await finalAttempt).statusCode, 200);
    assert.equal(f.record().providerMessageId, "final-attempt");
    assert.equal(f.record().deliveryStatus, "accepted");
  }
});

test("provider acceptance followed by persistence failure is safely retried with the same provider key", async () => {
  const f = fixture(), run = f.db.runTransaction.bind(f.db); let transactions = 0;
  f.db.runTransaction = async handler => { if (++transactions === 2) throw new Error("private database error"); return run(handler); };
  const first = await http(f); assert.equal(first.statusCode, 503); assert.equal(f.record().deliveryStatus, "sending");
  f.advance(LEASE_MS + 1);
  assert.equal((await http(f)).statusCode, 200);
  assert.deepEqual(f.sends[0], f.sends[1]);
});

test("expired ambiguous attempts and permanent failures require review instead of blind resend", async () => {
  for (const permanent of [false, true]) {
    const f = fixture();
    f.provider.send = async () => { f.sends.push(1); throw Object.assign(new Error("private detail"), { code: "provider_http_401", permanent }); };
    assert.equal((await http(f)).statusCode, 503);
    if (!permanent) f.advance(RETRY_WINDOW_MS);
    else f.advance(60000);
    assert.equal((await http(f)).statusCode, 503);
    assert.equal(f.sends.length, 1); assert.equal(f.record().deliveryStatus, "attention");
  }
});

test("bounded retries stop before repeated failures become unbounded provider sends", async () => {
  const f = fixture(); f.provider.send = async () => { f.sends.push(1); throw new Error("uncertain"); };
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) { assert.equal((await http(f)).statusCode, 503); f.advance(30001); }
  assert.equal(f.sends.length, MAX_ATTEMPTS); assert.equal(f.record().deliveryStatus, "attention");
});

test("rate limits hash platform IP, normalize mapped IPv4, and recover after the logical window", async () => {
  const f = fixture();
  for (let i = 1; i <= RATE_LIMIT; i++) await f.service.submit(body({ requestId: uuid(i) }), request);
  const response = await http(f, { body: body({ requestId: uuid(90) }), ip: "::ffff:192.0.2.11" });
  assert.equal(response.statusCode, 429); assert.equal(response.headers["Retry-After"], "900");
  assert.equal([...f.db.docs.keys()].filter(path => path.startsWith(LIMITS + "/")).length, 1);
  assert.ok(!JSON.stringify([...f.db.docs]).includes("192.0.2.11"));
  assert.equal(f.record(uuid(90)), undefined);
  f.advance(RATE_WINDOW_MS + 1); await f.service.submit(body({ requestId: uuid(90) }), request);
  assert.equal(f.sends.length, RATE_LIMIT + 1);
});

test("invalid input, honeypot, malformed dates and routing injection never write or send", async () => {
  const invalid = [
    { requestId: "not-an-id" }, { website: "https://spam.example" }, { email: "contact@example.com\r\nBcc: victim@example.com" },
    { fullName: "\nInjected" }, { fullName: "x".repeat(121) }, { email: "bad" }, { email: "x".repeat(255) },
    { notes: "x".repeat(1501) }, { notes: "bad\u0000" }, { appointmentDate: "2026-02-30" }, { appointmentDate: "2026-09-29" },
    { appointmentDate: "2028-10-01" }, { timeSlot: "17:30" }, { timeSlot: "9 AM" }, { timezone: "UTC" },
    { bookingType: "investor" }, { to: "someone@example.com" }, { from: "someone@example.com" },
  ];
  for (const patch of invalid) {
    const f = fixture(), response = await http(f, { body: body(patch) });
    assert.equal(response.statusCode, 400, JSON.stringify(patch)); assert.equal(f.db.docs.size, 0); assert.equal(f.sends.length, 0);
  }
});

test("Pacific date boundary governs new dates, with team/other and fixed slots accepted", async () => {
  const f = fixture(); f.setTime(Date.parse("2026-10-01T03:00:00Z")); // Still September 30 Pacific.
  for (const [i, bookingType, timeSlot] of [[1, "team", "09:00"], [2, "other", "17:00"]]) {
    await f.service.submit(body({ requestId: uuid(i), appointmentDate: "2026-09-30", bookingType, timeSlot }), request);
  }
  assert.equal(f.sends.length, 2);
});

test("missing platform IP fails closed and ignores caller-supplied forwarding values", async () => {
  const f = fixture();
  assert.equal((await http(f, { ip: undefined, headers: { origin: "https://posetek.net", "content-type": "application/json", "x-forwarded-for": "192.0.2.11" } })).statusCode, 503);
  assert.equal(f.db.docs.size, 0); assert.equal(f.sends.length, 0);
});

test("HTTP surface rejects bad origins, methods, media type and size without writes", async () => {
  const f = fixture();
  for (const [changes, status] of [
    [{ headers: { origin: "https://evil.example", "content-type": "application/json" } }, 403],
    [{ headers: { "content-type": "application/json" } }, 403], [{ method: "GET" }, 405],
    [{ headers: { origin: "https://posetek.net", "content-type": "text/plain" } }, 415], [{ rawBody: Buffer.alloc(8193) }, 413],
    [{ body: { ...body(), notes: "x".repeat(9000) } }, 413],
  ]) assert.equal((await http(f, changes)).statusCode, status);
  const preflight = await http(f, { method: "OPTIONS" });
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://posetek.net");
  assert.equal(f.db.docs.size, 0); assert.equal(f.sends.length, 0);
});

test("provider adapter fixes routing, uses bounded timeout/idempotency and sanitizes failures", async () => {
  const f = fixture(); await f.service.submit(body(), request);
  let sent;
  const provider = createBookingEmailProvider({ apiKey: () => "fixture-secret", fetchImpl: async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ id: "provider-one" }) }; } });
  const { payload, key } = f.sends[0];
  assert.deepEqual(await provider.send(payload, key), { id: "provider-one" });
  assert.equal(sent.url, "https://api.resend.com/emails"); assert.equal(sent.options.headers["Idempotency-Key"], key);
  assert.ok(sent.options.signal instanceof AbortSignal);
  for (const patch of [{ from: "Someone <x@example.com>" }, { to: [RECIPIENT, "extra@example.com"] }, { reply_to: "reply@example.com\nBcc: x@example.com" }]) {
    await rejectsCode(() => provider.send({ ...payload, ...patch }, key), "provider_payload_invalid");
  }
  for (const [status, permanent] of [[400, true], [401, true], [429, false], [409, false], [500, false]]) {
    const broken = createBookingEmailProvider({ apiKey: () => "fixture-secret", fetchImpl: async () => ({ ok: false, status, headers: { get: () => "120" }, text: async () => "private provider body" }) });
    await assert.rejects(() => broken.send(payload, key), error => error.permanent === permanent && error.retryAfterMs === 120000 && !error.message.includes("private"));
  }
  const malformed = createBookingEmailProvider({ apiKey: () => "fixture-secret", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await rejectsCode(() => malformed.send(payload, key), "provider_invalid_response");
  const missing = createBookingEmailProvider({ apiKey: () => "", fetchImpl: async () => { throw new Error("Should never fetch"); } });
  await rejectsCode(() => missing.send(payload, key), "provider_not_configured");
});

test("isolated entrypoint binds only the existing Resend secret and one bounded HTTP endpoint", () => {
  let options, handler;
  const functions = { runWith(value) { options = value; return { https: { onRequest(value) { handler = value; return "endpoint"; } } }; } };
  const exports = createPerformanceTestBookingEntrypoints(functions, { firestore: () => new FakeFirestore() });
  assert.deepEqual(exports, { requestPerformanceTestBooking: "endpoint" });
  assert.deepEqual(options, { secrets: ["RESEND_API_KEY"], timeoutSeconds: 60, maxInstances: 5 });
  assert.equal(typeof handler, "function");
});
