// Firestore / Storage / Functions access for the athlete portal — collection
// names, field fallbacks, query shapes, and error messages byte-identical to
// athlete-portal.js and athlete-mobile-pages.js.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { visibleAttempts } from "../../../lib/result-values";
import { parseProvisionalEstimates, type ProvisionalEstimate } from "../../../lib/provisional-estimates";
import { loadClubMembership } from "../../../lib/organization-data";
import { canAccessClubPlayer } from "../../../lib/organization";
import { refreshAdminIdentity } from "../../admin/lib/identity";
import firebase, { auth, cloud, db, storage } from "../../../lib/firebase";
import { captureIssue } from "../../../lib/user-issues";
import { findCoach as findCoachByUid, findPlayer, ownsPlayer } from "../../../lib/identity";
import type { Drill } from "./drills";
import { DRILLS } from "./drills";
import { accepted, fullName, mergeUnique, normalizeRep, num, repNumber, sessionNumber } from "./metrics";
import { boardsFromPlayers, number } from "./mobile";

export type Access = "athlete" | "coach" | "manager" | "admin" | "shared" | "preview";

export interface PortalData {
  access: Access;
  playerId: string | null;
  athlete: any;
  reps: Record<string, any[]>;
  provisionalEstimates?: ProvisionalEstimate[];
}

const emptyReps = (): Record<string, any[]> => Object.fromEntries(DRILLS.map(d => [d.key, []]));

// UID-first identity resolution shared with every legacy page (firebase-identity.js).
async function findCoach(uid: string): Promise<any> {
  return findCoachByUid(db, uid);
}

async function findOwnPlayer(uid: string): Promise<any> {
  return findPlayer(db, uid);
}

export async function loadAuthenticated(user: any, requestedPlayer: string | null): Promise<PortalData> {
  const playerDoc: any = requestedPlayer
    ? await db.collection("players").doc(requestedPlayer).get()
    : await findOwnPlayer(user.uid);
  if (!playerDoc?.exists) throw new Error("This athlete profile could not be found.");
  const own = ownsPlayer(playerDoc, user.uid);
  const identity = await refreshAdminIdentity(user);
  const player = playerDoc.data() || {};
  let access: Access = own ? "athlete" : "shared";
  if (identity.isAdmin) access = "admin";
  else if (!own && typeof player.organizationId === "string" && player.organizationId) {
    const membership = await loadClubMembership(user.uid, player.organizationId);
    if (!canAccessClubPlayer(membership, player)) throw new Error("You do not have permission to view this athlete.");
    access = membership!.role;
  } else if (!own) {
    const coach = await findCoach(user.uid);
    const coachData = coach?.data?.() || {};
    const linked = [player.coachUID, player.coachId, player.coachDocId];
    const allowed = Boolean(coach && ((coachData.members || []).includes(playerDoc.id) || linked.includes(coach.id) || linked.includes(user.uid)));
    if (!allowed) throw new Error("You do not have permission to view this athlete.");
    access = "coach";
  }
  const athlete = { id: playerDoc.id, ...playerDoc.data() };
  const effective = await cloud.httpsCallable("getAthleteEffectiveResults")({ playerId: playerDoc.id });
  const all = visibleAttempts(((effective.data as any).reps || []).map(normalizeRep));
  const reps = emptyReps();
  DRILLS.forEach(drill => { reps[drill.key] = all.filter((rep: any) => accepted(rep, drill)); });
  reps.freeRecord = await loadFreeRecordReps(playerDoc.id);
  try {
    reps.freeRecord = mergeUnique(reps.freeRecord, await listFreeRecordStorage(playerDoc.id));
  } catch (error) {
    console.warn("[profile] Free Record listing unavailable", error);
  }
  return { access, playerId: playerDoc.id, athlete, reps, provisionalEstimates: parseProvisionalEstimates((effective.data as any).provisionalEstimates) };
}

