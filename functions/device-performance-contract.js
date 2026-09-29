"use strict";

// Device performance schema V1 (plan 07 §4; PROCESSING_PERF_CONTRACTS_V1 §8).
//
// contracts/device-performance-v1/ is a pinned, byte-identical copy of the
// canonical mobile contract (device-performance-contract.test.js compares the
// hashes). The pinned schema.json is the executable source of truth: records are
// validated by interpreting it, not by a hand-copied field list. This module
// adds only the rules JSON Schema cannot express: RFC 8785 encoded size,
// attributable missing values, entity identity, forbidden content, and the
// production ban on evaluation traffic.
//
// No dependency: `ajv` is not a functions dependency, so a small interpreter
// covers exactly the keywords the pinned schema uses and refuses to load a
// schema that uses any other keyword (it can never silently skip a rule).

const crypto = require("node:crypto");
const schema = require("./contracts/device-performance-v1/schema.json");

const PERFORMANCE_SCHEMA_VERSION = 1;
const LIMITS = Object.freeze({
  recordBytes: 16384, batchBytes: 131072, batchRecords: 16, stageSummaries: 48, passIds: 8,
  missingReasons: 16, recordIdLength: 128, maxRevision: 2147483647, maxDepth: 32,
});
const RECORD_KINDS = Object.freeze(["attemptSummary", "runSummary", "uploadGroupSummary", "transferInvocation", "deviceStatus"]);
// Server-only roots (contract §8.10). Document id is `${recordKind}:${recordId}`.
const ROOTS = Object.freeze({
  attemptSummary: "devicePerformanceAttempts",
  runSummary: "devicePerformanceRuns",
  uploadGroupSummary: "devicePerformanceUploadGroups",
  transferInvocation: "devicePerformanceTransfers",
  deviceStatus: "devicePerformanceDevices",
});
// Contract §8.7 / schema $defs/ingestResponseV1.
const STATUSES = Object.freeze(["accepted", "duplicate", "superseded", "conflict", "rejected", "retryLater"]);
const ERROR_CODES = Object.freeze([
  "invalidSchema", "unsupportedVersion", "oversizedRecord", "oversizedBatch", "evaluationOriginRejected",
  "unauthorizedReporter", "identityMismatch", "dependencyPending", "revisionConflict", "staleRevision",
  "illegalTransition", "rateLimited", "internal", "attemptCapExceeded",
]);
// Each error code has exactly one status and retryability. Retryable codes are
// kept pending by the client (bounded by its spool); the rest are final.
const OUTCOME_FOR_CODE = Object.freeze({
  invalidSchema: ["rejected", false],
  oversizedRecord: ["rejected", false],
  evaluationOriginRejected: ["rejected", false],
  unauthorizedReporter: ["rejected", false],
  identityMismatch: ["rejected", false],
  illegalTransition: ["rejected", false],
  // A new run or transfer beyond its attempt's cap (contract §8.5, §8.7, v1.2.2).
  attemptCapExceeded: ["rejected", false],
  revisionConflict: ["conflict", false],
  staleRevision: ["superseded", false],
  unsupportedVersion: ["retryLater", true],
  oversizedBatch: ["retryLater", true],
  dependencyPending: ["retryLater", true],
  rateLimited: ["retryLater", true],
  internal: ["retryLater", true],
});
// Run outcomes fixed at run end (contract §8.3). interruptedUnknown is not one.
const TERMINAL_RUN_OUTCOMES = Object.freeze(["valid", "partial", "noMeasurement", "failed", "cancelled"]);

class ContractError extends Error {}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function codePointLength(text) {
  let length = 0;
  for (const _ of text) length++;
  return length;
}

