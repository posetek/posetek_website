"use strict";

// Device performance read API (plan 07 §3 "Binding measurement definitions",
// §6 "Read API"; PROCESSING_PERF_CONTRACTS_V1 §8.2-§8.4, §8.9-§8.10).
//
// getDevicePerformanceV1         fleet report: totals, drills, trends, steps, devices
// getDevicePerformanceDetailV1   one install: Captured here | Processed or uploaded here
// getDevicePerformanceAttemptV1  one attempt: verbatim contract records and evidence ids
// setDevicePerformanceLabelV1    admin alias for an install, with an audit record
//
// All four are admin-only through the verified, non-anonymous @posetek.net
// predicate (club-access.js isClubAdmin, the rules' isPosetekAdmin), and the
// scope is explicitly All devices. Reports come from complete projection
// generations (device-performance-projection.js): totals are exact pooled
// statistics over every filtered observation and never depend on row paging.
// Response shapes follow the admin UI's parsers (T1.4); every difference is
// listed in the T1.3b return.

const { createHash, randomUUID } = require("node:crypto");
const { isClubAdmin } = require("./club-access");
const { localDate, midnight, shiftDate } = require("./insights-v2");
const { completeQuery } = require("./insights-v2-projection");
const {
  createDevicePerformanceProjection, usableFact, narrowRange, buildRef, DRILLS, PHASES, UNKNOWN_INSTALL, TRANSFER_RETENTION_MS,
} = require("./device-performance-projection");

const REPORT_SCHEMA_VERSION = 1;
const UPLOAD_ROLES = Object.freeze(["resultFiles", "optionalVideo", "legacyVideo", "diagnostics"]);
const RECORDING_MODES = Object.freeze(["ordinary", "station"]);
const PROCESSING_MODES = Object.freeze(["liveCapture", "debugReview", "recovery", "validation", "fixture"]);
const NETWORK_INTERFACES = Object.freeze(["wifi", "cellular", "wiredEthernet", "loopback", "other", "none", "unknown"]);
const SIZE_BANDS = Object.freeze([
  { key: "under-100kB", label: "Under 100 kB", below: 1e5 },
  { key: "100kB-1MB", label: "100 kB to 1 MB", below: 1e6 },
  { key: "1MB-10MB", label: "1 MB to 10 MB", below: 1e7 },
  { key: "10MB-100MB", label: "10 MB to 100 MB", below: 1e8 },
  { key: "100MB-plus", label: "100 MB or more", below: Infinity },
]);
const SORTS = Object.freeze(["attention", "slowResult", "failureRate", "failureCount", "uploadWait", "lastSeen"]);
const SECTIONS = Object.freeze(["processing", "uploads", "failures"]);
const ATTRIBUTIONS = Object.freeze(["origin", "executor"]);
const DATE_BASES = Object.freeze(["capture", "serverReceipt"]);
const SHARED_FILTERS = Object.freeze(["drill", "recordingMode", "captureBuild", "captureMachine"]);
const RUN_FILTERS = Object.freeze(["processingMode", "executionBuild", "executionMachine"]);
const UPLOAD_FILTERS = Object.freeze(["networkInterface", "uploadRole", "payloadSizeBand"]);
const FILTER_KEYS = Object.freeze([...SHARED_FILTERS, ...RUN_FILTERS, ...UPLOAD_FILTERS]);
const LIMITED_DATA_SAMPLES = 20;
const NOT_RECENT_MS = 72 * 3600000;
const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 7;
const PAGE_SIZE = Object.freeze({ standard: 50, max: 100 });
const TRANSFER_PAGE_SIZE = 50;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REFRESH_BUDGET_MS = 60000;
const CACHE = Object.freeze({ ttlMs: 60000, entries: 2 });
const LIST_LIMITS = Object.freeze({ reasons: 32, choices: 500, failureStages: 200, innerModel: 200, builds: 64, trendBuilds: 16, detailRuns: 64, detailGroups: 16, detailDevices: 16, evidence: 32 });
const LABEL_MAX = 48;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHOICE_KEY = /^[A-Za-z0-9 ._,()+:-]{1,128}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,2048}$/;
const STAGE_ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Exact pooled statistics.

