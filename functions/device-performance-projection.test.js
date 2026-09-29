"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const contract = require("./device-performance-contract");
const { createDevicePerformanceIngestion } = require("./device-performance-ingestion");
const projectionModule = require("./device-performance-projection");
const { compactAttempt, placement, attemptPlacementFields, phaseOf, choiceKey, PROJECTION_VERSION, LIMITS } = projectionModule;
const { FakeFirestore, Timestamp, FieldValue, HttpsError } = require("./test-support/device-performance/fake-firestore");
const f = require("./test-support/device-performance/facts");

const { uuid, harness, completeAttempt, attemptSummary, runSummary, uploadGroup, transfer, deviceStatus, storedFact, START, DAY, ADMIN } = f;
const stored = (record, at = START) => storedFact(record, { receivedAt: at, updatedAt: at });
const INSTALL = uuid("i", 1);
const partitionsOf = (h) => h.db.paths("devicePerformanceProjections/v1/partitionManifests/").map((path) => h.db.snapshot(path));
const pagesOf = (h) => h.db.paths("devicePerformanceProjections/v1/projectionPages/");
// Report parts that depend only on the facts, not on receipt times or ids.
const substance = (report) => JSON.stringify({
  totals: report.totals, perDrill: report.perDrill, trends: report.trends, failureStages: report.failureStages,
  innerModel: report.innerModel, choices: report.choices,
  coverage: { ...report.coverage, collectionStartedAt: null },
  devices: report.devices.map(({ lastReportAt, ...row }) => row),
});
async function refreshAll(h, days = 7) {
  return h.projection.refresh({ basis: "capture", startMillis: START - days * DAY, endMillis: START + DAY }, { deadline: h.now() + 60000 });
}

test("compaction reads only canonical field facts: evaluation facts are ignored, unknown storage versions are counted as skipped", () => {
  const attemptId = uuid("a", 1);
  const [attempt, run, group, invocation] = completeAttempt(1);
  const evaluationRun = runSummary({ attemptId, runId: uuid("r", 9), recordOrigin: "evaluation" });
  const future = { ...stored(run), storageVersion: 99 };
  const compact = compactAttempt({ attemptId, attempt: stored(attempt), runs: [stored(evaluationRun), future], groups: [stored(group)], transfers: [stored(invocation)] });
  assert.equal(compact.attempt.skipped, 1, "the newer storage version is skipped and counted");
  assert.deepEqual(compact.samples.map((sample) => sample.kind), ["attempt", "group", "transfer"], "no evaluation run and no unknown-version run");
  assert.equal(compact.attempt.runsReceived, 0);
  // An attempt with only evaluation facts produces nothing at all.
  const onlyEvaluation = compactAttempt({ attemptId, attempt: stored(attemptSummary({ attemptId, origin: "evaluation" })), runs: [stored(evaluationRun)] });
  assert.equal(onlyEvaluation, null);
});

test("compaction keeps the §3 attributes: phases from one launch, first-run validity, inner model call time, attribution from the summary", () => {
  const attemptId = uuid("a", 1), first = uuid("r", 1), retry = uuid("r", 2);
  const attempt = attemptSummary({ attemptId, runCount: 2, acceptedRunId: retry, drill: "deadballShot", build: "300", machine: "iPhone16,1" });
  const failed = runSummary({ attemptId, runId: first, drill: "deadballShot", outcome: "failed", build: "999" });
  const valid = runSummary({ attemptId, runId: retry, retryOf: first, drill: "deadballShot", occurredAt: START - DAY + 60000 });
  const compact = compactAttempt({ attemptId, attempt: stored(attempt), runs: [stored(valid), stored(failed)], index: { schemaVersion: 2, attemptId, drillType: "sprint", build: "old" } });
  const a = compact.attempt;
  assert.equal(a.drill, "deadballShot", "the attempt summary wins over the index");
  assert.deepEqual(a.captureBuild.key, "1.4.0 (300)");
  assert.equal(a.captureMachine.key, "iPhone16,1");
  assert.equal(a.firstRunValid, false, "the accepted run is a retry");
  assert.deepEqual(a.phases, { preparation: 400, waiting: 120, analysis: 14010, calculation: 40, localSaving: 100 },
    "both same-launch runs' main phases (the failed run's math was not reached)");
  const runs = compact.samples.filter((sample) => sample.kind === "run");
  assert.deepEqual(runs.map((run) => run.runId), [first, retry], "runs in occurrence order");
  assert.deepEqual(runs[0].inner, [["model.create", "kick.extract", 150, 1], ["model.firstPrediction", "kick.extract", 60, 2]]);
  assert.deepEqual(runs[0].stages.find(([stageId]) => stageId === "kick.extract"), ["kick.extract", "failed"]);
  assert.equal(runs[0].stages.some(([stageId]) => stageId === "kick.math"), false, "notReached stages are not entered");
  // A run in another launch makes phases unavailable (time to result is cross-launch).
  const other = runSummary({ attemptId, runId: retry, retryOf: first, drill: "deadballShot", launch: f.launch(2) });
  assert.equal(compactAttempt({ attemptId, attempt: stored(attemptSummary({ attemptId, runCount: 2, acceptedRunId: retry, drill: "deadballShot", timeToResult: null })), runs: [stored(failed), stored(other)] }).attempt.phases, null);
  // Without the summary, attribution comes from the index only.
  const pending = compactAttempt({ attemptId, runs: [stored(failed)], index: { schemaVersion: 2, attemptId, drillType: "sprint", build: "1.3.9 (200)", lastStage: "sprint.extract" } });
  assert.equal(pending.attempt.summary, false);
  assert.equal(pending.attempt.drill, "sprint");
  assert.equal(pending.attempt.captureBuild.key, "1.3.9 (200)");
  assert.equal(pending.attempt.origin, null, "no origin install until the summary arrives");
});

