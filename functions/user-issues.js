"use strict";
const crypto = require("node:crypto");
const { isClubAdmin, clubStaffCanAccessPlayer } = require("./club-access");
const M = require("./user-issue-model");
const LEASE = 120000, RETRY = 23 * 3600000;
function createUserIssues({ db, HttpsError, provider, now = Date.now, logger = console }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const settingsRef = db.doc("userIssueSettings/current");
  const issueRef = id => db.doc(`userIssues/${id}`), jobRef = id => db.doc(`userIssueOutbox/${id}`);
  const admin = auth => { if (!isClubAdmin(auth)) fail("permission-denied", "PoseTek administrator access is required."); };
  async function identity(auth, playerId) {
    let player = null;
    if (auth?.uid && M.ID.test(playerId || "")) {
      const doc = (await db.doc(`players/${playerId}`).get()).data();
      const owners = [doc?.authenticationUID, doc?.userUID].filter(value => value !== undefined && value !== null && value !== "");
      const owns = owners.length ? owners.every(value => value === auth.uid) : playerId === auth.uid;
      if (doc && (owns || isClubAdmin(auth) || await clubStaffCanAccessPlayer(db, auth.uid, doc))) player = { id: playerId, name: M.clean([doc.firstName, doc.lastName].filter(Boolean).join(" ") || doc.name) };
    }
    return { uid: auth?.uid || null, name: M.clean(auth?.displayName) || null, player };
  }
  async function submit(data, auth, ip = "unknown") {
    if (Object.hasOwn(data || {}, "ownerUid") && data.ownerUid !== (auth?.uid || null)) fail("failed-precondition", "Sign in to the account that created this report before retrying.");
    let event; try { event = M.normalize(data, now()); } catch (e) { fail("invalid-argument", e.message); }
    const who = await identity(auth, data.playerId);
    return ingest(event, who, { source: "client", sourceEvent: event.eventId, rateKey: M.hash(auth?.uid || ip) });
  }
  async function ingest(event, who, origin) {
    const at = now(), actor = who.uid || (who.player?.id ? `player:${who.player.id}` : `anonymous:${event.sessionId}`);
    // A correlated request is one incident even when both client and server report it.
    const occurrenceId = M.hash([actor, event.requestId ? `request:${event.requestId}` : `${origin.source}:${origin.sourceEvent}`]);
    const fingerprint = M.hash([event.platform, event.operation, event.code, event.kind === "report" ? occurrenceId : event.kind]);
    const ref = issueRef(fingerprint), occurrenceRef = db.doc(`userIssueOccurrences/${occurrenceId}`), out = jobRef(occurrenceId);
    const dayRef = db.doc(`userIssueDays/${M.periodKey(at)}`);
    return db.runTransaction(async tx => {
      const settings = M.setting((await tx.get(settingsRef)).data(), at);
      if (!settings.enabled || settings.testUids && !settings.testUids.includes(who.uid) || Object.hasOwn(origin, "receivedAtMillis") && (!Number.isFinite(origin.receivedAtMillis) || origin.receivedAtMillis < settings.activatedAtMillis) || origin.isTest && !settings.testUids) return { status: "disabled" };
      const existing = await tx.get(occurrenceRef);
      if (existing.exists) return { status: "received", reference: existing.data().issueId, occurrenceId, duplicate: true };
      const issue = (await tx.get(ref)).data(), day = (await tx.get(dayRef)).data() || {};
      const actorRef = dayRef.collection("actors").doc(M.hash(actor)), actorSeen = await tx.get(actorRef);
      const dailyIssueRef = dayRef.collection("issues").doc(fingerprint), dailyIssue = (await tx.get(dailyIssueRef)).data();
      const rateRef = origin.rateKey ? db.doc(`userIssueLimits/${M.hash([origin.rateKey, Math.floor(at / 3600000)])}`) : null;
      const globalRef = origin.rateKey ? db.doc(`userIssueLimits/global-${Math.floor(at / 3600000)}`) : null;
      const rate = rateRef ? (await tx.get(rateRef)).data()?.count || 0 : 0;
      const global = globalRef ? (await tx.get(globalRef)).data()?.count || 0 : 0;
      if (rateRef && (rate >= (who.uid ? 120 : 15) || global >= 3000)) fail("resource-exhausted", "Report intake is busy. Your report can be retried later.");
      const reopened = issue?.state === "verified" || issue?.state === "fixed";
      const title = `${event.kind === "report" ? "Problem reported" : event.kind === "crash" ? "App crash" : event.kind === "interrupted" ? "Interrupted session — cause unknown" : "Action failed"}: ${event.operation}`;
      const label = who.player?.name || who.name || (who.uid ? "Signed-in user" : "Anonymous user");
      const lines = [`Affected user: ${label}${who.uid ? ` (${who.uid})` : ""}`, `Platform: ${event.platform}; build: ${event.build}; device: ${event.device}`,
        `Operation: ${event.operation}; code: ${event.code}`, `Occurred: ${M.dateText(event.occurredAtMillis)}`, `Received: ${M.dateText(at)}`,
        ...(reopened ? ["This issue has returned after being marked fixed or verified."] : [])];
      const count = (issue?.occurrences || 0) + 1;
      tx.create(occurrenceRef, { ...event, id: occurrenceId, issueId: fingerprint, reporterUid: who.uid, reporterName: who.name,
        player: who.player || null, source: origin.source, sourceReference: origin.reference || null, receivedAtMillis: at });
      tx.set(ref, { id: fingerprint, title, platform: event.platform, operation: event.operation, code: event.code, kind: event.kind, severity: event.severity,
        state: reopened ? "new" : issue?.state || "new", firstReceivedAtMillis: issue?.firstReceivedAtMillis || at, updatedAtMillis: Math.max(at, (issue?.updatedAtMillis || 0) + 1),
        occurrences: count, latestOccurrenceId: occurrenceId, latestBuild: event.build, latestUser: label,
        ...(reopened ? { reopenedAtMillis: at } : {}) }, { merge: true });
      tx.create(out, { id: occurrenceId, issueId: fingerprint, type: "incident", title, lines, createdAtMillis: at, status: "pending", dueAtMillis: at, attempts: 0, actorUid: who.uid });
      tx.set(dayRef, { incidents: (day.incidents || 0) + 1, changes: day.changes || 0, lastAtMillis: at,
        affectedActors: (day.affectedActors || 0) + (actorSeen.exists ? 0 : 1), recurrences: (day.recurrences || 0) + (reopened ? 1 : 0),
        crashes: (day.crashes || 0) + (event.kind === "crash" ? 1 : 0), reports: (day.reports || 0) + (event.kind === "report" ? 1 : 0) }, { merge: true });
      if (!actorSeen.exists) tx.create(actorRef, { firstAtMillis: at });
      tx.set(dailyIssueRef, { title, count: (dailyIssue?.count || 0) + 1 });
      if (who.uid) tx.set(db.doc(`userIssueActors/${M.hash([who.uid, fingerprint])}`), { uid: who.uid, issueId: fingerprint, updatedAtMillis: at });
      if (rateRef) { tx.set(rateRef, { count: rate + 1, expiresAtMillis: at + 86400000 }); tx.set(globalRef, { count: global + 1, expiresAtMillis: at + 86400000 }); }
      return { status: "received", reference: fingerprint, occurrenceId };
    });
  }
  async function list(data, auth) {
    admin(auth);
    if (data?.evidenceId) {
      if (!/^[a-f0-9]{64}$/.test(data.evidenceId)) fail("invalid-argument", "Invalid evidence reference.");
      const row = (await db.doc(`userIssueOccurrences/${data.evidenceId}`).get()).data();
      if (!row) fail("not-found", "Evidence not found.");
      return { screenshot: row.screenshot || null };
    }
    if (data?.issueId) {
      if (!/^[a-f0-9]{64}$/.test(data.issueId)) fail("invalid-argument", "Invalid issue reference.");
      const issue = (await issueRef(data.issueId).get()).data();
      if (!issue) fail("not-found", "Issue not found.");
      const rows = await db.collection("userIssueOccurrences").where("issueId", "==", data.issueId).orderBy("receivedAtMillis", "desc").limit(50).get();
      const occurrences = await Promise.all(rows.docs.map(async row => {
        const { screenshot, ...value } = row.data();
        return { ...value, hasScreenshot: Boolean(screenshot), delivery: (await jobRef(row.id).get()).data()?.status || "not_queued" };
      }));
      return { issue, occurrences, limit: 50, truncated: rows.size === 50 };
    }
    if (data?.actorUid) {
      if (!M.ID.test(data.actorUid)) fail("invalid-argument", "Enter an exact account UID.");
      const rows = await db.collection("userIssueActors").where("uid", "==", data.actorUid).orderBy("updatedAtMillis", "desc").limit(100).get();
      const issues = await Promise.all(rows.docs.map(row => issueRef(row.data().issueId).get()));
      return { issues: issues.filter(row => row.exists).map(row => row.data()), cursor: null, truncated: rows.size === 100 };
    }
    let query = db.collection("userIssues").orderBy("updatedAtMillis", "desc").orderBy("__name__", "desc");
    if (data?.cursor && Number.isSafeInteger(data.cursor.at) && /^[a-f0-9]{64}$/.test(data.cursor.id)) query = query.startAfter(data.cursor.at, data.cursor.id);
    const rows = await query.limit(100).get();
    const last = rows.docs.at(-1);
    return { issues: rows.docs.map(row => row.data()), cursor: rows.size === 100 ? { at: last.data().updatedAtMillis, id: last.id } : null };
  }
  async function triage(data, auth) {
    admin(auth);
    if (!/^[a-f0-9]{64}$/.test(data?.issueId || "") || !M.STATES.includes(data.state) || !Number.isSafeInteger(data.expectedUpdatedAtMillis)) fail("invalid-argument", "Choose an issue and status.");
    const fixRef = M.redact(data.fixRef, 200), verification = M.redact(data.verification, 1000);
    if (["fixed", "verified"].includes(data.state) && !fixRef || data.state === "verified" && !verification) fail("invalid-argument", "Record the fix and, when verifying, the verification evidence.");
    return db.runTransaction(async tx => {
      const ref = issueRef(data.issueId), issue = (await tx.get(ref)).data();
      const at = now(), dayRef = db.doc(`userIssueDays/${M.periodKey(at)}`), day = (await tx.get(dayRef)).data() || {};
      if (!issue) fail("not-found", "Issue not found.");
      if (issue.updatedAtMillis !== data.expectedUpdatedAtMillis) fail("aborted", "The issue changed. Refresh before updating it.");
      if (issue.state === data.state) return { unchanged: true };
      const id = M.hash([data.issueId, issue.updatedAtMillis, data.state]);
      tx.update(ref, { state: data.state, fixRef, verification, updatedBy: auth.uid, updatedAtMillis: Math.max(at, issue.updatedAtMillis + 1) });
      tx.create(jobRef(id), { id, issueId: data.issueId, type: "status", actorUid: auth.uid, title: `${issue.title} — ${data.state}`, lines: [`Status changed from ${issue.state} to ${data.state}.`, `Updated: ${M.dateText(at)}`], createdAtMillis: at, status: "pending", dueAtMillis: at, attempts: 0 });
      tx.set(dayRef, { changes: (day.changes || 0) + 1, incidents: day.incidents || 0, lastAtMillis: at }, { merge: true });
      return { updated: true };
    });
  }
  async function dispatch(id) {
    if (!/^[a-f0-9]{64}$/.test(id || "")) return;
    const claimed = await db.runTransaction(async tx => {
      const at = now(), settings = M.setting((await tx.get(settingsRef)).data(), at), ref = jobRef(id), job = (await tx.get(ref)).data();
      if (!settings.enabled || settings.sendEnabled !== true || !job || !["pending", "sending"].includes(job.status) || !job.dueAtMillis || job.dueAtMillis > at) return null;
      if (job.createdAtMillis < settings.activatedAtMillis || settings.testUids && !settings.testUids.includes(job.actorUid)) { tx.update(ref, { status: "cancelled", dueAtMillis: null }); return null; }
      if (job.firstAttemptAtMillis && at >= job.firstAttemptAtMillis + RETRY) { tx.update(ref, { status: "needs_review", dueAtMillis: null }); logger.error("user_issue_delivery_failed", { code: "retry_window", jobId: id }); return null; }
      const next = { payload: job.payload || M.payload(job, id), leaseId: crypto.randomUUID(), firstAttemptAtMillis: job.firstAttemptAtMillis || at,
        attempts: (job.attempts || 0) + 1, status: "sending", dueAtMillis: at + LEASE, uncertain: job.uncertain === true || job.status === "sending" };
      tx.update(ref, next); return { ...job, ...next };
    });
    if (!claimed) return;
    let result, error;
    try { result = await provider.send(claimed.payload, `posetek-user-issue/${id}`); } catch (e) { error = e; }
    await db.runTransaction(async tx => {
      const ref = jobRef(id), current = (await tx.get(ref)).data();
      if (current?.leaseId !== claimed.leaseId || current.status !== "sending") return;
      if (result?.id) { tx.update(ref, { status: "accepted", providerId: result.id, acceptedAtMillis: now(), dueAtMillis: null, leaseId: null }); return; }
      const delay = Math.max(Math.min(3600000, 60000 * 2 ** Math.min(claimed.attempts - 1, 6)), Number(error?.retryAfterMs) || 0);
      const expired = now() + delay >= claimed.firstAttemptAtMillis + RETRY;
      const status = expired || error?.permanent && claimed.uncertain ? "needs_review" : error?.permanent ? "failed" : "pending";
      tx.update(ref, { status, dueAtMillis: status === "pending" ? now() + delay : null, leaseId: null, uncertain: claimed.uncertain || !error?.permanent,
        failureCode: /^provider_[a-z0-9_]{1,50}$/.test(error?.code || "") ? error.code : "provider_uncertain" });
      logger.error("user_issue_delivery_failed", { code: status, jobId: id });
    });
  }
  async function sweep() {
    const rows = await db.collection("userIssueOutbox").where("dueAtMillis", ">", 0).where("dueAtMillis", "<=", now()).orderBy("dueAtMillis").limit(40).get();
    for (let i = 0; i < rows.docs.length; i += 4) await Promise.all(rows.docs.slice(i, i + 4).map(row => dispatch(row.id)));
    return { checked: rows.size };
  }
  async function daily() {
    const period = M.previousPeriod(now()), ref = db.doc(`userIssueDays/${period}`), id = M.hash(["daily", period]);
    const counts = await Promise.all(["new", "investigating", "fixed"].map(state => db.collection("userIssues").where("state", "==", state).count().get()));
    const failures = await Promise.all(["failed", "bounced", "suppressed", "needs_review"].map(status => db.collection("userIssueOutbox").where("status", "==", status).count().get()));
    const top = await ref.collection("issues").orderBy("count", "desc").limit(5).get();
    await db.runTransaction(async tx => {
      const day = (await tx.get(ref)).data(), job = await tx.get(jobRef(id));
      const settings = M.setting((await tx.get(settingsRef)).data(), now());
      if (!settings.enabled) return;
      if (!day || job.exists || !(day.incidents || day.changes)) return;
      tx.create(jobRef(id), { id, type: "daily", actorUid: settings.testUids?.[0] || null, title: `User issues: reporting day ${period}`, lines: ["Reporting window: 9 AM Pacific to 9 AM Pacific.",
        `${day.incidents || 0} distinct user incidents; ${day.crashes || 0} crashes; ${day.reports || 0} user reports; ${day.changes || 0} status changes.`,
        `${day.affectedActors || 0} affected accounts or anonymous sessions; ${day.recurrences || 0} recurrences after a fix.`,
        `${failures.reduce((sum, count) => sum + count.data().count, 0)} email jobs currently failed or require delivery review.`,
        ...top.docs.map(row => `${row.data().count} incidents: ${row.data().title}`),
        `${counts.reduce((sum, count) => sum + count.data().count, 0)} issues currently await resolution or verification.`], createdAtMillis: now(), status: "pending", dueAtMillis: now(), attempts: 0 });
    });
    await dispatch(id);
  }
  async function webhook({ id: eventId, event }) {
    const status = { "email.sent": "accepted", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.bounced": "bounced", "email.failed": "failed", "email.suppressed": "suppressed" }[event?.type];
    if (!status) return;
    let id = event?.data?.tags?.posetek_issue_outbox;
    const providerId = event?.data?.email_id, eventAt = Date.parse(event?.created_at);
    if (typeof providerId !== "string" || !M.ID.test(providerId) || !Number.isFinite(eventAt) || eventAt > now() + 60000) return;
    if (!/^[a-f0-9]{64}$/.test(id || "")) {
      const rows = await db.collection("userIssueOutbox").where("providerId", "==", providerId).limit(2).get();
      if (rows.size !== 1) return; id = rows.docs[0].id;
    }
    await db.runTransaction(async tx => {
      const ref = jobRef(id), job = (await tx.get(ref)).data(), receiptRef = ref.collection("receipts").doc(M.hash(eventId)), receipt = await tx.get(receiptRef);
      const recipient = event.data.to?.[0], recipients = job?.payload?.to;
      if (receipt.exists || !job?.firstAttemptAtMillis || !job.payload || job.providerId && job.providerId !== providerId || eventAt < job.firstAttemptAtMillis - 300000
        || ![M.FROM, "support@alerts.posetek.net"].includes(event.data.from) || !Array.isArray(event.data.to) || event.data.to.length !== 1
        || !Array.isArray(recipients) || !recipients.includes(recipient)) return;
      tx.create(receiptRef, { type: event.type, recipient, at: eventAt, receivedAtMillis: now() });
      const rank = { accepted: 1, delayed: 2, delivered: 3, failed: 4, bounced: 5, suppressed: 6 };
      // Resend emits one recipient per callback. Bind to the frozen payload,
      // including legacy Dylan-only jobs, and order events per recipient.
      const deliveries = { ...job.recipientDelivery };
      const previous = deliveries[recipient] || (recipients.length === 1 ? { status: job.status, at: job.lastProviderAtMillis } : {});
      if (eventAt < (previous.at || 0) || rank[previous.status] >= 3 && rank[status] < 3 || eventAt === previous.at && rank[status] <= (rank[previous.status] || 0)) return;
      deliveries[recipient] = { status, at: eventAt };
      const states = recipients.map(to => deliveries[to]?.status || "accepted");
      const aggregate = ["suppressed", "bounced", "failed", "delayed"].find(state => states.includes(state))
        || (states.every(state => state === "delivered") ? "delivered" : "accepted");
      tx.update(ref, { status: aggregate, recipientDelivery: deliveries, providerId,
        lastProviderAtMillis: Math.max(eventAt, job.lastProviderAtMillis || 0), dueAtMillis: null, leaseId: null });
      if (["failed", "bounced", "suppressed"].includes(status)) logger.error("user_issue_delivery_failed", { code: status, jobId: id });
    });
  }
  return { submit, ingest, list, triage, dispatch, sweep, daily, webhook, identity };
}
module.exports = { createUserIssues, LEASE, RETRY };
