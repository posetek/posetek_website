"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../.."), PRIVATE = path.join(ROOT, ".netlify");
const NAMES = ["issue-tracker-bridge.js", "issue-tracker-bridge-model.js", "issue-tracker-bridge-seed.js", "issue-tracker-bridge-transport.js", "issue-tracker-bridge-ingress.js", "issue-tracker-bridge-entrypoints.js", "issue-tracker-recovery.js", "issue-tracker-normalize.js", "issue-tracker-graph-reader.js", "issue-tracker-mail-read-proxy.js", "issue-tracker-mail-identity.js", "issue-tracker-mail-identity-proxy.js", "issue-tracker-mail-classification.js", "issue-tracker-evidence.js", "issue-tracker-mail-capture.js", "issue-tracker-source-capture.js", "user-issue-contacts.js", "user-issue-classification.js", "microsoft-email-model.js", "user-issue-model.js", "package.json", "package-lock.json"];
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function fixture(t, transform = value => value) {
  fs.mkdirSync(PRIVATE, { recursive: true });
  const root = fs.mkdtempSync(path.join(PRIVATE, "mail-identity-prepare-test-"));
  const deployment = path.join(root, "deployments", "issue-tracker");
  fs.mkdirSync(deployment, { recursive: true }); fs.mkdirSync(path.join(root, "functions"));
  fs.copyFileSync(path.join(__dirname, "prepare.cjs"), path.join(deployment, "prepare.cjs"));
  fs.writeFileSync(path.join(deployment, "index.js"), transform(fs.readFileSync(path.join(__dirname, "index.js"), "utf8")));
  for (const name of NAMES) fs.copyFileSync(path.join(ROOT, "functions", name), path.join(root, "functions", name));
  t.after(() => {
    const target = path.resolve(root);
    assert.ok(target.startsWith(PRIVATE + path.sep) && !fs.lstatSync(target).isSymbolicLink());
    fs.rmSync(target, { recursive: true, force: false });
  });
  const output = path.join(root, ".netlify", "candidate");
  return { root, output, run: target => spawnSync(process.execPath, [path.join(deployment, "prepare.cjs"), target || output], { encoding: "utf8" }) };
}
test("candidate enables identity capability and preserves the exact isolated source and runtime profile", t => {
  const f = fixture(t), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.output, "candidate-manifest.json")));
  assert.equal(manifest.candidateOnly, true); assert.equal(manifest.deployed, false); assert.equal(manifest.mailIdentityEnabled, true);
  assert.deepEqual(manifest.endpoints, ["observeUserIssueTracker", "observeUserIssueTrackerOccurrence", "drainUserIssueTracker", "ingestUserIssueTrackerMail", "recoverUserIssueTracker", "captureUserIssueTrackerSources"]);
  assert.deepEqual(Object.keys(manifest.files).sort(), [...NAMES, "index.js"].sort());
  for (const name of NAMES) {
    const original = fs.readFileSync(path.join(ROOT, "functions", name)), packaged = fs.readFileSync(path.join(f.output, "source", name));
    assert.deepEqual(packaged, original); assert.equal(manifest.files[name], hash(original));
  }
  const entrypoint = fs.readFileSync(path.join(f.output, "source", "index.js"));
  assert.deepEqual(entrypoint, fs.readFileSync(path.join(__dirname, "index.js"))); assert.equal(manifest.files["index.js"], hash(entrypoint));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output, "firebase.json"))), { functions: { source: "source", codebase: "issue-tracker", runtime: "nodejs22" } });
});
test("disabled, absent, string or ambiguous capability flags refuse before writing a candidate", t => {
  for (const replacement of ["false", "\"true\"", "true;\nconst mailIdentityEnabled = true", "true;\nconst mailIdentityEnabled = false"]) {
    const f = fixture(t, text => text.replace("const mailIdentityEnabled = true;", `const mailIdentityEnabled = ${replacement};`));
    const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /explicit enabled mail-identity capability flag/);
    assert.equal(fs.existsSync(f.output), false);
  }
  const f = fixture(t, text => text.replace("const mailIdentityEnabled = true;", ""));
  assert.notEqual(f.run().status, 0); assert.equal(fs.existsSync(f.output), false);
});
test("the explicit capability guard accepts a Windows CRLF checkout without changing source bytes", t => {
  const f = fixture(t, text => text.replace(/\r?\n/g, "\r\n"));
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const expected = fs.readFileSync(path.join(f.root, "deployments", "issue-tracker", "index.js"));
  assert.deepEqual(fs.readFileSync(path.join(f.output, "source", "index.js")), expected);
});
test("packaging rejects an output outside ignored storage and refuses candidate overwrite", t => {
  const f = fixture(t), outside = path.join(f.root, "public-candidate");
  assert.notEqual(f.run(outside).status, 0); assert.equal(fs.existsSync(outside), false);
  assert.equal(f.run().status, 0);
  const manifestPath = path.join(f.output, "candidate-manifest.json"), before = fs.readFileSync(manifestPath);
  const replay = f.run(); assert.notEqual(replay.status, 0); assert.match(replay.stderr, /Candidate directory already exists/);
  assert.deepEqual(fs.readFileSync(manifestPath), before);
});