test("placement: a reliable capture goes to its UTC capture day; uncertain, future and summary-less attempts go to their receipt day", () => {
  const capture = Date.parse("2026-09-27T23:30:00.000Z"), receipt = Date.parse("2026-09-28T10:00:00.000Z");
  const fact = (o) => ({ record: attemptSummary({ attemptId: uuid("a", 1), captureAt: capture, ...o }), receivedAt: receipt, clock: o.clock ?? "reliable" });
  assert.deepEqual(placement(attemptPlacementFields(fact({}), [])), { key: `2026-09-27~${INSTALL}`, dayKey: "2026-09-27", installKey: INSTALL });
  assert.equal(placement(attemptPlacementFields(fact({ clock: "uncertain" }), [])).key, `u-2026-09-28~${INSTALL}`);
  assert.equal(placement(attemptPlacementFields({ ...fact({}), receivedAt: capture - 3600000 }, [])).key, `u-2027-09-27~${INSTALL}`.replace("2027-09-27", "2026-09-27"),
    "a capture an hour after its receipt is in the future: date uncertain");
  assert.equal(placement(attemptPlacementFields(fact({ install: null }), [])).key, "2026-09-27~unknown");
  assert.equal(placement(attemptPlacementFields(null, [{ receivedAt: receipt }, { receivedAt: receipt + DAY }])).key, "u-2026-09-28~unknown");
  assert.equal(phaseOf("capture.stopRequested"), null);
  assert.equal(phaseOf("capture.retainCopyHash"), "preparation");
  assert.equal(phaseOf("input.mass"), "waiting");
  assert.equal(phaseOf("admission.granted"), "analysis");
  assert.equal(phaseOf("jump.math"), "calculation");
  assert.equal(phaseOf("sprint.encode"), "calculation");
  assert.equal(phaseOf("accept.manifestAck"), "localSaving");
  assert.equal(phaseOf("flow.nextReady"), null);
  assert.equal(choiceKey("1.4.0 (212)"), "1.4.0 (212)");
  assert.equal(choiceKey("iPhone15,2 <beta>/α"), "iPhone15,2 _beta___");
  assert.match(choiceKey("iPhone15,2 <beta>/α"), /^[A-Za-z0-9 ._,()+:-]{1,128}$/, "the admin UI's URL-safe key set");
});

test("a rebuild publishes immutable pages from the latest facts; an unchanged partition is not rebuilt and nothing is incremented", async () => {
  const h = harness({ limits: { maxPageBytes: 8192 } });
  for (let n = 1; n <= 12; n++) { h.index(uuid("a", n)); h.putAll(completeAttempt(n)); }
  await refreshAll(h);
  const [manifest] = partitionsOf(h);
  assert.equal(manifest.key, `2026-09-28~${INSTALL}`);
  assert.equal(manifest.dirty, false);
  assert.equal(manifest.generation.version, PROJECTION_VERSION);
  assert.equal(manifest.generation.attempts, 12);
  assert.equal(manifest.generation.samples, 48);
  assert.ok(manifest.generation.pages.length > 1, "small pages split the generation");
  for (const page of manifest.generation.pages) {
    const doc = h.db.snapshot(`devicePerformanceProjections/v1/projectionPages/${page.id}`);
    assert.equal(doc.generationId, manifest.generation.id);
    assert.equal(doc.rows.length, page.rows);
    assert.equal(Buffer.byteLength(JSON.stringify(doc.rows)), page.bytes);
    assert.ok(page.bytes <= 8192);
  }
  assert.deepEqual(manifest.executorInstalls, [INSTALL]);
  // No new facts: no rebuild, same generation.
  await refreshAll(h);
  assert.equal(partitionsOf(h)[0].generation.id, manifest.generation.id);
  // A new revision of one attempt rebuilds the partition from the latest facts:
  // still 12 attempts, and the changed values replace (not add to) the old ones.
  h.put(attemptSummary({ attemptId: uuid("a", 3), revision: 2, timeToResult: 30000, acceptedRunId: uuid("r", 3), runNumber: 3 }));
  await refreshAll(h);
  const next = partitionsOf(h)[0];
  assert.notEqual(next.generation.id, manifest.generation.id);
  assert.equal(next.generation.attempts, 12);
  assert.equal(next.generation.samples, 48);
  assert.equal(next.retired.at(-1).id, manifest.generation.id, "the superseded generation is retired, not deleted yet");
  const report = await h.fleet();
  assert.equal(report.totals.attempts, 12);
  assert.equal(report.totals.timeToResult.sample, 12);
  assert.equal(report.totals.timeToResult.slowMs, 12000, "p90 of eleven 12 s values and one 30 s value");
});

