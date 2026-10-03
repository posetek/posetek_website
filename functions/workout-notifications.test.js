"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createWorkoutNotifications, executionIdentity, QUIET_MS, RETRY_WINDOW_MS, LEASE_MS } = require("./workout-notifications");
const { createResendProvider, verifyResendWebhook, RECIPIENT, FROM } = require("./workout-notifications-provider");
const { createMicrosoftEmail } = require("./microsoft-email");
const NOW = Date.parse("2026-09-28T18:00:00Z");
const UUID = "11111111-1111-4111-8111-111111111111", OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const AUTH = { uid: "athlete", email: "athlete@example.com", emailVerified: true };
const ADMIN = { uid: "admin", email: "dylank@posetek.net", emailVerified: true };
const baseLog = (source = "workoutLogs") => ({ schemaVersion: source === "workoutLogs" ? 2 : 1,
  ...(source === "workoutLogs" ? { planId: "plan", source: "plan" } : { source: "personal" }),
  workoutId: "workout", startedAt: NOW - 600000, workoutRevision: 1,
  workoutSnapshot: { title: "Ball control", blocks: [{ blockId: "ball", name: "Ball work", sets: 3 }, { blockId: "jump", name: "Jump", sets: 2 }] },
  blocks: [{ blockId: "ball", status: "partial", setsCompleted: 1 }], activeSeconds: 125 });

// Local range support for bounded-work-queue unit tests; the independent suite
// exercises the actual Firestore SDK and query semantics in its emulator.
class QueueFirestore extends FakeFirestore {
  constructor(seed) { super(seed); this.versions = new Map(); }
  runTransaction(handler) {
    return super.runTransaction(tx => {
      const get = tx.get.bind(tx);
      tx.get = async ref => {
        const snapshot = await get(ref), version = this.versions.get(ref.path);
        if (version) snapshot.updateTime = { toMillis: () => version };
        return snapshot;
      };
      return handler(tx);
    });
  }
  collection(name) {
    const adapt = q => {
      const where = q.where.bind(q), limit = q.limit.bind(q), orderBy = q.orderBy.bind(q);
      q.where = (...args) => adapt(where(...args)); q.limit = (...args) => adapt(limit(...args)); q.orderBy = (...args) => adapt(orderBy(...args));
      q.matches = data => q.filters.every(([field, op, value]) => op === "==" ? data[field] === value : op === ">" ? data[field] > value : op === "<=" ? data[field] <= value : false);
      return q;
    };
    return adapt(super.collection(name));
  }
}
function fixture(extra = {}) {
  let time = NOW, lease = 0;
  const db = new QueueFirestore({ "workoutNotificationSettings/current": { enabled: true, sendEnabled: true, activatedAtMillis: NOW - 1000 },
    "players/player": { authenticationUID: "athlete", firstName: "Test", lastName: "Athlete", organizationId: "club", teamId: "team" },
    "organizations/club": { name: "Test Club" }, "teams/team": { name: "U14", organizationId: "club" },
    "players/player/workoutLogs/plan_workout": baseLog(), "players/player/personalWorkoutLogs/workout": baseLog("personalWorkoutLogs"), ...extra });
  const sends = [], provider = { send: async (payload, key) => { sends.push({ payload, key }); return { id: "email-1" }; } };
  const service = createWorkoutNotifications({ db, HttpsError, provider, now: () => time, randomId: () => `lease-${++lease}` });
  const path = source => `players/player/${source}/${source === "workoutLogs" ? "plan_workout" : "workout"}`;
  const identity = source => executionIdentity("player", source, source === "workoutLogs" ? "plan_workout" : "workout", db.snapshot(path(source))).executionId;
  const jobPath = (source = "workoutLogs", event = "terminal") => `workoutNotificationOutbox/${identity(source)}_${event}`;
  const statePath = (source = "workoutLogs") => `workoutNotificationActivity/${identity(source)}`;
  async function observe(source = "workoutLogs", patch = {}, eventAt = time) {
    const ref = db.doc(path(source)), before = await ref.get(); await ref.update(patch);
    const after = await ref.get(); await service.observe(source, { before, after }, { params: { playerId: "player", logId: ref.id }, timestamp: new Date(eventAt).toISOString() });
    return { before, after };
  }
  async function close(source = "workoutLogs", reason = "completed") { return observe(source, { endedAt: time, endReason: reason }); }
  function activity(sequence = 0, type = "resume", extra = {}) {
    return { source: "workoutLogs", logId: "plan_workout", sessionId: UUID, sequence, eventId: `${UUID}:${sequence}`, type,
      occurredAtMillis: time, ...(sequence ? { ownerEpoch: 1 } : {}), blockId: "ball", ...extra };
  }
  return { db, provider, sends, service, path, identity, jobPath, statePath, observe, close, activity, time: () => time, advance: ms => { time += ms; }, setTime: value => { time = value; } };
}

