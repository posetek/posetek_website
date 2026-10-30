import { auth, cloud, db } from '../../../lib/firebase';
import { reviewRefreshIsCurrent } from '../../../lib/reviewed-results';

/** A rep write invalidates the last projection before requesting the current one.
 * The server checks review provenance; this watcher checks request/owner freshness. */
export function watchEffectiveResults(playerId: string, callbacks: {
  pending: () => void;
  result: (payload: { reps: unknown[]; provisionalEstimates?: unknown }) => void;
  error: (error: Error) => void;
}): () => void {
  const ownerUid = auth.currentUser?.uid;
  let alive = true, version = 0;
  const current = (requestVersion: number) => reviewRefreshIsCurrent(ownerUid, auth.currentUser?.uid, alive, requestVersion, version);
  const stopOwner = auth.onAuthStateChanged(user => {
    if (!alive) return;
    if (user?.uid !== ownerUid) { ++version; callbacks.pending(); }
  });
  const stopReps = db.collection('players').doc(playerId).collection('reps').onSnapshot(() => {
    if (!alive) return;
    const requestVersion = ++version;
    callbacks.pending();
    if (!current(requestVersion)) return;
    void cloud.httpsCallable('getAthleteEffectiveResults')({ playerId }).then(response => {
      if (!current(requestVersion)) return;
      const payload = response.data as { reps?: unknown; provisionalEstimates?: unknown } | null;
      if (!payload || !Array.isArray(payload.reps)) throw new Error('The latest results could not be verified.');
      callbacks.result({ reps: payload.reps, provisionalEstimates: payload.provisionalEstimates });
    }).catch(error => {
      if (current(requestVersion)) { callbacks.pending(); callbacks.error(error); }
    });
  }, error => {
    if (alive) { ++version; callbacks.pending(); callbacks.error(error); }
  });
  return () => { alive = false; ++version; stopOwner(); stopReps(); };
}
