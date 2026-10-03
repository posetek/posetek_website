import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { composeAstroRelease } from "./build-astro-release.mjs";
import { sha1, mergeAstroAssets } from "./astro-assets.mjs";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "posetek-astro-release-"));
  const put = async (path, value) => { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
  const files = new Map([
    ["/application.html", "original app"], ["/assets/old.js", "original legacy asset"],
    ["/_astro/existing.12345678.js", "previous Astro chunk"],
    ["/booking.html", "original booking"], ["/marketing/home-navigation.js", "original bridge"],
  ]);
  const baseline = { deploymentId: "verified-current", files: [...files].map(([path, bytes]) => ({ path, sha: sha1(bytes), size: Buffer.byteLength(bytes) })) };
  for (const [path, bytes] of files) await put("production-dist" + path, bytes);
  await put("deployment/homepage-baseline.json", JSON.stringify(baseline));
  const page = marker => `<!doctype html>${marker}<div id="root"><astro-island component-url="/_astro/new.87654321.js" client="only"></astro-island></div><script src="/marketing/home-navigation.js"></script>`;
  for (const [path, marker] of [["index.html", "<!-- posetek-marketing-entry -->"], ["coaches/index.html", "<!-- posetek-coaches-entry -->"], ["application.html", "<!-- posetek-astro-application-entry -->"]]) await put("app/astro-dist/" + path, page(marker));
  await put("app/astro-dist/_astro/new.87654321.js", "new Astro chunk");
  try { await run({ root, put, files, baseline }); }
  finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.ok(basename(root).startsWith("posetek-astro-release-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("full-site Astro release changes exactly three documents and preserves historical assets", async () => fixture(async ({ root, files }) => {
  const receipt = await composeAstroRelease(root);
  assert.equal(receipt.framework, "astro"); assert.equal(receipt.preservedFiles, 4);
  assert.deepEqual(receipt.documents.map(file => file.path).sort(), ["/application.html", "/coaches/index.html", "/index.html"]);
  assert.deepEqual(receipt.added.map(file => file.path), ["/_astro/new.87654321.js"]);
  for (const [path, bytes] of files) if (path !== "/application.html") assert.equal(await readFile(join(root, "production-dist" + path), "utf8"), bytes);
  assert.match(await readFile(join(root, "production-dist/application.html"), "utf8"), /client="only"/);
}));

test("Astro composition refuses baseline drift before changing its entry", async () => fixture(async ({ root, put }) => {
  await put("production-dist/booking.html", "unexpected edit");
  await assert.rejects(composeAstroRelease(root), /Baseline not verified/);
  assert.equal(await readFile(join(root, "production-dist/application.html"), "utf8"), "original app");
}));

test("Astro output is limited to the declared entries and hashed assets", async () => {
  for (const path of ["private.json", "unknown/index.html", "_astro/unhashed.js"]) await fixture(async ({ root, put }) => {
    await put("app/astro-dist/" + path, "unexpected");
    await assert.rejects(composeAstroRelease(root), /Unexpected Astro release output|Expected a hashed Astro asset/);
    assert.equal(await readFile(join(root, "production-dist/application.html"), "utf8"), "original app");
  });
});

test("Astro application cannot be server-rendered or lose the navigation bridge", async () => {
  for (const token of ['client="only"', "/marketing/home-navigation.js"]) await fixture(async ({ root, put }) => {
    const source = await readFile(join(root, "app/astro-dist/application.html"), "utf8");
    await put("app/astro-dist/application.html", source.replace(token, ""));
    await assert.rejects(composeAstroRelease(root), /Application must be one client-only root/);
  });
});

test("case-folded Astro assets never overwrite pinned bytes", async () => {
  for (const same of [true, false]) await fixture(async ({ root, put, baseline }) => {
    await put("app/astro-dist/_astro/EXISTING.12345678.js", same ? "previous Astro chunk" : "changed");
    if (same) {
      const added = await mergeAstroAssets(join(root, "app/astro-dist"), join(root, "production-dist"), baseline.files);
      assert.deepEqual(added.map(file => file.path), ["/_astro/new.87654321.js"]);
      assert.ok(!(await readdir(join(root, "production-dist/_astro"))).includes("EXISTING.12345678.js"));
    } else await assert.rejects(composeAstroRelease(root), /Astro asset collision/);
    assert.equal(await readFile(join(root, "production-dist/_astro/existing.12345678.js"), "utf8"), "previous Astro chunk");
  });
});

