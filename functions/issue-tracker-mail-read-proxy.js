"use strict";
const crypto = require("node:crypto");
const { fail, digest } = require("./issue-tracker-bridge-model");
const { createGraphReader, safeGraphUrl, MAILBOX } = require("./issue-tracker-graph-reader");
const { flowEndpoint } = require("./issue-tracker-bridge-transport");
const TENANT = "4fa074df-8075-45d3-a2ba-a94e9b3f2ea5", CLIENT = "59fa6f0a-7982-410e-a006-606bdc05f310", CALLER = "cd9fa4b9-7716-4534-9cf1-620422f48aba";
const READ_TIMEOUT_MS = 45000, GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, HASH = /^[a-f0-9]{64}$/;
const endpointHash = value => crypto.createHash("sha256").update(flowEndpoint(value)).digest("hex");

// Explicit authorization route: a delegated proxy receipt never proves an
// Exchange application role. Invalid/missing selection has no fallback.
function mailReadBinding(settings) {
  if (settings?.mailbox !== MAILBOX) return null;
  if (settings.mailReadProvider === "graph" && settings.graphMailboxVerified === true) return digest({ provider: "graph", mailbox: MAILBOX });
  if (settings.mailReadProvider !== "power_automate" || settings.mailReadProxyVerified !== true) return null;
  const p = settings.mailReadProxyProof;
  if (!p || p.schemaVersion !== 1 || p.verified !== true || p.authorization !== "delegated_proxy_route" || p.tenantId !== TENANT ||
      p.clientId !== CLIENT || p.callerObjectId !== CALLER || p.connectionAccount !== MAILBOX || !GUID.test(p.flowId || "") ||
      !/^shared-office365-[a-f0-9-]{36}$/i.test(p.connectionName || "") || !HASH.test(p.endpointSha256 || "") || !HASH.test(p.exportSha256 || "")) return null;
  return digest({ provider: "power_automate", mailbox: MAILBOX, proof: p });
}

function createMailReadProxyTransport({ endpoint, getAccessToken, configuration, identity, fetchImpl = fetch, randomId = crypto.randomUUID }) {
  return async function requestJson(url, { item = false } = {}) {
    safeGraphUrl(url, item);
    const settings = await configuration(), binding = mailReadBinding(settings), target = flowEndpoint(await endpoint()), who = await identity();
    if (!binding || settings.mailReadProvider !== "power_automate" || settings.mailReadProxyProof.endpointSha256 !== endpointHash(target) ||
        who?.tenantId !== TENANT || who.clientId !== CLIENT) fail("tracker_mail_proxy_not_configured");
    const requestId = randomId(); if (!GUID.test(requestId)) fail("tracker_mail_proxy_invalid_request");
    const token = await getAccessToken();
    if (typeof token !== "string" || !token || /[\r\n]/.test(token)) fail("tracker_mail_proxy_not_configured");
    let response;
    try { response = await fetchImpl(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, requestId, url }) }); }
    catch (_) { fail("tracker_mail_proxy_unavailable"); }
    if (response.status !== 200) fail([401, 403].includes(response.status) ? "tracker_graph_access_denied" : response.status === 404 ? "tracker_graph_message_unavailable" : response.status === 429 ? "tracker_graph_throttled" : "tracker_mail_proxy_read_failed");
    let value; try { value = await response.json(); } catch (_) { fail("tracker_mail_proxy_invalid_response"); }
    if (!value || Object.keys(value).sort().join() !== "data,graphStatus,mailbox,requestId,schemaVersion" || value.schemaVersion !== 1 || value.requestId !== requestId ||
        value.mailbox !== MAILBOX || value.graphStatus !== 200 || !value.data || typeof value.data !== "object" || Array.isArray(value.data) || value.data.error) fail("tracker_mail_proxy_invalid_response");
    if (mailReadBinding(await configuration()) !== binding) fail("tracker_capture_configuration_changed");
    return value.data;
  };
}

function createConfiguredMailReader({ configuration, graph, proxyRequest }) {
  const proxy = createGraphReader({ requestJson: proxyRequest });
  async function read(method, input) {
    const settings = await configuration(), binding = mailReadBinding(settings);
    if (!binding) fail("tracker_mail_not_configured");
    const data = await (settings.mailReadProvider === "graph" ? graph : proxy)[method](input);
    if (mailReadBinding(await configuration()) !== binding) fail("tracker_capture_configuration_changed");
    return data;
  }
  return { page: input => read("page", input), message: id => read("message", id) };
}
module.exports = { TENANT, CLIENT, CALLER, READ_TIMEOUT_MS, endpointHash, mailReadBinding, createMailReadProxyTransport, createConfiguredMailReader };
