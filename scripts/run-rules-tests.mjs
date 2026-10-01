#!/usr/bin/env node
// Runs every app/rules-tests suite against the canonical rules in
// PoseTek-mobile-app/firebase/ — the only rules source (decision D5). This repo
// has no rules files and no rules-bearing firebase config: each suite gets a
// throwaway emulator config, written outside the repo, that names the canonical
// files, so nothing here can be `firebase deploy`ed as rules.
//
//   node scripts/run-rules-tests.mjs                   # every suite
//   node scripts/run-rules-tests.mjs socialRules ...   # named suites only
//
// Environment:
//   RULES_PATH, STORAGE_RULES_PATH  canonical files (default ../PoseTek-mobile-app/firebase/)
//   FIREBASE_BIN                    firebase CLI (default `firebase` on PATH)
//   JAVA_HOME / PATH                a Java 11+ runtime for the emulators
// See app/rules-tests/README.md.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firestoreRulesPath, storageRulesPath } from '../app/rules-tests/canonicalRules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebase = process.env.FIREBASE_BIN || 'firebase';
// A direct JavaScript entrypoint works on Windows without invoking a .cmd shim.
const firebaseCommand = /\.[cm]?js$/i.test(firebase) ? process.execPath : firebase;
const firebasePrefix = firebaseCommand === process.execPath ? [firebase] : [];

// project: each suite's own demo project id, so their fixtures never share an emulator.
// storage: whether the suite needs the Storage emulator as well as Firestore.
const suites = [
  { name: 'adminRules', project: 'demo-posetek-admin' },
  { name: 'insightsRules', project: 'demo-expanded-insights' },
  { name: 'workoutNotifications', project: 'demo-workout-notifications' },
  { name: 'userIssues', project: 'demo-user-issues' },
  { name: 'personalizedRules', project: 'demo-personalized-planner' },
  { name: 'personalWorkoutSetup', project: 'demo-personal-workout-setup' },
  { name: 'socialRules', project: 'demo-posetek-feed', storage: true },
  { name: 'testingEventRules', project: 'demo-posetek-testing-events' },
  { name: 'trainingExpansion', project: 'demo-personalized-planner' },
  { name: 'trainingMedia', project: 'demo-personalized-planner', storage: true },
];

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !suites.some((suite) => suite.name === name));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}. Known: ${suites.map((suite) => suite.name).join(', ')}`);
  process.exit(2);
}
for (const [variable, file] of [['RULES_PATH', firestoreRulesPath], ['STORAGE_RULES_PATH', storageRulesPath]]) {
  if (!fs.existsSync(file)) {
    console.error(`${variable}: ${file} does not exist. Point it at PoseTek-mobile-app/firebase/.`);
    process.exit(2);
  }
}

const digest = () => Object.fromEntries([firestoreRulesPath, storageRulesPath].map((file) => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const before = digest();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'posetek-rules-tests-'));
const config = path.join(scratch, 'firebase.json');
fs.writeFileSync(config, JSON.stringify({
  firestore: { rules: firestoreRulesPath },
  storage: { rules: storageRulesPath },
  emulators: {
    firestore: { host: '127.0.0.1', port: 8189 },
    storage: { host: '127.0.0.1', port: 9299 },
    hub: { host: '127.0.0.1', port: 4419 },
    logging: { host: '127.0.0.1', port: 4519 },
    ui: { enabled: false },
    singleProjectMode: true,
  },
}, null, 2));

const run = (suite) => new Promise((resolve) => {
  const only = suite.storage ? 'firestore,storage' : 'firestore';
  const script = `node ${JSON.stringify(path.join(root, 'app/rules-tests', `${suite.name}.emulator.mjs`))}`;
  const child = spawn(firebaseCommand, [...firebasePrefix, 'emulators:exec', '--project', suite.project, '--config', config, '--only', only, script], {
    cwd: root,
    env: { ...process.env, RULES_PATH: firestoreRulesPath, STORAGE_RULES_PATH: storageRulesPath },
    stdio: 'inherit',
  });
  child.on('error', (error) => { console.error(`${suite.name}: ${error.message}`); resolve(1); });
  child.on('close', (code) => resolve(code ?? 1));
});

console.log(`Firestore rules: ${firestoreRulesPath}\nStorage rules:   ${storageRulesPath}`);
const results = [];
try {
  for (const suite of suites.filter((entry) => !requested.length || requested.includes(entry.name))) {
    console.log(`\n=== ${suite.name} ===`);
    results.push([suite.name, await run(suite)]);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('\nSummary:');
for (const [name, code] of results) console.log(`  ${code === 0 ? 'pass' : 'FAIL'}  ${name}`);
const changed = JSON.stringify(before) !== JSON.stringify(digest());
if (changed) console.error('The rules files changed during the run; the results do not describe either version.');
console.log(`Rules sha256: ${Object.entries(before).map(([file, hash]) => `${path.basename(file)} ${hash}`).join(', ')}`);
process.exitCode = changed || results.some(([, code]) => code !== 0) ? 1 : 0;
