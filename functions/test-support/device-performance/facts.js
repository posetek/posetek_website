"use strict";

// Builders for device-performance facts in tests. Every record starts from a
// canonical contract fixture (functions/contracts/device-performance-v1) and
// must pass the ingestion validator; stored documents use the exact shape
// device-performance-ingestion.js writes (T1.3a return §7).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const contract = require("../../device-performance-contract");
const { storageKey, STORAGE_VERSION } = require("../../device-performance-ingestion");
const { FakeFirestore, Timestamp, FieldValue, HttpsError } = require("./fake-firestore");
const { createDevicePerformanceReports } = require("../../device-performance");

const FIXTURES = path.join(__dirname, "..", "..", "contracts", "device-performance-v1", "fixtures");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
const hex = (n, width) => n.toString(16).padStart(width, "0").slice(-width);
// Deterministic lowercase UUIDs per namespace (a = attempt, r = run, i = install, t = transfer).
const NAMESPACE = { a: 0xa, r: 0xb, i: 0xc, t: 0xd, x: 0xe };
const uuid = (space, n) => `${hex(NAMESPACE[space], 1)}${hex(n, 7)}-0000-4000-8000-${hex(n, 12)}`;
const launch = (n) => `${hex(n, 8).toUpperCase()}-0000-4000-8000-${hex(n, 12).toUpperCase()}`;
const REPORTER = "uidReporter0001";
const ADMIN = Object.freeze({ uid: "adminUid0001", email: "ops@posetek.net", emailVerified: true, authTime: 1, isAnonymous: false });
const START = Date.parse("2026-09-29T20:00:00.000Z");
const DAY = 86400000;
const isoAt = (millis) => new Date(millis).toISOString();
const PASS = { jump: "jump", sprint: "sprint", broadJump: "broadJump", deadballShot: "kick", changeOfDirection: "cod", dribbling: "cod", freeRecord: "poseValidation" };

function stage(stageId, elapsedMs, extra = {}) {
  const nested = extra.parent !== undefined;
  return {
    stageId, parentStageId: nested ? extra.parent : null, passId: extra.passId ?? null, status: extra.status ?? "completed",
    invocationCount: extra.invocations ?? 1, elapsedMs, activeMs: elapsedMs, continuousElapsedMs: elapsedMs,
    timingKind: nested ? "nestedOperation" : "mainPhase", framesDecoded: null, modelCalls: null, missingObservations: null,
    failureCode: extra.failureCode ?? null, failureLayer: extra.failureLayer ?? null, lastDurableStage: null,
  };
}
const platform = (build = "212", machine = "iPhone15,2", appVersion = "1.4.0") => ({
  appVersion, build, sourceRevision: "7baf5a7", machine, osVersion: "Version 26.0 (Build 23A341)", configuration: "Release",
});
function reasons(entries) { return entries.map(([field, reason]) => ({ field, reason })); }
function checked(record) {
  const result = contract.validateRecord(record);
  assert.ok(result.ok, `${record.recordKind} builder produced an invalid record: ${result.errors.join("; ")}`);
  return record;
}

// Attempt summary. Times in milliseconds; null leaves the span missing with a
// reason (missing: [[pointer, reason]] adds explicit reasons).
function attemptSummary(o) {
  const record = fixture("attempt-summary.valid.json");
  const captureAt = o.captureAt ?? START - DAY;
  const drill = o.drill ?? "sprint";
  const spans = {
    timeToResultMs: o.timeToResult === undefined ? 12000 : o.timeToResult,
    readyForNextRepMs: o.ready === undefined ? 15000 : o.ready,
    saveConfirmedAfterRecordingMs: o.saveConfirmed === undefined ? 20000 : o.saveConfirmed,
  };
  const missing = [...(o.missing ?? [])];
  for (const [key, value] of Object.entries(spans)) {
    if (value === null && !missing.some(([field]) => field === `/spans/${key}`)) missing.push([`/spans/${key}`, o.missingReason ?? "crossLaunch"]);
  }
  Object.assign(record, {
    recordId: o.attemptId, attemptId: o.attemptId, revision: o.revision ?? 1, repId: o.repId ?? null, commitJobId: null,
    originInstallId: o.install === undefined ? uuid("i", 1) : o.install, executorInstallId: o.install === undefined ? uuid("i", 1) : o.install,
    originLaunchId: o.launch ?? launch(1), executionLaunchId: o.launch ?? launch(1),
    originReporterUid: o.reporter ?? REPORTER, drillType: drill, recordingMode: o.mode ?? "ordinary",
    originPlatform: o.platform === undefined ? platform(o.build, o.machine) : o.platform,
    occurredAtClient: isoAt(o.occurredAt ?? captureAt + 30000),
    captureOccurredAtClient: o.captureAt === null ? null : isoAt(captureAt),
    clockQuality: o.clock ?? "reliable", completeness: o.completeness ?? "complete",
    missingReasons: reasons(missing), droppedDetailCount: o.dropped ?? 0,
    origin: o.origin ?? "field", evaluationRunId: o.origin === "evaluation" ? uuid("x", 1) : null,
  });
  const verdict = o.verdict ?? "valid";
  record.body = {
    ...record.body,
    stages: o.stages ?? [
      stage("capture.stopRequested", 200), stage("capture.movieFinalized", 100), stage("capture.retainCopyHash", 300),
      stage("artifact.persist", 80), stage("accept.manifestAck", 20), stage("flow.nextReady", 1500),
    ],
    spans, continuousSpans: { ...spans },
    measurementVerdict: verdict,
    verdictReason: o.reason ?? (verdict === "invalid" ? "processingFailed" : null),
    stationVerdict: "notApplicable",
    preAdmissionFailure: o.preAdmission ?? null,
    primaryMetricFinite: verdict === "valid",
    requiredSaveState: o.requiredSave ?? "committed",
    sidecarState: "uploaded",
    archiveState: o.archive ?? "notRequested",
    runCount: o.runCount ?? 1,
    acceptedRunId: o.acceptedRunId === undefined ? (verdict === "valid" ? uuid("r", o.runNumber ?? 1) : null) : o.acceptedRunId,
    launchSegmentCount: 1,
    lifecycleTransitionCount: 0,
  };
  return checked(record);
}

