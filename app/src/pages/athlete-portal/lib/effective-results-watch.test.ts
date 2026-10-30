import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  uid: 'owner' as string | undefined,
  changed: undefined as undefined | ((user: { uid: string } | null) => void),
  snapshot: undefined as undefined | (() => void), failure: undefined as undefined | ((e: Error) => void),
  call: vi.fn(), stopAuth: vi.fn(), stopReps: vi.fn(), path: vi.fn(),
}));
vi.mock('../../../lib/firebase', () => ({
  auth: { get currentUser() { return mock.uid ? { uid: mock.uid } : null; }, onAuthStateChanged: (fn: typeof mock.changed) => { mock.changed = fn; return mock.stopAuth; } },
  cloud: { httpsCallable: () => mock.call },
  db: { collection: (name: string) => ({ doc: (id: string) => ({ collection: (sub: string) => ({ onSnapshot: (next: typeof mock.snapshot, error: typeof mock.failure) => { mock.path(name, id, sub); mock.snapshot = next; mock.failure = error; return mock.stopReps; } }) }) }) },
}));
import { watchEffectiveResults } from './effective-results-watch';
import { reviewedResultFixtures } from '../../../lib/reviewed-results-fixtures';
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (reason: Error) => void;
  return { promise: new Promise((yes, no) => { resolve = yes; reject = no; }), resolve: (v: unknown) => resolve(v), reject: (e: Error) => reject(e) };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let stop: (() => void) | undefined;
beforeEach(() => { vi.resetAllMocks(); mock.uid = 'owner'; mock.changed = undefined; mock.snapshot = undefined; mock.failure = undefined; });
afterEach(() => stop?.());
function start() { const callbacks = { pending: vi.fn(), result: vi.fn(), error: vi.fn() }; stop = watchEffectiveResults('synthetic-player', callbacks); return callbacks; }
describe('effective results live refresh isolation', () => {
  it('invalidates first, reads the exact player, then accepts only the newest completed response', async () => {
    const older = deferred(), newer = deferred(); mock.call.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const callbacks = start(); mock.snapshot!(); mock.snapshot!();
    expect(mock.path).toHaveBeenCalledWith('players', 'synthetic-player', 'reps');
    expect(mock.call).toHaveBeenCalledWith({ playerId: 'synthetic-player' });
    expect(callbacks.pending).toHaveBeenCalledTimes(2);
    const payload = { reps: reviewedResultFixtures() };
    newer.resolve({ data: payload }); await settle();
    older.resolve({ data: { reps: [] } }); await settle();
    expect(callbacks.result).toHaveBeenCalledExactlyOnceWith(payload);
  });
  it('clears on failed refresh or malformed response instead of retaining the previous review', async () => {
    mock.call.mockResolvedValueOnce({ data: { reps: reviewedResultFixtures() } }).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ data: {} });
    const callbacks = start(); mock.snapshot!(); await settle();
    expect(callbacks.result).toHaveBeenCalledTimes(1);
    callbacks.pending.mockClear(); mock.snapshot!(); await settle();
    expect(callbacks.pending).toHaveBeenCalled(); expect(callbacks.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'unavailable' }));
    mock.snapshot!(); await settle();
    expect(callbacks.result).toHaveBeenCalledTimes(1);
    expect(callbacks.error).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'The latest results could not be verified.' }));
  });
  it.each(['other', undefined])('ignores an old owner response after switching to %s', async uid => {
    const pending = deferred(); mock.call.mockReturnValueOnce(pending.promise);
    const callbacks = start(); mock.snapshot!();
    mock.uid = uid; mock.changed!(uid ? { uid } : null);
    pending.resolve({ data: { reps: reviewedResultFixtures() } }); await settle();
    expect(callbacks.pending).toHaveBeenCalledTimes(2); expect(callbacks.result).not.toHaveBeenCalled();
    mock.snapshot!(); expect(mock.call).toHaveBeenCalledTimes(1);
  });
  it('invalidates an in-flight response on subscription failure and cleans up on unmount', async () => {
    const pending = deferred(); mock.call.mockReturnValueOnce(pending.promise);
    const callbacks = start(); mock.snapshot!(); mock.failure!(new Error('permission denied'));
    pending.resolve({ data: { reps: reviewedResultFixtures() } }); await settle();
    expect(callbacks.result).not.toHaveBeenCalled(); expect(callbacks.error).toHaveBeenCalledOnce();
    stop!(); stop = undefined;
    expect(mock.stopAuth).toHaveBeenCalledOnce(); expect(mock.stopReps).toHaveBeenCalledOnce();
  });
  it('does not accept an in-flight response after unmount', async () => {
    const pending = deferred(); mock.call.mockReturnValueOnce(pending.promise);
    const callbacks = start(); mock.snapshot!(); stop!(); stop = undefined;
    pending.resolve({ data: { reps: reviewedResultFixtures() } }); await settle();
    expect(callbacks.result).not.toHaveBeenCalled(); expect(callbacks.error).not.toHaveBeenCalled();
  });
});
