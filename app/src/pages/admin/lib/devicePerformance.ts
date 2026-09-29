// Device performance — the admin data library behind /admin/device-performance
// (plan PROCESSING_PERF_07 §3 "Binding measurement definitions", §6 "Read API",
// §7 "Admin interface"; contract PROCESSING_PERF_CONTRACTS_V1 §8, whose
// machine-readable copy is byte-copied under __fixtures__/device-performance-v1).
//
// The four reporting callables do not exist yet (backend task T1.3). The
// response types below are this page's side of that interface: they follow
// the contract's record shapes and the plan's getDevicePerformanceV1 sketch.
// Every assumption the backend must match is listed in the T1.4 return.
//
// Rules this module enforces, each with a test in devicePerformance.test.ts:
// - a response whose schemaVersion (or an embedded record whose
//   performanceSchemaVersion) is not 1 is refused, never guessed at;
// - a missing measurement is null with a reason, never zero;
// - fewer than 20 measured samples is "Limited data" and hides the slow tail;
// - upload filters never reach processing, capture or yield metrics;
// - any filter, period, sort or search change drops the paging cursor;
// - the preview module is reachable only from a DEV build, and a live
//   failure is reported as a failure, never replaced with preview data.

// MARK: - Contract vocabularies (schema.json $defs; tolerant: unknown values render verbatim)

export const PERFORMANCE_SCHEMA_VERSION = 1;
export const REPORT_SCHEMA_VERSION = 1;

export const DRILL_TYPES = ["jump", "deadballShot", "sprint", "broadJump", "changeOfDirection", "dribbling", "freeRecord"] as const;
export type DrillType = typeof DRILL_TYPES[number];
export const RECORDING_MODES = ["ordinary", "station"] as const;
export type RecordingMode = typeof RECORDING_MODES[number];
export const PROCESSING_MODES = ["liveCapture", "debugReview", "recovery", "validation", "fixture"] as const;
export type ProcessingMode = typeof PROCESSING_MODES[number];
export const NETWORK_INTERFACES = ["wifi", "cellular", "wiredEthernet", "loopback", "other", "none", "unknown"] as const;
export type NetworkInterface = typeof NETWORK_INTERFACES[number];
/** Upload roles are the contract's upload-group categories; the plan always reports them apart. */
export const UPLOAD_ROLES = ["resultFiles", "optionalVideo", "legacyVideo", "diagnostics"] as const;
export type UploadRole = typeof UPLOAD_ROLES[number];
/** Non-overlapping main phases between movie finalized and local acceptance (contract §1.3). */
export const MAIN_PHASES = ["preparation", "waiting", "analysis", "calculation", "localSaving"] as const;
export type MainPhase = typeof MAIN_PHASES[number];
export const MISSING_REASONS = [
  "notCollectedByThisVersion", "crossLaunch", "clockUnavailable", "notReached", "notApplicable",
  "droppedOnSaturation", "truncated", "interrupted", "unavailable", "pendingUpload",
] as const;
export type MissingReason = typeof MISSING_REASONS[number];
export type ClockQuality = "reliable" | "uncertain" | "future" | "unavailable";
export type Completeness = "complete" | "partial" | "pending";
export type RunOutcome = "valid" | "partial" | "noMeasurement" | "failed" | "cancelled" | "interruptedUnknown";
export type MeasurementVerdict = "pending" | "valid" | "invalid";
export type DateBasis = "capture" | "serverReceipt";
export type Attribution = "origin" | "executor";
export type DeviceSection = "processing" | "uploads" | "failures";

// MARK: - Plain-language labels

export const DRILL_LABELS: Record<DrillType, string> = {
  jump: "Jump",
  deadballShot: "Shooting",
  sprint: "Sprint",
  broadJump: "Broad jump",
  changeOfDirection: "Change of direction",
  dribbling: "Dribbling",
  freeRecord: "Free record",
};
/** Free record is validation plus a raw upload, never local drill processing. */
export const DRILL_ROW_LABELS: Record<DrillType, string> = { ...DRILL_LABELS, freeRecord: "Free record (validation and upload)" };
export const RECORDING_MODE_LABELS: Record<RecordingMode, string> = { ordinary: "Ordinary recording", station: "Testing station" };
export const PROCESSING_MODE_LABELS: Record<ProcessingMode, string> = {
  liveCapture: "Live capture", debugReview: "Debug review", recovery: "Recovery after relaunch", validation: "Validation", fixture: "Fixture",
};
export const NETWORK_LABELS: Record<NetworkInterface, string> = {
  wifi: "Wi-Fi", cellular: "Cellular", wiredEthernet: "Wired", loopback: "Loopback", other: "Other network", none: "No network", unknown: "Unknown network",
};
export const UPLOAD_ROLE_LABELS: Record<UploadRole, string> = {
  resultFiles: "Result files", optionalVideo: "Video archives", legacyVideo: "Free-record video", diagnostics: "Diagnostics",
};
export const PHASE_LABELS: Record<MainPhase | "unattributed", string> = {
  preparation: "Preparing the clip",
  waiting: "Waiting for inputs and the processor",
  analysis: "Video analysis",
  calculation: "Calculation",
  localSaving: "Saving on the phone",
  unattributed: "Unattributed",
};
export const MISSING_REASON_LABELS: Record<MissingReason, string> = {
  notCollectedByThisVersion: "Not collected by this app version",
  crossLaunch: "Spans an app relaunch, so the time between launches is unknown",
  clockUnavailable: "The phone's clock reading was unavailable",
  notReached: "The step was not reached",
  notApplicable: "Not applicable",
  droppedOnSaturation: "Dropped because the phone's report storage was full",
  truncated: "Shortened to fit the report size limit",
  interrupted: "Interrupted: the app closed or was suspended",
  unavailable: "Unavailable",
  pendingUpload: "Still uploading",
};
export const OUTCOME_LABELS: Record<RunOutcome, string> = {
  valid: "Valid", partial: "Partial", noMeasurement: "No measurement", failed: "Failed", cancelled: "Cancelled", interruptedUnknown: "Interrupted, outcome unknown",
};
export const VERDICT_LABELS: Record<string, string> = {
  valid: "Usable result", invalid: "No usable result", pending: "Still recoverable",
  noMeasurement: "no measurement", wrongSide: "wrong side", processingFailed: "processing failed", userDiscarded: "discarded by the user",
  awaitingRetry: "awaiting retry", interrupted: "interrupted",
};
export const SAVE_STATE_LABELS: Record<string, string> = {
  notQueued: "Not queued", queued: "Queued", committed: "Saved", failed: "Failed", cancelled: "Cancelled", notApplicable: "Not applicable",
  notRequested: "Not requested", pending: "Pending", uploaded: "Uploaded", unavailable: "Unavailable (clip no longer on the phone)",
  inProgress: "Uploading",
};
export const EVIDENCE_LABELS: Record<string, string> = {
  available: "Available", pending: "Not uploaded yet", expired: "Expired under the retention policy", notCollected: "Not collected",
};

export const label = (map: Record<string, string>, value: string | null | undefined, fallback = "Unknown") =>
  value === null || value === undefined ? fallback : map[value] ?? value;

// Friendly step names for "Failures by step" and the attempt timeline. The raw
// stage id stays available behind an expandable detail.
const STAGE_NAMES: Record<string, string> = {
  "capture.stopRequested": "Stopping the recording",
  "capture.movieFinalized": "Finishing the video file",
  "capture.cameraStopAck": "Stopping the camera",
  "capture.retainCopyHash": "Keeping a copy of the clip",
  "capture.calibrationFreeze": "Saving calibration evidence",
  "capture.snapshot": "Saving the capture settings",
  "capture.referenceJournal": "Recording the clip reference",
  "clip.retain": "Keeping a copy of the clip",
  "input.calibration": "Loading calibration",
  "input.mass": "Looking up athlete weight",
  "admission.requested": "Waiting for the processor",
  "admission.queue": "Waiting for the processor",
  "admission.granted": "Starting processing",
  "model.create": "Loading a model",
  "model.firstPrediction": "First model prediction",
  "kick.extract": "Tracking the player",
  "kick.denseBall": "Finding the ball",
  "kick.motionContact": "Detecting ball contact",
  "sprint.extract": "Tracking the sprint",
  "jump.extract": "Tracking the jump",
  "broadJump.extract": "Tracking the jump",
  "cod.extract": "Tracking movement",
  "artifact.persist": "Saving the result on the phone",
  "accept.manifestAck": "Queueing the result for upload",
  "accept.announce": "Announcing the result",
  "accept.correctionWindow": "Station correction window",
  "accept.progressAck": "Saving station progress",
  "flow.nextReady": "Getting ready for the next rep",
  "memory.checkpoint": "Memory check",
  processing: "Processing",
};
const STAGE_PATTERNS: [RegExp, string][] = [
  [/^poseValidation\./, "Checking the free-record video"],
  [/^capture\./, "Recording the clip"],
  [/^(calibration\.|recovery\.calibrationHash$)|\.calibrationPreflight$/, "Checking calibration"],
  [/\.beforeModel$/, "Preparing the models"],
  [/\.extract$/, "Tracking movement in the video"],
  [/\.math$/, "Calculating the result"],
  [/\.encode$/, "Preparing result files"],
  [/\.commitPayload$|^prepared(Artifact|Payload)\./, "Saving the result on the phone"],
  [/^reader\./, "Reading the video"],
  [/^journal\./, "Recording processing progress"],
  [/session/i, "Updating the session"],
  [/^(repUpload|upload)\./, "Saving result files"],
  [/^recovery\./, "Recovering after a relaunch"],
  [/^diagnostics\./, "Diagnostics bookkeeping"],
  [/^(system|telemetry|setup)\./, "App bookkeeping"],
];
export function stageLabel(stageId: string | null | undefined): string {
  if (!stageId) return "Unknown step";
  return STAGE_NAMES[stageId] ?? STAGE_PATTERNS.find(([pattern]) => pattern.test(stageId))?.[1] ?? "Other step";
}