const round3 = (value) => (value === null ? null : Math.round(value * 1000) / 1000);
// Hyndman-Fan type 7 (numpy's default, Excel PERCENTILE.INC): with the n
// values sorted ascending and h = (n - 1) * p, the quantile is
// x[floor h] + (h - floor h) * (x[ceil h] - x[floor h]). The median of an even
// count is the mean of the two middle values. Always computed over every
// pooled observation; a quantile is never averaged across groups.
function quantile(sorted, p) {
  const n = sorted.length;
  if (!n) return null;
  const h = (n - 1) * p, low = Math.floor(h), high = Math.ceil(h);
  return sorted[low] + (h - low) * (sorted[high] - sorted[low]);
}
function countedReasons(map) {
  const rows = [...map].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  if (rows.length <= LIST_LIMITS.reasons) return rows;
  const kept = rows.slice(0, LIST_LIMITS.reasons - 1);
  return [...kept, { reason: "other", count: rows.slice(LIST_LIMITS.reasons - 1).reduce((sum, row) => sum + row.count, 0) }];
}
class StatBuilder {
  constructor() { this.values = []; this.missing = new Map(); this.excluded = new Map(); }
  // A measured value (zero is a measurement); null is missing with a reason.
  add(value, reason) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) this.values.push(value);
    else this.miss(reason || "unavailable");
  }
  miss(reason) { this.missing.set(reason, (this.missing.get(reason) || 0) + 1); }
  exclude(reason) { const key = reason || "unknown"; this.excluded.set(key, (this.excluded.get(key) || 0) + 1); }
  build() {
    const sorted = Float64Array.from(this.values).sort();
    const missing = [...this.missing.values()].reduce((sum, count) => sum + count, 0);
    const excluded = [...this.excluded.values()].reduce((sum, count) => sum + count, 0);
    return {
      eligible: sorted.length + missing, sample: sorted.length, missing, excluded,
      typicalMs: round3(quantile(sorted, 0.5)), slowMs: round3(quantile(sorted, 0.9)),
      missingReasons: countedReasons(this.missing), excludedReasons: countedReasons(this.excluded),
    };
  }
}
const mean = (values) => (values.length ? round3(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
const iso = (millis) => (typeof millis === "number" && Number.isFinite(millis) ? new Date(millis).toISOString() : null);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sizeBand = (bytes) => SIZE_BANDS.find((band) => bytes < band.below)?.key ?? null;
const emptyOutcomes = () => ({ valid: 0, partial: 0, noMeasurement: 0, failed: 0, cancelled: 0, interruptedUnknown: 0, pending: 0, preAdmissionFailures: 0 });
const knownOutcomes = (outcomes) => outcomes.valid + outcomes.partial + outcomes.noMeasurement + outcomes.failed;

// ---------------------------------------------------------------------------
// Metric definitions carried in every report (plan 07 §6 response).

// metricDefinitions: Record<metricId, { label, definition, unit, population,
// denominator|null }> (D-2026-09-29-27 (2)). The first twelve ids are the admin
// UI's; the rest define allocation, inner timing, attribution, dates, focus and
// coverage, which the rulings asked the server to state.
const definition = (label, unit, population, denominator, text) => Object.freeze({ label, definition: text, unit, population, denominator });
const METRIC_DEFINITIONS = Object.freeze({
  timeToResult: definition("Time to result", "ms", "Accepted attempts (an accepted run or a valid verdict); others are excluded with their verdict.", null,
    "Movie finalized to durable local result accepted, in one app launch (attempt spans.timeToResultMs). A missing value is counted with its reason. Capture filters only. Attempt metric: origin-based in both device views."),
  processingTime: definition("Processing time", "ms", "Terminal runs: byOutcome valid, partial, noMeasurement and failed (each its own bucket); recovery holds recovery-mode runs of those outcomes. Cancelled and interruptedUnknown runs have no bucket.", null,
    "Admission granted to processor returned (run totals.processingMs); journal finalization is timed separately. The groups are disjoint: a recovery run is only in recovery. Debug review, fixture and validation runs are excluded (reason = the mode) and counted in totals.runsExcludedByMode unless the processing mode filter selects them; validation (free-record pose validation) runs are counted only in the free-record drill row and free-record inner-model rows, never pooled with the six local drills. Capture and processing filters apply; executor-based under Processed or uploaded here."),
  readyForNextRep: definition("Ready for next rep", "ms", "Attempts whose summary arrived; others are excluded (attemptNotReported).", null,
    "Capture stop requested to the next gate or capture ready (spans.readyForNextRepMs). Correction, speech and progress waits are stages inside it, not subtracted. Capture filters only; origin-based."),
  cloudSave: definition("Cloud save time", "ms", "Result-files upload jobs: committed jobs are measured, queued or uploading jobs are missing (pendingUpload), failed, cancelled, unavailable and not-queued jobs are excluded.", null,
    "Durable result job enqueued to required result files and rep/session commit acknowledged (result-files group cloudSaveMs). Archive, sidecar and diagnostics are separate. Capture filters only; under Processed or uploaded here only the jobs this install uploaded."),
  waitingToUpload: definition("Waiting to upload", "ms", "Upload groups of the role that were requested; notRequested and unavailable groups are excluded.", null,
    "Logical upload queued to first transfer start (group queueWaitMs). App retry waiting is the separate knownBackoffMs total. A network filter keeps groups with a transfer on that network; a size band keeps groups by unique object bytes."),
  uploadDuration: definition("Upload duration", "ms", "Successful transfer invocations of the role first received within the last 30 days; unsuccessful ones are excluded by outcome.", null,
    "One Storage task or PUT from start to terminal callback (transfer invocationElapsedMs). Network and payload-size filters apply to invocations. Transfer detail is retained 30 days (summaries 90): each upload role states retention retained, partial or notRetained (Not retained) with groupsBeyondRetention, and older transfers never count."),
  uploadSpeed: definition("Weighted effective throughput", "MB/s", "Successful invocations of one role with a measured, non-zero duration.", "Sum of those invocations' measured seconds",
    "Sum of payloadBytes divided by the sum of elapsedMs (MB/s = bytes / 1e6 / (ms / 1000)). Zero or unknown durations and unsuccessful invocations are left out and counted. Application-observed payload throughput, not radio capacity or wire bytes; never an average of device speeds."),
  saveConfirmed: definition("Save confirmed after recording", "ms", "Attempts whose required save committed.", null,
    "Movie finalized to required cloud commit, only when both ends are in one launch (spans.saveConfirmedAfterRecordingMs); across launches the value is missing (crossLaunch). Origin-based."),
  failureRate: definition("Processing failure rate", "ratio", "Terminal runs.", "valid + partial + noMeasurement + failed runs",
    "failed / (valid + partial + noMeasurement + failed). Cancelled, interruptedUnknown, pending (runs the phone counted but has not delivered) and pre-admission failures (not runs) are shown beside it, never counted. They cannot be attributed to a run filter or an executor: while a processing filter is active both are null (omittedReasons runFilterActive), and under Processed or uploaded here pending is null (executorAttribution); null never means zero."),
  yield: definition("Usable-result yield", "ratio", "Attempts with a final verdict, leaving out userDiscarded.", "valid + invalid attempts (userDiscarded excluded)",
    "measurementVerdict valid / (valid + invalid). Pending and userDiscarded are disclosed. Eventual yield uses the latest verdict; firstRunValid counts valid attempts whose accepted run is not a retry. Capture filters only; origin-based."),
  failureAtStep: definition("Failure at a stage", "ratio", "Runs that entered the stage plus pre-admission failures at it.", "entered",
    "failures / entered. entered counts runs with a reached stage summary for the stage plus pre-admission failures there; failures counts failed stage summaries, a failed run's typed failure stage and pre-admission failures. lastReportedOnly counts interrupted runs whose last reported stage is this one and is not a confirmed failure. Executor-based under Processed or uploaded here."),
  typicalSlow: definition("Typical and slow", "ms", "Every matching observation, pooled.", null,
    "Typical is the pooled median and slow the pooled 90th percentile, linear interpolation between order statistics (Hyndman-Fan type 7: h = (n - 1) p), rounded to 0.001 ms. Fleet values are never averaged from device values. Limited data: fewer than 20 eligible or fewer than 20 measured samples; both counts are returned."),
  allocation: definition("Where time goes", "ms", "Per drill, one cohort: attempts with a measured time to result and complete main-phase stage timing in the origin launch.", null,
    "Means of preparation, waiting, analysis, calculation and local saving over that cohort, with its mean time to result; Unattributed = mean time to result minus the phase means. Medians are never stacked."),
  innerModel: definition("Inner model timing", "ms", "Terminal runs (valid, partial, noMeasurement, failed) containing the operation.", null,
    "Cumulative call time of each model.* nested operation, one row per drill and stage aggregated across parent steps: each run's summed elapsedMs, pooled. It overlaps its parent step and is never added to step or phase times. Capture and processing filters apply, never upload filters."),
  attribution: definition("Captured here / Processed or uploaded here", "count", "Captured here: attempts recorded by this install with all of their runs, groups and transfers. Processed or uploaded here: attempt counts stay origin-based; run, transfer and upload counts include only what this install executed.", null,
    "Under Processed or uploaded here, outcomes, processing time, failure stages, inner model timing, uploads, cloud save and upload rows are executor-based; attempts, time to result, readiness, yield, coverage and processing rows are origin-based. The two populations are never added."),
  dateBasis: definition("Dates", "count", "Capture date: attempts with a reliable capture time in the period. Server receipt: attempts first received in the period.", null,
    "An attempt whose capture time is unreliable, in the future of its first receipt or missing is Date uncertain: left out of the capture-date cohort and counted (attemptsDateUncertain) by its first server receipt."),
  focus: definition("Focus", "count", "Rows only; never totals.", null,
    "On the fleet report a focus selects the matching-attempts list. On a device report it narrows only the current section's rows: a stage focus on processing lists attempts that failed at, or last reported, that stage; on failures, failures at that stage; a phase focus lists the drill's allocation cohort by time in that phase. Upload rows ignore a focus."),
  coverage: definition("Coverage", "count", "Attempts matching the capture filters only.", "attemptsIndexed",
    "attemptsIndexed uses the capture (shared) filters, period and date basis only; processing and upload filters never change it. Coverage percentages may use only this denominator; a phone that never reported is not in it. attemptsExcludedOverLimit counts attempts left out of every statistic because their facts exceed the per-attempt limits (128 runs, 16 upload groups, 2,000 transfers). attemptsUnknownDevice counts attempts whose summary names no install (old builds); attemptsDeviceNotYetReported counts attempts whose summary has not arrived (server-receipt dates), which have no device row yet."),
});

// ---------------------------------------------------------------------------
// Request validation.

function createValidator(HttpsError) {
  const invalid = (message) => { throw new HttpsError("invalid-argument", message); };
  function period(data, nowMillis) {
    const timeZone = data.timeZone ?? "America/Los_Angeles";
    if (typeof timeZone !== "string" || timeZone.length > 64) invalid("Choose a valid IANA time zone.");
    try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); } catch { invalid("Choose a valid IANA time zone."); }
    const today = localDate(nowMillis, timeZone);
    const endDate = data.endDate ?? today;
    const startDate = data.startDate ?? shiftDate(endDate, -(DEFAULT_RANGE_DAYS - 1));
    const valid = (value) => typeof value === "string" && DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(startDate) || !valid(endDate)) invalid("Dates must be YYYY-MM-DD.");
    const days = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
    if (startDate > endDate || endDate > today || days > MAX_RANGE_DAYS) {
      invalid(`Choose a range of at most ${MAX_RANGE_DAYS} days that ends today or earlier in the selected time zone.`);
    }
    try {
      return { startDate, endDate, timeZone, days, startMillis: midnight(startDate, timeZone), endMillis: midnight(shiftDate(endDate, 1), timeZone) };
    } catch { return invalid("Choose dates that exist in the selected time zone."); }
  }
  function filters(input) {
    const raw = input ?? {};
    if (typeof raw !== "object" || Array.isArray(raw)) invalid("Filters must be an object.");
    for (const key of Object.keys(raw)) if (!FILTER_KEYS.includes(key)) invalid("Unknown filter.");
    const out = Object.fromEntries(FILTER_KEYS.map((key) => [key, raw[key] ?? null]));
    const oneOf = (key, values) => { if (out[key] !== null && !values.includes(out[key])) invalid(`Invalid ${key} filter.`); };
    oneOf("drill", DRILLS); oneOf("recordingMode", RECORDING_MODES); oneOf("processingMode", PROCESSING_MODES);
    oneOf("networkInterface", NETWORK_INTERFACES); oneOf("payloadSizeBand", SIZE_BANDS.map((band) => band.key));
    out.uploadRole ??= "resultFiles";
    oneOf("uploadRole", UPLOAD_ROLES);
    for (const key of ["captureBuild", "captureMachine", "executionBuild", "executionMachine"]) {
      if (out[key] !== null && (typeof out[key] !== "string" || !CHOICE_KEY.test(out[key]))) invalid(`Invalid ${key} filter.`);
    }
    return out;
  }
  function focus(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object" || Array.isArray(value)) invalid("Invalid focus.");
    if (value.kind === "stage" && typeof value.stageId === "string" && value.stageId.length <= 96 && STAGE_ID.test(value.stageId)
      && Object.keys(value).length === 2) return { kind: "stage", stageId: value.stageId };
    if (value.kind === "phase" && DRILLS.includes(value.drill) && [...PHASES, "unattributed"].includes(value.phase)
      && Object.keys(value).length === 3) return { kind: "phase", drill: value.drill, phase: value.phase };
    return invalid("Invalid focus.");
  }
  const cursor = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || !CURSOR.test(value)) invalid("Invalid cursor.");
    return value;
  };
  const pageSize = (value) => {
    const size = value ?? PAGE_SIZE.standard;
    if (!Number.isInteger(size) || size < 1 || size > PAGE_SIZE.max) invalid(`Choose a page size between 1 and ${PAGE_SIZE.max}.`);
    return size;
  };
  const oneOf = (value, values, fallback, name) => {
    const chosen = value ?? fallback;
    if (!values.includes(chosen)) invalid(`Invalid ${name}.`);
    return chosen;
  };
  const uuid = (value, name) => { if (typeof value !== "string" || !LOWER_UUID.test(value)) invalid(`${name} must be a lowercase UUID.`); return value; };
  function report(data, nowMillis) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) invalid("Invalid request.");
    // First-release scope is explicitly All devices (plan 07 §6): an
    // organization or team scope is refused, never silently ignored.
    if (data.scope !== undefined && data.scope !== null && data.scope !== "allDevices") invalid("Device performance is reported for All devices only.");
    return {
      period: period(data, nowMillis),
      basis: oneOf(data.dateBasis, DATE_BASES, "capture", "date basis"),
      filters: filters(data.filters),
      pageSize: pageSize(data.pageSize),
      cursor: cursor(data.cursor),
      focus: focus(data.focus),
    };
  }
  function fleet(data, nowMillis) {
    const base = report(data, nowMillis);
    const search = data.search ?? null;
    if (search !== null && (typeof search !== "string" || search.length > 80)) invalid("Search must be at most 80 characters.");
    const attemptsCursor = cursor(data.attemptsCursor);
    if (attemptsCursor && !base.focus) invalid("An attempts cursor needs a focus.");
    return { ...base, search: search?.trim().toLowerCase() || null, sort: oneOf(data.sort, SORTS, "attention", "sort"), attemptsCursor };
  }
  function detail(data, nowMillis) {
    const base = report(data, nowMillis);
    return {
      ...base, installId: uuid(data.installId, "installId"),
      attribution: oneOf(data.attribution, ATTRIBUTIONS, "origin", "attribution"),
      section: oneOf(data.section, SECTIONS, "processing", "section"),
    };
  }
  function attempt(data) {
    if (typeof data !== "object" || data === null) invalid("Invalid request.");
    return { attemptId: uuid(data.attemptId, "attemptId"), cursor: cursor(data.cursor) };
  }
  function label(data) {
    if (typeof data !== "object" || data === null) invalid("Invalid request.");
    const installId = uuid(data.installId, "installId");
    if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) invalid("expectedRevision must be a non-negative integer.");
    let value = data.label ?? null;
    if (value !== null) {
      if (typeof value !== "string") invalid("A label must be text or null.");
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(value)) invalid("A label cannot contain control characters.");
      value = value.replace(/\s+/g, " ").trim();
      if ([...value].length > LABEL_MAX) invalid(`A label has at most ${LABEL_MAX} characters.`);
      if (!value) value = null;
    }
    return { installId, label: value, expectedRevision: data.expectedRevision };
  }
  return { fleet, detail, attempt, label };
}

