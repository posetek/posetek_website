"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createPlayerInvitations } = require("./player-invitations");
const { createAdmission } = require("./admission");
const { createClubs } = require("./clubs");
const crypto = require("node:crypto");
const operator = { uid: "admin", email: "staff@posetek.net", emailVerified: true };
const codeIndex = code => `playerSignupCodes/${crypto.createHash("sha256").update(code.toUpperCase()).digest("hex")}`;
const allDocuments = db => [...db.docs.keys()].sort().map(path => [path, db.snapshot(path)]);
function setup(extra = {}) {
  const db = new FakeFirestore({ "coaches/c": { userUID: "c", members: [] }, "players/p": { firstName: "New", lastName: "Player", coachUID: "c", coachDocId: "c", registered: false }, ...extra });
  const args = { db, FieldValue, HttpsError }, invitations = createPlayerInvitations(args);
  return { db, invitations, admission: createAdmission({ ...args, invitations }), clubs: createClubs({ ...args, invitations }) };
}
test("new client-created profiles get protected idempotent invitations, never public secrets", async () => {
  const { db, invitations } = setup();
  const before = await invitations.ensure("p", null, { dryRun: true });
  assert.equal(before.writes, 3); assert.equal(db.snapshot("playerSignupInvitations/p"), undefined);
  const issued = await invitations.ensure("p");
  assert.match(issued.code, /^PLR-[A-F0-9]{32}$/);
  assert.equal((await invitations.ensure("p", { uid: "c" })).code, issued.code);
  assert.equal((await invitations.ensure("p")).writes, 0);
  assert.equal(db.snapshot("players/p").signupCode, undefined);
  assert.equal(db.snapshot("players/p").signupCodeVersion, 3);
  await assert.rejects(invitations.ensure("p", { uid: "attacker" }), { code: "permission-denied" });
});
test("redemption binds the existing profile once and delayed triggers cannot reset it", async () => {
  const { db, invitations, admission } = setup();
  const invite = await invitations.ensure("p");
  assert.deepEqual(await admission.redeemPlayerSignupCode({ uid: "athlete", email: "athlete@example.com", code: invite.code.toLowerCase() }), { playerId: "p" });
  assert.equal(db.snapshot("players/p").authenticationUID, "athlete");
  assert.equal(db.snapshot("players/p").userUID, "athlete");
  assert.equal(db.snapshot("playerSignupInvitations/p"), undefined);
  const original = db.snapshot("players/p");
  assert.equal((await invitations.ensure("p")).skipped, "Already claimed");
  assert.deepEqual(db.snapshot("players/p"), original);
  await assert.rejects(invitations.ensure("p", operator, { rotate: true }), { code: "failed-precondition" });
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "another", code: invite.code }), { code: "not-found" });
});
test("migration preserves valid version-2 codes and explicit replacement invalidates old codes", async () => {
  const { invitations, admission } = setup({ "players/p": { coachUID: "c", registered: false, signupCode: "FRESH22", signupCodeVersion: 2 } });
  assert.equal((await invitations.ensure("p")).code, "FRESH22");
  const replaced = await invitations.ensure("p", operator, { rotate: true });
  assert.notEqual(replaced.code, "FRESH22");
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "new", code: "FRESH22" }), { code: "not-found" });
  assert.deepEqual(await admission.redeemPlayerSignupCode({ uid: "new", code: replaced.code }), { playerId: "p" });
});
test("canonical team access wins over stale coach pointers and malformed ownership is preserved", async () => {
  const { invitations, db } = setup({ "organizations/org": { schemaVersion: 2 }, "players/p": { organizationId: "org", teamId: "t", coachUID: "c" },
    "organizations/org/members/other": { userUID: "other", status: "active", role: "coach", teamIds: ["other-team"] },
    "organizations/org/members/assigned": { userUID: "assigned", status: "active", role: "coach", teamIds: ["t"] } });
  await assert.rejects(invitations.ensure("p", { uid: "c" }), { code: "permission-denied" });
  await assert.rejects(invitations.ensure("p", { uid: "other" }), { code: "permission-denied" });
  assert.ok((await invitations.ensure("p", { uid: "assigned" })).code);
  await db.doc("players/p").update({ authenticationUID: "bound" });
  await assert.rejects(invitations.ensure("p", operator), { code: "failed-precondition" });
});
test("independent coach creation commits roster and invitation together", async () => {
  const { invitations, db } = setup();
  const result = await invitations.createCoachPlayer({ firstName: "New", lastName: "Athlete", phone_number: "9258727208", position: "ST" }, { uid: "c" });
  assert.ok(db.snapshot("coaches/c").members.includes(result.playerId));
  assert.equal(db.snapshot("players/" + result.playerId).signupCode, undefined);
  assert.equal(db.snapshot("playerSignupInvitations/" + result.playerId).code, result.code);
});
test("missing owners and organization-only strangers never receive invitation access", async () => {
  const { invitations } = setup({ "players/orphan": { registered: false }, "players/mismatch": { coachUID: "different", coachDocId: "c" } });
  assert.ok((await invitations.ensure("orphan")).skipped);
  assert.ok((await invitations.ensure("mismatch")).skipped);
});

