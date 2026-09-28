"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createClubs, INVITE_TTL_MS } = require("./clubs");
const { createAdmission } = require("./admission");
const { createTeamLeaderboard } = require("./team-leaderboard");
const { createAthleteShares } = require("./athlete-shares");
const { clubStaffCanAccessPlayer } = require("./club-access");

const auth = (uid, email = `${uid}@example.test`, emailVerified = true) => ({ uid, email, emailVerified });
const admin = auth("admin", "Admin@PoseTek.net");
const manager = auth("manager");
const coachA = auth("coach-a");
const coachB = auth("coach-b");
const base = {
  "organizations/club": { schemaVersion: 2, name: "Test Club", memberUIDs: ["manager", "manager-2", "coach-a", "coach-b"], managerUIDs: ["manager", "manager-2"], coaches: ["legacy"], players: ["historic-uid"] },
  "organizations/elsewhere": { schemaVersion: 2, name: "Other", memberUIDs: ["outsider"] },
  "organizations/club/members/manager": { userUID: "manager", role: "manager", teamIds: [], status: "active", email: "manager@example.test" },
  "organizations/club/members/manager-2": { userUID: "manager-2", role: "manager", teamIds: [], status: "active", email: "manager-2@example.test" },
  "organizations/club/members/coach-a": { userUID: "coach-a", role: "coach", teamIds: ["a"], status: "active", email: "coach-a@example.test" },
  "organizations/club/members/coach-b": { userUID: "coach-b", role: "coach", teamIds: ["b"], status: "active", email: "coach-b@example.test" },
  "organizations/elsewhere/members/outsider": { userUID: "outsider", role: "manager", teamIds: [], status: "active" },
  "teams/a": { organizationId: "club", name: "Girls", coachUIDs: ["coach-a"], playerIds: ["pa"] },
  "teams/b": { organizationId: "club", name: "Boys", coachUIDs: ["coach-b"], playerIds: ["pb"] },
  "teams/foreign": { organizationId: "elsewhere", name: "Other" },
  "players/pa": { organizationId: "club", teamId: "a", firstName: "A", lastName: "One", authenticationUID: "athlete-a", userUID: "athlete-a", coachUID: "legacy", storagePath: "pa/sprint/session1/kick1" },
  "players/pb": { organizationId: "club", teamId: "b", firstName: "B", lastName: "Two", authenticationUID: "athlete-b", userUID: "athlete-b", coachUID: "legacy" },
  "players/pa/reps/r": { repType: "sprint", max_velocity: 7, storagePath: "pa/sprint/session1/kick1", private: "secret" },
  "players/pb/reps/r": { repType: "sprint", max_velocity: 8 },
  "coaches/legacy": { userUID: "legacy", members: ["pa", "pb"] },
};
function harness(seed = {}, clock) {
  const db = new FakeFirestore({ ...base, ...seed });
  return { db, clubs: createClubs({ db, FieldValue, HttpsError, ...(clock ? { now: clock } : {}) }) };
}
const invitation = { organizationId: "club", firstName: "Invited", lastName: "Coach", email: "new@example.test", role: "coach", teamIds: ["a"] };

test("fresh player code replaces legacy code without creating or moving a player profile", async () => {
  const { clubs, db } = harness({ "players/unclaimed": { firstName: "Existing", lastName: "Athlete", organizationId: "club", teamId: "a", registered: false, signupCode: "OLD001", coachUID: "legacy", customData: { preserved: true } }, "players/unclaimed/reps/old-rep": { max_velocity: 8 } });
  const result = await clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "unclaimed" }, coachA);
  assert.match(result.code, /^PLR-[A-F0-9]{32}$/);
  assert.equal(db.snapshot("players/unclaimed").signupCodeVersion, 2);
  assert.deepEqual(db.snapshot("players/unclaimed").customData, { preserved: true });
  const admission = createAdmission({ db, FieldValue, HttpsError });
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "claimant", code: "OLD001" }), { code: "not-found" });
  assert.deepEqual(await admission.redeemPlayerSignupCode({ uid: "claimant", email: "claimant@example.test", code: result.code }), { playerId: "unclaimed" });
  assert.equal(db.snapshot("players/unclaimed").authenticationUID, "claimant");
  assert.equal(db.snapshot("players/unclaimed").organizationId, "club");
  assert.equal(db.snapshot("players/claimant"), undefined);
  assert.equal(db.snapshot("players/unclaimed/reps/old-rep").max_velocity, 8);
  await assert.rejects(clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "unclaimed" }, manager), { code: "failed-precondition" });
});

