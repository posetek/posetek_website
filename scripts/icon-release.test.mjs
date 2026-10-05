import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { composeIconRelease } from "./build-icon-release.mjs";
import { sha1 } from "./astro-assets.mjs";
import { updateIconLinks, ICON_ASSETS } from "./website-icons.mjs";

const page = (label, marker = "") => `<!doctype html><html><head><meta charset="UTF-8"><title>${label}</title><link rel="icon" type="image/svg+xml" href="/images/logo.svg"><link rel="stylesheet" href="https://example.com/style.css"></head><body>${marker}<div id="root">${label}</div><link rel="icon" href="/body-link-must-stay.svg"><script src="/_astro/existing.12345678.js"></script><script>window.record = '<link rel="icon" href="/literal-must-stay.svg">';</script></body></html>`;

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "posetek-icon-release-"));
  const put = async (path, value) => { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
  const files = new Map([
    ["/application.html", page("Reviewed application")],
    ["/booking 2.html", page("Reviewed booking alias")],
    ["/feedback.html", page("Reviewed isolated feedback")],
    ["/_astro/existing.12345678.js", "reviewed runtime bytes"],
    ["/assets/settings.json", '{"unchanged":true}'],
    ["/favicon.svg", "historical unrelated icon retained"],
    ["/images/logo.svg", "historical wordmark retained"],
  ]);
  const baseline = { deploymentId: "verified-current", files: [...files].map(([path, bytes]) => ({ path, sha: sha1(bytes), size: Buffer.byteLength(bytes) })) };
  for (const [path, bytes] of files) await put("production-dist" + path, bytes);
  await put("deployment/homepage-baseline.json", JSON.stringify(baseline));
  for (const path of ICON_ASSETS) await put("production-dist" + path, "reviewed new icon " + path);
  const html = [page("Approved Players", "<!-- posetek-marketing-entry -->"), page("Approved Coaches", "<!-- posetek-coaches-entry -->")];
  const paths = ["/index.html", "/coaches/index.html"];
  for (const [index, path] of paths.entries()) {
    await put(".netlify/approved-marketing" + path, html[index]);
    await put("production-dist" + path, page("Unneeded newly compiled marketing " + index));
  }
  await put("production-dist/_astro/new.87654321.js", "unneeded newly compiled runtime");
  const manifest = { deploymentId: "current-marketing", sourceDirectory: join(root, ".netlify/approved-marketing"),
    files: paths.map((path, index) => ({ path, sha: sha1(html[index]), size: Buffer.byteLength(html[index]) })),
    served: [{ path: "/", sha: sha1(html[0]) }, { path: "/coaches", sha: sha1(html[1]) }] };
  const marketingSnapshot = join(root, ".netlify/approved-marketing-manifest.json");
  const saveManifest = async () => put(".netlify/approved-marketing-manifest.json", JSON.stringify(manifest));
  await saveManifest();
  const fetchImpl = async url => ({ ok: true, arrayBuffer: async () => Buffer.from(html[url.endsWith("/coaches") ? 1 : 0]) });
  try { await run({ root, put, files, baseline, html, manifest, marketingSnapshot, fetchImpl, saveManifest }); }
  finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.ok(basename(root).startsWith("posetek-icon-release-"));
    await rm(root, { recursive: true, force: true });
  }
}

async function artifactPaths(root, prefix = "") {
  const paths = [];
  for (const entry of await readdir(join(root, "production-dist" + prefix), { withFileTypes: true })) {
    const path = prefix + "/" + entry.name;
    if (entry.isDirectory()) paths.push(...await artifactPaths(root, path)); else paths.push(path);
  }
  return paths.sort();
}

test("icon release changes only document-head icon links and retains the complete reviewed artifact", async () => fixture(async context => {
  const { root, files, html } = context;
  const receipt = await composeIconRelease(root, context);
  assert.equal(receipt.scope, "website-icons");
  assert.equal(receipt.marketingDeploymentId, "current-marketing");
  assert.equal(receipt.baselineFiles, files.size);
  assert.equal(receipt.preservedFiles, files.size - 3);
  assert.deepEqual(receipt.removedAssets.map(asset => asset.path), ["/_astro/new.87654321.js"]);
  assert.deepEqual(receipt.added.map(asset => asset.path), ICON_ASSETS);
  assert.equal(receipt.outputFiles, files.size + 2 + ICON_ASSETS.length);
  assert.deepEqual(await artifactPaths(root), [...files.keys(), "/index.html", "/coaches/index.html", ...ICON_ASSETS].sort());
  for (const [path, before] of files) {
    const after = await readFile(join(root, "production-dist" + path), "utf8");
    if (!path.endsWith(".html")) assert.equal(after, before);
    else {
      assert.equal(after, updateIconLinks(before));
      assert.equal(after.slice(after.indexOf("</head>")), before.slice(before.indexOf("</head>")));
      assert.match(after, /<title>Reviewed/);
      assert.match(after, /href="https:\/\/example.com\/style.css"/);
      assert.match(after, /href="\/body-link-must-stay.svg"/);
      assert.match(after, /literal-must-stay.svg/);
      const changed = receipt.documents.find(document => document.path === path);
      assert.equal(changed.inputSha, sha1(before)); assert.equal(changed.sha, sha1(after));
    }
  }
  for (const [index, path] of ["/index.html", "/coaches/index.html"].entries()) {
    const after = await readFile(join(root, "production-dist" + path), "utf8");
    assert.equal(after, updateIconLinks(html[index]));
    assert.equal(after.slice(after.indexOf("</head>")), html[index].slice(html[index].indexOf("</head>")));
    assert.ok(!after.includes("Unneeded newly compiled"));
    assert.equal(receipt.documents.find(document => document.path === path).inputSha, sha1(html[index]));
  }
  assert.deepEqual(JSON.parse(await readFile(join(root, ".netlify/icon-release-build.json"), "utf8")), receipt);
}));