test("coach creation requires a phone number and position", async () => {
  const { invitations, db } = setup();
  await assert.rejects(invitations.createCoachPlayer({ firstName: "No", lastName: "Phone", position: "CM" }, { uid: "c" }), /phone number/);
  await assert.rejects(invitations.createCoachPlayer({ firstName: "No", lastName: "Position", phone_number: "9258727208" }, { uid: "c" }), /position/);
  assert.equal((db.snapshot("coaches/c").members || []).length, 0);
});

test("coach creation retries return the same player and never duplicate roster membership", async () => {
  const { invitations, db } = setup();
  const input = { firstName:"Retry", lastName:"Player", creationId:"test-creation-request-001", phone_number:"9258727208", position:"GK" };
  const first = await invitations.createCoachPlayer(input, { uid:"c" });
  const retry = await invitations.createCoachPlayer(input, { uid:"c" });
  assert.deepEqual(retry, first); assert.equal(db.snapshot("coaches/c").members.length, 1);
});
test("admission with protected invitation support preserves the legacy coach attachment path", async () => {
  const { admission } = setup({ "players/p": { registered:false, signupCode:"LEGACY2", signupCodeVersion:2 } });
  const result = await admission.attachPlayerByCode({ uid:"c", code:"LEGACY2" });
  assert.ok(result);
});

test("staff getter is read-only for missing and ready invitations, with fragment signup links", async () => {
  const { db, invitations } = setup({ "players/p/reps/r": { repType: "sprint", max_velocity: 7 }, "players/p/sessions/s": { numberReps: 1 } });
  const missingBefore = allDocuments(db);
  assert.deepEqual(await invitations.getInvitation("p", { uid: "c" }), { status: "missing", playerId: "p" });
  assert.deepEqual(allDocuments(db), missingBefore);
  const issued = await invitations.ensure("p", operator);
  const readyBefore = allDocuments(db);
  const ready = await invitations.getInvitation("p", { uid: "c" });
  assert.deepEqual(ready, { status: "ready", playerId: "p", code: issued.code, signupUrl: `https://posetek.net/signin#playerCode=${issued.code}` });
  assert.equal(new URL(ready.signupUrl).search, "");
  assert.deepEqual(await invitations.getInvitation("p", operator), ready);
  assert.deepEqual(allDocuments(db), readyBefore);
});

test("getter requires authenticated authorized staff and current canonical team access", async () => {
  const { db, invitations } = setup({ "organizations/org": { schemaVersion: 2 }, "players/p": { organizationId: "org", teamId: "t", coachUID: "c" },
    "organizations/org/members/manager": { userUID: "manager", status: "active", role: "manager", teamIds: [] },
    "organizations/org/members/assigned": { userUID: "assigned", status: "active", role: "coach", teamIds: ["t"] },
    "organizations/org/members/other": { userUID: "other", status: "active", role: "coach", teamIds: ["other"] },
    "organizations/org/members/revoked": { userUID: "revoked", status: "inactive", role: "manager", teamIds: [] } });
  await invitations.ensure("p", operator);
  const before = allDocuments(db);
  for (const caller of [undefined, { uid: "" }, { uid: "assigned", isAnonymous: true }]) {
    await assert.rejects(invitations.getInvitation("p", caller), { code: "unauthenticated" });
  }
  for (const uid of ["other", "revoked", "stranger", "c"]) {
    await assert.rejects(invitations.getInvitation("p", { uid }), { code: "permission-denied" });
  }
  await assert.rejects(invitations.getInvitation("missing", operator), { code: "permission-denied" });
  await assert.rejects(invitations.getInvitation("../p", operator), { code: "invalid-argument" });
  for (const caller of [operator, { uid: "manager" }, { uid: "assigned" }]) assert.equal((await invitations.getInvitation("p", caller)).status, "ready");
  assert.deepEqual(allDocuments(db), before);
});

