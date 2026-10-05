"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { observeSocialCallable } = require("../../functions/social-callable-observation");
const endpoints = ["getSocialAdminDirectory", "getSocialContext", "getSocialFeed", "getSocialActivity", "saveSocialPreferences", "setSocialVisibility", "getSocialPeople", "socialConnection", "setSocialKudos", "getSocialComments", "saveSocialComment", "reportSocialActivity", "moderateSocialActivity", "getSocialMedia"];
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture() {
  const options = Object.fromEntries(endpoints.map(endpoint => [endpoint, { timeoutSeconds: 120, memory: "256MB", preserveExternalChanges: true }]));
  const roots = Object.fromEntries(endpoints.map(endpoint => [endpoint, endpoint === "getSocialMedia" ? "endpoint-deps/getSocialMedia" : "."]));
  const registrations = [], loaded = [], calls = [], exports = {};
  const functions = { logger: { error() {}, info() {} }, https: { HttpsError }, region: region => ({ runWith: runtime => ({ https: { onCall: handler => { registrations.push({ region, runtime, handler }); return handler; } } }) }) };
  const admin = { initializeApp() {}, firestore: () => ({}), storage: () => ({ bucket: name => ({ name }) }) };
  const requireFixture = name => {
    if (name === "firebase-functions") return functions;
    if (name === "firebase-admin") return admin;
    if (name === "./runtime-options.json") return options;
    if (name === "./implementation-roots.json") return roots;
    if (name === "./social-callable-observation") return { observeSocialCallable };
    if (name.endsWith("/social.js")) {
      loaded.push(name);
      return { createSocial: config => { assert.equal(config.bucket.name, "kickai-69dd0.firebasestorage.app"); return new Proxy({}, { get: (_target, handler) => async (data, caller) => { calls.push({ name, handler, data, caller }); return { preserved: true }; } }); } };
    }
    throw Error("Unexpected dependency: " + name);
  };
  vm.runInNewContext(fs.readFileSync(__dirname + "/index.js", "utf8"), { require: requireFixture, exports, Map, Object, Error });
  return { options, roots, registrations, loaded, calls, exports };
}
test("discovers only fourteen current social callables with preserved per-endpoint options and dependency roots", () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.exports), endpoints); assert.equal(f.registrations.length, 14);
  assert.deepEqual(f.loaded, ["././social.js", "./endpoint-deps/getSocialMedia/social.js"]);
  for (const [index, endpoint] of endpoints.entries()) { assert.equal(f.registrations[index].region, "us-central1"); assert.equal(f.registrations[index].runtime, f.options[endpoint]); }
});
test("scoped handler preserves verified account and original target payload while rejecting anonymous access", async () => {
  const f = fixture(), input = { requestId: "exact-request", viewAsPlayerId: "target-player", reporterUid: "forged" };
  assert.deepEqual(await f.exports.getSocialFeed(input, { auth: { uid: "exact-staff", token: { email: "staff@example.test", email_verified: true, auth_time: 123 } } }), { preserved: true });
  assert.equal(f.calls[0].data, input); assert.equal(f.calls[0].caller.uid, "exact-staff"); assert.equal(f.calls[0].caller.authTime, undefined);
  await assert.rejects(f.exports.getSocialFeed({}, {}), { code: "unauthenticated" });
  await assert.rejects(f.exports.getSocialFeed({}, { auth: { uid: "anonymous", token: { firebase: { sign_in_provider: "anonymous" } } } }), { code: "permission-denied" });
  assert.equal(f.calls.length, 1);
});
