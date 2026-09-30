// Check the isolated marketing pages, preserved application, deep links, and assets.
// Authenticated editing/activation requires a separate authorized account pass.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const httpOnly = process.argv.includes('--http-only');
const applicationRelease = process.argv.includes('--application-release');
const bookingRelease = process.argv.includes('--booking-release');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'production-dist');
const out = path.join(root, 'app/node_modules/.cache/planner-entry-tests');
const cases = ['/signin', '/privacy', '/profile.html', '/insights', '/insights?orgId=club&teamId=team&weeks=12', '/dashboard', '/admin', '/admin/', '/admin/programs', '/admin/programs/personalized?orgId=club&players=p',
  '/admin/organizations', '/admin/accounts', '/admin/accounts/coach/c', '/admin/accounts/player/p',
  '/admin/accounts/player/p/plan/a/workout/w', '/admin/drills', '/admin/drills/d/edit',
  '/admin/analysis', '/admin/analysis/', '/admin/accounts/player/p/results',
  '/admin/accounts/player/p/results/kick', '/admin/accounts/player/p/results/kick/r',
  '/organization', '/athlete', '/administrator'];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const config = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(config, /publish = "production-dist"/);
  assert.match(config, /to = "\/application.html"/);
  for (const route of ['/coaches', '/coaches/']) {
    const rule = `from = "${route}"\n  to = "/coaches/index.html"\n  status = 200`;
    assert.ok(config.replace(/\r\n/g, '\n').includes(rule), 'Coaches rewrite missing: ' + route);
    assert.ok(config.indexOf(`from = "${route}"`) < config.indexOf('from = "/*"'), 'Coaches rewrite must precede app fallback');
  }
  assert.ok(!config.includes('/personalized-app/'), 'Obsolete split-entry rewrite remains');
  let server, browser, base = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const results = [];
  try {
    if (!base) {
      server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://local').pathname;
        const route = ['/coaches', '/coaches/'].includes(pathname) ? '/coaches/index.html' : pathname === '/' ? '/index.html' : /^\/bookperformancetest(?:\.html|\/)?$/i.test(pathname) ? '/bookperformancetest.html' : pathname;
        let file = path.resolve(dist, '.' + route);
        if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(400); res.end(); return; }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(dist, 'application.html');
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' }[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = 'http://127.0.0.1:' + server.address().port;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'deployment/homepage-baseline.json'), 'utf8'));
    assert.ok(!(applicationRelease && bookingRelease), 'Application and booking releases are separate compositions');
    const reviewedBooking = bookingRelease ? (await (await import('./build-booking-release.mjs')).verifyBookingRelease(root)).booking : undefined;
    let reviewedApplication;
    if (applicationRelease) {
      const receipt = JSON.parse(fs.readFileSync(path.join(root, '.netlify/application-release-build.json'), 'utf8'));
      assert.equal(receipt.baselineDeploymentId, manifest.deploymentId, 'Release receipt belongs to another baseline');
      reviewedApplication = receipt.application;
      assert.equal(reviewedApplication?.path, '/application.html', 'Release receipt must name the application document');
      assert.match(reviewedApplication.sha, /^[a-f0-9]{40}$/, 'Release receipt needs a SHA-1');
      assert.ok(Number.isSafeInteger(reviewedApplication.size) && reviewedApplication.size > 0, 'Release receipt needs an exact positive size');
    }
    const applicationPath = manifest.applicationPath ?? '/index.html';
    const preserveApplicationEntry = applicationPath === '/application.html';
    assert.ok(applicationPath === '/index.html' || preserveApplicationEntry, 'Unsupported baseline application path');
    assert.ok(manifest.files.some(file => file.path === applicationPath), 'Baseline application entry missing');
    if (preserveApplicationEntry) assert.ok(!manifest.files.some(file => file.path === '/index.html' || file.path.startsWith('/marketing/assets/')), 'Preservation baseline overlaps marketing output');
    assert.ok(!manifest.files.some(file => file.path === '/coaches' || file.path.startsWith('/coaches/')), 'Preservation baseline overlaps coaches output');
    const hash = bytes => require('node:crypto').createHash('sha1').update(bytes).digest('hex');
    for (const file of manifest.files) {
      const expected = reviewedApplication && file.path === '/application.html' ? reviewedApplication : reviewedBooking && file.path === '/bookperformancetest.html' ? reviewedBooking : file;
      let bytes = fs.readFileSync(path.join(dist, !preserveApplicationEntry && file.path === '/index.html' ? 'application.html' : file.path.slice(1)));
      if (!preserveApplicationEntry && file.path === '/index.html') bytes = bytes.toString('utf8').replace(/\n<!-- homepage-navigation:start -->[\s\S]*?<!-- homepage-navigation:end -->\n/g, '');
      assert.equal(typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length, expected.size, 'Verified file size changed: ' + file.path);
      assert.equal(hash(bytes), expected.sha, 'Verified file changed: ' + file.path);
    }
    if (reviewedBooking) for (const route of ['/bookPerformanceTest.html', '/bookperformancetest.html', '/bookPerformanceTest', '/bookperformancetest', '/bookperformancetest/']) {
      const response = await fetch(base + route), html = await response.text();
      assert.equal(response.status, 200, route);
      assert.ok(html.includes('<!-- posetek-booking-entry -->'), 'Booking page missing: ' + route);
    }
    const marketingPages = [
      { routes: ['/', '/index.html'], marker: '<!-- posetek-marketing-entry -->' },
      { routes: ['/coaches', '/coaches/', '/coaches/index.html'], marker: '<!-- posetek-coaches-entry -->' },
    ];
    for (const { routes, marker } of marketingPages) for (const route of routes) {
      const response = await fetch(base + route), html = await response.text();
      assert.equal(response.status, 200, route);
      assert.ok(html.includes(marker), 'Marketing page missing: ' + route);
      if (marker.includes('coaches')) {
        assert.match(html, /<title>[^<]*coach[^<]*<\/title>/i, 'Coaches title missing');
        assert.match(html, /<meta\s+name="description"\s+content="[^"]+"/, 'Coaches description missing');
        assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/posetek\.net\/coaches"/, 'Coaches canonical missing');
        assert.ok(!html.includes('<!-- posetek-marketing-entry -->'), 'Player entry rendered at coaches route');
      }
      const scripts = [...new Set([...html.matchAll(/(?:src|component-url|renderer-url)="(\/(?:marketing\/assets|_astro)\/[^"]+\.js)"/g)].map(match => match[1]))];
      assert.ok(scripts.length, 'Marketing bundle missing');
      for (const src of scripts) {
        const asset = await fetch(base + src);
        assert.equal(asset.status, 200, src);
        assert.match(asset.headers.get('content-type'), /javascript/, src);
      }
    }
    let entry;
    for (const route of cases) {
      const response = await fetch(base + route), html = await response.text();
      assert.equal(response.status, 200, route);
      const script = html.includes('<!-- posetek-astro-application-entry -->')
        ? html.match(/component-url="([^\"]+)"/)?.[1]
        : html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1];
      assert.ok(script?.startsWith('/assets/') || (script?.startsWith('/_astro/') && html.includes('client="only"')), 'Unified entry missing: ' + route);
      entry ??= script;
      assert.equal(script, entry, 'Different app served: ' + route);
      assert.ok(!html.includes('personalized-planner-entry:start'));
      assert.ok(html.includes('/marketing/home-navigation.js'), 'Home navigation bridge missing: ' + route);
    }
    let assets = 0;
    for (const directory of ['assets', '_astro'].filter(directory => fs.existsSync(path.join(dist, directory))))
    for (const file of fs.readdirSync(path.join(dist, directory)).filter(file => /\.(js|css)$/.test(file))) {
      const response = await fetch(base + '/' + directory + '/' + file);
      assert.equal(response.status, 200, file);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(dist, directory, file)), 'Asset mismatch: ' + file);
      assets++;
    }
    if (!httpOnly) {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [path.resolve(__dirname, '../app')] }));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 820, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [], failures = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) failures.push(response.url()); });
      for (const route of ['/admin/programs/personalized', '/admin/analysis', '/admin/accounts/player/p/results/kick/r']) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.getByText('Sign in with your PoseTek account', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Overflow: ' + width + route);
        await page.locator('.portal-brand').click();
        await page.waitForURL('**/admin');
        await page.goBack({ waitUntil: 'networkidle' });
        assert.equal(new URL(page.url()).pathname, route);
      }
      await page.screenshot({ path: path.join(out, 'unified-admin-' + width + '.png'), fullPage: true });
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      results.push({ width, signInGates: 3, history: true, overflow: false, errors, failures });
      await page.close();
    }
    }
    const report = { base, homepageRoutes: 2, coachesRoutes: 3, preservedFiles: manifest.files.length - (reviewedApplication ? 1 : 0), ...(reviewedApplication ? { reviewedApplication } : {}), applicationRoutes: cases.length, assets, results, browserChecks: httpOnly ? 'not exercised by this invocation' : 'passed', authenticatedWorkflows: 'not exercised' };
    fs.writeFileSync(path.join(out, 'production-entry-test-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser?.close(); server?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
