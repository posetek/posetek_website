"use strict";
const crypto = require("node:crypto");

const GROUPS = Object.freeze(["actions", "instances", "emails", "dailyRows"]);
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  throw new Error("tracker_non_json_value");
}
const digest = value => crypto.createHash("sha256").update(canonical(value)).digest("hex");
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const pick = (value, fields) => Object.fromEntries(fields.filter(field => value?.[field] !== undefined).map(field => [field, value[field]]));

// A dispatcher lease/attempt is operational churn, not a new incident or a
// confirmed delivery. Sending is presented as pending until the provider replies.
function materialOutbox(job) {
  if (!job || !["incident", "status", "daily"].includes(job.type)) return null;
  const value = pick(job, ["type", "issueId", "title", "lines", "createdAtMillis", "actorUid", "providerId", "acceptedAtMillis", "deliveredAtMillis", "failureCode", "uncertain"]);
  value.status = job.status === "sending" ? "pending" : job.status || "unknown";
  value.recipients = Array.isArray(job.payload?.to) ? [...job.payload.to].sort() : [];
  value.recipientDelivery = job.recipientDelivery || {};
  return value;
}

function sealBatch({ batchId, workbookKey, expectedRevision, generatedAt, changes }) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail("tracker_invalid_revision");
  for (const group of GROUPS) {
    if (!Array.isArray(changes?.[group])) fail("tracker_invalid_changes");
    const keys = new Set();
    for (const row of changes[group]) {
      if (!row || typeof row.key !== "string" || !row.key || keys.has(row.key)) fail("tracker_duplicate_or_missing_key");
      keys.add(row.key);
    }
  }
  const batch = { schemaVersion: 1, batchId, workbookKey, expectedRevision, generatedAt, changes };
  return { ...batch, payloadSha256: digest(batch) };
}

function verifyReceipt(batch, receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.verified !== true || receipt.batchId !== batch.batchId ||
      receipt.workbookKey !== batch.workbookKey || receipt.payloadSha256 !== batch.payloadSha256 || receipt.revision !== batch.expectedRevision + 1) fail("tracker_unverified_receipt");
  for (const group of GROUPS) {
    const expected = batch.changes[group].map(row => row.key).sort();
    const actual = receipt.applied?.[group];
    if (!Array.isArray(actual) || actual.some(key => typeof key !== "string") || canonical([...actual].sort()) !== canonical(expected)) fail("tracker_incomplete_receipt");
    if (!Number.isSafeInteger(receipt.counts?.[group]) || receipt.counts[group] < expected.length) fail("tracker_invalid_receipt_counts");
  }
  if (Object.keys(receipt.counts).sort().join(",") !== [...GROUPS].sort().join(",")) fail("tracker_invalid_receipt_counts");
  return receipt;
}
module.exports = { GROUPS, canonical, digest, fail, materialOutbox, sealBatch, verifyReceipt };