test("ordinary club issuance and concurrent ensure retries preserve one invitation and all athlete data", async () => {
  const { db, invitations, clubs } = setup({ "players/p/reps/r": { repType: "jump", jumpHeight: 0.5 }, "players/p/sessions/s": { numberReps: 1 } });
  const originalPlayer = db.snapshot("players/p");
  const attempts = await Promise.all([invitations.ensure("p", operator), invitations.ensure("p", operator), clubs.issueClubPlayerInvitation({ playerId: "p" }, operator)]);
  assert.equal(new Set(attempts.map(result => result.code)).size, 1);
  assert.equal(attempts.filter(result => result.writes !== 0).length, 1);
  assert.deepEqual(db.snapshot("players/p"), { ...originalPlayer, signupInvitationReady: true, signupCodeVersion: 3 });
  const before = allDocuments(db);
  const repeated = await clubs.issueClubPlayerInvitation({ playerId: "p", rotate: true }, operator);
  assert.equal(repeated.code, attempts[0].code);
  assert.equal(repeated.writes, 0);
  assert.deepEqual(allDocuments(db), before);
  assert.deepEqual(db.snapshot("players/p/reps/r"), { repType: "jump", jumpHeight: 0.5 });
  assert.deepEqual(db.snapshot("players/p/sessions/s"), { numberReps: 1 });
});

test("claimed getter never exposes a stale code and normal issuance cannot reset ownership", async () => {
  for (const claimed of [{ registered: true }, { authenticationUID: "athlete" }, { userUID: "athlete" }]) {
    const { db, invitations } = setup();
    const issued = await invitations.ensure("p", operator);
    await db.doc("players/p").update(claimed);
    const before = allDocuments(db);
    assert.deepEqual(await invitations.getInvitation("p", operator), { status: "claimed", playerId: "p" });
    assert.deepEqual(await invitations.validate(issued.code), { valid: false });
    await assert.rejects(invitations.ensure("p", operator), { code: "failed-precondition" });
    assert.deepEqual(allDocuments(db), before);
  }
});

test("broken protected mappings fail truthfully without rotating, repairing or exposing codes", async () => {
  for (const broken of ["missing-index", "wrong-index", "wrong-player", "invalid-code"]) {
    const { db, invitations } = setup();
    const issued = await invitations.ensure("p", operator);
    if (broken === "missing-index") await db.doc(codeIndex(issued.code)).delete();
    if (broken === "wrong-index") await db.doc(codeIndex(issued.code)).set({ playerId: "someone-else" });
    if (broken === "wrong-player") await db.doc("playerSignupInvitations/p").update({ playerId: "someone-else" });
    if (broken === "invalid-code") await db.doc("playerSignupInvitations/p").update({ code: "invalid/value" });
    const before = allDocuments(db);
    for (const read of [() => invitations.getInvitation("p", operator), () => invitations.ensure("p", operator), () => invitations.ensure("p", operator, { rotate: true })]) {
      await assert.rejects(read(), error => error.code === "failed-precondition" && !error.message.includes(issued.code));
    }
    assert.deepEqual(await invitations.validate(issued.code), { valid: false });
    assert.deepEqual(allDocuments(db), before);
  }
});

test("public preflight returns only validity with no writes and final claim remains authoritative", async () => {
  const { db, invitations } = setup();
  const issued = await invitations.ensure("p", operator);
  const before = allDocuments(db);
  assert.deepEqual(await invitations.validate(` ${issued.code.toLowerCase()} `), { valid: true });
  for (const code of [undefined, null, {}, [], 123, "", "a", "INVALID/value", "x".repeat(65), "UNKNOWN-CODE"]) {
    assert.deepEqual(await invitations.validate(code), { valid: false });
  }
  assert.deepEqual(allDocuments(db), before);
  await invitations.redeem(issued.code, "first-athlete", "athlete@example.test");
  const claimed = allDocuments(db);
  assert.deepEqual(await invitations.validate(issued.code), { valid: false });
  assert.equal(await invitations.redeem(issued.code, "second-athlete", "other@example.test"), null);
  assert.deepEqual(allDocuments(db), claimed);
});

