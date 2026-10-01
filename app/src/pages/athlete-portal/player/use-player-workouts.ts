import { useEffect, useRef, useState } from 'react';
import firebase, { db } from '../../../lib/firebase';
import type { WorkoutStore } from '../lib/workout-store';
import { initialLog, patchBlock, resumeWorkout } from './execution';
import type { Row } from './execution';
import { startPlayerWorkout, mutatePlayerWorkout } from './workout-repository';
import { captureIssue } from '../../../lib/user-issues';

export type PlayerWorkoutStore = WorkoutStore & {
  saving: boolean;
  start: (workout: Row) => Promise<Row>;
  saveBlock: (workoutId: string, blockId: string, row: Row | null, elapsedSeconds?: number) => Promise<void>;
  finish: (workoutId: string, reason: string, activeSeconds?: number) => Promise<void>;
};

export function usePlayerWorkouts(playerId: string, planId: string | null, preview: boolean): PlayerWorkoutStore {
  const [logs, setLogs] = useState<Record<string, Row>>({});
  const [workouts, setWorkouts] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = useRef(logs); current.current = logs;
  const busy = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setLogs({}); setWorkouts([]); setLoaded(preview); setError(null);
    if (preview || !planId) return;
    let active = true;
    const player = db.collection('players').doc(playerId);
    const stop = player.collection('workoutLogs').where('planId', '==', planId).onSnapshot(s => {
      if (!active) return;
      setLogs(Object.fromEntries(s.docs.map(d => [d.id, { ...d.data(), id: d.id }]))); setLoaded(true);
    }, e => { if (active) setError(e.message); });
    const stopWorkouts = player.collection('plannedWorkouts').where('planId', '==', planId).onSnapshot(s => {
      if (active) setWorkouts(s.docs.map(d => ({ ...d.data(), id: d.id })));
    }, e => { if (active) setError(e.message); });
    return () => { active = false; epoch.current++; stop(); stopWorkouts(); };
  }, [playerId, planId, preview]);

  const run = async <T,>(action: () => Promise<T>): Promise<T> => {
    if (busy.current) throw new Error('Please wait for your progress to save.');
    busy.current = true; setSaving(true); setError(null);
    try { return await action(); }
    catch (e: any) { if (!preview && e.code) captureIssue(e, 'workout_save', { playerId }); setError(e.message || 'Could not save. Check your connection and retry.'); throw e; }
    finally { busy.current = false; setSaving(false); }
  };
  const remember = (id: string, log: Row, token: number) => {
    if (epoch.current !== token) return;
    current.current = { ...current.current, [id]: { ...log, id } }; setLogs(current.current);
  };
  const start = (reviewed: Row) => run(async () => {
    const token = epoch.current;
    if (!loaded) throw new Error('Wait for workout history to load, then try again.');
    let saved: Row;
    if (preview) saved = { ...(current.current[reviewed.id] || initialLog(reviewed, new Date())), timerStartedHere: !current.current[reviewed.id] };
    else saved = await startPlayerWorkout(playerId, reviewed);
    if (epoch.current !== token) throw new Error('The selected player changed.');
    const { timerStartedHere, ...log } = saved;
    remember(reviewed.id, log, token);
    return { ...resumeWorkout(reviewed, { ...log, id: reviewed.id }), timerStartedHere: timerStartedHere === true };
  });
  const mutate = (id: string, patch: (old: Row) => Row) => run(async () => {
    const token = epoch.current;
    let saved: Row;
    if (preview) {
      const old = current.current[id];
      if (!old || old.endedAt) throw new Error('This workout is not active.');
      saved = { ...old, ...patch(old) };
    } else saved = await mutatePlayerWorkout(playerId, id, patch);
    remember(id, saved, token);
  });
  const saveBlock = (id: string, blockId: string, row: Row | null) => mutate(id, old => ({ blocks: patchBlock(old, blockId, row) }));
  const finish = (id: string, reason: string, activeSeconds?: number) => mutate(id, () => ({
    endedAt: preview ? new Date() : firebase.firestore.Timestamp.now(), endReason: reason,
    ...(activeSeconds !== undefined ? { activeSeconds: Math.max(0, activeSeconds) } : {}),
  }));
  return { workouts, logs, logsLoaded: loaded, error, saving, start, saveBlock, finish,
    logFor: id => current.current[id] || null,
    // Player execution starts explicitly, before mounting the guided player.
    beginWorkout: () => {},
    updateBlock: (id, row) => { void saveBlock(id, row.blockId, row).catch(() => {}); },
    removeBlock: (id, blockId) => { void saveBlock(id, blockId, null).catch(() => {}); },
    endWorkout: (id, reason) => { void finish(id, reason).catch(() => {}); },
    noteWorkout: workout => setWorkouts(rows => [...rows.filter(r => r.id !== workout.id), workout]),
  };
}
