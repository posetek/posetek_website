// Synthetic browser acceptance only. All external traffic is intercepted; this
// script cannot send feedback or touch live player/admin records.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../app/package.json", import.meta.url));
const { chromium } = require("playwright");
const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const base = new URL(argument("--base", "http://127.0.0.1:4321"));
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Browser acceptance requires a local preview server.");
const output = resolve(root, argument("--output", ".netlify/app-feedback-browser"));
const outputRelative = relative(resolve(root, ".netlify"), output);
assert(outputRelative && !outputRelative.startsWith(`..${sep}`) && outputRelative !== "..", "Screenshots must stay in ignored .netlify output.");
const endpoint = "https://us-central1-kickai-69dd0.cloudfunctions.net/receiveAppFeedback";
const widths = [320, 390, 820, 1440];
const report = { base: base.origin, synthetic: true, liveWrites: 0, screenshots: [], checks: [], publicRequests: [], publicErrors: [], adminErrors: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
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
async function publicPage(source = "direct", { preview = false, failFirstSubmission = false } = {}) {
  const page = await context.newPage();
  const state = { posts: [], externalAttempts: [], errors: [], failedSubmission: false };
  page.on("pageerror", error => { state.errors.push(error.message); report.publicErrors.push(error.message); });
  page.on("request", request => { report.publicRequests.push({ url: request.url(), method: request.method(), resource: request.resourceType() }); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base.origin) { await route.continue(); return; }
    if (request.url() === endpoint) {
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
      if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
      assert.equal(request.method(), "POST");
      const requestHeaders = await request.allHeaders();
      assert(!requestHeaders.authorization && !requestHeaders.cookie && !requestHeaders.referer, "Feedback inherited account credentials or referrer.");
      const body = request.postData();
      const payload = JSON.parse(body);
      assert.equal(payload.formVersion, 1);
      assert.equal(payload.entrySource, source);
      assert.match(payload.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert(Object.keys(payload).every(key => ["formVersion", "event", "sessionId", "entrySource", "answers", "durationSeconds"].includes(key)), "Unknown feedback envelope field.");
      assert(!body.includes("not-a-real-account") && !body.includes("private-url-canary") && !body.includes("playerId"), "Feedback contains an account or URL identifier.");
      if (payload.answers) assert.deepEqual(Object.keys(payload.answers).sort(), ["comment", "ease", "feature", "obstruction"]);
      state.posts.push({ payload, body });
      if (payload.event === "submitted" && failFirstSubmission && !state.failedSubmission) {
        state.failedSubmission = true;
        await route.fulfill({ status: 503, headers, body: JSON.stringify({ error: "synthetic-unavailable" }) });
      } else await route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true }) });
      return;
    }
    state.externalAttempts.push(request.url());
    await route.abort("blockedbyclient");
  });
  await page.goto(new URL(`/feedback?source=${source}&playerId=private-url-canary${preview ? "&preview=1" : ""}`, base).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Help us improve PoseTek." }).waitFor();
  await page.getByRole("radio", { name: "Results", exact: true }).waitFor();
  return { page, state };
}
async function publicSafe(state) {
  assert.deepEqual(state.externalAttempts, [], "The isolated public form attempted external font, auth or tracking requests.");
  assert.deepEqual(state.errors, [], "Public form had browser exceptions.");
}

try {
  // Exact question flow, native keyboard controls, backward recovery, a failed
  // submission, and byte-identical retry with no credentials or identifiers.
  {
    const { page, state } = await publicPage("workout", { failFirstSubmission: true });
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
    const ease = page.getByRole("radio", { name: "Very easy", exact: true });
    await ease.focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByText("Did anything get in your way?", { exact: true }).waitFor();
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
    assert.equal(state.posts.filter(post => post.payload.event === "opened").length, 1);
    assert.equal(state.posts.filter(post => post.payload.event === "started").length, 1);
    assert.equal(new Set(state.posts.map(post => post.payload.sessionId)).size, 1);
    await publicSafe(state);
    pass("Exact questions, keyboard selection, back recovery, failed send and identical retry");
    pass("Requests omit auth, cookies, referrer, URL canaries and unknown identifiers");
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
    const unused = page.getByRole("radio", { name: "Haven’t used it yet", exact: true });
    await unused.focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("heading", { name: "Thanks for helping us improve.", exact: true }).waitFor();
    const submitted = state.posts.find(post => post.payload.event === "submitted");
    assert.deepEqual(submitted?.payload.answers, { feature: "notUsed", ease: null, obstruction: null, comment: "" });
    await publicSafe(state);
    pass("Not-used exit sends one explicit answer without ratings or writing");
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
    await publicSafe(state);
    pass("Preview is labeled and sends zero opens, starts or submissions");
    await page.close();
  }

  if (!args.includes("--public-only")) {
    const page = await context.newPage();
    page.on("pageerror", error => { report.adminErrors.push(error.message); });
    await page.route("**/*", async route => {
      if (new URL(route.request().url()).origin === base.origin) await route.continue();
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
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  throw error;
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, liveWrites: 0, report: resolve(output, "report.json") }));
}
