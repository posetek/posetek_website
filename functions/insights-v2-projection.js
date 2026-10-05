"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { playerSegment } = require("./athlete-storage-paths");
const { millis, duplicateIds, qualifyRep, workoutEvents } = require("./insights-v2-qualification");
const { createProcessingEvidenceReader, failureMatchesRep } = require("./processing-evidence");
const { effectiveRep } = require("./effective-rep");
const { measuredMetrics } = require("./insights-axis-scoring");
const PROJECTION_VERSION = 4;
const MAX_HISTORY = 20000;
const MAX_WORKOUTS = 10000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REBUILD_LEASE_MS = 11 * 60000;
const REBUILD_WORK_MS = 8 * 60000;
const MAX_REBUILD_PASSES = 3;
const SOURCE_KINDS = new Set(["player", "record", "revision", "failure", "artifact", "artifact_delete", "testing_event"]);
function sourceEventHash(source) {
  if (source == null) return null;
  if (!SOURCE_KINDS.has(source.sourceKind) || typeof source.eventId !== "string" || !source.eventId
      || source.eventId.length > 1024) throw new Error("Invalid Insights source event.");
  return createHash("sha256").update(`${source.sourceKind}\0${source.eventId}`).digest("hex");
}

async function completeQuery(query, maximum, HttpsError, pageSize = 250, read = query => query.get()) {
  const result = [];
  let cursor = null;
  while (true) {
    let next = query.orderBy("__name__").limit(Math.min(pageSize, maximum + 1 - result.length));
    if (cursor !== null) next = next.startAfter(cursor);
    const page = await read(next);
    result.push(...page.docs);
    if (result.length > maximum) throw new HttpsError("resource-exhausted", "The complete report exceeds the current processing bound. No partial total was returned.");
    if (page.docs.length < Math.min(pageSize, maximum + 1 - (result.length - page.docs.length))) return result;
    cursor = page.docs.at(-1).id;
  }
}
async function mapBounded(items, concurrency, work) {
  let index = 0, failed = false;
  const result = new Array(items.length);
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && index < items.length) {
      const current = index++;
      try { result[current] = await work(items[current], current); } catch (error) { failed = true; throw error; }
    }
  }));
  const failure = settled.find(item => item.status === "rejected");
  if (failure) throw failure.reason;
  return result;
}
function createInsightProjection({ db, bucket, HttpsError, now = () => Date.now(), maxHistory = MAX_HISTORY,
  maxWorkouts = MAX_WORKOUTS, readEvidence: injectedEvidence, readFailures: injectedFailures }) {
  if (!Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > MAX_HISTORY
    || !Number.isInteger(maxWorkouts) || maxWorkouts < 1 || maxWorkouts > MAX_WORKOUTS) throw new Error("Invalid Insights history limits");
  const currentRef = id => db.collection("players").doc(id).collection("insightSummaries").doc("current");
  const stateRef = id => db.collection("players").doc(id).collection("insightSummaries").doc("state");
  function rebuildError(reason, rebuildId, source, message) {
    const details = { reason, rebuildId, sourceKind: source?.sourceKind || "direct",
      sourceEventHash: sourceEventHash(source) };
    const error = new HttpsError("aborted", message, details);
    // Lightweight test adapters may not retain the HttpsError third argument.
    if (!error.details) error.details = details;
    return error;
  }
  async function invalidateInsightPlayer(playerId, source = null) {
    if (!playerSegment(playerId)) throw new HttpsError("invalid-argument", "Invalid player.");
    const eventHash = sourceEventHash(source), token = randomUUID();
    return db.runTransaction(async transaction => {
      const eventRef = eventHash && db.collection("players").doc(playerId).collection("insightSummaries").doc(`event_${eventHash}`);
      if (eventRef && (await transaction.get(eventRef)).exists) return { invalidated: false, sourceEventHash: eventHash };
      // Preserve the active owner; a newly dirty token must be handled by that
      // owner or by an existing retry-enabled source invocation.
      transaction.set(stateRef(playerId), { token, dirtyAtMillis: now(),
        dirtySourceKind: source?.sourceKind || "direct", dirtySourceEventHash: eventHash }, { merge: true });
      if (eventRef) transaction.set(eventRef, { schemaVersion: 1, sourceKind: source.sourceKind,
        sourceEventHash: eventHash, token, receivedAtMillis: now() });
      return { invalidated: true, token, sourceEventHash: eventHash };
    });
  }
  const { readEvidence } = createProcessingEvidenceReader({ db, bucket, HttpsError, readEvidence: injectedEvidence });
  async function cleanupPages(playerId, previous, published) {
    // Old failed rebuilds can leave unpublished pages. They are eligible only
    // after 24 hours; publication itself has a ten-minute deadline below.
    const pages = await completeQuery(db.collection("players").doc(playerId).collection("insightSummaryDays"), 100000, HttpsError);
    const oldIds = pages.filter(page => page.data()?.revisionId !== published.revisionId
      && (page.data()?.revisionId === previous?.revisionId || page.data()?.rebuiltAtMillis < now() - MAX_AGE_MS)).map(page => page.id);
    for (let offset = 0; offset < oldIds.length; offset += 200) {
      const ids = oldIds.slice(offset, offset + 200).filter(id => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id));
      await db.runTransaction(async transaction => {
        const current = await transaction.get(currentRef(playerId));
        if (current.data()?.revisionId !== published.revisionId) return;
        const pages = await Promise.all(ids.map(id => transaction.get(db.collection("players").doc(playerId).collection("insightSummaryDays").doc(id))));
        for (const page of pages) if (!current.data().dayIds.includes(page.id) && (page.data()?.revisionId === previous?.revisionId
          || page.data()?.rebuiltAtMillis < now() - MAX_AGE_MS)) transaction.delete(page.ref);
      });
    }
  }
  async function rebuildOnce(playerId, rebuildId, source) {
    if (!playerSegment(playerId)) throw new HttpsError("invalid-argument", "Invalid player.");
    const playerRef = db.collection("players").doc(playerId), startedAtMillis = now();
    const [profile, state, previous] = await Promise.all([playerRef.get(), stateRef(playerId).get(), currentRef(playerId).get()]);
    if (!profile.exists) {
      const pages = await completeQuery(playerRef.collection("insightSummaryDays"), 100000, HttpsError);
      for (let offset = 0; offset < pages.length || offset === 0; offset += 200) await db.runTransaction(async transaction => {
        if ((await transaction.get(playerRef)).exists) throw new HttpsError("aborted", "Player was restored during cleanup.");
        for (const page of pages.slice(offset, offset + 200)) transaction.delete(page.ref);
        transaction.delete(currentRef(playerId)); transaction.delete(stateRef(playerId));
      });
      return { deleted: true, playerId };
    }
    const token = state.data()?.token || null;
    const [repDocs, logDocs, failures, corrections, personalLogs] = await Promise.all([
      completeQuery(playerRef.collection("reps"), maxHistory, HttpsError),
      completeQuery(playerRef.collection("workoutLogs"), maxWorkouts, HttpsError),
      injectedFailures ? injectedFailures(playerId) : completeQuery(db.collection("failureCases").where("playerDocumentID", "==", playerId), 5000, HttpsError)
        .then(docs => docs.map(doc => ({ ...doc.data(), id: doc.id }))),
      playerRef.collection("insightMetadata").doc("resultCorrections").get(),
      completeQuery(playerRef.collection("personalWorkoutLogs"), maxWorkouts, HttpsError),
    ]);
    const reps = repDocs.map(doc => ({ ...doc.data(), id: doc.id, playerId })), duplicates = duplicateIds(reps, corrections.data()), cache = new Map(), linkedFailures = new Set();
    const testing = await mapBounded(reps, 8, async rep => {
      const evidence = duplicates.has(rep.id) ? {} : await readEvidence(playerId, rep, cache, failures);
      for (const failure of evidence.failures || []) linkedFailures.add(failure);
      return { ...qualifyRep(rep, evidence, duplicates.has(rep.id)),
        profileMetrics: measuredMetrics(effectiveRep(rep, evidence, duplicates.has(rep.id))) };
    });
    if (logDocs.length + personalLogs.length > maxWorkouts) throw new HttpsError("resource-exhausted", "The complete workout history exceeds the reporting bound. No partial total was returned.");
    const workouts = workoutEvents([...logDocs.map(doc => ({ ...doc.data(), id: doc.id })),
      ...personalLogs.map(doc => ({ ...doc.data(), id: doc.id, source: "personal" }))]);
    const failureEvents = failures.map(failure => ({ at: millis(failure.createdAt), linked: linkedFailures.has(failure) ? 1 : 0, unmatched: linkedFailures.has(failure) ? 0 : 1 }));
    const grouped = new Map();
    for (const [type, values] of [["testing", testing], ["workouts", workouts], ["failures", failureEvents]]) for (const event of values) {
      const day = event.at === null ? "undated" : event.at > now() ? "future" : new Date(event.at).toISOString().slice(0, 10);
      if (!grouped.has(day)) grouped.set(day, { testing: [], workouts: [], failures: [] });
      grouped.get(day)[type].push(event);
    }
    const revisionId = randomUUID(), rebuiltAtMillis = now(), dayIds = [];
    let batch = db.batch(), pending = 0;
    for (const [day, events] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const count = Math.max(events.testing.length, events.workouts.length, events.failures.length);
      for (let offset = 0; offset < count; offset += 250) {
        const id = `${day}_${revisionId}_${offset / 250}`;
        dayIds.push(id);
        if (dayIds.length > 5000) throw new HttpsError("resource-exhausted", "The complete daily report exceeds its manifest bound.");
        batch.set(playerRef.collection("insightSummaryDays").doc(id), { version: PROJECTION_VERSION, revisionId, day,
          rebuiltAtMillis, testing: events.testing.slice(offset, offset + 250), workouts: events.workouts.slice(offset, offset + 250), failures: events.failures.slice(offset, offset + 250) });
        if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
      }
    }
    if (pending) await batch.commit();
    const summary = { version: PROJECTION_VERSION, revisionId, rebuiltAtMillis, complete: true, token,
      recordedDocuments: reps.length, workoutLogs: logDocs.length + personalLogs.length, failureReports: failures.length, dayIds };
    // Immutable daily pages become visible only when the complete manifest is
    // published. Concurrent invalidation prevents stale rebuild publication.
    await db.runTransaction(async transaction => {
      const [freshState, freshProfile] = await Promise.all([transaction.get(stateRef(playerId)), transaction.get(playerRef)]);
      if (!freshProfile.exists) throw rebuildError("insights-player-deleted", rebuildId, source, "Player was deleted during the rebuild.");
      if (freshState.data()?.rebuildLease?.id !== rebuildId || freshState.data().rebuildLease.expiresAtMillis <= now())
        throw rebuildError("insights-rebuild-lease-lost", rebuildId, source, "The rebuild owner changed. Retry to refresh the report.");
      if ((freshState.data()?.token || null) !== token)
        throw rebuildError("insights-rebuild-superseded", rebuildId, source, "New player data is pending. Retry to refresh the report.");
      if (now() - startedAtMillis > 10 * 60000)
        throw rebuildError("insights-rebuild-deadline-exceeded", rebuildId, source, "The rebuild exceeded its publication deadline.");
      transaction.set(currentRef(playerId), summary);
    });
    await cleanupPages(playerId, previous.data(), summary);
    return summary;
  }
  async function rebuildInsightPlayer(playerId, source = null) {
    if (!playerSegment(playerId)) throw new HttpsError("invalid-argument", "Invalid player.");
    sourceEventHash(source);
    const rebuildId = randomUUID(), startedAtMillis = now();
    const claim = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(stateRef(playerId)), state = snapshot.data() || {};
      if (state.rebuildLease?.id && state.rebuildLease.expiresAtMillis > now()) return { acquired: false };
      if (source) {
        const [current, profile] = await Promise.all([transaction.get(currentRef(playerId)), transaction.get(db.collection("players").doc(playerId))]);
        const summary = current.data();
        if (profile.exists && summary?.complete && summary.version === PROJECTION_VERSION
            && summary.token === (state.token || null) && summary.rebuiltAtMillis <= now()
            && now() - summary.rebuiltAtMillis <= MAX_AGE_MS) return { current: summary };
      }
      transaction.set(stateRef(playerId), { rebuildLease: { id: rebuildId,
        startedAtMillis, expiresAtMillis: startedAtMillis + REBUILD_LEASE_MS } }, { merge: true });
      return { acquired: true };
    });
    if (claim.current) return claim.current;
    // Returning success here would lose a dirty revision if its owner failed.
    // The source trigger remains retryable until a complete latest manifest is
    // published; callables never receive a stale healthy report.
    if (!claim.acquired) throw rebuildError("insights-rebuild-busy", rebuildId, source, "Another rebuild owns this player. Retry to refresh the report.");
    let originalFailure;
    try {
      for (let pass = 0; pass < MAX_REBUILD_PASSES && now() - startedAtMillis <= REBUILD_WORK_MS; pass++) {
        let summary;
        try { summary = await rebuildOnce(playerId, rebuildId, source); }
        catch (error) {
          if (error.details?.reason === "insights-rebuild-superseded") continue;
          throw error;
        }
        if (summary.deleted) return summary;
        const finished = await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(stateRef(playerId)), state = snapshot.data();
          if (state?.rebuildLease?.id !== rebuildId || state.rebuildLease.expiresAtMillis <= now())
            throw rebuildError("insights-rebuild-lease-lost", rebuildId, source, "The rebuild owner changed. Retry to refresh the report.");
          if ((state.token || null) !== summary.token) return false;
          transaction.set(stateRef(playerId), { rebuildLease: null }, { merge: true });
          return true;
        });
        if (finished) return summary;
      }
      throw rebuildError("insights-rebuild-continuation-required", rebuildId, source, "Newer changes remain pending. Retry to refresh the complete report.");
    } catch (error) {
      originalFailure = error;
      throw error;
    } finally {
      try {
        await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(stateRef(playerId));
          if (snapshot.data()?.rebuildLease?.id === rebuildId) transaction.set(stateRef(playerId), { rebuildLease: null }, { merge: true });
        });
      } catch (error) { if (!originalFailure) throw error; }
    }
  }
  async function loadInsightPlayer(playerId, { allowRebuild = true, repairMissingPage = true } = {}) {
    let [snapshot, state] = await Promise.all([currentRef(playerId).get(), stateRef(playerId).get()]);
    let summary = snapshot.data();
    if (!summary?.complete || summary.version !== PROJECTION_VERSION || summary.token !== (state.data()?.token || null)
      || now() - summary.rebuiltAtMillis > MAX_AGE_MS || summary.rebuiltAtMillis > now()) {
      if (!(typeof allowRebuild === "function" ? allowRebuild() : allowRebuild)) throw new HttpsError("failed-precondition", "Player summaries need rebuilding. Retry to refresh the complete report; each retry advances the rebuild.", { reason: "insights-rebuild-required" });
      summary = await rebuildInsightPlayer(playerId);
    }
    if (summary.deleted) return null;
    if (!Array.isArray(summary.dayIds) || summary.dayIds.length > maxHistory + maxWorkouts + 5000) throw new HttpsError("failed-precondition", "Invalid report manifest. Rebuild required.");
    let pages;
    try { pages = await mapBounded(summary.dayIds, 8, async id => {
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpsError("failed-precondition", "Invalid report manifest.");
      const snap = await db.collection("players").doc(playerId).collection("insightSummaryDays").doc(id).get();
      const data = snap.data();
      if (!data || data.version !== PROJECTION_VERSION || data.revisionId !== summary.revisionId) throw new HttpsError("aborted", "The complete report is being rebuilt. Retry to refresh.");
      return data;
    }); } catch (error) {
      if (error.code !== "aborted" || !repairMissingPage || !(typeof allowRebuild === "function" ? allowRebuild() : allowRebuild)) throw error;
      await rebuildInsightPlayer(playerId);
      return loadInsightPlayer(playerId, { allowRebuild: false, repairMissingPage: false });
    }
    return { summary, testing: pages.flatMap(page => page.testing), workouts: pages.flatMap(page => page.workouts), failures: pages.flatMap(page => page.failures) };
  }
  return { invalidateInsightPlayer, rebuildInsightPlayer, loadInsightPlayer };
}
module.exports = { createInsightProjection, completeQuery, mapBounded, failureMatchesRep, PROJECTION_VERSION, MAX_AGE_MS, sourceEventHash, REBUILD_LEASE_MS };
