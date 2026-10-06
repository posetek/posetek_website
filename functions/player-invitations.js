"use strict";
const crypto = require("node:crypto");
const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, memberCanAccessPlayer } = require("./club-access");
const { staffPlayerProfile } = require("./player-profile");
const unclaimed = p => p && p.registered !== true && !p.authenticationUID && !p.userUID;
const digest = code => crypto.createHash("sha256").update(code.toUpperCase()).digest("hex");
const validCode = code => typeof code === "string" && /^[A-Za-z0-9-]{6,64}$/.test(code);
const invitationResult = (playerId, code) => ({ playerId, code, signupUrl: `https://posetek.net/signin#playerCode=${encodeURIComponent(code)}` });

function createPlayerInvitations({ db, FieldValue, HttpsError }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const refs = id => ({ player: db.doc(`players/${id}`), invitation: db.doc(`playerSignupInvitations/${id}`) });
  async function authority(tx, p, auth) {
    const org = playerSegment(p.organizationId) ? await tx.get(db.doc(`organizations/${p.organizationId}`)) : null;
    const coachId = p.coachDocId || p.coachUID;
    const coach = playerSegment(coachId) ? await tx.get(db.doc(`coaches/${coachId}`)) : null;
    const validCoach = coach?.exists && playerSegment(coach.data().userUID) && (!p.coachUID || p.coachUID === coach.data().userUID);
    if (!org?.exists && !validCoach) return false;
    if (!auth || isClubAdmin(auth)) return true;
    if (org?.exists) {
      const member = await tx.get(db.doc(`organizations/${p.organizationId}/members/${auth.uid}`));
      return memberCanAccessPlayer(member.data(), auth.uid, p) || (org.data().schemaVersion !== 2 && validCoach && coach.data().userUID === auth.uid);
    }
    return validCoach && coach.data().userUID === auth.uid;
  }
  function stage(tx, id, p, code) {
    const r = refs(id);
    tx.set(r.invitation, { playerId: id, code, createdAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`playerSignupCodes/${digest(code)}`), { playerId: id });
    return { ...p, signupInvitationReady: true, signupCodeVersion: 3 };
  }
  async function protectedCode(tx, playerId, invitation) {
    if (!invitation.exists) return null;
    const stored = invitation.data();
    if (stored?.playerId !== playerId || !validCode(stored?.code)) {
      fail("failed-precondition", "This invitation needs review before it can be shared.");
    }
    const index = await tx.get(db.doc(`playerSignupCodes/${digest(stored.code)}`));
    if (!index.exists || index.data()?.playerId !== playerId) {
      fail("failed-precondition", "This invitation needs review before it can be shared.");
    }
    return stored.code;
  }
  // Use bounded exact legacy lookups, but reject ambiguity across both fields
  // rather than letting query order choose which athlete an invitation claims.
  async function legacyCandidate(tx, code) {
    const candidates = new Map();
    for (const field of ["signupCode", "code"]) {
      for (const value of [...new Set([code, code.toUpperCase()])]) {
        const found = await tx.get(db.collection("players").where(field, "==", value).limit(2));
        for (const doc of found.docs) candidates.set(doc.id, doc);
        if (candidates.size > 1) return null;
      }
    }
    return candidates.size === 1 ? [...candidates.values()][0] : null;
  }
  async function getInvitation(playerId, auth) {
    if (!auth || !playerSegment(auth.uid) || auth.isAnonymous) fail("unauthenticated", "Sign in to manage invitations.");
    if (!playerSegment(playerId)) fail("invalid-argument", "Choose a valid player.");
    return db.runTransaction(async tx => {
      const r = refs(playerId);
      const [snapshot, invitation] = await Promise.all([tx.get(r.player), tx.get(r.invitation)]);
      const p = snapshot.data();
      if (!p || !await authority(tx, p, auth)) fail("permission-denied", "This player is not assigned to your access.");
      if (!unclaimed(p)) return { status: "claimed", playerId };
      const code = await protectedCode(tx, playerId, invitation);
      if (code) return { status: "ready", ...invitationResult(playerId, code) };
      // A still-redeemable version-2 code can be viewed without migrating it.
      const legacy = p.signupCodeVersion === 2 && [p.signupCode, p.code].find(validCode);
      if (legacy) {
        const [candidate, index] = await Promise.all([legacyCandidate(tx, legacy), tx.get(db.doc(`playerSignupCodes/${digest(legacy)}`))]);
        if (candidate?.id !== playerId || index.exists) fail("failed-precondition", "This invitation needs review before it can be shared.");
        return { status: "ready", ...invitationResult(playerId, legacy) };
      }
      return { status: "missing", playerId };
    });
  }
  // Public preflight exposes only availability. Redemption still rechecks all
  // state atomically; a successful preflight never reserves or claims a code.
  async function validate(rawCode) {
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    if (!validCode(code)) return { valid: false };
    return db.runTransaction(async tx => {
      const index = await tx.get(db.doc(`playerSignupCodes/${digest(code)}`));
      if (index.exists) {
        const playerId = index.data()?.playerId;
        if (!playerSegment(playerId)) return { valid: false };
        const r = refs(playerId);
        const [player, invitation] = await Promise.all([tx.get(r.player), tx.get(r.invitation)]);
        const stored = invitation.data();
        return { valid: Boolean(unclaimed(player.data()) && stored?.playerId === playerId && validCode(stored?.code) && stored.code.toUpperCase() === code.toUpperCase()) };
      }
      const candidate = await legacyCandidate(tx, code);
      const p = candidate?.data();
      if (!candidate || !playerSegment(candidate.id) || !unclaimed(p) || p.signupCodeVersion !== 2) return { valid: false };
      const invitation = await tx.get(refs(candidate.id).invitation);
      return { valid: !invitation.exists && [p.signupCode, p.code].some(value => validCode(value) && value.toUpperCase() === code.toUpperCase()) };
    });
  }
  async function ensure(playerId, auth = null, { rotate = false, dryRun = false } = {}) {
    if (!playerSegment(playerId)) fail("invalid-argument", "Choose a valid player.");
    if (auth && (!playerSegment(auth.uid) || auth.isAnonymous)) fail("unauthenticated", "Sign in to manage invitations.");
    const r = refs(playerId);
    return db.runTransaction(async tx => {
      const [snapshot, invitation] = await Promise.all([tx.get(r.player), tx.get(r.invitation)]);
      const p = snapshot.data();
      if (!p || !await authority(tx, p, auth)) {
        if (auth) fail("permission-denied", "This player is not assigned to your access.");
        return { skipped: "No valid organization or coach" };
      }
      if (!unclaimed(p)) {
        if (auth) fail("failed-precondition", "This player already has a sign-in.");
        return { skipped: "Already claimed" };
      }
      const oldCode = await protectedCode(tx, playerId, invitation);
      if (oldCode && !rotate) return { ...invitationResult(playerId, oldCode), writes: 0 };
      // Preserve valid issued codes when moving them into protected storage.
      const legacy = [p.signupCode, p.code].find(validCode);
      if (!rotate && p.signupCodeVersion === 2 && legacy && (await legacyCandidate(tx, legacy))?.id !== playerId) {
        fail("failed-precondition", "This invitation needs review before it can be shared.");
      }
      const code = !rotate && p.signupCodeVersion === 2 && legacy ? legacy : `PLR-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
      const index = await tx.get(db.doc(`playerSignupCodes/${digest(code)}`));
      if (index.exists && index.data().playerId !== playerId) fail("already-exists", "Invitation collision. Replace this invitation.");
      if (!dryRun) {
        if (oldCode) tx.delete(db.doc(`playerSignupCodes/${digest(oldCode)}`));
        if (index.exists) tx.delete(index.ref);
        stage(tx, playerId, p, code);
        tx.update(r.player, { signupInvitationReady: true, signupCodeVersion: 3, signupCode: FieldValue.delete(), code: FieldValue.delete() });
      }
      return { ...invitationResult(playerId, code), writes: 3 };
    });
  }
  async function redeem(code, uid, email) {
    const indexRef = db.doc(`playerSignupCodes/${digest(code)}`);
    return db.runTransaction(async tx => {
      const index = await tx.get(indexRef);
      if (!index.exists) return null;
      if (!playerSegment(index.data()?.playerId)) fail("not-found", "This signup invitation is no longer available.");
      const r = refs(index.data().playerId);
      const [p, invite, first, second, direct] = await Promise.all([tx.get(r.player), tx.get(r.invitation),
        tx.get(db.collection("players").where("authenticationUID", "==", uid).limit(1)),
        tx.get(db.collection("players").where("userUID", "==", uid).limit(1)), tx.get(db.doc(`players/${uid}`))]);
      if (!first.empty || !second.empty || direct.exists) fail("already-exists", "This account already has an athlete profile.");
      if (!unclaimed(p.data()) || invite.data()?.playerId !== p.id || !validCode(invite.data()?.code) || invite.data().code.toUpperCase() !== code.toUpperCase()) fail("not-found", "This signup invitation is no longer available.");
      tx.update(r.player, { authenticationUID: uid, userUID: uid, registered: true,
        ...(email ? { email } : {}), signupCode: FieldValue.delete(), code: FieldValue.delete(), signupCodeVersion: FieldValue.delete(),
        signupInvitationReady: FieldValue.delete(), signupRedeemedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.delete(r.invitation); tx.delete(indexRef);
      return { playerId: p.id };
    });
  }
  async function createCoachPlayer(data, auth) {
    if (!auth?.uid || auth.isAnonymous) fail("unauthenticated", "Sign in with your coach account.");
    const firstName = String(data.firstName || "").trim(), lastName = String(data.lastName || "").trim();
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) fail("invalid-argument", "Enter the player's name.");
    const profile = staffPlayerProfile(data, fail);
    const creationId = typeof data.creationId === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(data.creationId) ? digest(auth.uid + ":" + data.creationId) : undefined;
    const ref = creationId ? db.collection("players").doc(creationId) : db.collection("players").doc(), code = `PLR-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
    return db.runTransaction(async tx => {
      const coachId = playerSegment(data.coachDocId) ? data.coachDocId : auth.uid;
      const coach = await tx.get(db.doc(`coaches/${coachId}`));
      if (!coach.exists || coach.data().userUID !== auth.uid) fail("permission-denied", "Use your organization's player creation form.");
      const [existing, invitation] = await Promise.all([tx.get(ref), tx.get(db.doc(`playerSignupInvitations/${ref.id}`))]);
      if (existing.exists) {
        if (existing.data().coachUID !== auth.uid || existing.data().firstName !== firstName || existing.data().lastName !== lastName) fail("failed-precondition", "Finish the original player creation before changing the name.");
        return { playerId: ref.id, code: invitation.data()?.code || null };
      }
      const organizationId = coach.data().organizationId;
      const org = playerSegment(organizationId) ? await tx.get(db.doc(`organizations/${organizationId}`)) : null;
      if (org?.data()?.schemaVersion === 2) fail("permission-denied", "Choose a team in your organization to create this player.");
      const p = { ...(org?.exists ? { organizationId } : {}), ...profile, firstName, lastName, coachUID: auth.uid, coachDocId: coach.id, registered: false, sport: "Soccer", createdAt: FieldValue.serverTimestamp() };
      tx.create(ref, stage(tx, ref.id, p, code));
      const members = Array.isArray(coach.data().members) ? coach.data().members : [];
      tx.update(coach.ref, { members: [...members, ref.id], numberMembers: members.length + 1 });
      return { playerId: ref.id, code };
    });
  }
  return { getInvitation, validate, ensure, redeem, stage, createCoachPlayer };
}
module.exports = { createPlayerInvitations, unclaimed };
