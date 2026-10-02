"use strict";
const crypto = require("node:crypto");
const M = require("./microsoft-email-model");
const TRACE_WINDOW = 7 * 86400000, RECEIPT_WAIT = 10 * 60000, SEND_BUDGET = 20;
const RECIPIENT_BUDGET = 9000, RECIPIENT_WINDOW = 86400000, RECIPIENT_BUCKET = 15 * 60000;
function recipientBudget(budget, at, recipients) {
  // Include every bucket overlapping the rolling day. Counting the complete
  // boundary bucket can delay a claim by up to 15 minutes, never admit it early.
  const rows = budget?.recipientBuckets || [];
  if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !Number.isSafeInteger(row?.start)
    || row.start < 0 || row.start % RECIPIENT_BUCKET || !Number.isSafeInteger(row?.count) || row.count < 0 || row.count > RECIPIENT_BUDGET)) M.fail("provider_send_budget_invalid");
  const buckets = new Map();
  for (const row of rows) if (row.start + RECIPIENT_BUCKET > at - RECIPIENT_WINDOW) buckets.set(row.start, (buckets.get(row.start) || 0) + row.count);
  if ([...buckets.values()].reduce((sum, count) => sum + count, 0) + recipients > RECIPIENT_BUDGET) return null;
  const current = Math.floor(at / RECIPIENT_BUCKET) * RECIPIENT_BUCKET;
  buckets.set(current, (buckets.get(current) || 0) + recipients);
  return [...buckets].sort(([a], [b]) => a - b).map(([start, count]) => ({ start, count }));
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function validate(data, receipt = false) {
  const keys = receipt ? ["schemaVersion", "kind", "jobId", "runId", "claimToken", "outcome"] : ["schemaVersion", "kind", "jobId", "runId"];
  if (!data || Object.keys(data).some(key => !keys.includes(key)) || data.schemaVersion !== 1 || !M.jobValid(data.kind, data.jobId) || !M.RUN.test(data.runId || "")
    || receipt && (!/^[a-f0-9]{64}$/.test(data.claimToken || "") || !["accepted", "uncertain"].includes(data.outcome))) M.fail("email_invalid_request");
}
function domainAllows(kind, settings, job, at) {
  const value = kind === "workout" ? require("./workout-notifications").settingsValue(settings, at) : require("./user-issue-model").setting(settings, at);
  return value.enabled && value.sendEnabled === true && job.createdAtMillis >= value.activatedAtMillis
    && (kind === "workout" ? !value.pilot || value.testPlayerIds.includes(job.playerId) : !value.testUids || value.testUids.includes(job.actorUid));
}
function createMicrosoftEmail({ db, now = Date.now, randomToken = () => crypto.randomBytes(32).toString("hex"), traceReader, logger = console }) {
  let traceDeadline = Infinity;
  const refFor = (kind, id) => db.doc(`${M.ROOTS[kind]}/${id}`);
  function inactive(tx, kind, job) {
    if (kind === "workout" && job.eventType === "inactivity") tx.set(db.doc(`workoutNotificationActivity/${job.executionId}`), { inactivityNotified: true }, { merge: true });
  }
  async function claim(data) {
    validate(data);
    return db.runTransaction(async tx => {
      const at = now(), ref = refFor(data.kind, data.jobId);
      const config = (await tx.get(db.doc(M.SETTINGS))).data(), settings = (await tx.get(db.doc(M.DOMAIN_SETTINGS[data.kind]))).data();
      const job = (await tx.get(ref)).data();
      if (!job || job.deliveryProvider !== "microsoft" || !job.microsoft || !job.payload || !job.firstAttemptAtMillis || job.microsoft.claimedAtMillis
        || !["pending", "sending"].includes(job.status)
        || !M.enabled(config, data.kind, data.jobId, job.createdAtMillis, at) || !domainAllows(data.kind, settings, job, at)) return { schemaVersion: 1, allowSend: false };
      const budgetRef = db.doc("microsoftEmailState/sendBudget"), budget = (await tx.get(budgetRef)).data();
      const times = (budget?.claimTimes || []).filter(value => Number.isSafeInteger(value) && value > at - 300000);
      if (times.length >= SEND_BUDGET) return { schemaVersion: 1, allowSend: false, deferred: true };
      const recipientBuckets = recipientBudget(budget, at, job.payload.to.length);
      if (!recipientBuckets) return { schemaVersion: 1, allowSend: false, deferred: true };
      const guard = job.microsoft.sourceGuard;
      if (data.kind === "workout") {
        const path = `players/${job.playerId}/${job.source}/${job.logId}`;
        if (!guard || guard.logPath !== path) M.fail("email_source_guard_invalid");
        const snapshot = await tx.get(db.doc(path));
        if (!snapshot.exists || require("./workout-notifications").savedFingerprint(snapshot.data()) !== guard.fingerprint) {
          tx.update(ref, { status: "cancelled", [M.deadlineField(data.kind)]: null, leaseId: null, failureMessage: "The workout changed before Microsoft claimed the email." });
          return { schemaVersion: 1, allowSend: false };
        }
      }
      // The permission is consumed before returning any message. A lost claim
      // response intentionally requires review; repeating even the same run ID
      // cannot recover another send permission.
      const token = randomToken();
      const microsoft = { ...job.microsoft, claimedAtMillis: at, runId: data.runId, claimTokenHash: M.hash(token), traceUntilMillis: at + TRACE_WINDOW };
      tx.set(budgetRef, { claimTimes: [...times, at], recipientBuckets });
      tx.update(ref, { microsoft, status: "sending", [M.deadlineField(data.kind)]: null, leaseId: null,
        microsoftTraceDueAtMillis: at + 300000, failureCode: null, failureMessage: null });
      return { schemaVersion: 1, allowSend: true, kind: data.kind, jobId: data.jobId, runId: data.runId, claimToken: token,
        correlation: microsoft.correlation, fromMailbox: microsoft.senderMailbox, to: job.payload.to.join(";"), subject: job.payload.subject,
        html: job.payload.html || `<div style="white-space:pre-wrap">${escape(job.payload.text)}</div>` };
    });
  }
  async function receipt(data) {
    validate(data, true);
    return db.runTransaction(async tx => {
      const ref = refFor(data.kind, data.jobId), job = (await tx.get(ref)).data(), at = now();
      if (!job || job.deliveryProvider !== "microsoft" || !job.microsoft?.claimedAtMillis || job.microsoft.runId !== data.runId
        || !M.authenticate(M.hash(data.claimToken), job.microsoft.claimTokenHash)) M.fail("email_claim_mismatch");
      const field = data.outcome === "accepted" ? "receiptAcceptedAtMillis" : "receiptUncertainAtMillis";
      if (job.microsoft[field]) return { schemaVersion: 1, recorded: true, duplicate: true };
      const deliveries = { ...job.recipientDelivery };
      if (data.outcome === "accepted") for (const to of job.payload.to) if (!deliveries[to]) deliveries[to] = { status: "accepted", at, evidence: "flow_action" };
      const status = data.outcome === "accepted" ? M.aggregate(job.payload.to, deliveries) : job.acceptedAtMillis || Object.keys(deliveries).length ? job.status : "needs_review";
      const finalStatus = job.microsoft.traceAmbiguous === true ? "needs_review" : status;
      tx.update(ref, { microsoft: { ...job.microsoft, [field]: at }, recipientDelivery: deliveries,
        status: finalStatus,
        ...(data.outcome === "accepted" ? { acceptedAtMillis: job.acceptedAtMillis || at, providerId: job.providerId || `microsoft-${data.runId}` } : {}),
        [M.deadlineField(data.kind)]: null, leaseId: null,
        failureCode: data.outcome === "accepted" ? null : "provider_flow_uncertain",
        failureMessage: finalStatus === "needs_review" ? "Microsoft send outcome is uncertain; automatic resend is blocked." : ["failed", "suppressed"].includes(finalStatus) ? job.failureMessage || null : null });
      if (data.outcome === "accepted") inactive(tx, data.kind, job);
      return { schemaVersion: 1, recorded: true };
    });
  }
  async function applyTrace(kind, id, result) {
    return db.runTransaction(async tx => {
      const ref = refFor(kind, id), job = (await tx.get(ref)).data(), at = now();
      if (job?.deliveryProvider !== "microsoft" || !job.microsoft?.claimedAtMillis) return;
      const send = job.microsoft, rows = result.rows.filter(row => row && row.subject === job.payload.subject
        && String(row.senderAddress).toLowerCase() === send.senderMailbox && job.payload.to.includes(String(row.recipientAddress).toLowerCase())
        && Number.isFinite(Date.parse(row.receivedDateTime)) && Date.parse(row.receivedDateTime) >= send.claimedAtMillis - 300000
        && Date.parse(row.receivedDateTime) <= Math.min(at, send.claimedAtMillis + 86400000));
      const invalid = rows.some(row => typeof row.messageId !== "string" || !row.messageId || row.messageId.length > 1000 || typeof row.id !== "string" || !row.id || row.id.length > 200);
      const messageIds = new Set(rows.map(row => row.messageId));
      const contradictory = job.payload.to.some(to => new Set(rows.filter(row => String(row.recipientAddress).toLowerCase() === to).map(row => row.status)).size > 1);
      const ambiguous = invalid || contradictory || messageIds.size > 1 || send.internetMessageId && rows.some(row => row.messageId !== send.internetMessageId);
      const deliveries = { ...job.recipientDelivery };
      if (!ambiguous) for (const row of rows) {
        const to = row.recipientAddress.toLowerCase(), previous = deliveries[to];
        const status = ({ delivered: "delivered", failed: "failed", quarantined: "suppressed", filteredAsSpam: "suppressed", pending: "delayed", gettingStatus: "delayed" })[row.status] || "needs_review";
        if (previous?.observedAtMillis > result.checkedAtMillis || previous?.status === "delivered" && ["delayed", "needs_review"].includes(status)) continue;
        deliveries[to] = { status, at: result.checkedAtMillis, observedAtMillis: result.checkedAtMillis,
          exchangeReceivedAtMillis: Date.parse(row.receivedDateTime), traceStatus: row.status, traceId: row.id, evidence: "microsoft_trace" };
      }
      const expired = at >= send.traceUntilMillis;
      const missing = job.payload.to.some(to => !["delivered", "failed", "suppressed", "bounced"].includes(deliveries[to]?.status));
      const status = ambiguous || send.traceAmbiguous || expired && missing ? "needs_review" : rows.length ? M.aggregate(job.payload.to, deliveries, "needs_review")
        : !job.acceptedAtMillis && at >= send.claimedAtMillis + RECEIPT_WAIT ? "needs_review" : job.status;
      const settled = status === "delivered";
      tx.update(ref, { status, recipientDelivery: deliveries, microsoft: { ...send, traceCheckedAtMillis: result.checkedAtMillis,
        traceErrorCode: null, traceAmbiguous: Boolean(ambiguous || send.traceAmbiguous), ...(messageIds.size === 1 && !ambiguous ? { internetMessageId: [...messageIds][0] } : {}) },
        microsoftTraceDueAtMillis: settled || expired || ambiguous || send.traceAmbiguous ? null : at + 300000,
        ...(settled ? { deliveryObservedAtMillis: job.deliveryObservedAtMillis || result.checkedAtMillis } : {}),
        failureMessage: status === "needs_review" ? ambiguous || send.traceAmbiguous ? "Microsoft trace matched conflicting message evidence; automatic resend is blocked." : "Microsoft delivery evidence is incomplete; automatic resend is blocked." : ["failed", "suppressed"].includes(status) ? "Microsoft trace reported a recipient delivery problem." : null,
        [M.deadlineField(kind)]: null, leaseId: null });
      if (rows.length) inactive(tx, kind, job);
      return { status, matched: rows.length };
    });
  }
  async function reserveTraceRequest() {
    if (now() >= traceDeadline - 15000) M.fail("provider_trace_deadline");
    return db.runTransaction(async tx => {
      const ref = db.doc("microsoftEmailState/traceBudget"), state = (await tx.get(ref)).data(), at = now();
      const times = (state?.requestTimes || []).filter(value => Number.isSafeInteger(value) && value > at - 300000);
      if (times.length >= 80) M.fail("provider_trace_budget");
      tx.set(ref, { requestTimes: [...times, at] });
    });
  }
  async function reconcile() {
    const lease = randomToken(), leaseRef = db.doc("microsoftEmailState/reconciliation"), started = now();
    const acquired = await db.runTransaction(async tx => {
      const config = (await tx.get(db.doc(M.SETTINGS))).data(), state = (await tx.get(leaseRef)).data();
      if (config?.connectionVerified !== true || config.traceEnabled !== true || state?.leaseUntilMillis > now()) return false;
      tx.set(leaseRef, { lease, leaseUntilMillis: now() + 270000, startedAtMillis: now() }, { merge: true }); return true;
    });
    if (!acquired) return { checked: 0, disabledOrBusy: true };
    traceDeadline = started + 225000;
    let checked = 0, failures = 0;
    try {
      const groups = await Promise.all(Object.entries(M.ROOTS).map(async ([kind, root]) => ({ kind, rows: (await db.collection(root)
        .where("microsoftTraceDueAtMillis", ">", 0).where("microsoftTraceDueAtMillis", "<=", now()).orderBy("microsoftTraceDueAtMillis").limit(40).get()).docs })));
      const jobs = groups.flatMap(group => group.rows.map(row => ({ kind: group.kind, row }))).sort((a, b) => a.row.data().microsoftTraceDueAtMillis - b.row.data().microsoftTraceDueAtMillis);
      for (const { kind, row } of jobs) {
        if (now() >= started + 225000) break;
        try {
          const job = row.data();
          if (job.deliveryProvider !== "microsoft" || !job.microsoft?.claimedAtMillis) continue;
          if (now() >= job.microsoft.traceUntilMillis) await applyTrace(kind, row.id, { rows: [], checkedAtMillis: now() });
          else await applyTrace(kind, row.id, await traceReader.read(job));
          checked++;
        } catch (error) {
          failures++;
          const code = /^provider_[a-z0-9_]{1,60}$/.test(error?.code || "") ? error.code : "provider_trace_uncertain";
          await db.runTransaction(async tx => {
            const current = (await tx.get(row.ref)).data();
            if (current?.deliveryProvider !== "microsoft" || current.microsoftTraceDueAtMillis === null) return;
            tx.update(row.ref, { microsoft: { ...current.microsoft, traceErrorCode: code, traceCheckedAtMillis: now() }, microsoftTraceDueAtMillis: now() + 900000,
              ...(!current.acceptedAtMillis && current.status === "sending" && now() >= current.microsoft.claimedAtMillis + RECEIPT_WAIT
                ? { status: "needs_review", failureMessage: "Microsoft acknowledgement is missing and trace is unavailable; automatic resend is blocked." } : {}) });
          });
          logger.error("microsoft_email_trace_failed", { code });
          if (["provider_trace_budget", "provider_trace_http_429", "provider_trace_deadline"].includes(code)) break;
        }
      }
    } finally {
      traceDeadline = Infinity;
      await db.runTransaction(async tx => { const state = (await tx.get(leaseRef)).data(); if (state?.lease === lease) tx.update(leaseRef, { lease: null, leaseUntilMillis: 0, completedAtMillis: now(), checked, failures }); });
    }
    return { checked, failures };
  }
  return { claim, receipt, applyTrace, reconcile, reserveTraceRequest };
}
module.exports = { createMicrosoftEmail, validate, domainAllows, TRACE_WINDOW, RECEIPT_WAIT, SEND_BUDGET, RECIPIENT_BUDGET, RECIPIENT_WINDOW, RECIPIENT_BUCKET };
