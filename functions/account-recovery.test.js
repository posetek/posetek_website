"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createAccountAccess } = require("./account-access");
const { REQUEST_RETENTION_MS } = require("./account-recovery");

const START = Date.parse("2026-10-08T12:00:00.000Z");
const admin = { uid: "operator", email: "operator@posetek.net", emailVerified: true, authTime: START / 1000 };
const manager = { uid: "manager", email: "manager@example.test", emailVerified: false, authTime: START / 1000 };
const athlete = { uid: "athlete", email: "athlete@example.test", emailVerified: false, authTime: START / 1000, signInProvider: "password" };
const PASSWORD = "chosen-by-recipient";
const ID = "a0000000-0000-4000-8000-000000000001";
const scope = { organizationId: "club", playerId: "player" };
const issue = { ...scope, identityConfirmed: true };
function setup(seed = {}) {
  let time = START;
  const db = new FakeFirestore({
    "organizations/club": { schemaVersion: 2, name: "Club", memberUIDs: [manager.uid] },
    "organizations/club/members/manager": { userUID: manager.uid, role: "manager", status: "active", teamIds: [] },
    "organizations/other": { schemaVersion: 2, name: "Other" },
    "players/player": { authenticationUID: athlete.uid, userUID: athlete.uid, registered: true, organizationId: "club", firstName: "Test", lastName: "Player", email: "stale-roster@example.test" },
    "players/player/workoutLogs/keep": { endingReason: "completed", repetitions: 12 },
    ...seed,
  });
  // This adapter exercises collection-group filtering without changing the shared
  // FakeFirestore used by other agents and tests.
  db.collectionGroup = name => {
    const make = (filters = [], limit = Infinity) => ({
      where: (field, op, value) => make([...filters, [field, op, value]], limit), limit: max => make(filters, max),
      async get() {
        const matching = [...db.docs.entries()].filter(([path, data]) => path.split("/").at(-2) === name && filters.every(([field, op, value]) => op === "==" && data[field] === value)).slice(0, limit);
        const docs = await Promise.all(matching.map(([path]) => db.doc(path).get()));
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    return make();
  };
  const users = new Map([admin, manager, athlete].map(source => [source.uid, { ...source, disabled: false, providerData: [{ providerId: "password" }], customClaims: { preserved: true }, metadata: { creationTime: new Date(START - 86400000).toUTCString() } }]));
  const directory = {
    writes: [], revocations: [], beforeUpdate: null, beforeRevoke: null,
    async getUser(uid) { if (!users.has(uid)) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); return { ...users.get(uid), metadata: { ...users.get(uid).metadata } }; },
    async getUserByEmail(email) { const user = [...users.values()].find(user => user.email.toLowerCase() === email.toLowerCase()); if (!user) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); return this.getUser(user.uid); },
    async updateUser(uid, value) { this.writes.push({ uid, ...value }); if (this.beforeUpdate) await this.beforeUpdate(uid, value); Object.assign(users.get(uid), value); return this.getUser(uid); },
    async revokeRefreshTokens(uid) { this.revocations.push(uid); if (this.beforeRevoke) await this.beforeRevoke(uid); users.get(uid).tokensValidAfterTime = new Date(time).toUTCString(); },
  };
  const api = createAccountAccess({ db, authDirectory: directory, clubs: {}, FieldValue, HttpsError, now: () => time });
  return { db, users, directory, api, advance: ms => { time += ms; }, now: () => time, fresh: actor => ({ ...actor, authTime: time / 1000 }), grant: link => db.snapshot(`accountAccessGrants/${link.grantId}`), request: key => db.snapshot(`accountRecoveryRequests/${key}`) };
}
const publicRequest = (requestId = ID, overrides = {}) => ({ requestId, email: athlete.email, name: "Claimed Player", organizationName: "Unverified organization", ...overrides });

test("own-organization manager recovery uses current Auth identity and preserves player data, privileges and providers", async () => {
  const h = setup(), playerBefore = h.db.snapshot("players/player"), workoutBefore = h.db.snapshot("players/player/workoutLogs/keep");
  const inspection = await h.api.inspectPlayerRecovery(scope, manager);
  assert.equal(inspection.email, athlete.email); assert.equal(inspection.targetUID, athlete.uid);
  const link = await h.api.issuePlayerRecovery(issue, manager);
  assert.ok(link.requestId); assert.equal(h.grant(link).recoveryScope, "organization_player");
  assert.equal((await h.api.getAccountAccessLink({ code: link.code })).grantId, link.grantId);
  const result = await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  assert.equal(result.grantId, link.grantId); assert.equal(result.requestId, link.requestId);
  assert.deepEqual(h.directory.writes, [{ uid: athlete.uid, password: PASSWORD }]);
  assert.deepEqual(h.directory.revocations, [athlete.uid]);
  assert.deepEqual(h.db.snapshot("players/player"), playerBefore); assert.deepEqual(h.db.snapshot("players/player/workoutLogs/keep"), workoutBefore);
  assert.equal(h.users.get(athlete.uid).emailVerified, false); assert.deepEqual(h.users.get(athlete.uid).customClaims, { preserved: true });
  assert.deepEqual(h.users.get(athlete.uid).providerData, [{ providerId: "password" }]);
  assert.ok(!JSON.stringify([...h.db.docs.values()]).includes(link.code)); assert.ok(!JSON.stringify([...h.db.docs.values()]).includes(PASSWORD));
});

test("coach, inactive or wrong-UID membership, other-organization manager and stale sign-in cannot issue player recovery", async () => {
  for (const member of [{ userUID: manager.uid, role: "coach", status: "active", teamIds: [] }, { userUID: manager.uid, role: "manager", status: "inactive", teamIds: [] }, { userUID: "wrong", role: "manager", status: "active", teamIds: [] }]) {
    const h = setup({ "organizations/club/members/manager": member });
    await assert.rejects(h.api.issuePlayerRecovery(issue, manager), { code: "permission-denied" }); assert.equal(h.directory.writes.length, 0);
  }
  const h = setup();
  await assert.rejects(h.api.issuePlayerRecovery({ ...issue, organizationId: "other" }, manager), { code: "permission-denied" });
  await assert.rejects(h.api.issuePlayerRecovery(issue, { ...manager, authTime: START / 1000 - 301 }), { code: "failed-precondition" });
  await assert.rejects(h.api.issuePlayerRecovery({ ...issue, identityConfirmed: false }, manager), { code: "invalid-argument" });
  await assert.rejects(h.api.issueAccountRecovery({ email: athlete.email, identityConfirmed: true }, manager), { code: "permission-denied" });
});

test("missing/conflicting/duplicate owner bindings and disabled or missing accounts require review", async () => {
  for (const seed of [
    { "players/player": { registered: true, organizationId: "club" } },
    { "players/player": { authenticationUID: athlete.uid, userUID: "other", organizationId: "club" } },
    { "players/duplicate": { authenticationUID: athlete.uid, organizationId: "other" } },
    { [`players/${athlete.uid}`]: { registered: true, organizationId: "other" } },
  ]) {
    const h = setup(seed); await assert.rejects(h.api.inspectPlayerRecovery(scope, manager), { code: "failed-precondition" });
  }
  const h = setup(); h.users.get(athlete.uid).disabled = true;
  await assert.rejects(h.api.issuePlayerRecovery(issue, manager), { code: "failed-precondition" });
  h.users.delete(athlete.uid); await assert.rejects(h.api.inspectPlayerRecovery(scope, admin), { code: "failed-precondition" });
});

test("company, coach and canonical membership targets cannot use organization player recovery", async () => {
  for (const seed of [
    { [`coaches/${athlete.uid}`]: { userUID: athlete.uid } },
    { "coaches/alias": { userUID: athlete.uid } },
    { [`organizations/other/members/${athlete.uid}`]: { userUID: athlete.uid, role: "manager", status: "active", teamIds: [] } },
    { "otherRoot/a/members/alias": { userUID: athlete.uid } },
  ]) {
    const h = setup(seed); await assert.rejects(h.api.issuePlayerRecovery(issue, manager), { code: "failed-precondition" });
  }
  const h = setup(); h.users.get(athlete.uid).email = "athlete@posetek.net";
  await assert.rejects(h.api.inspectPlayerRecovery(scope, manager), { code: "failed-precondition" });
  h.users.get(athlete.uid).emailVerified = true;
  const global = await h.api.issueAccountRecovery({ email: "athlete@posetek.net", identityConfirmed: true }, admin);
  assert.equal(global.purpose, "account_recovery");
});

test("player transfer, UID changes and revoked issuer stop pending redemption before Auth writes", async () => {
  for (const mutate of [
    h => h.db.docs.get("players/player").organizationId = "other",
    h => h.db.docs.get("players/player").authenticationUID = "wrong",
    h => h.db.docs.get("organizations/club/members/manager").status = "inactive",
    h => h.users.get(manager.uid).disabled = true,
  ]) {
    const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager); mutate(h);
    await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD })); assert.equal(h.directory.writes.length, 0);
  }
});

