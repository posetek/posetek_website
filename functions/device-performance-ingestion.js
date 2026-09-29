"use strict";

// ingestDevicePerformanceV1 (plan 07 §6 "Ingestion"; PROCESSING_PERF_CONTRACTS_V1 §8).
//
// One callable request carries at most 16 client-observed performance facts.
// Every record gets its own typed result; one bad record never blocks another.
// A fact is stored only when:
// - it is contract-valid (device-performance-contract.js) and field-origin;
// - its originReporterUid is the authenticated caller;
// - when it names an attempt, that attempt's processingAttempts index was
//   reported by the caller, who still has access to the athlete (the shared
//   diagnostics helpers). An install id is never authorization.
// Idempotency is (recordKind, recordId, revision) plus a server-computed
// RFC 8785 SHA-256 digest. Terminal run outcomes never change.

const contract = require("./device-performance-contract");
const { createDiagnosticAccess, registeredReporter, originalReporter } = require("./diagnostic-access");

const DAY = 86400000;
// Contract §8.9. expiresAt is written for a later, separately verified TTL
// policy; this change enables no deletion.
const RETENTION_DAYS = Object.freeze({ attemptSummary: 90, runSummary: 90, uploadGroupSummary: 90, transferInvocation: 30, deviceStatus: 90 });
// Server-only like the fact roots, modelled on insightUsageActors.
const RATE_LIMIT_ROOT = "devicePerformanceRateLimits";
// Calls per minute. A full 1,000-record spool is 63 calls, so one phone drains
// in about two minutes; excess calls get retryLater without any fact write.
const RATE_LIMITS = Object.freeze({ windowMs: 60000, callsPerCaller: 60, callsPerInstall: 30 });
// clockQuality may be downgraded to "future" by the server (contract §8.1).
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60000;
const STORAGE_VERSION = 1;
// Identity that never changes across revisions of one entity. A run's lineage
// is fixed when the run is created; other kinds may move their envelope run id
// to a later retry run.
const EXACT_IDENTITY = Object.freeze(["attemptId", "originReporterUid", "origin", "evaluationRunId"]);
const RUN_LINEAGE = Object.freeze(["processingRunId", "retryOfRunId"]);
// Origin facts are immutable once known (a retry or update never rewrites what
// originally recorded the clip); an unknown (null) origin may be filled in.
const ORIGIN_FACTS = Object.freeze(["originInstallId", "originLaunchId", "originPlatform", "captureOccurredAtClient"]);
// A terminal run's compute outcome: .failed(failure), .cancelled(reason) and the stages.
const TERMINAL_RUN_FIELDS = Object.freeze(["outcome", "failure", "cancellationReason", "stages"]);

function sameIdentity(stored, record, authority) {
  const previous = stored.record;
  if (!contract.isPlainObject(previous) || stored.authority?.reporterUid !== authority.reporterUid
      || stored.authority?.attemptId !== authority.attemptId) return false;
  const exact = record.recordKind === "runSummary" ? [...EXACT_IDENTITY, ...RUN_LINEAGE] : EXACT_IDENTITY;
  if (exact.some((key) => !contract.jsonEqual(previous[key], record[key]))) return false;
  return ORIGIN_FACTS.every((key) => previous[key] === null || contract.jsonEqual(previous[key], record[key]));
}

// A later revision may never change a terminal run measurement, so a retry's
// success can never replace a failed run (a retry is a new processingRunId).
function illegalTransition(previous, record) {
  if (record.recordKind !== "runSummary" || !contract.TERMINAL_RUN_OUTCOMES.includes(previous.body?.outcome)) return false;
  return TERMINAL_RUN_FIELDS.some((key) => !contract.jsonEqual(previous.body[key], record.body[key]));
}

function serverClockQuality(record, current) {
  const at = record.occurredAtClient === null ? NaN : Date.parse(record.occurredAtClient);
  return Number.isFinite(at) && at > current + FUTURE_CLOCK_TOLERANCE_MS ? "future" : record.clockQuality;
}

