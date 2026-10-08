// Standing guest-UI checks against this checkout's compiled application.
// This is deliberately not authenticated Firebase or production smoke coverage.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from '../app/node_modules/playwright/index.mjs';
import { createHomepagePreviewServer } from './serve-homepage-preview.mjs';

let server, browser, origin;
before(async () => {
  const outputUrl = new URL('../app/astro-dist/', import.meta.url);
  const output = fileURLToPath(outputUrl);
  for (const entry of ['index.html', 'coaches/index.html', 'feedback.html', 'application.html']) {
    await stat(new URL(entry, outputUrl));
  }
  server = createHomepagePreviewServer({ marketingRoot: output, referenceRoot: output });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(); // Missing browser is a failure, never a skip.
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function pageFor(t) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // The current application embeds production Firebase identifiers. Containment
  // precedes navigation: no non-local HTTP request reaches a server, including analytics.
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    // Give external font stylesheets an empty local response so CSS readiness
    // does not depend on how the browser handles an aborted @import.
    if (route.request().resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (new URL(request.url()).origin === origin) t.diagnostic(`Local request failed: ${request.url()} ${request.failure()?.errorText}`); });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'guest flow raised an uncaught browser error');
  });
  return page;
}

for (const [route, title] of [
  ['/', 'PoseTek | Start with evidence. Train what’s next.'],
  ['/coaches', 'PoseTek for Coaches & Clubs | Start with every player.'],
  ['/feedback', 'Give feedback | PoseTek'],
]) {
  test(`compiled Astro ${route} serves its own public entry`, { timeout: 30_000 }, async t => {
    const page = await pageFor(t);
    const response = await page.goto(origin + route);
    assert.equal(response.status(), 200);
    assert.equal(await page.title(), title);
  });
}

for (const route of ['/signin', '/kickai.html']) {
  test(`guest sign-in ${route}: player account dialog opens and closes`, { timeout: 30_000 }, async t => {
    const page = await pageFor(t);
    await page.goto(origin + route);
    await page.locator('#loginSubmit').waitFor({ state: 'visible' });
    assert.equal(await page.title(), 'Sign In | PoseTek');
    await page.locator('#getStartedBtn').click();
    await page.getByRole('heading', { name: 'Create your player account' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close account creation' }).click();
    await page.locator('#signupModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#loginSubmit').isVisible(), true);
  });
}

test('guest admin deep link offers sign-in without rendering privileged controls', { timeout: 30_000 }, async t => {
  const page = await pageFor(t);
  await page.goto(origin + '/admin');
  const link = page.getByRole('link', { name: 'Go to sign in' });
  await link.waitFor({ state: 'visible' });
  assert.equal(await link.getAttribute('href'), '/signin?returnTo=%2Fadmin');
  await link.click();
  await page.locator('#loginSubmit').waitFor({ state: 'visible' });
});

test('privacy deep link survives a full reload', { timeout: 30_000 }, async t => {
  const page = await pageFor(t);
  await page.goto(origin + '/privacy');
  await page.getByRole('heading', { name: 'PoseTek Privacy Policy', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'PoseTek Privacy Policy', exact: true }).waitFor();
  assert.equal(await page.title(), 'Privacy Policy | PoseTek');
});
