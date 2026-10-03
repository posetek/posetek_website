"use strict";

const EXERCISES = Object.freeze(["shooting", "sprint", "jump", "broadJump", "changeOfDirection", "dribbling"]);
const SPECS = Object.freeze({
  shooting: { fields: ["velocity"], unit: "m/s" }, sprint: { fields: ["max_velocity", "maxVelocity"], unit: "m/s" },
  jump: { fields: ["jumpHeight", "jump_height_m", "jump_height_in", "jump_height_inches"], unit: "m" }, broadJump: { fields: ["broadJumpDistance"], unit: "m" },
  changeOfDirection: { fields: ["totalTime"], unit: "s" }, dribbling: { fields: ["totalTime"], unit: "s" },
});
function millis(value) {
  try {
    const result = value?.toMillis ? value.toMillis() : value?.toDate ? value.toDate().getTime() : value instanceof Date ? value.getTime()
      : typeof value === "number" ? value : typeof value === "string" && value ? Date.parse(value)
      : typeof value?._seconds === "number" ? value._seconds * 1000
      : typeof value?.seconds === "number" ? value.seconds * 1000 : null;
    return Number.isFinite(result) && Math.abs(result) <= 8640000000000000 ? result : null;
  } catch { return null; }
}
function drillOf(rep) {
  const value = rep.repType || rep.drillType;
  return ["deadballShot", "side_kick"].includes(value) ? "shooting" : EXERCISES.includes(value) ? value : "unknown";
}
function primary(rep, drill = drillOf(rep)) {
  const field = SPECS[drill]?.fields.find(key => typeof rep[key] === "number" && Number.isFinite(rep[key]) && rep[key] > 0);
  if (!field) return null;
  if (drill === "jump") return { field: "jumpHeight", sourceField: field,
    value: rep[field] * (["jump_height_in", "jump_height_inches"].includes(field) ? 0.0254 : 1), unit: "m" };
  return { field, value: rep[field], unit: SPECS[drill].unit };
}
function agrees(left, right) { return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= Math.max(1e-6, Math.abs(left) * 1e-5); }
function attemptKey(rep) {
  const drill = drillOf(rep);
  // Only explicit recording coordinates support deduplication. Missing values
  // never silently become session 1 / rep 1.
  const session = Number.isSafeInteger(rep.sessionNumber) && rep.sessionNumber > 0 ? rep.sessionNumber : null;
  const number = Number.isSafeInteger(rep.repNumber) && rep.repNumber > 0 ? rep.repNumber : null;
  return session !== null && number !== null ? JSON.stringify([drill, session, number]) : null;
}
function duplicateIds(reps, corrections) {
  const result = new Set(), groups = new Map();
  for (const rep of reps) {
    const key = attemptKey(rep);
    if (key) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(rep); }
  }
  for (const group of groups.values()) {
    const recorded = group.filter(rep => typeof rep.storagePath === "string" && rep.storagePath);
    // The verified historical duplication is a pathless jump mirror of a
    // path-backed jump. Shared session labels alone do not collapse captures.
    if (recorded.length) for (const rep of group) if (drillOf(rep) === "jump" && !rep.storagePath) result.add(rep.id);
  }
  // Explicit cross-drill duplicate corrections live in a server-owned path.
  // Mobile-writable duplicateOf/adminRevision fields alone confer no authority.
  if (corrections?.schemaVersion === 1 && typeof corrections.repairId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(corrections.repairId)
    && Number.isFinite(corrections.reviewedAtMillis) && corrections.reviewedAtMillis > 0
    && corrections.duplicateReps && typeof corrections.duplicateReps === "object" && !Array.isArray(corrections.duplicateReps)) {
    const byId = new Map(reps.map(rep => [rep.id, rep]));
    for (const [id, targetId] of Object.entries(corrections.duplicateReps)) {
      const rep = byId.get(id), target = byId.get(targetId);
      if (!rep || !target || id === targetId || rep.duplicateOf !== targetId
        || Object.hasOwn(corrections.duplicateReps, targetId) || target.duplicateOf || result.has(targetId)
        || (rep.playerId && target.playerId && rep.playerId !== target.playerId)) continue;
      result.add(id);
    }
  }
  return result;
}
function qualifyRep(rep, evidence = {}, duplicate = false) {
  const drill = drillOf(rep), metric = primary(rep, drill);
  const base = { at: millis(rep.createdAt), drill, attempt: duplicate ? 0 : 1, duplicate: duplicate ? 1 : 0,
    qualified: 0, needsReview: 0, reason: "noPrimaryResult", metric: null };
  if (duplicate) return { ...base, reason: "duplicateDocument" };
  if (!metric) return base;
  const metadata = evidence.metadata, context = evidence.context;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { ...base, needsReview: 1, reason: "missingEvidence" };
  const metadataMetric = primary(metadata, drill);
  const revision = rep.adminRevision?.revisionId;
  const matchingRevision = Boolean(revision && revision === metadata.adminRevision?.revisionId
    && evidence.revision?.revisionId === revision && !evidence.revision.restoredAtMillis
    && primary(evidence.revision.fields || {}, drill) && agrees(primary(evidence.revision.fields, drill).value, metric.value));
  const validMetadata = (!Object.hasOwn(metadata, "resultsValid") || metadata.resultsValid === true) && (!Object.hasOwn(metadata, "processingStatus") || metadata.processingStatus === "complete")
    && (!Object.hasOwn(metadata, "failedSteps") || (Array.isArray(metadata.failedSteps) && metadata.failedSteps.length === 0))
    && (!metadataMetric || agrees(metric.value, metadataMetric.value));
  const revised = matchingRevision && validMetadata && metadata.resultsValid === true
    && metadata.processingStatus === "complete" && metadataMetric && agrees(metric.value, metadataMetric.value);
  const failures = Array.isArray(evidence.failures) ? evidence.failures : [];
  const revisionAt = millis(rep.adminRevision?.atMillis);
  const activeFailures = failures.filter(failure => !failure.resolvedAt && !failure.resolvedAtMillis
    && !["resolved", "superseded", "dismissed"].includes(failure.status)
    && !(revised && millis(failure.createdAt ?? failure.createdAtMillis) !== null
      && millis(failure.createdAt ?? failure.createdAtMillis) <= revisionAt));
  const rootInvalid = (Object.hasOwn(rep, "resultsValid") && rep.resultsValid !== true) || (Object.hasOwn(rep, "processingStatus") && rep.processingStatus !== "complete")
    || (Object.hasOwn(rep, "failedSteps") && (!Array.isArray(rep.failedSteps) || rep.failedSteps.length));
  const sidecarValid = context?.result?.resultsValid === true;
  const sidecarMetric = context?.result?.primaryMetric;
  const metricAgrees = !Number.isFinite(sidecarMetric) || agrees(metric.value, sidecarMetric)
    || (["jump_height_in", "jump_height_inches"].includes(metric.sourceField) && agrees(metric.value, sidecarMetric * 0.0254));
  if (activeFailures.length || !validMetadata || (!revised && (evidence.identityConflict || rootInvalid || !sidecarValid || !metricAgrees))) {
    return { ...base, needsReview: 1, reason: "evidenceNotComplete" };
  }
  return { ...base, qualified: 1, reason: revised ? "acceptedRevision" : "verifiedResult", metric };
}
function testingStatus(events) {
  const exerciseKeys = EXERCISES.filter(drill => events.some(event => event.drill === drill && event.qualified));
  const distinctAttempts = events.reduce((sum, item) => sum + item.attempt, 0);
  return { status: exerciseKeys.length === 6 ? "fullyTested" : exerciseKeys.length ? "partiallyTested"
    : distinctAttempts ? "noSuccessfulTests" : "noRecordedTests", exerciseKeys,
  exercisesComplete: exerciseKeys.length, recordedDocuments: events.length, distinctAttempts,
  qualifyingTests: events.reduce((sum, item) => sum + item.qualified, 0) };
}
function demographics(profile, reporting, now) {
  const division = ["boys", "girls"].includes(reporting?.division) ? reporting.division : "unknown";
  let age = null;
  for (const input of [profile.birthDate, profile.dateOfBirth, profile.dob, profile.birthdate, profile.birthday]) {
    if (typeof input === "string" && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(input)
      || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString().slice(0, 10) !== input.slice(0, 10))) continue;
    const birth = millis(input);
    if (birth === null || birth > now) continue;
    const date = new Date(birth), today = new Date(now);
    const years = today.getUTCFullYear() - date.getUTCFullYear() - (today.getUTCMonth() < date.getUTCMonth()
      || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate()) ? 1 : 0);
    if (years >= 5 && years <= 80) { age = years; break; }
  }
  const recorded = millis(profile.ageRecordedAt);
  if (age === null && Number.isInteger(profile.age) && profile.age >= 5 && profile.age <= 80
    && recorded !== null && recorded <= now && now - recorded <= 365 * 86400000) age = profile.age;
  return { division, age, ageBand: age === null ? "unknown" : age < 10 ? "under10" : age <= 12 ? "10-12"
    : age <= 15 ? "13-15" : age <= 18 ? "16-18" : "19+" };
}
function workoutEvents(logs) {
  const groups = new Map();
  for (const log of logs) {
    const identity = log.source === "personal" ? `personal:${log.workoutId || log.id}`
      : log.planId && log.workoutId && log.source !== "adhoc" ? `plan:${log.planId}:${log.workoutId}`
      : `adhoc:${log.workoutId || log.id}`;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(log);
  }
  return [...groups.values()].map(group => {
    // Prefer the immutable execution contract, then the most recently ended
    // linked log. A duplicate never increases starts, time or completion.
    group.sort((a, b) => Number(Boolean(b.workoutSnapshot)) - Number(Boolean(a.workoutSnapshot))
      || (millis(b.endedAt) ?? 0) - (millis(a.endedAt) ?? 0) || String(a.id).localeCompare(String(b.id)));
    const log = group[0], start = millis(log.startedAt), end = millis(log.endedAt);
    const status = end === null ? "inProgress" : log.source === "personal" && ["stopped", "pain"].includes(log.endReason) ? "endedEarly"
      : ["completed", "endedEarly", "abandoned"].includes(log.endReason) ? log.endReason : "unknown";
    const completions = new Map((Array.isArray(log.blocks) ? log.blocks : []).filter(b => b && typeof b.blockId === "string").map(b => [b.blockId, b]));
    const blocks = [...completions.values()], frozen = log.workoutSnapshot?.blocks;
    let prescribedKnown = Array.isArray(frozen) && frozen.length > 0, allSets = prescribedKnown;
    for (const block of Array.isArray(frozen) ? frozen : []) {
      const sets = block.sets ?? block.dose?.sets;
      if (!Number.isSafeInteger(sets) || sets < 1) { prescribedKnown = false; allSets = false; continue; }
      const completion = completions.get(block.blockId);
      if (!completion || completion.status !== "done" || !Number.isSafeInteger(completion.setsCompleted) || completion.setsCompleted < sets) allSets = false;
    }
    const timer = typeof log.activeSeconds === "number" && Number.isFinite(log.activeSeconds) && log.activeSeconds >= 0
      && log.activeSeconds <= 7 * 86400 ? log.activeSeconds / 60 : null;
    const estimate = timer === null && start !== null && end !== null && end >= start && end - start <= 7 * 86400000 ? (end - start) / 60000 : null;
    return { at: start, end, status, duplicateLogs: group.length - 1,
      doneBlocks: blocks.filter(b => b.status === "done").length, partialBlocks: blocks.filter(b => b.status === "partial").length,
      skippedBlocks: blocks.filter(b => b.status === "skipped").length,
      setsCompleted: blocks.reduce((sum, b) => sum + (["done", "partial", "skipped"].includes(b.status) && Number.isSafeInteger(b.setsCompleted) && b.setsCompleted >= 0 ? b.setsCompleted : 0), 0),
      timerMinutes: timer ?? 0, estimatedMinutes: estimate ?? 0, unknownDuration: timer === null && estimate === null ? 1 : 0,
      durationSource: timer !== null ? "timer" : estimate !== null ? "estimate" : "unknown",
      allPrescribedSetsCompleted: prescribedKnown && allSets ? 1 : 0, unknownPrescription: prescribedKnown ? 0 : 1 };
  });
}
module.exports = { EXERCISES, millis, drillOf, primary, agrees, duplicateIds, qualifyRep, testingStatus, demographics, workoutEvents };
