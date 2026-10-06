"use strict";

const crypto = require("crypto");
const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, activeMember, memberCanAccessPlayer } = require("./club-access");

const MAX_PARTICIPANTS = 30;
const LEASE_MS = 90 * 1000;
const INVITE_TTL_MS = 15 * 60 * 1000;
const PROTOCOL_ID = "station-testing-v1";

const STATIONS = Object.freeze([
  Object.freeze({
    id: "station-1", order: 1, label: "Vertical jump", orientation: "portrait", markerCount: 0,
    drills: Object.freeze([
      Object.freeze({ drillType: "jump", repType: "jump", label: "Vertical jump", repCount: 3, sides: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    id: "station-2", order: 2, label: "Broad jump + kicking", orientation: "landscape", markerCount: 1,
    drills: Object.freeze([
      Object.freeze({ drillType: "broadJump", repType: "broadJump", label: "Broad jump", repCount: 3, sides: Object.freeze([]) }),
      Object.freeze({ drillType: "deadballShot", repType: "side_kick", label: "Kicking", repCount: 4, sides: Object.freeze(["left", "left", "right", "right"]) }),
    ]),
  }),
  Object.freeze({
    id: "station-3", order: 3, label: "Speed + movement", orientation: "landscape", markerCount: 2,
    drills: Object.freeze([
      Object.freeze({ drillType: "sprint", repType: "sprint", label: "Sprint", repCount: 3, sides: Object.freeze([]) }),
      Object.freeze({ drillType: "changeOfDirection", repType: "changeOfDirection", label: "Change of direction", repCount: 3, sides: Object.freeze([]) }),
      Object.freeze({ drillType: "dribbling", repType: "dribbling", label: "Dribbling", repCount: 4, sides: Object.freeze(["left", "left", "right", "right"]) }),
    ]),
  }),
]);

const RESERVATIONS_PER_PARTICIPANT = STATIONS.reduce((sum, station) => sum + station.drills.length, 0);
const REPS_PER_PARTICIPANT = STATIONS.flatMap((station) => station.drills).reduce((sum, drill) => sum + drill.repCount, 0);
const MAX_REPS_PER_DRILL = 10;
// The published progress rules cap a station row's repIds at 10. Raise this only together with
// the rules change in STATION_ADJUSTABLE_REP_COUNTS_PLAN, after that ruleset is live.
const MAX_REPS_PER_STATION = 10;

function protocolSnapshot(stations = STATIONS) {
  return stations.map((station) => ({
    id: station.id,
    order: station.order,
    label: station.label,
    orientation: station.orientation,
    markerCount: station.markerCount,
    drills: station.drills.map((drill) => ({ ...drill, sides: [...drill.sides] })),
  }));
}

const baseDrill = (drillType) => STATIONS.flatMap((station) => station.drills).find((drill) => drill.drillType === drillType);
const sided = (drillType) => (baseDrill(drillType)?.sides.length || 0) > 0;
const sideTarget = (drill, side) => drill.sides.filter((value) => value === side).length;
const sidesFor = (left, right) => [...Array(left).fill("left"), ...Array(right).fill("right")];

// The event's own snapshot is the protocol. Events created before adjustable counts carry the
// v1 snapshot; one without any snapshot falls back to v1. A participant override replaces the
// team plan for the drills it names and nothing else.
function effectiveStations(snapshot, overrides = null) {
  const stations = Array.isArray(snapshot) && snapshot.length ? snapshot : protocolSnapshot();
  return stations.map((station) => ({
    ...station,
    drills: station.drills.map((drill) => {
      const override = overrides?.[drill.drillType];
      return override ? { ...drill, repCount: override.repCount, sides: [...override.sides] } : { ...drill, sides: [...(drill.sides || [])] };
    }),
  }));
}

// Sided drills are complete per side, so a count change can never be met by extra reps on the
// other foot. Unsided drills count valid reps.
function drillComplete(drill, completedByDrill = {}, completedByProtocolSide = {}) {
  if (drill.sides.length) {
    return ["left", "right"].every((side) =>
      Number(completedByProtocolSide[`${drill.drillType}:${side}`] || 0) >= sideTarget(drill, side));
  }
  return Number(completedByDrill[drill.drillType] || 0) >= drill.repCount;
}

function remainingReps(drill, completedByDrill = {}, completedByProtocolSide = {}) {
  if (drill.sides.length) {
    return ["left", "right"].reduce((sum, side) =>
      sum + Math.max(0, sideTarget(drill, side) - Number(completedByProtocolSide[`${drill.drillType}:${side}`] || 0)), 0);
  }
  return Math.max(0, drill.repCount - Number(completedByDrill[drill.drillType] || 0));
}

const repsForStations = (stations) => stations.flatMap((station) => station.drills).reduce((sum, drill) => sum + drill.repCount, 0);

function createTestingEvents({
  db,
  FieldValue,
  Timestamp,
  HttpsError,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  finalizePlayer = async () => {},
  storageSessionFloors = async () => ({}),
  operatorIdentity = async (uid) => ({ uid }),
}) {
  const stamp = () => FieldValue.serverTimestamp();
  const timestamp = (millis) => Timestamp.fromMillis(millis);
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const cleanId = (value, label = "identifier") => playerSegment(value) ? value : fail("invalid-argument", `Enter a valid ${label}.`);
  const cleanText = (value, label, limit = 100) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > limit) fail("invalid-argument", `Enter a valid ${label}.`);
    return value.trim();
  };
  const authRequired = (auth) => {
    if (!auth?.uid || !playerSegment(auth.uid) || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
  };
  const uniqueIds = (value, label, maximum = MAX_PARTICIPANTS) => {
    if (!Array.isArray(value) || !value.length || value.length > maximum) fail("invalid-argument", `Choose 1-${maximum} ${label}.`);
    const values = [...new Set(value.map((entry) => cleanId(entry, label.slice(0, -1))))];
    if (values.length !== value.length) fail("invalid-argument", `${label[0].toUpperCase() + label.slice(1)} cannot contain duplicates.`);
    return values;
  };
  const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const weight = (player) => {
    const value = number(player.weight);
    return value !== null && value > 0 && value < 500 ? value : null;
  };
  const displayName = (player) => {
    const joined = [player.firstName, player.lastName].filter((part) => typeof part === "string" && part.trim()).map((part) => part.trim()).join(" ");
    return joined || (typeof player.name === "string" && player.name.trim()) || "Athlete";
  };
  const eventRef = (eventId) => db.collection("testingEvents").doc(cleanId(eventId, "testing event"));
  const count = (value, label, minimum) => Number.isInteger(value) && value >= minimum && value <= MAX_REPS_PER_DRILL
    ? value : fail("invalid-argument", `${label} must be a whole number from ${minimum} to ${MAX_REPS_PER_DRILL}.`);

  // Counts arrive as { drillType: n } and, for sided drills, { drillType: { left, right } } so
  // left/right stay explicit. Only named drills change.
  function drillPlans(input) {
    if (input === undefined || input === null) return {};
    if (typeof input !== "object" || Array.isArray(input)) fail("invalid-argument", "Rep counts must name drills.");
    const plans = {};
    for (const [drillType, value] of Object.entries(input)) {
      const drill = baseDrill(drillType);
      if (!drill) fail("invalid-argument", "Choose a valid testing drill.");
      if (sided(drillType)) {
        if (!value || typeof value !== "object") fail("invalid-argument", `${drill.label} needs left and right counts.`);
        const left = count(value.left, `${drill.label} left`, 0);
        const right = count(value.right, `${drill.label} right`, 0);
        if (left + right < 1 || left + right > MAX_REPS_PER_DRILL) fail("invalid-argument", `${drill.label} needs 1-${MAX_REPS_PER_DRILL} reps in total.`);
        plans[drillType] = { repCount: left + right, sides: sidesFor(left, right) };
      } else {
        plans[drillType] = { repCount: count(value, drill.label, 1), sides: [] };
      }
    }
    return plans;
  }

  function checkStationTotals(stations) {
    for (const station of stations) {
      const total = station.drills.reduce((sum, drill) => sum + drill.repCount, 0);
      if (total > MAX_REPS_PER_STATION) fail("invalid-argument", `${station.label} can have at most ${MAX_REPS_PER_STATION} reps per athlete.`);
    }
    return stations;
  }

  async function authorityFor(organizationId, auth) {
    authRequired(auth);
    const orgId = cleanId(organizationId, "organization");
    const orgRef = db.collection("organizations").doc(orgId);
    const [orgDoc, memberDoc] = await Promise.all([
      orgRef.get(),
      orgRef.collection("members").doc(auth.uid).get(),
    ]);
    if (!orgDoc.exists || orgDoc.data().schemaVersion !== 2) fail("not-found", "That club could not be found.");
    const member = memberDoc.exists ? memberDoc.data() : null;
    if (!isClubAdmin(auth) && !activeMember(member, auth.uid)) fail("permission-denied", "Active club staff are required.");
    return { organizationId: orgId, org: orgDoc.data(), member, admin: isClubAdmin(auth) };
  }

  function canAccessTeam(authority, teamId) {
    return authority.admin || authority.member?.role === "manager" || authority.member?.teamIds?.includes(teamId);
  }

  function operatorCanAccessEvent(event, auth, member = null) {
    if (isClubAdmin(auth)) return true;
    if (!activeMember(member, auth.uid)) return false;
    if (!event.operatorUids?.includes(auth.uid)) return false;
    return member.role === "manager" || (Array.isArray(event.teamIds) && event.teamIds.every((teamId) => member.teamIds.includes(teamId)));
  }

  function memberCanJoinEvent(event, auth, member = null) {
    if (isClubAdmin(auth)) return true;
    if (!activeMember(member, auth.uid)) return false;
    return member.role === "manager" || (Array.isArray(event.teamIds) && event.teamIds.every((teamId) => member.teamIds.includes(teamId)));
  }

  async function requireEventOperator(eventId, auth) {
    authRequired(auth);
    const ref = eventRef(eventId);
    const eventDoc = await ref.get();
    if (!eventDoc.exists) fail("not-found", "That testing session could not be found.");
    const event = eventDoc.data();
    const memberDoc = await db.collection("organizations").doc(event.organizationId).collection("members").doc(auth.uid).get();
    const member = memberDoc.exists ? memberDoc.data() : null;
    if (!operatorCanAccessEvent(event, auth, member)) fail("permission-denied", "You are not an operator for this testing session.");
    return { ref, event, member };
  }

  async function createTestingEvent(data, auth) {
    const authority = await authorityFor(data?.organizationId, auth);
    const playerIds = uniqueIds(data?.playerIds, "participants");
    const playerDocs = await Promise.all(playerIds.map((playerId) => db.collection("players").doc(playerId).get()));
    const players = playerDocs.map((doc, index) => {
      if (!doc.exists) fail("not-found", `Participant ${index + 1} could not be found.`);
      const player = doc.data();
      if (player.organizationId !== authority.organizationId || !canAccessTeam(authority, player.teamId)) {
        fail("permission-denied", "Every participant must be in your authorized club roster.");
      }
      return { id: doc.id, ...player };
    });
    const teamIds = [...new Set(players.map((player) => cleanId(player.teamId, "participant team")))].sort();
    const teamStations = checkStationTotals(effectiveStations(protocolSnapshot(), drillPlans(data?.repCounts)));
    const snapshot = protocolSnapshot(teamStations);
    const playerRepCounts = data?.playerRepCounts ?? {};
    if (typeof playerRepCounts !== "object" || Array.isArray(playerRepCounts)) fail("invalid-argument", "Player rep counts must name participants.");
    const overridesByPlayer = new Map(Object.entries(playerRepCounts).map(([playerId, counts]) => {
      if (!playerIds.includes(playerId)) fail("invalid-argument", "Player rep counts must name a participant.");
      const overrides = drillPlans(counts);
      checkStationTotals(effectiveStations(snapshot, overrides));
      return [playerId, overrides];
    }));
    const ref = db.collection("testingEvents").doc();
    const batch = db.batch();
    batch.create(ref, {
      schemaVersion: 1,
      protocolId: PROTOCOL_ID,
      name: cleanText(data?.name, "testing session name"),
      ownerUid: auth.uid,
      organizationId: authority.organizationId,
      teamIds,
      operatorUids: [auth.uid],
      status: "draft",
      participantCount: players.length,
      stationCount: STATIONS.length,
      repsPerParticipant: repsForStations(snapshot),
      protocolSnapshot: snapshot,
      protocolRevision: 1,
      createdAt: stamp(),
      createdAtMillis: now(),
      updatedAt: stamp(),
    });
    players.forEach((player, rosterOrder) => batch.create(ref.collection("participants").doc(player.id), {
      playerDocId: player.id,
      displayName: displayName(player),
      photoUrl: typeof player.photoUrl === "string" ? player.photoUrl : "",
      teamId: player.teamId,
      weightKg: weight(player),
      weightStatus: weight(player) === null ? "missing" : "ready",
      rosterOrder,
      ...(overridesByPlayer.get(player.id) && Object.keys(overridesByPlayer.get(player.id)).length
        ? { protocolOverrides: overridesByPlayer.get(player.id) } : {}),
      createdAt: stamp(),
    }));
    for (const station of snapshot) batch.create(ref.collection("stations").doc(station.id), {
      ...station,
      claimedByUid: null,
      claimedDeviceId: null,
      setupVersion: 1,
      leaseExpiresAtMillis: 0,
      lastHeartbeatAt: null,
      createdAt: stamp(),
    });
    await batch.commit();
    return { eventId: ref.id, status: "draft", participantCount: players.length, protocolId: PROTOCOL_ID };
  }

  // Admission is retryable by canonical player ID. Pending entries count against
  // the pilot cap but cannot check in until all six reservations are durable.
  async function addTestingParticipant(data, auth) {
    authRequired(auth);
    const eventId = cleanId(data?.eventId, "testing event");
    const playerId = cleanId(data?.playerId, "player");
    const deviceId = cleanId(data?.deviceId, "device");
    const access = await requireEventOperator(eventId, auth);
    const ref = access.ref;
    const participantRef = ref.collection("participants").doc(playerId);
    const identities = new Map(await Promise.all((access.event.operatorUids || []).map(async (uid) => [
      uid, uid === auth.uid ? auth : await operatorIdentity(uid),
    ])));

    async function readAdmission(tx) {
      const [eventDoc, playerDoc, stationDoc, participantDoc, memberDoc] = await Promise.all([
        tx.get(ref), tx.get(db.collection("players").doc(playerId)),
        tx.get(ref.collection("stations").doc("station-1")), tx.get(participantRef),
        tx.get(db.collection("organizations").doc(access.event.organizationId).collection("members").doc(auth.uid)),
      ]);
      const event = eventDoc.data();
      const player = playerDoc.data();
      const lease = stationDoc.data();
      if (!eventDoc.exists || event.status !== "live") fail("failed-precondition", "The testing session must be live.");
      if (!operatorCanAccessEvent(event, auth, memberDoc.data())) fail("permission-denied", "Your event access changed.");
      if (!lease || lease.claimedByUid !== auth.uid || lease.claimedDeviceId !== deviceId || lease.leaseExpiresAtMillis <= now()) {
        fail("failed-precondition", "This device must own Station 1 to add players.");
      }
      if (!playerDoc.exists) fail("not-found", "That player could not be found.");
      if (player.organizationId !== event.organizationId || !playerSegment(player.teamId)
          || (!isClubAdmin(auth) && !memberCanAccessPlayer(memberDoc.data(), auth.uid, player))) {
        fail("permission-denied", "Choose a player from your authorized organization and team.");
      }
      // Expanding the roster must never expose another team's athletes to an
      // existing coach operator. Managers/admins may admit any authorized team.
      if (!event.teamIds.includes(player.teamId)) {
        for (const uid of event.operatorUids) {
          const member = await tx.get(db.collection("organizations").doc(event.organizationId).collection("members").doc(uid));
          if (!isClubAdmin(identities.get(uid)) && !memberCanAccessPlayer(member.data(), uid, player)) {
            fail("permission-denied", "Every station operator must have access to this player's team. Ask a club manager to update staff team assignments first.");
          }
        }
      }
      if (participantDoc.exists && participantDoc.data().teamId !== player.teamId) {
        fail("failed-precondition", "This player's team changed after enrollment. Review the event before continuing.");
      }
      if (!participantDoc.exists && event.participantCount >= MAX_PARTICIPANTS) fail("resource-exhausted", "This testing session already has 30 players.");
      return { event, player, participant: participantDoc.data() };
    }

    const participant = await db.runTransaction(async (tx) => {
      const state = await readAdmission(tx);
      if (state.participant) return state.participant;
      const snapshot = {
        playerDocId: playerId, displayName: displayName(state.player),
        photoUrl: typeof state.player.photoUrl === "string" ? state.player.photoUrl : "",
        teamId: state.player.teamId, weightKg: weight(state.player),
        weightStatus: weight(state.player) === null ? "missing" : "ready",
        rosterOrder: state.event.participantCount, enrollmentStatus: "pending", createdAt: stamp(),
      };
      tx.create(participantRef, snapshot);
      tx.update(ref, {
        participantCount: state.event.participantCount + 1,
        teamIds: [...new Set([...state.event.teamIds, state.player.teamId])].sort(), updatedAt: stamp(),
      });
      return snapshot;
    });
    if (participant.enrollmentStatus === "pending") {
      const floors = await storageSessionFloors(playerId);
      for (const station of effectiveStations(access.event.protocolSnapshot, participant.protocolOverrides)) {
        for (const drill of station.drills) await reserveSession(eventId, participant, station, drill, floors);
      }
    }
    return db.runTransaction(async (tx) => {
      const state = await readAdmission(tx);
      const checkInRef = ref.collection("checkIns").doc(playerId);
      const [checkIn, checkIns, ...reservations] = await Promise.all([
        tx.get(checkInRef), tx.get(ref.collection("checkIns").orderBy("ordinal", "desc").limit(1)),
        ...STATIONS.flatMap((station) => station.drills.map((drill) =>
          tx.get(ref.collection("sessionReservations").doc(`${station.id}_${playerId}_${drill.drillType}`)))),
      ]);
      if (reservations.some((doc) => !doc.exists)) fail("failed-precondition", "Session reservations are incomplete. Retry check-in.");
      const ordinal = checkIn.exists ? checkIn.data().ordinal : (checkIns.docs[0]?.data().ordinal || 0) + 1;
      if (state.participant.enrollmentStatus === "pending") {
        tx.update(participantRef, { enrollmentStatus: "ready", enrolledAt: stamp() });
        tx.update(ref, { reservationCount: (state.event.reservationCount || 0) + RESERVATIONS_PER_PARTICIPANT, updatedAt: stamp() });
      }
      if (!checkIn.exists) tx.create(checkInRef, {
        playerDocId: playerId, ordinal, checkedInAt: stamp(), checkedInByUid: auth.uid, deviceId,
      });
      return { eventId, playerId, ordinal, status: "ready" };
    });
  }

  async function maximaForPlayerDrill(tx, playerId, drill) {
    const playerRef = db.collection("players").doc(playerId);
    const [sessions, reps] = await Promise.all([
      tx.get(playerRef.collection("sessions").where("sessionType", "==", drill.drillType).limit(2000)),
      tx.get(playerRef.collection("reps").where("repType", "==", drill.repType).limit(5000)),
    ]);
    let maxSessionNumber = 0;
    let maxAbsoluteRepNumber = 0;
    for (const doc of sessions.docs) maxSessionNumber = Math.max(maxSessionNumber, Number(doc.data().sessionNumber) || 0);
    for (const doc of reps.docs) maxAbsoluteRepNumber = Math.max(maxAbsoluteRepNumber, Number(doc.data().absoluteRepNumber) || 0);
    return { maxSessionNumber, maxAbsoluteRepNumber };
  }

  async function reserveSession(eventId, participant, station, drill, storageFloors) {
    const reservationId = `${station.id}_${participant.playerDocId}_${drill.drillType}`;
    const reservationRef = eventRef(eventId).collection("sessionReservations").doc(reservationId);
    const existingReservation = await reservationRef.get();
    if (existingReservation.exists) return existingReservation.data();
    const storageMaxSessionNumber = Math.max(0, Number(storageFloors?.[drill.drillType]) || 0);
    return db.runTransaction(async (tx) => {
      const [eventDoc, reservationDoc] = await Promise.all([tx.get(eventRef(eventId)), tx.get(reservationRef)]);
      if (!eventDoc.exists || !["starting", "live"].includes(eventDoc.data().status)) fail("failed-precondition", "The testing session is not starting.");
      if (reservationDoc.exists) return reservationDoc.data();
      const counterRef = db.collection("players").doc(participant.playerDocId).collection("recordingCounters").doc(drill.drillType);
      const counterDoc = await tx.get(counterRef);
      const maxima = await maximaForPlayerDrill(tx, participant.playerDocId, drill);
      const nextSessionNumber = Math.max(
        1,
        Number(counterDoc.data()?.nextSessionNumber) || 1,
        maxima.maxSessionNumber + 1,
        storageMaxSessionNumber + 1,
      );
      const nextAbsoluteRepNumber = Math.max(
        1,
        Number(counterDoc.data()?.nextAbsoluteRepNumber) || 1,
        maxima.maxAbsoluteRepNumber + 1,
      );
      const sessionDocId = `testing_${eventId}_${station.id}_${drill.drillType}`;
      const sessionRef = db.collection("players").doc(participant.playerDocId).collection("sessions").doc(sessionDocId);
      const reservation = {
        eventId,
        stationId: station.id,
        playerDocId: participant.playerDocId,
        drillType: drill.drillType,
        repType: drill.repType,
        sessionDocId,
        sessionNumber: nextSessionNumber,
        absoluteRepStart: nextAbsoluteRepNumber,
        repCount: drill.repCount,
        createdAt: stamp(),
      };
      tx.set(counterRef, {
        nextSessionNumber: nextSessionNumber + 1,
        nextAbsoluteRepNumber: nextAbsoluteRepNumber + drill.repCount,
        updatedAt: stamp(),
      }, { merge: true });
      tx.create(sessionRef, {
        sessionType: drill.drillType,
        sessionNumber: nextSessionNumber,
        repCount: 0,
        testingEventId: eventId,
        testingStationId: station.id,
        expectedRepCount: drill.repCount,
        createdByUid: eventDoc.data().ownerUid,
        timestamp: stamp(),
      });
      tx.create(reservationRef, reservation);
      return reservation;
    });
  }

  async function startTestingEvent(data, auth) {
    const eventId = cleanId(data?.eventId, "testing event");
    const access = await requireEventOperator(eventId, auth);
    if (access.event.ownerUid !== auth.uid && !isClubAdmin(auth) && access.member?.role !== "manager") {
      fail("permission-denied", "Only the owner or a club manager can start this testing session.");
    }
    if (access.event.status === "live") return {
      eventId, status: "live", participantCount: access.event.participantCount, reservationCount: access.event.reservationCount,
    };
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(access.ref);
      if (!doc.exists) fail("not-found", "That testing session could not be found.");
      if (doc.data().status === "live") return;
      if (!["draft", "starting"].includes(doc.data().status)) fail("failed-precondition", "This testing session cannot be started.");
      if (doc.data().status === "draft") tx.update(access.ref, { status: "starting", updatedAt: stamp() });
    });
    const participantQuery = await access.ref.collection("participants").orderBy("rosterOrder").limit(MAX_PARTICIPANTS + 1).get();
    if (participantQuery.size !== access.event.participantCount || participantQuery.size > MAX_PARTICIPANTS) {
      fail("failed-precondition", "The participant roster changed. Recreate the testing session.");
    }
    const participants = participantQuery.docs.map((doc) => doc.data());
    const canonicalPlayers = await Promise.all(participants.map((participant) => db.collection("players").doc(participant.playerDocId).get()));
    const refreshedParticipants = participants.map((participant, index) => {
      const playerDoc = canonicalPlayers[index];
      if (!playerDoc.exists) fail("failed-precondition", "A participant was removed from the roster.");
      const player = playerDoc.data();
      if (player.organizationId !== access.event.organizationId
          || (!isClubAdmin(auth) && !memberCanAccessPlayer(access.member, auth.uid, player))) {
        fail("permission-denied", "Every participant must still be in your authorized club roster.");
      }
      return { ...participant, weightKg: weight(player), weightStatus: weight(player) === null ? "missing" : "ready" };
    });
    const participantBatch = db.batch();
    refreshedParticipants.forEach((participant) => participantBatch.set(access.ref.collection("participants").doc(participant.playerDocId), {
      weightKg: participant.weightKg,
      weightStatus: participant.weightStatus,
      validatedAt: stamp(),
    }, { merge: true }));
    await participantBatch.commit();
    // Weight is optional (product decision 2026-09-21): participants without one keep
    // weightStatus "missing" and the jump processor falls back to its default mass.
    const storageFloorsByPlayer = new Map(await Promise.all(refreshedParticipants.map(async (participant) => [
      participant.playerDocId,
      await storageSessionFloors(participant.playerDocId),
    ])));
    const reservationWork = [];
    for (const participant of refreshedParticipants) {
      for (const station of effectiveStations(access.event.protocolSnapshot, participant.protocolOverrides)) {
        for (const drill of station.drills) {
          reservationWork.push(() => reserveSession(
            eventId,
            participant,
            station,
            drill,
            storageFloorsByPlayer.get(participant.playerDocId),
          ));
        }
      }
    }
    let reservationCount = 0;
    for (let offset = 0; offset < reservationWork.length; offset += 12) {
      const batch = reservationWork.slice(offset, offset + 12);
      await Promise.all(batch.map((reserve) => reserve()));
      reservationCount += batch.length;
    }
    const expectedReservations = participants.length * RESERVATIONS_PER_PARTICIPANT;
    if (reservationCount !== expectedReservations) fail("internal", "Testing session reservations are incomplete.");
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(access.ref);
      if (!doc.exists || !["starting", "live"].includes(doc.data().status)) fail("failed-precondition", "The testing session changed while starting.");
      // A concurrent start may already have gone live and admitted more players.
      // Never overwrite that newer reservation count with our startup snapshot.
      if (doc.data().status === "live") return;
      tx.update(access.ref, {
        status: "live",
        reservationCount: expectedReservations,
        startedAt: doc.data().startedAt || stamp(),
        startedAtMillis: doc.data().startedAtMillis || now(),
        updatedAt: stamp(),
      });
    });
    return { eventId, status: "live", participantCount: participants.length, reservationCount: expectedReservations };
  }

  // Staff change counts for the whole team or one athlete, before or during testing. Completed
  // reps are never removed: a lower target is simply met sooner, a higher one reopens the station
  // row. Every change is recorded with the remaining reps it moved.
  async function updateTestingRepCounts(data, auth) {
    const eventId = cleanId(data?.eventId, "testing event");
    const access = await requireEventOperator(eventId, auth);
    if (access.event.ownerUid !== auth.uid && !isClubAdmin(auth) && access.member?.role !== "manager") {
      fail("permission-denied", "Only the owner or a club manager can change rep counts.");
    }
    const playerId = data?.playerId === undefined || data?.playerId === null ? null : cleanId(data.playerId, "player");
    const reset = data?.reset === true;
    if (reset && !playerId) fail("invalid-argument", "Choose the athlete whose custom counts to clear.");
    const plans = reset ? {} : drillPlans(data?.repCounts);
    if (!reset && !Object.keys(plans).length) fail("invalid-argument", "Change at least one drill.");
    const sameDrill = (left, right) => left.repCount === right.repCount && left.sides.join() === right.sides.join();

    return db.runTransaction(async (tx) => {
      const eventDoc = await tx.get(access.ref);
      const event = eventDoc.data();
      if (!eventDoc.exists || !["draft", "starting", "live"].includes(event.status)) {
        fail("failed-precondition", "This testing session can no longer change rep counts.");
      }
      const participantDocs = playerId
        ? [await tx.get(access.ref.collection("participants").doc(playerId))]
        : (await tx.get(access.ref.collection("participants").limit(MAX_PARTICIPANTS))).docs;
      if (playerId && !participantDocs[0].exists) fail("not-found", "That athlete is not in this testing session.");
      const teamBefore = effectiveStations(event.protocolSnapshot);
      const teamAfter = playerId ? teamBefore : checkStationTotals(effectiveStations(teamBefore, plans));

      const changes = [];
      let playerOverrides = null;
      for (const doc of participantDocs) {
        const participant = doc.data();
        const overridesBefore = participant.protocolOverrides || null;
        const overridesAfter = !playerId ? overridesBefore : (reset ? null : { ...(overridesBefore || {}), ...plans });
        const before = effectiveStations(teamBefore, overridesBefore);
        const after = checkStationTotals(effectiveStations(teamAfter, overridesAfter));
        after.forEach((station, stationIndex) => station.drills.forEach((drill, drillIndex) => {
          const old = before[stationIndex].drills[drillIndex];
          if (!sameDrill(old, drill)) changes.push({ playerId: doc.id, participant, station, drill, old });
        }));
        if (playerId) playerOverrides = overridesAfter;
      }

      // Every read happens before the first write.
      const progressDocs = new Map();
      const reservationDocs = new Map();
      for (const change of changes) {
        const progressId = `${change.station.id}_${change.playerId}`;
        if (!progressDocs.has(progressId)) progressDocs.set(progressId, await tx.get(access.ref.collection("progress").doc(progressId)));
        const reservationId = `${progressId}_${change.drill.drillType}`;
        reservationDocs.set(reservationId, await tx.get(access.ref.collection("sessionReservations").doc(reservationId)));
      }
      const counterRef = (change) => db.collection("players").doc(change.playerId).collection("recordingCounters").doc(change.drill.drillType);
      const growing = changes.filter((change) => {
        const reservation = reservationDocs.get(`${change.station.id}_${change.playerId}_${change.drill.drillType}`);
        return reservation.exists && change.drill.repCount > Number(reservation.data().repCount || 0);
      });
      const counterDocs = new Map();
      for (const change of growing) counterDocs.set(`${change.playerId}_${change.drill.drillType}`, await tx.get(counterRef(change)));

      const affected = changes.map((change) => {
        const progress = progressDocs.get(`${change.station.id}_${change.playerId}`).data() || {};
        const done = progress.completedByDrill || {};
        const doneSides = progress.completedByProtocolSide || {};
        return {
          playerId: change.playerId,
          displayName: change.participant.displayName || "Athlete",
          stationId: change.station.id,
          drillType: change.drill.drillType,
          completed: Number(done[change.drill.drillType] || 0),
          before: change.old.repCount,
          after: change.drill.repCount,
          beforeSides: change.old.sides,
          afterSides: change.drill.sides,
          remainingBefore: remainingReps(change.old, done, doneSides),
          remainingAfter: remainingReps(change.drill, done, doneSides),
        };
      });

      // Absolute rep numbers were reserved by count at start. Growth extends the reservation at
      // the counter's tail, contiguously when nothing was reserved after it.
      for (const change of growing) {
        const reservationRef = access.ref.collection("sessionReservations").doc(`${change.station.id}_${change.playerId}_${change.drill.drillType}`);
        const reservation = reservationDocs.get(reservationRef.id).data();
        const counter = counterDocs.get(`${change.playerId}_${change.drill.drillType}`).data() || {};
        const capacity = Number(reservation.repCount || 0);
        const extra = change.drill.repCount - capacity;
        const extensions = Array.isArray(reservation.absoluteRepExtensions) ? reservation.absoluteRepExtensions : [];
        const tail = reservation.absoluteRepStart + capacity;
        const next = Math.max(Number(counter.nextAbsoluteRepNumber) || tail, tail);
        tx.update(reservationRef, !extensions.length && next === tail
          ? { repCount: change.drill.repCount }
          : { repCount: change.drill.repCount, absoluteRepExtensions: [...extensions, { start: next, count: extra }] });
        tx.set(counterRef(change), { nextAbsoluteRepNumber: next + extra, updatedAt: stamp() }, { merge: true });
      }
      for (const change of changes) {
        const reservation = reservationDocs.get(`${change.station.id}_${change.playerId}_${change.drill.drillType}`);
        if (!reservation.exists) continue;
        tx.set(db.collection("players").doc(change.playerId).collection("sessions").doc(reservation.data().sessionDocId),
          { expectedRepCount: change.drill.repCount }, { merge: true });
      }
      for (const [progressId, doc] of progressDocs) {
        if (!doc.exists) continue;
        const row = doc.data();
        const change = changes.find((candidate) => `${candidate.station.id}_${candidate.playerId}` === progressId);
        const done = row.completedByDrill || {};
        const doneSides = row.completedByProtocolSide || {};
        const firstOpen = change.station.drills.findIndex((drill) => !drillComplete(drill, done, doneSides));
        let status = row.status;
        if (status === "inProgress" && firstOpen < 0) status = "completedPendingSync";
        if (["completedPendingSync", "completed"].includes(status) && firstOpen >= 0) status = "inProgress";
        if (status === row.status) continue;
        tx.update(doc.ref, {
          status,
          currentDrillIndex: firstOpen < 0 ? change.station.drills.length - 1 : firstOpen,
          revision: Number(row.revision || 0) + 1,
          updatedAt: stamp(),
        });
      }

      const protocolRevision = Number(event.protocolRevision || 1) + 1;
      if (playerId) {
        tx.update(participantDocs[0].ref, { protocolOverrides: playerOverrides });
      } else {
        const snapshot = protocolSnapshot(teamAfter);
        tx.update(access.ref, { protocolSnapshot: snapshot, repsPerParticipant: repsForStations(snapshot) });
        for (const station of snapshot) tx.update(access.ref.collection("stations").doc(station.id), { drills: station.drills });
      }
      tx.update(access.ref, { protocolRevision, updatedAt: stamp() });
      tx.create(access.ref.collection("protocolChanges").doc(), {
        protocolRevision,
        scope: playerId ? "player" : "team",
        playerId,
        reset,
        repCounts: plans,
        eventStatus: event.status,
        changedByUid: auth.uid,
        changedAt: stamp(),
        changedAtMillis: now(),
        affected,
      });
      return { eventId, protocolRevision, scope: playerId ? "player" : "team", playerId, affected };
    });
  }

  function inviteCode(token) { return `TEST-${token}`; }
  function tokenFromCode(code) {
    if (typeof code !== "string") fail("invalid-argument", "Enter a valid testing session code.");
    const normalized = code.trim();
    if (!/^TEST-[A-Za-z0-9_-]{32,}$/.test(normalized)) fail("invalid-argument", "Enter a valid testing session code.");
    return normalized.slice(5);
  }
  function inviteId(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

  async function createTestingEventInvite(data, auth) {
    const access = await requireEventOperator(data?.eventId, auth);
    if (!access.event.operatorUids?.includes(auth.uid) && !isClubAdmin(auth)) fail("permission-denied", "Only an event operator can invite another device.");
    if (!['draft', 'starting', 'live'].includes(access.event.status)) fail("failed-precondition", "This testing session is not accepting operators.");
    const token = randomBytes(24).toString("base64url");
    const id = inviteId(token);
    await db.collection("testingEventInvites").doc(id).create({
      eventId: access.ref.id,
      organizationId: access.event.organizationId,
      createdByUid: auth.uid,
      status: "pending",
      expiresAtMillis: now() + INVITE_TTL_MS,
      createdAt: stamp(),
    });
    return { code: inviteCode(token), expiresAtMillis: now() + INVITE_TTL_MS };
  }

  async function joinTestingEvent(data, auth) {
    authRequired(auth);
    const token = tokenFromCode(data?.code);
    const ref = db.collection("testingEventInvites").doc(inviteId(token));
    return db.runTransaction(async (tx) => {
      const invite = await tx.get(ref);
      if (!invite.exists || invite.data().status !== "pending" || invite.data().expiresAtMillis <= now()) fail("not-found", "That testing session code is invalid or expired.");
      const event = await tx.get(db.collection("testingEvents").doc(invite.data().eventId));
      if (!event.exists || !["draft", "starting", "live"].includes(event.data().status)) fail("failed-precondition", "That testing session is no longer accepting operators.");
      const member = await tx.get(db.collection("organizations").doc(event.data().organizationId).collection("members").doc(auth.uid));
      if (!memberCanJoinEvent(event.data(), auth, member.exists ? member.data() : null)) {
        fail("permission-denied", "This code cannot grant access to athletes outside your authorized roster.");
      }
      tx.update(ref, { status: "claimed", usedByUid: auth.uid, usedAt: stamp() });
      tx.update(event.ref, { operatorUids: FieldValue.arrayUnion(auth.uid), updatedAt: stamp() });
      return { eventId: event.id, status: event.data().status, organizationId: event.data().organizationId };
    });
  }

  async function claimStation(data, auth, { renew = false, takeover = false } = {}) {
    authRequired(auth);
    const eventId = cleanId(data?.eventId, "testing event");
    const stationId = cleanId(data?.stationId, "station");
    const deviceId = cleanId(data?.deviceId, "device");
    if (!STATIONS.some((station) => station.id === stationId)) fail("invalid-argument", "Choose a valid station.");
    const event = await requireEventOperator(eventId, auth);
    if (!['starting', 'live'].includes(event.event.status)) fail("failed-precondition", "Start the testing session before claiming a station.");
    const stationRef = event.ref.collection("stations").doc(stationId);
    return db.runTransaction(async (tx) => {
      const liveEvent = await tx.get(event.ref);
      if (!liveEvent.exists || liveEvent.data().status !== "live") fail("failed-precondition", "This testing session has ended or is not live.");
      const station = await tx.get(stationRef);
      if (!station.exists) fail("not-found", "That station could not be found.");
      const current = station.data();
      const sameDevice = current.claimedByUid === auth.uid && current.claimedDeviceId === deviceId;
      const expired = !current.claimedDeviceId || Number(current.leaseExpiresAtMillis || 0) <= now();
      if (renew && !sameDevice) fail("failed-precondition", "This device no longer owns the station.");
      if (!renew && !sameDevice && !expired) {
        const canForce = takeover && (event.event.ownerUid === auth.uid || isClubAdmin(auth) || event.member?.role === "manager");
        if (!canForce) fail("already-exists", "Another device currently owns this station.");
      }
      const leaseExpiresAtMillis = now() + LEASE_MS;
      tx.update(stationRef, {
      claimedByUid: auth.uid,
      claimedDeviceId: deviceId,
      leaseExpiresAt: timestamp(leaseExpiresAtMillis),
      leaseExpiresAtMillis,
        lastHeartbeatAt: stamp(),
      });
      tx.set(event.ref.collection("devices").doc(deviceId), {
        operatorUid: auth.uid,
        stationId,
        appVersion: typeof data?.appVersion === "string" ? data.appVersion.slice(0, 40) : "",
        leaseExpiresAt: timestamp(leaseExpiresAtMillis),
        leaseExpiresAtMillis,
        lastSeenAt: stamp(),
      }, { merge: true });
      return { eventId, stationId, deviceId, leaseExpiresAtMillis };
    });
  }

  async function resetTestingStationCalibration(data, auth) {
    authRequired(auth);
    const eventId = cleanId(data?.eventId, "testing event");
    const stationId = cleanId(data?.stationId, "station");
    const deviceId = cleanId(data?.deviceId, "device");
    const definition = STATIONS.find((station) => station.id === stationId);
    if (!definition || definition.markerCount < 1) fail("invalid-argument", "Choose a calibrated station.");
    const event = await requireEventOperator(eventId, auth);
    if (event.event.status !== "live") fail("failed-precondition", "The testing session is not live.");
    const stationRef = event.ref.collection("stations").doc(stationId);
    return db.runTransaction(async (tx) => {
      const liveEvent = await tx.get(event.ref);
      if (!liveEvent.exists || liveEvent.data().status !== "live") fail("failed-precondition", "This testing session has ended or is not live.");
      const station = await tx.get(stationRef);
      if (!station.exists) fail("not-found", "That station could not be found.");
      const current = station.data();
      if (current.claimedByUid !== auth.uid || current.claimedDeviceId !== deviceId || Number(current.leaseExpiresAtMillis || 0) <= now()) {
        fail("failed-precondition", "This device no longer owns the station.");
      }
      const setupVersion = Math.max(1, Number(current.setupVersion) || 1) + 1;
      tx.update(stationRef, { setupVersion, calibrationResetAt: stamp(), lastHeartbeatAt: stamp() });
      return { eventId, stationId, setupVersion };
    });
  }

  async function closeTestingEvent(data, auth) {
    if (data?.force !== undefined && typeof data.force !== "boolean") fail("invalid-argument", "force must be a boolean.");
    const access = await requireEventOperator(data?.eventId, auth);
    if (access.event.ownerUid !== auth.uid && !isClubAdmin(auth) && access.member?.role !== "manager") fail("permission-denied", "Only the owner or a club manager can close this testing session.");
    const result = await db.runTransaction(async (tx) => {
      const eventDoc = await tx.get(access.ref);
      const event = eventDoc.data();
      if (!eventDoc.exists || !["live", "closed"].includes(event.status)) fail("failed-precondition", "This testing session cannot close yet.");
      if (event.status === "closed") return { ...event.syncSummary, eventId: access.ref.id, status: "closed" };
      const member = await tx.get(db.collection("organizations").doc(event.organizationId).collection("members").doc(auth.uid));
      if (!operatorCanAccessEvent(event, auth, member.data()) ||
          (event.ownerUid !== auth.uid && !isClubAdmin(auth) && member.data()?.role !== "manager")) fail("permission-denied", "You can no longer end this testing session.");
      const progress = await tx.get(access.ref.collection("progress").limit(MAX_PARTICIPANTS * STATIONS.length + 1));
      const expected = event.participantCount * STATIONS.length;
      const rows = progress.docs.map((doc) => doc.data());
      const completed = rows.filter((row) => row.status === "completed").length;
      const pending = rows.filter((row) => row.status === "completedPendingSync").length;
      const attention = rows.filter((row) => row.status === "needsAttention").length;
      const missing = Math.max(0, expected - rows.length);
      const ready = completed === expected && pending === 0 && attention === 0 && missing === 0;
      const summary = { eventId: access.ref.id, ready, expected, completed, pending, attention, missing };
      if (!ready && data?.force !== true) return summary;
      tx.update(access.ref, { status: "closed", closedAt: stamp(), closedAtMillis: now(), updatedAt: stamp(),
        closedByUid: auth.uid, endedEarly: !ready, syncSummary: summary });
      for (const station of STATIONS) tx.update(access.ref.collection("stations").doc(station.id), {
        claimedByUid: null, claimedDeviceId: null, leaseExpiresAt: timestamp(0), leaseExpiresAtMillis: 0,
      });
      return { ...summary, status: "closed" };
    });
    if (result.status === "closed") {
      // Existing results remain usable even if the organizer ended an incomplete event.
      // Dirty markers survive a projection failure and are retried by the normal sweeper.
      const participants = await access.ref.collection("participants").limit(MAX_PARTICIPANTS).get();
      await Promise.allSettled(participants.docs.map((doc) => maybeFinalizePlayer(access.ref.id, doc.id)));
    }
    return result;
  }

  async function markProjectionDirty(eventId, playerId, source) {
    await eventRef(eventId).collection("projectionDirty").doc(playerId).set({
      playerId,
      source,
      revision: FieldValue.increment(1),
      pending: true,
      updatedAt: stamp(),
      updatedAtMillis: now(),
    }, { merge: true });
  }

  async function maybeFinalizePlayer(eventId, playerId) {
    const ref = eventRef(eventId);
    const rows = await Promise.all(STATIONS.map((station) => ref.collection("progress").doc(`${station.id}_${playerId}`).get()));
    const event = await ref.get();
    if (event.data()?.status !== "closed" && rows.some((row) => !row.exists || row.data().status !== "completed")) return false;
    const dirtyRef = ref.collection("projectionDirty").doc(playerId);
    const finalizationRef = ref.collection("projectionFinalizations").doc(playerId);
    const claimedRevision = await db.runTransaction(async (tx) => {
      const [dirty, finalization] = await Promise.all([tx.get(dirtyRef), tx.get(finalizationRef)]);
      const dirtyRevision = Number(dirty.data()?.revision || 0);
      const finalizedRevision = Number(finalization.data()?.finalizedRevision || 0);
      const runningFresh = finalization.data()?.status === "running" && Number(finalization.data()?.startedAtMillis || 0) > now() - 10 * 60 * 1000;
      if (dirtyRevision <= finalizedRevision || runningFresh) return 0;
      tx.set(finalizationRef, {
        playerId,
        status: "running",
        targetRevision: dirtyRevision,
        startedAt: stamp(),
        startedAtMillis: now(),
      }, { merge: true });
      return dirtyRevision;
    });
    if (!claimedRevision) return false;
    try {
      await finalizePlayer(playerId, { sourceKind: "testing_event", eventId: `testing-event/${eventId}/${claimedRevision}` });
      await finalizationRef.set({
        playerId,
        status: "completed",
        finalizedRevision: claimedRevision,
        completedAt: stamp(),
        completedAtMillis: now(),
      }, { merge: true });
      await db.runTransaction(async (tx) => {
        const dirty = await tx.get(dirtyRef);
        if (Number(dirty.data()?.revision || 0) <= claimedRevision) {
          tx.set(dirtyRef, { pending: false, finalizedAt: stamp() }, { merge: true });
        }
      });
      return true;
    } catch (error) {
      await finalizationRef.set({ status: "failed", failureMessage: String(error?.message || error), failedAt: stamp() }, { merge: true });
      throw error;
    }
  }

  async function reconcileProgress(eventId, progressId) {
    if (!playerSegment(eventId) || !playerSegment(progressId)) return;
    const ref = eventRef(eventId);
    const progressRef = ref.collection("progress").doc(progressId);
    const progressDoc = await progressRef.get();
    if (!progressDoc.exists) return;
    const row = progressDoc.data();
    if (!playerSegment(row.playerDocId) || !STATIONS.some((station) => station.id === row.stationId)) return;
    const repIds = Array.isArray(row.repIds) ? [...new Set(row.repIds.filter(playerSegment))].slice(0, 10) : [];
    const commits = await Promise.all(repIds.map((repId) => ref.collection("committedReps").doc(repId).get()));
    const pendingUploadCount = commits.filter((doc) => !doc.exists).length;
    let status = row.status;
    if (status === "completedPendingSync" && pendingUploadCount === 0) status = "completed";
    if (status === "completed" && pendingUploadCount > 0) status = "needsAttention";
    if (pendingUploadCount !== Number(row.pendingUploadCount || 0) || status !== row.status) {
      await progressRef.update({ pendingUploadCount, status, reconciledAt: stamp() });
    }
    if (status === "completed") await maybeFinalizePlayer(eventId, row.playerDocId);
  }

  async function repairProgressFromCommittedRep(eventId, stationId, playerId, repId, source) {
    // An invalid attempt never fills a slot. Current app builds never write one for a
    // testing event; this guards reps journaled by older builds whose progress write was lost.
    if (source.resultsValid === false) return;
    const drillType = source.testingDrillType;
    const progressRef = eventRef(eventId).collection("progress").doc(`${stationId}_${playerId}`);
    await db.runTransaction(async (tx) => {
      const [snapshot, eventDoc, participantDoc] = await Promise.all([
        tx.get(progressRef), tx.get(eventRef(eventId)), tx.get(eventRef(eventId).collection("participants").doc(playerId)),
      ]);
      const station = effectiveStations(eventDoc.data()?.protocolSnapshot, participantDoc.data()?.protocolOverrides)
        .find((candidate) => candidate.id === stationId);
      const drillIndex = station?.drills.findIndex((candidate) => candidate.drillType === drillType) ?? -1;
      if (drillIndex < 0) return;
      if (!snapshot.exists) return;
      const row = snapshot.data();
      const repIds = Array.isArray(row.repIds) ? row.repIds.filter(playerSegment) : [];
      if (repIds.includes(repId)) return;
      const completedByDrill = { ...(row.completedByDrill || {}) };
      completedByDrill[drillType] = Number(completedByDrill[drillType] || 0) + 1;
      const completedByProtocolSide = { ...(row.completedByProtocolSide || {}) };
      if (typeof source.protocolSide === "string" && ["left", "right"].includes(source.protocolSide)) {
        const key = `${drillType}:${source.protocolSide}`;
        completedByProtocolSide[key] = Number(completedByProtocolSide[key] || 0) + 1;
      }
      const stationComplete = station.drills.every((drill) => drillComplete(drill, completedByDrill, completedByProtocolSide));
      const keepAttention = row.status === "needsAttention";
      tx.update(progressRef, {
        repIds: [...repIds, repId].slice(0, MAX_REPS_PER_STATION),
        completedByDrill,
        completedByProtocolSide,
        currentDrillIndex: stationComplete ? station.drills.length - 1 : drillIndex,
        pendingUploadCount: Number(row.pendingUploadCount || 0) + 1,
        status: keepAttention ? "needsAttention" : (stationComplete ? "completedPendingSync" : "inProgress"),
        revision: Number(row.revision || 0) + 1,
        recoveredFromCommittedRepAt: stamp(),
      });
    });
  }

  async function onRepWrite(change, context) {
    const before = change.before?.data?.() || {};
    const after = change.after?.data?.() || {};
    const source = Object.keys(after).length ? after : before;
    const eventId = source.testingEventId;
    const stationId = source.testingStationId;
    const playerId = context?.params?.playerId;
    const repId = context?.params?.repId;
    if (!playerSegment(eventId) || !STATIONS.some((station) => station.id === stationId)
        || !playerSegment(playerId) || !playerSegment(repId) || source.testingParticipantId !== playerId) return false;
    await markProjectionDirty(eventId, playerId, "rep");
    const commitRef = eventRef(eventId).collection("committedReps").doc(repId);
    if (Object.keys(after).length) {
      await commitRef.set({ eventId, stationId, playerId, repId, committedAt: stamp() }, { merge: true });
      await repairProgressFromCommittedRep(eventId, stationId, playerId, repId, after);
    } else {
      await commitRef.delete();
    }
    await reconcileProgress(eventId, `${stationId}_${playerId}`);
    return true;
  }

  async function onProgressWrite(change, context) {
    const row = change.after?.data?.();
    if (!row) return;
    await reconcileProgress(context?.params?.eventId, context?.params?.progressId);
  }

  async function sweepTestingFinalizations() {
    const dirty = await db.collectionGroup("projectionDirty").where("pending", "==", true).limit(100).get();
    let finalized = 0;
    for (const marker of dirty.docs) {
      const parentEvent = marker.ref.parent.parent;
      if (parentEvent && await maybeFinalizePlayer(parentEvent.id, marker.id)) finalized += 1;
    }
    return { scanned: dirty.size, finalized };
  }

  return {
    createTestingEvent,
    addTestingParticipant,
    startTestingEvent,
    updateTestingRepCounts,
    createTestingEventInvite,
    joinTestingEvent,
    claimTestingStation: (data, auth) => claimStation(data, auth),
    renewTestingStationLease: (data, auth) => claimStation(data, auth, { renew: true }),
    takeOverTestingStation: (data, auth) => claimStation(data, auth, { takeover: true }),
    resetTestingStationCalibration,
    closeTestingEvent,
    onRepWrite,
    onProgressWrite,
    reconcileProgress,
    sweepTestingFinalizations,
  };
}

module.exports = {
  createTestingEvents,
  STATIONS,
  PROTOCOL_ID,
  MAX_PARTICIPANTS,
  LEASE_MS,
  INVITE_TTL_MS,
  REPS_PER_PARTICIPANT,
  RESERVATIONS_PER_PARTICIPANT,
  MAX_REPS_PER_DRILL,
  MAX_REPS_PER_STATION,
  effectiveStations,
};
