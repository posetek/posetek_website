// Read and freshly verify only the two current marketing documents. Assets must
// already belong to the verified protected application baseline; nothing is copied
// from an arbitrary snapshot directory except these exact compiled HTML entries.
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { sha1, containedPath, assertPlainPath } from "./astro-assets.mjs";
const markers = new Map([["/index.html", "<!-- posetek-marketing-entry -->"], ["/coaches/index.html", "<!-- posetek-coaches-entry -->"]]);
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function runtimeAssets(html, pagePath) {
  // Retain verified compiled marketing regardless of which framework produced
  // it. Every direct same-origin runtime asset must already be checksum pinned;
  // the snapshot never supplies replacement scripts or styles.
  const assets = [];
  for (const match of html.matchAll(/\b(src|href|component-url|renderer-url)=["']([^"']+)["']/g)) {
    const attribute = match[1], value = match[2].replaceAll("&amp;", "&");
    if (!/\.(?:[cm]?js|css|wasm)(?:[?#]|$)/i.test(value) && !["component-url", "renderer-url"].includes(attribute)) continue;
    if (/\\|%(?:2e|2f|5c)/i.test(value) || value.split(/[?#]/)[0].split("/").includes("..")) throw Error("Marketing snapshot runtime asset has an unsafe path");
    const url = new URL(value, "https://posetek.net" + pagePath);
    if (url.origin !== "https://posetek.net") continue;
    if (!/^\/[A-Za-z0-9_./-]+$/.test(url.pathname)) throw Error("Marketing snapshot runtime asset has an unsafe path");
    assets.push(url.pathname);
  }
  return [...new Set(assets)];
}
function overlap(first, second) {
  const within = (parent, child) => { const rel = relative(parent, child); return !rel || !isAbsolute(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../"); };
  return within(first, second) || within(second, first);
}
export async function readAstroMarketingSnapshot(root, manifestPath, protectedFiles, { fetchImpl = fetch } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest.deploymentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.deploymentId) ||
      typeof manifest.sourceDirectory !== "string" || !isAbsolute(manifest.sourceDirectory) || !Array.isArray(manifest.files) || manifest.files.length !== 2 ||
      !Array.isArray(manifest.served) || !manifest.served.length) throw Error("Invalid marketing snapshot manifest for Astro application release");
  const source = resolve(manifest.sourceDirectory), output = resolve(root, "production-dist"), records = new Map(), documents = [];
  if (overlap(source, output)) throw Error("Marketing snapshot source overlaps output");
  for (const record of manifest.files) {
    if (!markers.has(record?.path) || records.has(record.path) || !sha(record.sha) || !Number.isSafeInteger(record.size) || record.size < 1) throw Error("Unexpected marketing snapshot document");
    records.set(record.path, record);
    const path = containedPath(source, record.path);
    await assertPlainPath(source, path);
    const bytes = await readFile(path), html = bytes.toString("utf8");
    if (sha1(bytes) !== record.sha || bytes.length !== record.size) throw Error("Marketing snapshot checksum mismatch: " + record.path);
    if (!html.includes(markers.get(record.path)) || !/\bid=["']root["']/.test(html) || /(?:src|href|component-url|renderer-url)=["'][^"']*(?:\/src\/|\/@vite\/|\.(?:jsx|tsx?)(?:[?#]|["']))/i.test(html)) throw Error("Marketing snapshot is not a compiled document: " + record.path);
    const assets = runtimeAssets(html, record.path);
    if (!assets.some(asset => /\.[cm]?js$/i.test(asset)) || assets.some(asset => !protectedFiles.has(asset.toLowerCase()))) throw Error("Marketing snapshot asset is not in the protected baseline");
    documents.push({ path: record.path, sha: record.sha, size: record.size, bytes });
  }
  const covered = new Set(), served = [];
  for (const entry of manifest.served) {
    const sourcePath = entry?.path === "/" || entry?.path === "/index.html" ? "/index.html" : ["/coaches", "/coaches/", "/coaches/index.html"].includes(entry?.path) ? "/coaches/index.html" : null;
    if (!sourcePath || !sha(entry.sha) || served.some(row => row.path === entry.path)) throw Error("Invalid marketing live verification entry");
    const response = await fetchImpl("https://posetek.net" + entry.path, { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    if (response.url) {
      const final = new URL(response.url);
      const finalSource = ["/", "/index.html"].includes(final.pathname) ? "/index.html" : ["/coaches", "/coaches/", "/coaches/index.html"].includes(final.pathname) ? "/coaches/index.html" : null;
      if (final.origin !== "https://posetek.net" || finalSource !== sourcePath) throw Error("Live marketing redirected outside its approved page");
    }
    if (!response.ok || sha1(Buffer.from(await response.arrayBuffer())) !== entry.sha) throw Error("Live marketing changed: " + entry.path);
    covered.add(sourcePath); served.push({ path: entry.path, sha: entry.sha });
  }
  if (covered.size !== 2) throw Error("Both marketing documents require fresh live verification");
  return { deploymentId: manifest.deploymentId, documents, served };
}
