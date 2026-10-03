"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observeSocialCallable } = require("./social-callable-observation");
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
function setup(handler, requireCaller = c => c.auth, options = {}) {
  const info = [], errors = []; let time = 100;
  return { info, errors, call: observeSocialCallable({ endpoint: "getSocialFeed", handler, requireCaller, HttpsError,
    logger: { info: value => info.push(value), error: value => errors.push(value) }, now: () => time += 12, newId: () => "server-request", ...options }) };
}
test("success preserves the exact response and logs a bounded duration without request contents", async () => {
  const response = { items: [{ id: "a" }], nextCursor: null };
  const s = setup(async (data, caller) => { assert.equal(data.scope, "team"); assert.equal(caller.uid, "staff"); return response; });
  assert.equal(await s.call({ requestId: "web-request", scope: "team", reporterUid: "forged", email: "private@example.com", viewAsPlayerId: "different-athlete" }, { auth: { uid: "staff" } }), response);
  assert.equal(s.info.length, 1); assert.equal(s.errors.length, 0);
  assert.equal(s.info[0].reporterUid, "staff"); assert.equal(s.info[0].requestId, "web-request"); assert.equal(s.info[0].durationMillis, 12);
  assert.equal(JSON.stringify(s.info).includes("different-athlete"), false); assert.equal(JSON.stringify(s.info).includes("private@"), false);
});
test("user-visible validation and access failures are retained, and exact HttpsError is preserved", async () => {
  for (const code of ["invalid-argument", "failed-precondition", "permission-denied", "internal", "deadline-exceeded", "unavailable"]) {
    const error = new HttpsError(code, "public message", { preserved: true });
    const s = setup(async () => { throw error; });
    await assert.rejects(s.call({ requestId: `attempt-${code}` }, { auth: { uid: "account" } }), e => e === error);
    assert.equal(s.errors.length, 1); assert.equal(s.errors[0].code, code); assert.equal(s.errors[0].outcome, "failed");
    assert.equal(s.errors[0].errorCategory, ["invalid-argument", "failed-precondition"].includes(code) ? "action_validation" : "request_failure");
  }
});
test("cancellation is outcome telemetry rather than an incident log", async () => {
  const s = setup(async () => { throw new HttpsError("cancelled", "Cancelled"); });
  await assert.rejects(s.call({}, { auth: { uid: "account" } }), { code: "cancelled" });
  assert.equal(s.errors.length, 0); assert.equal(s.info[0].outcome, "cancelled");
});
test("untrusted identity and invalid request references never enter actor or correlation fields", async () => {
  const s = setup(async () => { throw new Error("password=secret private@example.com"); }, () => { throw new HttpsError("unauthenticated", "Sign in"); });
  await assert.rejects(s.call({ reporterUid: "forged", requestId: "private@example.com" }, {}), { code: "unauthenticated" });
  assert.equal(s.errors[0].reporterUid, null); assert.equal(s.errors[0].requestId, "server-request");
  assert.equal(JSON.stringify(s.errors).includes("private@"), false);
});
test("raw errors produce a single safe correlated log then generic INTERNAL; job references remain exact", async () => {
  const s = setup(async () => { throw new Error("Bearer secret-credential and private@example.com"); });
  await assert.rejects(s.call({ jobId: "exact-job" }, { auth: { uid: "account" } }), { code: "internal", message: "INTERNAL" });
  assert.equal(s.errors.length, 1); assert.equal(s.errors[0].requestId, "exact-job");
  assert.equal(JSON.stringify(s.errors).includes("secret"), false); assert.equal(JSON.stringify(s.errors).includes("private@"), false);
});

test("raw numeric and string gRPC errors retain diagnostic codes but always preserve the SDK public INTERNAL response", async () => {
  for (const [raw, diagnostic] of [[9, "failed-precondition"], [5, "not-found"], ["permission-denied", "permission-denied"], [1, "cancelled"]]) {
    const error = Object.assign(new Error("raw internal details and private@example.com"), { code: raw });
    const s = setup(async () => { throw error; });
    await assert.rejects(s.call({ requestId: "attempt-raw-" + raw }, { auth: { uid: "account" } }), result => result instanceof HttpsError && result !== error && result.code === "internal" && result.message === "INTERNAL" && result.details === undefined);
    assert.equal(s.errors.length, 1); assert.equal(s.info.length, 0);
    assert.equal(s.errors[0].code, diagnostic); assert.equal(s.errors[0].outcome, "failed"); assert.equal(s.errors[0].errorCategory, "request_failure");
    assert.equal(JSON.stringify(s.errors).includes("private@"), false);
  }
});
test("a logging failure cannot turn success into an application failure", async () => {
  const response = { items: [] };
  const s = setup(async () => response, undefined, { logger: { info: () => { throw new Error("log unavailable"); }, error: () => { throw new Error("log unavailable"); } } });
  assert.equal(await s.call({}, { auth: { uid: "account" } }), response);
});
