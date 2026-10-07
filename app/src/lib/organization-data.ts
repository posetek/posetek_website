/* eslint-disable @typescript-eslint/no-explicit-any */
import { auth, cloud, db } from "./firebase";
import { inFlightRequests } from "./inflightRequests";
import { membershipFrom, strings, visibleTeams } from "./organization";
import type { ClubAccess, ClubMembership, ClubOrganization, ClubTeam } from "./organization";
export async function clubCall<T = any>(name: string, data: Record<string, unknown>): Promise<T> {
  const result = await cloud.httpsCallable(name)(data);
  return result.data as T;
}
export async function loadClubAccess(uid: string): Promise<ClubAccess[]> {
  const organizations = await db.collection("organizations").where("memberUIDs", "array-contains", uid).get();
  const access = await Promise.all(organizations.docs.map(async doc => {
    const member = await doc.ref.collection("members").doc(uid).get();
    const membership = member.exists ? membershipFrom(uid, doc.id, member.data() || {}) : null;
    return membership ? { organization: { id: doc.id, name: String(doc.data().name || "Organization"), schemaVersion: Number(doc.data().schemaVersion || 0) }, membership } : null;
  }));
  return access.filter((item): item is ClubAccess => item !== null);
}
export async function loadClubMembership(uid: string, organizationId: string): Promise<ClubMembership | null> {
  try {
    const doc = await db.collection("organizations").doc(organizationId).collection("members").doc(uid).get();
    return doc.exists ? membershipFrom(uid, organizationId, doc.data() || {}) : null;
  } catch (error: any) {
    if (error?.code === "permission-denied") return null;
    throw error;
  }
}
export async function loadClubOrganizations(): Promise<ClubOrganization[]> {
  const result = await db.collection("organizations").where("schemaVersion", "==", 2).get();
  return result.docs.map(doc => ({ id: doc.id, name: String(doc.data().name || "Organization"), schemaVersion: 2 }));
}
export function teamFrom(doc: any): ClubTeam {
  const data = doc.data() || {};
  return { id: doc.id, organizationId: String(data.organizationId || ""), name: String(data.name || "Team"), coachUIDs: strings(data.coachUIDs), playerIds: strings(data.playerIds) };
}
export async function loadClubTeams(organizationId: string, access?: ClubAccess): Promise<ClubTeam[]> {
  // Coaches fetch only named teams. A collection query over the whole club
  // would be denied: Firestore rules do not filter inaccessible rows.
  const teams = access?.membership.role === "coach"
    ? (await Promise.all(access.membership.teamIds.map(id => db.collection("teams").doc(id).get()))).filter(doc => doc.exists).map(teamFrom)
    : (await db.collection("teams").where("organizationId", "==", organizationId).get()).docs.map(teamFrom);
  return (access ? visibleTeams(teams, access) : teams).sort((a, b) => a.name.localeCompare(b.name));
}
export async function loadClubPlayers(team: ClubTeam): Promise<any[]> {
  const docs = await Promise.all(team.playerIds.map(id => db.collection("players").doc(id).get()));
  return docs.filter(doc => doc.exists && doc.data()?.organizationId === team.organizationId && doc.data()?.teamId === team.id)
    .map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => String(a.firstName || "").localeCompare(String(b.firstName || "")));
}
export async function loadClubMembers(organizationId: string): Promise<ClubMembership[]> {
  const docs = await db.collection("organizations").doc(organizationId).collection("members").get();
  return docs.docs.map(doc => membershipFrom(doc.id, organizationId, doc.data())).filter((item): item is ClubMembership => item !== null);
}
export interface ClubContext {
  role: "admin" | "manager" | "coach" | "player" | "none";
  organizations: ClubOrganization[];
  organization: ClubOrganization | null;
  teams: ClubTeam[];
  staff: { userUID: string; email: string; firstName: string; lastName: string; role: "manager" | "coach"; teamIds: string[]; status: string }[];
  invitations: { id: string; email: string; firstName: string; lastName: string; role: "manager" | "coach"; teamIds: string[]; status: string; expiresAtMillis: number; activationMode?: "manual" | "verified_email"; activationStatus?: "pending" | "consuming" | "completed" | "revoked" | "blocked" | "expired" }[];
  players: { id: string; firstName: string; lastName: string; organizationId: string; teamId: string; canIssueSignupCode: boolean }[];
}
export function getClubContext(organizationId?: string): Promise<ClubContext> {
  // Auth can be restored before this module's first reader subscribes. Treat
  // the subscription's initial callback as the current identity, not a switch.
  const currentUid = auth.currentUser?.uid || null;
  if (currentUid !== contextUid) { contextUid = currentUid; contexts.clear(); }
  observeContextIdentity();
  const uid = auth.currentUser?.uid || "signed-out";
  return contexts.run(JSON.stringify([uid, organizationId || ""]), () => clubCall<ClubContext>("getClubContext", organizationId ? { organizationId } : {})).catch(error => {
    if (/permission-denied|unauthenticated/.test(String(error?.code || ""))) contexts.clear();
    throw error;
  });
}
const contexts = inFlightRequests<ClubContext>();
let contextUid = auth.currentUser?.uid || null;
let contextIdentityObserved = false;
function observeContextIdentity() {
  if (contextIdentityObserved) return;
  contextIdentityObserved = true;
  auth.onAuthStateChanged(user => {
    const next = user?.uid || null;
    if (next !== contextUid) { contextUid = next; contexts.clear(); }
  });
}
const contextInvalidationListeners = new Set<() => void>();
export function subscribeClubContextInvalidation(listener: () => void) {
  contextInvalidationListeners.add(listener);
  return () => { contextInvalidationListeners.delete(listener); };
}
export function invalidateClubContext() { contexts.clear(); contextInvalidationListeners.forEach(listener => listener()); }
