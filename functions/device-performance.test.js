"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  quantile, StatBuilder, effectiveFilters, evidenceAvailability, createDevicePerformanceCallable, HANDLERS, METRIC_DEFINITIONS,
  SHARED_FILTERS, RUN_FILTERS, UPLOAD_FILTERS,
} = require("./device-performance");
const f = require("./test-support/device-performance/facts");

const { uuid, harness, completeAttempt, attemptSummary, runSummary, uploadGroup, transfer, deviceStatus, stage, START, DAY, ADMIN } = f;
const INSTALL = uuid("i", 1), OTHER = uuid("i", 2);
const sorted = (values) => Float64Array.from(values).sort();
const sameJson = (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);
const at = (iso) => Date.parse(iso);
const rejectsWith = (promise, code, errorCode) => assert.rejects(promise, (error) => error.code === code && (!errorCode || error.details?.errorCode === errorCode));

// ---------------------------------------------------------------------------
// Exact pooled statistics.

test("exact percentile fixtures: odd and even counts, ties, a single sample, interpolation (type 7)", () => {
  assert.equal(quantile(sorted([7]), 0.5), 7, "single sample median");
  assert.equal(quantile(sorted([7]), 0.9), 7, "single sample p90");
  assert.equal(quantile(sorted([5, 1, 3]), 0.5), 3, "odd count: the middle value");
  assert.equal(quantile(sorted([4, 1, 3, 2]), 0.5), 2.5, "even count: the mean of the two middle values");
  assert.equal(quantile(sorted([2, 2, 2, 9]), 0.5), 2, "ties");
  assert.equal(quantile(sorted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 0.9), 10, "n = 11: h = 9, an exact order statistic");
  assert.equal(quantile(sorted([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]), 0.9), 81, "n = 10: h = 8.1, 80 + 0.1 x 10");
  assert.equal(quantile(sorted([100, 200]), 0.9), 190, "n = 2: h = 0.9");
  assert.equal(quantile(sorted([]), 0.5), null);
  const stat = new StatBuilder();
  for (const value of [3, 1, 2]) stat.add(value);
  stat.add(null, "crossLaunch"); stat.add(null, "crossLaunch"); stat.add(null);
  stat.exclude("pending");
  assert.deepEqual(stat.build(), {
    eligible: 6, sample: 3, missing: 3, excluded: 1, typicalMs: 2, slowMs: 2.8,
    missingReasons: [{ reason: "crossLaunch", count: 2 }, { reason: "unavailable", count: 1 }], excludedReasons: [{ reason: "pending", count: 1 }],
  });
  const zero = new StatBuilder();
  zero.add(0);
  assert.equal(zero.build().typicalMs, 0, "a measured zero is a value, not missing");
  const many = new StatBuilder();
  for (let i = 0; i < 40; i++) many.miss(`reason${String(i).padStart(2, "0")}`);
  const built = many.build();
  assert.equal(built.missingReasons.length, 32);
  assert.equal(built.missingReasons.reduce((sum, row) => sum + row.count, 0), 40, "the tail folds into other, keeping the total");
});

test("fleet percentiles are pooled over every observation, never averaged across devices", async () => {
  const h = harness();
  const phoneA = [1000, 2000, 3000], phoneB = [10000, 11000, 12000, 13000, 14000, 15000, 16000];
  let n = 0;
  for (const [install, values] of [[INSTALL, phoneA], [OTHER, phoneB]]) {
    for (const value of values) h.putAll(completeAttempt(++n, { install, attempt: { timeToResult: value } }));
  }
  const report = await h.fleet();
  const pooled = sorted([...phoneA, ...phoneB]);
  assert.equal(report.totals.timeToResult.typicalMs, quantile(pooled, 0.5));
  assert.equal(report.totals.timeToResult.typicalMs, 11500);
  assert.notEqual(report.totals.timeToResult.typicalMs, (2000 + 13000) / 2, "not the mean of device medians");
  assert.equal(report.totals.timeToResult.slowMs, quantile(pooled, 0.9));
  const byInstall = Object.fromEntries(report.devices.map((row) => [row.installId, row.timeToResult.typicalMs]));
  assert.deepEqual(byInstall, { [INSTALL]: 2000, [OTHER]: 13000 });
  const drill = report.perDrill.find((row) => row.drillType === "sprint");
  assert.equal(drill.timeToResult.typicalMs, 11500);
  assert.equal(report.perDrill.length, 7, "all seven drill rows, even without reports");
  assert.deepEqual(report.perDrill.map((row) => row.drillType), ["jump", "deadballShot", "sprint", "broadJump", "changeOfDirection", "dribbling", "freeRecord"]);
});

// ---------------------------------------------------------------------------
// Dates.

test("cutoff semantics: local-midnight boundaries (start inclusive, end exclusive); date uncertain is excluded and counted; server receipt is selectable", async () => {
  const h = harness();
  const la = (iso) => at(iso); // times given in UTC for America/Los_Angeles (UTC-7 in September)
  const cases = [
    [1, la("2026-09-23T07:00:00.000Z")], // 00:00 LA on the first day: in
    [2, la("2026-09-23T06:59:59.999Z")], // 23:59:59.999 LA the day before: out
    [3, la("2026-09-29T06:59:59.999Z")], // last instant of the last day: in (end date 2026-09-28)
    [4, la("2026-09-29T07:00:00.000Z")], // first instant after: out
  ];
  for (const [n, captureAt] of cases) h.putAll(completeAttempt(n, { captureAt }));
  h.putAll(completeAttempt(5, { captureAt: la("2026-09-25T12:00:00.000Z"), attempt: { clock: "uncertain" } }));
  h.putAll(completeAttempt(6, { captureAt: START + 7 * DAY })); // a future capture: date uncertain
  const range = { startDate: "2026-09-23", endDate: "2026-09-28", timeZone: "America/Los_Angeles" };
  const report = await h.fleet(range);
  assert.equal(report.totals.attempts, 2);
  assert.deepEqual(report.trends.filter((row) => row.attempts).map((row) => [row.date, row.attempts]), [["2026-09-23", 1], ["2026-09-28", 1]]);
  assert.equal(report.trends.length, 6);
  assert.equal(report.coverage.attemptsDateUncertain, 0, "uncertain attempts are counted only when received in the period");
  const today = await h.fleet({ startDate: "2026-09-29", endDate: "2026-09-29", timeZone: "UTC" });
  assert.equal(today.coverage.attemptsDateUncertain, 2, "received today, left out of the dated cohort");
  assert.equal(today.totals.attempts, 2, "cases 3 and 4 are on 2026-09-29 in UTC; the uncertain two are not in the cohort");
  const receipt = await h.fleet({ startDate: "2026-09-29", endDate: "2026-09-29", timeZone: "UTC", dateBasis: "serverReceipt" });
  assert.equal(receipt.totals.attempts, 6, "every attempt was first received today");
  assert.equal(receipt.coverage.attemptsDateUncertain, 2, "disclosed, and included under server receipt");
  assert.equal(receipt.period.dateBasis, "serverReceipt");
});

// ---------------------------------------------------------------------------
// §3 definitions and denominators.

