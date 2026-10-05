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
function setup(seed = {}, overrides = {}) {
  const db = new FakeFirestore(seed);
  let time = start;
  const deps = { db, Timestamp: FakeTimestamp, rateKey, now: () => time, ...overrides };
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
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type, Authorization");
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
  const fakeRows = Array.from({ length: 51 }, (_, n) => ({ id: `row-${n}`, data: () => ({ formVersion: n > 0 && n < 4 ? 2 : 1,
    identityMode: n === 2 || n === 3 ? "account" : "anonymous", entrySource: "qr", createdAt: FakeTimestamp.fromMillis(start - n), answers: submitted.answers,
    author: { uid: n === 3 ? "" : "synthetic-account", displayName: " Synthetic account\nname ", email: "synthetic@example.test", emailVerified: true, privateExtra: "not exported" },
    durationSeconds: 36, unexpected: "not exported" }) }));
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
  for (const index of [0, 1]) { assert.equal(result.responses[index].identityMode, "anonymous"); assert.equal(result.responses[index].author, null); }
  assert.deepEqual(result.responses[2].author, { uid: "synthetic-account", displayName: "Synthetic account name", email: "synthetic@example.test", emailVerified: true });
  assert.equal(result.responses[2].identityMode, "account"); assert.equal(result.responses[3].author, null);
  assert.ok(!JSON.stringify(result).includes("privateExtra"));
  assert.ok(calls.every(call => call.name !== COLLECTIONS.limits));
  const responseCall = calls.find(call => call.name === COLLECTIONS.responses);
  assert.equal(responseCall.steps.find(step => step[0] === "limit")[1], 51);
  assert.equal(responseCall.steps.find(step => step[0] === "where")[3].toMillis(), start - RETENTION_MS);
  assert.deepEqual(responseCall.steps.filter(step => step[0] === "orderBy").map(step => step.slice(1)), [["createdAt", "desc"], ["__name__", "desc"]]);
});

const version2 = (input = submitted, identityMode = "account") => ({ ...input, formVersion: 2, identityMode });
const accountRequest = token => ({ ...request, headers: { authorization: `Bearer ${token}` } });
const account = { uid: "synthetic-account-a", displayName: "Synthetic Account", email: "account@example.test", emailVerified: true, disabled: false };
function authDependencies(user = account) {
  const calls = [];
  return { calls, verifyIdToken: async (token, checkRevoked) => { calls.push(["verify", token, checkRevoked]); return { uid: user.uid, firebase: { sign_in_provider: "password" }, displayName: "Untrusted token name", email: "untrusted-token@example.test" }; },
    getUser: async uid => { calls.push(["get", uid]); return user; } };
}

test("version1 remains completely anonymous even with valid, invalid or changed account credentials", async () => {
  const { db, receive } = setup({}, { verifyIdToken: () => { throw new Error("Old forms must not inspect tokens"); }, getUser: () => { throw new Error("Old forms must not look up accounts"); } });
  await receive(submitted, accountRequest("account-a-token"));
  assert.equal((await receive(submitted, accountRequest("account-b-token"))).duplicate, true);
  assert.equal((await receive(submitted, { ...request, headers: { authorization: "invalid" } })).duplicate, true);
  const saved = db.snapshot(path("responses")), session = db.snapshot(path("sessions"));
  for (const value of [saved, session]) { assert.equal(value.formVersion, 1); assert.ok(!("author" in value)); assert.ok(!("identityMode" in value)); }
  assert.equal(saved.expiresAt.toMillis(), start + RETENTION_MS);
  await assert.rejects(receive({ ...submitted, identityMode: "account" }, accountRequest("account-a-token")), { status: 400 });
});

test("version2 telemetry accepts signed-out invitation landings without authenticating or storing account IDs", async () => {
  const { db, receive } = setup({}, { verifyIdToken: () => { throw new Error("Telemetry must not inspect auth"); }, getUser: () => { throw new Error("Telemetry must not read Auth"); } });
  for (const [source, identityMode] of [["workout", "anonymous"], ["results", "account"], ["qr", "account"]]) {
    const event = version2({ ...opened, sessionId: randomUUID(), entrySource: source }, identityMode);
    await receive(event, request);
    await receive({ ...event, event: "started" }, { ip: request.ip });
    const session = db.snapshot(path("sessions", event.sessionId));
    assert.equal(session.identityMode, identityMode); assert.equal(session.formVersion, 2);
    assert.deepEqual([session.opened, session.started, session.submitted], [true, true, false]);
    assert.equal(session.expiresAt.toMillis(), start + RETENTION_MS);
  }
  assert.equal(rows(db, "responses").length, 0);
  for (const forbidden of ["private-user", "private-token", "author", "displayName", "email", "uid"]) assert.ok(!JSON.stringify([...db.docs]).includes(forbidden));
});