// ---------------------------------------------------------------------------
// Bundles and filters.

function assemble(samples) {
  const bundles = new Map();
  for (const sample of samples) {
    let bundle = bundles.get(sample.attemptId);
    if (!bundle) bundles.set(sample.attemptId, bundle = { attempt: null, runs: [], groups: [], transfers: [] });
    if (sample.kind === "attempt") bundle.attempt = sample;
    else if (sample.kind === "run") bundle.runs.push(sample);
    else if (sample.kind === "group") bundle.groups.push(sample);
    else if (sample.kind === "transfer") bundle.transfers.push(sample);
  }
  return [...bundles.values()].filter((bundle) => bundle.attempt);
}
const sharedMatch = (a, f) => (!f.drill || a.drill === f.drill) && (!f.recordingMode || a.mode === f.recordingMode)
  && (!f.captureBuild || a.captureBuild?.key === f.captureBuild) && (!f.captureMachine || a.captureMachine?.key === f.captureMachine);
const runFilterActive = (f) => RUN_FILTERS.some((key) => f[key] !== null);
// Run modes left out of pooled statistics unless the processing-mode filter
// selects them (D-2026-09-29-31 F5): debugReview (admin re-processing), fixture
// (test harness) and validation (free-record pose validation). Validation runs
// appear only in free-record rows (drill === "freeRecord"), never pooled with
// the six local drills.
const DEFAULT_EXCLUDED_MODES = Object.freeze(["debugReview", "fixture", "validation"]);
const buildMatch = (r, f) => (!f.executionBuild || r.executionBuild?.key === f.executionBuild) && (!f.executionMachine || r.executionMachine?.key === f.executionMachine);
const modeIncluded = (r, f, drill) => (f.processingMode ? r.mode === f.processingMode
  : !DEFAULT_EXCLUDED_MODES.includes(r.mode) || (r.mode === "validation" && drill === "freeRecord"));
const runMatch = (r, f, drill) => modeIncluded(r, f, drill) && buildMatch(r, f);
// Run filters without the default mode exclusion (where excluded modes are counted).
const runFilterMatch = (r, f) => (!f.processingMode || r.mode === f.processingMode) && buildMatch(r, f);
const transferMatch = (t, f) => (!f.networkInterface || t.net === f.networkInterface) && (!f.payloadSizeBand || sizeBand(t.bytes) === f.payloadSizeBand);
// A group beyond transfer retention has no network evidence left, so a network
// filter never matches it (deterministic whatever the rebuild time, F3).
const groupUploadMatch = (g, f) => (!f.networkInterface || (!g.beyondRetention && g.networks.includes(f.networkInterface)))
  && (!f.payloadSizeBand || sizeBand(g.bytes) === f.payloadSizeBand);

function effectiveFilters(f) {
  const active = (keys) => keys.filter((key) => f[key] !== null);
  const shared = active(SHARED_FILTERS);
  return {
    capture: shared,
    processing: [...shared, ...active(RUN_FILTERS)],
    yield: shared,
    cloudSave: shared,
    upload: [...shared, ...active(["networkInterface", "payloadSizeBand"]), "uploadRole"],
  };
}

// A view is one attempt as seen from the report's scope (D-2026-09-29-27 (5)).
// Fleet and Captured here: every run, group and transfer of the attempt.
// Processed or uploaded here: run, group and transfer counts are executor-based
// (only what this install executed, whoever captured the attempt), while
// attempt counts stay origin-based (countAttempt: captured by this install).
function viewOf(bundle, scope) {
  if (!scope || scope.attribution === "origin") {
    if (scope && bundle.attempt.origin !== scope.installId) return null;
    return { a: bundle.attempt, runs: bundle.runs, allRuns: bundle.runs, allGroups: bundle.groups, groups: bundle.groups, transfers: bundle.transfers, countAttempt: true, pendingRuns: true, preAdmission: true };
  }
  const mine = (sample) => sample.executor === scope.installId;
  const runs = bundle.runs.filter(mine), groups = bundle.groups.filter(mine), transfers = bundle.transfers.filter(mine);
  const countAttempt = bundle.attempt.origin === scope.installId;
  if (!countAttempt && !runs.length && !groups.length && !transfers.length) return null;
  return { a: bundle.attempt, runs, allRuns: bundle.runs, allGroups: bundle.groups, groups, transfers, countAttempt, pendingRuns: false, preAdmission: countAttempt, executorScope: true };
}

// ---------------------------------------------------------------------------
// Aggregations.

function addTimeToResult(stat, a) {
  if (!a.summary) stat.exclude("attemptNotReported");
  else if (!a.accepted) stat.exclude(a.verdict === "invalid" ? a.verdictReason : a.verdict === "pending" ? "pending" : "notAccepted");
  else stat.add(a.timeToResult, a.timeToResultMissing);
}
function addCloudSave(stat, view) {
  const group = view.groups.find((g) => g.category === "resultFiles");
  if (group) {
    if (group.jobState === "committed") stat.add(group.cloudSave, group.cloudSaveMissing);
    else if (group.jobState === "queued" || group.jobState === "inProgress") stat.miss("pendingUpload");
    else stat.exclude(group.jobState);
    return;
  }
  if (view.executorScope) return; // no result-files group executed here
  const a = view.a;
  if (!a.summary) stat.exclude("attemptNotReported");
  else if (a.requiredSave === "queued" || a.requiredSave === "committed") stat.miss("pendingUpload");
  else stat.exclude(a.requiredSave);
}
// drill: the free-record context in which validation runs count (F5).
function processingRuns(view, f, drill) { return view.runs.filter((r) => runMatch(r, f, drill)); }
function addOutcomes(outcomes, view, f, drill) {
  for (const r of processingRuns(view, f, drill)) if (r.outcome in outcomes) outcomes[r.outcome]++;
  if (!runFilterActive(f)) {
    if (view.pendingRuns) outcomes.pending += Math.max(0, view.a.runCount - view.a.runsReceived);
    if (view.preAdmission && view.a.preAdmission) outcomes.preAdmissionFailures++;
  }
}
// Pending runs and pre-admission failures cannot be attributed to a run mode,
// build, machine or executor. When a run filter or the executor view omits
// them they are null with a reason, never 0 (D-2026-09-29-31 F8).
function finalizeOutcomes(outcomes, f, scope) {
  const filtered = runFilterActive(f) ? "runFilterActive" : null;
  const pendingReason = filtered ?? (scope?.attribution === "executor" ? "executorAttribution" : null);
  return {
    ...outcomes,
    pending: pendingReason ? null : outcomes.pending,
    preAdmissionFailures: filtered ? null : outcomes.preAdmissionFailures,
    omittedReasons: { pending: pendingReason, preAdmissionFailures: filtered },
  };
}

// processingTime { byOutcome { valid, partial, noMeasurement, failed }, recovery }
// (D-2026-09-29-27 (1)). The groups are disjoint: recovery is a mode, so a
// recovery run is in `recovery` whatever its terminal outcome, and byOutcome
// holds the other modes. Cancelled and interruptedUnknown runs have no bucket.
const TIMED_OUTCOMES = Object.freeze(["valid", "partial", "noMeasurement", "failed"]);
function processingTimes(views, f) {
  const byOutcome = Object.fromEntries(TIMED_OUTCOMES.map((outcome) => [outcome, new StatBuilder()]));
  const recovery = new StatBuilder();
  for (const view of views) {
    for (const r of view.runs) {
      if (!runFilterMatch(r, f) || !TIMED_OUTCOMES.includes(r.outcome)) continue;
      if (r.mode === "recovery") { recovery.add(r.ms, r.msMissing); continue; }
      // debugReview, fixture and validation runs are counted as excluded.
      if (!f.processingMode && DEFAULT_EXCLUDED_MODES.includes(r.mode)) { byOutcome[r.outcome].exclude(r.mode); continue; }
      byOutcome[r.outcome].add(r.ms, r.msMissing);
    }
  }
  return { byOutcome: Object.fromEntries(TIMED_OUTCOMES.map((outcome) => [outcome, byOutcome[outcome].build()])), recovery: recovery.build() };
}
// Runs of the default-excluded modes in the cohort (F5); null when a
// processing-mode filter selects the population.
function runsExcludedByMode(views, f) {
  if (f.processingMode) return null;
  const counts = Object.fromEntries(DEFAULT_EXCLUDED_MODES.map((mode) => [mode, 0]));
  for (const view of views) for (const r of view.runs) if (DEFAULT_EXCLUDED_MODES.includes(r.mode) && buildMatch(r, f)) counts[r.mode]++;
  return counts;
}

