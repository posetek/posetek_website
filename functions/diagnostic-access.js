"use strict";
const { isClubAdmin, memberCanAccessPlayer } = require("./club-access");
const { playerSegment } = require("./athlete-storage-paths");

// Diagnostics authorization shared by the upload broker (diagnostic-uploads.js)
// and device-performance ingestion. Extracted unchanged from diagnostic-uploads.js
// (decision D-2026-09-29-11b) so original-reporter and revoked-access behavior
// has one source of truth.

// A registered, non-anonymous caller whose UID is a valid path segment.
function registeredReporter(auth) {
  return Boolean(auth?.uid && auth.isAnonymous !== true && playerSegment(auth.uid));
}
// The schema-2 diagnostics record (processingAttempts / failureCases) was
// reported by this caller. The record's reportedByUid is rules-pinned to its writer.
function originalReporter(record, auth) {
  return record?.schemaVersion === 2 && record.reportedByUid === auth.uid;
}
// No retention phase has started for the record's artifacts.
function retentionActive(record) {
  return !(record.retentionState && record.retentionState !== "active");
}

function createDiagnosticAccess({ db }) {
  async function read(path) {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() : null;
  }
  // Current access to the athlete: admin, the athlete's own account, active club
  // staff for the athlete's team, or the legacy coach. Revocation takes effect
  // on the next check because nothing here is cached.
  async function athleteAccess(id, auth) {
    if (!playerSegment(id)) return false;
    const player = await read(`players/${id}`);
    if (!player) return false;
    if (isClubAdmin(auth)) return true;
    const own = (player.authenticationUID ?? auth.uid) === auth.uid && (player.userUID ?? auth.uid) === auth.uid
      && (player.authenticationUID === auth.uid || player.userUID === auth.uid || id === auth.uid);
    if (own) return true;
    if (Object.hasOwn(player, "organizationId")) {
      if (!playerSegment(player.organizationId)) return false;
      return memberCanAccessPlayer(await read(`organizations/${player.organizationId}/members/${auth.uid}`), auth.uid, player);
    }
    if ([player.coachUID, player.coachId, player.coachDocId].includes(auth.uid)) return true;
    const coachId = player.coachDocId || auth.uid;
    if (!playerSegment(coachId)) return false;
    const coach = await read(`coaches/${coachId}`);
    return coach?.userUID === auth.uid && Array.isArray(coach.members) && coach.members.includes(id);
  }
  return { read, athleteAccess };
}

module.exports = { createDiagnosticAccess, registeredReporter, originalReporter, retentionActive };