test("reservation transaction rechecks the manager and target instead of trusting earlier reads", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager), original = h.db.runTransaction.bind(h.db);
  h.db.runTransaction = handler => { h.db.docs.get("players/player").organizationId = "other"; return original(handler); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "permission-denied" });
  assert.equal(h.directory.writes.length, 0); assert.equal(h.grant(link).status, "pending");
});

test("interrupted scoped recovery resumes token revocation once without replaying the password, and rejects changed scope", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.directory.beforeRevoke = () => { throw new Error("lost revocation acknowledgement"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  assert.equal(h.grant(link).stage, "password_applied");
  h.directory.beforeRevoke = null; h.db.docs.get("players/player").organizationId = "other";
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code }), { code: "permission-denied" });
  h.db.docs.get("players/player").organizationId = "club";
  await h.api.completeAccountAccessLink({ code: link.code });
  assert.equal(h.directory.writes.length, 1); assert.equal(h.grant(link).status, "completed");
});

test("manager grants listing and revocation cannot affect global, staff or another organization scope", async () => {
  const h = setup(), scoped = await h.api.issuePlayerRecovery(issue, manager);
  const global = await h.api.issueAccountRecovery({ email: manager.email, identityConfirmed: true }, admin);
  await h.db.doc("accountAccessGrants/" + "a".repeat(64)).set({ purpose: "staff_activation", organizationId: "club", status: "pending", createdAtMillis: START, expiresAtMillis: START + 10000 });
  const listing = await h.api.listAccountAccessLinks({ organizationId: "club" }, manager);
  assert.deepEqual(listing.links.map(row => row.grantId), [scoped.grantId]);
  await assert.rejects(h.api.revokeAccountAccessLink({ grantId: global.grantId }, manager), { code: "permission-denied" });
  await assert.rejects(h.api.revokeAccountAccessLink({ grantId: scoped.grantId, organizationId: "other" }, manager), { code: "permission-denied" });
  await h.api.revokeAccountAccessLink({ grantId: scoped.grantId, organizationId: "club" }, manager);
  assert.equal(h.grant(scoped).status, "revoked"); assert.equal(h.grant(global).status, "pending");
});

