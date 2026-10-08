"use strict";

// Audit an already-uploaded immutable website artifact. The sole mutation is
// the explicit promote mode's restore of that exact reviewed deployment.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), cp = require("node:child_process");
const ROOT = path.resolve(__dirname, "../.."), SITE = "b1ccf990-286c-4367-bb67-ca0d9ea2a020";
const PUBLIC_FILES = ["/index.html", "/coaches/index.html", "/feedback.html", "/favicon.ico", "/brand/posetek-p.svg", "/brand/posetek-p-96.png", "/apple-touch-icon.png"];
const APP_ROUTES = ["/application.html", "/signin", "/join", "/organization", "/admin", "/admin/access", "/admin/organizations"];
const FEEDBACK_ROUTES = ["/feedback", "/feedback/", "/feedback.html"];
const sha1 = value => crypto.createHash("sha1").update(value).digest("hex");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const requireThat = (value, message) => { if (!value) throw Error(message); };
const json = filename => JSON.parse(fs.readFileSync(filename, "utf8"));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => sha256(JSON.stringify(canonical(value)));
const write = (run, name, value, exclusive = false) => fs.writeFileSync(path.join(run, name), JSON.stringify(value, null, 2) + "\n", { flag: exclusive ? "wx" : "w" });
function safePath(root, filename) {
  const relative = path.relative(root, filename);
  requireThat(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Path is outside the intended directory");
  let current = root;
  requireThat(!fs.lstatSync(root).isSymbolicLink(), "Symbolic links are not allowed");
  for (const part of relative.split(path.sep)) { current = path.join(current, part); if (fs.existsSync(current)) requireThat(!fs.lstatSync(current).isSymbolicLink(), "Symbolic links are not allowed"); }
  return filename;
}
function inventoryPath(value) {
  requireThat(typeof value === "string" && value.startsWith("/") && !/[\\\u0000?#]/.test(value) && value.split("/").every(part => part !== "." && part !== ".."), "Invalid inventory path");
  return value;
}
function normalizeInventory(rows, deployId, siteId = SITE) {
  requireThat(Array.isArray(rows) && rows.length > 0, "Provider inventory is missing");
  const found = new Set();
  return rows.map(row => {
    const name = inventoryPath(row.path), folded = name.toLowerCase();
    requireThat(!found.has(folded), "Duplicate provider inventory path"); found.add(folded);
    requireThat(row.deploy_id === deployId && row.site_id === siteId && /^[a-f0-9]{40}$/.test(row.sha) && Number.isSafeInteger(row.size) && row.size >= 0, "Provider inventory binding or digest differs");
    return { path: name, sha: row.sha, size: row.size };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function localInventory(directory) {
  requireThat(fs.existsSync(directory) && !fs.lstatSync(directory).isSymbolicLink(), "Reviewed production-dist is missing or linked");
  const rows = [], folded = new Set();
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = safePath(directory, path.join(folder, entry.name));
      requireThat(!entry.isSymbolicLink(), "Linked website files are not allowed");
      if (entry.isDirectory()) visit(filename);
      else {
        requireThat(entry.isFile(), "Unexpected website artifact type");
        const name = inventoryPath("/" + path.relative(directory, filename).split(path.sep).join("/"));
        requireThat(!folded.has(name.toLowerCase()), "Case-colliding local artifact paths"); folded.add(name.toLowerCase());
        const bytes = fs.readFileSync(filename); rows.push({ path: name, sha: sha1(bytes), size: bytes.length });
      }
    }
  }
  visit(directory); return rows.sort((a, b) => a.path.localeCompare(b.path));
}
function compareArtifact(local, provider, metadataPath) {
  const remote = new Map(provider.filter(row => row.path !== metadataPath).map(row => [row.path, row]));
  requireThat(local.length === remote.size && local.every(row => { const peer = remote.get(row.path); return peer?.sha === row.sha && peer.size === row.size; }), "Local production-dist differs from the complete provider inventory");
}
function preserveBefore(before, after, metadataPath) {
  const remote = new Map(after.map(row => [row.path, row]));
  for (const row of before) {
    if (["/application.html", metadataPath].includes(row.path)) continue;
    const peer = remote.get(row.path);
    requireThat(peer?.sha === row.sha && peer.size === row.size, "A preserved predecessor artifact changed or disappeared");
  }
  requireThat(remote.has(metadataPath) && remote.has("/application.html"), "Declared application or provider metadata is missing");
  requireThat(before.some(row => row.path === "/application.html" && remote.get(row.path).sha !== row.sha), "Candidate application has not changed");
}
function effectiveConfig(bytes) {
  const result = { redirects: [], headers: [] }; let table = null;
  for (const original of bytes.toString("utf8").split(/\r?\n/)) {
    const line = original.trim(); if (!line || line.startsWith("#")) continue;
    const array = /^\[\[(redirects|headers)\]\]$/.exec(line);
    if (array) { table = {}; result[array[1]].push(table); continue; }
    const nested = /^\[(redirects|headers)\.([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (nested) { table = result[nested[1]].at(-1); requireThat(table, "Invalid effective configuration table"); for (const key of nested[2].split(".")) table = table[key] ||= {}; continue; }
    if (line.startsWith("[")) { table = null; continue; }
    if (!table) continue;
    const match = /^("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    requireThat(match, "Unsupported effective configuration syntax");
    const key = match[1].replace(/^["']|["']$/g, ""); let value;
    try { value = match[2].startsWith("'") && match[2].endsWith("'") ? match[2].slice(1, -1) : JSON.parse(match[2]); }
    catch { throw Error("Unsupported effective configuration value"); }
    table[key] = value;
  }
  requireThat(result.redirects.length > 0 && result.headers.length > 0, "Effective redirects and headers are missing");
  return result;
}
function browserEvidence(value, deploymentId, artifactDigest) {
  requireThat(value?.accepted === true && value.deploymentId === deploymentId && value.artifactDigest === artifactDigest && value.origin === `https://${deploymentId}--posetek.netlify.app` && Number.isSafeInteger(value.checks) && value.checks > 0 && value.failed === 0 && typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt)), "Browser acceptance evidence does not bind this exact reviewed draft");
  return { accepted: true, deploymentId, artifactDigest, checks: value.checks, failed: 0, checkedAt: value.checkedAt, origin: value.origin };
}
function argumentsFor(argv) {
  const mode = argv[0]; requireThat(["verify-draft", "promote", "verify-production"].includes(mode), "Choose verify-draft, promote or verify-production");
  const result = { mode };
  for (let n = 1; n < argv.length; n += 2) {
    const key = { "--run-dir": "runDir", "--deployment-id": "deploymentId", "--browser-evidence": "browserEvidence" }[argv[n]];
    requireThat(key && argv[n + 1] && !argv[n + 1].startsWith("--") && !result[key], "Invalid web release arguments"); result[key] = argv[n + 1];
  }
  requireThat(result.runDir && /^[a-f0-9]{24}$/.test(result.deploymentId || ""), "Provide a private run directory and exact deployment ID");
  requireThat(mode !== "promote" || result.browserEvidence, "Promotion requires accepted browser evidence");
  return result;
}
function authorizedApi() {
  const config = json(path.join(process.env.APPDATA || "", "netlify/Config/config.json"));
  const auth = config.users?.[config.userId]?.auth, token = auth?.token || auth?.access_token;
  requireThat(typeof token === "string" && token, "Authorized Netlify session unavailable");
  return async (route, { raw = false, method = "GET" } = {}) => {
    const response = await fetch("https://api.netlify.com/api/v1" + route, { method, headers: { Authorization: "Bearer " + token, ...(raw ? { "Content-Type": "application/vnd.bitballoon.v1.raw" } : {}) }, redirect: "error", signal: AbortSignal.timeout(30000) });
    requireThat(response.ok, "Netlify operation failed with HTTP " + response.status);
    return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}
async function served(origin, route) {
  const response = await fetch(origin + route, { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
  requireThat(response.ok && new URL(response.url).origin === origin, "Reviewed website route is unavailable or redirects externally");
  const bytes = Buffer.from(await response.arrayBuffer()), names = ["cache-control", "content-security-policy", "referrer-policy", "x-content-type-options", "x-frame-options"];
  return { sha: sha1(bytes), size: bytes.length, finalPath: new URL(response.url).pathname, headers: Object.fromEntries(names.map(name => [name, response.headers.get(name)])) };
}
async function verifyArtifact(context, api, fetchServed = served) {
  const { root, run, deploymentId, previous, metadataPath, before, preflight } = context;
  const deploy = await api(`/deploys/${deploymentId}`);
  requireThat(deploy.id === deploymentId && deploy.site_id === SITE && ["ready", "current"].includes(deploy.state), "Candidate deployment is not an immutable ready artifact for this site");
  requireThat(Number.isFinite(Date.parse(deploy.created_at)) && Date.parse(deploy.created_at) >= Date.parse(preflight.checkedAt), "Candidate predates the fresh release preflight");
  const local = localInventory(path.join(root, "production-dist")), provider = normalizeInventory(await api(`/deploys/${deploymentId}/files`), deploymentId);
  compareArtifact(local, provider, metadataPath); preserveBefore(before, provider, metadataPath);
  const providerMap = new Map(provider.map(row => [row.path, row])), beforeMap = new Map(before.map(row => [row.path, row]));
  const rawFile = (id, name) => api(`/deploys/${id}/files/` + name.slice(1).split("/").map(encodeURIComponent).join("/"), { raw: true });
  for (const name of PUBLIC_FILES) {
    const old = await rawFile(previous, name), next = await rawFile(deploymentId, name), expected = beforeMap.get(name);
    requireThat(expected && old.length === expected.size && sha1(old) === expected.sha && next.equals(old), "Approved marketing, feedback or P icon bytes differ");
    const capture = path.join(run, "approved-public", name.slice(1));
    if (PUBLIC_FILES.slice(0, 3).includes(name)) requireThat(fs.existsSync(capture), "Freshly captured approved public document is missing");
    if (fs.existsSync(capture)) requireThat(fs.readFileSync(safePath(run, capture)).equals(old), "Freshly captured approved public document changed");
  }
  const oldConfig = await rawFile(previous, metadataPath), newConfig = await rawFile(deploymentId, metadataPath);
  requireThat(sha1(oldConfig) === beforeMap.get(metadataPath)?.sha && oldConfig.length === beforeMap.get(metadataPath)?.size && sha1(newConfig) === providerMap.get(metadataPath)?.sha && newConfig.length === providerMap.get(metadataPath)?.size, "Provider configuration byte readback differs");
  requireThat(digest(effectiveConfig(oldConfig)) === digest(effectiveConfig(newConfig)), "Effective redirects or headers changed");
  const origin = `https://${deploymentId}--posetek.netlify.app`, priorOrigin = `https://${previous}--posetek.netlify.app`, routes = [];
  for (const route of preflight.served) {
    const response = await fetchServed(origin, route.path);
    requireThat(response.sha === route.sha, "Freshly captured served marketing bytes differ"); routes.push({ path: route.path, ...response });
  }
  const app = await fetchServed(origin, "/application.html");
  for (const name of [...APP_ROUTES, ...FEEDBACK_ROUTES]) {
    const [old, next] = await Promise.all([fetchServed(priorOrigin, name), fetchServed(origin, name)]);
    requireThat(digest(old.headers) === digest(next.headers) && old.finalPath === next.finalPath, "Effective application or feedback route headers/redirect changed");
    requireThat(next.sha === (APP_ROUTES.includes(name) ? app.sha : old.sha), "Application fallback or isolated feedback rewrite differs");
    routes.push({ path: name, ...next });
  }
  write(run, "candidate-inventory.json", provider); write(run, "local-inventory.json", local); write(run, "candidate-route-audit.json", routes);
  return { schemaVersion: 1, accepted: true, checkedAt: new Date().toISOString(), deploymentId, previousDeploymentId: previous, siteId: SITE, localInventorySha256: digest(local), providerInventorySha256: digest(provider), beforeInventorySha256: digest(before), committedBaselineSha256: context.baselineDigest, localFiles: local.length, providerFiles: provider.length, preservedBeforeFiles: before.length - 2, addedFiles: provider.filter(row => !beforeMap.has(row.path)).length, publicFilesByteVerified: PUBLIC_FILES.length, effectiveConfigurationPreserved: true, checkedRoutes: routes.length };
}
function readContext(options, root, baselineBytes) {
  const run = path.resolve(root, options.runDir); safePath(path.join(root, ".netlify"), run);
  const baseline = JSON.parse(baselineBytes), preflight = json(path.join(run, "preflight.json")), before = normalizeInventory(json(path.join(run, "before-inventory.json")), preflight.previousDeploymentId);
  requireThat(/^[a-f0-9]{24}$/.test(preflight.previousDeploymentId) && options.deploymentId !== preflight.previousDeploymentId && (baseline.deploymentId === preflight.previousDeploymentId || options.mode === "verify-production" && baseline.deploymentId === options.deploymentId), "Candidate or committed baseline differs from the fresh preflight");
  const metadataPath = baseline.platformConfig?.path; requireThat(metadataPath === "/netlify.toml", "Unexpected provider metadata exception");
  requireThat(preflight.providerFiles === before.length && Array.isArray(preflight.served) && preflight.served.length > 0, "Fresh website preflight is incomplete");
  requireThat(Number.isFinite(Date.parse(preflight.checkedAt)), "Fresh website preflight timestamp is missing");
  if (baseline.deploymentId === preflight.previousDeploymentId) {
    const records = new Map(before.map(row => [row.path, row]));
    requireThat(Array.isArray(baseline.files) && baseline.files.length > 0 && baseline.files.every(row => { const peer = records.get(row.path); return peer?.sha === row.sha && peer.size === row.size; }) && records.get(metadataPath)?.sha === baseline.platformConfig.sha && records.get(metadataPath)?.size === baseline.platformConfig.size, "Fresh inventory differs from the committed protected baseline");
  }
  return { root, run, deploymentId: options.deploymentId, previous: preflight.previousDeploymentId, metadataPath, before, preflight, baselineDigest: sha256(baselineBytes) };
}
async function runMode(options, { root = ROOT, api = authorizedApi(), fetchServed = served, baselineBytes } = {}) {
  baselineBytes ||= cp.execFileSync("git", ["show", "HEAD:deployment/homepage-baseline.json"], { cwd: root, windowsHide: true });
  const context = readContext(options, root, baselineBytes), { run, deploymentId, previous } = context;
  const site = await api(`/sites/${SITE}`), current = site.published_deploy?.id;
  if (options.mode === "verify-draft") {
    requireThat(current === previous, "Production changed before draft verification");
    const audit = await verifyArtifact(context, api, fetchServed);
    requireThat((await api(`/sites/${SITE}`)).published_deploy?.id === previous, "Production changed during draft verification");
    write(run, "draft-audit.json", audit); return audit;
  }
  const audit = json(path.join(run, "draft-audit.json"));
  requireThat(audit.accepted === true && audit.deploymentId === deploymentId && audit.previousDeploymentId === previous && audit.beforeInventorySha256 === digest(context.before), "Stored accepted artifact audit is missing or bound to another deployment");
  requireThat(digest(localInventory(path.join(root, "production-dist"))) === audit.localInventorySha256, "Reviewed local artifact changed after acceptance");
  if (options.mode === "promote") {
    requireThat(audit.committedBaselineSha256 === context.baselineDigest, "Committed preservation baseline changed after the audit");
    const evidencePath = safePath(path.join(root, ".netlify"), path.resolve(root, options.browserEvidence));
    const browser = browserEvidence(json(evidencePath), deploymentId, audit.localInventorySha256);
    const intent = path.join(run, "promotion-intent.json");
    if (current === deploymentId && fs.existsSync(intent)) return verifyProduction();
    requireThat(current === previous, "Production differs from the expected committed baseline");
    requireThat(!fs.existsSync(intent), "Promotion outcome is unresolved; inspect production before any retry");
    const fresh = await verifyArtifact(context, api, fetchServed);
    requireThat(fresh.localInventorySha256 === audit.localInventorySha256 && fresh.providerInventorySha256 === audit.providerInventorySha256 && (await api(`/sites/${SITE}`)).published_deploy?.id === previous, "Reviewed artifact or production changed before promotion");
    write(run, "browser-acceptance.json", browser);
    write(run, "promotion-intent.json", { deploymentId, previousDeploymentId: previous, artifactDigest: audit.localInventorySha256, browserEvidenceDigest: digest(browser), recordedAt: new Date().toISOString() }, true);
    try { await api(`/sites/${SITE}/deploys/${deploymentId}/restore`, { method: "POST" }); }
    catch { write(run, "promotion-outcome.json", { deploymentId, outcome: "uncertain", checkedAt: new Date().toISOString() }); }
    requireThat((await api(`/sites/${SITE}`)).published_deploy?.id === deploymentId, "Promotion is not confirmed; inspect production and do not replay blindly");
  } else requireThat(current === deploymentId, "Production is not the accepted candidate");
  return verifyProduction();
  async function verifyProduction() {
    requireThat((await api(`/sites/${SITE}`)).published_deploy?.id === deploymentId, "Production does not point to the reviewed candidate");
    const fresh = await verifyArtifact(context, api, fetchServed);
    requireThat(fresh.localInventorySha256 === audit.localInventorySha256 && fresh.providerInventorySha256 === audit.providerInventorySha256, "Production artifact differs from accepted draft");
    const direct = [];
    for (const row of json(path.join(run, "candidate-route-audit.json"))) {
      const response = await fetchServed("https://posetek.net", row.path);
      requireThat(response.sha === row.sha && digest(response.headers) === digest(row.headers) && response.finalPath === row.finalPath, "Primary-host served content or effective headers differ from the reviewed draft");
      direct.push({ path: row.path, ...response });
    }
    requireThat((await api(`/sites/${SITE}`)).published_deploy?.id === deploymentId, "Production changed during verification");
    const receipt = { ...fresh, status: "published_verified", primaryHostRoutes: direct.length, promotion: "Exact accepted draft restored without rebuilding" };
    write(run, "production-route-audit.json", direct); write(run, "production-audit.json", receipt); write(run, "promotion-outcome.json", { deploymentId, outcome: "confirmed", checkedAt: new Date().toISOString() });
    return receipt;
  }
}
module.exports = { argumentsFor, localInventory, normalizeInventory, compareArtifact, preserveBefore, effectiveConfig, browserEvidence, readContext, runMode, SITE, PUBLIC_FILES, APP_ROUTES, FEEDBACK_ROUTES, digest };
if (require.main === module) {
  Promise.resolve().then(() => {
    const options = argumentsFor(process.argv.slice(2)), run = path.resolve(ROOT, options.runDir);
    safePath(path.join(ROOT, ".netlify"), run);
    requireThat(cp.spawnSync("git", ["check-ignore", "--quiet", run], { cwd: ROOT, windowsHide: true }).status === 0, "Run directory must be ignored");
    return runMode(options);
  }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error("Website release stopped: " + error.message); process.exitCode = 1; });
}