test("§3 definitions: time to result, readiness, save confirmed and processing time by outcome, with noMeasurement and recovery buckets", async () => {
  const h = harness();
  h.putAll(completeAttempt(1, { attempt: { timeToResult: 10000 }, run: { processingMs: 8000 } }));
  h.putAll(completeAttempt(2, { attempt: { timeToResult: null, missingReason: "crossLaunch" }, run: { processingMs: 9000 } }));
  const noResult = { jobState: "notRequested", cloudSave: null };
  h.putAll(completeAttempt(3, { verdict: "invalid", attempt: { verdict: "invalid", reason: "noMeasurement", timeToResult: null, saveConfirmed: null, requiredSave: "notQueued" },
    run: { outcome: "noMeasurement", processingMs: 7000 }, group: noResult }));
  h.putAll(completeAttempt(4, { verdict: "invalid", attempt: { verdict: "invalid", reason: "processingFailed", timeToResult: null, saveConfirmed: null, requiredSave: "notQueued" },
    run: { outcome: "failed", processingMs: 3000 }, group: noResult }));
  h.putAll(completeAttempt(5, { attempt: { timeToResult: 11000 }, run: { processingMs: 20000, processingMode: "recovery", launch: f.launch(2) } }));
  h.putAll(completeAttempt(6, { attempt: { timeToResult: 12000 }, run: { processingMs: 99999, processingMode: "debugReview" } }));
  h.putAll(completeAttempt(7, { verdict: "pending", attempt: { verdict: "pending", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null },
    run: { outcome: "interruptedUnknown", processingMs: null }, group: noResult }));
  const { totals } = await h.fleet();
  assert.deepEqual([totals.timeToResult.eligible, totals.timeToResult.sample, totals.timeToResult.missing, totals.timeToResult.excluded], [4, 3, 1, 3]);
  assert.deepEqual(totals.timeToResult.missingReasons, [{ reason: "crossLaunch", count: 1 }]);
  assert.deepEqual(totals.timeToResult.excludedReasons, [{ reason: "noMeasurement", count: 1 }, { reason: "pending", count: 1 }, { reason: "processingFailed", count: 1 }]);
  assert.equal(totals.timeToResult.typicalMs, 11000);
  const pt = totals.processingTime;
  assert.deepEqual(Object.keys(pt), ["byOutcome", "recovery"]);
  assert.deepEqual(Object.keys(pt.byOutcome), ["valid", "partial", "noMeasurement", "failed"]);
  assert.deepEqual([pt.byOutcome.valid.sample, pt.byOutcome.valid.typicalMs, pt.byOutcome.valid.excluded], [2, 8500, 1], "the debug review run is excluded");
  assert.deepEqual(pt.byOutcome.valid.excludedReasons, [{ reason: "debugReview", count: 1 }]);
  assert.deepEqual([pt.byOutcome.noMeasurement.sample, pt.byOutcome.noMeasurement.typicalMs], [1, 7000]);
  assert.deepEqual([pt.byOutcome.failed.sample, pt.byOutcome.failed.typicalMs], [1, 3000]);
  assert.deepEqual([pt.recovery.sample, pt.recovery.typicalMs], [1, 20000], "recovery is a mode: its run is only in recovery");
  assert.equal(pt.byOutcome.partial.eligible, 0);
  assert.equal(totals.saveConfirmedAfterRecording.eligible, 4, "committed required saves only");
  assert.equal(totals.readyForNextRep.sample, 7);
  // Failure rate and yield denominators.
  assert.deepEqual(totals.outcomes, { valid: 2 + 1, partial: 0, noMeasurement: 1, failed: 1, cancelled: 0, interruptedUnknown: 1, pending: 0, preAdmissionFailures: 0,
    omittedReasons: { pending: null, preAdmissionFailures: null } }, "the debug review run is left out; the recovery run counts by its outcome");
  assert.deepEqual(totals.runsExcludedByMode, { debugReview: 1, fixture: 0, validation: 0 });
  assert.deepEqual(totals.yield, { valid: 4, invalid: 2, pending: 1, userDiscarded: 0, firstRunValid: 4 });
  // The debug run is the population when the processing mode filter selects it.
  const debug = await h.fleet({ filters: { processingMode: "debugReview" } });
  assert.deepEqual([debug.totals.processingTime.byOutcome.valid.sample, debug.totals.processingTime.byOutcome.valid.typicalMs], [1, 99999]);
  assert.equal(debug.totals.outcomes.valid, 1);
});

test("failure rate and yield disclose pending runs, pre-admission failures and discards without counting them", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  // Two runs counted by the phone, only one delivered: one pending run.
  h.putAll(completeAttempt(2, { verdict: "pending", attempt: { verdict: "pending", runCount: 2, timeToResult: null, requiredSave: "notQueued", saveConfirmed: null }, run: { outcome: "cancelled" } }));
  h.put(attemptSummary({ attemptId: uuid("a", 3), verdict: "pending", runCount: 0, acceptedRunId: null, timeToResult: null, requiredSave: "notQueued", saveConfirmed: null,
    preAdmission: { stage: "input.calibration", failureCode: "calibration_unavailable", failureLayer: "input" } }));
  h.put(attemptSummary({ attemptId: uuid("a", 4), verdict: "invalid", reason: "userDiscarded", runCount: 0, acceptedRunId: null, timeToResult: null, requiredSave: "cancelled", saveConfirmed: null }));
  const { totals, failureStages } = await h.fleet();
  assert.deepEqual(totals.outcomes, { valid: 1, partial: 0, noMeasurement: 0, failed: 0, cancelled: 1, interruptedUnknown: 0, pending: 1, preAdmissionFailures: 1,
    omittedReasons: { pending: null, preAdmissionFailures: null } });
  assert.deepEqual(totals.yield, { valid: 1, invalid: 0, pending: 2, userDiscarded: 1, firstRunValid: 1 });
  const calibration = failureStages.find((row) => row.stageId === "input.calibration");
  assert.deepEqual([calibration.failures, calibration.entered], [1, 3], "entered by two runs and the pre-admission failure");
  // A processing filter omits the phone-counted pending runs and pre-admission
  // failures: null with a reason, never 0 (D-31 F8).
  const filtered = await h.fleet({ filters: { processingMode: "liveCapture" } });
  assert.deepEqual([filtered.totals.outcomes.pending, filtered.totals.outcomes.preAdmissionFailures], [null, null]);
  assert.deepEqual(filtered.totals.outcomes.omittedReasons, { pending: "runFilterActive", preAdmissionFailures: "runFilterActive" });
  assert.ok(filtered.perDrill.every((row) => row.outcomes.pending === null && row.outcomes.preAdmissionFailures === null));
  assert.ok(filtered.devices.every((row) => row.outcomes.pending === null), "device rows too");
  assert.equal(filtered.totals.runsExcludedByMode, null, "a mode filter selects the population");
  assert.equal(filtered.failureStages.find((row) => row.stageId === "input.calibration"), undefined);
  const executor = await h.detail(INSTALL, { attribution: "executor" });
  assert.deepEqual([executor.totals.outcomes.pending, executor.totals.outcomes.preAdmissionFailures, executor.totals.outcomes.omittedReasons.pending],
    [null, 1, "executorAttribution"], "pending runs have no executor; pre-admission failures stay origin-based");
});

test("failure at a stage: entered, confirmed failures, cancelled, unavailable and last-reported-only are separate", async () => {
  const h = harness();
  h.index(uuid("a", 3), { latestRunId: uuid("r", 3), lastStage: "sprint.extract" });
  h.putAll(completeAttempt(1));
  h.putAll(completeAttempt(2, { verdict: "invalid", attempt: { verdict: "invalid", reason: "processingFailed", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null }, run: { outcome: "failed" } }));
  h.putAll(completeAttempt(3, { verdict: "pending", attempt: { verdict: "pending", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null },
    run: { outcome: "interruptedUnknown", processingMs: null, stages: [] } }));
  h.putAll(completeAttempt(4, { run: { stages: [stage("input.calibration", null, { status: "unavailable" }), stage("sprint.extract", 10, { passId: "sprint.extract" })] } }));
  const { failureStages } = await h.fleet();
  const extract = failureStages.find((row) => row.stageId === "sprint.extract");
  assert.deepEqual({ ...extract }, { stageId: "sprint.extract", failures: 1, entered: 3, cancelled: 0, unavailable: 0, lastReportedOnly: 1, drills: ["sprint"] });
  const calibration = failureStages.find((row) => row.stageId === "input.calibration");
  assert.deepEqual([calibration.failures, calibration.unavailable, calibration.entered], [0, 1, 3]);
  assert.equal(failureStages.some((row) => row.stageId === "sprint.math"), false, "a stage with nothing to act on is not a row");
  // Fleet focus on a stage lists the confirmed and last-reported attempts, never changing totals.
  const focused = await h.fleet({ focus: { kind: "stage", stageId: "sprint.extract" } });
  assert.deepEqual(focused.attempts.map((row) => [row.attemptId, row.failureStageId, row.lastReportedStageId]).sort(),
    [[uuid("a", 2), "sprint.extract", null], [uuid("a", 3), null, "sprint.extract"]]);
  sameJson(focused.totals, (await h.fleet()).totals, "a focus never changes totals");
});

