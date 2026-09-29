import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createHomepagePreviewServer } from './serve-homepage-preview.mjs';

test('marketing preview keeps coaches routes separate and serves seekable drill media', async () => {
  const directory = await mkdtemp(join(resolve(tmpdir()), 'posetek-marketing-preview-'));
  const marketingRoot = join(directory, 'marketing'), referenceRoot = join(directory, 'reference');
  const put = async (file, value) => { const target = join(directory, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
  const server = createHomepagePreviewServer({ marketingRoot, referenceRoot });
  try {
    await put('marketing/index.html', 'Players entry');
    await put('marketing/coaches/index.html', 'Coaches entry');
    await put('marketing/assets/drill.mp4', Buffer.from('0123456789'));
    await put('marketing/_astro/react.12345678.js', 'Astro React island');
    await put('reference/application.html', 'Preserved application');
    await put('reference/marketing/home-navigation.js', 'Preserved navigation bridge');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const [route, expected] of [
      ['/', 'Players entry'], ['/index.html', 'Players entry'],
      ['/coaches', 'Coaches entry'], ['/coaches/', 'Coaches entry'], ['/coaches/index.html', 'Coaches entry'],
      ['/admin/organizations', 'Preserved application'], ['/signin', 'Preserved application'],
      ['/marketing/home-navigation.js', 'Preserved navigation bridge'],
      ['/_astro/react.12345678.js', 'Astro React island'],
      ['/profile.html', 'Preserved application'],
    ]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), expected, route);
    }
    const video = await fetch(base + '/marketing/assets/drill.mp4');
    assert.equal(video.status, 200);
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    assert.equal(video.headers.get('accept-ranges'), 'bytes');
    assert.equal(await video.text(), '0123456789');
    for (const [range, expected, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/10'],
      ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'],
      ['bytes=8-99', '89', 'bytes 8-9/10'],
    ]) {
      const response = await fetch(base + '/marketing/assets/drill.mp4', { headers: { Range: range } });
      assert.equal(response.status, 206, range);
      assert.equal(response.headers.get('content-range'), contentRange, range);
      assert.equal(Number(response.headers.get('content-length')), expected.length, range);
      assert.equal(await response.text(), expected, range);
    }
    const head = await fetch(base + '/marketing/assets/drill.mp4', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(await head.text(), '');
    for (const range of ['bytes=20-', 'bytes=8-3', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6']) {
      const response = await fetch(base + '/marketing/assets/drill.mp4', { headers: { Range: range } });
      assert.equal(response.status, 416, range);
      assert.equal(response.headers.get('content-range'), 'bytes */10', range);
    }
    assert.equal((await fetch(base + '/marketing/assets/missing.mp4')).status, 404);
    assert.equal((await fetch(base + '/coaches', { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('posetek-marketing-preview-'));
    await rm(directory, { recursive: true, force: true });
  }
});
