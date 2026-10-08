"use strict";

const crypto = require("node:crypto");
const { isClubAdmin, activeMember } = require("./club-access");
const { playerSegment } = require("./athlete-storage-paths");

const REQUEST_RETENTION_MS = 90 * 86400000;
const REQUEST_WINDOW_MS = 3600000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SCOPE = "organization_player";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const company = value => /^[a-z0-9._%+-]+@posetek\.net$/i.test(value || "");

// Requests contain unverified contact claims. Only the exact current Auth email
// and a unique canonical player binding can route a request to an organization.
// Neither a public request nor a copied link is evidence of identity or sign-in.
function createAccountRecovery({ db, authDirectory, HttpsError, actor, now = Date.now }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const requestRef = id => db.collection("accountRecoveryRequests").doc(id);
  const id = value => { if (!playerSegment(value)) fail("invalid-argument", "Choose an organization and player."); return value; };
  const requestId = value => { if (typeof value !== "string" || !UUID.test(value)) fail("invalid-argument", "Use a valid recovery request reference."); return value.toLowerCase(); };
  const address = value => {
    const result = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (result.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result)) fail("invalid-argument", "Enter your account email address.");
    return result;
  };
  const text = (value, limit) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f]/.test(value) || /ACCESS-[a-f0-9]{64}/i.test(value)) fail("invalid-argument", "Check your recovery request details. Do not include passwords or private links.");
    return value.trim();
  };
  const read = (ref, tx) => tx ? tx.get(ref) : ref.get();
  async function caller(auth) {
    const current = await actor(auth);
    if (isClubAdmin(current) && !isClubAdmin(auth)) fail("permission-denied", "Refresh your administrator sign-in before managing recovery.");
    return current;
  }
  function fresh(auth) {
    const age = now() - Number(auth?.authTime) * 1000;
    if (!Number.isFinite(age) || age < -30000 || age > 300000) fail("failed-precondition", "Sign in again to confirm your identity, then retry within five minutes.");
  }
  async function authority(current, organizationId, tx) {
    const org = await read(db.doc(`organizations/${id(organizationId)}`), tx);
    if (!org.exists || org.data().schemaVersion !== 2) fail("failed-precondition", "This organization needs PoseTek account review.");
    if (!isClubAdmin(current)) {
      const member = (await read(org.ref.collection("members").doc(current.uid), tx)).data();
      if (!activeMember(member, current.uid) || member.role !== "manager") fail("permission-denied", "An active administrator of this organization must make this change.");
    }
    return org;
  }
  async function assertPlayerOnly(uid, user, tx) {
    if (company(user.email)) fail("failed-precondition", "This account requires PoseTek staff recovery.");
    if (!Array.isArray(user.providerData) || !user.providerData.some(provider => provider?.providerId === "password")) fail("failed-precondition", "Use this account's original sign-in method or ask PoseTek to review recovery.");
    const [directCoach, coaches, memberships] = await Promise.all([
      read(db.doc(`coaches/${uid}`), tx), read(db.collection("coaches").where("userUID", "==", uid).limit(2), tx),
      read(db.collectionGroup("members").where("userUID", "==", uid).limit(2), tx),
    ]);
    if (directCoach.exists || coaches.size || memberships.size) {
      fail("failed-precondition", "This account has staff access and requires PoseTek recovery.");
    }
  }
  async function uniquePlayer(uid, tx) {
    const [first, second, direct] = await Promise.all([
      read(db.collection("players").where("authenticationUID", "==", uid).limit(2), tx),
      read(db.collection("players").where("userUID", "==", uid).limit(2), tx), read(db.doc(`players/${uid}`), tx),
    ]);
    const found = new Map([...first.docs, ...second.docs, ...(direct.exists ? [direct] : [])].map(doc => [doc.id, doc]));
    if (found.size !== 1) fail("failed-precondition", "This player's account link needs PoseTek review.");
    const doc = [...found.values()][0], player = doc.data();
    const fields = ["authenticationUID", "userUID"].filter(field => Object.hasOwn(player, field));
    if (!fields.length || fields.some(field => player[field] !== uid || !playerSegment(player[field]))) fail("failed-precondition", "This player's account link needs PoseTek review.");
    return doc;
  }
  async function playerTarget(data, current, tx, userOverride) {
    const organizationId = id(data?.organizationId), playerId = id(data?.playerId);
    const org = await authority(current, organizationId, tx);
    const doc = await read(db.doc(`players/${playerId}`), tx), player = doc.data();
    if (!player || player.organizationId !== organizationId) fail("permission-denied", "This player is not in your organization.");
    const fields = ["authenticationUID", "userUID"].filter(field => Object.hasOwn(player, field));
    const uid = fields.length ? player[fields[0]] : null;
    if (!playerSegment(uid) || fields.some(field => player[field] !== uid)) fail("failed-precondition", "This player must have one confirmed account link. Ask PoseTek to review it.");
    if ((await uniquePlayer(uid, tx)).id !== playerId) fail("failed-precondition", "This player's account link needs PoseTek review.");
    let user;
    try { user = userOverride?.uid === uid ? userOverride : await authDirectory.getUser(uid); }
    catch (error) { if (error?.code === "auth/user-not-found") fail("failed-precondition", "This account needs PoseTek review."); throw error; }
    if (user.disabled || !user.email || !Number.isFinite(Date.parse(user.metadata?.creationTime))) fail("failed-precondition", "This account needs PoseTek review.");
    await assertPlayerOnly(uid, user, tx);
    return { user, accountMode: "existing", target: { targetUID: uid, email: address(user.email), authCreatedAt: user.metadata.creationTime },
      scope: { recoveryScope: SCOPE, playerId, organizationId, playerName: [player.firstName, player.lastName].filter(Boolean).join(" ").trim() || player.name || "Player", organizationName: String(org.data().name || "Organization") } };
  }
  async function inspectPlayerRecovery(data, auth) {
    const current = await caller(auth), target = await playerTarget(data, current);
    return { ...target.scope, targetUID: target.user.uid, email: target.target.email, recoverable: true };
  }
  async function preparePlayerRecovery(data, auth) {
    const current = await caller(auth); fresh(auth);
    if (data?.identityConfirmed !== true) fail("invalid-argument", "Confirm the player's identity and account before issuing recovery.");
    return { current, target: await playerTarget(data, current) };
  }
  async function validateGrantScope(g, tx, issuerOverride, userOverride) {
    if (g.recoveryScope !== SCOPE) return;
    const issuer = issuerOverride || await authDirectory.getUser(g.createdByUID);
    if (issuer.disabled) fail("permission-denied", "The recovery issuer is no longer authorized.");
    const target = await playerTarget(g, issuer, tx, userOverride);
    if (target.user.uid !== g.targetUID || target.target.email !== g.email || target.target.authCreatedAt !== g.authCreatedAt) fail("failed-precondition", "This player's account changed. Ask an administrator to review recovery.");
  }
  async function manager(current, organizationId, tx) {
    if (isClubAdmin(current)) return;
    await authority(current, organizationId, tx);
  }
  async function prepareIssuedRequest(data, target, current, tx) {
    const key = data?.requestId ? requestId(data.requestId) : crypto.randomUUID(), ref = requestRef(key);
    const previous = data?.requestId ? (await tx.get(ref)).data() : null;
    if (data?.requestId && (!previous || previous.expiresAtMillis <= now())) fail("failed-precondition", "This recovery request expired. Start a new request.");
    if (previous?.grantId && (previous.organizationId !== target.scope.organizationId || previous.playerId !== target.scope.playerId || previous.targetUID !== target.user.uid || previous.accountEmail !== target.target.email)) fail("failed-precondition", "An issued recovery request cannot be attached to a different account.");
    if (previous && !isClubAdmin(current) && (previous.organizationId !== target.scope.organizationId || previous.playerId !== target.scope.playerId || previous.targetUID !== target.user.uid || previous.accountEmail !== target.target.email)) fail("permission-denied", "This request requires PoseTek review.");
    return { ref, request: previous || { schemaVersion: 1, requestId: key, source: "administrator", claimedName: target.scope.playerName, claimedEmail: target.target.email, claimedOrganizationName: target.scope.organizationName, contact: "", identityVerified: false, handlingStatus: "in_review", createdAtMillis: now(), expiresAtMillis: now() + REQUEST_RETENTION_MS, expiresAt: new Date(now() + REQUEST_RETENTION_MS) } };
  }
  function writeIssuedRequest(tx, prepared, target, current, grantId) {
    const request = { ...prepared.request, ...target.scope, targetUID: target.user.uid, accountEmail: target.target.email, grantId, handlingStatus: "in_review", updatedAtMillis: Math.max(now(), (prepared.request.updatedAtMillis || 0) + 1), updatedByUID: current.uid, linkCreatedAtMillis: now(), linkSharedAtMillis: null, note: prepared.request.note || "" };
    tx.set(prepared.ref, request);
    return prepared.ref.id;
  }
  function requestRow(doc, grant) {
    const r = doc.data(), expired = r.expiresAtMillis <= now();
    const grantStatus = grant?.status === "pending" && grant.expiresAtMillis <= now() ? "expired" : grant?.status || null;
    let status = r.handlingStatus || "new";
    if (!["closed", "needs_review"].includes(status) && !expired && grant) status = grant.signInConfirmedAtMillis ? "confirmed" : grantStatus === "completed" ? "reset_completed" : grantStatus === "blocked" ? "needs_review" : grantStatus === "consuming" ? "processing" : grantStatus === "pending" ? r.linkSharedAtMillis ? "link_shared" : "link_ready" : grantStatus;
    if (expired) status = "expired";
    return { requestId: doc.id, status, handlingStatus: r.handlingStatus || "new", identityVerified: false, claimedName: r.claimedName, claimedEmail: r.claimedEmail, claimedOrganizationName: r.claimedOrganizationName, contact: r.contact || "", organizationId: r.organizationId || null, organizationName: r.organizationName || null, playerId: r.playerId || null, playerName: r.playerName || null, accountEmail: r.accountEmail || null, targetUID: r.targetUID || null, grantId: r.grantId || null, grantStatus, createdAtMillis: r.createdAtMillis, updatedAtMillis: r.updatedAtMillis, expiresAtMillis: r.expiresAtMillis, linkCreatedAtMillis: r.linkCreatedAtMillis || null, linkSharedAtMillis: r.linkSharedAtMillis || null, passwordUpdatedAtMillis: grant?.passwordAppliedAtMillis || null, signInConfirmedAtMillis: grant?.signInConfirmedAtMillis || null, note: r.note || "" };
  }
  async function routeClaim(email) {
    try {
      const user = await authDirectory.getUserByEmail(email);
      if (user.disabled || address(user.email) !== email) return {};
      const doc = await uniquePlayer(user.uid), player = doc.data();
      await assertPlayerOnly(user.uid, user);
      if (!playerSegment(player.organizationId)) return {};
      const org = await db.doc(`organizations/${player.organizationId}`).get();
      if (!org.exists || org.data().schemaVersion !== 2) return {};
      return { organizationId: org.id, organizationName: String(org.data().name || "Organization"), playerId: doc.id, playerName: [player.firstName, player.lastName].filter(Boolean).join(" ").trim() || player.name || "Player", targetUID: user.uid, accountEmail: email };
    } catch { return {}; } // Intake remains available; unresolved claims go only to PoseTek.
  }
  async function submitAccountRecoveryRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["requestId", "email", "name", "organizationName", "contact"].includes(key)) || Buffer.byteLength(JSON.stringify(input), "utf8") > 4096) fail("invalid-argument", "Check your recovery request details.");
    const key = requestId(input.requestId), email = address(input.email), claims = { claimedEmail: email, claimedName: text(input.name, 100), claimedOrganizationName: text(input.organizationName, 100), contact: text(input.contact, 300) };
    const fingerprint = hash(JSON.stringify(claims)), ref = requestRef(key), route = await routeClaim(email);
    await db.runTransaction(async tx => {
      const previous = (await tx.get(ref)).data();
      if (previous) {
        if (previous.inputFingerprint !== fingerprint || previous.expiresAtMillis <= now()) fail("already-exists", "This request reference has already been used. Start a new request.");
        return;
      }
      const window = Math.floor(now() / REQUEST_WINDOW_MS), emailLimit = db.doc(`accountRecoveryRequestRateLimits/${hash(`email:${window}:${email}`)}`), globalLimit = db.doc(`accountRecoveryRequestRateLimits/global-${window}`);
      const [emailDoc, globalDoc] = await Promise.all([tx.get(emailLimit), tx.get(globalLimit)]);
      const counts = [emailDoc, globalDoc].map(doc => doc.exists ? doc.data().count : 0);
      if (counts.some(count => !Number.isSafeInteger(count) || count < 0) || counts[0] >= 3 || counts[1] >= 1000) fail("resource-exhausted", "Too many recovery requests. Please try again later.");
      const expiresAt = new Date((window + 2) * REQUEST_WINDOW_MS);
      tx.set(emailLimit, { count: counts[0] + 1, expiresAt }); tx.set(globalLimit, { count: counts[1] + 1, expiresAt });
      tx.create(ref, { schemaVersion: 1, requestId: key, source: "public", ...claims, ...route, identityVerified: false, inputFingerprint: fingerprint, handlingStatus: "new", createdAtMillis: now(), updatedAtMillis: now(), expiresAtMillis: now() + REQUEST_RETENTION_MS, expiresAt: new Date(now() + REQUEST_RETENTION_MS), note: "" });
      tx.create(db.collection("accountAccessAudit").doc(), { action: "recovery_requested", requestId: key, targetUID: route.targetUID || null, organizationId: route.organizationId || null, atMillis: now() });
    });
    return { accepted: true, requestId: key };
  }
  async function requestAuthority(r, current, tx) {
    if (isClubAdmin(current)) return;
    if (!r.organizationId || !r.playerId || !r.targetUID) fail("permission-denied", "This request requires PoseTek review.");
    const target = await playerTarget(r, current, tx);
    if (target.user.uid !== r.targetUID || target.target.email !== r.accountEmail) fail("permission-denied", "This request requires PoseTek review.");
  }
  async function listAccountRecoveryRequests(data, auth) {
    const current = await caller(auth), organizationId = data?.organizationId;
    if (!isClubAdmin(current) && !organizationId) fail("permission-denied", "Choose your organization.");
    if (organizationId) await authority(current, organizationId);
    if (data?.requestId) {
      const doc = await requestRef(requestId(data.requestId)).get(), r = doc.data();
      if (!r || r.expiresAtMillis <= now() || (organizationId && r.organizationId !== organizationId)) return { requests: [], nextCursor: null };
      await requestAuthority(r, current);
      const grant = r.grantId ? (await db.doc(`accountAccessGrants/${r.grantId}`).get()).data() : null;
      return { requests: [requestRow(doc, grant)], nextCursor: null };
    }
    let query = db.collection("accountRecoveryRequests");
    if (organizationId) query = query.where("organizationId", "==", organizationId);
    query = query.orderBy("createdAtMillis", "desc").orderBy("__name__", "desc");
    if (data?.cursor) {
      if (!Number.isSafeInteger(data.cursor.at) || data.cursor.at < 0) fail("invalid-argument", "Choose a valid recovery page.");
      query = query.startAfter(data.cursor.at, requestId(data.cursor.id));
    }
    const docs = await query.limit(51).get(), rows = [];
    for (const doc of docs.docs.slice(0, 50)) {
      const r = doc.data();
      if (r.expiresAtMillis <= now()) continue;
      if (!isClubAdmin(current)) { try { await requestAuthority(r, current); } catch (error) { if (["permission-denied", "failed-precondition", "not-found"].includes(error?.code)) continue; throw error; } }
      const grant = r.grantId ? (await db.doc(`accountAccessGrants/${r.grantId}`).get()).data() : null;
      rows.push(requestRow(doc, grant));
    }
    const last = docs.docs.slice(0, 50).at(-1);
    return { requests: rows, nextCursor: docs.size > 50 ? { at: last.data().createdAtMillis, id: last.id } : null };
  }
  async function updateAccountRecoveryRequest(data, auth) {
    const current = await caller(auth), ref = requestRef(requestId(data?.requestId));
    if (!Number.isSafeInteger(data?.expectedUpdatedAtMillis) || !["in_review", "needs_review", "closed", "link_shared"].includes(data?.status)) fail("invalid-argument", "Choose a valid recovery status.");
    const note = text(data.note, 1000);
    await db.runTransaction(async tx => {
      const r = (await tx.get(ref)).data();
      if (!r || r.expiresAtMillis <= now()) fail("not-found", "This recovery request is no longer available.");
      await requestAuthority(r, current, tx);
      if (data.organizationId && data.organizationId !== r.organizationId && !(isClubAdmin(current) && data.playerId && !r.grantId)) fail("permission-denied", "This request belongs to another organization.");
      if (r.updatedAtMillis !== data.expectedUpdatedAtMillis) fail("aborted", "This request changed. Refresh it before updating.");
      let target = null;
      if (data.playerId) {
        if (!isClubAdmin(current)) fail("permission-denied", "PoseTek must review an unresolved account match.");
        target = await playerTarget(data, current, tx);
        if (r.grantId && (target.scope.organizationId !== r.organizationId || target.scope.playerId !== r.playerId || target.user.uid !== r.targetUID || target.target.email !== r.accountEmail)) fail("failed-precondition", "An issued recovery request cannot be attached to a different account.");
      }
      const grant = r.grantId ? (await tx.get(db.doc(`accountAccessGrants/${r.grantId}`))).data() : null;
      if (data.status === "link_shared" && (!grant || grant.status !== "pending" || grant.expiresAtMillis <= now())) fail("failed-precondition", "Only an unused, current recovery link can be marked shared.");
      tx.update(ref, { ...(target ? { ...target.scope, targetUID: target.user.uid, accountEmail: target.target.email } : {}), ...(data.status === "link_shared" ? { linkSharedAtMillis: now() } : { handlingStatus: data.status }), note: data.note === undefined ? r.note || "" : note, updatedByUID: current.uid, updatedAtMillis: Math.max(now(), r.updatedAtMillis + 1) });
      tx.create(db.collection("accountAccessAudit").doc(), { action: data.status === "link_shared" ? "recovery_link_shared" : "recovery_request_updated", requestId: ref.id, targetUID: target?.user.uid || r.targetUID || null, organizationId: target?.scope.organizationId || r.organizationId || null, actorUID: current.uid, status: data.status, atMillis: now() });
    });
    const doc = await ref.get(), grant = doc.data().grantId ? (await db.doc(`accountAccessGrants/${doc.data().grantId}`).get()).data() : null;
    return { request: requestRow(doc, grant) };
  }
  return { inspectPlayerRecovery, preparePlayerRecovery, validateGrantScope, manager, prepareIssuedRequest, writeIssuedRequest, submitAccountRecoveryRequest, listAccountRecoveryRequests, updateAccountRecoveryRequest, requestRow, fresh, SCOPE };
}

module.exports = { createAccountRecovery, REQUEST_RETENTION_MS, REQUEST_WINDOW_MS, SCOPE };