test("icon metadata does not modify head scripts or commented markup", () => {
  const script = '<script>window.bootstrap = "<link rel=\\"icon\\" href=\\"/bootstrap.svg\\">";</script>';
  const comment = '<!-- Historical example: <link rel="icon" href="/commented-example.svg"> -->';
  const before = `<!doctype html><html><head>${script}${comment}<meta name="description" content="Keep metadata"><link rel="icon" href="/images/logo.svg"></head><body>Keep every body byte</body></html>`;
  const after = updateIconLinks(before);
  assert.ok(after.includes(script));
  assert.ok(after.includes(comment));
  assert.ok(after.includes('<meta name="description" content="Keep metadata">'));
  assert.match(after, /href="\/brand\/posetek-p-96.png"/);
  assert.equal(after.slice(after.indexOf("</head>")), before.slice(before.indexOf("</head>")));
});

test("baseline drift fails before replacing any document or deleting newly compiled assets", async () => fixture(async context => {
  await context.put("production-dist/assets/settings.json", "unexpected drift");
  await assert.rejects(composeIconRelease(context.root, context), /Baseline not verified/);
  assert.equal(await readFile(join(context.root, "production-dist/application.html"), "utf8"), context.files.get("/application.html"));
  assert.equal(await readFile(join(context.root, "production-dist/_astro/new.87654321.js"), "utf8"), "unneeded newly compiled runtime");
}));

test("approved marketing requires matching snapshot, pinned runtime assets and fresh live verification", async () => {
  for (const state of ["snapshot", "live", "unprotected-runtime", "missing-live-page", "output-overlap", "redirect"]) await fixture(async context => {
    if (state === "snapshot") await context.put(".netlify/approved-marketing/index.html", "unreviewed snapshot change");
    if (state === "live") context.fetchImpl = async () => ({ ok: true, arrayBuffer: async () => Buffer.from("changed live marketing") });
    if (state === "unprotected-runtime") {
      context.html[0] = context.html[0].replace("existing.12345678.js", "unprotected.12345678.js");
      await context.put(".netlify/approved-marketing/index.html", context.html[0]);
      Object.assign(context.manifest.files[0], { sha: sha1(context.html[0]), size: Buffer.byteLength(context.html[0]) });
    }
    if (state === "missing-live-page") context.manifest.served.pop();
    if (state === "output-overlap") context.manifest.sourceDirectory = join(context.root, "production-dist");
    if (state === "redirect") context.fetchImpl = async () => ({ ok: true, url: "https://external.example/", arrayBuffer: async () => Buffer.from(context.html[0]) });
    await context.saveManifest();
    await assert.rejects(composeIconRelease(context.root, context), /Marketing snapshot|Live marketing|Both marketing/);
    assert.equal(await readFile(join(context.root, "production-dist/application.html"), "utf8"), context.files.get("/application.html"));
    assert.equal(await readFile(join(context.root, "production-dist/index.html"), "utf8"), page("Unneeded newly compiled marketing 0"));
    assert.equal(await readFile(join(context.root, "production-dist/_astro/new.87654321.js"), "utf8"), "unneeded newly compiled runtime");
  });
});

test("composition requires the marketing manifest and rejects unrelated output or missing icons before mutation", async () => {
  for (const state of ["missing-snapshot", "unexpected-output", "missing-icon"]) await fixture(async context => {
    if (state === "missing-snapshot") delete context.marketingSnapshot;
    if (state === "unexpected-output") await context.put("production-dist/private.json", "unexpected unrelated output");
    if (state === "missing-icon") await rm(join(context.root, "production-dist" + ICON_ASSETS[0]));
    await assert.rejects(composeIconRelease(context.root, context), /requires --preserve-marketing|Unexpected icon release output|ENOENT/);
    assert.equal(await readFile(join(context.root, "production-dist/application.html"), "utf8"), context.files.get("/application.html"));
    assert.equal(await readFile(join(context.root, "production-dist/_astro/new.87654321.js"), "utf8"), "unneeded newly compiled runtime");
  });
});

test("historical aliases with spaces are supported while baseline path escapes are rejected", async () => fixture(async context => {
  context.baseline.files.push({ path: "/../external.html", sha: sha1("external"), size: 8 });
  await context.put("deployment/homepage-baseline.json", JSON.stringify(context.baseline));
  await context.put("external.html", "external");
  await assert.rejects(composeIconRelease(context.root, context), /Invalid icon release path|escapes output/);
  assert.equal(await readFile(join(context.root, "external.html"), "utf8"), "external");
  assert.equal(await readFile(join(context.root, "production-dist/booking 2.html"), "utf8"), context.files.get("/booking 2.html"));
}));

test("junctions cannot redirect protected output outside the release artifact", async () => fixture(async context => {
  const directory = resolve(context.root, "production-dist/_astro");
  assert.equal(dirname(directory), resolve(context.root, "production-dist"));
  await rm(directory, { recursive: true });
  await context.put("external/existing.12345678.js", "reviewed runtime bytes");
  await symlink(join(context.root, "external"), directory, "junction");
  await assert.rejects(composeIconRelease(context.root, context), /Symbolic links/);
  assert.equal(await readFile(join(context.root, "external/existing.12345678.js"), "utf8"), "reviewed runtime bytes");
  assert.equal(await readFile(join(context.root, "production-dist/application.html"), "utf8"), context.files.get("/application.html"));
}));
