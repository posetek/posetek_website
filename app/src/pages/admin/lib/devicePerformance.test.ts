// The device-performance data library: contract fixtures, response refusal,
// the Limited-data and null-with-reason rules, the plan 07 §3 filter scope,
// query-state merging and cursor reset, and the attempt timeline.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CALLABLES, DEFAULT_FILTERS, DevicePerformanceResponseError, FILTER_SCOPE, LIMITED_DATA_MIN_SAMPLES, PARAMS, UPLOAD_FILTERS,
  allocationView, appliedFilters, attemptTimeline, createDevicePerformanceClient, createReportCache, customRangeProblem,
  dateInZone, describeLoadFailure, detailRequest, devicePath, devicePerformanceSearch, failureRate, fleetPath, fleetRequest,
  forgetCachedReports, formatBytes, formatDuration, formatMBps, isLimitedData, loadDevicePerformanceSource,
  parseAttemptDetail, parseDeviceReport, parseDevicePerformanceQuery, parseFleetReport, parsePerformanceRecord,
  attemptDeviceName, excludedCountText, retentionNote,
  recoverFromFailure, recoveryLabel, reportCacheFor, reportKeys, reportModeFor, reportStateFor, scopeMismatches,
  stageLabel, statView, statedScope, usableYield, weightedThroughputMBps,
} from "./devicePerformance";
import type {
  AttemptSummaryRecordV1, DistributionStatV1, FleetReportV1, RunSummaryRecordV1, UploadGroupRecordV1,
} from "./devicePerformance";
import { PREVIEW_SCENARIOS, previewDevice, previewFleet } from "./devicePerformancePreview";

// MARK: - Fixture copy (fail, never skip, when the canonical checkout is absent)

const SCHEMA_SHA256 = "906c843cc446a29bcc8e8f2947e9ed11246f03929b1b93731e3273042fba1f49";
const CANONICAL = path.join("tools", "contracts", "device-performance-v1");
const localCopy = fileURLToPath(new URL("./__fixtures__/device-performance-v1/", import.meta.url));
const websiteRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(localCopy, "fixtures", name), "utf8"));

/** POSETEK_MOBILE_REPO wins; otherwise ../PoseTek-mobile-app beside this checkout, or beside the main checkout of a linked worktree. */
function mobileRepoCandidates(): string[] {
  if (process.env.POSETEK_MOBILE_REPO) return [path.resolve(process.env.POSETEK_MOBILE_REPO)];
  const candidates = [path.resolve(websiteRoot, "../PoseTek-mobile-app")];
  const gitFile = path.join(websiteRoot, ".git");
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitFile, "utf8"))?.[1]?.trim();
    if (gitdir) candidates.push(path.resolve(path.dirname(path.resolve(websiteRoot, gitdir, "../..")), "../PoseTek-mobile-app"));
  }
  return candidates;
}

