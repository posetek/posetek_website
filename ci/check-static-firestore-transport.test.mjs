import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { check } from '../scripts/check-static-firestore-transport.mjs';

async function fixture(options = {}) {
  const app = await mkdtemp(path.join(os.tmpdir(), 'posetek-static-transport-'));
  await mkdir(path.join(app, 'node_modules/@firebase/firestore/dist'), { recursive: true });
  await mkdir(path.join(app, 'astro-dist/_astro'), { recursive: true });
  await writeFile(path.join(app, 'astro.config.mjs'),
    `export default { output: ${JSON.stringify(options.output ?? 'static')}, adapter: ${JSON.stringify(options.adapter)} };`);
  await writeFile(path.join(app, 'node_modules/@firebase/firestore/package.json'), JSON.stringify({
    exports: { '.': { browser: { import: './dist/browser.js' }, node: { import: './dist/node.js' } } },
  }));
  await writeFile(path.join(app, 'node_modules/@firebase/firestore/dist/browser.js'), options.browser ?? 'browser transport');
  await writeFile(path.join(app, 'astro-dist/application.html'), '<html>application</html>');
  await writeFile(path.join(app, 'astro-dist/_astro/firebase.js'), options.bundle ?? 'browser app');
  if (options.serverDirectory) await mkdir(path.join(app, 'astro-dist/server'));
  return app;
}

test('static browser-only Firestore output satisfies the temporary exception invariant', async () => {
  const app = await fixture();
  try { await check(app); } finally { await rm(app, { recursive: true, force: true }); }
});

test('SSR, server adapter, browser transport, or shipped gRPC code invalidates the exception', async () => {
  for (const options of [
    { output: 'server' }, { adapter: 'server adapter' }, { serverDirectory: true },
    { browser: 'grpc-js' }, { bundle: '@grpc/grpc-js' },
  ]) {
    const app = await fixture(options);
    try {
      await assert.rejects(check(app), { name: 'AssertionError' }, JSON.stringify(options));
    } finally { await rm(app, { recursive: true, force: true }); }
  }
});
