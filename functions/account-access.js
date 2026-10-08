"use strict";

const crypto = require("node:crypto");
const { isIP } = require("node:net");
const { isClubAdmin, activeMember } = require("./club-access");
const { playerSegment } = require("./athlete-storage-paths");
const { createAccountRecovery } = require("./account-recovery");

const ACCESS_CODE = /^ACCESS-[A-F0-9]{64}$/;
const TTL = Object.freeze({ staff_activation: 7 * 86400000, internal_admin_activation: 86400000, account_recovery: 1800000 });
const RECENT_AUTH_MS = 5 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const OPERATION_QUIET_MS = 2 * 60 * 1000;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const companyEmail = value => /^[a-z0-9._%+-]+@posetek\.net$/i.test(value);

// Passwords, raw codes and ID/custom tokens are never persisted or logged.
// Auth cannot participate in a Firestore transaction. A grant is durably consumed
// BEFORE a password write; uncertainty is terminal (blocked), never an invitation
// to replay that write. Only metadata acknowledgement is idempotent.
function createAccountAccess({ db, authDirectory, clubs, FieldValue, HttpsError, now = () => Date.now(), randomBytes = crypto.randomBytes, origin = "https://posetek.net" }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const stamp = () => FieldValue.serverTimestamp();
  const grantRef = id => db.collection("accountAccessGrants").doc(id);
  const targetRef = email => db.collection("accountAccessTargets").doc(hash(email));
  const invalid = () => fail("not-found", "This private link is invalid, expired or revoked. Ask PoseTek or your organization admin for a new link.");
  const needsHelp = () => fail("failed-precondition", "This setup has already started. Try signing in with the password you chose. If that does not work, contact PoseTek for account recovery.");
  function email(value) {
    const result = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (result.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result)) fail("invalid-argument", "Enter a valid email address.");
    return result;
  }
  function name(value, label) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100) fail("invalid-argument", `Enter a valid ${label}.`);
    return value.trim();
  }
  function codeId(value) {
    const code = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!ACCESS_CODE.test(code)) invalid();
    return hash(code);
  }
  function knownId(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
    return value;
  }
  function creation(user) {
    const value = user?.metadata?.creationTime;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("failed-precondition", "This account needs PoseTek identity review.");
    return value;
  }
  async function getUser(uid) {
    try { return await authDirectory.getUser(uid); }
    catch (error) { if (error?.code === "auth/user-not-found") fail("failed-precondition", "This account no longer exists. Ask PoseTek to review it."); throw error; }
  }
  async function actor(auth, recent = false) {
    if (!playerSegment(auth?.uid) || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
    const current = await getUser(auth.uid);
    if (current.disabled) fail("permission-denied", "This account cannot manage access.");
    const validAfter = Date.parse(current.tokensValidAfterTime || "");
    if (Number.isFinite(validAfter) && (!Number.isFinite(Number(auth.authTime)) || Number(auth.authTime) * 1000 < validAfter)) fail("unauthenticated", "Your session was reset. Sign in again to continue.");
    if (typeof auth.email !== "string" || email(current.email) !== email(auth.email)) fail("permission-denied", "Your account changed. Sign in again.");
    const result = { uid: current.uid, email: current.email, emailVerified: current.emailVerified === true, isAnonymous: false };
    if (recent) {
      if (!isClubAdmin(result) || !isClubAdmin(auth)) fail("permission-denied", "Only a current PoseTek administrator can make this change.");
      const age = now() - Number(auth.authTime) * 1000;
      if (!Number.isFinite(age) || age < -30000 || age > RECENT_AUTH_MS) fail("failed-precondition", "Sign in again to confirm your identity, then retry within five minutes.");
    }
    return result;
  }
  async function trustedAdmin(auth, data, confirmation = true) {
    const current = await actor(auth, true);
    if (confirmation && data?.identityConfirmed !== true) fail("invalid-argument", "Confirm the person's identity and account address before issuing access.");
    return current;
  }
  const recovery = createAccountRecovery({ db, authDirectory, HttpsError, actor, now });
  async function rate(rawRequest, auth, kind, limit) {
    let ip = rawRequest?.ip;
    if (typeof ip !== "string" || ip.length > 64 || !isIP(ip)) fail("failed-precondition", "This request could not be checked. Please try again.");
    ip = ip.toLowerCase();
    if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    const keys = [`ip:${ip}`];
    if (playerSegment(auth?.uid)) keys.push(`uid:${auth.uid}`);
    await db.runTransaction(async tx => {
      const refs = keys.map(key => db.collection("accountAccessRateLimits").doc(hash(`${kind}:${key}`)));
      const docs = await Promise.all(refs.map(ref => tx.get(ref)));
      const updates = docs.map(doc => {
        const d = doc.data();
        if (d && (!Number.isSafeInteger(d.count) || d.count < 0 || !Number.isSafeInteger(d.windowStartMillis) || d.windowStartMillis > now())) fail("resource-exhausted", "Account access is temporarily unavailable. Try again later.");
        const inWindow = d && now() - d.windowStartMillis < WINDOW_MS;
        const count = inWindow ? d.count : 0;
        if (count >= limit) fail("resource-exhausted", "Too many account access attempts. Try again in a few minutes.");
        const windowStartMillis = inWindow ? d.windowStartMillis : now();
        return { count: count + 1, windowStartMillis, expiresAt: new Date(windowStartMillis + WINDOW_MS) };
      });
      refs.forEach((ref, i) => tx.set(ref, updates[i]));
    });
  }
  async function findByEmail(address) {
    try { return await authDirectory.getUserByEmail(address); }
    catch (error) { if (error?.code === "auth/user-not-found") return null; throw error; }
  }
  async function assertUnlinked(uid) {
    const [directPlayer, players, aliasPlayers, coaches, directCoach, organizations] = await Promise.all([
      db.doc(`players/${uid}`).get(), db.collection("players").where("authenticationUID", "==", uid).limit(1).get(),
      db.collection("players").where("userUID", "==", uid).limit(1).get(), db.collection("coaches").where("userUID", "==", uid).limit(2).get(),
      db.doc(`coaches/${uid}`).get(), db.collection("organizations").where("memberUIDs", "array-contains", uid).limit(1).get(),
    ]);
    const coach = directCoach.data();
    if (directPlayer.exists || players.size || aliasPlayers.size || organizations.size || coaches.docs.some(doc => doc.id !== uid)
      || (coach && (coach.userUID !== uid || coach.organization || Object.hasOwn(coach, "organizationId") || coach.organizationCode || (coach.members || []).length))) {
      fail("failed-precondition", "This account is already linked to an athlete, roster or organization. Ask PoseTek to reconcile it.");
    }
  }
  async function prepareTarget(address, purpose, issuerUID) {
    const ref = targetRef(address);
    let user = await findByEmail(address);
    const existing = (await ref.get()).data();
    if (purpose === "account_recovery") {
      if (!user || user.disabled) fail("failed-precondition", "Recovery requires an existing enabled account. Disabled or missing accounts need PoseTek review.");
      return { user, accountMode: "existing", target: { targetUID: user.uid, email: address, authCreatedAt: creation(user) } };
    }
    if (user) {
      const prior = existing?.activeGrantId ? (await grantRef(existing.activeGrantId).get()).data() : null;
      const untouchedStaging = !prior || (["pending", "revoked"].includes(prior.status) && !prior.enableAttemptedAtMillis);
      if (user.disabled && !(existing?.provisionedByAccess === true && existing.targetUID === user.uid && existing.authCreatedAt === creation(user) && existing.state === "staged" && untouchedStaging)) fail("failed-precondition", "This disabled account needs PoseTek review.");
      await assertUnlinked(user.uid);
      return { user, accountMode: user.disabled ? "new" : "existing", target: { targetUID: user.uid, email: address, authCreatedAt: creation(user), ...(user.disabled ? { provisionedByAccess: true, state: "staged" } : {}) } };
    }
    // Reserve a UID before creating Auth. A collision never adopts another
    // account. The reserved disabled identity is retained for operator review.
    const uid = `access_${randomBytes(20).toString("hex")}`;
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists) fail("failed-precondition", "An earlier setup for this address needs PoseTek review.");
      tx.create(ref, { email: address, targetUID: uid, state: "provisioning", provisionedByAccess: true, createdByUID: issuerUID, createdAtMillis: now() });
    });
    try {
      user = await authDirectory.createUser({ uid, email: address, disabled: true, emailVerified: false });
      const target = { email: address, targetUID: uid, authCreatedAt: creation(user), state: "staged", provisionedByAccess: true };
      await ref.set(target, { merge: true });
      return { user, accountMode: "new", target };
    } catch (error) {
      await ref.set({ state: "blocked", failureAtMillis: now() }, { merge: true }).catch(() => {});
      fail("failed-precondition", "Account preparation could not be confirmed. Ask PoseTek to review this address before retrying.");
    }
  }
  function makeGrant(purpose, target, current, data) {
    const code = `ACCESS-${randomBytes(32).toString("hex").toUpperCase()}`;
    const id = hash(code);
    const grant = {
      schemaVersion: 1, purpose, status: "pending", targetUID: target.user.uid, email: email(target.user.email), authCreatedAt: creation(target.user),
      accountMode: target.accountMode, createdByUID: current.uid, createdAtMillis: now(), expiresAtMillis: now() + TTL[purpose],
      firstName: data.firstName || "", lastName: data.lastName || "", role: purpose === "internal_admin_activation" ? "admin" : purpose === "staff_activation" ? data.role : null,
      ...(purpose === "staff_activation" ? { organizationId: data.organizationId, teamIds: data.role === "manager" ? [] : [...new Set(data.teamIds || [])].sort() } : {}),
      ...(purpose !== "staff_activation" ? { identityConfirmedByUID: current.uid, identityConfirmedAtMillis: now(), verificationMethod: purpose === "internal_admin_activation" ? "posetek_admin_attestation" : "posetek_assisted_recovery" } : {}),
    };
    return { id, code, grant };
  }
  async function guardTarget(tx, bundle, replacementId = null) {
    const ref = targetRef(bundle.grant.email), doc = await tx.get(ref), target = doc.data();
    if (target && (target.targetUID !== bundle.grant.targetUID || (target.authCreatedAt && target.authCreatedAt !== bundle.grant.authCreatedAt))) fail("failed-precondition", "This address has a different account binding. Ask PoseTek to reconcile it.");
    let previous = null;
    if (target?.activeGrantId) previous = await tx.get(grantRef(target.activeGrantId));
    const old = previous?.data();
    const sameRecoveryScope = isClubAdmin(bundle.current) || !bundle.grant.recoveryScope || (old?.recoveryScope === bundle.grant.recoveryScope && old?.organizationId === bundle.grant.organizationId && old?.playerId === bundle.grant.playerId);
    const reviewedRecovery = bundle.grant.purpose === "account_recovery" && sameRecoveryScope && old?.status === "blocked" && Number.isFinite(old.failureAtMillis) && now() - old.failureAtMillis > OPERATION_QUIET_MS;
    if (old && ((!reviewedRecovery && ["consuming", "blocked"].includes(old.status)) || (old.status === "pending" && old.expiresAtMillis > now() && previous.id !== replacementId))) fail("already-exists", "This account already has an active or unfinished access link. Revoke or review it before issuing another.");
    if (replacementId && (!previous || previous.id !== replacementId || old.status !== "pending")) fail("failed-precondition", "That invitation cannot be replaced while activation is in progress.");
  }
  function writeGrant(tx, bundle, target, extra = {}, replacementId = null) {
    tx.create(grantRef(bundle.id), { ...bundle.grant, ...extra });
    tx.set(targetRef(bundle.grant.email), { ...target.target, activeGrantId: bundle.id, updatedAtMillis: now() }, { merge: true });
    tx.create(db.collection("accountAccessAudit").doc(), { action: "issued", grantId: bundle.id, purpose: bundle.grant.purpose, targetUID: bundle.grant.targetUID, email: bundle.grant.email, actorUID: bundle.grant.createdByUID, atMillis: now(), ...(bundle.grant.verificationMethod ? { verificationMethod: bundle.grant.verificationMethod } : {}), ...(bundle.grant.recoveryScope ? { recoveryScope: bundle.grant.recoveryScope, organizationId: bundle.grant.organizationId, playerId: bundle.grant.playerId, requestId: bundle.grant.requestId } : {}) });
    if (replacementId) tx.update(grantRef(replacementId), { status: "revoked", replacedByGrantId: bundle.id, revokedAtMillis: now(), revokedByUID: bundle.grant.createdByUID });
  }
  function issued(bundle, extra = {}) {
    return { grantId: bundle.id, code: bundle.code, activationUrl: `${origin}/join#accessCode=${bundle.code}`, expiresAtMillis: bundle.grant.expiresAtMillis, email: bundle.grant.email, accountMode: bundle.grant.accountMode, purpose: bundle.grant.purpose, ...extra };
  }
  async function issueStaffActivation(data, auth, replacement = null) {
    const current = await actor(auth);
    const address = email(data?.email);
    if (companyEmail(address)) fail("invalid-argument", "PoseTek company accounts use the separate internal administrator setup.");
    const scope = await clubs.validateStaffInvitation(data, current, replacement?.id);
    data = { ...data, firstName: name(data.firstName, "first name"), lastName: name(data.lastName, "last name") };
    const target = await prepareTarget(address, "staff_activation", current.uid);
    const bundle = makeGrant("staff_activation", target, current, data);
    const result = await clubs.createClubStaffInvitation({ ...data, activationMode: "manual" }, current, {
      targetUID: target.user.uid, grantId: bundle.id, replacementId: replacement?.id,
      beforeWrite: tx => guardTarget(tx, bundle, replacement?.grantId),
      write: (tx, extra) => writeGrant(tx, bundle, target, { ...extra, organizationName: scope.organizationName, teamNames: scope.teamNames }, replacement?.grantId),
    });
    return issued(bundle, { invitationId: result.invitationId });
  }
  async function replaceClubStaffInvitation(data, auth) {
    if (!playerSegment(data?.invitationId) || !playerSegment(data?.organizationId)) invalid();
    const old = (await db.doc(`clubStaffInvitations/${data.invitationId}`).get()).data();
    if (!old || old.organizationId !== data.organizationId) fail("failed-precondition", "That staff invitation could not be found.");
    return issueStaffActivation(old, auth, { id: data.invitationId, grantId: old.activationMode === "manual" ? old.grantId : null });
  }
  async function issueInternalAdminAccess(data, auth) {
    const current = await trustedAdmin(auth, data);
    const address = email(data?.email);
    if (!companyEmail(address)) fail("invalid-argument", "Internal administrators require an exact @posetek.net address.");
    const firstName = name(data?.firstName, "first name"), lastName = name(data?.lastName, "last name");
    const target = await prepareTarget(address, "internal_admin_activation", current.uid);
    if (target.user.emailVerified) fail("already-exists", "This account already has verified PoseTek administrator access. Use account recovery if needed.");
    const bundle = makeGrant("internal_admin_activation", target, current, { firstName, lastName });
    await db.runTransaction(async tx => { await guardTarget(tx, bundle); writeGrant(tx, bundle, target); });
    return issued(bundle);
  }
  async function issueAccountRecovery(data, auth) {
    const current = await trustedAdmin(auth, data);
    const address = email(data?.email);
    const target = await prepareTarget(address, "account_recovery", current.uid);
    const bundle = makeGrant("account_recovery", target, current, {});
    await db.runTransaction(async tx => { await guardTarget(tx, bundle); writeGrant(tx, bundle, target); });
    return issued(bundle);
  }
  async function issuePlayerRecovery(data, auth) {
    const { current, target } = await recovery.preparePlayerRecovery(data, auth);
    const bundle = makeGrant("account_recovery", target, current, {});
    Object.assign(bundle.grant, target.scope, { verificationMethod: "administrator_assisted_player_recovery" });
    bundle.current = current;
    let requestId;
    await db.runTransaction(async tx => {
      await recovery.validateGrantScope(bundle.grant, tx, current, target.user);
      await guardTarget(tx, bundle);
      const prepared = await recovery.prepareIssuedRequest(data, target, current, tx);
      requestId = prepared.ref.id;
      bundle.grant.requestId = requestId;
      writeGrant(tx, bundle, target);
      recovery.writeIssuedRequest(tx, prepared, target, current, bundle.id);
    });
    return issued(bundle, { ...target.scope, requestId });
  }
  function summary(id, g) {
    return { grantId: id, email: g.email, targetUID: g.targetUID, purpose: g.purpose, accountMode: g.accountMode, status: g.status === "pending" && g.expiresAtMillis <= now() ? "expired" : g.status, expiresAtMillis: g.expiresAtMillis, createdAtMillis: g.createdAtMillis, role: g.role, firstName: g.firstName || "", lastName: g.lastName || "", ...(g.recoveryScope ? { recoveryScope: g.recoveryScope, organizationId: g.organizationId, playerId: g.playerId, playerName: g.playerName, requestId: g.requestId, signInConfirmedAtMillis: g.signInConfirmedAtMillis || null } : {}) };
  }
  async function listAccountAccessLinks(data, auth) {
    const current = await actor(auth);
    if (isClubAdmin(current) && !isClubAdmin(auth)) fail("permission-denied", "Refresh your administrator sign-in before reviewing access.");
    let query = db.collection("accountAccessGrants");
    if (!isClubAdmin(current) || !isClubAdmin(auth)) {
      await recovery.manager(current, data?.organizationId);
      query = query.where("organizationId", "==", data.organizationId).where("recoveryScope", "==", recovery.SCOPE);
    }
    const docs = await query.orderBy("createdAtMillis", "desc").limit(100).get();
    const links = [];
    for (const doc of docs.docs) {
      if (!isClubAdmin(current) || !isClubAdmin(auth)) {
        if (doc.data().purpose !== "account_recovery") continue;
        try { await recovery.validateGrantScope(doc.data(), undefined, current); }
        catch (error) { if (["permission-denied", "failed-precondition", "not-found"].includes(error?.code)) continue; throw error; }
      }
      links.push(summary(doc.id, doc.data()));
    }
    return { links };
  }
  async function revokeAccountAccessLink(data, auth) {
    const current = await actor(auth);
    if (isClubAdmin(current) && !isClubAdmin(auth)) fail("permission-denied", "Refresh your administrator sign-in before changing access.");
    recovery.fresh(auth);
    const ref = grantRef(knownId(data?.grantId));
    await db.runTransaction(async tx => {
      const g = (await tx.get(ref)).data();
      if (!g) invalid();
      if (!isClubAdmin(current) || !isClubAdmin(auth)) {
        if (g.recoveryScope !== recovery.SCOPE || g.purpose !== "account_recovery") fail("permission-denied", "Only PoseTek can manage this access link.");
        await recovery.manager(current, g.organizationId, tx);
        await recovery.validateGrantScope(g, tx, current);
        if (data?.organizationId && data.organizationId !== g.organizationId) fail("permission-denied", "This access link belongs to another organization.");
      }
      if (g.status === "revoked") return;
      if (g.status !== "pending") fail("failed-precondition", "This setup has started. Review the account instead of revoking its old link.");
      let invite = null;
      if (g.invitationId) invite = await tx.get(db.doc(`clubStaffInvitations/${g.invitationId}`));
      if (invite && (invite.data()?.status !== "pending" || invite.data()?.grantId !== ref.id)) fail("failed-precondition", "This staff invitation needs review.");
      tx.update(ref, { status: "revoked", revokedAtMillis: now(), revokedByUID: current.uid });
      if (invite) {
        tx.update(invite.ref, { status: "revoked", revokedAt: stamp(), revokedByUID: current.uid });
        tx.update(db.doc(`organizations/${g.organizationId}/staffProfiles/${g.staffProfileId}`), { status: "revoked", updatedAt: stamp() });
      }
      tx.create(db.collection("accountAccessAudit").doc(), { action: "revoked", grantId: ref.id, actorUID: current.uid, targetUID: g.targetUID, atMillis: now() });
    });
    return { ok: true };
  }
  async function load(code) {
    const id = codeId(code), g = (await grantRef(id).get()).data();
    if (!g || !Object.hasOwn(TTL, g.purpose) || g.status === "revoked" || (g.status === "pending" && g.expiresAtMillis <= now())) invalid();
    const target = (await targetRef(g.email).get()).data();
    if (target?.activeGrantId !== id || target.targetUID !== g.targetUID || target.authCreatedAt !== g.authCreatedAt) invalid();
    return { id, g };
  }
  async function checkTarget(g) {
    const user = await getUser(g.targetUID);
    if (email(user.email) !== g.email || creation(user) !== g.authCreatedAt) fail("failed-precondition", "This account changed after the link was issued. Ask PoseTek for review.");
    if (g.accountMode === "new" ? !user.disabled : user.disabled) fail("failed-precondition", "This account's activation state changed. Try signing in or contact PoseTek.");
    if (g.purpose === "staff_activation" && companyEmail(user.email)) fail("permission-denied", "Company accounts cannot use staff activation.");
    if (g.purpose === "internal_admin_activation" && !companyEmail(user.email)) fail("permission-denied", "The attested company address no longer matches.");
    await recovery.validateGrantScope(g, undefined, undefined, user);
    return user;
  }
  async function checkIssuer(g) {
    const issuer = await getUser(g.createdByUID);
    if (issuer.disabled) fail("permission-denied", "The issuer no longer has permission. Ask PoseTek for a new link.");
    if (g.recoveryScope === recovery.SCOPE) { await recovery.validateGrantScope(g, undefined, issuer); return issuer; }
    if (isClubAdmin(issuer)) return issuer;
    if (g.purpose !== "staff_activation") fail("permission-denied", "The PoseTek administrator who issued this link is no longer authorized.");
    const member = (await db.doc(`organizations/${g.organizationId}/members/${issuer.uid}`).get()).data();
    if (!activeMember(member, issuer.uid) || member.role !== "manager") fail("permission-denied", "The organization manager who issued this link is no longer authorized.");
    return issuer;
  }
  async function getAccountAccessLink(data) {
    const { id, g } = await load(data?.code);
    if (g.status === "blocked" && !["password_applied", "membership_applied", "admin_attestation_applied", "enable_attempted", "account_enabled", "sessions_revoked"].includes(g.stage)) needsHelp();
    if (g.status === "pending") { await checkTarget(g); await checkIssuer(g); }
    return { grantId: id, ...(g.requestId ? { requestId: g.requestId, playerId: g.playerId } : {}), status: g.status === "pending" ? "ready" : g.status === "completed" ? "completed" : "processing", purpose: g.purpose, accountMode: g.accountMode, email: g.email, targetUID: g.targetUID, firstName: g.firstName || "", lastName: g.lastName || "", role: g.role, ...(g.organizationId ? { organizationId: g.organizationId, organizationName: g.organizationName || "", teamNames: g.teamNames || [] } : {}), expiresAtMillis: g.expiresAtMillis, requiresSignIn: g.status !== "pending" || (g.accountMode === "existing" && g.purpose !== "account_recovery") };
  }
  function result(g, id) {
    return { ...(id ? { grantId: id } : {}), ...(g.requestId ? { requestId: g.requestId, playerId: g.playerId } : {}), status: "completed", purpose: g.purpose, targetUID: g.targetUID, email: g.email, role: g.role, ...(g.organizationId ? { organizationId: g.organizationId, ...(g.teamIds ? { teamIds: g.teamIds } : {}) } : {}) };
  }
  async function finishGrant(id, g, acknowledgement = false) {
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(grantRef(id))).data();
      if (fresh?.status === "completed") return;
      if (!fresh || !(acknowledgement ? ["consuming", "blocked"] : ["consuming"]).includes(fresh.status)) needsHelp();
      await recovery.validateGrantScope(g, tx);
      tx.update(grantRef(id), { status: "completed", stage: "completed", completedAtMillis: now() });
      if (acknowledgement && g.accountMode === "new") tx.update(targetRef(g.email), { state: "activated", activatedAtMillis: now() });
      tx.create(db.collection("accountAccessAudit").doc(), { action: acknowledgement ? "completion_acknowledged" : "completed", grantId: id, purpose: g.purpose, targetUID: g.targetUID, atMillis: now(), ...(g.verificationMethod ? { verificationMethod: g.verificationMethod, confirmedByUID: g.createdByUID } : {}) });
    });
  }
  async function acknowledgeApplied(id, g, auth) {
    if (!auth || auth.uid !== g.targetUID || !["membership_applied", "admin_attestation_applied", "enable_attempted", "account_enabled", "sessions_revoked"].includes(g.stage)) needsHelp();
    const current = await actor(auth), user = await getUser(g.targetUID);
    if (email(current.email) !== g.email || creation(user) !== g.authCreatedAt) needsHelp();
    await recovery.validateGrantScope(g, undefined, undefined, user);
    if (g.purpose === "staff_activation") {
      const membership = (await db.doc(`organizations/${g.organizationId}/members/${g.targetUID}`).get()).data();
      const invite = (await db.doc(`clubStaffInvitations/${g.invitationId}`).get()).data();
      if (!activeMember(membership, g.targetUID) || membership.role !== g.role || membership.staffProfileId !== g.staffProfileId || invite?.claimedByUID !== g.targetUID || invite?.grantId !== id) needsHelp();
    } else if (g.purpose === "internal_admin_activation" && !isClubAdmin(current)) needsHelp();
    // This acknowledges durable side effects only; it cannot enable an account,
    // grant membership, set verification, revoke tokens or rewrite a password.
    await finishGrant(id, g, true);
    return result(g, id);
  }
  async function applyAfterPassword(id, g, user, issuer) {
    await recovery.validateGrantScope(g, undefined, issuer, user);
    if (g.purpose === "account_recovery") {
      if (g.stage !== "sessions_revoked") {
        await authDirectory.revokeRefreshTokens(g.targetUID);
        await grantRef(id).update({ stage: "sessions_revoked", sessionsRevokedAtMillis: now() });
      }
    } else if (g.purpose === "staff_activation") {
      await clubs.claimManualStaffInvitation(g.invitationId, { uid: g.targetUID, email: g.email, emailVerified: user.emailVerified, isAnonymous: false }, id, issuer);
      await grantRef(id).update({ stage: "membership_applied" });
    } else if (g.stage !== "admin_attestation_applied") {
      await checkTarget(g);
      await checkIssuer(g);
      await authDirectory.updateUser(g.targetUID, { emailVerified: true });
      await grantRef(id).update({ stage: "admin_attestation_applied" });
    }
    if (g.accountMode === "new") {
      // Enabling is also an external side effect. Never replay an uncertain
      // enable: an operator may have disabled the account after it succeeded.
      await checkTarget(g);
      await grantRef(id).update({ stage: "enable_attempted", enableAttemptedAtMillis: now() });
      await authDirectory.updateUser(g.targetUID, { disabled: false });
      await grantRef(id).update({ stage: "account_enabled", accountEnabledAtMillis: now() });
      await targetRef(g.email).update({ state: "activated", activatedAtMillis: now() });
    }
    await finishGrant(id, g);
    return result(g, id);
  }
  async function resumeApplied(id, g, auth) {
    // An enabled, signed-in recipient can acknowledge a lost final response.
    if (auth?.uid === g.targetUID) {
      const signedInUser = await getUser(g.targetUID);
      if (!signedInUser.disabled && ["membership_applied", "admin_attestation_applied", "enable_attempted", "account_enabled", "sessions_revoked"].includes(g.stage)) return acknowledgeApplied(id, g, auth);
    }
    if (g.status !== "blocked" || !["password_applied", "membership_applied", "admin_attestation_applied", "sessions_revoked"].includes(g.stage)) needsHelp();
    const user = await getUser(g.targetUID);
    if (email(user.email) !== g.email || creation(user) !== g.authCreatedAt || (g.accountMode === "existing" && user.disabled)) needsHelp();
    if (g.accountMode === "new" && !user.disabled) needsHelp();
    const issuer = await checkIssuer(g);
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(grantRef(id))).data(), target = (await tx.get(targetRef(g.email))).data();
      if (fresh?.status !== "blocked" || fresh.stage !== g.stage || target?.activeGrantId !== id) needsHelp();
      await recovery.validateGrantScope(g, tx, issuer, user);
      tx.update(grantRef(id), { status: "consuming", resumedAtMillis: now() });
    });
    try { return await applyAfterPassword(id, g, user, issuer); }
    catch {
      await grantRef(id).update({ status: "blocked", failureAtMillis: now() }).catch(() => {});
      needsHelp();
    }
  }
  async function completeAccountAccessLink(data, auth = null) {
    const { id, g } = await load(data?.code);
    if (g.status === "completed") return result(g, id); // Never rerun password/verification writes.
    if (g.status !== "pending") return resumeApplied(id, g, auth);
    const passwordWrite = g.accountMode === "new" || g.purpose === "account_recovery";
    if (passwordWrite) {
      if (typeof data?.password !== "string" || data.password.length < 8 || data.password.length > 128) fail("invalid-argument", "Choose a password between 8 and 128 characters.");
    } else {
      if (Object.hasOwn(data || {}, "password")) fail("invalid-argument", "An existing account must sign in. This link cannot change its password.");
      const current = await actor(auth);
      if (current.uid !== g.targetUID || email(current.email) !== g.email) fail("permission-denied", "Sign in to the exact account this link was issued for.");
    }
    const user = await checkTarget(g);
    const issuer = await checkIssuer(g);
    if (g.purpose !== "account_recovery") await assertUnlinked(g.targetUID);
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(grantRef(id))).data();
      const target = (await tx.get(targetRef(g.email))).data();
      if (fresh?.status !== "pending" || fresh.expiresAtMillis <= now() || target?.activeGrantId !== id || target.targetUID !== g.targetUID) invalid();
      await recovery.validateGrantScope(g, tx, issuer, user);
      tx.update(grantRef(id), { status: "consuming", stage: "reserved", consumingAtMillis: now() });
    });
    try {
      // Existing activation has no password write; recovery changes only password.
      if (passwordWrite) {
        await checkTarget(g);
        await authDirectory.updateUser(g.targetUID, { password: data.password });
        await grantRef(id).update({ stage: "password_applied", passwordAppliedAtMillis: now() });
      }
      return await applyAfterPassword(id, g, user, issuer);
    } catch (error) {
      // A timeout can mean Auth accepted the write. Do not clear consumption,
      // delete the identity, change its password again, or enable it on a retry.
      await grantRef(id).update({ status: "blocked", failureAtMillis: now() }).catch(() => {});
      needsHelp();
    }
  }
  async function confirmAccountRecovery(data, auth) {
    const current = await actor(auth), id = knownId(data?.grantId);
    recovery.fresh(auth);
    if (auth?.signInProvider !== "password") fail("failed-precondition", "Sign in with your new password to confirm recovery.");
    await db.runTransaction(async tx => {
      const g = (await tx.get(grantRef(id))).data();
      if (!g || g.purpose !== "account_recovery" || g.status !== "completed" || current.uid !== g.targetUID || email(current.email) !== g.email) fail("permission-denied", "Sign in to the account named on your recovery link.");
      const target = (await tx.get(targetRef(g.email))).data();
      if (target?.activeGrantId !== id || target.targetUID !== g.targetUID || target.authCreatedAt !== g.authCreatedAt) fail("failed-precondition", "Use your current recovery link to confirm sign-in.");
      const user = await getUser(g.targetUID);
      const stages = [g.passwordAppliedAtMillis, g.sessionsRevokedAtMillis, g.completedAtMillis];
      if (creation(user) !== g.authCreatedAt || !stages.every(Number.isFinite) || Number(auth.authTime) <= Math.floor(Math.max(...stages) / 1000)) fail("failed-precondition", "Sign in again with your new password to confirm recovery.");
      await recovery.validateGrantScope(g, tx, undefined, user);
      if (!g.signInConfirmedAtMillis) {
        tx.update(grantRef(id), { signInConfirmedAtMillis: now(), signInConfirmedByUID: current.uid });
        tx.create(db.collection("accountAccessAudit").doc(), { action: "sign_in_confirmed", grantId: id, purpose: g.purpose, targetUID: g.targetUID, actorUID: current.uid, atMillis: now() });
      }
    });
    return { confirmed: true, grantId: id };
  }
  return { rate, issueStaffActivation, replaceClubStaffInvitation, issueInternalAdminAccess, issueAccountRecovery, issuePlayerRecovery, inspectPlayerRecovery: recovery.inspectPlayerRecovery, submitAccountRecoveryRequest: recovery.submitAccountRecoveryRequest, listAccountRecoveryRequests: recovery.listAccountRecoveryRequests, updateAccountRecoveryRequest: recovery.updateAccountRecoveryRequest, confirmAccountRecovery, listAccountAccessLinks, revokeAccountAccessLink, getAccountAccessLink, completeAccountAccessLink };
}

module.exports = { createAccountAccess, ACCESS_CODE, TTL, RECENT_AUTH_MS };