// RFC 8785 (JCS) canonical JSON: object keys sorted by UTF-16 code units, no
// whitespace, ECMAScript number and string serialization. Values JCS cannot
// represent (non-finite numbers, lone surrogates, non-JSON types) throw.
function canonicalJson(value) {
  return serialize(value, 0);
}
function serialize(value, depth) {
  if (depth > LIMITS.maxDepth) throw new ContractError(`nesting deeper than ${LIMITS.maxDepth}`);
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ContractError("non-finite number");
    return JSON.stringify(value); // Number::toString; -0 serializes as 0.
  }
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new ContractError("string contains a lone surrogate");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (let index = 0; index < value.length; index++) parts.push(serialize(value[index], depth + 1));
    return `[${parts.join(",")}]`;
  }
  if (isPlainObject(value)) {
    const members = Object.keys(value).sort().map((key) => {
      if (!key.isWellFormed()) throw new ContractError("key contains a lone surrogate");
      return `${JSON.stringify(key)}:${serialize(value[key], depth + 1)}`;
    });
    return `{${members.join(",")}}`;
  }
  throw new ContractError("value is not JSON");
}
function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
// Refusal messages reach logs; a client-chosen key name appears only as a hash.
function clientKey(key) {
  return `#${sha256Hex(key).slice(0, 12)}`;
}
// SHA-256 of the UTF-8 RFC 8785 canonical JSON (contract §8.6).
function digest(value) {
  return sha256Hex(canonicalJson(value));
}
function encodedBytes(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function jsonEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// JSON Schema 2020-12 interpreter for the keyword subset the pinned schema uses.

const SCHEMA_ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description", "x-posetekContract"]);
const SCHEMA_KEYWORDS = new Set([
  "$ref", "type", "enum", "const", "properties", "required", "additionalProperties", "items",
  "minItems", "maxItems", "uniqueItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "pattern", "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
  "x-maxEncodedBytes",
]);
const TYPE_NAMES = new Set(["null", "boolean", "object", "array", "string", "number", "integer"]);
const MAX_REPORTED_ERRORS = 20;

function typeMatches(instance, type) {
  switch (type) {
    case "null": return instance === null;
    case "boolean": return typeof instance === "boolean";
    case "object": return isPlainObject(instance);
    case "array": return Array.isArray(instance);
    case "string": return typeof instance === "string";
    case "number": return typeof instance === "number" && Number.isFinite(instance);
    case "integer": return Number.isInteger(instance);
    default: return false;
  }
}

function createSchemaValidator(root) {
  const patterns = new Map();
  function resolve(ref) {
    if (typeof ref !== "string" || !ref.startsWith("#")) throw new Error(`Unsupported $ref ${ref}`);
    let node = root;
    for (const raw of ref.slice(1).split("/").slice(1)) {
      const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) throw new Error(`Unresolvable $ref ${ref}`);
      node = node[part];
    }
    return node;
  }
  // Fail closed at load: every keyword is implemented, every $ref resolves and
  // every pattern compiles as an ECMA-262 (unicode) regular expression.
  function prepare(node, where) {
    if (typeof node === "boolean") return;
    if (!isPlainObject(node)) throw new Error(`Schema at ${where} is not an object`);
    for (const key of Object.keys(node)) {
      if (!SCHEMA_KEYWORDS.has(key) && !SCHEMA_ANNOTATIONS.has(key)) throw new Error(`Unimplemented schema keyword ${key} at ${where}`);
    }
    for (const type of [].concat(node.type ?? [])) if (!TYPE_NAMES.has(type)) throw new Error(`Unknown type ${type} at ${where}`);
    if (node.pattern !== undefined && !patterns.has(node.pattern)) patterns.set(node.pattern, new RegExp(node.pattern, "u"));
    if (node.$ref !== undefined) resolve(node.$ref);
    for (const group of ["properties", "$defs"]) {
      for (const [name, child] of Object.entries(node[group] ?? {})) prepare(child, `${where}/${group}/${name}`);
    }
    for (const key of ["items", "not", "if", "then", "else", "additionalProperties"]) {
      if (node[key] !== undefined) prepare(node[key], `${where}/${key}`);
    }
    for (const key of ["allOf", "anyOf", "oneOf"]) (node[key] ?? []).forEach((child, index) => prepare(child, `${where}/${key}/${index}`));
  }
  prepare(root, "#");

  function check(instance, node, path, errors) {
    if (node === true) return true;
    let ok = true;
    const fail = (message) => {
      ok = false;
      if (errors.length < MAX_REPORTED_ERRORS) errors.push(`${path}: ${message}`);
    };
    if (node === false) { fail("no value is allowed"); return false; }
    if (node.$ref !== undefined && !check(instance, resolve(node.$ref), path, errors)) ok = false;
    if (node.type !== undefined) {
      const types = [].concat(node.type);
      if (!types.some((type) => typeMatches(instance, type))) fail(`type is not ${types.join("|")}`);
    }
    if (node.enum !== undefined && !node.enum.some((candidate) => jsonEqual(candidate, instance))) fail("value is not in the enum");
    if (Object.hasOwn(node, "const") && !jsonEqual(node.const, instance)) fail("value differs from const");
    if (typeof instance === "number") {
      if (node.minimum !== undefined && !(instance >= node.minimum)) fail(`below minimum ${node.minimum}`);
      if (node.maximum !== undefined && !(instance <= node.maximum)) fail(`above maximum ${node.maximum}`);
      if (node.exclusiveMinimum !== undefined && !(instance > node.exclusiveMinimum)) fail(`not above ${node.exclusiveMinimum}`);
      if (node.exclusiveMaximum !== undefined && !(instance < node.exclusiveMaximum)) fail(`not below ${node.exclusiveMaximum}`);
    }
    if (typeof instance === "string") {
      if (node.minLength !== undefined || node.maxLength !== undefined) {
        const length = codePointLength(instance);
        if (node.minLength !== undefined && length < node.minLength) fail(`shorter than ${node.minLength}`);
        if (node.maxLength !== undefined && length > node.maxLength) fail(`longer than ${node.maxLength}`);
      }
      if (node.pattern !== undefined && !patterns.get(node.pattern).test(instance)) fail("does not match the pattern");
    }
    if (Array.isArray(instance)) {
      if (node.minItems !== undefined && instance.length < node.minItems) fail(`fewer than ${node.minItems} items`);
      if (node.maxItems !== undefined && instance.length > node.maxItems) fail(`more than ${node.maxItems} items`);
      if (node.uniqueItems === true) {
        const seen = new Set();
        for (const item of instance) {
          let key;
          try { key = canonicalJson(item); } catch { fail("items are not JSON"); break; }
          if (seen.has(key)) { fail("items are not unique"); break; }
          seen.add(key);
        }
      }
      if (node.items !== undefined) {
        instance.forEach((item, index) => { if (!check(item, node.items, `${path}[${index}]`, errors)) ok = false; });
      }
    }
    if (isPlainObject(instance)) {
      for (const name of node.required ?? []) if (!Object.hasOwn(instance, name)) fail(`missing required ${name}`);
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        if (Object.hasOwn(instance, name) && !check(instance[name], child, `${path}.${name}`, errors)) ok = false;
      }
      if (node.additionalProperties !== undefined) {
        for (const key of Object.keys(instance)) {
          if (node.properties && Object.hasOwn(node.properties, key)) continue;
          if (node.additionalProperties === false) fail(`unexpected property ${clientKey(key)}`);
          else if (!check(instance[key], node.additionalProperties, `${path}.${clientKey(key)}`, errors)) ok = false;
        }
      }
    }
    for (const child of node.allOf ?? []) if (!check(instance, child, path, errors)) ok = false;
    if (node.anyOf !== undefined && !node.anyOf.some((child) => check(instance, child, path, []))) fail("matches no anyOf branch");
    if (node.oneOf !== undefined && node.oneOf.filter((child) => check(instance, child, path, [])).length !== 1) fail("does not match exactly one oneOf branch");
    if (node.not !== undefined && check(instance, node.not, path, [])) fail("matches a forbidden schema");
    if (node.if !== undefined) {
      const branch = check(instance, node.if, path, []) ? node.then : node.else;
      if (branch !== undefined && !check(instance, branch, path, errors)) ok = false;
    }
    if (node["x-maxEncodedBytes"] !== undefined) {
      let bytes = Infinity;
      try { bytes = encodedBytes(instance); } catch { /* reported as oversized below */ }
      if (bytes > node["x-maxEncodedBytes"]) fail(`canonical encoding exceeds ${node["x-maxEncodedBytes"]} bytes`);
    }
    return ok;
  }
  return {
    // pointer: "#" (one record), "#/$defs/batchV1", "#/$defs/ingestResponseV1", ...
    validate(pointer, instance) {
      const errors = [];
      const valid = check(instance, resolve(pointer), "$", errors);
      return { valid, errors };
    },
  };
}

