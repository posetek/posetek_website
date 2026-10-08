"use strict";
// Read-only provider preflight. Saves verified public marketing/feedback bytes
// under ignored .netlify; carries no Netlify token in output or artifacts.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), cp = require("node:child_process");
const ROOT = path.resolve(__dirname, "../.."), SITE = "b1ccf990-286c-4367-bb67-ca0d9ea2a020";
const RUN = path.resolve(process.argv[2] || path.join(ROOT, ".netlify/account-recovery-web"));
const rel = path.relative(path.join(ROOT, ".netlify"), RUN);
if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || cp.spawnSync("git", ["check-ignore", "--quiet", RUN], { cwd: ROOT }).status !== 0) throw Error("Run directory must be inside ignored .netlify");
if (fs.existsSync(path.join(RUN, "preflight.json"))) throw Error("Use a fresh preflight directory");
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment/homepage-baseline.json"), "utf8"));
const PREVIOUS = baseline.deploymentId, sha = value => crypto.createHash("sha1").update(value).digest("hex");
const configPath = path.join(process.env.APPDATA || "", "netlify/Config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const current = config.users[config.userId]?.auth, token = current?.token || current?.access_token;
if (!token) throw Error("Authorized Netlify session unavailable");
async function api(route, raw = false) {
  const response = await fetch("https://api.netlify.com/api/v1" + route, { headers: { Authorization: "Bearer " + token,
    ...(raw ? { "Content-Type": "application/vnd.bitballoon.v1.raw" } : {}) }, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error("Netlify read failed with HTTP " + response.status);
  return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
}
function save(name, value) { fs.writeFileSync(path.join(RUN, name), JSON.stringify(value, null, 2) + "\n"); }
async function main() {
  const site = await api("/sites/" + SITE);
  if (site.published_deploy?.id !== PREVIOUS) throw Error("Production differs from the committed preservation baseline");
  const inventory = await api("/deploys/" + PREVIOUS + "/files");
  if (!inventory.every(row => row.site_id === SITE && row.deploy_id === PREVIOUS) || new Set(inventory.map(row => row.path.toLowerCase())).size !== inventory.length) throw Error("Provider inventory binding or uniqueness differs");
  fs.mkdirSync(RUN, { recursive: true });
  save("before-inventory.json", inventory);
  const files = [], preserved = [];
  for (const document of ["/index.html", "/coaches/index.html", "/feedback.html"]) {
    const expected = inventory.find(row => row.path === document);
    if (!expected) throw Error("Approved document missing: " + document);
    const bytes = await api("/deploys/" + PREVIOUS + "/files/" + document.slice(1), true);
    if (bytes.length !== expected.size || sha(bytes) !== expected.sha) throw Error("Raw document checksum differs: " + document);
    const target = path.join(RUN, "approved-public", document);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    const row = { path: document, sha: expected.sha, size: expected.size };
    preserved.push(row);
    if (document !== "/feedback.html") files.push(row);
  }
  const served = [];
  for (const document of ["/", "/index.html", "/coaches", "/coaches/", "/coaches/index.html"]) {
    const response = await fetch("https://posetek.net" + document, { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok || new URL(response.url).origin !== "https://posetek.net") throw Error("Marketing route failed");
    served.push({ path: document, sha: sha(Buffer.from(await response.arrayBuffer())) });
  }
  if ((await api("/sites/" + SITE)).published_deploy?.id !== PREVIOUS) throw Error("Production changed during preflight");
  save("marketing-manifest.json", { deploymentId: PREVIOUS, sourceDirectory: path.join(RUN, "approved-public"), files, served });
  save("preflight.json", { checkedAt: new Date().toISOString(), previousDeploymentId: PREVIOUS, providerFiles: inventory.length,
    protectedFiles: baseline.files.length, preservedDocuments: preserved, served, gitBuildEnabled: Boolean(site.build_settings?.repo_url),
    commitDirective: "[skip netlify]", rulesPublished: false });
  console.log(JSON.stringify({ previousDeploymentId: PREVIOUS, providerFiles: inventory.length, protectedFiles: baseline.files.length,
    marketingOriginalBytesVerified: true, feedbackOriginalBytesVerified: true, servedMarketingRoutes: served.length, productionUnchanged: true }));
}
main().catch(() => { console.error("Website preflight failed; inspect private artifacts and current baseline without exposing credentials"); process.exitCode = 1; });
