/* eslint-disable @typescript-eslint/no-explicit-any */
import { cloud, db } from '../../../lib/firebase';
import { workoutHistory } from '../../coach-dashboard/lib/history';

export type WorkoutLogSource = 'workoutLogs' | 'personalWorkoutLogs';
export interface WorkoutFocus { source: WorkoutLogSource; logId: string }
export type FocusRequest = { kind: 'none' } | { kind: 'invalid' } | { kind: 'valid'; focus: WorkoutFocus };
export type RecordedWorkoutLog = Record<string, any> & { id: string; _workoutSource: WorkoutLogSource };
export type NotificationStatus = 'pending' | 'sending' | 'accepted' | 'delivered' | 'delayed' | 'bounced' | 'suppressed' | 'failed' | 'needs_review' | 'cancelled';
export interface WorkoutNotificationResult {
  settings: { enabled: boolean; sendEnabled: boolean; recipient: string; quietMinutes: number; pilot?: boolean; playerIncluded?: boolean };
  notifications: { id: string; eventType: 'terminal' | 'inactivity'; status: NotificationStatus;
    createdAtMillis: number; lastAttemptAtMillis: number | null; acceptedAtMillis: number | null;
    deliveredAtMillis: number | null; failureMessage: string | null }[];
  activity: null | { lastActivityAtMillis: number; lastSeenAtMillis: number | null; lastSignal: 'resume' | 'progress' | 'pause' | 'heartbeat' | 'saved';
    quietDueAtMillis: number | null; inactivityNotified: boolean; blockId: string | null; webObserved: boolean };
  observedAtMillis: number;
}

export function parseWorkoutFocus(query: URLSearchParams): FocusRequest {
  if (!query.has('workoutSource') && !query.has('workoutLog')) return { kind: 'none' };
  const source = query.get('workoutSource'), logId = query.get('workoutLog');
  if (query.getAll('workoutSource').length !== 1 || query.getAll('workoutLog').length !== 1
    || !['workoutLogs', 'personalWorkoutLogs'].includes(source || '') || !logId || logId.length > 1500
    || /[\\/]/.test(logId) || Array.from(logId).some(character => character.charCodeAt(0) < 32)
    || logId === '.' || logId === '..') return { kind: 'invalid' };
  return { kind: 'valid', focus: { source: source as WorkoutLogSource, logId } };
}

export function workoutFocusQuery(query: URLSearchParams, focus: WorkoutFocus): URLSearchParams {
  const next = new URLSearchParams(query);
  next.set('workoutSource', focus.source); next.set('workoutLog', focus.logId);
  return next;
}

/** A link targets one saved document, even if reporting prefers a linked duplicate. */
export function selectWorkoutHistory(logs: RecordedWorkoutLog[], request: FocusRequest) {
  const rows = workoutHistory(logs);
  const log = request.kind === 'valid' ? logs.find(row => row.id === request.focus.logId && row._workoutSource === request.focus.source) : undefined;
  const focused = log ? workoutHistory([log])[0] : null;
  return { focused, rows: focused ? rows.filter(row => row.id !== focused.id) : rows };
}

export function workoutPacificTime(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'Not recorded' : new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

export async function loadPlayerWorkoutHistory(playerId: string): Promise<RecordedWorkoutLog[]> {
  const player = db.collection('players').doc(playerId);
  const [assigned, config] = await Promise.all([player.collection('workoutLogs').get(), db.collection('config').doc('llm').get()]);
  const personal = config.data()?.personalWorkoutsEnabled === true ? await player.collection('personalWorkoutLogs').get() : null;
  return [
    ...assigned.docs.map(doc => ({ ...doc.data(), id: doc.id, _workoutSource: 'workoutLogs' as const })),
    ...(personal?.docs || []).map(doc => ({ ...doc.data(), id: doc.id, source: 'personal', _workoutSource: 'personalWorkoutLogs' as const })),
  ];
}

export async function getWorkoutNotificationStatus(playerId: string, focus: WorkoutFocus): Promise<WorkoutNotificationResult> {
  return (await cloud.httpsCallable('getWorkoutNotificationStatus')({ playerId, ...focus })).data as WorkoutNotificationResult;
}