const schemaValidator = createSchemaValidator(schema);
function validateSchema(pointer, instance) {
  return schemaValidator.validate(pointer, instance);
}

// ---------------------------------------------------------------------------
// Rules the README adds to JSON Schema.

const MISSING = Symbol("missing");
// JSON Pointer into body. "" (the whole record) is an unattributed reason and
// is not checked, as in the contract's reference validator.
function pointerGet(document, pointer) {
  let node = document;
  for (const part of pointer.split("/").slice(1)) {
    if (Array.isArray(node) && /^[0-9]+$/.test(part) && Number(part) < node.length) node = node[Number(part)];
    else if (isPlainObject(node) && Object.hasOwn(node, part)) node = node[part];
    else return MISSING;
  }
  return node;
}

// Reporting facts never carry URLs (signed or not), credentials or personal
// data (plan 07 §4). The schema's closed key sets already exclude such keys;
// these checks keep that true if a future schema opens a key set, and catch
// URLs or email addresses smuggled into free-text strings such as osVersion.
const FORBIDDEN_KEY = /^(e-?mail(address)?|phone(number)?|(first|last|full|display|user)?name|address|password|secret|(access|id|refresh|auth|upload)?token|credentials?|(signed|download|upload)?ur[il]|href)$/i;
const FORBIDDEN_TEXT = [
  /[a-z][a-z0-9+.-]*:\/\//i,
  /x-goog-(signature|credential|algorithm)|googleaccessid=|x-amz-(signature|credential)|[?&](token|sig|signature)=/i,
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
];
function forbiddenContent(value, path, errors, depth = 0) {
  if (depth > LIMITS.maxDepth || errors.length >= MAX_REPORTED_ERRORS) return;
  if (typeof value === "string") {
    if (FORBIDDEN_TEXT.some((pattern) => pattern.test(value))) errors.push(`${path}: looks like a URL, credential or email address`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenContent(item, `${path}[${index}]`, errors, depth + 1));
  } else if (isPlainObject(value)) {
    // Keys reaching here passed the closed schema; a forbidden one is still logged only as a hash.
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) errors.push(`${path}: forbidden key ${clientKey(key)}`);
      forbiddenContent(item, `${path}.${FORBIDDEN_KEY.test(key) ? clientKey(key) : key}`, errors, depth + 1);
    }
  }
}

