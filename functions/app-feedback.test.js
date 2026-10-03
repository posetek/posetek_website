"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createAppFeedback, createAppFeedbackHttp, createAppFeedbackAdmin, allowedFeedbackOrigin, COLLECTIONS, RETENTION_MS, WINDOW_MS } = require("./app-feedback");

const start = Date.UTC(2026, 9, 3);
const rateKey = "synthetic-feedback-secret-at-least-32-characters";
const sessionId = "4a8327e9-bd1a-48c1-91d0-83e2ec182479";
const request = { ip: "192.0.2.11", auth: { uid: "private-user" }, headers: { authorization: "Bearer private-token", "x-forwarded-for": "203.0.113.2" } };
const opened = { formVersion: 1, event: "opened", sessionId, entrySource: "qr" };
const submitted = { ...opened, event: "submitted", answers: { feature: "workouts", ease: "easy", obstruction: "none", comment: "  Useful.  " }, durationSeconds: 36 };
const path = (kind, id = sessionId) => `${COLLECTIONS[kind]}/${id}`;
const rows = (db, kind) => [...db.docs].filter(([key]) => key.startsWith(COLLECTIONS[kind] + "/"));
function setup(seed = {}) {
  const db = new FakeFirestore(seed);
  let time = start;
  const deps = { db, Timestamp: FakeTimestamp, rateKey, now: () => time };
  return { db, deps, receive: createAppFeedback(deps), time: value => { time = value; } };
}

test("records only received transitions, independent of account, network and athlete data", async () => {
  const preserved = { "players/athlete": { name: "Private athlete", feedback_form_needed: true }, "userFeedback/legacy": { playerId: "athlete" } };
  const { db, receive, time } = setup(preserved);
  await receive(opened, request);
  let row = db.snapshot(path("sessions"));
  assert.deepEqual([row.opened, row.started, row.submitted], [true, false, false]);
  assert.equal(row.openedAt.toMillis(), start);
  assert.equal(row.expiresAt.toMillis(), start + RETENTION_MS);
  time(start + 2000); await receive({ ...opened, event: "started" }, request);
  time(start + 36000); await receive(submitted, request);
  row = db.snapshot(path("sessions"));
  assert.deepEqual([row.opened, row.started, row.submitted], [true, true, true]);
  const response = db.snapshot(path("responses"));
  assert.equal(response.answers.comment, "Useful.");
  assert.equal(response.durationSeconds, 36);
  assert.equal(response.createdAt.toMillis(), start + 36000);
  assert.equal(response.submittedAt.toMillis(), start + 36000);
  assert.equal(response.expiresAt.toMillis(), start + 36000 + RETENTION_MS);
  assert.equal(rows(db, "limits")[0][1].count, 1);
  const all = JSON.stringify([...db.docs].filter(([key]) => key.startsWith(COLLECTIONS.sessions) || key.startsWith(COLLECTIONS.responses)));
  for (const privateValue of [request.ip, "private-user", "private-token", "203.0.113.2", "playerId", "coachUID", "authenticationUID"]) assert.ok(!all.includes(privateValue));
  for (const [key, value] of Object.entries(preserved)) assert.deepEqual(db.snapshot(key), value);
});

test("reordered or missing telemetry never blocks feedback or invents open/start events", async () => {
  const { db, receive } = setup();
  await receive(submitted, request);
  let session = db.snapshot(path("sessions"));
  assert.deepEqual([session.opened, session.started, session.submitted], [false, false, true]);
  assert.equal(session.openedAt, undefined); assert.equal(session.startedAt, undefined);
  await receive({ ...opened, event: "started" }, request);
  await receive(opened, request);
  session = db.snapshot(path("sessions"));
  assert.deepEqual([session.opened, session.started, session.submitted], [true, true, true]);
  assert.equal(rows(db, "responses").length, 1);
});

test("concurrent and later retries save a response exactly once, preserving original timestamps", async () => {
  const { db, receive, time } = setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => receive(submitted, request)));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal(rows(db, "responses").length, 1);
  // Firestore reads maps in canonical key order, not client insertion order.
  const saved = db.docs.get(path("responses"));
  saved.answers = Object.fromEntries(Object.entries(saved.answers).sort(([left], [right]) => left.localeCompare(right)));
  const before = JSON.stringify([...db.docs]);
  time(start + 50000);
  assert.equal((await receive(submitted, request)).duplicate, true);
  assert.equal(JSON.stringify([...db.docs]), before);
  await assert.rejects(receive({ ...submitted, answers: { ...submitted.answers, comment: "Different." } }, request), { status: 409 });
  assert.equal(JSON.stringify([...db.docs]), before);
});

