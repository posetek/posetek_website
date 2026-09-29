// Optional web activity reporting. Workout saves remain the source of truth;
// this queue never participates in the personal-workout command journal.
export type WorkoutActivitySource = 'workoutLogs' | 'personalWorkoutLogs';
export type WorkoutActivityType = 'resume' | 'progress' | 'pause' | 'heartbeat';
export type WorkoutActivityRequest = {
  source: WorkoutActivitySource; logId: string; sessionId: string; sequence: number;
  eventId: string; type: WorkoutActivityType; occurredAtMillis: number;
  ownerEpoch?: number; blockId?: string;
};
export type WorkoutActivityResponse = { accepted: boolean; ownerEpoch?: number; serverTimeMillis?: number; reason?: string };
export type WorkoutActivityState = {
  uid: string | null; playerId: string; currentOwner: boolean; visible: boolean;
  running: boolean; ended: boolean; blockId?: string;
};
export const WORKOUT_ACTIVITY_HEARTBEAT_MS = 60_000;
export const WORKOUT_ACTIVITY_MAX_AGE_MS = 120_000;
const RETRY_MS = 10_000;
const COALESCE_MS = 1_000;

export function workoutActivitySessionId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function workoutActivityLog(source: string | undefined, id: string): { source: WorkoutActivitySource; logId: string } {
  return source === 'personal'
    ? { source: 'personalWorkoutLogs', logId: id.startsWith('personal_') ? id.slice('personal_'.length) : id }
    : { source: 'workoutLogs', logId: id };
}

/** A bounded, in-memory queue: one immutable retry, the latest activity and
 * the latest pause/heartbeat. Retries retain their original event time/ID.
 * A timer or reconnect can never claim ownership or manufacture fresh activity. */
export function createWorkoutActivity(options: {
  uid: string; playerId: string; source: WorkoutActivitySource; logId: string; sessionId: string;
  read: () => WorkoutActivityState;
  send: (request: WorkoutActivityRequest) => Promise<WorkoutActivityResponse>;
  online?: () => boolean; now?: () => number; newSessionId?: () => string;
}) {
  const now = options.now || Date.now;
  const online = options.online || (() => true);
  let sessionId = options.sessionId, sequence = 0, epoch: number | undefined;
  let claim: WorkoutActivityRequest | null = null, retry: WorkoutActivityRequest | null = null;
  let activity: WorkoutActivityRequest | null = null, state: WorkoutActivityRequest | null = null;
  let busy = false, disposed = false, retired = false, claiming = false, closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const allowed = (active: boolean) => {
    const current = options.read();
    return !disposed && !retired && !!options.uid && options.uid !== 'preview'
      && current.uid === options.uid && current.playerId === options.playerId
      && current.currentOwner && !current.ended
      && (!active || (current.visible && current.running));
  };
  const fresh = (request: WorkoutActivityRequest) => now() >= request.occurredAtMillis - 60_000
    && now() - request.occurredAtMillis < WORKOUT_ACTIVITY_MAX_AGE_MS;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const clearQueue = () => { claim = null; retry = null; activity = null; state = null; clearTimer(); };
  const schedule = (delay: number) => {
    if (timer !== undefined || disposed || retired) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
  };
  const request = (type: WorkoutActivityType, occurredAtMillis = now()): WorkoutActivityRequest => {
    const blockId = options.read().blockId;
    const next = sequence++;
    return { source: options.source, logId: options.logId, sessionId, sequence: next,
      eventId: `${sessionId}:${next}`, type, occurredAtMillis,
      ...(epoch !== undefined ? { ownerEpoch: epoch } : {}), ...(blockId ? { blockId } : {}) };
  };
  const expireClaim = () => {
    if (!claim || fresh(claim)) return false;
    clearQueue(); claiming = false;
    // This attempt might have reached the server despite a lost response. Only
    // a NEW explicit action may establish a new reporting session afterwards.
    sessionId = options.newSessionId?.() || `${options.sessionId}-${now()}`;
    sequence = 0;
    return true;
  };
  async function flush() {
    if (busy || disposed || retired) return;
    clearTimer();
    if (!allowed(false)) { clearQueue(); return; }
    if (expireClaim()) return;
    if (retry && !fresh(retry)) retry = null;
    if (activity && !fresh(activity)) activity = null;
    if (state && !fresh(state)) state = null;
    if (!online()) { if (claim || retry || activity || state) schedule(RETRY_MS); return; }
    let next = claim || retry;
    if (!next && epoch !== undefined) {
      next = activity && (!state || activity.sequence < state.sequence) ? activity : state;
      if (next === activity) activity = null;
      else if (next === state) state = null;
    }
    if (!next) { if (closing) { disposed = true; clearQueue(); } return; }
    if (epoch !== undefined && next !== claim) next = { ...next, ownerEpoch: epoch };
    const sent = next;
    busy = true;
    try {
      const response = await options.send(sent);
      if (!allowed(false)) { clearQueue(); return; }
      if (!response.accepted) {
        if (['disabled', 'ended', 'not-current-owner'].includes(response.reason || '') || sent === claim) {
          retired = true; clearQueue(); return;
        }
      } else if (sent === claim) {
        if (!Number.isSafeInteger(response.ownerEpoch) || response.ownerEpoch! < 1) { retired = true; clearQueue(); return; }
        epoch = response.ownerEpoch;
        claiming = false;
      }
      if (sent === claim) claim = null;
      retry = null;
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || '').split('/').at(-1);
      if (['permission-denied', 'unauthenticated', 'not-found', 'invalid-argument', 'already-exists'].includes(code || '')) {
        retired = true; clearQueue(); return;
      }
      // An ambiguous transport failure retries exactly the same command. It
      // does not gain a newer timestamp when the device comes back online.
      if (allowed(false) && fresh(sent)) retry = sent;
    } finally {
      busy = false;
      if (!disposed && !retired && (claim || retry || activity || state)) schedule(retry ? RETRY_MS : 0);
      else if (closing) { disposed = true; clearQueue(); }
    }
  }
  function record(type: WorkoutActivityType, occurredAtMillis = now()) {
    if (closing) return;
    const active = type !== 'pause';
    if (!allowed(active)) return;
    expireClaim();
    if (epoch === undefined && !claiming) {
      if (type === 'pause' || type === 'heartbeat') return;
      claim = request('resume', occurredAtMillis); claiming = true;
      void flush();
      return;
    }
    const next = request(type, occurredAtMillis);
    if (type === 'resume' || type === 'progress') {
      activity = next;
      state = null; // A newer explicit action supersedes an unsent pause.
    } else state = next;
    if (type === 'progress') schedule(COALESCE_MS);
    else void flush();
  }
  return {
    resume: () => record('resume'), progress: (occurredAtMillis?: number) => record('progress', occurredAtMillis), pause: () => record('pause'),
    heartbeat: () => record('heartbeat'), flush,
    close: () => { record('pause'); closing = true; void flush(); },
    dispose: () => { disposed = true; clearQueue(); },
  };
}
export type WorkoutActivityReporter = ReturnType<typeof createWorkoutActivity>;
