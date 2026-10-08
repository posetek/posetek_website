"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
function fixture() {
  const calls = [], exports = {};
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const onCall = options => handler => Object.assign(handler, { options });
  const functions = { https: { HttpsError, onCall: onCall({}) }, runWith: options => ({ https: { onCall: onCall(options) } }) };
  const access = new Proxy({}, { get: (_, key) => async (...args) => { calls.push({ key, args }); return { key }; } });
  const fake = { "firebase-functions": functions, "firebase-admin": { initializeApp() {}, firestore: Object.assign(() => ({}), { FieldValue: {} }), auth: () => ({}) },
    "./clubs": { createClubs: () => ({}) }, "./account-access": { createAccountAccess: () => access } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "index.js"), "utf8"), { exports, require: name => { assert.ok(Object.hasOwn(fake, name), "unexpected scope dependency"); return fake[name]; } });
  return { exports, calls };
}
const context = { auth: { uid: "owned-player", token: { email: "owned@example.test", email_verified: false, auth_time: 100, firebase: { sign_in_provider: "password" } } }, rawRequest: {} };
test("scope exports exactly ten callable endpoints with preserved and bounded runtimes", () => {
  const { exports } = fixture();
  assert.equal(Object.keys(exports).length, 10);
  for (const name of ["getAccountAccessLink", "completeAccountAccessLink"]) assert.deepEqual({ ...exports[name].options }, { timeoutSeconds: 120 });
  for (const name of ["listAccountAccessLinks", "revokeAccountAccessLink"]) assert.equal(Object.keys(exports[name].options).length, 0);
  assert.deepEqual({ ...exports.submitAccountRecoveryRequest.options }, { timeoutSeconds: 30, maxInstances: 10 });
  for (const name of ["inspectPlayerRecovery", "issuePlayerRecovery", "listAccountRecoveryRequests", "updateAccountRecoveryRequest", "confirmAccountRecovery"]) {
    assert.deepEqual({ ...exports[name].options }, { timeoutSeconds: 60, maxInstances: 5 });
  }
});
test("authenticated confirmation forwards the password provider and exact token claims", async () => {
  const { exports, calls } = fixture();
  await exports.confirmAccountRecovery({ grantId: "owned-grant" }, context);
  assert.equal(calls[0].key, "rate"); assert.equal(calls[0].args[2], "recovery_manage");
  const current = calls[1].args[1];
  assert.equal(current.uid, context.auth.uid); assert.equal(current.signInProvider, "password"); assert.equal(current.authTime, 100);
  assert.equal(current.emailVerified, false); assert.equal(current.isAnonymous, false);
});
test("privileged calls reject anonymous and signed-out callers before handler", async () => {
  const { exports, calls } = fixture();
  for (const ctx of [{ rawRequest: {} }, { ...context, auth: { ...context.auth, token: { firebase: { sign_in_provider: "anonymous" } } } }]) {
    await assert.rejects(exports.issuePlayerRecovery({}, ctx), error => ["unauthenticated", "permission-denied"].includes(error.code));
  }
  assert.equal(calls.length, 0);
});
test("public anonymous intake keeps its generic request and IP rate wrapper", async () => {
  const { exports, calls } = fixture();
  const rawRequest = {}, ctx = { rawRequest, auth: { uid: "anonymous", token: { firebase: { sign_in_provider: "anonymous" } } } };
  const body = { requestId: "owned-request" };
  await exports.submitAccountRecoveryRequest(body, ctx);
  assert.equal(calls[0].key, "rate"); assert.equal(calls[0].args[0], rawRequest); assert.equal(calls[0].args[1], null);
  assert.equal(calls[0].args[2], "recovery_request"); assert.equal(calls[0].args[3], 5);
  assert.equal(calls[1].key, "submitAccountRecoveryRequest"); assert.equal(calls[1].args[0], body); assert.equal(calls[1].args[1], null);
});
