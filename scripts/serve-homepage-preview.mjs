// Local review only: updated marketing output + the pinned current public app.
// This deliberately does not modify or bypass the production build guard.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const marketing = fileURLToPath(new URL('../app/astro-dist/', import.meta.url));
const reference = fileURLToPath(new URL('../.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };

export function createHomepagePreviewServer({ marketingRoot = marketing, referenceRoot = reference } = {}) {
return createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let root = referenceRoot;
    let filePath = pathname;
    if (pathname === '/' || pathname === '/index.html' || pathname === '/marketing/' || pathname === '/marketing/index.html') {
      root = marketingRoot;
      filePath = '/index.html';
    } else if (/^\/feedback(?:\.html|\/)?$/.test(pathname)) {
      root = marketingRoot;
      filePath = '/feedback.html';
    } else if (pathname === '/coaches' || pathname === '/coaches/' || pathname === '/coaches/index.html') {
      root = marketingRoot;
      filePath = '/coaches/index.html';
    } else if (pathname.startsWith('/marketing/assets/')) {
      root = marketingRoot;
      filePath = resolve(marketingRoot) === resolve(referenceRoot) ? pathname : pathname.slice('/marketing'.length);
    } else if (pathname.startsWith('/_astro/')) {
      root = marketingRoot;
    } else if (/^\/bookperformancetest\/?$/i.test(pathname)) {
      filePath = '/bookPerformanceTest.html';
    }
    let target = resolve(root, '.' + filePath);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel === 'reference-manifest.json') { res.writeHead(400); res.end(); return; }
    let details;
    try { details = await stat(target); if (!details.isFile()) throw new Error('not file'); }
    catch {
      if ((extname(pathname) && extname(pathname) !== '.html') || pathname.startsWith('/_astro/') || pathname.startsWith('/marketing/assets/') || pathname === '/' || /^\/coaches(?:\/index\.html|\/)?$/.test(pathname)) { res.writeHead(404); res.end(); return; }
      target = resolve(referenceRoot, 'application.html');
      details = await stat(target);
    }
    const headers = { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Content-Length': details.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    let start = 0, end = details.size - 1, status = 200;
    if (req.headers.range && req.method === 'GET') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, details.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= details.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${details.size}` }); res.end(); return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${details.size}`;
      headers['Content-Length'] = end - start + 1;
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || details.size === 0) { res.end(); return; }
    const stream = createReadStream(target, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch { res.writeHead(400); res.end(); }
});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await stat(resolve(marketing, 'index.html')).catch(() => { throw new Error('Build the marketing pages first: npm --prefix app run build:marketing'); });
  await stat(resolve(marketing, 'coaches/index.html')).catch(() => { throw new Error('Build the coaches page first: npm --prefix app run build:marketing'); });
  await stat(resolve(reference, 'application.html')).catch(() => { throw new Error('Capture the public reference first: node scripts/capture-deployed-reference.mjs'); });
  const port = Number(process.env.PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  createHomepagePreviewServer().listen(port, '127.0.0.1', () => console.log(`Updated PoseTek marketing pages: http://127.0.0.1:${port} (local review only)`));
}
