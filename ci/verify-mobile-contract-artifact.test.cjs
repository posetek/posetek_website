"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { verify } = require("./verify-mobile-contract-artifact.cjs");

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "posetek-mobile-artifact-"));
  const artifactRoot = path.join(root, "artifact");
  const pinned = path.join(root, "pinned");
  const manifest = path.join(root, "manifest.json");
  const sha = "a".repeat(40);
  const put = (base, file, value) => {
    const target = path.join(base, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  const mobile = path.join(artifactRoot, "tools/contracts/device-performance-v1");
  try {
    fs.writeFileSync(manifest, JSON.stringify({ repository: "posetek/posetek-mobile-app", sha }));
    put(artifactRoot, "source-sha.txt", sha + "\n");
    for (const [file, value] of [["schema.json", "{}"], ["fixtures/one.json", '{"ok":true}']]) {
      put(mobile, file, value);
      put(pinned, file, value);
    }
    run({ artifactRoot, mobile, pinned, manifest, put, sha });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("accepts the exact reviewed revision and matching contract bytes", () => fixture(options => {
  assert.deepEqual(verify(options), { repository: "posetek/posetek-mobile-app", sha: options.sha, files: 2 });
}));

test("absent source, receipt or changed revision fails closed", () => fixture(options => {
  assert.throws(() => verify({ ...options, artifactRoot: "" }), /MOBILE_CONTRACT_ARTIFACT/);
  fs.unlinkSync(path.join(options.artifactRoot, "source-sha.txt"));
  assert.throws(() => verify(options), /ENOENT/);
  options.put(options.artifactRoot, "source-sha.txt", "b".repeat(40) + "\n");
  assert.throws(() => verify(options), /revision differs/);
}));

test("changed, added or missing fixture bytes cannot pass parity", () => fixture(options => {
  options.put(options.mobile, "fixtures/one.json", '{"ok":false}');
  assert.throws(() => verify(options), /differs from canonical mobile/);
  options.put(options.mobile, "fixtures/one.json", '{"ok":true}');
  options.put(options.mobile, "fixtures/two.json", "{}");
  assert.throws(() => verify(options), /file lists differ/);
  fs.unlinkSync(path.join(options.mobile, "fixtures/two.json"));
  fs.unlinkSync(path.join(options.mobile, "fixtures/one.json"));
  assert.throws(() => verify(options), /lacks schema or fixtures/);
}));

test("unexpected files and symlinked paths cannot escape the contract", () => fixture(options => {
  options.put(options.mobile, "fixtures/unexpected.txt", "no");
  assert.throws(() => verify(options), /unexpected files/);
  fs.unlinkSync(path.join(options.mobile, "fixtures/unexpected.txt"));
  fs.symlinkSync(path.join(options.pinned, "schema.json"), path.join(options.mobile, "fixtures/linked.json"));
  assert.throws(() => verify(options), /Symlink in contract/);
}));

test("a symlinked source receipt is rejected", () => fixture(options => {
  const receipt = path.join(options.artifactRoot, "source-sha.txt");
  fs.unlinkSync(receipt);
  fs.symlinkSync(options.manifest, receipt);
  assert.throws(() => verify(options), /regular file/);
}));