test("null skipped answers and not-used exit are valid while invalid or identity-bearing payloads make no writes", async () => {
  const { db, receive } = setup();
  for (const input of [
    { ...submitted, playerId: "athlete" }, { ...opened, answers: submitted.answers }, { ...opened, durationSeconds: 3 },
    { ...submitted, formVersion: 2 }, { ...submitted, sessionId: "../players/athlete" }, { ...submitted, entrySource: "unknown" },
    { ...submitted, answers: { ...submitted.answers, contact: "kid@example.test" } },
    { ...submitted, answers: { ...submitted.answers, ease: "nice" } }, { ...submitted, answers: { ...submitted.answers, comment: "a".repeat(1001) } },
    { ...submitted, answers: { ...submitted.answers, feature: "notUsed" } },
    ...[-1, NaN, Infinity, 1.2, 86401, "60"].map(durationSeconds => ({ ...submitted, durationSeconds })),
  ]) await assert.rejects(receive(input, request), { status: 400 });
  assert.equal(db.docs.size, 0);
  await receive({ ...submitted, answers: { feature: null, ease: null, obstruction: null, comment: "" } }, request);
  await receive({ ...submitted, sessionId: randomUUID(), answers: { feature: "notUsed", ease: null, obstruction: null, comment: "" }, durationSeconds: 0 }, request);
  assert.equal(rows(db, "responses").length, 2);
});

test("shared team Wi-Fi permits60 new sessions per15minutes and accepted transitions do not consume further quota", async () => {
  const { db, receive, time } = setup();
  const sessions = Array.from({ length: 65 }, () => randomUUID());
  const results = await Promise.allSettled(sessions.map(id => receive({ ...opened, sessionId: id }, request)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 60);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.status === 429).length, 5);
  for (const id of sessions.slice(0, 60)) {
    await receive({ ...opened, sessionId: id, event: "started" }, request);
    await receive({ ...submitted, sessionId: id }, request);
  }
  assert.equal(rows(db, "responses").length, 60);
  assert.equal(rows(db, "limits")[0][1].count, 60);
  time(start + WINDOW_MS);
  await receive({ ...opened, sessionId: sessions[60] }, request);
  assert.equal(rows(db, "limits").length, 2);
});

test("quota keys are keyed and window-specific, normalizeIPspellings and never use supplied headers", async () => {
  const { db, receive, time } = setup();
  await receive(opened, request);
  await receive({ ...opened, sessionId: randomUUID() }, { ...request, ip: "::ffff:192.0.2.11" });
  assert.equal(rows(db, "limits").length, 1);
  assert.equal(rows(db, "limits")[0][1].count, 2);
  const firstKey = rows(db, "limits")[0][0];
  assert.match(firstKey.split("/").at(-1), /^[a-f0-9]{64}$/);
  assert.equal(rows(db, "limits")[0][1].expiresAt.toMillis(), start + 2 * WINDOW_MS);
  await receive({ ...opened, sessionId: randomUUID() }, { ...request, ip: "2001:DB8:0:0:0:0:0:A" });
  await receive({ ...opened, sessionId: randomUUID() }, { ...request, ip: "2001:db8::a" });
  assert.equal(rows(db, "limits").length, 2);
  assert.ok(rows(db, "limits").every(([, row]) => row.count === 2));
  time(start + WINDOW_MS); await receive({ ...opened, sessionId: randomUUID() }, request);
  assert.notEqual(rows(db, "limits").at(-1)[0], firstKey);
  const stored = JSON.stringify(rows(db, "limits"));
  for (const value of [request.ip, rateKey, "private-user", "private-token", "203.0.113.2", sessionId]) assert.ok(!stored.includes(value));
});

test("missing IP/secret and corrupt quota/session state fail closed without writes", async () => {
  const { db, receive, deps, time } = setup();
  for (const ip of [undefined, null, "not-an-ip", "192.0.2.11, 198.51.100.2", 3]) await assert.rejects(receive(opened, { ...request, ip }), { status: 503 });
  await assert.rejects(createAppFeedback({ ...deps, rateKey: "" })(opened, request), { status: 503 });
  assert.equal(db.docs.size, 0);
  await receive(opened, request);
  const limit = rows(db, "limits")[0][0];
  db.docs.set(limit, { count: -1, windowStartMillis: start });
  const before = JSON.stringify([...db.docs]);
  await assert.rejects(receive({ ...opened, sessionId: randomUUID() }, request), { status: 503 });
  assert.equal(JSON.stringify([...db.docs]), before);
  time(start + RETENTION_MS); await assert.rejects(receive(submitted, request), { status: 410 });
});

const response = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } });
const httpRequest = changes => ({ ...request, method: "POST", body: opened, headers: { origin: "https://posetek.net", "content-type": "application/json" }, ...changes });

