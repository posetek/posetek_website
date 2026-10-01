"use strict";
const { fail, verifyReceipt } = require("./issue-tracker-bridge-model");
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLOW_SCOPE = "https://service.flow.microsoft.com/.default";

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

function createPowerAutomateTransport({ endpoint, getAccessToken, fetchImpl = fetch }) {
  return { async send(batch) {
    const url = flowEndpoint(await endpoint());
    const token = await getAccessToken();
    if (typeof token !== "string" || !token || /[\r\n]/.test(token)) fail("tracker_missing_oauth_config");
    let response;
    try {
      response = await fetchImpl(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(125000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-PoseTek-Batch-Id": batch.batchId }, body: JSON.stringify(batch) });
    } catch (_) { fail("tracker_transport_uncertain"); }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) fail("tracker_remote_auth");
      if ([409, 412, 423].includes(response.status)) fail("tracker_remote_conflict");
      fail(response.status >= 500 || response.status === 429 || response.status === 408 ? "tracker_transport_retry" : "tracker_remote_rejected");
    }
    // A 202 acknowledgement is not a verified Excel write. The response action
    // must run only after the script returned an exact post-read receipt.
    if (response.status !== 200) fail("tracker_unverified_receipt");
    let receipt; try { receipt = await response.json(); } catch (_) { fail("tracker_unverified_receipt"); }
    return verifyReceipt(batch, receipt);
  } };
}
module.exports = { FLOW_SCOPE, flowEndpoint, createFlowTokenProvider, createPowerAutomateTransport };
