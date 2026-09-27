"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createClubs } = require("./clubs");
const { createAccountAccess, TTL } = require("./account-access");

const START = Date.parse("2026-09-26T15:00:00.000Z");
const PASSWORD = "recipient-only-secret";
const admin = { uid: "admin", email: "operator@posetek.net", emailVerified: true, authTime: START / 1000 };
const manager = { uid: "manager", email: "manager@example.test", emailVerified: false, authTime: START / 1000 };
const invite = { organizationId: "club", firstName: "New", lastName: "Coach", email: "new@example.test", role: "coach", teamIds: ["team"], activationMode: "manual" };
const internal = { firstName: "New", lastName: "Staff", email: "new@posetek.net", identityConfirmed: true };

class AuthDirectory {
  constructor(clock) {
    this.clock = clock; this.users = new Map(); this.writes = []; this.revocations = []; this.beforeUpdate = null; this.beforeRevoke = null;
    for (const source of [admin, manager]) this.add(source);
  }
  add(source) {
    const user = { disabled: false, emailVerified: false, metadata: { creationTime: new Date(START - 86400000).toUTCString() }, ...source };
    this.users.set(user.uid, user); return user;
  }
  async getUser(uid) { const user = this.users.get(uid); if (!user) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); return { ...user, metadata: { ...user.metadata } }; }
  async getUserByEmail(email) { const user = [...this.users.values()].find(row => row.email.toLowerCase() === email.toLowerCase()); if (!user) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); return this.getUser(user.uid); }
  async createUser(data) {
    if (this.users.has(data.uid) || [...this.users.values()].some(user => user.email.toLowerCase() === data.email.toLowerCase())) throw Object.assign(new Error("duplicate"), { code: "auth/email-already-exists" });
    return this.add({ ...data, metadata: { creationTime: new Date(this.clock()).toUTCString() } });
  }
  async updateUser(uid, updates) {
    this.writes.push({ uid, ...updates });
    if (this.beforeUpdate) await this.beforeUpdate(uid, updates);
    Object.assign(this.users.get(uid), updates);
    return this.getUser(uid);
  }
  async revokeRefreshTokens(uid) {
    this.revocations.push(uid);
    if (this.beforeRevoke) await this.beforeRevoke(uid);
    this.users.get(uid).tokensValidAfterTime = new Date(this.clock()).toUTCString();
  }
}
function setup(seed = {}) {
  let time = START;
  const now = () => time;
  const db = new FakeFirestore({
    "organizations/club": { schemaVersion: 2, name: "Club", memberUIDs: ["manager"], managerUIDs: ["manager"] },
    "organizations/club/members/manager": { userUID: "manager", email: manager.email, role: "manager", status: "active", teamIds: [] },
    "coaches/manager": { userUID: "manager", organizationId: "club" },
    "teams/team": { organizationId: "club", name: "Team", playerIds: ["player"], coachUIDs: [] },
    "players/player": { organizationId: "club", teamId: "team", firstName: "Player", authenticationUID: "athlete" },
    ...seed,
  });
  const directory = new AuthDirectory(now);
  const clubs = createClubs({ db, FieldValue, HttpsError, now });
  const api = createAccountAccess({ db, authDirectory: directory, clubs, FieldValue, HttpsError, now });
  return { api, clubs, directory, db, now, advance: ms => { time += ms; }, fresh: user => ({ ...user, authTime: time / 1000 }), grant: link => db.snapshot(`accountAccessGrants/${link.grantId}`) };
}
const account = uid => ({ uid, email: "new@example.test", emailVerified: false, authTime: START / 1000 });

