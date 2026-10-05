"use strict";
const M = require("./microsoft-email-model");
const { UID, validContact } = require("./user-issue-contacts");
const { classifyOccurrence } = require("./user-issue-classification");
const SOURCE = "posetek_notification_policy", MODE = "first_and_daily";
const HEX = /^[a-f0-9]{64}$/;
const RANK = { diagnostic: 0, reported: 1, error: 2, critical: 3 };
const fail = code => { throw Object.assign(new Error(code), { code }); };

function configuration(settings, at) {
  const policy = settings?.notificationPolicy;
  if (policy === undefined || policy === null) return null;
  if (policy.schemaVersion !== 1 || policy.mode !== MODE || !Number.isSafeInteger(policy.activatedAtMillis)
    || policy.activatedAtMillis <= 0 || policy.activatedAtMillis > at
    || Object.keys(policy).some(key => !["schemaVersion", "mode", "activatedAtMillis"].includes(key))) fail("provider_notification_policy_invalid");
  return { ...policy, namespace: M.hash(M.canonical(policy)) };
}
function occurrenceIdentity(job, occurrence) {
  if (!HEX.test(job.id || "") || !HEX.test(job.issueId || "") || !occurrence || occurrence.id !== job.id
    || occurrence.issueId !== job.issueId || !Number.isSafeInteger(occurrence.receivedAtMillis)
    || occurrence.receivedAtMillis !== job.createdAtMillis || (occurrence.reporterUid || null) !== (job.actorUid || null)) fail("provider_notification_occurrence_mismatch");
  const actorUid = UID.test(occurrence.reporterUid || "") ? occurrence.reporterUid : null;
  const targetId = UID.test(occurrence.player?.id || "") ? occurrence.player.id : null;
  if (job.contactSnapshot && (job.contactSnapshot.schemaVersion !== 1 || (job.contactSnapshot.actorUid || null) !== actorUid
    || (job.contactSnapshot.player?.id || null) !== targetId || job.contactSnapshot.operation !== occurrence.operation
    || job.contactSnapshot.currentContact && !validContact(job.contactSnapshot.currentContact, actorUid)
    || job.contactSnapshot.authenticatedSnapshot && (job.contactSnapshot.authenticatedSnapshot.uid !== actorUid
      || job.contactSnapshot.authenticatedSnapshot.source !== "authenticated_token"))) fail("provider_notification_identity_mismatch");
  if (occurrence.currentContact && !validContact(occurrence.currentContact, actorUid)) fail("provider_notification_identity_mismatch");
  return { actorUid, targetId };
}
function auditDecision(policy, job, at, reason, identityEvidence = null, reasons = [reason]) {
  return { schemaVersion: 1, source: SOURCE, mode: MODE, policyActivationMillis: policy.activatedAtMillis,
    policyNamespace: policy.namespace, jobId: job.id, issueId: job.issueId || null,
    occurrenceId: job.type === "incident" ? job.id : null, type: job.type,
    action: ["routine_repeat", "backlog_before_cutover"].includes(reason) ? "daily_summary" : "immediate",
    reason, reasons, identityEvidence, evaluatedAtMillis: at,
    originalPayloadDigest: job.payload ? M.payloadDigest(job.payload) : null,
    effectivePayloadDigest: job.payload ? M.payloadDigest(M.effectiveDeliveryPayload(job)) : null };
}

/** All reads precede caller writes. This is a preview until commitImmediate is
 * executed in the same transaction as Microsoft's consumed send permission.
 * No issue aggregate's latest actor/target is used for an older notification.
 */
