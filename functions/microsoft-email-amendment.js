"use strict";
// Operator-only recovery primitive: deliberately not exposed as a callable,
// trigger or schedule. Never edits the original frozen payload or send claims.
const M = require("./microsoft-email-model");
const REASON = "approved_dylan_only_recent_unsent_microsoft";
function validateInput(input, at) {
  if (!input || !M.jobValid("issue", input.jobId) || !/^[a-f0-9]{64}$/.test(input.expectedOriginalDigest || "")
    || !M.RUN.test(input.authorizationId || "") || !Number.isSafeInteger(input.lowerBoundMillis) || input.lowerBoundMillis <= 0
    || !Number.isSafeInteger(input.upperBoundMillis) || input.upperBoundMillis <= input.lowerBoundMillis || input.upperBoundMillis > at) M.fail("amendment_invalid_request");
}
function amendmentFor(job, input, at, renderSource = null) {
  validateInput(input, at);
  if (M.payloadDigest(job?.payload) !== input.expectedOriginalDigest) M.fail("amendment_original_changed");
  const original = job.payload;
  if (!Array.isArray(original?.to) || !original.to.length || new Set(original.to).size !== original.to.length
    || !original.to.includes(M.RECIPIENTS[0]) || original.to.some(to => !M.HISTORICAL_ISSUE_RECIPIENTS.includes(to))
    || original.cc || original.bcc) M.fail("amendment_original_recipient_invalid");
  const payload = M.amendedPayload(input.jobId, original, renderSource, job.microsoft?.correlation), effectivePayloadDigest = M.payloadDigest(payload);
  const id = M.deliveryAmendmentId(input.jobId, input.expectedOriginalDigest, effectivePayloadDigest, input.lowerBoundMillis, input.upperBoundMillis, input.authorizationId);
  return { schemaVersion: 1, kind: "recipient_restriction", id, jobId: input.jobId, reason: REASON, authorizedBy: M.RECIPIENTS[0],
    authorizationId: input.authorizationId, originalPayloadDigest: input.expectedOriginalDigest, effectivePayloadDigest, payload,
    createdAtMillis: at, approvedFromMillis: input.lowerBoundMillis, approvedCutoffMillis: input.upperBoundMillis,
    ...(renderSource ? { renderSource, renderSourceDigest: M.payloadDigest(renderSource) } : {}),
    previousDeliveryState: Object.fromEntries(["status", "dueAtMillis", "leaseId", "leaseUntilMillis", "failureCode", "failureMessage", "attempts", "firstAttemptAtMillis"]
      .map(key => [key, job[key] === undefined ? null : job[key]])) };
}
function ineligible(job, input, at, receiptExists = false) {
  if (!job || job.deliveryProvider !== "microsoft" || !job.microsoft || !job.payload || !job.firstAttemptAtMillis) return "amendment_not_frozen_microsoft";
  if (!Number.isSafeInteger(job.createdAtMillis) || job.createdAtMillis < input.lowerBoundMillis || job.createdAtMillis >= input.upperBoundMillis) return "amendment_outside_approved_window";
  if (!["incident", "status", "daily"].includes(job.type) || !["pending", "sending", "needs_review"].includes(job.status)) return "amendment_job_not_recoverable";
  if (M.hasSendEvidence(job) || receiptExists) return "amendment_send_evidence_present";
  if (job.leaseUntilMillis > at) return "amendment_dispatch_lease_active";
  return null;
}
async function amendRecentUnclaimed({ db, input, now = Date.now, dryRun = true }) {
  validateInput(input, now());
  return db.runTransaction(async tx => {
    const at = now(), ref = db.doc(`${M.ROOTS.issue}/${input.jobId}`);
    const job = (await tx.get(ref)).data(), receipts = await tx.get(ref.collection("receipts").limit(1));
    const settings = (await tx.get(db.doc(M.DOMAIN_SETTINGS.issue))).data();
    const occurrence = job?.type === "incident" ? (await tx.get(db.doc(`userIssueOccurrences/${input.jobId}`))).data() : null;
    if (!job) return { applied: false, reason: "amendment_not_frozen_microsoft" };
    let renderSource = job.deliveryAmendment?.renderSource || null;
    if (!job.deliveryAmendment && occurrence && occurrence.issueId === job.issueId && (occurrence.reporterUid || null) === (job.actorUid || null)) {
      renderSource = { schemaVersion: 1, occurrenceId: input.jobId, occurrenceDigest: M.payloadDigest(occurrence),
        job: Object.fromEntries(["title", "lines", "type", "issueId"].map(key => [key, job[key] === undefined ? null : job[key]])),
        contactSnapshot: require("./user-issue-contacts").occurrenceContactSnapshot(occurrence) };
    }
    const amendment = amendmentFor(job, input, at, renderSource);
    if (job.deliveryAmendment) {
      if (job.deliveryAmendment.id !== amendment.id || job.deliveryAmendment.originalPayloadDigest !== amendment.originalPayloadDigest
        || job.deliveryAmendment.effectivePayloadDigest !== amendment.effectivePayloadDigest) M.fail("amendment_conflict");
      M.effectiveDeliveryPayload(job);
      return { applied: false, duplicate: true, amendmentId: amendment.id };
    }
    if (settings?.sendEnabled !== false) return { applied: false, reason: "amendment_sending_not_paused" };
    const reason = ineligible(job, input, at, !receipts.empty);
    if (reason) return { applied: false, reason };
    M.effectiveDeliveryPayload({ ...job, deliveryAmendment: amendment });
    if (!dryRun) tx.update(ref, { deliveryAmendment: amendment, status: "pending", dueAtMillis: at,
      leaseId: null, leaseUntilMillis: 0, failureCode: null, failureMessage: null });
    return { applied: !dryRun, eligible: true, amendmentId: amendment.id, originalPayloadDigest: input.expectedOriginalDigest,
      effectivePayloadDigest: amendment.effectivePayloadDigest };
  });
}
module.exports = { REASON, validateInput, amendmentFor, ineligible, amendRecentUnclaimed };
