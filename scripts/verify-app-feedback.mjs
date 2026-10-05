// Synthetic browser acceptance only. All external traffic is intercepted; this
// script cannot send feedback or touch live player/admin records.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../app/package.json", import.meta.url));
const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
let playwright;
try { playwright = require("playwright"); }
catch (error) {
  const packageRoot = argument("--package-root", process.env.POSETEK_BROWSER_PACKAGE_ROOT);
  if (!packageRoot) throw new Error("Playwright is unavailable. Restore app dependencies or provide --package-root with the bundled node_modules path returned by load_workspace_dependencies.", { cause: error });
  playwright = require(resolve(packageRoot, "playwright"));
}
const { chromium } = playwright;
const base = new URL(argument("--base", "http://127.0.0.1:4321"));
const hosted = args.includes("--hosted");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
const developmentFixtures = args.includes("--dev-auth-fixtures");
assert(!base.username && !base.password && !base.search && !base.hash && ["", "/"].includes(base.pathname), "Use an origin URL without credentials, path, query or fragment.");
assert(local || hosted && base.protocol === "https:" && !base.port
  && (base.hostname === "posetek.net" || /^[0-9a-f]{24}--posetek\.netlify\.app$/.test(base.hostname)),
"Use a local preview server, or --hosted with https://posetek.net or an exact PoseTek 24-hex deploy URL.");
assert(!hosted || args.includes("--public-only"), "Hosted review requires --public-only; admin sample preview is available only in development.");
assert(!developmentFixtures || local && !hosted, "Development Auth fixtures require a local Astro development server.");
const output = resolve(root, argument("--output", ".netlify/app-feedback-browser"));
const outputRelative = relative(resolve(root, ".netlify"), output);
assert(outputRelative && !outputRelative.startsWith(`..${sep}`) && outputRelative !== "..", "Screenshots must stay in ignored .netlify output.");
const endpoint = "https://us-central1-kickai-69dd0.cloudfunctions.net/receiveAppFeedback";
const widths = [320, 390, 820, 1440];
const report = { base: base.origin, hosted, synthetic: true, liveWrites: 0, screenshots: [], checks: [], publicRequests: [], publicErrors: [], publicCspErrors: [], adminErrors: [], adminCspErrors: [] };
await mkdir(output, { recursive: true });
const executablePath = argument("--browser-executable", undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const publicContexts = [];
// Synthetic cookies demonstrate that credential-free cross-origin requests do
// not inherit account cookies, even when the browser has some stored.
await context.addCookies([{ name: "synthetic-local-account", value: "not-a-real-account", url: base.origin },
  { name: "synthetic-endpoint-account", value: "not-a-real-account", url: endpoint }]);

function pass(name) { report.checks.push(name); }
async function screenshot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(output, file), fullPage: true });
  report.screenshots.push(file);
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(dimensions.html <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1, `${label} has horizontal overflow: ${JSON.stringify(dimensions)}`);
  pass(`${label}: no horizontal overflow`);
}
const authStorageKey = "firebase:authUser:AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs:[DEFAULT]";
const syntheticAccount = { uid: "synthetic-feedback-account-a", label: "Synthetic player A", email: "synthetic-feedback-a@example.test" };
function syntheticToken(account, revision = 0) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: "https://securetoken.google.com/kickai-69dd0", aud: "kickai-69dd0", auth_time: now - 300,
    user_id: account.uid, sub: account.uid, iat: now, exp: now + 3600, email: account.email, test_revision: revision,
    firebase: { identities: {}, sign_in_provider: account.anonymous ? "anonymous" : "custom" } })).toString("base64url");
  return `${header}.${claims}.synthetic-signature`;
}
function syntheticAuthRecord(account) {
  return { uid: account.uid, email: account.email, emailVerified: true, displayName: account.label, isAnonymous: Boolean(account.anonymous), providerData: [],
    stsTokenManager: { refreshToken: "synthetic-refresh-only", accessToken: syntheticToken(account), expirationTime: Date.now() + 3600000 },
    createdAt: String(Date.now() - 3600000), lastLoginAt: String(Date.now()), apiKey: "AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs", appName: "[DEFAULT]" };
}
function mockAdapterModule(account, failFirstReady) {
  return `
const state = window.__feedbackAuthHarness = { current: ${JSON.stringify(account)}, listeners: new Set(), failures: ${failFirstReady ? 1 : 0} };
state.switchTo = next => { state.current = next; for (const listener of state.listeners) listener(next); };
export function createFeedbackAuthAdapter() { return {
  async ready() { if (state.failures > 0) { state.failures--; throw new Error('Synthetic auth initialization failure'); } return state.current; },
  subscribe(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  isCurrent(uid) { return (state.current?.uid ?? null) === uid; },
  async tokenFor(uid) { if (state.current?.uid !== uid) throw new Error('Account changed'); return 'synthetic-adapter-token'; }
}; }`;
}
async function publicPage(source = "direct", { preview = false, failFirstSubmission = false,
  account = source === "workout" || source === "results" ? syntheticAccount : null, expectGate = false, adapterMock = false, expectAuthFailure = false } = {}) {
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  publicContexts.push(publicContext);
  await publicContext.addCookies([{ name: "synthetic-endpoint-account", value: "not-a-real-account", url: endpoint }]);
  if (account && !preview && !adapterMock) await publicContext.addInitScript(({ key, value, origin }) => {
    if (location.origin === origin) localStorage.setItem(key, JSON.stringify(value));
  }, { key: authStorageKey, value: syntheticAuthRecord(account), origin: base.origin });
  const page = await publicContext.newPage();
  const state = { posts: [], requests: [], authRequests: [], externalAttempts: [], errors: [], failedSubmission: false, tokenRevision: 0 };
  page.on("pageerror", error => { state.errors.push(error.message); report.publicErrors.push(error.message); });
  page.on("console", message => { if (message.type() === "error" && /Content Security Policy|Content-Security-Policy|violates.*directive/i.test(message.text())) report.publicCspErrors.push(message.text()); });
  page.on("request", request => { const item = { url: request.url(), method: request.method(), resource: request.resourceType() }; state.requests.push(item); report.publicRequests.push(item); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (adapterMock && !hosted && url.pathname.endsWith("/src/pages/feedback/feedback-auth.ts")) {
      await route.fulfill({ status: 200, contentType: "text/javascript", body: mockAdapterModule(account, expectAuthFailure) }); return;
    }
    if (url.origin === base.origin && ["GET", "HEAD"].includes(request.method())) { await route.continue(); return; }
    if (request.url() === endpoint) {
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };
      if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
      assert.equal(request.method(), "POST");
      const requestHeaders = await request.allHeaders();
      assert(!requestHeaders.cookie && !requestHeaders.referer, "Feedback inherited cookies or referrer.");
      const body = request.postData();
      const payload = JSON.parse(body);
      assert.equal(payload.formVersion, 2);
      assert(["account", "anonymous"].includes(payload.identityMode));
      if (payload.event === "submitted" && payload.identityMode === "account") assert(requestHeaders.authorization?.startsWith("Bearer "), "Account feedback lacked its ID token.");
      else assert(!requestHeaders.authorization, "Anonymous feedback or diagnostics sent an account token.");
      assert.equal(payload.entrySource, source);
      assert.match(payload.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert(Object.keys(payload).every(key => ["formVersion", "event", "sessionId", "entrySource", "identityMode", "answers", "durationSeconds"].includes(key)), "Unknown feedback envelope field.");
      assert(!body.includes("not-a-real-account") && !body.includes("private-url-canary") && !body.includes("playerId"), "Feedback contains an account or URL identifier.");
      assert(!body.includes("synthetic-feedback-account") && !body.includes("example.test"), "Account identity was copied into feedback JSON.");
      if (payload.answers) assert.deepEqual(Object.keys(payload.answers).sort(), ["comment", "ease", "feature", "obstruction"]);
      state.posts.push({ payload, body, authorization: requestHeaders.authorization });
      if (payload.event === "submitted" && failFirstSubmission && !state.failedSubmission) {
        state.failedSubmission = true;
        await route.fulfill({ status: 503, headers, body: JSON.stringify({ error: "synthetic-unavailable" }) });
      } else await route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true }) });
      return;
    }
    if (["identitytoolkit.googleapis.com", "securetoken.googleapis.com"].includes(url.hostname)) {
      state.authRequests.push({ url: request.url(), method: request.method() });
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
      if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
      assert(account && !preview, "Signed-out or preview form unexpectedly contacted an Auth API.");
      if (url.hostname === "identitytoolkit.googleapis.com" && url.pathname.endsWith("accounts:lookup")) {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ users: [{ localId: account.uid,
          ...(account.anonymous ? {} : { email: account.email, emailVerified: true, displayName: account.label, passwordHash: "synthetic" }),
          providerUserInfo: [], validSince: String(Math.floor(Date.now() / 1000) - 3600),
          createdAt: String(Date.now() - 3600000), lastLoginAt: String(Date.now()) }] }) });
      } else if (url.hostname === "securetoken.googleapis.com" && url.pathname.endsWith("/token")) {
        const token = syntheticToken(account, ++state.tokenRevision);
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ access_token: token, expires_in: "3600", token_type: "Bearer",
          refresh_token: "synthetic-refresh-only", id_token: token, user_id: account.uid, project_id: "kickai-69dd0" }) });
      } else throw new Error(`Unexpected Auth API request: ${url.pathname}`);
      return;
    }
    state.externalAttempts.push(request.url());
    await route.abort("blockedbyclient");
  });
  await page.goto(new URL(`/feedback?source=${source}&playerId=private-url-canary${preview ? "&preview=1" : ""}`, base).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Help us improve PoseTek." }).waitFor();
  if (expectGate) await page.getByRole("heading", { name: "Sign in to give feedback", exact: true }).waitFor();
  else if (expectAuthFailure) await page.getByRole("heading", { name: "We couldn’t check your sign-in status.", exact: true }).waitFor();
  else await page.getByRole("radio", { name: "Results", exact: true }).waitFor();
  return { page, state };
}
async function publicSafe(state) {
  assert.deepEqual(state.externalAttempts, [], "The isolated public form attempted unapproved external font, tracking or service requests.");
  assert.deepEqual(state.errors, [], "Public form had browser exceptions.");
  assert.deepEqual(report.publicCspErrors, [], "Public form had Content Security Policy failures.");
}