test("existing player invitations respect team assignments and cannot reset a claimed account", async () => {
  const { clubs } = harness({ "players/unclaimed": { organizationId: "club", teamId: "a", registered: false } });
  for (const actor of [coachB, auth("legacy"), auth("outsider")]) await assert.rejects(clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "unclaimed" }, actor), { code: "permission-denied" });
  await assert.rejects(clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "pa" }, admin), { code: "failed-precondition" });
  const first = await clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "unclaimed" }, admin);
  const second = await clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "unclaimed" }, manager);
  assert.equal(first.code, second.code);
});

test("legacy club invitation retries preserve valid version-2 codes without profile or result writes", async () => {
  const { clubs, db } = harness({ "players/unclaimed": { organizationId: "club", teamId: "a", registered: false, signupCode: "CURRENT22", signupCodeVersion: 2 }, "players/unclaimed/reps/r": { max_velocity: 8 } });
  const before = [...db.docs.keys()].map(path => [path, db.snapshot(path)]);
  for (const actor of [coachA, manager, admin]) {
    assert.equal((await clubs.issueClubPlayerInvitation({ organizationId: "club", playerId: "unclaimed" }, actor)).code, "CURRENT22");
  }
  assert.deepEqual([...db.docs.keys()].map(path => [path, db.snapshot(path)]), before);
});