test("HTTP origin/method/content gates fail before storage and production/local/ownpreview CORS are precise", async () => {
  for (const origin of ["https://posetek.net", "https://www.posetek.net", "https://posetek.netlify.app", "http://localhost:4321", "http://127.0.0.1:4174", "https://deploy-preview-21--posetek.netlify.app", "https://6abeaf5702a9c9983c7a41b9--posetek.netlify.app"]) assert.equal(allowedFeedbackOrigin(origin), true, origin);
  for (const origin of ["", "null", "https://evil.test", "https://posetek.net.evil.test", "https://deploy-preview-21--other.netlify.app", "https://evil--posetek.netlify.app.evil.test", "https://posetek.net/", "https://posetek.net:444", "http://posetek.net", "https://person@posetek.net"]) assert.equal(allowedFeedbackOrigin(origin), false, origin);
  const { db, deps } = setup(), handler = createAppFeedbackHttp(deps);
  for (const [req, code] of [
    [httpRequest({ headers: { origin: "https://evil.test" } }), 403], [httpRequest({ method: "GET" }), 405],
    [httpRequest({ headers: { origin: "https://posetek.net", "content-type": "text/plain" } }), 415], [httpRequest({ rawBody: Buffer.alloc(8193) }), 413],
    [httpRequest({ method: "OPTIONS" }), 204],
  ]) { const res = response(); await handler(req, res); assert.equal(res.statusCode, code); }
  assert.equal(db.docs.size, 0);
  const res = response(); await handler(httpRequest(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.accepted, true);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://posetek.net");
  assert.equal(res.headers["Access-Control-Allow-Credentials"], undefined);
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type");
});

test("HTTP storage failures never expose SDK, comment, auth or network details", async () => {
  const { deps } = setup(); deps.db.runTransaction = async () => { throw new Error("Private SDK error private-token 192.0.2.11"); };
  const res = response(); await createAppFeedbackHttp(deps)(httpRequest(), res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.error.code, "unavailable");
  assert.ok(!JSON.stringify(res.body).includes("private-token")); assert.ok(!JSON.stringify(res.body).includes("192.0.2.11"));
});

test("admin access uses currentcanonicalverifiedidentity and rejects forged pagination", async () => {
  const { deps } = setup();
  const list = createAppFeedbackAdmin({ ...deps, HttpsError });
  for (const auth of [null, { uid: "player", email: "kid@example.test", emailVerified: true }, { uid: "admin", email: "dylan@posetek.net", emailVerified: false },
    { uid: "admin", email: "dylan@posetek.net.evil.test", emailVerified: true }, { uid: "admin", email: "dylan@posetek.net", emailVerified: true, isAnonymous: true }]) await assert.rejects(list({}, auth), { code: "permission-denied" });
  const admin = { uid: "admin", email: "Dylan@PoseTek.net", emailVerified: true };
  for (const input of [{ playerId: "private-player" }, { cursor: { at: -1, id: sessionId } }, { cursor: { at: start, id: "../players/private" } }, { cursor: { at: start, id: sessionId, forged: true } }]) await assert.rejects(list(input, admin), { code: "invalid-argument" });
});

test("admin reads return a bounded stable page and90-dayactual-eventcounts without network counters", async () => {
  const calls = [];
  const fakeRows = Array.from({ length: 51 }, (_, n) => ({ id: `row-${n}`, data: () => ({ formVersion: 1, entrySource: "qr", createdAt: FakeTimestamp.fromMillis(start - n), answers: submitted.answers, durationSeconds: 36, unexpected: "not exported" }) }));
  function query(name, steps = []) {
    return { where(...values) { return query(name, [...steps, ["where", ...values]]); }, orderBy(...values) { return query(name, [...steps, ["orderBy", ...values]]); }, startAfter(...values) { return query(name, [...steps, ["startAfter", ...values]]); }, limit(...values) { return query(name, [...steps, ["limit", ...values]]); },
      count() { return { async get() { calls.push({ name, steps }); const field = steps.find(step => step[0] === "where" && step[2] === "==")[1]; return { data: () => ({ count: { opened: 9, started: 7, submitted: 4 }[field] }) }; } }; },
      async get() { calls.push({ name, steps }); return { docs: fakeRows }; } };
  }
  const db = { collection: name => query(name) }, list = createAppFeedbackAdmin({ db, Timestamp: FakeTimestamp, HttpsError, now: () => start });
  const result = await list({ cursor: { at: start + 1, id: sessionId } }, { uid: "admin", email: "dylan@posetek.net", emailVerified: true });
  assert.equal(result.responses.length, 50); assert.equal(result.responses[0].createdAtMillis, start);
  assert.deepEqual(result.nextCursor, { at: start - 49, id: "row-49" });
  assert.deepEqual(result.metrics, { opened: 9, started: 7, submitted: 4 });
  assert.ok(!JSON.stringify(result).includes("unexpected")); assert.equal(result.retentionDays, 90);
  assert.ok(calls.every(call => call.name !== COLLECTIONS.limits));
  const responseCall = calls.find(call => call.name === COLLECTIONS.responses);
  assert.equal(responseCall.steps.find(step => step[0] === "limit")[1], 51);
  assert.equal(responseCall.steps.find(step => step[0] === "where")[3].toMillis(), start - RETENTION_MS);
  assert.deepEqual(responseCall.steps.filter(step => step[0] === "orderBy").map(step => step.slice(1)), [["createdAt", "desc"], ["__name__", "desc"]]);
});