test("manager blocked replacement is limited to the same player scope and cannot supersede global recovery", async () => {
  const h = setup(), global = await h.api.issueAccountRecovery({ email: athlete.email, identityConfirmed: true }, admin);
  h.directory.beforeUpdate = () => { throw new Error("uncertain password result"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: global.code, password: PASSWORD }));
  h.advance(121000); h.directory.beforeUpdate = null;
  await assert.rejects(h.api.issuePlayerRecovery(issue, h.fresh(manager)), { code: "already-exists" });
  const reviewed = await h.api.issuePlayerRecovery(issue, h.fresh(admin));
  h.directory.beforeUpdate = () => { throw new Error("uncertain again"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: reviewed.code, password: PASSWORD }));
  h.advance(121000); h.directory.beforeUpdate = null;
  const next = await h.api.issuePlayerRecovery(issue, h.fresh(manager));
  await h.api.completeAccountAccessLink({ code: next.code, password: PASSWORD });
  assert.equal(h.grant(next).status, "completed");
});

test("public request exact email routes privately but all claims remain unverified and acknowledgment is generic", async () => {
  const h = setup();
  let expiry;
  const write = h.db.write.bind(h.db);
  h.db.write = (path, value, options) => { if (path === `accountRecoveryRequests/${ID}`) expiry = value.expiresAt; return write(path, value, options); };
  const response = await h.api.submitAccountRecoveryRequest(publicRequest(ID, { email: "ATHLETE@EXAMPLE.TEST", contact: "Use this contact only after an identity check." }));
  assert.deepEqual(response, { accepted: true, requestId: ID });
  const request = h.request(ID); assert.equal(request.identityVerified, false); assert.equal(request.organizationId, "club"); assert.equal(request.targetUID, athlete.uid);
  assert.equal(request.claimedOrganizationName, "Unverified organization"); assert.equal(request.organizationName, "Club"); assert.equal(request.accountEmail, athlete.email);
  assert.ok(expiry instanceof Date); assert.equal(expiry.getTime(), START + REQUEST_RETENTION_MS);
  const rows = await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager);
  assert.equal(rows.requests[0].identityVerified, false); assert.equal(rows.requests[0].claimedName, "Claimed Player");
  await assert.rejects(h.api.listAccountRecoveryRequests({ organizationId: "other" }, manager), { code: "permission-denied" });
});

