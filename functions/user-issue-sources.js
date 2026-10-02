"use strict";
const M = require("./user-issue-model");
const millis = value => typeof value?.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : Date.parse(value || "");
function createIssueSources(service, db, now = Date.now) {
  async function document(source, snapshot, context) {
    const d = snapshot.data(); if (!d) return;
    if (source === "aiIncidents" && (d.foldedInto || d.kind !== "failure" || d.backfill || snapshot.id.startsWith("client-") && (d.jobId || d.requestId && d.requestId !== snapshot.id.slice(7)))) return;
    const playerId = d.playerDocumentID || d.playerId || null;
    const uid = d.reportedByUid || d.requestedByUid || d.userId || null;
    // Legacy documents have rules-verified provenance. Never substitute today's
    // active athlete for the identity captured on the original record.
    const player = M.ID.test(playerId || "") ? (await db.doc(`players/${playerId}`).get()).data() : null;
    const event = M.normalize({ eventId: M.hash([source, snapshot.id]), sessionId: M.hash(d.launchId || d.requestId || d.jobId || snapshot.id),
      kind: source === "fieldReports" || d.stage === "user_report" ? "report" : source === "failureCases" && /launch|system|interrupt/i.test(d.kind || "") ? "interrupted" : "error",
      platform: source === "aiIncidents" ? "backend" : "ios", operation: d.capability || d.stage || d.kind || "application",
      code: d.code || d.errorCode || source, description: d.description || "User submitted a diagnostic report.", message: d.message,
      occurredAtMillis: millis(d.occurredAt || d.createdAt), build: d.build || d.appVersion, device: d.deviceModel,
      requestId: d.requestId || d.jobId }, now(), true);
    return service.ingest(event, { uid, name: null, player: player ? { id: playerId, name: M.clean([player.firstName, player.lastName].filter(Boolean).join(" ")) } : null },
      { source, sourceEvent: snapshot.id, reference: `${source}/${snapshot.id}`, receivedAtMillis: millis(context.timestamp), isTest: d.isTest === true });
  }
  async function log(message) {
    const entry = message.json;
    if (!entry || !String(entry.logName).startsWith("projects/kickai-69dd0/logs/")) return;
    const p = entry.jsonPayload || {}, crash = entry.logName === "projects/kickai-69dd0/logs/firebasecrashlytics.googleapis.com%2Fevents";
    if (!crash && (!['cloud_run_revision', 'cloud_function'].includes(entry.resource?.type) || !["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(entry.severity))) return;
    const serviceName = entry.resource?.labels?.service_name || entry.resource?.labels?.function_name || "backend";
    if (!crash && (/userissue|user-issue|observeissue|workoutnotification|resend|microsoftemail/i.test(serviceName) || p.event === "ai_incident" || entry.labels?.event === "ai_incident" || !entry.insertId)) return;
    const keys = p.customKeys || {};
    const sourceEvent = crash ? p.eventId : entry.insertId;
    if (!sourceEvent || crash && p.platform !== "IOS") return;
    // Crashlytics user.id is the legacy player document ID, not an Auth UID.
    const playerId = crash ? p.user?.id : null;
    const player = M.ID.test(playerId || "") ? (await db.doc(`players/${playerId}`).get()).data() : null;
    const uid = crash ? (M.ID.test(keys.reporter_uid || "") ? keys.reporter_uid : null) : (M.ID.test(p.reporterUid || "") ? p.reporterUid : null);
    const event = M.normalize({ eventId: M.hash([entry.logName, sourceEvent]), sessionId: M.hash(crash ? p.sessionId || sourceEvent : entry.trace || sourceEvent),
      kind: crash && (p.issue?.errorType === "FATAL" || p.threads?.some(thread => thread.crashed === true)) ? "crash" : "error", platform: crash ? "ios" : "backend",
      operation: crash ? keys.flow || keys.processing_stage || "application" : p.operation || serviceName,
      code: crash ? p.issue?.id || p.issue?.name || "crashlytics" : p.code || "service_error",
      message: crash ? p.issueTitle : p.message || entry.textPayload, build: crash ? [p.version?.displayVersion, p.version?.buildVersion].filter(Boolean).join(" ") : entry.resource?.labels?.revision_name,
      device: crash ? [p.device?.model, p.operatingSystem?.displayVersion].filter(Boolean).join(" ") : "server",
      occurredAtMillis: Date.parse(crash ? p.eventTime : entry.timestamp), requestId: crash ? keys.llm_job_id : p.requestId }, now(), true);
    return service.ingest(event, { uid, name: null, player: player ? { id: playerId, name: M.clean([player.firstName, player.lastName].filter(Boolean).join(" ")) } : null },
      { source: crash ? "crashlytics" : "cloudLogging", sourceEvent, reference: crash ? M.clean(p.name, 300) : null, receivedAtMillis: Date.parse(crash ? p.receivedTime : entry.receiveTimestamp || entry.timestamp) });
  }
  return { document, log };
}
module.exports = { createIssueSources };