test("uploads: weighted throughput sums exclude zero, unknown and failed invocations with counts; archive-off is not requested; cloud save pending is missing", async () => {
  const h = harness();
  h.putAll(completeAttempt(1, { transfer: { bytes: 2_000_000, ms: 1000 } }));
  h.put(transfer({ attemptId: uuid("a", 1), invocationId: uuid("t", 101), bytes: 1_000_000, ms: 0 }));
  h.put(transfer({ attemptId: uuid("a", 1), invocationId: uuid("t", 102), bytes: 1_000_000, ms: null }));
  h.put(transfer({ attemptId: uuid("a", 1), invocationId: uuid("t", 103), bytes: 5_000_000, ms: 4000, outcome: "failed" }));
  h.putAll(completeAttempt(2, { group: { jobState: "inProgress", cloudSave: null }, transfer: { bytes: 6_000_000, ms: 2000 } }));
  h.putAll(completeAttempt(3, { attempt: { archive: "notRequested" } }));
  h.put(uploadGroup({ attemptId: uuid("a", 3), category: "optionalVideo", jobState: "committed", queueWait: 60000 }));
  h.put(transfer({ attemptId: uuid("a", 3), invocationId: uuid("t", 104), category: "optionalVideo", bytes: 40_000_000, ms: 8000, net: "cellular" }));
  const { totals } = await h.fleet();
  const result = totals.uploads.find((row) => row.role === "resultFiles");
  assert.deepEqual(totals.uploads.map((row) => row.role), ["resultFiles", "optionalVideo", "legacyVideo", "diagnostics"]);
  assert.deepEqual({ invocations: result.invocations, succeeded: result.succeeded, failed: result.failed, excluded: result.excludedZeroOrUnknownDuration, bytes: result.payloadBytes, ms: result.elapsedMs, pending: result.pending },
    { invocations: 6, succeeded: 5, failed: 1, excluded: 2, bytes: 2_000_000 + 6_000_000 + 50_000, ms: 1000 + 2000 + 500, pending: 1 });
  assert.deepEqual([result.duration.sample, result.duration.missing, result.duration.excluded], [4, 1, 1], "zero is measured, null is missing, failed is excluded");
  const video = totals.uploads.find((row) => row.role === "optionalVideo");
  assert.deepEqual([video.notRequested, video.invocations, video.payloadBytes, video.queueWait.typicalMs], [2, 1, 40_000_000, 60000],
    "archive-off attempts are Not requested, not 0 MB/s");
  assert.deepEqual([totals.cloudSave.sample, totals.cloudSave.missing, totals.cloudSave.missingReasons], [2, 1, [{ reason: "pendingUpload", count: 1 }]]);
});

test("upload-only filters leave totals, perDrill, failureStages, trends and attemptsIndexed byte-identical (D-26 B)", async () => {
  const h = harness();
  let n = 0;
  for (const net of ["wifi", "cellular"]) {
    for (const bytes of [20_000, 3_000_000]) {
      h.putAll(completeAttempt(++n, { transfer: { net, bytes, ms: 700 + n }, attempt: { timeToResult: 9000 + n * 100 } }));
      h.putAll(completeAttempt(++n, { verdict: "invalid", attempt: { verdict: "invalid", reason: "processingFailed", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null },
        run: { outcome: "failed" }, group: { jobState: "notRequested", cloudSave: null }, transfer: { net, bytes, outcome: "failed" } }));
    }
  }
  h.put(uploadGroup({ attemptId: uuid("a", 1), category: "optionalVideo", queueWait: 5000 }));
  const invariant = (report) => ({
    totals: { ...report.totals, uploads: undefined, cloudBacklog: undefined }, perDrill: report.perDrill, failureStages: report.failureStages,
    trends: report.trends, attemptsIndexed: report.coverage.attemptsIndexed, innerModel: report.innerModel,
  });
  const base = await h.fleet();
  const variants = [
    { networkInterface: "cellular" }, { networkInterface: "wiredEthernet" }, { payloadSizeBand: "1MB-10MB" }, { uploadRole: "optionalVideo" },
    { uploadRole: "diagnostics", networkInterface: "wifi", payloadSizeBand: "under-100kB" },
  ];
  for (const filters of variants) {
    const report = await h.fleet({ filters });
    sameJson(invariant(report), invariant(base), `upload-only filters ${JSON.stringify(filters)} changed a non-upload number`);
    assert.deepEqual(report.effectiveFilters.processing, [], "no upload key is ever listed outside the upload group");
    assert.ok(report.effectiveFilters.upload.includes("uploadRole"));
  }
  // The upload numbers themselves do change.
  const cellular = await h.fleet({ filters: { networkInterface: "cellular" } });
  assert.equal(cellular.totals.uploads[0].invocations, 4);
  assert.equal(base.totals.uploads[0].invocations, 8);
});

test("filter scope: run filters never change capture metrics, yield or attemptsIndexed; effectiveFilters lists only in-scope keys", async () => {
  const h = harness();
  h.putAll(completeAttempt(1, { run: { build: "215", appVersion: "1.4.1" } }));
  h.putAll(completeAttempt(2, { attempt: { drill: "jump" }, run: { build: "212" } }));
  const base = await h.fleet();
  const filtered = await h.fleet({ filters: { executionBuild: "1.4.1 (215)", processingMode: "liveCapture" } });
  for (const key of ["attempts", "timeToResult", "readyForNextRep", "saveConfirmedAfterRecording", "cloudSave", "yield"]) {
    sameJson(filtered.totals[key], base.totals[key], `${key} ignores run filters`);
  }
  assert.equal(filtered.coverage.attemptsIndexed, base.coverage.attemptsIndexed);
  assert.equal(filtered.totals.outcomes.valid, 1, "outcomes follow the run filters");
  assert.deepEqual(filtered.effectiveFilters, { capture: [], processing: ["processingMode", "executionBuild"], yield: [], cloudSave: [], upload: ["uploadRole"] });
  const drill = await h.fleet({ filters: { drill: "jump", networkInterface: "wifi" } });
  assert.equal(drill.coverage.attemptsIndexed, 1, "shared filters do narrow the cohort");
  assert.deepEqual(drill.effectiveFilters, { capture: ["drill"], processing: ["drill"], yield: ["drill"], cloudSave: ["drill"], upload: ["drill", "networkInterface", "uploadRole"] });
  const allowed = { capture: SHARED_FILTERS, processing: [...SHARED_FILTERS, ...RUN_FILTERS], yield: SHARED_FILTERS, cloudSave: SHARED_FILTERS, upload: [...SHARED_FILTERS, ...UPLOAD_FILTERS] };
  const everything = Object.fromEntries([...SHARED_FILTERS, ...RUN_FILTERS, ...UPLOAD_FILTERS].map((key) => [key, "x"]));
  for (const [group, keys] of Object.entries(effectiveFilters(everything))) assert.ok(keys.every((key) => allowed[group].includes(key)), group);
  assert.equal(base.choices.executionBuilds.length, 2);
  for (const choice of [...base.choices.captureBuilds, ...base.choices.executionBuilds, ...base.choices.captureMachines, ...base.choices.payloadSizeBands]) {
    assert.match(choice.key, /^[A-Za-z0-9 ._,()+:-]{1,128}$/, "choice keys are URL-safe (D-26 (7))");
  }
});

// ---------------------------------------------------------------------------
// Paging, cursors, cache.

