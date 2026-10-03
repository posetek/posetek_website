// Release only the public marketing pages. Keep the current production application
// byte-for-byte, even when local dependencies or unrelated source have changed.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mergeAstroAssets } from "./astro-assets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = join(root, "app");
const output = join(root, "production-dist");
const manifest = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
const cache = join(app, "node_modules/.cache/homepage-baseline", manifest.deploymentId);
const hash = bytes => createHash("sha1").update(bytes).digest("hex");
// Some pinned releases include filename aliases with the same original bytes.
// Share a declared local source only for an exact checksum AND size match.
const localSources = new Map(manifest.files.filter(file => file.localPath)
  .map(file => [`${file.sha}:${file.size}`, file.localPath]));
const injected = /\n<!-- homepage-navigation:start -->[\s\S]*?<!-- homepage-navigation:end -->\n/g;
const applicationPath = manifest.applicationPath ?? "/index.html";
const preserveApplicationEntry = applicationPath === "/application.html";
if (applicationPath !== "/index.html" && !preserveApplicationEntry) throw new Error("Unsupported baseline application path");
const entry = manifest.files.find(file => file.path === applicationPath);
if (!entry) throw new Error("Baseline application entry is missing: " + applicationPath);
if (manifest.files.some(file => file.path === "/coaches" || file.path.startsWith("/coaches/") ||
    (preserveApplicationEntry && (file.path === "/index.html" || file.path.startsWith("/marketing/assets/"))))) {
  throw new Error("Preservation baseline overlaps the marketing output");
}
const outputPath = file => !preserveApplicationEntry && file.path === "/index.html" ? "/application.html" : file.path;
const live = await fetch("https://posetek.net" + (preserveApplicationEntry ? applicationPath : "/"), { signal: AbortSignal.timeout(30000) });
if (!live.ok) throw new Error("Could not verify production before building");
const liveHtml = await live.text();
let current = liveHtml;
if (!preserveApplicationEntry && liveHtml.includes("<!-- posetek-marketing-entry -->")) {
  const response = await fetch("https://posetek.net/application.html", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Could not verify preserved application");
  current = (await response.text()).replace(injected, "");
}
if (hash(current) !== entry.sha) throw new Error("Production application changed; reconcile homepage-baseline.json with its latest deployment.");

function command(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: app, stdio: "inherit", windowsHide: true, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build command failed: ${file}`);
}
command(join(app, "node_modules/typescript/bin/tsc"), ["-b"]);
command(join(app, "node_modules/astro/bin/astro.mjs"), ["build"]);

// Validate the absolute target immediately before the recursive operation.
if (relative(root, output) !== "production-dist" || isAbsolute(relative(root, output))) throw new Error("Invalid output directory");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
function contained(directory, file) {
  const target = resolve(directory, "." + file);
  const rel = relative(directory, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid baseline path: " + file);
  return target;
}

let index = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (index < manifest.files.length) {
    const file = manifest.files[index++];
    const cached = contained(cache, file.path);
    let bytes;
    try { bytes = await readFile(cached); } catch { /* First release downloads the pinned deploy. */ }
    // Netlify pretty-URL processing rewrites served HTML. Prefer matching
    // original source bytes, allowing only Git's Windows line-ending conversion.
    const localPath = file.localPath || localSources.get(`${file.sha}:${file.size}`);
    if ((!bytes || hash(bytes) !== file.sha) && localPath) {
      try {
        const local = await readFile(contained(root, "/" + localPath));
        const normalized = Buffer.from(local.toString("utf8").replace(/\r\n/g, "\n"));
        if (hash(local) === file.sha) bytes = local;
        else if (hash(normalized) === file.sha) bytes = normalized;
      } catch { /* Download when the original source is unavailable. */ }
    }
    if (!bytes || hash(bytes) !== file.sha) {
      const response = await fetch(new URL(file.path, manifest.url), { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Baseline download failed: ${file.path} (${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
      // Historical duplicate marketing entries can be served through Netlify's
      // pretty-URL rewrite. Recover only the committed noscript block, and only
      // accept it if it reproduces the pinned original in full.
      if (hash(bytes) !== file.sha && /^\/index \d+\.html$/.test(file.path)) {
        const source = await readFile(join(root, 'index.html'), 'utf8');
        const originalNoscript = source.match(/<noscript>.*<\/noscript>/)?.[0];
        if (originalNoscript) {
          const candidate = Buffer.from(bytes.toString('utf8').replace(/<noscript>.*<\/noscript>/, originalNoscript));
          if (hash(candidate) === file.sha && candidate.length === file.size) bytes = candidate;
        }
      }
      if (hash(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Baseline checksum mismatch: " + file.path);
    }
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, bytes);
    const target = contained(output, outputPath(file));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}));

if (!preserveApplicationEntry) {
  const shellPath = join(output, "application.html");
  const applicationHtml = await readFile(shellPath, "utf8");
  if (!applicationHtml.includes("</body>")) throw new Error("Unexpected application shell");
  await writeFile(shellPath, applicationHtml.replace("</body>", '\n<!-- homepage-navigation:start -->\n<script src="/marketing/home-navigation.js" defer></script>\n<!-- homepage-navigation:end -->\n</body>'));
}
const marketingHtml = await readFile(join(root, "app/astro-dist/index.html"), "utf8");
if (!marketingHtml.includes("<!-- posetek-marketing-entry -->")) throw new Error("Missing marketing entry marker");
await writeFile(join(output, "index.html"), marketingHtml);
const coachesHtml = await readFile(join(root, "app/astro-dist/coaches/index.html"), "utf8");
if (!coachesHtml.includes("<!-- posetek-coaches-entry -->")) throw new Error("Missing coaches entry marker");
await mkdir(join(output, "coaches"), { recursive: true });
await writeFile(join(output, "coaches/index.html"), coachesHtml);
await mergeAstroAssets(join(root, "app/astro-dist"), output, manifest.files);
if (!preserveApplicationEntry) await cp(join(root, "deployment/home-navigation.js"), join(output, "marketing/home-navigation.js"));

for (const file of manifest.files) {
  const bytes = await readFile(contained(output, outputPath(file)));
  const original = !preserveApplicationEntry && file.path === "/index.html" ? bytes.toString("utf8").replace(injected, "") : bytes;
  if (hash(original) !== file.sha || Buffer.byteLength(original) !== file.size) throw new Error("Preservation verification failed: " + file.path);
}
console.log(`[production] Verified ${manifest.files.length} preserved application files from ${manifest.deploymentId}; added isolated player and coaches pages.`);
