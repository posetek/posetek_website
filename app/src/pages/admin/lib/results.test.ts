import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ profileReads: 0, effectiveCalls: 0, fail: false }));
vi.mock('../../../lib/firebase', () => ({
  db: { collection: () => ({ doc: (id: string) => ({ get: async () => { ++f.profileReads; return { id, exists: true, data: () => ({ id: 'spoofed', firstName: 'Alex' }) }; } }) }) },
  cloud: { httpsCallable: (name: string) => async (payload: any) => {
    expect(name).toBe('getAthleteEffectiveResults'); expect(payload).toEqual({ playerId: 'p' }); ++f.effectiveCalls;
    if (f.fail) throw Error('permission-denied'); return { data: { reps: [] } };
  } },
}));
vi.mock('../../athlete-portal/lib/loaders', () => ({ loadFreeRecordReps: async () => [], listFreeRecordStorage: async () => [] }));
import { loadAdminResults } from './results';
beforeEach(() => { f.profileReads = 0; f.effectiveCalls = 0; f.fail = false; });
describe('admin Results within the selected player workspace', () => {
  it('reuses the already-authorized athlete header without another profile read', async () => {
    const athlete = { id: 'p', firstName: 'Alex' };
    expect((await loadAdminResults('p', athlete)).athlete).toBe(athlete);
    expect(f.profileReads).toBe(0); expect(f.effectiveCalls).toBe(1);
  });
  it('keeps legacy standalone reads working with the actual document ID', async () => {
    expect((await loadAdminResults('p')).athlete.id).toBe('p');
    expect(f.profileReads).toBe(1); expect(f.effectiveCalls).toBe(1);
  });
  it('rejects a retained profile from another athlete before reading evidence', async () => {
    await expect(loadAdminResults('p', { id: 'other' })).rejects.toThrow('selected athlete changed');
    expect(f.effectiveCalls).toBe(0); expect(f.profileReads).toBe(0);
  });
  it('does not replace denied evidence with empty testing results', async () => {
    f.fail = true;
    await expect(loadAdminResults('p', { id: 'p' })).rejects.toThrow('permission-denied');
  });
});