function runSummary(o) {
  const record = fixture("run-summary.valid.json");
  const drill = o.drill ?? "sprint", prefix = PASS[drill];
  const outcome = o.outcome ?? "valid";
  const missing = [...(o.missing ?? [])];
  const processingMs = o.processingMs === undefined ? 9000 : o.processingMs;
  if (processingMs === null && !missing.some(([field]) => field === "/totals/processingMs")) missing.push(["/totals/processingMs", "interrupted"]);
  Object.assign(record, {
    recordId: o.runId, processingRunId: o.runId, attemptId: o.attemptId, retryOfRunId: o.retryOf ?? null, repId: null,
    originInstallId: o.origin === undefined ? uuid("i", 1) : o.origin, executorInstallId: o.executor ?? o.origin ?? uuid("i", 1),
    originLaunchId: o.originLaunch ?? launch(1), executionLaunchId: o.launch ?? launch(1), stationDeviceId: null,
    originReporterUid: o.reporter ?? REPORTER, drillType: drill, recordingMode: o.mode ?? "ordinary",
    processingMode: o.processingMode ?? "liveCapture",
    originPlatform: platform(o.captureBuild, o.captureMachine), executorPlatform: platform(o.build, o.machine, o.appVersion),
    occurredAtClient: isoAt(o.occurredAt ?? START - DAY + 20000), captureOccurredAtClient: isoAt(o.captureAt ?? START - DAY),
    clockQuality: "reliable", completeness: o.completeness ?? "complete", missingReasons: reasons(missing),
    droppedDetailCount: 0, origin: o.recordOrigin ?? "field", evaluationRunId: o.recordOrigin === "evaluation" ? uuid("x", 2) : null,
  });
  record.body = {
    ...record.body,
    outcome,
    failure: o.failure ?? (outcome === "failed" ? { code: "algorithm_failed", stage: `${prefix}.extract`, disposition: "retryable", layer: "algorithm" } : null),
    cancellationReason: outcome === "cancelled" ? "sceneDeactivated" : null,
    stages: o.stages ?? [
      stage("input.calibration", 50), stage("admission.requested", 10), stage("admission.granted", 5),
      stage(`${prefix}.extract`, 7000, { passId: `${prefix}.extract`, status: outcome === "failed" ? "failed" : "completed" }),
      stage("model.create", 150, { parent: `${prefix}.extract`, passId: `${prefix}.extract` }),
      stage("model.firstPrediction", 60, { parent: `${prefix}.extract`, passId: `${prefix}.extract`, invocations: 2 }),
      stage(`${prefix}.math`, 40, { status: outcome === "failed" ? "notReached" : "completed" }),
    ],
    passIds: [`${prefix}.extract`],
    totals: { admissionWaitMs: 10, processingMs, journalFinalizeMs: 12, framesDecoded: 1200, modelCalls: 1200 },
  };
  return checked(record);
}

