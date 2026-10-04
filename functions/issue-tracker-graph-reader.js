"use strict";
const { fail, digest } = require("./issue-tracker-bridge-model");
const Identity = require("./issue-tracker-mail-identity");
const MAILBOX = "dylank@posetek.net", ORIGIN = "https://graph.microsoft.com";
const FIELDS = "id,internetMessageId,receivedDateTime,sentDateTime,subject,from,sender,body,bodyPreview,webLink,parentFolderId,internetMessageHeaders,isRead";
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || "");
const messageId = value => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
const PREFER = 'IdType="ImmutableId", outlook.body-content-type="html"';
const PAGE_SIZE = 50, IDENTITY_BUDGET_MS = 60000, IDENTITY_CONCURRENCY = 3;
const TYPE_MISMATCH = "tracker_mail_identity_source_type_mismatch";
function safeGraphUrl(value, item = false) {
  // Check raw bytes before URL parsing can normalize traversal, whitespace or
  // backslashes. Opaque query/skip-token bytes are preserved exactly.
  if (typeof value !== "string" || value.length > 8192 || /[^A-Za-z0-9\-._~:/?\[\]@!$&'()*+,;=%]/.test(value) ||
      !value.startsWith(ORIGIN + "/")) fail("tracker_graph_invalid_page");
  const path = value.slice(ORIGIN.length).split("?")[0];
  if (!/^\/v1\.0\/users\/dylank(?:%40|@)posetek\.net\/messages(?:\/(?:[A-Za-z0-9_+=-]|%2[bBfF]|%3[dD])+)?$/.test(path)) fail("tracker_graph_invalid_page");
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

function createGraphReader({ getAccessToken, fetchImpl = fetch, mailbox = MAILBOX, requestJson, canonicalGetVerified = async () => !requestJson, translateIds, collectionIdType = requestJson ? null : "restImmutableEntryId", now = Date.now }) {
  if (mailbox.toLowerCase() !== MAILBOX) fail("tracker_wrong_mailbox");
  if (collectionIdType !== null && !Identity.TYPES.includes(collectionIdType)) fail("tracker_mail_identity_unverified");
  const base = `/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`;
  function budget(parentSignal) {
    const started = now(), controller = new AbortController();
    const parentAbort = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", parentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), IDENTITY_BUDGET_MS); timer.unref?.();
    const check = () => { if (controller.signal.aborted || now() - started >= IDENTITY_BUDGET_MS) fail("tracker_mail_identity_budget_exceeded"); };
    return { signal: controller.signal, check, close: () => { clearTimeout(timer); parentSignal?.removeEventListener("abort", parentAbort); }, async call(fn) {
      check(); let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = () => reject(Object.assign(new Error("tracker_mail_identity_budget_exceeded"), { code: "tracker_mail_identity_budget_exceeded" })); controller.signal.addEventListener("abort", rejectAbort, { once: true }); });
      try { const result = await Promise.race([Promise.resolve().then(fn), aborted]); check(); return result; }
      finally { controller.signal.removeEventListener("abort", rejectAbort); }
    } };
  }
  async function request(url, item = false, signal) {
    const safe = safeGraphUrl(url, item);
    if (requestJson) return requestJson(safe, { item, ...(signal ? { signal } : {}) });
    const accessToken = await getAccessToken();
    let response;
    try { response = await fetchImpl(safe, { method: "GET", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
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
  async function message(id, work) {
    if (!messageId(id)) fail("tracker_graph_invalid_message_id");
    const u = new URL(ORIGIN + base + "/" + encodeURIComponent(id)); u.searchParams.set("$select", FIELDS);
    return validateMessage(await (work ? work.call(() => request(u.href, true, work.signal)) : request(u.href, true)));
  }
  async function translated(ids, sourceIdType, work, targetIdType = "restImmutableEntryId") {
    const body = Identity.translationRequest(ids, sourceIdType, targetIdType);
    const response = await work.call(() => translateIds(body, { signal: work.signal }));
    const result = Identity.translationResult(body, response);
    return new Map(ids.map(sourceId => [sourceId, { targetId: result.get(sourceId), sourceIdType,
      responseSha256: digest({ sourceIdType, targetIdType: body.targetIdType, translation: response.value.find(item => item.sourceId === sourceId) }) }]));
  }
  async function one(id, type, work) {
    if (type !== null && type !== undefined && !Identity.TYPES.includes(type)) fail("tracker_graph_invalid_translation_request");
    // A caller's type hint is validation input, not an attestation. Both event
    // and GET IDs start with the same declared REST attempt, without guessing
    // from bytes or assuming that the provider honored a requested format.
    try { return (await translated([id], "restId", work)).get(id); }
    catch (error) {
      // Only this exact, authenticated Graph mismatch permits another type.
      // Access, throttle, timeout, generic/partial or malformed results stop.
      if (error?.code !== TYPE_MISMATCH) throw error;
      // Graph rejects identical source/target types. Prove an immutable input
      // through TWO different-type conversions and its exact return value.
      const rest = (await translated([id], "restImmutableEntryId", work, "restId")).get(id);
      const reverse = (await translated([rest.targetId], "restId", work)).get(rest.targetId);
      if (reverse.targetId !== id) fail("tracker_mail_identity_item_changed");
      return { targetId: id, sourceIdType: "restImmutableEntryId", responseSha256: digest({ sourceId: id, sourceIdType: "restImmutableEntryId", targetIdType: "restImmutableEntryId", translations: [rest.responseSha256, reverse.responseSha256] }) };
    }
  }
  function withIdentity(mail, sourceId, resolved) {
    return { ...mail, sourceMessage: mail.sourceMessage || mail, id: resolved.targetId,
      itemIdentity: Identity.itemIdentity({ sourceId, canonicalId: resolved.targetId, sourceIdType: resolved.sourceIdType, responseSha256: resolved.responseSha256 }) };
  }
  const fingerprint = mail => digest(Object.fromEntries(["internetMessageId", "receivedDateTime", "sentDateTime", "subject", "from", "sender", "body", "bodyPreview", "internetMessageHeaders", "toRecipients", "ccRecipients", "bccRecipients"].map(key => [key, mail[key] ?? null])));
  async function canonicalize(mail, { sourceId = mail?.id, sourceIdType = collectionIdType } = {}) {
    validateMessage(mail);
    if (Identity.validItemIdentity(mail.itemIdentity, mail.id)) return mail;
    if (translateIds) {
      const work = budget();
      try { return withIdentity(mail, sourceId, await one(sourceId, sourceIdType, work)); }
      finally { work.close(); }
    }
    if (await canonicalGetVerified()) return { ...mail, itemIdentity: Identity.itemIdentity({ sourceId: mail.id, canonicalId: mail.id, sourceIdType: "restImmutableEntryId", method: "graph_verified_immutable_get", responseSha256: digest(mail) }) };
    // Preserve the original item and retry identity enrichment after a verified
    // resolver is installed. An ignored Prefer header cannot certify this ID.
    return { ...mail, itemIdentityPending: true };
  }
  return {
    canonicalize,
    async canonicalMessage(id, { sourceIdType = null, signal } = {}) {
      const work = budget(signal);
      try {
        if (!translateIds) return canonicalize(await message(id, work), { sourceId: id, sourceIdType });
        const original = await message(id, work), resolved = await one(id, sourceIdType, work);
        if (original.id !== id && (await one(original.id, null, work)).targetId !== resolved.targetId) fail("tracker_mail_identity_item_changed");
        const canonical = await message(resolved.targetId, work);
        // The provider may ignore Prefer. Translate even its returned GET ID;
        // neither the requested format nor an echoed ID certifies immutable type.
        if ((await one(canonical.id, null, work)).targetId !== resolved.targetId || fingerprint(original) !== fingerprint(canonical)) fail("tracker_mail_identity_item_changed");
        return withIdentity(original, id, resolved);
      } finally { work.close(); }
    },
    async page({ since, until, cursor = null }) {
      if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(since) >= Date.parse(until)) fail("tracker_graph_invalid_window");
      const first = new URL(ORIGIN + base);
      first.searchParams.set("$filter", `receivedDateTime ge ${since} and receivedDateTime lt ${until}`);
      first.searchParams.set("$orderby", "receivedDateTime asc"); first.searchParams.set("$top", String(PAGE_SIZE)); first.searchParams.set("$select", FIELDS);
      // Keep the provider's COMPLETE nextLink, including opaque skip tokens.
      const work = budget();
      try {
        const data = await work.call(() => request(cursor || first.href, false, work.signal));
        if (!data || !Array.isArray(data.value)) fail("tracker_graph_invalid_page");
        if (data.value.length > PAGE_SIZE) fail("tracker_graph_invalid_page");
        let messages = data.value.map(validateMessage);
        if (new Set(messages.map(mail => mail.id)).size !== messages.length) fail("tracker_graph_invalid_page");
        if (messages.some(m => Date.parse(m.receivedDateTime) < Date.parse(since) || Date.parse(m.receivedDateTime) >= Date.parse(until))) fail("tracker_graph_window_violation");
        const next = data["@odata.nextLink"] == null ? null : safeGraphUrl(data["@odata.nextLink"]);
        if (next && next === cursor) fail("tracker_graph_pagination_loop");
        if (translateIds && messages.length) {
          let result;
          try { result = await translated(messages.map(mail => mail.id), "restId", work); }
          catch (error) {
            if (error?.code !== TYPE_MISMATCH) throw error;
            // A mixed batch can fail as a whole. Exactly one declared REST
            // attempt per item, plus two proven roundtrip reads, is bounded at
            // 1 + 3*50 = 151 translations, three workers and 60 seconds.
            result = new Map(); let nextItem = 0, stopped;
            await Promise.all(Array.from({ length: Math.min(IDENTITY_CONCURRENCY, messages.length) }, async () => {
              while (!stopped && nextItem < messages.length) {
                const mail = messages[nextItem++];
                try { result.set(mail.id, await one(mail.id, collectionIdType || "restId", work)); }
                catch (error) { stopped ||= error; }
              }
            }));
            if (stopped) throw stopped;
            if (new Set([...result.values()].map(item => item.targetId)).size !== result.size) fail("tracker_graph_invalid_translation_response");
          }
          messages = messages.map(mail => withIdentity(mail, mail.id, result.get(mail.id)));
        }
        return { records: messages, cursor: next, complete: next === null };
      } finally { work.close(); }
    },
    // Raw GET is retained for evidence inspection. Canonical identity requires
    // the explicit immutable-header attestation or exact translation above.
    message,
  };
}
module.exports = { createGraphTokenProvider, createGraphReader, safeGraphUrl, PREFER, MAILBOX, PAGE_SIZE, IDENTITY_BUDGET_MS, IDENTITY_CONCURRENCY };
