"use strict";
const crypto = require("node:crypto");
const { isClubAdmin, clubStaffCanAccessPlayer } = require("./club-access");
const M = require("./user-issue-model");
const Microsoft = require("./microsoft-email-model");
const { createIssueContactEnrichment, tokenSnapshot } = require("./user-issue-contacts");
const { classifyOccurrence, occurrenceTitle, validCallableOutcome } = require("./user-issue-classification");
const { reportingSummary, deliveryReviewSummary } = require("./user-issue-summary");
const Observations = require("./user-issue-observations");
const RequestIdentity = require("./user-issue-request-identity");
const NotificationPolicy = require("./user-issue-notification-policy");
const SendFrontier = require("./user-issue-send-frontier");
const LEASE = 120000, RETRY = 23 * 3600000;
function createUserIssues({ db, auth: authProvider, HttpsError, provider, now = Date.now, logger = console }) {
  const contacts = createIssueContactEnrichment({ db, auth: authProvider, now });
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
    return { uid: auth?.uid || null, name: M.redact(auth?.displayName, 200) || null, player, authenticatedSnapshot: tokenSnapshot(auth, now()) };
  }
  async function submit(data, auth, ip = "unknown") {
    if (Object.hasOwn(data || {}, "ownerUid") && data.ownerUid !== (auth?.uid || null)) fail("failed-precondition", "Sign in to the account that created this report before retrying.");
    let event; try { event = M.normalize(data, now()); } catch (e) { fail("invalid-argument", e.message); }
    const who = await identity(auth, data.playerId);
    return ingest(event, who, { source: "client", sourceEvent: event.eventId, rateKey: M.hash(auth?.uid || ip) });
  }
  async function ingest(event, who, origin) {
    if (Object.hasOwn(event, "callableOutcome")) {
      const { callableOutcome, ...original } = event;
      event = validCallableOutcome(callableOutcome, { ...original, source: origin.source })
        ? { ...original, callableOutcome: { ...callableOutcome } } : original;
    }
    const at = now(), actor = who.uid || (who.player?.id ? `player:${who.player.id}` : `anonymous:${event.sessionId}`);
    // Do not collect contact records while intake is disabled or outside its
    // authorized source window. The transaction below rechecks this gate.
    const intakeSettings = M.setting((await settingsRef.get()).data(), at);
    if (!intakeSettings.enabled || intakeSettings.testUids && !intakeSettings.testUids.includes(who.uid)
      || Object.hasOwn(origin, "receivedAtMillis") && (!Number.isFinite(origin.receivedAtMillis) || origin.receivedAtMillis < intakeSettings.activatedAtMillis)
      || origin.isTest && !intakeSettings.testUids) return { status: "disabled" };
    const enrichment = await contacts.resolve(who.uid);
    const contactSnapshot = { schemaVersion: 1, actorUid: who.uid || null, currentContact: enrichment.contact, lookup: enrichment.lookup,
      authenticatedSnapshot: who.authenticatedSnapshot || null, player: who.player || null,
      reporterOnly: /failureCases|fieldReports|system_diagnostic/i.test(`${origin.source} ${event.code}`), operation: event.operation };
    // Preserve the legacy primary ID. Reused caller request references are
    // corroboration only when server-owned action/target evidence is compatible.
    const primaryId = M.hash([actor, event.requestId ? `request:${event.requestId}` : `${origin.source}:${origin.sourceEvent}`]);
    const sourceKey = RequestIdentity.sourceKey(actor, event, origin), sourceClaimRef = db.doc(`userIssueSourceClaims/${sourceKey}`);
    const registryRef = event.requestId ? db.doc(`userIssueRequestIdentities/${primaryId}`) : null;
    // Preserve the historical aggregate key for the corrected generic upload
    // classification. Stored new evidence/title use diagnostic, while prior
    // triage and recurrence state stay attached to the same issue.
    const fingerprintKind = origin.source === "failureCases" && event.kind === "diagnostic" ? "interrupted" : event.kind;
    const observationId = M.hash([origin.source, origin.sourceEvent || event.eventId, event.eventId]);
    const sourceObservation = { ...event, reporterUid: who.uid || null, reporterName: who.name || null, player: who.player || null,
      authenticatedSnapshot: who.authenticatedSnapshot || null, source: origin.source, sourceEvent: origin.sourceEvent || event.eventId,
      sourceReference: origin.reference || null, receivedAtMillis: at,
      sourceReceivedAtMillis: Number.isSafeInteger(origin.receivedAtMillis) ? origin.receivedAtMillis : null };
    const dayRef = db.doc(`userIssueDays/${M.periodKey(at)}`);
    return db.runTransaction(async tx => {
      const settings = M.setting((await tx.get(settingsRef)).data(), at);
      if (!settings.enabled || settings.testUids && !settings.testUids.includes(who.uid) || Object.hasOwn(origin, "receivedAtMillis") && (!Number.isFinite(origin.receivedAtMillis) || origin.receivedAtMillis < settings.activatedAtMillis) || origin.isTest && !settings.testUids) return { status: "disabled" };
      const sourceClaim = (await tx.get(sourceClaimRef)).data();
      if (sourceClaim) {
        if (sourceClaim.schemaVersion !== 1 || sourceClaim.source !== RequestIdentity.SOURCE || sourceClaim.sourceKey !== sourceKey
          || sourceClaim.primaryOccurrenceId !== primaryId || !/^[a-f0-9]{64}$/.test(sourceClaim.occurrenceId || "")) throw new Error("invalid_server_source_claim");
        const claimed = (await tx.get(db.doc(`userIssueOccurrences/${sourceClaim.occurrenceId}`))).data();
        if (!claimed || claimed.issueId !== sourceClaim.issueId) throw new Error("source_claim_occurrence_unavailable");
        return { status: "received", reference: claimed.issueId, occurrenceId: sourceClaim.occurrenceId, duplicate: true };
      }
      const primaryRef = db.doc(`userIssueOccurrences/${primaryId}`), primary = await tx.get(primaryRef);
      const primaryObservation = await tx.get(primaryRef.collection("observations").doc(observationId));
      const primaryReplay = primary.exists && (primaryObservation.exists || primary.data().eventId === event.eventId && primary.data().source === origin.source);
      let plan = RequestIdentity.route({ original: primary.data(), catalog: registryRef ? (await tx.get(registryRef)).data() : null,
        event, who, origin, actor, primaryId, key: sourceKey, primaryReplay });
      if (!event.requestId && primary.exists && !primaryReplay) plan = { ...plan,
        occurrenceId: M.hash(["uncorrelated-source-v1", primaryId, sourceKey]), reason: "source_evidence_unconfirmed" };
      let occurrenceRef = db.doc(`userIssueOccurrences/${plan.occurrenceId}`), existing = plan.occurrenceId === primaryId ? primary : await tx.get(occurrenceRef);
      let observationRef = occurrenceRef.collection("observations").doc(observationId), observation = plan.occurrenceId === primaryId ? primaryObservation : await tx.get(observationRef);
      const exactReplay = () => existing.exists && (observation.exists || existing.data().eventId === event.eventId && existing.data().source === origin.source);
      if (existing.exists && !exactReplay() && !Observations.sameRequest(existing.data(), event, who, origin, plan.branch)) {
        // A mismatched or ambiguous historical branch is never acknowledged as
        // a duplicate. Retain this independent source with a stable secondary ID.
        plan = event.requestId ? RequestIdentity.isolate(plan, event, who, origin, sourceKey)
          : { ...plan, occurrenceId: M.hash(["uncorrelated-source-v1", primaryId, sourceKey]), reason: "source_evidence_unconfirmed" };
        occurrenceRef = db.doc(`userIssueOccurrences/${plan.occurrenceId}`); existing = await tx.get(occurrenceRef);
        observationRef = occurrenceRef.collection("observations").doc(observationId); observation = await tx.get(observationRef);
        if (existing.exists && !exactReplay()) throw new Error("source_identity_collision");
      }
      const occurrenceId = plan.occurrenceId;
      const recordIdentity = issueId => {
        if (registryRef) tx.set(registryRef, plan.catalog);
        tx.create(sourceClaimRef, { schemaVersion: 1, source: RequestIdentity.SOURCE, sourceKey, primaryOccurrenceId: primaryId,
          occurrenceId, issueId, sourceEvent: origin.sourceEvent || event.eventId, eventId: event.eventId, createdAtMillis: at });
      };
      if (existing.exists) {
        const original = existing.data();
        if (!exactReplay() && Observations.sameRequest(original, event, who, origin, plan.branch)) {
          // Exact actor/request corroboration is retained privately. A second
          // source never rewrites the canonical actor, athlete or frozen job.
          tx.create(observationRef, sourceObservation);
          tx.update(occurrenceRef, { sourceObservationSummary: Observations.appendSummary(original, sourceObservation) });
        }
        recordIdentity(original.issueId);
        return { status: "received", reference: original.issueId, occurrenceId, duplicate: true };
      }
      const fingerprint = M.hash([event.platform, event.operation, event.code, event.kind === "report" ? occurrenceId : fingerprintKind]);
      const ref = issueRef(fingerprint), out = jobRef(occurrenceId);
      const issue = (await tx.get(ref)).data(), day = (await tx.get(dayRef)).data() || {};
      const actorRef = dayRef.collection("actors").doc(M.hash(actor)), actorSeen = await tx.get(actorRef);
      const dailyIssueRef = dayRef.collection("issues").doc(fingerprint), dailyIssue = (await tx.get(dailyIssueRef)).data();
      const rateRef = origin.rateKey ? db.doc(`userIssueLimits/${M.hash([origin.rateKey, Math.floor(at / 3600000)])}`) : null;
      const globalRef = origin.rateKey ? db.doc(`userIssueLimits/global-${Math.floor(at / 3600000)}`) : null;
      const rate = rateRef ? (await tx.get(rateRef)).data()?.count || 0 : 0;
      const global = globalRef ? (await tx.get(globalRef)).data()?.count || 0 : 0;
      if (rateRef && (rate >= (who.uid ? 120 : 15) || global >= 3000)) fail("resource-exhausted", "Report intake is busy. Your report can be retried later.");
      const reopened = issue?.state === "verified" || issue?.state === "fixed";
      const classification = classifyOccurrence({ ...event, source: origin.source, reporterUid: who.uid });
      const title = occurrenceTitle(event, classification);
      const label = enrichment.contact?.name || who.name || (who.uid ? "Signed-in user" : "Unknown actor");
      const lines = [`Occurrence reference: ${occurrenceId}`,
        `Platform: ${event.platform}; build: ${event.build}; device: ${event.device}`,
        `Error code: ${event.code}`, `Occurred: ${M.dateText(event.occurredAtMillis)}`, `Received: ${M.dateText(at)}`,
        ...(classification.effectiveKind === "diagnostic" ? ["Evidence classification: Diagnostic upload; subtype unconfirmed. This record does not establish a crash or an interrupted session."] : []),
        ...(classification.scope === "automated_service" ? ["Evidence scope: Automated service occurrence; no affected operator is established by this service record."] : []),
        ...(classification.scope === "unknown_actor" && validCallableOutcome(event.callableOutcome, { ...event, source: origin.source }) ? ["Evidence scope: Verified failed callable request; no accepted authenticated reporter is recorded. The actor and contact remain unknown."] : []),
        ...(occurrenceId !== primaryId ? ["Request correlation: This source shares a request reference with another incident, but a distinct or unconfirmed attempted action is retained separately."] : []),
        ...(reopened ? ["This issue has returned after being marked fixed or verified."] : [])];
      const count = (issue?.occurrences || 0) + 1;
      tx.create(occurrenceRef, { ...event, id: occurrenceId, issueId: fingerprint, reporterUid: who.uid, reporterName: who.name,
        authenticatedSnapshot: who.authenticatedSnapshot || null, currentContact: enrichment.contact, contactLookup: enrichment.lookup,
        player: who.player || null, source: origin.source, sourceReference: origin.reference || null, classification,
        ...(reopened ? { notificationRecurrence: { schemaVersion: 1, previousState: issue.state, previousUpdatedAtMillis: issue.updatedAtMillis } } : {}),
        ...(event.requestId ? { requestCorrelation: { schemaVersion: 1, source: RequestIdentity.SOURCE, primaryOccurrenceId: primaryId,
          mode: occurrenceId === primaryId ? "primary" : "separate_attempt", reason: plan.reason || null } } : {}),
        sourceObservationSummary: Observations.initialSummary(sourceObservation), receivedAtMillis: at });
      if (!observation.exists) tx.create(observationRef, sourceObservation);
      tx.set(ref, { id: fingerprint, title, platform: event.platform, operation: event.operation, code: event.code, kind: event.kind, severity: event.severity,
        classification, state: reopened ? "new" : issue?.state || "new", firstReceivedAtMillis: issue?.firstReceivedAtMillis || at, updatedAtMillis: Math.max(at, (issue?.updatedAtMillis || 0) + 1),
        occurrences: count, latestOccurrenceId: occurrenceId, latestBuild: event.build, latestUser: label,
        ...(reopened ? { reopenedAtMillis: at } : {}) }, { merge: true });
      tx.create(out, { id: occurrenceId, issueId: fingerprint, type: "incident", title, lines, contactSnapshot, createdAtMillis: at, status: "pending", dueAtMillis: at, attempts: 0, actorUid: who.uid });
      tx.set(dayRef, { incidents: (day.incidents || 0) + 1, changes: day.changes || 0, lastAtMillis: at,
        affectedActors: (day.affectedActors || 0) + (actorSeen.exists ? 0 : 1), recurrences: (day.recurrences || 0) + (reopened ? 1 : 0),
        crashes: (day.crashes || 0) + (event.kind === "crash" ? 1 : 0), reports: (day.reports || 0) + (event.kind === "report" ? 1 : 0) }, { merge: true });
      if (!actorSeen.exists) tx.create(actorRef, { firstAtMillis: at });
      tx.set(dailyIssueRef, { title, count: (dailyIssue?.count || 0) + 1 });
      if (who.uid) tx.set(db.doc(`userIssueActors/${M.hash([who.uid, fingerprint])}`), { uid: who.uid, issueId: fingerprint, updatedAtMillis: at });
      if (rateRef) { tx.set(rateRef, { count: rate + 1, expiresAtMillis: at + 86400000 }); tx.set(globalRef, { count: global + 1, expiresAtMillis: at + 86400000 }); }
      recordIdentity(fingerprint);
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
      tx.create(jobRef(id), { id, issueId: data.issueId, type: "status", actorUid: auth.uid, title: `${issue.title} — ${data.state}`, lines: [`Status changed from ${issue.state} to ${data.state}.`, `Updated: ${M.dateText(at)}`,
        ...(fixRef ? [`Recorded fix reference: ${fixRef}`] : []), ...(data.state === "verified" ? [`Recorded retest evidence: ${verification}`] : []),
        ...(data.state === "fixed" ? ["A fix is recorded; recovery remains unconfirmed until verification evidence is recorded."] : [])],
        notificationTransition: { schemaVersion: 1, from: issue.state, to: data.state, changedBy: auth.uid, fixRef, verification },
        createdAtMillis: at, status: "pending", dueAtMillis: at, attempts: 0 });
      tx.set(dayRef, { changes: (day.changes || 0) + 1, incidents: day.incidents || 0, lastAtMillis: at }, { merge: true });
      return { updated: true };
    });
  }
  async function dispatch(id) {
    if (!/^[a-f0-9]{64}$/.test(id || "")) return;
    const claimed = await db.runTransaction(async tx => {
      const at = now(), settings = M.setting((await tx.get(settingsRef)).data(), at), ref = jobRef(id), job = (await tx.get(ref)).data();
      if (!settings.enabled || settings.sendEnabled !== true || !job || !["pending", "sending"].includes(job.status) || !job.dueAtMillis || job.dueAtMillis > at) return null;
      if (!SendFrontier.allows(settings, job, at)) return null;
      const deliveryProvider = Microsoft.providerFor(job, settings);
      const microsoftConfig = deliveryProvider === "microsoft" ? (await tx.get(db.doc(Microsoft.SETTINGS))).data() : null;
      if (!deliveryProvider || deliveryProvider === "microsoft" && (!Microsoft.enabled(microsoftConfig, "issue", id, job.createdAtMillis, at) || job.microsoft?.claimedAtMillis)) return null;
      if (job.createdAtMillis < settings.activatedAtMillis || settings.testUids && !settings.testUids.includes(job.actorUid)) { tx.update(ref, { status: "cancelled", dueAtMillis: null }); return null; }
      if (deliveryProvider === "resend" && job.firstAttemptAtMillis && at >= job.firstAttemptAtMillis + RETRY) { tx.update(ref, { status: "needs_review", dueAtMillis: null }); logger.error("user_issue_delivery_failed", { code: "retry_window", jobId: id }); return null; }
      const rawPayload = job.payload || M.payload(job, id);
      if (!Microsoft.issueRecipientAllowed({ ...job, payload: rawPayload })) {
        tx.update(ref, { status: "needs_review", dueAtMillis: null, failureCode: "provider_recipient_removed" });
        return null;
      }
      let policy;
      try { policy = await NotificationPolicy.prepare({ tx, db, settings, job: { ...job, id, deliveryProvider }, at }); }
      catch (error) { NotificationPolicy.review(tx, ref, error); return null; }
      if (policy?.decision.action === "daily_summary") { NotificationPolicy.defer(tx, ref, policy, { ...job, id, deliveryProvider }, at); return null; }
      const route = deliveryProvider === "microsoft" && !job.microsoft ? Microsoft.freeze("issue", id, rawPayload, microsoftConfig, at) : { deliveryProvider, payload: rawPayload };
      const next = { ...route, leaseId: crypto.randomUUID(), firstAttemptAtMillis: job.firstAttemptAtMillis || at,
        attempts: (job.attempts || 0) + 1, status: "sending", dueAtMillis: at + LEASE, uncertain: job.uncertain === true || job.status === "sending" };
      tx.update(ref, next); return { ...job, ...next };
    });
    if (!claimed) return;
    let result, error;
    try { result = await provider.send(claimed.payload, `posetek-user-issue/${id}`, { ...claimed, kind: "issue", id }); } catch (e) { error = e; }
    await db.runTransaction(async tx => {
      const ref = jobRef(id), current = (await tx.get(ref)).data();
      if (current?.leaseId !== claimed.leaseId || current.status !== "sending") return;
      if (result?.id && claimed.deliveryProvider !== "microsoft") { tx.update(ref, { status: "accepted", providerId: result.id, acceptedAtMillis: now(), dueAtMillis: null, leaseId: null }); return; }
      const delay = Math.max(Math.min(3600000, 60000 * 2 ** Math.min(claimed.attempts - 1, 6)), Number(error?.retryAfterMs) || 0);
      const expired = claimed.deliveryProvider !== "microsoft" && now() + delay >= claimed.firstAttemptAtMillis + RETRY;
      const status = expired || error?.permanent && claimed.uncertain ? "needs_review" : error?.permanent ? "failed" : "pending";
      tx.update(ref, { status, dueAtMillis: status === "pending" ? now() + delay : null, leaseId: null, uncertain: claimed.uncertain || !error?.permanent,
        failureCode: result?.pending ? null : /^provider_[a-z0-9_]{1,50}$/.test(error?.code || "") ? error.code : "provider_uncertain" });
      if (!result?.pending) logger.error("user_issue_delivery_failed", { code: status, jobId: id });
    });
  }
  async function sweep() {
    const at = now(), settings = M.setting((await settingsRef.get()).data(), at), frontier = SendFrontier.configuration(settings, at);
    if (!settings.enabled || settings.sendEnabled !== true || !frontier.valid) return { checked: 0 };
    if (frontier.configured) {
      // Single-field createdAt index only. A bounded rotating scan excludes every
      // historical job without changing it; old due jobs cannot occupy the first
      // forty slots. New writes also retain their normal immediate trigger.
      const scanRef = db.doc("userIssueLimits/sendFrontierSweep"), saved = (await scanRef.get()).data();
      const validCursor = cursor => cursor && Number.isSafeInteger(cursor.at) && cursor.at >= frontier.fromMillis
        && cursor.at <= saved?.upperMillis && /^[a-f0-9]{64}$/.test(cursor.id || "");
      const resume = saved?.schemaVersion === 1 && saved.sendFromMillis === frontier.fromMillis
        && Number.isSafeInteger(saved.upperMillis) && saved.upperMillis >= frontier.fromMillis && saved.upperMillis <= at && validCursor(saved.cursor);
      const upperMillis = resume ? saved.upperMillis : at;
      let cursor = resume ? saved.cursor : null, complete = false, examined = 0, pages = 0;
      const eligible = [];
      while (pages < 20 && eligible.length < 40 && !complete) {
        let query = db.collection("userIssueOutbox").where("createdAtMillis", ">=", frontier.fromMillis)
          .where("createdAtMillis", "<=", upperMillis).orderBy("createdAtMillis").orderBy("__name__");
        if (cursor) query = query.startAfter(cursor.at, cursor.id);
        const page = await query.limit(100).get(); pages++;
        let consumed = 0;
        for (const row of page.docs) {
          const job = row.data();
          if (!/^[a-f0-9]{64}$/.test(row.id) || !Number.isSafeInteger(job.createdAtMillis) || job.createdAtMillis < frontier.fromMillis
            || job.createdAtMillis > upperMillis || cursor && (job.createdAtMillis < cursor.at || job.createdAtMillis === cursor.at && row.id <= cursor.id)) throw new Error("issue_send_scan_invalid_page");
          cursor = { at: job.createdAtMillis, id: row.id }; consumed++; examined++;
          if (["pending", "sending"].includes(job.status) && job.dueAtMillis > 0 && job.dueAtMillis <= at && SendFrontier.allows(settings, job, at)) eligible.push(row.id);
          if (eligible.length === 40) break;
        }
        complete = consumed === page.size && page.size < 100;
      }
      for (let i = 0; i < eligible.length; i += 4) await Promise.all(eligible.slice(i, i + 4).map(dispatch));
      await db.runTransaction(async tx => {
        const current = (await tx.get(scanRef)).data(), currentSettings = (await tx.get(settingsRef)).data();
        if (Microsoft.canonical(current || null) !== Microsoft.canonical(saved || null)
          || currentSettings?.sendFromMillis !== frontier.fromMillis) return;
        tx.set(scanRef, { schemaVersion: 1, sendFromMillis: frontier.fromMillis, upperMillis: complete ? null : upperMillis,
          cursor: complete ? null : cursor, lastCheckedAtMillis: now(), examined, complete });
      });
      return { checked: eligible.length, examined, pages, complete };
    }
    const rows = await db.collection("userIssueOutbox").where("dueAtMillis", ">", 0).where("dueAtMillis", "<=", now()).orderBy("dueAtMillis").limit(40).get();
    for (let i = 0; i < rows.docs.length; i += 4) await Promise.all(rows.docs.slice(i, i + 4).map(row => dispatch(row.id)));
    return { checked: rows.size };
  }
  // Maintenance-only server helper. It never wakes a flow or enables sending.
  // The caller records each returned page in its private recovery audit.
  async function deferBacklogPage({ cursor = null, limit = 40 } = {}) {
    if (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor) || !Number.isSafeInteger(limit) || limit < 1 || limit > 40) throw new Error("notification_backlog_page_invalid");
    const settings = (await settingsRef.get()).data(), policy = NotificationPolicy.configuration(settings, now());
    if (!policy || settings?.sendEnabled !== false) throw new Error("notification_backlog_requires_send_hold");
    let query = db.collection("userIssueOutbox").orderBy("__name__").limit(limit);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); let deferred = 0, preserved = 0;
    for (const row of page.docs) {
      if (!/^[a-f0-9]{64}$/.test(row.id) || cursor && row.id <= cursor) throw new Error("notification_backlog_page_nonadvancing");
      const result = await db.runTransaction(async tx => {
        const currentSettings = (await tx.get(settingsRef)).data(), currentPolicy = NotificationPolicy.configuration(currentSettings, now());
        const job = (await tx.get(row.ref)).data();
        if (!currentPolicy || currentSettings?.sendEnabled !== false || currentPolicy.namespace !== policy.namespace) throw new Error("notification_backlog_hold_changed");
        if (!job || !["pending", "sending"].includes(job.status) || Microsoft.providerFor(job, currentSettings) !== "microsoft"
          || Microsoft.hasSendEvidence(job) || job.createdAtMillis >= policy.activatedAtMillis) return false;
        const prepared = await NotificationPolicy.prepare({ tx, db, settings: currentSettings, job: { ...job, id: row.id, deliveryProvider: "microsoft" }, at: now() });
        if (prepared?.decision.reason !== "backlog_before_cutover") throw new Error("notification_backlog_decision_invalid");
        NotificationPolicy.defer(tx, row.ref, prepared, job, now()); return true;
      });
      if (result) deferred++; else preserved++;
      cursor = row.id;
    }
    return { examined: page.size, deferred, preserved, cursor: page.size < limit ? null : cursor,
      enumerationComplete: page.size < limit, policyNamespace: policy.namespace, sendEnabled: false };
  }
  async function daily() {
    const at = now(), period = M.previousPeriod(at), ref = db.doc(`userIssueDays/${period}`);
    const settingsSnapshot = await settingsRef.get(), frontier = SendFrontier.configuration(settingsSnapshot.data(), at), bounds = M.periodBounds(period);
    if (!frontier.valid || frontier.configured && frontier.fromMillis >= bounds.upper) return;
    // A prior full-day summary remains immutable. The new partial first window
    // gets its own deterministic identity, containing only post-frontier evidence.
    const id = M.hash(frontier.configured ? ["daily", period, "send-from", frontier.fromMillis] : ["daily", period]);
    const [daySnapshot, existingJob] = await Promise.all([ref.get(), jobRef(id).get()]);
    const before = daySnapshot.data();
    // Existing summaries and their frozen payload/receipts remain historical.
    if (!M.setting(settingsSnapshot.data(), at).enabled || !before || existingJob.exists || !(before.incidents || before.changes)) return;
    const [summary, deliveryReview] = await Promise.all([reportingSummary(db, period, { fromMillis: frontier.configured ? frontier.fromMillis : null }), frontier.configured ? null : deliveryReviewSummary(db)]);
    if (!frontier.configured && summary.occurrences !== (before.incidents || 0)) throw Object.assign(new Error("summary_occurrence_count_mismatch"), { code: "summary_occurrence_count_mismatch" });
    if (frontier.configured && !(summary.occurrences || summary.statusChanges)) return;
    const counts = frontier.configured ? [] : await Promise.all(["new", "investigating", "fixed"].map(state => db.collection("userIssues").where("state", "==", state).count().get()));
    await db.runTransaction(async tx => {
      const day = (await tx.get(ref)).data(), job = await tx.get(jobRef(id));
      const settings = M.setting((await tx.get(settingsRef)).data(), now());
      if (!settings.enabled) return;
      if (!SendFrontier.configuration(settings, now()).valid || settings.sendFromMillis !== settingsSnapshot.data()?.sendFromMillis) return;
      if (!day || job.exists || !(day.incidents || day.changes)) return;
      if ((!frontier.configured && (day.incidents || 0) !== summary.occurrences) || day.lastAtMillis !== before.lastAtMillis || (day.changes || 0) !== (before.changes || 0)) throw Object.assign(new Error("summary_day_changed"), { code: "summary_day_changed" });
      tx.create(jobRef(id), { id, type: "daily", actorUid: settings.testUids?.[0] || null, title: `Issue evidence: reporting day ${period}`, summary, deliveryReview, lines: [frontier.configured
        ? `Reporting window: ${M.dateText(summary.lower)} to ${M.dateText(summary.upper)}; server receipt time, restricted to new evidence after email activation.`
        : "Reporting window: 9 AM Pacific to 9 AM Pacific; counts use server receipt time.",
        `${summary.occurrences} captured issue and diagnostic occurrences; ${summary.crashes} confirmed crashes; ${summary.reports} user-submitted reports; ${summary.interruptions} explicit interruption records; ${frontier.configured ? summary.statusChanges : day.changes || 0} status changes.`,
        `Source scope: ${summary.serviceOccurrences} automated service occurrences; ${summary.diagnostics} diagnostic uploads; ${summary.otherOccurrences} other issue/report occurrences.`,
        `${summary.accountOccurrences} occurrences have a recorded reporting Auth UID across ${summary.reportingAccounts} accounts; ${summary.noAccountOccurrences} occurrences have no recorded account UID. Reporting accounts may be uploaders or staff; affected users are not inferred.`,
        `${summary.unknownDiagnosticSubtype} diagnostic uploads have an unknown subtype and do not establish a crash or an interrupted session.${frontier.configured ? "" : ` ${day.recurrences || 0} recurrences after a fix.`}`,
        `Notification cadence at summary capture: ${summary.notificationCadence.routineRepeats} routine repeat emails and ${summary.notificationCadence.backlogDeferred} pre-cutover queued notifications deferred; ${summary.notificationCadence.immediateSelected} incident send permissions selected for immediate notice; ${summary.notificationCadence.undecided} occurrences have no recorded cadence decision. All ${summary.occurrences} occurrences remain documented; selected permission is not delivery confirmation.`,
        ...(deliveryReview ? [`${deliveryReview.total} email jobs currently failed or require delivery review across all time: ${deliveryReview.microsoft} Microsoft, ${deliveryReview.resend} Resend, ${deliveryReview.unassigned} unassigned provider. This backlog is separate from reporting-day incident counts.`] : []),
        ...summary.top.map(row => `${row.count} occurrences: ${row.title}`),
        ...(frontier.configured ? [] : [`${counts.reduce((sum, count) => sum + count.data().count, 0)} issues currently await resolution or verification.`])], createdAtMillis: now(), status: "pending", dueAtMillis: now(), attempts: 0 });
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
      if (receipt.exists || !job?.firstAttemptAtMillis || job.deliveryProvider === "microsoft" || !job.payload || job.providerId && job.providerId !== providerId || eventAt < job.firstAttemptAtMillis - 300000
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
  return { submit, ingest, list, triage, dispatch, sweep, deferBacklogPage, daily, webhook, identity };
}
module.exports = { createUserIssues, LEASE, RETRY };
