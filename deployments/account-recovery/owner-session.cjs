"use strict";
// Refresh Firebase CLI with a read-only command first when needed. Copy only its
// current OAuth access token into an ignored, private operator file.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const root = path.resolve(__dirname, "../.."), output = path.resolve(process.argv[2] || path.join(root, ".netlify/account-recovery-owner.json"));
const relative = path.relative(path.join(root, ".netlify"), output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || cp.spawnSync("git", ["check-ignore", "--quiet", output], { cwd: root }).status !== 0) {
  throw new Error("Operator output must be a file inside ignored .netlify");
}
const candidates = [path.join(os.homedir(), ".config/configstore/firebase-tools.json"),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "configstore/firebase-tools.json")] : [])];
let token;
for (const filename of candidates) {
  if (!fs.existsSync(filename)) continue;
  const current = JSON.parse(fs.readFileSync(filename, "utf8")).tokens;
  if (current?.access_token && current.expires_at > Date.now() + 60000) { token = current; break; }
}
if (!token) throw new Error("Run firebase projects:list --json --non-interactive to refresh the authorized session");
fs.mkdirSync(path.dirname(output), { recursive: true });
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error("Operator output cannot be a symbolic link");
fs.writeFileSync(output, JSON.stringify({ access_token: token.access_token, expires_at: token.expires_at }) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ authorizedSessionReady: true, expiresAt: new Date(token.expires_at).toISOString() }));
