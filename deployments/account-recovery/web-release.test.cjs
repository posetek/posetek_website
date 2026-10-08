"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const W = require("./web-release.cjs");
const PREVIOUS = "a".repeat(24), CANDIDATE = "b".repeat(24), sha = bytes => crypto.createHash("sha1").update(bytes).digest("hex");
const CONFIG = '[build]\npublish = "OLD"\n[[redirects]]\nfrom = "/*"\nto = "/application.html"\nstatus = 200\n[[headers]]\nfor = "/*.html"\n[headers.values]\nCache-Control = "no-store"\n';
async function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "posetek-recovery-web-")), run = path.join(root, ".netlify/release"), output = path.join(root, "production-dist");
  fs.mkdirSync(run, { recursive: true }); fs.mkdirSync(output);
  const beforeBytes = new Map([...W.PUBLIC_FILES, "/application.html", "/_astro/old.js"].map(name => [name, Buffer.from("original:" + name)]));
  beforeBytes.set("/netlify.toml", Buffer.from(CONFIG));
  const candidateBytes = new Map(beforeBytes); candidateBytes.set("/application.html", Buffer.from("reviewed application")); candidateBytes.set("/_astro/new.js", Buffer.from("new recovery asset")); candidateBytes.set("/netlify.toml", Buffer.from(CONFIG.replace('"OLD"', '"NEW"')));
  const records = (files, id) => [...files].map(([name, bytes]) => ({ path: name, sha: sha(bytes), size: bytes.length, site_id: W.SITE, deploy_id: id }));
  for (const [name, bytes] of candidateBytes) if (name !== "/netlify.toml") { const filename = path.join(output, name.slice(1)); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); }
  for (const name of W.PUBLIC_FILES.slice(0, 3)) { const filename = path.join(run, "approved-public", name.slice(1)); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, beforeBytes.get(name)); }
  const before = records(beforeBytes, PREVIOUS), baselineBytes = Buffer.from(JSON.stringify({ deploymentId: PREVIOUS, platformConfig: before.find(row => row.path === "/netlify.toml"), files: before.filter(row => row.path !== "/netlify.toml") }));
  const preflight = { previousDeploymentId: PREVIOUS, checkedAt: "2026-10-08T00:00:00Z", providerFiles: before.length, served: [{ path: "/", sha: sha(beforeBytes.get("/index.html")) }] };
  fs.writeFileSync(path.join(run, "before-inventory.json"), JSON.stringify(before)); fs.writeFileSync(path.join(run, "preflight.json"), JSON.stringify(preflight));
  let published = PREVIOUS, posts = 0, failRestore = false;
  const api = async (route, options = {}) => {
    if (route === `/sites/${W.SITE}`) return { published_deploy: { id: published } };
    if (route === `/deploys/${CANDIDATE}`) return { id: CANDIDATE, site_id: W.SITE, state: "ready", created_at: "2026-10-08T00:01:00Z" };
    if (route === `/deploys/${CANDIDATE}/files`) return records(candidateBytes, CANDIDATE);
    if (route === `/sites/${W.SITE}/deploys/${CANDIDATE}/restore` && options.method === "POST") { posts++; published = CANDIDATE; if (failRestore) throw Error("lost response"); return { id: CANDIDATE }; }
    const match = /^\/deploys\/([ab]{24})\/files\/(.+)$/.exec(route);
    if (match && options.raw) return (match[1] === PREVIOUS ? beforeBytes : candidateBytes).get("/" + match[2].split("/").map(decodeURIComponent).join("/"));
    throw Error("Unexpected API operation");
  };
  const fetchServed = async (origin, route) => {
    const files = origin.includes(PREVIOUS) ? beforeBytes : candidateBytes, name = route === "/" ? "/index.html" : W.APP_ROUTES.includes(route) ? "/application.html" : route.startsWith("/feedback") ? "/feedback.html" : route;
    const bytes = [...files.entries()].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    assert.ok(bytes, "route fixture exists");
    return { sha: sha(bytes), size: bytes.length, finalPath: route, headers: { "cache-control": "no-store", "content-security-policy": null, "referrer-policy": null, "x-content-type-options": null, "x-frame-options": null } };
  };
  const args = mode => ({ mode, runDir: ".netlify/release", deploymentId: CANDIDATE });
  const deps = { root, api, fetchServed, baselineBytes };
  const evidence = audit => { const filename = path.join(root, ".netlify/browser.json"); fs.writeFileSync(filename, JSON.stringify({ accepted: true, deploymentId: CANDIDATE, artifactDigest: audit.localInventorySha256, checks: 8, failed: 0, checkedAt: "2026-10-08T00:03:00Z", origin: `https://${CANDIDATE}--posetek.netlify.app` })); return ".netlify/browser.json"; };
  try { await callback({ root, run, output, beforeBytes, candidateBytes, before, args, deps, evidence, posts: () => posts, setPublished: id => { published = id; }, loseRestoreResponse: () => { failRestore = true; } }); }
  finally { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith("posetek-recovery-web-")); fs.rmSync(root, { recursive: true, force: true }); }
}

