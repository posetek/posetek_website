"use strict";
// This is server-owned interpretation of retained evidence. It never replaces
// the original kind, actor, message, source ID or frozen delivery envelope.
const SOURCE = "posetek_server_issue_classifier";
const KINDS = ["error", "report", "crash", "interrupted", "diagnostic"];
const SUBTYPES = ["metrics", "diagnostics", "unknown"];
const SCOPES = ["automated_service", "account_reported", "unknown_actor"];
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const CALLABLE_OPERATIONS = new Set(["getSocialAdminDirectory", "getSocialContext", "getSocialFeed", "getSocialActivity",
  "saveSocialPreferences", "setSocialVisibility", "getSocialPeople", "socialConnection", "setSocialKudos",
  "getSocialComments", "saveSocialComment", "reportSocialActivity", "moderateSocialActivity", "getSocialMedia"]);
const CALLABLE_SOURCE = "posetek_callable_outcome";
const CALLABLE_FIELDS = ["schemaVersion", "source", "operation", "requestId", "code", "outcome", "errorCategory", "resourceType", "resourceFunction"].sort();
const REQUEST = /^[A-Za-z0-9_-]{1,160}$/;
const FAILURE_CODES = new Set(["cancelled", "unknown", "invalid-argument", "deadline-exceeded", "not-found", "already-exists", "permission-denied", "resource-exhausted", "failed-precondition", "aborted", "out-of-range", "unimplemented", "internal", "unavailable", "data-loss", "unauthenticated"]);
const VALIDATION_CODES = new Set(["invalid-argument", "failed-precondition", "out-of-range", "already-exists"]);
const validReporterUid = value => typeof value === "string" && UID.test(value);

function validCallableOutcome(value, event) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === CALLABLE_FIELDS.join(",")
    && value.schemaVersion === 1 && value.source === CALLABLE_SOURCE
    && event?.source === "cloudLogging" && event.platform === "backend" && event.kind === "error"
    && CALLABLE_OPERATIONS.has(value.operation) && value.operation === event.operation
    && typeof value.requestId === "string" && REQUEST.test(value.requestId) && value.requestId === event.requestId
    && FAILURE_CODES.has(value.code) && value.code === event.code && value.outcome === "failed"
    && (value.errorCategory === "request_failure" || value.errorCategory === "action_validation" && VALIDATION_CODES.has(value.code))
    && value.resourceType === "cloud_function" && value.resourceFunction === value.operation);
}

// Only the trusted logging adapter calls this on the original project log. A
// request reference or failure code alone cannot distinguish service work from
// a failed callable attempt. The deployed fourteen callables are generation 1.
function callableOutcomeEvidence(entry) {
  const p = entry?.jsonPayload || {};
  if (typeof entry?.logName !== "string" || !entry.logName.startsWith("projects/kickai-69dd0/logs/")
    || p.event !== CALLABLE_SOURCE || entry.resource?.type !== "cloud_function"
    || entry.resource.labels?.function_name !== p.operation) return null;
  const value = { schemaVersion: 1, source: CALLABLE_SOURCE, operation: p.operation, requestId: p.requestId,
    code: p.code, outcome: p.outcome, errorCategory: p.errorCategory, resourceType: entry.resource.type,
    resourceFunction: entry.resource.labels.function_name };
  return validCallableOutcome(value, { source: "cloudLogging", platform: "backend", kind: "error",
    operation: p.operation, requestId: p.requestId, code: p.code }) ? value : null;
}

function documentKind(source, record = {}) {
  if (source === "fieldReports" || record.stage === "user_report") return { kind: "report", diagnosticSubtype: null, reason: "user_submitted_report" };
  if (source === "failureCases" && record.kind === "system_diagnostic") {
    // Generic MetricKit bundles can include ordinary metrics. Neither the name
    // nor the upload itself proves a crash or an interrupted session.
    return { kind: "diagnostic", diagnosticSubtype: "unknown", reason: "generic_system_diagnostic" };
  }
  if (source === "failureCases" && ["launch_interrupted", "session_interrupted", "interrupted_launch"].includes(record.kind)) {
    return { kind: "interrupted", diagnosticSubtype: null, reason: "explicit_interruption_record" };
  }
  return { kind: "error", diagnosticSubtype: null, reason: "recorded_error" };
}

