"use strict";

const { createInsightsV2 } = require("./insights-v2");
const { createInsightUsage } = require("./insight-usage");
const { playerSegment } = require("./athlete-storage-paths");
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
function createInsightsEntrypoints(functions, admin, caller) {
  const db = admin.firestore();
  const insights = createInsightsV2({ db, bucket: admin.storage().bucket(BUCKET), HttpsError: functions.https.HttpsError });
  const usage = createInsightUsage({ db, Timestamp: admin.firestore.Timestamp, HttpsError: functions.https.HttpsError });
  async function rebuild(playerId) {
    if (!playerSegment(playerId)) return;
    await insights.invalidateInsightPlayer(playerId);
    await insights.rebuildInsightPlayer(playerId);
  }
  async function projectRecord(change, context) {
    if (!RECORD_COLLECTIONS.has(context.params.collectionId)) return null;
    const before = change.before?.data?.() || {};
    const after = change.after?.data?.() || {};
    if (context.params.collectionId === "reps" && (playerSegment(after.testingEventId) || playerSegment(before.testingEventId))) return null;
    return rebuild(context.params.playerId);
  }
  async function projectArtifact(object) {
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
    return rebuild(playerId);
  }
  const events = functions.runWith({ timeoutSeconds: 540, memory: "512MB", maxInstances: 10, failurePolicy: true });
  const result = {
    getClubInsightsV2: functions.runWith({ timeoutSeconds: 540, memory: "1GB", maxInstances: 10 }).https.onCall((data, context) => insights.getClubInsightsV2(data || {}, caller(context))),
    getCoachPlayerComparison: functions.runWith({ timeoutSeconds: 540, memory: "1GB", maxInstances: 10 }).https.onCall((data, context) => insights.getCoachPlayerComparison(data || {}, caller(context))),
    recordInsightUsage: functions.runWith({ timeoutSeconds: 60, maxInstances: 10 }).https.onCall((data, context) => usage.recordInsightUsage(data, caller(context))),
    projectInsightPlayer: events.firestore.document("players/{playerId}").onWrite((_, context) => rebuild(context.params.playerId)),
    projectInsightRecords: events.firestore.document("players/{playerId}/{collectionId}/{recordId}").onWrite(projectRecord),
    projectInsightRevisions: events.firestore.document("players/{playerId}/reps/{repId}/revisions/{revisionId}").onWrite((_, context) => rebuild(context.params.playerId)),
    projectInsightFailures: events.firestore.document("failureCases/{failureId}").onWrite(async change => {
      const ids = [...new Set([change.before?.data()?.playerDocumentID, change.after?.data()?.playerDocumentID].filter(playerSegment))];
      for (const id of ids) await rebuild(id);
    }),
    projectInsightArtifacts: events.storage.bucket(BUCKET).object().onFinalize(projectArtifact),
    projectInsightArtifactDeletes: events.storage.bucket(BUCKET).object().onDelete(projectArtifact),
  };
  Object.defineProperty(result, "rebuildInsightPlayer", { value: rebuild, enumerable: false });
  return result;
}
module.exports = { createInsightsEntrypoints, storageOwner, storageTestingEventId, BUCKET, RECORD_COLLECTIONS };
