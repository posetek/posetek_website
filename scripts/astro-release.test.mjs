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
