"use strict";
const { isClubAdmin, activeMember } = require("./club-access");
const { playerSegment } = require("./athlete-storage-paths");
const { createDiagnosticAccess, registeredReporter, originalReporter, retentionActive } = require("./diagnostic-access");

// A fresh resumable upload is issued only after current authorization is checked.
// Clients never receive download URLs, bucket credentials or a reusable role grant.
function createDiagnosticUploads({ db, bucket, FieldValue, HttpsError }) {
  const denied = () => new HttpsError("permission-denied", "Diagnostic upload is not authorized.");
  const { read, athleteAccess } = createDiagnosticAccess({ db });
  async function authorize(data, auth) {
    if (!registeredReporter(auth)) throw denied();
    const path = data.path;
    if (typeof path !== "string" || path.length > 512) throw denied();
    let record, name, recordPath, observationId;
    // log.jsonl.gz is the trimmed run journal the phone sends beside the manifest.
    // It has no record field of its own; it is bound to the record's manifest path.
    const attempt = path.match(/^processing_attempts\/([^/]+)\/([a-f0-9-]{36})\/(manifest\.json|log\.jsonl\.gz)$/);
    const incident = path.match(/^failure_cases\/([A-Za-z0-9_-]{1,128})\/(report\.json|video\.mov|log\.jsonl|calibration\.json|calibration\.jpg|system_diagnostic\.json|calibration_observations\/[a-f0-9-]{36}\.png)$/);
    if (attempt) {
      if (attempt[1] !== auth.uid) throw denied();
      recordPath = `processingAttempts/${attempt[2]}`;
      record = await read(recordPath);
      name = attempt[3];
      const manifestPath = `processing_attempts/${attempt[1]}/${attempt[2]}/manifest.json`;
      if (record?.manifestPath !== manifestPath || record?.attemptId !== attempt[2]) throw denied();
    } else if (incident) {
      recordPath = `failureCases/${incident[1]}`;
      record = await read(recordPath);
      name = incident[2];
      if (name.startsWith("calibration_observations/")) {
        observationId = name.split("/")[1].slice(0, -4);
        const observations = record?.calibrationObservations;
        if (!observations || Object.keys(observations).length > 4 || observations[observationId] !== data.sha256) throw denied();
      }
      if (record?.storage?.prefix !== `failure_cases/${incident[1]}`) throw denied();
    } else throw denied();
    if (!originalReporter(record, auth) || !retentionActive(record)) throw denied();
    const scope = record.scope || "attempt";
    if (scope === "actor") {
      if (record.kind !== "system_diagnostic" || record.playerDocumentID != null || record.attemptId != null
          || record.processingRunId != null || record.testingEventId != null || record.repId != null
          || name !== "system_diagnostic.json") throw denied();
    } else if (scope === "stationSetup") {
      if (!playerSegment(record.testingEventId) || record.playerDocumentID != null || record.attemptId != null) throw denied();
      const event = await read(`testingEvents/${record.testingEventId}`);
      if (!event?.operatorUids?.includes(auth.uid)) throw denied();
      if (!isClubAdmin(auth)) {
        if (!playerSegment(event.organizationId)
            || !activeMember(await read(`organizations/${event.organizationId}/members/${auth.uid}`), auth.uid)) throw denied();
      }
    } else if (scope !== "attempt" || !await athleteAccess(record.playerDocumentID, auth)) throw denied();
    const expectedType = observationId ? "image/png" : name === "video.mov" ? "video/quicktime" : name === "calibration.jpg" ? "image/jpeg"
      : name === "log.jsonl" ? "application/x-ndjson" : name === "log.jsonl.gz" ? "application/gzip" : "application/json";
    const limit = observationId ? 8 * 1024 * 1024 : name === "video.mov" ? 512 * 1024 * 1024 : name === "calibration.jpg" ? 8 * 1024 * 1024
      : name === "manifest.json" || name === "log.jsonl.gz" ? 1024 * 1024 : 2 * 1024 * 1024;
    if (data.contentType !== expectedType || !Number.isSafeInteger(data.byteCount) || data.byteCount < 1 || data.byteCount > limit
        || typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256)) {
      throw new HttpsError("invalid-argument", "Diagnostic artifact shape is invalid.");
    }
    // Serialize issuance with cleanup claims. Google upload sessions expire
    // after a week; cleanup waits eight days from this server timestamp so an
    // abandoned authorized session cannot resurrect a deleted object.
    await db.runTransaction(async tx => {
      const target = db.doc(recordPath);
      const latest = (await tx.get(target)).data();
      if ((observationId && latest?.calibrationObservations?.[observationId] !== data.sha256)
          || !latest || latest.reportedByUid !== auth.uid || latest.sequence !== record.sequence
          || (latest.retentionState && latest.retentionState !== "active")) throw denied();
      tx.update(target, { uploadSessionIssuedAt: FieldValue.serverTimestamp() });
    });
    const [uploadURL] = await bucket.file(path).createResumableUpload({ metadata: {
      contentType: expectedType, contentLength: data.byteCount, metadata: { posetekLocalProcessed: "true", diagnosticSchema: "2",
        reportedByUid: auth.uid, sha256: data.sha256, expectedBytes: String(data.byteCount),
        ...(record.attemptId ? { attemptId: record.attemptId } : {}) }
    } });
    return { uploadURL };
  }
  return { authorize };
}
module.exports = { createDiagnosticUploads };