// Upload statistics state their transfer retention (F3): a group first received
// before the 30-day transfer cutoff has no transfer detail left.
// retention: "retained" (no such group) | "partial" | "notRetained" (all such).
function uploadRoleStats(views, f) {
  return UPLOAD_ROLES.map((role) => {
    const row = { role, notRequested: 0, invocations: 0, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0, pending: 0, excludedZeroOrUnknownDuration: 0, payloadBytes: 0, elapsedMs: 0 };
    const duration = new StatBuilder(), queueWait = new StatBuilder();
    let backoff = null, groupsSeen = 0, groupsBeyondRetention = 0;
    for (const view of views) {
      const groups = view.groups.filter((g) => g.category === role);
      if (role === "optionalVideo" && view.countAttempt && view.a.archive === "notRequested" && !groups.length) row.notRequested++;
      for (const g of groups) {
        if (g.jobState !== "notRequested") { groupsSeen++; if (g.beyondRetention) groupsBeyondRetention++; }
        if (g.jobState === "notRequested") { row.notRequested++; continue; }
        if (g.jobState === "queued" || g.jobState === "inProgress") row.pending++;
        if (!groupUploadMatch(g, f)) continue;
        if (g.jobState === "unavailable") queueWait.exclude("unavailable");
        else queueWait.add(g.queueWait, g.queueWaitMissing);
        if (g.backoff !== null) backoff = (backoff ?? 0) + g.backoff;
      }
      for (const t of view.transfers) {
        if (t.category !== role || !transferMatch(t, f)) continue;
        row.invocations++;
        if (t.outcome in row) row[t.outcome]++;
        if (t.outcome !== "succeeded") { duration.exclude(t.outcome); continue; }
        duration.add(t.ms, "unavailable");
        if (t.ms === null || t.ms <= 0) row.excludedZeroOrUnknownDuration++;
        else { row.payloadBytes += t.bytes; row.elapsedMs += t.ms; }
      }
    }
    return {
      ...row, elapsedMs: round3(row.elapsedMs), duration: duration.build(), queueWait: queueWait.build(), knownBackoffMs: backoff === null ? null : round3(backoff),
      retention: groupsBeyondRetention === 0 ? "retained" : groupsBeyondRetention === groupsSeen ? "notRetained" : "partial",
      groupsBeyondRetention,
    };
  });
}

function allocationOf(views) {
  const cohort = views.filter((view) => view.a.timeToResult !== null && view.a.phases);
  if (!cohort.length) return null;
  return {
    cohortSize: cohort.length,
    meanTimeToResultMs: mean(cohort.map((view) => view.a.timeToResult)),
    phases: PHASES.map((phase) => {
      const values = cohort.map((view) => view.a.phases[phase]);
      return { phase, meanMs: values.every((value) => value === null) ? null : mean(values.map((value) => value ?? 0)) };
    }),
  };
}
const allocationCohort = (views, drill) => views.filter((view) => view.a.drill === drill && view.a.timeToResult !== null && view.a.phases);
function phaseValue(a, phase) {
  if (phase !== "unattributed") return a.phases[phase] ?? 0;
  return a.timeToResult - PHASES.reduce((sum, key) => sum + (a.phases[key] ?? 0), 0);
}

// Inner model timing (D-2026-09-29-27 (6)): model.* nested operations only, one
// row per `${drillType}:${stageId}` aggregated across parents. A run counts
// once: its summed call time for the operation, over terminal runs (valid,
// partial, noMeasurement, failed) that contain it. parentStageId is the main
// phase the operation ran inside; when it ran inside several, the one that
// most runs used (ties: stage id order); null only when it ran at top level.
function innerModelRows(views, f) {
  const rows = new Map();
  for (const view of views) {
    if (!view.a.drill) continue;
    // Rows are per drill, so free-record validation runs count in free-record rows only.
    for (const r of processingRuns(view, f, view.a.drill)) {
      if (!TIMED_OUTCOMES.includes(r.outcome)) continue;
      const perRun = new Map();
      for (const [stageId, parentStageId, ms, calls] of r.inner) {
        if (!stageId.startsWith("model.")) continue;
        const entry = perRun.get(stageId) ?? { ms: 0, measured: true, calls: 0, parents: new Set() };
        if (ms === null) entry.measured = false; else entry.ms += ms;
        entry.calls += calls;
        entry.parents.add(parentStageId);
        perRun.set(stageId, entry);
      }
      for (const [stageId, entry] of perRun) {
        const id = `${view.a.drill}:${stageId}`;
        const row = rows.get(id) ?? { drillType: view.a.drill, stageId, parents: new Map(), runs: 0, invocations: 0, stat: new StatBuilder() };
        row.runs++; row.invocations += entry.calls;
        row.stat.add(entry.measured ? round3(entry.ms) : null, "unavailable");
        for (const parent of entry.parents) row.parents.set(parent, (row.parents.get(parent) || 0) + 1);
        rows.set(id, row);
      }
    }
  }
  return [...rows.values()]
    .sort((a, b) => DRILLS.indexOf(a.drillType) - DRILLS.indexOf(b.drillType) || a.stageId.localeCompare(b.stageId))
    .slice(0, LIST_LIMITS.innerModel)
    .map(({ stat, parents, ...row }) => ({
      ...row,
      parentStageId: [...parents].sort((a, b) => b[1] - a[1] || (a[0] ?? "").localeCompare(b[0] ?? ""))[0]?.[0] ?? null,
      cumulativeMs: stat.build(),
    }));
}

function failureStagesOf(views, f) {
  const rows = new Map();
  const row = (stageId) => rows.get(stageId) ?? rows.set(stageId, { stageId, failures: 0, entered: 0, cancelled: 0, unavailable: 0, lastReportedOnly: 0, drills: new Set() }).get(stageId);
  for (const view of views) {
    const drill = view.a.drill;
    for (const r of processingRuns(view, f)) {
      const seen = new Map(r.stages);
      for (const [stageId, status] of r.stages) {
        const entry = row(stageId);
        entry.entered++;
        if (status === "failed") { entry.failures++; if (drill) entry.drills.add(drill); }
        if (status === "cancelled") entry.cancelled++;
        if (status === "unavailable") entry.unavailable++;
      }
      if (r.outcome === "failed" && r.failure && seen.get(r.failure.stage) !== "failed") {
        const entry = row(r.failure.stage);
        if (!seen.has(r.failure.stage)) entry.entered++;
        entry.failures++;
        if (drill) entry.drills.add(drill);
      }
      if (r.outcome === "interruptedUnknown" && r.lastStage) {
        const entry = row(r.lastStage);
        entry.lastReportedOnly++;
        if (drill) entry.drills.add(drill);
      }
    }
    if (!runFilterActive(f) && view.preAdmission && view.a.preAdmission) {
      const entry = row(view.a.preAdmission.stage);
      entry.entered++; entry.failures++;
      if (drill) entry.drills.add(drill);
    }
  }
  return [...rows.values()]
    .filter((entry) => entry.failures + entry.lastReportedOnly + entry.cancelled + entry.unavailable > 0)
    .sort((a, b) => b.failures - a.failures || b.lastReportedOnly - a.lastReportedOnly || b.entered - a.entered || a.stageId.localeCompare(b.stageId))
    .slice(0, LIST_LIMITS.failureStages)
    .map((entry) => ({ ...entry, drills: DRILLS.filter((drill) => entry.drills.has(drill)) }));
}

function choicesOf(views) {
  const tally = () => new Map();
  const bump = (map, ref) => { if (!ref?.key) return; const entry = map.get(ref.key) ?? { key: ref.key, label: ref.label, count: 0 }; entry.count++; map.set(ref.key, entry); };
  const captureBuilds = tally(), captureMachines = tally(), executionBuilds = tally(), executionMachines = tally(), bands = tally();
  for (const view of views) {
    bump(captureBuilds, view.a.captureBuild); bump(captureMachines, view.a.captureMachine);
    for (const r of view.runs) { bump(executionBuilds, r.executionBuild); bump(executionMachines, r.executionMachine); }
    for (const t of view.transfers) { const key = sizeBand(t.bytes); bump(bands, { key, label: SIZE_BANDS.find((band) => band.key === key).label }); }
  }
  const list = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, LIST_LIMITS.choices);
  return {
    captureBuilds: list(captureBuilds), captureMachines: list(captureMachines),
    executionBuilds: list(executionBuilds), executionMachines: list(executionMachines),
    payloadSizeBands: SIZE_BANDS.filter((band) => bands.has(band.key)).map((band) => bands.get(band.key)),
  };
}

// ---------------------------------------------------------------------------
// Row builders.

