// DEV-ONLY synthetic data for /admin/device-performance?preview=1 (plan 07 §7
// "Essential UI states"). It is imported only through
// loadDevicePerformanceSource() behind `import.meta.env.DEV`, so production
// bundles do not contain it, and a live failure never falls back to it.
//
// Every response goes through the same parsers as the live callables, so a
// preview that renders is also a preview whose shape the parsers accept.
// Identifiers, devices and timings are invented; none is a real phone, athlete
// or build. Choose a state with &scenario=<name>; PREVIEW_SCENARIOS lists them.

import {
  DRILL_TYPES, MAIN_PHASES, PERFORMANCE_SCHEMA_VERSION, REPORT_SCHEMA_VERSION, UPLOAD_ROLES,
  appliedFilters, parseAttemptDetail, parseDeviceReport, parseFleetReport, parseLabelResult,
} from "./devicePerformance";
import type {
  AttemptRequestV1, AttemptRowV1, DetailRequestV1, DevicePerformanceFilters, DevicePerformanceSource, DistributionStatV1,
  DrillRowV1, DrillType, FailureRowV1, FailureStageRowV1, FleetRequestV1, LabelRequestV1, MetricGroup, OutcomeCountsV1,
  ReportRequestBaseV1, StageSummaryV1, TotalsV1, UploadRoleStatV1, UploadRowV1,
} from "./devicePerformance";

export const PREVIEW_SCENARIOS = [
  { key: "normal", label: "Recorded data (healthy, slow, failing, stale, unknown devices)" },
  { key: "loading", label: "Loading" },
  { key: "error", label: "Could not load report" },
  { key: "oversized", label: "Query too large" },
  { key: "empty", label: "No matching data" },
  { key: "uncollected", label: "Nothing collected yet" },
  { key: "oldBuilds", label: "Only old builds (not collected by this app version)" },
  { key: "detailError", label: "Totals load, detail and next pages fail" },
  { key: "staleCursor", label: "Report changed while paging" },
  { key: "newerFormat", label: "Newer response format" },
] as const;
export type PreviewScenario = typeof PREVIEW_SCENARIOS[number]["key"];
const scenarioOf = (value: string | null): PreviewScenario => (PREVIEW_SCENARIOS.some(row => row.key === value) ? value as PreviewScenario : "normal");

const GENERATED_AT = "2026-09-29T16:40:00.000Z";
const failure = (code: string, details?: unknown) => Object.assign(new Error(`Preview ${code}`), { code: `functions/${code}`, details });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// MARK: - Small factories

const dist = (sample: number, typicalMs: number | null, slowMs: number | null, missing = 0, excluded = 0, missingReason = "notCollectedByThisVersion"): DistributionStatV1 => ({
  eligible: sample + missing, sample, missing, excluded,
  typicalMs: sample ? typicalMs : null, slowMs: sample ? slowMs : null,
  missingReasons: missing ? [{ reason: missingReason, count: missing }] : [],
  excludedReasons: excluded ? [{ reason: "failedOrUnmeasured", count: excluded }] : [],
});
const outcomes = (valid: number, failed = 0, partial = 0, noMeasurement = 0, cancelled = 0, interruptedUnknown = 0, pending = 0, preAdmissionFailures = 0): OutcomeCountsV1 =>
  ({ valid, partial, noMeasurement, failed, cancelled, interruptedUnknown, pending, preAdmissionFailures });
const scaleCount = (value: number, factor: number) => Math.round(value * factor);
const scaleDist = (stat: DistributionStatV1, factor: number): DistributionStatV1 => {
  const sample = scaleCount(stat.sample, factor), missing = scaleCount(stat.missing, factor);
  return { ...stat, sample, missing, eligible: sample + missing, excluded: scaleCount(stat.excluded, factor),
    typicalMs: sample ? stat.typicalMs : null, slowMs: sample ? stat.slowMs : null,
    missingReasons: missing ? stat.missingReasons.map(row => ({ ...row, count: missing })) : [] };
};
const scaleOutcomes = (value: OutcomeCountsV1, factor: number): OutcomeCountsV1 =>
  Object.fromEntries(Object.entries(value).map(([key, count]) => [key, scaleCount(count, factor)])) as unknown as OutcomeCountsV1;

const BUILDS = [
  { key: "1.4.0 (212)", label: "1.4.0 (212)", appVersion: "1.4.0", build: "212" },
  { key: "1.4.1 (215)", label: "1.4.1 (215)", appVersion: "1.4.1", build: "215" },
];
const MACHINES = ["iPhone14,7", "iPhone15,2", "iPhone13,2", "iPhone16,1", "iPhone12,1", "iPhone14,2"];

