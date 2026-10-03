"use strict";

const crypto = require("node:crypto");
const { isClubAdmin } = require("./club-access");
const { playerSegment } = require("./athlete-storage-paths");
const { millis, workoutEvents } = require("./insights-v2-qualification");
const { RECIPIENT, FROM } = require("./workout-notifications-provider");
const Microsoft = require("./microsoft-email-model");
const QUIET_MS = 30 * 60000, RETRY_WINDOW_MS = 23 * 3600000, LEASE_MS = 120000;
const SOURCES = ["workoutLogs", "personalWorkoutLogs"];
const TYPES = ["resume", "progress", "pause", "heartbeat"];
const FINAL_DELIVERY = new Set(["accepted", "delivered", "delayed", "bounced", "suppressed", "failed", "needs_review", "cancelled"]);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value, max = 150) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "";
const finiteTime = value => { const n = millis(value); return Number.isFinite(n) && n > 0 ? n : null; };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateText = value => value === null ? "Not recorded" : new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "long" }).format(value);
function settingsValue(doc, now) {
  const activatedAtMillis = finiteTime(doc?.activatedAtMillis);
  const testPlayerIds = doc?.testPlayerIds;
  const validPilot = testPlayerIds === undefined || Array.isArray(testPlayerIds) && testPlayerIds.length >= 1 && testPlayerIds.length <= 50
    && testPlayerIds.every(playerSegment) && new Set(testPlayerIds).size === testPlayerIds.length;
  return { enabled: doc?.enabled === true && activatedAtMillis !== null && activatedAtMillis <= now && validPilot,
    sendEnabled: doc?.sendEnabled === true, emailProvider: doc?.emailProvider, activatedAtMillis, recipient: RECIPIENT, quietMinutes: 30,
    pilot: testPlayerIds !== undefined, testPlayerIds: validPilot && testPlayerIds !== undefined ? testPlayerIds : null };
}
function playerIncluded(settings, playerId) { return !settings.pilot || settings.testPlayerIds?.includes(playerId) === true; }
function executionIdentity(playerId, source, logId, log) {
  const namespace = source === "personalWorkoutLogs" ? `personal:${log.workoutId || logId}`
    : log.planId && log.workoutId && log.source !== "adhoc" ? `plan:${log.planId}:${log.workoutId}` : `adhoc:${log.workoutId || logId}`;
  return { executionId: hash([playerId, namespace]), namespace };
}
function ending(log, source, now) {
  const start = finiteTime(log?.startedAt), end = finiteTime(log?.endedAt);
  const allowed = source === "personalWorkoutLogs" ? ["completed", "stopped", "pain"] : ["completed", "endedEarly", "abandoned"];
  return start !== null && end !== null && end >= start && end <= now + 60000 && allowed.includes(log.endReason) ? log.endReason : null;
}
function validLog(log, source) {
  return log && [1, 2].includes(log.schemaVersion) && Array.isArray(log.blocks) && log.blocks.length <= 200
    && finiteTime(log.startedAt) !== null && (log.workoutId === undefined || playerSegment(log.workoutId))
    && (source === "personalWorkoutLogs" ? playerSegment(log.workoutId) : typeof log.planId === "string" && log.planId.length <= 256);
}
function normalizedLog(log, source, id) {
  const frozen = log.workoutSnapshot?.blocks;
  const validPrescription = Array.isArray(frozen) && frozen.length <= 200 && frozen.every(b => b && typeof b.blockId === "string");
  return { ...log, id, ...(validPrescription ? {} : { workoutSnapshot: null }),
    source: source === "personalWorkoutLogs" ? "personal" : log.source === "adhoc" ? "adhoc" : "plan" };
}
function savedFingerprint(log) {
  return hash([finiteTime(log.startedAt), finiteTime(log.endedAt), log.endReason || null, log.blocks,
    log.activeSeconds ?? null, log.workoutRevision ?? null, log.workoutSnapshot ?? null]);
}
function snapshotSummary(playerId, source, logId, log, player, org, team, activity, now) {
  const normalized = normalizedLog(log, source, logId), report = workoutEvents([normalized])[0];
  const blocks = (Array.isArray(log.workoutSnapshot?.blocks) ? log.workoutSnapshot.blocks : []).filter(b => b && typeof b.blockId === "string").slice(0, 200);
  const counts = new Map(log.blocks.filter(row => row && typeof row.blockId === "string").map(row => [row.blockId, row]));
  const rows = blocks.map(block => { const row = counts.get(block.blockId) || {}; return {
    name: text(block.name) || "Drill", sets: Number.isSafeInteger(block.sets ?? block.dose?.sets) ? Math.max(0, block.sets ?? block.dose?.sets) : null,
    setsCompleted: Number.isSafeInteger(row.setsCompleted) && row.setsCompleted >= 0 ? Math.min(row.setsCompleted, 10000) : 0,
    status: ["done", "partial", "skipped"].includes(row.status) ? row.status : "not recorded",
    skipReason: ["pain", "time", "equipment", "tooHard", "tooEasy", "other", "fatigue", "tooTired", "noSpace"].includes(row.skipReason) ? row.skipReason : null,
  }; });
  const selected = blocks.find(block => block.blockId === activity?.blockId);
  return { playerId, source, logId, playerName: text([player.firstName, player.lastName].filter(Boolean).join(" ")) || text(player.name) || "Player",
    organizationName: text(org?.name) || null, teamName: text(team?.name) || null,
    workoutTitle: text(log.workoutSnapshot?.title) || text(log.title) || "Workout", startedAtMillis: finiteTime(log.startedAt), endedAtMillis: finiteTime(log.endedAt),
    endReason: ending(log, source, now), durationSource: report.durationSource, timerMinutes: report.timerMinutes, estimatedMinutes: report.estimatedMinutes,
    doneBlocks: report.doneBlocks, partialBlocks: report.partialBlocks, skippedBlocks: report.skippedBlocks, setsCompleted: report.setsCompleted,
    allPrescribedSetsCompleted: report.allPrescribedSetsCompleted === 1, unknownPrescription: report.unknownPrescription === 1, rows,
    lastActivityAtMillis: activity?.lastActivityAtMillis || null, lastSignal: activity?.lastSignal || null, selectedDrill: text(selected?.name) || null,
    adminUrl: `https://posetek.net/admin/accounts/player/${encodeURIComponent(playerId)}?workoutSource=${source}&workoutLog=${encodeURIComponent(logId)}` };
}
function emailPayload(summary, eventType, id) {
  const status = eventType === "inactivity" ? "No recent workout activity" : ({ completed: "Workout completed", endedEarly: "Workout ended early", stopped: "Workout stopped", pain: "Workout stopped — pain reported", abandoned: "Workout abandoned" }[summary.endReason] || "Workout ended");
  const lines = [`${summary.playerName} — ${status}`, `${summary.workoutTitle} (${summary.source === "personalWorkoutLogs" ? "Personal" : "Assigned / ad-hoc"})`,
    ...[summary.organizationName, summary.teamName].filter(Boolean), `Started: ${dateText(summary.startedAtMillis)}`,
    ...(eventType === "inactivity" ? [`Last recorded workout activity: ${dateText(summary.lastActivityAtMillis)}`, "No workout progress or resume has reached PoseTek for at least 30 minutes. The workout has no recorded ending; a pause or connectivity may explain the silence."] : [`Ended: ${dateText(summary.endedAtMillis)}`]),
    `Duration: ${summary.durationSource === "timer" ? `${Math.round(summary.timerMinutes * 10) / 10} timer minutes` : summary.durationSource === "estimate" ? `${Math.round(summary.estimatedMinutes * 10) / 10} estimated elapsed minutes` : "Not recorded"}`,
    `Reported progress: ${summary.setsCompleted} sets; ${summary.doneBlocks} done, ${summary.partialBlocks} partial, ${summary.skippedBlocks} skipped drills.`,
    `Every prescribed set: ${summary.unknownPrescription ? "Unknown prescription" : summary.allPrescribedSetsCompleted ? "Recorded complete" : "Not recorded complete"}`,
    ...(summary.selectedDrill ? [`Last selected drill: ${summary.selectedDrill}`] : []),
    ...summary.rows.map(row => `${row.name}: ${row.setsCompleted}/${row.sets ?? "?"} sets · ${row.status}${row.skipReason ? ` (${row.skipReason})` : ""}`),
    "Times are Pacific. These are reported workout records, not measured attendance.", `Open protected workout history: ${summary.adminUrl}`];
  return { from: FROM, to: [RECIPIENT], subject: `${status}: ${summary.playerName} · ${summary.workoutTitle}`.slice(0, 220),
    text: lines.join("\n\n"), html: `<div>${lines.slice(0, -1).map(line => `<p>${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(summary.adminUrl)}">Open protected workout history</a></p></div>`,
    tags: [{ name: "posetek_outbox", value: id }] };
}