test("manual staff setup binds a disabled UID, keeps secrets out of storage and preserves unverified email", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager);
  assert.match(link.code, /^ACCESS-[A-F0-9]{64}$/);
  assert.equal(link.activationUrl, `https://posetek.net/join#accessCode=${link.code}`);
  assert.equal(link.expiresAtMillis, START + TTL.staff_activation);
  const before = h.grant(link), uid = before.targetUID;
  assert.equal((await h.directory.getUser(uid)).disabled, true);
  assert.equal(before.accountMode, "new");
  const check = await h.api.getAccountAccessLink({ code: link.code.toLowerCase() });
  assert.equal(check.targetUID, uid); assert.equal(check.requiresSignIn, false);
  const result = await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  assert.equal(result.organizationId, "club"); assert.equal(result.targetUID, uid);
  assert.equal(h.grant(link).status, "completed");
  assert.equal((await h.directory.getUser(uid)).emailVerified, false);
  assert.equal((await h.directory.getUser(uid)).disabled, false);
  assert.deepEqual(h.db.snapshot(`organizations/club/members/${uid}`).teamIds, ["team"]);
  assert.deepEqual(h.db.snapshot(`coaches/${uid}`).members, ["player"]);
  const stored = JSON.stringify([...h.db.docs.values()]);
  assert.ok(!stored.includes(link.code)); assert.ok(!stored.includes(PASSWORD));
  assert.equal(h.directory.writes.filter(write => "password" in write).length, 1);
  assert.ok(h.directory.writes.every(write => !("emailVerified" in write)));
});

test("existing staff activation requires the bound login, never creates or resets an account", async () => {
  const h = setup(); h.directory.add(account("existing"));
  const link = await h.api.issueStaffActivation(invite, manager);
  assert.equal(link.accountMode, "existing");
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code }), { code: "unauthenticated" });
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }, account("existing")), { code: "invalid-argument" });
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code }, manager), { code: "permission-denied" });
  await h.api.completeAccountAccessLink({ code: link.code }, account("existing"));
  assert.deepEqual(h.directory.writes, []);
  assert.equal(h.db.snapshot("organizations/club/members/existing").status, "active");
});

test("staff managers cannot grant global administration or recover passwords", async () => {
  const h = setup();
  await assert.rejects(h.api.issueStaffActivation({ ...invite, email: "Staff@PoseTek.net" }, manager), { code: "invalid-argument" });
  await assert.rejects(h.api.issueInternalAdminAccess(internal, manager), { code: "permission-denied" });
  await assert.rejects(h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, manager), { code: "permission-denied" });
  assert.equal(h.directory.users.size, 2);
});

test("internal admin setup requires fresh current authority and explicit exact-domain attestation", async () => {
  const h = setup();
  await assert.rejects(h.api.issueInternalAdminAccess({ ...internal, identityConfirmed: false }, admin), { code: "invalid-argument" });
  await assert.rejects(h.api.issueInternalAdminAccess({ ...internal, email: "new@posetek.net.evil.com" }, admin), { code: "invalid-argument" });
  await assert.rejects(h.api.issueInternalAdminAccess(internal, { ...admin, authTime: START / 1000 - 301 }), { code: "failed-precondition" });
  h.directory.users.get(admin.uid).emailVerified = false;
  await assert.rejects(h.api.issueInternalAdminAccess(internal, admin), { code: "permission-denied" });
  assert.equal(h.directory.users.size, 2);
});

test("internal admin's separately attested activation is the only branch that verifies company email", async () => {
  const h = setup(), link = await h.api.issueInternalAdminAccess(internal, admin), uid = h.grant(link).targetUID;
  assert.equal(link.expiresAtMillis, START + TTL.internal_admin_activation);
  assert.equal(h.grant(link).verificationMethod, "posetek_admin_attestation");
  assert.equal((await h.directory.getUser(uid)).emailVerified, false);
  await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  const user = await h.directory.getUser(uid);
  assert.equal(user.emailVerified, true); assert.equal(user.disabled, false);
  assert.equal(h.db.snapshot(`admins/${uid}`), undefined); // The existing sign-in profile upsert remains the owner.
  assert.equal(h.directory.writes.filter(write => write.emailVerified === true).length, 1);
  assert.ok(![...h.db.docs.keys()].some(path => path === `coaches/${uid}`));
});

test("existing internal admin candidate signs in and gains attested verification without password write", async () => {
  const h = setup(), user = h.directory.add({ uid: "candidate", email: internal.email, emailVerified: false });
  const link = await h.api.issueInternalAdminAccess(internal, admin);
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }, h.fresh(user)), { code: "invalid-argument" });
  await h.api.completeAccountAccessLink({ code: link.code }, h.fresh(user));
  assert.deepEqual(h.directory.writes, [{ uid: user.uid, emailVerified: true }]);
});

