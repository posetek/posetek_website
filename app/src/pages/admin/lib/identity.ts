// Admin identity on the web — ADMIN_IDENTITY_CONTRACT.md §1 and §2.
//
// An Auth user is a PoseTek admin **if and only if** the ID token carries an
// email in the posetek.net domain AND `email_verified` is true. Nothing else
// confers admin: no custom claim, no allow-list document. `admins/{uid}` is a
// RECORD of the admin, never the source of admin-ness, so a failed write never
// blocks the shell.
//
// This client check exists to route the UI. **The rules are the boundary** —
// the identical predicate lives in docs/rules/admin.rules and
// docs/rules/storage.rules, and a client that merely believes it is an admin is
// denied by them.

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { db } from "../../../lib/firebase";
import { isAdminEmail } from "./adminEmail";

export { isAdminEmail };

export interface AdminIdentity {
  uid: string;
  email: string;
  displayName: string;
  /** The address is in the domain — true even when the address is unverified. */
  adminDomain: boolean;
  emailVerified: boolean;
  isAdmin: boolean;
}

/**
 * Re-read the user and force a token refresh before judging. A verification
 * completed in another browser tab is invisible to the cached user object and
 * to a cached ID token, so an admin who just verified would otherwise be told
 * to verify again (contract §1.2).
 */
export async function refreshAdminIdentity(user: any): Promise<AdminIdentity> {
  const uid = String(user?.uid || "");
  let claims: any = {};
  try {
    await user.reload();
    const token = await user.getIdTokenResult(true);
    if (firebase.auth().currentUser?.uid === uid && (!token?.claims?.sub || token.claims.sub === uid)) {
      claims = token?.claims || {};
    }
  } catch {
    // A cached verification flag cannot authorize a freshly activated account.
    // The next sign-in retries authoritative refresh without sending email.
  }
  const current = user;
  const email = String(claims.email ?? current?.email ?? "").trim().toLowerCase();
  const emailVerified = typeof claims.email === "string" && claims.email_verified === true;
  const adminDomain = isAdminEmail(email);
  return {
    uid,
    email,
    displayName: String(current?.displayName || email.split("@")[0] || "Admin"),
    adminDomain,
    emailVerified,
    isAdmin: adminDomain && emailVerified,
  };
}

// MARK: - admins/{uid} (§2.1)

export const ADMIN_CLIENT_VERSION = "web 2026-09-05";

/**
 * Upsert the admin's profile record. `createdAt` is written once; every later
 * sign-in only bumps `lastSignInAt`. Never throws into the caller — the shell
 * renders whether or not this lands (a record, not an authority).
 */
export async function upsertAdminProfile(identity: AdminIdentity): Promise<void> {
  if (!identity.isAdmin || !identity.uid) return;
  const ref = db.collection("admins").doc(identity.uid);
  const base = {
    schemaVersion: 1,
    uid: identity.uid,
    email: identity.email,
    displayName: identity.displayName,
    lastSignInAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastClient: { platform: "web", version: ADMIN_CLIENT_VERSION },
  };
  try {
    const existing = await ref.get();
    if (existing.exists) await ref.set(base, { merge: true });
    else await ref.set({ ...base, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (error) {
    console.warn("[admin] admins/{uid} upsert failed — the admin shell is unaffected", error);
  }
}