test("totals are independent of page size; paging is complete and ordered", async () => {
  const h = harness();
  for (let i = 1; i <= 7; i++) {
    const install = uuid("i", 10 + i);
    for (let j = 0; j < i; j++) h.putAll(completeAttempt(i * 10 + j, { install, attempt: { timeToResult: 5000 + i * 1000 + j } }));
  }
  const full = await h.fleet({ pageSize: 100 });
  const collected = [];
  let cursor = null, pages = 0;
  do {
    const report = await h.fleet({ pageSize: 2, cursor });
    sameJson({ totals: report.totals, perDrill: report.perDrill, trends: report.trends, failureStages: report.failureStages, coverage: report.coverage },
      { totals: full.totals, perDrill: full.perDrill, trends: full.trends, failureStages: full.failureStages, coverage: full.coverage });
    assert.equal(report.pagination.totalRows, 7);
    assert.ok(report.devices.length <= 2);
    collected.push(...report.devices.map((row) => row.installId));
    cursor = report.pagination.nextCursor;
    if (cursor) assert.match(cursor, /^[A-Za-z0-9._~:+/=-]{1,2048}$/);
    pages++;
  } while (cursor);
  assert.equal(pages, 4);
  assert.deepEqual(collected, full.devices.map((row) => row.installId));
  assert.equal(new Set(collected).size, 7);
  const slow = await h.fleet({ sort: "slowResult" });
  assert.deepEqual(slow.devices.map((row) => row.timeToResult.typicalMs), [...slow.devices.map((row) => row.timeToResult.typicalMs)].sort((a, b) => b - a));
  const lastSeen = await h.fleet({ sort: "lastSeen" });
  const seen = lastSeen.devices.map((row) => Date.parse(row.lastReportAt));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test("stale cursors: a new projection revision or a tampered cursor refuses the page; only the attempts cursor depends on focus", async () => {
  const h = harness();
  for (let i = 1; i <= 4; i++) h.putAll(completeAttempt(i, { install: uuid("i", 10 + i), verdict: "invalid",
    attempt: { verdict: "invalid", reason: "processingFailed", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null }, run: { outcome: "failed" } }));
  const focus = { kind: "stage", stageId: "sprint.extract" };
  const first = await h.fleet({ pageSize: 1, focus });
  assert.ok(first.pagination.nextCursor && first.attemptPagination.nextCursor);
  // The devices cursor is not bound to focus (D-27 (4)).
  const otherFocus = await h.fleet({ pageSize: 1, cursor: first.pagination.nextCursor, focus: { kind: "phase", drill: "sprint", phase: "analysis" } });
  assert.equal(otherFocus.devices.length, 1);
  assert.equal((await h.fleet({ pageSize: 1, cursor: first.pagination.nextCursor })).devices.length, 1, "nor to focus being absent");
  // The attempts cursor is.
  await rejectsWith(h.fleet({ pageSize: 1, focus: { kind: "stage", stageId: "sprint.math" }, attemptsCursor: first.attemptPagination.nextCursor }), "failed-precondition", "staleCursor");
  // A cursor from another sort, search, filter or a tampered offset is stale.
  await rejectsWith(h.fleet({ pageSize: 1, cursor: first.pagination.nextCursor, sort: "lastSeen" }), "failed-precondition", "staleCursor");
  await rejectsWith(h.fleet({ pageSize: 1, cursor: first.pagination.nextCursor, filters: { drill: "sprint" } }), "failed-precondition");
  // The cursor is unsigned (as in Insights): the server recomputes the binding.
  // A forged fingerprint or an offset past the list is refused; a forged offset
  // inside the list can only select another page of the same report.
  const parsed = JSON.parse(Buffer.from(first.pagination.nextCursor, "base64url"));
  const forge = (value) => Buffer.from(JSON.stringify({ ...parsed, ...value })).toString("base64url");
  await rejectsWith(h.fleet({ pageSize: 1, cursor: forge({ f: "0".repeat(32) }) }), "failed-precondition");
  await rejectsWith(h.fleet({ pageSize: 1, cursor: forge({ o: 99 }) }), "failed-precondition");
  await rejectsWith(h.fleet({ pageSize: 1, cursor: forge({ o: 0 }) }), "failed-precondition");
  await rejectsWith(h.fleet({ pageSize: 1, cursor: "not-a-cursor" }), "failed-precondition");
  // Another admin cannot reuse a cursor.
  await rejectsWith(h.fleet({ pageSize: 1, cursor: first.pagination.nextCursor }, { ...ADMIN, uid: "adminUid0002" }), "failed-precondition");
  // New facts change the projection revision: the old cursor is stale.
  h.putAll(completeAttempt(9, { install: uuid("i", 19) }));
  const fresh = await h.fleet({ pageSize: 1 });
  assert.notEqual(fresh.projectionRevision, first.projectionRevision);
  await rejectsWith(h.fleet({ pageSize: 1, cursor: first.pagination.nextCursor }), "failed-precondition", "staleCursor");
  // The device report's row cursor is bound to section but not to focus.
  for (let i = 20; i < 23; i++) h.putAll(completeAttempt(i));
  const rows = await h.detail(INSTALL, { pageSize: 1 });
  assert.equal((await h.detail(INSTALL, { pageSize: 1, cursor: rows.pagination.nextCursor, focus: { kind: "phase", drill: "sprint", phase: "analysis" } })).rows.attempts.length, 1);
  await rejectsWith(h.detail(INSTALL, { pageSize: 1, cursor: rows.pagination.nextCursor, section: "failures" }), "failed-precondition");
});

test("complete totals are cached independently of cursor, focus, section, sort and search", async () => {
  const h = harness();
  for (let i = 1; i <= 5; i++) h.putAll(completeAttempt(i, { install: uuid("i", 10 + i) }));
  const first = await h.fleet({ pageSize: 2 });
  h.db.resetStats();
  await h.fleet({ pageSize: 2, cursor: first.pagination.nextCursor });
  await h.fleet({ pageSize: 2, focus: { kind: "phase", drill: "sprint", phase: "waiting" } });
  await h.fleet({ pageSize: 2, sort: "lastSeen", search: "iphone" });
  assert.equal(h.db.stats.pageReads, 0, "no projection page was read again");
  await h.fleet({ pageSize: 2, filters: { drill: "jump" } });
  assert.ok(h.db.stats.pageReads > 0, "a different filter set is a different report");
  h.db.resetStats();
  await h.detail(uuid("i", 11), { section: "processing" });
  const reads = h.db.stats.pageReads;
  await h.detail(uuid("i", 11), { section: "failures" });
  await h.detail(uuid("i", 11), { section: "uploads", focus: { kind: "stage", stageId: "sprint.extract" } });
  assert.equal(h.db.stats.pageReads, reads, "device sections and focus reuse the cached totals");
});

// ---------------------------------------------------------------------------
// Bounds and validation.

test("query limits: page size, range length, future end, unknown filters, focus, cursor syntax, response size", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  const invalid = (extra) => rejectsWith(h.fleet(extra), "invalid-argument");
  await invalid({ pageSize: 0 });
  await invalid({ pageSize: 101 });
  await invalid({ pageSize: 2.5 });
  await invalid({ startDate: "2026-06-30", endDate: "2026-09-28" }); // 91 days
  await h.fleet({ startDate: "2026-07-01", endDate: "2026-09-28" }); // 90 days
  await invalid({ endDate: "2026-09-30" });
  await invalid({ startDate: "2026-09-28", endDate: "2026-09-27" });
  await invalid({ startDate: "2026-02-30" });
  await invalid({ timeZone: "Mars/Olympus" });
  await invalid({ dateBasis: "clientTime" });
  await invalid({ filters: { team: "x" } });
  await invalid({ filters: { drill: "hockey" } });
  await invalid({ filters: { captureBuild: "1.4<script>" } });
  await invalid({ sort: "random" });
  await invalid({ focus: { kind: "stage", stageId: "Not A Stage" } });
  await invalid({ focus: { kind: "phase", drill: "sprint", phase: "capture" } });
  await invalid({ attemptsCursor: "abc" });
  await invalid({ cursor: "bad cursor!" });
  await invalid({ search: "x".repeat(81) });
  await invalid({ scope: { kind: "team", teamId: "t1" } });
  assert.equal((await h.fleet({ scope: "allDevices" })).scope, "allDevices", "the scope is explicit");
  const defaults = await h.reports.getFleet({}, ADMIN);
  assert.deepEqual(defaults.period, { startDate: "2026-09-23", endDate: "2026-09-29", timeZone: "America/Los_Angeles", dateBasis: "capture" }, "default: seven local days");
  assert.equal(defaults.filters.uploadRole, "resultFiles");
  const small = harness({ maxResponseBytes: 5000 });
  small.putAll(completeAttempt(1));
  await rejectsWith(small.fleet(), "resource-exhausted", "narrowRange");
});

test("admin only: every callable refuses non-admin callers before reading anything", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  const callers = [
    { uid: "coach1", email: "coach@club.example", emailVerified: true, isAnonymous: false },
    { uid: "unverified1", email: "ops@posetek.net", emailVerified: false, isAnonymous: false },
    { uid: "lookalike1", email: "ops@posetek.net.evil.example", emailVerified: true, isAnonymous: false },
    { uid: "anon1", email: "ops@posetek.net", emailVerified: true, isAnonymous: true },
    null,
  ];
  for (const caller of callers) {
    h.db.resetStats();
    await rejectsWith(h.reports.getFleet(h.request(), caller), "permission-denied");
    await rejectsWith(h.reports.getDetail({ ...h.request(), installId: INSTALL }, caller), "permission-denied");
    await rejectsWith(h.reports.getAttempt({ attemptId: uuid("a", 1) }, caller), "permission-denied");
    await rejectsWith(h.reports.setLabel({ installId: INSTALL, label: "x", expectedRevision: 0 }, caller), "permission-denied");
    assert.equal(h.db.stats.reads, 0, "nothing is read for a refused caller");
  }
  const report = await h.fleet();
  assert.equal(report.schemaVersion, 1);
});

