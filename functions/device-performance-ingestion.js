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
//   diagnostics helpers), and the fact agrees with the drill, rep and capture
//   launch the index records. An install id is never authorization.
// Idempotency is (recordKind, recordId, revision) plus a server-computed
// RFC 8785 SHA-256 digest. A terminal run is frozen apart from a small
// allowlist. Review rulings: decision D-2026-09-29-21.

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
// Once a run's outcome is terminal, a later revision may change only these;
// every measurement and every attribution field is frozen (D-21 F2).
const POST_TERMINAL_MUTABLE = Object.freeze({
  envelope: Object.freeze(["revision", "completeness", "missingReasons", "droppedDetailCount"]),
  totals: Object.freeze(["journalFinalizeMs"]),
  resources: Object.freeze(["released"]),
});
// Attempt identity the processingAttempts index records; a fact may not
// contradict it (D-21 F7).
const ATTEMPT_INDEX_FACTS = Object.freeze(["drillType", "repId", "originLaunchId"]);
// Per-attempt bounds on new entities (D-31 F1 follow-up), well inside the
// projection's over-limit exclusion (128 runs / 2,000 transfers per attempt).
const ATTEMPT_CAPS = Object.freeze({ runSummary: 32, transferInvocation: 512 });
// Contract v1.2.1 (§8.7, $defs/ingestResponseV1) has no `attemptCapExceeded`
// error code. Until a contract amendment adds it, the permanent refusal is sent
// with the closest frozen code and the typed reason is logged; adding the code
// to the contract makes this a one-line change.
const ATTEMPT_CAP_WIRE_CODE = "illegalTransition";

function omit(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}
function frozenRunView(record) {
  const { body } = record;
  return {
    ...omit(record, [...POST_TERMINAL_MUTABLE.envelope, "body"]),
    body: {
      ...omit(body, ["totals", "resources"]),
      totals: omit(body.totals, POST_TERMINAL_MUTABLE.totals),
      resources: omit(body.resources, POST_TERMINAL_MUTABLE.resources),
    },
  };
}
// A terminal run measurement never changes, so a retry's success can never
// replace a failed run (a retry is a new processingRunId). interruptedUnknown
// is not terminal.
function illegalTransition(previous, record) {
  if (record.recordKind !== "runSummary" || !contract.TERMINAL_RUN_OUTCOMES.includes(previous.body?.outcome)) return false;
  return !contract.jsonEqual(frozenRunView(previous), frozenRunView(record));
}

function sameIdentity(stored, record, authority) {
  const previous = stored.record;
  if (!contract.isPlainObject(previous) || stored.authority?.reporterUid !== authority.reporterUid
      || stored.authority?.attemptId !== authority.attemptId) return false;
  const exact = record.recordKind === "runSummary" ? [...EXACT_IDENTITY, ...RUN_LINEAGE] : EXACT_IDENTITY;
  if (exact.some((key) => !contract.jsonEqual(previous[key], record[key]))) return false;
  return ORIGIN_FACTS.every((key) => previous[key] === null || contract.jsonEqual(previous[key], record[key]));
}

// Contract §8.6 transition rule (D-21 F1, kept in v1.2): a system upload group
// (`system:<category>:<originInstallId>`, which already names its install) is
// stored and keyed under `${recordKind}:${recordId}:${originInstallId}:${originReporterUid}`,
// so accounts sharing an install never share a document. Every other fact,
// including the per-reporter deviceStatus id `<executorInstallId>:<originReporterUid>`,
// is keyed `${recordKind}:${recordId}`.
function storageKey(record) {
  const key = `${record.recordKind}:${record.recordId}`;
  return record.recordKind === "uploadGroupSummary" && record.recordId.startsWith("system:")
    ? `${key}:${record.originInstallId}:${record.originReporterUid}`
    : key;
}

