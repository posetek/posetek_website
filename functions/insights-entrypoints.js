"use strict";

const { createInsightsV2 } = require("./insights-v2");
const { createInsightUsage } = require("./insight-usage");
const { playerSegment } = require("./athlete-storage-paths");
const { millis } = require("./insights-v2-qualification");
const { sourceEventHash } = require("./insights-v2-projection");
const { isDeepStrictEqual } = require("node:util");
const BUCKET = "kickai-69dd0.firebasestorage.app";
const RECORD_COLLECTIONS = new Set(["reps", "workoutLogs", "personalWorkoutLogs", "trainingSessions", "insightMetadata"]);
function storageOwner(object) {
  if (object?.bucket !== BUCKET || typeof object.name !== "string") return null;
  const match = /^([A-Za-z0-9_-]+)\/(deadballShot|sprint|jump|broadJump|changeOfDirection|dribbling|freeRecord)\/session[1-9]\d*\/(?:kick[1-9]\d*\/(?:capture_[a-f0-9]{32}\/)?)?(metadata|reprocess_context)\.json$/.exec(object.name);
  return match && playerSegment(match[1]) ? match[1] : null;
}
function storageTestingEventId(object) {
  const value = object?.metadata?.posetekTestingEventId;
  return playerSegment(value) ? value : null;
}
function failureProjectionInput(data) {
  if (data == null) return null;
  return { playerDocumentID: data.playerDocumentID ?? null, createdAt: millis(data.createdAt),
    qualificationAt: millis(data.createdAt ?? data.createdAtMillis), repId: data.repId ?? null,
    sessionDocId: data.sessionDocId ?? null, repArtifactFolder: data.storage?.repArtifactFolder ?? null,
    drillType: data.drillType ?? null, repNumber: data.repNumber ?? null, sessionNumber: data.sessionNumber ?? null,
    resolved: Boolean(data.resolvedAt || data.resolvedAtMillis), status: data.status ?? null };
}
function snapshotExists(snapshot) { return snapshot?.exists === true || (snapshot?.exists !== false && snapshot?.data?.() !== undefined); }
const CONTROL_REASONS = new Set(["insights-rebuild-busy", "insights-rebuild-superseded", "insights-rebuild-lease-lost", "insights-rebuild-continuation-required"]);
function createInsightsEntrypoints(functions, admin, caller) {
  const db = admin.firestore();
  const insights = createInsightsV2({ db, bucket: admin.storage().bucket(BUCKET), HttpsError: functions.https.HttpsError });
  const usage = createInsightUsage({ db, Timestamp: admin.firestore.Timestamp, HttpsError: functions.https.HttpsError });
  async function rebuild(playerId, sourceKind, context) {
    if (!playerSegment(playerId)) return;
    const source = typeof context?.eventId === "string" && context.eventId ? { sourceKind, eventId: context.eventId } : null;
    try {
      await insights.invalidateInsightPlayer(playerId, source);
      return await insights.rebuildInsightPlayer(playerId, source);
    } catch (error) {
      const reason = error.details?.reason;
      const facts = { event: CONTROL_REASONS.has(reason) ? "posetek_insight_projection_control" : "posetek_insight_projection_failure",
        reason: typeof reason === "string" && /^insights-[a-z-]+$/.test(reason) ? reason : "insights-rebuild-failed",
        sourceKind: source?.sourceKind || "direct", sourceEventHash: sourceEventHash(source),
        rebuildId: typeof error.details?.rebuildId === "string" && /^[a-f0-9-]{36}$/.test(error.details.rebuildId) ? error.details.rebuildId : null };
      const logger = CONTROL_REASONS.has(reason) ? functions.logger?.info : functions.logger?.error;
      if (logger) logger.call(functions.logger, "Insights projection outcome", facts);
      // All genuine errors and pending coalesced work retain retry semantics.
      throw error;
    }
  }
  async function projectRecord(change, context) {
    if (!RECORD_COLLECTIONS.has(context.params.collectionId)) return null;
    const before = change.before?.data?.() || {};
    const after = change.after?.data?.() || {};
    if (context.params.collectionId === "reps" && (playerSegment(after.testingEventId) || playerSegment(before.testingEventId))) return null;
    return rebuild(context.params.playerId, "record", context);
  }
  async function projectArtifact(object, context, sourceKind) {
    const playerId = storageOwner(object);
    const eventId = storageTestingEventId(object);
    if (playerId && eventId) {
      await db.collection("testingEvents").doc(eventId).collection("projectionDirty").doc(playerId).set({
        playerId,
        insightArtifactDirty: true,
        revision: admin.firestore.FieldValue.increment(1),
        pending: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMillis: Date.now(),
      }, { merge: true });
      return;
    }
    return rebuild(playerId, sourceKind, context);
  }
  const events = functions.runWith({ timeoutSeconds: 540, memory: "512MB", maxInstances: 10, failurePolicy: true });
  const result = {
    getClubInsightsV2: functions.runWith({ timeoutSeconds: 540, memory: "1GB", maxInstances: 10 }).https.onCall((data, context) => insights.getClubInsightsV2(data || {}, caller(context))),
    getCoachPlayerComparison: functions.runWith({ timeoutSeconds: 540, memory: "1GB", maxInstances: 10 }).https.onCall((data, context) => insights.getCoachPlayerComparison(data || {}, caller(context))),
    recordInsightUsage: functions.runWith({ timeoutSeconds: 60, maxInstances: 10 }).https.onCall((data, context) => usage.recordInsightUsage(data, caller(context))),
    // Profile fields/membership are read fresh by the reporting service. Only
    // existence changes affect this history projection's inputs.
    projectInsightPlayer: events.firestore.document("players/{playerId}").onWrite((change, context) =>
      snapshotExists(change.before) === snapshotExists(change.after) ? null : rebuild(context.params.playerId, "player", context)),
    projectInsightRecords: events.firestore.document("players/{playerId}/{collectionId}/{recordId}").onWrite(projectRecord),
    projectInsightRevisions: events.firestore.document("players/{playerId}/reps/{repId}/revisions/{revisionId}").onWrite((_, context) => rebuild(context.params.playerId, "revision", context)),
    projectInsightFailures: events.firestore.document("failureCases/{failureId}").onWrite(async (change, context) => {
      if (isDeepStrictEqual(failureProjectionInput(change.before?.data?.()), failureProjectionInput(change.after?.data?.()))) return null;
      const ids = [...new Set([change.before?.data()?.playerDocumentID, change.after?.data()?.playerDocumentID].filter(playerSegment))];
      for (const id of ids) await rebuild(id, "failure", context);
    }),
    projectInsightArtifacts: events.storage.bucket(BUCKET).object().onFinalize((object, context) => projectArtifact(object, context, "artifact")),
    projectInsightArtifactDeletes: events.storage.bucket(BUCKET).object().onDelete((object, context) => projectArtifact(object, context, "artifact_delete")),
  };
  Object.defineProperty(result, "rebuildInsightPlayer", { value: (playerId, source = null) =>
    rebuild(playerId, source?.sourceKind, source), enumerable: false });
  return result;
}
module.exports = { createInsightsEntrypoints, storageOwner, storageTestingEventId, BUCKET, RECORD_COLLECTIONS, failureProjectionInput };
