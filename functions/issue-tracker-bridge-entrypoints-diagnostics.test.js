"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

function fixture(outcomes = {}, logger) {
  const calls = [], logs = [], sideEffects = [], registrations = [];
  const branch = name => async () => {
    calls.push(name);
    return typeof outcomes[name] === "function" ? outcomes[name]() : { complete: true };
  };
  const bridge = { wake: () => sideEffects.push("wake"), drain: () => sideEffects.push("drain"),
    observeOutbox: () => sideEffects.push("outbox"), observeOccurrence: () => sideEffects.push("occurrence") };
  const dependencies = {
    "./issue-tracker-bridge": { createIssueTrackerBridge: () => bridge },
    "./issue-tracker-bridge-transport": { createFlowTokenProvider: () => () => {}, createPowerAutomateTransport: () => ({}) },
    "./issue-tracker-bridge-ingress": { createTrackerMailIngress: () => () => {} },
    "./issue-tracker-recovery": { createIssueTrackerRecovery: () => ({ run: () => sideEffects.push("recovery") }) },
    "./issue-tracker-graph-reader": { createGraphTokenProvider: () => () => {}, createGraphReader: () => ({}) },
    "./issue-tracker-mail-capture": { createMailCapture: () => ({ reconcile: branch("mail_join_recovery"), ingress: () => {} }) },
    "./issue-tracker-source-capture": { createSourceCapture: () => ({ run: name => branch(name)() }) },
    "./issue-tracker-mail-read-proxy": { createMailReadProxyTransport: () => () => {}, createConfiguredMailReader: () => ({}) },
    "./issue-tracker-mail-identity-proxy": { createMailIdentityProxyTransport: () => () => {} },
    "./user-issue-contacts": { createIssueContactEnrichment: () => ({ reconcile: branch("contacts") }) },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "issue-tracker-bridge-entrypoints.js"), "utf8");
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, fetch: () => { throw new Error("Fake fixture must never fetch"); } }, { filename: "issue-tracker-bridge-entrypoints.js" });
  const functions = { logger: logger || { error: (...args) => logs.push(args) }, runWith: options => {
    registrations.push(options);
    const registered = handler => handler;
    return { firestore: { document: () => ({ onWrite: registered }) },
      tasks: { taskQueue: () => ({ onDispatch: registered }) }, https: { onRequest: registered },
      pubsub: { schedule: () => ({ timeZone: () => ({ onRun: registered }) }) } };
  } };
  const entrypoints = module.exports.createIssueTrackerBridgeEntrypoints(functions, { firestore: () => ({}) }, {
    normalize: () => {}, taskQueue: { enqueue: () => { throw new Error("Fake fixture must never enqueue"); } },
  });
  return { handler: entrypoints.captureUserIssueTrackerSources, calls, logs, sideEffects, registrations, entrypoints };
}
const reject = code => async () => { throw Object.assign(new Error("Private provider detail must not be logged"), { code }); };
const plain = value => JSON.parse(JSON.stringify(value));
const generic = { message: "tracker_source_capture_incomplete" };

test("successful independent branches remain successful with no diagnostics or extra work", async () => {
  const f = fixture();
  assert.equal(await f.handler(), undefined);
  assert.deepEqual(f.calls, ["outlook", "backend", "mail_join_recovery", "contacts"]);
  assert.deepEqual(f.logs, []); assert.deepEqual(f.sideEffects, []);
  assert.equal(Object.keys(f.entrypoints).length, 6);
  assert.equal(f.registrations.at(-1).timeoutSeconds, 180); assert.equal(f.registrations.at(-1).maxInstances, 1);
});

test("each failed branch logs its fixed reason before the unchanged aggregate failure", async () => {
  const f = fixture({ outlook: reject("tracker_graph_access_denied"), mail_join_recovery: reject("tracker_mail_alias_budget_exceeded") });
  await assert.rejects(f.handler(), generic);
  assert.deepEqual(plain(f.logs), [
    ["tracker_source_capture_branch_failed", { branch: "outlook", reason: "tracker_graph_access_denied" }],
    ["tracker_source_capture_branch_failed", { branch: "mail_join_recovery", reason: "tracker_mail_alias_budget_exceeded" }],
  ]);
  assert.deepEqual(f.calls, ["outlook", "backend", "mail_join_recovery", "contacts"]); assert.deepEqual(f.sideEffects, []);
});