export async function listFreeRecordStorage(playerId: string): Promise<any[]> {
  const root = storage.ref(`${playerId}/freeRecord`);
  const result = await root.listAll();
  const rows: any[] = [];
  for (const sessionRef of result.prefixes) {
    const sessionResult = await sessionRef.listAll();
    if (sessionResult.prefixes.length) {
      sessionResult.prefixes.forEach((ref, index) => rows.push({
        id: `freeRecord-${sessionRef.name}-${ref.name}`,
        repType: "freeRecord",
        sessionFolder: sessionRef.name,
        repFolder: ref.name,
        sessionNumber: num(sessionRef.name.match(/\d+/)?.[0]) || 1,
        repNumber: num(ref.name.match(/\d+/)?.[0]) || index + 1,
      }));
    } else if (sessionResult.items.length) {
      rows.push({
        id: `freeRecord-${sessionRef.name}-root`,
        repType: "freeRecord",
        sessionFolder: sessionRef.name,
        repFolder: "",
        sessionNumber: num(sessionRef.name.match(/\d+/)?.[0]) || 1,
        repNumber: 1,
        sessionRoot: true,
      });
    }
  }
  return rows;
}

// Free Record is outside verified testing and retains its existing document-backed recordings.
export async function loadFreeRecordReps(playerId: string): Promise<any[]> {
  const collection = db.collection("players").doc(playerId).collection("reps");
  const snapshots = await Promise.all([collection.where("repType", "==", "freeRecord").get(), collection.where("drillType", "==", "freeRecord").get()]);
  const rows = new Map<string, any>();
  snapshots.flatMap(snapshot => snapshot.docs).forEach(doc => { const rep = normalizeRep(doc); if (accepted(rep, DRILLS.find(drill => drill.key === "freeRecord")!)) rows.set(doc.id, rep); });
  return [...rows.values()];
}

export async function loadShared(token: string): Promise<PortalData> {
  const calls = DRILLS.map(drill =>
    cloud.httpsCallable("getAthleteResultsShare")({ token, drill: drill.key })
      .then(result => ({ drill, payload: result.data as any, error: null as any }))
      .catch(error => ({ drill, payload: null as any, error })),
  );
  const results = await Promise.all(calls);
  const valid = results.filter(item => item.payload);
  if (!valid.length) throw results[0]?.error || new Error("This results link is invalid or expired.");
  const reps = emptyReps();
  valid.forEach(({ drill, payload }) => { reps[drill.key] = visibleAttempts((payload.reps || []).map(normalizeRep)); });
  return { access: "shared", playerId: null, athlete: valid[0].payload.athlete, reps };
}

export interface RepArtifacts {
  artifactUrls?: Record<string, string>;
  mediaUrl?: string | null;
  folder?: string;
  source?: "recording" | "diagnostic" | "unavailable";
  expiresAtMillis?: number;
  resultStatus?: { qualified: boolean; duplicate: boolean; reason: string; revisionId: string | null };
}

export async function authArtifacts(drill: Drill, rep: any, playerId: string): Promise<RepArtifacts> {
  if (drill.key !== "freeRecord") {
    const response = await cloud.httpsCallable("getAthleteRepMedia")({ playerId, drill: drill.key, repId: rep.id });
    return (response.data as RepArtifacts) || {};
  }
  const { artifactFolder } = await import("./metrics");
  const folder = artifactFolder(rep, drill, playerId), base = storage.ref(folder);
  const urls: Record<string, string> = {};
  await Promise.all(drill.artifacts.map(async name => {
    try { urls[name] = await base.child(name).getDownloadURL(); } catch { /* missing artifact */ }
  }));
  let mediaUrl: string | null = null;
  try {
    const listing = await base.listAll();
    const movie = listing.items.find(item => /\.(mov|mp4)$/i.test(item.name));
    if (movie) mediaUrl = await movie.getDownloadURL();
  } catch { /* listing unavailable */ }
  if (!mediaUrl && rep.sessionRoot) {
    for (const name of ["free_record_video.mov", "video.mov"]) {
      try { mediaUrl = await base.child(name).getDownloadURL(); break; } catch { /* try next */ }
    }
  }
  return { artifactUrls: urls, mediaUrl, folder, source: mediaUrl ? "recording" : "unavailable" };
}

