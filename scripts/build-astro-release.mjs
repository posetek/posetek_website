// Deliberate full-site application release. First run the ordinary live-drift
// guard, then replace only Astro's three declared documents. All historical
// assets and public files remain checksum protected.
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sha1, containedPath, assertPlainPath, mergeAstroAssets } from "./astro-assets.mjs";
import { restoreMarketingSnapshot } from "./build-application-release.mjs";

const entries = new Map([
  ["/index.html", "<!-- posetek-marketing-entry -->"],
  ["/coaches/index.html", "<!-- posetek-coaches-entry -->"],
  ["/application.html", "<!-- posetek-astro-application-entry -->"],
  ["/feedback.html", "<!-- posetek-feedback-entry -->"],
]);

export async function composeAstroRelease(root, { marketingDeploymentId } = {}) {
  root = resolve(root);
  const source = join(root, "app/astro-dist"), output = join(root, "production-dist");
  const baseline = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
  const protectedFiles = new Map();
  for (const file of baseline.files) {
    const key = file.path.toLowerCase(), prior = protectedFiles.get(key);
    if (prior && (prior.sha !== file.sha || prior.size !== file.size)) throw new Error("Conflicting folded baseline path");
    protectedFiles.set(key, file);
    const target = resolve(output, "." + file.path);
    await assertPlainPath(output, target);
    const bytes = await readFile(target);
    if (sha1(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Baseline not verified: " + file.path);
  }
  const prepared = [];
  async function inspect(directory, prefix = "") {
    await assertPlainPath(source, directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + "/" + item.name;
      if (path === "/_astro" && item.isDirectory()) continue;
      if (path === "/coaches" && item.isDirectory()) { await inspect(join(directory, item.name), path); continue; }
      if (!item.isFile() || !entries.has(path)) throw new Error("Unexpected Astro release output: " + path);
      const bytes = await readFile(containedPath(source, path)), html = bytes.toString("utf8");
      if (!html.includes(entries.get(path)) || !html.includes('id="root"') || !html.includes("/_astro/") || /(?:src|href)=["']\/src\//.test(html)) throw new Error("Uncompiled Astro document: " + path);
      if (path === "/application.html" && (!html.includes('client="only"') || (html.match(/<astro-island\b/g) || []).length !== 1 || !html.includes("/marketing/home-navigation.js"))) throw new Error("Application must be one client-only root with its navigation bridge");
      if (path === "/feedback.html" && (!html.includes('client="only"') || (html.match(/<astro-island\b/g) || []).length !== 1 || /clarity|googletagmanager|google-analytics|fonts\.googleapis|home-navigation\.js/i.test(html))) throw new Error("Feedback must be an isolated client-only document");
      prepared.push({ path, bytes, sha: sha1(bytes), size: bytes.length });
    }
  }
  await inspect(source);
  if (prepared.length !== entries.size) throw new Error("All four Astro documents are required");
  const added = await mergeAstroAssets(source, output, [...protectedFiles.values()]);
  for (const entry of prepared) {
    if (marketingDeploymentId && ["/index.html", "/coaches/index.html"].includes(entry.path)) {
      // restoreMarketingSnapshot verified these original approved bytes and live hashes.
      entry.bytes = await readFile(containedPath(output, entry.path));
      entry.sha = sha1(entry.bytes); entry.size = entry.bytes.length;
      continue;
    }
    const target = containedPath(output, entry.path);
    await assertPlainPath(output, target); await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, entry.bytes);
  }
  let preservedFiles = 0;
  for (const file of protectedFiles.values()) {
    if (entries.has(file.path)) continue;
    const bytes = await readFile(resolve(output, "." + file.path));
    if (sha1(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Unrelated file changed: " + file.path);
    preservedFiles++;
  }
  const documents = prepared.map(({ bytes, ...record }) => record);
  const receipt = { framework: "astro", baselineDeploymentId: baseline.deploymentId, preservedFiles, documents, added,
    ...(marketingDeploymentId ? { marketingDeploymentId } : {}),
    application: documents.find(entry => entry.path === "/application.html"),
    homepageSha: documents.find(entry => entry.path === "/index.html").sha,
    coachesSha: documents.find(entry => entry.path === "/coaches/index.html").sha };
  await mkdir(join(root, ".netlify"), { recursive: true });
  await writeFile(join(root, ".netlify/application-release-build.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--marketing-snapshot")) throw new Error("Usage: node scripts/build-astro-release.mjs [--marketing-snapshot manifest.json]");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, [join(root, "scripts/build-production.mjs")], {
    cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Ordinary preservation build failed");
  const marketing = args.length ? await restoreMarketingSnapshot(root, resolve(args[1])) : {};
  const receipt = await composeAstroRelease(root, marketing);
  console.log(JSON.stringify({ framework: receipt.framework, preservedFiles: receipt.preservedFiles, addedAssets: receipt.added.length, documents: receipt.documents }));
}