test("unknown, ambiguous, staff and unavailable email lookups receive the same acknowledgment and PoseTek-only routing", async () => {
  for (const mode of ["unknown", "duplicate", "staff", "unavailable"]) {
    const h = setup(mode === "duplicate" ? { "players/duplicate": { userUID: athlete.uid, organizationId: "other" } } : mode === "staff" ? { "coaches/alias": { userUID: athlete.uid } } : {});
    if (mode === "unavailable") h.directory.getUserByEmail = () => { throw new Error("unavailable"); };
    const response = await h.api.submitAccountRecoveryRequest(publicRequest(ID, mode === "unknown" ? { email: "unknown@example.test" } : {}));
    assert.deepEqual(response, { accepted: true, requestId: ID }); assert.equal(h.request(ID).organizationId, undefined);
    assert.deepEqual((await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager)).requests, []);
    assert.equal((await h.api.listAccountRecoveryRequests({}, admin)).requests.length, 1);
  }
});

test("intake retries deduplicate without quota consumption, changed payloads conflict, and bounded email/global quotas reject abuse", async () => {
  const h = setup();
  await h.api.submitAccountRecoveryRequest(publicRequest()); await h.api.submitAccountRecoveryRequest(publicRequest());
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("accountRecoveryRequests/")).length, 1);
  await assert.rejects(h.api.submitAccountRecoveryRequest(publicRequest(ID, { name: "Different" })), { code: "already-exists" });
  for (const tail of [2, 3]) await h.api.submitAccountRecoveryRequest(publicRequest(`a0000000-0000-4000-8000-${String(tail).padStart(12, "0")}`));
  await assert.rejects(h.api.submitAccountRecoveryRequest(publicRequest("a0000000-0000-4000-8000-000000000004")), { code: "resource-exhausted" });
  h.advance(3600000); await h.api.submitAccountRecoveryRequest(publicRequest("a0000000-0000-4000-8000-000000000004"));
  h.db.docs.get(`accountRecoveryRequestRateLimits/global-${Math.floor(h.now() / 3600000)}`).count = 1000;
  await assert.rejects(h.api.submitAccountRecoveryRequest(publicRequest("a0000000-0000-4000-8000-000000000005", { email: "other@example.test" })), { code: "resource-exhausted" });
  assert.ok([...h.db.docs.keys()].filter(path => path.startsWith("accountRecoveryRequestRateLimits/")).every(path => !path.includes("@")));
});