test("Astro release rejects generated and output junctions", async () => {
  for (const folder of ["app/astro-dist", "production-dist"]) await fixture(async ({ root, put }) => {
    const directory = join(root, folder, "_astro");
    assert.equal(dirname(directory), join(root, folder)); await rm(directory, { recursive: true });
    await put("external/new.87654321.js", "new Astro chunk");
    await symlink(join(root, "external"), directory, "junction");
    await assert.rejects(composeAstroRelease(root), /Symbolic links|Unexpected Astro release output/);
    assert.equal(await readFile(join(root, "external/new.87654321.js"), "utf8"), "new Astro chunk");
  });
});

async function marketingFixture(root, put) {
  const sourceDirectory = join(root, ".netlify/marketing-snapshot"), paths = ["/index.html", "/coaches/index.html"];
  const markers = ["<!-- posetek-marketing-entry -->", "<!-- posetek-coaches-entry -->"];
  const html = paths.map((_path, i) => `<!doctype html>${markers[i]}<div id="root">Current approved marketing ${i}</div><script src="/_astro/existing.12345678.js"></script>`);
  for (const [i, path] of paths.entries()) await put(".netlify/marketing-snapshot" + path, html[i]);
  const manifest = { deploymentId: "current-marketing", sourceDirectory, files: paths.map((path, i) => ({ path, sha: sha1(html[i]), size: Buffer.byteLength(html[i]) })),
    served: [{ path: "/", sha: sha1(html[0]) }, { path: "/coaches", sha: sha1(html[1]) }] };
  const marketingSnapshot = join(root, ".netlify/marketing-manifest.json");
  await put(".netlify/marketing-manifest.json", JSON.stringify(manifest));
  const fetchImpl = async url => ({ ok: true, arrayBuffer: async () => Buffer.from(html[url.endsWith("/coaches") ? 1 : 0]) });
  return { manifest, marketingSnapshot, fetchImpl, html };
}

test("explicit Astro application-only composition preserves both freshly verified marketing documents", async () => fixture(async ({ root, put, files }) => {
  const snapshot = await marketingFixture(root, put);
  const receipt = await composeAstroRelease(root, snapshot);
  assert.equal(receipt.marketingPreserved, true); assert.equal(receipt.marketingDeploymentId, "current-marketing");
  assert.equal(receipt.homepageSha, sha1(snapshot.html[0])); assert.equal(receipt.coachesSha, sha1(snapshot.html[1]));
  assert.equal(await readFile(join(root, "production-dist/index.html"), "utf8"), snapshot.html[0]);
  assert.equal(await readFile(join(root, "production-dist/coaches/index.html"), "utf8"), snapshot.html[1]);
  for (const [path, bytes] of files) if (path !== "/application.html") assert.equal(await readFile(join(root, "production-dist" + path), "utf8"), bytes);
  assert.match(await readFile(join(root, "production-dist/application.html"), "utf8"), /client="only"/);
}));

test("an Astro application release preserves exact legacy compiled marketing and all protected runtime assets", async () => fixture(async ({ root, put, files, baseline }) => {
  const additions = [["/marketing/assets/players-pinned.12345678.js", "approved legacy players"],
    ["/marketing/assets/coaches-pinned.12345678.js", "approved legacy coaches"], ["/marketing/assets/common.12345678.css", "approved legacy styles"]];
  for (const [path, bytes] of additions) {
    files.set(path, bytes); await put("production-dist" + path, bytes);
    baseline.files.push({ path, sha: sha1(bytes), size: Buffer.byteLength(bytes) });
  }
  await put("deployment/homepage-baseline.json", JSON.stringify(baseline));
  const snapshot = await marketingFixture(root, put);
  for (const [index, page] of ["players", "coaches"].entries()) {
    snapshot.html[index] = `<!doctype html><!-- posetek-${index ? "coaches" : "marketing"}-entry --><div id="root">Legacy approved ${page}</div><link rel="stylesheet" href="/marketing/assets/common.12345678.css"><script type="module" src="https://posetek.net/marketing/assets/${page}-pinned.12345678.js"></script><script src="/marketing/home-navigation.js" defer></script>`;
    await put(".netlify/marketing-snapshot" + snapshot.manifest.files[index].path, snapshot.html[index]);
    Object.assign(snapshot.manifest.files[index], { sha: sha1(snapshot.html[index]), size: Buffer.byteLength(snapshot.html[index]) });
    snapshot.manifest.served[index].sha = sha1(snapshot.html[index]);
  }
  await put(".netlify/marketing-manifest.json", JSON.stringify(snapshot.manifest));
  const receipt = await composeAstroRelease(root, snapshot);
  assert.equal(receipt.framework, "astro"); assert.equal(receipt.marketingPreserved, true);
  assert.equal(await readFile(join(root, "production-dist/index.html"), "utf8"), snapshot.html[0]);
  assert.equal(await readFile(join(root, "production-dist/coaches/index.html"), "utf8"), snapshot.html[1]);
  assert.match(await readFile(join(root, "production-dist/application.html"), "utf8"), /astro-island/);
  for (const [path, bytes] of files) if (path !== "/application.html") assert.equal(await readFile(join(root, "production-dist" + path), "utf8"), bytes);
}));