test("all four failures are retained and unknown reasons use a fixed fallback", async () => {
  const f = fixture({ outlook: reject("tracker_mail_proxy_unavailable"), backend: reject(13),
    mail_join_recovery: reject("tracker_alias_group_changed"), contacts: reject("unrecognized_contact_reason") });
  await assert.rejects(f.handler(), generic);
  assert.deepEqual(plain(f.logs).map(([, value]) => value), [
    { branch: "outlook", reason: "tracker_mail_proxy_unavailable" },
    { branch: "backend", reason: "tracker_source_capture_failed" },
    { branch: "mail_join_recovery", reason: "tracker_alias_group_changed" },
    { branch: "contacts", reason: "tracker_source_capture_failed" },
  ]);
});

test("private error fields and attacker-chosen tracker-looking codes never reach logs", async () => {
  const marker = "private@example.test https://private.invalid/token Bearer secret-player-id";
  const hostile = { code: "tracker_private_provider_secret", message: marker, stack: marker, body: marker, url: marker };
  const known = { code: "tracker_graph_throttled" };
  for (const key of ["message", "stack", "body", "url", "cause", "toJSON"]) Object.defineProperty(known, key, {
    get() { throw new Error(`Private ${key} must never be read`); },
  });
  const f = fixture({ outlook: async () => { throw hostile; }, backend: async () => { throw known; },
    mail_join_recovery: async () => { throw marker; }, contacts: reject(`tracker_${marker}`) });
  await assert.rejects(f.handler(), generic);
  const serialized = JSON.stringify(f.logs);
  assert.equal(serialized.includes(marker), false); assert.equal(serialized.includes(hostile.code), false);
  assert.equal(f.logs.length, 4);
  assert.deepEqual(plain(f.logs).map(([, value]) => value.reason), [
    "tracker_source_capture_failed", "tracker_graph_throttled", "tracker_source_capture_failed", "tracker_source_capture_failed",
  ]);
});

test("unreadable or nonstring error codes cannot suppress the aggregate failure", async () => {
  const accessor = Object.defineProperty({}, "code", { get() { throw new Error("Private accessor"); } });
  const boxed = { code: new String("tracker_graph_throttled") };
  const f = fixture({ outlook: async () => { throw accessor; }, backend: async () => { throw boxed; } });
  await assert.rejects(f.handler(), generic);
  assert.deepEqual(plain(f.logs).map(([, value]) => value.reason), ["tracker_source_capture_failed", "tracker_source_capture_failed"]);
});

test("a rejected branch does not short-circuit still-running independent branches", async () => {
  let finish, finished = false;
  const pending = new Promise(resolve => { finish = () => { finished = true; resolve({ complete: true }); }; });
  const f = fixture({ outlook: reject("tracker_graph_access_denied"), backend: () => pending });
  const running = f.handler();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.calls, ["outlook", "backend", "mail_join_recovery", "contacts"]);
  assert.deepEqual(f.logs, []); assert.equal(finished, false);
  finish(); await assert.rejects(running, generic); assert.equal(finished, true); assert.equal(f.logs.length, 1);
});

test("a logging failure cannot replace the generic retry error or hide later branch attempts", async () => {
  const attempts = [];
  const f = fixture({ outlook: reject("tracker_graph_access_denied"), backend: reject("tracker_capture_configuration_changed") }, {
    error: (...args) => { attempts.push(args); if (attempts.length === 1) throw new Error("Logger unavailable"); },
  });
  await assert.rejects(f.handler(), generic);
  assert.deepEqual(plain(attempts).map(([, value]) => value.branch), ["outlook", "backend"]);
  assert.deepEqual(f.sideEffects, []);
});