// A stored fact written by a newer (or unknown) storage shape is never judged
// by this code: the record stays pending until a compatible build runs (D-21 F3).
function unknownStorage(stored) {
  return !(Number.isSafeInteger(stored.storageVersion) && stored.storageVersion <= STORAGE_VERSION);
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
    const facts = Object.fromEntries(ATTEMPT_INDEX_FACTS
      .filter((key) => typeof index[key] === "string" && index[key] !== "").map((key) => [key, index[key]]));
    return { authority: { basis: "processingAttempt", reporterUid: auth.uid, attemptId, playerDocumentID: index.playerDocumentID }, facts };
  }
  async function authorize(record, auth, attempts) {
    if (record.attemptId === null) {
      return { authority: { basis: "reporter", reporterUid: auth.uid, attemptId: null, playerDocumentID: null }, facts: {} };
    }
    if (!attempts.has(record.attemptId)) attempts.set(record.attemptId, verifyAttempt(record.attemptId, auth));
    const verified = await attempts.get(record.attemptId);
    if (verified.errorCode) return verified;
    // A value the fact leaves null makes no claim; a present value must agree.
    if (Object.entries(verified.facts).some(([key, value]) => record[key] !== null && record[key] !== value)) {
      return { errorCode: "identityMismatch" };
    }
    return verified;
  }

  // One fixed-minute counter (insight-usage.js pattern). A malformed counter
  // fails closed: the current minute is sealed as exhausted and the next
  // minute starts clean (D-21 F8).
  async function consumeRate(key, limit) {
    const current = now();
    const window = Math.floor(current / RATE_LIMITS.windowMs);
    const ref = db.collection(RATE_LIMIT_ROOT).doc(key);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const data = snapshot.exists ? snapshot.data() : null;
      const expiresAt = Timestamp.fromMillis(current + DAY);
      const malformed = data !== null && (!Number.isSafeInteger(data.window)
        || (data.window === window && !(Number.isSafeInteger(data.count) && data.count >= 0)));
      if (malformed) {
        tx.set(ref, { window, count: limit, expiresAt });
        return true;
      }
      const count = data?.window === window ? data.count : 0;
      if (count >= limit) return true;
      tx.set(ref, { window, count: count + 1, expiresAt });
      return false;
    });
  }
  // Each executing install is charged once per call, only for a record whose
  // caller may report it (D-21 F4), and on a counter of its own per account, so
  // another account naming a known install id cannot spend that device's
  // budget (D-23 low item).
  function installLimited(installId, uid, installs) {
    if (!installs.has(installId)) installs.set(installId, consumeRate(`install:${installId}:${uid}`, RATE_LIMITS.callsPerInstall));
    return installs.get(installId);
  }
  // True when a NEW run or transfer would take its attempt past the cap. Only
  // new entities count; revisions and replays of a stored one never do. The
  // count runs outside the fact transaction, so two concurrent new entities can
  // overshoot the cap by the concurrency (bounded by the batch and the rate
  // limits, and far inside the projection's own exclusion bound).
  async function attemptCapReached(record) {
    const cap = ATTEMPT_CAPS[record.recordKind];
    if (cap === undefined || record.attemptId === null) return false;
    const counted = await db.collection(contract.ROOTS[record.recordKind]).where("attemptId", "==", record.attemptId).count().get();
    return counted.data().count >= cap;
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

  async function ingestOne(index, record, evaluation, auth, call, batchId) {
    const reply = (fields) => contract.responseItem(index, evaluation, fields);
    // A refusal carries a stored revision only when the caller owns that entity (D-21 F5).
    const refuse = (errorCode, acceptedRevision = null) => reply({ ...contract.outcome(errorCode), acceptedRevision });
    const duplicate = (revision) => reply({ status: "duplicate", retryable: false, acceptedRevision: revision });
    if (record.originReporterUid !== auth.uid) return refuse("unauthorizedReporter");
    const ref = db.collection(contract.ROOTS[record.recordKind]).doc(storageKey(record));
    // An exact replay of the caller's own accepted revision is acknowledged
    // before current access is re-checked, so revocation never turns an
    // accepted fact into a dropped one (D-21 F6).
    const existing = await ref.get();
    const known = existing.exists ? existing.data() : null;
    if (known && unknownStorage(known)) return refuse("unsupportedVersion");
    if (known && known.authority?.reporterUid === auth.uid && known.revision === record.revision && known.digest === evaluation.digest) {
      return duplicate(known.revision);
    }
    const verified = await authorize(record, auth, call.attempts);
    if (verified.errorCode) return refuse(verified.errorCode);
    if (!known && await attemptCapReached(record)) {
      logger.warn("ingestDevicePerformanceV1 refused a record", {
        index, errorCode: "attemptCapExceeded", recordKind: record.recordKind, cap: ATTEMPT_CAPS[record.recordKind],
      });
      return refuse(ATTEMPT_CAP_WIRE_CODE);
    }
    if (record.executorInstallId !== null && await installLimited(record.executorInstallId, auth.uid, call.installs)) return refuse("rateLimited");
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const stored = snapshot.exists ? snapshot.data() : null;
      const current = now();
      if (stored) {
        if (unknownStorage(stored)) return refuse("unsupportedVersion");
        if (!sameIdentity(stored, record, verified.authority)) return refuse("identityMismatch");
        if (record.revision === stored.revision) {
          return stored.digest === evaluation.digest ? duplicate(stored.revision) : refuse("revisionConflict", stored.revision);
        }
        if (record.revision < stored.revision) return refuse("staleRevision", stored.revision);
        if (illegalTransition(stored.record, record)) return refuse("illegalTransition", stored.revision);
        // firstReceivedAtServer is set once and never reset on replay.
        tx.update(ref, { ...factFields(record, evaluation, verified.authority, current, batchId), updatedAtServer: FieldValue.serverTimestamp() });
      } else {
        tx.create(ref, {
          ...factFields(record, evaluation, verified.authority, current, batchId),
          firstReceivedAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp(),
        });
      }
      return reply({ status: "accepted", retryable: false, acceptedRevision: record.revision });
    });
  }

  function logRefusal(index, evaluation) {
    const { errorCode } = evaluation.outcome;
    if (!["invalidSchema", "identityMismatch", "oversizedRecord"].includes(errorCode)) return;
    // Error paths only, never values; client-chosen key names appear hashed.
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
    // The per-caller bound comes first; per-install bounds follow actor binding.
    if (await consumeRate(`caller:${auth.uid}`, RATE_LIMITS.callsPerCaller)) return settle("rateLimited");
    const call = { attempts: new Map(), installs: new Map() };
    for (const index of pending) {
      try {
        results[index] = await ingestOne(index, batch.records[index], evaluations[index], auth, call, batch.batchId);
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
  createDevicePerformanceIngestion, createIngestDevicePerformanceV1, storageKey, frozenRunView,
  RATE_LIMIT_ROOT, RATE_LIMITS, RETENTION_DAYS, STORAGE_VERSION, EXACT_IDENTITY, RUN_LINEAGE, ORIGIN_FACTS,
  POST_TERMINAL_MUTABLE, ATTEMPT_INDEX_FACTS, ATTEMPT_CAPS, ATTEMPT_CAP_WIRE_CODE,
};