test("recovery resets only the bound password and sessions, preserving verification and authority", async () => {
  const h = setup(), user = h.directory.add({ uid: "existing", email: invite.email, emailVerified: false, customClaims: { unrelated: true }, providerData: [{ providerId: "password" }] });
  const link = await h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, admin);
  assert.equal(link.expiresAtMillis, START + TTL.account_recovery);
  await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  assert.deepEqual(h.directory.writes, [{ uid: user.uid, password: PASSWORD }]);
  assert.deepEqual(h.directory.revocations, [user.uid]);
  const after = await h.directory.getUser(user.uid);
  assert.equal(after.emailVerified, false); assert.equal(after.disabled, false);
  assert.deepEqual(after.customClaims, { unrelated: true });
  assert.deepEqual(after.providerData, user.providerData);
  assert.equal(h.db.snapshot("organizations/club/members/existing"), undefined);
});

test("recovery does not create missing accounts, enable disabled users or trust claimed privilege", async () => {
  const h = setup();
  await assert.rejects(h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, admin), { code: "failed-precondition" });
  h.directory.add({ uid: "disabled", email: invite.email, disabled: true });
  await assert.rejects(h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, admin), { code: "failed-precondition" });
  await assert.rejects(h.api.issueInternalAdminAccess(internal, { ...manager, emailVerified: true, role: "admin" }), { code: "permission-denied" });
  assert.deepEqual(h.directory.writes, []);
});

test("completed replay returns metadata and cannot rewrite a chosen password", async () => {
  const h = setup(), link = await h.api.issueInternalAdminAccess(internal, admin);
  const first = await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  const count = h.directory.writes.length;
  assert.deepEqual(await h.api.completeAccountAccessLink({ code: link.code, password: "attacker-changed-password" }), first);
  assert.equal(h.directory.writes.length, count);
});

test("competing submissions consume once before any password write", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager);
  const results = await Promise.allSettled([h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), h.api.completeAccountAccessLink({ code: link.code, password: "different-password" })]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(h.directory.writes.filter(write => "password" in write).length, 1);
  assert.equal(h.grant(link).status, "completed");
});

test("revoked, expired and malformed links cannot change Auth", async () => {
  const h = setup(), link = await h.api.issueInternalAdminAccess(internal, admin);
  await h.api.revokeAccountAccessLink({ grantId: link.grantId }, admin);
  for (const code of [link.code, "ACCESS-invalid", "../anything"]) await assert.rejects(h.api.completeAccountAccessLink({ code, password: PASSWORD }), { code: "not-found" });
  const fresh = await h.api.issueInternalAdminAccess(internal, admin);
  assert.equal(h.grant(fresh).targetUID, h.grant(link).targetUID);
  h.advance(TTL.internal_admin_activation);
  await assert.rejects(h.api.getAccountAccessLink({ code: fresh.code }), { code: "not-found" });
  assert.deepEqual(h.directory.writes, []);
});

test("manual staff replacement atomically invalidates old link and retains staged UID", async () => {
  const h = setup(), first = await h.api.issueStaffActivation(invite, manager);
  const next = await h.api.replaceClubStaffInvitation({ organizationId: "club", invitationId: first.invitationId }, manager);
  assert.notEqual(first.code, next.code);
  assert.equal(h.grant(first).status, "revoked");
  assert.equal(h.grant(first).targetUID, h.grant(next).targetUID);
  assert.equal(h.db.snapshot(`clubStaffInvitations/${first.invitationId}`).status, "revoked");
  await assert.rejects(h.api.completeAccountAccessLink({ code: first.code, password: PASSWORD }), { code: "not-found" });
  await h.api.completeAccountAccessLink({ code: next.code, password: PASSWORD });
});

test("legacy pending invitation upgrades atomically to manual setup without changing legacy redemption defaults", async () => {
  const h = setup(), old = await h.clubs.createClubStaffInvitation({ ...invite, activationMode: undefined }, manager);
  const next = await h.api.replaceClubStaffInvitation({ organizationId: "club", invitationId: old.invitationId }, manager);
  assert.equal(h.db.snapshot(`clubStaffInvitations/${old.invitationId}`).status, "revoked");
  await assert.rejects(h.clubs.redeemClubStaffInvitation({ code: old.code }, account("old")), { code: "failed-precondition" });
  await h.api.completeAccountAccessLink({ code: next.code, password: PASSWORD });
});

