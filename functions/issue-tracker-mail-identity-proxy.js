"use strict";
const crypto = require("node:crypto");
const { fail, digest } = require("./issue-tracker-bridge-model");
const I = require("./issue-tracker-mail-identity");
const { TENANT, CLIENT, CALLER, endpointHash, READ_TIMEOUT_MS } = require("./issue-tracker-mail-read-proxy");
const { flowEndpoint } = require("./issue-tracker-bridge-transport");
const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, HASH = /^[a-f0-9]{64}$/;
const CONNECTION = /^(?:shared-webcontents-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})$/i;
function mailIdentityBinding(settings) {
  const p = settings?.mailIdentityProxyProof;
  if (settings?.mailbox !== I.MAILBOX || settings.mailIdentityProvider !== "power_automate" || settings.mailIdentityProxyVerified !== true || !p ||
      p.schemaVersion !== 1 || p.verified !== true || p.authorization !== "delegated_translation_route" || p.tenantId !== TENANT || p.clientId !== CLIENT ||
      p.callerObjectId !== CALLER || p.connectionAccount !== I.MAILBOX || !GUID.test(p.flowId || "") ||
      typeof p.connectionName !== "string" || p.connectionName !== p.connectionName.trim() || !CONNECTION.test(p.connectionName) ||
      p.graphResource !== "https://graph.microsoft.com" || p.targetIdType !== "restImmutableEntryId" || !HASH.test(p.endpointSha256 || "") || !HASH.test(p.exportSha256 || "")) return null;
  return digest({ provider: "power_automate", mailbox: I.MAILBOX, proof: p });
}
function createMailIdentityProxyTransport({ endpoint, getAccessToken, configuration, identity, fetchImpl = fetch, randomId = crypto.randomUUID }) {
  return async function translateIds(input, { signal } = {}) {
    const request = I.translationRequest(input?.inputIds, input?.sourceIdType, input?.targetIdType);
    if (input.targetIdType !== request.targetIdType) fail("tracker_graph_invalid_translation_request");
    const settings = await configuration(), binding = mailIdentityBinding(settings);
    if (!binding) fail("tracker_mail_identity_not_configured");
    const target = flowEndpoint(await endpoint()), who = await identity();
    if (settings.mailIdentityProxyProof.endpointSha256 !== endpointHash(target) || who?.tenantId !== TENANT || who.clientId !== CLIENT) fail("tracker_mail_identity_not_configured");
    const requestId = randomId(); if (!GUID.test(requestId)) fail("tracker_mail_identity_invalid_request");
    const token = await getAccessToken();
    if (typeof token !== "string" || !token || /[\r\n]/.test(token)) fail("tracker_mail_identity_not_configured");
    let response;
    try { response = await fetchImpl(target, { method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) : AbortSignal.timeout(READ_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, requestId, ...request }) }); }
    catch (_) { fail("tracker_mail_identity_unavailable"); }
    if (response.status !== 200) {
      // The fixed authenticated flow exposes this enum ONLY for the observed
      // Graph 400 InvalidArgument: ImmutableId where EntryId was required.
      // No generic failure, security failure or malformed body can authorize
      // another declaration. The enum authorizes a read, never an identity.
      if (response.status === 502 && request.sourceIdType === "restId" && request.targetIdType === "restImmutableEntryId") {
        let error; try { error = await response.json(); } catch (_) {}
        if (error && Object.keys(error).sort().join() === "error,graphCode,graphStatus,mailbox,requestId,schemaVersion,sourceIdType,targetIdType"
            && error.schemaVersion === 1 && error.requestId === requestId && error.mailbox === I.MAILBOX
            && error.sourceIdType === request.sourceIdType && error.targetIdType === request.targetIdType
            && error.graphStatus === 400 && error.graphCode === "InvalidArgument" && error.error === "mail_identity_source_type_mismatch") {
          if (mailIdentityBinding(await configuration()) !== binding) fail("tracker_capture_configuration_changed");
          fail("tracker_mail_identity_source_type_mismatch");
        }
      }
      fail([401, 403].includes(response.status) ? "tracker_mail_identity_access_denied" : response.status === 429 ? "tracker_mail_identity_throttled" : "tracker_mail_identity_translation_failed");
    }
    let value; try { value = await response.json(); } catch (_) { fail("tracker_mail_identity_invalid_response"); }
    if (!value || Object.keys(value).sort().join() !== "data,graphStatus,mailbox,mailboxUser,requestId,schemaVersion,sourceIdType,targetIdType" || value.schemaVersion !== 1 || value.requestId !== requestId || value.mailbox !== I.MAILBOX || value.graphStatus !== 200 ||
      typeof value.mailboxUser?.id !== "string" || !value.mailboxUser.id || String(value.mailboxUser.userPrincipalName || "").toLowerCase() !== I.MAILBOX || value.sourceIdType !== request.sourceIdType || value.targetIdType !== request.targetIdType) fail("tracker_mail_identity_invalid_response");
    I.translationResult(request, value.data);
    if (mailIdentityBinding(await configuration()) !== binding) fail("tracker_capture_configuration_changed");
    return value.data;
  };
}
module.exports = { mailIdentityBinding, createMailIdentityProxyTransport };
