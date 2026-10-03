"use strict";
const M = require("./user-issue-model");
const { UID } = require("./user-issue-contacts");
const LIMIT = 16, SHA = /^[a-f0-9]{64}$/;
const SOURCE = "posetek_server_request_identity";
const target = player => typeof player?.id === "string" && M.ID.test(player.id) ? player.id : null;
const sourceKey = (actor, event, origin) => M.hash(["source-observation-v1", actor, origin.source, origin.sourceEvent || event.eventId, event.eventId]);
function descriptor(row, occurrenceId) {
  const entries = Array.isArray(row.sourceObservationSummary?.evidence) ? row.sourceObservationSummary.evidence : [];
  const operations = new Set([row.operation, ...entries.map(item => item.operation)].filter(Boolean));
  const targets = new Set([target(row.player), ...entries.map(item => target(item.player))].filter(Boolean));
  const invalidSummary = row.sourceObservationSummary && (row.sourceObservationSummary.schemaVersion !== 1
    || !Array.isArray(row.sourceObservationSummary.evidence) || entries.length > LIMIT
    || row.sourceObservationSummary.truncated === true || entries.some(item => item.actorUid !== (row.reporterUid || null) || item.requestId !== row.requestId));
  return { occurrenceId, operation: row.operation || "application", targetId: targets.size === 1 ? [...targets][0] : null,
    sessionId: row.sessionId, source: row.source, ambiguous: Boolean(invalidSummary || operations.size !== 1 || targets.size > 1 || !row.operation || row.operation === "application"), isolated: false };
}
function incoming(event, who, origin, occurrenceId) {
  return { occurrenceId, operation: event.operation, targetId: target(who.player), sessionId: event.sessionId,
    source: origin.source, ambiguous: event.operation === "application", isolated: false };
}
function validCatalog(value, primaryId, actor, requestId) {
  return value?.schemaVersion === 1 && value.source === SOURCE && value.primaryOccurrenceId === primaryId
    && value.actorKey === M.hash(actor) && value.requestId === requestId && typeof value.overflow === "boolean"
    && Array.isArray(value.branches) && value.branches.length > 0 && value.branches.length <= LIMIT
    && new Set(value.branches.map(branch => branch.occurrenceId)).size === value.branches.length
    && value.branches.every(branch => SHA.test(branch.occurrenceId || "") && typeof branch.operation === "string" && branch.operation.length > 0 && branch.operation.length <= 100
      && (branch.targetId === null || typeof branch.targetId === "string" && M.ID.test(branch.targetId))
      && typeof branch.sessionId === "string" && M.ID.test(branch.sessionId) && typeof branch.source === "string" && branch.source.length > 0 && branch.source.length <= 80
      && typeof branch.ambiguous === "boolean" && typeof branch.isolated === "boolean");
}
function sameRequest(original, event, who, origin, binding) {
  if (!M.ID.test(event.requestId || "") || event.requestId !== original.requestId || (who.uid || null) !== (original.reporterUid || null)
    || !event.operation || event.operation === "application" || event.operation !== original.operation) return false;
  if (!who.uid && (event.sessionId !== original.sessionId || !origin?.source || origin.source !== original.source)) return false;
  if (who.uid && !UID.test(who.uid)) return false;
  const known = binding?.targetId || target(original.player), next = target(who.player);
  return !(known && next && known !== next) && binding?.ambiguous !== true && binding?.isolated !== true;
}
function store(catalog, branch) {
  const existing = catalog.branches.findIndex(item => item.occurrenceId === branch.occurrenceId);
  if (existing >= 0) catalog.branches[existing] = branch;
  else if (catalog.branches.length < LIMIT) catalog.branches.push(branch);
  else catalog.overflow = true;
  return catalog;
}
function isolate(plan, event, who, origin, key, reason = "source_evidence_unconfirmed") {
  const occurrenceId = M.hash(["request-unassigned-source-v1", plan.primaryId, key]);
  const branch = { ...incoming(event, who, origin, occurrenceId), isolated: true };
  return { ...plan, occurrenceId, branch, reason, catalog: store(plan.catalog, branch) };
}
function route({ original, catalog: saved, event, who, origin, actor, primaryId, key, primaryReplay = false }) {
  if (!event.requestId) return { primaryId, occurrenceId: primaryId, catalog: null, branch: null, reason: null };
  if (saved && !validCatalog(saved, primaryId, actor, event.requestId)) throw new Error("invalid_server_request_identity");
  const catalog = saved ? { ...saved, branches: saved.branches.map(branch => ({ ...branch })) }
    : { schemaVersion: 1, source: SOURCE, primaryOccurrenceId: primaryId, actorKey: M.hash(actor), requestId: event.requestId,
      overflow: false, branches: [original ? descriptor(original, primaryId) : incoming(event, who, origin, primaryId)] };
  if (!original) {
    if (saved) throw new Error("request_identity_primary_unavailable");
    return { primaryId, occurrenceId: primaryId, catalog, branch: catalog.branches[0], reason: null };
  }
  if (primaryReplay) return { primaryId, occurrenceId: primaryId, catalog, branch: catalog.branches.find(branch => branch.occurrenceId === primaryId), reason: null };
  const nextTarget = target(who.player), authenticated = typeof who.uid === "string" && UID.test(who.uid);
  const sameOperation = catalog.branches.filter(branch => branch.operation === event.operation && !branch.isolated);
  const candidates = sameOperation.filter(branch => !branch.ambiguous && event.operation !== "application"
    && (authenticated || !who.uid && branch.sessionId === event.sessionId && branch.source === origin.source)
    && (!nextTarget || !branch.targetId || nextTarget === branch.targetId));
  // A missing target cannot choose among distinct known targets. Once capacity
  // is exhausted, an unregistered branch may exist: only exact known targets
  // remain eligible, and all uncertain sources are individually retained.
  const exact = nextTarget ? candidates.filter(branch => branch.targetId === nextTarget) : candidates;
  const selected = exact.length === 1 ? exact[0] : exact.length === 0 && candidates.length === 1 && !catalog.overflow && sameOperation.length === 1 ? candidates[0] : null;
  const safe = selected && (!catalog.overflow || nextTarget && selected.targetId === nextTarget)
    && (nextTarget || sameOperation.length === 1 && !catalog.overflow);
  if (safe) {
    const branch = { ...selected, targetId: selected.targetId || nextTarget };
    return { primaryId, occurrenceId: branch.occurrenceId, branch, reason: null, catalog: store(catalog, branch) };
  }
  let reason = catalog.overflow ? "registry_capacity_reached" : event.operation === "application" ? "request_evidence_unconfirmed"
    : !sameOperation.length ? "attempted_action_conflict" : !who.uid && sameOperation.some(branch => branch.sessionId !== event.sessionId) ? "anonymous_session_conflict"
      : !who.uid && sameOperation.some(branch => branch.source !== origin.source) ? "anonymous_source_unconfirmed"
        : !nextTarget ? "target_ambiguous" : sameOperation.some(branch => branch.ambiguous) ? "historical_request_conflict" : "target_athlete_conflict";
  const plan = { primaryId, catalog, reason };
  if (catalog.overflow || !nextTarget && sameOperation.length > 1 || event.operation === "application" || who.uid && !authenticated
    || sameOperation.some(branch => branch.ambiguous)) return isolate(plan, event, who, origin, key, reason);
  const occurrenceId = M.hash(["request-collision-v1", primaryId, event.operation, nextTarget, who.uid ? null : event.sessionId, who.uid ? null : origin.source]);
  const branch = incoming(event, who, origin, occurrenceId);
  return { ...plan, occurrenceId, branch, catalog: store(catalog, branch) };
}
module.exports = { LIMIT, SOURCE, sourceKey, descriptor, validCatalog, sameRequest, route, isolate };
