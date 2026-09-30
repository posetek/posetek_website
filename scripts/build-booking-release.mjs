// Deliberate booking-only composition over an already verified production-dist.
// No framework build, baseline edits, other document replacements, or deployment.
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { sha1, assertPlainPath } from "./astro-assets.mjs";

const bookingPath = "/bookperformancetest.html";
const marker = "<!-- posetek-booking-entry -->";
const receiptPath = ".netlify/booking-release-build.json";
const same = (first, second) => first.sha === second.sha && first.size === second.size;
const record = (path, bytes) => ({ path, sha: sha1(bytes), size: bytes.length });

function contained(root, path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error("Invalid booking release path");
  const target = resolve(root, "." + path), rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Booking release path escapes output");
  return target;
}

async function inventory(root) {
  const files = new Map();
  async function visit(directory, prefix = "") {
    await assertPlainPath(root, directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + "/" + item.name, target = contained(root, path);
      await assertPlainPath(root, target);
      if (item.isDirectory()) { await visit(target, path); continue; }
      if (!item.isFile()) throw new Error("Unexpected booking release output: " + path);
      const key = path.toLowerCase();
      if (files.has(key)) throw new Error("Case-folded release path collision: " + path);
      files.set(key, record(path, await readFile(target)));
    }
  }
  await visit(root);
  return files;
}

function verifyBaseline(baseline, files, booking) {
  if (baseline.applicationPath !== "/application.html" || !Array.isArray(baseline.files) ||
      !baseline.files.some(file => file.path === "/application.html") ||
      !baseline.files.some(file => file.path === bookingPath)) throw new Error("Current application and booking baseline required");
  const seen = new Set();
  for (const file of baseline.files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate baseline path: " + file.path);
    seen.add(key);
    const expected = booking && key === bookingPath ? booking : file;
    if (!files.has(key) || !same(files.get(key), expected)) throw new Error("Baseline not verified: " + file.path);
  }
}

export async function verifyBookingRelease(root) {
  root = resolve(root);
  const baseline = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
  const receipt = JSON.parse(await readFile(join(root, receiptPath), "utf8"));
  const prior = baseline.files.find(file => file.path === bookingPath);
  if (receipt.kind !== "booking-only" || receipt.baselineDeploymentId !== baseline.deploymentId ||
      receipt.booking?.path !== bookingPath || !/^[a-f0-9]{40}$/.test(receipt.booking.sha) ||
      !Number.isSafeInteger(receipt.booking.size) || receipt.booking.size <= 0 ||
      !prior || !same(receipt.previousBooking || {}, prior) || !Array.isArray(receipt.files)) throw new Error("Invalid booking release receipt");
  const files = await inventory(join(root, "production-dist"));
  verifyBaseline(baseline, files, receipt.booking);
  if (files.size !== receipt.files.length) throw new Error("Booking release inventory changed");
  const seen = new Set();
  for (const file of receipt.files) {
    const key = file.path.toLowerCase();
    if (seen.has(key) || !files.has(key) || !same(files.get(key), file)) throw new Error("Booking release file changed: " + file.path);
    seen.add(key);
  }
  return receipt;
}

export async function composeBookingRelease(root, { fetchImpl = fetch } = {}) {
  root = resolve(root);
  const output = join(root, "production-dist");
  const baseline = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
  const before = await inventory(output);
  verifyBaseline(baseline, before);
  for (const [path, entryMarker] of [["/index.html", "<!-- posetek-marketing-entry -->"], ["/coaches/index.html", "<!-- posetek-coaches-entry -->"]]) {
    if (!(await readFile(contained(output, path), "utf8")).includes(entryMarker)) throw new Error("Verified marketing output required: " + path);
  }
  const source = join(root, "bookPerformanceTest.html");
  await assertPlainPath(root, source);
  if (!(await lstat(source)).isFile()) throw new Error("Booking source must be a plain file");
  const bytes = await readFile(source), html = bytes.toString("utf8");
  if (!html.includes(marker) || !/<html\b/i.test(html) || !/<\/html>/i.test(html)) throw new Error("Booking source requires its isolated entry marker and HTML document");
  // Retain the ordinary production guard even when the assembled artifact is old.
  const live = await fetchImpl("https://posetek.net/application.html", { cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!live.ok || (live.url && new URL(live.url).origin !== "https://posetek.net")) throw new Error("Could not verify production before booking composition");
  const liveBytes = Buffer.from(await live.arrayBuffer());
  if (!same(record("/application.html", liveBytes), baseline.files.find(file => file.path === "/application.html"))) throw new Error("Production application changed; reconcile homepage-baseline.json with its latest deployment.");
  const booking = record(bookingPath, bytes), target = contained(output, before.get(bookingPath).path);
  const receiptTarget = join(root, receiptPath);
  await assertPlainPath(root, receiptTarget);
  await assertPlainPath(output, target);
  await writeFile(target, bytes);
  const after = await inventory(output);
  if (after.size !== before.size) throw new Error("Unexpected booking release inventory change");
  for (const [path, file] of before) {
    if (!same(after.get(path) || {}, path === bookingPath ? booking : file)) throw new Error("Unrelated file changed: " + file.path);
  }
  verifyBaseline(baseline, after, booking);
  const receipt = { kind: "booking-only", baselineDeploymentId: baseline.deploymentId,
    previousBooking: before.get(bookingPath), booking, preservedFiles: baseline.files.length - 1,
    preservedOutputFiles: before.size - 1, files: [...after.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  await mkdir(join(root, ".netlify"), { recursive: true });
  await writeFile(receiptTarget, JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/build-booking-release.mjs (requires a fresh guarded production-dist)");
  const receipt = await composeBookingRelease(fileURLToPath(new URL("../", import.meta.url)));
  console.log(JSON.stringify({ kind: receipt.kind, baselineDeploymentId: receipt.baselineDeploymentId, preservedFiles: receipt.preservedFiles, booking: receipt.booking }));
}
