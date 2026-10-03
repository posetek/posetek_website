"use strict";
const crypto = require("node:crypto");
const UID = /^[A-Za-z0-9_-]{1,160}$/, EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const TTL_MS = 24 * 3600000, RETRY_MS = 15 * 60000, PAGE_SIZE = 20;
const clean = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200)
  .replace(/(?:Bearer\s+\S+|\b(?:re_|whsec_)[A-Za-z0-9_+/=-]{12,})/gi, "[credential]")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]") : "";
const email = value => typeof value === "string" && value.length <= 320 && EMAIL.test(value) ? value : null;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function tokenSnapshot(auth, at) {
  if (!UID.test(auth?.uid || "")) return null;
  return { schemaVersion: 1, uid: auth.uid, source: "authenticated_token", name: clean(auth.displayName) || null,
    email: email(auth.email), emailVerified: auth.emailVerified === true, observedAtMillis: at };
}
function validContact(value, uid) {
  return Boolean(value?.schemaVersion === 1 && value.uid === uid && UID.test(uid || "") && value.source === "firebase_admin_auth"
    && Number.isSafeInteger(value.observedAtMillis) && value.observedAtMillis > 0 && (value.email === null || email(value.email))
    && typeof value.emailVerified === "boolean" && (value.name === null || typeof value.name === "string" && value.name === clean(value.name)));
}
function contactText(value, uid) {
  if (!validContact(value, uid)) return "Unavailable; exact account lookup is pending or no authenticated actor was recorded";
  return `${value.email || "No contact email on the exact Auth account"}${value.email ? ` (email ${value.emailVerified ? "verified" : "unverified"})` : ""}; current Auth lookup ${new Date(value.observedAtMillis).toISOString()}`;
}
function occurrenceContactSnapshot(event) {
  const uid = UID.test(event?.reporterUid || "") ? event.reporterUid : null;
  return { schemaVersion: 1, actorUid: uid, currentContact: validContact(event?.currentContact, uid) ? event.currentContact : null,
    lookup: event?.contactLookup ? { status: event.contactLookup.status, code: event.contactLookup.code || null, checkedAtMillis: event.contactLookup.checkedAtMillis } : null,
    authenticatedSnapshot: event?.authenticatedSnapshot?.uid === uid && event.authenticatedSnapshot.source === "authenticated_token" ? event.authenticatedSnapshot : null,
    player: event?.player || null, reporterOnly: /failureCases|fieldReports|system_diagnostic/i.test(`${event?.source} ${event?.code}`), operation: event?.operation || "unknown" };
}
/** Server-owned enrichment. Intake never fails because Auth lookup failed.
 * Prior successful contact evidence survives a failed retry; failure means the
 * displayed contact is a last verified lookup, not confirmation of currency.
 * This record never substitutes the target athlete for the reporting account.
 */
function createIssueContactEnrichment({ db, auth, now = Date.now }) {
  async function resolve(uid, { force = false } = {}) {
    if (!UID.test(uid || "")) return { contact: null, lookup: { status: "unknown_actor", retryAfterMillis: null } };
    const ref = db.doc(`userIssueContacts/${hash(uid)}`), old = (await ref.get()).data();
    if (old?.uid && old.uid !== uid) throw new Error("user_issue_contact_uid_conflict");
    const prior = validContact(old?.contact, uid) ? old.contact : null;
    if (!force && old?.retryAfterMillis > now()) return { contact: prior, lookup: old.lookup };
    let contact, code = null;
    try {
      if (typeof auth?.getUser !== "function") throw new Error("unavailable");
      let timer;
      const user = await Promise.race([auth.getUser(uid), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("lookup_timeout")), 5000); })]).finally(() => clearTimeout(timer));
      if (user?.uid !== uid) throw new Error("uid_mismatch");
      contact = { schemaVersion: 1, uid, source: "firebase_admin_auth", name: clean(user.displayName) || null,
        email: email(user.email), emailVerified: user.emailVerified === true, observedAtMillis: now(), disabled: user.disabled === true };
    } catch (error) { code = error?.code === "auth/user-not-found" ? "account_not_found" : "lookup_unavailable"; }
    return db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.uid && current.uid !== uid) throw new Error("user_issue_contact_uid_conflict");
      const saved = validContact(current?.contact, uid) ? current.contact : prior;
      // A slower failed lookup must not erase another invocation's success.
      const chosen = contact && (!saved || saved.observedAtMillis <= contact.observedAtMillis) ? contact : saved || null;
      const lookup = { status: code ? "failed" : "verified", code, checkedAtMillis: now() };
      tx.set(ref, { schemaVersion: 1, uid, contact: chosen, lookup, retryAfterMillis: now() + (code ? RETRY_MS : TTL_MS) });
      return { contact: chosen, lookup };
    });
  }
  async function enrichOccurrence(id, options) {
    if (!/^[a-f0-9]{64}$/.test(id || "")) throw new Error("user_issue_contact_invalid_occurrence");
    const ref = db.doc(`userIssueOccurrences/${id}`), event = (await ref.get()).data();
    if (!event) return { skipped: "missing_occurrence" };
    const uid = event.reporterUid;
    if (!UID.test(uid || "")) return { skipped: "unknown_actor" };
    const result = await resolve(uid, options);
    return db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current || current.reporterUid !== uid) throw new Error("user_issue_contact_occurrence_changed");
      const next = { currentContact: result.contact, contactLookup: result.lookup };
      if (JSON.stringify(current.currentContact || null) === JSON.stringify(next.currentContact) && JSON.stringify(current.contactLookup || null) === JSON.stringify(next.contactLookup)) return { changed: false };
      tx.update(ref, next); return { changed: true, lookupStatus: result.lookup.status };
    });
  }
  async function reconcile() {
    const settings = (await db.doc("issueTrackerSettings/current").get()).data();
    if (settings?.enabled !== true || settings.sourceRecoveryEnabled !== true) return { skipped: "not_configured" };
    const stateRef = db.doc("issueTrackerState/contactRecovery"), state = (await stateRef.get()).data() || {};
    let query = db.collection("userIssueOccurrences").orderBy("__name__").limit(PAGE_SIZE);
    if (state.cursor) query = query.startAfter(state.cursor);
    const page = await query.get(); let changed = 0;
    for (const doc of page.docs) if ((await enrichOccurrence(doc.id)).changed) changed++;
    await stateRef.set({ schemaVersion: 1, cursor: page.size < PAGE_SIZE ? null : page.docs.at(-1).id,
      lastCheckedAtMillis: now(), examined: page.size, changed, enumerationComplete: page.size < PAGE_SIZE,
      sourceCompleteThroughAdvanced: false, publicationConfirmed: false });
    return { examined: page.size, changed, sourceCompleteThroughAdvanced: false };
  }
  return { resolve, enrichOccurrence, reconcile };
}
module.exports = { createIssueContactEnrichment, tokenSnapshot, occurrenceContactSnapshot, validContact, contactText, email, UID, TTL_MS, RETRY_MS, PAGE_SIZE };