interface PreviewDevice {
  installId: string | null; label: string | null; machine: string | null; builds: typeof BUILDS; attempts: number; runs: number;
  lastReportAt: string | null; stale: boolean; resultMs: number; slowMs: number; saveMs: number; waitMs: number; failed: number; known: number;
}
const namedDevices: PreviewDevice[] = [
  { installId: "0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5", label: "Station 2 phone (preview)", machine: "iPhone14,7", builds: BUILDS, attempts: 214, runs: 219, lastReportAt: "2026-09-29T16:31:00.000Z", stale: false, resultMs: 17_400, slowMs: 24_100, saveMs: 3_900, waitMs: 420, failed: 2, known: 217 },
  { installId: "1e6d0b2f-3c4a-4d7e-9f80-b1c2d3e4f5a6", label: "Coach phone (preview)", machine: "iPhone15,2", builds: [BUILDS[1]], attempts: 96, runs: 98, lastReportAt: "2026-09-29T15:02:00.000Z", stale: false, resultMs: 31_800, slowMs: 47_300, saveMs: 6_200, waitMs: 1_800, failed: 3, known: 97 },
  { installId: "2f7e1c30-4d5b-4e8f-a091-c2d3e4f5a6b7", label: null, machine: "iPhone13,2", builds: [BUILDS[0]], attempts: 74, runs: 81, lastReportAt: "2026-09-29T11:47:00.000Z", stale: false, resultMs: 22_600, slowMs: 38_900, saveMs: 4_700, waitMs: 950, failed: 9, known: 78 },
  { installId: "3a8f2d41-5e6c-4f90-b1a2-d3e4f5a6b7c8", label: "Station 1 phone (preview)", machine: "iPhone14,7", builds: [BUILDS[0]], attempts: 131, runs: 133, lastReportAt: "2026-09-25T19:10:00.000Z", stale: true, resultMs: 18_200, slowMs: 26_700, saveMs: 12_900, waitMs: 9_400, failed: 1, known: 131 },
  { installId: "4b903e52-6f7d-4a01-82b3-e4f5a6b7c8d9", label: null, machine: "iPhone12,1", builds: [BUILDS[1]], attempts: 8, runs: 8, lastReportAt: "2026-09-28T21:30:00.000Z", stale: false, resultMs: 27_500, slowMs: 33_000, saveMs: 5_100, waitMs: 700, failed: 0, known: 8 },
  { installId: "5ca14f63-7a8e-4b12-93c4-f5a6b7c8d9e0", label: null, machine: "iPhone16,1", builds: [BUILDS[1]], attempts: 58, runs: 58, lastReportAt: "2026-09-29T16:12:00.000Z", stale: false, resultMs: 14_900, slowMs: 19_800, saveMs: 3_100, waitMs: 260, failed: 0, known: 58 },
  { installId: "6db25a74-8b9f-4c23-a4d5-a6b7c8d9e0f1", label: "Loaner phone (preview)", machine: "iPhone14,2", builds: BUILDS, attempts: 41, runs: 47, lastReportAt: "2026-09-29T09:05:00.000Z", stale: false, resultMs: 20_300, slowMs: 29_900, saveMs: 4_400, waitMs: 610, failed: 5, known: 45 },
  { installId: null, label: null, machine: null, builds: [], attempts: 23, runs: 23, lastReportAt: null, stale: false, resultMs: 0, slowMs: 0, saveMs: 0, waitMs: 0, failed: 0, known: 0 },
];
const fillerDevices: PreviewDevice[] = Array.from({ length: 54 }, (_, index) => ({
  installId: `7e${(index + 16).toString(16).padStart(6, "0")}-9c0a-4d34-b5e6-${(index * 7919 + 100_000).toString(16).padStart(12, "0").slice(-12)}`,
  label: null, machine: MACHINES[index % MACHINES.length], builds: [BUILDS[index % 2]], attempts: 20 + (index * 7) % 40, runs: 20 + (index * 7) % 40 + index % 3,
  lastReportAt: `2026-09-${String(22 + index % 8).padStart(2, "0")}T1${index % 10}:00:00.000Z`, stale: index % 8 === 0,
  resultMs: 15_000 + (index * 911) % 12_000, slowMs: 22_000 + (index * 1307) % 15_000, saveMs: 3_000 + (index * 331) % 4_000,
  waitMs: 200 + (index * 97) % 1_500, failed: index % 5 === 0 ? 1 : 0, known: 20 + (index * 7) % 40,
}));
const allDevices = [...namedDevices, ...fillerDevices];

const DRILL_BASE: Record<DrillType, { attempts: number; resultMs: number; slowMs: number; phases: [number, number, number, number, number]; outcome: OutcomeCountsV1 }> = {
  deadballShot: { attempts: 188, resultMs: 24_300, slowMs: 36_800, phases: [520, 180, 17_900, 240, 130], outcome: outcomes(174, 9, 3, 2, 1, 1, 0, 1) },
  sprint: { attempts: 142, resultMs: 12_800, slowMs: 18_400, phases: [470, 90, 9_700, 610, 110], outcome: outcomes(139, 2, 0, 1, 0, 0, 1, 0) },
  jump: { attempts: 121, resultMs: 9_600, slowMs: 13_100, phases: [430, 70, 7_300, 420, 95], outcome: outcomes(118, 1, 1, 1, 0, 0, 0, 0) },
  broadJump: { attempts: 12, resultMs: 16_900, slowMs: 22_000, phases: [480, 260, 12_600, 530, 100], outcome: outcomes(10, 1, 0, 1, 0, 0, 0, 2) },
  changeOfDirection: { attempts: 97, resultMs: 21_900, slowMs: 30_200, phases: [610, 140, 17_700, 390, 110], outcome: outcomes(93, 2, 1, 0, 1, 0, 0, 1) },
  dribbling: { attempts: 0, resultMs: 0, slowMs: 0, phases: [0, 0, 0, 0, 0], outcome: outcomes(0) },
  freeRecord: { attempts: 37, resultMs: 5_200, slowMs: 7_900, phases: [390, 40, 4_100, 0, 80], outcome: outcomes(36, 0, 0, 0, 1, 0, 0, 0) },
};
const TOTAL_ATTEMPTS = Object.values(DRILL_BASE).reduce((sum, row) => sum + row.attempts, 0);

const STAGE_ROWS: FailureStageRowV1[] = [
  { stageId: "kick.denseBall", failures: 7, entered: 186, cancelled: 1, unavailable: 0, lastReportedOnly: 2, drills: ["deadballShot"] },
  { stageId: "input.calibration", failures: 4, entered: 612, cancelled: 0, unavailable: 0, lastReportedOnly: 0, drills: ["deadballShot", "changeOfDirection", "sprint", "broadJump"] },
  { stageId: "broadJump.calibrationPreflight", failures: 1, entered: 12, cancelled: 0, unavailable: 0, lastReportedOnly: 0, drills: ["broadJump"] },
  { stageId: "sprint.extract", failures: 2, entered: 143, cancelled: 0, unavailable: 1, lastReportedOnly: 1, drills: ["sprint"] },
  { stageId: "cod.extract", failures: 2, entered: 98, cancelled: 1, unavailable: 0, lastReportedOnly: 0, drills: ["changeOfDirection"] },
  { stageId: "preparedArtifact.repBudget", failures: 1, entered: 590, cancelled: 0, unavailable: 0, lastReportedOnly: 0, drills: ["jump"] },
  { stageId: "repUpload.restorePayload", failures: 2, entered: 581, cancelled: 0, unavailable: 3, lastReportedOnly: 0, drills: ["deadballShot", "sprint"] },
];

const INNER_MODEL: { drillType: DrillType; stageId: string; parentStageId: string; runs: number; callsPerRun: number; typicalMs: number; slowMs: number }[] = [
  { drillType: "deadballShot", stageId: "model.create", parentStageId: "kick.extract", runs: 186, callsPerRun: 2, typicalMs: 182, slowMs: 410 },
  { drillType: "deadballShot", stageId: "model.firstPrediction", parentStageId: "kick.extract", runs: 186, callsPerRun: 2, typicalMs: 64, slowMs: 131 },
  { drillType: "sprint", stageId: "model.create", parentStageId: "sprint.extract", runs: 143, callsPerRun: 1, typicalMs: 121, slowMs: 290 },
  { drillType: "jump", stageId: "model.firstPrediction", parentStageId: "jump.extract", runs: 120, callsPerRun: 1, typicalMs: 41, slowMs: 88 },
  { drillType: "broadJump", stageId: "model.create", parentStageId: "broadJump.extract", runs: 12, callsPerRun: 1, typicalMs: 139, slowMs: 260 },
];