const ROLE = { resultFiles: "resultArtifact", optionalVideo: "videoArchive", legacyVideo: "freeRecordVideo", diagnostics: "diagnosticArtifact" };
function uploadGroup(o) {
  const record = fixture("upload-group-summary.valid.json");
  const category = o.category ?? "resultFiles", groupId = `${o.attemptId}:${category}`;
  const missing = [...(o.missing ?? [])];
  const queueWaitMs = o.queueWait === undefined ? 250 : o.queueWait;
  const cloudSaveMs = o.cloudSave === undefined ? (category === "resultFiles" ? 4000 : null) : o.cloudSave;
  if (queueWaitMs === null && !missing.some(([f]) => f === "/queueWaitMs")) missing.push(["/queueWaitMs", "crossLaunch"]);
  if (cloudSaveMs === null && !missing.some(([f]) => f === "/cloudSaveMs")) missing.push(["/cloudSaveMs", category === "resultFiles" ? "pendingUpload" : "notApplicable"]);
  Object.assign(record, {
    recordId: groupId, attemptId: o.attemptId, revision: o.revision ?? 1, processingRunId: null, retryOfRunId: null, repId: null, commitJobId: null,
    originInstallId: o.origin === undefined ? uuid("i", 1) : o.origin, executorInstallId: o.executor ?? o.origin ?? uuid("i", 1),
    originLaunchId: launch(1), executionLaunchId: launch(1), originReporterUid: o.reporter ?? REPORTER,
    drillType: o.drill ?? "sprint", recordingMode: "ordinary", executorPlatform: platform(),
    occurredAtClient: isoAt(o.occurredAt ?? START - DAY + 40000), captureOccurredAtClient: isoAt(o.captureAt ?? START - DAY),
    missingReasons: reasons(missing),
  });
  record.body = {
    groupId, category, jobState: o.jobState ?? "committed", uniqueObjectCount: o.objects ?? 3, uniqueObjectBytes: o.bytes ?? 150000,
    queueWaitMs, knownBackoffMs: o.backoff ?? null, cloudSaveMs, transferAttemptCount: o.transferAttempts ?? 3,
    successfulTransferCount: o.transfersSucceeded ?? 3, failedTransferCount: o.transfersFailed ?? 0, lifetimeRetryCount: o.retries ?? 0,
    requiredCommitAcknowledged: category === "resultFiles" ? (o.jobState ?? "committed") === "committed" : null, firestoreWriteMs: 300,
  };
  return checked(record);
}

function transfer(o) {
  const record = fixture("transfer-invocation.valid.json");
  const category = o.category ?? "resultFiles";
  const elapsed = o.ms === undefined ? 500 : o.ms;
  Object.assign(record, {
    recordId: o.invocationId, attemptId: o.attemptId, processingRunId: null, retryOfRunId: null, repId: null, commitJobId: null,
    originInstallId: o.origin === undefined ? uuid("i", 1) : o.origin, executorInstallId: o.executor ?? o.origin ?? uuid("i", 1),
    originLaunchId: launch(1), executionLaunchId: launch(1), originReporterUid: o.reporter ?? REPORTER,
    drillType: o.drill ?? "sprint", recordingMode: "ordinary",
    occurredAtClient: isoAt(o.occurredAt ?? START - DAY + 41000), captureOccurredAtClient: isoAt(o.captureAt ?? START - DAY),
    missingReasons: elapsed === null ? reasons([["/invocationElapsedMs", "interrupted"]]) : [],
    origin: o.recordOrigin ?? "field", evaluationRunId: o.recordOrigin === "evaluation" ? uuid("x", 3) : null,
  });
  record.body = {
    ...record.body,
    invocationId: o.invocationId, logicalObjectId: `${o.attemptId}/${ROLE[category]}.slot/${"1".repeat(64)}`,
    groupId: `${o.attemptId}:${category}`, objectRole: ROLE[category], payloadBytes: o.bytes ?? 50000,
    progressCompletedBytes: null, queueWaitMs: 10, invocationElapsedMs: elapsed, knownBackoffMs: null,
    networkInterface: o.net ?? "wifi", outcome: o.outcome ?? "succeeded",
    normalizedFailureCode: (o.outcome ?? "succeeded") === "failed" ? "network_lost" : null,
  };
  return checked(record);
}

// One device status per install and account: recordId <executorInstallId>:<originReporterUid> (v1.2, D-18).
function deviceStatus(o) {
  const record = fixture("device-status.valid.json");
  const reporter = o.reporter ?? REPORTER;
  Object.assign(record, {
    recordId: `${o.install}:${reporter}`, executorInstallId: o.install, revision: o.revision ?? 1, originReporterUid: reporter,
    executorPlatform: platform(o.build ?? "215", o.machine ?? "iPhone14,7", o.appVersion ?? "1.4.1"),
    occurredAtClient: o.occurredAt === null ? null : isoAt(o.occurredAt ?? START - 3600000), clockQuality: o.clock ?? "reliable",
    stationDeviceId: null,
  });
  record.body = { ...record.body, repQueuePending: o.pending ?? 1, repQueueFailed: o.failed ?? 0 };
  return checked(record);
}

