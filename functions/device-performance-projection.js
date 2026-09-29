"use strict";

// Device performance projections (plan 07 §6 "Reporting V1: complete, bounded
// and exact"; PROCESSING_PERF_CONTRACTS_V1 §8).
//
// Facts written by ingestion (device-performance-ingestion.js) are the only
// source. A projection is never incremented: every published generation of a
// day/device partition is rebuilt from the canonical latest facts of the
// attempts that belong to it.
//
// - Partition: (capture day in UTC, origin install). An attempt whose capture
//   date is uncertain (no attempt summary yet, clock not reliable, or a capture
//   time in the future of its first receipt) is placed in `u-<receipt day>`.
// - Membership: attemptLocators/{attemptId} names the attempt's partition. It
//   is recomputed from the canonical attempt fact, transactionally, whenever a
//   change is seen, so duplicate or reordered delivery cannot misplace it.
// - Invalidation: the change scanner reads every fact root in (updatedAtServer,
//   document id) order from a persisted cursor. For each changed attempt it
//   fixes the locator and marks the old and new partitions dirty by rotating
//   their token. The cursor advances only after the marks are written.
// - Publication (the insights-v2-projection.js pattern): immutable pages
//   `${partition}_${generation}_${n}` are written first; the manifest switches
//   to the new generation only inside a transaction that re-checks the token
//   captured before any fact was read. A concurrent invalidation or a failed
//   partial write therefore never publishes a half or stale generation, and
//   superseded pages are deleted only after a grace period longer than any read.
// - Reading: a report selects manifests, checks the declared sample and byte
//   totals before reading any page, reads at most two pages at a time, validates
//   each page's size and row count before retaining it, and stops before the
//   decoded total can pass its budget. Exceeding a bound is a typed narrowRange
//   error; nothing is ever truncated.
//
// Evaluation-origin facts are rejected by ingestion; any that exist are ignored
// here. Transfer invocations are projected only as a compact measured tuple
// (role, outcome, bytes, elapsed, network, queue wait, executor, receipt): the
// upload tiles need invocation durations and bytes, which no group summary
// carries. Raw transfer detail (object ids, provider codes, failure stages)
// stays out.
//
// Review rulings D-2026-09-29-31:
// - An attempt over its fact limits (runs, groups, transfers) is excluded from
//   the rebuild and counted (excludedOverLimit); the partition still publishes.
//   A partition over its attempt limit publishes an overflow generation that a
//   report surfaces as a typed narrowRange naming the partition (F1).
// - Each attempt is compacted inside the bounded read, and transfers are read
//   as a field projection, so raw facts are never all held at once (F2).
// - Transfer facts are retained 30 days, partitions 90: compaction and reports
//   ignore transfers first received more than 30 days ago, deterministically,
//   and upload statistics state their retention (F3).
//   RELEASE GATE: before a TTL policy or retention sweep deletes any fact, the
//   sweep must call invalidateAttempts() for every attempt it touches, so no
//   published generation keeps samples of deleted facts.
// - A generation is current when it was built from the partition's current
//   token (or by this request after its own scan); no clocks of different
//   instances are compared (F7).

const { randomUUID, createHash } = require("node:crypto");
const contract = require("./device-performance-contract");
const { STORAGE_VERSION, RETENTION_DAYS } = require("./device-performance-ingestion");
const { completeQuery, mapBounded } = require("./insights-v2-projection");

const PROJECTION_VERSION = 1;
const PROJECTION_ROOT = "devicePerformanceProjections";
const PROJECTION_DOC = "v1";
const COLLECTIONS = Object.freeze({
  partitions: "partitionManifests",
  pages: "projectionPages",
  locators: "attemptLocators",
  labels: "deviceLabels",
  labelAudit: "labelAudit",
});
const DRILLS = Object.freeze(["jump", "deadballShot", "sprint", "broadJump", "changeOfDirection", "dribbling", "freeRecord"]);
const PHASES = Object.freeze(["preparation", "waiting", "analysis", "calculation", "localSaving"]);
const DAY_MS = 86400000;
// The contract lets the server downgrade a client time more than five minutes
// ahead of receipt (device-performance-ingestion.js uses the same tolerance).
const FUTURE_TOLERANCE_MS = 5 * 60000;
const UNKNOWN_INSTALL = "unknown";
// Contract §8.9: transfer invocations are kept 30 days, summaries 90.
const TRANSFER_RETENTION_MS = RETENTION_DAYS.transferInvocation * DAY_MS;
// The transfer fields compaction needs; read as a projection (F2).
const TRANSFER_FIELDS = Object.freeze([
  "storageVersion", "firstReceivedAtServer", "updatedAtServer", "serverClockQuality",
  "record.performanceSchemaVersion", "record.recordKind", "record.origin", "record.attemptId", "record.executorInstallId",
  "record.clockQuality", "record.droppedDetailCount", "record.body.groupId", "record.body.outcome", "record.body.payloadBytes",
  "record.body.invocationElapsedMs", "record.body.networkInterface", "record.body.queueWaitMs", "record.body.knownBackoffMs",
]);

// Maximum values; a caller may lower (tests), never raise, a bound.
const LIMITS = Object.freeze({
  maxSamples: 50000,
  maxDecodedBytes: 128 * 1024 * 1024,
  maxPageBytes: 256 * 1024,
  pageReadConcurrency: 2,
  maxPartitions: 20000,
  maxPartitionAttempts: 5000,
  maxRunsPerAttempt: 64,
  maxGroupsPerAttempt: 16,
  maxTransfersPerAttempt: 2000,
  maxDevices: 5000,
  scanPageSize: 500,
  scanMaxPerCall: 5000,
  rebuildConcurrency: 4,
  attemptReadConcurrency: 8,
  retiredGraceMs: 15 * 60000,
  orphanGraceMs: 60 * 60000,
  maxRetired: 16,
  batchBytes: 4 * 1024 * 1024,
  batchOperations: 400,
  pageRetentionMs: 120 * DAY_MS,
});
const SCANNED_ROOTS = Object.freeze([
  ["attempts", contract.ROOTS.attemptSummary],
  ["runs", contract.ROOTS.runSummary],
  ["uploadGroups", contract.ROOTS.uploadGroupSummary],
  ["transfers", contract.ROOTS.transferInvocation],
]);

// ---------------------------------------------------------------------------
// Small helpers.

function millisOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}
// A sortable form of a Firestore Timestamp that keeps sub-millisecond order.
function timeOrder(value) {
  if (!value) return "";
  const seconds = typeof value.seconds === "number" ? value.seconds : Math.floor(millisOf(value) / 1000);
  const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
  return `${String(seconds).padStart(13, "0")}.${String(nanos).padStart(9, "0")}`;
}
function utcDay(millis) { return new Date(millis).toISOString().slice(0, 10); }
function clientTime(text) {
  if (typeof text !== "string") return null;
  const millis = Date.parse(text);
  return Number.isFinite(millis) ? millis : null;
}
function byteLength(value) { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
const finiteOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

// Filter choice keys travel in URLs; the admin UI accepts only this set.
const KEY_UNSAFE = /[^A-Za-z0-9 ._,()+:-]/g;
function choiceKey(text) {
  if (typeof text !== "string") return null;
  const key = text.replace(KEY_UNSAFE, "_").trim().slice(0, 128);
  return key || null;
}
function buildRef(platform) {
  if (!contract.isPlainObject(platform)) return null;
  const label = `${platform.appVersion} (${platform.build})`;
  return { key: choiceKey(label), label, appVersion: platform.appVersion, build: platform.build, os: platform.osVersion ?? null };
}
// processingAttempts.build is the capture build string the phone froze; used
// only when the attempt summary has not arrived (handoff: attribution comes
// from the attempt summary and the attempt index, never nullable run fields).
function indexBuildRef(build) {
  if (typeof build !== "string" || !build || build === "unknown") return null;
  return { key: choiceKey(build), label: build, appVersion: build, build: "", os: null };
}
function machineRef(platform) {
  if (!contract.isPlainObject(platform) || typeof platform.machine !== "string") return null;
  return { key: choiceKey(platform.machine), label: platform.machine };
}
function missingReason(record, pointer, fallback = "unavailable") {
  const list = Array.isArray(record?.missingReasons) ? record.missingReasons : [];
  return list.find((entry) => entry.field === pointer)?.reason ?? list.find((entry) => entry.field === "")?.reason ?? fallback;
}

// A stored fact the projection may use: a storage shape this build knows, a V1
// record of the expected kind, and field origin. Returns null otherwise.
function usableFact(data, kind) {
  if (!data || !Number.isSafeInteger(data.storageVersion) || data.storageVersion > STORAGE_VERSION) return null;
  const record = data.record;
  if (!contract.isPlainObject(record) || record.performanceSchemaVersion !== 1 || record.recordKind !== kind) return null;
  if (record.origin !== "field") return null;
  return {
    record,
    receivedAt: millisOf(data.firstReceivedAtServer),
    updatedAt: millisOf(data.updatedAtServer),
    clock: data.serverClockQuality ?? record.clockQuality,
  };
}
const isEvaluationFact = (data) => data?.record?.origin === "evaluation";

// Main-phase reporting buckets inside Time to result (contract §1.3). Stages
// outside the span (capture.stopRequested, acceptance and readiness) and nested
// operations are never stacked. An unknown in-run main phase counts as analysis.
function phaseOf(stageId) {
  if (stageId === "capture.stopRequested") return null;
  if (stageId.startsWith("capture.")) return "preparation";
  if (stageId.startsWith("input.") || stageId === "admission.requested") return "waiting";
  if (stageId === "artifact.persist" || stageId === "accept.manifestAck") return "localSaving";
  if (stageId.startsWith("accept.") || stageId.startsWith("flow.")) return null;
  if (/\.(math|encode)$/.test(stageId)) return "calculation";
  return "analysis";
}
const ENTERED = (status) => status !== "notNeeded" && status !== "notReached";
const STATUS_PRIORITY = ["failed", "cancelled", "unavailable", "interrupted", "completed"];
const REPORTED_STATUSES = new Set(["completed", "interrupted", "cancelled", "failed", "unavailable"]);

function sortRuns(runs) {
  return [...runs].sort((a, b) => (clientTime(a.record.occurredAtClient) ?? a.receivedAt ?? 0) - (clientTime(b.record.occurredAtClient) ?? b.receivedAt ?? 0)
    || (a.receivedAt ?? 0) - (b.receivedAt ?? 0) || a.record.processingRunId.localeCompare(b.record.processingRunId));
}

// ---------------------------------------------------------------------------
// Compaction: canonical facts of one attempt -> compact samples.

function compactRun(fact, attemptId, indexFacts) {
  const record = fact.record, body = record.body;
  const byStage = new Map();
  for (const stage of body.stages) {
    if (!ENTERED(stage.status)) continue;
    const previous = byStage.get(stage.stageId);
    if (!previous || STATUS_PRIORITY.indexOf(stage.status) < STATUS_PRIORITY.indexOf(previous)) byStage.set(stage.stageId, stage.status);
  }
  // Inner (nested-operation) call time per (stage, parent), summed over the
  // run's passes. It overlaps its parent main phase and is reported only as
  // cumulative call time, never stacked (plan 07 §3).
  const inner = new Map();
  for (const stage of body.stages) {
    if (stage.timingKind !== "nestedOperation" || !ENTERED(stage.status)) continue;
    const id = `${stage.stageId}|${stage.parentStageId ?? ""}`;
    const entry = inner.get(id) ?? { stageId: stage.stageId, parentStageId: stage.parentStageId ?? null, ms: 0, calls: 0, measured: true };
    if (finiteOrNull(stage.elapsedMs) === null) entry.measured = false;
    else entry.ms += stage.elapsedMs;
    entry.calls += stage.invocationCount;
    inner.set(id, entry);
  }
  let lastStage = null;
  if (body.outcome === "interruptedUnknown" || body.outcome === "cancelled") {
    const reported = body.stages.filter((stage) => REPORTED_STATUSES.has(stage.status));
    lastStage = reported.at(-1)?.stageId ?? null;
    if (!lastStage && indexFacts?.latestRunId === record.processingRunId) lastStage = indexFacts.lastStage;
  }
  const processingMs = finiteOrNull(body.totals.processingMs);
  return {
    kind: "run",
    attemptId,
    runId: record.processingRunId,
    retryOf: record.retryOfRunId,
    executor: record.executorInstallId,
    launch: record.executionLaunchId,
    executionBuild: buildRef(record.executorPlatform),
    executionMachine: machineRef(record.executorPlatform),
    mode: record.processingMode,
    outcome: body.outcome,
    ms: processingMs,
    msMissing: processingMs === null ? missingReason(record, "/totals/processingMs") : null,
    journalMs: finiteOrNull(body.totals.journalFinalizeMs),
    failure: body.failure ? { stage: body.failure.stage, code: body.failure.code, layer: body.failure.layer } : null,
    cancellationReason: body.cancellationReason,
    stages: [...byStage],
    lastStage,
    inner: [...inner.values()].map((entry) => [entry.stageId, entry.parentStageId, entry.measured ? entry.ms : null, entry.calls]),
    occurredAt: clientTime(record.occurredAtClient),
    clock: fact.clock,
    receivedAt: fact.receivedAt,
    updatedAt: fact.updatedAt,
    dropped: record.droppedDetailCount,
  };
}

function compactGroup(fact, attemptId, transfers) {
  const record = fact.record, body = record.body;
  const queueWait = finiteOrNull(body.queueWaitMs), cloudSave = finiteOrNull(body.cloudSaveMs);
  const networks = [...new Set(transfers.filter((t) => t.record.body.groupId === body.groupId).map((t) => t.record.body.networkInterface))].sort();
  return {
    kind: "group",
    attemptId,
    groupId: body.groupId,
    category: body.category,
    jobState: body.jobState,
    executor: record.executorInstallId,
    queueWait,
    queueWaitMissing: queueWait === null ? missingReason(record, "/queueWaitMs") : null,
    backoff: finiteOrNull(body.knownBackoffMs),
    cloudSave,
    cloudSaveMissing: cloudSave === null ? missingReason(record, "/cloudSaveMs") : null,
    objects: body.uniqueObjectCount,
    bytes: body.uniqueObjectBytes,
    transferAttempts: body.transferAttemptCount,
    transfersSucceeded: body.successfulTransferCount,
    transfersFailed: body.failedTransferCount,
    retries: body.lifetimeRetryCount,
    ack: body.requiredCommitAcknowledged,
    firestoreMs: finiteOrNull(body.firestoreWriteMs),
    networks,
    occurredAt: clientTime(record.occurredAtClient),
    clock: fact.clock,
    receivedAt: fact.receivedAt,
    updatedAt: fact.updatedAt,
    dropped: record.droppedDetailCount,
  };
}

// Transfer facts live 30 days, partitions up to 90 (F3). A transfer first
// received before the retention cutoff is never compacted, and reports drop
// any older tuple at read time, so upload numbers do not depend on when a
// partition was last rebuilt or whether TTL has deleted the fact yet.
const beyondRetention = (receivedAt, nowMillis) => nowMillis !== undefined && receivedAt !== null && receivedAt < nowMillis - TRANSFER_RETENTION_MS;
function compactTransfer(fact, attemptId) {
  const record = fact.record, body = record.body;
  return {
    kind: "transfer",
    attemptId,
    // First two separators (contract.groupParts): a v1.2 system group id
    // system:<category>:<originInstallId> never yields its install as the category.
    category: contract.groupParts(body.groupId).category,
    executor: record.executorInstallId,
    outcome: body.outcome,
    bytes: body.payloadBytes,
    ms: finiteOrNull(body.invocationElapsedMs),
    net: body.networkInterface,
    queueWait: finiteOrNull(body.queueWaitMs),
    backoff: finiteOrNull(body.knownBackoffMs),
    receivedAt: fact.receivedAt,
  };
}

// Where an attempt belongs. `receivedAt` is the attempt fact's first receipt,
// or the earliest receipt among its facts while the summary is pending.
function placement({ summary, origin, captureAt, dateUncertain, receivedAt }, fallbackMillis) {
  const installKey = summary && origin ? origin : UNKNOWN_INSTALL;
  const dayKey = summary && !dateUncertain && captureAt !== null
    ? utcDay(captureAt) : `u-${utcDay(receivedAt ?? fallbackMillis)}`;
  return { key: `${dayKey}~${installKey}`, dayKey, installKey };
}
function attemptPlacementFields(attemptFact, otherFacts) {
  if (attemptFact) {
    const record = attemptFact.record;
    const captureAt = clientTime(record.captureOccurredAtClient);
    const dateUncertain = captureAt === null || attemptFact.clock !== "reliable"
      || (attemptFact.receivedAt !== null && captureAt > attemptFact.receivedAt + FUTURE_TOLERANCE_MS);
    return { summary: true, origin: record.originInstallId, captureAt, dateUncertain, receivedAt: attemptFact.receivedAt };
  }
  const receipts = otherFacts.map((fact) => fact.receivedAt).filter((value) => value !== null);
  return { summary: false, origin: null, captureAt: null, dateUncertain: true, receivedAt: receipts.length ? Math.min(...receipts) : null };
}

// facts: { attemptId, attempt, runs[], groups[], transfers[], overLimit? } as
// stored docs, index: processingAttempts/{attemptId} or null. Returns null when
// no usable field-origin fact exists (evaluation-only or expired). An attempt
// whose facts exceed the per-attempt limits (overLimit, F1) yields only its
// attempt sample, flagged excludedOverLimit: reports count it and leave it out.
// nowMillis (the rebuild time) drops transfers beyond retention (F3).
function compactAttempt({ attemptId, attempt: attemptDoc, runs: runDocs = [], groups: groupDocs = [], transfers: transferDocs = [], index = null, overLimit = null },
  fallbackMillis = 0, { nowMillis } = {}) {
  let skipped = 0;
  const take = (doc, kind) => {
    const fact = usableFact(doc, kind);
    if (!fact) { if (doc && !isEvaluationFact(doc)) skipped++; return null; }
    return fact.record.attemptId === attemptId ? fact : null;
  };
  const attempt = take(attemptDoc, "attemptSummary");
  const runs = sortRuns(runDocs.map((doc) => take(doc, "runSummary")).filter(Boolean));
  const groups = groupDocs.map((doc) => take(doc, "uploadGroupSummary")).filter(Boolean);
  const receivedTransfers = transferDocs.map((doc) => take(doc, "transferInvocation")).filter(Boolean);
  const transfers = receivedTransfers.filter((fact) => !beyondRetention(fact.receivedAt, nowMillis));
  if (!attempt && !runs.length && !groups.length && !receivedTransfers.length && !overLimit) return null;
  const indexFacts = index && index.schemaVersion === 2 && index.attemptId === attemptId ? {
    drillType: DRILLS.includes(index.drillType) ? index.drillType : null,
    build: index.build ?? null,
    latestRunId: index.latestRunId ?? null,
    lastStage: typeof index.lastStage === "string" && index.lastStage && index.lastStage !== "unknown" ? index.lastStage : null,
  } : null;
  const record = attempt?.record ?? null, body = record?.body ?? null;
  // Placement uses every received fact (as the change scanner does), so an
  // expired transfer never moves an attempt.
  const place = attemptPlacementFields(attempt, [...runs, ...groups, ...receivedTransfers]);
  const runSamples = runs.map((fact) => compactRun(fact, attemptId, indexFacts));
  const runById = new Map(runSamples.map((run) => [run.runId, run]));

  // Time to result and its main-phase allocation belong to the origin launch;
  // runs in another launch make the span cross-launch (null), and debug review
  // runs are not part of it.
  const counted = runs.filter((fact) => record && fact.record.executionLaunchId && fact.record.executionLaunchId === record.originLaunchId
    && fact.record.processingMode !== "debugReview");
  const timeToResult = body ? finiteOrNull(body.spans.timeToResultMs) : null;
  let phases = null;
  if (body && timeToResult !== null && runs.length >= body.runCount) {
    const totals = Object.fromEntries(PHASES.map((phase) => [phase, null]));
    let complete = true;
    for (const stage of [...body.stages, ...counted.flatMap((fact) => fact.record.body.stages)]) {
      if (stage.timingKind !== "mainPhase" || !ENTERED(stage.status)) continue;
      const phase = phaseOf(stage.stageId);
      if (!phase) continue;
      if (finiteOrNull(stage.elapsedMs) === null) { complete = false; continue; }
      totals[phase] = (totals[phase] ?? 0) + stage.elapsedMs;
    }
    if (complete) phases = totals;
  }
  const acceptedRun = body?.acceptedRunId ? runById.get(body.acceptedRunId) : null;
  const firstRunValid = body?.measurementVerdict === "valid"
    && (acceptedRun ? acceptedRun.retryOf === null : body.runCount <= 1);
  const latestRun = acceptedRun ?? runSamples.at(-1) ?? null;
  const notCollected = Boolean(record) && (["/spans/timeToResultMs", "/spans/readyForNextRepMs", ""]
    .some((field) => record.missingReasons.some((entry) => entry.field === field && entry.reason === "notCollectedByThisVersion")));
  const readyForNextRep = body ? finiteOrNull(body.spans.readyForNextRepMs) : null;
  const saveConfirmed = body ? finiteOrNull(body.spans.saveConfirmedAfterRecordingMs) : null;
  const facts = [attempt, ...runs, ...groups, ...transfers].filter(Boolean);
  const updates = facts.map((fact) => fact.updatedAt).filter((value) => value !== null);
  const attemptSample = {
    kind: "attempt",
    attemptId,
    summary: Boolean(attempt),
    skipped,
    origin: place.summary ? place.origin : null,
    drill: record?.drillType ?? indexFacts?.drillType ?? null,
    mode: record?.recordingMode ?? null,
    repId: record?.repId ?? null,
    captureBuild: buildRef(record?.originPlatform) ?? indexBuildRef(indexFacts?.build),
    captureMachine: machineRef(record?.originPlatform),
    captureAt: place.captureAt,
    clock: attempt ? attempt.clock : "unavailable",
    dateUncertain: place.dateUncertain,
    receivedAt: place.receivedAt,
    updatedAt: updates.length ? Math.max(...updates) : null,
    completeness: record?.completeness ?? "pending",
    notCollected,
    dropped: facts.reduce((sum, fact) => sum + (fact.record.droppedDetailCount || 0), 0),
    verdict: body?.measurementVerdict ?? "pending",
    verdictReason: body?.verdictReason ?? null,
    firstRunValid,
    accepted: Boolean(body) && (body.acceptedRunId !== null || body.measurementVerdict === "valid"),
    timeToResult,
    timeToResultMissing: body && timeToResult === null ? missingReason(record, "/spans/timeToResultMs") : null,
    readyForNextRep,
    readyForNextRepMissing: body && readyForNextRep === null ? missingReason(record, "/spans/readyForNextRepMs") : null,
    saveConfirmed,
    saveConfirmedMissing: body && saveConfirmed === null ? missingReason(record, "/spans/saveConfirmedAfterRecordingMs") : null,
    phases,
    requiredSave: body?.requiredSaveState ?? null,
    sidecar: body?.sidecarState ?? null,
    archive: body?.archiveState ?? null,
    runCount: body ? body.runCount : runs.length,
    runsReceived: runs.length,
    acceptedRunId: body?.acceptedRunId ?? null,
    executor: latestRun?.executor ?? null,
    preAdmission: body?.preAdmissionFailure
      ? { stage: body.preAdmissionFailure.stage, code: body.preAdmissionFailure.failureCode, layer: body.preAdmissionFailure.failureLayer } : null,
    indexLastStage: indexFacts?.lastStage ?? null,
    transfersBeyondRetention: receivedTransfers.length - transfers.length,
    // { runs, groups, transfers } counts when over the per-attempt limits.
    excludedOverLimit: overLimit,
  };
  const samples = overLimit ? [attemptSample] : [
    attemptSample,
    ...runSamples,
    ...groups.map((fact) => compactGroup(fact, attemptId, transfers)),
    ...transfers.map((fact) => compactTransfer(fact, attemptId)),
  ];
  return { attempt: attemptSample, samples, placement: placement(place, fallbackMillis), overLimit };
}

// ---------------------------------------------------------------------------
// The projection service.

// Partitions are day x install, so a narrower range or a single device reduces
// what a report reads; a drill filter does not (review F4).
function narrowRange(HttpsError, bound, limit, extra = {}) {
  const details = { errorCode: "narrowRange", bound, ...extra };
  // The admin UI prints details.limit as a measurement count, so only the
  // sample bound carries it.
  if (bound === "samples") details.limit = limit;
  else details.max = limit;
  return new HttpsError("resource-exhausted", "This report is too large to compute exactly. Narrow the date range or choose a device. No partial total was returned.", details);
}
function rebuilding(HttpsError) {
  return new HttpsError("unavailable", "The report is being updated with newly received facts. Retry to continue; each retry advances the update.",
    { errorCode: "projectionRebuilding" });
}

function createDevicePerformanceProjection({ db, HttpsError, FieldValue, Timestamp, now = () => Date.now(), limits: overrides = {}, logger = console, hooks = {} }) {
  const limits = { ...LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in LIMITS) || !Number.isFinite(value) || value <= 0 || value > LIMITS[key]) throw new Error(`Invalid device performance limit ${key}`);
    limits[key] = value;
  }
  const root = db.collection(PROJECTION_ROOT).doc(PROJECTION_DOC);
  const partitions = root.collection(COLLECTIONS.partitions);
  const pages = root.collection(COLLECTIONS.pages);
  const locators = root.collection(COLLECTIONS.locators);
  const factRoot = (kind) => db.collection(contract.ROOTS[kind]);
  const bounded = async (query, maximum, bound) => {
    try { return await completeQuery(query, maximum, HttpsError); } catch (error) {
      if (error?.code === "resource-exhausted") throw narrowRange(HttpsError, bound, maximum);
      throw error;
    }
  };

  // -- Canonical facts of one attempt.
  async function readCanonical(attemptId, { withIndex = true } = {}) {
    const [attempt, runs, groups, transfers, index] = await Promise.all([
      factRoot("attemptSummary").doc(`attemptSummary:${attemptId}`).get(),
      bounded(factRoot("runSummary").where("attemptId", "==", attemptId), limits.maxRunsPerAttempt * 2, "attemptRuns"),
      bounded(factRoot("uploadGroupSummary").where("attemptId", "==", attemptId), limits.maxGroupsPerAttempt, "attemptGroups"),
      bounded(factRoot("transferInvocation").where("attemptId", "==", attemptId), limits.maxTransfersPerAttempt, "attemptTransfers"),
      withIndex ? db.doc(`processingAttempts/${attemptId}`).get() : null,
    ]);
    return {
      attemptId,
      attempt: attempt.exists ? attempt.data() : null,
      runs: runs.map((doc) => doc.data()),
      groups: groups.map((doc) => doc.data()),
      transfers: transfers.map((doc) => doc.data()),
      index: index?.exists ? index.data() : null,
    };
  }

  // The facts a rebuild compacts for one attempt (F1, F2). Fact counts are
  // aggregated first: an attempt over any per-attempt limit is never read in
  // full, only its summary and index (for its counted, excluded sample).
  // Transfers are read as a field projection of the compacted fields.
  async function readForCompaction(attemptId) {
    const byAttempt = (kind) => factRoot(kind).where("attemptId", "==", attemptId);
    const [attempt, index, runCount, groupCount, transferCount] = await Promise.all([
      factRoot("attemptSummary").doc(`attemptSummary:${attemptId}`).get(),
      db.doc(`processingAttempts/${attemptId}`).get(),
      ...["runSummary", "uploadGroupSummary", "transferInvocation"].map(async (kind) => (await byAttempt(kind).count().get()).data().count),
    ]);
    const base = { attemptId, attempt: attempt.exists ? attempt.data() : null, index: index.exists ? index.data() : null };
    const maxRuns = limits.maxRunsPerAttempt * 2;
    if (runCount > maxRuns || groupCount > limits.maxGroupsPerAttempt || transferCount > limits.maxTransfersPerAttempt) {
      return { ...base, overLimit: { runs: runCount, groups: groupCount, transfers: transferCount } };
    }
    try {
      const [runs, groups, transfers] = await Promise.all([
        completeQuery(byAttempt("runSummary"), maxRuns, HttpsError),
        completeQuery(byAttempt("uploadGroupSummary"), limits.maxGroupsPerAttempt, HttpsError),
        completeQuery(byAttempt("transferInvocation").select(...TRANSFER_FIELDS), limits.maxTransfersPerAttempt, HttpsError),
      ]);
      return { ...base, runs: runs.map((doc) => doc.data()), groups: groups.map((doc) => doc.data()), transfers: transfers.map((doc) => doc.data()) };
    } catch (error) {
      // Facts arrived between the count and the read and crossed a limit.
      if (error?.code !== "resource-exhausted") throw error;
      return { ...base, overLimit: { runs: runCount, groups: groupCount, transfers: transferCount, grewDuringRead: true } };
    }
  }

  // -- Invalidation.
  async function markDirty(marks) {
    let batch = db.batch(), count = 0;
    for (const [key, mark] of marks) {
      const fields = {
        key, dayKey: mark.dayKey, installKey: mark.installKey, dirty: true, token: randomUUID(), dirtyAtMillis: now(),
        // Selected by every receipt-time query until rebuilt with exact bounds.
        minReceiptMillis: 0, maxReceiptMillis: Number.MAX_SAFE_INTEGER,
      };
      // A new executor must be selectable by a "Processed or uploaded here"
      // query before the rebuild publishes the exact set.
      if (mark.executors.size) fields.executorInstalls = FieldValue.arrayUnion(...mark.executors);
      batch.set(partitions.doc(key), fields, { merge: true });
      if (++count === limits.batchOperations) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count) await batch.commit();
  }
  const addMark = (marks, where, executors) => {
    if (!marks.has(where.key)) marks.set(where.key, { dayKey: where.dayKey, installKey: where.installKey, executors: new Set() });
    for (const executor of executors) if (executor) marks.get(where.key).executors.add(executor);
  };

  // Recompute an attempt's partition from its canonical facts and move its
  // locator in one transaction, so concurrent scans cannot interleave.
  async function locate(attemptId, fallbackMillis) {
    return db.runTransaction(async (tx) => {
      const locatorRef = locators.doc(attemptId);
      const [locator, attemptDoc] = await Promise.all([tx.get(locatorRef), tx.get(factRoot("attemptSummary").doc(`attemptSummary:${attemptId}`))]);
      const attempt = usableFact(attemptDoc.exists ? attemptDoc.data() : null, "attemptSummary");
      let others = [];
      if (!attempt) {
        // Only what placement needs (F2): usability and first receipt.
        const queries = ["runSummary", "uploadGroupSummary", "transferInvocation"]
          .map((kind) => tx.get(factRoot(kind).where("attemptId", "==", attemptId)
            .select("storageVersion", "firstReceivedAtServer", "record.performanceSchemaVersion", "record.recordKind", "record.origin")
            .limit(limits.maxTransfersPerAttempt)));
        others = (await Promise.all(queries)).flatMap((result, index) => result.docs
          .map((doc) => usableFact(doc.data(), ["runSummary", "uploadGroupSummary", "transferInvocation"][index])).filter(Boolean));
      }
      const where = placement(attemptPlacementFields(attempt, others), fallbackMillis);
      const previous = locator.exists ? locator.data().partitionKey : null;
      if (previous !== where.key) {
        tx.set(locatorRef, { attemptId, partitionKey: where.key, dayKey: where.dayKey, installKey: where.installKey, locatedAtMillis: now() });
      }
      const old = previous && previous !== where.key ? locator.data() : null;
      return { where, previous: old ? { key: old.partitionKey, dayKey: old.dayKey, installKey: old.installKey } : null };
    });
  }

  async function scanChanges({ deadline }) {
    let processed = 0;
    for (const [name, collection] of SCANNED_ROOTS) {
      while (true) {
        if (now() > deadline || processed >= limits.scanMaxPerCall) return { drained: false, processed };
        const cursor = (await root.get()).data()?.scan?.[name] ?? null;
        let query = db.collection(collection).orderBy("updatedAtServer").orderBy("__name__");
        if (cursor) query = query.startAfter(cursor.time, cursor.id);
        const page = await query.limit(limits.scanPageSize).get();
        if (page.empty) break;
        const changes = new Map();
        for (const doc of page.docs) {
          const data = doc.data();
          // System upload groups and device status are not attempt partitions.
          if (typeof data.attemptId !== "string") continue;
          const change = changes.get(data.attemptId) ?? { executors: new Set(), receipt: Infinity };
          if (typeof data.executorInstallId === "string") change.executors.add(data.executorInstallId);
          change.receipt = Math.min(change.receipt, millisOf(data.firstReceivedAtServer) ?? Infinity);
          changes.set(data.attemptId, change);
        }
        const marks = new Map();
        await mapBounded([...changes], limits.attemptReadConcurrency, async ([attemptId, change]) => {
          const { where, previous } = await locate(attemptId, Number.isFinite(change.receipt) ? change.receipt : now());
          addMark(marks, where, change.executors);
          if (previous) addMark(marks, previous, []);
        });
        await markDirty(marks);
        // Advance only after every mark is durable; never move backwards.
        const last = page.docs.at(-1);
        const next = { time: last.data().updatedAtServer, id: last.id };
        await db.runTransaction(async (tx) => {
          const state = (await tx.get(root)).data() || {};
          const current = state.scan?.[name];
          if (current && (timeOrder(current.time) > timeOrder(next.time)
            || (timeOrder(current.time) === timeOrder(next.time) && current.id >= next.id))) return;
          tx.set(root, { version: PROJECTION_VERSION, scan: { ...(state.scan || {}), [name]: next }, scannedAtMillis: now() }, { merge: true });
        });
        processed += page.size;
        if (page.size < limits.scanPageSize) break;
      }
    }
    return { drained: true, processed };
  }

  // -- Publication.
  function splitPages(samples) {
    const result = [];
    let rows = [], bytes = 2;
    for (const sample of samples) {
      const size = byteLength(sample);
      if (size + 2 > limits.maxPageBytes) throw new Error("A compact sample exceeds the projection page bound.");
      if (rows.length && bytes + size + 1 > limits.maxPageBytes) { result.push(rows); rows = []; bytes = 2; }
      rows.push(sample);
      bytes += size + (rows.length > 1 ? 1 : 0);
    }
    if (rows.length) result.push(rows);
    return result;
  }

  async function deletePages(ids) {
    for (let offset = 0; offset < ids.length; offset += limits.batchOperations) {
      const batch = db.batch();
      for (const id of ids.slice(offset, offset + limits.batchOperations)) batch.delete(pages.doc(id));
      await batch.commit();
    }
  }

  // Write immutable pages, then publish them only if the partition token is
  // unchanged since `token` was read (before any fact was read).
  async function writeGeneration(key, where, token, samples, startedAtMillis) {
    const generationId = randomUUID();
    const chunks = splitPages(samples);
    const written = [];
    const createdAtMillis = now();
    try {
      let batch = db.batch(), operations = 0, batchBytes = 0;
      for (const [ordinal, rows] of chunks.entries()) {
        const id = `${key}_${generationId}_${ordinal}`;
        const bytes = byteLength(rows);
        if (operations && (operations >= limits.batchOperations || batchBytes + bytes > limits.batchBytes)) {
          await batch.commit(); batch = db.batch(); operations = 0; batchBytes = 0;
        }
        batch.set(pages.doc(id), {
          version: PROJECTION_VERSION, partitionKey: key, generationId, ordinal, rowCount: rows.length, bytes, createdAtMillis,
          expiresAt: Timestamp ? Timestamp.fromMillis(createdAtMillis + limits.pageRetentionMs) : null, rows,
        });
        written.push({ id, rows: rows.length, bytes });
        operations++; batchBytes += bytes;
      }
      if (operations) await batch.commit();
    } catch (error) {
      // A partial write is never referenced; remove what landed.
      await deletePages(written.map((page) => page.id)).catch(() => {});
      throw error;
    }
    const attempts = samples.filter((sample) => sample.kind === "attempt");
    const receipts = attempts.map((sample) => sample.receivedAt).filter((value) => value !== null);
    const executors = [...new Set(samples.filter((sample) => sample.kind !== "attempt").map((sample) => sample.executor).filter(Boolean))].sort();
    const updates = attempts.map((sample) => sample.updatedAt).filter((value) => value !== null);
    const generation = {
      // The token read before any fact was read (F7: currency is a token match).
      id: generationId, version: PROJECTION_VERSION, token, pages: written, samples: samples.length,
      bytes: written.reduce((sum, page) => sum + page.bytes, 0), attempts: attempts.length,
      startedAtMillis, publishedAtMillis: null,
      sourceUpdatedAtMillis: updates.length ? Math.max(...updates) : null,
      minReceiptMillis: receipts.length ? Math.min(...receipts) : null,
      maxReceiptMillis: receipts.length ? Math.max(...receipts) : null,
    };
    if (hooks.beforePublish) await hooks.beforePublish(key);
    const published = await db.runTransaction(async (tx) => {
      const ref = partitions.doc(key);
      const fresh = await tx.get(ref);
      const data = fresh.exists ? fresh.data() : null;
      if ((data?.token ?? null) !== token) return null;
      const publishedAtMillis = now();
      const previous = data?.generation;
      const retired = [...(data?.retired || [])];
      if (previous?.id) retired.push({ id: previous.id, pages: (previous.pages || []).map((page) => page.id), retiredAtMillis: publishedAtMillis });
      const next = {
        key, dayKey: where.dayKey, installKey: where.installKey, version: PROJECTION_VERSION, dirty: false, token,
        dirtyAtMillis: data?.dirtyAtMillis ?? null,
        executorInstalls: executors,
        minReceiptMillis: generation.minReceiptMillis ?? Number.MAX_SAFE_INTEGER,
        maxReceiptMillis: generation.maxReceiptMillis ?? 0,
        generation: { ...generation, publishedAtMillis },
        retired: retired.slice(-limits.maxRetired),
      };
      tx.set(ref, next);
      return next;
    });
    if (!published) {
      await deletePages(written.map((page) => page.id)).catch((error) => logger.warn?.("device performance page cleanup failed", { key, message: error?.message }));
      return null;
    }
    await cleanup(key).catch((error) => logger.warn?.("device performance cleanup failed", { key, message: error?.message }));
    return published;
  }

  // Delete pages of generations retired longer ago than any read can last, and
  // unreferenced pages (a crashed rebuild) older than the orphan grace.
  async function cleanup(key) {
    const ref = partitions.doc(key);
    const manifest = (await ref.get()).data();
    if (!manifest) return;
    const cutoff = now() - limits.retiredGraceMs;
    const expired = (manifest.retired || []).filter((entry) => entry.retiredAtMillis < cutoff);
    if (expired.length) {
      await deletePages(expired.flatMap((entry) => entry.pages));
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(ref)).data();
        if (!fresh) return;
        const gone = new Set(expired.map((entry) => entry.id));
        tx.set(ref, { ...fresh, retired: (fresh.retired || []).filter((entry) => !gone.has(entry.id)) });
      });
    }
    const referenced = new Set([manifest.generation?.id, ...(manifest.retired || []).map((entry) => entry.id)].filter(Boolean));
    const listed = await completeQuery(pages.where("partitionKey", "==", key).select("generationId", "createdAtMillis"), 10000, HttpsError);
    const orphans = listed.filter((doc) => !referenced.has(doc.data().generationId) && doc.data().createdAtMillis < now() - limits.orphanGraceMs);
    if (orphans.length) await deletePages(orphans.map((doc) => doc.id));
  }

  // Move an attempt whose canonical partition changed after its locator was
  // read. The target is marked dirty; this partition's own token is untouched
  // (it is being rebuilt without the attempt).
  async function relocate(moves, fromKey) {
    const marks = new Map();
    for (const [attemptId, where, executors] of moves) {
      await db.runTransaction(async (tx) => {
        const ref = locators.doc(attemptId);
        const locator = await tx.get(ref);
        if (locator.exists && locator.data().partitionKey !== fromKey) return;
        tx.set(ref, { attemptId, partitionKey: where.key, dayKey: where.dayKey, installKey: where.installKey, locatedAtMillis: now() });
      });
      addMark(marks, where, executors);
    }
    await markDirty(marks);
  }

  async function rebuildPartition(key) {
    const manifest = (await partitions.doc(key).get()).data();
    if (!manifest) return null;
    const token = manifest.token ?? null;
    const startedAtMillis = now();
    const where = { dayKey: manifest.dayKey, installKey: manifest.installKey };
    // A partition over its attempt limit publishes an overflow generation; a
    // report that selects it fails with a typed narrowRange naming it (F1).
    const memberQuery = locators.where("partitionKey", "==", key);
    const memberCount = (await memberQuery.count().get()).data().count;
    if (memberCount > limits.maxPartitionAttempts) return writeOverflow(key, where, token, memberCount, startedAtMillis);
    let members;
    try { members = await completeQuery(memberQuery, limits.maxPartitionAttempts, HttpsError); } catch (error) {
      if (error?.code !== "resource-exhausted") throw error;
      return writeOverflow(key, where, token, limits.maxPartitionAttempts + 1, startedAtMillis);
    }
    // Each attempt is compacted inside the bounded read, so at most
    // attemptReadConcurrency raw bundles are alive at once (F2).
    const compacted = await mapBounded(members, limits.attemptReadConcurrency, async (doc) => {
      const bundle = await readForCompaction(doc.id);
      const compact = compactAttempt(bundle, millisOf(doc.data().locatedAtMillis) ?? startedAtMillis, { nowMillis: startedAtMillis });
      return compact && { attemptId: doc.id, compact };
    });
    const samples = [], moves = [];
    for (const entry of compacted) {
      if (!entry) continue;
      const { attemptId, compact } = entry;
      // An over-limit attempt without a summary was not read in full, so its
      // earliest receipt is unknown: it stays where the scanner placed it.
      const stays = compact.overLimit && !compact.attempt.summary;
      if (!stays && compact.placement.key !== key) {
        moves.push([attemptId, compact.placement, compact.samples.filter((s) => s.kind !== "attempt").map((s) => s.executor)]);
        continue;
      }
      samples.push(...compact.samples);
    }
    if (moves.length) await relocate(moves, key);
    return writeGeneration(key, where, token, samples, startedAtMillis);
  }

  // Publish a generation that records only that the partition is over its
  // attempt limit (token-checked like any generation).
  async function writeOverflow(key, where, token, attempts, startedAtMillis) {
    return db.runTransaction(async (tx) => {
      const ref = partitions.doc(key);
      const data = (await tx.get(ref)).data() ?? null;
      if ((data?.token ?? null) !== token) return null;
      const publishedAtMillis = now();
      const previous = data?.generation;
      const retired = [...(data?.retired || [])];
      if (previous?.id) retired.push({ id: previous.id, pages: (previous.pages || []).map((page) => page.id), retiredAtMillis: publishedAtMillis });
      // Receipt-time selection: an uncertain partition's receipts are its own
      // day; a capture day's receipts are that day or later.
      const dayStart = Date.parse(`${where.dayKey.replace(/^u-/, "")}T00:00:00.000Z`);
      const next = {
        key, dayKey: where.dayKey, installKey: where.installKey, version: PROJECTION_VERSION, dirty: false, token,
        dirtyAtMillis: data?.dirtyAtMillis ?? null, executorInstalls: data?.executorInstalls ?? [],
        minReceiptMillis: dayStart, maxReceiptMillis: where.dayKey.startsWith("u-") ? dayStart + DAY_MS - 1 : Number.MAX_SAFE_INTEGER,
        generation: {
          id: randomUUID(), version: PROJECTION_VERSION, token, overflow: { attempts, limit: limits.maxPartitionAttempts },
          pages: [], samples: 0, bytes: 0, attempts: 0, startedAtMillis, publishedAtMillis,
          sourceUpdatedAtMillis: null, minReceiptMillis: null, maxReceiptMillis: null,
        },
        retired: retired.slice(-limits.maxRetired),
      };
      tx.set(ref, next);
      return next;
    });
  }

  // For the retention sweep (RELEASE GATE, F3): before or after deleting any
  // fact of these attempts, mark their partitions dirty so no published
  // generation keeps samples of deleted facts.
  async function invalidateAttempts(attemptIds) {
    const marks = new Map();
    for (let offset = 0; offset < attemptIds.length; offset += 30) {
      const ids = attemptIds.slice(offset, offset + 30);
      const docs = await Promise.all(ids.map((id) => locators.doc(id).get()));
      for (const doc of docs) {
        if (!doc.exists) continue;
        const { partitionKey, dayKey, installKey } = doc.data();
        addMark(marks, { key: partitionKey, dayKey, installKey }, []);
      }
    }
    await markDirty(marks);
    return [...marks.keys()];
  }

  // -- Selection and bounded reading.
  async function rangeQuery(base, field, lower, upper) {
    const result = [];
    let cursor = null;
    while (true) {
      let query = base.where(field, ">=", lower);
      if (upper !== undefined) query = query.where(field, "<=", upper);
      query = query.orderBy(field).orderBy("__name__");
      if (cursor) query = query.startAfter(cursor.value, cursor.id);
      const page = await query.limit(500).get();
      result.push(...page.docs);
      if (result.length > limits.maxPartitions) throw narrowRange(HttpsError, "partitions", limits.maxPartitions);
      if (page.size < 500) return result;
      const last = page.docs.at(-1);
      cursor = { value: last.data()[field], id: last.id };
    }
  }

  // spec: { basis: "capture"|"serverReceipt", startMillis, endMillis, installKey?, executorInstall? }
  // installKey selects the install's own captures; executorInstall selects its
  // captures plus every partition where it executed a run, group or transfer.
  async function selectPartitions(spec) {
    const bases = [];
    if (spec.installKey) bases.push(partitions.where("installKey", "==", spec.installKey));
    else if (spec.executorInstall) {
      bases.push(partitions.where("installKey", "==", spec.executorInstall), partitions.where("executorInstalls", "array-contains", spec.executorInstall));
    } else bases.push(partitions);
    const firstDay = utcDay(spec.startMillis), lastDay = utcDay(spec.endMillis - 1);
    const found = new Map();
    for (const base of bases) {
      let docs;
      if (spec.basis === "serverReceipt") {
        docs = (await rangeQuery(base, "maxReceiptMillis", spec.startMillis)).filter((doc) => doc.data().minReceiptMillis < spec.endMillis);
      } else {
        // Dated partitions by capture day, plus date-uncertain partitions by
        // receipt day (counted, never placed in a dated trend).
        const [dated, uncertain] = await Promise.all([
          rangeQuery(base, "dayKey", firstDay, lastDay),
          rangeQuery(base, "dayKey", `u-${firstDay}`, `u-${lastDay}`),
        ]);
        docs = [...dated, ...uncertain];
      }
      for (const doc of docs) found.set(doc.id, doc.data());
      if (found.size > limits.maxPartitions) throw narrowRange(HttpsError, "partitions", limits.maxPartitions);
    }
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  // A generation is current when it was built from the partition's current
  // token: every invalidation rotates the token, so a match means no fact was
  // marked after the build began. A generation this request published after
  // its own scan is also current for this request, even if a concurrent scan
  // has marked the partition again since (no livelock under steady traffic).
  // No clock of another instance is compared (F7).
  const usable = (manifest, own = new Map()) => Boolean(manifest.generation) && manifest.generation.version === PROJECTION_VERSION
    && ((manifest.generation.token ?? null) === (manifest.token ?? null) || own.get(manifest.key) === manifest.generation.id);

  // Bring every selected partition up to date with every fact the scan saw,
  // rebuilding at most what the deadline allows; otherwise refuse (retryable).
  async function refresh(spec, { deadline }) {
    let scanned;
    try { scanned = await scanChanges({ deadline }); } catch (error) {
      // Contention or a transient read failure: nothing was skipped (the
      // cursor advances only after its marks are durable), so a retry resumes.
      logger.error?.("device performance change scan failed", { message: error?.message });
      throw rebuilding(HttpsError);
    }
    if (!scanned.drained) throw rebuilding(HttpsError);
    let manifests = await selectPartitions(spec);
    const pending = manifests.filter((manifest) => !usable(manifest));
    const own = new Map();
    if (pending.length) {
      await mapBounded(pending, limits.rebuildConcurrency, async (manifest) => {
        if (now() > deadline) return;
        try {
          const published = await rebuildPartition(manifest.key);
          if (published?.generation) own.set(manifest.key, published.generation.id);
        } catch (error) {
          logger.error?.("device performance rebuild failed", { key: manifest.key, message: error?.message });
        }
      });
      manifests = await selectPartitions(spec);
      if (manifests.some((manifest) => !usable(manifest, own))) throw rebuilding(HttpsError);
    }
    return { manifests, scanned: scanned.processed };
  }

  // Declared totals are checked before any page is read; each page is
  // validated before it is retained; reading stops before the decoded total
  // passes the budget.
  async function loadSamples(manifests, { maxSamples = limits.maxSamples, maxDecodedBytes = limits.maxDecodedBytes } = {}) {
    const overflow = manifests.find((manifest) => manifest.generation.overflow);
    if (overflow) {
      throw narrowRange(HttpsError, "partitionAttempts", overflow.generation.overflow.limit,
        { partition: overflow.key, attempts: overflow.generation.overflow.attempts });
    }
    const declaredSamples = manifests.reduce((sum, manifest) => sum + manifest.generation.samples, 0);
    if (declaredSamples > maxSamples) throw narrowRange(HttpsError, "samples", maxSamples);
    const declaredBytes = manifests.reduce((sum, manifest) => sum + manifest.generation.bytes, 0);
    if (declaredBytes > maxDecodedBytes) throw narrowRange(HttpsError, "decodedBytes", maxDecodedBytes);
    const plan = manifests.flatMap((manifest) => manifest.generation.pages.map((page) => ({ ...page, key: manifest.key, generationId: manifest.generation.id })));
    let decoded = 0, reserved = 0, retainedSamples = 0;
    const chunks = await mapBounded(plan, limits.pageReadConcurrency, async (page) => {
      if (page.bytes > limits.maxPageBytes) throw new HttpsError("failed-precondition", "Invalid report page. Retry to rebuild.", { errorCode: "invalidPage" });
      if (reserved + page.bytes > maxDecodedBytes) throw narrowRange(HttpsError, "decodedBytes", maxDecodedBytes);
      reserved += page.bytes;
      const data = (await pages.doc(page.id).get()).data();
      if (!data || data.version !== PROJECTION_VERSION || data.generationId !== page.generationId || data.partitionKey !== page.key) {
        throw new HttpsError("aborted", "The report changed while it was read. Retry to refresh.", { errorCode: "staleGeneration" });
      }
      const rows = Array.isArray(data.rows) ? data.rows : null;
      const bytes = rows ? byteLength(rows) : Infinity;
      decoded += Number.isFinite(bytes) ? bytes : 0;
      if (!rows || rows.length !== page.rows || bytes !== page.bytes || bytes > limits.maxPageBytes) {
        throw new HttpsError("failed-precondition", "Invalid report page. Retry to rebuild.", { errorCode: "invalidPage" });
      }
      if (decoded > maxDecodedBytes) throw narrowRange(HttpsError, "decodedBytes", maxDecodedBytes);
      retainedSamples += rows.length;
      if (retainedSamples > maxSamples) throw narrowRange(HttpsError, "samples", maxSamples);
      return rows;
    });
    return { samples: chunks.flat(), decodedBytes: decoded, pagesRead: plan.length };
  }

  function projectionRevision(manifests) {
    const hash = createHash("sha256").update(JSON.stringify([PROJECTION_VERSION, manifests.map((manifest) => [manifest.key, manifest.generation.id])]));
    return `v${PROJECTION_VERSION}-${hash.digest("hex").slice(0, 32)}`;
  }

  // -- Device status (not partitioned; latest per install, D-18 merge).
  // v1.2 keys one status per install and account; the reports merge per
  // install. Client report times decide only when both reports carry one and
  // both clocks are reliable; otherwise, or on a tie, server receipt order
  // decides and the latest received revision wins (contract §8.6, v1.2.1).
  const reliableTime = (entry) => (entry.clock === "reliable" ? clientTime(entry.record.occurredAtClient) : null);
  function newerStatus(candidate, current) {
    const [a, b] = [reliableTime(candidate), reliableTime(current)];
    if (a !== null && b !== null && a !== b) return a > b;
    return (candidate.updatedAt ?? -Infinity) > (current.updatedAt ?? -Infinity);
  }
  async function readDeviceStatuses() {
    const docs = await bounded(factRoot("deviceStatus"), limits.maxDevices, "devices");
    const byInstall = new Map();
    for (const doc of docs) {
      const fact = usableFact(doc.data(), "deviceStatus");
      const install = fact?.record.executorInstallId;
      if (!install) continue;
      const entry = { record: fact.record, clock: fact.clock, updatedAt: fact.updatedAt, receivedAt: fact.receivedAt };
      const previous = byInstall.get(install);
      const firstReceivedAt = Math.min(previous?.firstReceivedAt ?? Infinity, fact.receivedAt ?? Infinity);
      const reporters = (previous?.reporters ?? 0) + 1;
      byInstall.set(install, !previous || newerStatus(entry, previous) ? { ...entry, firstReceivedAt, reporters } : { ...previous, firstReceivedAt, reporters });
    }
    return byInstall;
  }

  // Earliest first receipt and latest update across every fact root.
  async function collectionBounds() {
    const roots = Object.values(contract.ROOTS);
    const [first, last] = await Promise.all([
      Promise.all(roots.map((name) => db.collection(name).orderBy("firstReceivedAtServer").limit(1).get())),
      Promise.all(roots.map((name) => db.collection(name).orderBy("updatedAtServer", "desc").limit(1).get())),
    ]);
    const pick = (results, field) => results.map((result) => (result.docs[0] ? millisOf(result.docs[0].data()[field]) : null)).filter((value) => value !== null);
    const starts = pick(first, "firstReceivedAtServer"), updates = pick(last, "updatedAtServer");
    return { collectionStartedAtMillis: starts.length ? Math.min(...starts) : null, lastReportReceivedAtMillis: updates.length ? Math.max(...updates) : null };
  }

  // An install is known when any stored fact names it, as origin or executor
  // (top-level stored fields; independent of whether a projection exists yet).
  async function installKnown(installId) {
    const results = await Promise.all([
      factRoot("attemptSummary").where("originInstallId", "==", installId).limit(1).get(),
      ...["deviceStatus", "runSummary", "uploadGroupSummary", "transferInvocation"]
        .map((kind) => factRoot(kind).where("executorInstallId", "==", installId).limit(1).get()),
    ]);
    return results.some((result) => !result.empty);
  }

  return {
    limits, refresh, scanChanges, rebuildPartition, writeGeneration, selectPartitions, loadSamples, projectionRevision,
    readDeviceStatuses, collectionBounds, readCanonical, readForCompaction, installKnown, markDirty, invalidateAttempts, usable,
    refs: { root, partitions, pages, locators, labels: root.collection(COLLECTIONS.labels), labelAudit: root.collection(COLLECTIONS.labelAudit) },
  };
}

module.exports = {
  createDevicePerformanceProjection, compactAttempt, compactTransfer, placement, attemptPlacementFields, phaseOf, choiceKey, buildRef, millisOf,
  timeOrder, utcDay, narrowRange, rebuilding, usableFact,
  PROJECTION_VERSION, PROJECTION_ROOT, PROJECTION_DOC, COLLECTIONS, LIMITS, DRILLS, PHASES, UNKNOWN_INSTALL, FUTURE_TOLERANCE_MS,
  TRANSFER_RETENTION_MS, TRANSFER_FIELDS,
};