test("Microsoft workout routing holds when disabled and claims only unchanged recorded source", async () => {
  const f = fixture({ "microsoftEmailSettings/current": { enabled: false, connectionVerified: true, activatedAtMillis: NOW - 1, senderMailbox: "alerts@posetek.net" } });
  await f.db.doc("workoutNotificationSettings/current").update({ emailProvider: "microsoft" });
  await f.close();
  const id = f.db.snapshot(f.jobPath()).id;
  await f.service.dispatch(id); assert.equal(f.sends.length, 0);
  await f.db.doc("microsoftEmailSettings/current").update({ enabled: true });
  f.provider.send = async (payload, key, job) => { f.sends.push({ payload, key, job }); return { pending: true }; };
  await f.service.dispatch(id);
  assert.equal(f.sends[0].job.deliveryProvider, "microsoft"); assert.deepEqual(f.sends[0].payload.to, [RECIPIENT]);
  assert.equal(f.db.snapshot(f.jobPath()).status, "pending");
  // Direct save reached Firestore but its normal observer has not run yet.
  await f.db.doc(f.path("workoutLogs")).update({ activeSeconds: 200 });
  const ms = createMicrosoftEmail({ db: f.db, now: f.time });
  assert.equal((await ms.claim({ schemaVersion: 1, kind: "workout", jobId: id, runId: "run-workout" })).allowSend, false);
  assert.equal(f.db.snapshot(f.jobPath()).status, "cancelled");
});

test("a consumed Microsoft workout claim cannot be resent by expired dispatcher leases", async () => {
  const f = fixture({ "microsoftEmailSettings/current": { enabled: true, connectionVerified: true, activatedAtMillis: NOW - 1, senderMailbox: "alerts@posetek.net" } });
  await f.db.doc("workoutNotificationSettings/current").update({ emailProvider: "microsoft" }); await f.close();
  const id = f.db.snapshot(f.jobPath()).id, ms = createMicrosoftEmail({ db: f.db, now: f.time });
  let c;
  f.provider.send = async (_payload, _key, job) => { f.sends.push(job); c = await ms.claim({ schemaVersion: 1, kind: "workout", jobId: id, runId: "run-workout" }); throw new Error("wake response lost"); };
  await f.service.dispatch(id); assert.equal(c.allowSend, true);
  f.advance(24 * 3600000); await f.service.dispatch(id); assert.equal(f.sends.length, 1);
  assert.equal(f.db.snapshot(f.jobPath()).dispatchAfterMillis, null);
});

test("settings absent, invalid activation, sending disabled and pilot selection fail closed", async () => {
  for (const settings of [undefined, { enabled: true }, { enabled: true, activatedAtMillis: NOW + 1000 }, { enabled: true, activatedAtMillis: NOW - 1, testPlayerIds: [] }]) {
    const f = fixture(); if (settings) await f.db.doc("workoutNotificationSettings/current").set(settings); else await f.db.doc("workoutNotificationSettings/current").delete();
    await f.close(); assert.equal(f.db.snapshot(f.jobPath()), undefined);
  }
  const f = fixture(); await f.db.doc("workoutNotificationSettings/current").update({ sendEnabled: false });
  await f.close(); await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.sends.length, 0);
  await f.db.doc("workoutNotificationSettings/current").update({ sendEnabled: true, testPlayerIds: ["different-player"] });
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.db.snapshot(f.jobPath()).status, "cancelled");
  const status = await f.service.getWorkoutNotificationStatus({ playerId: "player", source: "workoutLogs", logId: "plan_workout" }, ADMIN);
  assert.equal(status.settings.pilot, true); assert.equal(status.settings.playerIncluded, false);
});