test("intake strict validation prevents public UID/organization routing overrides and private link retention", async () => {
  const h = setup();
  for (const payload of [publicRequest(ID, { targetUID: "operator" }), publicRequest(ID, { organizationId: "other" }), publicRequest(ID, { contact: "x".repeat(301) }), publicRequest(ID, { name: "ACCESS-" + "a".repeat(64) }), publicRequest(ID, { requestId: "bad" })]) await assert.rejects(h.api.submitAccountRecoveryRequest(payload), { code: "invalid-argument" });
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("accountRecoveryRequests/")).length, 0);
});

test("manager request reads/updates recheck transfers and changed UID bindings; triage protects stale versions", async () => {
  const h = setup(); await h.api.submitAccountRecoveryRequest(publicRequest());
  const version = h.request(ID).updatedAtMillis;
  await h.api.updateAccountRecoveryRequest({ requestId: ID, expectedUpdatedAtMillis: version, status: "in_review" }, manager);
  await assert.rejects(h.api.updateAccountRecoveryRequest({ requestId: ID, expectedUpdatedAtMillis: version, status: "closed" }, manager), { code: "aborted" });
  h.db.docs.get("players/player").organizationId = "other";
  assert.deepEqual((await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager)).requests, []);
  await assert.rejects(h.api.updateAccountRecoveryRequest({ requestId: ID, expectedUpdatedAtMillis: h.request(ID).updatedAtMillis, status: "closed" }, manager), { code: "permission-denied" });
  assert.equal((await h.api.listAccountRecoveryRequests({}, admin)).requests.length, 1);
});

test("PoseTek can attach an unmatched typo email to a verified player while preserving the original claim, then the manager can help", async () => {
  const h = setup(); await h.api.submitAccountRecoveryRequest(publicRequest(ID, { email: "typo@example.test" }));
  await h.api.updateAccountRecoveryRequest({ requestId: ID, expectedUpdatedAtMillis: START, status: "in_review", ...scope }, admin);
  assert.equal(h.request(ID).claimedEmail, "typo@example.test"); assert.equal(h.request(ID).accountEmail, athlete.email);
  assert.equal((await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager)).requests.length, 1);
  const link = await h.api.issuePlayerRecovery({ ...issue, requestId: ID }, manager);
  assert.equal(link.email, athlete.email); assert.equal(link.requestId, ID);
  await h.db.doc("players/second").set({ authenticationUID: "second", userUID: "second", organizationId: "club" });
  h.users.set("second", { ...h.users.get(athlete.uid), uid: "second", email: "second@example.test" });
  await assert.rejects(h.api.updateAccountRecoveryRequest({ requestId: ID, expectedUpdatedAtMillis: h.request(ID).updatedAtMillis, status: "in_review", organizationId: "club", playerId: "second" }, admin), { code: "failed-precondition" });
});

test("copy is not delivery, shared status is explicit and truthful grant lifecycle/sign-in status is server-derived", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  let row = (await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager)).requests[0];
  assert.equal(row.status, "link_ready"); assert.equal(row.linkSharedAtMillis, null);
  await h.api.updateAccountRecoveryRequest({ requestId: link.requestId, expectedUpdatedAtMillis: row.updatedAtMillis, status: "link_shared" }, manager);
  row = (await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager)).requests[0]; assert.equal(row.status, "link_shared");
  await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  row = (await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager)).requests[0]; assert.equal(row.status, "reset_completed"); assert.equal(row.signInConfirmedAtMillis, null);
  await assert.rejects(h.api.confirmAccountRecovery({ grantId: link.grantId }, { ...athlete, uid: manager.uid, email: manager.email }), { code: "permission-denied" });
  await assert.rejects(h.api.confirmAccountRecovery({ grantId: link.grantId }, { ...athlete, signInProvider: "google.com" }), { code: "failed-precondition" });
  h.advance(1000); const signedIn = h.fresh(athlete);
  await h.api.confirmAccountRecovery({ grantId: link.grantId }, signedIn);
  await h.api.confirmAccountRecovery({ grantId: link.grantId }, signedIn);
  row = (await h.api.listAccountRecoveryRequests({ organizationId: "club" }, h.fresh(manager))).requests[0]; assert.equal(row.status, "confirmed");
  assert.equal([...h.db.docs.values()].filter(doc => doc.action === "sign_in_confirmed").length, 1);
  assert.equal(h.directory.writes.length, 1);
});