test("legacy marketing preservation refuses unprotected runtime scripts/styles, source entries and path escapes", async () => {
  for (const script of ["/marketing/assets/not-pinned.js", "/marketing/assets/%2e%2e/escape.js", "/marketing/assets/../escape.js", "/src/home.tsx", "/@vite/client"]) await fixture(async ({ root, put }) => {
    const snapshot = await marketingFixture(root, put);
    snapshot.html[0] = `<!doctype html><!-- posetek-marketing-entry --><div id="root"></div><script src="${script}"></script>`;
    await put(".netlify/marketing-snapshot/index.html", snapshot.html[0]);
    Object.assign(snapshot.manifest.files[0], { sha: sha1(snapshot.html[0]), size: Buffer.byteLength(snapshot.html[0]) });
    await put(".netlify/marketing-manifest.json", JSON.stringify(snapshot.manifest));
    await assert.rejects(composeAstroRelease(root, snapshot), /Marketing snapshot/);
    assert.equal(await readFile(join(root, "production-dist/application.html"), "utf8"), "original app");
  });
  await fixture(async ({ root, put }) => {
    const snapshot = await marketingFixture(root, put);
    snapshot.html[0] += '<link rel="stylesheet" href="/marketing/assets/not-pinned.css">';
    await put(".netlify/marketing-snapshot/index.html", snapshot.html[0]);
    Object.assign(snapshot.manifest.files[0], { sha: sha1(snapshot.html[0]), size: Buffer.byteLength(snapshot.html[0]) });
    await put(".netlify/marketing-manifest.json", JSON.stringify(snapshot.manifest));
    await assert.rejects(composeAstroRelease(root, snapshot), /Marketing snapshot asset/);
    assert.equal(await readFile(join(root, "production-dist/application.html"), "utf8"), "original app");
  });
});

test("marketing snapshot drift and unavailable live proof refuse before changing the application", async () => {
  for (const state of ["snapshot", "live", "redirect", "missing_asset", "extra_document", "missing_live_page", "output_overlap"]) await fixture(async ({ root, put }) => {
    const snapshot = await marketingFixture(root, put);
    if (state === "snapshot") await put(".netlify/marketing-snapshot/index.html", "changed private source");
    if (state === "live") snapshot.fetchImpl = async () => ({ ok: true, arrayBuffer: async () => Buffer.from("different live page") });
    if (state === "redirect") snapshot.fetchImpl = async () => ({ ok: true, url: "https://external.example/", arrayBuffer: async () => Buffer.from(snapshot.html[0]) });
    if (state === "missing_asset") { snapshot.html[0] = snapshot.html[0].replace("existing.12345678", "unprotected.12345678"); await put(".netlify/marketing-snapshot/index.html", snapshot.html[0]); snapshot.manifest.files[0].sha = sha1(snapshot.html[0]); snapshot.manifest.files[0].size = Buffer.byteLength(snapshot.html[0]); }
    if (state === "extra_document") snapshot.manifest.files.push({ path: "/private.json", sha: sha1("private"), size: 7 });
    if (state === "missing_live_page") snapshot.manifest.served.pop();
    if (state === "output_overlap") snapshot.manifest.sourceDirectory = join(root, "production-dist");
    await put(".netlify/marketing-manifest.json", JSON.stringify(snapshot.manifest));
    await assert.rejects(composeAstroRelease(root, snapshot), /Marketing snapshot|Live marketing|marketing snapshot|Both marketing/);
    assert.equal(await readFile(join(root, "production-dist/application.html"), "utf8"), "original app");
  });
});
