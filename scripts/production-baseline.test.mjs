import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ICON_ASSETS, mergeWebsiteIcons } from './website-icons.mjs';

const source = fileURLToPath(new URL('./', import.meta.url));
const app = '<!doctype html><html><head><script type="module" crossorigin src="/assets/current.js"></script></head><body>Current application</body></html>';
const bridgeBlock = '\n<!-- homepage-navigation:start -->\n<script src="/marketing/home-navigation.js" defer></script>\n<!-- homepage-navigation:end -->\n';
const applicationWithBridge = app.replace('</body>', bridgeBlock + '</body>');
const marketing = '<!doctype html><!-- posetek-marketing-entry --><script type="module" src="/_astro/new.12345678.js"></script>';
const coaches = '<!doctype html><!-- posetek-coaches-entry --><title>PoseTek for coaches</title><meta name="description" content="Team-by-team support"><link rel="canonical" href="https://posetek.net/coaches"><script type="module" src="/_astro/coaches.12345678.js"></script>';
const sha = bytes => createHash('sha1').update(bytes).digest('hex');

async function fixture(mode, options, run) {
  const directory = await mkdtemp(join(resolve(tmpdir()), 'posetek-production-baseline-'));
  const put = async (file, value) => { const target = join(directory, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
  try {
    const modern = mode === 'modern';
    const files = new Map([
      [modern ? '/application.html' : '/index.html', modern ? applicationWithBridge : app],
      ['/assets/current.js', '/* unchanged current application bundle */'],
      ['/bookperformancetest.html', '<!doctype html><form id="bookingForm"></form>'],
    ]);
    if (modern) files.set('/marketing/home-navigation.js', '// current published bridge\n');
    if (options.localAlias) files.set('/booking-copy.html', files.get('/bookperformancetest.html'));
    if (options.marketingAlias) {
      files.set('/index 2.html', '<html><noscript><a href="/bookPerformanceTest.html">Book</a></noscript></html>');
      await put('index.html', '<noscript><a href="/bookPerformanceTest.html">Book</a></noscript>');
    }
    if (options.overlap) files.set(options.overlap, '// do not preserve this marketing file');
    const manifest = {
      deploymentId: 'test-pinned-deployment', url: 'https://pinned.example',
      ...(modern ? { applicationPath: '/application.html' } : {}),
      files: [...files].map(([path, bytes]) => ({ path, sha: sha(bytes), size: Buffer.byteLength(bytes) })),
    };
    if (options.localAlias) {
      manifest.files.find(file => file.path === '/bookperformancetest.html').localPath = 'booking-source.html';
      await put('booking-source.html', options.badLocal ? 'incorrect original source' : files.get('/bookperformancetest.html'));
    }
    await put('deployment/homepage-baseline.json', JSON.stringify(manifest));
    await put('deployment/home-navigation.js', '// local legacy-only bridge\n');
    await put('app/astro-dist/index.html', marketing);
    await put('app/astro-dist/coaches/index.html', options.missingMarker ? coaches.replace('<!-- posetek-coaches-entry -->', '') : coaches);
    await put('app/astro-dist/_astro/new.12345678.js', '/* new isolated homepage */');
    await put('app/astro-dist/_astro/coaches.12345678.js', '/* new isolated coaches page */');
    for (const path of ICON_ASSETS) {
      const bytes = 'fixture icon bytes ' + path;
      await put('app/astro/public' + path, bytes);
      await put('app/astro-dist' + path, bytes);
    }
    await put('app/node_modules/typescript/bin/tsc', '// build tool fixture\n');
    await put('app/node_modules/astro/bin/astro.mjs', '// build tool fixture\n');
    await put('netlify.toml', '[build]\npublish = "production-dist"\n[[redirects]]\n  from = "/coaches"\n  to = "/coaches/index.html"\n  status = 200\n[[redirects]]\n  from = "/coaches/"\n  to = "/coaches/index.html"\n  status = 200\n[[redirects]]\nfrom = "/*"\nto = "/application.html"\nstatus = 200\n');
    await put('production-dist/guard-sentinel.txt', 'unchanged until guard passes');
    await mkdir(join(directory, 'scripts'), { recursive: true });
    await copyFile(join(source, 'build-production.mjs'), join(directory, 'scripts/build-production.mjs'));
    await copyFile(join(source, 'astro-assets.mjs'), join(directory, 'scripts/astro-assets.mjs'));
    await copyFile(join(source, 'website-icons.mjs'), join(directory, 'scripts/website-icons.mjs'));
    await copyFile(join(source, 'test-production-entry.cjs'), join(directory, 'scripts/test-production-entry.cjs'));

    const responses = Object.fromEntries([...files].map(([path, bytes]) => [new URL(path, 'https://pinned.example').href, bytes]));
    responses['https://posetek.net/'] = marketing;
    responses['https://posetek.net/application.html'] = options.drift ? applicationWithBridge + '\nchanged' : applicationWithBridge;
    if (options.corrupt) responses['https://pinned.example/assets/current.js'] = 'corrupted bytes';
    if (options.localAlias) for (const path of ['/bookperformancetest.html', '/booking-copy.html']) responses['https://pinned.example' + path] = '<html>pretty URL rewrite</html>';
    if (options.marketingAlias) responses['https://pinned.example/index%202.html'] = `<html>${options.aliasDrift ? 'changed' : ''}<noscript><a href='/bookperformancetest'>Book</a></noscript></html>`;
    await put('mock-fetch.mjs', `const responses = ${JSON.stringify(responses)};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init);
  if (!Object.hasOwn(responses, url)) throw new Error('Unexpected external request: ' + url);
  return new Response(responses[url], { status: 200 });
};\n`);
    const environment = { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(join(directory, 'mock-fetch.mjs')).href };
    const execute = (script, args = []) => spawnSync(process.execPath, [join(directory, 'scripts', script), ...args], { cwd: directory, env: environment, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    await run({ directory, files, execute, build: execute('build-production.mjs') });
  } finally {
    // Only remove the exact temporary fixture allocated above.
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('posetek-production-baseline-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('modern baseline preserves the complete app and bridge without reinjection', async () => {
  await fixture('modern', {}, async ({ directory, files, execute, build }) => {
    assert.equal(build.status, 0, build.stderr);
    for (const [path, bytes] of files) assert.equal(await readFile(join(directory, 'production-dist', path.slice(1)), 'utf8'), bytes);
    assert.equal(await readFile(join(directory, 'production-dist/index.html'), 'utf8'), marketing);
    assert.equal(await readFile(join(directory, 'production-dist/coaches/index.html'), 'utf8'), coaches);
    const checks = execute('test-production-entry.cjs', ['--http-only']);
    assert.equal(checks.status, 0, checks.stderr);
  });
});

test('legacy baseline still remaps the app index and adds one navigation bridge', async () => {
  await fixture('legacy', {}, async ({ directory, execute, build }) => {
    assert.equal(build.status, 0, build.stderr);
    assert.equal(await readFile(join(directory, 'production-dist/application.html'), 'utf8'), applicationWithBridge);
    assert.equal(await readFile(join(directory, 'production-dist/marketing/home-navigation.js'), 'utf8'), '// local legacy-only bridge\n');
    const checks = execute('test-production-entry.cjs', ['--http-only']);
    assert.equal(checks.status, 0, checks.stderr);
  });
});

test('candidate verification accepts only the exact built entry from the current baseline', async () => {
  await fixture('modern', {}, async ({ directory, execute, build }) => {
    assert.equal(build.status, 0, build.stderr);
    const next = applicationWithBridge.replace('Current application', 'Reviewed new application');
    await writeFile(join(directory, 'production-dist/application.html'), next);
    await mkdir(join(directory, '.netlify'), { recursive: true });
    const receipt = { baselineDeploymentId: 'test-pinned-deployment', application: { path: '/application.html', sha: sha(next), size: Buffer.byteLength(next) } };
    const save = () => writeFile(join(directory, '.netlify/application-release-build.json'), JSON.stringify(receipt));
    await save();
    assert.notEqual(execute('test-production-entry.cjs', ['--http-only']).status, 0, 'Ordinary preservation must still fail');
    let result = execute('test-production-entry.cjs', ['--http-only', '--application-release']);
    assert.equal(result.status, 0, result.stderr);
    receipt.baselineDeploymentId = 'different-production'; await save();
    result = execute('test-production-entry.cjs', ['--http-only', '--application-release']);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /another baseline/);
    receipt.baselineDeploymentId = 'test-pinned-deployment'; await save();
    await writeFile(join(directory, 'production-dist/application.html'), next + ' changed after build');
    result = execute('test-production-entry.cjs', ['--http-only', '--application-release']);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Verified file size changed/);
  });
});

test('modern live-app drift stops before modifying the output', async () => {
  await fixture('modern', { drift: true }, async ({ directory, build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Production application changed/);
    assert.equal(await readFile(join(directory, 'production-dist/guard-sentinel.txt'), 'utf8'), 'unchanged until guard passes');
  });
});

test('preserved download hash mismatches remain fatal', async () => {
  await fixture('modern', { corrupt: true }, async ({ build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Baseline checksum mismatch: \/assets\/current.js/);
  });
});

test('pinned aliases preserve identical original source bytes despite served HTML rewrites', async () => {
  await fixture('modern', { localAlias: true }, async ({ directory, files, build }) => {
    assert.equal(build.status, 0, build.stderr);
    assert.equal(await readFile(join(directory, 'production-dist/booking-copy.html'), 'utf8'), files.get('/bookperformancetest.html'));
  });
});

test('an alias never accepts a declared source with different bytes', async () => {
  await fixture('modern', { localAlias: true, badLocal: true }, async ({ build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Baseline checksum mismatch/);
  });
});

test('marketing filename alias restores a rewritten noscript only when the whole original hash matches', async () => {
  await fixture('modern', { marketingAlias: true }, async ({ directory, files, build }) => {
    assert.equal(build.status, 0, build.stderr);
    assert.equal(await readFile(join(directory, 'production-dist/index 2.html'), 'utf8'), files.get('/index 2.html'));
  });
  await fixture('modern', { marketingAlias: true, aliasDrift: true }, async ({ build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Baseline checksum mismatch/);
  });
});

for (const overlap of ['/marketing/assets/stale.js', '/coaches', '/coaches/index.html']) test(`modern preservation cannot overlap ${overlap}`, async () => {
  await fixture('modern', { overlap }, async ({ directory, build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Preservation baseline overlaps the marketing output/);
    assert.equal(await readFile(join(directory, 'production-dist/guard-sentinel.txt'), 'utf8'), 'unchanged until guard passes');
  });
});

test('coaches output requires its isolated entry marker', async () => {
  await fixture('modern', { missingMarker: true }, async ({ build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Missing coaches entry marker/);
  });
});

test('website icon merging retains exact pinned bytes and rejects collisions before copying any asset', async () => {
  for (const state of ['unchanged', 'pinned-collision', 'output-collision']) await fixture('modern', {}, async ({ directory, files, build }) => {
    assert.equal(build.status, 0, build.stderr);
    const sourceDirectory = join(directory, 'app/astro-dist'), outputDirectory = join(directory, 'production-dist');
    const pinned = ICON_ASSETS.map(path => ({ path, sha: sha('fixture icon bytes ' + path), size: Buffer.byteLength('fixture icon bytes ' + path) }));
    if (state === 'unchanged') {
      const merged = await mergeWebsiteIcons(sourceDirectory, outputDirectory, pinned);
      assert.deepEqual(merged, pinned);
      for (const path of ICON_ASSETS) assert.equal(await readFile(join(outputDirectory, path.slice(1)), 'utf8'), 'fixture icon bytes ' + path);
    } else {
      // A missing first target proves validation of a later collision completes
      // before the helper begins copying otherwise valid earlier assets.
      const first = join(outputDirectory, ICON_ASSETS[0].slice(1));
      const lastPath = ICON_ASSETS.at(-1), last = join(outputDirectory, lastPath.slice(1));
      await rm(first);
      if (state === 'pinned-collision') await writeFile(join(sourceDirectory, lastPath.slice(1)), 'changed source icon');
      else await writeFile(last, 'unrelated existing output icon');
      await assert.rejects(mergeWebsiteIcons(sourceDirectory, outputDirectory, pinned), state === 'pinned-collision' ? /Website icon collision/ : /Website icon output collision/);
      await assert.rejects(readFile(first), /ENOENT/);
      assert.equal(await readFile(last, 'utf8'), state === 'pinned-collision' ? 'fixture icon bytes ' + lastPath : 'unrelated existing output icon');
    }
    for (const [path, bytes] of files) assert.equal(await readFile(join(outputDirectory, path.slice(1)), 'utf8'), bytes);
  });
});