test("expired/revoked/blocked links are reflected in the queue; expired requests are unavailable and cannot retain new grants", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.advance(1800000);
  let row = (await h.api.listAccountRecoveryRequests({ organizationId: "club" }, h.fresh(manager))).requests[0]; assert.equal(row.status, "expired");
  await assert.rejects(h.api.updateAccountRecoveryRequest({ requestId: link.requestId, expectedUpdatedAtMillis: row.updatedAtMillis, status: "link_shared" }, h.fresh(manager)), { code: "failed-precondition" });
  await h.api.revokeAccountAccessLink({ grantId: link.grantId }, h.fresh(manager));
  row = (await h.api.listAccountRecoveryRequests({ organizationId: "club" }, h.fresh(manager))).requests[0]; assert.equal(row.status, "revoked");
  h.advance(REQUEST_RETENTION_MS);
  assert.deepEqual((await h.api.listAccountRecoveryRequests({}, h.fresh(admin))).requests, []);
  await assert.rejects(h.api.issuePlayerRecovery({ ...issue, requestId: link.requestId }, h.fresh(manager)), { code: "failed-precondition" });
});

test("manager old grant listings and revocations cannot retain access after a player transfer", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.db.docs.get("players/player").organizationId = "other";
  assert.deepEqual((await h.api.listAccountAccessLinks({ organizationId: "club" }, manager)).links, []);
  await assert.rejects(h.api.revokeAccountAccessLink({ grantId: link.grantId }, manager), { code: "permission-denied" });
  assert.equal((await h.api.listAccountAccessLinks({}, admin)).links.length, 1);
  await h.api.revokeAccountAccessLink({ grantId: link.grantId }, admin);
  assert.equal(h.grant(link).status, "revoked");
});

test("scoped uncertain password acceptance never replays and is exposed as needing review", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.directory.beforeUpdate = (uid, update) => { Object.assign(h.users.get(uid), update); throw new Error("acknowledgement lost"); };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: "must-not-be-written" }), { code: "failed-precondition" });
  assert.equal(h.directory.writes.length, 1); assert.equal(h.grant(link).stage, "reserved");
  assert.equal((await h.api.listAccountRecoveryRequests({ organizationId: "club", requestId: link.requestId }, manager)).requests[0].status, "needs_review");
});

test("current player scope is checked again before final completion after the password write", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.directory.beforeUpdate = () => { h.db.docs.get("players/player").organizationId = "other"; };
  await assert.rejects(h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD }), { code: "failed-precondition" });
  assert.equal(h.directory.writes.length, 1); assert.equal(h.grant(link).status, "blocked"); assert.equal(h.directory.revocations.length, 0);
});