// ---------------------------------------------------------------------------
// Verdict revision and attribution.

test("first-failure verdict revision (N3): invalid/processingFailed at once, then valid after a successful retry", async () => {
  const h = harness();
  const attemptId = uuid("a", 1), first = uuid("r", 1), retry = uuid("r", 2);
  h.put(attemptSummary({ attemptId, revision: 1, verdict: "invalid", reason: "processingFailed", acceptedRunId: null, timeToResult: null, requiredSave: "notQueued", saveConfirmed: null }));
  h.put(runSummary({ attemptId, runId: first, outcome: "failed" }));
  const before = await h.fleet();
  assert.deepEqual(before.totals.yield, { valid: 0, invalid: 1, pending: 0, userDiscarded: 0, firstRunValid: 0 }, "the failed attempt enters the yield denominator at once");
  assert.deepEqual([before.totals.outcomes.failed, before.totals.outcomes.valid], [1, 0]);
  h.put(runSummary({ attemptId, runId: retry, retryOf: first, occurredAt: START - DAY + 90000 }));
  h.put(attemptSummary({ attemptId, revision: 2, runCount: 2, acceptedRunId: retry }));
  const after = await h.fleet();
  assert.deepEqual(after.totals.yield, { valid: 1, invalid: 0, pending: 0, userDiscarded: 0, firstRunValid: 0 }, "eventual yield uses the latest verdict; first-run yield does not");
  assert.deepEqual([after.totals.outcomes.failed, after.totals.outcomes.valid], [1, 1], "the failed run still counts in the failure rate");
  assert.equal(after.totals.attempts, 1);
  const detail = await h.detail(INSTALL);
  assert.equal(detail.rows.attempts[0].measurementVerdict, "valid");
  assert.equal(detail.rows.attempts[0].failureStageId, "sprint.extract", "the confirmed failure stays visible on the row");
});

test("Captured here vs Processed or uploaded here: attempt counts stay origin-based, run and upload counts are executor-based (D-27 (5))", async () => {
  const h = harness();
  // Captured on INSTALL, processed on INSTALL.
  h.putAll(completeAttempt(1));
  // Captured on INSTALL, retried and uploaded on OTHER.
  const attemptId = uuid("a", 2);
  h.put(attemptSummary({ attemptId, runCount: 2, acceptedRunId: uuid("r", 3) }));
  h.put(runSummary({ attemptId, runId: uuid("r", 2), outcome: "failed" }));
  h.put(runSummary({ attemptId, runId: uuid("r", 3), retryOf: uuid("r", 2), executor: OTHER, origin: INSTALL, launch: f.launch(5), processingMs: 4000 }));
  h.put(uploadGroup({ attemptId, executor: OTHER, origin: INSTALL, cloudSave: 7000 }));
  h.put(transfer({ attemptId, invocationId: uuid("t", 2), executor: OTHER, origin: INSTALL }));
  // Captured and processed on OTHER.
  h.putAll(completeAttempt(4, { install: OTHER }));
  const captured = await h.detail(INSTALL, { attribution: "origin" });
  assert.equal(captured.totals.attempts, 2);
  assert.deepEqual([captured.totals.outcomes.valid, captured.totals.outcomes.failed], [2, 1], "all runs of the attempts captured here");
  assert.equal(captured.totals.cloudSave.sample, 2);
  const processed = await h.detail(OTHER, { attribution: "executor" });
  assert.equal(processed.totals.attempts, 1, "attempts are counted where they were captured");
  assert.equal(processed.coverage.attemptsIndexed, 1);
  assert.deepEqual([processed.totals.outcomes.valid, processed.totals.outcomes.failed], [2, 0], "the retry run and OTHER's own run");
  assert.equal(processed.totals.processingTime.byOutcome.valid.sample, 2);
  assert.deepEqual([processed.totals.cloudSave.sample, processed.totals.cloudSave.typicalMs], [2, 5500], "the result upload OTHER performed plus its own");
  assert.equal(processed.totals.uploads[0].invocations, 2);
  assert.deepEqual(processed.rows.attempts.map((row) => row.attemptId), [uuid("a", 4)], "processing rows are origin-based");
  const failures = await h.detail(INSTALL, { attribution: "executor", section: "failures" });
  assert.deepEqual(failures.rows.failures.map((row) => row.processingRunId), [uuid("r", 2)]);
  // Attempt rows show the executor on retries.
  const row = captured.rows.attempts.find((entry) => entry.attemptId === attemptId);
  assert.deepEqual([row.originInstallId, row.executorInstallId, row.runCount], [INSTALL, OTHER, 2]);
  // Fleet: unique attempts, runs to executors.
  const fleet = await h.fleet();
  assert.equal(fleet.totals.attempts, 3);
  const devices = Object.fromEntries(fleet.devices.map((entry) => [entry.installId, [entry.attempts, entry.runs]]));
  assert.deepEqual(devices, { [INSTALL]: [2, 2], [OTHER]: [1, 2] }, "attempts and runs are different populations");
});

// ---------------------------------------------------------------------------
// Device report, attempt detail, labels.

test("device report: header, builds, last status, sections and not-found", async () => {
  const h = harness();
  h.putAll(completeAttempt(1, { attempt: { build: "212" } }));
  h.putAll(completeAttempt(2, { captureAt: START - 2 * DAY, attempt: { build: "215", machine: "iPhone15,2" }, group: { category: "resultFiles", jobState: "queued", cloudSave: null } }));
  h.put(deviceStatus({ install: INSTALL, pending: 3, failed: 1 }));
  const report = await h.detail(INSTALL);
  assert.equal(report.device.installId, INSTALL);
  assert.equal(report.device.labelRevision, 0);
  assert.equal(report.device.machine, "iPhone14,7", "the latest status names the model");
  assert.deepEqual(report.device.builds.map((build) => build.label), ["1.4.0 (215)", "1.4.0 (212)", "1.4.1 (215)"]);
  assert.deepEqual(report.device.lastStatus.repQueuePending, 3);
  assert.equal(report.device.notRecentlyReporting, false);
  assert.equal(report.attribution, "origin");
  assert.equal(report.rows.kind, "processing");
  assert.equal(report.rows.attempts.length, 2);
  assert.deepEqual(report.totals.cloudBacklog, { pendingJobs: 3, failedJobs: 1, installsReporting: 1, oldestReportAt: report.device.lastStatus.reportedAt });
  const uploads = await h.detail(INSTALL, { section: "uploads" });
  assert.deepEqual(uploads.rows.uploads.map((row) => [row.attemptId, row.jobState, row.role]), [[uuid("a", 1), "committed", "resultFiles"], [uuid("a", 2), "queued", "resultFiles"]]);
  await rejectsWith(h.detail(uuid("i", 404)), "not-found");
  h.advance(4 * DAY);
  h.reports.clearCache();
  const stale = await h.detail(INSTALL, { startDate: "2026-09-27", endDate: "2026-10-03" });
  assert.equal(stale.device.notRecentlyReporting, true, "an old last report is Not recently reporting, not offline");
});