// MARK: - Reports

function uploadStats(filters: DevicePerformanceFilters, factor: number): UploadRoleStatV1[] {
  // Network changes only the upload numbers; processing totals never read it.
  const net = filters.networkInterface === "cellular" ? 0.45 : filters.networkInterface === "wifi" ? 1.25 : 1;
  const base: Record<string, [number, number, number, number, number, number]> = {
    // invocations, succeeded, failed, bytes, ms, notRequested
    resultFiles: [3_660, 3_604, 41, 2_190_000_000, 1_910_000, 0],
    optionalVideo: [212, 188, 17, 9_870_000_000, 1_140_000, 402],
    legacyVideo: [37, 36, 1, 3_120_000_000, 402_000, 0],
    diagnostics: [118, 116, 2, 88_400_000, 94_000, 0],
  };
  return UPLOAD_ROLES.map(role => {
    const [invocations, succeeded, failed, bytes, ms, notRequested] = base[role];
    const f = factor;
    return {
      role, notRequested: scaleCount(notRequested, f), invocations: scaleCount(invocations, f), succeeded: scaleCount(succeeded, f),
      failed: scaleCount(failed, f), cancelled: scaleCount(3, f), interrupted: scaleCount(2, f), pending: scaleCount(role === "optionalVideo" ? 9 : 4, f),
      excludedZeroOrUnknownDuration: scaleCount(role === "resultFiles" ? 16 : 1, f),
      payloadBytes: scaleCount(bytes, f), elapsedMs: Math.round((ms * f) / net),
      duration: scaleDist(dist(succeeded, (role === "resultFiles" ? 380 : role === "diagnostics" ? 690 : 5_400) / net, (role === "resultFiles" ? 1_450 : 14_800) / net, 0, failed + 16), f),
      queueWait: scaleDist(dist(succeeded, role === "optionalVideo" ? 38_000 : 240, role === "optionalVideo" ? 210_000 : 2_900, 12, 0, "crossLaunch"), f),
      knownBackoffMs: scaleCount(role === "optionalVideo" ? 640_000 : 95_000, f),
    };
  });
}