test("both log collections notify terminal outcomes once and keep personal/assigned identities separate", async () => {
  const f = fixture(); await f.close(); await f.close("personalWorkoutLogs", "pain");
  assert.notEqual(f.identity("workoutLogs"), f.identity("personalWorkoutLogs"));
  for (const source of ["workoutLogs", "personalWorkoutLogs"]) {
    const job = f.db.snapshot(f.jobPath(source)); await Promise.all([f.service.dispatch(job.id), f.service.dispatch(job.id)]);
    assert.equal(f.db.snapshot(f.jobPath(source)).status, "accepted");
  }
  assert.equal(f.sends.length, 2); assert.match(f.sends[1].payload.subject, /pain reported/);
  assert.equal(f.sends[0].payload.to[0], RECIPIENT); assert.equal(f.sends[0].payload.from, FROM);
  assert.match(f.sends[0].payload.text, /Test Club/); assert.match(f.sends[0].payload.text, /U14/);
  assert.match(f.sends[0].payload.text, /Not recorded complete/);
});

test("duplicate triggers and edits to already-ended logs never create another terminal message", async () => {
  const f = fixture(), change = await f.close();
  const context = { params: { playerId: "player", logId: "plan_workout" }, timestamp: new Date(NOW).toISOString() };
  await Promise.all([f.service.observe("workoutLogs", change, context), f.service.observe("workoutLogs", change, context)]);
  await f.observe("workoutLogs", { endReason: "endedEarly" });
  assert.equal([...f.db.docs.keys()].filter(p => p.startsWith("workoutNotificationOutbox/")).length, 1);
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.sends.length, 0); // ending changed before send
});

test("old events, historical ended imports and deleted documents produce no mail", async () => {
  const f = fixture(); await f.observe("workoutLogs", { endedAt: NOW, endReason: "completed" }, NOW - 2000);
  assert.equal(f.db.snapshot(f.jobPath()), undefined);
  const old = { ...baseLog(), endedAt: NOW - 2000, endReason: "completed" };
  await f.db.doc(f.path("workoutLogs")).set(old);
  await f.service.observe("workoutLogs", { before: { exists: false, data: () => undefined }, after: await f.db.doc(f.path("workoutLogs")).get() },
    { params: { playerId: "player", logId: "plan_workout" }, timestamp: new Date(NOW).toISOString() });
  await f.service.observe("workoutLogs", { after: { exists: false } }, { params: { playerId: "player", logId: "plan_workout" } });
  assert.equal(f.db.snapshot(f.jobPath()), undefined);
});

test("native-only unfinished logs never acquire inactivity deadlines; terminal outcomes still work", async () => {
  const f = fixture(); await f.observe(); assert.equal(f.db.snapshot(f.statePath()).quietDueAtMillis, null);
  f.advance(QUIET_MS + 1); await f.service.sweep(); assert.equal(f.db.snapshot(f.jobPath("workoutLogs", "inactivity")), undefined);
  await f.close("workoutLogs", "endedEarly"); await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.sends.length, 1);
});

test("all supported terminal reasons are explicit; missing/invalid endings and prescriptions remain unknown", async () => {
  for (const [source, reasons] of [["workoutLogs", ["completed", "endedEarly", "abandoned"]], ["personalWorkoutLogs", ["completed", "stopped", "pain"]]]) {
    for (const reason of reasons) { const f = fixture(); await f.close(source, reason); assert.equal(f.db.snapshot(f.jobPath(source)).summary.endReason, reason); }
  }
  for (const patch of [{ endReason: "completed" }, { endReason: "completed", endedAt: NOW + 120000 }, { endReason: "anything", endedAt: NOW }, { endReason: "completed", endedAt: NOW - 700000 }]) {
    const f = fixture(); await f.observe("workoutLogs", patch); assert.equal(f.db.snapshot(f.jobPath()), undefined);
  }
  for (const blocks of [undefined, "malformed", [null], [{ blockId: "x", name: "Missing sets" }]]) {
    const f = fixture(); await f.db.doc(f.path("workoutLogs")).update({ workoutSnapshot: { title: "Historical", ...(blocks === undefined ? {} : { blocks }) }, activeSeconds: null });
    await f.close(); await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
    assert.match(f.sends[0].payload.text, /Unknown prescription/); assert.match(f.sends[0].payload.text, /estimated elapsed minutes/);
  }
});