// The document device-performance-ingestion.js stores for an accepted record.
function storedFact(record, { receivedAt, updatedAt, reporter = record.originReporterUid, playerDocumentID = "player" }) {
  return {
    storageVersion: STORAGE_VERSION, recordKind: record.recordKind, recordId: record.recordId, revision: record.revision,
    digest: contract.digest(record), encodedBytes: contract.encodedBytes(record), record,
    authority: record.attemptId
      ? { basis: "processingAttempt", reporterUid: reporter, attemptId: record.attemptId, playerDocumentID }
      : { basis: "reporter", reporterUid: reporter, attemptId: null, playerDocumentID: null },
    attemptId: record.attemptId, processingRunId: record.processingRunId, originInstallId: record.originInstallId,
    executorInstallId: record.executorInstallId, serverClockQuality: record.clockQuality, lastBatchId: uuid("x", 9),
    expiresAt: Timestamp.fromMillis(receivedAt + 90 * DAY),
    firstReceivedAtServer: Timestamp.fromMillis(receivedAt), updatedAtServer: Timestamp.fromMillis(updatedAt),
  };
}
const factPath = (record) => `${contract.ROOTS[record.recordKind]}/${storageKey(record)}`;

// A report service over a fake Firestore with a controllable clock. `put`
// stores a fact as ingestion would (first receipt kept, update time now).
function harness({ now = START, limits, maxResponseBytes, hooks, seed = {} } = {}) {
  let clock = now;
  const db = new FakeFirestore(seed, { now: () => clock });
  const logs = [];
  const logger = { warn: (...args) => logs.push(["warn", ...args]), error: (...args) => logs.push(["error", ...args]) };
  const reports = createDevicePerformanceReports({ db, HttpsError, FieldValue, Timestamp, now: () => clock, limits, maxResponseBytes, logger, hooks });
  const h = {
    db, reports, logs, projection: reports.projection,
    now: () => clock,
    advance(ms) { clock += ms; },
    put(record, { at } = {}) {
      clock = Math.max(clock + 1, at ?? clock + 1);
      const pathName = factPath(record);
      const existing = db.snapshot(pathName);
      db.docs.set(pathName, storedFact(record, { receivedAt: existing?.firstReceivedAtServer?.toMillis() ?? clock, updatedAt: clock }));
      return pathName;
    },
    putAll(records) { for (const record of records) h.put(record); },
    index(attemptId, extra = {}) {
      db.docs.set(`processingAttempts/${attemptId}`, {
        schemaVersion: 2, scope: "attempt", reportedByUid: REPORTER, attemptId, playerDocumentID: "player", sequence: 1,
        manifestPath: `processing_attempts/${REPORTER}/${attemptId}/manifest.json`, retentionState: "active", lastStage: "unknown", ...extra,
      });
    },
    request(extra = {}) {
      return { startDate: "2026-09-23", endDate: "2026-09-29", timeZone: "UTC", dateBasis: "capture", filters: {}, sort: "attention", pageSize: 50, cursor: null, focus: null, attemptsCursor: null, search: null, ...extra };
    },
    fleet(extra = {}, caller = ADMIN) { return reports.getFleet(h.request(extra), caller); },
    detail(installId, extra = {}, caller = ADMIN) {
      const { search, sort, attemptsCursor, ...base } = h.request(extra);
      void search; void sort; void attemptsCursor;
      return reports.getDetail({ installId, attribution: "origin", section: "processing", ...base, ...extra }, caller);
    },
  };
  return h;
}

// One complete, valid attempt: summary, run, result-files group and one transfer.
function completeAttempt(n, o = {}) {
  const attemptId = uuid("a", n), runId = uuid("r", n);
  const install = o.install === undefined ? uuid("i", 1) : o.install;
  const captureAt = o.captureAt ?? START - DAY;
  return [
    attemptSummary({ attemptId, install, captureAt, runNumber: n, acceptedRunId: o.verdict === "invalid" || o.verdict === "pending" ? null : runId, ...o.attempt, ...(o.attemptOverrides ?? {}) }),
    runSummary({ attemptId, runId, origin: install, captureAt, drill: o.attempt?.drill, ...o.run }),
    uploadGroup({ attemptId, origin: install, captureAt, drill: o.attempt?.drill, ...o.group }),
    transfer({ attemptId, invocationId: uuid("t", n), origin: install, captureAt, drill: o.attempt?.drill, ...o.transfer }),
  ];
}

module.exports = {
  fixture, uuid, launch, stage, platform, attemptSummary, runSummary, uploadGroup, transfer, deviceStatus, storedFact, factPath,
  harness, completeAttempt, REPORTER, ADMIN, START, DAY, isoAt,
};