function validClassification(value) {
  const reasons = { error: "recorded_error", report: "user_submitted_report", crash: "explicit_crash_record", interrupted: "explicit_interruption_record" };
  const expected = value?.effectiveKind === "diagnostic" ? { metrics: "verified_metric_payload", diagnostics: "verified_diagnostic_payload", unknown: "generic_system_diagnostic" }[value.diagnosticSubtype] : reasons[value?.effectiveKind];
  return value?.schemaVersion === 1 && value.source === SOURCE && KINDS.includes(value.effectiveKind)
    && (value.diagnosticSubtype === null || SUBTYPES.includes(value.diagnosticSubtype))
    && (value.effectiveKind === "diagnostic" || value.diagnosticSubtype === null)
    && SCOPES.includes(value.scope) && value.reason === expected;
}

function classifyOccurrence(event, sourceRecord = null) {
  const generic = event.source === "failureCases" && (event.operation === "system_diagnostic" || event.code === "system_diagnostic");
  // Historical broad /system/ classification must be corrected without
  // mutating its original kind or claiming subtype evidence we do not have.
  let evidence = sourceRecord ? documentKind(event.source, sourceRecord) : generic
    ? { kind: "diagnostic", diagnosticSubtype: "unknown", reason: "generic_system_diagnostic" }
    : { kind: KINDS.includes(event.kind) ? event.kind : "error", diagnosticSubtype: event.kind === "diagnostic" ? "unknown" : null,
      reason: event.kind === "crash" ? "explicit_crash_record" : event.kind === "report" ? "user_submitted_report" : event.kind === "interrupted" ? "explicit_interruption_record" : event.kind === "diagnostic" ? "generic_system_diagnostic" : "recorded_error" };
  if (!sourceRecord && validClassification(event.classification)) evidence = {
    kind: event.classification.effectiveKind, diagnosticSubtype: event.classification.diagnosticSubtype, reason: event.classification.reason,
  };
  // A verified callable failure before caller acceptance is an unknown-actor
  // attempt. Generic service log identifiers still do not identify app users.
  const account = validReporterUid(event.reporterUid);
  const scope = account ? "account_reported" : validCallableOutcome(event.callableOutcome, event) ? "unknown_actor"
    : event.source === "cloudLogging" || ["aiIncidents", "backend"].includes(event.source) && event.platform === "backend" ? "automated_service" : "unknown_actor";
  return { schemaVersion: 1, source: SOURCE, effectiveKind: evidence.kind, diagnosticSubtype: evidence.diagnosticSubtype, scope, reason: evidence.reason };
}

function occurrenceTitle(event, classification = classifyOccurrence(event)) {
  if (classification.scope === "automated_service" && classification.effectiveKind === "error") return `Service error: ${event.operation || "backend"}`;
  const label = { report: "Problem reported", crash: "App crash", interrupted: "Interrupted session — cause unknown", diagnostic: "Diagnostic uploaded", error: "Action failed" }[classification.effectiveKind];
  return `${label}: ${event.operation || "application"}`;
}

function summarizeOccurrences(events) {
  const totals = { occurrences: 0, serviceOccurrences: 0, diagnostics: 0, otherOccurrences: 0, crashes: 0, reports: 0,
    interruptions: 0, accountOccurrences: 0, noAccountOccurrences: 0, reportingAccounts: 0, unknownDiagnosticSubtype: 0 };
  const accounts = new Set(), groups = new Map();
  for (const event of events) {
    const classification = classifyOccurrence(event), kind = classification.effectiveKind;
    totals.occurrences++;
    if (classification.scope === "automated_service") totals.serviceOccurrences++;
    else if (kind === "diagnostic") totals.diagnostics++;
    else totals.otherOccurrences++;
    if (kind === "crash") totals.crashes++;
    if (kind === "report") totals.reports++;
    if (kind === "interrupted") totals.interruptions++;
    if (kind === "diagnostic" && classification.diagnosticSubtype === "unknown") totals.unknownDiagnosticSubtype++;
    if (validReporterUid(event.reporterUid)) { totals.accountOccurrences++; accounts.add(event.reporterUid); }
    else totals.noAccountOccurrences++;
    const title = occurrenceTitle(event, classification);
    groups.set(title, (groups.get(title) || 0) + 1);
  }
  totals.reportingAccounts = accounts.size;
  return { ...totals, top: [...groups].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)).slice(0, 5) };
}

module.exports = { SOURCE, documentKind, validClassification, validReporterUid, callableOutcomeEvidence, validCallableOutcome, classifyOccurrence, occurrenceTitle, summarizeOccurrences };
