"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
function files(name, inherited = []) {
  const source = fs.readFileSync(path.join(ROOT, "deployments", name, "prepare.py"), "utf8");
  const tuple = source.match(/^FILES\s*=\s*\(([\s\S]*?)\)/m)?.[1];
  assert.ok(tuple, `Missing source manifest: ${name}`);
  return new Set([...inherited, ...[...tuple.matchAll(/'([^']+)'/g)].map(match => match[1])]);
}
function closure(manifest) {
  for (const name of manifest) {
    if (!name.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    for (const match of source.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)) {
      const dependency = match[1].slice(2) + ".js";
      assert.ok(manifest.has(dependency), `${name} requires ${dependency}, omitted from deployment manifest`);
    }
  }
}
test("user-issue, workout and inherited Microsoft deploy packages include full local runtime dependency closure", () => {
  const workout = files("workout-notifications"), issue = files("user-issues"), microsoft = files("microsoft-email", workout);
  for (const manifest of [workout, issue, microsoft]) {
    for (const dependency of ["user-issue-classification.js", "user-issue-summary.js", "user-issue-observations.js", "user-issue-request-identity.js"]) assert.ok(manifest.has(dependency));
    closure(manifest);
  }
});