// recordId must equal the entity id for its kind (contract §8.6, v1.2):
// - an upload group is <attemptId>:<category>, or system:<category>:<originInstallId>
//   for a group with no attempt (D-21);
// - a device status is <executorInstallId>:<originReporterUid>, one per install
//   and account (D-18).
function entityId(record) {
  switch (record.recordKind) {
    case "attemptSummary": return record.attemptId;
    case "runSummary": return record.processingRunId;
    case "uploadGroupSummary":
      return typeof record.recordId === "string" && record.recordId.startsWith("system:")
        ? `system:${record.body?.category}:${record.originInstallId}`
        : `${record.attemptId}:${record.body?.category}`;
    case "transferInvocation": return record.body?.invocationId;
    case "deviceStatus": return `${record.executorInstallId}:${record.originReporterUid}`;
    default: return undefined;
  }
}
// An upload-group id splits on its FIRST two separators (R4-2):
// <attemptId>:<category> or system:<category>:<originInstallId>.
function groupParts(groupId) {
  const first = groupId.indexOf(":");
  const owner = groupId.slice(0, first), rest = groupId.slice(first + 1);
  const second = rest.indexOf(":");
  return second === -1
    ? { owner, category: rest, install: null }
    : { owner, category: rest.slice(0, second), install: rest.slice(second + 1) };
}
// The attempt a fact names is the attempt that authorizes it, so the ids a
// fact derives from its attempt (groupId, logicalObjectId = <attemptId|system>/…)
// must name the same attempt. A system transfer's group names the record's own
// install instead; a null originInstallId never matches (§8.6, v1.2.2, D-36).
function identityErrors(record) {
  const errors = [];
  if (record.recordId !== entityId(record)) errors.push(`$.recordId: does not equal the ${record.recordKind} entity id`);
  const owner = record.attemptId ?? "system";
  if (record.recordKind === "uploadGroupSummary" && record.body.groupId !== record.recordId) {
    errors.push("$.body.groupId: differs from recordId");
  }
  if (record.recordKind === "transferInvocation") {
    const group = groupParts(record.body.groupId);
    if (group.owner !== owner) errors.push("$.body.groupId: names a different attempt");
    else if (owner === "system" && (record.originInstallId === null || group.install !== record.originInstallId)) {
      errors.push("$.body.groupId: names a different install");
    }
    if (record.body.logicalObjectId.split("/")[0] !== owner) errors.push("$.body.logicalObjectId: names a different attempt");
  }
  return errors;
}

