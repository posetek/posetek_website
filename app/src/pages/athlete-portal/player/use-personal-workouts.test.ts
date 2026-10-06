import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  uid: 'assessment-test-owner', allocated: 0, storage: new Map<string, string>(), jobs: new Map<string, any>(),
  observers: new Map<string, (snapshot: any) => void>(), set: vi.fn(), observe: vi.fn(), stop: vi.fn(),
}));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial: any) => ({ current: initial }), useEffect: () => {},
}));
vi.mock('../../../lib/firebase', () => ({
  default: { firestore: { FieldValue: { serverTimestamp: () => 'server-timestamp' } } },
  auth: { get currentUser() { return { uid: harness.uid }; } },
  db: { collection: () => ({ doc: (provided?: string) => {
    const id = provided || `assessmentJob${String(++harness.allocated).padStart(4, '0')}`;
    return { id, set: (value: any) => harness.set(id, value),
      get: async () => ({ exists: harness.jobs.has(id), data: () => harness.jobs.get(id) }),
      onSnapshot: (next: (snapshot: any) => void) => harness.observe(id, next),
    };
  } }) },
}));
import { usePersonalWorkouts } from './use-personal-workouts';

const config = { globalEnabled: true, personalWorkoutsEnabled: true, capabilities: { assess_personal_workout: { enabled: true } } };
const params = { scheduledDate: '2026-10-01', timezone: 'UTC', timeAvailableMinutes: 30,
  intake: { age: 21, equipment: ['cones', 'markers', 'timer', 'ball', 'goal'], setting: 'solo', painFlag: false,
    focusDomains: ['speed', 'agility'], access: { facility: 'pitch', participantCount: 1, confirmed: true, space: { assumedSufficient: true } } } };
const result = { schemaVersion: 1, supportedMinutes: [], scheduleRevision: 0,
  limitations: [{ code: 'age_ineligible', domain: 'speed', message: 'The available Speed library does not include age 21.' }] };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const receipt = () => JSON.parse([...harness.storage.values()][0]);
const emit = (id: string) => harness.observers.get(id)?.({ data: () => harness.jobs.get(id) });