function createDevicePerformanceIngestion({ db, FieldValue, Timestamp, HttpsError, now = Date.now, logger = console }) {
  const access = createDiagnosticAccess({ db });

  // An attempt-linked fact is authorized by the attempt's diagnostics index,
  // never by the fact itself. retentionState is deliberately not checked:
  // expiry of optional diagnostic artifacts never invalidates an identity.
  async function verifyAttempt(attemptId, auth) {
    const index = await access.read(`processingAttempts/${attemptId}`);
    // The phone delivers the attempt index first; until it lands the fact
    // stays pending on the phone. No replacement identity is ever forged.
    if (!index) return { errorCode: "dependencyPending" };
    if (!originalReporter(index, auth)) return { errorCode: "unauthorizedReporter" };
    if ((index.scope || "attempt") !== "attempt" || index.attemptId !== attemptId) return { errorCode: "identityMismatch" };
    if (!await access.athleteAccess(index.playerDocumentID, auth)) return { errorCode: "unauthorizedReporter" };
    return { basis: "processingAttempt", reporterUid: auth.uid, attemptId, playerDocumentID: index.playerDocumentID };
  }
  function authorityFor(record, auth, cache) {
    if (record.attemptId === null) return { basis: "reporter", reporterUid: auth.uid, attemptId: null, playerDocumentID: null };
    if (!cache.has(record.attemptId)) cache.set(record.attemptId, verifyAttempt(record.attemptId, auth));
    return cache.get(record.attemptId);
  }

  // Bounded per caller and per executing install (insight-usage.js pattern).
  async function rateLimited(uid, installIds) {
    const current = now();
    const window = Math.floor(current / RATE_LIMITS.windowMs);
    const limits = [[`caller:${uid}`, RATE_LIMITS.callsPerCaller], ...installIds.map((id) => [`install:${id}`, RATE_LIMITS.callsPerInstall])];
    return db.runTransaction(async (tx) => {
      const refs = limits.map(([key]) => db.collection(RATE_LIMIT_ROOT).doc(key));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      const counts = snapshots.map((snapshot) => (snapshot.data()?.window === window ? snapshot.data().count : 0));
      if (counts.some((count, index) => count >= limits[index][1])) return true;
      refs.forEach((ref, index) => tx.set(ref, { window, count: counts[index] + 1, expiresAt: Timestamp.fromMillis(current + DAY) }));
      return false;
    });
  }

  function factFields(record, evaluation, authority, current, batchId) {
    return {
      storageVersion: STORAGE_VERSION,
      recordKind: record.recordKind,
      recordId: record.recordId,
      revision: record.revision,
      digest: evaluation.digest,
      encodedBytes: evaluation.bytes,
      record,
      authority,
      attemptId: record.attemptId,
      processingRunId: record.processingRunId,
      originInstallId: record.originInstallId,
      executorInstallId: record.executorInstallId,
      serverClockQuality: serverClockQuality(record, current),
      lastBatchId: batchId,
      expiresAt: Timestamp.fromMillis(current + RETENTION_DAYS[record.recordKind] * DAY),
    };
  }

  async function ingestOne(index, record, evaluation, auth, cache, batchId) {
    const reply = (fields) => contract.responseItem(index, evaluation, fields);
    const refuse = (errorCode, acceptedRevision = null) => reply({ ...contract.outcome(errorCode), acceptedRevision });
    if (record.originReporterUid !== auth.uid) return refuse("unauthorizedReporter");
    const authority = await authorityFor(record, auth, cache);
    if (authority.errorCode) return refuse(authority.errorCode);
    const ref = db.collection(contract.ROOTS[record.recordKind]).doc(`${record.recordKind}:${record.recordId}`);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const stored = snapshot.exists ? snapshot.data() : null;
      const current = now();
      if (stored) {
        if (!sameIdentity(stored, record, authority)) return refuse("identityMismatch", stored.revision);
        if (record.revision === stored.revision) {
          return stored.digest === evaluation.digest
            ? reply({ status: "duplicate", retryable: false, acceptedRevision: stored.revision })
            : refuse("revisionConflict", stored.revision);
        }
        if (record.revision < stored.revision) return refuse("staleRevision", stored.revision);
        if (illegalTransition(stored.record, record)) return refuse("illegalTransition", stored.revision);
        // firstReceivedAtServer is set once and never reset on replay.
        tx.update(ref, { ...factFields(record, evaluation, authority, current, batchId), updatedAtServer: FieldValue.serverTimestamp() });
      } else {
        tx.create(ref, {
          ...factFields(record, evaluation, authority, current, batchId),
          firstReceivedAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp(),
        });
      }
      return reply({ status: "accepted", retryable: false, acceptedRevision: record.revision });
    });
  }

  function logRefusal(index, evaluation) {
    const { errorCode } = evaluation.outcome;
    if (!["invalidSchema", "identityMismatch", "oversizedRecord"].includes(errorCode)) return;
    // Error paths only, never values: facts can carry athlete-linked ids.
    logger.warn("ingestDevicePerformanceV1 refused a record", {
      index, errorCode, recordKind: evaluation.recordKind, errors: evaluation.errors.slice(0, 3),
    });
  }

  async function ingest(data, auth) {
    if (!registeredReporter(auth)) throw new HttpsError("permission-denied", "A registered account is required.");
    let batch;
    try {
      batch = contract.inspectBatch(data);
    } catch (error) {
      // Not itemizable. No record is rejected; the phone keeps them pending.
      if (error instanceof contract.BatchError) throw new HttpsError("invalid-argument", error.message, { errorCode: error.errorCode });
      throw error;
    }
    const respond = (results) => ({ performanceSchemaVersion: contract.PERFORMANCE_SCHEMA_VERSION, batchId: batch.batchId, results });
    const item = (index, evaluation, errorCode) => contract.responseItem(index, evaluation, contract.outcome(errorCode));
    if (batch.unsupportedVersion) {
      return respond(batch.records.map((record, index) => item(index, contract.validateRecord(record), "unsupportedVersion")));
    }
    const evaluations = batch.records.map((record) => contract.checkIngestible(record));
    const results = evaluations.map((evaluation, index) => {
      if (evaluation.ok) return null;
      logRefusal(index, evaluation);
      return contract.responseItem(index, evaluation, evaluation.outcome);
    });
    const pending = evaluations.flatMap((evaluation, index) => (evaluation.ok ? [index] : []));
    const settle = (errorCode) => { for (const index of pending) results[index] = item(index, evaluations[index], errorCode); return respond(results); };
    if (!pending.length) return respond(results);
    const bytes = contract.batchEncodedBytes(batch.batchId, batch.records, evaluations.map((evaluation) => evaluation.canonical));
    // Records within their own limit stay pending for a smaller batch.
    if (bytes > contract.LIMITS.batchBytes) return settle("oversizedBatch");
    const installIds = [...new Set(pending.map((index) => batch.records[index].executorInstallId).filter((id) => id !== null))];
    if (await rateLimited(auth.uid, installIds)) return settle("rateLimited");
    const cache = new Map();
    for (const index of pending) {
      try {
        results[index] = await ingestOne(index, batch.records[index], evaluations[index], auth, cache, batch.batchId);
      } catch (error) {
        logger.error("ingestDevicePerformanceV1 record failed", { index, recordKind: evaluations[index].recordKind, message: error?.message });
        results[index] = item(index, evaluations[index], "internal");
      }
    }
    return respond(results);
  }

  return { ingest };
}

// Explicit 1st-gen export in the codebase's default region (us-central1), with
// plan 07's 512 MiB / 120 s budget.
function createIngestDevicePerformanceV1(functions, admin, requireCaller) {
  const ingestion = createDevicePerformanceIngestion({
    db: admin.firestore(), FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp, HttpsError: functions.https.HttpsError,
  });
  // App Check is not enforced, matching every callable here (decision D-2026-09-29-11a; open item for release).
  return functions.runWith({ timeoutSeconds: 120, memory: "512MB" }).https.onCall((data, context) => ingestion.ingest(data, requireCaller(context)));
}

module.exports = {
  createDevicePerformanceIngestion, createIngestDevicePerformanceV1,
  RATE_LIMIT_ROOT, RATE_LIMITS, RETENTION_DAYS, EXACT_IDENTITY, RUN_LINEAGE, ORIGIN_FACTS, TERMINAL_RUN_FIELDS,
};