// Attempt rows describe the whole attempt (every run and group, wherever it
// executed), so the executor is shown on retries in either view.
function latestRun(view) {
  return (view.a.acceptedRunId && view.allRuns.find((r) => r.runId === view.a.acceptedRunId)) || view.allRuns.at(-1) || null;
}
function failureStageId(view) {
  const failed = [...view.allRuns].reverse().find((r) => r.outcome === "failed" && r.failure);
  return failed?.failure.stage ?? view.a.preAdmission?.stage ?? null;
}
function lastReportedStageId(view) {
  if (failureStageId(view) || view.a.verdict !== "pending") return null;
  const interrupted = [...view.allRuns].reverse().find((r) => (r.outcome === "interruptedUnknown" || r.outcome === "cancelled") && r.lastStage);
  return interrupted?.lastStage ?? view.a.indexLastStage ?? null;
}
function cloudSaveOf(view) {
  const group = view.allGroups.find((g) => g.category === "resultFiles");
  if (!group) return { ms: null, missing: view.a.requiredSave === "queued" || view.a.requiredSave === "committed" || !view.a.summary ? "pendingUpload" : null };
  if (group.jobState === "committed") return { ms: group.cloudSave, missing: group.cloudSaveMissing };
  return { ms: null, missing: group.jobState === "queued" || group.jobState === "inProgress" ? "pendingUpload" : "notApplicable" };
}
function attemptRow(view, labels) {
  const a = view.a, cloud = cloudSaveOf(view);
  return {
    attemptId: a.attemptId,
    originInstallId: a.origin,
    deviceLabel: a.origin ? labels.get(a.origin)?.label ?? null : null,
    machine: a.captureMachine?.label ?? null,
    drillType: a.drill ?? "unknown",
    recordingMode: a.mode,
    captureOccurredAt: iso(a.captureAt),
    clockQuality: a.clock,
    receivedAt: iso(a.receivedAt),
    captureBuild: a.captureBuild?.label ?? null,
    executionBuilds: [...new Set(view.allRuns.map((r) => r.executionBuild?.label).filter(Boolean))].slice(0, LIST_LIMITS.builds),
    executorInstallId: latestRun(view)?.executor ?? null,
    measurementVerdict: a.verdict,
    verdictReason: a.verdictReason,
    runCount: a.runCount,
    timeToResultMs: a.timeToResult,
    timeToResultMissing: a.timeToResult === null ? (a.summary ? a.timeToResultMissing : "pendingUpload") : null,
    cloudSaveMs: cloud.ms,
    cloudSaveMissing: cloud.ms === null ? cloud.missing : null,
    requiredSaveState: a.requiredSave ?? "notReported",
    archiveState: a.archive ?? "notReported",
    failureStageId: failureStageId(view),
    lastReportedStageId: lastReportedStageId(view),
    completeness: a.summary ? a.completeness : "pending",
  };
}
function uploadRows(views, f) {
  const rows = [];
  for (const view of views) {
    for (const g of view.groups) {
      if (g.category !== f.uploadRole || !groupUploadMatch(g, f)) continue;
      const measured = view.transfers.filter((t) => t.category === g.category && t.ms !== null);
      rows.push({
        sortAt: g.occurredAt ?? g.receivedAt ?? 0,
        row: {
          attemptId: view.a.attemptId, groupId: g.groupId, role: g.category, drillType: view.a.drill ?? "unknown",
          occurredAt: iso(g.occurredAt), clockQuality: g.clock, jobState: g.jobState, objectCount: g.objects, bytes: g.bytes,
          queueWaitMs: g.queueWait, transferMs: measured.length ? round3(measured.reduce((sum, t) => sum + t.ms, 0)) : null,
          cloudSaveMs: g.cloudSave, transferAttempts: g.transferAttempts, failedTransfers: g.transfersFailed,
          lifetimeRetries: g.retries, requiredCommitAcknowledged: g.ack,
        },
      });
    }
  }
  return rows.sort((a, b) => b.sortAt - a.sortAt || a.row.groupId.localeCompare(b.row.groupId)).map((entry) => entry.row);
}
function failureRows(views, f) {
  const rows = [];
  for (const view of views) {
    const a = view.a;
    const base = { attemptId: a.attemptId, drillType: a.drill ?? "unknown" };
    // Failure rows list one attempt's runs; a free-record attempt keeps its validation runs.
    for (const r of processingRuns(view, f, a.drill)) {
      if (r.outcome === "failed" && r.failure) {
        rows.push({ ...base, processingRunId: r.runId, stageId: r.failure.stage, failureCode: r.failure.code, failureLayer: r.failure.layer, confirmed: true,
          occurredAt: iso(r.occurredAt), clockQuality: r.clock, build: r.executionBuild?.label ?? a.captureBuild?.label ?? null, sortAt: r.occurredAt ?? r.receivedAt ?? 0 });
      } else if (r.outcome === "interruptedUnknown" && r.lastStage) {
        rows.push({ ...base, processingRunId: r.runId, stageId: r.lastStage, failureCode: null, failureLayer: null, confirmed: false,
          occurredAt: iso(r.occurredAt), clockQuality: r.clock, build: r.executionBuild?.label ?? a.captureBuild?.label ?? null, sortAt: r.occurredAt ?? r.receivedAt ?? 0 });
      }
    }
    if (!runFilterActive(f) && view.preAdmission && a.preAdmission) {
      rows.push({ ...base, processingRunId: null, stageId: a.preAdmission.stage, failureCode: a.preAdmission.code, failureLayer: a.preAdmission.layer,
        confirmed: true, occurredAt: iso(a.captureAt), clockQuality: a.clock, build: a.captureBuild?.label ?? null, sortAt: a.captureAt ?? a.receivedAt ?? 0 });
    }
  }
  return rows.sort((a, b) => b.sortAt - a.sortAt || a.attemptId.localeCompare(b.attemptId) || (a.processingRunId ?? "").localeCompare(b.processingRunId ?? ""))
    .map(({ sortAt, ...row }) => row);
}
function focusedAttempts(views, focus, f, basisTime) {
  if (focus.kind === "phase") {
    return allocationCohort(views, focus.drill)
      .sort((a, b) => phaseValue(b.a, focus.phase) - phaseValue(a.a, focus.phase) || a.a.attemptId.localeCompare(b.a.attemptId));
  }
  const matches = (view) => processingRuns(view, f).some((r) => r.stages.some(([stageId, status]) => stageId === focus.stageId && status === "failed")
      || (r.outcome === "failed" && r.failure?.stage === focus.stageId) || (r.outcome === "interruptedUnknown" && r.lastStage === focus.stageId))
    || (!runFilterActive(f) && view.preAdmission && view.a.preAdmission?.stage === focus.stageId);
  return views.filter(matches).sort((a, b) => (basisTime(b.a) ?? 0) - (basisTime(a.a) ?? 0) || a.a.attemptId.localeCompare(b.a.attemptId));
}

// ---------------------------------------------------------------------------
// The service.