test("duplicate, reordered and stale delivery through ingestion gives the same report as in-order delivery", async () => {
  const attemptId = uuid("a", 1), first = uuid("r", 1), retry = uuid("r", 2);
  const records = {
    pending: attemptSummary({ attemptId, revision: 1, verdict: "pending", runCount: 1, acceptedRunId: null, timeToResult: null, ready: null, saveConfirmed: null, requiredSave: "notQueued" }),
    failedRun: runSummary({ attemptId, runId: first, outcome: "failed" }),
    invalid: attemptSummary({ attemptId, revision: 2, verdict: "invalid", reason: "processingFailed", runCount: 1, acceptedRunId: null, timeToResult: null, saveConfirmed: null, requiredSave: "notQueued" }),
    retryRun: runSummary({ attemptId, runId: retry, retryOf: first, occurredAt: START - DAY + 90000 }),
    valid: attemptSummary({ attemptId, revision: 3, runCount: 2, acceptedRunId: retry, timeToResult: null }),
    group: uploadGroup({ attemptId }),
    invocation: transfer({ attemptId, invocationId: uuid("t", 1) }),
  };
  async function deliver(order) {
    const h = harness();
    h.db.docs.set("players/player", { authenticationUID: f.REPORTER, userUID: f.REPORTER });
    h.index(attemptId);
    const ingestion = createDevicePerformanceIngestion({ db: h.db, FieldValue, Timestamp, HttpsError, now: h.now, logger: { warn() {}, error() {} } });
    const statuses = [];
    for (const name of order) {
      h.advance(3000);
      const response = await ingestion.ingest({ performanceSchemaVersion: 1, batchId: uuid("x", 7), records: [records[name]] }, { uid: f.REPORTER, isAnonymous: false });
      statuses.push(response.results[0].status);
      // Interleave reads: a report between deliveries must never leave stale
      // or double-counted state behind.
      if (order.indexOf(name) % 2 === 1) await h.fleet();
    }
    return { report: await h.fleet(), statuses };
  }
  const inOrder = await deliver(["pending", "failedRun", "invalid", "retryRun", "valid", "group", "invocation"]);
  const shuffled = await deliver(["invocation", "valid", "retryRun", "retryRun", "group", "failedRun", "invalid", "pending", "valid", "failedRun"]);
  assert.deepEqual(inOrder.statuses, Array(7).fill("accepted"));
  assert.deepEqual(shuffled.statuses, ["accepted", "accepted", "accepted", "duplicate", "accepted", "accepted", "superseded", "superseded", "duplicate", "duplicate"]);
  assert.equal(substance(shuffled.report), substance(inOrder.report));
  const { totals } = inOrder.report;
  assert.equal(totals.attempts, 1);
  assert.deepEqual([totals.outcomes.valid, totals.outcomes.failed], [1, 1], "two runs, one attempt");
  assert.deepEqual(totals.yield, { valid: 1, invalid: 0, pending: 0, userDiscarded: 0, firstRunValid: 0 });
});

test("a failed partial rebuild publishes nothing, removes its pages, and keeps the previous generation", async () => {
  const h = harness({ limits: { maxPageBytes: 4096 } });
  for (let n = 1; n <= 6; n++) h.putAll(completeAttempt(n));
  let writes = 0;
  h.db.failWrite = (path) => path.includes("/projectionPages/") && ++writes === 2;
  await assert.rejects(h.fleet(), (error) => error.code === "unavailable" && error.details.errorCode === "projectionRebuilding");
  assert.deepEqual(pagesOf(h), [], "the landed first page was removed");
  assert.equal(partitionsOf(h)[0].generation, undefined, "nothing was published");
  h.db.failWrite = null;
  const first = await h.fleet();
  assert.equal(first.totals.attempts, 6);
  const published = partitionsOf(h)[0].generation;
  // A later failure leaves the published generation and its pages untouched.
  h.put(attemptSummary({ attemptId: uuid("a", 1), revision: 2, acceptedRunId: uuid("r", 1) }));
  h.db.failWrite = (path) => path.includes("/projectionPages/");
  await assert.rejects(h.fleet(), (error) => error.code === "unavailable");
  const after = partitionsOf(h)[0];
  assert.equal(after.generation.id, published.id);
  assert.equal(after.dirty, true);
  assert.deepEqual(pagesOf(h).length, published.pages.length);
  h.db.failWrite = null;
  assert.equal((await h.fleet()).totals.attempts, 6);
});

test("a source update during a rebuild aborts publication; the next refresh includes it", async () => {
  let injected = false;
  const hooks = {
    async beforePublish() {
      if (injected) return;
      injected = true;
      h.putAll(completeAttempt(2));
      await h.projection.scanChanges({ deadline: h.now() + 60000 });
    },
  };
  const h = harness({ hooks });
  h.putAll(completeAttempt(1));
  await assert.rejects(h.fleet(), (error) => error.code === "unavailable", "the only generation was stale, so nothing is served");
  assert.deepEqual(pagesOf(h), [], "the aborted generation's pages are gone");
  const report = await h.fleet();
  assert.equal(report.totals.attempts, 2);
  assert.equal(partitionsOf(h)[0].dirty, false);
});

