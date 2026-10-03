// Monitor accounts: reading organizations, coaches and players, and the four
// admin-writable profile inputs.
//
// ADMIN_IDENTITY_CONTRACT.md §3 (the admin permission table) and §4 (the
// navigation), PLAYER_PROFILE_INPUTS_CONTRACT.md §1 (position), §2 (age), §3
// (the private coach note) and §7 (technical eligibility).
//
// Admins read every player, coach and organization, and write ONLY:
//   players/{id}  → position, birthDate, age, ageRecordedAt, maxDrillDifficulty, updatedAt
//   coaches/{id}  → maxDrillDifficulty, updatedAt
//   players/{id}/privateProfile/coachFeedback
// Nothing here touches reps, sessions or workoutLogs: an admin inspects athlete
// evidence and edits prescriptions, and never executes or completes work as the
// athlete (01A Q19).

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { auth, db } from "../../../lib/firebase";
import { resolveEligibility } from "../../../lib/contracts/types";
import type { Position, TechnicalEligibility } from "../../../lib/contracts/types";
import { playerSignup, withoutSignupSecrets } from "./signup";
import { getClubContext } from "../../../lib/organization-data";
import { buildClubHierarchy, hasClubIdentity, staffName } from "./accountHierarchy";
import { resolveProfileAge, type ProfileAge } from "../../../lib/profile-age";

export interface OrganizationRow {
  id: string;
  name: string;
  code: string;
  coachIds: string[];
  /** 2 = a club organization with `teams` documents; anything else is a legacy roster org. */
  schemaVersion: number;
  logoUrl: string | null;
}

export interface TeamRow {
  id: string;
  organizationId: string;
  name: string;
  playerIds: string[];
  coachUIDs: string[];
}

export interface CoachRow {
  id: string;
  userUID: string;
  name: string;
  email: string;
  members: string[];
  organizationId: string | null;
  organizationCode: string | null;
  maxDrillDifficulty: number | null;
  organizationRole?: "manager" | "coach";
  organizationStatus?: string;
  teamIds?: string[];
}

export interface PlayerRow {
  id: string;
  name: string;
  email: string;
  coachId: string | null;
  /** The club `organizationId` string when migrated, else the legacy `organization` ref id. */
  organizationId: string | null;
  teamId: string | null;
  registered: boolean;
  signupCode: string | null;
  raw: any;
}

function personName(data: any, fallback: string): string {
  return [data?.firstName, data?.lastName].filter(Boolean).join(" ").trim()
    || String(data?.name || "").trim()
    || fallback;
}

function refId(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return typeof value?.id === "string" ? value.id : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(entry => String(entry)))] : [];
}

function ratingOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

// MARK: - Reads

