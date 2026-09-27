"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const {
  createTestingEvents,
  STATIONS,
  INVITE_TTL_MS,
  REPS_PER_PARTICIPANT,
  RESERVATIONS_PER_PARTICIPANT,
} = require("./testing-events");

const base = {
  "organizations/club": { schemaVersion: 2, name: "Test Club", memberUIDs: ["manager", "coach-a", "coach-b"] },
  "organizations/club/members/manager": { userUID: "manager", role: "manager", status: "active", teamIds: [] },
  "organizations/club/members/coach-a": { userUID: "coach-a", role: "coach", status: "active", teamIds: ["team-a"] },
  "organizations/club/members/coach-b": { userUID: "coach-b", role: "coach", status: "active", teamIds: ["team-b"] },
  "players/player-a": { organizationId: "club", teamId: "team-a", firstName: "Alex", lastName: "One", weight: 70 },
  "players/player-b": { organizationId: "club", teamId: "team-a", firstName: "Blair", lastName: "Two", weight: 61.5 },
  "players/player-c": { organizationId: "club", teamId: "team-b", firstName: "Casey", lastName: "Three", weight: 80 },
};

const auth = (uid, email = `${uid}@example.test`) => ({ uid, email, emailVerified: true, isAnonymous: false });
const admin = auth("admin", "admin@posetek.net");

function harness(seed = {}, clock = { value: 1000 }, overrides = {}) {
  const db = new FakeFirestore({ ...base, ...seed });
  const finalized = [];
  const testing = createTestingEvents({
    db,
    FieldValue,
    Timestamp: FakeTimestamp,
    HttpsError,
    now: () => clock.value,
    randomBytes: () => Buffer.alloc(24, 7),
    finalizePlayer: async (playerId) => { finalized.push(playerId); },
    ...overrides,
  });
  return { db, testing, clock, finalized };
}

async function draft(testing, playerIds = ["player-a", "player-b"], actor = auth("manager")) {
  return testing.createTestingEvent({ organizationId: "club", name: "Fall testing", playerIds }, actor);
}

test("fixed protocol is three stations and exactly twenty reps", () => {
  assert.equal(STATIONS.length, 3);
  assert.equal(REPS_PER_PARTICIPANT, 20);
  assert.equal(RESERVATIONS_PER_PARTICIPANT, 6);
  assert.deepEqual(STATIONS[1].drills[1].sides, ["left", "left", "right", "right"]);
  assert.deepEqual(STATIONS[2].drills[2].sides, ["left", "left", "right", "right"]);
});

test("manager creates immutable event snapshots and participant readiness", async () => {
  const { db, testing } = harness();
  const result = await draft(testing);
  assert.equal(result.status, "draft");
  const event = db.snapshot(`testingEvents/${result.eventId}`);
  assert.equal(event.ownerUid, "manager");
  assert.equal(event.repsPerParticipant, 20);
  assert.deepEqual(event.teamIds, ["team-a"]);
  assert.equal(event.protocolSnapshot.length, 3);
  assert.equal(db.snapshot(`testingEvents/${result.eventId}/participants/player-a`).weightKg, 70);
  assert.equal(db.snapshot(`testingEvents/${result.eventId}/stations/station-3`).markerCount, 2);
});

test("coach cannot include another team's player or forge organization access", async () => {
  const { testing } = harness();
  await assert.rejects(draft(testing, ["player-a", "player-c"], auth("coach-a")), { code: "permission-denied" });
  await assert.rejects(testing.createTestingEvent({ organizationId: "elsewhere", name: "No", playerIds: ["player-a"] }, auth("manager")), { code: "not-found" });
  const allowed = await draft(testing, ["player-a"], auth("coach-a"));
  assert.equal(allowed.participantCount, 1);
});

test("start proceeds without weight and keeps the missing status on the snapshot", async () => {
  const { db, testing } = harness({ "players/player-a": { ...base["players/player-a"], weight: null } });
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "live");
  const participant = db.snapshot(`testingEvents/${event.eventId}/participants/player-a`);
  assert.equal(participant.weightKg, null);
  assert.equal(participant.weightStatus, "missing");
  assert.notEqual(db.snapshot(`players/player-a/sessions/testing_${event.eventId}_station-1_jump`), undefined);
});