const FAILURE_EXPLANATIONS: Record<string, string> = {
  memory_pressure: "The phone ran low on memory.",
  storage_capacity: "The phone ran out of storage space.",
  decode_setup_failed: "The video could not be opened.",
  decode_read_failed: "The video could not be read.",
  invalid_input: "The recording or its inputs were not usable.",
  calibration_unavailable: "Calibration was not available.",
  calibration_incompatible: "Calibration did not match this recording.",
  model_initialization_failed: "A model could not be loaded.",
  algorithm_failed: "The analysis could not produce a result.",
  persistence_failed: "The result could not be saved on the phone.",
  cancelled: "Processing was cancelled.",
  unsupported_drill: "This app version does not process this drill.",
};
const LAYER_EXPLANATIONS: Record<string, string> = {
  input: "A problem with the recording's inputs.",
  decoder: "A problem reading the video.",
  model: "A problem with a model.",
  algorithm: "The analysis could not produce a result.",
  resource: "The phone ran short of memory or storage.",
  persistence: "A problem saving on the phone.",
  runtime: "The app stopped the work.",
};
/** A safe explanation built only from the typed code and layer, never from phone-supplied text. */
export function failureExplanation(code: string | null | undefined, layer?: string | null): string {
  return (code && FAILURE_EXPLANATIONS[code]) || (layer && LAYER_EXPLANATIONS[layer]) || "The phone reported an unclassified failure.";
}

// MARK: - Metric definitions (plan 07 §3, contract §8.4) — shown in full on the page, never tooltip-only

export interface MetricDefinition { key: string; label: string; definition: string }
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: "timeToResult", label: "Time to result", definition: "From the moment the video file is finalized to the moment the result is saved durably on the phone. Only accepted attempts with both endpoints count. Recording time and cloud delivery are not included." },
  { key: "processingTime", label: "Processing time", definition: "From the processor admitting the run to the processor returning. Valid, partial, failed and recovery runs are reported separately, and saving the run journal is timed on its own." },
  { key: "readyForNextRep", label: "Ready for next rep", definition: "From the stop request to the next gate or capture being ready. Correction, speech and progress waits are shown separately." },
  { key: "cloudSave", label: "Cloud save time", definition: "From the durable result job being queued to the required result files and the rep and session records being confirmed in the cloud. Video archive, sidecar and diagnostics delivery are separate." },
  { key: "waitingToUpload", label: "Waiting to upload", definition: "From an upload being queued to its first actual transfer starting. Time the app spent waiting to retry is a separate total." },
  { key: "uploadDuration", label: "Upload duration", definition: "One Storage upload task or PUT, from its start to its final callback." },
  { key: "uploadSpeed", label: "Upload speed", definition: "Successful payload bytes divided by measured seconds, in decimal MB/s, for one upload role at a time. The total is weighted effective throughput: all bytes over all seconds, never an average of device speeds. Failed transfers and zero or unknown durations are left out and counted. It is what the app observed, not the radio's capacity." },
  { key: "saveConfirmed", label: "Save confirmed after recording", definition: "From the video file being finalized to the required cloud save, only when both ends were measured in the same app launch. Across a relaunch the time between launches is shown as an unknown gap." },
  { key: "failureRate", label: "Processing failures", definition: "Failed runs divided by known outcomes: valid, partial, no measurement and failed runs. Cancelled, interrupted and pending runs, and failures before processing started, are shown beside it but not counted." },
  { key: "yield", label: "Usable results", definition: "Attempts with a valid measurement divided by attempts whose measurement is final, leaving out attempts the user discarded. First-run and eventual results are shown separately." },
  { key: "failureAtStep", label: "Failures by step", definition: "Failures attributed to a step divided by the runs that entered it. When the phone only reported the last step it reached, that is shown separately and is not a confirmed failure." },
  { key: "typicalSlow", label: "Typical and slow", definition: "Typical is the median and slow is the 90th percentile, both pooled across every matching observation. With fewer than 20 measured samples the value is marked Limited data and no slow value is shown." },
];

// MARK: - Statistics and formatting

export const LIMITED_DATA_MIN_SAMPLES = 20;

export interface CountedReason { reason: string; count: number }
/** Every statistic carries its counts (contract §8.4). eligible = sample + missing. */
export interface DistributionStatV1 {
  eligible: number;
  sample: number;
  missing: number;
  excluded: number;
  typicalMs: number | null;
  slowMs: number | null;
  missingReasons: CountedReason[];
  excludedReasons: CountedReason[];
}

export type StatView =
  | { kind: "value"; typicalMs: number; slowMs: number | null; limited: boolean; stat: DistributionStatV1 }
  | { kind: "missing"; reason: string; stat: DistributionStatV1 }
  | { kind: "none"; stat: DistributionStatV1 };

/** Limited data counts measured samples: a median of 5 values out of 100 eligible is still 5 values. */
export function isLimitedData(stat: Pick<DistributionStatV1, "sample">): boolean {
  return stat.sample < LIMITED_DATA_MIN_SAMPLES;
}

/**
 * How one statistic is displayed. Nothing measured is never shown as zero: it
 * is either "no matching observations" or "missing, because …". Limited data
 * keeps the typical value and hides the slow tail.
 */
export function statView(stat: DistributionStatV1): StatView {
  if (stat.sample > 0 && stat.typicalMs !== null) {
    const limited = isLimitedData(stat);
    return { kind: "value", typicalMs: stat.typicalMs, slowMs: limited ? null : stat.slowMs, limited, stat };
  }
  if (stat.eligible > 0 || stat.missing > 0) {
    const top = [...stat.missingReasons].sort((a, b) => b.count - a.count)[0];
    return { kind: "missing", reason: top ? missingReasonLabel(top.reason) : "Not measured", stat };
  }
  return { kind: "none", stat };
}

export function missingReasonLabel(reason: string | null | undefined): string {
  return label(MISSING_REASON_LABELS, reason, "Not measured");
}