test("an attempt that moves partition is counted once: runs first in the date-uncertain partition, then its capture day", async () => {
  const h = harness();
  const attemptId = uuid("a", 1), runId = uuid("r", 1);
  h.index(attemptId, { drillType: "sprint" });
  h.put(runSummary({ attemptId, runId }));
  const early = await h.fleet();
  assert.equal(early.totals.attempts, 0, "no capture date yet");
  assert.equal(early.coverage.attemptsDateUncertain, 1, "counted by receipt");
  const locator = h.db.snapshot(`devicePerformanceProjections/v1/attemptLocators/${attemptId}`);
  assert.match(locator.partitionKey, /^u-2026-09-29~unknown$/);
  h.put(attemptSummary({ attemptId, acceptedRunId: runId }));
  const late = await h.fleet();
  assert.equal(late.totals.attempts, 1);
  assert.equal(late.totals.outcomes.valid, 1, "the run is counted once");
  assert.equal(late.coverage.attemptsDateUncertain, 0);
  const manifests = Object.fromEntries(partitionsOf(h).map((manifest) => [manifest.key, manifest.generation.attempts]));
  assert.deepEqual(manifests, { [`2026-09-28~${INSTALL}`]: 1, "u-2026-09-29~unknown": 0 });
});

test("50,000 compact samples are read exactly; 50,001 are refused with narrowRange before any page is decoded", async () => {
  const h = harness();
  const template = compactAttempt({ attemptId: uuid("a", 1), attempt: stored(completeAttempt(1)[0]), runs: [stored(completeAttempt(1)[1])] });
  const [attemptTemplate, runTemplate] = template.samples;
  const perPartition = 5000, partitions = 5; // 25,000 attempts + 25,000 runs = 50,000 samples
  let n = 0;
  for (let p = 0; p < partitions; p++) {
    const install = uuid("i", 100 + p), key = `2026-09-28~${install}`;
    const samples = [];
    for (let i = 0; i < perPartition; i++) {
      const attemptId = uuid("a", ++n);
      samples.push({ ...attemptTemplate, attemptId, origin: install, timeToResult: 1000 + (n % 997) });
      samples.push({ ...runTemplate, attemptId, runId: uuid("r", n), executor: install });
    }
    await h.projection.markDirty(new Map([[key, { dayKey: "2026-09-28", installKey: install, executors: new Set([install]) }]]));
    const token = h.db.snapshot(`devicePerformanceProjections/v1/partitionManifests/${key}`).token;
    assert.ok(await h.projection.writeGeneration(key, { dayKey: "2026-09-28", installKey: install }, token, samples, h.now() + 1));
  }
  const manifests = await h.projection.selectPartitions({ basis: "capture", startMillis: START - 7 * DAY, endMillis: START + DAY });
  assert.equal(manifests.reduce((sum, manifest) => sum + manifest.generation.samples, 0), 50000);
  h.db.resetStats();
  const loaded = await h.projection.loadSamples(manifests);
  assert.equal(loaded.samples.length, 50000);
  assert.ok(loaded.decodedBytes <= LIMITS.maxDecodedBytes);
  assert.equal(h.db.stats.pageBytes, loaded.decodedBytes, "decoded bytes are measured, page by page");
  assert.ok(h.db.stats.maxInflightPages <= 2, `at most two concurrent page reads (saw ${h.db.stats.maxInflightPages})`);
  const report = await h.fleet();
  assert.equal(report.totals.attempts, 25000);
  assert.equal(report.totals.timeToResult.sample, 25000);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 2 * 1024 * 1024, "the response stays within 2 MiB");
  // One more sample: refused from the declared totals, before any decoding.
  const extra = `2026-09-27~${uuid("i", 999)}`;
  await h.projection.markDirty(new Map([[extra, { dayKey: "2026-09-27", installKey: uuid("i", 999), executors: new Set() }]]));
  const token = h.db.snapshot(`devicePerformanceProjections/v1/partitionManifests/${extra}`).token;
  await h.projection.writeGeneration(extra, { dayKey: "2026-09-27", installKey: uuid("i", 999) }, token, [{ ...attemptTemplate, attemptId: uuid("a", 999999) }], h.now() + 1);
  h.db.resetStats();
  const more = await h.projection.selectPartitions({ basis: "capture", startMillis: START - 7 * DAY, endMillis: START + DAY });
  await assert.rejects(h.projection.loadSamples(more), (error) => error.code === "resource-exhausted"
    && error.details.errorCode === "narrowRange" && error.details.bound === "samples" && error.details.limit === 50000);
  assert.equal(h.db.stats.pageReads, 0, "no page was decoded");
  await assert.rejects(h.fleet(), (error) => error.code === "resource-exhausted" && error.details.limit === 50000);
});

test("the decoded-byte budget and page sizes are enforced before a page is retained", async () => {
  const h = harness({ limits: { maxDecodedBytes: 20000, maxPageBytes: 8192 } });
  for (let n = 1; n <= 30; n++) h.putAll(completeAttempt(n));
  h.db.resetStats();
  await assert.rejects(h.fleet(), (error) => error.code === "resource-exhausted" && error.details.bound === "decodedBytes" && error.details.limit === undefined);
  assert.equal(h.db.stats.pageReads, 0, "refused from the declared bytes");
  // A manifest that understates a page is caught when that page is decoded,
  // and the page is never retained.
  const g = harness();
  g.putAll(completeAttempt(1));
  await g.fleet();
  const path = g.db.paths("devicePerformanceProjections/v1/partitionManifests/")[0];
  const manifest = g.db.snapshot(path);
  manifest.generation.pages[0].bytes = 10;
  manifest.generation.bytes = 10;
  g.db.docs.set(path, manifest);
  g.reports.clearCache();
  const selected = await g.projection.selectPartitions({ basis: "capture", startMillis: START - 7 * DAY, endMillis: START + DAY });
  await assert.rejects(g.projection.loadSamples(selected), (error) => error.code === "failed-precondition" && error.details.errorCode === "invalidPage");
});