export async function loadOrganizations(): Promise<OrganizationRow[]> {
  const snapshot = await db.collection("organizations").get();
  return snapshot.docs
    .map(doc => {
      const data: any = doc.data() || {};
      return {
        id: doc.id,
        name: String(data.name || "Organization"),
        code: String(data.code || ""),
        coachIds: (Array.isArray(data.coaches) ? data.coaches : []).map((entry: unknown) => String(refId(entry) ?? entry)),
        schemaVersion: Number(data.schemaVersion || 1),
        logoUrl: typeof data.logoUrl === "string" && data.logoUrl ? data.logoUrl : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every club team. Admins may read the whole `teams` collection (the rule is
 * not resource-dependent), so one query covers every organization — the
 * Monitor accounts page groups them client-side.
 */
export async function loadTeams(): Promise<TeamRow[]> {
  const snapshot = await db.collection("teams").get();
  return snapshot.docs
    .map(doc => {
      const data: any = doc.data() || {};
      return {
        id: doc.id,
        organizationId: String(data.organizationId || ""),
        name: String(data.name || "Team"),
        playerIds: stringArray(data.playerIds),
        coachUIDs: stringArray(data.coachUIDs),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Canonical ownership is authoritative even when roster projections are stale.
 * The optional index is retained for callers compiled against the earlier API.
 */
export async function loadTeamPlayers(team: TeamRow, _index?: PlayerRow[]): Promise<PlayerRow[]> {
  const roster = await loadOrganizationPlayers(team.organizationId);
  if (roster.truncated) throw new Error("This organization exceeds the 2,000-athlete roster limit. Contact PoseTek to load the remaining athletes.");
  return roster.players.filter(player => player.teamId === team.id);
}

export const CLUB_PLAYER_LIMIT = 2000;
export async function loadOrganizationPlayers(organizationId: string) {
  const snapshot = await db.collection("players").where("organizationId", "==", organizationId).limit(CLUB_PLAYER_LIMIT + 1).get();
  return { players: snapshot.docs.slice(0, CLUB_PLAYER_LIMIT).map(doc => playerRow(doc.id, doc.data()))
    .filter(player => hasClubIdentity(player) && player.organizationId === organizationId)
    .sort((a, b) => a.name.localeCompare(b.name)), truncated: snapshot.docs.length > CLUB_PLAYER_LIMIT };
}

export async function loadClubAccountData(organizationId: string) {
  const context = await getClubContext(organizationId);
  if (context.role !== "admin" || context.organization?.id !== organizationId) throw new Error("PoseTek admin access is required to inspect this organization.");
  const roster = await loadOrganizationPlayers(organizationId);
  return { context, hierarchy: buildClubHierarchy(context, roster.players, roster.truncated) };
}

export async function loadCoaches(): Promise<CoachRow[]> {
  const snapshot = await db.collection("coaches").get();
  return snapshot.docs
    .map(coachRowFrom)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function playerRow(id: string, data: any): PlayerRow {
  return {
    id,
    name: personName(data, "Athlete"),
    email: String(data?.signupEmail || data?.email || ""),
    coachId: refId(data?.coach) ?? (data?.coachUID ? String(data.coachUID) : null),
    organizationId: Object.prototype.hasOwnProperty.call(data || {}, "organizationId")
      ? (typeof data.organizationId === "string" && data.organizationId ? data.organizationId : null) : refId(data?.organization),
    teamId: typeof data?.teamId === "string" && data.teamId ? data.teamId : null,
    ...playerSignup(data),
    raw: withoutSignupSecrets(data || {}),
  };
}

/**
 * The roster of one coach: the `members` array on the coach document plus any
 * player whose `coachUID` back-pointer names them (`AddPlayerView` writes the
 * latter). Both relations exist in real data, so both are read.
 */
export async function loadCoachRoster(coach: CoachRow): Promise<PlayerRow[]> {
  if (coach.organizationRole && !coach.organizationId) throw new Error("This staff account has a missing organization assignment. Its legacy roster cannot identify current team access.");
  if (coach.organizationId) {
    const organization = await db.collection("organizations").doc(coach.organizationId).get();
    if (coach.organizationRole || organization.data()?.schemaVersion === 2) {
      const { context, hierarchy } = await loadClubAccountData(coach.organizationId);
      const member = context.staff.find(entry => entry.userUID === coach.userUID);
      if (!member || member.status !== "active") return [];
      return member.role === "manager" ? hierarchy.players : hierarchy.coaches.find(row => row.member.userUID === coach.userUID)?.players || [];
    }
  }
  const byId = new Map<string, PlayerRow>();
  const memberDocs = await Promise.all(
    coach.members.map(id => db.collection("players").doc(id).get()),
  );
  const include = (doc: any) => {
    if (!doc.exists) return;
    const player = playerRow(doc.id, doc.data());
    if (!hasClubIdentity(player)) byId.set(doc.id, player);
  };
  for (const doc of memberDocs) {
    include(doc);
  }
  for (const key of new Set([coach.userUID, coach.id])) {
    if (!key) continue;
    const snapshot = await db.collection("players").where("coachUID", "==", key).get();
    snapshot.docs.forEach(include);
  }
  const references = await db.collection("players").where("coach", "==", db.collection("coaches").doc(coach.id)).get();
  references.docs.forEach(include);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadCoachAccount(coachId: string, organizationId?: string) {
  const doc = await db.collection("coaches").doc(coachId).get();
  const mirror = doc.exists ? coachRowFrom(doc) : null;
  const orgId = organizationId || mirror?.organizationId;
  if (orgId) {
    const org = await db.collection("organizations").doc(orgId).get();
    if (org.data()?.schemaVersion === 2) {
      const { context, hierarchy } = await loadClubAccountData(orgId);
      const member = context.staff.find(entry => entry.userUID === (mirror?.userUID || coachId));
      if (!member) throw new Error("This account has no staff membership in this organization. Open Accounts to find its current assignment.");
      const canonicalMirror = mirror?.id === member.userUID && mirror.userUID === member.userUID && mirror.organizationId === orgId ? mirror : null;
      const assignment = hierarchy.coaches.find(entry => entry.member.userUID === member.userUID);
      const active = Boolean(assignment || hierarchy.managers.some(entry => entry.userUID === member.userUID));
      const coach: CoachRow = { id: member.userUID, userUID: member.userUID, name: staffName(member), email: member.email,
        members: [], organizationId: orgId, organizationCode: null, maxDrillDifficulty: canonicalMirror?.maxDrillDifficulty ?? null,
        organizationRole: member.role, organizationStatus: active ? "active" : member.status === "active" ? "invalid" : member.status, teamIds: member.teamIds };
      return { coach, organization: context.organization, teams: !active ? [] : member.role === "manager" ? hierarchy.teams : assignment?.teams || [],
        roster: !active ? [] : member.role === "manager" ? hierarchy.players : assignment?.players || [],
        limits: hierarchy.limits, ratingEditable: active && member.role === "coach" && Boolean(canonicalMirror) };
    }
    if (organizationId && mirror?.organizationId && mirror.organizationId !== organizationId) throw new Error("This coach is linked to another organization. Return to Accounts to view the current assignment.");
  }
  if (!mirror) throw new Error("That coach account no longer exists.");
  return { coach: mirror, organization: null, teams: [], roster: await loadCoachRoster(mirror), limits: [] as string[], ratingEditable: true };
}

/**
 * A bounded snapshot of the player collection, used only to power the console's
 * name/email search (an admin reads every player, and this avoids one composite
 * index per search field). The cap is reported so the UI never implies the list
 * is complete.
 */
export const PLAYER_INDEX_LIMIT = 500;

export async function loadPlayerIndex(): Promise<{ players: PlayerRow[]; truncated: boolean }> {
  const snapshot = await db.collection("players").limit(PLAYER_INDEX_LIMIT + 1).get();
  const docs = snapshot.docs.slice(0, PLAYER_INDEX_LIMIT);
  return {
    players: docs.map(doc => playerRow(doc.id, doc.data())).sort((a, b) => a.name.localeCompare(b.name)),
    truncated: snapshot.docs.length > PLAYER_INDEX_LIMIT,
  };
}

export async function loadPlayer(playerId: string): Promise<PlayerRow | null> {
  const doc = await db.collection("players").doc(playerId).get();
  return doc.exists ? playerRow(doc.id, doc.data()) : null;
}

export async function loadCoachOfPlayer(player: PlayerRow): Promise<CoachRow | null> {
  if (player.coachId) {
    const direct = await db.collection("coaches").doc(player.coachId).get();
    if (direct.exists) {
      const coaches = [direct];
      return coachRowFrom(coaches[0]);
    }
    const byUid = await db.collection("coaches").where("userUID", "==", player.coachId).limit(1).get();
    if (!byUid.empty) return coachRowFrom(byUid.docs[0]);
  }
  // The roster array is the other real relation. A player claimed by more than
  // one coach has no unique association, so eligibility falls back to the
  // default rather than inheriting an arbitrary coach's rating (§7).
  const roster = await db.collection("coaches").where("members", "array-contains", player.id).limit(2).get();
  if (roster.size === 1) return coachRowFrom(roster.docs[0]);
  return null;
}

function coachRowFrom(doc: any): CoachRow {
  const data: any = doc.data() || {};
  return {
    id: doc.id,
    userUID: String(data.userUID || doc.id),
    name: personName(data, "Coach"),
    email: String(data.email || ""),
    members: stringArray(data.members),
    organizationId: Object.prototype.hasOwnProperty.call(data, "organizationId") ? refId(data.organizationId) : refId(data.organization),
    organizationCode: data.organizationCode ? String(data.organizationCode) : null,
    maxDrillDifficulty: ratingOrNull(data.maxDrillDifficulty),
    organizationRole: ["coach", "manager"].includes(data.organizationRole) ? data.organizationRole : undefined,
    organizationStatus: typeof data.organizationStatus === "string" ? data.organizationStatus : undefined,
    teamIds: Array.isArray(data.teamIds) ? stringArray(data.teamIds) : undefined,
  };
}

// MARK: - Age (profile inputs §2)

export type ResolvedAge = ProfileAge;

/**
 * Valid `birthDate` → valid legacy `dateOfBirth` → a current dated integer `age` →
 * absent. An integer age is a dated OBSERVATION: it is never incremented on the
 * anniversary of `ageRecordedAt`, which is not the athlete's birthday.
 */
export function resolvePlayerAge(player: any, now: Date = new Date()): ResolvedAge {
  return resolveProfileAge(player, now);
}

export function eligibilityFor(player: PlayerRow | null, coach: CoachRow | null): TechnicalEligibility {
  return resolveEligibility(player?.raw ?? null, coach ? { maxDrillDifficulty: coach.maxDrillDifficulty } : null, coach?.id ?? null);
}

// MARK: - Profile writes

export interface ProfilePatch {
  position?: Position | null;
  birthDate?: Date | null;
  age?: number | null;
  maxDrillDifficulty?: number | null;
}

/**
 * Only the keys the rules allow, and only the ones that actually changed —
 * validating an unchanged value would fail an unrelated edit (01A F16).
 * Clearing a rating removes the key so the coach/default is inherited again.
 */
export async function savePlayerProfile(playerId: string, patch: ProfilePatch): Promise<void> {
  const update: Record<string, any> = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if ("position" in patch) {
    update.position = patch.position ?? firebase.firestore.FieldValue.delete();
  }
  if ("birthDate" in patch) {
    update.birthDate = patch.birthDate
      ? firebase.firestore.Timestamp.fromDate(patch.birthDate)
      : firebase.firestore.FieldValue.delete();
  }
  if ("age" in patch) {
    if (patch.age === null) {
      update.age = firebase.firestore.FieldValue.delete();
      update.ageRecordedAt = firebase.firestore.FieldValue.delete();
    } else {
      update.age = patch.age;
      update.ageRecordedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
  }
  if ("maxDrillDifficulty" in patch) {
    update.maxDrillDifficulty = patch.maxDrillDifficulty ?? firebase.firestore.FieldValue.delete();
  }
  await db.collection("players").doc(playerId).update(update);
}

export async function saveCoachRating(coachId: string, rating: number | null): Promise<void> {
  await db.collection("coaches").doc(coachId).update({
    maxDrillDifficulty: rating ?? firebase.firestore.FieldValue.delete(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// MARK: - The private coach note (profile inputs §3)

export interface CoachNote {
  text: string;
  emphasis?: { domain: string; direction: "more" | "less" }[];
  authorUid?: string;
  authorRole?: string;
  updatedAt?: any;
}

export const COACH_NOTE_MAX_CHARS = 1000;

const NOTE_PATH = (playerId: string) =>
  db.collection("players").doc(playerId).collection("privateProfile").doc("coachFeedback");

export async function loadCoachNote(playerId: string): Promise<CoachNote | null> {
  const doc = await NOTE_PATH(playerId).get();
  return doc.exists ? (doc.data() as CoachNote) : null;
}

/**
 * One current note per player — an overwrite, not a history. The document lives
 * OUTSIDE the athlete-readable player document because Firestore cannot hide a
 * field within a readable document (01A F04); the athlete sees the plan, never
 * the note.
 */
export async function saveCoachNote(
  playerId: string,
  text: string,
  emphasis: { domain: string; direction: "more" | "less" }[],
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("You are signed out. Sign in again to save.");
  const note: Record<string, any> = {
    text,
    authorUid: uid,
    authorRole: "admin",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (emphasis.length) note.emphasis = emphasis.slice(0, 4);
  await NOTE_PATH(playerId).set(note);
}

export async function clearCoachNote(playerId: string): Promise<void> {
  await NOTE_PATH(playerId).delete();
}

// MARK: - Plans, logs and ad-hoc workouts

export async function loadPlayerPlans(playerId: string): Promise<any[]> {
  const snapshot = await db.collection("players").doc(playerId).collection("trainingPlans").get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function loadWorkoutLogs(playerId: string): Promise<any[]> {
  const snapshot = await db.collection("players").doc(playerId).collection("workoutLogs").get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function loadPlannedWorkouts(playerId: string): Promise<any[]> {
  const snapshot = await db.collection("players").doc(playerId).collection("plannedWorkouts").get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function loadPlanAdjustments(playerId: string, planId: string): Promise<any[]> {
  // Ordered client-side: the composite (planId, createdAt) index the contract
  // names is not deployed yet, and an admin page must not fail on a missing one.
  const snapshot = await db.collection("players").doc(playerId).collection("planAdjustments").get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...(doc.data() as any) }))
    .filter(row => String(row.planId ?? "") === planId)
    .sort((a: any, b: any) => Number(b?.createdAt?.seconds ?? 0) - Number(a?.createdAt?.seconds ?? 0));
}

/** The active plan is the newest `status: "active"` document. */
export function activePlan(plans: any[]): any | null {
  const active = plans.filter(plan => String(plan?.status ?? "") === "active");
  if (!active.length) return null;
  return active.sort(
    (a, b) => Number(b?.generatedAt?.seconds ?? 0) - Number(a?.generatedAt?.seconds ?? 0),
  )[0];
}
