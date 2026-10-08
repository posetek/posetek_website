// The temporary gRPC advisory exception depends on Firestore's Node transport
// remaining absent from the static browser release. Run after the Astro build.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function check(app) {
const dist = path.join(app, 'astro-dist');
const { default: config } = await import(path.join(app, 'astro.config.mjs'));
assert.equal(config.output, 'static', 'gRPC exception requires static Astro output');
assert.equal(config.adapter, undefined, 'gRPC exception forbids a server adapter');

const firestoreRoot = path.join(app, 'node_modules/@firebase/firestore');
const firestore = JSON.parse(await readFile(path.join(firestoreRoot, 'package.json'), 'utf8'));
const browser = firestore.exports['.'].browser;
const node = firestore.exports['.'].node;
assert.equal(typeof browser?.import, 'string', 'Firestore browser export must remain explicit');
assert.equal(typeof node?.import, 'string', 'Firestore Node export must remain explicit');
assert.notEqual(browser.import, node.import, 'browser must not resolve to the Node transport');
const browserBytes = await readFile(path.join(firestoreRoot, browser.import));
assert.equal(browserBytes.includes('grpc-js'), false, 'Firestore browser export must exclude gRPC transport');

assert.equal((await stat(path.join(dist, 'application.html'))).isFile(), true, 'static application entry missing');
await assert.rejects(stat(path.join(dist, 'server')), { code: 'ENOENT' });
let files = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    assert.ok(entry.isFile(), `unexpected non-file in static output: ${file}`);
    if (!/\.(?:js|mjs|cjs|html)$/.test(entry.name)) continue;
    files++;
    assert.equal((await readFile(file)).includes('grpc-js'), false, `gRPC transport leaked into ${file}`);
  }
}
await scan(dist);
assert.ok(files > 1, 'static output has no inspectable application assets');
console.log(`Static Firestore transport check passed across ${files} HTML/JS files`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await check(fileURLToPath(new URL('../app/', import.meta.url)));
}