test("explicit modes require exact candidate and browser evidence for promotion", () => {
  assert.equal(W.argumentsFor(["verify-draft", "--run-dir", ".netlify/private", "--deployment-id", CANDIDATE]).mode, "verify-draft");
  assert.throws(() => W.argumentsFor(["promote", "--run-dir", ".netlify/private", "--deployment-id", CANDIDATE]), /browser evidence/);
  assert.throws(() => W.argumentsFor(["verify-draft", "--run-dir", ".netlify/private", "--deployment-id", "bad"]), /exact deployment/);
});
test("complete draft inventory, approved bytes and effective routes are verified with zero mutations", async () => fixture(async f => {
  const audit = await W.runMode(f.args("verify-draft"), f.deps);
  assert.equal(audit.accepted, true); assert.equal(audit.addedFiles, 1); assert.equal(audit.publicFilesByteVerified, 7); assert.equal(f.posts(), 0);
  assert.ok(fs.existsSync(path.join(f.run, "draft-audit.json"))); assert.ok(fs.existsSync(path.join(f.run, "candidate-inventory.json")));
}));
test("extra, missing or changed local files prevent acceptance", async () => {
  for (const mutation of [f => fs.writeFileSync(path.join(f.output, "extra.txt"), "unreviewed"), f => fs.unlinkSync(path.join(f.output, "favicon.ico")), f => fs.writeFileSync(path.join(f.output, "application.html"), "changed")]) await fixture(async f => { mutation(f); await assert.rejects(W.runMode(f.args("verify-draft"), f.deps), /complete provider inventory/); assert.equal(f.posts(), 0); });
});
test("case collision, wrong provider ownership and path traversal are rejected", () => {
  const row = { path: "/one", sha: "a".repeat(40), size: 1, deploy_id: CANDIDATE, site_id: W.SITE };
  assert.throws(() => W.normalizeInventory([row, { ...row, path: "/ONE" }], CANDIDATE), /Duplicate/);
  assert.throws(() => W.normalizeInventory([{ ...row, site_id: "wrong" }], CANDIDATE), /binding/);
  assert.throws(() => W.normalizeInventory([{ ...row, path: "/../secret" }], CANDIDATE), /Invalid inventory/);
});
test("predecessor assets cannot change even when the local and provider candidate agree", async () => fixture(async f => {
  f.candidateBytes.set("/_astro/old.js", Buffer.from("changed predecessor")); fs.writeFileSync(path.join(f.output, "_astro/old.js"), f.candidateBytes.get("/_astro/old.js"));
  await assert.rejects(W.runMode(f.args("verify-draft"), f.deps), /preserved predecessor/); assert.equal(f.posts(), 0);
}));
test("generated build paths may differ while redirects and headers must retain exact semantics", async () => fixture(async f => {
  f.candidateBytes.set("/netlify.toml", Buffer.from(CONFIG.replace('"OLD"', '"NEW"').replace('"/application.html"', '"/wrong.html"')));
  await assert.rejects(W.runMode(f.args("verify-draft"), f.deps), /Effective redirects or headers/); assert.equal(f.posts(), 0);
}));
test("fresh captured public documents and served marketing cannot drift", async () => {
  await fixture(async f => { fs.writeFileSync(path.join(f.run, "approved-public/feedback.html"), "modified capture"); await assert.rejects(W.runMode(f.args("verify-draft"), f.deps), /captured approved public/); });
  await fixture(async f => { const old = f.deps.fetchServed; f.deps.fetchServed = async (origin, route) => ({ ...await old(origin, route), ...(route === "/" ? { sha: "a".repeat(40) } : {}) }); await assert.rejects(W.runMode(f.args("verify-draft"), f.deps), /served marketing/); });
});
test("browser evidence binds deployment, artifact, immutable origin and zero failures", () => {
  const good = { accepted: true, deploymentId: CANDIDATE, artifactDigest: "digest", checks: 1, failed: 0, checkedAt: "2026-10-08", origin: `https://${CANDIDATE}--posetek.netlify.app` };
  for (const change of [{ accepted: false }, { deploymentId: PREVIOUS }, { artifactDigest: "wrong" }, { checks: 0 }, { failed: 1 }, { origin: "https://posetek.net" }]) assert.throws(() => W.browserEvidence({ ...good, ...change }, CANDIDATE, "digest"), /Browser acceptance/);
});
test("promotion only restores the accepted explicit candidate after a write-ahead receipt", async () => fixture(async f => {
  const audit = await W.runMode(f.args("verify-draft"), f.deps), browserEvidence = f.evidence(audit);
  const receipt = await W.runMode({ ...f.args("promote"), browserEvidence }, f.deps);
  assert.equal(receipt.status, "published_verified"); assert.equal(f.posts(), 1); assert.equal(JSON.parse(fs.readFileSync(path.join(f.run, "promotion-intent.json"))).deploymentId, CANDIDATE);
  await W.runMode(f.args("verify-production"), f.deps); assert.equal(f.posts(), 1);
}));
test("accepted local artifact changes and concurrent production changes prevent restore", async () => {
  await fixture(async f => { const audit = await W.runMode(f.args("verify-draft"), f.deps); const browserEvidence = f.evidence(audit); fs.writeFileSync(path.join(f.output, "application.html"), "changed after browser acceptance"); await assert.rejects(W.runMode({ ...f.args("promote"), browserEvidence }, f.deps), /changed after acceptance/); assert.equal(f.posts(), 0); });
  await fixture(async f => { const audit = await W.runMode(f.args("verify-draft"), f.deps); f.setPublished("c".repeat(24)); await assert.rejects(W.runMode({ ...f.args("promote"), browserEvidence: f.evidence(audit) }, f.deps), /expected committed baseline/); assert.equal(f.posts(), 0); });
});
test("a lost restore response is reconciled by readback without repeating the mutation", async () => fixture(async f => {
  const audit = await W.runMode(f.args("verify-draft"), f.deps); f.loseRestoreResponse();
  const options = { ...f.args("promote"), browserEvidence: f.evidence(audit) };
  const receipt = await W.runMode(options, f.deps); assert.equal(receipt.status, "published_verified"); assert.equal(f.posts(), 1);
  await W.runMode(options, f.deps); assert.equal(f.posts(), 1);
}));
test("an unresolved write-ahead record cannot blindly replay promotion", async () => fixture(async f => {
  const audit = await W.runMode(f.args("verify-draft"), f.deps); fs.writeFileSync(path.join(f.run, "promotion-intent.json"), "{}");
  await assert.rejects(W.runMode({ ...f.args("promote"), browserEvidence: f.evidence(audit) }, f.deps), /outcome is unresolved/); assert.equal(f.posts(), 0);
}));
test("case-only CLI normalization preserves the source digest and verifies source and provider asset URLs", async () => fixture(async f => {
  const name = "/_astro/Recovery.MixedCase.js", bytes = Buffer.from("reviewed mixed-case asset");
  f.candidateBytes.delete("/_astro/new.js"); f.candidateBytes.set(name, bytes);
  fs.unlinkSync(path.join(f.output, "_astro/new.js")); fs.writeFileSync(path.join(f.output, name.slice(1)), bytes);
  const api = f.deps.api;
  f.deps.api = async (...args) => { const value = await api(...args); return args[0] === `/deploys/${CANDIDATE}/files` ? value.map(row => ({ ...row, path: row.path.toLowerCase() })) : value; };
  const audit = await W.runMode(f.args("verify-draft"), f.deps);
  assert.equal(audit.checkedNewAssetUrls, 2);
  const local = JSON.parse(fs.readFileSync(path.join(f.run, "local-inventory.json"))); assert.ok(local.some(row => row.path === name));
  const routes = JSON.parse(fs.readFileSync(path.join(f.run, "candidate-asset-route-audit.json"))); assert.deepEqual(routes.map(row => row.path), [name, name.toLowerCase()]);
}));
test("new normalized asset URLs must return the exact asset rather than application fallback", async () => fixture(async f => {
  const read = f.deps.fetchServed;
  f.deps.fetchServed = async (origin, route) => read(origin, route === "/_astro/new.js" ? "/application.html" : route);
  await assert.rejects(W.runMode(f.args("verify-draft"), f.deps), /asset URL/); assert.equal(f.posts(), 0);
}));
test("case-normalized matching does not allow ambiguous local or provider inventories", () => {
  const one = { path: "/One.js", sha: "a".repeat(40), size: 1 }, two = { ...one, path: "/one.js" };
  assert.throws(() => W.compareArtifact([one, two], [one, two], "/netlify.toml"), /Case-colliding/);
});