function createWorkoutNotifications({ db, HttpsError, provider, now = Date.now, randomId = () => crypto.randomUUID() }) {
  const settingsRef = db.collection("workoutNotificationSettings").doc("current");
  const activityRef = id => db.collection("workoutNotificationActivity").doc(id);
  const outboxRef = id => db.collection("workoutNotificationOutbox").doc(id);
  const logRef = (playerId, source, logId) => db.collection("players").doc(playerId).collection(source).doc(logId);
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const pathValid = (source, id) => SOURCES.includes(source) && playerSegment(id);
  const isFuture = (settings, at) => settings.enabled && at !== null && at >= settings.activatedAtMillis;
  async function preferredLog(tx, playerId, source, incoming, state, executionId) {
    if (state.source !== source || !playerSegment(state.logId) || state.logId === incoming.id) return incoming;
    const previous = await tx.get(logRef(playerId, source, state.logId)), log = previous.data();
    if (!validLog(log, source) || executionIdentity(playerId, source, previous.id, log).executionId !== executionId) return incoming;
    // Match the existing history qualification preference. A late callback for
    // a legacy duplicate must not replace the execution's preferred record.
    return [previous, incoming].sort((a, b) => Number(Boolean(b.data().workoutSnapshot)) - Number(Boolean(a.data().workoutSnapshot))
      || (finiteTime(b.data().endedAt) || 0) - (finiteTime(a.data().endedAt) || 0) || a.id.localeCompare(b.id))[0];
  }
  function savedObservation(state, snapshot, at, fallback = at) {
    const fingerprint = savedFingerprint(snapshot.data());
    const savedAt = Math.min(at, finiteTime(snapshot.updateTime) || fallback);
    const changed = state.logId !== snapshot.id || fingerprint !== state.savedFingerprint || savedAt > (state.lastSavedAtMillis || 0);
    return { changed, savedFingerprint: fingerprint, lastSavedAtMillis: savedAt,
      lastActivityAtMillis: Math.max(state.lastActivityAtMillis || 0, changed ? savedAt : 0) };
  }
  function reconcileQuiet(tx, ref, state, snapshot, job, at) {
    const saved = savedObservation(state, snapshot, at, state.savedFingerprint === savedFingerprint(snapshot.data()) ? state.lastSavedAtMillis || at : at);
    if (!saved.changed) return false;
    tx.update(ref, { savedFingerprint: saved.savedFingerprint, lastSavedAtMillis: saved.lastSavedAtMillis,
      lastActivityAtMillis: saved.lastActivityAtMillis, lastSignal: "saved", updatedAtMillis: at,
      quietDueAtMillis: job.data()?.firstAttemptAtMillis ? null : saved.lastActivityAtMillis + QUIET_MS });
    cancelQuiet(tx, job, at);
    return true;
  }
  async function related(tx, playerId) {
    const player = await tx.get(db.collection("players").doc(playerId));
    if (!player.exists) return null;
    const profile = player.data();
    const org = playerSegment(profile.organizationId) ? await tx.get(db.collection("organizations").doc(profile.organizationId)) : null;
    const team = playerSegment(profile.teamId) ? await tx.get(db.collection("teams").doc(profile.teamId)) : null;
    return { player: profile, org: org?.data(), team: team?.exists && profile.organizationId && team.data().organizationId === profile.organizationId ? team.data() : undefined };
  }
  function newJob(state, log, records, eventType, at) {
    const id = `${state.executionId}_${eventType}`;
    return { schemaVersion: 1, id, executionId: state.executionId, playerId: state.playerId, source: state.source, logId: state.logId, eventType,
      status: "pending", createdAtMillis: at, dispatchAfterMillis: at, attempts: 0, firstAttemptAtMillis: null, lastAttemptAtMillis: null,
      acceptedAtMillis: null, deliveredAtMillis: null, providerId: null, leaseId: null, failureMessage: null,
      basedOnActivityAtMillis: state.lastActivityAtMillis, basedOnSavedAtMillis: state.lastSavedAtMillis || null,
      basedOnSavedFingerprint: state.savedFingerprint || null, endingFingerprint: hash([log.endReason || null, finiteTime(log.endedAt)]),
      summary: snapshotSummary(state.playerId, state.source, state.logId, log, records.player, records.org, records.team, state, at) };
  }
  function cancelQuiet(tx, snapshot, at) {
    if (!snapshot.exists || !["pending", "sending"].includes(snapshot.data().status)) return;
    tx.update(snapshot.ref, { status: snapshot.data().firstAttemptAtMillis ? "needs_review" : "cancelled", dispatchAfterMillis: null, leaseId: null,
      failureMessage: snapshot.data().firstAttemptAtMillis ? "Workout activity changed after an email attempt; delivery needs review." : "New activity or a workout ending superseded this quiet alert.", updatedAtMillis: at });
  }
  async function observe(source, change, context) {
    const playerId = context.params?.playerId, id = context.params?.logId;
    if (!playerSegment(playerId) || !pathValid(source, id) || !change.after?.exists) return;
    const eventAt = finiteTime(context.timestamp), after = change.after.data(), before = change.before?.data?.();
    if (!validLog(after, source)) return;
    return db.runTransaction(async tx => {
      const at = now(), settings = settingsValue((await tx.get(settingsRef)).data(), at);
      if (!isFuture(settings, eventAt) || !playerIncluded(settings, playerId)) return;
      const incoming = await tx.get(logRef(playerId, source, id));
      if (!validLog(incoming.data(), source)) return;
      const identity = executionIdentity(playerId, source, id, incoming.data()), stateRef = activityRef(identity.executionId);
      const stateDoc = await tx.get(stateRef), previous = stateDoc.data() || {};
      const current = await preferredLog(tx, playerId, source, incoming, previous, identity.executionId), log = current.data();
      const saved = savedObservation(previous, current, at, current.id === id && previous.savedFingerprint !== savedFingerprint(log) ? eventAt : previous.lastSavedAtMillis || eventAt);
      const terminalRef = outboxRef(`${identity.executionId}_terminal`), quietRef = outboxRef(`${identity.executionId}_inactivity`);
      const [terminal, quiet] = await Promise.all([tx.get(terminalRef), tx.get(quietRef)]);
      const records = await related(tx, playerId);
      if (!records) return;
      const reason = ending(log, source, at);
      const state = { ...previous, ...identity, playerId, source, logId: current.id, lastSavedAtMillis: saved.lastSavedAtMillis, savedFingerprint: saved.savedFingerprint,
        lastActivityAtMillis: saved.lastActivityAtMillis, lastSignal: saved.changed && saved.lastSavedAtMillis >= (previous.lastActivityAtMillis || 0) ? "saved" : previous.lastSignal || "saved",
        quietDueAtMillis: !previous.webObserved || reason || log.endedAt || quiet.data()?.firstAttemptAtMillis ? null : saved.lastActivityAtMillis + QUIET_MS, updatedAtMillis: at };
      tx.set(stateRef, state);
      if (reason || log.endedAt || saved.changed) cancelQuiet(tx, quiet, at);
      // Before any provider attempt, the one terminal slot may follow a better
      // duplicate. If its preferred record is open, wait for that record's own
      // future ending. An attempted payload is never rewritten or resent anew.
      const terminalJob = terminal.data();
      if (terminalJob?.status === "pending" && !terminalJob.firstAttemptAtMillis && terminalJob.logId !== current.id) {
        if (reason && finiteTime(log.endedAt) >= settings.activatedAtMillis) tx.set(terminalRef, newJob(state, log, records, "terminal", at));
        else tx.update(terminalRef, { status: "cancelled", dispatchAfterMillis: null,
          failureMessage: "The preferred workout record has no eligible saved ending." });
      }
      // A new terminal transition is required; updates to historical finished
      // logs and old offline imports cannot generate a launch-time mail flood.
      if ((!terminal.exists || terminalJob.status === "cancelled" && !terminalJob.firstAttemptAtMillis)
        && current.id === id && reason && ending(after, source, at) && !finiteTime(before?.endedAt)
        && finiteTime(after.endedAt) >= settings.activatedAtMillis && finiteTime(log.endedAt) >= settings.activatedAtMillis) {
        if (terminal.exists) tx.set(terminalRef, newJob(state, log, records, "terminal", at));
        else tx.create(terminalRef, newJob(state, log, records, "terminal", at));
      }
    });
  }
  async function selfPlayer(tx, auth) {
    if (!auth?.uid || !playerSegment(auth.uid) || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
    if (isClubAdmin(auth)) fail("permission-denied", "Workout activity belongs to the signed-in athlete.");
    const matches = new Map();
    for (const field of ["authenticationUID", "userUID"]) for (const row of (await tx.get(db.collection("players").where(field, "==", auth.uid).limit(2))).docs) matches.set(row.id, row);
    const direct = await tx.get(db.collection("players").doc(auth.uid)); if (direct.exists) matches.set(direct.id, direct);
    const coach = await tx.get(db.collection("coaches").doc(auth.uid)), coaches = await tx.get(db.collection("coaches").where("userUID", "==", auth.uid).limit(1));
    if (coach.exists || !coaches.empty || matches.size !== 1) fail("permission-denied", "A single athlete account is required.");
    const row = [...matches.values()][0], profile = row.data();
    if (["authenticationUID", "userUID"].some(key => Object.hasOwn(profile, key) && profile[key] !== auth.uid)) fail("permission-denied", "Athlete identity changed.");
    if (profile.organizationId) {
      if (!playerSegment(profile.organizationId)) fail("permission-denied", "Invalid organization binding.");
      const member = await tx.get(db.collection("organizations").doc(profile.organizationId).collection("members").doc(auth.uid));
      if (member.exists) fail("permission-denied", "Staff activity is not athlete workout activity.");
    }
    return row;
  }
  async function recordWorkoutActivity(data, auth) {
    if (!auth?.uid || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
    if (!data || Object.keys(data).some(k => !["source", "logId", "sessionId", "eventId", "sequence", "type", "occurredAtMillis", "ownerEpoch", "blockId"].includes(k))
      || !pathValid(data.source, data.logId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.sessionId || "")
      || !Number.isSafeInteger(data.sequence) || data.sequence < 0 || data.sequence > 1000000000 || data.eventId !== `${data.sessionId}:${data.sequence}`
      || !TYPES.includes(data.type) || !Number.isSafeInteger(data.occurredAtMillis)
      || (data.ownerEpoch !== undefined && (!Number.isSafeInteger(data.ownerEpoch) || data.ownerEpoch < 1))
      || (data.blockId !== undefined && (typeof data.blockId !== "string" || data.blockId.length > 150))) fail("invalid-argument", "Invalid workout activity event.");
    return db.runTransaction(async tx => {
      const at = now(), settings = settingsValue((await tx.get(settingsRef)).data(), at);
      if (!settings.enabled) return { accepted: false, reason: "disabled" };
      const player = await selfPlayer(tx, auth);
      if (!playerIncluded(settings, player.id)) return { accepted: false, reason: "disabled" };
      const incoming = await tx.get(logRef(player.id, data.source, data.logId));
      if (!validLog(incoming.data(), data.source)) fail("not-found", "The saved workout was not found.");
      const identity = executionIdentity(player.id, data.source, data.logId, incoming.data()), ref = activityRef(identity.executionId);
      const state = (await tx.get(ref)).data() || {}, sessionRef = ref.collection("sessions").doc(hash([auth.uid, data.sessionId]));
      const logDoc = await preferredLog(tx, player.id, data.source, incoming, state, identity.executionId), log = logDoc.data();
      if (incoming.data().endedAt || log.endedAt) return { accepted: false, reason: "ended" };
      if (data.blockId && (!Array.isArray(log.workoutSnapshot?.blocks) || !log.workoutSnapshot.blocks.some(b => b?.blockId === data.blockId))) fail("invalid-argument", "The selected drill is not in the saved workout.");
      const previous = (await tx.get(sessionRef)).data(), quiet = await tx.get(outboxRef(`${identity.executionId}_inactivity`));
      const digest = hash(data), owns = state.ownerSessionId === data.sessionId;
      // Lost claim acknowledgements are recoverable without issuing a new owner.
      if (previous && previous.sequence === data.sequence && previous.eventId === data.eventId) {
        if (previous.digest !== digest) fail("already-exists", "That activity identity has different content.");
        return owns ? { accepted: true, duplicate: true, ownerEpoch: state.ownerEpoch, serverTimeMillis: at } : { accepted: false, reason: "not-current-owner" };
      }
      if (data.occurredAtMillis < at - 120000 || data.occurredAtMillis > at + 60000 || data.occurredAtMillis < settings.activatedAtMillis
        || previous && data.sequence <= previous.sequence) return { accepted: false, reason: "stale" };
      let epoch = state.ownerEpoch || 0;
      if (!previous) {
        if (data.type !== "resume" || data.sequence !== 0 || data.ownerEpoch !== undefined) return { accepted: false, reason: "not-current-owner" };
        if (data.occurredAtMillis < (state.ownerClaimedAtMillis || 0)) return { accepted: false, reason: "stale" };
        epoch++;
      } else if (!owns || data.ownerEpoch !== epoch) return { accepted: false, reason: "not-current-owner" };
      const rateWindow = Math.floor(at / 60000), rateCount = state.rateWindow === rateWindow ? state.rateCount || 0 : 0;
      if (rateCount >= 20) fail("resource-exhausted", "Workout activity rate exceeded; wait before retrying.");
      // Clock ticks and Pause are observations, not progress. Preserve the
      // original recent action time across transport retries; neither a stuck
      // foreground tab nor a delayed acknowledgement postpones a quiet alert.
      const meaningful = data.type === "resume" || data.type === "progress";
      const activityAt = meaningful ? Math.max(state.lastActivityAtMillis || 0, Math.min(at, data.occurredAtMillis)) : state.lastActivityAtMillis;
      tx.set(ref, { ...state, ...identity, playerId: player.id, source: data.source, logId: logDoc.id,
        // A non-progress signal must not consume a saved version that the log
        // observer (or the dispatcher recheck) has not yet reconciled.
        ...(meaningful || !state.savedFingerprint ? { savedFingerprint: savedFingerprint(log), lastSavedAtMillis: finiteTime(logDoc.updateTime) || at } : {}),
        ownerSessionId: data.sessionId, ownerEpoch: epoch, ownerClaimedAtMillis: previous ? state.ownerClaimedAtMillis : data.occurredAtMillis,
        webObserved: true, lastActivityAtMillis: activityAt, lastSeenAtMillis: at, lastSignal: data.type, blockId: data.blockId || state.blockId || null,
        quietDueAtMillis: quiet.data()?.firstAttemptAtMillis ? null : meaningful ? activityAt + QUIET_MS : state.quietDueAtMillis || null,
        rateWindow, rateCount: rateCount + 1, updatedAtMillis: at });
      tx.set(sessionRef, { sequence: data.sequence, eventId: data.eventId, digest, ownerEpoch: epoch, updatedAtMillis: at });
      if (meaningful) cancelQuiet(tx, quiet, at);
      return { accepted: true, ownerEpoch: epoch, serverTimeMillis: at };
    });
  }
  async function queueQuiet(id) {
    return db.runTransaction(async tx => {
      const at = now(), settings = settingsValue((await tx.get(settingsRef)).data(), at);
      if (!settings.enabled) return;
      const ref = activityRef(id), stateDoc = await tx.get(ref), state = stateDoc.data();
      if (!state || !state.webObserved || !state.quietDueAtMillis || state.quietDueAtMillis > at) return;
      const logDoc = await tx.get(logRef(state.playerId, state.source, state.logId)), log = logDoc.data();
      const jobRef = outboxRef(`${id}_inactivity`), job = await tx.get(jobRef);
      const records = await related(tx, state.playerId);
      if (!validLog(log, state.source) || log.endedAt || !records || !playerIncluded(settings, state.playerId) || state.lastActivityAtMillis < settings.activatedAtMillis) {
        tx.update(ref, { quietDueAtMillis: null }); cancelQuiet(tx, job, at); return;
      }
      if (reconcileQuiet(tx, ref, state, logDoc, job, at)) return;
      if (!job.exists || job.data().status === "cancelled" && !job.data().firstAttemptAtMillis) tx.set(jobRef, newJob(state, log, records, "inactivity", at));
      tx.update(ref, { quietDueAtMillis: null });
    });
  }
  async function dispatch(id) {
    if (!/^[a-f0-9]{64}_(terminal|inactivity)$/.test(id || "")) return;
    const claimed = await db.runTransaction(async tx => {
      const at = now(), settings = settingsValue((await tx.get(settingsRef)).data(), at);
      if (!settings.enabled || !settings.sendEnabled) return null;
      const ref = outboxRef(id), snapshot = await tx.get(ref), job = snapshot.data();
      if (!job || FINAL_DELIVERY.has(job.status) || !job.dispatchAfterMillis || job.dispatchAfterMillis > at) return null;
      const deliveryProvider = Microsoft.providerFor(job, settings);
      const microsoftConfig = deliveryProvider === "microsoft" ? (await tx.get(db.doc(Microsoft.SETTINGS))).data() : null;
      if (!deliveryProvider || deliveryProvider === "microsoft" && (!Microsoft.enabled(microsoftConfig, "workout", id, job.createdAtMillis, at) || job.microsoft?.claimedAtMillis)) return null;
      const stateRef = activityRef(job.executionId), state = (await tx.get(stateRef)).data();
      const logDoc = await tx.get(logRef(job.playerId, job.source, job.logId)), log = logDoc.data();
      const records = await related(tx, job.playerId);
      const changed = !state || !validLog(log, job.source) || !records || !playerIncluded(settings, job.playerId) || job.createdAtMillis < settings.activatedAtMillis
        || state.source !== job.source || state.logId !== job.logId
        || (job.eventType === "inactivity" ? !state.webObserved || log.endedAt || state.lastActivityAtMillis !== job.basedOnActivityAtMillis || state.lastActivityAtMillis + QUIET_MS > at
          : !ending(log, job.source, at) || hash([log.endReason || null, finiteTime(log.endedAt)]) !== job.endingFingerprint);
      if (changed) {
        tx.update(ref, { status: job.firstAttemptAtMillis ? "needs_review" : "cancelled", dispatchAfterMillis: null, leaseId: null,
          failureMessage: job.firstAttemptAtMillis ? "The workout changed after an email attempt; delivery needs review." : "The notification was superseded before sending." }); return null;
      }
      // A direct workout save may arrive before its asynchronous observer.
      // Reconcile the actual saved version inside this transaction before any
      // external request can claim that the execution has been quiet.
      if (job.eventType === "inactivity" && reconcileQuiet(tx, stateRef, state, logDoc, snapshot, at)) return null;
      if (deliveryProvider === "resend" && job.firstAttemptAtMillis && at >= job.firstAttemptAtMillis + RETRY_WINDOW_MS) {
        tx.update(ref, { status: "needs_review", dispatchAfterMillis: null, leaseId: null, failureMessage: "The safe email retry window expired; delivery needs review." }); return null;
      }
      const summary = job.payload ? job.summary : snapshotSummary(job.playerId, job.source, job.logId, log, records.player, records.org, records.team, state, at);
      const rawPayload = job.payload || emailPayload(summary, job.eventType, id), leaseId = randomId();
      const route = deliveryProvider === "microsoft" && !job.microsoft ? Microsoft.freeze("workout", id, rawPayload, microsoftConfig, at,
        { logPath: logRef(job.playerId, job.source, job.logId).path, fingerprint: savedFingerprint(log) }) : { deliveryProvider, payload: rawPayload };
      const payload = route.payload;
      tx.update(ref, { ...route, status: "sending", leaseId, summary, dispatchAfterMillis: at + LEASE_MS, lastAttemptAtMillis: at,
        deliveryUncertain: job.deliveryUncertain === true || job.status === "sending",
        firstAttemptAtMillis: job.firstAttemptAtMillis || at, attempts: (job.attempts || 0) + 1, failureMessage: null });
      return { ...job, ...route, summary, payload, leaseId, firstAttemptAtMillis: job.firstAttemptAtMillis || at, attempts: (job.attempts || 0) + 1 };
    });
    if (!claimed) return;
    let result, error;
    try { result = await provider.send(claimed.payload, `posetek-workout/${id}`, { ...claimed, kind: "workout", id }); } catch (caught) { error = caught; }
    await db.runTransaction(async tx => {
      const ref = outboxRef(id), latest = (await tx.get(ref)).data();
      if (!latest || latest.leaseId !== claimed.leaseId || latest.status !== "sending") return;
      const at = now();
      if (result?.id && claimed.deliveryProvider !== "microsoft") {
        tx.update(ref, { status: "accepted", providerId: result.id, acceptedAtMillis: at, dispatchAfterMillis: null, leaseId: null, failureMessage: null });
        if (claimed.eventType === "inactivity") tx.set(activityRef(claimed.executionId), { inactivityNotified: true }, { merge: true });
      } else {
        const delay = Math.max(Math.min(3600000, 60000 * 2 ** Math.min(claimed.attempts - 1, 6)), Number(error?.retryAfterMs) || 0);
        const expired = claimed.deliveryProvider !== "microsoft" && at + delay >= claimed.firstAttemptAtMillis + RETRY_WINDOW_MS, needsReview = expired || error?.permanent && latest.deliveryUncertain;
        tx.update(ref, { status: needsReview ? "needs_review" : error?.permanent ? "failed" : "pending", leaseId: null,
          dispatchAfterMillis: error?.permanent || expired ? null : at + delay,
          deliveryUncertain: latest.deliveryUncertain === true || !error?.permanent,
        failureMessage: needsReview ? "Email acceptance remains uncertain; delivery needs review." : claimed.deliveryProvider === "microsoft" ? "Waiting for the Microsoft send claim or receipt; no second send is authorized." : error?.permanent ? "The email provider rejected this request; operator action is required." : "The email attempt was not confirmed. A safe retry is scheduled.",
          failureCode: result?.pending ? null : /^provider_[a-z0-9_]{1,50}$/.test(error?.code || "") ? error.code : "provider_uncertain" });
      }
    });
  }
  async function sweep() {
    const settings = settingsValue((await settingsRef.get()).data(), now());
    if (!settings.enabled) return { activityChecked: 0, deliveriesChecked: 0 };
    const activity = await db.collection("workoutNotificationActivity").where("quietDueAtMillis", ">", 0).where("quietDueAtMillis", "<=", now()).orderBy("quietDueAtMillis").limit(50).get();
    for (const row of activity.docs) await queueQuiet(row.id);
    // Bounded batches, no player/catalog scans. A single ordered field uses its
    // default index; null deadlines remove settled jobs from the work queue.
    const jobs = settings.sendEnabled ? await db.collection("workoutNotificationOutbox").where("dispatchAfterMillis", ">", 0).where("dispatchAfterMillis", "<=", now()).orderBy("dispatchAfterMillis").limit(20).get() : { docs: [] };
    for (let i = 0; i < jobs.docs.length; i += 4) await Promise.all(jobs.docs.slice(i, i + 4).map(row => dispatch(row.id)));
    return { activityChecked: activity.docs.length, deliveriesChecked: jobs.docs.length };
  }
  async function getWorkoutNotificationStatus(data, auth) {
    if (!isClubAdmin(auth)) fail("permission-denied", "PoseTek administrator access is required.");
    if (!data || Object.keys(data).some(k => !["playerId", "source", "logId"].includes(k)) || !playerSegment(data.playerId) || !pathValid(data.source, data.logId)) fail("invalid-argument", "Choose an exact workout record.");
    const log = (await logRef(data.playerId, data.source, data.logId).get()).data();
    if (!validLog(log, data.source)) fail("not-found", "The workout record was not found.");
    const { executionId } = executionIdentity(data.playerId, data.source, data.logId, log);
    const [settingsDoc, stateDoc, terminal, quiet] = await Promise.all([settingsRef.get(), activityRef(executionId).get(), outboxRef(`${executionId}_terminal`).get(), outboxRef(`${executionId}_inactivity`).get()]);
    const settings = settingsValue(settingsDoc.data(), now()), state = stateDoc.data();
    return { settings: { enabled: settings.enabled, sendEnabled: settings.enabled && settings.sendEnabled, recipient: RECIPIENT, quietMinutes: 30,
      pilot: settings.pilot, playerIncluded: playerIncluded(settings, data.playerId) },
      notifications: [terminal, quiet].filter(row => row.exists).map(row => {
        const value = row.data(); return Object.fromEntries(["id", "eventType", "status", "createdAtMillis", "lastAttemptAtMillis", "acceptedAtMillis", "deliveredAtMillis", "deliveryObservedAtMillis", "deliveryProvider", "failureMessage"].map(key => [key, value[key] ?? null]));
      }), activity: state ? { lastActivityAtMillis: state.lastActivityAtMillis, lastSeenAtMillis: state.lastSeenAtMillis || null,
        lastSignal: state.lastSignal, blockId: state.blockId || null, webObserved: state.webObserved === true,
        quietDueAtMillis: state.quietDueAtMillis || null, inactivityNotified: state.inactivityNotified === true } : null,
      observedAtMillis: now() };
  }
  async function webhook({ id: eventId, event }) {
    const statuses = { "email.sent": "accepted", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.bounced": "bounced", "email.suppressed": "suppressed", "email.failed": "failed" };
    const status = statuses[event?.type], eventAt = finiteTime(event?.created_at), providerId = event?.data?.email_id;
    if (!status) return { ignored: true };
    if (!eventAt || eventAt > now() + 60000 || typeof providerId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(providerId)) fail("invalid-argument", "Invalid delivery event.");
    let id = event?.data?.tags?.posetek_outbox;
    if (typeof id !== "string" || !/^[a-f0-9]{64}_(terminal|inactivity)$/.test(id)) {
      const matches = await db.collection("workoutNotificationOutbox").where("providerId", "==", providerId).limit(2).get();
      if (matches.docs.length !== 1) return { ignored: true }; id = matches.docs[0].id;
    }
    return db.runTransaction(async tx => {
      const ref = outboxRef(id), job = (await tx.get(ref)).data(), receiptRef = ref.collection("webhookEvents").doc(hash(eventId));
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) return { duplicate: true };
      if (!job?.firstAttemptAtMillis || job.deliveryProvider === "microsoft" || !job.payload || (job.providerId && job.providerId !== providerId)
        || eventAt < job.firstAttemptAtMillis - 300000 || ![FROM, "workouts@alerts.posetek.net"].includes(event.data.from)
        || !Array.isArray(event.data.to) || event.data.to.length !== 1 || event.data.to[0] !== RECIPIENT) return { ignored: true };
      const digest = hash(event);
      tx.create(receiptRef, { eventType: event.type, eventAtMillis: eventAt, receivedAtMillis: now(), digest });
      const alreadyFinal = ["delivered", "bounced", "suppressed", "failed"].includes(job.status), incomingFinal = ["delivered", "bounced", "suppressed", "failed"].includes(status);
      const rank = { accepted: 1, delayed: 2, delivered: 3, failed: 4, bounced: 5, suppressed: 6 };
      if (eventAt < (job.lastProviderEventAtMillis || 0) || alreadyFinal && !incomingFinal
        || eventAt === job.lastProviderEventAtMillis && rank[status] <= (rank[job.status] || 0)) return { ignored: true };
      tx.update(ref, { status, providerId, lastProviderEventAtMillis: eventAt, acceptedAtMillis: job.acceptedAtMillis || eventAt,
        ...(status === "delivered" ? { deliveredAtMillis: eventAt } : {}), dispatchAfterMillis: null, leaseId: null,
        failureMessage: ["bounced", "suppressed", "failed"].includes(status) ? `The email provider reported ${status}.` : null });
      if (job.eventType === "inactivity") tx.set(activityRef(job.executionId), { inactivityNotified: true }, { merge: true });
      return { accepted: true };
    });
  }
  return { observe, recordWorkoutActivity, getWorkoutNotificationStatus, dispatch, sweep, queueQuiet, webhook };
}

module.exports = { createWorkoutNotifications, executionIdentity, emailPayload, settingsValue, snapshotSummary, ending, savedFingerprint, QUIET_MS, RETRY_WINDOW_MS, LEASE_MS };