test("failed or unauthorized replacement preserves the pending invitation", async () => {
  const h = setup(), first = await h.api.issueStaffActivation(invite, manager);
  h.directory.add({ uid: "stranger", email: "stranger@example.test" });
  await assert.rejects(h.api.replaceClubStaffInvitation({ organizationId: "club", invitationId: first.invitationId }, { uid: "stranger", email: "stranger@example.test" }), { code: "permission-denied" });
  assert.equal(h.grant(first).status, "pending");
  assert.equal(h.db.snapshot(`clubStaffInvitations/${first.invitationId}`).status, "pending");
});

test("target email or account incarnation changes fail closed before consumption", async () => {
  for (const mutation of [user => { user.email = "changed@example.test"; }, user => { user.metadata.creationTime = new Date(START + 1000).toUTCString(); }]) {
    const h = setup(), link = await h.api.issueStaffActivation(invite, manager), uid = h.grant(link).targetUID;
    mutation(h.directory.users.get(uid));
    await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
    assert.equal(h.grant(link).status, "pending"); assert.deepEqual(h.directory.writes, []);
  }
});

test("current issuer revocation stops consumption and canonical transaction rechecks manager scope", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager);
  // Deactivate after the outer check, during password update; the membership
  // transaction must still reject the former manager rather than granting access.
  h.directory.beforeUpdate = async (_, write) => { if (write.password) await h.db.doc("organizations/club/members/manager").update({ status: "inactive" }); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  assert.equal(h.grant(link).status, "blocked");
  assert.equal(h.db.snapshot(`organizations/club/members/${h.grant(link).targetUID}`), undefined);
  assert.equal((await h.directory.getUser(h.grant(link).targetUID)).disabled, true);
});

test("existing athlete, populated coach and other club identities are never silently adopted", async () => {
  for (const seed of [
    { "players/p": { authenticationUID: "existing" } },
    { "coaches/existing": { userUID: "existing", members: ["p"] } },
    { "organizations/other": { schemaVersion: 2, memberUIDs: ["existing"] } },
  ]) {
    const h = setup(seed); h.directory.add(account("existing"));
    await assert.rejects(h.api.issueStaffActivation(invite, manager), { code: "failed-precondition" });
    assert.deepEqual(h.directory.writes, []);
    assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("accountAccessGrants/")).length, 0);
  }
});

test("uncertain password write is never replayed, even when Auth accepted it", async () => {
  const h = setup(), link = await h.api.issueInternalAdminAccess(internal, admin), uid = h.grant(link).targetUID;
  h.directory.beforeUpdate = async (_, updates) => { if (updates.password) { Object.assign(h.directory.users.get(uid), updates); throw new Error("response lost"); } };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: "never-replay-password" }), { code: "failed-precondition" });
  assert.equal(h.directory.writes.length, 1);
  assert.equal(h.grant(link).stage, "reserved"); assert.equal(h.grant(link).status, "blocked");
  assert.equal((await h.directory.getUser(uid)).disabled, true);
});

test("durable password resumes a lost membership acknowledgement without replaying password or widening teams", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager);
  const write = h.db.write.bind(h.db);
  let failStage = true;
  h.db.write = (path, value, options) => { if (failStage && value.stage === "membership_applied") { failStage = false; throw new Error("stage unavailable"); } return write(path, value, options); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  assert.equal(h.grant(link).stage, "password_applied");
  await h.api.completeAccountAccessLink({ code: link.code });
  assert.equal(h.directory.writes.filter(write => "password" in write).length, 1);
  assert.equal(h.grant(link).status, "completed");
  assert.deepEqual(h.db.snapshot(`organizations/club/members/${h.grant(link).targetUID}`).teamIds, ["team"]);
});

test("uncertain enabling cannot be replayed to undo a later administrative disable", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager), uid = h.grant(link).targetUID;
  h.directory.beforeUpdate = async (_, updates) => { if (updates.disabled === false) { Object.assign(h.directory.users.get(uid), updates); throw new Error("enable acknowledgement lost"); } };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  assert.equal(h.grant(link).stage, "enable_attempted");
  h.directory.users.get(uid).disabled = true;
  h.directory.beforeUpdate = null;
  const count = h.directory.writes.length;
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code }), { code: "failed-precondition" });
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code }, h.fresh(account(uid))), { code: "failed-precondition" });
  assert.equal(h.directory.writes.length, count);
  assert.equal((await h.directory.getUser(uid)).disabled, true);
});