async function prepare({ tx, db, settings, job, at }) {
  const policy = configuration(settings, at);
  if (!policy || job.deliveryProvider !== "microsoft" || M.hasSendEvidence(job)) return null;
  if (!HEX.test(job.id || "") || !["incident", "status", "daily"].includes(job.type)
    || !Number.isSafeInteger(job.createdAtMillis) || job.createdAtMillis <= 0) fail("provider_notification_job_invalid");
  // The cutover backlog is retained for the recovery report, never a burst of
  // delayed emails. This applies to old statuses and daily jobs as well.
  if (job.createdAtMillis < policy.activatedAtMillis) return { decision: auditDecision(policy, job, at, "backlog_before_cutover") };
  if (job.type !== "incident") {
    // Verified is the only recovery label. A fixed transition is a proposed fix,
    // and an absence of alerts never constitutes recovery evidence.
    const transition = job.notificationTransition;
    const recovery = job.type === "status" && transition?.schemaVersion === 1 && transition.to === "verified"
      && transition.fixRef && transition.verification && transition.changedBy === job.actorUid;
    return { decision: auditDecision(policy, job, at, job.type === "daily" ? "daily_summary_message" : recovery ? "confirmed_recovery" : "status_change") };
  }
  const occurrence = (await tx.get(db.doc(`userIssueOccurrences/${job.id}`))).data();
  const identity = occurrenceIdentity(job, occurrence), classification = classifyOccurrence(occurrence);
  const severity = classification.effectiveKind === "crash" ? 3 : RANK[occurrence.severity] ?? 2;
  const stateRef = db.doc(`userIssueNotificationState/${M.hash(`${policy.namespace}:${job.issueId}`)}`);
  const state = (await tx.get(stateRef)).data();
  if (state && (state.schemaVersion !== 1 || state.source !== SOURCE || state.policyNamespace !== policy.namespace
    || state.issueId !== job.issueId || !Number.isInteger(state.maxSeverity) || state.maxSeverity < 0 || state.maxSeverity > 3
    || !HEX.test(state.firstJobId || "") || !Number.isSafeInteger(state.firstAtMillis))) fail("provider_notification_state_invalid");
  const audiences = [];
  for (const [kind, id] of [["account", identity.actorUid], ["athlete", identity.targetId]]) {
    if (!id) continue;
    const ref = db.doc(`userIssueNotificationAudience/${M.hash(`${policy.namespace}:${job.issueId}:${kind}:${id}`)}`);
    const seen = (await tx.get(ref)).data();
    if (seen && (seen.schemaVersion !== 1 || seen.source !== SOURCE || seen.policyNamespace !== policy.namespace
      || seen.issueId !== job.issueId || seen.kind !== kind || seen.identityId !== id || !HEX.test(seen.firstJobId || ""))) fail("provider_notification_audience_invalid");
    audiences.push({ ref, seen, kind, id });
  }
  const reasons = [];
  if (!state) reasons.push("first_issue");
  for (const audience of audiences) if (!audience.seen) reasons.push(audience.kind === "account" ? "new_reporting_account" : "new_target_athlete");
  if (state && severity > state.maxSeverity) reasons.push("severity_escalation");
  const recurrence = occurrence.notificationRecurrence;
  if (recurrence?.schemaVersion === 1 && ["fixed", "verified"].includes(recurrence.previousState)
    && Number.isSafeInteger(recurrence.previousUpdatedAtMillis) && recurrence.previousUpdatedAtMillis > 0) reasons.push("recurrence_after_resolution");
  const reason = reasons[0] || "routine_repeat";
  return { decision: auditDecision(policy, job, at, reason, { ...identity, accountRole: /failureCases|fieldReports|system_diagnostic/i.test(`${occurrence.source} ${occurrence.code}`) ? "reporter_uploader_only" : classification.scope }, reasons.length ? reasons : [reason]),
    stateRef, state, severity, audiences, policy };
}
function commitImmediate(tx, prepared, job, at) {
  if (!prepared || prepared.decision.action !== "immediate") return;
  if (!prepared.stateRef) return;
  const { policy, state, stateRef, audiences, severity } = prepared;
  tx.set(stateRef, { schemaVersion: 1, source: SOURCE, policyNamespace: policy.namespace, issueId: job.issueId,
    firstJobId: state?.firstJobId || job.id, firstAtMillis: state?.firstAtMillis || at,
    maxSeverity: Math.max(state?.maxSeverity ?? -1, severity), lastJobId: job.id, lastAtMillis: at });
  for (const audience of audiences) if (!audience.seen) tx.create(audience.ref, { schemaVersion: 1, source: SOURCE,
    policyNamespace: policy.namespace, issueId: job.issueId, kind: audience.kind, identityId: audience.id, firstJobId: job.id, firstAtMillis: at });
}
function defer(tx, ref, prepared, job, at) {
  if (!prepared || prepared.decision.action !== "daily_summary" || M.hasSendEvidence(job)) fail("provider_notification_defer_invalid");
  const decision = prepared.decision;
  tx.create(ref.collection("notificationPolicyAudits").doc(M.hash(`${decision.policyNamespace}:${job.id}`)), {
    ...decision, originalStatus: job.status, originalDueAtMillis: job.dueAtMillis || null,
    originalLeaseId: job.leaseId || null, originalFailureCode: job.failureCode || null,
    originalFailureMessage: job.failureMessage || null, noSendPermissionConsumed: true, deferredAtMillis: at });
  tx.update(ref, { status: "deferred_to_summary", dueAtMillis: null, leaseId: null,
    notificationDecision: decision, notificationDeferredAtMillis: at, failureCode: null, failureMessage: null });
}
function review(tx, ref, error) {
  tx.update(ref, { status: "needs_review", dueAtMillis: null, leaseId: null,
    failureCode: /^provider_notification_[a-z_]+$/.test(error?.code || "") ? error.code : "provider_notification_policy_invalid",
    failureMessage: "Notification evidence did not pass the current policy checks; no new send permission was consumed." });
}
module.exports = { SOURCE, MODE, configuration, occurrenceIdentity, prepare, commitImmediate, defer, review };