test("claim acknowledgement retry recovers epoch; stale owners, reordered events and old timestamps cannot renew", async () => {
  const f = fixture(), claim = f.activity(); const accepted = await f.service.recordWorkoutActivity(claim, AUTH);
  assert.equal(accepted.ownerEpoch, 1); assert.equal((await f.service.recordWorkoutActivity(claim, AUTH)).duplicate, true);
  f.advance(1000);
  const other = f.activity(0, "resume", { sessionId: OTHER_UUID, eventId: `${OTHER_UUID}:0` });
  assert.equal((await f.service.recordWorkoutActivity(other, AUTH)).ownerEpoch, 2);
  assert.equal((await f.service.recordWorkoutActivity(f.activity(1, "progress"), AUTH)).reason, "not-current-owner");
  assert.equal((await f.service.recordWorkoutActivity(claim, AUTH)).reason, "not-current-owner");
  const progress = f.activity(1, "progress", { sessionId: OTHER_UUID, eventId: `${OTHER_UUID}:1`, ownerEpoch: 2 });
  await f.service.recordWorkoutActivity(progress, AUTH);
  await assert.rejects(f.service.recordWorkoutActivity({ ...progress, type: "pause" }, AUTH), e => e.code === "already-exists");
  f.advance(121000);
  assert.equal((await f.service.recordWorkoutActivity({ ...progress, sequence: 2, eventId: `${OTHER_UUID}:2` }, AUTH)).reason, "stale");
});

test("heartbeat and pause update observation without extending inactivity; resume uses original recent event time", async () => {
  const f = fixture(); await f.service.recordWorkoutActivity(f.activity(), AUTH);
  const original = f.db.snapshot(f.statePath()); f.advance(60000);
  await f.service.recordWorkoutActivity(f.activity(1, "heartbeat"), AUTH);
  f.advance(60000); await f.service.recordWorkoutActivity(f.activity(2, "pause"), AUTH);
  const paused = f.db.snapshot(f.statePath()); assert.equal(paused.lastActivityAtMillis, original.lastActivityAtMillis);
  assert.equal(paused.quietDueAtMillis, original.quietDueAtMillis); assert.equal(paused.lastSeenAtMillis, f.time());
  f.advance(60000); await f.service.recordWorkoutActivity(f.activity(3, "resume", { occurredAtMillis: f.time() - 45000 }), AUTH);
  assert.equal(f.db.snapshot(f.statePath()).lastActivityAtMillis, f.time() - 45000);
});

test("30 minute quiet alert is provisional, cancelled before send on progress, and can be scheduled once later", async () => {
  const f = fixture(); await f.service.recordWorkoutActivity(f.activity(), AUTH); f.advance(QUIET_MS);
  await f.service.queueQuiet(f.identity("workoutLogs")); let job = f.db.snapshot(f.jobPath("workoutLogs", "inactivity"));
  assert.equal(job.status, "pending"); await f.service.recordWorkoutActivity(f.activity(1, "progress"), AUTH);
  assert.equal(f.db.snapshot(f.jobPath("workoutLogs", "inactivity")).status, "cancelled");
  f.advance(QUIET_MS); await f.service.queueQuiet(f.identity("workoutLogs")); job = f.db.snapshot(f.jobPath("workoutLogs", "inactivity"));
  await f.service.dispatch(job.id); assert.match(f.sends[0].payload.text, /no recorded ending/);
  assert.equal(f.db.snapshot(f.path("workoutLogs")).endedAt, undefined);
  await f.service.recordWorkoutActivity(f.activity(2, "resume"), AUTH); f.advance(QUIET_MS); await f.service.sweep();
  assert.equal(f.sends.length, 1);
  await f.close(); await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.sends.length, 2);
});

test("terminal save cancels pending quiet job, and sending rechecks newer activity even if observer is delayed", async () => {
  const f = fixture(); await f.service.recordWorkoutActivity(f.activity(), AUTH); f.advance(QUIET_MS);
  await f.service.queueQuiet(f.identity("workoutLogs"));
  await f.db.doc(f.path("workoutLogs")).update({ endedAt: f.time(), endReason: "completed" });
  const quiet = f.db.snapshot(f.jobPath("workoutLogs", "inactivity")); await f.service.dispatch(quiet.id);
  assert.equal(f.sends.length, 0); assert.equal(f.db.snapshot(f.jobPath("workoutLogs", "inactivity")).status, "cancelled");
});

