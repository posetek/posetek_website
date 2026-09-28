"use strict";

// Club authority is held only in organizations/{id}/members/{authUID}.
// Team rosters, coach mirrors and organization directory arrays are projections.
// All membership changes and their projections commit in one transaction.
const crypto = require("crypto");
const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, activeMember, memberCanAccessPlayer } = require("./club-access");
const { staffPlayerProfile } = require("./player-profile");
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEAMS = 100;
const MAX_STAFF = 100;
const MAX_PLAYERS = 2000;

function createClubs({ invitations, db, FieldValue, HttpsError, now = () => Date.now(), randomBytes = crypto.randomBytes }) {
  const stamp = () => FieldValue.serverTimestamp();
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const id = (value, label = "identifier") => playerSegment(value) ? value : fail("invalid-argument", `Enter a valid ${label}.`);
  function authRequired(auth) {
    if (!auth?.uid || !playerSegment(auth.uid) || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
  }
  function text(value, label, limit = 100) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > limit) fail("invalid-argument", `Enter a valid ${label}.`);
    return value.trim();
  }
  function email(value) {
    const result = text(value, "email address", 254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result)) fail("invalid-argument", "Enter a valid email address.");
    return result;
  }
  function teamIds(value) {
    if (!Array.isArray(value) || value.length > MAX_TEAMS) fail("invalid-argument", "Choose valid teams.");
    return [...new Set(value.map((entry) => id(entry, "team")))].sort();
  }
  function publicOrg(doc) {
    const source = doc.data();
    const result = { id: doc.id, name: String(source.name || ""), schemaVersion: 2 };
    for (const key of ["logoStoragePath", "logoUrl", "logoSourceUrl", "websiteUrl"]) if (typeof source[key] === "string") result[key] = source[key];
    return result;
  }
  function publicPlayer(player) {
    const weightKg = typeof player.weight === "number" && Number.isFinite(player.weight) && player.weight > 0 ? player.weight : null;
    return { id: player.id, firstName: String(player.firstName || ""), lastName: String(player.lastName || ""), organizationId: player.organizationId, teamId: player.teamId || "", weightKg, canIssueSignupCode: canIssuePlayerCode(player) };
  }
  function canIssuePlayerCode(player) {
    return player.registered !== true && !["authenticationUID", "userUID"].some((field) => Object.hasOwn(player, field));
  }
  function publicMember(member) {
    return { userUID: member.userUID, email: member.email || "", firstName: member.firstName || "", lastName: member.lastName || "", role: member.role, teamIds: member.teamIds || [], status: member.status };
  }
  function publicTeam(team) {
    return { id: team.id, organizationId: team.organizationId, name: team.name, coachUIDs: team.coachUIDs || [], playerIds: team.playerIds || [] };
  }
  function invitationStatus(invite) { return invite.status === "pending" && invite.expiresAtMillis <= now() ? "expired" : invite.status; }
  function publicInvite(doc, activation = null) {
    const invite = doc.data();
    return { id: doc.id, email: invite.email, firstName: invite.firstName, lastName: invite.lastName, role: invite.role, teamIds: invite.teamIds, activationMode: invite.activationMode === "manual" ? "manual" : "verified_email", status: invitationStatus(invite), ...(invite.activationMode === "manual" ? { activationStatus: activation?.status === "pending" && activation.expiresAtMillis <= now() ? "expired" : activation?.status || "blocked" } : {}), expiresAtMillis: invite.expiresAtMillis };
  }
  function requireTeams(state, ids) {
    if (ids.some((teamId) => !state.teams.some((team) => team.id === teamId))) fail("invalid-argument", "Every selected team must belong to this club.");
  }
  function requireManager(state, auth) {
    if (!isClubAdmin(auth) && !(activeMember(state.actor, auth.uid) && state.actor.role === "manager")) fail("permission-denied", "A club manager or PoseTek admin must make this change.");
  }
  // Reads precede every write, including mirror identity checks. Bounded club
  // sizes keep atomic updates below Firestore's 500-write transaction limit.
  async function readClub(tx, organizationId, auth, managerOnly = true) {
    authRequired(auth);
    const orgRef = db.collection("organizations").doc(id(organizationId, "organization"));
    const org = await tx.get(orgRef);
    if (!org.exists || org.data().schemaVersion !== 2) fail("not-found", "That club could not be found.");
    const actorDoc = await tx.get(orgRef.collection("members").doc(auth.uid));
    const state = { orgRef, org: org.data(), actor: actorDoc.exists ? actorDoc.data() : null };
    if (managerOnly) requireManager(state, auth);
    const [teams, members, players] = await Promise.all([
      tx.get(db.collection("teams").where("organizationId", "==", organizationId).limit(MAX_TEAMS + 1)),
      tx.get(orgRef.collection("members").limit(MAX_STAFF + 1)),
      tx.get(db.collection("players").where("organizationId", "==", organizationId).limit(MAX_PLAYERS + 1)),
    ]);
    if (teams.size > MAX_TEAMS || members.size > MAX_STAFF || players.size > MAX_PLAYERS) fail("resource-exhausted", "This club requires a larger managed migration. Contact PoseTek.");
    state.teams = teams.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    state.members = members.docs.map((doc) => ({ ...doc.data(), userUID: doc.id }));
    // Reject corrupt authority instead of silently adopting a different UID.
    if (members.docs.some((doc) => doc.data().userUID !== doc.id)) fail("failed-precondition", "A club membership needs administrator repair.");
    state.players = players.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const mirrors = await Promise.all(state.members.map((member) => tx.get(db.collection("coaches").doc(member.userUID))));
    state.mirrors = new Map(mirrors.map((doc) => [doc.id, doc.exists ? doc.data() : null]));
    for (const member of state.members) {
      const mirror = state.mirrors.get(member.userUID);
      if (mirror && (mirror.userUID !== member.userUID || (Object.hasOwn(mirror, "organizationId") && mirror.organizationId !== organizationId))) fail("failed-precondition", "A staff profile belongs to a different account or club.");
    }
    return state;
  }
  function syncProjections(tx, state) {
    const active = state.members.filter((member) => activeMember(member, member.userUID));
    tx.update(state.orgRef, { memberUIDs: active.map((m) => m.userUID).sort(), managerUIDs: active.filter((m) => m.role === "manager").map((m) => m.userUID).sort(), updatedAt: stamp() });
    for (const team of state.teams) {
      const playerIds = state.players.filter((p) => p.teamId === team.id).map((p) => p.id).sort();
      const coachUIDs = active.filter((m) => m.role === "coach" && m.teamIds.includes(team.id)).map((m) => m.userUID).sort();
      tx.set(db.collection("teams").doc(team.id), { organizationId: state.orgRef.id, name: team.name, playerIds, coachUIDs, updatedAt: stamp() }, { merge: true });
    }
    for (const member of state.members) {
      const members = state.players.filter((player) => memberCanAccessPlayer(member, member.userUID, player)).map((player) => player.id).sort();
      tx.set(db.collection("coaches").doc(member.userUID), {
        userUID: member.userUID, email: member.email || "", firstName: member.firstName || "", lastName: member.lastName || "",
        organizationId: state.orgRef.id, organization: state.orgRef, organizationRole: member.role,
        organizationStatus: member.status, teamIds: member.teamIds, members, numberMembers: members.length, updatedAt: stamp(),
      }, { merge: true });
    }
  }
  async function findPlayer(uid) {
    const candidates = [];
    for (const field of ["authenticationUID", "userUID"]) {
      const result = await db.collection("players").where(field, "==", uid).limit(2).get();
      candidates.push(...result.docs);
    }
    const direct = await db.collection("players").doc(uid).get();
    if (direct.exists) candidates.push(direct);
    const unique = [...new Map(candidates.map((doc) => [doc.id, doc])).values()];
    if (unique.length !== 1) return null;
    const player = unique[0].data();
    if (["authenticationUID", "userUID"].some((field) => Object.hasOwn(player, field) && player[field] !== uid)) return null;
    return { ...player, id: unique[0].id };
  }
  async function getClubContext(data, auth) {
    authRequired(auth);
    const admin = isClubAdmin(auth);
    const orgDocs = await (admin ? db.collection("organizations").where("schemaVersion", "==", 2) : db.collection("organizations").where("memberUIDs", "array-contains", auth.uid)).limit(100).get();
    const organizations = [];
    const memberships = new Map();
    for (const org of orgDocs.docs) {
      if (org.data().schemaVersion !== 2) continue;
      const member = admin ? null : await org.ref.collection("members").doc(auth.uid).get();
      if (admin || activeMember(member?.data(), auth.uid)) {
        organizations.push(publicOrg(org));
        memberships.set(org.id, member?.data());
      }
    }
    const player = organizations.length || admin ? null : await findPlayer(auth.uid);
    if (player?.organizationId) {
      const org = await db.collection("organizations").doc(player.organizationId).get();
      if (org.exists && org.data().schemaVersion === 2) organizations.push(publicOrg(org));
    }
    const selected = data?.organizationId ? id(data.organizationId, "organization") : admin ? null : organizations[0]?.id;
    const result = { role: admin ? "admin" : "none", organizations, organization: null, teams: [], staff: [], invitations: [], players: [] };
    if (!selected) return result;
    const organization = organizations.find((org) => org.id === selected);
    if (!organization) fail("permission-denied", "You do not have access to that club.");
    const membership = memberships.get(selected);
    const role = admin ? "admin" : membership?.role || (player?.organizationId === selected ? "player" : "none");
    if (role === "none") fail("permission-denied", "You do not have access to that club.");
    const [teams, players] = await Promise.all([
      db.collection("teams").where("organizationId", "==", selected).limit(MAX_TEAMS).get(),
      role === "player" ? Promise.resolve({ docs: [] }) : db.collection("players").where("organizationId", "==", selected).limit(MAX_PLAYERS).get(),
    ]);
    result.role = role;
    result.organization = organization;
    result.teams = teams.docs.map((doc) => ({ ...doc.data(), id: doc.id })).filter((team) => ["admin", "manager"].includes(role) || (role === "coach" ? membership.teamIds.includes(team.id) : player.teamId === team.id)).map(publicTeam);
    // A player's team descriptor must not disclose other athlete document IDs.
    if (role === "player") result.teams = result.teams.map((team) => ({ ...team, playerIds: [player.id] }));
    result.players = role === "player" ? [publicPlayer(player)] : players.docs.map((doc) => ({ ...doc.data(), id: doc.id })).filter((p) => role === "admin" || memberCanAccessPlayer(membership, auth.uid, p)).map(publicPlayer);
    if (["admin", "manager"].includes(role)) {
      const [staff, invitations] = await Promise.all([
        db.collection("organizations").doc(selected).collection("members").limit(MAX_STAFF).get(),
        db.collection("clubStaffInvitations").where("organizationId", "==", selected).limit(200).get(),
      ]);
      result.staff = staff.docs.map((doc) => publicMember(doc.data()));
      result.invitations = await Promise.all(invitations.docs.map(async doc => publicInvite(doc, doc.data().activationMode === "manual" && playerSegment(doc.data().grantId) ? (await db.doc(`accountAccessGrants/${doc.data().grantId}`).get()).data() : null)));
    }
    return result;
  }
  async function createClubOrganization(data, auth) {
    authRequired(auth);
    if (!isClubAdmin(auth)) fail("permission-denied", "Only a PoseTek admin can create a club.");
    const name = text(data?.name, "club name", 120);
    const orgRef = db.collection("organizations").doc();
    await orgRef.create({ name, schemaVersion: 2, memberUIDs: [], managerUIDs: [], coaches: [], players: [], createdAt: stamp(), updatedAt: stamp(), createdByUID: auth.uid });
    return { organizationId: orgRef.id };
  }
  async function saveClubTeam(data, auth) {
    const name = text(data?.name, "team name", 120);
    const teamRef = data?.teamId ? db.collection("teams").doc(id(data.teamId, "team")) : db.collection("teams").doc();
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data?.organizationId, auth);
      const teamDoc = await tx.get(teamRef);
      if (teamDoc.exists && teamDoc.data().organizationId !== state.orgRef.id) fail("permission-denied", "That team belongs to another club.");
      if (data?.teamId && !teamDoc.exists) fail("not-found", "That team could not be found.");
      const team = state.teams.find((entry) => entry.id === teamRef.id);
      if (team) team.name = name;
      else {
        if (state.teams.length >= MAX_TEAMS) fail("resource-exhausted", "The club team limit has been reached.");
        state.teams.push({ id: teamRef.id, name });
        tx.create(teamRef, { organizationId: state.orgRef.id, name, createdAt: stamp() });
      }
      syncProjections(tx, state);
    });
    return { teamId: teamRef.id };
  }
  async function validateStaffInvitation(data, auth, replacementId = null) {
    return db.runTransaction(async tx => {
      const state = await readClub(tx, data?.organizationId, auth);
      email(data?.email); text(data?.firstName, "first name"); text(data?.lastName, "last name");
      if (!["manager", "coach"].includes(data?.role)) fail("invalid-argument", "Choose manager or coach.");
      const assigned = teamIds(data?.teamIds || []);
      if (data.role === "manager" && assigned.length) fail("invalid-argument", "Managers have access to every team; leave team assignments empty.");
      requireTeams(state, assigned);
      const pending = await tx.get(db.collection("clubStaffInvitations").where("organizationId", "==", state.orgRef.id).limit(201));
      if (state.members.length >= MAX_STAFF || pending.size >= 200) fail("resource-exhausted", "This club has reached its staff invitation limit.");
      if (state.members.some(m => String(m.email).toLowerCase() === email(data.email)) || pending.docs.some(doc => doc.id !== replacementId && doc.data().email === email(data.email) && invitationStatus(doc.data()) === "pending")) fail("already-exists", "This email already has staff access or a pending invitation.");
      if (replacementId) {
        const old = pending.docs.find(doc => doc.id === replacementId)?.data();
        if (!old || !["pending", "expired"].includes(invitationStatus(old))) fail("failed-precondition", "Only pending or expired invitations can be replaced.");
      }
      return { organizationName: state.org.name, teamNames: state.teams.filter(team => assigned.includes(team.id)).map(team => team.name) };
    });
  }
  // The third argument is an in-process capability, never callable request data.
  async function createClubStaffInvitation(data, auth, manual = null) {
    if (data?.activationMode !== undefined && !["manual", "verified_email"].includes(data.activationMode)) fail("invalid-argument", "Choose a supported activation method.");
    if ((data?.activationMode === "manual") !== Boolean(manual)) fail("failed-precondition", "Use the account activation service for private links.");
    const invitedEmail = email(data?.email);
    const firstName = text(data?.firstName, "first name");
    const lastName = text(data?.lastName, "last name");
    const role = data?.role;
    if (!["manager", "coach"].includes(role)) fail("invalid-argument", "Choose manager or coach.");
    const assigned = teamIds(data?.teamIds || []);
    if (role === "manager" && assigned.length) fail("invalid-argument", "Managers have access to every team; leave team assignments empty.");
    const code = `CLUB-${randomBytes(16).toString("hex").toUpperCase()}`;
    const inviteRef = db.collection("clubStaffInvitations").doc(crypto.createHash("sha256").update(code).digest("hex"));
    const expiresAtMillis = now() + INVITE_TTL_MS;
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data?.organizationId, auth);
      requireTeams(state, assigned);
      if (state.members.length >= MAX_STAFF) fail("resource-exhausted", "The club staff limit has been reached.");
      const pending = await tx.get(db.collection("clubStaffInvitations").where("organizationId", "==", state.orgRef.id).limit(201));
      if (pending.size >= 200) fail("resource-exhausted", "The club invitation limit has been reached. Contact PoseTek.");
      if (state.members.some((m) => String(m.email).toLowerCase() === invitedEmail) || pending.docs.some((doc) => doc.id !== manual?.replacementId && doc.data().email === invitedEmail && invitationStatus(doc.data()) === "pending")) fail("already-exists", "This email already has staff access or a pending invitation.");
      let replacement = null;
      if (manual?.replacementId) {
        replacement = pending.docs.find(doc => doc.id === manual.replacementId);
        if (!replacement || !["pending", "expired"].includes(invitationStatus(replacement.data()))) fail("failed-precondition", "Only pending or expired invitations can be replaced.");
      }
      if (manual) await manual.beforeWrite(tx);
      const profileRef = state.orgRef.collection("staffProfiles").doc();
      const invitation = { organizationId: state.orgRef.id, email: invitedEmail, firstName, lastName, role, teamIds: assigned, status: "pending", staffProfileId: profileRef.id, createdByUID: auth.uid, createdAt: stamp(), expiresAtMillis };
      if (manual) Object.assign(invitation, { activationMode: "manual", targetUID: manual.targetUID, grantId: manual.grantId });
      if (replacement) {
        tx.update(replacement.ref, { status: "revoked", revokedAt: stamp(), revokedByUID: auth.uid, replacedByInvitationId: inviteRef.id });
        tx.update(state.orgRef.collection("staffProfiles").doc(replacement.data().staffProfileId), { status: "revoked", updatedAt: stamp() });
      }
      tx.create(inviteRef, invitation);
      tx.create(profileRef, { email: invitedEmail, firstName, lastName, role, teamIds: assigned, status: "pending", invitationId: inviteRef.id, createdAt: stamp() });
      if (manual) manual.write(tx, { invitationId: inviteRef.id, staffProfileId: profileRef.id });
    });
    return { invitationId: inviteRef.id, code, expiresAtMillis };
  }
  async function redeemClubStaffInvitation(data, auth) {
    authRequired(auth);
    if (auth.emailVerified !== true) fail("failed-precondition", "Verify your email, then refresh your login and claim the invitation.");
    const invitedEmail = email(auth.email);
    const code = typeof data?.code === "string" ? data.code.trim().toUpperCase() : "";
    if (!/^CLUB-[A-F0-9]{32}$/.test(code)) fail("not-found", "That invitation is invalid or has expired.");
    const ref = db.collection("clubStaffInvitations").doc(crypto.createHash("sha256").update(code).digest("hex"));
    return claimStaffInvitation(ref, auth, invitedEmail);
  }
  async function claimManualStaffInvitation(invitationId, auth, grantId, issuer) {
    authRequired(auth);
    return claimStaffInvitation(db.collection("clubStaffInvitations").doc(id(invitationId)), auth, email(auth.email), grantId, issuer);
  }
  async function claimStaffInvitation(ref, auth, invitedEmail, grantId = null, issuer = null) {
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const invite = doc.exists ? doc.data() : null;
      if (!invite || (invitationStatus(invite) !== "pending" && !(grantId && invite.status === "claimed" && invite.claimedByUID === auth.uid))) fail("not-found", "That invitation is invalid or has expired.");
      if (invite.activationMode === "manual") {
        if (!grantId || invite.grantId !== grantId || invite.targetUID !== auth.uid || /^[^@]+@posetek\.net$/i.test(invitedEmail)) fail("permission-denied", "Use your private staff activation link.");
        const grant = await tx.get(db.collection("accountAccessGrants").doc(grantId));
        if (grant.data()?.status !== "consuming" || grant.data()?.targetUID !== auth.uid || grant.data()?.purpose !== "staff_activation" || issuer?.uid !== grant.data()?.createdByUID) fail("failed-precondition", "This activation cannot be completed. Contact PoseTek.");
      } else if (grantId) fail("permission-denied", "This invitation requires verified email.");
      if (invite.email !== invitedEmail) fail("permission-denied", "Sign in with the email address this invitation was sent to.");
      const state = await readClub(tx, invite.organizationId, auth, false);
      if (grantId) requireManager({ ...state, actor: state.members.find(member => member.userUID === issuer.uid) }, issuer);
      requireTeams(state, invite.teamIds);
      if (grantId && invite.status === "claimed") {
        const member = state.members.find(entry => entry.userUID === auth.uid);
        if (!activeMember(member, auth.uid) || member.role !== invite.role || member.staffProfileId !== invite.staffProfileId || JSON.stringify(member.teamIds) !== JSON.stringify(invite.teamIds)) fail("failed-precondition", "This account's access changed. Ask PoseTek to review it.");
        return { organizationId: invite.organizationId, role: invite.role, teamIds: invite.teamIds };
      }
      if (state.members.some((m) => m.userUID === auth.uid) || state.members.length >= MAX_STAFF) fail("already-exists", "This account already has a staff membership or the club is full.");
      const coachRef = db.collection("coaches").doc(auth.uid);
      const profileRef = state.orgRef.collection("staffProfiles").doc(id(invite.staffProfileId));
      const [coach, boundCoaches, boundPlayers, aliasPlayers, directPlayer, profile, otherOrgs] = await Promise.all([
        tx.get(coachRef), tx.get(db.collection("coaches").where("userUID", "==", auth.uid).limit(2)),
        tx.get(db.collection("players").where("authenticationUID", "==", auth.uid).limit(1)), tx.get(db.collection("players").where("userUID", "==", auth.uid).limit(1)),
        tx.get(db.collection("players").doc(auth.uid)), tx.get(profileRef), tx.get(db.collection("organizations").where("memberUIDs", "array-contains", auth.uid).limit(1)),
      ]);
      const existing = coach.exists ? coach.data() : null;
      if (boundPlayers.size || aliasPlayers.size || directPlayer.exists || otherOrgs.size || boundCoaches.docs.some((c) => c.id !== auth.uid)
        || (existing && (existing.userUID !== auth.uid || Object.hasOwn(existing, "organizationId") || existing.organization || existing.organizationCode || (existing.members || []).length))) fail("failed-precondition", "This login is already linked to another athlete, roster, or club. Ask PoseTek to reconcile it.");
      if (!profile.exists || profile.data().status !== "pending" || profile.data().invitationId !== ref.id || profile.data().userUID) fail("failed-precondition", "This staff profile has already been linked.");
      const member = { userUID: auth.uid, email: invitedEmail, firstName: invite.firstName, lastName: invite.lastName, role: invite.role, teamIds: invite.teamIds, status: "active", staffProfileId: profileRef.id, joinedAt: stamp(), updatedAt: stamp() };
      state.members.push(member);
      tx.create(state.orgRef.collection("members").doc(auth.uid), member);
      tx.update(profileRef, { userUID: auth.uid, status: "active", claimedAt: stamp() });
      tx.update(ref, { status: "claimed", claimedByUID: auth.uid, claimedAt: stamp() });
      syncProjections(tx, state);
      return { organizationId: invite.organizationId, role: invite.role, teamIds: invite.teamIds };
    });
  }
  async function setClubStaffTeams(data, auth) {
    const userUID = id(data?.userUID, "staff account");
    const assigned = teamIds(data?.teamIds || []);
    if (data?.status !== undefined && !["active", "inactive"].includes(data.status)) fail("invalid-argument", "Choose active or inactive status.");
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data?.organizationId, auth);
      requireTeams(state, assigned);
      const member = state.members.find((m) => m.userUID === userUID);
      if (!member) fail("not-found", "That staff member could not be found.");
      if (member.role === "manager" && assigned.length) fail("invalid-argument", "Managers have access to every team.");
      const status = data?.status || member.status;
      if (status === "inactive" && userUID === auth.uid) fail("failed-precondition", "Ask another manager to deactivate your account.");
      if (status === "inactive" && member.role === "manager" && state.members.filter((m) => m.role === "manager" && m.status === "active" && m.userUID !== userUID).length === 0) fail("failed-precondition", "Keep at least one active club manager.");
      member.teamIds = assigned;
      member.status = status;
      tx.update(state.orgRef.collection("members").doc(userUID), { teamIds: assigned, status, updatedAt: stamp() });
      if (member.staffProfileId) tx.update(state.orgRef.collection("staffProfiles").doc(member.staffProfileId), { teamIds: assigned, status, updatedAt: stamp() });
      syncProjections(tx, state);
    });
    return { ok: true };
  }
  async function revokeClubStaffInvitation(data, auth) {
    const inviteRef = db.collection("clubStaffInvitations").doc(id(data?.invitationId, "invitation"));
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data?.organizationId, auth);
      const doc = await tx.get(inviteRef);
      if (!doc.exists || doc.data().organizationId !== state.orgRef.id) fail("not-found", "That invitation could not be found.");
      if (doc.data().status !== "pending") fail("failed-precondition", "Only pending invitations can be revoked.");
      let grantRef = null;
      if (doc.data().activationMode === "manual") {
        grantRef = db.collection("accountAccessGrants").doc(id(doc.data().grantId));
        const grant = await tx.get(grantRef);
        if (grant.data()?.status !== "pending") fail("failed-precondition", "This activation has started and cannot be revoked as an invitation.");
      }
      tx.update(inviteRef, { status: "revoked", revokedAt: stamp(), revokedByUID: auth.uid });
      if (grantRef) tx.update(grantRef, { status: "revoked", revokedAtMillis: now(), revokedByUID: auth.uid });
      tx.update(state.orgRef.collection("staffProfiles").doc(doc.data().staffProfileId), { status: "revoked", updatedAt: stamp() });
    });
    return { ok: true };
  }
  async function setClubPlayerTeam(data, auth) {
    const playerId = id(data?.playerId, "player");
    const teamId = id(data?.teamId, "team");
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data?.organizationId, auth);
      requireTeams(state, [teamId]);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) fail("permission-denied", "Only players already in this club can be moved between its teams.");
      player.teamId = teamId;
      tx.update(db.collection("players").doc(playerId), { teamId, updatedAt: stamp() });
      syncProjections(tx, state);
    });
    return { ok: true };
  }
  async function createClubPlayer(data, auth) {
    const firstName = text(data?.firstName, "first name");
    const lastName = text(data?.lastName, "last name");
    const teamId = id(data?.teamId, "team");
    // Phone and position are required; height/weight are validated when sent.
    const extra = staffPlayerProfile(data, fail);
    if (data?.preferredFoot) extra.preferredFoot = text(data.preferredFoot, "preferredFoot");
    if (data?.signupEmail) extra.signupEmail = email(data.signupEmail);
    const ref = db.collection("players").doc();
    const code = randomBytes(12).toString("hex").toUpperCase();
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data?.organizationId, auth, false);
      requireTeams(state, [teamId]);
      if (!isClubAdmin(auth) && !memberCanAccessPlayer(state.actor, auth.uid, { teamId })) fail("permission-denied", "You can add players only to teams assigned to you.");
      if (state.players.length >= MAX_PLAYERS) fail("resource-exhausted", "The club player limit has been reached.");
      const player = { ...extra, firstName, lastName, organizationId: state.orgRef.id, teamId, registered: false, signupCode: code, signupCodeVersion: 2, sport: "Soccer", createdByUID: auth.uid, createdAt: stamp(), updatedAt: stamp() };
      state.players.push({ ...player, id: ref.id });
      if (invitations) {
        delete player.signupCode;
        Object.assign(player, invitations.stage(tx, ref.id, player, code));
      }
      tx.create(ref, player);
      syncProjections(tx, state);
    });
    return { playerId: ref.id, code };
  }
  async function issueClubPlayerInvitation(data, auth) {
    authRequired(auth);
    const playerId = id(data.playerId, "player");
    // Normal player onboarding preserves issued invitations. Deliberate rotation
    // remains separate from this endpoint so retries cannot invalidate a code.
    if (invitations) return invitations.ensure(playerId, auth);
    let code = `PLR-${randomBytes(16).toString("hex").toUpperCase()}`;
    await db.runTransaction(async (tx) => {
      const state = await readClub(tx, data.organizationId, auth, false);
      const player = state.players.find((entry) => entry.id === playerId);
      if (!player || (!isClubAdmin(auth) && !memberCanAccessPlayer(state.actor, auth.uid, player))) fail("permission-denied", "This player is not assigned to your club access.");
      if (!canIssuePlayerCode(player)) fail("failed-precondition", "This player already has an account binding. Their sign-in does not need a new code.");
      const existing = [player.signupCode, player.code].find(value => typeof value === "string" && /^[A-Za-z0-9-]{6,64}$/.test(value));
      if (player.signupCodeVersion === 2 && existing) { code = existing; return; }
      if (player.signupCodeVersion === 3) fail("failed-precondition", "Use the protected invitation service for this player.");
      tx.update(db.collection("players").doc(playerId), {
        signupCode: code, code: FieldValue.delete(), signupCodeVersion: 2,
        signupInvitedAt: stamp(), signupInvitedByUID: auth.uid, updatedAt: stamp(),
      });
    });
    return { playerId, code };
  }
  return { getClubContext, createClubOrganization, saveClubTeam, validateStaffInvitation, createClubStaffInvitation, redeemClubStaffInvitation, claimManualStaffInvitation, setClubStaffTeams, revokeClubStaffInvitation, setClubPlayerTeam, createClubPlayer, issueClubPlayerInvitation };
}
module.exports = { createClubs, INVITE_TTL_MS };
