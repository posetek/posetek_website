import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'scripts/run-rules-tests.mjs');

function fixture(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posetek-rules-runner-test-'));
  const firestore = path.join(directory, 'firestore.rules');
  const storage = path.join(directory, 'storage.rules');
  const firebase = path.join(directory, 'fake-firebase.mjs');
  const capture = path.join(directory, 'capture.json');
  fs.writeFileSync(firestore, 'firestore fixture\n');
  fs.writeFileSync(storage, 'storage fixture\n');
  fs.writeFileSync(firebase, `import fs from 'node:fs';
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args, config}));
if (process.env.FAKE_CHANGE_RULES === '1') fs.appendFileSync(process.env.RULES_PATH, 'changed\\n');
process.exit(Number(process.env.FAKE_EXIT || '0'));
`);
  const run = (args = [], extra = {}) => spawnSync(process.execPath, [runner, ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, FIREBASE_BIN: firebase, RULES_PATH: firestore,
      STORAGE_RULES_PATH: storage, CAPTURE_PATH: capture, RULES_PORT_OFFSET: '12000', ...extra },
  });
  try { action({ run, capture, firestore, storage }); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('rules runner rejects unknown suites and unsafe offsets before starting an emulator', () => {
  fixture(({ run, capture }) => {
    for (const [args, env] of [[['unknownSuite'], {}], [['adminRules'], { RULES_PORT_OFFSET: '-1' }],
      [['adminRules'], { RULES_PORT_OFFSET: '56237' }]]) {
      const result = run(args, env);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(fs.existsSync(capture), false, 'Firebase must not be invoked');
    }
  });
});

test('selected rules suite receives a disposable loopback demo configuration for exact source files', () => {
  fixture(({ run, capture, firestore, storage }) => {
    const result = run(['socialRules']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pass  socialRules/);
    const { args, config } = JSON.parse(fs.readFileSync(capture, 'utf8'));
    assert.equal(args[0], 'emulators:exec');
    assert.equal(args[args.indexOf('--project') + 1], 'demo-posetek-feed');
    assert.equal(args[args.indexOf('--only') + 1], 'firestore,storage');
    assert.match(args.at(-1), /socialRules\.emulator\.mjs/);
    assert.equal(config.firestore.rules, firestore);
    assert.equal(config.storage.rules, storage);
    for (const service of ['firestore', 'storage', 'hub', 'logging']) {
      assert.equal(config.emulators[service].host, '127.0.0.1');
    }
    assert.equal(config.emulators.firestore.port, 20189);
    assert.equal(config.emulators.storage.port, 21299);
    assert.equal(config.emulators.ui.enabled, false);
  });
});

test('a failed suite or rules changed during execution cannot report a passing receipt', () => {
  fixture(({ run, capture }) => {
    const failed = run(['adminRules'], { FAKE_EXIT: '7' });
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stdout, /FAIL  adminRules/);
    assert.equal(fs.existsSync(capture), true);
    fs.rmSync(capture);
    const changed = run(['adminRules'], { FAKE_CHANGE_RULES: '1' });
    assert.equal(changed.status, 1, changed.stderr);
    assert.match(changed.stderr, /rules files changed during the run/);
  });
});