test("saved progress before a delayed observer defers quiet queueing and cancels a queued quiet email", async () => {
  for (const queueFirst of [false, true]) {
    const f = fixture(); f.db.versions.set(f.path("workoutLogs"), NOW - 100);
    await f.service.recordWorkoutActivity(f.activity(), AUTH); f.advance(QUIET_MS);
    if (queueFirst) await f.service.queueQuiet(f.identity("workoutLogs"));
    await f.db.doc(f.path("workoutLogs")).update({ blocks: [{ blockId: "ball", status: "partial", setsCompleted: 2 }] });
    f.db.versions.set(f.path("workoutLogs"), f.time() - 15000);
    // A connection signal sees the changed log but may not consume its saved
    // version and conceal the progress from the independent dispatcher check.
    await f.service.recordWorkoutActivity(f.activity(1, "heartbeat"), AUTH);
    if (queueFirst) await f.service.dispatch(f.db.snapshot(f.jobPath("workoutLogs", "inactivity")).id);
    else await f.service.queueQuiet(f.identity("workoutLogs"));
    assert.equal(f.sends.length, 0);
    assert.equal(f.db.snapshot(f.statePath()).lastActivityAtMillis, f.time() - 15000);
    assert.equal(f.db.snapshot(f.statePath()).quietDueAtMillis, f.time() - 15000 + QUIET_MS);
    assert.equal(f.db.snapshot(f.jobPath("workoutLogs", "inactivity"))?.status, queueFirst ? "cancelled" : undefined);
    f.advance(QUIET_MS); await f.service.sweep(); assert.equal(f.sends.length, 1);
  }
});

test("quiet dispatch detects changed saved content even without SDK version metadata", async () => {
  const f = fixture(); await f.service.recordWorkoutActivity(f.activity(), AUTH); f.advance(QUIET_MS);
  await f.service.queueQuiet(f.identity("workoutLogs"));
  await f.db.doc(f.path("workoutLogs")).update({ activeSeconds: 250 });
  await f.service.dispatch(f.db.snapshot(f.jobPath("workoutLogs", "inactivity")).id);
  assert.equal(f.sends.length, 0); assert.equal(f.db.snapshot(f.jobPath("workoutLogs", "inactivity")).status, "cancelled");
  assert.equal(f.db.snapshot(f.statePath()).quietDueAtMillis, f.time() + QUIET_MS);
});

test("late duplicate aliases preserve the preferred snapshot, activity version and one terminal job", async () => {
  const f = fixture(); await f.service.recordWorkoutActivity(f.activity(), AUTH);
  const original = f.db.snapshot(f.statePath()); f.advance(60000);
  const duplicate = f.db.doc("players/player/workoutLogs/legacy_duplicate");
  await duplicate.set({ ...baseLog(), workoutSnapshot: null });
  const context = { params: { playerId: "player", logId: duplicate.id }, timestamp: new Date(f.time()).toISOString() };
  await f.service.observe("workoutLogs", { before: { data: () => undefined }, after: await duplicate.get() }, context);
  assert.equal(f.db.snapshot(f.statePath()).logId, "plan_workout");
  assert.equal(f.db.snapshot(f.statePath()).lastActivityAtMillis, original.lastActivityAtMillis);
  assert.equal(f.db.snapshot(f.statePath()).quietDueAtMillis, original.quietDueAtMillis);
  await f.close();
  const before = await duplicate.get(); await duplicate.update({ endedAt: f.time() + 1, endReason: "abandoned" });
  await f.service.observe("workoutLogs", { before, after: await duplicate.get() }, context);
  assert.equal(f.db.snapshot(f.statePath()).logId, "plan_workout");
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
  assert.equal(f.sends.length, 1); assert.match(f.sends[0].payload.subject, /Workout completed/);
});

test("duplicate preference uses newest ending then stable ID when both records have snapshots", async () => {
  const f = fixture(); await f.close();
  const duplicate = f.db.doc("players/player/workoutLogs/aaa_duplicate");
  const emit = async end => {
    const before = await duplicate.get(); await duplicate.set({ ...baseLog(), endedAt: end, endReason: "completed" });
    await f.service.observe("workoutLogs", { before, after: await duplicate.get() },
      { params: { playerId: "player", logId: duplicate.id }, timestamp: new Date(f.time()).toISOString() });
  };
  await emit(NOW - 1); assert.equal(f.db.snapshot(f.statePath()).logId, "plan_workout");
  await emit(NOW); assert.equal(f.db.snapshot(f.statePath()).logId, "aaa_duplicate");
  assert.equal(f.db.snapshot(f.jobPath()).logId, "aaa_duplicate");
  f.advance(1000); await f.observe("workoutLogs", { endedAt: f.time() });
  assert.equal(f.db.snapshot(f.statePath()).logId, "plan_workout");
  assert.equal(f.db.snapshot(f.jobPath()).logId, "plan_workout");
});

