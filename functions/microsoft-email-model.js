"use strict";
const crypto = require("node:crypto");
const SETTINGS = "microsoftEmailSettings/current";
const ROOTS = { workout: "workoutNotificationOutbox", issue: "userIssueOutbox" };
const DOMAIN_SETTINGS = { workout: "workoutNotificationSettings/current", issue: "userIssueSettings/current" };
const RECIPIENTS = Object.freeze(["dylank@posetek.net"]);
// Kept only to validate original historical envelopes during explicit recovery.
const HISTORICAL_ISSUE_RECIPIENTS = Object.freeze([RECIPIENTS[0], "nolanj@posetek.net", "taiyow@posetek.net"]);
const RUN = /^[A-Za-z0-9_-]{1,200}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const payloadDigest = value => hash(canonical(value));
const deliveryAmendmentId = (jobId, originalPayloadDigest, effectivePayloadDigest, lowerBoundMillis, upperBoundMillis, authorizationId) =>
  hash(canonical({ reason: "approved_dylan_only_recent_unsent_microsoft", jobId, originalPayloadDigest, effectivePayloadDigest,
    lowerBoundMillis, upperBoundMillis, authorizationId }));
function onlyDylan(payload) {
  return Array.isArray(payload?.to) && payload.to.length === 1 && payload.to[0] === RECIPIENTS[0] && !payload.cc && !payload.bcc;
}
function amendedPayload(id, original, renderSource = null, correlation = null) {
  const payload = { ...original, to: [...RECIPIENTS] };
  if (!renderSource) return payload;
  const snapshot = renderSource.contactSnapshot, contact = require("./user-issue-contacts");
  if (renderSource.schemaVersion !== 1 || !jobValid("issue", id) || renderSource.job?.type !== "incident"
    || !Array.isArray(renderSource.job.lines) || snapshot?.schemaVersion !== 1
    || snapshot.actorUid !== null && !contact.UID.test(snapshot.actorUid || "")
    || snapshot.currentContact && !contact.validContact(snapshot.currentContact, snapshot.actorUid)
    || !/^PTM-[a-f0-9]{32}$/.test(correlation || "")) fail("provider_delivery_amendment_invalid");
  payload.text = `${require("./user-issue-model").payload({ ...renderSource.job, contactSnapshot: snapshot }, id).text}\n\nPoseTek email reference: ${correlation}`;
  if (original.html) {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    payload.html = `<div style="white-space:pre-wrap">${escape(payload.text)}</div>`;
  }
  return payload;
}
function effectiveDeliveryPayload(job) {
  // A historical consumed permission always remains bound to its original
  // envelope, including all three historical recipients. New claims snapshot
  // the effective envelope digest and recipients before granting permission.
  if (job?.microsoft?.claimedAtMillis && !job.microsoft.claimPayloadDigest) return job.payload;
  let payload = job?.payload;
  if (job?.deliveryAmendment) {
    const a = job.deliveryAmendment;
    if (a.schemaVersion !== 1 || a.kind !== "recipient_restriction" || !jobValid("issue", a.jobId) || job.id && job.id !== a.jobId
      || !/^[a-f0-9]{64}$/.test(a.id || "") || !RUN.test(a.authorizationId || "")
      || a.reason !== "approved_dylan_only_recent_unsent_microsoft" || a.authorizedBy !== RECIPIENTS[0]
      || a.originalPayloadDigest !== payloadDigest(payload) || a.effectivePayloadDigest !== payloadDigest(a.payload)
      || !onlyDylan(a.payload) || !Number.isSafeInteger(a.createdAtMillis) || a.createdAtMillis <= 0
      || !Number.isSafeInteger(a.approvedCutoffMillis) || a.approvedCutoffMillis <= 0
      || !Number.isSafeInteger(a.approvedFromMillis) || a.approvedFromMillis <= 0 || a.approvedFromMillis >= a.approvedCutoffMillis
      || a.id !== deliveryAmendmentId(a.jobId, a.originalPayloadDigest, a.effectivePayloadDigest, a.approvedFromMillis, a.approvedCutoffMillis, a.authorizationId)
      || a.renderSource && a.renderSourceDigest !== payloadDigest(a.renderSource)
      // Before permission is consumed, prove the audited rendering. Afterwards
      // its frozen digest remains authoritative across formatter upgrades.
      || !job.microsoft?.claimedAtMillis && canonical(amendedPayload(job.id || a.jobId, payload, a.renderSource || null, job.microsoft?.correlation)) !== canonical(a.payload)) fail("provider_delivery_amendment_invalid");
    payload = a.payload;
  }
  if (job?.microsoft?.claimPayloadDigest && (job.microsoft.claimPayloadDigest !== payloadDigest(payload)
    || canonical(job.microsoft.claimRecipients) !== canonical(payload?.to))) fail("provider_claim_envelope_invalid");
  return payload;
}
function issueRecipientAllowed(job) {
  try { return onlyDylan(effectiveDeliveryPayload(job)); } catch (_) { return false; }
}
function hasSendEvidence(job) {
  const send = job?.microsoft || {};
  return Boolean(job?.acceptedAtMillis || job?.providerId || job?.deliveryObservedAtMillis || job?.deliveredAtMillis
    || job?.lastProviderAtMillis || Object.keys(job?.recipientDelivery || {}).length
    || send.claimedAtMillis || send.runId || send.claimTokenHash || send.claimToken
    || send.receiptAcceptedAtMillis || send.receiptUncertainAtMillis || send.internetMessageId
    || send.traceCheckedAtMillis || send.traceUntilMillis || send.traceAmbiguous || job?.microsoftTraceDueAtMillis
    || send.claimPayloadDigest || send.claimRecipients || send.deliveryAmendmentId);
}
const jobValid = (kind, id) => kind === "issue" ? /^[a-f0-9]{64}$/.test(id || "") : kind === "workout" && /^[a-f0-9]{64}_(terminal|inactivity)$/.test(id || "");
function providerFor(job, settings) {
  // Every pre-migration attempted payload belongs to Resend, regardless of a
  // later operator setting. A provider's key cannot deduplicate another provider.
  if (job.deliveryProvider) return ["resend", "microsoft"].includes(job.deliveryProvider) ? job.deliveryProvider : null;
  if (job.firstAttemptAtMillis || job.attempts > 0 || job.payload || job.providerId) return "resend";
  return settings.emailProvider === undefined || settings.emailProvider === "resend" ? "resend" : settings.emailProvider === "microsoft" ? "microsoft" : null;
}
function enabled(config, kind, id, createdAt, now) {
  const pilot = config?.testJobIds;
  return config?.enabled === true && config.connectionVerified === true
    && config.senderMailbox === "alerts@posetek.net"
    && Number.isSafeInteger(config.activatedAtMillis) && config.activatedAtMillis > 0 && config.activatedAtMillis <= now
    && createdAt >= config.activatedAtMillis
    && (pilot === undefined || Array.isArray(pilot) && pilot.length > 0 && pilot.length <= 50
      && pilot.every(value => typeof value === "string" && /^(issue|workout):[a-f0-9]{64}(?:_(?:terminal|inactivity))?$/.test(value))
      && pilot.includes(`${kind}:${id}`));
}
function freeze(kind, id, payload, config, now, sourceGuard = null) {
  const allowed = RECIPIENTS;
  if (!jobValid(kind, id) || !Array.isArray(payload.to) || payload.to.length !== allowed.length
    || new Set(payload.to).size !== payload.to.length || payload.to.some(to => !allowed.includes(to)) || payload.cc || payload.bcc) fail("provider_recipient_invalid");
  const correlation = `PTM-${hash(`${kind}:${id}`).slice(0, 32)}`;
  const marker = `[${correlation}]`;
  const from = `${kind === "workout" ? "PoseTek Workouts" : "PoseTek Support"} <${config.senderMailbox}>`;
  return { deliveryProvider: "microsoft", payload: { ...payload, from, subject: `${marker} ${payload.subject}`.slice(0, 250),
    text: `${payload.text}\n\nPoseTek email reference: ${correlation}`,
    ...(payload.html ? { html: `${payload.html}<p>PoseTek email reference: ${correlation}</p>` } : {}) },
  microsoft: { schemaVersion: 1, correlation, senderMailbox: config.senderMailbox, frozenAtMillis: now, sourceGuard } };
}
function authenticate(header, secret) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512 || typeof header !== "string" || header.length > 512) return false;
  const a = Buffer.from(header), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const deadlineField = kind => kind === "workout" ? "dispatchAfterMillis" : "dueAtMillis";
function aggregate(recipients, deliveries, unknown = "accepted") {
  const states = recipients.map(to => deliveries[to]?.status || unknown);
  return ["suppressed", "bounced", "failed", "delayed", "needs_review"].find(status => states.includes(status))
    || (states.every(status => status === "delivered") ? "delivered" : "accepted");
}
module.exports = { SETTINGS, ROOTS, DOMAIN_SETTINGS, RECIPIENTS, HISTORICAL_ISSUE_RECIPIENTS, RUN, fail, hash, canonical, payloadDigest, deliveryAmendmentId,
  onlyDylan, amendedPayload, effectiveDeliveryPayload, issueRecipientAllowed, hasSendEvidence, jobValid, providerFor, enabled, freeze, authenticate, deadlineField, aggregate };