test("superseded pages are deleted only after the grace period; unreferenced pages after the orphan grace", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  await h.fleet();
  const firstPages = pagesOf(h);
  h.put(attemptSummary({ attemptId: uuid("a", 1), revision: 2, acceptedRunId: uuid("r", 1) }));
  await h.fleet();
  assert.ok(firstPages.every((path) => h.db.snapshot(path)), "a concurrent reader of the old generation still finds its pages");
  // An orphan from a crashed rebuild (never referenced).
  h.db.docs.set("devicePerformanceProjections/v1/projectionPages/orphan", { version: 1, partitionKey: `2026-09-28~${INSTALL}`, generationId: "crashed", createdAtMillis: h.now(), rows: [] });
  h.advance(LIMITS.retiredGraceMs + 1);
  h.put(attemptSummary({ attemptId: uuid("a", 1), revision: 3, acceptedRunId: uuid("r", 1) }));
  await h.fleet();
  assert.ok(firstPages.every((path) => !h.db.snapshot(path)), "the first generation's pages are gone after the grace");
  assert.ok(h.db.snapshot("devicePerformanceProjections/v1/projectionPages/orphan"), "an orphan younger than its grace is kept");
  h.advance(LIMITS.orphanGraceMs + 1);
  h.put(attemptSummary({ attemptId: uuid("a", 1), revision: 4, acceptedRunId: uuid("r", 1) }));
  await h.fleet();
  assert.equal(h.db.snapshot("devicePerformanceProjections/v1/projectionPages/orphan"), undefined);
  const manifest = partitionsOf(h)[0];
  const live = new Set([manifest.generation.id, ...manifest.retired.map((entry) => entry.id)]);
  assert.ok(pagesOf(h).every((path) => live.has(h.db.snapshot(path).generationId)), "every remaining page is referenced");
});

test("evaluation-origin facts that exist are never projected; ingestion rejects them", async () => {
  const withEvaluation = harness(), without = harness();
  for (const h of [withEvaluation, without]) for (let n = 1; n <= 3; n++) h.putAll(completeAttempt(n));
  // Seeded directly (ingestion would refuse them): an evaluation attempt with a
  // failed run, and an evaluation run on a field attempt.
  const evaluationAttempt = uuid("a", 50);
  withEvaluation.put(attemptSummary({ attemptId: evaluationAttempt, origin: "evaluation", verdict: "invalid" }));
  withEvaluation.put(runSummary({ attemptId: evaluationAttempt, runId: uuid("r", 50), outcome: "failed", recordOrigin: "evaluation" }));
  withEvaluation.put(runSummary({ attemptId: uuid("a", 1), runId: uuid("r", 51), outcome: "failed", recordOrigin: "evaluation" }));
  withEvaluation.put(transfer({ attemptId: uuid("a", 2), invocationId: uuid("t", 51), recordOrigin: "evaluation", ms: 1 }));
  assert.equal(substance(await withEvaluation.fleet()), substance(await without.fleet()));
  const detail = await withEvaluation.reports.getAttempt({ attemptId: uuid("a", 1) }, ADMIN);
  assert.deepEqual(detail.runs.map((run) => run.processingRunId), [uuid("r", 1)]);
  await assert.rejects(withEvaluation.reports.getAttempt({ attemptId: evaluationAttempt }, ADMIN), (error) => error.code === "not-found");
  const db = new FakeFirestore({ "players/player": { authenticationUID: f.REPORTER, userUID: f.REPORTER } });
  const ingestion = createDevicePerformanceIngestion({ db, FieldValue, Timestamp, HttpsError, logger: { warn() {}, error() {} } });
  const evaluationRecord = runSummary({ attemptId: uuid("a", 60), runId: uuid("r", 60), recordOrigin: "evaluation" });
  const response = await ingestion.ingest({ performanceSchemaVersion: 1, batchId: uuid("x", 8), records: [evaluationRecord] }, { uid: f.REPORTER, isAnonymous: false });
  assert.deepEqual([response.results[0].status, response.results[0].errorCode], ["rejected", "evaluationOriginRejected"]);
  assert.equal(contract.checkIngestible(evaluationRecord).ok, false);
});