/** Milliseconds for display. null stays "Not measured", never "0 ms". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "Not measured";
  if (ms === 0) return "0 ms";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000), seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return seconds === 60 ? `${minutes + 1} min` : `${minutes} min ${seconds} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Decimal units, as the plan requires for MB/s. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "Not measured";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 2 : 1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function formatCount(value: number): string { return value.toLocaleString("en-US"); }

export function formatPercent(numerator: number, denominator: number): string {
  if (!denominator) return "No known outcomes";
  const value = (numerator / denominator) * 100;
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}

/** Σ successful payload bytes ÷ Σ measured seconds (decimal MB/s); null when no measured seconds. */
export function weightedThroughputMBps(payloadBytes: number, elapsedMs: number): number | null {
  if (!Number.isFinite(payloadBytes) || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || payloadBytes < 0) return null;
  return payloadBytes / 1_000_000 / (elapsedMs / 1000);
}
export function formatMBps(value: number | null): string {
  if (value === null) return "Not measured";
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} MB/s`;
}

export function shortInstallId(installId: string | null | undefined): string {
  return installId ? installId.slice(0, 8) : "unknown";
}

// MARK: - Response types (the read API; backend task T1.3 must match these)

export interface ChoiceV1 { key: string; label: string; count: number }
export interface DevicePerformanceFilters {
  drill: DrillType | null;
  recordingMode: RecordingMode | null;
  captureBuild: string | null;
  captureMachine: string | null;
  processingMode: ProcessingMode | null;
  executionBuild: string | null;
  executionMachine: string | null;
  networkInterface: NetworkInterface | null;
  /** Always one role: upload speed is never mixed across roles. */
  uploadRole: UploadRole;
  payloadSizeBand: string | null;
}
export type FilterKey = keyof DevicePerformanceFilters;
export type MetricGroup = "capture" | "processing" | "yield" | "cloudSave" | "upload";

export interface PeriodV1 { startDate: string; endDate: string; timeZone: string; dateBasis: DateBasis }
export interface FreshnessV1 { sourceUpdatedAt: string | null; lastReportReceivedAt: string | null }
export interface CoverageV1 {
  /** null: no phone has ever sent device-performance reports (the "not collected" state). */
  collectionStartedAt: string | null;
  installsKnown: number;
  installsNotRecentlyReporting: number;
  /** Known indexed attempts in the cohort; the only denominator coverage percentages may use. */
  attemptsIndexed: number;
  attemptsPartial: number;
  attemptsNotCollectedByVersion: number;
  attemptsDateUncertain: number;
  attemptsUnknownDevice: number;
  droppedDetailCount: number;
}
export interface ChoicesV1 {
  captureBuilds: ChoiceV1[];
  captureMachines: ChoiceV1[];
  executionBuilds: ChoiceV1[];
  executionMachines: ChoiceV1[];
  payloadSizeBands: ChoiceV1[];
}
export interface OutcomeCountsV1 {
  valid: number;
  partial: number;
  noMeasurement: number;
  failed: number;
  cancelled: number;
  interruptedUnknown: number;
  pending: number;
  /** Invocations that ended before a run existed (contract §8.2); never in the rate. */
  preAdmissionFailures: number;
}
export interface YieldCountsV1 {
  valid: number;
  /** invalid verdicts other than userDiscarded */
  invalid: number;
  pending: number;
  userDiscarded: number;
  firstRunValid: number;
}
export interface UploadRoleStatV1 {
  role: UploadRole;
  /** Attempts whose settings did not ask for this role (for example archive off): "Not requested", not 0 MB/s. */
  notRequested: number;
  invocations: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  interrupted: number;
  pending: number;
  excludedZeroOrUnknownDuration: number;
  /** Σ payload bytes of successful invocations with a measured duration. */
  payloadBytes: number;
  /** Σ measured invocation milliseconds of those same invocations. */
  elapsedMs: number;
  duration: DistributionStatV1;
  queueWait: DistributionStatV1;
  knownBackoffMs: number | null;
}
export interface CloudBacklogV1 { pendingJobs: number; failedJobs: number; installsReporting: number; oldestReportAt: string | null }
export interface ProcessingTimeV1 { valid: DistributionStatV1; partial: DistributionStatV1; failed: DistributionStatV1; recovery: DistributionStatV1 }
export interface TotalsV1 {
  attempts: number;
  timeToResult: DistributionStatV1;
  readyForNextRep: DistributionStatV1;
  saveConfirmedAfterRecording: DistributionStatV1;
  processingTime: ProcessingTimeV1;
  cloudSave: DistributionStatV1;
  cloudBacklog: CloudBacklogV1;
  /** All four roles, always present. */
  uploads: UploadRoleStatV1[];
  outcomes: OutcomeCountsV1;
  yield: YieldCountsV1;
}
export interface PhaseMeanV1 { phase: MainPhase; meanMs: number | null }
export interface AllocationV1 { cohortSize: number; meanTimeToResultMs: number | null; phases: PhaseMeanV1[] }
export interface DrillRowV1 {
  drillType: DrillType;
  attempts: number;
  timeToResult: DistributionStatV1;
  /** Means from ONE same-cohort population (never stacked medians); null when the cohort is empty. */
  allocation: AllocationV1 | null;
  outcomes: OutcomeCountsV1;
}
export interface TrendPointV1 { date: string; attempts: number; timeToResult: DistributionStatV1; failed: number; knownOutcomes: number; newBuilds: string[] }
export interface FailureStageRowV1 {
  stageId: string;
  failures: number;
  entered: number;
  cancelled: number;
  unavailable: number;
  /** Attempts whose last reported step is this one without a confirmed failure. */
  lastReportedOnly: number;
  drills: DrillType[];
}
export interface BuildV1 { key: string; label: string }
export interface DeviceRowV1 {
  /** null: attempts recorded before install identity existed ("Unknown device"). */
  installId: string | null;
  label: string | null;
  machine: string | null;
  builds: BuildV1[];
  attempts: number;
  runs: number;
  lastReportAt: string | null;
  notRecentlyReporting: boolean;
  timeToResult: DistributionStatV1;
  cloudSave: DistributionStatV1;
  uploadWait: DistributionStatV1;
  outcomes: OutcomeCountsV1;
}
export interface AttemptRowV1 {
  attemptId: string;
  originInstallId: string | null;
  deviceLabel: string | null;
  machine: string | null;
  drillType: string;
  recordingMode: string | null;
  captureOccurredAt: string | null;
  clockQuality: ClockQuality;
  receivedAt: string | null;
  captureBuild: string | null;
  executionBuilds: string[];
  measurementVerdict: MeasurementVerdict;
  verdictReason: string | null;
  runCount: number;
  timeToResultMs: number | null;
  timeToResultMissing: string | null;
  cloudSaveMs: number | null;
  cloudSaveMissing: string | null;
  requiredSaveState: string;
  archiveState: string;
  /** Confirmed failure step; lastReportedStageId is used when a failure is not confirmed. */
  failureStageId: string | null;
  lastReportedStageId: string | null;
  completeness: Completeness;
}
export interface UploadRowV1 {
  attemptId: string;
  groupId: string;
  role: UploadRole;
  drillType: string;
  occurredAt: string | null;
  clockQuality: ClockQuality;
  jobState: string;
  objectCount: number;
  bytes: number;
  queueWaitMs: number | null;
  transferMs: number | null;
  cloudSaveMs: number | null;
  transferAttempts: number;
  failedTransfers: number;
  lifetimeRetries: number;
  requiredCommitAcknowledged: boolean | null;
}
export interface FailureRowV1 {
  attemptId: string;
  processingRunId: string | null;
  stageId: string;
  failureCode: string | null;
  failureLayer: string | null;
  /** false: only the last reported step is known (interruption or uncertainty). */
  confirmed: boolean;
  occurredAt: string | null;
  clockQuality: ClockQuality;
  drillType: string;
  build: string | null;
}
export interface PaginationV1 { pageSize: number; nextCursor: string | null; totalRows: number }
export type FocusV1 = { kind: "stage"; stageId: string } | { kind: "phase"; drill: DrillType; phase: MainPhase | "unattributed" };

export interface ReportEnvelopeV1 {
  schemaVersion: 1;
  generatedAt: string;
  projectionRevision: string;
  period: PeriodV1;
  filters: DevicePerformanceFilters;
  /** Which filter keys the server applied to each metric group (plan 07 §3). */
  effectiveFilters: Record<MetricGroup, FilterKey[]>;
  freshness: FreshnessV1;
  coverage: CoverageV1;
  choices: ChoicesV1;
  totals: TotalsV1;
  perDrill: DrillRowV1[];
  trends: TrendPointV1[];
  failureStages: FailureStageRowV1[];
}
export interface FleetReportV1 extends ReportEnvelopeV1 {
  devices: DeviceRowV1[];
  pagination: PaginationV1;
  focus: FocusV1 | null;
  attempts: AttemptRowV1[] | null;
  attemptPagination: PaginationV1 | null;
}
export interface DeviceBuildV1 extends BuildV1 { appVersion: string; build: string; osVersions: string[]; firstSeenAt: string | null; lastSeenAt: string | null }
export interface DeviceStatusSummaryV1 {
  reportedAt: string | null;
  collectionCapability: string;
  repQueuePending: number;
  repQueueFailed: number;
  oldestPendingRepAgeSeconds: number | null;
  spoolRecordCount: number;
  droppedRecordCount: number;
}
export interface DeviceHeaderV1 {
  installId: string;
  label: string | null;
  labelRevision: number;
  machine: string | null;
  builds: DeviceBuildV1[];
  lastReportAt: string | null;
  notRecentlyReporting: boolean;
  collectionStartedAt: string | null;
  lastStatus: DeviceStatusSummaryV1 | null;
}
export type DeviceRowsV1 =
  | { kind: "processing"; attempts: AttemptRowV1[] }
  | { kind: "uploads"; uploads: UploadRowV1[] }
  | { kind: "failures"; failures: FailureRowV1[] };
export interface DeviceReportV1 extends ReportEnvelopeV1 {
  device: DeviceHeaderV1;
  attribution: Attribution;
  rows: DeviceRowsV1;
  pagination: PaginationV1;
}

// Contract records as the attempt drawer receives them (schema.json recordV1).
export interface PlatformRefV1 { appVersion: string; build: string; sourceRevision: string; machine: string; osVersion: string; configuration: string }
export interface StageSummaryV1 {
  stageId: string;
  parentStageId: string | null;
  passId: string | null;
  status: string;
  invocationCount: number;
  elapsedMs: number | null;
  activeMs: number | null;
  continuousElapsedMs: number | null;
  timingKind: string;
  framesDecoded: number | null;
  modelCalls: number | null;
  missingObservations: number | null;
  failureCode: string | null;
  failureLayer: string | null;
  lastDurableStage: string | null;
}
export interface ClientSpansV1 { timeToResultMs: number | null; readyForNextRepMs: number | null; saveConfirmedAfterRecordingMs: number | null }
export interface AttemptSummaryBodyV1 {
  stages: StageSummaryV1[];
  spans: ClientSpansV1;
  continuousSpans: ClientSpansV1;
  inputSource: { calibration: string; mass: { valueKg: number | null; units: string; source: string; snapshotVersion: number } | null; snapshotIdentityHash: string | null };
  captureFormat: Record<string, number | null>;
  measurementVerdict: MeasurementVerdict;
  verdictReason: string | null;
  stationVerdict: string;
  preAdmissionFailure: { stage: string; failureCode: string; failureLayer: string } | null;
  primaryMetricFinite: boolean | null;
  requiredSaveState: string;
  sidecarState: string;
  archiveState: string;
  runCount: number;
  acceptedRunId: string | null;
  launchSegmentCount: number;
  lifecycleTransitionCount: number;
}
export interface RunSummaryBodyV1 {
  outcome: RunOutcome;
  failure: { code: string; stage: string; disposition: string; layer: string } | null;
  cancellationReason: string | null;
  priority: string;
  reviewRequest: string;
  poseDelegateRequested: string;
  poseDelegateActual: string | null;
  poseDelegateFallbackReason: string | null;
  yoloComputeUnits: string;
  modelCacheState: string;
  stages: StageSummaryV1[];
  passIds: string[];
  totals: { admissionWaitMs: number | null; processingMs: number | null; journalFinalizeMs: number | null; framesDecoded: number | null; modelCalls: number | null };
  resources: { admitted: Record<string, unknown> | null; released: Record<string, unknown> | null; sampledPeakBytes: number | null };
}
export interface UploadGroupSummaryBodyV1 {
  groupId: string;
  category: UploadRole;
  jobState: string;
  uniqueObjectCount: number;
  uniqueObjectBytes: number;
  queueWaitMs: number | null;
  knownBackoffMs: number | null;
  cloudSaveMs: number | null;
  transferAttemptCount: number;
  successfulTransferCount: number;
  failedTransferCount: number;
  lifetimeRetryCount: number;
  requiredCommitAcknowledged: boolean | null;
  firestoreWriteMs: number | null;
}
export interface TransferInvocationBodyV1 {
  invocationId: string;
  logicalObjectId: string;
  groupId: string;
  outerCommitOrdinal: number;
  objectOrdinal: number;
  objectRole: string;
  transport: string;
  payloadBytes: number;
  progressCompletedBytes: number | null;
  queueWaitMs: number | null;
  authorizationMs: number | null;
  invocationElapsedMs: number | null;
  knownBackoffMs: number | null;
  observedPauseMs: number | null;
  sdkInternalRetryCount: number | null;
  networkInterface: string;
  constrained: boolean | null;
  expensive: boolean | null;
  outcome: string;
  providerDomain: string | null;
  providerCode: number | null;
  normalizedFailureCode: string | null;
  failureStage: string | null;
}
export interface PerformanceRecordV1<K extends string, B> {
  performanceSchemaVersion: 1;
  recordKind: K;
  recordId: string;
  revision: number;
  attemptId: string | null;
  processingRunId: string | null;
  retryOfRunId: string | null;
  repId: string | null;
  commitJobId: string | null;
  originInstallId: string | null;
  executorInstallId: string | null;
  originLaunchId: string | null;
  executionLaunchId: string | null;
  stationDeviceId: string | null;
  originReporterUid: string | null;
  drillType: string | null;
  recordingMode: string | null;
  processingMode: string | null;
  originPlatform: PlatformRefV1 | null;
  executorPlatform: PlatformRefV1 | null;
  captureFingerprint: string | null;
  modelFingerprint: string | null;
  policyVersion: { id: string; hash: string; components: Record<string, string> } | null;
  occurredAtClient: string | null;
  captureOccurredAtClient: string | null;
  clockQuality: ClockQuality;
  completeness: Completeness;
  missingReasons: { field: string; reason: string }[];
  droppedDetailCount: number;
  origin: "field" | "evaluation";
  evaluationRunId: string | null;
  body: B;
}
export type AttemptSummaryRecordV1 = PerformanceRecordV1<"attemptSummary", AttemptSummaryBodyV1>;
export type RunSummaryRecordV1 = PerformanceRecordV1<"runSummary", RunSummaryBodyV1>;
export type UploadGroupRecordV1 = PerformanceRecordV1<"uploadGroupSummary", UploadGroupSummaryBodyV1>;
export type TransferRecordV1 = PerformanceRecordV1<"transferInvocation", TransferInvocationBodyV1>;

export interface EvidenceRefV1 { kind: "processingAttempt" | "run" | "failureCase"; id: string; availability: "available" | "pending" | "expired" | "notCollected" }
export interface AttemptDetailV1 {
  schemaVersion: 1;
  generatedAt: string;
  attemptId: string;
  /** null while the attempt fact has not arrived (runs or uploads can arrive first). */
  attempt: AttemptSummaryRecordV1 | null;
  runs: RunSummaryRecordV1[];
  uploadGroups: UploadGroupRecordV1[];
  transfers: TransferRecordV1[];
  transferPagination: PaginationV1;
  receivedAt: { firstReceivedAtServer: string | null; updatedAtServer: string | null };
  devices: { installId: string; label: string | null }[];
  evidence: EvidenceRefV1[];
}
export interface LabelResultV1 { schemaVersion: 1; installId: string; label: string | null; labelRevision: number }

// MARK: - Response parsing: refuse unknown versions, never guess a shape

export type ResponseProblem = "unsupportedVersion" | "malformed";
export class DevicePerformanceResponseError extends Error {
  readonly reason: ResponseProblem;
  readonly path: string;
  constructor(reason: ResponseProblem, message: string, path = "") {
    super(message);
    this.name = "DevicePerformanceResponseError";
    this.reason = reason;
    this.path = path;
  }
}

type Check = (value: unknown, path: string) => void;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function malformed(path: string, expected: string): never {
  throw new DevicePerformanceResponseError("malformed", `The device performance response is malformed at ${path}: expected ${expected}.`, path);
}
const count: Check = (value, path) => { if (!Number.isInteger(value) || (value as number) < 0) malformed(path, "a non-negative integer"); };
const measure: Check = (value, path) => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) malformed(path, "a finite non-negative number"); };
const anyNumber: Check = (value, path) => { if (typeof value !== "number" || !Number.isFinite(value)) malformed(path, "a finite number"); };
const text: Check = (value, path) => { if (typeof value !== "string") malformed(path, "a string"); };
const flag: Check = (value, path) => { if (typeof value !== "boolean") malformed(path, "true or false"); };
const nullable = (check: Check): Check => (value, path) => { if (value !== null) check(value, path); };
const oneOf = (values: readonly string[]): Check => (value, path) => { if (typeof value !== "string" || !values.includes(value)) malformed(path, `one of ${values.join(", ")}`); };
const list = (check: Check, max = 100_000): Check => (value, path) => {
  if (!Array.isArray(value) || value.length > max) malformed(path, `a list of at most ${max}`);
  value.forEach((item, index) => check(item, `${path}[${index}]`));
};
const shape = (fields: Record<string, Check>): Check => (value, path) => {
  if (!isRecord(value)) malformed(path, "an object");
  for (const [key, check] of Object.entries(fields)) check(value[key], `${path}.${key}`);
};
const loose: Check = (value, path) => { if (value !== null && !isRecord(value)) malformed(path, "an object or null"); };

const countedReason = shape({ reason: text, count });
const stat = shape({
  eligible: count, sample: count, missing: count, excluded: count,
  typicalMs: nullable(measure), slowMs: nullable(measure),
  missingReasons: list(countedReason, 32), excludedReasons: list(countedReason, 32),
});
const outcomes = shape({ valid: count, partial: count, noMeasurement: count, failed: count, cancelled: count, interruptedUnknown: count, pending: count, preAdmissionFailures: count });
const choice = shape({ key: text, label: text, count });
const filtersCheck = shape({
  drill: nullable(oneOf(DRILL_TYPES)), recordingMode: nullable(text), captureBuild: nullable(text), captureMachine: nullable(text),
  processingMode: nullable(text), executionBuild: nullable(text), executionMachine: nullable(text),
  networkInterface: nullable(text), uploadRole: oneOf(UPLOAD_ROLES), payloadSizeBand: nullable(text),
});
const uploadRoleStat = shape({
  role: oneOf(UPLOAD_ROLES), notRequested: count, invocations: count, succeeded: count, failed: count, cancelled: count,
  interrupted: count, pending: count, excludedZeroOrUnknownDuration: count, payloadBytes: count, elapsedMs: measure,
  duration: stat, queueWait: stat, knownBackoffMs: nullable(measure),
});
const pagination = shape({ pageSize: count, nextCursor: nullable(text), totalRows: count });
const attemptRow = shape({
  attemptId: text, originInstallId: nullable(text), deviceLabel: nullable(text), machine: nullable(text), drillType: text,
  recordingMode: nullable(text), captureOccurredAt: nullable(text), clockQuality: text, receivedAt: nullable(text),
  captureBuild: nullable(text), executionBuilds: list(text, 64), measurementVerdict: oneOf(["pending", "valid", "invalid"]),
  verdictReason: nullable(text), runCount: count, timeToResultMs: nullable(measure), timeToResultMissing: nullable(text),
  cloudSaveMs: nullable(measure), cloudSaveMissing: nullable(text), requiredSaveState: text, archiveState: text,
  failureStageId: nullable(text), lastReportedStageId: nullable(text), completeness: text,
});
const focusCheck: Check = (value, path) => {
  if (value === null) return;
  if (!isRecord(value)) malformed(path, "an object or null");
  if (value.kind === "stage") shape({ stageId: text })(value, path);
  else if (value.kind === "phase") shape({ drill: oneOf(DRILL_TYPES), phase: oneOf([...MAIN_PHASES, "unattributed"]) })(value, path);
  else malformed(`${path}.kind`, "stage or phase");
};
const metricGroupList = list(text, 16);
const envelopeFields: Record<string, Check> = {
  generatedAt: text,
  projectionRevision: text,
  period: shape({ startDate: text, endDate: text, timeZone: text, dateBasis: oneOf(["capture", "serverReceipt"]) }),
  filters: filtersCheck,
  effectiveFilters: shape({ capture: metricGroupList, processing: metricGroupList, yield: metricGroupList, cloudSave: metricGroupList, upload: metricGroupList }),
  freshness: shape({ sourceUpdatedAt: nullable(text), lastReportReceivedAt: nullable(text) }),
  coverage: shape({
    collectionStartedAt: nullable(text), installsKnown: count, installsNotRecentlyReporting: count, attemptsIndexed: count,
    attemptsPartial: count, attemptsNotCollectedByVersion: count, attemptsDateUncertain: count, attemptsUnknownDevice: count, droppedDetailCount: count,
  }),
  choices: shape({ captureBuilds: list(choice, 500), captureMachines: list(choice, 500), executionBuilds: list(choice, 500), executionMachines: list(choice, 500), payloadSizeBands: list(choice, 32) }),
  totals: shape({
    attempts: count, timeToResult: stat, readyForNextRep: stat, saveConfirmedAfterRecording: stat,
    processingTime: shape({ valid: stat, partial: stat, failed: stat, recovery: stat }),
    cloudSave: stat,
    cloudBacklog: shape({ pendingJobs: count, failedJobs: count, installsReporting: count, oldestReportAt: nullable(text) }),
    uploads: list(uploadRoleStat, UPLOAD_ROLES.length),
    outcomes,
    yield: shape({ valid: count, invalid: count, pending: count, userDiscarded: count, firstRunValid: count }),
  }),
  perDrill: list(shape({
    drillType: oneOf(DRILL_TYPES), attempts: count, timeToResult: stat, outcomes,
    allocation: nullable(shape({ cohortSize: count, meanTimeToResultMs: nullable(measure), phases: list(shape({ phase: oneOf(MAIN_PHASES), meanMs: nullable(measure) }), MAIN_PHASES.length) })),
  }), DRILL_TYPES.length),
  trends: list(shape({ date: text, attempts: count, timeToResult: stat, failed: count, knownOutcomes: count, newBuilds: list(text, 16) }), 400),
  failureStages: list(shape({ stageId: text, failures: count, entered: count, cancelled: count, unavailable: count, lastReportedOnly: count, drills: list(text, 16) }), 200),
};

function requireVersion(raw: unknown, what: string): Record<string, unknown> {
  if (!isRecord(raw)) malformed(what, "an object");
  if (raw.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new DevicePerformanceResponseError("unsupportedVersion",
      `The ${what} uses format version ${JSON.stringify(raw.schemaVersion ?? null)}, which this page does not understand. Reload the page to get the current admin console.`,
      `${what}.schemaVersion`);
  }
  return raw;
}

export function parseFleetReport(raw: unknown): FleetReportV1 {
  const value = requireVersion(raw, "report");
  shape({ ...envelopeFields, devices: list(shape({
    installId: nullable(text), label: nullable(text), machine: nullable(text), builds: list(shape({ key: text, label: text }), 64),
    attempts: count, runs: count, lastReportAt: nullable(text), notRecentlyReporting: flag,
    timeToResult: stat, cloudSave: stat, uploadWait: stat, outcomes,
  }), 100), pagination, focus: focusCheck, attempts: nullable(list(attemptRow, 100)), attemptPagination: nullable(pagination) })(value, "report");
  return value as unknown as FleetReportV1;
}

const rowsCheck: Check = (value, path) => {
  if (!isRecord(value)) malformed(path, "an object");
  if (value.kind === "processing") shape({ attempts: list(attemptRow, 100) })(value, path);
  else if (value.kind === "uploads") shape({ uploads: list(shape({
    attemptId: text, groupId: text, role: oneOf(UPLOAD_ROLES), drillType: text, occurredAt: nullable(text), clockQuality: text,
    jobState: text, objectCount: count, bytes: count, queueWaitMs: nullable(measure), transferMs: nullable(measure),
    cloudSaveMs: nullable(measure), transferAttempts: count, failedTransfers: count, lifetimeRetries: count,
    requiredCommitAcknowledged: nullable(flag),
  }), 100) })(value, path);
  else if (value.kind === "failures") shape({ failures: list(shape({
    attemptId: text, processingRunId: nullable(text), stageId: text, failureCode: nullable(text), failureLayer: nullable(text),
    confirmed: flag, occurredAt: nullable(text), clockQuality: text, drillType: text, build: nullable(text),
  }), 100) })(value, path);
  else malformed(`${path}.kind`, "processing, uploads or failures");
};

export function parseDeviceReport(raw: unknown): DeviceReportV1 {
  const value = requireVersion(raw, "device report");
  shape({
    ...envelopeFields,
    device: shape({
      installId: text, label: nullable(text), labelRevision: count, machine: nullable(text),
      builds: list(shape({ key: text, label: text, appVersion: text, build: text, osVersions: list(text, 32), firstSeenAt: nullable(text), lastSeenAt: nullable(text) }), 64),
      lastReportAt: nullable(text), notRecentlyReporting: flag, collectionStartedAt: nullable(text),
      lastStatus: nullable(shape({
        reportedAt: nullable(text), collectionCapability: text, repQueuePending: count, repQueueFailed: count,
        oldestPendingRepAgeSeconds: nullable(measure), spoolRecordCount: count, droppedRecordCount: count,
      })),
    }),
    attribution: oneOf(["origin", "executor"]),
    rows: rowsCheck,
    pagination,
  })(value, "device report");
  return value as unknown as DeviceReportV1;
}

const platform = nullable(shape({ appVersion: text, build: text, sourceRevision: text, machine: text, osVersion: text, configuration: text }));
const stage = shape({
  stageId: text, parentStageId: nullable(text), passId: nullable(text), status: text, invocationCount: count,
  elapsedMs: nullable(measure), activeMs: nullable(measure), continuousElapsedMs: nullable(measure), timingKind: text,
  framesDecoded: nullable(count), modelCalls: nullable(count), missingObservations: nullable(count),
  failureCode: nullable(text), failureLayer: nullable(text), lastDurableStage: nullable(text),
});
const spans = shape({ timeToResultMs: nullable(measure), readyForNextRepMs: nullable(measure), saveConfirmedAfterRecordingMs: nullable(measure) });
const BODY_CHECKS: Record<string, Check> = {
  attemptSummary: shape({
    stages: list(stage, 48), spans, continuousSpans: spans, inputSource: loose, captureFormat: loose,
    measurementVerdict: oneOf(["pending", "valid", "invalid"]), verdictReason: nullable(text), stationVerdict: text,
    preAdmissionFailure: nullable(shape({ stage: text, failureCode: text, failureLayer: text })), primaryMetricFinite: nullable(flag),
    requiredSaveState: text, sidecarState: text, archiveState: text, runCount: count, acceptedRunId: nullable(text),
    launchSegmentCount: count, lifecycleTransitionCount: count,
  }),
  runSummary: shape({
    outcome: text, failure: nullable(shape({ code: text, stage: text, disposition: text, layer: text })), cancellationReason: nullable(text),
    priority: text, reviewRequest: text, poseDelegateRequested: text, poseDelegateActual: nullable(text), poseDelegateFallbackReason: nullable(text),
    yoloComputeUnits: text, modelCacheState: text, stages: list(stage, 48), passIds: list(text, 8),
    totals: shape({ admissionWaitMs: nullable(measure), processingMs: nullable(measure), journalFinalizeMs: nullable(measure), framesDecoded: nullable(count), modelCalls: nullable(count) }),
    resources: shape({ admitted: loose, released: loose, sampledPeakBytes: nullable(count) }),
  }),
  uploadGroupSummary: shape({
    groupId: text, category: oneOf(UPLOAD_ROLES), jobState: text, uniqueObjectCount: count, uniqueObjectBytes: count,
    queueWaitMs: nullable(measure), knownBackoffMs: nullable(measure), cloudSaveMs: nullable(measure),
    transferAttemptCount: count, successfulTransferCount: count, failedTransferCount: count, lifetimeRetryCount: count,
    requiredCommitAcknowledged: nullable(flag), firestoreWriteMs: nullable(measure),
  }),
  transferInvocation: shape({
    invocationId: text, logicalObjectId: text, groupId: text, outerCommitOrdinal: count, objectOrdinal: count, objectRole: text,
    transport: text, payloadBytes: count, progressCompletedBytes: nullable(count), queueWaitMs: nullable(measure),
    authorizationMs: nullable(measure), invocationElapsedMs: nullable(measure), knownBackoffMs: nullable(measure),
    observedPauseMs: nullable(measure), sdkInternalRetryCount: nullable(count), networkInterface: text,
    constrained: nullable(flag), expensive: nullable(flag), outcome: text, providerDomain: nullable(text),
    providerCode: nullable(anyNumber), normalizedFailureCode: nullable(text), failureStage: nullable(text),
  }),
};
const recordKinds = Object.keys(BODY_CHECKS);

/** One contract record (schema.json recordV1). An unknown performanceSchemaVersion is refused. */
export function parsePerformanceRecord<T>(raw: unknown, expectedKind: string, path = "record"): T {
  if (!isRecord(raw)) malformed(path, "a device performance record");
  if (raw.performanceSchemaVersion !== PERFORMANCE_SCHEMA_VERSION) {
    throw new DevicePerformanceResponseError("unsupportedVersion",
      `A ${expectedKind} record uses performance schema version ${JSON.stringify(raw.performanceSchemaVersion ?? null)}; this page reads version ${PERFORMANCE_SCHEMA_VERSION} only.`,
      `${path}.performanceSchemaVersion`);
  }
  if (raw.recordKind !== expectedKind || !recordKinds.includes(expectedKind)) malformed(`${path}.recordKind`, expectedKind);
  shape({
    recordId: text, revision: count, attemptId: nullable(text), processingRunId: nullable(text), retryOfRunId: nullable(text),
    repId: nullable(text), commitJobId: nullable(text), originInstallId: nullable(text), executorInstallId: nullable(text),
    originLaunchId: nullable(text), executionLaunchId: nullable(text), stationDeviceId: nullable(text), originReporterUid: nullable(text),
    drillType: nullable(text), recordingMode: nullable(text), processingMode: nullable(text), originPlatform: platform, executorPlatform: platform,
    captureFingerprint: nullable(text), modelFingerprint: nullable(text), policyVersion: loose, occurredAtClient: nullable(text),
    captureOccurredAtClient: nullable(text), clockQuality: text, completeness: text,
    missingReasons: list(shape({ field: text, reason: text }), 16), droppedDetailCount: count,
    origin: oneOf(["field", "evaluation"]), evaluationRunId: nullable(text), body: BODY_CHECKS[expectedKind],
  })(raw, path);
  return raw as T;
}

export function parseAttemptDetail(raw: unknown): AttemptDetailV1 {
  const value = requireVersion(raw, "attempt detail");
  shape({
    generatedAt: text, attemptId: text,
    runs: list(() => undefined, 64), uploadGroups: list(() => undefined, 16), transfers: list(() => undefined, 100),
    transferPagination: pagination,
    receivedAt: shape({ firstReceivedAtServer: nullable(text), updatedAtServer: nullable(text) }),
    devices: list(shape({ installId: text, label: nullable(text) }), 16),
    evidence: list(shape({ kind: oneOf(["processingAttempt", "run", "failureCase"]), id: text, availability: oneOf(["available", "pending", "expired", "notCollected"]) }), 32),
  })(value, "attempt detail");
  const attempt = value.attempt === null ? null : parsePerformanceRecord<AttemptSummaryRecordV1>(value.attempt, "attemptSummary", "attempt detail.attempt");
  const runs = (value.runs as unknown[]).map((run, index) => parsePerformanceRecord<RunSummaryRecordV1>(run, "runSummary", `attempt detail.runs[${index}]`));
  const uploadGroups = (value.uploadGroups as unknown[]).map((group, index) => parsePerformanceRecord<UploadGroupRecordV1>(group, "uploadGroupSummary", `attempt detail.uploadGroups[${index}]`));
  const transfers = (value.transfers as unknown[]).map((transfer, index) => parsePerformanceRecord<TransferRecordV1>(transfer, "transferInvocation", `attempt detail.transfers[${index}]`));
  const attemptId = value.attemptId as string;
  for (const [index, record] of [attempt, ...runs, ...uploadGroups, ...transfers].entries()) {
    if (record && record.attemptId !== attemptId) malformed(`attempt detail record ${index}.attemptId`, attemptId);
  }
  return { ...(value as unknown as AttemptDetailV1), attempt, runs, uploadGroups, transfers };
}

export function parseLabelResult(raw: unknown): LabelResultV1 {
  const value = requireVersion(raw, "label update");
  shape({ installId: text, label: nullable(text), labelRevision: count })(value, "label update");
  return value as unknown as LabelResultV1;
}

// MARK: - Derived numbers (always with their denominators)

export interface FailureRate { failed: number; knownOutcomes: number; rate: number | null; excluded: { cancelled: number; interruptedUnknown: number; pending: number; preAdmissionFailures: number } }
/** failed ÷ (valid + partial + noMeasurement + failed) terminal runs (contract §8.4). */
export function failureRate(outcome: OutcomeCountsV1): FailureRate {
  const knownOutcomes = outcome.valid + outcome.partial + outcome.noMeasurement + outcome.failed;
  return {
    failed: outcome.failed,
    knownOutcomes,
    rate: knownOutcomes ? outcome.failed / knownOutcomes : null,
    excluded: { cancelled: outcome.cancelled, interruptedUnknown: outcome.interruptedUnknown, pending: outcome.pending, preAdmissionFailures: outcome.preAdmissionFailures },
  };
}

export interface UsableYield { valid: number; finalized: number; rate: number | null; firstRunRate: number | null; pending: number; userDiscarded: number }
/** valid ÷ (valid + invalid), userDiscarded left out and disclosed; pending disclosed (contract §8.4). */
export function usableYield(counts: YieldCountsV1): UsableYield {
  const finalized = counts.valid + counts.invalid;
  return {
    valid: counts.valid,
    finalized,
    rate: finalized ? counts.valid / finalized : null,
    firstRunRate: finalized ? counts.firstRunValid / finalized : null,
    pending: counts.pending,
    userDiscarded: counts.userDiscarded,
  };
}

export interface UploadSpeed { role: UploadRole; mbps: number | null; requested: boolean; stat: UploadRoleStatV1 }
export function uploadSpeed(stats: UploadRoleStatV1[], role: UploadRole): UploadSpeed | null {
  const stat = stats.find(row => row.role === role);
  if (!stat) return null;
  return { role, mbps: weightedThroughputMBps(stat.payloadBytes, stat.elapsedMs), requested: stat.invocations > 0 || stat.notRequested === 0, stat };
}

export interface AllocationSegment { phase: MainPhase | "unattributed"; meanMs: number | null; share: number }
export interface AllocationView { segments: AllocationSegment[]; totalMs: number; inconsistent: boolean; missingPhases: MainPhase[] }
/**
 * The "Where time goes" bar: mean main-phase times from one cohort plus the
 * Unattributed residual (mean time to result − Σ phase means). Medians are
 * never stacked. A negative residual means the inputs were not one cohort; it
 * is flagged, clamped to zero and never silently absorbed.
 */
export function allocationView(allocation: AllocationV1 | null): AllocationView | null {
  if (!allocation || !allocation.cohortSize || allocation.meanTimeToResultMs === null) return null;
  const byPhase = new Map(allocation.phases.map(row => [row.phase, row.meanMs]));
  const measured = MAIN_PHASES.map(phase => ({ phase, meanMs: byPhase.has(phase) ? byPhase.get(phase)! : null }));
  const attributed = measured.reduce((sum, row) => sum + (row.meanMs ?? 0), 0);
  const residual = allocation.meanTimeToResultMs - attributed;
  const inconsistent = residual < -Math.max(1, allocation.meanTimeToResultMs * 0.005);
  const unattributed = Math.max(0, residual);
  const totalMs = inconsistent ? attributed : allocation.meanTimeToResultMs;
  const segments: AllocationSegment[] = [...measured, { phase: "unattributed" as const, meanMs: unattributed }]
    .map(row => ({ ...row, share: totalMs > 0 && row.meanMs !== null ? row.meanMs / totalMs : 0 }));
  return { segments, totalMs, inconsistent, missingPhases: measured.filter(row => row.meanMs === null).map(row => row.phase) };
}

// MARK: - Filter model (plan 07 §3 "Filter and device attribution contract")

export const SHARED_FILTERS: FilterKey[] = ["drill", "recordingMode", "captureBuild", "captureMachine"];
export const RUN_FILTERS: FilterKey[] = ["processingMode", "executionBuild", "executionMachine"];
export const UPLOAD_FILTERS: FilterKey[] = ["networkInterface", "uploadRole", "payloadSizeBand"];
/** Which filters may change which metrics. Upload filters never remove processing or yield denominators. */
export const FILTER_SCOPE: Record<MetricGroup, FilterKey[]> = {
  capture: SHARED_FILTERS,
  processing: [...SHARED_FILTERS, ...RUN_FILTERS],
  yield: SHARED_FILTERS,
  cloudSave: SHARED_FILTERS,
  upload: [...SHARED_FILTERS, ...UPLOAD_FILTERS],
};
export const FILTER_LABELS: Record<FilterKey, string> = {
  drill: "drill", recordingMode: "recording mode", captureBuild: "recorded app version", captureMachine: "recording phone model",
  processingMode: "processing mode", executionBuild: "processing app version", executionMachine: "processing phone model",
  networkInterface: "network", uploadRole: "upload role", payloadSizeBand: "payload size",
};

export const DEFAULT_FILTERS: DevicePerformanceFilters = {
  drill: null, recordingMode: null, captureBuild: null, captureMachine: null, processingMode: null,
  executionBuild: null, executionMachine: null, networkInterface: null, uploadRole: "resultFiles", payloadSizeBand: null,
};

/** The active filters that apply to one metric group; uploadRole always applies to upload metrics. */
export function appliedFilters(group: MetricGroup, filters: DevicePerformanceFilters): FilterKey[] {
  return FILTER_SCOPE[group].filter(key => key === "uploadRole" ? group === "upload" : filters[key] !== null);
}

/** Server-stated scope wins when it is present; a scope that leaks an upload filter is dropped. */
export function statedScope(report: Pick<ReportEnvelopeV1, "effectiveFilters" | "filters">, group: MetricGroup): FilterKey[] {
  const stated = report.effectiveFilters?.[group];
  const allowed = new Set(FILTER_SCOPE[group]);
  return (stated ?? appliedFilters(group, report.filters)).filter(key => allowed.has(key));
}

export const PERIOD_PRESETS = [7, 14, 30, 90] as const;
export const MAX_PERIOD_DAYS = 90;
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";
export const TIME_ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "UTC"];
export const DEVICE_SORTS = ["attention", "slowResult", "failureRate", "failureCount", "uploadWait", "lastSeen"] as const;
export type DeviceSort = typeof DEVICE_SORTS[number];
export const DEVICE_SORT_LABELS: Record<DeviceSort, string> = {
  attention: "Known failures, then slow results",
  slowResult: "Slowest typical result time",
  failureRate: "Highest failure rate (20+ known outcomes)",
  failureCount: "Most failed runs",
  uploadWait: "Longest typical upload wait",
  lastSeen: "Least recently seen",
};
export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export function dateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string | null): value is string => !!value && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && shiftDate(value, 0) === value;
const daysBetween = (start: string, end: string) => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);

export interface DevicePerformanceQuery {
  period: { preset: typeof PERIOD_PRESETS[number] | "custom"; startDate: string; endDate: string; timeZone: string };
  dateBasis: DateBasis;
  filters: DevicePerformanceFilters;
  search: string;
  sort: DeviceSort;
  cursor: string | null;
  focus: FocusV1 | null;
  attemptsCursor: string | null;
  attempt: string | null;
  attribution: Attribution;
  section: DeviceSection;
}

/** Query-string names. Everything else in the URL (orgId, teamId, coachId, preview) is preserved untouched. */
export const PARAMS = {
  start: "start", end: "end", days: "days", timeZone: "tz", dateBasis: "basis",
  drill: "drill", recordingMode: "mode", captureBuild: "cbuild", captureMachine: "cmodel",
  processingMode: "pmode", executionBuild: "xbuild", executionMachine: "xmodel",
  networkInterface: "net", uploadRole: "role", payloadSizeBand: "size",
  search: "q", sort: "sort", cursor: "cursor", focus: "focus", attemptsCursor: "acursor", attempt: "attempt",
  attribution: "view", section: "section", scenario: "scenario",
} as const;
export type ParamName = typeof PARAMS[keyof typeof PARAMS];
const CURSOR_PARAMS: ParamName[] = [PARAMS.cursor, PARAMS.attemptsCursor];
/** Changing any of these makes every loaded cursor meaningless (plan 07 §6: cursors are bound to filters, sort and period). */
const REPORT_SHAPING: Set<string> = new Set([
  PARAMS.start, PARAMS.end, PARAMS.days, PARAMS.timeZone, PARAMS.dateBasis, PARAMS.drill, PARAMS.recordingMode, PARAMS.captureBuild,
  PARAMS.captureMachine, PARAMS.processingMode, PARAMS.executionBuild, PARAMS.executionMachine, PARAMS.networkInterface,
  PARAMS.uploadRole, PARAMS.payloadSizeBand, PARAMS.search, PARAMS.sort, PARAMS.attribution, PARAMS.section, PARAMS.scenario,
]);
const DEFAULT_PARAM_VALUES: Partial<Record<string, string>> = {
  [PARAMS.days]: "7", [PARAMS.timeZone]: DEFAULT_TIME_ZONE, [PARAMS.dateBasis]: "capture", [PARAMS.uploadRole]: "resultFiles",
  [PARAMS.sort]: "attention", [PARAMS.attribution]: "origin", [PARAMS.section]: "processing",
};
const FILTER_PARAM: Record<FilterKey, ParamName> = {
  drill: PARAMS.drill, recordingMode: PARAMS.recordingMode, captureBuild: PARAMS.captureBuild, captureMachine: PARAMS.captureMachine,
  processingMode: PARAMS.processingMode, executionBuild: PARAMS.executionBuild, executionMachine: PARAMS.executionMachine,
  networkInterface: PARAMS.networkInterface, uploadRole: PARAMS.uploadRole, payloadSizeBand: PARAMS.payloadSizeBand,
};
export const filterParam = (key: FilterKey): ParamName => FILTER_PARAM[key];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGE_ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;
const OPAQUE = /^[A-Za-z0-9._~:+/=-]{1,2048}$/;
const KEY = /^[A-Za-z0-9 ._,()+:-]{1,128}$/;
const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (value && (allowed as readonly string[]).includes(value) ? value as T : null);

export function parseFocus(value: string | null): FocusV1 | null {
  if (!value) return null;
  const [kind, first, second] = value.split(":");
  if (kind === "stage" && first && STAGE_ID.test(first) && first.length <= 96 && second === undefined) return { kind: "stage", stageId: first };
  const drill = pick(first ?? null, DRILL_TYPES), phase = pick(second ?? null, [...MAIN_PHASES, "unattributed"] as const);
  if (kind === "phase" && drill && phase) return { kind: "phase", drill, phase };
  return null;
}
export function focusParam(focus: FocusV1 | null): string | null {
  if (!focus) return null;
  return focus.kind === "stage" ? `stage:${focus.stageId}` : `phase:${focus.drill}:${focus.phase}`;
}

export function isInstallId(value: string | null | undefined): value is string { return !!value && UUID.test(value); }

export function parseDevicePerformanceQuery(search: string | URLSearchParams, now = new Date()): DevicePerformanceQuery {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const timeZone = pick(params.get(PARAMS.timeZone), TIME_ZONES) ?? DEFAULT_TIME_ZONE;
  const today = dateInZone(now, timeZone);
  const start = params.get(PARAMS.start), end = params.get(PARAMS.end);
  let period: DevicePerformanceQuery["period"];
  if (isDate(start) && isDate(end) && start <= end && end <= today && daysBetween(start, end) < MAX_PERIOD_DAYS) {
    period = { preset: "custom", startDate: start, endDate: end, timeZone };
  } else {
    const days = Number(params.get(PARAMS.days));
    const preset = (PERIOD_PRESETS as readonly number[]).includes(days) ? days as typeof PERIOD_PRESETS[number] : 7;
    period = { preset, startDate: shiftDate(today, 1 - preset), endDate: today, timeZone };
  }
  const key = (name: ParamName) => { const value = params.get(name); return value && KEY.test(value) ? value : null; };
  const filters: DevicePerformanceFilters = {
    drill: pick(params.get(PARAMS.drill), DRILL_TYPES),
    recordingMode: pick(params.get(PARAMS.recordingMode), RECORDING_MODES),
    captureBuild: key(PARAMS.captureBuild),
    captureMachine: key(PARAMS.captureMachine),
    processingMode: pick(params.get(PARAMS.processingMode), PROCESSING_MODES),
    executionBuild: key(PARAMS.executionBuild),
    executionMachine: key(PARAMS.executionMachine),
    networkInterface: pick(params.get(PARAMS.networkInterface), NETWORK_INTERFACES),
    uploadRole: pick(params.get(PARAMS.uploadRole), UPLOAD_ROLES) ?? "resultFiles",
    payloadSizeBand: key(PARAMS.payloadSizeBand),
  };
  const opaque = (name: ParamName) => { const value = params.get(name); return value && OPAQUE.test(value) ? value : null; };
  const attempt = params.get(PARAMS.attempt);
  return {
    period,
    dateBasis: params.get(PARAMS.dateBasis) === "serverReceipt" ? "serverReceipt" : "capture",
    filters,
    search: (params.get(PARAMS.search) ?? "").slice(0, 80),
    sort: pick(params.get(PARAMS.sort), DEVICE_SORTS) ?? "attention",
    cursor: opaque(PARAMS.cursor),
    focus: parseFocus(params.get(PARAMS.focus)),
    attemptsCursor: opaque(PARAMS.attemptsCursor),
    attempt: attempt && UUID.test(attempt) ? attempt : null,
    attribution: params.get(PARAMS.attribution) === "executor" ? "executor" : "origin",
    section: pick(params.get(PARAMS.section), ["processing", "uploads", "failures"] as const) ?? "processing",
  };
}

export type QueryPatch = Partial<Record<ParamName, string | null>>;

/**
 * Merge a change into the current query string. Unrelated parameters (the
 * admin org/team scope, preview) survive; defaults are omitted; a change that
 * reshapes the report drops both paging cursors, and a new focus drops the
 * attempt-list cursor.
 */
export function devicePerformanceSearch(search: string, patch: QueryPatch): string {
  const before = new URLSearchParams(search), params = new URLSearchParams(search);
  for (const [name, raw] of Object.entries(patch)) {
    const value = raw === null || raw === undefined || raw === "" || DEFAULT_PARAM_VALUES[name] === raw ? null : raw;
    if (value === null) params.delete(name); else params.set(name, value);
  }
  // A preset and a custom range are exclusive.
  if (patch[PARAMS.days] !== undefined && patch[PARAMS.start] === undefined) { params.delete(PARAMS.start); params.delete(PARAMS.end); }
  if (patch[PARAMS.start]) params.delete(PARAMS.days);
  const changed = (name: string) => (before.get(name) ?? null) !== (params.get(name) ?? null);
  if ([...REPORT_SHAPING].some(changed)) for (const name of CURSOR_PARAMS) if (patch[name] === undefined) params.delete(name);
  if (changed(PARAMS.focus) && patch[PARAMS.attemptsCursor] === undefined) params.delete(PARAMS.attemptsCursor);
  const text = params.toString();
  return text ? `?${text}` : "";
}

const withoutParams = (search: string, names: string[]) => {
  const params = new URLSearchParams(search);
  for (const name of names) params.delete(name);
  const text = params.toString();
  return text ? `?${text}` : "";
};
export const FLEET_PATH = "/admin/device-performance";
/** Device report link: period, filters, sort and search carry over; page cursors and the drawer do not. */
export function devicePath(installId: string, search: string): string {
  return `${FLEET_PATH}/${encodeURIComponent(installId)}${withoutParams(search, [PARAMS.cursor, PARAMS.attemptsCursor, PARAMS.attempt])}`;
}
/** Back to the fleet from a device report (breadcrumb): same filters, sort and search, first page. */
export function fleetPath(search: string): string {
  return `${FLEET_PATH}${withoutParams(search, [PARAMS.cursor, PARAMS.attemptsCursor, PARAMS.attempt, PARAMS.attribution, PARAMS.section])}`;
}

// MARK: - Requests (plan 07 §6 Read API)

export interface ReportRequestBaseV1 {
  startDate: string;
  endDate: string;
  timeZone: string;
  dateBasis: DateBasis;
  filters: DevicePerformanceFilters;
}
export interface FleetRequestV1 extends ReportRequestBaseV1 {
  search: string | null;
  sort: DeviceSort;
  pageSize: number;
  cursor: string | null;
  focus: FocusV1 | null;
  attemptsCursor: string | null;
}
export interface DetailRequestV1 extends ReportRequestBaseV1 {
  installId: string;
  attribution: Attribution;
  section: DeviceSection;
  pageSize: number;
  cursor: string | null;
}
export interface AttemptRequestV1 { attemptId: string; cursor: string | null }
export interface LabelRequestV1 { installId: string; label: string | null; expectedRevision: number }

const base = (query: DevicePerformanceQuery): ReportRequestBaseV1 => ({
  startDate: query.period.startDate, endDate: query.period.endDate, timeZone: query.period.timeZone,
  dateBasis: query.dateBasis, filters: { ...query.filters },
});
export function fleetRequest(query: DevicePerformanceQuery, pageSize = PAGE_SIZE): FleetRequestV1 {
  return { ...base(query), search: query.search.trim() || null, sort: query.sort, pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize)), cursor: query.cursor, focus: query.focus, attemptsCursor: query.focus ? query.attemptsCursor : null };
}
export function detailRequest(installId: string, query: DevicePerformanceQuery, pageSize = PAGE_SIZE): DetailRequestV1 {
  return { ...base(query), installId, attribution: query.attribution, section: query.section, pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize)), cursor: query.cursor };
}
export const DEVICE_LABEL_MAX = 48;
export function normalizeDeviceLabel(value: string): string | null {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, DEVICE_LABEL_MAX) : null;
}

// MARK: - Errors shown to the admin

export type LoadProblem = "oversized" | "staleCursor" | "denied" | "unsupportedVersion" | "malformed" | "notFound" | "timeout" | "failed";
export interface LoadFailure { problem: LoadProblem; title: string; message: string }
export function describeLoadFailure(error: unknown, subject: "report" | "device" | "attempt" | "rename" = "report"): LoadFailure {
  if (error instanceof DevicePerformanceResponseError) {
    return error.reason === "unsupportedVersion"
      ? { problem: "unsupportedVersion", title: "Newer report format", message: error.message }
      : { problem: "malformed", title: "Could not read the report", message: "The report arrived in a shape this page does not recognize, so nothing from it is shown." };
  }
  const code = String((error as { code?: unknown })?.code ?? "").split("/").at(-1);
  const details = (error as { details?: unknown })?.details;
  if (code === "resource-exhausted") {
    const limit = isRecord(details) && typeof details.limit === "number" ? ` It matches more than ${details.limit.toLocaleString("en-US")} measurements.` : "";
    return { problem: "oversized", title: "This report is too large to compute exactly", message: `Narrow the date range or choose a drill or device.${limit} Totals are never estimated from part of the data.` };
  }
  if (code === "failed-precondition" || code === "aborted") {
    return subject === "rename"
      ? { problem: "staleCursor", title: "The label changed", message: "Someone else renamed this device. Reload to see the current label, then try again." }
      : { problem: "staleCursor", title: "The report changed", message: "New reports arrived while you were paging. Refresh to load the first page of the current report." };
  }
  if (code === "permission-denied" || code === "unauthenticated") {
    return { problem: "denied", title: "Admin access required", message: "Device performance is for verified @posetek.net admins. Sign in again with an admin account." };
  }
  if (code === "not-found") {
    return subject === "device"
      ? { problem: "notFound", title: "No reports from this device", message: "No device with this install id has reported in the retained period." }
      : subject === "attempt"
        ? { problem: "notFound", title: "Attempt not found", message: "No performance facts for this attempt are stored. They may have expired under the 90-day retention." }
        : { problem: "notFound", title: "Could not load report", message: "The device performance service is not available. It may not be deployed yet." };
  }
  if (code === "deadline-exceeded") return { problem: "timeout", title: "Could not load report", message: "The report took too long. Retry, or narrow the date range." };
  return { problem: "failed", title: subject === "rename" ? "Could not rename the device" : "Could not load report", message: "The request failed. Retry keeps your filters." };
}

// MARK: - Data sources: live callables, or the DEV-only preview

export type CallableTransport = (name: string, payload: unknown) => Promise<unknown>;
export interface DevicePerformanceSource {
  kind: "live" | "preview";
  fleet(request: FleetRequestV1): Promise<FleetReportV1>;
  device(request: DetailRequestV1): Promise<DeviceReportV1>;
  attempt(request: AttemptRequestV1): Promise<AttemptDetailV1>;
  rename(request: LabelRequestV1): Promise<LabelResultV1>;
}
export const CALLABLES = {
  fleet: "getDevicePerformanceV1",
  device: "getDevicePerformanceDetailV1",
  attempt: "getDevicePerformanceAttemptV1",
  rename: "setDevicePerformanceLabelV1",
} as const;

export function createDevicePerformanceClient(transport: CallableTransport): DevicePerformanceSource {
  return {
    kind: "live",
    fleet: async request => parseFleetReport(await transport(CALLABLES.fleet, request)),
    device: async request => parseDeviceReport(await transport(CALLABLES.device, request)),
    attempt: async request => parseAttemptDetail(await transport(CALLABLES.attempt, request)),
    rename: async request => parseLabelResult(await transport(CALLABLES.rename, request)),
  };
}

const firebaseTransport: CallableTransport = async (name, payload) => {
  const { cloud } = await import("../../../lib/firebase");
  return (await cloud.httpsCallable(name, { timeout: 120_000 })(payload)).data;
};

/**
 * The live source, or — only in a DEV build with ?preview=1 — synthetic data.
 * There is no path from a live failure to the preview: callers surface the
 * error and keep their filters.
 */
export async function loadDevicePerformanceSource(preview: boolean, scenario: string | null = null): Promise<DevicePerformanceSource> {
  if (import.meta.env.DEV && preview) {
    const module = await import("./devicePerformancePreview");
    return module.createPreviewSource(scenario);
  }
  return createDevicePerformanceClient(firebaseTransport);
}

/** A short-lived cache so Back to the fleet redraws at once and can restore scroll. */
export function createReportCache<T>(ttlMs = 60_000, max = 8) {
  const entries = new Map<string, { value: T; at: number }>();
  return {
    get(key: string, now = Date.now()): T | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now - entry.at > ttlMs) { entries.delete(key); return null; }
      return entry.value;
    },
    set(key: string, value: T, now = Date.now()) {
      entries.delete(key);
      entries.set(key, { value, at: now });
      while (entries.size > max) entries.delete(entries.keys().next().value!);
    },
    clear() { entries.clear(); },
  };
}
export const requestKey = (kind: string, request: unknown, scenario: string | null = null) => JSON.stringify([kind, scenario, request]);

// MARK: - Attempt timeline (plan 07 §7 "Attempt detail")

export type TimelineLaneKey = "recording" | "processing" | "localSave" | "acceptance" | "cloudSave" | "archive";
export interface TimelineBar {
  stageId: string;
  label: string;
  startMs: number;
  durationMs: number | null;
  status: string;
  passId: string | null;
  marker: "stoppedHere" | "lastReported" | null;
}
export interface TimelineLane { key: TimelineLaneKey; label: string; bars: TimelineBar[]; nested: TimelineBar[]; note: string | null }
export interface TimelineSegment { launchId: string | null; lanes: TimelineLane[]; spanMs: number }
export interface AttemptTimeline {
  segments: TimelineSegment[];
  /** Unknown gaps between launch segments; never drawn as measured time. */
  unknownGaps: number;
  unattributedMs: number | null;
  notes: string[];
}

const ACCEPTANCE = /^(accept\.(announce|correctionWindow|progressAck)|flow\.)/;
const LOCAL_SAVE = new Set(["artifact.persist", "accept.manifestAck"]);
function laneFrom(key: TimelineLaneKey, laneLabel: string, stages: StageSummaryV1[], start: number, note: string | null = null): TimelineLane {
  let cursor = start;
  const bars: TimelineBar[] = [], nested: TimelineBar[] = [];
  for (const row of stages) {
    if (row.status === "notNeeded") continue;
    const bar: TimelineBar = { stageId: row.stageId, label: stageLabel(row.stageId), startMs: cursor, durationMs: row.elapsedMs, status: row.status, passId: row.passId, marker: null };
    if (row.timingKind === "nestedOperation") { nested.push(bar); continue; }
    bars.push(bar);
    cursor += row.elapsedMs ?? 0;
  }
  return { key, label: laneLabel, bars, nested, note };
}
const laneEnd = (lane: TimelineLane | undefined) => lane ? lane.bars.reduce((end, bar) => Math.max(end, bar.startMs + (bar.durationMs ?? 0)), lane.bars[0]?.startMs ?? 0) : 0;

function orderRuns(runs: RunSummaryRecordV1[]): RunSummaryRecordV1[] {
  const ordered: RunSummaryRecordV1[] = [];
  const remaining = [...runs];
  const place = (parent: string | null) => {
    for (let index = 0; index < remaining.length;) {
      const run = remaining[index];
      if ((run.retryOfRunId ?? null) === parent || (parent === null && !runs.some(other => other.processingRunId === run.retryOfRunId))) {
        remaining.splice(index, 1);
        ordered.push(run);
        place(run.processingRunId);
        index = 0;
      } else index += 1;
    }
  };
  place(null);
  return [...ordered, ...remaining];
}

/**
 * Lanes for one attempt. Stage summaries carry durations, not start offsets,
 * so main phases are drawn end to end in first-start order within a launch;
 * nested operations (model loads, speech) are listed as cumulative call time,
 * never added to their parent. Different launches are separate segments with
 * an explicit unknown gap: monotonic clocks from two launches are never
 * subtracted (contract §5).
 */
export function attemptTimeline(detail: Pick<AttemptDetailV1, "attempt" | "runs" | "uploadGroups">): AttemptTimeline {
  const { attempt } = detail;
  const runs = orderRuns(detail.runs);
  const notes: string[] = [];
  const originLaunch = attempt?.originLaunchId ?? runs[0]?.originLaunchId ?? null;
  const segments: TimelineSegment[] = [];
  const segmentFor = (launchId: string | null) => {
    let segment = segments.find(row => row.launchId === launchId);
    if (!segment) { segment = { launchId, lanes: [], spanMs: 0 }; segments.push(segment); }
    return segment;
  };
  const stages = attempt?.body.stages ?? [];
  const origin = segmentFor(originLaunch);
  const recording = laneFrom("recording", "Recording and preparation", stages.filter(row => row.stageId.startsWith("capture.")), 0);
  if (recording.bars.length || recording.nested.length) origin.lanes.push(recording);

  const runLaunch = new Map<string, string | null>();
  runs.forEach((run, index) => {
    const launch = run.executionLaunchId ?? originLaunch;
    const segment = segmentFor(launch);
    const previous = [...segment.lanes].reverse().find(lane => lane.key === "processing" || lane.key === "recording");
    const outcome = label(OUTCOME_LABELS, run.body.outcome);
    const lane = laneFrom("processing", `Run ${index + 1}${run.retryOfRunId ? " (retry)" : ""} · ${outcome}`, run.body.stages, laneEnd(previous),
      run.processingMode === "recovery" ? "Recovery run after a relaunch; it is not uninterrupted compute." : null);
    if (run.body.outcome === "failed" && run.body.failure) {
      const bar = lane.bars.find(row => row.stageId === run.body.failure!.stage) ?? [...lane.bars].reverse().find(row => row.status === "failed");
      if (bar) bar.marker = "stoppedHere";
      else lane.note = `Stopped at ${stageLabel(run.body.failure.stage)}, which has no timing in this run.`;
    } else if (run.body.outcome === "interruptedUnknown" || run.body.outcome === "cancelled") {
      const bar = [...lane.bars].reverse().find(row => row.status === "completed" || row.status === "interrupted" || row.status === "cancelled");
      if (bar) bar.marker = "lastReported";
    }
    segment.lanes.push(lane);
    runLaunch.set(run.processingRunId ?? `run-${index}`, launch);
  });
  const preAdmission = attempt?.body.preAdmissionFailure;
  if (preAdmission) {
    origin.lanes.push({
      key: "processing", label: "Processing did not start", nested: [],
      bars: [{ stageId: preAdmission.stage, label: stageLabel(preAdmission.stage), startMs: laneEnd(recording), durationMs: null, status: "failed", passId: null, marker: "stoppedHere" }],
      note: failureExplanation(preAdmission.failureCode, preAdmission.failureLayer),
    });
  }

  const acceptedLaunch = attempt?.body.acceptedRunId && runLaunch.has(attempt.body.acceptedRunId)
    ? runLaunch.get(attempt.body.acceptedRunId)! : runs.length ? runLaunch.get(runs.at(-1)!.processingRunId ?? `run-${runs.length - 1}`)! : originLaunch;
  const acceptSegment = segmentFor(acceptedLaunch);
  const afterProcessing = laneEnd([...acceptSegment.lanes].reverse().find(lane => lane.key === "processing" || lane.key === "recording"));
  const localSave = laneFrom("localSave", "Saving on the phone", stages.filter(row => LOCAL_SAVE.has(row.stageId)), afterProcessing);
  if (localSave.bars.length) acceptSegment.lanes.push(localSave);
  const acceptance = laneFrom("acceptance", "Result accepted, next rep", stages.filter(row => ACCEPTANCE.test(row.stageId)), laneEnd(localSave) || afterProcessing);
  if (acceptance.bars.length || acceptance.nested.length) acceptSegment.lanes.push(acceptance);
  if (!runs.length && attempt && !preAdmission && attempt.body.runCount > 0) notes.push(`${attempt.body.runCount} run${attempt.body.runCount === 1 ? "" : "s"} counted by the phone have not been received yet.`);

  const manifestStart = localSave.bars.find(bar => bar.stageId === "accept.manifestAck")?.startMs ?? null;
  for (const group of detail.uploadGroups) {
    const launch = group.executionLaunchId ?? acceptedLaunch;
    const segment = segmentFor(launch);
    const cloud = group.body.category === "resultFiles";
    const start = segment === acceptSegment && manifestStart !== null ? manifestStart : 0;
    const state = label(SAVE_STATE_LABELS, group.body.jobState);
    const laneLabel = `${cloud ? "Required cloud save" : `Optional ${label(UPLOAD_ROLE_LABELS, group.body.category).toLowerCase()}`} · ${state}`;
    const missing = group.missingReasons.find(row => row.field === "/queueWaitMs" || row.field === "/cloudSaveMs");
    segment.lanes.push({
      key: cloud ? "cloudSave" : "archive",
      label: laneLabel,
      bars: [{ stageId: `upload.${group.body.category}`, label: cloud ? "Cloud save" : label(UPLOAD_ROLE_LABELS, group.body.category), startMs: start, durationMs: group.body.cloudSaveMs, status: group.body.jobState, passId: null, marker: group.body.jobState === "failed" ? "stoppedHere" : null }],
      nested: [],
      note: [
        group.body.queueWaitMs !== null ? `Waited ${formatDuration(group.body.queueWaitMs)} before the first transfer.` : missing ? `Waiting time: ${missingReasonLabel(missing.reason).toLowerCase()}.` : null,
        group.body.knownBackoffMs ? `App retry waiting ${formatDuration(group.body.knownBackoffMs)}.` : null,
        group.body.failedTransferCount ? `${group.body.failedTransferCount} failed transfer${group.body.failedTransferCount === 1 ? "" : "s"}, ${group.body.lifetimeRetryCount} retr${group.body.lifetimeRetryCount === 1 ? "y" : "ies"}.` : null,
      ].filter(Boolean).join(" ") || null,
    });
  }
  if (attempt && attempt.body.archiveState === "notRequested" && !detail.uploadGroups.some(group => group.body.category === "optionalVideo")) {
    acceptSegment.lanes.push({ key: "archive", label: "Optional video archive · Not requested", bars: [], nested: [], note: "Saving video to the cloud was off for this attempt." });
  }

  for (const segment of segments) segment.spanMs = Math.max(0, ...segment.lanes.map(lane => Math.max(laneEnd(lane), ...lane.nested.map(bar => bar.startMs + (bar.durationMs ?? 0)))));
  const populated = segments.filter(segment => segment.lanes.length);
  if (attempt && attempt.body.launchSegmentCount > populated.length) notes.push(`The phone reported ${attempt.body.launchSegmentCount} app launches for this attempt; some launch segments sent no timing.`);

  // Time to result is reported only when both ends share a launch (contract §8.4),
  // so the residual is computed only when every counted run ran in that launch too.
  let unattributedMs: number | null = null;
  const timeToResult = attempt?.body.spans.timeToResultMs ?? null;
  const counted = runs.filter(run => run.processingMode !== "debugReview");
  if (timeToResult !== null && counted.every(run => (run.executionLaunchId ?? originLaunch) === originLaunch)) {
    const main = (rows: StageSummaryV1[]) => rows.filter(row => row.timingKind === "mainPhase").reduce((sum, row) => sum + (row.elapsedMs ?? 0), 0);
    const preparation = main(stages.filter(row => row.stageId.startsWith("capture.") && row.stageId !== "capture.stopRequested"));
    const saving = main(stages.filter(row => LOCAL_SAVE.has(row.stageId)));
    const processing = counted.reduce((sum, run) => sum + main(run.body.stages), 0);
    unattributedMs = Math.max(0, timeToResult - preparation - processing - saving);
  }
  return { segments: populated, unknownGaps: Math.max(0, populated.length - 1), unattributedMs, notes };
}

export function transferSpeedMBps(transfer: TransferInvocationBodyV1): number | null {
  return transfer.outcome === "succeeded" && transfer.invocationElapsedMs !== null ? weightedThroughputMBps(transfer.payloadBytes, transfer.invocationElapsedMs) : null;
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "Not reported";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "Not reported";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}
