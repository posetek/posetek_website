"use strict";
const M = require("./user-issue-model");
const RequestIdentity = require("./user-issue-request-identity");
const { validCallableOutcome } = require("./user-issue-classification");
const LIMIT = 16;
function evidence(event, { historical = false } = {}) {
  return { evidenceType: historical ? "historical_canonical" : "source_observation", source: M.clean(event.source, 80),
    sourceReference: M.redact(event.sourceReference, 300) || null, eventId: M.ID.test(event.eventId || "") ? event.eventId : null,
    requestId: M.ID.test(event.requestId || "") ? event.requestId : null, actorUid: M.ID.test(event.reporterUid || "") ? event.reporterUid : null,
    kind: M.clean(event.kind, 30), operation: M.redact(event.operation, 100), code: M.redact(event.code, 100), platform: M.clean(event.platform, 30),
    build: M.redact(event.build, 80), device: M.redact(event.device, 180), route: M.clean(event.route, 200).split(/[?#]/)[0],
    occurredAtMillis: Number.isSafeInteger(event.occurredAtMillis) ? event.occurredAtMillis : null,
    receivedAtMillis: Number.isSafeInteger(event.receivedAtMillis) ? event.receivedAtMillis : null,
    sourceReceivedAtMillis: Number.isSafeInteger(event.sourceReceivedAtMillis) ? event.sourceReceivedAtMillis : null,
    player: M.ID.test(event.player?.id || "") ? { id: event.player.id, name: M.redact(event.player.name, 200) || null } : null,
    ...(validCallableOutcome(event.callableOutcome, event) ? { callableOutcome: { ...event.callableOutcome } } : {}),
    hasScreenshot: Boolean(event.screenshot), conflictsWithCanonical: [], additionalContext: [] };
}
const sameRequest = RequestIdentity.sameRequest;
function appendSummary(original, next) {
  const prior = original.sourceObservationSummary;
  const known = prior?.schemaVersion === 1 && Number.isSafeInteger(prior.count) && prior.count > 0 && Array.isArray(prior.evidence) && prior.evidence.length <= LIMIT;
  const entries = known ? prior.evidence : [evidence(original, { historical: true })];
  const count = (known ? prior.count : 1) + 1, item = evidence(next);
  if (next.operation !== original.operation && next.operation && original.operation && original.operation !== "application") item.conflictsWithCanonical.push("attempted_action");
  else if (next.operation && next.operation !== "application" && (!original.operation || original.operation === "application")) item.additionalContext.push("attempted_action");
  if (next.player?.id && original.player?.id && next.player.id !== original.player.id) item.conflictsWithCanonical.push("target_athlete");
  else if (next.player?.id && !original.player?.id) item.additionalContext.push("target_athlete");
  const merged = [...entries, item];
  const kept = merged.length <= LIMIT ? merged : [merged[0], ...merged.slice(-(LIMIT - 1))];
  return { schemaVersion: 1, count, evidence: kept, truncated: count > kept.length };
}
function initialSummary(event) { return { schemaVersion: 1, count: 1, evidence: [evidence(event)], truncated: false }; }
module.exports = { LIMIT, evidence, sameRequest, appendSummary, initialSummary };
