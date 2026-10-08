import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reviewedMobileRules } from './authenticated-emulator-source.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function checkout() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'posetek-reviewed-rules-'));
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', 'git@github.com:posetek/posetek-mobile-app.git');
  mkdirSync(path.join(dir, 'firebase'));
  for (const name of ['firestore.rules', 'storage.rules']) writeFileSync(path.join(dir, 'firebase', name), `rules for ${name}\n`);
  git(dir, 'add', 'firebase');
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'Synthetic rules');
  return { dir, sha: git(dir, 'rev-parse', 'HEAD'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('explicit canonical mobile checkout and full reviewed SHA provide both private rule files', () => {
  const source = checkout();
  try {
    const rules = reviewedMobileRules(source.dir, source.sha);
    assert.equal(rules.repo, realpathSync(source.dir));
    assert.equal(rules.sha, source.sha);
    assert.equal(rules.firestore, path.join(realpathSync(source.dir), 'firebase/firestore.rules'));
    assert.equal(rules.storage, path.join(realpathSync(source.dir), 'firebase/storage.rules'));
  } finally { source.cleanup(); }
});

test('missing, short, mismatched and noncanonical source identity fail before emulator launch', () => {
  const source = checkout();
  try {
    assert.throws(() => reviewedMobileRules('', source.sha), /explicit absolute/);
    assert.throws(() => reviewedMobileRules(source.dir, source.sha.slice(0, 12)), /full lowercase/);
    assert.throws(() => reviewedMobileRules(source.dir, '0'.repeat(40)), /HEAD differs/);
    git(source.dir, 'remote', 'set-url', 'origin', 'git@github.com:someone/fork.git');
    assert.throws(() => reviewedMobileRules(source.dir, source.sha), /canonical/);
  } finally { source.cleanup(); }
});

test('dirty or symlinked canonical rules cannot be used as reviewed bytes', () => {
  const source = checkout();
  try {
    appendFileSync(path.join(source.dir, 'firebase/firestore.rules'), '// changed\n');
    assert.throws(() => reviewedMobileRules(source.dir, source.sha), /differs from the reviewed commit/);
    git(source.dir, 'checkout', '--', 'firebase/firestore.rules');
    rmSync(path.join(source.dir, 'firebase/storage.rules'));
    symlinkSync(path.join(source.dir, 'firebase/firestore.rules'), path.join(source.dir, 'firebase/storage.rules'));
    assert.throws(() => reviewedMobileRules(source.dir, source.sha), /cannot be a symlink/);
  } finally { source.cleanup(); }
});

test('assume-unchanged cannot hide modified private rule bytes', () => {
  const source = checkout();
  try {
    git(source.dir, 'update-index', '--assume-unchanged', 'firebase/firestore.rules');
    appendFileSync(path.join(source.dir, 'firebase/firestore.rules'), '// hidden edit\n');
    assert.equal(git(source.dir, 'status', '--porcelain', '--', 'firebase/firestore.rules'), '');
    assert.throws(() => reviewedMobileRules(source.dir, source.sha), /bytes differ from the reviewed commit/);
  } finally { source.cleanup(); }
});