test("version2 account submission requires a valid unrevoked nonanonymous enabled Firebase identity", async () => {
  const invalidRequests = [{ ip: request.ip }, { ...request, headers: { authorization: "Basic no" } }, { ...request, headers: { authorization: ["Bearer no"] } },
    { ...request, headers: { authorization: "Bearer first second" } }, { ...request, headers: { authorization: "Bearer " + "x".repeat(16384) } }];
  for (const raw of invalidRequests) {
    const auth = authDependencies(), { db, receive } = setup({}, auth);
    await assert.rejects(receive(version2(), raw), { status: 401, code: "account-required" });
    assert.equal(auth.calls.length, 0); assert.equal(db.docs.size, 0);
  }
  for (const code of ["auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found"]) {
    const { db, receive } = setup({}, { verifyIdToken: async (token, checkRevoked) => { assert.equal(checkRevoked, true); throw Object.assign(new Error("Private token details"), { code }); }, getUser: () => { throw new Error("No lookup after invalid token"); } });
    await assert.rejects(receive(version2(), accountRequest("rejected-token")), { status: 401, code: "account-required" });
    assert.equal(db.docs.size, 0);
  }
  for (const token of [{ uid: account.uid, firebase: { sign_in_provider: "anonymous" } }, { uid: "" }, { uid: "x".repeat(129) }, { uid: "bad\nuid" }]) {
    const { db, receive } = setup({}, { verifyIdToken: async () => token, getUser: () => { throw new Error("No lookup after unsupported identity"); } });
    await assert.rejects(receive(version2(), accountRequest("unsupported-token")), { status: 401 }); assert.equal(db.docs.size, 0);
  }
  for (const user of [{ ...account, disabled: true }, { ...account, uid: "different-account" }, null]) {
    const { db, receive } = setup({}, { verifyIdToken: async () => ({ uid: account.uid, firebase: { sign_in_provider: "password" } }), getUser: async () => user });
    await assert.rejects(receive(version2(), accountRequest("rejected-user")), { status: 401 }); assert.equal(db.docs.size, 0);
  }
});

test("account attribution comes only from bounded Auth user snapshots and never enters sessions or rate counters", async () => {
  const user = { ...account, displayName: "  Account\u0000 Name\n" + "x".repeat(250), email: " account@example.test\u0007" + "y".repeat(350), emailVerified: false, customClaims: { privateExtra: "not stored" } };
  const privatePlayer = { name: "Private player profile", authUID: account.uid, feedback_form_needed: false };
  const auth = authDependencies(user), { db, receive } = setup({ [`players/${account.uid}`]: privatePlayer }, auth);
  await receive(version2({ ...submitted, entrySource: "workout" }), accountRequest("verified-token"));
  const saved = db.snapshot(path("responses"));
  assert.equal(saved.formVersion, 2); assert.equal(saved.identityMode, "account");
  assert.deepEqual(saved.author, { uid: account.uid, displayName: ("Account Name " + "x".repeat(250)).slice(0, 200), email: ("account@example.test " + "y".repeat(350)).slice(0, 320), emailVerified: false });
  assert.equal(saved.expiresAt.toMillis(), start + RETENTION_MS);
  assert.deepEqual(auth.calls, [["verify", "verified-token", true], ["get", account.uid]]);
  const privateCounters = JSON.stringify([...rows(db, "sessions"), ...rows(db, "limits")]);
  for (const value of [account.uid, "author", "displayName", "email", "verified-token", "private-user"]) assert.ok(!privateCounters.includes(value));
  assert.ok(!JSON.stringify(saved).includes("Untrusted token")); assert.ok(!JSON.stringify(saved).includes("privateExtra"));
  assert.ok(!JSON.stringify(saved).includes("Private player profile")); assert.deepEqual(db.snapshot(`players/${account.uid}`), privatePlayer); assert.equal(db.queries.length, 0);
  const blank = authDependencies({ ...account, uid: "synthetic-no-profile", displayName: " \n ", email: undefined, emailVerified: false });
  const other = setup({}, blank); await other.receive(version2(), accountRequest("email-free-account"));
  assert.deepEqual(other.db.snapshot(path("responses")).author, { uid: "synthetic-no-profile", displayName: null, email: null, emailVerified: false });
});

test("same-account retries retain the immutable author snapshot and another account cannot replay them successfully", async () => {
  let updatedName = false, revoked = false;
  const { db, receive, time } = setup({}, {
    verifyIdToken: async (token, checkRevoked) => { assert.equal(checkRevoked, true); if (revoked) throw Object.assign(new Error("Private revocation"), { code: "auth/id-token-revoked" }); return { uid: token === "account-b-token" ? "synthetic-account-b" : account.uid, firebase: { sign_in_provider: "password" } }; },
    getUser: async uid => ({ ...account, uid, displayName: updatedName ? "New account name" : account.displayName }),
  });
  await Promise.all(Array.from({ length: 4 }, () => receive(version2(), accountRequest("account-a-token"))));
  assert.equal(rows(db, "responses").length, 1);
  const before = JSON.stringify([...db.docs]); updatedName = true; time(start + 50000);
  assert.equal((await receive(version2(), accountRequest("account-a-new-token"))).duplicate, true);
  assert.equal(JSON.stringify([...db.docs]), before);
  await assert.rejects(receive(version2(), accountRequest("account-b-token")), { status: 409, code: "already-submitted" });
  assert.equal(JSON.stringify([...db.docs]), before);
  revoked = true;
  await assert.rejects(receive(version2(), accountRequest("account-a-token")), { status: 401 });
  assert.equal(JSON.stringify([...db.docs]), before);
});