test("attempt detail: verbatim contract records, server times outside them, transfer paging, evidence by id and availability", async () => {
  const h = harness();
  const attemptId = uuid("a", 1);
  h.index(attemptId, { artifactsAcknowledgedAt: 1 });
  h.putAll(completeAttempt(1));
  for (let i = 0; i < 55; i++) h.put(transfer({ attemptId, invocationId: uuid("t", 200 + i), occurredAt: START - DAY + 50000 + i }));
  h.db.docs.set(`failureCases/processing-${uuid("r", 1)}`, { schemaVersion: 2, attemptId, retentionState: "expired" });
  const records = completeAttempt(1);
  const first = await h.reports.getAttempt({ attemptId, cursor: null }, ADMIN);
  assert.deepEqual(first.attempt, records[0], "the attempt summary is the client record, verbatim");
  assert.equal(first.attempt.firstReceivedAtServer, undefined);
  assert.ok(first.receivedAt.firstReceivedAtServer);
  assert.deepEqual(first.runs, [records[1]]);
  assert.deepEqual(first.uploadGroups, [records[2]]);
  assert.equal(first.transfers.length, 50);
  assert.deepEqual(first.transferPagination.totalRows, 56);
  const second = await h.reports.getAttempt({ attemptId, cursor: first.transferPagination.nextCursor }, ADMIN);
  assert.equal(second.transfers.length, 6);
  assert.equal(second.transferPagination.nextCursor, null);
  assert.deepEqual(first.evidence, [
    { kind: "processingAttempt", id: attemptId, availability: "available" },
    { kind: "run", id: uuid("r", 1), availability: "available" },
    { kind: "failureCase", id: `processing-${uuid("r", 1)}`, availability: "expired" },
  ]);
  assert.deepEqual(first.devices, [{ installId: INSTALL, label: null }]);
  h.put(transfer({ attemptId, invocationId: uuid("t", 999) }));
  await rejectsWith(h.reports.getAttempt({ attemptId, cursor: first.transferPagination.nextCursor }, ADMIN), "failed-precondition", "staleCursor");
  await rejectsWith(h.reports.getAttempt({ attemptId: uuid("a", 404) }, ADMIN), "not-found");
  await rejectsWith(h.reports.getAttempt({ attemptId: "A0000001-0000-4000-8000-000000000001" }, ADMIN), "invalid-argument");
  assert.equal(evidenceAvailability(null), "notCollected");
  assert.equal(evidenceAvailability({ retentionState: "active" }, "processingAttempt"), "pending");
  assert.equal(evidenceAvailability({ artifactUploadState: "complete" }, "failureCase"), "available");
});

test("labels: expected revision, conflict, audit record, aliases apart from measurements, search, not-found", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  h.putAll(completeAttempt(2, { install: OTHER }));
  const set = (label, expectedRevision, installId = INSTALL) => h.reports.setLabel({ installId, label, expectedRevision }, ADMIN);
  assert.deepEqual(await set("  Station   2 phone ", 0), { schemaVersion: 1, installId: INSTALL, label: "Station 2 phone", labelRevision: 1 });
  await rejectsWith(set("Other name", 0), "failed-precondition", "labelRevisionConflict");
  assert.deepEqual(await set(null, 1), { schemaVersion: 1, installId: INSTALL, label: null, labelRevision: 2 });
  await set("Station 2 phone", 2);
  await rejectsWith(set("x".repeat(49), 3), "invalid-argument");
  await rejectsWith(set("bad\u0007label", 3), "invalid-argument");
  await rejectsWith(set("New", 0, uuid("i", 404)), "not-found");
  const audit = h.db.paths("devicePerformanceProjections/v1/labelAudit/").map((path) => h.db.snapshot(path));
  assert.deepEqual(audit.map((row) => [row.previousLabel, row.label, row.previousRevision, row.labelRevision, row.actorUid]).sort((a, b) => a[3] - b[3]),
    [[null, "Station 2 phone", 0, 1, ADMIN.uid], ["Station 2 phone", null, 1, 2, ADMIN.uid], [null, "Station 2 phone", 2, 3, ADMIN.uid]]);
  assert.equal(h.db.paths("devicePerformanceDevices/").length, 0, "no measurement document was touched");
  const fleet = await h.fleet({ search: "station" });
  assert.deepEqual(fleet.devices.map((row) => [row.installId, row.label]), [[INSTALL, "Station 2 phone"]]);
  const device = await h.detail(INSTALL);
  assert.deepEqual([device.device.label, device.device.labelRevision], ["Station 2 phone", 3]);
  const attempts = await h.fleet({ focus: { kind: "phase", drill: "sprint", phase: "analysis" } });
  assert.equal(attempts.attempts.find((row) => row.originInstallId === INSTALL).deviceLabel, "Station 2 phone");
});

test("inner model rows: model operations only, one row per drill and stage across parents, terminal runs, cumulative per run", async () => {
  const h = harness();
  const kickStages = (extra = []) => [
    stage("kick.extract", 5000, { passId: "kick.extract" }), stage("model.create", 100, { parent: "kick.extract", passId: "kick.extract" }),
    stage("kick.denseBall", 3000, { passId: "kick.denseBall" }), stage("model.create", 40, { parent: "kick.denseBall", passId: "kick.denseBall" }),
    stage("model.firstPrediction", 30, { parent: "kick.denseBall", passId: "kick.denseBall", invocations: 3 }),
    stage("capture.cameraStopAck", 10, { parent: "kick.extract" }), ...extra,
  ];
  h.putAll(completeAttempt(1, { attempt: { drill: "deadballShot" }, run: { drill: "deadballShot", stages: kickStages() } }));
  h.putAll(completeAttempt(2, { attempt: { drill: "deadballShot" }, run: { drill: "deadballShot", stages: kickStages() } }));
  h.putAll(completeAttempt(3, { attempt: { drill: "deadballShot", verdict: "pending", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null },
    verdict: "pending", run: { drill: "deadballShot", outcome: "interruptedUnknown", processingMs: null, stages: kickStages() } }));
  const report = await h.fleet();
  const rows = report.innerModel.rows.filter((row) => row.drillType === "deadballShot");
  assert.deepEqual(rows.map((row) => `${row.drillType}:${row.stageId}`), ["deadballShot:model.create", "deadballShot:model.firstPrediction"], "unique keys, model.* only");
  const create = rows[0];
  assert.deepEqual([create.runs, create.invocations, create.cumulativeMs.sample, create.cumulativeMs.typicalMs], [2, 4, 2, 140],
    "two terminal runs; each run's calls summed across passes");
  assert.equal(create.parentStageId, "kick.denseBall", "the parent most runs used (a tie resolved by stage id)");
  const filtered = await h.fleet({ filters: { processingMode: "recovery" } });
  assert.deepEqual(filtered.innerModel.rows, [], "processing filters apply");
  const uploadFiltered = await h.fleet({ filters: { networkInterface: "cellular" } });
  sameJson(uploadFiltered.innerModel, report.innerModel, "upload filters never apply");
});

