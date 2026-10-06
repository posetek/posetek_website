"use strict";

// Actual server SDK transactions against a disposable loopback emulator only.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8190
// GCLOUD_PROJECT=demo-workout-notifications-integration
// node --test functions/workout-notifications.emulator.cjs
const assert = require("node:assert/strict");
const { describe, test, before, after, beforeEach } = require("node:test");
const PROJECT = "demo-workout-notifications-integration", HOST = "127.0.0.1:8190";
if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || process.env.GCLOUD_PROJECT !== PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) {
  throw new Error("Refusing to run: the dedicated loopback Firestore emulator and demo project are required.");
}
const { Firestore, Timestamp } = require("@google-cloud/firestore");
const { HttpsError } = require("firebase-functions/v1/https");
const { createWorkoutNotifications, executionIdentity, QUIET_MS, LEASE_MS } = require("./workout-notifications");
const { FROM, RECIPIENT } = require("./workout-notifications-provider");
const db = new Firestore({ projectId: PROJECT, host: HOST, ssl: false });
const settings = db.doc("workoutNotificationSettings/current");
const PLAYER = "synthetic-player", AUTH = { uid: "synthetic-athlete-auth" };
const ADMIN = { uid: "synthetic-admin", email: "synthetic@posetek.net", emailVerified: true };
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111", OTHER_SESSION = "bbbbbbbb-2222-4222-8222-222222222222";
const collections = ["players", "coaches", "organizations", "teams", "workoutNotificationSettings", "workoutNotificationActivity", "workoutNotificationOutbox"];
let time, base, mode, lease, api, calls, releaseProvider, notifyProviderStarted;

function log(source = "workoutLogs", id = "slot") {
  return { schemaVersion: source === "personalWorkoutLogs" ? 1 : 2,
    ...(source === "workoutLogs" ? { planId: "plan", source: "plan" } : { source: "personal", revision: 1, elapsedSeconds: 60 }),
    workoutId: id, workoutRevision: 1, startedAt: Timestamp.fromMillis(time - 60_000),
    workoutSnapshot: { title: "Synthetic session", blocks: [
      { blockId: "b1", name: "Control", sets: 3 }, { blockId: "b2", name: "Passing", sets: 2 }], },
    blocks: [{ blockId: "b1", status: "partial", setsCompleted: 1 }], activeSeconds: 60 };
}
const refFor = (source, id) => db.doc(`players/${PLAYER}/${source}/${id}`);
const stateFor = (source, id, value) => db.doc(`workoutNotificationActivity/${executionIdentity(PLAYER, source, id, value).executionId}`);
const outboxFor = (source, id, value, type = "terminal") => db.doc(`workoutNotificationOutbox/${executionIdentity(PLAYER, source, id, value).executionId}_${type}`);
function event(sequence, type, extra = {}) {
  return { source: "workoutLogs", logId: "plan_slot", sessionId: SESSION, sequence, eventId: `${SESSION}:${sequence}`,
    type, occurredAtMillis: time, blockId: "b1", ...extra };
}
async function observe(source, id, next) {
  const ref = refFor(source, id), before = await ref.get();
  await ref.set(next);
  const after = await ref.get();
  const change = { before, after }, context = { params: { playerId: PLAYER, logId: id }, timestamp: new Date(time).toISOString() };
  await api.observe(source, change, context);
  return { ref, change, context };
}
async function clearDemo() {
  assert.equal(db.projectId, PROJECT);
  for (const name of collections) await db.recursiveDelete(db.collection(name));
}
async function reset() {
  await clearDemo();
  base = Date.now() + 2_000; time = base; mode = "accepted"; lease = 0; calls = [];
  releaseProvider = null; notifyProviderStarted = null;
  api = createWorkoutNotifications({ db, HttpsError, now: () => time, randomId: () => `lease-${++lease}`,
    provider: { send: async (payload, key) => {
      calls.push({ payload, key });
      if (mode === "uncertain") throw Object.assign(new Error("Synthetic lost acknowledgement"), { retryAfterMs: 60_000 });
      if (mode === "permanent") throw Object.assign(new Error("Synthetic provider rejection"), { permanent: true, code: "provider_http_401" });
      if (mode === "held-response") await new Promise(resolve => { releaseProvider = resolve; notifyProviderStarted(); });
      const id = `synthetic-email-${key.slice(-16).replace(/[^a-zA-Z0-9]/g, "")}`;
      if (mode === "delivered-before-response") await api.webhook({ id: `svix-${id}`, event: {
        type: "email.delivered", created_at: new Date(time).toISOString(), data: { email_id: id, from: FROM, to: [RECIPIENT],
          tags: { posetek_outbox: payload.tags.find(tag => tag.name === "posetek_outbox").value } },
      } });
      return { id };
    } } });
  const seed = db.batch();
  seed.set(settings, { enabled: true, sendEnabled: true, activatedAtMillis: base - 60_000 });
  seed.set(db.doc(`players/${PLAYER}`), { authenticationUID: AUTH.uid, userUID: AUTH.uid,
    firstName: "Synthetic", lastName: "Athlete", organizationId: "club", teamId: "team" });
  seed.set(db.doc("organizations/club"), { name: "Synthetic club" });
  seed.set(db.doc("teams/team"), { name: "Synthetic team", organizationId: "club" });
  await seed.commit();
}