test("directory and context isolate manager, team coach, athlete and other clubs", async () => {
  const { clubs } = harness();
  const all = await clubs.getClubContext({}, manager);
  assert.equal(all.role, "manager");
  assert.equal(all.players.length, 2);
  const scoped = await clubs.getClubContext({}, coachA);
  assert.deepEqual(scoped.players.map((p) => p.id), ["pa"]);
  assert.deepEqual(scoped.teams.map((t) => t.id), ["a"]);
  assert.deepEqual(scoped.staff, []);
  assert.deepEqual(scoped.invitations, []);
  const player = await clubs.getClubContext({}, auth("athlete-a"));
  assert.equal(player.role, "player");
  assert.deepEqual(player.teams[0].playerIds, ["pa"]);
  assert.deepEqual(player.players.map((p) => p.id), ["pa"]);
  await assert.rejects(clubs.getClubContext({ organizationId: "elsewhere" }, manager), { code: "permission-denied" });
  assert.equal((await clubs.getClubContext({}, auth("nobody"))).role, "none");
  assert.equal((await clubs.getClubContext({}, admin)).organizations.length, 2);
});
test("context offers signup codes only for profiles without any account binding", async () => {
  const { clubs } = harness({
    "players/unclaimed": { organizationId: "club", teamId: "a", registered: false },
    "players/registered": { organizationId: "club", teamId: "a", registered: true },
    "players/malformed": { organizationId: "club", teamId: "a", authenticationUID: null },
  });
  const context = await clubs.getClubContext({}, manager);
  const offered = context.players.filter((player) => player.canIssueSignupCode).map((player) => player.id);
  assert.deepEqual(offered, ["unclaimed"]);
  assert.ok(context.players.every((player) => !Object.hasOwn(player, "authenticationUID") && !Object.hasOwn(player, "signupCode")));
});
test("only verified exact-domain admins create clubs; spoofed payload grants no authority", async () => {
  const { clubs } = harness();
  for (const actor of [coachA, manager, auth("bad", "admin@posetek.net", false), auth("bad", "admin@posetek.net.evil")]) await assert.rejects(clubs.createClubOrganization({ name: "New", role: "admin" }, actor), { code: "permission-denied" });
  const created = await clubs.createClubOrganization({ name: "New" }, admin);
  assert.ok(created.organizationId);
});
test("128-bit staff codes are hash-only and placeholder claim binds canonical UID atomically", async () => {
  const { clubs, db } = harness();
  const invite = await clubs.createClubStaffInvitation(invitation, manager);
  assert.match(invite.code, /^CLUB-[A-F0-9]{32}$/);
  assert.equal(invite.invitationId, crypto.createHash("sha256").update(invite.code).digest("hex"));
  assert.ok(!JSON.stringify([...db.docs.values()]).includes(invite.code));
  const result = await clubs.redeemClubStaffInvitation({ code: invite.code.toLowerCase() }, auth("new"));
  assert.deepEqual(result, { organizationId: "club", role: "coach", teamIds: ["a"] });
  assert.equal(db.snapshot("organizations/club/members/new").userUID, "new");
  assert.deepEqual(db.snapshot("coaches/new").members, ["pa"]);
  assert.equal(db.snapshot(`clubStaffInvitations/${invite.invitationId}`).status, "claimed");
  assert.deepEqual(db.snapshot("organizations/club").coaches, ["legacy"]);
  assert.deepEqual(db.snapshot("organizations/club").players, ["historic-uid"]);
  await assert.rejects(clubs.redeemClubStaffInvitation({ code: invite.code }, auth("new")), { code: "not-found" });
});
test("email mismatch, unverified token and expiry cannot claim or consume an invitation", async () => {
  let time = 1000;
  const { clubs, db } = harness({}, () => time);
  const invite = await clubs.createClubStaffInvitation(invitation, manager);
  await assert.rejects(clubs.redeemClubStaffInvitation({ code: invite.code }, auth("new", "new@example.test", false)), { code: "failed-precondition" });
  await assert.rejects(clubs.redeemClubStaffInvitation({ code: invite.code }, auth("wrong")), { code: "permission-denied" });
  assert.equal(db.snapshot(`clubStaffInvitations/${invite.invitationId}`).status, "pending");
  time += INVITE_TTL_MS + 1;
  await assert.rejects(clubs.redeemClubStaffInvitation({ code: invite.code }, auth("new")), { code: "not-found" });
  assert.equal((await clubs.getClubContext({}, manager)).invitations[0].status, "expired");
});
test("competing verified callers sharing an email get exactly one atomic claim", async () => {
  const { clubs, db } = harness();
  const invite = await clubs.createClubStaffInvitation(invitation, manager);
  const results = await Promise.allSettled(["new-a", "new-b"].map((uid) => clubs.redeemClubStaffInvitation({ code: invite.code }, auth(uid, "new@example.test"))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "not-found");
  assert.equal(["new-a", "new-b"].filter((uid) => db.snapshot(`organizations/club/members/${uid}`)).length, 1);
});
test("one UID racing two invitations across clubs cannot acquire both identities", async () => {
  const { clubs } = harness();
  const first = await clubs.createClubStaffInvitation(invitation, manager);
  const second = await clubs.createClubStaffInvitation({ ...invitation, organizationId: "elsewhere", teamIds: [] }, admin);
  const results = await Promise.allSettled([first, second].map((invite) => clubs.redeemClubStaffInvitation({ code: invite.code }, auth("new"))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("placeholder cannot overwrite another coach, athlete or legacy organization binding", async () => {
  for (const seed of [
    { "coaches/new": { userUID: "other" } },
    { "coaches/old-doc": { userUID: "new" } },
    { "coaches/new": { userUID: "new", members: ["unrelated"] } },
    { "players/old-player": { authenticationUID: "new" } },
    { "coaches/new": { userUID: "new", organizationId: "elsewhere" } },
    { "coaches/new": { userUID: "new", organizationId: "" } },
    { "coaches/new": { userUID: "new", organizationCode: "LEGACY" } },
  ]) {
    const { clubs, db } = harness(seed);
    const invite = await clubs.createClubStaffInvitation(invitation, manager);
    await assert.rejects(clubs.redeemClubStaffInvitation({ code: invite.code }, auth("new")), { code: "failed-precondition" });
    for (const [path, original] of Object.entries(seed)) assert.deepEqual(db.snapshot(path), original);
    assert.equal(db.snapshot(`clubStaffInvitations/${invite.invitationId}`).status, "pending");
  }
});
test("coach cannot grant roles or transfer teams; manager cannot cross clubs", async () => {
  const { clubs } = harness();
  for (const call of [
    () => clubs.createClubStaffInvitation(invitation, coachA),
    () => clubs.saveClubTeam({ organizationId: "club", name: "Forged" }, coachA),
    () => clubs.setClubStaffTeams({ organizationId: "club", userUID: "coach-b", teamIds: ["a"] }, coachA),
    () => clubs.setClubPlayerTeam({ organizationId: "club", playerId: "pb", teamId: "a" }, coachA),
    () => clubs.saveClubTeam({ organizationId: "elsewhere", name: "Foreign" }, manager),
  ]) await assert.rejects(call(), { code: "permission-denied" });
  await assert.rejects(clubs.createClubStaffInvitation({ ...invitation, teamIds: ["foreign"] }, manager), { code: "invalid-argument" });
});
test("team transfers preserve player identity and revoke old team access immediately", async () => {
  const { clubs, db } = harness();
  const original = db.snapshot("players/pa");
  await clubs.setClubPlayerTeam({ organizationId: "club", playerId: "pa", teamId: "b" }, manager);
  const moved = db.snapshot("players/pa");
  assert.equal(moved.authenticationUID, original.authenticationUID);
  assert.equal(moved.userUID, original.userUID);
  assert.equal(moved.storagePath, original.storagePath);
  assert.deepEqual(db.snapshot("coaches/coach-a").members, []);
  assert.deepEqual(db.snapshot("coaches/coach-b").members, ["pa", "pb"]);
  assert.equal(await clubStaffCanAccessPlayer(db, "coach-a", moved), false);
  assert.equal(await clubStaffCanAccessPlayer(db, "coach-b", moved), true);
  assert.equal(await clubStaffCanAccessPlayer(db, "legacy", moved), false);
});
test("staff revocation clears mirrors and directory; self/last manager safeguards", async () => {
  const { clubs, db } = harness();
  await clubs.setClubStaffTeams({ organizationId: "club", userUID: "coach-a", teamIds: [], status: "inactive" }, manager);
  assert.deepEqual(db.snapshot("coaches/coach-a").members, []);
  assert.equal((await clubs.getClubContext({}, coachA)).role, "none");
  assert.equal(await clubStaffCanAccessPlayer(db, "coach-a", db.snapshot("players/pa")), false);
  await assert.rejects(clubs.setClubStaffTeams({ organizationId: "club", userUID: "manager", teamIds: [], status: "inactive" }, manager), { code: "failed-precondition" });
  await clubs.setClubStaffTeams({ organizationId: "club", userUID: "manager-2", teamIds: [], status: "inactive" }, manager);
  await assert.rejects(clubs.setClubStaffTeams({ organizationId: "club", userUID: "manager", teamIds: [], status: "inactive" }, admin), { code: "failed-precondition" });
});
test("revoking pending invitation prevents later claim", async () => {
  const { clubs } = harness();
  const invite = await clubs.createClubStaffInvitation(invitation, manager);
  await clubs.revokeClubStaffInvitation({ organizationId: "club", invitationId: invite.invitationId }, manager);
  await assert.rejects(clubs.redeemClubStaffInvitation({ code: invite.code }, auth("new")), { code: "not-found" });
});
test("assigned coach adds player with canonical club/team and existing player-code claim works", async () => {
  const { clubs, db } = harness();
  await assert.rejects(clubs.createClubPlayer({ organizationId: "club", teamId: "b", firstName: "New", lastName: "Player", phone_number: "9258727208", position: "CM" }, coachA), { code: "permission-denied" });
  const base = { organizationId: "club", teamId: "a", firstName: "New", lastName: "Player" };
  await assert.rejects(clubs.createClubPlayer(base, coachA), /phone number/);
  await assert.rejects(clubs.createClubPlayer({ ...base, phone_number: "925-872" , position: "CM" }, coachA), /phone number/);
  await assert.rejects(clubs.createClubPlayer({ ...base, phone_number: "9258727208" }, coachA), /position/);
  await assert.rejects(clubs.createClubPlayer({ ...base, phone_number: "9258727208", position: "Striker" }, coachA), /position/);
  await assert.rejects(clubs.createClubPlayer({ ...base, phone_number: "9258727208", position: "CM", weight: 0 }, coachA), /weight/);
  const created = await clubs.createClubPlayer({ ...base, phone_number: "+1 925 872 7208", position: "CM", height: 177.8, weight: 70.3 }, coachA);
  const player = db.snapshot(`players/${created.playerId}`);
  assert.equal(player.phone_number, "(925)-872-7208");
  assert.equal(player.position, "CM");
  assert.equal(player.height, 177.8);
  assert.equal(player.weight, 70.3);
  assert.equal(player.organizationId, "club");
  assert.equal(player.teamId, "a");
  const admission = createAdmission({ db, FieldValue, HttpsError, randomInt: () => 0 });
  assert.deepEqual(await admission.redeemPlayerSignupCode({ uid: "new-athlete", email: "new-athlete@example.test", code: created.code }), { playerId: created.playerId });
  assert.equal(db.snapshot(`players/${created.playerId}`).organizationId, "club");
});
test("legacy organization codes cannot admit staff or move club identities", async () => {
  const { db } = harness({
    "organizations/club": { ...base["organizations/club"], code: "ORGTEST", codeVersion: 2 },
    "organizations/legacy-org": { code: "ORGOLD", codeVersion: 2 },
    "coaches/coach-a": { userUID: "coach-a", organizationId: "club", members: ["pa"] },
  });
  const admission = createAdmission({ db, FieldValue, HttpsError, randomInt: () => 0 });
  await assert.rejects(admission.joinOrganization({ uid: "stranger", role: "coach", code: "ORGTEST", firstName: "A", lastName: "B" }), { code: "not-found" });
  await assert.rejects(admission.joinOrganization({ uid: "coach-a", role: "coach", code: "ORGOLD", firstName: "A", lastName: "B" }), { code: "failed-precondition" });
  await assert.rejects(admission.createOrganization({ uid: "coach-a", name: "Other", firstName: "A", lastName: "B" }), { code: "failed-precondition" });
});
test("leaderboards use canonical team assignments despite broad stale coach rosters", async () => {
  const { db } = harness();
  const boards = createTeamLeaderboard({ db, HttpsError, effectiveResults: { listForPlayer: async () => ({ reps: [] }) } });
  const result = await boards.getTeamLeaderboard({ uid: "athlete-a" });
  assert.deepEqual(result.athletes.map((p) => p.id), ["pa"]);
  assert.equal(result.teamId, "a");
  await assert.rejects(boards.getTeamLeaderboard({ uid: "athlete-a", teamId: "b" }), { code: "permission-denied" });
  await assert.rejects(boards.getTeamLeaderboard({ ...coachA, teamId: "b" }), { code: "permission-denied" });
  assert.equal((await boards.getTeamLeaderboard({ ...manager, teamId: "b" })).athletes.length, 1);
});
test("club share creation and later read reject stale legacy and revoked assignments", async () => {
  const { db, clubs } = harness();
  const shares = createAthleteShares({ db, crypto, Timestamp: FakeTimestamp, HttpsError, signingKey: () => "k".repeat(64) });
  await assert.rejects(shares.createAthleteResultsShare({ uid: "legacy", playerDocId: "pa" }), { code: "permission-denied" });
  const share = await shares.createAthleteResultsShare({ ...coachA, playerDocId: "pa" });
  await shares.verifiedAthleteShare(share.token, "sprint");
  await clubs.setClubStaffTeams({ organizationId: "club", userUID: "coach-a", teamIds: [] }, manager);
  await assert.rejects(shares.verifiedAthleteShare(share.token, "sprint"), { code: "permission-denied" });
  const adminShare = await shares.createAthleteResultsShare({ ...admin, playerDocId: "pa" });
  await shares.verifiedAthleteShare(adminShare.token, "sprint");
});

test("legacy signup preserves non-UID athlete IDs and cannot create cross-role club duplicates", async () => {
  for (const profile of [
    { organizationId: "club" }, { organizationId: "" }, { organizationId: null },
  ]) {
    for (const existing of [
      { "players/random-id": { userUID: "new", authenticationUID: "new", ...profile } },
      { "coaches/random-coach": { userUID: "new", ...profile } },
    ]) {
      for (const role of ["player", "coach"]) {
        const { db } = harness({ "organizations/legacy": { code: "ORGLEGACY", codeVersion: 2 }, ...existing });
        const admission = createAdmission({ db, FieldValue, HttpsError, randomInt: () => 0 });
        await assert.rejects(admission.joinOrganization({ uid: "new", role, code: "ORGLEGACY", firstName: "New", lastName: "User" }), { code: "failed-precondition" });
        assert.equal(db.snapshot("players/new"), undefined);
        assert.equal(db.snapshot("coaches/new"), undefined);
      }
    }
  }
  const { db } = harness({
    "organizations/legacy": { code: "ORGLEGACY", codeVersion: 2 },
    "players/non-uid-player": { userUID: "new", authenticationUID: "new", firstName: "Original" },
  });
  const admission = createAdmission({ db, FieldValue, HttpsError, randomInt: () => 0 });
  await admission.joinOrganization({ uid: "new", role: "player", code: "ORGLEGACY", firstName: "New", lastName: "User" });
  assert.equal(db.snapshot("players/new"), undefined);
  assert.equal(db.snapshot("players/non-uid-player").firstName, "Original");
  assert.equal(db.snapshot("players/non-uid-player").organization.id, "legacy");
});

test("createdByRole is HMAC-bound; forged admin role cannot revive a revoked club share", async () => {
  const { db, clubs } = harness();
  const shares = createAthleteShares({ db, crypto, Timestamp: FakeTimestamp, HttpsError, signingKey: () => "k".repeat(64) });
  const issued = await shares.createAthleteResultsShare({ ...coachA, playerDocId: "pa" });
  const hash = shares.athleteShareTokenHash(issued.token);
  const ref = db.collection("athleteResultSharesV2").doc(hash);
  await clubs.setClubStaffTeams({ organizationId: "club", userUID: "coach-a", teamIds: [] }, manager);
  await ref.update({ createdByRole: "admin" });
  await assert.rejects(shares.verifiedAthleteShare(issued.token, "sprint"), { code: "permission-denied" });
  // Historical shares signed without a role retain their original HMAC shape,
  // but absent role still requires the issuing staff member's active assignment.
  const legacy = { ...db.snapshot(`athleteResultSharesV2/${hash}`) };
  delete legacy.createdByRole;
  legacy.issuanceSignature = shares.athleteShareSignature(hash, legacy);
  await ref.set(legacy);
  assert.equal(shares.validAthleteShareSignature(hash, legacy), true);
  await assert.rejects(shares.verifiedAthleteShare(issued.token, "sprint"), { code: "permission-denied" });
});