describe("canonical device-performance-v1 copy", () => {
  it("is byte-identical to the canonical contract in the sibling mobile checkout", () => {
    const candidates = mobileRepoCandidates();
    const repo = candidates.find(dir => existsSync(path.join(dir, CANONICAL, "schema.json")));
    if (!repo) {
      throw new Error(`The canonical contract was not found at ${candidates.map(dir => path.join(dir, CANONICAL)).join(" or ")}. `
        + "Check out PoseTek-mobile-app beside this repository or set POSETEK_MOBILE_REPO. This check fails rather than skips.");
    }
    const canonical = path.join(repo, CANONICAL);
    expect(sha256(path.join(canonical, "schema.json"))).toBe(sha256(path.join(localCopy, "schema.json")));
    const canonicalFiles = readdirSync(path.join(canonical, "fixtures")).filter(name => name.endsWith(".json")).sort();
    const localFiles = readdirSync(path.join(localCopy, "fixtures")).sort();
    expect(localFiles).toEqual(canonicalFiles);
    for (const name of canonicalFiles) {
      expect(sha256(path.join(localCopy, "fixtures", name)), name).toBe(sha256(path.join(canonical, "fixtures", name)));
    }
    // The README's pinned digest table must describe these same bytes.
    const readme = readFileSync(path.join(canonical, "README.md"), "utf8");
    const pinned = [...readme.matchAll(/^\| `([^`]+\.json)` \| `([0-9a-f]{64})` \|$/gm)].map(match => [match[1], match[2]] as const);
    expect(pinned.length).toBeGreaterThanOrEqual(19);
    for (const [file, digest] of pinned) expect(sha256(path.join(localCopy, file)), file).toBe(digest);
  });

  it("pins the frozen schema digest", () => {
    expect(sha256(path.join(localCopy, "schema.json"))).toBe(SCHEMA_SHA256);
  });
});

// MARK: - Record and response parsing

const VALID_RECORDS: [string, string][] = [
  ["attempt-summary.valid.json", "attemptSummary"],
  ["attempt-summary-pre-admission-failure.valid.json", "attemptSummary"],
  ["run-summary.valid.json", "runSummary"],
  ["run-summary-evaluation-origin.valid.json", "runSummary"],
  ["upload-group-summary.valid.json", "uploadGroupSummary"],
  ["upload-group-summary-video-unavailable.valid.json", "uploadGroupSummary"],
  ["transfer-invocation.valid.json", "transferInvocation"],
];

describe("contract record parsing", () => {
  it.each(VALID_RECORDS)("reads %s as a %s record", (file, kind) => {
    const record = parsePerformanceRecord<{ recordKind: string }>(fixture(file), kind);
    expect(record.recordKind).toBe(kind);
  });

  it("refuses a record whose performanceSchemaVersion is not 1", () => {
    const newer = { ...fixture("run-summary.valid.json"), performanceSchemaVersion: 2 };
    expect(() => parsePerformanceRecord(newer, "runSummary")).toThrow(DevicePerformanceResponseError);
    try { parsePerformanceRecord(newer, "runSummary"); } catch (error) { expect((error as DevicePerformanceResponseError).reason).toBe("unsupportedVersion"); }
  });

  it("refuses a record of the wrong kind or with a missing key", () => {
    expect(() => parsePerformanceRecord(fixture("run-summary.valid.json"), "attemptSummary")).toThrow(/recordKind/);
    const { body, ...withoutBody } = fixture("upload-group-summary.valid.json");
    void body;
    expect(() => parsePerformanceRecord(withoutBody, "uploadGroupSummary")).toThrow(/body/);
  });
});

const baseQuery = parseDevicePerformanceQuery("", new Date("2026-09-29T18:00:00Z"));
const normalReport = () => previewFleet(fleetRequest(baseQuery)) as unknown as Record<string, unknown>;
const previewDeviceRaw = () => previewDevice(detailRequest("0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5", baseQuery)) as unknown;

describe("report parsing refuses what it does not understand", () => {
  it("accepts the preview fleet report and every preview scenario that returns data", () => {
    for (const scenario of PREVIEW_SCENARIOS.map(row => row.key).filter(key => ["normal", "empty", "uncollected", "oldBuilds"].includes(key))) {
      expect(parseFleetReport(previewFleet(fleetRequest(baseQuery), scenario)).schemaVersion).toBe(1);
    }
  });

  it("refuses an unknown or missing schemaVersion instead of guessing", () => {
    for (const schemaVersion of [2, 0, "1", undefined]) {
      const raw = { ...normalReport(), schemaVersion };
      expect(() => parseFleetReport(raw)).toThrow(/format version/);
    }
    expect(() => parseFleetReport(previewFleet(fleetRequest(baseQuery), "newerFormat"))).toThrow(DevicePerformanceResponseError);
  });

  it("refuses a statistic without its counts", () => {
    const raw = normalReport();
    const totals = raw.totals as Record<string, Record<string, unknown>>;
    delete totals.timeToResult.sample;
    expect(() => parseFleetReport(raw)).toThrow(/report\.totals\.timeToResult\.sample/);
  });

  it("accepts the optional executor install id on attempt rows, absent, null or present (D-26 D)", () => {
    const focused = () => previewFleet(fleetRequest(parseDevicePerformanceQuery("focus=stage:kick.denseBall", new Date("2026-09-29T18:00:00Z")))) as unknown as { attempts: Record<string, unknown>[] };
    const withIds = focused();
    expect(parseFleetReport(withIds).attempts!.map(row => row.executorInstallId)).toContain("6db25a74-8b9f-4c23-a4d5-a6b7c8d9e0f1");
    const absent = focused();
    for (const row of absent.attempts) delete row.executorInstallId;
    expect(parseFleetReport(absent).attempts![0].executorInstallId).toBeUndefined();
    const wrong = focused();
    wrong.attempts[0].executorInstallId = 42;
    expect(() => parseFleetReport(wrong)).toThrow(/attempts\[0\]\.executorInstallId/);
  });

  it("accepts the optional inner-model block, absent, null or complete, and checks its rows (D-26 J)", () => {
    const raw = normalReport();
    expect(parseFleetReport(raw).innerModel?.rows.length).toBeGreaterThan(0);
    delete raw.innerModel;
    expect(parseFleetReport(raw).innerModel).toBeUndefined();
    expect(parseFleetReport({ ...normalReport(), innerModel: null }).innerModel).toBeNull();
    const broken = normalReport();
    delete ((broken.innerModel as { rows: Record<string, unknown>[] }).rows[0]).cumulativeMs;
    expect(() => parseFleetReport(broken)).toThrow(/innerModel\.rows\[0\]\.cumulativeMs/);
  });

  it("reads processing time by outcome with its own noMeasurement bucket, and refuses the old flat shape (D-27 1)", () => {
    const raw = normalReport();
    expect(parseFleetReport(raw).totals.processingTime.byOutcome.noMeasurement.sample).toBeGreaterThan(0);
    const flat = normalReport();
    const totals = flat.totals as Record<string, Record<string, unknown>>;
    totals.processingTime = { valid: totals.timeToResult, partial: totals.timeToResult, failed: totals.timeToResult, recovery: totals.timeToResult };
    expect(() => parseFleetReport(flat)).toThrow(/processingTime\.byOutcome/);
    const missing = normalReport();
    delete ((missing.totals as Record<string, Record<string, Record<string, unknown>>>).processingTime.byOutcome).noMeasurement;
    expect(() => parseFleetReport(missing)).toThrow(/byOutcome\.noMeasurement/);
  });

  it("holds inner-model rows to model operations, unique by drill and stage (D-27 6)", () => {
    const rows = (report: Record<string, unknown>) => (report.innerModel as { rows: Record<string, unknown>[] }).rows;
    const notModel = normalReport();
    rows(notModel)[0].stageId = "kick.extract";
    expect(() => parseFleetReport(notModel)).toThrow(/innerModel\.rows\[0\]\.stageId: expected a model operation/);
    const duplicate = normalReport();
    rows(duplicate).push({ ...rows(duplicate)[0] });
    expect(() => parseFleetReport(duplicate)).toThrow(/unique drillType:stageId \(deadballShot:model\.create repeats\)/);
  });

  it("validates optional server metric definitions as a map of {label, definition, unit, population, denominator} (D-27 2)", () => {
    const definitions = { failureRate: { label: "Processing failures", definition: "failed / known outcomes", unit: "ratio", population: "terminal runs", denominator: "valid+partial+noMeasurement+failed" },
      timeToResult: { label: "Time to result", definition: "movie finalized to result accepted", unit: "ms", population: "accepted attempts", denominator: null } };
    expect(parseFleetReport({ ...normalReport(), metricDefinitions: definitions }).metricDefinitions?.failureRate.unit).toBe("ratio");
    expect(() => parseFleetReport({ ...normalReport(), metricDefinitions: { timeToResult: { label: "x", definition: "y" } } })).toThrow(/metricDefinitions\.timeToResult\.unit/);
    expect(() => parseFleetReport({ ...normalReport(), metricDefinitions: [] })).toThrow(/keyed by metric id/);
  });

  it("refuses a negative duration (the telemetry -1 sentinel is not a value)", () => {
    const raw = normalReport();
    (raw.totals as Record<string, Record<string, unknown>>).cloudSave.typicalMs = -1;
    expect(() => parseFleetReport(raw)).toThrow(/cloudSave\.typicalMs/);
  });
});

describe("reporting V1 review keys (D-31)", () => {
  const withRunFilter = () => previewFleet(fleetRequest(parseDevicePerformanceQuery("pmode=liveCapture&drill=sprint", new Date("2026-09-29T18:00:00Z")))) as unknown as Record<string, Record<string, Record<string, unknown>>>;

  it("F8: accepts null pending and pre-admission counts in totals, drill rows and device rows, each with its reason", () => {
    const report = parseFleetReport(withRunFilter());
    expect(report.totals.outcomes).toMatchObject({ pending: null, preAdmissionFailures: null, omittedReasons: { pending: "runFilterActive", preAdmissionFailures: "runFilterActive" } });
    expect(report.perDrill.every(row => row.outcomes.pending === null)).toBe(true);
    expect(report.devices.every(row => row.outcomes.preAdmissionFailures === null)).toBe(true);
    const executor = parseDeviceReport(previewDevice({ ...detailRequest("0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5", baseQuery), attribution: "executor" }));
    expect(executor.totals.outcomes).toMatchObject({ pending: null, omittedReasons: { pending: "executorAttribution", preAdmissionFailures: null } });
    expect(executor.totals.outcomes.preAdmissionFailures).not.toBeNull();
  });

  it("F8: refuses a null count without a reason, a reason on a present count, and a missing omittedReasons", () => {
    const silent = withRunFilter();
    (silent.totals.outcomes.omittedReasons as Record<string, unknown>).pending = null;
    expect(() => parseFleetReport(silent)).toThrow(/totals\.outcomes\.omittedReasons\.pending: expected a reason exactly when pending is null/);
    const spurious = normalReport() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    (spurious.totals.outcomes.omittedReasons as Record<string, unknown>).preAdmissionFailures = "runFilterActive";
    expect(() => parseFleetReport(spurious)).toThrow(/omittedReasons\.preAdmissionFailures/);
    const missing = normalReport() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    delete missing.totals.outcomes.omittedReasons;
    expect(() => parseFleetReport(missing)).toThrow(/totals\.outcomes\.omittedReasons/);
    const unknownReason = withRunFilter();
    (unknownReason.totals.outcomes.omittedReasons as Record<string, unknown>).pending = "tooBusy";
    expect(() => parseFleetReport(unknownReason)).toThrow(/runFilterActive, executorAttribution/);
  });

  it("F3/F5/F1/F6: requires retention, runs left out by mode and the new coverage counts", () => {
    const report = parseFleetReport(normalReport());
    expect(report.totals.uploads.every(row => row.retention === "retained" && row.groupsBeyondRetention === 0)).toBe(true);
    expect(report.totals.runsExcludedByMode).toMatchObject({ debugReview: expect.any(Number), fixture: expect.any(Number), validation: expect.any(Number) });
    expect(report.coverage).toMatchObject({ attemptsExcludedOverLimit: 1, attemptsDeviceNotYetReported: expect.any(Number) });
    expect(parseFleetReport(withRunFilter()).totals.runsExcludedByMode).toBeNull();
    const old = parseFleetReport(previewFleet(fleetRequest(parseDevicePerformanceQuery("start=2026-07-10&end=2026-08-20", new Date("2026-09-29T18:00:00Z")))));
    expect(old.totals.uploads[0]).toMatchObject({ retention: "notRetained", invocations: 0 });
    for (const [path, mutate] of [
      ["retention", (raw: Record<string, Record<string, unknown>>) => { delete (raw.totals.uploads as Record<string, unknown>[])[0].retention; }],
      ["groupsBeyondRetention", (raw: Record<string, Record<string, unknown>>) => { delete (raw.totals.uploads as Record<string, unknown>[])[0].groupsBeyondRetention; }],
      ["attemptsExcludedOverLimit", (raw: Record<string, Record<string, unknown>>) => { delete raw.coverage.attemptsExcludedOverLimit; }],
      ["attemptsDeviceNotYetReported", (raw: Record<string, Record<string, unknown>>) => { delete raw.coverage.attemptsDeviceNotYetReported; }],
      ["runsExcludedByMode", (raw: Record<string, Record<string, unknown>>) => { delete raw.totals.runsExcludedByMode; }],
    ] as const) {
      const raw = normalReport() as unknown as Record<string, Record<string, unknown>>;
      mutate(raw);
      expect(() => parseFleetReport(raw), path).toThrow(new RegExp(path));
    }
  });

  it("F5: pools no free-record (validation) runs and counts them apart", () => {
    const report = parseFleetReport(normalReport());
    const local = report.perDrill.filter(row => row.drillType !== "freeRecord").reduce((sum, row) => sum + row.outcomes.valid, 0);
    const free = report.perDrill.find(row => row.drillType === "freeRecord")!.outcomes;
    expect(report.totals.outcomes.valid).toBe(local);
    expect(report.totals.runsExcludedByMode!.validation).toBe(free.valid + free.partial + free.noMeasurement + free.failed + free.cancelled + free.interruptedUnknown);
  });

  it("F3/F6: explains retention and names a device that has not reported yet", () => {
    expect(retentionNote({ retention: "retained", groupsBeyondRetention: 0 })).toBeNull();
    expect(retentionNote({ retention: "partial", groupsBeyondRetention: 3 })).toMatch(/^Partly retained: 3 upload groups are older than the 30-day transfer detail/);
    expect(retentionNote({ retention: "notRetained", groupsBeyondRetention: 9 })).toMatch(/^Not retained: .*This is not zero\./);
    const row = { originInstallId: null, deviceLabel: null, machine: null };
    expect(attemptDeviceName({ ...row, completeness: "pending" })).toBe("Device not yet reported");
    expect(attemptDeviceName({ ...row, completeness: "partial" })).toBe("Unknown device");
    expect(attemptDeviceName({ ...row, originInstallId: "b7e2c1d4-5f6a-4b8c-9d0e-1f2a3b4c5d6e", completeness: "complete" })).toBe("Unnamed device");
  });

  it("F4: uses the reporting API's narrowing wording, naming the partition when given", () => {
    const failure = describeLoadFailure({ code: "functions/resource-exhausted", details: { errorCode: "narrowRange", bound: "partitionAttempts", partition: "d-2026-09-20", attempts: 4, max: 3 } });
    expect(failure.message).toMatch(/^Narrow the date range or choose a device\./);
    expect(failure.message).toContain("(d-2026-09-20) holds more attempts than a report can read exactly");
    expect(failure.message).not.toMatch(/drill/);
  });
});

describe("attempt detail", () => {
  const attempt = fixture("attempt-summary.valid.json") as AttemptSummaryRecordV1;
  // The canonical run fixture belongs to another attempt; re-home a copy for a joined example.
  const run = { ...fixture("run-summary.valid.json"), attemptId: attempt.attemptId } as RunSummaryRecordV1;
  const group = fixture("upload-group-summary.valid.json") as UploadGroupRecordV1;
  const detail = (extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1, generatedAt: "2026-09-29T10:00:00.000Z", attemptId: attempt.attemptId, attempt, runs: [run], uploadGroups: [group],
    transfers: [fixture("transfer-invocation.valid.json")], transferPagination: { pageSize: 50, nextCursor: null, totalRows: 1 },
    receivedAt: { firstReceivedAtServer: null, updatedAtServer: null }, devices: [], evidence: [{ kind: "processingAttempt", id: attempt.attemptId, availability: "expired" }],
    ...extra,
  });

  it("parses contract records and refuses one that belongs to a different attempt", () => {
    expect(parseAttemptDetail(detail()).runs).toHaveLength(1);
    expect(() => parseAttemptDetail(detail({ runs: [fixture("run-summary.valid.json")] }))).toThrow(/attemptId/);
    expect(() => parseAttemptDetail(detail({ schemaVersion: 3 }))).toThrow(/format version 3/);
  });

  it("draws one launch per segment and never measures across a relaunch", () => {
    const timeline = attemptTimeline(parseAttemptDetail(detail()));
    // The upload group ran in a later launch than the capture and the run.
    expect(timeline.segments.map(segment => segment.launchId)).toEqual([attempt.originLaunchId, group.executionLaunchId]);
    expect(timeline.unknownGaps).toBe(1);
    const [first, second] = timeline.segments;
    expect(first.lanes.map(lane => lane.key)).toEqual(["recording", "processing", "localSave", "acceptance", "archive"]);
    expect(second.lanes.map(lane => lane.key)).toEqual(["cloudSave"]);
    expect(second.lanes[0].note).toMatch(/app relaunch/);
    // Main phases are end to end; nested operations are listed, not added.
    const processing = first.lanes[1];
    expect(processing.bars.map(bar => bar.stageId)).toEqual(["input.calibration", "admission.requested", "admission.granted", "kick.beforeModel", "kick.extract", "kick.denseBall", "kick.motionContact", "kick.math", "kick.encode"]);
    expect(processing.nested.map(bar => bar.stageId)).toEqual(["model.create", "model.firstPrediction"]);
    expect(processing.bars[0].startMs).toBeCloseTo(first.lanes[0].bars.reduce((sum, bar) => sum + (bar.durationMs ?? 0), 0));
    // 21874.2 − preparation 496.3 − processing 17689.1 − local saving 109.1
    expect(timeline.unattributedMs).toBeCloseTo(3579.7, 1);
  });

  it("marks Stopped here only for a known failure and Last reported step for an interruption", () => {
    const failedStages = run.body.stages.map(stage => stage.stageId === "kick.denseBall" ? { ...stage, status: "failed", failureCode: "memory_pressure", failureLayer: "resource" } : stage);
    const failed = { ...run, body: { ...run.body, outcome: "failed", failure: { code: "memory_pressure", stage: "kick.denseBall", disposition: "retryable", layer: "resource" }, stages: failedStages } };
    const failedLane = attemptTimeline({ attempt, runs: [failed as RunSummaryRecordV1], uploadGroups: [] }).segments[0].lanes.find(lane => lane.key === "processing")!;
    expect(failedLane.bars.filter(bar => bar.marker).map(bar => [bar.stageId, bar.marker])).toEqual([["kick.denseBall", "stoppedHere"]]);

    const interrupted = { ...run, body: { ...run.body, outcome: "interruptedUnknown", failure: null } };
    const interruptedLane = attemptTimeline({ attempt, runs: [interrupted as RunSummaryRecordV1], uploadGroups: [] }).segments[0].lanes.find(lane => lane.key === "processing")!;
    expect(interruptedLane.bars.filter(bar => bar.marker).map(bar => bar.marker)).toEqual(["lastReported"]);
    expect(interruptedLane.bars.some(bar => bar.marker === "stoppedHere")).toBe(false);
  });

  it("shows a failure before processing started without inventing a run", () => {
    const preAdmission = fixture("attempt-summary-pre-admission-failure.valid.json") as AttemptSummaryRecordV1;
    const timeline = attemptTimeline({ attempt: preAdmission, runs: [], uploadGroups: [] });
    const lane = timeline.segments[0].lanes.find(row => row.key === "processing")!;
    expect(lane.label).toBe("Processing did not start");
    expect(lane.bars[0]).toMatchObject({ stageId: "input.calibration", marker: "stoppedHere", durationMs: null });
    expect(lane.note).toBe("Calibration was not available.");
    expect(timeline.unattributedMs).toBeNull();
  });
});

// MARK: - Statistics

const stat = (sample: number, extra: Partial<DistributionStatV1> = {}): DistributionStatV1 => ({
  eligible: sample, sample, missing: 0, excluded: 0, typicalMs: sample ? 1200 : null, slowMs: sample ? 3400 : null, missingReasons: [], excludedReasons: [], ...extra,
});

describe("Limited data and missing values", () => {
  it("marks fewer than 20 eligible or measured samples as Limited data and hides the slow tail (D-26 E)", () => {
    expect(LIMITED_DATA_MIN_SAMPLES).toBe(20);
    expect(isLimitedData(stat(19))).toBe(true);
    expect(isLimitedData(stat(20))).toBe(false);
    expect(isLimitedData(stat(5, { eligible: 100, missing: 95 }))).toBe(true);
    // An inconsistent statistic with fewer eligible than measured samples is still limited.
    expect(isLimitedData(stat(25, { eligible: 10 }))).toBe(true);
    expect(statView(stat(19))).toMatchObject({ kind: "value", limited: true, typicalMs: 1200, slowMs: null });
    expect(statView(stat(20))).toMatchObject({ kind: "value", limited: false, slowMs: 3400 });
    // 100 eligible but only 5 measured is still 5 values.
    expect(statView(stat(5, { eligible: 100, missing: 95 }))).toMatchObject({ limited: true });
  });

  it("shows a missing measurement with its reason, never as zero", () => {
    const missing = stat(0, { eligible: 12, missing: 12, missingReasons: [{ reason: "crossLaunch", count: 2 }, { reason: "notCollectedByThisVersion", count: 10 }] });
    expect(statView(missing)).toMatchObject({ kind: "missing", reason: "Not collected by this app version" });
    expect(statView(stat(0))).toMatchObject({ kind: "none" });
    expect(formatDuration(null)).toBe("Not measured");
    expect(formatDuration(undefined)).toBe("Not measured");
    expect(formatDuration(-1)).toBe("Not measured");
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatBytes(null)).toBe("Not measured");
    expect(formatMBps(null)).toBe("Not measured");
  });

  it("formats durations and decimal sizes", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(2_345)).toBe("2.35 s");
    expect(formatDuration(21_874)).toBe("21.9 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatBytes(1_520_311)).toBe("1.52 MB");
    expect(formatBytes(48_210_004)).toBe("48.2 MB");
  });
});

describe("rates always carry their denominators", () => {
  const none = { pending: null, preAdmissionFailures: null };
  it("computes processing failures over known outcomes only", () => {
    const rate = failureRate({ valid: 90, partial: 3, noMeasurement: 2, failed: 5, cancelled: 7, interruptedUnknown: 4, pending: 6, preAdmissionFailures: 9, omittedReasons: none });
    expect(rate.failed).toBe(5);
    expect(rate.knownOutcomes).toBe(100);
    expect(rate.rate).toBeCloseTo(0.05);
    expect(rate.excluded).toEqual({ cancelled: 7, interruptedUnknown: 4, pending: 6, preAdmissionFailures: 9 });
    expect(failureRate({ valid: 0, partial: 0, noMeasurement: 0, failed: 0, cancelled: 3, interruptedUnknown: 0, pending: 0, preAdmissionFailures: 0, omittedReasons: none }).rate).toBeNull();
  });

  it("keeps omitted pending and pre-admission counts null with their reasons, never zero (D-31 F8)", () => {
    const rate = failureRate({ valid: 90, partial: 3, noMeasurement: 2, failed: 5, cancelled: 7, interruptedUnknown: 4, pending: null, preAdmissionFailures: null,
      omittedReasons: { pending: "runFilterActive", preAdmissionFailures: "runFilterActive" } });
    expect(rate.knownOutcomes).toBe(100);
    expect(rate.excluded).toEqual({ cancelled: 7, interruptedUnknown: 4, pending: null, preAdmissionFailures: null });
    expect(rate.omittedReasons.pending).toBe("runFilterActive");
    expect(excludedCountText(rate.excluded.pending, rate.omittedReasons.pending, "pending")).toBe("pending not shown while a processing filter is active, because they cannot be tied to a processing mode, version or phone model");
    expect(excludedCountText(null, "executorAttribution", "pending")).toMatch(/^pending not shown under Processed or uploaded here/);
    expect(excludedCountText(0, null, "pending")).toBe("0 pending");
  });

  it("leaves user-discarded attempts out of usable-result yield and discloses them", () => {
    const result = usableYield({ valid: 80, invalid: 20, pending: 7, userDiscarded: 11, firstRunValid: 72 });
    expect(result.finalized).toBe(100);
    expect(result.rate).toBeCloseTo(0.8);
    expect(result.firstRunRate).toBeCloseTo(0.72);
    expect(result).toMatchObject({ pending: 7, userDiscarded: 11 });
  });

  it("computes weighted effective throughput as Σbytes ÷ Σseconds, never an average of speeds", () => {
    // 10 MB in 1 s and 1 MB in 9 s: the mean of speeds is 5.06 MB/s, the weighted throughput 1.1 MB/s.
    expect(weightedThroughputMBps(11_000_000, 10_000)).toBeCloseTo(1.1);
    expect(weightedThroughputMBps(5_000, 0)).toBeNull();
  });

  it("builds the allocation bar from one cohort with an Unattributed residual", () => {
    const view = allocationView({ cohortSize: 40, meanTimeToResultMs: 20_000, phases: [
      { phase: "preparation", meanMs: 500 }, { phase: "waiting", meanMs: 100 }, { phase: "analysis", meanMs: 17_000 }, { phase: "calculation", meanMs: 400 }, { phase: "localSaving", meanMs: null },
    ] })!;
    expect(view.segments.at(-1)).toMatchObject({ phase: "unattributed", meanMs: 2_000 });
    expect(view.missingPhases).toEqual(["localSaving"]);
    expect(view.inconsistent).toBe(false);
    expect(view.segments.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
    expect(allocationView({ cohortSize: 3, meanTimeToResultMs: 1_000, phases: [{ phase: "analysis", meanMs: 1_500 }] })!.inconsistent).toBe(true);
    expect(allocationView(null)).toBeNull();
    expect(allocationView({ cohortSize: 0, meanTimeToResultMs: null, phases: [] })).toBeNull();
  });
});

// MARK: - Filters and query state

describe("filter scope (plan 07 §3)", () => {
  const filters = { ...DEFAULT_FILTERS, drill: "sprint" as const, networkInterface: "cellular" as const, uploadRole: "optionalVideo" as const, payloadSizeBand: "over100MB", processingMode: "recovery" as const };

  it("never lets an upload filter reach processing, capture, yield or cloud-save metrics", () => {
    for (const group of ["capture", "processing", "yield", "cloudSave"] as const) {
      for (const key of UPLOAD_FILTERS) expect(FILTER_SCOPE[group]).not.toContain(key);
      expect(appliedFilters(group, filters)).not.toEqual(expect.arrayContaining(["networkInterface"]));
    }
    expect(appliedFilters("processing", filters)).toEqual(["drill", "processingMode"]);
    expect(appliedFilters("upload", filters)).toEqual(["drill", "networkInterface", "uploadRole", "payloadSizeBand"]);
    expect(appliedFilters("capture", filters)).toEqual(["drill"]);
  });

  // Inverted by review ruling D-26 B: a leaked filter is a contract violation, refused, never dropped from the label.
  it("refuses a report whose stated scope puts an upload filter on a processing metric", () => {
    const raw = normalReport();
    (raw.effectiveFilters as Record<string, string[]>).processing = ["drill", "networkInterface"];
    expect(() => parseFleetReport(raw)).toThrow(/Report scope mismatch: the server says network reached processing time and failures/);
    let failure = null;
    try { parseFleetReport(raw); } catch (error) { failure = describeLoadFailure(error); }
    expect(failure).toMatchObject({ problem: "scopeMismatch", title: "Report scope mismatch" });
  });

  it("names every filter that reached a metric it must not change, including unknown keys", () => {
    expect(scopeMismatches({
      capture: ["drill", "processingMode"], processing: ["executionBuild"], yield: ["uploadRole"], cloudSave: ["payloadSizeBand"], upload: ["networkInterface", "teamId"],
    })).toEqual([
      { group: "capture", key: "processingMode" },
      { group: "yield", key: "uploadRole" },
      { group: "cloudSave", key: "payloadSizeBand" },
      { group: "upload", key: "teamId" },
    ]);
    expect(scopeMismatches({ capture: ["drill"], processing: ["drill", "processingMode"], yield: [], cloudSave: [], upload: ["networkInterface", "uploadRole"] })).toEqual([]);
    const device = { ...(previewDeviceRaw() as Record<string, unknown>) };
    (device.effectiveFilters as Record<string, string[]>).yield = ["networkInterface"];
    expect(() => parseDeviceReport(device)).toThrow(/network reached usable results/);
  });

  it("shows the server's stated scope unchanged for a valid report", () => {
    const valid = { filters, effectiveFilters: { capture: ["drill"], processing: ["drill", "processingMode"], yield: ["drill"], cloudSave: ["drill"], upload: ["drill", "networkInterface", "uploadRole"] } } as unknown as FleetReportV1;
    expect(statedScope(valid, "processing")).toEqual(["drill", "processingMode"]);
    expect(statedScope(valid, "yield")).toEqual(["drill"]);
  });

  it("keeps processing totals identical when only upload filters change (preview contract)", () => {
    const plain = previewFleet(fleetRequest(baseQuery));
    const upload = previewFleet(fleetRequest({ ...baseQuery, filters: { ...baseQuery.filters, networkInterface: "cellular", uploadRole: "optionalVideo", payloadSizeBand: "over100MB" } }));
    expect(upload.totals.outcomes).toEqual(plain.totals.outcomes);
    expect(upload.totals.timeToResult).toEqual(plain.totals.timeToResult);
    expect(upload.totals.yield).toEqual(plain.totals.yield);
    expect(upload.totals.uploads).not.toEqual(plain.totals.uploads);
  });
});

describe("query state", () => {
  const now = new Date("2026-09-29T18:00:00Z");

  it("defaults to the last seven local days, all drills and the Result files role", () => {
    const query = parseDevicePerformanceQuery("", now);
    expect(query.period).toEqual({ preset: 7, startDate: "2026-09-23", endDate: "2026-09-29", timeZone: "America/Los_Angeles", problem: null });
    expect(query.filters).toEqual(DEFAULT_FILTERS);
    expect(query).toMatchObject({ dateBasis: "capture", sort: "attention", cursor: null, focus: null, attempt: null, attribution: "origin", section: "processing" });
  });

  // D-26 G: an unusable custom range is named, never silently replaced by the last 7 days.
  it("accepts a custom range up to 90 days ending today and names the problem with any other range", () => {
    const period = (search: string) => parseDevicePerformanceQuery(search, now).period;
    expect(period("start=2026-07-02&end=2026-09-29")).toMatchObject({ preset: "custom", startDate: "2026-07-02", endDate: "2026-09-29", problem: null });
    expect(period("start=2026-07-01&end=2026-09-29")).toMatchObject({ preset: "custom", startDate: "2026-07-01", problem: "The range is longer than 90 days." });
    expect(period("start=2026-09-01&end=2026-10-02").problem).toBe("The range ends after today (2026-09-29 in the selected time zone).");
    expect(period("start=2026-02-30&end=2026-03-02").problem).toBe("Use real calendar dates (YYYY-MM-DD).");
    expect(period("start=2026-09-10&end=2026-09-01").problem).toBe("The start date is after the end date.");
    expect(period("start=2026-09-10").problem).toBe("Choose both a start and an end date.");
    expect(period("days=30")).toMatchObject({ preset: 30, startDate: "2026-08-31", problem: null });
  });

  it("judges 'after today' in the report's time zone", () => {
    const lateEvening = new Date("2026-09-30T05:00:00Z"); // 22:00 on the 29th in Los Angeles, 01:00 on the 30th in New York
    expect(customRangeProblem("2026-09-24", "2026-09-30", dateInZone(lateEvening, "America/Los_Angeles"))).toMatch(/ends after today/);
    expect(customRangeProblem("2026-09-24", "2026-09-30", dateInZone(lateEvening, "America/New_York"))).toBeNull();
    expect(parseDevicePerformanceQuery("start=2026-09-24&end=2026-09-30&tz=America/New_York", lateEvening).period.problem).toBeNull();
  });

  it("ignores unknown values instead of sending them", () => {
    const query = parseDevicePerformanceQuery("drill=cricket&role=everything&net=5g&attempt=not-a-uuid&sort=random&focus=stage:Bad%20Id", now);
    expect(query.filters.drill).toBeNull();
    expect(query.filters.uploadRole).toBe("resultFiles");
    expect(query.filters.networkInterface).toBeNull();
    expect(query).toMatchObject({ attempt: null, sort: "attention", focus: null });
    expect(parseDevicePerformanceQuery("focus=phase:jump:analysis", now).focus).toEqual({ kind: "phase", drill: "jump", phase: "analysis" });
    expect(parseDevicePerformanceQuery("focus=stage:kick.denseBall", now).focus).toEqual({ kind: "stage", stageId: "kick.denseBall" });
  });

  it("merges changes into the URL, keeping the admin scope and preview flags", () => {
    const next = devicePerformanceSearch("?orgId=club&teamId=u15&coachId=c1&preview=1&drill=jump", { [PARAMS.drill]: "sprint" });
    const params = new URLSearchParams(next);
    expect(Object.fromEntries(params)).toEqual({ orgId: "club", teamId: "u15", coachId: "c1", preview: "1", drill: "sprint" });
  });

  it("resets both cursors whenever the report is reshaped", () => {
    const paged = "?orgId=club&cursor=abc&focus=stage:kick.denseBall&acursor=def";
    for (const patch of [{ [PARAMS.drill]: "sprint" }, { [PARAMS.days]: "30" }, { [PARAMS.sort]: "lastSeen" }, { [PARAMS.search]: "station" }, { [PARAMS.networkInterface]: "wifi" }, { [PARAMS.uploadRole]: "optionalVideo" }, { [PARAMS.dateBasis]: "serverReceipt" }]) {
      const params = new URLSearchParams(devicePerformanceSearch(paged, patch));
      expect(params.get("cursor"), JSON.stringify(patch)).toBeNull();
      expect(params.get("acursor"), JSON.stringify(patch)).toBeNull();
      expect(params.get("orgId")).toBe("club");
    }
  });

  it("keeps the device page when only the attempt focus changes, and drops the attempt cursor", () => {
    const params = new URLSearchParams(devicePerformanceSearch("?cursor=abc&focus=stage:kick.denseBall&acursor=def", { [PARAMS.focus]: "stage:input.calibration" }));
    expect(params.get("cursor")).toBe("abc");
    expect(params.get("acursor")).toBeNull();
    const paging = new URLSearchParams(devicePerformanceSearch("?drill=jump", { [PARAMS.cursor]: "next-page" }));
    expect(Object.fromEntries(paging)).toEqual({ drill: "jump", cursor: "next-page" });
  });

  it("omits defaults and keeps a preset and a custom range exclusive", () => {
    expect(devicePerformanceSearch("?role=optionalVideo&days=30", { [PARAMS.uploadRole]: "resultFiles", [PARAMS.days]: "7" })).toBe("");
    expect(new URLSearchParams(devicePerformanceSearch("?days=30&cursor=x", { [PARAMS.start]: "2026-09-01", [PARAMS.end]: "2026-09-10" })).get("days")).toBeNull();
    const preset = new URLSearchParams(devicePerformanceSearch("?start=2026-09-01&end=2026-09-10&cursor=x", { [PARAMS.days]: "14" }));
    expect(Object.fromEntries(preset)).toEqual({ days: "14" });
    // Returning to the default preset from a custom range is still a reshaping change.
    expect(devicePerformanceSearch("?start=2026-09-01&end=2026-09-10&cursor=x", { [PARAMS.days]: "7" })).toBe("");
  });

  it("carries filters to the device report and back without stale cursors", () => {
    const search = "?orgId=club&drill=jump&sort=lastSeen&cursor=p2&acursor=a2&attempt=3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c&focus=stage:kick.denseBall";
    expect(devicePath("b7e2c1d4-5f6a-4b8c-9d0e-1f2a3b4c5d6e", search)).toBe("/admin/device-performance/b7e2c1d4-5f6a-4b8c-9d0e-1f2a3b4c5d6e?orgId=club&drill=jump&sort=lastSeen&focus=stage%3Akick.denseBall");
    expect(fleetPath("?orgId=club&drill=jump&view=executor&section=uploads&cursor=d2")).toBe("/admin/device-performance?orgId=club&drill=jump");
  });

  it("sends one request per view with clamped paging", () => {
    const query = parseDevicePerformanceQuery("drill=sprint&net=wifi&q=%20station%20&cursor=p2&acursor=a1", now);
    const request = fleetRequest(query, 500);
    expect(request).toMatchObject({ startDate: "2026-09-23", endDate: "2026-09-29", timeZone: "America/Los_Angeles", dateBasis: "capture", search: "station", sort: "attention", pageSize: 100, cursor: "p2", focus: null, attemptsCursor: null });
    expect(request.filters).toMatchObject({ drill: "sprint", networkInterface: "wifi", uploadRole: "resultFiles" });
  });
});

// MARK: - Errors, client and sources

describe("load failures", () => {
  it("explains an oversized query and how to narrow it", () => {
    const failure = describeLoadFailure({ code: "functions/resource-exhausted", details: { limit: 50_000 } });
    expect(failure.problem).toBe("oversized");
    expect(failure.message).toMatch(/Narrow the date range or choose a device/);
    expect(failure.message).toMatch(/50,000/);
  });

  it("names stale cursors, denial, missing devices and newer formats", () => {
    expect(describeLoadFailure({ code: "functions/failed-precondition" }).problem).toBe("staleCursor");
    expect(describeLoadFailure({ code: "functions/permission-denied" }).problem).toBe("denied");
    expect(describeLoadFailure({ code: "functions/not-found" }, "device").title).toBe("No reports from this device");
    expect(describeLoadFailure(new DevicePerformanceResponseError("unsupportedVersion", "newer")).problem).toBe("unsupportedVersion");
    expect(describeLoadFailure(new Error("boom")).title).toBe("Could not load report");
  });
});

describe("callable client", () => {
  it("calls the four named callables and parses each response", async () => {
    const calls: string[] = [];
    const client = createDevicePerformanceClient(async (name, payload) => {
      calls.push(name);
      if (name === CALLABLES.fleet) return previewFleet(payload as ReturnType<typeof fleetRequest>);
      if (name === CALLABLES.rename) return { schemaVersion: 1, installId: "i", label: "Station 2", labelRevision: 4 };
      return { schemaVersion: 7 };
    });
    expect(client.kind).toBe("live");
    expect((await client.fleet(fleetRequest(baseQuery))).devices.length).toBeGreaterThan(0);
    expect((await client.rename({ installId: "i", label: "Station 2", expectedRevision: 3 })).labelRevision).toBe(4);
    await expect(client.device({ ...fleetRequest(baseQuery), installId: "i", attribution: "origin", section: "processing" })).rejects.toThrow(/format version 7/);
    await expect(client.attempt({ attemptId: "a", cursor: null })).rejects.toThrow(DevicePerformanceResponseError);
    expect(calls).toEqual([CALLABLES.fleet, CALLABLES.rename, CALLABLES.device, CALLABLES.attempt]);
  });

  it("uses the live callables unless a DEV preview is requested", async () => {
    expect((await loadDevicePerformanceSource(false)).kind).toBe("live");
    expect((await loadDevicePerformanceSource(true, "normal")).kind).toBe("preview");
  });

  it("imports the preview module only behind the DEV guard, and never from a failure path", () => {
    const source = readFileSync(new URL("./devicePerformance.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/import\("\.\/devicePerformancePreview"\)/g)];
    expect(imports).toHaveLength(1);
    const guarded = /if \(import\.meta\.env\.DEV && preview\) \{\s*const module = await import\("\.\/devicePerformancePreview"\);/;
    expect(source).toMatch(guarded);
    expect(source).not.toMatch(/catch[^}]*devicePerformancePreview/);
  });

  it("keeps preview and live reports in separate caches with separate keys (D-26 F)", () => {
    expect(reportModeFor(true)).toBe("preview"); // Vitest runs as a DEV build
    expect(reportModeFor(false)).toBe("live");
    reportCacheFor("preview").set("same-request", "synthetic");
    expect(reportCacheFor("live").get("same-request")).toBeNull();
    expect(reportCacheFor("preview").get("same-request")).toBe("synthetic");
    const request = fleetRequest(baseQuery);
    expect(reportKeys("preview", "fleet", request, request, null)).not.toEqual(reportKeys("live", "fleet", request, request, null));
    forgetCachedReports();
    expect(reportCacheFor("preview").get("same-request")).toBeNull();
  });

  it("recovers from a stale cursor by loading the first page, never by resending the cursor (D-26 A)", () => {
    const stale = describeLoadFailure({ code: "functions/failed-precondition" });
    const patches: Record<string, string | null>[] = [];
    let refreshed = 0;
    const actions = { refresh: () => { refreshed += 1; }, change: (patch: Record<string, string | null>) => { patches.push(patch); } };
    reportCacheFor("live").set("page-2", "old");
    expect(recoveryLabel(stale, true)).toBe("Load the first page");
    expect(recoverFromFailure(stale, true, actions)).toBe("firstPage");
    expect(patches).toEqual([{ cursor: null, acursor: null }]);
    expect(refreshed).toBe(0);
    expect(reportCacheFor("live").get("page-2")).toBeNull();
    expect(devicePerformanceSearch("?orgId=club&drill=jump&cursor=p2&focus=stage:kick.denseBall&acursor=a1", patches[0])).toBe("?orgId=club&drill=jump&focus=stage%3Akick.denseBall");
    // Without a cursor, or for any other failure, the same request is retried.
    expect(recoverFromFailure(stale, false, actions)).toBe("retry");
    expect(recoveryLabel(stale, false)).toBe("Retry");
    expect(recoverFromFailure(describeLoadFailure({ code: "functions/unavailable" }), true, actions)).toBe("retry");
    expect(refreshed).toBe(2);
    expect(patches).toHaveLength(1);
  });

  it("keeps the loaded totals while a page loads or fails, but never across a filter change", () => {
    const good = { key: "page-1", shape: "filters-a", report: "report-a" };
    const failure = describeLoadFailure({ code: "functions/unavailable" });
    expect(reportStateFor("page-1", "filters-a", { good, failed: null }, null)).toMatchObject({ status: "ready", report: "report-a", stale: false });
    expect(reportStateFor("page-2", "filters-a", { good, failed: null }, null)).toMatchObject({ status: "loading", report: "report-a", stale: true });
    expect(reportStateFor("page-2", "filters-a", { good, failed: { key: "page-2", failure } }, null)).toMatchObject({ status: "error", report: "report-a", stale: true, failure });
    expect(reportStateFor("other", "filters-b", { good, failed: null }, null)).toMatchObject({ status: "loading", report: null });
    expect(reportStateFor("other", "filters-b", { good, failed: { key: "other", failure } }, null)).toMatchObject({ status: "error", report: null });
    expect(reportStateFor("other", "filters-b", { good, failed: null }, "cached-b")).toMatchObject({ status: "ready", report: "cached-b" });
    // After Refresh the old report stays visible as stale until the new one arrives.
    expect(reportStateFor("page-1", "filters-a", { good: { ...good, key: null }, failed: null }, null)).toMatchObject({ status: "loading", report: "report-a", stale: true });
  });

  it("expires cached reports and keeps the cache bounded", () => {
    const cache = createReportCache<number>(1_000, 2);
    cache.set("a", 1, 0);
    expect(cache.get("a", 999)).toBe(1);
    expect(cache.get("a", 1_001)).toBeNull();
    cache.set("a", 1, 0); cache.set("b", 2, 0); cache.set("c", 3, 0);
    expect(cache.get("a", 1)).toBeNull();
    expect(cache.get("c", 1)).toBe(3);
  });
});

describe("step names", () => {
  it("uses plain names and keeps unknown steps honest", () => {
    expect(stageLabel("kick.denseBall")).toBe("Finding the ball");
    expect(stageLabel("repUpload.restorePayload")).toBe("Saving result files");
    expect(stageLabel("input.calibration")).toBe("Loading calibration");
    expect(stageLabel("broadJump.calibrationPreflight")).toBe("Checking calibration");
    expect(stageLabel("sprint.encode")).toBe("Preparing result files");
    expect(stageLabel("poseValidation.extract")).toBe("Checking the free-record video");
    expect(stageLabel("someFuture.stage")).toBe("Other step");
    expect(stageLabel(null)).toBe("Unknown step");
  });
});