test("private request pagination and exact reread keep an older selected request available without broadening manager scope", async () => {
  const h = setup();
  for (let n = 1; n <= 51; n++) {
    const requestId = `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await h.db.doc(`accountRecoveryRequests/${requestId}`).set({ requestId, claimedName: "Test", claimedEmail: athlete.email, accountEmail: athlete.email, organizationId: "club", playerId: "player", targetUID: athlete.uid, handlingStatus: "new", createdAtMillis: START + n, updatedAtMillis: START + n, expiresAtMillis: START + REQUEST_RETENTION_MS });
  }
  const page = await h.api.listAccountRecoveryRequests({ organizationId: "club" }, manager);
  assert.equal(page.requests.length, 50); assert.ok(page.nextCursor);
  const second = await h.api.listAccountRecoveryRequests({ organizationId: "club", cursor: page.nextCursor }, manager);
  assert.equal(second.requests.length, 1); assert.equal(second.nextCursor, null);
  const selected = await h.api.listAccountRecoveryRequests({ organizationId: "club", requestId: second.requests[0].requestId }, manager);
  assert.equal(selected.requests[0].requestId, second.requests[0].requestId);
  assert.deepEqual((await h.api.listAccountRecoveryRequests({ organizationId: "other", requestId: second.requests[0].requestId }, admin)).requests, []);
});

test("recovery sign-in confirmation rejects a pre-reset session and cannot be claimed by a staff action or read", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.advance(1000); await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  await assert.rejects(h.api.confirmAccountRecovery({ grantId: link.grantId }, athlete), { code: "unauthenticated" });
  await h.api.listAccountRecoveryRequests({ organizationId: "club" }, h.fresh(manager));
  assert.equal(h.grant(link).signInConfirmedAtMillis, undefined);
  h.advance(1000);
  await h.api.confirmAccountRecovery({ grantId: link.grantId }, h.fresh(athlete));
  assert.equal(h.grant(link).signInConfirmedAtMillis, h.now());
});

test("issuance cannot move an issued request to a different player, organization or Auth email", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, admin);
  h.users.set("second", { ...h.users.get(athlete.uid), uid: "second", email: "second@example.test" });
  await h.db.doc("players/second").set({ authenticationUID: "second", userUID: "second", organizationId: "club" });
  await assert.rejects(h.api.issuePlayerRecovery({ organizationId: "club", playerId: "second", identityConfirmed: true, requestId: link.requestId }, admin), { code: "failed-precondition" });
  h.db.docs.get("players/second").organizationId = "other";
  await assert.rejects(h.api.issuePlayerRecovery({ organizationId: "other", playerId: "second", identityConfirmed: true, requestId: link.requestId }, admin), { code: "failed-precondition" });
  await h.api.revokeAccountAccessLink({ grantId: link.grantId }, admin);
  h.users.get(athlete.uid).email = "changed@example.test";
  await assert.rejects(h.api.issuePlayerRecovery({ ...issue, requestId: link.requestId }, admin), { code: "failed-precondition" });
  assert.equal(h.request(link.requestId).targetUID, athlete.uid); assert.equal(h.request(link.requestId).accountEmail, athlete.email); assert.equal(h.request(link.requestId).grantId, link.grantId);
});

test("concurrent administrators selecting different players for one request bind it once and leave no untracked grant", async () => {
  const h = setup(); await h.api.submitAccountRecoveryRequest(publicRequest());
  h.users.set("second", { ...h.users.get(athlete.uid), uid: "second", email: "second@example.test" });
  await h.db.doc("players/second").set({ authenticationUID: "second", userUID: "second", organizationId: "club" });
  const results = await Promise.allSettled([
    h.api.issuePlayerRecovery({ ...issue, requestId: ID }, admin),
    h.api.issuePlayerRecovery({ organizationId: "club", playerId: "second", identityConfirmed: true, requestId: ID }, admin),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const winner = results.find(result => result.status === "fulfilled").value;
  assert.equal(h.request(ID).grantId, winner.grantId); assert.equal(h.request(ID).playerId, winner.playerId);
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("accountAccessGrants/")).length, 1);
});

test("operator review and closure remain visible independently of password and sign-in evidence", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  await h.api.updateAccountRecoveryRequest({ requestId: link.requestId, expectedUpdatedAtMillis: h.request(link.requestId).updatedAtMillis, status: "needs_review" }, manager);
  let row = (await h.api.listAccountRecoveryRequests({ requestId: link.requestId, organizationId: "club" }, manager)).requests[0];
  assert.equal(row.status, "needs_review"); assert.equal(row.grantStatus, "pending");
  await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  h.advance(1000);
  await h.api.confirmAccountRecovery({ grantId: link.grantId }, h.fresh(athlete));
  row = (await h.api.listAccountRecoveryRequests({ requestId: link.requestId, organizationId: "club" }, manager)).requests[0];
  assert.equal(row.status, "needs_review"); assert.equal(row.grantStatus, "completed"); assert.equal(row.passwordUpdatedAtMillis, START); assert.equal(row.signInConfirmedAtMillis, START + 1000);
  await h.api.updateAccountRecoveryRequest({ requestId: link.requestId, expectedUpdatedAtMillis: row.updatedAtMillis, status: "closed" }, manager);
  row = (await h.api.listAccountRecoveryRequests({ requestId: link.requestId, organizationId: "club" }, manager)).requests[0];
  assert.equal(row.status, "closed"); assert.equal(row.passwordUpdatedAtMillis, START); assert.equal(row.signInConfirmedAtMillis, START + 1000);
});

test("same-second pre-reset password sessions cannot acknowledge recovery at Firebase's second-resolution boundary", async () => {
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  h.advance(300); await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  assert.equal(Date.parse(h.users.get(athlete.uid).tokensValidAfterTime), START);
  await assert.rejects(h.api.confirmAccountRecovery({ grantId: link.grantId }, athlete), { code: "failed-precondition" });
  assert.equal(h.grant(link).signInConfirmedAtMillis, undefined);
  h.advance(1000);
  await h.api.confirmAccountRecovery({ grantId: link.grantId }, { ...athlete, authTime: Math.floor(h.now() / 1000) });
  assert.equal(h.grant(link).signInConfirmedAtMillis, h.now());
});

test("confirmation requires all durable timestamps and a sign-in after the latest completion stage", async () => {
  for (const field of ["passwordAppliedAtMillis", "sessionsRevokedAtMillis", "completedAtMillis"]) {
    const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
    await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
    delete h.db.docs.get(`accountAccessGrants/${link.grantId}`)[field];
    h.advance(1000);
    await assert.rejects(h.api.confirmAccountRecovery({ grantId: link.grantId }, h.fresh(athlete)), { code: "failed-precondition" });
  }
  const h = setup(), link = await h.api.issuePlayerRecovery(issue, manager);
  await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  h.db.docs.get(`accountAccessGrants/${link.grantId}`).completedAtMillis = START + 1200;
  h.advance(1500);
  await assert.rejects(h.api.confirmAccountRecovery({ grantId: link.grantId }, { ...athlete, authTime: (START + 1000) / 1000 }), { code: "failed-precondition" });
  h.advance(1000); await h.api.confirmAccountRecovery({ grantId: link.grantId }, { ...athlete, authTime: Math.floor(h.now() / 1000) });
});

test("OAuth-only or missing provider accounts require PoseTek review without adding a password login", async () => {
  for (const providers of [[{ providerId: "google.com" }], [], undefined]) {
    const h = setup(); h.users.get(athlete.uid).providerData = providers;
    await assert.rejects(h.api.inspectPlayerRecovery(scope, manager), { code: "failed-precondition" });
    await assert.rejects(h.api.issuePlayerRecovery(issue, manager), { code: "failed-precondition" });
    await h.api.submitAccountRecoveryRequest(publicRequest());
    assert.equal(h.request(ID).organizationId, undefined); assert.equal(h.directory.writes.length, 0);
    assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("accountAccessGrants/")).length, 0);
  }
});

test("password plus OAuth recovery preserves the existing provider bindings exactly", async () => {
  const h = setup(), providers = [{ providerId: "password", email: athlete.email }, { providerId: "google.com", uid: "provider-subject", email: athlete.email }];
  h.users.get(athlete.uid).providerData = providers;
  const link = await h.api.issuePlayerRecovery(issue, manager);
  await h.api.completeAccountAccessLink({ code: link.code, password: PASSWORD });
  assert.deepEqual(h.users.get(athlete.uid).providerData, providers);
  assert.deepEqual(h.directory.writes, [{ uid: athlete.uid, password: PASSWORD }]);
});
