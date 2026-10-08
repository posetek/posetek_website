"use strict";
// Explicit cross-repository lane. A missing canonical source is a failure.
// This file deliberately does not match the self-contained *.test.js CI glob.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const PINNED = path.join(__dirname, "contracts", "device-performance-v1");
const FRONTEND = path.join(__dirname, "..", "app", "src", "pages", "admin", "lib", "__fixtures__", "device-performance-v1");
const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function listFiles(root, prefix = "") {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => (entry.isDirectory() ? listFiles(root, path.join(prefix, entry.name)) : [path.join(prefix, entry.name)]))
    .sort();
}
// The pin covers the executable contract only: schema.json and fixtures/**.
// README.md is refreshed by copy but never hashed, so a prose-only change on
// mobile never fails this repository (decision D-2026-09-29-24, as D-20 F2).
function pinnedContractFiles(root) {
  return listFiles(root).filter((file) => file === "schema.json" || file.startsWith(`fixtures${path.sep}`));
}

test("the pinned copy is byte-identical to the canonical mobile contract (schema.json and fixtures only)", () => {
  const repo = process.env.POSETEK_MOBILE_REPO || path.resolve(__dirname, "..", "..", "PoseTek-mobile-app");
  const canonical = path.join(repo, "tools", "contracts", "device-performance-v1");
  if (!fs.existsSync(path.join(canonical, "schema.json"))) {
    assert.fail(`Canonical device-performance contract not found at ${canonical}. Check out PoseTek-mobile-app beside `
      + "this repository or set POSETEK_MOBILE_REPO. The pinned copy cannot be verified without it, so this test fails rather than skips.");
  }
  const pinned = pinnedContractFiles(PINNED);
  assert.ok(pinned.includes("schema.json") && pinned.some((file) => file.startsWith(`fixtures${path.sep}`)), "the pin covers the schema and fixtures");
  assert.ok(!pinned.includes("README.md"), "README.md is never hashed");
  assert.deepEqual(pinned, pinnedContractFiles(canonical), "the pinned and canonical directories hold the same schema and fixtures");
  for (const file of pinned) {
    assert.equal(sha256File(path.join(PINNED, file)), sha256File(path.join(canonical, file)), `${file} differs from the canonical copy`);
  }
});

test("the frontend schema and fixtures match canonical mobile bytes and the pinned digest table", () => {
  const repo = process.env.POSETEK_MOBILE_REPO || path.resolve(__dirname, "..", "..", "PoseTek-mobile-app");
  const canonical = path.join(repo, "tools", "contracts", "device-performance-v1");
  if (!fs.existsSync(path.join(canonical, "schema.json"))) {
    assert.fail(`Canonical device-performance contract not found at ${canonical}. Set POSETEK_MOBILE_REPO to the reviewed source; frontend parity fails rather than skips.`);
  }
  const files = pinnedContractFiles(canonical);
  assert.deepEqual(pinnedContractFiles(FRONTEND), files, "frontend schema and fixture names match canonical source");
  for (const file of files) {
    assert.equal(sha256File(path.join(FRONTEND, file)), sha256File(path.join(canonical, file)), `${file} differs in frontend copy`);
  }
  // The source artifact intentionally excludes private prose. The local pinned
  // README's digest table still guards the frontend copy's executable bytes.
  const readme = fs.readFileSync(path.join(PINNED, "README.md"), "utf8");
  const digests = [...readme.matchAll(/^\| `([^`]+\.json)` \| `([0-9a-f]{64})` \|$/gm)];
  assert.ok(digests.length >= 19, "pinned digest table covers the contract files");
  for (const [, file, digest] of digests) {
    assert.equal(sha256File(path.join(FRONTEND, file)), digest, `${file} differs from pinned digest`);
  }
});
