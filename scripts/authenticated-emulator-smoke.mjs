// Synthetic player signup across the local Astro app and four Firebase emulators.
// Requires cached Java 21, Firebase emulator binaries, Playwright Chromium,
// and POSETEK_MOBILE_REPO pointing at the sibling engineering-pipeline checkout.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const projectId = 'demo-posetek-website-e2e';
const offset = 100;
const ports = { auth: 19199, firestore: 18189, functions: 15101, storage: 19399, hub: 14400, logging: 14500, websocket: 14150, astro: 14321 };
const host = '127.0.0.1';
const origin = `http://${host}:${ports.astro}`;
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const { initializeTestEnvironment, assertFails } = require('../app/node_modules/@firebase/rules-unit-testing');

function exactMobileRules() {
  const mobile = process.env.POSETEK_MOBILE_REPO;
  assert.ok(mobile, 'POSETEK_MOBILE_REPO must identify the canonical local mobile checkout');
  assert.equal(path.resolve(mobile), path.resolve(root, '../../posetek-mobile-app/engineering-pipeline'),
    'mobile rules must come from the canonical sibling engineering-pipeline checkout');
  return { firestore: path.join(mobile, 'firebase/firestore.rules'), storage: path.join(mobile, 'firebase/storage.rules') };
}

async function assertFreePorts() {
  for (const port of Object.values(ports)) {
    const server = net.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve));
    await new Promise(resolve => server.close(resolve));
  }
}

function safeEnvironment(extra = {}) {
  // Do not hand local cloud credentials or app secrets to Functions subprocesses.
  const allowed = ['PATH', 'TMPDIR', 'USER', 'LANG', 'LC_ALL', 'TERM', 'JAVA_HOME', 'FIREBASE_EMULATORS_PATH', 'PLAYWRIGHT_BROWSERS_PATH'];
  const env = Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return { ...env, HOME: '/private/tmp/posetek-website-e2e-home', XDG_CONFIG_HOME: '/private/tmp/posetek-website-e2e-config',
    NO_UPDATE_NOTIFIER: '1', CI: '1', GOOGLE_CLOUD_PROJECT: projectId, GCLOUD_PROJECT: projectId, ...extra };
}