test("start refreshes weight from the canonical player after setup", async () => {
  const { db, testing } = harness({ "players/player-a": { ...base["players/player-a"], weight: null } });
  const event = await draft(testing, ["player-a"]);
  db.write("players/player-a", { weight: 72 }, { merge: true, create: false });
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${event.eventId}/participants/player-a`).weightKg, 72);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "live");
});

test("start reserves deterministic sessions and absolute ranges exactly once", async () => {
  const { db, testing } = harness({
    "players/player-a/sessions/old-jump": { sessionType: "jump", sessionNumber: 4 },
    "players/player-a/reps/old-jump": { repType: "jump", absoluteRepNumber: 9 },
  });
  const event = await draft(testing, ["player-a"]);
  const started = await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(started.reservationCount, RESERVATIONS_PER_PARTICIPANT);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "live");
  const jump = db.snapshot(`testingEvents/${event.eventId}/sessionReservations/station-1_player-a_jump`);
  assert.equal(jump.sessionNumber, 5);
  assert.equal(jump.absoluteRepStart, 10);
  assert.equal(jump.repCount, 3);
  assert.equal(db.snapshot(`players/player-a/sessions/${jump.sessionDocId}`).testingEventId, event.eventId);
  const counterBefore = db.snapshot("players/player-a/recordingCounters/jump");
  const retried = await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(retried.reservationCount, RESERVATIONS_PER_PARTICIPANT);
  assert.deepEqual(db.snapshot("players/player-a/recordingCounters/jump"), counterBefore);
});

test("start advances past legacy Storage session folders", async () => {
  const inspected = [];
  const { db, testing } = harness({}, { value: 1000 }, {
    storageSessionFloors: async (playerId) => {
      inspected.push(playerId);
      return { jump: 8 };
    },
  });
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const jump = db.snapshot(`testingEvents/${event.eventId}/sessionReservations/station-1_player-a_jump`);
  assert.equal(jump.sessionNumber, 9);
  assert.deepEqual(inspected, ["player-a"]);
});

test("thirty-athlete pilot reserves the full 600-rep event shape", async () => {
  const playerIds = Array.from({ length: 30 }, (_, index) => `pilot-${String(index + 1).padStart(2, "0")}`);
  const players = Object.fromEntries(playerIds.map((playerId, index) => [
    `players/${playerId}`,
    { organizationId: "club", teamId: "team-a", firstName: `Pilot ${index + 1}`, weight: 60 + index },
  ]));
  const storageReads = [];
  const { db, testing } = harness(players, { value: 1000 }, {
    storageSessionFloors: async (playerId) => { storageReads.push(playerId); return {}; },
  });
  const event = await draft(testing, playerIds);
  const started = await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const reservationPrefix = `testingEvents/${event.eventId}/sessionReservations/`;
  const sessionCount = [...db.docs.keys()].filter((path) => /^players\/pilot-\d+\/sessions\/testing_/.test(path)).length;
  assert.equal(started.reservationCount, 30 * RESERVATIONS_PER_PARTICIPANT);
  assert.equal([...db.docs.keys()].filter((path) => path.startsWith(reservationPrefix)).length, 180);
  assert.equal(sessionCount, 180);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).repsPerParticipant * 30, 600);
  assert.equal(new Set(storageReads).size, 30);
});

test("team rep counts and a player override shape the snapshot and each player's reservations", async () => {
  const { db, testing } = harness();
  const event = await testing.createTestingEvent({
    organizationId: "club", name: "Fall testing", playerIds: ["player-a", "player-b"],
    repCounts: { jump: 2, deadballShot: { left: 3, right: 1 } },
    playerRepCounts: { "player-b": { jump: 4 } },
  }, auth("manager"));
  const stored = db.snapshot(`testingEvents/${event.eventId}`);
  assert.equal(stored.protocolSnapshot[0].drills[0].repCount, 2);
  assert.deepEqual(stored.protocolSnapshot[1].drills[1].sides, ["left", "left", "left", "right"]);
  assert.equal(stored.repsPerParticipant, 19);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}/stations/station-1`).drills[0].repCount, 2);
  assert.deepEqual(db.snapshot(`testingEvents/${event.eventId}/participants/player-b`).protocolOverrides, { jump: { repCount: 4, sides: [] } });
  assert.equal(db.snapshot(`testingEvents/${event.eventId}/participants/player-a`).protocolOverrides, undefined);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const reservation = (playerId, drill) => db.snapshot(`testingEvents/${event.eventId}/sessionReservations/station-1_${playerId}_${drill}`);
  assert.equal(reservation("player-a", "jump").repCount, 2);
  assert.equal(reservation("player-b", "jump").repCount, 4);
  assert.equal(db.snapshot(`players/player-b/sessions/${reservation("player-b", "jump").sessionDocId}`).expectedRepCount, 4);
});

