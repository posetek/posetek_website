"use strict";
const { fail } = require("./issue-tracker-bridge-model");
const MAILBOX = "dylank@posetek.net", ORIGIN = "https://graph.microsoft.com";
const FIELDS = "id,internetMessageId,receivedDateTime,sentDateTime,subject,from,sender,body,bodyPreview,webLink,parentFolderId,internetMessageHeaders,isRead";
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || "");
const messageId = value => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
const PREFER = 'IdType="ImmutableId", outlook.body-content-type="html"';
function safeGraphUrl(value, item = false) {
  // Check raw bytes before URL parsing can normalize traversal, whitespace or
  // backslashes. Opaque query/skip-token bytes are preserved exactly.
  if (typeof value !== "string" || value.length > 8192 || /[^A-Za-z0-9\-._~:/?\[\]@!$&'()*+,;=%]/.test(value) ||
      !value.startsWith(ORIGIN + "/")) fail("tracker_graph_invalid_page");
  const path = value.slice(ORIGIN.length).split("?")[0];
  if (!/^\/v1\.0\/users\/dylank(?:%40|@)posetek\.net\/messages(?:\/(?:[A-Za-z0-9_+=-]|%2[bB]|%3[dD])+)?$/.test(path)) fail("tracker_graph_invalid_page");
  const segments = path.split("/");
  if (segments.length !== 5 && !(item && segments.length === 6)) fail("tracker_graph_invalid_page");
  let url; try { url = new URL(value); } catch (_) { fail("tracker_graph_invalid_page"); }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== path) fail("tracker_graph_invalid_page");
  return value;
}

// Tokens are purpose-scoped to Graph. Authorization must be separately verified
// with Exchange application RBAC for this ONE mailbox before enabling capture.
function createGraphTokenProvider({ credentials, fetchImpl = fetch, now = Date.now }) {
  let cached;
  return async function token() {
    const c = await credentials();
    if (!uuid(c?.tenantId) || !uuid(c?.clientId) || typeof c.clientSecret !== "string" || !c.clientSecret) fail("tracker_graph_not_configured");
    if (cached?.key === `${c.tenantId}/${c.clientId}` && cached.until > now() + 60000) return cached.value;
    let response;
    try { response = await fetchImpl(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }).toString(),
    }); } catch (_) { fail("tracker_graph_auth_unavailable"); }
    if (!response.ok) fail("tracker_graph_auth_rejected");
    let data; try { data = await response.json(); } catch (_) { fail("tracker_graph_auth_invalid"); }
    if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 60) fail("tracker_graph_auth_invalid");
    cached = { key: `${c.tenantId}/${c.clientId}`, value: data.access_token, until: now() + Math.min(data.expires_in, 3600) * 1000 };
    return cached.value;
  };
}

function createGraphReader({ getAccessToken, fetchImpl = fetch, mailbox = MAILBOX, requestJson }) {
  if (mailbox.toLowerCase() !== MAILBOX) fail("tracker_wrong_mailbox");
  const base = `/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`;
  async function request(url, item = false) {
    const safe = safeGraphUrl(url, item);
    if (requestJson) return requestJson(safe, { item });
    const accessToken = await getAccessToken();
    let response;
    try { response = await fetchImpl(safe, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: PREFER } }); }
    catch (_) { fail("tracker_graph_read_unavailable"); }
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? "tracker_graph_access_denied" : response.status === 404 ? "tracker_graph_message_unavailable" : response.status === 429 ? "tracker_graph_throttled" : "tracker_graph_read_failed");
    let data; try { data = await response.json(); } catch (_) { fail("tracker_graph_invalid_response"); }
    return data;
  }
  function validateMessage(message) {
    if (!message || !messageId(message.id) || !Number.isFinite(Date.parse(message.receivedDateTime)) ||
      typeof message.subject !== "string" || !message.body || typeof message.body.content !== "string" ||
      !["html", "text"].includes(message.body.contentType?.toLowerCase())) fail("tracker_graph_invalid_message");
    return message;
  }
  return {
    async page({ since, until, cursor = null }) {
      if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(since) >= Date.parse(until)) fail("tracker_graph_invalid_window");
      const first = new URL(ORIGIN + base);
      first.searchParams.set("$filter", `receivedDateTime ge ${since} and receivedDateTime lt ${until}`);
      first.searchParams.set("$orderby", "receivedDateTime asc"); first.searchParams.set("$top", "50"); first.searchParams.set("$select", FIELDS);
      // Keep the provider's COMPLETE nextLink, including opaque skip tokens.
      const data = await request(cursor || first.href);
      if (!data || !Array.isArray(data.value)) fail("tracker_graph_invalid_page");
      const messages = data.value.map(validateMessage);
      if (messages.some(m => Date.parse(m.receivedDateTime) < Date.parse(since) || Date.parse(m.receivedDateTime) >= Date.parse(until))) fail("tracker_graph_window_violation");
      const next = data["@odata.nextLink"] == null ? null : safeGraphUrl(data["@odata.nextLink"]);
      if (next && next === cursor) fail("tracker_graph_pagination_loop");
      return { records: messages, cursor: next, complete: next === null };
    },
    // Read an existing REST ID with the immutable-ID preference. This verifies
    // an alias using Mail.Read without translateExchangeIds/User.Read.All.
    async message(id) {
      if (!messageId(id)) fail("tracker_graph_invalid_message_id");
      const u = new URL(ORIGIN + base + "/" + encodeURIComponent(id)); u.searchParams.set("$select", FIELDS);
      return validateMessage(await request(u.href, true));
    },
  };
}
module.exports = { createGraphTokenProvider, createGraphReader, safeGraphUrl, PREFER, MAILBOX };