async function runOuter() {
  assert.equal(process.env.JAVA_HOME?.includes('jdk-21'), true, 'local Java 21 is required');
  assert.equal(process.env.FIREBASE_EMULATORS_PATH?.startsWith('/private/tmp/'), true, 'use cached local emulator binaries');
  assert.ok(process.env.PLAYWRIGHT_BROWSERS_PATH, 'PLAYWRIGHT_BROWSERS_PATH must identify cached local Chromium');
  await assertFreePorts();
  const rules = exactMobileRules();
  const { stat } = await import('node:fs/promises');
  await Promise.all(Object.values(rules).map(stat));
  await Promise.all(['/private/tmp/posetek-website-e2e-home', '/private/tmp/posetek-website-e2e-config'].map(dir => mkdir(dir, { recursive: true })));
  const tmp = await mkdtemp(path.join(root, '.firebase-e2e-'));
  try {
    // Firebase CLI proxies admin.firestore inside the Functions emulator and
    // loses static members such as FieldValue. Restore those members only in
    // this throwaway emulator entry; production Functions source is untouched.
    const fixture = path.join(tmp, 'functions');
    await mkdir(fixture);
    await symlink(path.join(root, 'functions/node_modules'), path.join(fixture, 'node_modules'));
    await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'posetek-local-functions-fixture', private: true,
      main: 'index.js', engines: { node: '22' }, dependencies: { 'firebase-admin': '12.7.0', 'firebase-functions': '4.9.0' } }));
    await writeFile(path.join(fixture, 'index.js'), `const adminPath = require.resolve(${JSON.stringify(path.join(root, 'functions/node_modules/firebase-admin'))});\n` +
      `const admin = require(adminPath);\n` +
      `const firestore = require(${JSON.stringify(path.join(root, 'functions/node_modules/@google-cloud/firestore'))});\n` +
      `require.cache[adminPath].exports = new Proxy(admin, { get(target, key, receiver) {\n` +
      `  const value = Reflect.get(target, key, receiver);\n` +
      `  if (key === 'firestore') for (const name of ['FieldValue', 'Timestamp', 'FieldPath', 'Filter']) value[name] ||= firestore[name];\n` +
      `  return value;\n` +
      `} });\n` +
      `module.exports = require(${JSON.stringify(path.join(root, 'functions/index.js'))});\n`);
    const config = {
      functions: { source: 'functions', runtime: 'nodejs22' },
      firestore: { rules: rules.firestore }, storage: { rules: rules.storage },
      emulators: { auth: { host, port: ports.auth }, firestore: { host, port: ports.firestore, websocketPort: ports.websocket },
        functions: { host, port: ports.functions }, storage: { host, port: ports.storage },
        hub: { host, port: ports.hub }, logging: { host, port: ports.logging }, ui: { enabled: false } },
    };
    const configFile = path.join(tmp, 'firebase.json');
    await writeFile(configFile, JSON.stringify(config));
    const cli = spawn('firebase', ['emulators:exec', '--only', 'auth,firestore,functions,storage', '--project', projectId,
      '--config', configFile, 'node scripts/authenticated-emulator-smoke.mjs --inside'],
    { cwd: root, env: safeEnvironment({ POSETEK_MOBILE_REPO: process.env.POSETEK_MOBILE_REPO }), stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { cli.once('error', reject); cli.once('exit', resolve); });
    assert.equal(code, 0, `Firebase emulator journey exited ${code}`);
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

async function waitForAstro(child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Astro dev server exited ${child.exitCode}`);
    try { const response = await fetch(origin + '/signin'); if (response.ok) return; } catch {}
    await delay(500);
  }
  throw new Error('Astro dev server did not become ready');
}

async function runInside() {
  assert.equal(process.env.GCLOUD_PROJECT, projectId);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, `${host}:${ports.auth}`);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, `${host}:${ports.firestore}`);
  assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, `${host}:${ports.storage}`);
  const astro = spawn('npm', ['--prefix', 'app', 'run', 'dev:astro', '--', '--host', host, '--port', String(ports.astro), '--mode', 'posetek-emulator-e2e'],
    { cwd: root, env: safeEnvironment({ PUBLIC_FIREBASE_EMULATOR_PORT_OFFSET: String(offset) }), stdio: 'inherit' });
  let browser;
  try {
    await waitForAstro(astro);
    admin.initializeApp({ projectId });
    const db = admin.firestore();
    const player = db.collection('players').doc('synthetic-invited-player');
    await player.set({ firstName: 'Synthetic', lastName: 'Athlete', coachUID: 'synthetic-coach', coachDocId: 'synthetic-coach',
      registered: false, signupCode: 'PLRTEST7', signupCodeVersion: 2 });
    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const allowed = new Set([origin, ...['auth', 'firestore', 'functions', 'storage'].map(service => `http://${host}:${ports[service]}`)]);
    const blocked = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === `http://${host}:${ports.functions}`) {
        // Hosted Functions arrives through a platform proxy. The local emulator
        // has none; supply its loopback peer as the proxy address for this run.
        return route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': host } });
      }
      if (allowed.has(url.origin)) return route.continue();
      blocked.push(url.origin);
      if (route.request().resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => {
      if ([ports.astro, ports.firestore, ports.websocket].some(port => new URL(socket.url()).origin === `ws://${host}:${port}`)) return socket.connectToServer();
      blocked.push(socket.url()); socket.close();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => requests.push(`${request.url()} ${request.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) requests.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + '/signin#playerCode=PLRTEST7');
    try { await page.locator('#playerCodeSubmit').waitFor({ state: 'visible', timeout: 8000 }); }
    catch (error) { throw new Error(`Signup UI did not load: ${JSON.stringify({ title: await page.title(), body: (await page.locator('body').innerText()).slice(0, 800), errors, requests, blocked })}`, { cause: error }); }
    await page.locator('#playerEmail').fill('synthetic-athlete@example.test');
    await page.locator('#playerPassword').fill('SyntheticPass123!');
    await page.locator('#playerConfirmPassword').fill('SyntheticPass123!');
    await page.locator('#playerCodeSubmit').click();
    try { await page.locator('#playerCodeSuccess').getByText(/Account created/).waitFor({ timeout: 20000 }); }
    catch (error) { throw new Error(`Signup did not complete: ${JSON.stringify({ error: await page.locator('#playerCodeError').innerText(), success: await page.locator('#playerCodeSuccess').innerText(), disabled: await page.locator('#playerCodeSubmit').isDisabled(), errors, requests, blocked, player: (await player.get()).data() })}`, { cause: error }); }
    await page.waitForURL('**/athlete?player=synthetic-invited-player', { timeout: 30000 });
    const claimed = (await player.get()).data();
    assert.equal(claimed.registered, true);
    assert.equal(claimed.signupCode, undefined);
    assert.equal(claimed.authenticationUID, claimed.userUID);
    assert.ok(claimed.authenticationUID);
    assert.equal((await admin.auth().getUserByEmail('synthetic-athlete@example.test')).uid, claimed.userUID);
    await page.waitForFunction(() => document.title === 'Synthetic Athlete | PoseTek');
    await page.reload();
    await page.waitForURL('**/athlete?player=synthetic-invited-player');
    await page.waitForFunction(() => document.title === 'Synthetic Athlete | PoseTek');
    const second = await fetch(`http://${host}:${ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'synthetic-stranger@example.test', password: 'AnotherPass123!', returnSecureToken: true }),
    });
    assert.equal(second.status, 200, 'second synthetic account must be created locally');
    const { idToken } = await second.json();
    const retry = await fetch(`http://${host}:${ports.functions}/${projectId}/us-central1/redeemPlayerSignupCode`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}`, 'x-forwarded-for': host },
      body: JSON.stringify({ data: { code: 'PLRTEST7' } }),
    });
    assert.equal(retry.status, 404, `used invitation retry returned ${retry.status}: ${await retry.text()}`);
    const rules = await initializeTestEnvironment({ projectId, firestore: { host, port: ports.firestore } });
    try {
      await assertFails(rules.authenticatedContext('synthetic-stranger').firestore().doc(player.path).get());
    } finally { await rules.cleanup(); }
    assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
    assert.deepEqual([...new Set(blocked)].filter(value => !['https://fonts.googleapis.com', 'https://images.unsplash.com'].includes(value)), []);
    await context.close();
    console.log('Authenticated emulator journey passed: signup, one-time claim, canonical UID, stranger denial, refresh');
  } finally {
    await browser?.close();
    astro.kill('SIGTERM');
    await new Promise(resolve => { if (astro.exitCode !== null) resolve(); else astro.once('exit', resolve); });
    await Promise.all(admin.apps.map(app => app.delete()));
  }
}

if (process.argv.includes('--inside')) await runInside(); else await runOuter();