test("rep counts are validated per drill, per side and per station", async () => {
  const { testing } = harness();
  const create = (repCounts, playerRepCounts) => testing.createTestingEvent({
    organizationId: "club", name: "Fall testing", playerIds: ["player-a"], repCounts, playerRepCounts,
  }, auth("manager"));
  await assert.rejects(create({ jump: 0 }), /whole number from 1/);
  await assert.rejects(create({ deadballShot: 4 }), /left and right/);
  await assert.rejects(create({ dribbling: { left: 0, right: 0 } }), /1-10 reps/);
  await assert.rejects(create({ sprint: 5 }), /at most 10 reps/);
  await assert.rejects(create({ unknownDrill: 3 }), /valid testing drill/);
  await assert.rejects(create({}, { "player-c": { jump: 2 } }), /name a participant/);
});

test("an event without a stored snapshot still runs the v1 protocol", async () => {
  const eventId = "event-legacy";
  const progressPath = `testingEvents/${eventId}/progress/station-2_player-a`;
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live" },
    [progressPath]: {
      stationId: "station-2", playerDocId: "player-a", status: "inProgress", currentDrillIndex: 1,
      completedByDrill: { broadJump: 3, deadballShot: 3 }, completedByProtocolSide: { "deadballShot:left": 2, "deadballShot:right": 1 },
      repIds: ["b1", "b2", "b3", "k1", "k2", "k3"], pendingUploadCount: 0, revision: 4, deviceId: "phone-a",
    },
  });
  await testing.onRepWrite({ before: { data: () => undefined }, after: { data: () => ({
    testingEventId: eventId, testingStationId: "station-2", testingParticipantId: "player-a",
    testingDrillType: "deadballShot", protocolSide: "right",
  }) } }, { params: { playerId: "player-a", repId: "k4" } });
  assert.equal(db.snapshot(progressPath).status, "completedPendingSync");
});

test("a sided drill completes per side, not on its total", async () => {
  const eventId = "event-sides";
  const progressPath = `testingEvents/${eventId}/progress/station-2_player-a`;
  const snapshot = [
    { id: "station-1", order: 1, label: "Vertical jump", orientation: "portrait", markerCount: 0, drills: [STATIONS[0].drills[0]] },
    { id: "station-2", order: 2, label: "Broad jump + kicking", orientation: "landscape", markerCount: 1, drills: [
      { ...STATIONS[1].drills[0], repCount: 1 },
      { ...STATIONS[1].drills[1], repCount: 4, sides: ["left", "left", "left", "right"] },
    ] },
    STATIONS[2],
  ];
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live", protocolSnapshot: snapshot },
    [progressPath]: {
      stationId: "station-2", playerDocId: "player-a", status: "inProgress", currentDrillIndex: 1,
      completedByDrill: { broadJump: 1, deadballShot: 3 }, completedByProtocolSide: { "deadballShot:left": 1, "deadballShot:right": 2 },
      repIds: ["b1", "k1", "k2", "k3"], pendingUploadCount: 0, revision: 4, deviceId: "phone-a",
    },
  });
  const write = (repId, protocolSide) => testing.onRepWrite({ before: { data: () => undefined }, after: { data: () => ({
    testingEventId: eventId, testingStationId: "station-2", testingParticipantId: "player-a",
    testingDrillType: "deadballShot", protocolSide,
  }) } }, { params: { playerId: "player-a", repId } });
  await write("k4", "left");
  assert.equal(db.snapshot(progressPath).status, "inProgress", "four kicks, but only two of three lefts");
  await write("k5", "left");
  assert.equal(db.snapshot(progressPath).status, "completedPendingSync");
});