test("version2 signed-out or deliberately anonymous shared-link submissions ignore all credentials", async () => {
  const { db, receive } = setup({}, { verifyIdToken: () => { throw new Error("Anonymous choice must not inspect auth"); }, getUser: () => { throw new Error("Anonymous choice must not read Auth"); } });
  for (const source of ["qr", "message", "direct"]) {
    const id = randomUUID(), input = version2({ ...submitted, sessionId: id, entrySource: source }, "anonymous");
    await receive(input, { ip: request.ip });
    assert.equal((await receive(input, accountRequest("valid-but-ignored-token"))).duplicate, true);
    const saved = db.snapshot(path("responses", id));
    assert.equal(saved.formVersion, 2); assert.equal(saved.identityMode, "anonymous"); assert.equal(saved.author, null);
  }
  const all = JSON.stringify([...db.docs]);
  for (const value of ["valid-but-ignored-token", "private-user", "uid", "displayName", "email"]) assert.ok(!all.includes(value));
});

test("version2 source/mode gates and client identity forgeries fail before Auth lookup or storage", async () => {
  const auth = authDependencies(), { db, receive } = setup({}, auth);
  for (const input of [
    ...["workout", "results"].map(entrySource => version2({ ...submitted, entrySource }, "anonymous")),
    ...[null, undefined, "player", 1].map(identityMode => ({ ...version2(), identityMode })),
    ...["uid", "name", "displayName", "email", "author", "auth", "user", "playerId"].map(field => ({ ...version2(), [field]: "forged identity" })),
    { ...version2(), answers: { ...submitted.answers, author: account } },
  ]) await assert.rejects(receive(input, accountRequest("valid-token")), { status: 400 });
  assert.equal(auth.calls.length, 0); assert.equal(db.docs.size, 0);
});

test("a version2 session binds its chosen mode while allowing unlinked telemetry to arrive out of order", async () => {
  const auth = authDependencies(), { db, receive } = setup({}, auth);
  const accountInput = version2();
  await receive(version2(opened, "anonymous"), { ip: request.ip });
  const before = JSON.stringify([...db.docs]);
  await assert.rejects(receive(accountInput, accountRequest("valid-token")), { status: 409, code: "session-changed" });
  await assert.rejects(receive(version2({ ...opened, event: "started" }), { ip: request.ip }), { status: 409, code: "session-changed" });
  assert.equal(JSON.stringify([...db.docs]), before);
  const next = randomUUID(); await receive({ ...accountInput, sessionId: next }, accountRequest("valid-token"));
  await receive(version2({ ...opened, sessionId: next, event: "started" }), { ip: request.ip });
  await receive(version2({ ...opened, sessionId: next }), { ip: request.ip });
  const session = db.snapshot(path("sessions", next)); assert.deepEqual([session.opened, session.started, session.submitted], [true, true, true]);
  assert.ok(!JSON.stringify(session).includes(account.uid));
  await assert.rejects(receive(version2({ ...submitted, sessionId: next }, "anonymous"), { ip: request.ip }), { status: 409, code: "session-changed" });
});

test("HTTP auth failures are safe, authorization preflight is allowed and transient Auth failure does not become an identity error", async () => {
  const { db, deps } = setup({}, { verifyIdToken: async () => { throw Object.assign(new Error("Private token PII account@example.test"), { code: "auth/internal-error" }); }, getUser: async () => account });
  const handler = createAppFeedbackHttp(deps);
  const headers = { origin: "https://posetek.net", "content-type": "application/json", authorization: "Bearer private-token" };
  const preflight = response(); await handler(httpRequest({ method: "OPTIONS", headers: { ...headers, "access-control-request-headers": "authorization,content-type" } }), preflight);
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers["Access-Control-Allow-Headers"], "Content-Type, Authorization");
  const absent = response(); await handler(httpRequest({ body: version2() }), absent); assert.equal(absent.statusCode, 401);
  const transient = response(); await handler(httpRequest({ body: version2(), headers }), transient);
  assert.equal(transient.statusCode, 503); assert.equal(transient.body.error.code, "unavailable");
  for (const value of ["private-token", "account@example.test", "Private token"]) assert.ok(!JSON.stringify([absent.body, transient.body]).includes(value));
  assert.equal(db.docs.size, 0);
});