test("unknown device and summary-pending attempts are reported honestly, never as healthy zeros", async () => {
  const h = harness();
  const report0 = await h.fleet();
  assert.equal(report0.coverage.collectionStartedAt, null, "nothing collected yet");
  assert.equal(report0.totals.timeToResult.eligible, 0);
  h.putAll(completeAttempt(1, { install: null }));
  h.putAll(completeAttempt(2, { attempt: { missing: [["", "notCollectedByThisVersion"]] } }));
  const report = await h.fleet();
  assert.ok(report.coverage.collectionStartedAt);
  assert.equal(report.coverage.attemptsUnknownDevice, 1);
  assert.equal(report.coverage.attemptsNotCollectedByVersion, 1);
  const unknown = report.devices.find((row) => row.installId === null);
  assert.equal(unknown.attempts, 1, "Unknown device row");
  assert.equal(report.devices.at(-1).installId, null, "listed last");
});

test("response shapes carry every key the admin UI parses, with metric definitions and the optional executor and inner model keys", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  h.put(deviceStatus({ install: INSTALL }));
  const fleet = await h.fleet({ focus: { kind: "phase", drill: "sprint", phase: "unattributed" } });
  const envelope = ["schemaVersion", "scope", "generatedAt", "projectionRevision", "period", "filters", "effectiveFilters", "freshness", "coverage", "choices", "totals", "perDrill", "trends", "failureStages", "innerModel", "metricDefinitions"];
  for (const key of [...envelope, "devices", "pagination", "focus", "attempts", "attemptPagination"]) assert.ok(key in fleet, `fleet.${key}`);
  assert.deepEqual(Object.keys(fleet.totals), ["attempts", "timeToResult", "readyForNextRep", "saveConfirmedAfterRecording", "processingTime", "cloudSave", "cloudBacklog", "uploads", "outcomes", "runsExcludedByMode", "yield"]);
  assert.deepEqual(Object.keys(fleet.coverage), ["collectionStartedAt", "installsKnown", "installsNotRecentlyReporting", "attemptsIndexed", "attemptsPartial", "attemptsNotCollectedByVersion", "attemptsDateUncertain",
    "attemptsUnknownDevice", "attemptsDeviceNotYetReported", "attemptsExcludedOverLimit", "droppedDetailCount"]);
  assert.deepEqual(Object.keys(fleet.totals.outcomes), ["valid", "partial", "noMeasurement", "failed", "cancelled", "interruptedUnknown", "pending", "preAdmissionFailures", "omittedReasons"]);
  assert.deepEqual(Object.keys(fleet.totals.uploads[0]).slice(-2), ["retention", "groupsBeyondRetention"]);
  assert.deepEqual(Object.keys(fleet.devices[0]), ["installId", "label", "machine", "builds", "attempts", "runs", "lastReportAt", "notRecentlyReporting", "timeToResult", "cloudSave", "uploadWait", "outcomes"]);
  assert.deepEqual(Object.keys(fleet.attempts[0]), ["attemptId", "originInstallId", "deviceLabel", "machine", "drillType", "recordingMode", "captureOccurredAt", "clockQuality", "receivedAt",
    "captureBuild", "executionBuilds", "executorInstallId", "measurementVerdict", "verdictReason", "runCount", "timeToResultMs", "timeToResultMissing", "cloudSaveMs", "cloudSaveMissing",
    "requiredSaveState", "archiveState", "failureStageId", "lastReportedStageId", "completeness"]);
  assert.deepEqual(Object.keys(fleet.perDrill[2]), ["drillType", "attempts", "timeToResult", "allocation", "outcomes"]);
  assert.deepEqual(Object.keys(fleet.trends[0]), ["date", "attempts", "timeToResult", "failed", "knownOutcomes", "newBuilds"]);
  for (const id of ["timeToResult", "processingTime", "readyForNextRep", "cloudSave", "waitingToUpload", "uploadDuration", "uploadSpeed", "saveConfirmed", "failureRate", "yield", "failureAtStep", "typicalSlow"]) {
    assert.deepEqual(Object.keys(fleet.metricDefinitions[id]).sort(), ["definition", "denominator", "label", "population", "unit"], id);
  }
  assert.equal(fleet.metricDefinitions, METRIC_DEFINITIONS);
  const device = await h.detail(INSTALL);
  for (const key of [...envelope, "device", "attribution", "rows", "pagination"]) assert.ok(key in device, `device.${key}`);
  assert.deepEqual(Object.keys(device.device), ["installId", "label", "labelRevision", "machine", "builds", "lastReportAt", "notRecentlyReporting", "collectionStartedAt", "lastStatus"]);
  const uploads = await h.detail(INSTALL, { section: "uploads" });
  assert.deepEqual(Object.keys(uploads.rows.uploads[0]), ["attemptId", "groupId", "role", "drillType", "occurredAt", "clockQuality", "jobState", "objectCount", "bytes", "queueWaitMs", "transferMs", "cloudSaveMs", "transferAttempts", "failedTransfers", "lifetimeRetries", "requiredCommitAcknowledged"]);
  const attempt = await h.reports.getAttempt({ attemptId: uuid("a", 1) }, ADMIN);
  assert.deepEqual(Object.keys(attempt), ["schemaVersion", "generatedAt", "attemptId", "attempt", "runs", "uploadGroups", "transfers", "transferPagination", "receivedAt", "devices", "evidence"]);
});

test("the callable factory wires 1st-gen onCall handlers with the 512MB / 120 s budget", async () => {
  const calls = [];
  const fakeAdmin = { firestore: Object.assign(() => new (require("./test-support/device-performance/fake-firestore").FakeFirestore)(), { FieldValue: {}, Timestamp: {} }) };
  const functions = {
    https: { HttpsError: class extends Error {} },
    runWith(options) { calls.push(options); return { https: { onCall: (handler) => ({ handler }) } }; },
  };
  for (const name of Object.keys(HANDLERS)) {
    const callable = createDevicePerformanceCallable(name, functions, fakeAdmin, () => ({ uid: "x" }));
    assert.equal(typeof callable.handler, "function", name);
  }
  assert.deepEqual(calls, Array(4).fill({ timeoutSeconds: 120, memory: "512MB" }));
  assert.throws(() => createDevicePerformanceCallable("getSomethingElse", functions, fakeAdmin, () => null), /Unknown/);
});

// ---------------------------------------------------------------------------
// Review fixes (D-2026-09-29-31).

test("F5: fixture runs are excluded and counted; validation runs appear only in free-record rows, never pooled with the local drills", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  h.putAll(completeAttempt(2, { verdict: "invalid", attempt: { verdict: "invalid", reason: "processingFailed", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null },
    run: { outcome: "failed", processingMode: "fixture" }, group: { jobState: "notRequested", cloudSave: null } }));
  h.putAll(completeAttempt(3, { attempt: { drill: "freeRecord" }, run: { drill: "freeRecord", processingMode: "validation", processingMs: 4000 } }));
  const { totals, perDrill, failureStages, innerModel } = await h.fleet();
  assert.deepEqual([totals.outcomes.valid, totals.outcomes.failed], [1, 0], "neither the fixture run nor the validation run is pooled");
  assert.deepEqual(totals.runsExcludedByMode, { debugReview: 0, fixture: 1, validation: 1 });
  assert.deepEqual(totals.processingTime.byOutcome.failed.excludedReasons, [{ reason: "fixture", count: 1 }]);
  assert.deepEqual(totals.processingTime.byOutcome.valid.excludedReasons, [{ reason: "validation", count: 1 }]);
  const row = (drill) => perDrill.find((entry) => entry.drillType === drill);
  assert.equal(row("freeRecord").outcomes.valid, 1, "the free-record row counts its validation run");
  assert.deepEqual([row("sprint").outcomes.valid, row("sprint").outcomes.failed], [1, 0], "the fixture run is not in the sprint row");
  assert.equal(failureStages.some((entry) => entry.stageId.startsWith("poseValidation.")), false);
  assert.ok(innerModel.rows.some((entry) => entry.drillType === "freeRecord"), "free-record inner-model rows use validation runs");
  // Selecting a mode makes it the population.
  const fixture = await h.fleet({ filters: { processingMode: "fixture" } });
  assert.deepEqual([fixture.totals.outcomes.failed, fixture.totals.processingTime.byOutcome.failed.sample], [1, 1]);
  const validation = await h.fleet({ filters: { processingMode: "validation" } });
  assert.equal(validation.totals.outcomes.valid, 1);
});

