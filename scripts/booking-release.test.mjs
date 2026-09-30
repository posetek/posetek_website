import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { composeBookingRelease, verifyBookingRelease } from "./build-booking-release.mjs";
import { sha1 } from "./astro-assets.mjs";

const source = '<!doctype html><!-- posetek-booking-entry --><html><body>Updated booking</body></html>';
async function fixture(run) {
  const root = await mkdtemp(join(resolve(tmpdir()), "posetek-booking-release-"));
  const put = async (path, value) => { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
  const files = new Map([
    ["/application.html", "current application"], ["/assets/current.js", "preserved app chunk"],
    ["/bookperformancetest.html", "old booking"], ["/bookperformancetest 3.html", "old booking"],
    ["/marketing/home-navigation.js", "preserved bridge"],
  ]);
  const baseline = { deploymentId: "current-deployment", applicationPath: "/application.html",
    files: [...files].map(([path, bytes]) => ({ path, sha: sha1(bytes), size: Buffer.byteLength(bytes) })) };
  for (const [path, bytes] of files) await put("production-dist" + path, bytes);
  await put("production-dist/index.html", "<!-- posetek-marketing-entry -->Current players");
  await put("production-dist/coaches/index.html", "<!-- posetek-coaches-entry -->Current coaches");
  await put("production-dist/_astro/marketing.12345678.js", "preserved marketing chunk");
  await put("deployment/homepage-baseline.json", JSON.stringify(baseline));
  await put("bookPerformanceTest.html", source);
  const fetchImpl = async url => { assert.equal(url, "https://posetek.net/application.html"); return new Response(files.get("/application.html")); };
  try { await run({ root, put, baseline, files, fetchImpl }); }
  finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.ok(basename(root).startsWith("posetek-booking-release-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("booking composition replaces only canonical HTML without any framework build", async () => fixture(async ({ root, files, fetchImpl }) => {
  const baselineBefore = await readFile(join(root, "deployment/homepage-baseline.json"), "utf8");
  const receipt = await composeBookingRelease(root, { fetchImpl });
  assert.equal(receipt.preservedFiles, 4);
  assert.equal(receipt.preservedOutputFiles, 7);
  assert.equal(receipt.booking.sha, sha1(source));
  for (const [path, bytes] of files) assert.equal(await readFile(join(root, "production-dist" + path), "utf8"), path === "/bookperformancetest.html" ? source : bytes);
  assert.equal(await readFile(join(root, "production-dist/index.html"), "utf8"), "<!-- posetek-marketing-entry -->Current players");
  assert.equal(await readFile(join(root, "production-dist/coaches/index.html"), "utf8"), "<!-- posetek-coaches-entry -->Current coaches");
  assert.equal(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"), baselineBefore);
  assert.deepEqual(await verifyBookingRelease(root), receipt);
}));

test("local baseline drift rejects composition before writes or live requests", async () => fixture(async ({ root, put }) => {
  await put("production-dist/assets/current.js", "unexpected edit");
  await assert.rejects(composeBookingRelease(root, { fetchImpl: () => { throw new Error("must not fetch"); } }), /Baseline not verified/);
  assert.equal(await readFile(join(root, "production-dist/bookperformancetest.html"), "utf8"), "old booking");
}));

test("live application drift rejects composition before booking changes", async () => fixture(async ({ root }) => {
  await assert.rejects(composeBookingRelease(root, { fetchImpl: async () => new Response("new production application") }), /Production application changed/);
  assert.equal(await readFile(join(root, "production-dist/bookperformancetest.html"), "utf8"), "old booking");
}));

test("booking source must explicitly identify its isolated document", async () => fixture(async ({ root, put, fetchImpl }) => {
  await put("bookPerformanceTest.html", "<html>wrong page</html>");
  await assert.rejects(composeBookingRelease(root, { fetchImpl }), /isolated entry marker/);
  assert.equal(await readFile(join(root, "production-dist/bookperformancetest.html"), "utf8"), "old booking");
}));

test("booking composition refuses absent or duplicate baseline paths", async () => {
  for (const change of [baseline => baseline.files.splice(2, 1), baseline => baseline.files.push({ ...baseline.files[2], path: "/BOOKPERFORMANCETEST.html" })]) await fixture(async ({ root, put, baseline, fetchImpl }) => {
    change(baseline);
    await put("deployment/homepage-baseline.json", JSON.stringify(baseline));
    await assert.rejects(composeBookingRelease(root, { fetchImpl }), /booking baseline required|Duplicate baseline path/);
    assert.equal(await readFile(join(root, "production-dist/bookperformancetest.html"), "utf8"), "old booking");
  });
});

test("output directory junctions are rejected without touching external files", async () => fixture(async ({ root, put, fetchImpl }) => {
  const directory = join(root, "production-dist/assets");
  assert.equal(dirname(directory), join(root, "production-dist")); await rm(directory, { recursive: true });
  await put("external/current.js", "preserved app chunk");
  await symlink(join(root, "external"), directory, "junction");
  await assert.rejects(composeBookingRelease(root, { fetchImpl }), /Symbolic links/);
  assert.equal(await readFile(join(root, "external/current.js"), "utf8"), "preserved app chunk");
}));

test("receipt verification detects changed unrelated marketing and extra files", async () => {
  for (const path of ["index.html", "unreviewed.js", "bookperformancetest.html"]) await fixture(async ({ root, put, fetchImpl }) => {
    await composeBookingRelease(root, { fetchImpl });
    await put("production-dist/" + path, "unreviewed change");
    await assert.rejects(verifyBookingRelease(root), /Baseline not verified|inventory changed|file changed/);
  });
});

test("a composed artifact cannot silently become the baseline for another edit", async () => fixture(async ({ root, put, fetchImpl }) => {
  await composeBookingRelease(root, { fetchImpl });
  await put("bookPerformanceTest.html", source.replace("Updated", "Second"));
  await assert.rejects(composeBookingRelease(root, { fetchImpl }), /Baseline not verified/);
  assert.equal(await readFile(join(root, "production-dist/bookperformancetest.html"), "utf8"), source);
}));