test("invite contains no stored secret, enforces roster authority, and is single-use", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"]);
  const invite = await testing.createTestingEventInvite({ eventId: event.eventId }, auth("manager"));
  assert.match(invite.code, /^TEST-[A-Za-z0-9_-]{32}$/);
  assert.ok(!JSON.stringify([...db.docs.values()]).includes(invite.code));
  await assert.rejects(testing.joinTestingEvent({ code: invite.code }, auth("coach-b")), { code: "permission-denied" });
  const joined = await testing.joinTestingEvent({ code: invite.code }, auth("coach-a"));
  assert.equal(joined.eventId, event.eventId);
  assert.deepEqual(db.snapshot(`testingEvents/${event.eventId}`).operatorUids.sort(), ["coach-a", "manager"]);
  await assert.rejects(testing.joinTestingEvent({ code: invite.code }, auth("coach-a")), { code: "not-found" });
});

test("expired invite cannot be consumed", async () => {
  const { testing, clock } = harness();
  const event = await draft(testing, ["player-a"]);
  const invite = await testing.createTestingEventInvite({ eventId: event.eventId }, auth("manager"));
  clock.value += INVITE_TTL_MS + 1;
  await assert.rejects(testing.joinTestingEvent({ code: invite.code }, auth("coach-a")), { code: "not-found" });
});