function createDevicePerformanceReports({ db, HttpsError, FieldValue, Timestamp, now = () => Date.now(), limits = {}, logger = console, hooks = {}, maxResponseBytes = MAX_RESPONSE_BYTES }) {
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) throw new Error("Invalid device performance response bound");
  const projection = createDevicePerformanceProjection({ db, HttpsError, FieldValue, Timestamp, now, limits, logger, hooks });
  const validate = createValidator(HttpsError);
  const cache = new Map();

  function requireAdmin(caller) {
    if (!isClubAdmin(caller)) throw new HttpsError("permission-denied", "Device performance requires a verified @posetek.net admin account.");
  }
  const staleCursor = () => new HttpsError("failed-precondition", "The report changed. Refresh the first page.", { errorCode: "staleCursor" });
  const fingerprint = (value) => hash(value).slice(0, 32);
  function page(list, cursor, pageSize, print) {
    let offset = 0;
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (parsed.f !== print || !Number.isSafeInteger(parsed.o) || parsed.o <= 0 || parsed.o >= list.length) throw new Error("stale");
        offset = parsed.o;
      } catch { throw staleCursor(); }
    }
    const next = offset + pageSize < list.length ? Buffer.from(JSON.stringify({ o: offset + pageSize, f: print })).toString("base64url") : null;
    return { rows: list.slice(offset, offset + pageSize), pagination: { pageSize, nextCursor: next, totalRows: list.length } };
  }
  function bounded(response) {
    const bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
    if (bytes > maxResponseBytes) throw narrowRange(HttpsError, "responseBytes", maxResponseBytes);
    return response;
  }
  async function readLabels() {
    let docs;
    try { docs = await completeQuery(projection.refs.labels, projection.limits.maxDevices, HttpsError); } catch (error) {
      if (error?.code === "resource-exhausted") throw narrowRange(HttpsError, "devices", projection.limits.maxDevices);
      throw error;
    }
    return new Map(docs.map((doc) => [doc.id, { label: doc.data().label ?? null, labelRevision: doc.data().labelRevision ?? 0 }]));
  }
  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (now() - entry.at > CACHE.ttlMs) { cache.delete(key); return null; }
    return entry.model;
  }
  function remember(key, model) {
    cache.delete(key);
    cache.set(key, { model, at: now() });
    while (cache.size > CACHE.entries) cache.delete(cache.keys().next().value);
  }

  // The complete, filter-scoped model for one period, basis, filter set and
  // scope. Cursor, focus, section, sort and search never enter its key.
  async function model(request, scope) {
    const started = now();
    const spec = { basis: request.basis, startMillis: request.period.startMillis, endMillis: request.period.endMillis };
    if (scope?.attribution === "origin") spec.installKey = scope.installId;
    if (scope?.attribution === "executor") spec.executorInstall = scope.installId;
    const { manifests } = await projection.refresh(spec, { deadline: started + REFRESH_BUDGET_MS });
    const revision = projection.projectionRevision(manifests);
    const { period, basis, filters } = request;
    const key = hash([scope ?? null, period.startDate, period.endDate, period.timeZone, basis, filters, revision]);
    const hit = cached(key);
    if (hit) return hit;
    const [{ samples }, statuses, bounds] = await Promise.all([projection.loadSamples(manifests), projection.readDeviceStatuses(), projection.collectionBounds()]);
    const basisTime = (a) => (basis === "capture" ? a.captureAt : a.receivedAt);
    const inPeriod = (a) => {
      const at = basisTime(a);
      return (basis === "serverReceipt" || !a.dateUncertain) && at !== null && at >= period.startMillis && at < period.endMillis;
    };
    // Transfer retention at read time (F3): a transfer tuple first received more
    // than 30 days ago is dropped whether or not its partition was rebuilt since
    // and whether or not TTL has deleted the fact, and a group received before
    // the cutoff is marked beyond retention.
    const retentionCutoff = now() - TRANSFER_RETENTION_MS;
    const bundles = assemble(samples);
    for (const bundle of bundles) {
      bundle.transfers = bundle.transfers.filter((t) => t.receivedAt === undefined || t.receivedAt === null || t.receivedAt >= retentionCutoff);
      for (const g of bundle.groups) g.beyondRetention = g.receivedAt !== null && g.receivedAt < retentionCutoff;
    }
    const views = bundles.map((bundle) => viewOf(bundle, scope)).filter(Boolean);
    const periodViews = views.filter((view) => inPeriod(view.a));
    // cohort: every view in the period passing the capture (shared) filters; run,
    // upload and transfer metrics read its runs, groups and transfers. Attempt
    // counts and attempt metrics read the origin-based attempts only. An attempt
    // over its fact limits is left out of every statistic and counted (F1).
    const overLimit = periodViews.filter((view) => view.a.excludedOverLimit && view.countAttempt && sharedMatch(view.a, filters)).length;
    const cohort = periodViews.filter((view) => !view.a.excludedOverLimit && sharedMatch(view.a, filters));
    const attempts = cohort.filter((view) => view.countAttempt);
    const uncertain = basis === "capture"
      ? views.filter((view) => view.countAttempt && view.a.dateUncertain && view.a.receivedAt !== null && view.a.receivedAt >= period.startMillis
        && view.a.receivedAt < period.endMillis && sharedMatch(view.a, filters)).length
      : attempts.filter((view) => view.a.dateUncertain).length;

    const stat = (views, add) => { const builder = new StatBuilder(); for (const view of views) add(builder, view); return builder.build(); };
    const outcomes = emptyOutcomes();
    for (const view of cohort) addOutcomes(outcomes, view, filters);
    const statusRows = [...statuses].filter(([install]) => !scope || install === scope.installId);
    const totals = {
      attempts: attempts.length,
      timeToResult: stat(attempts, (b, v) => addTimeToResult(b, v.a)),
      readyForNextRep: stat(attempts, (b, v) => (v.a.summary ? b.add(v.a.readyForNextRep, v.a.readyForNextRepMissing) : b.exclude("attemptNotReported"))),
      saveConfirmedAfterRecording: stat(attempts, (b, v) => {
        if (!v.a.summary) b.exclude("attemptNotReported");
        else if (v.a.requiredSave !== "committed" && !v.groups.some((g) => g.category === "resultFiles" && g.jobState === "committed")) b.exclude(v.a.requiredSave);
        else b.add(v.a.saveConfirmed, v.a.saveConfirmedMissing);
      }),
      processingTime: processingTimes(cohort, filters),
      cloudSave: stat(cohort, addCloudSave),
      cloudBacklog: {
        pendingJobs: statusRows.reduce((sum, [, s]) => sum + s.record.body.repQueuePending, 0),
        failedJobs: statusRows.reduce((sum, [, s]) => sum + s.record.body.repQueueFailed, 0),
        installsReporting: statusRows.length,
        oldestReportAt: iso(statusRows.length ? Math.min(...statusRows.map(([, s]) => s.updatedAt ?? s.receivedAt ?? Infinity)) : null),
      },
      uploads: uploadRoleStats(cohort, filters),
      outcomes: finalizeOutcomes(outcomes, filters, scope),
      runsExcludedByMode: runsExcludedByMode(cohort, filters),
      yield: {
        valid: attempts.filter((v) => v.a.verdict === "valid").length,
        invalid: attempts.filter((v) => v.a.verdict === "invalid" && v.a.verdictReason !== "userDiscarded").length,
        pending: attempts.filter((v) => v.a.verdict === "pending").length,
        userDiscarded: attempts.filter((v) => v.a.verdict === "invalid" && v.a.verdictReason === "userDiscarded").length,
        firstRunValid: attempts.filter((v) => v.a.firstRunValid).length,
      },
    };
    const perDrill = DRILLS.map((drill) => {
      const drillViews = cohort.filter((view) => view.a.drill === drill);
      const drillAttempts = drillViews.filter((view) => view.countAttempt);
      const drillOutcomes = emptyOutcomes();
      for (const view of drillViews) addOutcomes(drillOutcomes, view, filters, drill);
      return {
        drillType: drill, attempts: drillAttempts.length, timeToResult: stat(drillAttempts, (b, v) => addTimeToResult(b, v.a)),
        allocation: allocationOf(drillAttempts), outcomes: finalizeOutcomes(drillOutcomes, filters, scope),
      };
    });

    // Trends by local date; a build is marked where it first appears, except on
    // the first date with data (it may predate the period).
    const dates = [];
    for (let date = period.startDate; date <= period.endDate; date = shiftDate(date, 1)) dates.push(date);
    const byDate = new Map(dates.map((date) => [date, []]));
    const firstSeen = new Map();
    for (const view of cohort) {
      const date = localDate(basisTime(view.a), period.timeZone);
      byDate.get(date)?.push(view);
      const label = view.countAttempt ? view.a.captureBuild?.label : null;
      if (label && (!firstSeen.has(label) || date < firstSeen.get(label))) firstSeen.set(label, date);
    }
    const firstDataDate = dates.find((date) => byDate.get(date).length) ?? null;
    const trends = dates.map((date) => {
      const dayViews = byDate.get(date);
      const dayAttempts = dayViews.filter((view) => view.countAttempt);
      const dayOutcomes = emptyOutcomes();
      for (const view of dayViews) addOutcomes(dayOutcomes, view, filters);
      return {
        date, attempts: dayAttempts.length, timeToResult: stat(dayAttempts, (b, v) => addTimeToResult(b, v.a)),
        failed: dayOutcomes.failed, knownOutcomes: knownOutcomes(dayOutcomes),
        newBuilds: date === firstDataDate ? [] : [...firstSeen].filter(([, first]) => first === date).map(([label]) => label).sort().slice(0, LIST_LIMITS.trendBuilds),
      };
    });

    // Device rows (fleet): captures to the origin, runs and uploads to the executor.
    const devices = new Map();
    const device = (installId) => {
      if (!devices.has(installId)) {
        devices.set(installId, {
          installId, machines: new Map(), builds: new Map(), attempts: 0, runs: 0, lastFactAt: null,
          timeToResult: new StatBuilder(), cloudSave: new StatBuilder(), uploadWait: new StatBuilder(), outcomes: emptyOutcomes(),
        });
      }
      return devices.get(installId);
    };
    const touch = (row, at) => { if (at !== null && (row.lastFactAt === null || at > row.lastFactAt)) row.lastFactAt = at; };
    if (!scope) {
      for (const view of cohort) {
        const a = view.a;
        // An attempt whose summary has not arrived has no recording device yet:
        // it is counted as Device not yet reported, never as Unknown device (F6).
        if (a.summary) {
          const origin = device(a.origin);
          origin.attempts++;
          addTimeToResult(origin.timeToResult, a);
          touch(origin, a.updatedAt);
          if (a.captureBuild) origin.builds.set(a.captureBuild.key, a.captureBuild);
          if (a.captureMachine) origin.machines.set(a.captureMachine.label, a.captureAt ?? a.receivedAt ?? 0);
          if (!runFilterActive(filters)) {
            origin.outcomes.pending += Math.max(0, a.runCount - a.runsReceived);
            if (a.preAdmission) origin.outcomes.preAdmissionFailures++;
          }
        }
        for (const r of processingRuns(view, filters)) {
          const executor = device(r.executor ?? a.origin);
          executor.runs++;
          if (r.outcome in executor.outcomes) executor.outcomes[r.outcome]++;
          if (r.executionBuild) executor.builds.set(r.executionBuild.key, r.executionBuild);
          touch(executor, r.updatedAt);
        }
        for (const g of view.groups) {
          const uploader = device(g.executor ?? a.origin);
          touch(uploader, g.updatedAt);
          if (g.category === "resultFiles") {
            if (g.jobState === "committed") uploader.cloudSave.add(g.cloudSave, g.cloudSaveMissing);
            else if (g.jobState === "queued" || g.jobState === "inProgress") uploader.cloudSave.miss("pendingUpload");
            else uploader.cloudSave.exclude(g.jobState);
          }
          if (g.category === filters.uploadRole && groupUploadMatch(g, filters)) {
            if (g.jobState === "notRequested" || g.jobState === "unavailable") uploader.uploadWait.exclude(g.jobState);
            else uploader.uploadWait.add(g.queueWait, g.queueWaitMissing);
          }
        }
      }
    }
    // Known installs and when the server last heard from each (one pass): the
    // latest device status or fact receipt update naming the install.
    const known = new Set([...statuses.keys()]);
    const latestFact = new Map();
    const seen = (install, at) => {
      if (!install) return;
      known.add(install);
      if (typeof at === "number" && !(latestFact.get(install) >= at)) latestFact.set(install, at);
    };
    for (const view of periodViews) {
      seen(view.a.origin, view.a.updatedAt);
      for (const sample of [...view.runs, ...view.groups]) seen(sample.executor, sample.updatedAt);
      for (const sample of view.transfers) seen(sample.executor, null);
    }
    const lastSeen = (install) => {
      const values = [statuses.get(install)?.updatedAt, latestFact.get(install)].filter((value) => typeof value === "number");
      return values.length ? Math.max(...values) : null;
    };
    if (scope) { known.clear(); known.add(scope.installId); }
    const anyFilter = FILTER_KEYS.some((key) => key !== "uploadRole" && filters[key] !== null);
    const deviceRows = [];
    if (!scope) {
      for (const install of known) if (!anyFilter) device(install);
      for (const row of devices.values()) {
        const status = row.installId ? statuses.get(row.installId) : null;
        const lastReportAt = row.installId ? lastSeen(row.installId) ?? -Infinity : row.lastFactAt ?? -Infinity;
        const statusMachine = status?.record.executorPlatform?.machine ?? null;
        const latestMachine = [...row.machines].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        deviceRows.push({
          installId: row.installId, machine: statusMachine ?? latestMachine,
          builds: [...row.builds.values()].sort((a, b) => a.label.localeCompare(b.label)).slice(0, LIST_LIMITS.builds).map((b) => ({ key: b.key, label: b.label })),
          attempts: row.attempts, runs: row.runs,
          lastReportAt: Number.isFinite(lastReportAt) ? lastReportAt : null,
          timeToResult: row.timeToResult.build(), cloudSave: row.cloudSave.build(), uploadWait: row.uploadWait.build(), outcomes: finalizeOutcomes(row.outcomes, filters, null),
        });
      }
    }
    const notRecent = (at) => at !== null && now() - at > NOT_RECENT_MS;
    const knownRows = [...known].map((install) => lastSeen(install));

    const envelope = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      scope: "allDevices",
      projectionRevision: revision,
      period: { startDate: period.startDate, endDate: period.endDate, timeZone: period.timeZone, dateBasis: basis },
      filters,
      effectiveFilters: effectiveFilters(filters),
      freshness: {
        sourceUpdatedAt: iso(manifests.map((m) => m.generation.sourceUpdatedAtMillis).filter((v) => v !== null).reduce((max, v) => Math.max(max, v), -Infinity)),
        lastReportReceivedAt: iso(bounds.lastReportReceivedAtMillis),
      },
      coverage: {
        collectionStartedAt: iso(bounds.collectionStartedAtMillis),
        installsKnown: known.size,
        installsNotRecentlyReporting: knownRows.filter(notRecent).length,
        attemptsIndexed: attempts.length,
        attemptsPartial: attempts.filter((v) => !v.a.summary || v.a.completeness !== "complete" || v.a.runsReceived < v.a.runCount || v.a.skipped > 0).length,
        attemptsNotCollectedByVersion: attempts.filter((v) => v.a.notCollected).length,
        attemptsDateUncertain: uncertain,
        // Unknown device: a summary with no install id (an old build). A missing
        // summary is Device not yet reported instead (F6).
        attemptsUnknownDevice: attempts.filter((v) => v.a.summary && v.a.origin === null).length,
        attemptsDeviceNotYetReported: attempts.filter((v) => !v.a.summary).length,
        attemptsExcludedOverLimit: overLimit,
        droppedDetailCount: attempts.reduce((sum, v) => sum + v.a.dropped, 0),
      },
      metricDefinitions: METRIC_DEFINITIONS,
      choices: choicesOf(periodViews),
      totals,
      perDrill,
      trends,
      failureStages: failureStagesOf(cohort, filters),
      innerModel: { rows: innerModelRows(cohort, filters) },
    };
    const result = { key, revision, envelope, cohort, attempts, periodViews, deviceRows, statuses, basisTime, lastSeen, notRecent };
    remember(key, result);
    return result;
  }

  const generatedAt = () => new Date(now()).toISOString();

  async function getFleet(data, caller) {
    requireAdmin(caller);
    const request = validate.fleet(data, now());
    const [built, labels] = await Promise.all([model(request, null), readLabels()]);
    const labelsHash = fingerprint([...labels].sort(([a], [b]) => a.localeCompare(b)));
    const rows = built.deviceRows.map((row) => ({
      installId: row.installId, label: row.installId ? labels.get(row.installId)?.label ?? null : null, machine: row.machine, builds: row.builds,
      attempts: row.attempts, runs: row.runs, lastReportAt: iso(row.lastReportAt), notRecentlyReporting: built.notRecent(row.lastReportAt),
      timeToResult: row.timeToResult, cloudSave: row.cloudSave, uploadWait: row.uploadWait, outcomes: row.outcomes, _lastReport: row.lastReportAt,
    })).filter((row) => !request.search || (row.installId !== null
      && [row.label, row.machine].some((text) => typeof text === "string" && text.toLowerCase().includes(request.search))));
    const sorted = sortDevices(rows, request.sort).map(({ _lastReport, ...row }) => row);
    const devices = page(sorted, request.cursor, request.pageSize, fingerprint([caller.uid, "devices", built.key, request.sort, request.search, labelsHash]));
    let attempts = null, attemptPagination = null;
    if (request.focus) {
      const focused = focusedAttempts(built.cohort, request.focus, request.filters, built.basisTime);
      const paged = page(focused, request.attemptsCursor, request.pageSize, fingerprint([caller.uid, "attempts", built.key, request.focus, labelsHash]));
      attempts = paged.rows.map((view) => attemptRow(view, labels));
      attemptPagination = paged.pagination;
    }
    return bounded({
      ...built.envelope, generatedAt: generatedAt(),
      devices: devices.rows, pagination: devices.pagination, focus: request.focus, attempts, attemptPagination,
    });
  }

  async function getDetail(data, caller) {
    requireAdmin(caller);
    const request = validate.detail(data, now());
    const scope = { installId: request.installId, attribution: request.attribution };
    const [labels, labelDoc] = await Promise.all([readLabels(), projection.refs.labels.doc(request.installId).get()]);
    if (!labelDoc.exists && !await projection.installKnown(request.installId)) {
      throw new HttpsError("not-found", "No device with this install id has reported.");
    }
    const built = await model(request, scope);
    const views = built.cohort;
    const install = request.installId;
    let list;
    if (request.section === "processing") {
      // Processing rows are attempts, so they stay origin-based in both views
      // (D-2026-09-29-27 (5)); in the executor view a row's runs are the ones
      // this install executed.
      const processed = built.attempts;
      list = request.focus ? focusedAttempts(processed, request.focus, request.filters, built.basisTime)
        : [...processed].sort((a, b) => (built.basisTime(b.a) ?? 0) - (built.basisTime(a.a) ?? 0) || a.a.attemptId.localeCompare(b.a.attemptId));
      list = list.map((view) => attemptRow(view, labels));
    } else if (request.section === "uploads") {
      list = uploadRows(views, request.filters);
    } else {
      list = failureRows(views, request.filters).filter((row) => !request.focus
        || (request.focus.kind === "stage" ? row.stageId === request.focus.stageId : row.drillType === request.focus.drill));
    }
    const labelsHash = fingerprint([...labels].sort(([a], [b]) => a.localeCompare(b)));
    // Only the fleet attempts-list cursor depends on focus (D-2026-09-29-27 (4));
    // the page resets this cursor itself when the focus changes.
    const paged = page(list, request.cursor, request.pageSize, fingerprint([caller.uid, "rows", built.key, request.section, labelsHash]));
    const rowKey = { processing: "attempts", uploads: "uploads", failures: "failures" }[request.section];
    const status = built.statuses.get(install) ?? null;
    const builds = new Map();
    const seenBuild = (ref, at, os) => {
      if (!ref?.key) return;
      const entry = builds.get(ref.key) ?? { key: ref.key, label: ref.label, appVersion: ref.appVersion, build: ref.build, osVersions: new Set(), first: null, last: null };
      if (os) entry.osVersions.add(os);
      if (at !== null) { entry.first = entry.first === null ? at : Math.min(entry.first, at); entry.last = entry.last === null ? at : Math.max(entry.last, at); }
      builds.set(ref.key, entry);
    };
    for (const view of built.periodViews) {
      if (view.a.origin === install) seenBuild(view.a.captureBuild, view.a.captureAt ?? view.a.receivedAt, view.a.captureBuild?.os);
      for (const r of view.runs) if (r.executor === install) seenBuild(r.executionBuild, r.occurredAt ?? r.receivedAt, r.executionBuild?.os);
    }
    if (status?.record.executorPlatform) {
      const platform = status.record.executorPlatform;
      seenBuild(buildRef(platform), status.updatedAt ?? null, platform.osVersion);
    }
    const lastReportAt = built.lastSeen(install);
    const origins = built.periodViews.filter((view) => view.a.origin === install);
    const machine = status?.record.executorPlatform?.machine
      ?? origins.map((view) => [view.a.captureMachine?.label, view.a.captureAt ?? 0]).filter(([label]) => label).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const receipts = [status?.firstReceivedAt, ...origins.map((view) => view.a.receivedAt)].filter((v) => typeof v === "number" && Number.isFinite(v));
    return bounded({
      ...built.envelope, generatedAt: generatedAt(),
      device: {
        installId: install, label: labels.get(install)?.label ?? null, labelRevision: labels.get(install)?.labelRevision ?? 0, machine,
        builds: [...builds.values()].sort((a, b) => (a.first ?? 0) - (b.first ?? 0) || a.key.localeCompare(b.key)).slice(0, LIST_LIMITS.builds)
          .map((entry) => ({ key: entry.key, label: entry.label, appVersion: entry.appVersion, build: entry.build, osVersions: [...entry.osVersions].sort(), firstSeenAt: iso(entry.first), lastSeenAt: iso(entry.last) })),
        lastReportAt: iso(lastReportAt),
        notRecentlyReporting: built.notRecent(lastReportAt),
        collectionStartedAt: iso(receipts.length ? Math.min(...receipts) : null),
        lastStatus: status ? {
          reportedAt: iso(status.updatedAt), collectionCapability: status.record.body.collectionCapability,
          repQueuePending: status.record.body.repQueuePending, repQueueFailed: status.record.body.repQueueFailed,
          oldestPendingRepAgeSeconds: status.record.body.oldestPendingRepAgeSeconds, spoolRecordCount: status.record.body.spoolRecordCount,
          droppedRecordCount: status.record.body.droppedRecordCount,
        } : null,
      },
      attribution: request.attribution,
      focus: request.focus,
      rows: { kind: request.section, [rowKey]: paged.rows },
      pagination: paged.pagination,
    });
  }

  async function getAttempt(data, caller) {
    requireAdmin(caller);
    const request = validate.attempt(data);
    const facts = await projection.readCanonical(request.attemptId);
    const attempt = usableFact(facts.attempt, "attemptSummary");
    const own = (fact) => fact && fact.record.attemptId === request.attemptId;
    const runs = facts.runs.map((doc) => usableFact(doc, "runSummary")).filter(own)
      .sort((a, b) => (Date.parse(a.record.occurredAtClient) || 0) - (Date.parse(b.record.occurredAtClient) || 0) || a.record.recordId.localeCompare(b.record.recordId));
    const groups = facts.groups.map((doc) => usableFact(doc, "uploadGroupSummary")).filter(own)
      .sort((a, b) => a.record.recordId.localeCompare(b.record.recordId));
    const transfers = facts.transfers.map((doc) => usableFact(doc, "transferInvocation")).filter(own)
      .sort((a, b) => (Date.parse(a.record.occurredAtClient) || 0) - (Date.parse(b.record.occurredAtClient) || 0)
        || a.record.body.outerCommitOrdinal - b.record.body.outerCommitOrdinal || a.record.body.objectOrdinal - b.record.body.objectOrdinal
        || a.record.recordId.localeCompare(b.record.recordId));
    if (!own(attempt) && !runs.length && !groups.length && !transfers.length) {
      throw new HttpsError("not-found", "No performance facts are stored for this attempt.");
    }
    const print = fingerprint([caller.uid, "transfers", request.attemptId, transfers.map((t) => [t.record.recordId, t.record.revision])]);
    const paged = page(transfers, request.cursor, TRANSFER_PAGE_SIZE, print);
    const installs = [...new Set([attempt, ...runs, ...groups, ...transfers].filter(own)
      .flatMap((fact) => [fact.record.originInstallId, fact.record.executorInstallId]).filter(Boolean))].sort().slice(0, LIST_LIMITS.detailDevices);
    const labelDocs = await Promise.all(installs.map((install) => projection.refs.labels.doc(install).get()));
    const failureCases = await db.collection("failureCases").where("attemptId", "==", request.attemptId).limit(LIST_LIMITS.evidence).get();
    const indexAvailability = evidenceAvailability(facts.index, "processingAttempt");
    const evidence = [
      { kind: "processingAttempt", id: request.attemptId, availability: indexAvailability },
      ...runs.map((run) => ({ kind: "run", id: run.record.processingRunId, availability: indexAvailability })),
      ...failureCases.docs.map((doc) => ({ kind: "failureCase", id: doc.id, availability: evidenceAvailability(doc.data(), "failureCase") })),
    ].slice(0, LIST_LIMITS.evidence);
    return bounded({
      schemaVersion: REPORT_SCHEMA_VERSION,
      generatedAt: generatedAt(),
      attemptId: request.attemptId,
      attempt: own(attempt) ? attempt.record : null,
      runs: runs.slice(0, LIST_LIMITS.detailRuns).map((fact) => fact.record),
      uploadGroups: groups.slice(0, LIST_LIMITS.detailGroups).map((fact) => fact.record),
      transfers: paged.rows.map((fact) => fact.record),
      transferPagination: paged.pagination,
      receivedAt: { firstReceivedAtServer: iso(own(attempt) ? attempt.receivedAt : null), updatedAtServer: iso(own(attempt) ? attempt.updatedAt : null) },
      devices: installs.map((install, index) => ({ installId: install, label: labelDocs[index].exists ? labelDocs[index].data().label ?? null : null })),
      evidence,
    });
  }

  async function setLabel(data, caller) {
    requireAdmin(caller);
    const request = validate.label(data);
    const ref = projection.refs.labels.doc(request.installId);
    const existing = await ref.get();
    if (!existing.exists && !await projection.installKnown(request.installId)) {
      throw new HttpsError("not-found", "No device with this install id has reported.");
    }
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = snapshot.exists ? snapshot.data() : null;
      const revision = current?.labelRevision ?? 0;
      if (request.expectedRevision !== revision) {
        throw new HttpsError("failed-precondition", "The label changed. Reload and try again.", { errorCode: "labelRevisionConflict", labelRevision: revision });
      }
      const next = revision + 1, atMillis = now();
      // The alias is admin data, stored apart from every client measurement.
      tx.set(ref, { installId: request.installId, label: request.label, labelRevision: next, updatedAtMillis: atMillis, updatedByUid: caller.uid });
      tx.create(projection.refs.labelAudit.doc(randomUUID()), {
        installId: request.installId, previousLabel: current?.label ?? null, label: request.label, previousRevision: revision,
        labelRevision: next, actorUid: caller.uid, atMillis, at: FieldValue.serverTimestamp(),
      });
      return { schemaVersion: REPORT_SCHEMA_VERSION, installId: request.installId, label: request.label, labelRevision: next };
    });
  }

  return { getFleet, getDetail, getAttempt, setLabel, projection, clearCache: () => cache.clear() };
}