test("same UID sign-in acknowledges lost successful enable without replaying any Auth writes", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager), uid = h.grant(link).targetUID;
  h.directory.beforeUpdate = async (_, updates) => { if (updates.disabled === false) { Object.assign(h.directory.users.get(uid), updates); throw new Error("enable acknowledgement lost"); } };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }));
  const count = h.directory.writes.length;
  const result = await h.api.completeAccountAccessLink({ code: link.code }, h.fresh(account(uid)));
  assert.equal(result.status, "completed");
  assert.equal(h.directory.writes.length, count);
  assert.equal(h.grant(link).status, "completed");
});

test("durable recovery password resumes session revocation without a second password write", async () => {
  const h = setup(); h.directory.add(account("existing"));
  const link = await h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, admin);
  h.directory.beforeRevoke = async () => { throw new Error("revocation unavailable"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  assert.equal(h.grant(link).stage, "password_applied");
  h.directory.beforeRevoke = null;
  await h.api.completeAccountAccessLink({ code: link.code });
  assert.equal(h.directory.writes.filter(write => "password" in write).length, 1);
  assert.equal(h.grant(link).status, "completed");
});

test("issuer status is truthful for a blocked staff operation", async () => {
  const h = setup(), link = await h.api.issueStaffActivation(invite, manager);
  h.directory.beforeUpdate = async () => { throw new Error("unavailable"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }));
  const context = await h.clubs.getClubContext({}, manager);
  assert.equal(context.invitations[0].activationMode, "manual");
  assert.equal(context.invitations[0].activationStatus, "blocked");
  const listing = await h.api.listAccountAccessLinks({}, admin);
  assert.equal(listing.links[0].status, "blocked");
  assert.ok(!JSON.stringify(listing).includes(link.code));
});

test("public limits reject missing addresses, normalize mapped IPv4 and enforce attempt bounds", async () => {
  const h = setup();
  await assert.rejects(h.api.rate({}, null, "complete", 2), { code: "failed-precondition" });
  await h.api.rate({ ip: "::ffff:127.0.0.1" }, null, "complete", 2);
  await h.api.rate({ ip: "127.0.0.1" }, null, "complete", 2);
  await assert.rejects(h.api.rate({ ip: "127.0.0.1" }, null, "complete", 2), { code: "resource-exhausted" });
  h.advance(15 * 60 * 1000);
  await h.api.rate({ ip: "127.0.0.1" }, null, "complete", 2);
  assert.ok(!JSON.stringify([...h.db.docs.values()]).includes("127.0.0.1"));
});

test("revocation racing an in-flight Auth write cannot report a false cancellation", async () => {
  const h = setup(), link = await h.api.issueInternalAdminAccess(internal, admin);
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  h.directory.beforeUpdate = async (_, write) => { if (write.password) { began(); await new Promise(resolve => { release = resolve; }); } };
  const completing = h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  await started;
  await assert.rejects(h.api.revokeAccountAccessLink({ grantId: link.grantId }, admin), { code: "failed-precondition" });
  release(); await completing;
  assert.equal(h.grant(link).status, "completed");
});

test("a new recovery link after terminal failure requires fresh attestation and a settled enabled account", async () => {
  const h = setup(); h.directory.add(account("existing"));
  const old = await h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, admin);
  h.directory.beforeUpdate = async () => { throw new Error("unknown password result"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: old.code, password: PASSWORD }));
  await assert.rejects(h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, admin), { code: "already-exists" });
  h.advance(121000); h.directory.beforeUpdate = null;
  const next = await h.api.issueAccountRecovery({ email: invite.email, identityConfirmed: true }, h.fresh(admin));
  await assert.rejects(h.api.completeAccountAccessLink({ code: old.code, password: PASSWORD }), { code: "not-found" });
  await h.api.completeAccountAccessLink({ code: next.code, password: "new-recipient-password" });
  assert.equal(h.grant(next).targetUID, "existing");
});
