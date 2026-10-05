"use strict";

const { isClubAdmin } = require("./club-access");
const DAY = 86400000;
const FILES = ["video.mov", "report.json", "log.jsonl", "calibration.jpg", "calibration.json", "system_diagnostic.json"];
const milliseconds = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN);

// Diagnostics-only retention. Never enumerate a bucket or touch athlete archives.
// Deployment starts disabled; a separate reviewed config write enables the sweep.
function createDiagnosticRetention({ db, bucket, FieldValue, HttpsError, now = Date.now }) {
  const ref = id => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new HttpsError("invalid-argument", "Invalid incident ID.");
    return db.collection("failureCases").doc(id);
  };

  async function acknowledge(id, collection = "failureCases") {
    const target = collection === "processingAttempts" ? db.collection(collection).doc(id) : ref(id);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      const d = snapshot.data();
      if (!snapshot.exists || d.schemaVersion !== 2 || d.artifactUploadState !== "complete" || d.artifactsAcknowledgedAt) return false;
      tx.update(target, { artifactsAcknowledgedAt: FieldValue.serverTimestamp() });
      return true;
    });
  }

  async function protect(data, auth) {
    if (!isClubAdmin(auth)) throw new HttpsError("permission-denied", "Verified administrator required.");
    if (typeof data.hold !== "boolean" || !Array.isArray(data.references) || data.references.length > 64
        || data.references.some(v => typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(v))) {
      throw new HttpsError("invalid-argument", "Supply a hold and bounded reference IDs.");
    }
    if (data.attemptId != null && !/^[a-f0-9-]{36}$/.test(data.attemptId)) throw new HttpsError("invalid-argument", "Invalid attempt ID.");
    const target = data.attemptId ? db.collection("processingAttempts").doc(data.attemptId) : ref(data.incidentId);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      const d = snapshot.data();
      if (!snapshot.exists || d.schemaVersion !== 2) throw new HttpsError("not-found", "No schema-2 incident.");
      if (["videoDeleting", "allDeleting", "expired"].includes(d.retentionState)) {
        throw new HttpsError("failed-precondition", "Cleanup has already claimed this incident; retained artifacts cannot be promised.");
      }
      tx.update(target, { investigationHold: data.hold, artifactReferences: [...new Set(data.references)],
        retentionReviewedBy: auth.uid, retentionReviewedAt: FieldValue.serverTimestamp() });
      return { held: data.hold, references: data.references.length };
    });
  }

  async function cleanIncident(id) {
    const target = ref(id);
    const phase = await db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      const d = snapshot.data();
      if (!snapshot.exists || d.schemaVersion !== 2 || d.investigationHold === true
          || (d.artifactReferences?.length ?? 0) > 0 || d.retentionState === "expired") return null;
      if (d.storage?.prefix !== `failure_cases/${id}`) return null;
      // Recover an interrupted deletion using the already-persisted claim.
      if (["videoDeleting", "allDeleting"].includes(d.retentionState)) return d.retentionState;
      const lastSession = milliseconds(d.uploadSessionIssuedAt);
      if (Number.isFinite(lastSession) && now() - lastSession < 8 * DAY) return null;
      const acknowledged = milliseconds(d.artifactsAcknowledgedAt);
      if (d.artifactUploadState !== "complete" || !Number.isFinite(acknowledged)) return null;
      const age = now() - acknowledged;
      const next = age >= 30 * DAY ? "allDeleting"
        : age >= 7 * DAY && d.retentionState !== "videoExpired" ? "videoDeleting" : null;
      if (!next) return null;
      tx.update(target, { retentionState: next, retentionStartedAt: FieldValue.serverTimestamp() });
      return next;
    });
    if (!phase) return { skipped: true };
    // A failed object delete leaves the claim in place. Retries may repeat
    // successful deletions; 404 is success. Metadata remains an authorization
    // tombstone and an audit of expired evidence, not a promise of completeness.
    const record = (await target.get()).data();
    const observations = Object.keys(record.calibrationObservations || {}).filter(id => /^[a-f0-9-]{36}$/.test(id)).slice(0, 4);
    const files = [...FILES, ...observations.map(id => `calibration_observations/${id}.png`)];
    for (const name of phase === "videoDeleting" ? ["video.mov"] : files) {
      await bucket.file(`failure_cases/${id}/${name}`).delete({ ignoreNotFound: true });
    }
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      if (snapshot.data()?.retentionState !== phase) throw new Error("Retention claim changed unexpectedly");
      tx.update(target, { retentionState: phase === "videoDeleting" ? "videoExpired" : "expired",
        retentionCompletedAt: FieldValue.serverTimestamp() });
    });
    return { state: phase === "videoDeleting" ? "videoExpired" : "expired" };
  }

  async function cleanAttempt(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return { skipped: true };
    const target = db.collection("processingAttempts").doc(id);
    // Incident evidence is retained independently. Preserve the shared history
    // whenever any incident references it, including held/partial old reports.
    const incidents = await db.collection("failureCases").where("attemptId", "==", id).limit(1).get();
    if (incidents.docs.length) return { skipped: true };
    const path = await db.runTransaction(async tx => {
      const d = (await tx.get(target)).data();
      if (!d || d.schemaVersion !== 2 || d.investigationHold === true || (d.artifactReferences?.length ?? 0) > 0
          || d.retentionState === "expired" || !["committed", "cancelled"].includes(d.lifecycle)
          || typeof d.reportedByUid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(d.reportedByUid)
          || d.manifestPath !== `processing_attempts/${d.reportedByUid}/${id}/manifest.json`) return null;
      if (d.retentionState === "allDeleting") return d.manifestPath;
      const acknowledged = milliseconds(d.artifactsAcknowledgedAt);
      const updated = milliseconds(d.updatedAt);
      const lastSession = milliseconds(d.uploadSessionIssuedAt);
      if (d.artifactUploadState !== "complete" || !Number.isFinite(acknowledged)
          || now() - Math.max(acknowledged, Number.isFinite(updated) ? updated : acknowledged) < 30 * DAY
          || (Number.isFinite(lastSession) && now() - lastSession < 8 * DAY)) return null;
      tx.update(target, { retentionState: "allDeleting", retentionStartedAt: FieldValue.serverTimestamp() });
      return d.manifestPath;
    });
    if (!path) return { skipped: true };
    // The run journal sits beside the manifest; it is absent for failed runs and older builds (404 is success).
    await bucket.file(path.replace(/manifest\.json$/, "log.jsonl.gz")).delete({ ignoreNotFound: true });
    await bucket.file(path).delete({ ignoreNotFound: true });
    await db.runTransaction(async tx => {
      const d = (await tx.get(target)).data();
      if (d?.retentionState !== "allDeleting") throw new Error("Attempt retention claim changed");
      tx.update(target, { retentionState: "expired", retentionCompletedAt: FieldValue.serverTimestamp() });
    });
    return { state: "expired" };
  }

  async function sweep() {
    const control = db.collection("config").doc("diagnosticsRetention");
    const config = (await control.get()).data() || {};
    if (config.enabled !== true) return { disabled: true };
    let query = db.collection("failureCases").orderBy("__name__").limit(50);
    if (typeof config.cursor === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(config.cursor)) query = query.startAfter(config.cursor);
    const batch = await query.get();
    const results = [];
    for (const snapshot of batch.docs) {
      try { results.push(await cleanIncident(snapshot.id)); }
      catch { results.push({ retryPending: true }); }
    }
    // A rotating bounded cursor avoids held/partial oldest rows starving later
    // candidates. A failed deletion is revisited on the next sweep cycle.
    let attemptQuery = db.collection("processingAttempts").orderBy("__name__").limit(50);
    if (typeof config.attemptCursor === "string" && /^[a-f0-9-]{36}$/.test(config.attemptCursor)) attemptQuery = attemptQuery.startAfter(config.attemptCursor);
    const attempts = await attemptQuery.get();
    for (const snapshot of attempts.docs) {
      try { results.push(await cleanAttempt(snapshot.id)); }
      catch { results.push({ retryPending: true }); }
    }
    await control.set({ attemptCursor: attempts.docs.length === 50 ? attempts.docs.at(-1).id : null, cursor: batch.docs.length === 50 ? batch.docs.at(-1).id : null,
      lastSweepAt: FieldValue.serverTimestamp(), lastBatchCount: batch.docs.length }, { merge: true });
    return { checked: batch.docs.length, results };
  }
  return { acknowledge, protect, cleanIncident, cleanAttempt, sweep };
}
module.exports = { createDiagnosticRetention };