test("legacy version-2 read and preflight preserve the code and use only bounded exact lookups", async () => {
  const { db, invitations } = setup({ "players/p": { coachUID: "c", registered: false, signupCode: "LEGACY22", signupCodeVersion: 2 } });
  const before = allDocuments(db);
  assert.deepEqual(await invitations.getInvitation("p", operator), { status: "ready", playerId: "p", code: "LEGACY22", signupUrl: "https://posetek.net/signin#playerCode=LEGACY22" });
  assert.deepEqual(await invitations.validate("legacy22"), { valid: true });
  assert.deepEqual(allDocuments(db), before);
  assert.ok(db.queries.every(query => query.path === "players" && query.filters.length === 1 && ["signupCode", "code"].includes(query.filters[0][0]) && query.filters[0][1] === "=="));
  assert.equal((await invitations.ensure("p", operator)).code, "LEGACY22");
  assert.deepEqual(await invitations.validate("LEGACY22"), { valid: true });
  await db.doc("players/p").update({ registered: true });
  assert.deepEqual(await invitations.validate("LEGACY22"), { valid: false });
});

test("preflight rejects obsolete legacy codes, malformed indices and mismatched invitation identities", async () => {
  const { db, invitations } = setup({ "players/p": { coachUID: "c", registered: false, signupCode: "LEGACY1", signupCodeVersion: 1 } });
  assert.deepEqual(await invitations.validate("LEGACY1"), { valid: false });
  const issued = await invitations.ensure("p", operator);
  await db.doc(codeIndex(issued.code)).update({ playerId: "bad/path" });
  const broken = allDocuments(db);
  assert.deepEqual(await invitations.validate(issued.code), { valid: false });
  await assert.rejects(invitations.redeem(issued.code, "athlete", "a@example.test"), { code: "not-found" });
  assert.deepEqual(allDocuments(db), broken);
});

test("redemption rejects inconsistent protected identity even after an earlier successful preflight", async () => {
  const { db, invitations } = setup();
  const issued = await invitations.ensure("p", operator);
  assert.deepEqual(await invitations.validate(issued.code), { valid: true });
  await db.doc("playerSignupInvitations/p").update({ playerId: "different-player" });
  const before = allDocuments(db);
  await assert.rejects(invitations.redeem(issued.code, "athlete", "a@example.test"), { code: "not-found" });
  assert.deepEqual(allDocuments(db), before);
});

test("migration preserves the exact issued legacy code while protected lookup remains case-insensitive", async () => {
  const { invitations } = setup({ "players/p": { coachUID: "c", registered: false, signupCode: "Legacy22", signupCodeVersion: 2 } });
  assert.equal((await invitations.ensure("p", operator)).code, "Legacy22");
  assert.equal((await invitations.getInvitation("p", operator)).code, "Legacy22");
  assert.deepEqual(await invitations.validate("LEGACY22"), { valid: true });
});

test("ambiguous legacy codes cannot be read, validated or migrated across either legacy field", async () => {
  for (const otherField of ["signupCode", "code"]) {
    const { db, invitations } = setup({
      "players/p": { coachUID: "c", registered: false, signupCode: "SHARED22", signupCodeVersion: 2 },
      "players/other": { coachUID: "c", registered: false, [otherField]: "SHARED22", signupCodeVersion: 2 },
    });
    const before = allDocuments(db);
    assert.deepEqual(await invitations.validate("shared22"), { valid: false });
    for (const playerId of ["p", "other"]) {
      await assert.rejects(invitations.getInvitation(playerId, operator), { code: "failed-precondition" });
      await assert.rejects(invitations.ensure(playerId, operator), { code: "failed-precondition" });
    }
    assert.deepEqual(allDocuments(db), before);
  }
});

test("the same legacy code in both fields of one athlete is one unambiguous invitation", async () => {
  const { invitations } = setup({ "players/p": { coachUID: "c", registered: false, signupCode: "UNIQUE22", code: "UNIQUE22", signupCodeVersion: 2 } });
  assert.deepEqual(await invitations.validate("unique22"), { valid: true });
  assert.equal((await invitations.getInvitation("p", operator)).code, "UNIQUE22");
  assert.equal((await invitations.ensure("p", operator)).code, "UNIQUE22");
});
