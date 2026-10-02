"use strict";
const M = require("./microsoft-email-model");
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Preserve the Flow resource's trailing slash in aud when using v2 /.default.
const FLOW_SCOPE = "https://service.flow.microsoft.com//.default";
const TRACE = "https://graph.microsoft.com/v1.0/admin/exchange/tracing/messageTraces";
const SECRETS = ["MICROSOFT_EMAIL_FLOW_ENDPOINT", "MICROSOFT_EMAIL_TENANT_ID", "MICROSOFT_EMAIL_CLIENT_ID", "MICROSOFT_EMAIL_CLIENT_SECRET"];
function flowEndpoint(value) {
  let url; try { url = new URL(value); } catch (_) { M.fail("provider_flow_configuration"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443"
    || !(url.hostname.endsWith(".logic.azure.com") || url.hostname.endsWith(".environment.api.powerplatform.com"))
    || !url.pathname.includes("/workflows/") || !url.pathname.endsWith("/triggers/manual/paths/invoke")
    || [...url.searchParams.keys()].some(key => ["sig", "token", "code", "access_token"].includes(key.toLowerCase()))) M.fail("provider_flow_configuration");
  return url.href;
}
function createTokenProvider({ credentials, scope, fetchImpl = fetch, now = Date.now }) {
  let cached;
  return async () => {
    if (cached?.expiresAt > now() + 60000) return cached.token;
    const c = await credentials();
    if (!GUID.test(c.tenantId || "") || !GUID.test(c.clientId || "") || typeof c.clientSecret !== "string" || c.clientSecret.length < 16) M.fail("provider_oauth_configuration");
    let response;
    try { response = await fetchImpl(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, scope, grant_type: "client_credentials" }).toString(),
    }); } catch (_) { M.fail("provider_oauth_unavailable"); }
    if (!response.ok) M.fail([401, 403].includes(response.status) ? "provider_oauth_auth" : "provider_oauth_unavailable");
    let data; try { data = await response.json(); } catch (_) { M.fail("provider_oauth_unavailable"); }
    if (typeof data?.access_token !== "string" || data.access_token.length < 20 || !/^Bearer$/i.test(data.token_type || "") || !(Number(data.expires_in) > 60)) M.fail("provider_oauth_unavailable");
    cached = { token: data.access_token, expiresAt: now() + Math.min(Number(data.expires_in), 3600) * 1000 };
    return cached.token;
  };
}
function createFlowTransport({ endpoint, getAccessToken, fetchImpl = fetch }) {
  return { async send(_payload, _key, job) {
    if (!M.jobValid(job?.kind, job?.id) || job.deliveryProvider !== "microsoft") M.fail("provider_job_invalid");
    const url = flowEndpoint(await endpoint()), token = await getAccessToken();
    let response;
    try { response = await fetchImpl(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, kind: job.kind, jobId: job.id }),
    }); } catch (_) { M.fail("provider_flow_uncertain"); }
    // An HTTP acknowledgement is only a wake-up. The authenticated callback is
    // the sole send acknowledgement; a transactional claim prevents duplicate sends.
    if (![200, 202].includes(response.status)) M.fail(`provider_flow_http_${response.status}`);
    return { pending: true };
  } };
}
function traceUrl(value) {
  let url; try { url = new URL(value); } catch (_) { M.fail("provider_trace_invalid_page"); }
  if (url.origin !== "https://graph.microsoft.com" || url.pathname !== "/v1.0/admin/exchange/tracing/messageTraces"
    || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => !["$filter", "$top", "$skiptoken"].includes(key))) M.fail("provider_trace_invalid_page");
  return url.href;
}
function createTraceReader({ getAccessToken, fetchImpl = fetch, now = Date.now, beforeRequest = async () => {} }) {
  return { async read(job) {
    const send = job.microsoft, start = send?.claimedAtMillis - 300000, end = Math.min(now(), send?.claimedAtMillis + 86400000);
    if (!send?.claimedAtMillis || !Number.isFinite(start) || end < start || end - start > 10 * 86400000 || start < now() - 90 * 86400000
      || !/^PTM-[a-f0-9]{32}$/.test(send.correlation) || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@posetek\.net$/.test(send.senderMailbox)) M.fail("provider_trace_configuration");
    const url = new URL(TRACE), quote = value => value.replace(/'/g, "''");
    const iso = value => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
    url.searchParams.set("$filter", `receivedDateTime ge ${iso(start)} and receivedDateTime le ${iso(end)} and senderAddress eq '${quote(send.senderMailbox)}' and contains(subject, '${send.correlation}')`);
    url.searchParams.set("$top", "1000");
    let next = url.href, rows = [], pages = 0;
    const seen = new Set(), token = await getAccessToken();
    while (next) {
      next = traceUrl(next);
      if (seen.has(next) || ++pages > 5) M.fail("provider_trace_incomplete");
      seen.add(next); await beforeRequest();
      let response;
      try { response = await fetchImpl(next, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); }
      catch (_) { M.fail("provider_trace_unavailable"); }
      if (!response.ok) M.fail(`provider_trace_http_${response.status}`);
      let page; try { page = await response.json(); } catch (_) { M.fail("provider_trace_invalid_response"); }
      if (!Array.isArray(page?.value) || page.value.length > 5000 || rows.length + page.value.length > 5000) M.fail("provider_trace_incomplete");
      rows.push(...page.value);
      next = page["@odata.nextLink"] || null;
      if (next !== null && typeof next !== "string") M.fail("provider_trace_invalid_page");
    }
    // Do not apply partial-page evidence: another page could prove a duplicate.
    return { rows, start, end, checkedAtMillis: now() };
  } };
}
const credentialsFromEnv = () => ({ tenantId: process.env.MICROSOFT_EMAIL_TENANT_ID, clientId: process.env.MICROSOFT_EMAIL_CLIENT_ID, clientSecret: process.env.MICROSOFT_EMAIL_CLIENT_SECRET });
function createMicrosoftProvider() {
  return createFlowTransport({ endpoint: () => process.env.MICROSOFT_EMAIL_FLOW_ENDPOINT,
    getAccessToken: createTokenProvider({ credentials: credentialsFromEnv, scope: FLOW_SCOPE }) });
}
module.exports = { SECRETS, TRACE, FLOW_SCOPE, flowEndpoint, traceUrl, createTokenProvider, createFlowTransport, createTraceReader, credentialsFromEnv, createMicrosoftProvider };