test("station lease rejects a competing phone and permits manager takeover", async () => {
  const { testing } = harness();
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const first = await testing.claimTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-a" }, auth("manager"));
  assert.equal(first.stationId, "station-1");
  await assert.rejects(testing.claimTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-b" }, admin), { code: "already-exists" });
  const taken = await testing.takeOverTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-b" }, admin);
  assert.equal(taken.deviceId, "phone-b");
  await assert.rejects(testing.renewTestingStationLease({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-a" }, auth("manager")), { code: "failed-precondition" });
});

test("station calibration reset is versioned and restricted to the active station device", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  await testing.claimTestingStation({ eventId: event.eventId, stationId: "station-2", deviceId: "phone-a" }, auth("manager"));
  const reset = await testing.resetTestingStationCalibration({ eventId: event.eventId, stationId: "station-2", deviceId: "phone-a" }, auth("manager"));
  assert.equal(reset.setupVersion, 2);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}/stations/station-2`).setupVersion, 2);
  await assert.rejects(
    testing.resetTestingStationCalibration({ eventId: event.eventId, stationId: "station-2", deviceId: "phone-b" }, auth("manager")),
    { code: "failed-precondition" }
  );
  await assert.rejects(
    testing.resetTestingStationCalibration({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-a" }, auth("manager")),
    { code: "invalid-argument" }
  );
});

test("revoked event operator immediately loses callable access", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"], auth("coach-a"));
  db.write("organizations/club/members/coach-a", { status: "revoked" }, { merge: true, create: false });
  await assert.rejects(testing.startTestingEvent({ eventId: event.eventId }, auth("coach-a")), { code: "permission-denied" });
});

test("close reports incomplete progress and closes only after all stations sync", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  let readiness = await testing.closeTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing, 3);
  for (const station of STATIONS) db.write(`testingEvents/${event.eventId}/progress/${station.id}_player-a`, {
    stationId: station.id, playerDocId: "player-a", status: "completed",
  }, { merge: false, create: false });
  readiness = await testing.closeTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "closed");
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "closed");
});

test("rep commits reconcile pending progress and coalesce player projections", async () => {
  const eventId = "event-sync";
  const progressRows = Object.fromEntries(STATIONS.map((station) => [
    `testingEvents/${eventId}/progress/${station.id}_player-a`,
    {
      stationId: station.id,
      playerDocId: "player-a",
      status: "completedPendingSync",
      repIds: [`${station.id}-rep`],
      pendingUploadCount: 1,
    },
  ]));
  const { db, testing, finalized } = harness({
    [`testingEvents/${eventId}`]: { ...base["organizations/club"], organizationId: "club", operatorUids: ["manager"], status: "live" },
    ...progressRows,
  });
  for (const station of STATIONS) {
    const repId = `${station.id}-rep`;
    const data = { testingEventId: eventId, testingStationId: station.id, testingParticipantId: "player-a" };
    await testing.onRepWrite({ before: { data: () => undefined }, after: { data: () => data } }, { params: { playerId: "player-a", repId } });
  }
  assert.deepEqual(finalized, ["player-a"]);
  for (const station of STATIONS) {
    const progress = db.snapshot(`testingEvents/${eventId}/progress/${station.id}_player-a`);
    assert.equal(progress.status, "completed");
    assert.equal(progress.pendingUploadCount, 0);
  }
  assert.equal(db.snapshot(`testingEvents/${eventId}/projectionDirty/player-a`).revision, 3);
  assert.equal(db.snapshot(`testingEvents/${eventId}/projectionFinalizations/player-a`).status, "completed");
});

test("progress written after an early rep commit still reconciles", async () => {
  const eventId = "event-race";
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live" },
  });
  const data = { testingEventId: eventId, testingStationId: "station-1", testingParticipantId: "player-a" };
  await testing.onRepWrite({ before: { data: () => undefined }, after: { data: () => data } }, { params: { playerId: "player-a", repId: "rep-early" } });
  db.write(`testingEvents/${eventId}/progress/station-1_player-a`, {
    stationId: "station-1", playerDocId: "player-a", status: "completedPendingSync", repIds: ["rep-early"], pendingUploadCount: 1,
  }, { merge: false, create: false });
  await testing.onProgressWrite({ after: { data: () => db.snapshot(`testingEvents/${eventId}/progress/station-1_player-a`) } }, { params: { eventId, progressId: "station-1_player-a" } });
  assert.equal(db.snapshot(`testingEvents/${eventId}/progress/station-1_player-a`).status, "completed");
});

test("a committed rep repairs station progress after the app dies before its completion callback", async () => {
  const eventId = "event-recovery";
  const progressPath = `testingEvents/${eventId}/progress/station-1_player-a`;
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live" },
    [progressPath]: {
      stationId: "station-1", playerDocId: "player-a", status: "inProgress",
      currentDrillIndex: 0, completedByDrill: {}, completedByProtocolSide: {},
      repIds: [], pendingUploadCount: 0, revision: 1, deviceId: "phone-a",
    },
  });
  const data = {
    testingEventId: eventId, testingStationId: "station-1", testingParticipantId: "player-a",
    testingDrillType: "jump", absoluteRepNumber: 1,
  };
  await testing.onRepWrite(
    { before: { data: () => undefined }, after: { data: () => data } },
    { params: { playerId: "player-a", repId: "recovered-rep" } }
  );
  const progress = db.snapshot(progressPath);
  assert.deepEqual(progress.repIds, ["recovered-rep"]);
  assert.equal(progress.completedByDrill.jump, 1);
  assert.equal(progress.pendingUploadCount, 0);
  assert.equal(progress.status, "inProgress");
});

test("an invalid rep never repairs station progress", async () => {
  const eventId = "event-invalid";
  const progressPath = `testingEvents/${eventId}/progress/station-1_player-a`;
  const before = {
    stationId: "station-1", playerDocId: "player-a", status: "inProgress",
    currentDrillIndex: 0, completedByDrill: {}, completedByProtocolSide: {},
    repIds: [], pendingUploadCount: 0, revision: 1, deviceId: "phone-a",
  };
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live" },
    [progressPath]: before,
  });
  const data = {
    testingEventId: eventId, testingStationId: "station-1", testingParticipantId: "player-a",
    testingDrillType: "jump", absoluteRepNumber: 1, processingStatus: "failed", resultsValid: false,
  };
  await testing.onRepWrite(
    { before: { data: () => undefined }, after: { data: () => data } },
    { params: { playerId: "player-a", repId: "failed-rep" } }
  );
  const progress = db.snapshot(progressPath);
  assert.deepEqual(progress.repIds, []);
  assert.deepEqual(progress.completedByDrill, {});
  assert.equal(progress.revision, 1);
  assert.equal(progress.status, "inProgress");
});

async function liveStation(testing, playerIds = ["player-a"], actor = auth("manager")) {
  const event = await draft(testing, playerIds, actor);
  await testing.startTestingEvent({ eventId: event.eventId }, actor);
  await testing.claimTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone" }, actor);
  return { eventId: event.eventId, playerId: "player-b", deviceId: "phone" };
}

test("live admission reserves all drills and checks in exactly once", async () => {
  const { db, testing } = harness();
  const request = await liveStation(testing);
  const first = await testing.addTestingParticipant(request, auth("manager"));
  const counter = db.snapshot("players/player-b/recordingCounters/jump");
  const second = await testing.addTestingParticipant(request, auth("manager"));
  assert.deepEqual(second, first);
  assert.equal(first.ordinal, 1);
  assert.deepEqual(db.snapshot("players/player-b/recordingCounters/jump"), counter);
  const event = db.snapshot(`testingEvents/${request.eventId}`);
  assert.equal(event.participantCount, 2);
  assert.equal(event.reservationCount, 12);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/participants/player-b`).enrollmentStatus, "ready");
  for (const station of STATIONS) for (const drill of station.drills) {
    assert.ok(db.snapshot(`testingEvents/${request.eventId}/sessionReservations/${station.id}_player-b_${drill.drillType}`));
  }
  const initial = await testing.addTestingParticipant({ ...request, playerId: "player-a" }, auth("manager"));
  assert.equal(initial.ordinal, 2);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).reservationCount, 12);
  const restarted = await testing.startTestingEvent({ eventId: request.eventId }, auth("manager"));
  assert.equal(restarted.participantCount, 2);
  assert.equal(restarted.reservationCount, 12);
});