describe("Workout notification real Firestore transactions", { concurrency: false, timeout: 120_000 }, () => {
  before(async () => { assert.equal(db.projectId, PROJECT); });
  beforeEach(reset);
  after(async () => { try { await clearDemo(); } finally { await db.terminate(); } });

  test("concurrent trigger retries create one terminal message and one provider request", async () => {
    const value = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" };
    const { change, context } = await observe("workoutLogs", "plan_slot", value);
    await Promise.all([api.observe("workoutLogs", change, context), api.observe("workoutLogs", change, context)]);
    const outbox = outboxFor("workoutLogs", "plan_slot", value);
    assert.equal((await db.collection("workoutNotificationOutbox").get()).size, 1);
    await Promise.all([api.dispatch(outbox.id), api.dispatch(outbox.id)]);
    assert.equal(calls.length, 1);
    assert.equal((await outbox.get()).data().status, "accepted");
    const status = await api.getWorkoutNotificationStatus({ playerId: PLAYER, source: "workoutLogs", logId: "plan_slot" }, ADMIN);
    assert.equal(status.notifications.length, 1); assert.equal(status.notifications[0].status, "accepted");
    assert.match(calls[0].payload.text, /Not recorded complete/);
    assert.match(calls[0].payload.text, /Synthetic team/);
    assert.deepEqual(calls[0].payload.to, [RECIPIENT]);
  });

  test("personal and assigned logs with the same workout ID retain distinct immutable identities", async () => {
    const assigned = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "endedEarly" };
    const personal = { ...log("personalWorkoutLogs"), endedAt: Timestamp.fromMillis(time), endReason: "pain" };
    await observe("workoutLogs", "plan_slot", assigned);
    await observe("personalWorkoutLogs", "slot", personal);
    const result = await api.sweep();
    assert.equal(result.deliveriesChecked, 2); assert.equal(calls.length, 2);
    assert.notEqual(calls[0].key, calls[1].key);
    assert.ok(calls.some(call => /pain reported/.test(call.payload.subject)));
    assert.ok(calls.some(call => /workoutSource=personalWorkoutLogs/.test(call.payload.text)));
  });

  test("an unsent duplicate execution uses its preferred saved snapshot and ending", async () => {
    const legacy = { ...log(), workoutSnapshot: null, endedAt: Timestamp.fromMillis(time), endReason: "abandoned" };
    await observe("workoutLogs", "legacy_alias", legacy);
    const outbox = outboxFor("workoutLogs", "legacy_alias", legacy);
    assert.equal((await outbox.get()).data().status, "pending");
    time += 1_000;
    const preferred = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" };
    await observe("workoutLogs", "plan_slot", preferred);
    assert.equal((await stateFor("workoutLogs", "plan_slot", preferred).get()).data().logId, "plan_slot");
    assert.equal((await db.collection("workoutNotificationOutbox").get()).size, 1);
    await api.dispatch(outbox.id);
    assert.equal(calls.length, 1);
    assert.match(calls[0].payload.subject, /Workout completed/);
    assert.match(calls[0].payload.text, /Control: 1\/3 sets/);
    assert.match(calls[0].payload.text, /workoutLog=plan_slot/);
    assert.equal((await outbox.get()).data().status, "accepted");
  });

  test("a preferred open alias cancels stale unsent ending and its later ending reuses the same slot", async () => {
    const legacy = { ...log(), workoutSnapshot: null, endedAt: Timestamp.fromMillis(time), endReason: "abandoned" };
    await observe("workoutLogs", "legacy_alias", legacy);
    const outbox = outboxFor("workoutLogs", "legacy_alias", legacy);
    time += 1_000;
    const preferred = log(); await observe("workoutLogs", "plan_slot", preferred);
    await api.dispatch(outbox.id);
    assert.equal((await outbox.get()).data().status, "cancelled"); assert.equal(calls.length, 0);
    time += 1_000;
    await observe("workoutLogs", "plan_slot", { ...preferred, endedAt: Timestamp.fromMillis(time), endReason: "completed" });
    assert.equal((await outbox.get()).data().status, "pending");
    await api.dispatch(outbox.id);
    assert.equal((await db.collection("workoutNotificationOutbox").get()).size, 1);
    assert.equal(calls.length, 1); assert.match(calls[0].payload.subject, /Workout completed/);
    assert.match(calls[0].payload.text, /workoutLog=plan_slot/);
  });

  test("a preferred alias change after uncertain send requires review and preserves the attempted payload", async () => {
    const legacy = { ...log(), workoutSnapshot: null, endedAt: Timestamp.fromMillis(time), endReason: "abandoned" };
    await observe("workoutLogs", "legacy_alias", legacy);
    const outbox = outboxFor("workoutLogs", "legacy_alias", legacy);
    mode = "uncertain"; await api.dispatch(outbox.id);
    const attempted = (await outbox.get()).data();
    time += 1_000;
    await observe("workoutLogs", "plan_slot", { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" });
    time = attempted.dispatchAfterMillis + 1; mode = "accepted";
    await api.dispatch(outbox.id);
    const result = (await outbox.get()).data();
    assert.equal(result.status, "needs_review"); assert.equal(result.dispatchAfterMillis, null);
    assert.deepEqual(result.payload, attempted.payload); assert.equal(calls.length, 1);
  });

  test("activity claims retry idempotently and reject stale owners through real query transactions", async () => {
    const value = log(); await observe("workoutLogs", "plan_slot", value);
    const claim = event(0, "resume");
    const results = await Promise.all([api.recordWorkoutActivity(claim, AUTH), api.recordWorkoutActivity(claim, AUTH)]);
    assert.ok(results.every(result => result.accepted && result.ownerEpoch === 1));
    time += 1_000;
    const second = await api.recordWorkoutActivity(event(0, "resume", { sessionId: OTHER_SESSION, eventId: `${OTHER_SESSION}:0` }), AUTH);
    assert.equal(second.ownerEpoch, 2);
    assert.deepEqual(await api.recordWorkoutActivity(event(1, "progress", { ownerEpoch: 1 }), AUTH), { accepted: false, reason: "not-current-owner" });
    const state = (await stateFor("workoutLogs", "plan_slot", value).get()).data();
    assert.equal(state.ownerSessionId, OTHER_SESSION); assert.equal(state.ownerEpoch, 2);
    await assert.rejects(api.recordWorkoutActivity(event(2, "progress", { ownerEpoch: 2, blockId: "unknown" }), AUTH), { code: "invalid-argument" });
  });

  test("heartbeats and pause preserve the explicit activity deadline and sweep finds overdue work", async () => {
    const value = log(); await observe("workoutLogs", "plan_slot", value);
    const claim = await api.recordWorkoutActivity(event(0, "resume"), AUTH);
    const ref = stateFor("workoutLogs", "plan_slot", value), initial = (await ref.get()).data();
    time += 20 * 60_000;
    assert.equal((await api.recordWorkoutActivity(event(1, "heartbeat", { ownerEpoch: claim.ownerEpoch }), AUTH)).accepted, true);
    time += 5 * 60_000;
    assert.equal((await api.recordWorkoutActivity(event(2, "pause", { ownerEpoch: claim.ownerEpoch, blockId: "b2" }), AUTH)).accepted, true);
    const paused = (await ref.get()).data();
    assert.equal(paused.lastActivityAtMillis, initial.lastActivityAtMillis);
    assert.equal(paused.quietDueAtMillis, initial.lastActivityAtMillis + QUIET_MS);
    time = initial.lastActivityAtMillis + QUIET_MS + 1;
    const result = await api.sweep();
    assert.equal(result.activityChecked, 1); assert.equal(result.deliveriesChecked, 1); assert.equal(calls.length, 1);
    assert.match(calls[0].payload.subject, /No recent workout activity/);
    assert.match(calls[0].payload.text, /Last selected drill: Passing/);
    assert.equal((await refFor("workoutLogs", "plan_slot").get()).data().endedAt, undefined);
  });

  test("new progress cancels an unsent inactivity message without altering saved workout evidence", async () => {
    const value = log(); await observe("workoutLogs", "plan_slot", value);
    const claim = await api.recordWorkoutActivity(event(0, "resume"), AUTH);
    const activity = stateFor("workoutLogs", "plan_slot", value);
    time += QUIET_MS + 1;
    await api.queueQuiet(activity.id);
    const quiet = outboxFor("workoutLogs", "plan_slot", value, "inactivity");
    assert.equal((await quiet.get()).data().status, "pending");
    await api.recordWorkoutActivity(event(1, "progress", { ownerEpoch: claim.ownerEpoch }), AUTH);
    await api.dispatch(quiet.id);
    assert.equal((await quiet.get()).data().status, "cancelled"); assert.equal(calls.length, 0);
    assert.deepEqual((await refFor("workoutLogs", "plan_slot").get()).data().blocks, value.blocks);
  });

  test("a native terminal write wins over queued web inactivity and yields one ending", async () => {
    const value = log(); await observe("workoutLogs", "plan_slot", value);
    await api.recordWorkoutActivity(event(0, "resume"), AUTH);
    const activity = stateFor("workoutLogs", "plan_slot", value);
    time += QUIET_MS + 1; await api.queueQuiet(activity.id);
    await observe("workoutLogs", "plan_slot", { ...value, endedAt: Timestamp.fromMillis(time), endReason: "endedEarly" });
    await api.sweep();
    assert.equal(calls.length, 1); assert.match(calls[0].payload.subject, /Workout ended early/);
    assert.equal((await outboxFor("workoutLogs", "plan_slot", value, "inactivity").get()).data().status, "cancelled");
  });

  test("queueing reconciles saved progress when its Firestore observer has not run", async () => {
    const value = log(); await observe("workoutLogs", "plan_slot", value);
    const activity = stateFor("workoutLogs", "plan_slot", value);
    time = (await activity.get()).data().lastActivityAtMillis;
    await api.recordWorkoutActivity(event(0, "resume"), AUTH);
    const initial = (await activity.get()).data();
    // Keep actual SDK updateTime authoritative while aging only the injected clock.
    await refFor("workoutLogs", "plan_slot").update({ blocks: [{ blockId: "b1", status: "partial", setsCompleted: 2 }] });
    const savedAt = (await refFor("workoutLogs", "plan_slot").get()).updateTime.toMillis();
    assert.ok(savedAt > initial.lastActivityAtMillis + 1);
    time = savedAt + QUIET_MS - 1;
    assert.ok(initial.quietDueAtMillis < time);
    await api.queueQuiet(activity.id);
    assert.equal((await outboxFor("workoutLogs", "plan_slot", value, "inactivity").get()).exists, false);
    const refreshed = (await activity.get()).data();
    assert.equal(refreshed.lastSavedAtMillis, savedAt);
    assert.equal(refreshed.lastActivityAtMillis, savedAt);
    assert.equal(refreshed.quietDueAtMillis, savedAt + QUIET_MS);
    assert.equal(calls.length, 0);
  });

  test("dispatch cancels queued inactivity when newer saved progress precedes its observer", async () => {
    const value = log(); await observe("workoutLogs", "plan_slot", value);
    const activity = stateFor("workoutLogs", "plan_slot", value);
    time = (await activity.get()).data().lastActivityAtMillis;
    await api.recordWorkoutActivity(event(0, "resume"), AUTH);
    time += QUIET_MS + 1; await api.queueQuiet(activity.id);
    const quiet = outboxFor("workoutLogs", "plan_slot", value, "inactivity");
    assert.equal((await quiet.get()).data().status, "pending");
    await refFor("workoutLogs", "plan_slot").update({ blocks: [{ blockId: "b1", status: "partial", setsCompleted: 2 }] });
    const savedAt = (await refFor("workoutLogs", "plan_slot").get()).updateTime.toMillis();
    await api.dispatch(quiet.id);
    assert.equal((await quiet.get()).data().status, "cancelled");
    const refreshed = (await activity.get()).data();
    assert.equal(refreshed.lastSavedAtMillis, savedAt);
    assert.equal(refreshed.lastActivityAtMillis, savedAt);
    assert.equal(refreshed.quietDueAtMillis, savedAt + QUIET_MS);
    assert.equal(calls.length, 0);
  });

  test("ambiguous provider failure retries the exact frozen payload and stable idempotency key", async () => {
    const value = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" };
    await observe("workoutLogs", "plan_slot", value); const outbox = outboxFor("workoutLogs", "plan_slot", value);
    mode = "uncertain"; await api.dispatch(outbox.id);
    const pending = (await outbox.get()).data(); assert.equal(pending.status, "pending");
    mode = "accepted"; time = pending.dispatchAfterMillis + 1; await api.sweep();
    assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
    assert.equal((await outbox.get()).data().status, "accepted");
  });

  test("expired sending lease retains uncertain delivery through rejection and a late first acknowledgement", async () => {
    const value = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" };
    await observe("workoutLogs", "plan_slot", value);
    const outbox = outboxFor("workoutLogs", "plan_slot", value);
    const started = new Promise(resolve => { notifyProviderStarted = resolve; });
    mode = "held-response";
    const firstAttempt = api.dispatch(outbox.id);
    try {
      await started;
      assert.equal((await outbox.get()).data().status, "sending");
      time += LEASE_MS + 1; mode = "permanent";
      await api.dispatch(outbox.id);
      const uncertain = (await outbox.get()).data();
      assert.equal(uncertain.status, "needs_review");
      assert.equal(uncertain.deliveryUncertain, true);
      assert.equal(uncertain.dispatchAfterMillis, null);
      assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
    } finally {
      releaseProvider?.(); await firstAttempt;
    }
    assert.equal((await outbox.get()).data().status, "needs_review");
    await api.sweep(); assert.equal(calls.length, 2);
  });

  test("a verified delivery arriving before provider acknowledgement is not downgraded", async () => {
    const value = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" };
    await observe("workoutLogs", "plan_slot", value); const outbox = outboxFor("workoutLogs", "plan_slot", value);
    mode = "delivered-before-response"; await api.dispatch(outbox.id);
    const delivered = (await outbox.get()).data(); assert.equal(delivered.status, "delivered");
    assert.equal(delivered.deliveredAtMillis, time); assert.equal(calls.length, 1);
    await api.sweep(); assert.equal(calls.length, 1);
  });

  test("disabled rollout, historical endings and staff cannot create athlete notifications", async () => {
    await settings.update({ enabled: false });
    const value = { ...log(), endedAt: Timestamp.fromMillis(time), endReason: "completed" };
    await observe("workoutLogs", "plan_slot", value);
    assert.equal((await db.collection("workoutNotificationOutbox").get()).size, 0);
    await settings.update({ enabled: true });
    await observe("workoutLogs", "plan_slot", { ...value, activeSeconds: 61 });
    assert.equal((await db.collection("workoutNotificationOutbox").get()).size, 0);
    await assert.rejects(api.recordWorkoutActivity(event(0, "resume"), ADMIN), { code: "permission-denied" });
    await assert.rejects(api.getWorkoutNotificationStatus({ playerId: PLAYER, source: "workoutLogs", logId: "plan_slot" }, AUTH), { code: "permission-denied" });
  });
});