export async function sharedArtifacts(drill: Drill, rep: any, token: string | null): Promise<RepArtifacts> {
  const result = await cloud.httpsCallable("getAthleteSharedRepArtifacts")({
    token,
    drill: drill.key,
    repId: rep.id,
    sessionNumber: sessionNumber(rep),
    repNumber: rep.sessionRoot ? 0 : repNumber(rep),
  });
  return (result.data as any) || {};
}

export async function fetchJson(url: string | undefined | null): Promise<any> {
  if (!url) return null;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${response.status}`);
  return response.json();
}

export async function storageJson(reference: any): Promise<any> {
  const url = await reference.getDownloadURL();
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${reference.name}`);
  return response.json();
}

export async function submitLlmJob(playerId: string, capability: string, params: any): Promise<any> {
  const ref = db.collection("llmJobs").doc();
  const ownerUid = auth.currentUser?.uid || null;
  try { await ref.set({
    schemaVersion: 1,
    capability,
    playerId,
    params,
    requestedByUid: auth.currentUser!.uid,
    clientVersion: "1.1+4",
    status: "pending",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  }); } catch (error) { captureIssue(error, `submit_${capability}`, { playerId, requestId: ref.id, ownerUid }); throw error; }
  return ref;
}

export function waitForJob(
  jobId: string,
  onStatus: (text: string) => void,
  register: (unsubscribe: () => void) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const unsubscribe = db.collection("llmJobs").doc(jobId).onSnapshot(snapshot => {
      const job: any = snapshot.data() || {};
      onStatus(job.status === "running" ? "Building your plan…" : "Waiting for the training engine…");
      if (job.status === "complete") { unsubscribe(); resolve(job); }
      if (job.status === "failed") { unsubscribe(); reject(new Error(job.error?.detail || job.error?.message || "The training engine could not finish.")); }
    }, error => { unsubscribe(); reject(error); });
    register(unsubscribe);
  });
}

// Coaches read their own roster directly; athletes receive a whitelisted
// projection from the admission service and never touch teammates' documents.
export async function loadTeamStandings(playerId: string): Promise<Record<string, { id: string; name: string; value: number }[]>> {
  const profile = await db.collection("players").doc(playerId).get();
  if (profile.data()?.organizationId) {
    const result = await cloud.httpsCallable("getTeamLeaderboard")({ teamId: profile.data()!.teamId });
    const payload = result.data as any;
    return boardsFromPlayers((payload.athletes || []).map((athlete: any) => ({ id: athlete.id, name: fullName(athlete), reps: athlete.reps || [] })));
  }
  const coachDoc: any = await findCoach(auth.currentUser!.uid);
  if (!coachDoc) throw new Error("A coach account is required for team standings.");
  const ids: string[] = [...new Set<string>([...(coachDoc.data().members || []), playerId])];
  const players = await Promise.all(ids.map(async id => {
    const [player, reps] = await Promise.all([
      db.collection("players").doc(id).get(),
      cloud.httpsCallable("getAthleteEffectiveResults")({ playerId: id }),
    ]);
    return { id, name: fullName(player.data() || {}), reps: ((reps.data as any).reps || []) };
  }));
  return boardsFromPlayers(players);
}

export async function loadAthleteStandings(): Promise<Record<string, { id: string; name: string; value: number }[]>> {
  const result = await cloud.httpsCallable("getTeamLeaderboard")({});
  const team: any = (result && result.data) || {};
  const players = (team.athletes || []).map((athlete: any) => ({
    id: athlete.id,
    name: fullName({ firstName: athlete.firstName, lastName: athlete.lastName }),
    reps: Array.isArray(athlete.reps) ? athlete.reps : [],
  }));
  return boardsFromPlayers(players);
}

// Body Profile: list `${playerId}/bodyScans` prefixes newest-first.
export async function listBodyScans(playerId: string): Promise<{ ref: any; number: number }[]> {
  const root = storage.ref(`${playerId}/bodyScans`);
  const listing = await root.listAll();
  return listing.prefixes
    .map(ref => ({ ref, number: number(ref.name.replace(/^kick/i, "")) ?? 0 }))
    .sort((a, b) => b.number - a.number);
}