test("device status merges per install by the latest client report (D-18)", async () => {
  const h = harness();
  const older = deviceStatus({ install: INSTALL, reporter: "uidA", occurredAt: START - 2 * 3600000, pending: 5 });
  const newer = deviceStatus({ install: INSTALL, reporter: "uidB", occurredAt: START - 3600000, pending: 2 });
  // v1.2 keys a status per install and reporter; two documents for one install.
  h.db.docs.set(`devicePerformanceDevices/deviceStatus:${INSTALL}:uidB`, storedFact(newer, { receivedAt: START - 5000, updatedAt: START - 5000 }));
  h.db.docs.set(`devicePerformanceDevices/deviceStatus:${INSTALL}`, storedFact(older, { receivedAt: START - 9000, updatedAt: START - 1000 }));
  const statuses = await h.projection.readDeviceStatuses();
  assert.equal(statuses.size, 1);
  assert.equal(statuses.get(INSTALL).record.body.repQueuePending, 2, "latest occurredAtClient wins, not latest receipt");
  assert.equal(statuses.get(INSTALL).firstReceivedAt, START - 9000);
  const report = await h.fleet();
  assert.deepEqual(report.totals.cloudBacklog, { pendingJobs: 2, failedJobs: 0, installsReporting: 1, oldestReportAt: new Date(START - 5000).toISOString() });
});

test("compactTransfer takes its category from the first two groupId separators, never a v1.2 system group's install", () => {
  const { compactTransfer, usableFact } = projectionModule;
  const fact = (record) => usableFact(stored(record), "transferInvocation");
  const attemptTransfer = transfer({ attemptId: uuid("a", 1), invocationId: uuid("t", 70), category: "optionalVideo" });
  assert.equal(compactTransfer(fact(attemptTransfer), uuid("a", 1)).category, "optionalVideo");
  const install = uuid("i", 7);
  // A system transfer's group names the record's own install (v1.2.2, D-36).
  const system = { ...transfer({ attemptId: uuid("a", 1), invocationId: uuid("t", 71), category: "diagnostics", origin: install }), attemptId: null };
  system.body = { ...system.body, groupId: `system:diagnostics:${install}`, logicalObjectId: `system/diagnosticArtifact.slot/${"1".repeat(64)}` };
  assert.equal(contract.validateRecord(system).ok, true, contract.validateRecord(system).errors.join("; "));
  const compact = compactTransfer(fact(system), null);
  assert.equal(compact.category, "diagnostics");
  assert.notEqual(compact.category, install);
});

test("device status merge falls back to server receipt order when a client time is missing, unreliable or tied (v1.2.1)", async () => {
  const h = harness();
  const put = (record, updatedAt, extra = {}) => h.db.docs.set(`devicePerformanceDevices/deviceStatus:${record.recordId}`,
    { ...storedFact(record, { receivedAt: updatedAt - 1000, updatedAt }), ...extra });
  const hour = 3600000;
  const cases = [
    // [label, install, reports: [reporter, occurredAt, clock, updatedAt, extra], expected winner]
    ["both reliable: the later client time wins over the later receipt", 41,
      [["uidA", START - hour, "reliable", START - 9000], ["uidB", START - 2 * hour, "reliable", START - 1000]], "uidA"],
    ["an uncertain clock never outranks by client time: receipt order decides", 42,
      [["uidA", START - hour, "uncertain", START - 9000], ["uidB", START - 2 * hour, "reliable", START - 1000]], "uidB"],
    ["a missing client time: receipt order decides", 43,
      [["uidA", null, "reliable", START - 1000], ["uidB", START - hour, "reliable", START - 9000]], "uidA"],
    ["a tie on client time: the latest received revision wins", 44,
      [["uidA", START - hour, "reliable", START - 9000], ["uidB", START - hour, "reliable", START - 1000]], "uidB"],
    ["a server-downgraded future clock is not reliable: receipt order decides", 45,
      [["uidA", START + hour, "reliable", START - 9000, { serverClockQuality: "future" }], ["uidB", START - hour, "reliable", START - 1000]], "uidB"],
  ];
  for (const [, n, reports] of cases) {
    for (const [reporter, occurredAt, clock, updatedAt, extra] of reports) put(deviceStatus({ install: uuid("i", n), reporter, occurredAt, clock }), updatedAt, extra);
  }
  const statuses = await h.projection.readDeviceStatuses();
  for (const [label, n, , winner] of cases) {
    const merged = statuses.get(uuid("i", n));
    assert.equal(merged.record.originReporterUid, winner, label);
    assert.equal(merged.reporters, 2, label);
    assert.equal(merged.firstReceivedAt, Math.min(...cases.find((row) => row[1] === n)[2].map((report) => report[3] - 1000)), label);
  }
  // Reads page by document id; swapping the reporter names swaps which report
  // is read first, and the same report must still win.
  const swap = { uidA: "uidB", uidB: "uidA" };
  const swapped = harness();
  for (const [, n, reports] of cases) {
    for (const [reporter, occurredAt, clock, updatedAt, extra] of reports) {
      const record = deviceStatus({ install: uuid("i", n), reporter: swap[reporter], occurredAt, clock });
      swapped.db.docs.set(`devicePerformanceDevices/deviceStatus:${record.recordId}`,
        { ...storedFact(record, { receivedAt: updatedAt - 1000, updatedAt }), ...extra });
    }
  }
  const again = await swapped.projection.readDeviceStatuses();
  for (const [label, n, , winner] of cases) assert.equal(again.get(uuid("i", n)).record.originReporterUid, swap[winner], `${label} (read order swapped)`);
});