test("a preferred duplicate rebinds an unsent ending, or waits for its own ending when still open", async () => {
  for (const alreadyEnded of [false, true]) {
    const f = fixture(), duplicate = f.db.doc("players/player/workoutLogs/legacy_duplicate");
    await duplicate.set({ ...baseLog(), workoutSnapshot: null, endedAt: NOW, endReason: "abandoned" });
    await f.service.observe("workoutLogs", { before: { data: () => undefined }, after: await duplicate.get() },
      { params: { playerId: "player", logId: duplicate.id }, timestamp: new Date(NOW).toISOString() });
    assert.equal(f.db.snapshot(f.jobPath()).logId, "legacy_duplicate");
    f.advance(1000);
    if (alreadyEnded) await f.close();
    else {
      await f.observe(); assert.equal(f.db.snapshot(f.jobPath()).status, "cancelled");
      await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.sends.length, 0);
      await f.close();
    }
    assert.equal(f.db.snapshot(f.jobPath()).logId, "plan_workout");
    await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
    assert.equal(f.sends.length, 1); assert.match(f.sends[0].payload.subject, /Workout completed/);
  }
});

test("an attempted legacy alias payload stays frozen and conflicting preferred record needs review", async () => {
  const f = fixture(), duplicate = f.db.doc("players/player/workoutLogs/legacy_duplicate");
  await duplicate.set({ ...baseLog(), workoutSnapshot: null, endedAt: NOW, endReason: "abandoned" });
  await f.service.observe("workoutLogs", { before: { data: () => undefined }, after: await duplicate.get() },
    { params: { playerId: "player", logId: duplicate.id }, timestamp: new Date(NOW).toISOString() });
  f.provider.send = async payload => { f.sends.push(payload); throw new Error("lost acceptance"); };
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
  const frozen = f.db.snapshot(f.jobPath()).payload;
  f.advance(1000); await f.close();
  assert.deepEqual(f.db.snapshot(f.jobPath()).payload, frozen);
  f.advance(60000); await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
  assert.equal(f.sends.length, 1); assert.equal(f.db.snapshot(f.jobPath()).status, "needs_review");
});

test("activity rejects administrators, staff, ambiguous bindings, foreign workout and unpinned blocks", async () => {
  const f = fixture();
  await assert.rejects(f.service.recordWorkoutActivity(f.activity(), ADMIN), e => e.code === "permission-denied");
  await assert.rejects(f.service.recordWorkoutActivity(f.activity(), null), e => e.code === "unauthenticated");
  await assert.rejects(f.service.recordWorkoutActivity(f.activity(0, "resume", { blockId: "not-prescribed" }), AUTH), e => e.code === "invalid-argument");
  await assert.rejects(f.service.recordWorkoutActivity(f.activity(0, "resume", { logId: "someone-else" }), AUTH), e => e.code === "not-found");
  await f.db.doc("players/duplicate").set({ authenticationUID: "athlete" });
  await assert.rejects(f.service.recordWorkoutActivity(f.activity(), AUTH), e => e.code === "permission-denied");
  await f.db.doc("players/duplicate").delete(); await f.db.doc("organizations/club/members/athlete").set({ userUID: "athlete", role: "coach" });
  await assert.rejects(f.service.recordWorkoutActivity(f.activity(), AUTH), e => e.code === "permission-denied");
});

test("status is admin-only and omits frozen email payload, recipient secrets and session ownership", async () => {
  const f = fixture(); await f.close(); const data = { playerId: "player", source: "workoutLogs", logId: "plan_workout" };
  await assert.rejects(f.service.getWorkoutNotificationStatus(data, AUTH), e => e.code === "permission-denied");
  await assert.rejects(f.service.getWorkoutNotificationStatus(data, { ...ADMIN, emailVerified: false }), e => e.code === "permission-denied");
  const status = await f.service.getWorkoutNotificationStatus(data, ADMIN);
  assert.equal(status.notifications.length, 1); assert.equal(status.settings.recipient, RECIPIENT);
  for (const key of ["payload", "summary", "ownerSessionId", "providerId", "leaseId"]) assert.equal(JSON.stringify(status).includes(`"${key}"`), false);
});

test("provider timeout retry preserves exact frozen payload and idempotency; concurrent dispatch sends once", async () => {
  const f = fixture(); await f.close(); const job = f.db.snapshot(f.jobPath());
  f.provider.send = async (payload, key) => { f.sends.push({ payload, key }); if (f.sends.length === 1) throw new Error("lost response"); return { id: "email-2" }; };
  await f.service.dispatch(job.id); assert.equal(f.db.snapshot(f.jobPath()).status, "pending");
  await f.db.doc("players/player").update({ firstName: "Changed" }); f.advance(60000);
  await Promise.all([f.service.dispatch(job.id), f.service.dispatch(job.id)]);
  assert.equal(f.sends.length, 2); assert.deepEqual(f.sends[0], f.sends[1]); assert.equal(f.db.snapshot(f.jobPath()).status, "accepted");
});