function semanticErrors(record) {
  const errors = [];
  record.missingReasons.forEach((entry, index) => {
    if (entry.field === "") return;
    const value = pointerGet(record.body, entry.field);
    if (value === MISSING) errors.push(`$.missingReasons[${index}]: points at an absent value`);
    else if (value !== null) errors.push(`$.missingReasons[${index}]: points at a present value`);
  });
  forbiddenContent(record, "$", errors);
  return errors;
}

// ---------------------------------------------------------------------------
// Record and batch evaluation.

// Identity fields echoed in a response item, only when they are well formed.
function echoIdentity(record) {
  const kind = isPlainObject(record) && RECORD_KINDS.includes(record.recordKind) ? record.recordKind : null;
  const id = isPlainObject(record) && typeof record.recordId === "string" && record.recordId.length > 0
    && codePointLength(record.recordId) <= LIMITS.recordIdLength ? record.recordId : null;
  const revision = isPlainObject(record) && Number.isSafeInteger(record.revision) && record.revision >= 1
    && record.revision <= LIMITS.maxRevision ? record.revision : null;
  return { recordKind: kind, recordId: id, revision };
}

function outcome(errorCode) {
  const [status, retryable] = OUTCOME_FOR_CODE[errorCode];
  return { status, retryable, errorCode };
}

// Contract validation of one record: canonical form, version, size, schema,
// README semantic rules and identity. `ok` records are contract-valid; that
// includes evaluation-origin records, which only production ingestion refuses
// (see checkIngestible).
function validateRecord(record) {
  const result = { ok: false, ...echoIdentity(record), canonical: null, bytes: null, digest: null, outcome: null, errors: [] };
  const refuse = (errorCode, errors = []) => ({ ...result, outcome: outcome(errorCode), errors });
  if (!isPlainObject(record)) return refuse("invalidSchema", ["$: record is not an object"]);
  try {
    result.canonical = canonicalJson(record);
  } catch (error) {
    return refuse("invalidSchema", [`$: ${error.message}`]);
  }
  result.bytes = Buffer.byteLength(result.canonical, "utf8");
  result.digest = sha256Hex(result.canonical);
  // A newer schema version is kept pending by the client until the server
  // supports it (plan 07 §9); it is never silently dropped.
  const version = record.performanceSchemaVersion;
  if (Number.isSafeInteger(version) && version > PERFORMANCE_SCHEMA_VERSION) return refuse("unsupportedVersion");
  if (result.bytes > LIMITS.recordBytes) return refuse("oversizedRecord", [`$: ${result.bytes} bytes exceeds ${LIMITS.recordBytes}`]);
  const shape = validateSchema("#", record);
  if (!shape.valid) return refuse("invalidSchema", shape.errors);
  const semantic = semanticErrors(record);
  if (semantic.length) return refuse("invalidSchema", semantic);
  const identity = identityErrors(record);
  if (identity.length) return refuse("identityMismatch", identity);
  return { ...result, ok: true };
}

