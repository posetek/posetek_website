import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { uid: 'owner' } as { uid: string } | null, profile: {} as any, update: vi.fn(), serverTimestamp: vi.fn(() => new Date()), runTransaction: vi.fn(), get: vi.fn() }));
vi.mock('../../../lib/firebase', () => ({
  default: { firestore: { FieldValue: { serverTimestamp: mocks.serverTimestamp } } },
  auth: { get currentUser() { return mocks.user; } },
  db: { collection: () => ({ doc: () => ({ get: mocks.get }) }), runTransaction: mocks.runTransaction },
}));
import { readOwnPlayerAge, saveOwnPlayerAge } from './player-age';

beforeEach(() => {
  vi.clearAllMocks(); mocks.user = { uid: 'owner' }; mocks.profile = { authenticationUID: 'owner', age: 15, ageRecordedAt: new Date('2020-01-01') };
  mocks.get.mockImplementation(async () => ({ exists: true, data: () => mocks.profile }));
  mocks.update.mockImplementation((_ref, patch) => { mocks.profile = { ...mocks.profile, ...patch }; });
  mocks.runTransaction.mockImplementation(async callback => callback({ get: mocks.get, update: mocks.update }));
});
describe('owner-confirmed profile age', () => {
  it('refreshes the same integer age with a server-dated observation and leaves birth date absent', async () => {
    const profile = await saveOwnPlayerAge('player', 'owner', 15);
    expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.serverTimestamp).toHaveBeenCalledTimes(2);
    expect(profile.age).toBe(15); expect(profile.ageRecordedAt.getUTCFullYear()).toBe(new Date().getUTCFullYear());
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('birthDate');
  });
  it('rejects a recorded birthday instead of overwriting its derived age', async () => {
    mocks.profile.birthDate = '2011-10-01';
    await expect(saveOwnPlayerAge('player', 'owner', 20)).rejects.toThrow('birthday is already recorded');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('allows a confirmed age when an impossible legacy birthday is unusable', async () => {
    mocks.profile.birthDate = '2011-02-31';
    const profile = await saveOwnPlayerAge('player', 'owner', 15);
    expect(profile.age).toBe(15); expect(profile.birthDate).toBe('2011-02-31');
  });
  it('rejects another owner or changed authentication binding before writing', async () => {
    mocks.profile.authenticationUID = 'another';
    await expect(saveOwnPlayerAge('player', 'owner', 15)).rejects.toThrow('Only the player');
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.user = null; await expect(saveOwnPlayerAge('player', 'owner', 15)).rejects.toThrow('Sign in again');
  });
  it('rejects invalid ages and reads only currently owner-bound recorded observations', async () => {
    await expect(saveOwnPlayerAge('player', 'owner', 4)).rejects.toThrow('actual age');
    await expect(saveOwnPlayerAge('player', 'owner', 15.5)).rejects.toThrow('actual age');
    expect(await readOwnPlayerAge('player', 'owner')).toBeUndefined();
    mocks.profile.ageRecordedAt = new Date(); expect(await readOwnPlayerAge('player', 'owner')).toBe(15);
    mocks.profile.authenticationUID = 'another'; expect(await readOwnPlayerAge('player', 'owner')).toBeUndefined();
  });
});
