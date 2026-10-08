"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const pinnedRoot = path.join(repositoryRoot, "functions/contracts/device-performance-v1");
const manifestPath = path.join(__dirname, "mobile-contract-source.json");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function filesUnder(root, prefix = "") {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Symlink in contract: ${name}`);
    if (entry.isDirectory()) return filesUnder(root, name);
    assert.ok(entry.isFile(), `Non-file in contract: ${name}`);
    return [name];
  }).sort();
}

function verify({ artifactRoot, manifest = manifestPath, pinned = pinnedRoot }) {
  assert.ok(artifactRoot, "MOBILE_CONTRACT_ARTIFACT is required");
  const source = JSON.parse(fs.readFileSync(manifest, "utf8"));
  assert.deepEqual(Object.keys(source).sort(), ["repository", "sha"]);
  assert.equal(source.repository, "posetek/posetek-mobile-app");
  assert.match(source.sha, /^[0-9a-f]{40}$/);
  const mobile = path.join(artifactRoot, "tools/contracts/device-performance-v1");
  for (const component of [artifactRoot, path.join(artifactRoot, "tools"), path.join(artifactRoot, "tools/contracts"), mobile]) {
    assert.ok(fs.statSync(component).isDirectory() && !fs.lstatSync(component).isSymbolicLink(), `Unsafe artifact directory: ${component}`);
  }
  const receipt = path.join(artifactRoot, "source-sha.txt");
  assert.ok(fs.lstatSync(receipt).isFile(), "Artifact revision receipt must be a regular file");
  assert.equal(fs.readFileSync(receipt, "utf8"), source.sha + "\n", "artifact revision differs from reviewed pin");
  const mobileFiles = filesUnder(mobile);
  assert.ok(mobileFiles.includes("schema.json") && mobileFiles.some((file) => file.startsWith(`fixtures${path.sep}`)), "artifact lacks schema or fixtures");
  assert.ok(mobileFiles.every((file) => file === "schema.json" || (path.dirname(file) === "fixtures" && file.endsWith(".json"))), "artifact includes unexpected files");
  const pinnedFiles = filesUnder(pinned).filter((file) => file === "schema.json" || file.startsWith(`fixtures${path.sep}`));
  assert.deepEqual(mobileFiles, pinnedFiles, "mobile and website contract file lists differ");
  for (const file of pinnedFiles) assert.equal(sha256(path.join(mobile, file)), sha256(path.join(pinned, file)), `${file} differs from canonical mobile`);
  return { repository: source.repository, sha: source.sha, files: pinnedFiles.length };
}

if (require.main === module) {
  const result = verify({ artifactRoot: process.env.MOBILE_CONTRACT_ARTIFACT });
  process.stdout.write(JSON.stringify(result) + "\n");
}

module.exports = { verify };