// Production ingestion additionally rejects evaluation traffic (contract §8.8):
// evaluation records never reach fleet totals, percentiles or rankings.
function checkIngestible(record) {
  const result = validateRecord(record);
  if (result.ok && record.origin !== "field") {
    return { ...result, ok: false, outcome: outcome("evaluationOriginRejected"), errors: ["$.origin: evaluation records are not ingested"] };
  }
  return result;
}

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BATCH_KEYS = ["performanceSchemaVersion", "batchId", "records"];

// Batch envelope ($defs/batchV1). Problems that make per-item results
// impossible (no batch id, no record array, more than 16 records, which the
// response cannot itemize) are thrown as a BatchError and reject no record: the
// client keeps every record pending. A newer batch version itemizes every
// record as unsupportedVersion.
class BatchError extends ContractError {
  constructor(errorCode, message) { super(message); this.errorCode = errorCode; }
}
function inspectBatch(data) {
  if (!isPlainObject(data)) throw new BatchError("invalidSchema", "The batch must be an object.");
  if (typeof data.batchId !== "string" || !UUID_LOWER.test(data.batchId)) throw new BatchError("invalidSchema", "The batch id must be a lowercase UUID.");
  if (!Array.isArray(data.records) || data.records.length < 1) throw new BatchError("invalidSchema", "The batch must contain at least one record.");
  if (data.records.length > LIMITS.batchRecords) throw new BatchError("oversizedBatch", `A batch holds at most ${LIMITS.batchRecords} records.`);
  const version = data.performanceSchemaVersion;
  if (Number.isSafeInteger(version) && version > PERFORMANCE_SCHEMA_VERSION) return { batchId: data.batchId, records: data.records, unsupportedVersion: true };
  if (version !== PERFORMANCE_SCHEMA_VERSION) throw new BatchError("invalidSchema", "Unsupported batch schema version.");
  const extra = Object.keys(data).filter((key) => !BATCH_KEYS.includes(key));
  if (extra.length) throw new BatchError("invalidSchema", "The batch has unexpected properties.");
  return { batchId: data.batchId, records: data.records, unsupportedVersion: false };
}
// UTF-8 bytes of the batch's RFC 8785 canonical JSON. A record that has no
// canonical form counts at its plain JSON length (or as unbounded).
function batchEncodedBytes(batchId, records, canonicalRecords) {
  let bytes = Buffer.byteLength(`{"batchId":${JSON.stringify(batchId)},"performanceSchemaVersion":1,"records":[]}`, "utf8");
  records.forEach((record, index) => {
    if (index > 0) bytes += 1;
    if (canonicalRecords[index] !== null) { bytes += Buffer.byteLength(canonicalRecords[index], "utf8"); return; }
    try { bytes += Buffer.byteLength(JSON.stringify(record) ?? "null", "utf8"); } catch { bytes = Infinity; }
  });
  return bytes;
}

function responseItem(index, evaluation, fields) {
  return {
    index,
    recordKind: evaluation.recordKind,
    recordId: evaluation.recordId,
    revision: evaluation.revision,
    status: fields.status,
    retryable: fields.retryable,
    acceptedRevision: fields.acceptedRevision ?? null,
    digest: evaluation.digest,
    errorCode: fields.errorCode ?? null,
  };
}

module.exports = {
  PERFORMANCE_SCHEMA_VERSION, LIMITS, RECORD_KINDS, ROOTS, STATUSES, ERROR_CODES, OUTCOME_FOR_CODE, TERMINAL_RUN_OUTCOMES,
  ContractError, BatchError, schema, isPlainObject, canonicalJson, digest, encodedBytes, jsonEqual, clientKey,
  createSchemaValidator, validateSchema, pointerGet, entityId, groupParts, validateRecord, checkIngestible, inspectBatch,
  batchEncodedBytes, outcome, responseItem,
};
