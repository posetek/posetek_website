#!/usr/bin/env node
"use strict";
// Local packaging only. Never deploys, reads credentials or changes production.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const output = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !output.startsWith(path.join(root, ".netlify") + path.sep)) throw new Error("Use a NEW ignored .netlify candidate directory");
if (fs.existsSync(output)) throw new Error("Candidate directory already exists; choose a new directory");
const names = ["issue-tracker-bridge.js", "issue-tracker-bridge-model.js", "issue-tracker-bridge-seed.js", "issue-tracker-bridge-transport.js", "issue-tracker-bridge-ingress.js", "issue-tracker-bridge-entrypoints.js", "issue-tracker-recovery.js", "issue-tracker-normalize.js", "issue-tracker-graph-reader.js", "issue-tracker-evidence.js", "issue-tracker-mail-capture.js", "issue-tracker-source-capture.js", "package.json", "package-lock.json"];
const sources = names.map(name => [name, fs.readFileSync(path.join(root, "functions", name))]);
sources.push(["index.js", fs.readFileSync(path.join(__dirname, "index.js"))]);
fs.mkdirSync(path.join(output, "source"), { recursive: true });
for (const [name, bytes] of sources) fs.writeFileSync(path.join(output, "source", name), bytes, { flag: "wx" });
const config = { functions: { source: "source", codebase: "issue-tracker", runtime: "nodejs22" } };
fs.writeFileSync(path.join(output, "firebase.json"), JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
const manifest = { candidateOnly: true, deployed: false, endpoints: ["observeUserIssueTracker", "observeUserIssueTrackerOccurrence", "drainUserIssueTracker", "ingestUserIssueTrackerMail", "recoverUserIssueTracker", "captureUserIssueTrackerSources"], files: Object.fromEntries(sources.map(([name, bytes]) => [name, crypto.createHash("sha256").update(bytes).digest("hex")])) };
fs.writeFileSync(path.join(output, "candidate-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ candidateOnly: true, output, endpoints: manifest.endpoints }));