describe('recoverable workout setup assessment', () => {
  beforeEach(() => {
    vi.useFakeTimers(); harness.uid = 'assessment-test-owner'; harness.allocated = 0;
    harness.storage.clear(); harness.jobs.clear(); harness.observers.clear();
    harness.set.mockReset(); harness.observe.mockReset(); harness.stop.mockReset();
    vi.stubGlobal('window', { setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (timer: any) => clearTimeout(timer) });
    vi.stubGlobal('localStorage', { getItem: (key: string) => harness.storage.get(key) || null,
      setItem: (key: string, value: string) => harness.storage.set(key, value), removeItem: (key: string) => harness.storage.delete(key) });
    harness.set.mockImplementation(async (id: string, value: any) => {
      if (harness.jobs.has(id)) throw Object.assign(new Error('Create-only job already exists'), { code: 'permission-denied' });
      harness.jobs.set(id, value);
    });
    harness.observe.mockImplementation((id: string, next: (snapshot: any) => void) => {
      harness.observers.set(id, next); next({ data: () => harness.jobs.get(id) });
      return () => { harness.stop(id); if (harness.observers.get(id) === next) harness.observers.delete(id); };
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('bounds a lost create acknowledgement and recovers the same accepted job after its late completion', async () => {
    const acknowledgement = deferred();
    harness.set.mockImplementationOnce((id: string, value: any) => { harness.jobs.set(id, value); return acknowledgement.promise; });
    const store = usePersonalWorkouts('synthetic-player', false, config), pending = store.assess(params);
    const rejected = expect(pending).rejects.toThrow('Retry to recover the same check');
    await vi.advanceTimersByTimeAsync(20000); await rejected;
    const saved = receipt(); expect(saved.terminalFailed).not.toBe(true); expect(harness.observe).not.toHaveBeenCalled();
    harness.jobs.set(saved.jobId, { ...harness.jobs.get(saved.jobId), status: 'complete', result });
    acknowledgement.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(harness.observe).not.toHaveBeenCalled(); expect(receipt().jobId).toBe(saved.jobId);
    await expect(usePersonalWorkouts('synthetic-player', false, config).assess(params)).resolves.toEqual(result);
    expect(harness.allocated).toBe(1); expect(harness.jobs.size).toBe(1);
    expect(harness.set.mock.calls[1][0]).toBe(saved.jobId);
    expect(harness.set.mock.calls[1][1].params.requestId).toBe(saved.params.requestId);
    expect(harness.storage.size).toBe(0); expect(harness.stop).toHaveBeenCalledTimes(1);
  });

  it('stops a timed-out observer but preserves its job for a completed-result retry', async () => {
    const store = usePersonalWorkouts('synthetic-player', false, config), pending = store.assess(params);
    const rejected = expect(pending).rejects.toThrow('taking longer than expected');
    await vi.advanceTimersByTimeAsync(20000); await rejected;
    const saved = receipt(); expect(harness.observers.size).toBe(0); expect(harness.stop).toHaveBeenCalledTimes(1);
    harness.jobs.set(saved.jobId, { ...harness.jobs.get(saved.jobId), status: 'complete', result });
    await expect(store.assess(params)).resolves.toEqual(result);
    expect(harness.jobs.size).toBe(1); expect(harness.allocated).toBe(1); expect(harness.storage.size).toBe(0);
  });

  it('marks a terminal failure and starts a new check only after that failed result', async () => {
    harness.set.mockImplementation(async (id: string, value: any) => { harness.jobs.set(id, { ...value,
      status: harness.allocated === 1 ? 'failed' : 'complete', error: { message: 'Assessment unavailable' }, result }); });
    const store = usePersonalWorkouts('synthetic-player', false, config);
    await expect(store.assess(params)).rejects.toThrow('Assessment unavailable');
    const saved = receipt(); expect(saved.terminalFailed).toBe(true);
    await expect(store.assess(params)).resolves.toEqual(result);
    expect(harness.allocated).toBe(2); expect(harness.set.mock.calls[1][0]).not.toBe(saved.jobId);
  });

  it('does not replace a newer setup receipt when an older assessment fails', async () => {
    const store = usePersonalWorkouts('synthetic-player', false, config), first = store.assess(params);
    const rejected = expect(first).rejects.toThrow('Older check failed');
    await vi.advanceTimersByTimeAsync(0); const firstId = receipt().jobId;
    const second = store.assess({ ...params, timeAvailableMinutes: 25 });
    await vi.advanceTimersByTimeAsync(0); const newer = receipt(); expect(newer.jobId).not.toBe(firstId);
    harness.jobs.set(firstId, { ...harness.jobs.get(firstId), status: 'failed', error: { message: 'Older check failed' } }); emit(firstId); await rejected;
    expect(receipt().jobId).toBe(newer.jobId); expect(receipt().terminalFailed).not.toBe(true);
    harness.jobs.set(newer.jobId, { ...harness.jobs.get(newer.jobId), status: 'complete', result }); emit(newer.jobId);
    await expect(second).resolves.toEqual(result);
  });

  it('does not attach an old-owner observer after a delayed submission acknowledgement', async () => {
    const acknowledgement = deferred();
    harness.set.mockImplementationOnce((id: string, value: any) => { harness.jobs.set(id, value); return acknowledgement.promise; });
    const pending = usePersonalWorkouts('synthetic-player', false, config).assess(params);
    const rejected = expect(pending).rejects.toThrow('selected player changed');
    harness.uid = 'different-owner'; acknowledgement.resolve(); await rejected;
    expect(harness.observe).not.toHaveBeenCalled(); expect(receipt().uid).toBe('assessment-test-owner');
  });
});