try {
  // Exact question flow, native keyboard controls, backward recovery, a failed
  // submission, and byte-identical retry with no credentials or identifiers.
  {
    const { page, state } = await publicPage("workout", { failFirstSubmission: true });
    await page.getByRole("note").getByText("Synthetic player A", { exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 0, "Account identification introduced a consent checkbox.");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page, `Public question 1 at ${width}px`);
      await screenshot(page, `public-question1-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const feature = page.getByRole("radio", { name: "Workouts", exact: true });
    await feature.focus();
    await page.keyboard.press("Space");
    assert(await feature.isChecked(), "Keyboard selection did not work.");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByText("How easy was it to do what you wanted?", { exact: true }).waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page, `Public question 2 at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const ease = page.getByRole("radio", { name: "Very easy", exact: true });
    await ease.focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByText("Did anything get in your way?", { exact: true }).waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page, `Public question 3 at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const obstruction = page.getByRole("radio", { name: "Couldn’t find something", exact: true });
    await obstruction.focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    assert(await page.getByRole("radio", { name: "Very easy", exact: true }).isChecked(), "Back lost the selected answer.");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    assert(await page.getByRole("radio", { name: "Couldn’t find something", exact: true }).isChecked(), "Forward lost the selected answer.");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("textbox", { name: "Anything else we should know?", exact: true }).fill("Synthetic browser check: the next workout was easy to find.");
    await screenshot(page, "public-optional-comment-390");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("textbox").inputValue(), "Synthetic browser check: the next workout was easy to find.");
    assert(await page.getByRole("textbox").isDisabled(), "Retry changed the accepted response snapshot.");
    await screenshot(page, "public-retry-390");
    await page.getByRole("button", { name: "Retry sending", exact: true }).click();
    await page.getByRole("heading", { name: "Thanks for helping us improve.", exact: true }).waitFor();
    await screenshot(page, "public-confirmed-390");
    const submitted = state.posts.filter(post => post.payload.event === "submitted");
    assert.equal(submitted.length, 2);
    assert.equal(submitted[0].body, submitted[1].body, "Retry changed the original submission.");
    assert.equal(submitted[0].payload.identityMode, "account");
    assert.notEqual(submitted[0].authorization, submitted[1].authorization, "Account retry did not refresh its ID token.");
    assert.equal(state.posts.filter(post => post.payload.event === "opened").length, 1);
    assert.equal(state.posts.filter(post => post.payload.event === "started").length, 1);
    assert.equal(new Set(state.posts.map(post => post.payload.sessionId)).size, 1);
    await publicSafe(state);
    pass("Exact questions, keyboard selection, back recovery, failed send and identical retry");
    pass("Disclosed account responses use refreshed Bearer tokens; diagnostics omit authentication");
    pass("Feedback JSON and URLs omit account identifiers, cookies, referrer and unknown fields");
    await page.close();
  }

  {
    const { page, state } = await publicPage("results");
    for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Skip question", exact: true }).click();
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("heading", { name: "No feedback sent", exact: true }).waitFor();
    assert.equal(state.posts.filter(post => post.payload.event === "submitted").length, 0);
    await screenshot(page, "public-all-skipped-390");
    await publicSafe(state);
    pass("All questions and comment can be skipped without an empty response");
    await page.close();
  }

  {
    const { page, state } = await publicPage("qr");
    await page.getByRole("note").getByText("No account is linked to this response.", { exact: false }).waitFor();
    const unused = page.getByRole("radio", { name: "Haven’t used it yet", exact: true });
    await unused.focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("heading", { name: "Thanks for helping us improve.", exact: true }).waitFor();
    const submitted = state.posts.find(post => post.payload.event === "submitted");
    assert.deepEqual(submitted?.payload.answers, { feature: "notUsed", ease: null, obstruction: null, comment: "" });
    assert.equal(submitted.payload.identityMode, "anonymous");
    assert.equal(state.authRequests.length, 0);
    await publicSafe(state);
    pass("Not-used exit sends one explicit answer without ratings or writing");
    pass("Signed-out QR responses remain anonymous without Auth API calls");
    await page.close();
  }

  {
    const { page, state } = await publicPage("message", { preview: true });
    await page.getByText("Preview · nothing you enter here will be sent", { exact: true }).waitFor();
    for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Skip question", exact: true }).click();
    await page.getByRole("textbox").fill("Synthetic preview only");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("heading", { name: "Preview complete", exact: true }).waitFor();
    assert.equal(state.posts.length, 0);
    assert.equal(state.authRequests.length, 0);
    assert.equal(state.requests.filter(request => request.url.includes("feedback-auth") || /firebase_auth|firebase\/auth/.test(request.url)).length, 0, "Preview loaded the isolated Auth module.");
    await publicSafe(state);
    pass("Preview is labeled and sends zero opens, starts, submissions or Auth requests");
    await page.close();
  }

  for (const source of ["workout", "results"]) {
    const { page, state } = await publicPage(source, { account: null, expectGate: true });
    assert.equal(await page.getByRole("radio").count(), 0, "A signed-out account entry showed questions.");
    const signIn = page.getByRole("link", { name: "Sign in to PoseTek", exact: false });
    assert.equal(await signIn.getAttribute("href"), `/signin?returnTo=${encodeURIComponent(`/feedback?source=${source}`)}`);
    assert.equal(state.posts.filter(post => post.payload.event === "submitted").length, 0);
    assert.equal(state.authRequests.length, 0);
    await noOverflow(page, `Signed-out ${source} gate at 390px`);
    if (source === "workout") await screenshot(page, "public-signin-gate-390");
    await publicSafe(state);
    pass(`Signed-out ${source} requires sign-in with a source-only return link`);
    await page.close();
  }

  {
    const anonymous = { uid: "synthetic-anonymous-auth-user", anonymous: true };
    const { page, state } = await publicPage("message", { account: anonymous });
    await page.getByRole("note").getByText("No account is linked to this response.", { exact: false }).waitFor();
    await page.getByRole("radio", { name: "Haven’t used it yet", exact: true }).check();
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("heading", { name: "Thanks for helping us improve.", exact: true }).waitFor();
    assert(state.posts.every(post => post.payload.identityMode === "anonymous" && !post.authorization));
    await publicSafe(state);
    pass("Anonymous Firebase users can send shared-link feedback without account attribution");
    await page.close();
  }

  // The adapter replacement is a development-server network fixture, never a
  // production fake identity or an application URL parameter.
  if (developmentFixtures) {
    {
      const { page, state } = await publicPage("direct", { adapterMock: true, expectAuthFailure: true });
      assert.equal(await page.getByRole("radio").count(), 0);
      assert.equal(state.posts.length, 0, "Auth initialization failure silently opened an anonymous session.");
      await page.getByRole("button", { name: "Retry checking account", exact: true }).click();
      await page.getByRole("radio", { name: "Results", exact: true }).waitFor();
      await page.getByRole("note").getByText("No account is linked to this response.", { exact: false }).waitFor();
      await publicSafe(state);
      pass("Auth initialization failure offers retry before opening a feedback session");
      await page.close();
    }
    {
      const { page, state } = await publicPage("qr", { account: syntheticAccount, adapterMock: true, failFirstSubmission: true });
      await page.getByRole("radio", { name: "Haven’t used it yet", exact: true }).check();
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await page.getByRole("alert").waitFor();
      const previousSession = state.posts.find(post => post.payload.event === "submitted").payload.sessionId;
      await page.evaluate(() => window.__feedbackAuthHarness.switchTo({ uid: "synthetic-feedback-account-b", label: "Synthetic player B" }));
      await page.getByRole("note").getByText("Synthetic player B", { exact: true }).waitFor();
      await page.getByText("Your sign-in status changed. This form has been reset. Check the account notice above before sending.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Retry sending", exact: true }).count(), 0);
      assert.equal(await page.getByRole("radio", { name: "Haven’t used it yet", exact: true }).isChecked(), false);
      await page.getByRole("radio", { name: "Haven’t used it yet", exact: true }).check();
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await page.getByRole("heading", { name: "Thanks for helping us improve.", exact: true }).waitFor();
      const submitted = state.posts.filter(post => post.payload.event === "submitted");
      assert.equal(submitted.length, 2);
      assert.notEqual(submitted[1].payload.sessionId, previousSession, "Account switch reused the previous feedback session.");
      await page.evaluate(() => window.__feedbackAuthHarness.switchTo(null));
      await page.getByRole("note").getByText("No account is linked to this response.", { exact: false }).waitFor();
      await page.getByRole("radio", { name: "Haven’t used it yet", exact: true }).check();
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await page.getByRole("heading", { name: "Thanks for helping us improve.", exact: true }).waitFor();
      const anonymousSubmission = state.posts.filter(post => post.payload.event === "submitted").at(-1);
      assert.equal(anonymousSubmission.payload.identityMode, "anonymous");
      assert(!anonymousSubmission.authorization);
      await publicSafe(state);
      pass("Account switches reset answers, failed retries and session identity; sign-out permits anonymous shared feedback");
      await page.close();
    }
  }

  if (!args.includes("--public-only")) {
    const page = await context.newPage();
    page.on("pageerror", error => { report.adminErrors.push(error.message); });
    await page.route("**/*", async route => {
      if (new URL(route.request().url()).origin === base.origin && ["GET", "HEAD"].includes(route.request().method())) await route.continue();
      else await route.abort("blockedbyclient");
    });
    await page.goto(new URL("/admin/feedback?preview=1", base).href, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "App feedback", exact: true }).waitFor();
    await page.getByText("Synthetic preview · sample responses and counts.", { exact: true }).waitFor();
    const qr = page.getByRole("img", { name: "QR code for the optional PoseTek app feedback form", exact: true });
    await qr.waitFor();
    assert((await qr.getAttribute("src")).startsWith("data:image/svg+xml"), "QR must be generated locally, without a remote image service.");
    assert.equal(await page.locator("#feedback-qr-link").inputValue(), "https://posetek.net/feedback?source=qr");
    assert.equal(await page.locator("#feedback-message-link").inputValue(), "https://posetek.net/feedback?source=message");
    await page.getByText("It took me a moment to find the next workout.", { exact: true }).waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page, `Admin sample at ${width}px`);
      await screenshot(page, `admin-feedback-${width}`);
    }
    assert.deepEqual(report.adminErrors, [], "Admin preview had browser exceptions.");
    pass("Admin synthetic review, local downloadable QR and broad-source share links");
    await page.close();
  }
  if (hosted) {
    const cleanRoutes = [];
    for (const path of ["/feedback", "/feedback/"]) {
      let url = new URL(path, base), response;
      for (let attempt = 0; attempt < 5; attempt++) {
        response = await context.request.get(url.href, { maxRedirects: 0 });
        if (response.status() < 300 || response.status() >= 400) break;
        url = new URL(response.headers().location, url);
        assert.equal(url.origin, base.origin, "A feedback clean alias redirected away from the reviewed preview.");
      }
      assert.equal(response.status(), 200, `${path} did not resolve successfully.`);
      const html = await response.text();
      assert(html.includes("posetek-feedback-entry") && !html.includes("posetek-astro-application-entry"), `${path} resolved to the authenticated application document.`);
      const headers = response.headers();
      cleanRoutes.push({ path, resolved: url.href, status: response.status(), contentSecurityPolicy: headers["content-security-policy"] || null, referrerPolicy: headers["referrer-policy"] || null });
    }
    report.cleanRoutes = cleanRoutes;
    pass("Hosted /feedback and /feedback/ serve the isolated feedback document");
    // A fresh isolated browser has no Firebase identity. Allow public font GETs
    // to inspect the served admin shell, while blocking all service/API traffic.
    const page = await context.newPage();
    page.on("pageerror", error => { report.adminErrors.push(error.message); });
    page.on("console", message => { if (message.type() === "error" && /Content Security Policy|Content-Security-Policy|violates.*directive/i.test(message.text())) report.adminCspErrors.push(message.text()); });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base.origin && ["GET", "HEAD"].includes(request.method()) || request.method() === "GET" && ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) await route.continue();
      else await route.abort("blockedbyclient");
    });
    await page.goto(new URL("/admin/feedback", base).href, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Sign in with your PoseTek account", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Share the feedback form", exact: true }).count(), 0);
    assert.equal(await page.locator(".feedback-response").count(), 0);
    const signIn = page.getByRole("link", { name: "Go to sign in", exact: true });
    assert((await signIn.getAttribute("href")).includes("returnTo=%2Fadmin%2Ffeedback"));
    await noOverflow(page, "Hosted signed-out admin at 390px");
    await screenshot(page, "hosted-admin-signed-out-390");
    assert.deepEqual(report.adminErrors, [], "Hosted signed-out admin had browser exceptions.");
    assert.deepEqual(report.adminCspErrors, [], "Hosted signed-out admin had Content Security Policy failures.");
    pass("Hosted admin feedback is guarded and reveals no responses while signed out");
    await page.close();
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  throw error;
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  await Promise.all(publicContexts.map(publicContext => publicContext.close()));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, liveWrites: 0, report: resolve(output, "report.json") }));
}