function reportBase(request: ReportRequestBaseV1, scenario: PreviewScenario, factor: number, perDevice = false) {
  const uncollected = scenario === "uncollected", empty = scenario === "empty" || uncollected, old = scenario === "oldBuilds";
  const drillFactor = (drill: DrillType) => (request.filters.drill && request.filters.drill !== drill ? 0 : 1);
  const filterFactor = empty ? 0 : factor * (request.filters.drill ? (DRILL_BASE[request.filters.drill].attempts / TOTAL_ATTEMPTS) : 1)
    * (request.filters.recordingMode === "station" ? 0.55 : request.filters.recordingMode === "ordinary" ? 0.45 : 1);
  const perDrill: DrillRowV1[] = DRILL_TYPES.map(drill => {
    const base = DRILL_BASE[drill], f = empty ? 0 : factor * drillFactor(drill);
    const cohort = scaleCount(base.attempts, f);
    const measured = old ? 0 : cohort;
    return {
      drillType: drill,
      attempts: cohort,
      timeToResult: old ? dist(0, null, null, cohort) : dist(measured, base.resultMs, base.slowMs, scaleCount(base.attempts * 0.04, f), 0, "crossLaunch"),
      allocation: measured ? { cohortSize: measured, meanTimeToResultMs: base.resultMs * 1.08, phases: MAIN_PHASES.map((phase, index) => ({ phase, meanMs: drill === "freeRecord" && phase === "calculation" ? null : base.phases[index] })) } : null,
      outcomes: scaleOutcomes(base.outcome, f),
    };
  });
  const sum = (pick: (row: DrillRowV1) => number) => perDrill.reduce((total, row) => total + pick(row), 0);
  const outcomeTotals = perDrill.reduce((total, row) => scaleOutcomes({
    valid: total.valid + row.outcomes.valid, partial: total.partial + row.outcomes.partial, noMeasurement: total.noMeasurement + row.outcomes.noMeasurement,
    failed: total.failed + row.outcomes.failed, cancelled: total.cancelled + row.outcomes.cancelled, interruptedUnknown: total.interruptedUnknown + row.outcomes.interruptedUnknown,
    pending: total.pending + row.outcomes.pending, preAdmissionFailures: total.preAdmissionFailures + row.outcomes.preAdmissionFailures,
  }, 1), outcomes(0));
  const attempts = sum(row => row.attempts), measuredAttempts = old ? 0 : attempts;
  const totals: TotalsV1 = {
    attempts,
    timeToResult: old ? dist(0, null, null, attempts) : dist(measuredAttempts, 18_900, 31_400, scaleCount(24, filterFactor), 0, "crossLaunch"),
    readyForNextRep: old ? dist(0, null, null, attempts) : dist(measuredAttempts, 21_600, 34_800, scaleCount(31, filterFactor), 0, "interrupted"),
    saveConfirmedAfterRecording: old ? dist(0, null, null, attempts) : dist(scaleCount(measuredAttempts * 0.83, 1), 26_200, 58_900, scaleCount(measuredAttempts * 0.17, 1), 0, "crossLaunch"),
    processingTime: {
      byOutcome: {
        valid: old ? dist(0, null, null, attempts) : dist(scaleCount(measuredAttempts * 0.95, 1), 15_700, 27_400),
        partial: dist(outcomeTotals.partial, 16_900, 24_000),
        noMeasurement: dist(outcomeTotals.noMeasurement, 14_200, 21_500),
        failed: dist(outcomeTotals.failed, 8_300, 19_600),
      },
      recovery: dist(scaleCount(11, filterFactor), 19_100, 29_300),
    },
    cloudSave: old ? dist(0, null, null, attempts) : dist(scaleCount(measuredAttempts * 0.97, 1), 4_300, 11_900, scaleCount(measuredAttempts * 0.03, 1), 0, "pendingUpload"),
    cloudBacklog: { pendingJobs: empty ? 0 : scaleCount(7, factor), failedJobs: empty ? 0 : scaleCount(1, factor), installsReporting: empty ? 0 : perDevice ? 1 : 58, oldestReportAt: empty ? null : "2026-09-25T19:10:00.000Z" },
    uploads: uploadStats(request.filters, empty ? 0 : filterFactor),
    outcomes: outcomeTotals,
    yield: { valid: scaleCount(outcomeTotals.valid * 0.97, 1), invalid: outcomeTotals.noMeasurement + outcomeTotals.failed, pending: outcomeTotals.pending + outcomeTotals.interruptedUnknown, userDiscarded: scaleCount(6, filterFactor), firstRunValid: scaleCount(outcomeTotals.valid * 0.94, 1) },
  };
  const days = Math.max(1, Math.round((Date.parse(`${request.endDate}T12:00:00Z`) - Date.parse(`${request.startDate}T12:00:00Z`)) / 86_400_000) + 1);
  const trends = Array.from({ length: Math.min(days, 90) }, (_, index) => {
    const date = new Date(Date.parse(`${request.startDate}T12:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
    const count = empty || old ? 0 : Math.max(0, Math.round((attempts / days) * (0.6 + ((index * 37) % 9) / 10)));
    return { date, attempts: count, timeToResult: dist(count, 17_000 + ((index * 1_733) % 5_000), 26_000 + ((index * 2_111) % 9_000)), failed: count ? index % 3 : 0, knownOutcomes: count, newBuilds: index === Math.min(days - 1, 3) && !empty ? ["1.4.1 (215)"] : [] };
  });
  const groups: MetricGroup[] = ["capture", "processing", "yield", "cloudSave", "upload"];
  return {
    schemaVersion: scenario === "newerFormat" ? 2 : REPORT_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    projectionRevision: "preview-revision-1",
    period: { startDate: request.startDate, endDate: request.endDate, timeZone: request.timeZone, dateBasis: request.dateBasis },
    filters: request.filters,
    effectiveFilters: Object.fromEntries(groups.map(group => [group, appliedFilters(group, request.filters)])),
    freshness: { sourceUpdatedAt: uncollected ? null : "2026-09-29T16:31:00.000Z", lastReportReceivedAt: uncollected ? null : "2026-09-29T16:31:00.000Z" },
    coverage: {
      collectionStartedAt: uncollected ? null : "2026-09-12T00:00:00.000Z",
      installsKnown: uncollected ? 0 : perDevice ? 1 : allDevices.length - 1,
      installsNotRecentlyReporting: uncollected || perDevice ? 0 : allDevices.filter(row => row.stale).length,
      attemptsIndexed: attempts,
      attemptsPartial: empty ? 0 : scaleCount(19, filterFactor),
      attemptsNotCollectedByVersion: old ? attempts : empty ? 0 : scaleCount(23, filterFactor),
      attemptsDateUncertain: empty ? 0 : scaleCount(5, filterFactor),
      attemptsUnknownDevice: empty || perDevice ? 0 : scaleCount(23, filterFactor),
      droppedDetailCount: empty ? 0 : scaleCount(12, filterFactor),
    },
    choices: {
      captureBuilds: BUILDS.map((build, index) => ({ key: build.key, label: build.label, count: index ? 402 : 197 })),
      captureMachines: MACHINES.map((machine, index) => ({ key: machine, label: machine, count: 40 + index * 17 })),
      executionBuilds: BUILDS.map((build, index) => ({ key: build.key, label: build.label, count: index ? 410 : 199 })),
      executionMachines: MACHINES.map((machine, index) => ({ key: machine, label: machine, count: 40 + index * 17 })),
      payloadSizeBands: [
        { key: "under100kB", label: "Under 100 kB", count: 2_901 }, { key: "100kBto1MB", label: "100 kB – 1 MB", count: 702 },
        { key: "1to10MB", label: "1 – 10 MB", count: 61 }, { key: "10to100MB", label: "10 – 100 MB", count: 180 }, { key: "over100MB", label: "Over 100 MB", count: 57 },
      ],
    },
    totals,
    perDrill,
    trends,
    failureStages: empty || old ? [] : STAGE_ROWS.filter(row => !request.filters.drill || row.drills.includes(request.filters.drill)).map(row => ({ ...row, failures: scaleCount(row.failures, factor), entered: scaleCount(row.entered, factor) || 1 })),
    // Optional block (D-26 J); absent from the old-build and empty states on purpose.
    innerModel: empty || old ? null : { rows: INNER_MODEL.filter(row => !request.filters.drill || row.drillType === request.filters.drill).map(row => {
      const runs = scaleCount(row.runs, factor);
      return { drillType: row.drillType, stageId: row.stageId, parentStageId: row.parentStageId, runs, invocations: scaleCount(row.runs * row.callsPerRun, factor), cumulativeMs: dist(runs, row.typicalMs, row.slowMs) };
    }) },
  };
}

const deviceRow = (device: PreviewDevice) => ({
  installId: device.installId, label: device.label, machine: device.machine, builds: device.builds.map(({ key, label }) => ({ key, label })),
  attempts: device.attempts, runs: device.runs, lastReportAt: device.lastReportAt, notRecentlyReporting: device.stale,
  timeToResult: device.installId ? dist(device.attempts - 2, device.resultMs, device.slowMs, 2, 0, "crossLaunch") : dist(0, null, null, device.attempts),
  cloudSave: device.installId ? dist(device.attempts - 3, device.saveMs, device.saveMs * 2.6, 3, 0, "pendingUpload") : dist(0, null, null, device.attempts),
  uploadWait: device.installId ? dist(device.attempts * 6, device.waitMs, device.waitMs * 4.2) : dist(0, null, null, device.attempts),
  outcomes: device.installId ? outcomes(device.known - device.failed, device.failed, 0, 0, device.runs - device.known > 0 ? 1 : 0, 0, 0) : outcomes(0, 0, 0, 0, 0, 0, 0, 0),
});

function sortedDevices(request: FleetRequestV1) {
  const search = request.search?.toLowerCase() ?? "";
  const rows = allDevices.filter(device => !search || [device.label, device.machine, device.installId].some(value => value?.toLowerCase().includes(search)));
  const score = (device: PreviewDevice): number => {
    switch (request.sort) {
      case "slowResult": return device.installId && device.attempts >= 20 ? -device.resultMs : Infinity;
      case "failureRate": return device.known >= 20 ? -(device.failed / device.known) : Infinity;
      case "failureCount": return -device.failed;
      case "uploadWait": return device.installId ? -device.waitMs : Infinity;
      case "lastSeen": return device.lastReportAt ? Date.parse(device.lastReportAt) : -Infinity;
      default: return device.installId && device.attempts >= 20 ? -(device.failed * 1e6 + device.resultMs) : Infinity;
    }
  };
  return [...rows].sort((a, b) => score(a) - score(b));
}

const pageOf = <T,>(rows: T[], cursor: string | null, pageSize: number) => {
  const offset = cursor && /^preview-page-\d+$/.test(cursor) ? Number(cursor.slice(13)) : 0;
  const next = offset + pageSize;
  return { rows: rows.slice(offset, next), pagination: { pageSize, nextCursor: next < rows.length ? `preview-page-${next}` : null, totalRows: rows.length } };
};

/** Attempt ids cycle through four timelines: healthy, failed then retried after a relaunch, stopped before processing, interrupted. */
export const ATTEMPT_IDS = Array.from({ length: 30 }, (_, index) => `9f${index.toString(16).padStart(6, "0")}-1a2b-4c3d-8e4f-${(index * 104_729 + 7).toString(16).padStart(12, "0").slice(-12)}`);
function attemptRows(filterDrill: DrillType | null, stageId: string | null, count = 24, installId: string | null = null): AttemptRowV1[] {
  return ATTEMPT_IDS.slice(0, count).map((attemptId, index) => {
    // Rows follow the drawer's four timelines (previewAttempt): 0 healthy, 1 failed then retried after a
    // relaunch, 2 stopped before processing, 3 interrupted.
    const variant = index % 4;
    const drill = filterDrill ?? (["deadballShot", "sprint", "jump", "changeOfDirection", "broadJump", "freeRecord"] as DrillType[])[index % 6];
    const device = installId ? allDevices.find(row => row.installId === installId) ?? namedDevices[0] : namedDevices[index % 7];
    const uncertain = index % 11 === 5, usable = variant <= 1;
    return {
      attemptId, originInstallId: device.installId, deviceLabel: device.label, machine: device.machine, drillType: drill,
      recordingMode: index % 2 ? "station" : "ordinary",
      captureOccurredAt: uncertain ? "2031-01-01T00:00:00.000Z" : `2026-09-${String(23 + index % 7).padStart(2, "0")}T${String(14 + index % 8).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}:00.000Z`,
      clockQuality: uncertain ? "future" : "reliable", receivedAt: `2026-09-${String(23 + index % 7).padStart(2, "0")}T${String(15 + index % 8).padStart(2, "0")}:00:00.000Z`,
      captureBuild: BUILDS[variant === 1 ? 0 : index % 2].label, executionBuilds: variant === 1 ? [BUILDS[0].label, BUILDS[1].label] : [BUILDS[index % 2].label],
      measurementVerdict: usable ? "valid" : "pending", verdictReason: variant === 2 ? "awaitingRetry" : variant === 3 ? "interrupted" : null,
      runCount: variant === 1 ? 2 : variant === 2 ? 0 : 1,
      timeToResultMs: variant === 0 ? 14_000 + (index * 1_931) % 20_000 : null,
      timeToResultMissing: variant === 1 ? "crossLaunch" : variant === 2 ? "notReached" : variant === 3 ? "interrupted" : null,
      cloudSaveMs: usable ? 2_800 + (index * 613) % 9_000 : null, cloudSaveMissing: usable ? null : "notReached",
      requiredSaveState: usable ? "committed" : "notQueued", archiveState: variant === 0 ? "uploaded" : "notRequested",
      failureStageId: variant === 2 ? stageId ?? "input.calibration" : null,
      lastReportedStageId: variant === 3 ? stageId ?? "kick.denseBall" : null,
      completeness: variant === 0 ? "complete" : "partial",
      // Variant 1 was retried on another install after a relaunch; variant 2 never had a run.
      executorInstallId: variant === 1 ? namedDevices[6].installId : variant === 2 ? null : device.installId,
    };
  });
}

// MARK: - Attempt detail records (contract recordV1 shapes)

const LAUNCH_A = "0C8B4E2A-1D3F-4A5B-9C6D-7E8F9A0B1C2D", LAUNCH_B = "9A8B7C6D-5E4F-4A3B-8C2D-1E0F9A8B7C6D";
const platform = (build: typeof BUILDS[number], machine = "iPhone14,7") => ({ appVersion: build.appVersion, build: build.build, sourceRevision: "preview0", machine, osVersion: "Version 26.0 (Build 23A341)", configuration: "Release" });
const stageRow = (stageId: string, elapsedMs: number | null, extra: Partial<StageSummaryV1> = {}): StageSummaryV1 => ({
  stageId, parentStageId: null, passId: null, status: elapsedMs === null ? "notNeeded" : "completed", invocationCount: elapsedMs === null ? 0 : 1,
  elapsedMs, activeMs: elapsedMs, continuousElapsedMs: elapsedMs, timingKind: "mainPhase", framesDecoded: null, modelCalls: null,
  missingObservations: null, failureCode: null, failureLayer: null, lastDurableStage: null, ...extra,
});
function envelope(kind: string, recordId: string, attemptId: string, extra: Record<string, unknown>, body: unknown) {
  return {
    performanceSchemaVersion: PERFORMANCE_SCHEMA_VERSION, recordKind: kind, recordId, revision: 1, attemptId, processingRunId: null, retryOfRunId: null,
    repId: null, commitJobId: null, originInstallId: namedDevices[0].installId, executorInstallId: namedDevices[0].installId,
    originLaunchId: LAUNCH_A, executionLaunchId: LAUNCH_A, stationDeviceId: null, originReporterUid: "previewReporter", drillType: "deadballShot",
    recordingMode: "station", processingMode: null, originPlatform: platform(BUILDS[0]), executorPlatform: null, captureFingerprint: null,
    modelFingerprint: null, policyVersion: null, occurredAtClient: "2026-09-29T08:16:02.887Z", captureOccurredAtClient: "2026-09-29T08:15:30.123Z",
    clockQuality: "reliable", completeness: "complete", missingReasons: [], droppedDetailCount: 0, origin: "field", evaluationRunId: null,
    ...extra, body,
  };
}
const captureStages = [
  stageRow("capture.stopRequested", 208), stageRow("capture.movieFinalized", 3.4),
  stageRow("capture.cameraStopAck", 139, { timingKind: "nestedOperation", parentStageId: "capture.movieFinalized" }),
  stageRow("capture.retainCopyHash", 402), stageRow("capture.calibrationFreeze", 22), stageRow("capture.snapshot", 58), stageRow("capture.referenceJournal", 17),
];
const kickStages = (failAt: string | null, interrupted = false) => {
  const rows = [
    stageRow("input.calibration", 2.7), stageRow("admission.requested", 0.5), stageRow("admission.granted", 9.4), stageRow("kick.beforeModel", 5.1),
    stageRow("kick.extract", 9_280, { passId: "kick.extract", framesDecoded: 1_203, modelCalls: 1_504, missingObservations: 17, lastDurableStage: "kick.extract" }),
    stageRow("model.create", 183, { passId: "kick.extract", timingKind: "nestedOperation", parentStageId: "kick.extract" }),
    stageRow("kick.denseBall", 6_090, { passId: "kick.denseBall", framesDecoded: 1_203, modelCalls: 611, lastDurableStage: "kick.denseBall" }),
    stageRow("kick.motionContact", 2_020, { passId: "kick.motionContact", framesDecoded: 1_203, modelCalls: 0 }),
    stageRow("kick.math", 91), stageRow("kick.encode", 137),
  ];
  if (!failAt && !interrupted) return rows;
  const index = rows.findIndex(row => row.stageId === (failAt ?? "kick.denseBall"));
  return rows.map((row, position) => position < index ? row
    : position === index ? { ...row, status: interrupted ? "interrupted" : "failed", elapsedMs: interrupted ? null : 3_112, activeMs: interrupted ? null : 3_112, continuousElapsedMs: interrupted ? null : 3_112, failureCode: interrupted ? null : "memory_pressure", failureLayer: interrupted ? null : "resource" }
      : row.timingKind === "nestedOperation" ? row : { ...row, status: "notReached", invocationCount: 0, elapsedMs: null, activeMs: null, continuousElapsedMs: null });
};
const acceptStages = [
  stageRow("artifact.persist", 94), stageRow("accept.manifestAck", 13),
  stageRow("accept.announce", 1_590, { timingKind: "nestedOperation", parentStageId: "flow.nextReady" }),
  stageRow("accept.correctionWindow", 6_020), stageRow("accept.progressAck", 312), stageRow("flow.nextReady", 1_904),
];
const runBody = (outcome: string, stages: StageSummaryV1[], failureStage: string | null) => ({
  outcome, failure: failureStage ? { code: "memory_pressure", stage: failureStage, disposition: "retryable", layer: "resource" } : null,
  cancellationReason: null, priority: "liveRep", reviewRequest: "none", poseDelegateRequested: "cpu", poseDelegateActual: outcome === "interruptedUnknown" ? null : "cpu",
  poseDelegateFallbackReason: null, yoloComputeUnits: "all", modelCacheState: "warm", stages,
  passIds: ["kick.extract", "kick.denseBall", "kick.motionContact"],
  totals: { admissionWaitMs: 0.5, processingMs: stages.reduce((sum, row) => sum + (row.timingKind === "mainPhase" ? row.elapsedMs ?? 0 : 0), 0), journalFinalizeMs: 11, framesDecoded: 3_609, modelCalls: 2_115 },
  resources: { admitted: { footprintBytes: 612_368_384, availableBytes: 2_147_483_648, freeDiskBytes: 40_802_189_312, pendingUploads: 2, thermalState: "nominal" }, released: null, sampledPeakBytes: 902_823_936 },
});
const groupBody = (attemptId: string, category: string, jobState: string, cloudSaveMs: number | null, extra: Record<string, unknown> = {}) => ({
  groupId: `${attemptId}:${category}`, category, jobState, uniqueObjectCount: category === "resultFiles" ? 6 : 1, uniqueObjectBytes: category === "resultFiles" ? 1_843_377 : 48_210_004,
  queueWaitMs: 240, knownBackoffMs: null, cloudSaveMs, transferAttemptCount: 6, successfulTransferCount: 6, failedTransferCount: 0, lifetimeRetryCount: 0,
  requiredCommitAcknowledged: category === "resultFiles" ? jobState === "committed" : null, firestoreWriteMs: category === "resultFiles" ? 598 : null, ...extra,
});
const transfer = (attemptId: string, index: number, role: string, category: string, bytes: number, elapsedMs: number | null, outcome: string, launch = LAUNCH_A) => envelope("transferInvocation",
  `ab${index.toString(16).padStart(6, "0")}-0f9e-4d8c-8b7a-6f5e4d3c2b1a`, attemptId, { executionLaunchId: launch, executorPlatform: platform(BUILDS[launch === LAUNCH_A ? 0 : 1]) }, {
    invocationId: `ab${index.toString(16).padStart(6, "0")}-0f9e-4d8c-8b7a-6f5e4d3c2b1a`,
    logicalObjectId: `${attemptId}/${role}.${index}/${"1234567890abcdef".repeat(4)}`,
    groupId: `${attemptId}:${category}`, outerCommitOrdinal: 1 + (outcome === "failed" ? 0 : 1), objectOrdinal: index, objectRole: role,
    transport: role === "videoArchive" ? "firebaseStoragePutFile" : "firebaseStoragePutData", payloadBytes: bytes, progressCompletedBytes: outcome === "succeeded" ? bytes : Math.round(bytes / 3),
    queueWaitMs: 12, authorizationMs: null, invocationElapsedMs: elapsedMs, knownBackoffMs: outcome === "failed" ? 30_000 : null, observedPauseMs: null,
    sdkInternalRetryCount: null, networkInterface: index % 2 ? "cellular" : "wifi", constrained: false, expensive: index % 2 === 1, outcome,
    providerDomain: outcome === "failed" ? "FIRStorageErrorDomain" : null, providerCode: outcome === "failed" ? -13030 : null,
    normalizedFailureCode: outcome === "failed" ? "networkUnavailable" : null, failureStage: null,
  });

export function previewAttempt(attemptId: string) {
  const position = ATTEMPT_IDS.indexOf(attemptId);
  const variant = position < 0 ? 0 : position % 4; // unknown ids use the healthy variant
  const run1 = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", run2 = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e50";
  const attemptBody = (extra: Record<string, unknown>, stages: StageSummaryV1[]) => ({
    stages, spans: { timeToResultMs: 21_874, readyForNextRepMs: 31_305, saveConfirmedAfterRecordingMs: 27_902 },
    continuousSpans: { timeToResultMs: 21_874, readyForNextRepMs: 31_305, saveConfirmedAfterRecordingMs: 27_902 },
    inputSource: { calibration: "stationBundle", mass: null, snapshotIdentityHash: null },
    captureFormat: { requestedFPS: 120, appliedFPS: 120, formatWidth: 1920, formatHeight: 1080, measuredNominalFPS: 119.9, measuredDurationSeconds: 10.0, uprightWidth: 1080, uprightHeight: 1920 },
    measurementVerdict: "valid", verdictReason: null, stationVerdict: "valid", preAdmissionFailure: null, primaryMetricFinite: true,
    requiredSaveState: "committed", sidecarState: "uploaded", archiveState: "uploaded", runCount: 1, acceptedRunId: run1, launchSegmentCount: 1, lifecycleTransitionCount: 2,
    ...extra,
  });
  let attempt: unknown, runs: unknown[], groups: unknown[], transfers: unknown[];
  let evidence = [{ kind: "processingAttempt", id: attemptId, availability: "available" }, { kind: "run", id: run1, availability: "available" }];
  if (variant === 0) {
    attempt = envelope("attemptSummary", attemptId, attemptId, {}, attemptBody({}, [...captureStages, ...acceptStages]));
    runs = [envelope("runSummary", run1, attemptId, { processingRunId: run1, processingMode: "liveCapture", executorPlatform: platform(BUILDS[0]), policyVersion: { id: "baseline-v1", hash: "63256738ad026d65118ce3b15a01e69ac3ae728876df23cf815191999df23d56", components: {} } }, runBody("valid", kickStages(null), null))];
    groups = [
      envelope("uploadGroupSummary", `${attemptId}:resultFiles`, attemptId, {}, groupBody(attemptId, "resultFiles", "committed", 4_120)),
      envelope("uploadGroupSummary", `${attemptId}:optionalVideo`, attemptId, {}, groupBody(attemptId, "optionalVideo", "committed", 38_400)),
    ];
    transfers = [transfer(attemptId, 0, "resultArtifact", "resultFiles", 1_520_311, 2_310, "succeeded"), transfer(attemptId, 1, "resultArtifact", "resultFiles", 84_220, 402, "succeeded"), transfer(attemptId, 2, "videoArchive", "optionalVideo", 48_210_004, 31_900, "succeeded")];
  } else if (variant === 1) {
    // Failed run, relaunch, successful retry: two launches with an unknown gap; expired evidence.
    attempt = envelope("attemptSummary", attemptId, attemptId, { completeness: "partial", missingReasons: [{ field: "/spans/timeToResultMs", reason: "crossLaunch" }, { field: "/continuousSpans/timeToResultMs", reason: "crossLaunch" }, { field: "/spans/saveConfirmedAfterRecordingMs", reason: "crossLaunch" }, { field: "/continuousSpans/saveConfirmedAfterRecordingMs", reason: "crossLaunch" }] },
      attemptBody({ spans: { timeToResultMs: null, readyForNextRepMs: 30_004, saveConfirmedAfterRecordingMs: null }, continuousSpans: { timeToResultMs: null, readyForNextRepMs: 30_004, saveConfirmedAfterRecordingMs: null }, runCount: 2, acceptedRunId: run2, launchSegmentCount: 2, archiveState: "notRequested" }, [...captureStages, ...acceptStages.slice(0, 2)]));
    runs = [
      envelope("runSummary", run1, attemptId, { processingRunId: run1, processingMode: "liveCapture", executorPlatform: platform(BUILDS[0]), completeness: "complete" }, runBody("failed", kickStages("kick.denseBall"), "kick.denseBall")),
      envelope("runSummary", run2, attemptId, { processingRunId: run2, retryOfRunId: run1, processingMode: "recovery", executionLaunchId: LAUNCH_B, executorInstallId: namedDevices[6].installId, executorPlatform: platform(BUILDS[1], "iPhone14,2") }, runBody("valid", kickStages(null), null)),
    ];
    groups = [envelope("uploadGroupSummary", `${attemptId}:resultFiles`, attemptId, { executionLaunchId: LAUNCH_B }, groupBody(attemptId, "resultFiles", "committed", 9_880, { knownBackoffMs: 35_000, failedTransferCount: 2, lifetimeRetryCount: 2, transferAttemptCount: 8 }))];
    transfers = [transfer(attemptId, 0, "resultArtifact", "resultFiles", 1_520_311, null, "failed", LAUNCH_B), transfer(attemptId, 1, "resultArtifact", "resultFiles", 1_520_311, 2_910, "succeeded", LAUNCH_B)];
    evidence = [{ kind: "processingAttempt", id: attemptId, availability: "expired" }, { kind: "run", id: run1, availability: "expired" }, { kind: "failureCase", id: "fc-preview-0001", availability: "expired" }];
  } else if (variant === 2) {
    // Stopped before processing started (pre-admission failure): no run exists.
    attempt = envelope("attemptSummary", attemptId, attemptId, { completeness: "partial", missingReasons: [{ field: "/spans/timeToResultMs", reason: "notReached" }] },
      attemptBody({ spans: { timeToResultMs: null, readyForNextRepMs: 2_310, saveConfirmedAfterRecordingMs: null }, measurementVerdict: "pending", verdictReason: "awaitingRetry", stationVerdict: "unknown", preAdmissionFailure: { stage: "input.calibration", failureCode: "calibration_unavailable", failureLayer: "input" }, primaryMetricFinite: null, requiredSaveState: "notQueued", sidecarState: "notRequested", archiveState: "notRequested", runCount: 0, acceptedRunId: null }, captureStages));
    runs = []; groups = []; transfers = [];
    evidence = [{ kind: "processingAttempt", id: attemptId, availability: "pending" }];
  } else {
    // Interrupted run: only the last reported step is known.
    attempt = envelope("attemptSummary", attemptId, attemptId, { completeness: "partial", missingReasons: [{ field: "/spans/timeToResultMs", reason: "interrupted" }] },
      attemptBody({ spans: { timeToResultMs: null, readyForNextRepMs: null, saveConfirmedAfterRecordingMs: null }, measurementVerdict: "pending", verdictReason: "interrupted", requiredSaveState: "notQueued", sidecarState: "notRequested", archiveState: "notRequested", acceptedRunId: null }, captureStages));
    runs = [envelope("runSummary", run1, attemptId, { processingRunId: run1, processingMode: "liveCapture", completeness: "partial", missingReasons: [] }, runBody("interruptedUnknown", kickStages(null, true), null))];
    groups = []; transfers = [];
    evidence = [{ kind: "processingAttempt", id: attemptId, availability: "notCollected" }];
  }
  return {
    schemaVersion: REPORT_SCHEMA_VERSION, generatedAt: GENERATED_AT, attemptId, attempt, runs, uploadGroups: groups, transfers,
    transferPagination: { pageSize: 50, nextCursor: null, totalRows: transfers.length },
    receivedAt: { firstReceivedAtServer: "2026-09-29T08:16:05.000Z", updatedAtServer: "2026-09-29T09:02:13.000Z" },
    devices: [{ installId: namedDevices[0].installId!, label: namedDevices[0].label }], evidence,
  };
}

// MARK: - Source

function detailRows(request: DetailRequestV1, device: PreviewDevice) {
  const all = attemptRows(null, null, Math.min(30, device.attempts), device.installId);
  if (request.section === "uploads") {
    const uploads: UploadRowV1[] = all.flatMap((row, index) => (row.archiveState === "notRequested" ? ["resultFiles"] as const : ["resultFiles", "optionalVideo"] as const).map(role => ({
      attemptId: row.attemptId, groupId: `${row.attemptId}:${role}`, role, drillType: row.drillType, occurredAt: row.captureOccurredAt, clockQuality: row.clockQuality,
      jobState: role === "optionalVideo" && index % 3 === 0 ? "inProgress" : row.requiredSaveState === "notQueued" ? "notRequested" : "committed",
      objectCount: role === "resultFiles" ? 6 : 1, bytes: role === "resultFiles" ? 1_300_000 + index * 21_000 : 41_000_000 + index * 900_000,
      queueWaitMs: index % 9 === 4 ? null : 180 + index * 37, transferMs: role === "resultFiles" ? 900 + index * 51 : 24_000 + index * 800,
      cloudSaveMs: role === "resultFiles" ? row.cloudSaveMs : null, transferAttempts: index % 6 === 1 ? 8 : 6, failedTransfers: index % 6 === 1 ? 2 : 0, lifetimeRetries: index % 6 === 1 ? 2 : 0,
      requiredCommitAcknowledged: role === "resultFiles" ? row.requiredSaveState === "committed" : null,
    })));
    return { kind: "uploads", ...pageOf(uploads, request.cursor, request.pageSize) };
  }
  if (request.section === "failures") {
    const stage = request.focus?.kind === "stage" ? request.focus.stageId : null;
    const failures: FailureRowV1[] = all.filter(row => (row.failureStageId || row.lastReportedStageId) && (!stage || row.failureStageId === stage || row.lastReportedStageId === stage)).map(row => ({
      // Variant 2 stopped before a run existed; variant 3 was interrupted inside its run.
      attemptId: row.attemptId, processingRunId: row.failureStageId ? null : "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", stageId: (row.failureStageId ?? row.lastReportedStageId)!,
      failureCode: row.failureStageId ? "calibration_unavailable" : null, failureLayer: row.failureStageId ? "input" : null, confirmed: !!row.failureStageId,
      occurredAt: row.captureOccurredAt, clockQuality: row.clockQuality, drillType: row.drillType, build: row.captureBuild,
    }));
    return { kind: "failures", ...pageOf(failures, request.cursor, request.pageSize) };
  }
  return { kind: "processing", ...pageOf(all, request.cursor, request.pageSize) };
}

export function previewFleet(request: FleetRequestV1, scenario: PreviewScenario = "normal") {
  const empty = scenario === "empty" || scenario === "uncollected";
  const devices = empty ? { rows: [], pagination: { pageSize: request.pageSize, nextCursor: null, totalRows: 0 } } : pageOf(sortedDevices(request).map(deviceRow), request.cursor, request.pageSize);
  const focusStage = request.focus?.kind === "stage" ? request.focus.stageId : null;
  const focusDrill = request.focus?.kind === "phase" ? request.focus.drill : request.filters.drill;
  const focused = request.focus && !empty ? pageOf(attemptRows(focusDrill, focusStage), request.attemptsCursor, 10) : null;
  return {
    ...reportBase(request, scenario, 1),
    devices: devices.rows,
    pagination: devices.pagination,
    focus: request.focus,
    attempts: focused?.rows ?? null,
    attemptPagination: focused?.pagination ?? null,
  };
}

export function previewDevice(request: DetailRequestV1, scenario: PreviewScenario = "normal") {
  const device = allDevices.find(row => row.installId === request.installId);
  if (!device) throw failure("not-found");
  const factor = device.attempts / TOTAL_ATTEMPTS;
  const rows = detailRows(request, device);
  return {
    ...reportBase(request, scenario, request.attribution === "executor" ? factor * (device.runs / device.attempts) : factor, true),
    device: {
      installId: device.installId!, label: device.label, labelRevision: 3, machine: device.machine,
      builds: device.builds.map((build, index) => ({ ...build, osVersions: ["Version 26.0 (Build 23A341)"], firstSeenAt: index ? "2026-09-25T10:00:00.000Z" : "2026-09-12T08:00:00.000Z", lastSeenAt: index || device.builds.length === 1 ? device.lastReportAt : "2026-09-25T09:40:00.000Z" })),
      lastReportAt: device.lastReportAt, notRecentlyReporting: device.stale, collectionStartedAt: "2026-09-12T08:00:00.000Z",
      lastStatus: { reportedAt: device.lastReportAt, collectionCapability: "full", repQueuePending: device.stale ? 5 : 0, repQueueFailed: device.stale ? 1 : 0, oldestPendingRepAgeSeconds: device.stale ? 331_200 : null, spoolRecordCount: device.stale ? 212 : 4, droppedRecordCount: device.stale ? 12 : 0 },
    },
    attribution: request.attribution,
    rows: { kind: rows.kind, [rows.kind === "processing" ? "attempts" : rows.kind]: rows.rows },
    pagination: rows.pagination,
  };
}

const labels = new Map<string, { label: string | null; revision: number }>();

export function createPreviewSource(scenarioName: string | null): DevicePerformanceSource {
  const scenario = scenarioOf(scenarioName);
  // paged: a request carrying a cursor; detail: a page, focus or section beyond the first view.
  const gate = async (paged: boolean, detail: boolean) => {
    if (scenario === "loading") return new Promise<never>(() => undefined);
    await wait(250);
    if (scenario === "error") throw failure("internal");
    if (scenario === "oversized") throw failure("resource-exhausted", { limit: 50_000 });
    if (paged && scenario === "staleCursor") throw failure("failed-precondition");
    if ((paged || detail) && scenario === "detailError") throw failure("unavailable");
  };
  return {
    kind: "preview",
    scenarios: PREVIEW_SCENARIOS,
    async fleet(request) {
      const paged = Boolean(request.cursor || request.attemptsCursor);
      await gate(paged, paged || Boolean(request.focus));
      return parseFleetReport(previewFleet(request, scenario));
    },
    async device(request) {
      await gate(Boolean(request.cursor), Boolean(request.cursor) || request.section !== "processing");
      const report = previewDevice(request, scenario);
      const stored = labels.get(request.installId);
      if (stored) Object.assign(report.device, { label: stored.label, labelRevision: stored.revision });
      return parseDeviceReport(report);
    },
    async attempt(request: AttemptRequestV1) {
      await gate(false, scenario === "detailError");
      return parseAttemptDetail(previewAttempt(request.attemptId));
    },
    async rename(request: LabelRequestV1) {
      await wait(200);
      const current = labels.get(request.installId)?.revision ?? 3;
      if (request.expectedRevision !== current) throw failure("failed-precondition");
      labels.set(request.installId, { label: request.label, revision: current + 1 });
      return parseLabelResult({ schemaVersion: REPORT_SCHEMA_VERSION, installId: request.installId, label: request.label, labelRevision: current + 1 });
    },
  };
}