// processingAttempts / failureCases retention -> evidence availability.
function evidenceAvailability(doc, kind) {
  if (!doc) return "notCollected";
  const state = doc.retentionState ?? "active";
  if (state === "expired" || state === "allDeleting") return "expired";
  if (kind === "failureCase") return doc.artifactUploadState === "complete" ? "available" : "pending";
  return doc.artifactsAcknowledgedAt ? "available" : "pending";
}

function sortDevices(rows, sort) {
  const typical = (stat) => (stat.sample > 0 ? stat.typicalMs : -1);
  const comparable = (stat) => stat.sample >= LIMITED_DATA_SAMPLES && stat.eligible >= LIMITED_DATA_SAMPLES;
  const known = (row) => knownOutcomes(row.outcomes);
  const rate = (row) => (known(row) ? row.outcomes.failed / known(row) : -1);
  const tiebreak = (a, b) => (a.installId ?? "").localeCompare(b.installId ?? "");
  const unknownLast = (a, b) => (a.installId === null) - (b.installId === null);
  const orders = {
    attention: (a, b) => (comparable(b.timeToResult) || known(b) >= LIMITED_DATA_SAMPLES) - (comparable(a.timeToResult) || known(a) >= LIMITED_DATA_SAMPLES)
      || b.outcomes.failed - a.outcomes.failed || typical(b.timeToResult) - typical(a.timeToResult) || (b._lastReport ?? 0) - (a._lastReport ?? 0),
    slowResult: (a, b) => comparable(b.timeToResult) - comparable(a.timeToResult) || typical(b.timeToResult) - typical(a.timeToResult),
    failureRate: (a, b) => (known(b) >= LIMITED_DATA_SAMPLES) - (known(a) >= LIMITED_DATA_SAMPLES) || rate(b) - rate(a) || b.outcomes.failed - a.outcomes.failed,
    failureCount: (a, b) => b.outcomes.failed - a.outcomes.failed || rate(b) - rate(a),
    uploadWait: (a, b) => comparable(b.uploadWait) - comparable(a.uploadWait) || typical(b.uploadWait) - typical(a.uploadWait),
    lastSeen: (a, b) => (a._lastReport ?? -Infinity) - (b._lastReport ?? -Infinity),
  };
  return [...rows].sort((a, b) => unknownLast(a, b) || orders[sort](a, b) || tiebreak(a, b));
}