test("pending enrollment recovers after reservation failure without duplicate players", async () => {
  let failScan = false;
  const { db, testing } = harness({}, { value: 1000 }, {
    storageSessionFloors: async () => { if (failScan) throw new Error("storage unavailable"); return { jump: 20 }; },
  });
  const request = await liveStation(testing);
  failScan = true;
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), /storage unavailable/);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/participants/player-b`).enrollmentStatus, "pending");
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/checkIns/player-b`), undefined);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).participantCount, 2);
  failScan = false;
  await testing.addTestingParticipant(request, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).participantCount, 2);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).reservationCount, 12);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/sessionReservations/station-1_player-b_jump`).sessionNumber, 21);
});

test("admission requires the live Station 1 lease and canonical organization", async () => {
  const { db, testing, clock } = harness({ "players/foreign": { organizationId: "other", teamId: "team-a" } });
  const request = await liveStation(testing);
  await assert.rejects(testing.addTestingParticipant({ ...request, deviceId: "wrong" }, auth("manager")), { code: "failed-precondition" });
  await assert.rejects(testing.addTestingParticipant({ ...request, playerId: "foreign" }, auth("manager")), { code: "permission-denied" });
  await assert.rejects(testing.addTestingParticipant(request, auth("coach-a")), { code: "permission-denied" });
  clock.value += 100000;
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), { code: "failed-precondition" });
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).participantCount, 1);
});

test("manager can add another organization team only when all operators can access it", async () => {
  const { db, testing } = harness();
  const request = await liveStation(testing);
  db.write(`testingEvents/${request.eventId}`, { operatorUids: ["manager", "coach-a"] }, { merge: true });
  await assert.rejects(testing.addTestingParticipant({ ...request, playerId: "player-c" }, auth("manager")), { code: "permission-denied" });
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).participantCount, 1);
  db.write("organizations/club/members/coach-a", { teamIds: ["team-a", "team-b"] }, { merge: true });
  await testing.addTestingParticipant({ ...request, playerId: "player-c" }, auth("manager"));
  assert.deepEqual(db.snapshot(`testingEvents/${request.eventId}`).teamIds, ["team-a", "team-b"]);
});

test("admin station operator remains authorized when admitting a new team", async () => {
  const { db, testing } = harness({}, { value: 1000 }, { operatorIdentity: async uid => uid === "admin" ? admin : auth(uid) });
  const request = await liveStation(testing);
  db.write(`testingEvents/${request.eventId}`, { operatorUids: ["manager", "admin"] }, { merge: true });
  await testing.addTestingParticipant({ ...request, playerId: "player-c" }, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).participantCount, 2);
});

test("pilot cap, revoked membership and closed sessions reject admission", async () => {
  const { db, testing } = harness();
  const request = await liveStation(testing);
  db.write(`testingEvents/${request.eventId}`, { participantCount: 30 }, { merge: true });
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), { code: "resource-exhausted" });
  db.write(`testingEvents/${request.eventId}`, { participantCount: 1, status: "closed" }, { merge: true });
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), { code: "failed-precondition" });
  db.write(`testingEvents/${request.eventId}`, { status: "live" }, { merge: true });
  db.write("organizations/club/members/manager", { status: "revoked" }, { merge: true });
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), { code: "permission-denied" });
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/participants/player-b`), undefined);
});