test("the change scanner pages through every root, never moves backwards, and locates each attempt once per change", async () => {
  const h = harness({ limits: { scanPageSize: 3 } });
  for (let n = 1; n <= 7; n++) h.putAll(completeAttempt(n));
  const result = await h.projection.scanChanges({ deadline: h.now() + 60000 });
  assert.deepEqual(result, { drained: true, processed: 28 });
  assert.equal(h.db.paths("devicePerformanceProjections/v1/attemptLocators/").length, 7);
  const state = h.db.snapshot("devicePerformanceProjections/v1");
  assert.deepEqual(Object.keys(state.scan).sort(), ["attempts", "runs", "transfers", "uploadGroups"]);
  // Re-running finds nothing; an older cursor written concurrently never wins.
  assert.deepEqual(await h.projection.scanChanges({ deadline: h.now() + 60000 }), { drained: true, processed: 0 });
  const bounded = harness({ limits: { scanPageSize: 2, scanMaxPerCall: 4 } });
  for (let n = 1; n <= 5; n++) bounded.putAll(completeAttempt(n));
  assert.equal((await bounded.projection.scanChanges({ deadline: bounded.now() + 60000 })).drained, false);
  await assert.rejects(bounded.fleet(), (error) => error.code === "unavailable", "an undrained backlog is never reported as complete");
  const done = await (async () => { for (let i = 0; i < 10; i++) { try { return await bounded.fleet(); } catch (error) { if (error.code !== "unavailable") throw error; } } return null; })();
  assert.equal(done.totals.attempts, 5, "each retry advances the scan until the report is complete");
});

test("every query that needs a composite index has one in firestore.indexes.json; capture-date reports never select by receipt time", async () => {
  const { indexes, fieldOverrides } = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "firestore.indexes.json"), "utf8"));
  const h = harness();
  h.putAll(completeAttempt(1));
  h.put(runSummary({ attemptId: uuid("a", 1), runId: uuid("r", 7), retryOf: uuid("r", 1), executor: uuid("i", 2), origin: INSTALL }));
  h.putAll(completeAttempt(2, { install: uuid("i", 2) }));
  h.db.resetStats();
  await h.fleet();
  const capture = h.db.stats.queries.filter((query) => query.path.endsWith("/partitionManifests"));
  assert.ok(capture.length && capture.every((query) => query.filters.every((filter) => !filter.startsWith("maxReceiptMillis"))), "capture-date selection uses capture days only");
  await h.fleet({ dateBasis: "serverReceipt" });
  for (const attribution of ["origin", "executor"]) {
    for (const dateBasis of ["capture", "serverReceipt"]) await h.detail(uuid("i", 2), { attribution, dateBasis });
  }
  const needs = new Map();
  for (const query of h.db.stats.queries) {
    const group = query.path.split("/").at(-1);
    const equality = query.filters.filter((filter) => / (==|array-contains)$/.test(filter)).map((filter) => filter.split(" "));
    const range = [...new Set([...query.filters.filter((filter) => / (<|<=|>|>=)$/.test(filter)), ...query.orders]
      .map((entry) => entry.split(" ")[0]).filter((field) => field !== "__name__"))];
    if (!equality.length || !range.length) continue; // served by single-field indexes
    needs.set(`${group}|${equality.map(([field, op]) => `${field}:${op}`).sort().join(",")}|${range.join(",")}`, { group, equality, range });
  }
  assert.ok(needs.size >= 4, "the device-scoped selections were exercised");
  for (const { group, equality, range } of needs.values()) {
    const covered = indexes.some((index) => index.collectionGroup === group && index.queryScope === "COLLECTION"
      && index.fields.length === equality.length + range.length
      && equality.every(([field, op]) => index.fields.slice(0, equality.length).some((entry) => entry.fieldPath === field
        && (op === "array-contains" ? entry.arrayConfig === "CONTAINS" : entry.order === "ASCENDING")))
      && range.every((field, offset) => index.fields[equality.length + offset].fieldPath === field));
    assert.ok(covered, `missing composite index: ${group} ${JSON.stringify(equality)} then ${range}`);
  }
  // The large nested fields are exempt from single-field indexing.
  const exempt = new Set(fieldOverrides.filter((entry) => entry.indexes.length === 0).map((entry) => `${entry.collectionGroup}.${entry.fieldPath}`));
  for (const root of Object.values(contract.ROOTS)) assert.ok(exempt.has(`${root}.record`), `${root}.record is exempt`);
  assert.ok(exempt.has("projectionPages.rows"));
});

// ---------------------------------------------------------------------------
// Review fixes (D-2026-09-29-31).

test("F1: an attempt with 129 runs and one with 2,001 transfers are excluded and counted; the partition publishes and the report loads", async () => {
  const h = harness();
  for (let n = 1; n <= 3; n++) h.putAll(completeAttempt(n));
  const runs = uuid("a", 10), transfers = uuid("a", 11);
  h.put(attemptSummary({ attemptId: runs, runCount: 64, acceptedRunId: null, verdict: "pending", timeToResult: null, requiredSave: "notQueued", saveConfirmed: null }));
  for (let i = 0; i < 129; i++) h.put(runSummary({ attemptId: runs, runId: uuid("r", 1000 + i), outcome: "failed" }));
  h.putAll(completeAttempt(11));
  for (let i = 0; i < 2000; i++) h.put(transfer({ attemptId: transfers, invocationId: uuid("t", 5000 + i), bytes: 1 }));
  let report;
  for (let i = 0; i < 3 && !report; i++) {
    try { report = await h.fleet(); } catch (error) { if (error.code !== "unavailable") throw error; } // the scan drains 5,000 facts per call
  }
  assert.ok(report, "the report loads");
  assert.equal(report.coverage.attemptsExcludedOverLimit, 2);
  assert.equal(report.totals.attempts, 3, "the other attempts are all reported");
  assert.equal(report.totals.outcomes.failed, 0, "none of the 129 runs is counted");
  assert.equal(report.totals.uploads[0].invocations, 3);
  const manifest = partitionsOf(h)[0];
  assert.equal(manifest.dirty, false);
  assert.equal(manifest.generation.attempts, 5, "published, with the two over-limit attempts as counted attempt samples only");
  assert.equal(manifest.generation.samples, 3 * 4 + 2);
  const excluded = compactAttempt(await h.projection.readForCompaction(runs)).attempt.excludedOverLimit;
  assert.deepEqual(excluded, { runs: 129, groups: 0, transfers: 0 });
});