test("F6: an attempt whose summary has not arrived is Device not yet reported, not Unknown device", async () => {
  const h = harness();
  h.put(runSummary({ attemptId: uuid("a", 1), runId: uuid("r", 1) }));
  h.putAll(completeAttempt(2, { install: null }));
  h.putAll(completeAttempt(3));
  const receipt = await h.fleet({ dateBasis: "serverReceipt", startDate: "2026-09-29", endDate: "2026-09-29" });
  assert.equal(receipt.totals.attempts, 3);
  assert.deepEqual([receipt.coverage.attemptsDeviceNotYetReported, receipt.coverage.attemptsUnknownDevice], [1, 1]);
  const unknown = receipt.devices.find((row) => row.installId === null);
  assert.equal(unknown.attempts, 1, "only the old-build attempt is in the Unknown device row");
  assert.equal(receipt.devices.reduce((sum, row) => sum + row.attempts, 0), 2, "the summary-pending attempt has no device row");
  const devices = Object.fromEntries(receipt.devices.map((row) => [row.installId, row.runs]));
  assert.equal(devices[INSTALL], 3, "runs stay with their executor: the pending attempt's run ran on INSTALL");
});

test("F3: transfers first received more than 30 days ago never count, whether or not their partition was rebuilt; upload stats state retention", async () => {
  const old = START - 35 * DAY;
  const h = harness({ now: old });
  h.putAll(completeAttempt(1, { captureAt: old - 60000, transfer: { bytes: 9_000_000, ms: 3000 } }));
  const early = await h.fleet({ startDate: "2026-08-20", endDate: "2026-08-25" });
  assert.equal(early.totals.uploads[0].invocations, 1, "within retention the transfer counts");
  assert.equal(early.totals.uploads[0].retention, "retained");
  h.advance(35 * DAY);
  h.putAll(completeAttempt(2, { transfer: { bytes: 1_000_000, ms: 1000 } }));
  const range = { startDate: "2026-07-02", endDate: "2026-09-29" };
  const late = await h.fleet(range);
  const role = late.totals.uploads[0];
  assert.deepEqual([role.invocations, role.payloadBytes, role.retention, role.groupsBeyondRetention], [1, 1_000_000, "partial", 1],
    "the old partition was not rebuilt, yet its expired transfer is dropped at read time");
  assert.equal(late.totals.attempts, 2, "attempt summaries are kept 90 days");
  // Rebuilding the old partition (as the retention sweep must) changes nothing.
  const keys = await h.projection.invalidateAttempts([uuid("a", 1)]);
  assert.equal(keys.length, 1);
  h.reports.clearCache();
  const rebuilt = await h.fleet(range);
  sameJson(rebuilt.totals.uploads, late.totals.uploads);
  const onlyOld = await h.fleet({ startDate: "2026-08-20", endDate: "2026-08-25" });
  assert.deepEqual([onlyOld.totals.uploads[0].retention, onlyOld.totals.uploads[0].invocations], ["notRetained", 0]);
  assert.equal(onlyOld.totals.uploads[0].queueWait.sample, 1, "group summaries (90 days) keep their waiting time");
  const cellular = await h.fleet({ startDate: "2026-08-20", endDate: "2026-08-25", filters: { networkInterface: "wifi" } });
  assert.equal(cellular.totals.uploads[0].queueWait.eligible, 0, "a group beyond retention never matches a network filter");
});

test("report fragments validate against the pinned contract $defs (v1.2.2): retention, omittedReasons, coverage, runsExcludedByMode", async () => {
  const contract = require("./device-performance-contract");
  const check = (pointer, value, label) => {
    const result = contract.validateSchema(pointer, value);
    assert.ok(result.valid, `${label}: ${result.errors.join("; ")}`);
  };
  const h = harness();
  h.putAll(completeAttempt(1));
  h.putAll(completeAttempt(2, { run: { processingMode: "debugReview" } }));
  h.putAll(completeAttempt(3, { install: null }));
  h.put(attemptSummary({ attemptId: uuid("a", 4), verdict: "pending", runCount: 2, acceptedRunId: null, timeToResult: null, requiredSave: "notQueued", saveConfirmed: null }));
  // Retention states partial and notRetained (as in the F3 test).
  const old = START - 35 * DAY;
  const aged = harness({ now: old });
  aged.putAll(completeAttempt(1, { captureAt: old - 60000 }));
  aged.advance(35 * DAY);
  aged.putAll(completeAttempt(2));
  const reports = [
    ["fleet", await h.fleet()],
    ["fleet processing filter", await h.fleet({ filters: { processingMode: "liveCapture" } })],
    ["fleet server receipt", await h.fleet({ dateBasis: "serverReceipt" })],
    ["device executor", await h.detail(INSTALL, { attribution: "executor" })],
    ["device uploads", await h.detail(INSTALL, { section: "uploads" })],
    ["fleet partial retention", await aged.fleet({ startDate: "2026-07-02", endDate: "2026-09-29" })],
    ["fleet not retained", await aged.fleet({ startDate: "2026-08-20", endDate: "2026-08-25" })],
  ];
  const seen = { uploads: new Set(), omitted: new Set(), coverage: 0, modes: new Set() };
  for (const [label, report] of reports) {
    for (const role of report.totals?.uploads ?? []) {
      check("#/$defs/reportUploadRetentionV1", role, `${label} upload role ${role.role ?? ""}`);
      seen.uploads.add(role.retention);
    }
    const outcomes = [report.totals?.outcomes, ...(report.perDrill ?? []).map((row) => row.outcomes), ...(report.devices ?? []).map((row) => row.outcomes)];
    for (const entry of outcomes.filter(Boolean)) {
      check("#/$defs/reportOmittedReasonsV1", entry.omittedReasons, `${label} omittedReasons`);
      seen.omitted.add(JSON.stringify(entry.omittedReasons));
    }
    if (report.coverage) { check("#/$defs/reportCoverageV1", report.coverage, `${label} coverage`); seen.coverage++; }
    if (report.totals && Object.hasOwn(report.totals, "runsExcludedByMode")) {
      check("#/$defs/reportRunsExcludedByModeV1", report.totals.runsExcludedByMode, `${label} runsExcludedByMode`);
      seen.modes.add(report.totals.runsExcludedByMode === null ? "null" : "counts");
    }
  }
  assert.deepEqual([...seen.uploads].sort(), ["notRetained", "partial", "retained"]);
  assert.ok(seen.omitted.has(JSON.stringify({ pending: "runFilterActive", preAdmissionFailures: "runFilterActive" })));
  assert.ok(seen.omitted.has(JSON.stringify({ pending: null, preAdmissionFailures: null })));
  assert.ok(seen.coverage >= 5, `coverage checked ${seen.coverage} times`);
  assert.deepEqual([...seen.modes].sort(), ["counts", "null"]);
  // The pinned $defs refuse what the contract forbids.
  assert.equal(contract.validateSchema("#/$defs/reportOmittedReasonsV1", { pending: "other", preAdmissionFailures: null }).valid, false);
  assert.equal(contract.validateSchema("#/$defs/reportRunsExcludedByModeV1", { debugReview: 0, fixture: 0 }).valid, false);
  assert.equal(contract.validateSchema("#/$defs/reportUploadRetentionV1", { retention: "unknown", groupsBeyondRetention: 0 }).valid, false);
  assert.equal(contract.validateSchema("#/$defs/reportCoverageV1", { attemptsIndexed: 1 }).valid, false);
});
