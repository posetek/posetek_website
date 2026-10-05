// A favicon-only release restores the exact reviewed marketing documents, then
// changes icon links in document heads while retaining all application bytes.
import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sha1, assertPlainPath } from "./astro-assets.mjs";
import { readAstroMarketingSnapshot } from "./astro-marketing-snapshot.mjs";
import { updateIconLinks, ICON_ASSETS } from "./website-icons.mjs";

const marketingPaths = ["/index.html", "/coaches/index.html"];

// Historical protected aliases contain spaces. Keep containment checks without
// the generated-asset path restriction used by containedPath().
function releasePath(directory, path) {
  if (typeof path !== "string" || !path.startsWith("/") || /[\\\x00-\x1f]/.test(path) || path.split("/").includes("..")) {
    throw Error("Invalid icon release path: " + path);
  }
  const target = resolve(directory, "." + path), rel = relative(directory, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) throw Error("Icon release path escapes output: " + path);
  return target;
}

async function inventory(output) {
  const files = [];
  async function inspect(directory, prefix = "") {
    await assertPlainPath(output, directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + "/" + item.name, target = releasePath(output, path);
      await assertPlainPath(output, target);
      if (item.isDirectory()) await inspect(target, path);
      else if (item.isFile()) files.push(path);
      else throw Error("Unexpected icon release output: " + path);
    }
  }
  await inspect(output);
  return files.sort();
}

function record(path, bytes) { return { path, sha: sha1(bytes), size: bytes.length }; }

export async function composeIconRelease(root, { marketingSnapshot, fetchImpl = fetch } = {}) {
  if (typeof marketingSnapshot !== "string" || !marketingSnapshot) throw Error("Icon release requires --preserve-marketing <manifest-path>");
  root = resolve(root);
  const output = join(root, "production-dist");
  const baseline = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
  if (!baseline || typeof baseline.deploymentId !== "string" || !Array.isArray(baseline.files)) throw Error("Invalid icon release baseline");
  const protectedFiles = new Map(), originals = new Map();
  for (const file of baseline.files) {
    const target = releasePath(output, file.path), key = file.path.toLowerCase(), prior = protectedFiles.get(key);
    if (prior && (prior.sha !== file.sha || prior.size !== file.size)) throw Error("Conflicting folded baseline path: " + file.path);
    if (!/^[a-f0-9]{40}$/.test(file.sha) || !Number.isSafeInteger(file.size) || file.size < 0) throw Error("Invalid icon release baseline record: " + file.path);
    await assertPlainPath(output, target);
    const bytes = await readFile(target);
    if (sha1(bytes) !== file.sha || bytes.length !== file.size) throw Error("Baseline not verified: " + file.path);
    protectedFiles.set(key, file);
    if (/\.html$/i.test(file.path)) originals.set(key, { path: file.path, bytes, source: "baseline" });
  }

  // Validate snapshot checksums, pinned runtime assets and fresh live proof
  // before changing any reviewed output or removing newly built assets.
  const marketing = await readAstroMarketingSnapshot(root, marketingSnapshot, protectedFiles, { fetchImpl });
  for (const document of marketing.documents) originals.set(document.path.toLowerCase(), { ...document, source: "approved-marketing" });

  if (!Array.isArray(ICON_ASSETS) || new Set(ICON_ASSETS.map(path => path.toLowerCase())).size !== ICON_ASSETS.length) throw Error("Invalid icon release asset list");
  const icons = [];
  for (const path of ICON_ASSETS) {
    const target = releasePath(output, path);
    await assertPlainPath(output, target);
    icons.push(record(path, await readFile(target)));
  }
  const allowed = new Set([...protectedFiles.keys(), ...marketingPaths, ...ICON_ASSETS.map(path => path.toLowerCase())]);
  const removedAssets = [];
  for (const path of await inventory(output)) {
    if (allowed.has(path.toLowerCase())) continue;
    if (!path.startsWith("/_astro/") || !/\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(path)) throw Error("Unexpected icon release output: " + path);
    removedAssets.push(record(path, await readFile(releasePath(output, path))));
  }

  const prepared = [];
  for (const original of originals.values()) {
    const html = original.bytes.toString("utf8");
    if (!Buffer.from(html).equals(original.bytes)) throw Error("Icon release HTML must preserve UTF-8 bytes: " + original.path);
    const updated = updateIconLinks(html);
    if (typeof updated !== "string") throw Error("Invalid icon document transformation: " + original.path);
    const bytes = Buffer.from(updated);
    prepared.push({ ...record(original.path, bytes), bytes, inputSha: sha1(original.bytes), inputSize: original.bytes.length,
      source: original.source, changed: !bytes.equals(original.bytes) });
  }

  for (const document of prepared) {
    const target = releasePath(output, document.path);
    await assertPlainPath(output, target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, document.bytes);
  }
  for (const asset of removedAssets) {
    const target = releasePath(output, asset.path);
    await assertPlainPath(output, target);
    await rm(target);
  }

  // Independent readback proves the complete artifact has exactly the retained
  // baseline, the two approved documents and the declared icon assets.
  const documents = new Map(prepared.map(document => [document.path.toLowerCase(), document]));
  let preservedFiles = 0;
  for (const file of baseline.files) {
    const bytes = await readFile(releasePath(output, file.path)), transformed = documents.get(file.path.toLowerCase());
    if (transformed ? !bytes.equals(transformed.bytes) : sha1(bytes) !== file.sha || bytes.length !== file.size) throw Error("Icon release preservation failed: " + file.path);
    if (sha1(bytes) === file.sha && bytes.length === file.size) preservedFiles++;
  }
  for (const document of prepared) if (!(await readFile(releasePath(output, document.path))).equals(document.bytes)) throw Error("Icon document readback failed: " + document.path);
  for (const asset of icons) {
    const bytes = await readFile(releasePath(output, asset.path));
    if (sha1(bytes) !== asset.sha || bytes.length !== asset.size) throw Error("Icon asset changed during composition: " + asset.path);
  }
  const outputPaths = await inventory(output), outputKeys = new Set(outputPaths.map(path => path.toLowerCase()));
  if (outputKeys.size !== allowed.size || outputPaths.length !== outputKeys.size || [...allowed].some(path => !outputKeys.has(path))) throw Error("Icon release inventory differs from its declared scope");

  const documentRecords = prepared.map(({ bytes, ...document }) => document);
  const added = icons.filter(asset => !protectedFiles.has(asset.path.toLowerCase()));
  const receipt = { scope: "website-icons", baselineDeploymentId: baseline.deploymentId,
    marketingDeploymentId: marketing.deploymentId, marketingLiveVerification: marketing.served,
    baselineFiles: baseline.files.length, preservedFiles, outputFiles: outputPaths.length,
    changedPaths: [...documentRecords.filter(document => document.changed).map(document => document.path), ...added.map(asset => asset.path)].sort(),
    documents: documentRecords, icons, added, removedAssets };
  const receiptPath = join(root, ".netlify/icon-release-build.json");
  await assertPlainPath(root, receiptPath);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--preserve-marketing" || !args[1] || args[1].startsWith("--")) throw Error("Usage: node scripts/build-icon-release.mjs --preserve-marketing <manifest-path>");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, [join(root, "scripts/build-production.mjs")], {
    cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Ordinary preservation build failed");
  const receipt = await composeIconRelease(root, { marketingSnapshot: resolve(args[1]) });
  console.log(JSON.stringify({ scope: receipt.scope, preservedFiles: receipt.preservedFiles, outputFiles: receipt.outputFiles, changedPaths: receipt.changedPaths }));
}
