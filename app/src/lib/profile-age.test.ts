import { describe, expect, it } from 'vitest';
import { resolveProfileAge } from './profile-age';
const now = new Date('2026-10-01T12:00:00Z'), year = 365 * 86400000;
describe('shared profile age eligibility', () => {
  it('uses valid DOB before age observations, with UTC birthday boundaries', () => {
    expect(resolveProfileAge({ birthDate: '2011-10-02', age: 30, ageRecordedAt: now }, now).age).toBe(14);
    expect(resolveProfileAge({ birthDate: '2011-10-02' }, new Date('2026-10-02T00:00:00Z')).age).toBe(15);
    expect(resolveProfileAge({ birthDate: { toDate: () => new Date('2011-10-01T00:00:00Z') } }, now)).toMatchObject({ age: 15, source: 'birthDate', stale: false });
  });
  it('rejects impossible or future birthdays and tries legacy DOB before a fresh observation', () => {
    expect(resolveProfileAge({ birthDate: '2011-02-31', dateOfBirth: '2010-10-01' }, now)).toMatchObject({ age: 16, source: 'legacyDateOfBirth' });
    expect(resolveProfileAge({ birthDate: '2011-02-31T00:00:00Z' }, now).age).toBeNull();
    expect(resolveProfileAge({ birthDate: '2027-10-01', age: 15, ageRecordedAt: now }, now)).toMatchObject({ age: 15, source: 'playerDocAge' });
    expect(resolveProfileAge({ birthDate: '2020-02-29' }, now).age).toBe(6);
    expect(resolveProfileAge({ birthDate: '2011-13-01', age: 15, ageRecordedAt: now }, now).age).toBe(15);
  });
  it('only authorizes a bounded integer observation dated between now and365 days ago', () => {
    expect(resolveProfileAge({ age: 15, ageRecordedAt: new Date(now.getTime() - year) }, now)).toMatchObject({ age: 15, stale: false, observationStatus: 'current' });
    for (const [ageRecordedAt, status] of [[undefined, 'undated'], [new Date(now.getTime() - year - 1), 'stale'], [new Date(now.getTime() + 1), 'future']] as const) {
      expect(resolveProfileAge({ age: 15, ageRecordedAt }, now)).toMatchObject({ age: null, source: 'playerDocAge', stale: true, recordedAge: 15, observationStatus: status });
    }
    for (const age of ['15', 15.5, 4, 81]) expect(resolveProfileAge({ age, ageRecordedAt: now }, now)).toMatchObject({ age: null, observationStatus: 'invalid' });
    expect(resolveProfileAge({ age: 15, ageRecordedAt: '2011-02-31' }, now).age).toBeNull();
  });
});
