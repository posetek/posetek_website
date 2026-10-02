"use strict";
const { fail, verifyReceipt } = require("./issue-tracker-bridge-model");
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The HTTP trigger requires aud=https://service.flow.microsoft.com/ exactly.
// The v2 token scope is that resource URI plus /.default; keep both slashes.
const FLOW_SCOPE = "https://service.flow.microsoft.com//.default";
const TRANSPORT_TIMEOUT_MS = 125000, MAX_ASYNC_POLLS = 24, MIN_POLL_MS = 5000;

function flowEndpoint(value) {
  let url; try { url = new URL(value); } catch (_) { fail("tracker_invalid_endpoint"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" ||
      !(host.endsWith(".logic.azure.com") || host.endsWith(".environment.api.powerplatform.com")) ||
      !url.pathname.includes("/workflows/") || !url.pathname.endsWith("/triggers/manual/paths/invoke") ||
      [...url.searchParams.keys()].some(key => ["sig", "token", "code", "access_token"].includes(key.toLowerCase()))) fail("tracker_invalid_endpoint");
  return url.href;
}

/** An OAuth client-credentials provider, never a user Graph/mailbox token. The
 * Power Automate trigger must allowlist this exact service principal object ID.
 * Configuration/secrets are loaded lazily from Secret Manager environment refs.
 */
function createFlowTokenProvider({ credentials, fetchImpl = fetch, now = Date.now }) {
  let cached;
  return async function token() {
    if (cached && cached.expiresAt > now() + 60000) return cached.value;
    const { tenantId, clientId, clientSecret } = await credentials();
    if (!GUID.test(tenantId || "") || !GUID.test(clientId || "") || typeof clientSecret !== "string" || clientSecret.length < 16) fail("tracker_missing_oauth_config");
    let response;
    try {
      response = await fetchImpl(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: FLOW_SCOPE, grant_type: "client_credentials" }).toString() });
    } catch (_) { fail("tracker_oauth_unavailable"); }
    if (!response.ok) fail(response.status >= 500 || response.status === 429 ? "tracker_oauth_unavailable" : "tracker_remote_auth");
    let data; try { data = await response.json(); } catch (_) { fail("tracker_oauth_unavailable"); }
    if (typeof data.access_token !== "string" || data.access_token.length < 20 || !/^Bearer$/i.test(data.token_type || "") || !(Number(data.expires_in) > 60)) fail("tracker_oauth_unavailable");
    cached = { value: data.access_token, expiresAt: now() + Math.min(Number(data.expires_in), 3600) * 1000 };
    return cached.value;
  };
}

// Location is supplied only by the authenticated flow response. Never follow an
// arbitrary redirect, another origin, another workflow, or the invoke endpoint.
// Signed polling URLs may contain a capability token: keep them memory-only and
// do not forward an OAuth token when the URL already carries a signature.
function pollEndpoint(value, invoke) {
  let url, source;
  try { source = new URL(invoke); url = new URL(value, source); } catch (_) { fail("tracker_unverified_receipt"); }
  // Power Platform may omit the documented /cu/<scale-unit> routing segment
  // from its async Location. Canonicalize that segment only; origin, workflow
  // identity and the /runs/ boundary must still match exactly.
  const route = pathname => source.hostname.endsWith(".environment.api.powerplatform.com")
    ? pathname.replace(/^\/powerautomate\/automations\/direct\/cu\/\d+\/workflows\//, "/powerautomate/automations/direct/workflows/") : pathname;
  const base = route(source.pathname).slice(0, -"/triggers/manual/paths/invoke".length);
  if (typeof value !== "string" || !value || value.length > 8192 || url.protocol !== "https:" || url.origin !== source.origin ||
      url.username || url.password || url.hash || !route(url.pathname).startsWith(`${base}/runs/`) ||
      /%(?:2e|2f|5c)/i.test(url.pathname) || /[\\\u0000-\u0020]/.test(value) ||
      [...url.searchParams.keys()].some(key => ["access_token", "authorization"].includes(key.toLowerCase()))) fail("tracker_unverified_receipt");
  return url.href;
}
function pollDelay(value, now) {
  if (value == null || value === "") return MIN_POLL_MS;
  const seconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(seconds) ? Math.max(MIN_POLL_MS, seconds) : MIN_POLL_MS;
}
function checkStatus(response) {
  if (response.ok) return;
  if ([401, 403].includes(response.status)) fail("tracker_remote_auth");
  if ([409, 412, 423].includes(response.status)) fail("tracker_remote_conflict");
  fail(response.status >= 500 || response.status === 429 || response.status === 408 ? "tracker_transport_retry" : "tracker_remote_rejected");
}
function createPowerAutomateTransport({ endpoint, getAccessToken, fetchImpl = fetch, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  return { async send(batch) {
    const url = flowEndpoint(await endpoint());
    const token = await getAccessToken();
    if (typeof token !== "string" || !token || /[\r\n]/.test(token)) fail("tracker_missing_oauth_config");
    const deadline = now() + TRANSPORT_TIMEOUT_MS;
    async function request(target, options) {
      const remaining = deadline - now();
      if (remaining <= 0) fail("tracker_transport_uncertain");
      try { return await fetchImpl(target, { ...options, redirect: "error", signal: AbortSignal.timeout(Math.min(remaining, TRANSPORT_TIMEOUT_MS)) }); }
      catch (_) { fail("tracker_transport_uncertain"); }
    }
    let response;
    response = await request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      "X-PoseTek-Batch-Id": batch.batchId }, body: JSON.stringify(batch) });
    let pollingUrl, polls = 0;
    while (response.status === 202) {
      // Acceptance is not an Excel acknowledgement. Only the final exact native
      // receipt can release the frozen batch. Flow concurrency MUST remain one:
      // bounded-timeout retries may submit the same batch more than once.
      const location = response.headers?.get("location");
      pollingUrl = location ? pollEndpoint(location, url) : pollingUrl;
      if (!pollingUrl) fail("tracker_unverified_receipt");
      if (polls >= MAX_ASYNC_POLLS) fail("tracker_transport_uncertain");
      const delay = pollDelay(response.headers?.get("retry-after"), now());
      if (now() + delay >= deadline) fail("tracker_transport_uncertain");
      await wait(delay);
      const signed = [...new URL(pollingUrl).searchParams.keys()].some(key => ["sig", "signature", "token", "code"].includes(key.toLowerCase()));
      response = await request(pollingUrl, { method: "GET", headers: signed ? { Accept: "application/json" } : { Accept: "application/json", Authorization: `Bearer ${token}` } });
      polls++;
    }
    checkStatus(response);
    if (response.status !== 200) fail("tracker_unverified_receipt");
    let receipt; try { receipt = await response.json(); } catch (_) { fail("tracker_unverified_receipt"); }
    return verifyReceipt(batch, receipt);
  } };
}
module.exports = { FLOW_SCOPE, TRANSPORT_TIMEOUT_MS, MAX_ASYNC_POLLS, MIN_POLL_MS, flowEndpoint, pollEndpoint, pollDelay, createFlowTokenProvider, createPowerAutomateTransport };