test("new canonical team player can enroll without weight or an auth account", async () => {
  const { db, testing } = harness({ "players/new-player": { organizationId: "club", teamId: "team-a", firstName: "New", lastName: "Athlete", registered: false } });
  const request = await liveStation(testing);
  await testing.addTestingParticipant({ ...request, playerId: "new-player" }, auth("manager"));
  const participant = db.snapshot(`testingEvents/${request.eventId}/participants/new-player`);
  assert.equal(participant.displayName, "New Athlete");
  assert.equal(participant.teamId, "team-a");
  assert.equal(participant.weightKg, null);
  assert.equal(participant.enrollmentStatus, "ready");
  assert.ok(db.snapshot(`players/new-player/sessions/testing_${request.eventId}_station-1_jump`));
});

test("lease loss during reservations preserves a retryable pending enrollment", async () => {
  let moveLease = false;
  const { db, testing } = harness({}, { value: 1000 }, {
    storageSessionFloors: async () => {
      if (moveLease) db.write(`testingEvents/${request.eventId}/stations/station-1`, { claimedDeviceId: "other" }, { merge: true });
      return {};
    },
  });
  const request = await liveStation(testing);
  moveLease = true;
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), { code: "failed-precondition" });
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/checkIns/player-b`), undefined);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}/participants/player-b`).enrollmentStatus, "pending");
  moveLease = false;
  db.write(`testingEvents/${request.eventId}/stations/station-1`, { claimedDeviceId: "phone" }, { merge: true });
  await testing.addTestingParticipant(request, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).reservationCount, 12);
});


test("unfinished enrollment prevents event close even when the original roster is complete", async () => {
  let failScan = false;
  const { db, testing } = harness({}, { value: 1000 }, {
    storageSessionFloors: async () => { if (failScan) throw new Error("offline"); return {}; },
  });
  const request = await liveStation(testing);
  for (const station of STATIONS) db.write(`testingEvents/${request.eventId}/progress/${station.id}_player-a`, { status: "completed" }, {});
  failScan = true;
  await assert.rejects(testing.addTestingParticipant(request, auth("manager")), /offline/);
  const result = await testing.closeTestingEvent({ eventId: request.eventId }, auth("manager"));
  assert.equal(result.ready, false);
  assert.equal(result.expected, 6);
  assert.equal(result.missing, 3);
  assert.equal(db.snapshot(`testingEvents/${request.eventId}`).status, "live");
});

