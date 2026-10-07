"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const contract = require("./device-performance-contract");

const PINNED = path.join(__dirname, "contracts", "device-performance-v1");
// Frozen V1 schema digest (mobile tools/contracts/device-performance-v1/README.md).
const SCHEMA_SHA256 = "e8a09d63a84ed2d95130015489e97ce6884f5e8fef0655caf2115ff16d08e0d3";
const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fixture = (name) => readJson(path.join(PINNED, "fixtures", name));
function listFiles(root, prefix = "") {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => (entry.isDirectory() ? listFiles(root, path.posix.join(prefix, entry.name)) : [path.posix.join(prefix, entry.name)]))
    .sort();
}
function readmeDigests(readme) {
  return new Map([...readme.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map(([, file, hash]) => [file, hash]));
}
// The sibling-checkout convention of app/rules-tests (RULES_PATH): default
// ../PoseTek-mobile-app, overridable.
function canonicalDirectory() {
  const repo = process.env.POSETEK_MOBILE_REPO || path.resolve(__dirname, "..", "..", "PoseTek-mobile-app");
  return path.join(repo, "tools", "contracts", "device-performance-v1");
}

// The error code each invalid fixture must produce through the ingestion
// validator, and the rule (the manifest's `violates`) every reported error must
// name, so a fixture can never pass by failing for an unrelated reason.
const INVALID_FIXTURES = {
  "run-summary-oversized.invalid.json": ["oversizedRecord", /^\$: \d+ bytes exceeds 16384$/],
  "run-summary-too-many-pass-ids.invalid.json": ["invalidSchema", /^\$\.body\.passIds: more than 8 items$/],
  "run-summary-negative-duration.invalid.json": ["invalidSchema", /^\$\.body\.stages\[\d+\]\.elapsedMs: below minimum 0$/],
  "evaluation-origin-without-run-id.invalid.json": ["invalidSchema", /^\$\.evaluationRunId: type is not string$/],
  "field-origin-with-evaluation-run-id.invalid.json": ["invalidSchema", /^\$\.evaluationRunId: type is not null$/],
  "stage-nested-without-parent.invalid.json": ["invalidSchema", /^\$\.body\.stages\[\d+\]\.parentStageId: type is not string$/],
  "attempt-summary-invalid-verdict-without-reason.invalid.json": ["invalidSchema", /^\$\.body\.verdictReason: value is not in the enum$/],
  "missing-reason-points-at-value.invalid.json": ["invalidSchema", /^\$\.missingReasons\[\d+\]: points at a present value$/],
  "upload-group-summary-system-without-install.invalid.json": ["invalidSchema", /^\$\.originInstallId: type is not string$/],
  "upload-group-summary-system-foreign-install.invalid.json": ["identityMismatch", /^\$\.recordId: does not equal the uploadGroupSummary entity id$/],
  "device-status-without-reporter.invalid.json": ["invalidSchema", /^\$\.originReporterUid: type is not string$/],
  "device-status-record-id-other-reporter.invalid.json": ["identityMismatch", /^\$\.recordId: does not equal the deviceStatus entity id$/],
  "transfer-invocation-system-foreign-install.invalid.json": ["identityMismatch", /^\$\.body\.groupId: names a different install$/],
  "batch-too-many-records.invalid.json": ["oversizedBatch", /^\$\.records: more than 16 items$/],
};
function assertFailingRule(file, errors) {
  const [, rule] = INVALID_FIXTURES[file];
  assert.ok(errors.length > 0, `${file} reports its violation`);
  for (const error of errors) assert.match(error, rule, `${file} fails only for its declared rule`);
}

test("the pinned schema and fixtures match the contract's digest table", () => {
  const digests = readmeDigests(fs.readFileSync(path.join(PINNED, "README.md"), "utf8"));
  assert.equal(digests.get("schema.json"), SCHEMA_SHA256);
  assert.equal(sha256File(path.join(PINNED, "schema.json")), SCHEMA_SHA256);
  const contractFiles = listFiles(PINNED).filter((file) => file !== "README.md" && file !== "fixtures/index.json");
  assert.deepEqual([...digests.keys()].sort(), contractFiles, "every pinned contract file has exactly one README digest");
  for (const [file, hash] of digests) assert.equal(sha256File(path.join(PINNED, file)), hash, file);
});

// The pin covers the executable contract only: schema.json and fixtures/**.
// README.md is refreshed by copy but never hashed, so a prose-only change on
// mobile never fails this repository (decision D-2026-09-29-24, as D-20 F2).
function pinnedContractFiles(root) {
  return listFiles(root).filter((file) => file === "schema.json" || file.startsWith("fixtures/"));
}

test("the pinned copy is byte-identical to the canonical mobile contract (schema.json and fixtures only)", () => {
  const canonical = canonicalDirectory();
  if (!fs.existsSync(path.join(canonical, "schema.json"))) {
    assert.fail(`Canonical device-performance contract not found at ${canonical}. Check out PoseTek-mobile-app beside `
      + "this repository or set POSETEK_MOBILE_REPO. The pinned copy cannot be verified without it, so this test fails rather than skips.");
  }
  const pinned = pinnedContractFiles(PINNED);
  assert.ok(pinned.includes("schema.json") && pinned.some((file) => file.startsWith("fixtures/")), "the pin covers the schema and fixtures");
  assert.ok(!pinned.includes("README.md"), "README.md is never hashed");
  assert.deepEqual(pinned, pinnedContractFiles(canonical), "the pinned and canonical directories hold the same schema and fixtures");
  for (const file of pinned) {
    assert.equal(sha256File(path.join(PINNED, file)), sha256File(path.join(canonical, file)), `${file} differs from the canonical copy`);
  }
});

test("every fixture meets its manifest expectation through the ingestion validator", () => {
  const manifest = fixture("index.json");
  const onDisk = listFiles(path.join(PINNED, "fixtures")).filter((file) => file !== "index.json");
  assert.deepEqual(manifest.fixtures.map((entry) => entry.file).sort(), onDisk, "the manifest lists every fixture");
  for (const entry of manifest.fixtures) {
    const doc = fixture(entry.file);
    const valid = entry.expect === "valid";
    if (!valid) assert.ok(INVALID_FIXTURES[entry.file], `${entry.file} has an expected error code and rule`);
    if (entry.target === "#") {
      const result = contract.validateRecord(doc);
      assert.equal(result.ok, valid, `${entry.file}: ${result.errors.join("; ")}`);
      // A semantic-only fixture is schema-valid; only the README rule rejects it.
      assert.equal(contract.validateSchema("#", doc).valid, entry.check === "semantic" || valid, `${entry.file} schema check`);
      if (valid) {
        assert.equal(result.digest, crypto.createHash("sha256").update(contract.canonicalJson(doc), "utf8").digest("hex"));
      } else {
        assert.equal(result.outcome.errorCode, INVALID_FIXTURES[entry.file][0], entry.file);
        assert.equal(result.outcome.status, "rejected", entry.file);
        assert.equal(result.outcome.retryable, false, entry.file);
        assertFailingRule(entry.file, result.errors);
      }
    } else if (entry.target === "#/$defs/batchV1") {
      const shape = contract.validateSchema(entry.target, doc);
      assert.equal(shape.valid, valid, `${entry.file} schema check`);
      if (valid) {
        const batch = contract.inspectBatch(doc);
        for (const record of batch.records) assert.ok(contract.validateRecord(record).ok, entry.file);
      } else {
        assertFailingRule(entry.file, shape.errors);
        assert.throws(() => contract.inspectBatch(doc), (error) => error instanceof contract.BatchError
          && error.errorCode === INVALID_FIXTURES[entry.file][0] && /at most 16 records/.test(error.message));
      }
    } else {
      assert.fail(`${entry.file}: unknown target ${entry.target}`);
    }
  }
});

test("production ingestion refuses the evaluation-origin fixture and admits every field fixture", () => {
  const manifest = fixture("index.json");
  const records = manifest.fixtures.filter((entry) => entry.expect === "valid" && entry.target === "#");
  assert.ok(records.some((entry) => fixture(entry.file).origin === "evaluation"));
  for (const entry of records) {
    const doc = fixture(entry.file);
    const result = contract.checkIngestible(doc);
    if (doc.origin === "field") {
      assert.equal(result.ok, true, entry.file);
    } else {
      assert.equal(result.ok, false, entry.file);
      assert.deepEqual(result.outcome, { status: "rejected", retryable: false, errorCode: "evaluationOriginRejected" });
    }
  }
});

test("the module's vocabulary and limits are the pinned schema's", () => {
  const { schema } = contract;
  const item = schema.$defs.ingestResponseV1.properties.results.items.properties;
  assert.deepEqual([...contract.ERROR_CODES].sort(), item.errorCode.enum.filter((code) => code !== null).sort());
  assert.deepEqual([...contract.STATUSES].sort(), [...item.status.enum].sort());
  assert.deepEqual([...contract.RECORD_KINDS], schema.$defs.recordV1.properties.recordKind.enum);
  assert.deepEqual(Object.keys(contract.OUTCOME_FOR_CODE).sort(), [...contract.ERROR_CODES].sort());
  for (const [code, [status]] of Object.entries(contract.OUTCOME_FOR_CODE)) assert.ok(contract.STATUSES.includes(status), code);
  const outcomes = schema.$defs.outcomeV1.enum;
  assert.ok(contract.TERMINAL_RUN_OUTCOMES.every((value) => outcomes.includes(value)));
  assert.deepEqual(outcomes.filter((value) => !contract.TERMINAL_RUN_OUTCOMES.includes(value)), ["interruptedUnknown"]);
  assert.equal(schema["x-maxEncodedBytes"], contract.LIMITS.recordBytes);
  assert.equal(schema.$defs.batchV1["x-maxEncodedBytes"], contract.LIMITS.batchBytes);
  assert.equal(schema.$defs.batchV1.properties.records.maxItems, contract.LIMITS.batchRecords);
  assert.equal(schema.$defs.runSummaryBodyV1.properties.stages.maxItems, contract.LIMITS.stageSummaries);
  assert.equal(schema.$defs.attemptSummaryBodyV1.properties.stages.maxItems, contract.LIMITS.stageSummaries);
  assert.equal(schema.$defs.runSummaryBodyV1.properties.passIds.maxItems, contract.LIMITS.passIds);
  assert.deepEqual(Object.values(contract.ROOTS),
    ["devicePerformanceAttempts", "devicePerformanceRuns", "devicePerformanceUploadGroups", "devicePerformanceTransfers", "devicePerformanceDevices"]);
});

test("canonical JSON follows RFC 8785", () => {
  // RFC 8785 §3.2.3: property names sort by UTF-16 code units.
  const names = {
    "€": "Euro Sign", "\r": "Carriage Return", "דּ": "Hebrew Letter Dalet With Dagesh", "1": "One",
    "😀": "Emoji: Grinning Face", "\u0080": "Control", "ö": "Latin Small Letter O With Diaeresis",
  };
  const order = ["\r", "1", "\u0080", "ö", "€", "😀", "דּ"];
  assert.equal(contract.canonicalJson(names), `{${order.map((key) => `${JSON.stringify(key)}:${JSON.stringify(names[key])}`).join(",")}}`);
  // ECMAScript number serialization (RFC 8785 §3.2.2.3).
  assert.equal(contract.canonicalJson([1.0, -0, 1e21, 1e-7, 0.000001, 333333333.3333333, 5e-324, 4.5, 2147483647]),
    "[1,0,1e+21,1e-7,0.000001,333333333.3333333,5e-324,4.5,2147483647]");
  assert.equal(contract.canonicalJson("\u0000\u001f\"\\/ é"), "\"\\u0000\\u001f\\\"\\\\/ é\"");
  assert.equal(contract.canonicalJson({ b: [{ d: 1, c: 2 }], a: null, e: true }), "{\"a\":null,\"b\":[{\"c\":2,\"d\":1}],\"e\":true}");
  for (const bad of [NaN, Infinity, -Infinity, "\ud800", { "\udc00": 1 }, undefined, new Date(0), () => 1, [undefined]]) {
    assert.throws(() => contract.canonicalJson(bad), contract.ContractError);
  }
  let deep = 1;
  for (let depth = 0; depth < 40; depth++) deep = [deep];
  assert.throws(() => contract.canonicalJson(deep), /nesting/);
});

test("the digest is the SHA-256 of the canonical form, independent of key order", () => {
  const record = fixture("run-summary.valid.json");
  const reversed = JSON.parse(JSON.stringify(record, (key, value) => (contract.isPlainObject(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value)));
  assert.notEqual(JSON.stringify(reversed), JSON.stringify(record));
  assert.equal(contract.digest(reversed), contract.digest(record));
  assert.equal(contract.digest(record), crypto.createHash("sha256").update(Buffer.from(contract.canonicalJson(record), "utf8")).digest("hex"));
  assert.notEqual(contract.digest({ ...record, revision: 2 }), contract.digest(record));
  assert.equal(contract.encodedBytes(record), Buffer.byteLength(contract.canonicalJson(record), "utf8"));
});

test("the schema interpreter refuses to load a schema it cannot fully enforce", () => {
  assert.throws(() => contract.createSchemaValidator({ type: "object", patternProperties: {} }), /Unimplemented schema keyword patternProperties/);
  assert.throws(() => contract.createSchemaValidator({ $ref: "#/$defs/missing" }), /Unresolvable \$ref/);
  assert.throws(() => contract.createSchemaValidator({ $ref: "https://example.test/schema.json" }), /Unsupported \$ref/);
  assert.throws(() => contract.createSchemaValidator({ type: "float" }), /Unknown type/);
  assert.throws(() => contract.createSchemaValidator({ properties: { a: { format: "uuid" } } }), /Unimplemented schema keyword format/);
});

// Mutations of valid fixtures and the error each must produce.
const run = () => fixture("run-summary.valid.json");
const stage = (overrides = {}) => ({
  stageId: "a", parentStageId: null, passId: null, status: "completed", invocationCount: 0, elapsedMs: null, activeMs: null,
  continuousElapsedMs: null, timingKind: "mainPhase", framesDecoded: null, modelCalls: null, missingObservations: null,
  failureCode: null, failureLayer: null, lastDurableStage: null, ...overrides,
});
const REJECTIONS = [
  ["an unknown future schema version", (r) => { r.performanceSchemaVersion = 2; }, "unsupportedVersion"],
  ["a string schema version", (r) => { r.performanceSchemaVersion = "1"; }, "invalidSchema"],
  ["schema version zero", (r) => { r.performanceSchemaVersion = 0; }, "invalidSchema"],
  ["a missing envelope field", (r) => { delete r.clockQuality; }, "invalidSchema"],
  ["a missing nullable envelope field", (r) => { delete r.retryOfRunId; }, "invalidSchema"],
  ["a missing body field", (r) => { delete r.body.totals; }, "invalidSchema"],
  ["an unknown record kind", (r) => { r.recordKind = "sessionSummary"; }, "invalidSchema"],
  ["a wrong drill enum", (r) => { r.drillType = "hockey"; }, "invalidSchema"],
  ["a wrong outcome enum", (r) => { r.body.outcome = "success"; }, "invalidSchema"],
  ["a wrong clock-quality enum", (r) => { r.clockQuality = "good"; }, "invalidSchema"],
  ["a negative duration", (r) => { r.body.totals.processingMs = -1; }, "invalidSchema"],
  ["a negative count", (r) => { r.body.stages[0].invocationCount = -1; }, "invalidSchema"],
  ["a NaN duration", (r) => { r.body.totals.processingMs = NaN; }, "invalidSchema"],
  ["an infinite duration", (r) => { r.body.totals.processingMs = Infinity; }, "invalidSchema"],
  ["a fractional count", (r) => { r.body.totals.framesDecoded = 1.5; }, "invalidSchema"],
  ["revision zero", (r) => { r.revision = 0; }, "invalidSchema"],
  ["nine pass ids", (r) => { r.body.passIds = Array.from({ length: 9 }, (_, i) => `pass${i}`); }, "invalidSchema"],
  ["repeated pass ids", (r) => { r.body.passIds = ["kick.extract", "kick.extract"]; }, "invalidSchema"],
  ["a lowercase launch id", (r) => { r.originLaunchId = r.originLaunchId.toLowerCase(); }, "invalidSchema"],
  ["an uppercase attempt id", (r) => { r.attemptId = r.attemptId.toUpperCase(); }, "invalidSchema"],
  ["a timestamp with an offset", (r) => { r.occurredAtClient = "2026-09-29T08:16:02.887+00:00"; }, "invalidSchema"],
  ["a server-assigned field", (r) => { r.firstReceivedAtServer = "2026-09-29T08:16:02.887Z"; }, "invalidSchema"],
  ["a client digest", (r) => { r.digest = "a".repeat(64); }, "invalidSchema"],
  ["an email key", (r) => { r.email = "coach@example.test"; }, "invalidSchema"],
  ["an unknown body key", (r) => { r.body.downloadUrl = "x"; }, "invalidSchema"],
  ["a signed URL in a free-text field", (r) => { r.executorPlatform.osVersion = "https://storage.googleapis.com/b/o?X-Goog-Signature=abc"; }, "invalidSchema"],
  ["a bare URL in a free-text field", (r) => { r.originPlatform.sourceRevision = "gs://kickai-69dd0/player/video.mov"; }, "invalidSchema"],
  ["an email address in a free-text field", (r) => { r.executorPlatform.machine = "coach@example.test"; }, "invalidSchema"],
  ["a missing reason at a present value", (r) => { r.missingReasons = [{ field: "/totals/processingMs", reason: "crossLaunch" }]; }, "invalidSchema"],
  ["a missing reason at an absent value", (r) => { r.missingReasons = [{ field: "/totals/notAField", reason: "crossLaunch" }]; }, "invalidSchema"],
  ["a missing reason past an array end", (r) => { r.missingReasons = [{ field: "/stages/40/elapsedMs", reason: "truncated" }]; }, "invalidSchema"],
  ["a nested operation without a parent", (r) => { r.body.stages[5].parentStageId = null; }, "invalidSchema"],
  ["evaluation origin without a run id", (r) => { r.origin = "evaluation"; }, "invalidSchema"],
  ["a run summary without a policy", (r) => { r.policyVersion = null; }, "invalidSchema"],
  ["a recordId that is not the run id", (r) => { r.recordId = r.attemptId; }, "identityMismatch"],
  ["49 stage summaries", (r) => { r.body.stages = Array.from({ length: 49 }, () => stage()); r.originPlatform = null; r.executorPlatform = null; }, null],
];

test("the validator's failure matrix: each defect has one typed, itemized error", () => {
  for (const [label, mutate, code] of REJECTIONS) {
    const record = run();
    mutate(record);
    const result = contract.validateRecord(record);
    assert.equal(result.ok, false, label);
    if (code === null) {
      // 49 minimal stages sit at the 16 KiB boundary: rejected permanently either way.
      assert.ok(["invalidSchema", "oversizedRecord"].includes(result.outcome.errorCode), label);
      continue;
    }
    assert.equal(result.outcome.errorCode, code, `${label}: ${result.errors.join("; ")}`);
    assert.equal(result.outcome.retryable, code === "unsupportedVersion", label);
    assert.equal(result.outcome.status, code === "unsupportedVersion" ? "retryLater" : "rejected", label);
  }
  // The stage and pass-id bounds are schema rules, independent of encoded size.
  const body = run().body;
  body.stages = Array.from({ length: 49 }, () => stage());
  assert.match(contract.validateSchema("#/$defs/runSummaryBodyV1", body).errors.join(";"), /more than 48 items/);
  body.stages = Array.from({ length: 48 }, () => stage());
  assert.equal(contract.validateSchema("#/$defs/runSummaryBodyV1", body).valid, true);
  for (const bad of [null, [], "record", 7]) assert.equal(contract.validateRecord(bad).outcome.errorCode, "invalidSchema");
});

test("records over 16 KiB are oversized; a whole-record missing reason is allowed", () => {
  const record = run();
  record.body.stages = Array.from({ length: 48 }, (_, i) => stage({ stageId: `s${i}${"x".repeat(90)}`, lastDurableStage: `s${i}${"y".repeat(90)}` }));
  const oversized = contract.validateRecord(record);
  assert.ok(contract.encodedBytes(record) > contract.LIMITS.recordBytes);
  assert.deepEqual(oversized.outcome, { status: "rejected", retryable: false, errorCode: "oversizedRecord" });
  assert.ok(oversized.digest, "an oversized record still has a digest for correlation");
  const whole = run();
  whole.missingReasons = [{ field: "", reason: "droppedOnSaturation" }];
  whole.completeness = "partial";
  assert.equal(contract.validateRecord(whole).ok, true);
});

test("upload-group ids split on their first two separators (v1.2, R4-2)", () => {
  const install = "b7e2c1d4-5f6a-4b8c-9d0e-1f2a3b4c5d6e";
  assert.deepEqual(contract.groupParts(`${install}:resultFiles`), { owner: install, category: "resultFiles", install: null });
  assert.deepEqual(contract.groupParts(`system:diagnostics:${install}`), { owner: "system", category: "diagnostics", install });
});

test("derived identities must name the record's own attempt, install and account (v1.2)", () => {
  const group = fixture("upload-group-summary.valid.json");
  const other = "00000000-0000-4000-8000-000000000000";
  group.recordId = group.body.groupId = `${other}:resultFiles`;
  assert.equal(contract.validateRecord(group).outcome.errorCode, "identityMismatch");
  const category = fixture("upload-group-summary.valid.json");
  category.body.category = "optionalVideo";
  assert.equal(contract.validateRecord(category).outcome.errorCode, "identityMismatch");
  const divergent = fixture("upload-group-summary.valid.json");
  divergent.body.groupId = divergent.recordId.replace("resultFiles", "optionalVideo");
  divergent.body.category = "optionalVideo";
  assert.deepEqual(contract.validateRecord(divergent).errors, ["$.recordId: does not equal the uploadGroupSummary entity id", "$.body.groupId: differs from recordId"]);
  // System groups: system:<category>:<originInstallId>, no attempt (D-21).
  const system = fixture("upload-group-summary-system.valid.json");
  assert.equal(contract.validateRecord(system).ok, true);
  assert.equal(contract.validateRecord({ ...system, originInstallId: other }).outcome.errorCode, "identityMismatch", "the id names another install");
  assert.equal(contract.validateRecord({ ...system, body: { ...system.body, category: "resultFiles" } }).outcome.errorCode, "identityMismatch");
  assert.equal(contract.validateRecord({ ...system, attemptId: other }).outcome.errorCode, "invalidSchema", "a system group has no attempt");
  const legacy = fixture("upload-group-summary-system.valid.json");
  legacy.recordId = legacy.body.groupId = "system:diagnostics";
  assert.equal(contract.validateRecord(legacy).outcome.errorCode, "invalidSchema", "the v1.1 system id is no longer accepted");
  const attemptless = fixture("upload-group-summary.valid.json");
  attemptless.attemptId = null;
  assert.equal(contract.validateRecord(attemptless).outcome.errorCode, "invalidSchema", "an attempt group requires its attempt");
  // A system transfer: its group and logical object name no attempt.
  const install = system.originInstallId;
  const systemTransfer = fixture("transfer-invocation.valid.json");
  Object.assign(systemTransfer, { attemptId: null });
  systemTransfer.body = { ...systemTransfer.body, groupId: `system:diagnostics:${install}`, objectRole: "diagnosticArtifact",
    logicalObjectId: systemTransfer.body.logicalObjectId.replace(systemTransfer.body.logicalObjectId.split("/")[0], "system") };
  assert.equal(contract.validateRecord(systemTransfer).ok, true, contract.validateRecord(systemTransfer).errors.join("; "));
  assert.equal(contract.validateRecord({ ...systemTransfer, attemptId: fixture("transfer-invocation.valid.json").attemptId }).outcome.errorCode, "identityMismatch");
  // v1.2.2 (D-36): a system transfer's group names the record's own install; a null install never matches.
  const canonicalSystemTransfer = fixture("transfer-invocation-system.valid.json");
  assert.equal(contract.validateRecord(canonicalSystemTransfer).ok, true);
  assert.equal(contract.groupParts(canonicalSystemTransfer.body.groupId).install, canonicalSystemTransfer.originInstallId);
  for (const originInstallId of [other, null]) {
    const result = contract.validateRecord({ ...canonicalSystemTransfer, originInstallId });
    assert.deepEqual([result.outcome?.errorCode, result.errors], ["identityMismatch", ["$.body.groupId: names a different install"]], String(originInstallId));
  }
  // Device status: <executorInstallId>:<originReporterUid> (D-18).
  const status = fixture("device-status.valid.json");
  assert.equal(status.recordId, `${status.executorInstallId}:${status.originReporterUid}`);
  assert.equal(contract.validateRecord({ ...status, originReporterUid: "someoneElse" }).outcome.errorCode, "identityMismatch");
  assert.equal(contract.validateRecord({ ...status, recordId: status.executorInstallId }).outcome.errorCode, "invalidSchema", "the v1.1 install-only id");
  const longUid = "u".repeat(92);
  assert.equal(contract.validateRecord({ ...status, originReporterUid: longUid, recordId: `${status.executorInstallId}:${longUid}` }).outcome.errorCode, "invalidSchema");
  const transfer = fixture("transfer-invocation.valid.json");
  transfer.body.logicalObjectId = transfer.body.logicalObjectId.replace(transfer.attemptId, other);
  assert.equal(contract.validateRecord(transfer).outcome.errorCode, "identityMismatch");
  const transferGroup = fixture("transfer-invocation.valid.json");
  transferGroup.body.groupId = `${other}:resultFiles`;
  assert.equal(contract.validateRecord(transferGroup).outcome.errorCode, "identityMismatch");
  const invocation = fixture("transfer-invocation.valid.json");
  invocation.recordId = other;
  assert.equal(contract.validateRecord(invocation).outcome.errorCode, "identityMismatch");
  const attempt = fixture("attempt-summary.valid.json");
  attempt.recordId = other;
  assert.equal(contract.validateRecord(attempt).outcome.errorCode, "identityMismatch");
});

test("batch envelopes: itemizable or refused without rejecting any record", () => {
  const valid = fixture("batch.valid.json");
  assert.equal(contract.inspectBatch(valid).unsupportedVersion, false);
  const canonical = valid.records.map((record) => contract.canonicalJson(record));
  assert.equal(contract.batchEncodedBytes(valid.batchId, valid.records, canonical), contract.encodedBytes(valid));
  assert.equal(contract.batchEncodedBytes(valid.batchId, valid.records, [null, canonical[1]]), contract.encodedBytes(valid));
  const refused = [
    [null, "invalidSchema"], [[], "invalidSchema"], [{ ...valid, batchId: valid.batchId.toUpperCase() }, "invalidSchema"],
    [{ ...valid, batchId: undefined }, "invalidSchema"], [{ ...valid, records: [] }, "invalidSchema"],
    [{ ...valid, records: {} }, "invalidSchema"], [{ ...valid, extra: true }, "invalidSchema"],
    [{ ...valid, performanceSchemaVersion: "1" }, "invalidSchema"], [{ ...valid, performanceSchemaVersion: 0 }, "invalidSchema"],
    [{ ...valid, records: Array.from({ length: 17 }, () => valid.records[0]) }, "oversizedBatch"],
  ];
  for (const [batch, code] of refused) {
    assert.throws(() => contract.inspectBatch(batch), (error) => error instanceof contract.BatchError && error.errorCode === code);
  }
  assert.equal(contract.inspectBatch({ ...valid, performanceSchemaVersion: 2, future: true }).unsupportedVersion, true);
});

test("refusal messages carry client-chosen key names only as hashes", () => {
  const secretKey = "athleteJaneDoePhone5551234";
  const record = run();
  record[secretKey] = null;
  record.body.userName = null;
  const result = contract.validateRecord(record);
  assert.equal(result.outcome.errorCode, "invalidSchema");
  const text = result.errors.join("\n");
  assert.doesNotMatch(text, /JaneDoe|5551234|userName/);
  assert.match(text, new RegExp(`unexpected property ${contract.clientKey(secretKey)}`));
  assert.match(text, new RegExp(`unexpected property ${contract.clientKey("userName")}`));
  assert.match(contract.clientKey(secretKey), /^#[0-9a-f]{12}$/);
});

test("JSON Pointer lookup into body", () => {
  const body = { spans: { a: null }, stages: [{ elapsedMs: null }, { elapsedMs: 3 }] };
  assert.equal(contract.pointerGet(body, "/spans/a"), null);
  assert.equal(contract.pointerGet(body, "/stages/1/elapsedMs"), 3);
  assert.equal(typeof contract.pointerGet(body, "/stages/2/elapsedMs"), "symbol");
  assert.equal(typeof contract.pointerGet(body, "/spans/a/deeper"), "symbol");
  assert.equal(typeof contract.pointerGet(body, "/constructor"), "symbol");
});