test("expired worker lease recovers inside 23 hours; uncertain sends never retry after cutoff", async () => {
  const f = fixture(); await f.close(); const job = f.db.snapshot(f.jobPath());
  await f.db.doc(f.jobPath()).update({ status: "sending", leaseId: "dead-worker", attempts: 1, firstAttemptAtMillis: NOW, dispatchAfterMillis: NOW + LEASE_MS });
  f.advance(LEASE_MS); await f.service.dispatch(job.id); assert.equal(f.sends.length, 1);
  const g = fixture(); await g.close(); g.provider.send = async () => { throw new Error("uncertain"); };
  await g.service.dispatch(g.db.snapshot(g.jobPath()).id); g.advance(RETRY_WINDOW_MS);
  await g.service.dispatch(g.db.snapshot(g.jobPath()).id); assert.equal(g.db.snapshot(g.jobPath()).status, "needs_review");
  assert.equal(g.db.snapshot(g.jobPath()).dispatchAfterMillis, null);
});

test("permanent rejection fails once, but prior uncertain acceptance needs review", async () => {
  const f = fixture(); await f.close(); f.provider.send = async () => { throw Object.assign(new Error("bad key"), { permanent: true, code: "provider_http_401" }); };
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.db.snapshot(f.jobPath()).status, "failed");
  const g = fixture(); await g.close(); g.provider.send = async () => { throw new Error("timeout"); };
  await g.service.dispatch(g.db.snapshot(g.jobPath()).id); g.advance(60000); g.provider.send = f.provider.send;
  await g.service.dispatch(g.db.snapshot(g.jobPath()).id); assert.equal(g.db.snapshot(g.jobPath()).status, "needs_review");
  const h = fixture(); await h.close();
  let originalResponse;
  h.provider.send = async () => new Promise(resolve => { originalResponse = resolve; });
  const attempt = h.service.dispatch(h.db.snapshot(h.jobPath()).id);
  // Wait for the original transaction to lease the job, without resolving the
  // external call, then simulate recovery after a worker's lease expires.
  while (!originalResponse) await new Promise(resolve => setImmediate(resolve));
  const frozen = h.db.snapshot(h.jobPath()).payload;
  h.advance(LEASE_MS); h.provider.send = async payload => { assert.deepEqual(payload, frozen); throw Object.assign(new Error("rejected"), { permanent: true }); };
  await h.service.dispatch(h.db.snapshot(h.jobPath()).id);
  assert.equal(h.db.snapshot(h.jobPath()).status, "needs_review"); assert.equal(h.db.snapshot(h.jobPath()).deliveryUncertain, true);
  originalResponse({ id: "late-acceptance" }); await attempt;
  assert.equal(h.db.snapshot(h.jobPath()).status, "needs_review");
});

test("scheduled queries are bounded and process only due server-owned work", async () => {
  const f = fixture(); await f.service.recordWorkoutActivity(f.activity(), AUTH); f.advance(QUIET_MS + 1);
  const result = await f.service.sweep(); assert.equal(result.activityChecked, 1); assert.equal(result.deliveriesChecked, 1); assert.equal(f.sends.length, 1);
  assert.ok(f.db.queries.filter(q => q.path.startsWith("workoutNotification")).every(q => q.filters.some(v => v[1] === "<=")));
});

test("email HTML escapes athlete/drill content, preserves skip reasons, and rejects wrong-club team label", async () => {
  const f = fixture(); await f.db.doc("players/player").update({ firstName: '<script>alert("x")</script>' });
  await f.db.doc("teams/team").update({ organizationId: "other" });
  await f.observe("workoutLogs", { blocks: [{ blockId: "ball", status: "skipped", setsCompleted: 1, skipReason: "tooTired" }] });
  await f.close(); await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
  assert.ok(!f.sends[0].payload.html.includes("<script>")); assert.match(f.sends[0].payload.html, /&lt;script&gt;/);
  assert.match(f.sends[0].payload.text, /tooTired/); assert.ok(!f.sends[0].payload.text.includes("U14"));
});