test("F1: a partition over its attempt limit becomes a typed narrowRange naming it; other devices and days still load", async () => {
  const h = harness({ limits: { maxPartitionAttempts: 3 } });
  for (let n = 1; n <= 4; n++) h.putAll(completeAttempt(n));
  h.putAll(completeAttempt(5, { install: uuid("i", 2) }));
  h.putAll(completeAttempt(6, { captureAt: START - 3 * DAY }));
  const key = `2026-09-28~${INSTALL}`;
  await assert.rejects(h.fleet(), (error) => error.code === "resource-exhausted" && error.details.errorCode === "narrowRange"
    && error.details.bound === "partitionAttempts" && error.details.partition === key && error.details.attempts === 4 && error.details.max === 3
    && /choose a device/.test(error.message) && !/drill/.test(error.message));
  const overflow = partitionsOf(h).find((manifest) => manifest.key === key);
  assert.equal(overflow.dirty, false, "the overflow is published, not left rebuilding");
  assert.deepEqual(overflow.generation.overflow, { attempts: 4, limit: 3 });
  // A second call does not rebuild again (typed, stable), and narrower reports load.
  await assert.rejects(h.fleet(), (error) => error.details?.bound === "partitionAttempts");
  assert.equal((await h.detail(uuid("i", 2))).totals.attempts, 1);
  assert.equal((await h.fleet({ startDate: "2026-09-26", endDate: "2026-09-26" })).totals.attempts, 1);
});

test("F2: a rebuild compacts each attempt as it is read and reads transfers as a field projection with identical samples", async () => {
  const h = harness();
  for (let n = 1; n <= 3; n++) h.putAll(completeAttempt(n));
  h.db.resetStats();
  await h.fleet();
  const transferReads = h.db.stats.queries.filter((query) => query.path === "devicePerformanceTransfers" && query.filters.includes("attemptId =="));
  assert.ok(transferReads.length >= 3);
  assert.ok(transferReads.every((query) => Array.isArray(query.fields) && query.fields.includes("record.body.invocationElapsedMs")
    && !query.fields.includes("record")), "never the whole transfer record");
  const attemptId = uuid("a", 1);
  const projected = await h.projection.readForCompaction(attemptId);
  const full = await h.projection.readCanonical(attemptId);
  const kinds = (compact) => compact.samples.filter((sample) => sample.kind === "transfer");
  assert.deepEqual(kinds(compactAttempt(projected, 0, { nowMillis: h.now() })), kinds(compactAttempt(full, 0, { nowMillis: h.now() })));
  assert.deepEqual(compactAttempt(projected).samples, compactAttempt(full).samples, "the compacted attempt is the same either way");
});

test("F7: currency is a token match, not a clock comparison: a dirty partition with a future-dated generation is rebuilt", async () => {
  const h = harness();
  h.putAll(completeAttempt(1));
  assert.equal((await h.fleet()).totals.attempts, 1);
  h.putAll(completeAttempt(2));
  await h.projection.scanChanges({ deadline: h.now() + 60000 });
  // Another instance's clock runs a day ahead.
  const path = h.db.paths("devicePerformanceProjections/v1/partitionManifests/")[0];
  const manifest = h.db.snapshot(path);
  manifest.generation.startedAtMillis = h.now() + DAY;
  h.db.docs.set(path, manifest);
  assert.equal(h.projection.usable(manifest), false, "the token was rotated after the generation began");
  assert.equal((await h.fleet()).totals.attempts, 2, "rebuilt, so the new attempt is in");
  const current = partitionsOf(h)[0];
  assert.equal(h.projection.usable(current), true);
  assert.equal(h.projection.usable({ ...current, token: "rotated" }), false);
  assert.equal(h.projection.usable({ ...current, token: "rotated" }, new Map([[current.key, current.generation.id]])), true,
    "a generation this request published after its own scan stays current for it");
});

test("limits can be lowered for tests but never raised", () => {
  const db = new FakeFirestore();
  assert.throws(() => projectionModule.createDevicePerformanceProjection({ db, HttpsError, FieldValue, limits: { maxSamples: 50001 } }), /Invalid device performance limit maxSamples/);
  assert.throws(() => projectionModule.createDevicePerformanceProjection({ db, HttpsError, FieldValue, limits: { unknown: 1 } }), /Invalid/);
  assert.equal(projectionModule.createDevicePerformanceProjection({ db, HttpsError, FieldValue, limits: { maxSamples: 10 } }).limits.maxSamples, 10);
});
