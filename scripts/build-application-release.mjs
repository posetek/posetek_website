// Deliberate application release, separate from ordinary homepage preservation.
// New releases use Astro. The explicitly pinned marketing-snapshot mode remains
// available only for reproducing historical Vite releases and their contracts.
// The existing build verifies live drift and assembles all preserved public files first.
import { readFile, writeFile, mkdir, readdir, lstat, rm } from "node:fs/promises";
import { join, relative, isAbsolute, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const sha = bytes => createHash("sha1").update(bytes).digest("hex");
const marketingPath = path => typeof path === "string" && (path === "/index.html" || path === "/coaches/index.html" ||
  /^\/marketing\/assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path));
const validSha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function containedPath(directory, path) {
  const target = resolve(directory, "." + path), rel = relative(directory, target);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Path escapes marketing directory: " + path);
  return target;
}
async function assertPlainPath(directory, target) {
  const rel = relative(directory, target);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Path escapes marketing directory");
  let current = directory;
  for (const part of ["", ...rel.split(/[\\/]/).filter(Boolean)]) {
    current = part ? join(current, part) : current;
    let stat;
    try { stat = await lstat(current); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error("Symbolic links are not allowed in marketing snapshot paths");
    if (current !== target && !stat.isDirectory()) throw new Error("Marketing path ancestor is not a directory");
  }
}
function directoriesOverlap(first, second) {
  const within = (parent, child) => { const rel = relative(parent, child); return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../")); };
  return within(first, second) || within(second, first);
}

// An app-only release can pin the already approved marketing build, including its
// original bytes. Validate the complete snapshot and current served pages before
// touching output; the private source location is never included in the receipt.
export async function restoreMarketingSnapshot(root, manifestPath, { fetchImpl = fetch } = {}) {
  root = resolve(root);
  const output = join(root, "production-dist");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest.deploymentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.deploymentId) ||
      typeof manifest.sourceDirectory !== "string" || !isAbsolute(manifest.sourceDirectory) ||
      !Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.served)) throw new Error("Invalid marketing snapshot manifest");
  const sourceDirectory = resolve(manifest.sourceDirectory);
  if (directoriesOverlap(sourceDirectory, output)) throw new Error("Marketing source and output directories must not overlap");
  const files = new Map(), folded = new Set();
  for (const file of manifest.files) {
    if (!file || !marketingPath(file.path) || !validSha(file.sha) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("Invalid marketing snapshot file");
    const key = file.path.toLowerCase();
    if (folded.has(key)) throw new Error("Duplicate marketing snapshot path: " + file.path);
    folded.add(key);
    files.set(file.path, file);
  }
  if (!files.has("/index.html") || !files.has("/coaches/index.html")) throw new Error("Marketing snapshot must include both page entries");
  const served = new Map(), covered = new Set();
  for (const file of manifest.served) {
    const path = file?.path;
    const sourcePath = path === "/" ? "/index.html" : path === "/coaches" || path === "/coaches/" ? "/coaches/index.html" : path;
    if (!files.has(sourcePath) || !validSha(file.sha)) throw new Error("Invalid served marketing snapshot path");
    if (served.has(path.toLowerCase())) throw new Error("Duplicate served marketing snapshot path: " + path);
    served.set(path.toLowerCase(), { path, sha: file.sha });
    covered.add(sourcePath);
  }
  if ([...files.keys()].some(path => !covered.has(path))) throw new Error("Live marketing verification must cover every snapshot file");
  const prepared = [];
  for (const file of files.values()) {
    const source = containedPath(sourceDirectory, file.path), target = containedPath(output, file.path);
    await assertPlainPath(sourceDirectory, source);
    await assertPlainPath(root, target);
    if (!(await lstat(source)).isFile()) throw new Error("Marketing snapshot source must be a file");
    try { if (!(await lstat(target)).isFile()) throw new Error("Marketing snapshot target must be a file"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const bytes = await readFile(source);
    if (sha(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Marketing snapshot checksum or size mismatch: " + file.path);
    prepared.push({ ...file, target, bytes });
  }
  const assets = containedPath(output, "/marketing/assets"), obsolete = [];
  await assertPlainPath(root, assets);
  async function inspectAssets(directory, prefix) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const item of entries) {
      const path = prefix + "/" + item.name, target = containedPath(output, path);
      await assertPlainPath(root, target);
      if (item.isDirectory()) await inspectAssets(target, path);
      else if (!item.isFile()) throw new Error("Unexpected generated marketing asset type");
      else if (!files.has(path)) obsolete.push(target);
    }
  }
  await inspectAssets(assets, "/marketing/assets");
  for (const file of served.values()) {
    const url = "https://posetek.net" + file.path;
    const response = await fetchImpl(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Could not verify current marketing production: " + file.path);
    if (response.url && new URL(response.url).origin !== "https://posetek.net") throw new Error("Unexpected marketing verification redirect");
    if (sha(Buffer.from(await response.arrayBuffer())) !== file.sha) throw new Error("Production marketing changed; refresh the approved snapshot: " + file.path);
  }
  for (const target of obsolete) {
    // Check again immediately before removal; only files under marketing/assets
    // are candidates, never application assets or other public marketing files.
    containedPath(assets, "/" + relative(assets, target).replaceAll("\\", "/"));
    await assertPlainPath(root, target);
    await rm(target);
  }
  for (const file of prepared) {
    await assertPlainPath(root, file.target);
    await mkdir(dirname(file.target), { recursive: true });
    await writeFile(file.target, file.bytes);
    if (sha(await readFile(file.target)) !== file.sha) throw new Error("Restored marketing file verification failed: " + file.path);
  }
  return { marketingDeploymentId: manifest.deploymentId };
}

export async function composeApplicationRelease(root, { marketingDeploymentId } = {}) {
  const output = join(root, "production-dist"), dist = join(root, "dist");
  const baseline = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
  const homepage = await readFile(join(output, "index.html"));
  if (!homepage.toString().includes("<!-- posetek-marketing-entry -->")) throw new Error("Verified homepage output is required");
  const coaches = await readFile(join(output, "coaches/index.html"));
  if (!coaches.toString().includes("<!-- posetek-coaches-entry -->")) throw new Error("Verified coaches output is required");
  const entry = await readFile(join(dist, "index.html"), "utf8");
  if (!entry.includes('id="root"') || !entry.includes('type="module"') || entry.includes("/src/") || !entry.includes("/assets/")) throw new Error("Fresh compiled application entry required");
  const before = new Map();
  for (const file of baseline.files) {
    const key = file.path.toLowerCase(), existing = before.get(key);
    if (existing) {
      if (existing.sha !== file.sha || existing.size !== file.size) throw new Error("Conflicting case-insensitive baseline path: " + file.path);
      continue;
    }
    const bytes = await readFile(join(output, file.path.slice(1)));
    if (sha(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Baseline not verified: " + file.path);
    before.set(key, { ...file, bytes });
  }
  const added = [], newAssets = new Map();
  async function copyAssets(directory, prefix = "/assets") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + "/" + item.name, source = join(directory, item.name);
      if (item.isDirectory()) { await copyAssets(source, path); continue; }
      if (!item.isFile()) throw new Error("Unexpected asset type: " + path);
      const target = resolve(output, "." + path), rel = relative(output, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid output path");
      const bytes = await readFile(source);
      // Netlify's inventory folds names to lowercase. Keep the pinned path when
      // Vite emits the same asset with different casing, including on Linux.
      const key = path.toLowerCase(), checksum = sha(bytes), preserved = before.get(key), duplicate = newAssets.get(key);
      if (preserved && (preserved.sha !== checksum || preserved.size !== bytes.length)) throw new Error("Asset collision with existing application: " + path);
      if (duplicate && (duplicate.sha !== checksum || duplicate.size !== bytes.length)) throw new Error("Conflicting case-insensitive new asset path: " + path);
      if (preserved || duplicate) continue;
      const record = { path, sha: checksum, size: bytes.length };
      newAssets.set(key, record);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      added.push(record);
    }
  }
  await copyAssets(join(dist, "assets"));
  const bridge = '\n<!-- homepage-navigation:start -->\n<script src="/marketing/home-navigation.js" defer></script>\n<!-- homepage-navigation:end -->\n';
  const application = entry.replace("</body>", bridge + "</body>");
  if (!application.includes(bridge)) throw new Error("Application body is missing");
  await writeFile(join(output, "application.html"), application);
  for (const { path, bytes } of before.values()) {
    if (path.toLowerCase() === "/application.html") continue;
    if (sha(await readFile(join(output, path.slice(1)))) !== sha(bytes)) throw new Error("Unrelated file changed: " + path);
  }
  if (sha(await readFile(join(output, "index.html"))) !== sha(homepage)) throw new Error("Homepage changed during application composition");
  if (sha(await readFile(join(output, "coaches/index.html"))) !== sha(coaches)) throw new Error("Coaches page changed during application composition");
  const receipt = { baselineDeploymentId: baseline.deploymentId, ...(marketingDeploymentId ? { marketingDeploymentId } : {}), homepageSha: sha(homepage), coachesSha: sha(coaches), preservedFiles: before.size - 1,
    application: { path: "/application.html", sha: sha(application), size: Buffer.byteLength(application) }, added };
  await mkdir(join(root, ".netlify"), { recursive: true });
  await writeFile(join(root, ".netlify/application-release-build.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || !["--marketing-snapshot", "--preserve-marketing"].includes(args[0]) || !args[1] || args[1].startsWith("--"))) throw new Error("Usage: node scripts/build-application-release.mjs [--preserve-marketing <Astro-manifest-path> | --marketing-snapshot <historical-Vite-manifest-path>]");
  function run(file, args = [], cwd = root) {
    const result = spawnSync(process.execPath, [file, ...args], { cwd, stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Build failed: " + file);
  }
  if (!args.length || args[0] === "--preserve-marketing") {
    run(join(root, "scripts/build-astro-release.mjs"), args);
  } else {
    run(join(root, "scripts/build-production.mjs"));
    const marketing = await restoreMarketingSnapshot(root, resolve(args[1]));
    // Do not copy arbitrary repository-root legacy files into a public release.
    run(join(root, "app/node_modules/vite/bin/vite.js"), ["build"], join(root, "app"));
    const receipt = await composeApplicationRelease(root, marketing);
    console.log(JSON.stringify({ ...marketing, preservedFiles: receipt.preservedFiles, addedAssets: receipt.added.length, application: receipt.application }));
  }
}