function delivery(f, type = "email.delivered", overrides = {}) {
  return { id: `event-${type}`, event: { type, created_at: new Date(f.time()).toISOString(), data: { email_id: "email-1", from: FROM, to: [RECIPIENT], tags: { posetek_outbox: f.db.snapshot(f.jobPath()).id } }, ...overrides } };
}
test("verified webhooks deduplicate, reconcile uncertain acceptance and never downgrade delivered to sent", async () => {
  const f = fixture(); await f.close(); f.provider.send = async () => { throw new Error("lost acceptance"); }; await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
  const event = delivery(f); await f.service.webhook(event); assert.equal(f.db.snapshot(f.jobPath()).status, "delivered");
  assert.equal((await f.service.webhook(event)).duplicate, true);
  f.advance(1000); await f.service.webhook(delivery(f, "email.sent")); assert.equal(f.db.snapshot(f.jobPath()).status, "delivered");
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.db.snapshot(f.jobPath()).attempts, 1);
});

test("webhook provider ID/recipient binding and out-of-order delivery protection", async () => {
  const f = fixture(); await f.close(); await f.service.dispatch(f.db.snapshot(f.jobPath()).id);
  let event = delivery(f); event.event.data.email_id = "wrong-email"; assert.equal((await f.service.webhook(event)).ignored, true);
  event = delivery(f); event.event.data.to = ["stranger@example.com"]; assert.equal((await f.service.webhook(event)).ignored, true);
  f.advance(2000); await f.service.webhook(delivery(f, "email.bounced"));
  await f.service.webhook(delivery(f, "email.delivered")); assert.equal(f.db.snapshot(f.jobPath()).status, "bounced");
  const old = delivery(f, "email.delivered", { created_at: new Date(NOW).toISOString() }); await f.service.webhook(old);
  assert.equal(f.db.snapshot(f.jobPath()).status, "bounced");
});

test("webhook arriving before send response wins over the API acknowledgement", async () => {
  const f = fixture(); await f.close(); f.provider.send = async () => { await f.service.webhook(delivery(f)); return { id: "email-1" }; };
  await f.service.dispatch(f.db.snapshot(f.jobPath()).id); assert.equal(f.db.snapshot(f.jobPath()).status, "delivered");
});

test("Resend adapter bounds timeout, fixed recipient, safe errors and retry classifications", async () => {
  let options;
  const provider = createResendProvider({ apiKey: () => "fixture-only", fetchImpl: async (_, opts) => { options = opts; return { ok: true, json: async () => ({ id: "email-test" }) }; } });
  const payload = { from: FROM, to: [RECIPIENT], text: "Synthetic", subject: "Synthetic" };
  assert.equal((await provider.send(payload, "opaque-key")).id, "email-test"); assert.equal(options.headers["Idempotency-Key"], "opaque-key");
  assert.ok(options.signal instanceof AbortSignal);
  await assert.rejects(provider.send({ ...payload, to: ["wrong@example.com"] }, "k"), e => e.permanent === true);
  for (const code of [401, 422, 429, 500, 409]) {
    const p = createResendProvider({ apiKey: () => "fixture-only", fetchImpl: async () => ({ ok: false, status: code, headers: { get: () => "120" }, text: async () => "sensitive provider detail" }) });
    await assert.rejects(p.send(payload, "k"), e => e.permanent === [401, 422].includes(code) && e.retryAfterMs === 120000 && !e.message.includes("sensitive"));
  }
});

test("raw-body Svix verification rejects forgery, changed bytes, old/future timestamps and malformed JSON", () => {
  const secret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`, id = "msg_123", timestamp = String(NOW / 1000), body = Buffer.from('{"type":"email.sent"}');
  const sign = raw => `v1,${crypto.createHmac("sha256", Buffer.alloc(32, 9)).update(`${id}.${timestamp}.`).update(raw).digest("base64")}`;
  const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": sign(body) };
  assert.equal(verifyResendWebhook(body, headers, secret, NOW).event.type, "email.sent");
  assert.throws(() => verifyResendWebhook(Buffer.from('{}'), headers, secret, NOW));
  assert.throws(() => verifyResendWebhook(body, headers, secret, NOW + 301000));
  assert.throws(() => verifyResendWebhook(body, headers, secret, NOW - 301000));
  assert.throws(() => verifyResendWebhook(body, { ...headers, "svix-signature": "v1,bad" }, secret, NOW));
  const broken = Buffer.from("not-json"); assert.throws(() => verifyResendWebhook(broken, { ...headers, "svix-signature": sign(broken) }, secret, NOW));
});
