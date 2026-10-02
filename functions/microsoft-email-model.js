"use strict";
const crypto = require("node:crypto");
const SETTINGS = "microsoftEmailSettings/current";
const ROOTS = { workout: "workoutNotificationOutbox", issue: "userIssueOutbox" };
const DOMAIN_SETTINGS = { workout: "workoutNotificationSettings/current", issue: "userIssueSettings/current" };
const RECIPIENTS = ["dylank@posetek.net", "nolanj@posetek.net", "taiyow@posetek.net"];
const RUN = /^[A-Za-z0-9_-]{1,200}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
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
  const allowed = kind === "workout" ? RECIPIENTS.slice(0, 1) : RECIPIENTS;
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
module.exports = { SETTINGS, ROOTS, DOMAIN_SETTINGS, RECIPIENTS, RUN, fail, hash, jobValid, providerFor, enabled, freeze, authenticate, deadlineField, aggregate };
