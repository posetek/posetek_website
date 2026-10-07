// Recorded results for one athlete, read the way the athlete portal reads them
// (same collection, same rep normalization, same per-drill bucketing) so the
// admin sees exactly what the athlete and their coach see — then reaches the
// rep tools from it.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { visibleAttempts } from "../../../lib/result-values";
import { cloud, db } from "../../../lib/firebase";
import { DRILLS } from "../../athlete-portal/lib/drills";
import type { Drill } from "../../athlete-portal/lib/drills";
import { listFreeRecordStorage, loadFreeRecordReps } from "../../athlete-portal/lib/loaders";
import { accepted, mergeUnique, normalizeRep } from "../../athlete-portal/lib/metrics";

export interface AdminResults {
  athlete: any;
  reps: Record<string, any[]>;
}

export const RESULT_DRILLS: Drill[] = DRILLS.filter(drill => drill.key !== "freeRecord");

export async function loadAdminResults(playerId: string, knownAthlete?: any): Promise<AdminResults> {
  if (knownAthlete && knownAthlete.id !== playerId) throw new Error('The selected athlete changed. Open their results again.');
  let athlete = knownAthlete;
  if (!athlete) {
    const playerDoc = await db.collection("players").doc(playerId).get();
    if (!playerDoc.exists) throw new Error("That athlete could not be found.");
    athlete = { ...(playerDoc.data() || {}), id: playerDoc.id };
  }
  const response = await cloud.httpsCallable("getAthleteEffectiveResults")({ playerId });
  const all = visibleAttempts(((response.data as any).reps || []).map(normalizeRep), { includeFailedAttempts: true });
  const reps: Record<string, any[]> = Object.fromEntries(DRILLS.map(drill => [drill.key, []]));
  DRILLS.forEach(drill => { reps[drill.key] = all.filter((rep: any) => accepted(rep, drill)); });
  reps.freeRecord = await loadFreeRecordReps(playerId);
  try {
    reps.freeRecord = mergeUnique(reps.freeRecord, await listFreeRecordStorage(playerId));
  } catch (error) {
    console.warn("[admin results] Free Record listing unavailable", error);
  }
  return { athlete, reps };
}

export function resultsPath(playerId: string, drillKey?: string, repId?: string): string {
  const base = `/admin/accounts/player/${encodeURIComponent(playerId)}/results`;
  if (!drillKey) return base;
  if (!repId) return `${base}/${drillKey}`;
  return `${base}/${drillKey}/${encodeURIComponent(String(repId))}`;
}