test("force close ends incomplete event, releases leases and preserves pending results", async () => {
  const { db, testing, clock } = harness();
  const { eventId } = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId }, auth("manager"));
  await testing.claimTestingStation({ eventId, stationId: "station-1", deviceId: "phone" }, auth("manager"));
  const path = `testingEvents/${eventId}/progress/station-1_player-a`;
  const row = { stationId: "station-1", playerDocId: "player-a", status: "inProgress", repIds: ["rep-a"], pendingUploadCount: 1 };
  db.write(path, row, { merge: false });
  const result = await testing.closeTestingEvent({ eventId, force: true }, auth("manager"));
  assert.equal(result.status, "closed");
  assert.equal(result.ready, false);
  assert.equal(db.snapshot(`testingEvents/${eventId}`).endedEarly, true);
  assert.deepEqual(db.snapshot(path), row);
  for (const station of STATIONS) {
    const lease = db.snapshot(`testingEvents/${eventId}/stations/${station.id}`);
    assert.equal(lease.claimedDeviceId, null);
    assert.equal(lease.leaseExpiresAtMillis, 0);
  }
  const first = db.snapshot(`testingEvents/${eventId}`);
  clock.value += 10000;
  await testing.closeTestingEvent({ eventId, force: true }, auth("manager"));
  assert.deepEqual(db.snapshot(`testingEvents/${eventId}`), first);
  await assert.rejects(testing.startTestingEvent({ eventId }, auth("manager")), { code: "failed-precondition" });
  for (const action of ["claimTestingStation", "renewTestingStationLease", "takeOverTestingStation"]) {
    await assert.rejects(testing[action]({ eventId, stationId: "station-1", deviceId: "phone" }, auth("manager")), { code: "failed-precondition" });
  }
  await assert.rejects(testing.resetTestingStationCalibration({ eventId, stationId: "station-2", deviceId: "phone" }, auth("manager")), { code: "failed-precondition" });
  const next = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: next.eventId }, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${next.eventId}`).status, "live");
});

test("force close validates input and rejects non-owner coach without ending session", async () => {
  const { db, testing } = harness();
  const { eventId } = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId }, auth("manager"));
  db.write(`testingEvents/${eventId}`, { operatorUids: ["manager", "coach-a"] }, { merge: true });
  await assert.rejects(testing.closeTestingEvent({ eventId, force: "true" }, auth("manager")), { code: "invalid-argument" });
  await assert.rejects(testing.closeTestingEvent({ eventId, force: true }, auth("coach-a")), { code: "permission-denied" });
  await assert.rejects(testing.closeTestingEvent({ eventId, force: true }, auth("coach-b")), { code: "permission-denied" });
  assert.equal(db.snapshot(`testingEvents/${eventId}`).status, "live");
  const owned = await draft(testing, ["player-a"], auth("coach-a"));
  await testing.startTestingEvent({ eventId: owned.eventId }, auth("coach-a"));
  assert.equal((await testing.closeTestingEvent({ eventId: owned.eventId, force: true }, auth("coach-a"))).status, "closed");
});

test("lease transaction rechecks event closed after authorization", async () => {
  const { db, testing } = harness();
  const { eventId } = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId }, auth("manager"));
  const transact = db.runTransaction.bind(db);
  db.runTransaction = async callback => {
    db.write(`testingEvents/${eventId}`, { status: "closed" }, { merge: true });
    return transact(callback);
  };
  await assert.rejects(testing.claimTestingStation({ eventId, stationId: "station-1", deviceId: "late-phone" }, auth("manager")), { code: "failed-precondition" });
  assert.equal(db.snapshot(`testingEvents/${eventId}/stations/station-1`).claimedDeviceId, null);
});

test("ending incomplete event finalizes existing results and sweeps late uploads", async () => {
  const { db, testing, finalized } = harness();
  const { eventId } = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId }, auth("manager"));
  db.write(`testingEvents/${eventId}/projectionDirty/player-a`, { pending: true, revision: 1 }, { merge: false });
  await testing.closeTestingEvent({ eventId, force: true }, auth("manager"));
  assert.deepEqual(finalized, ["player-a"]);
  db.write(`testingEvents/${eventId}/projectionDirty/player-a`, { pending: true, revision: 2 }, { merge: true });
  // This fake supports collection queries; adapt the collection-group seam for this event.
  db.collectionGroup = name => ({ where: (field, op, value) => ({ limit: count => ({ get: async () => {
    assert.equal(name, "projectionDirty");
    const event = db.collection("testingEvents").doc(eventId);
    const result = await event.collection(name).where(field, op, value).limit(count).get();
    for (const row of result.docs) row.ref.parent = { parent: event };
    return result;
  } }) }) });
  await testing.sweepTestingFinalizations();
  assert.deepEqual(finalized, ["player-a", "player-a"]);
  assert.equal(db.snapshot(`testingEvents/${eventId}`).status, "closed");
});