// ---------------------------------------------------------------------------
// Callables: 1st gen, us-central1 (the default region), plan 07's 512 MiB /
// 120 s budget; 1st gen serves one request per instance.

const services = new WeakMap();
const HANDLERS = Object.freeze({
  getDevicePerformanceV1: "getFleet",
  getDevicePerformanceDetailV1: "getDetail",
  getDevicePerformanceAttemptV1: "getAttempt",
  setDevicePerformanceLabelV1: "setLabel",
});
function createDevicePerformanceCallable(name, functions, admin, requireCaller) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown device performance callable ${name}`);
  if (!services.has(admin)) {
    services.set(admin, createDevicePerformanceReports({
      db: admin.firestore(), HttpsError: functions.https.HttpsError, FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp,
    }));
  }
  const service = services.get(admin);
  // App Check is not enforced, matching every callable here (D-2026-09-29-11a).
  return functions.runWith({ timeoutSeconds: 120, memory: "512MB" }).https.onCall((data, context) => service[handler](data || {}, requireCaller(context)));
}

module.exports = {
  createDevicePerformanceReports, createDevicePerformanceCallable, quantile, StatBuilder, sortDevices, effectiveFilters, evidenceAvailability,
  METRIC_DEFINITIONS, REPORT_SCHEMA_VERSION, SIZE_BANDS, UPLOAD_ROLES, FILTER_KEYS, SHARED_FILTERS, RUN_FILTERS, UPLOAD_FILTERS, HANDLERS,
  MAX_RANGE_DAYS, PAGE_SIZE, TRANSFER_PAGE_SIZE, MAX_RESPONSE_BYTES, NOT_RECENT_MS, UNKNOWN_INSTALL,
};
