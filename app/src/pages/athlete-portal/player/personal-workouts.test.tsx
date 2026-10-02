import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'athlete-auth' } }, db: {}, cloud: {}, storage: {} }));
import { normalizeCatalogDrill } from '../../../lib/contracts/drillV2';
import { blockEstimatedMinutes, workoutEstimatedMinutes } from '../../../lib/contracts/expectedMinutes';
import { addPersonalDrill, eligiblePersonalDrill, ensurePersonalSubmission, latestPersonalRevision, personalAge, personalCapabilityEnabled, personalDraft, personalDraftErrors, personalExecution, personalGenerationErrors, personalJobKey, personalLogRows, personalProgress, personalWorkoutPayload, personalWorkoutsEnabled, recomputePersonalDraft, restorePersonalJob } from './personal-workouts';
import type { PendingPersonalJob, PersonalIntake } from './personal-workouts';
import PersonalWorkoutHub from './PersonalWorkoutHub';

const drill = normalizeCatalogDrill('PAS-001', { schemaVersion: 2, name: 'Wall pass', domain: 'passing', status: 'published', minAge: 10, maxAge: 18, difficultyLevel: 2, equipment: ['ball', 'wall'], dose: { setsMin: 1, setsMax: 3, repsMin: 20, repsMax: 60, repUnit: 'seconds', restSecondsMin: 10, restSecondsMax: 60 } });
const intake: PersonalIntake = { age: 15, equipment: ['ball', 'wall'], setting: 'solo', painFlag: false };
const config = { globalEnabled: true, personalWorkoutsEnabled: true, capabilities: Object.fromEntries(['save_personal_workout', 'generate_personal_workout', 'start_personal_workout', 'update_personal_workout_log'].map(c => [c, { enabled: true, dailyLimitPerUser: 10 }])) };

describe('personal workout readiness', () => {
  it('requires literal feature enablement and explicit positive capability quotas', () => {
    expect(personalWorkoutsEnabled(config)).toBe(true);
    for (const c of [null, {}, { ...config, personalWorkoutsEnabled: 'true' }, { ...config, globalEnabled: false }, { ...config, capabilities: {} }, { ...config, unavailable: true }]) expect(personalWorkoutsEnabled(c)).toBe(false);
    for (const dailyLimitPerUser of [0, -1, 1.5, '10']) expect(personalCapabilityEnabled({ ...config, capabilities: { ...config.capabilities, save_personal_workout: { enabled: true, dailyLimitPerUser } } }, 'save_personal_workout')).toBe(false);
    expect(personalWorkoutsEnabled(null, true)).toBe(true);
  });
  it('excludes drafts, expanded training, unknown ages, missing equipment and wrong training settings', () => {
    expect(eligiblePersonalDrill(drill, intake)).toBe(true);
    for (const d of [{ ...drill, status: 'draft' }, { ...drill, trainingPolicy: { version: 'whole-body-v1' } }, { ...drill, requiresPartner: true }, { ...drill, minAge: 16 }]) expect(eligiblePersonalDrill(d as any, intake)).toBe(false);
    expect(eligiblePersonalDrill(drill, { ...intake, equipment: [] })).toBe(false);
    expect(eligiblePersonalDrill(drill, { ...intake, age: undefined })).toBe(false);
    expect(eligiblePersonalDrill(drill, intake, 1)).toBe(false);
  });
  it('uses the actual birthday before an age field and does not invent missing ages', () => {
    expect(personalAge({ birthDate: '2011-10-01', age: 18 }, new Date('2026-09-25T12:00:00'))).toBe(14);
    expect(personalAge({ age: 15 })).toBeUndefined(); expect(personalAge({ age: 15, ageRecordedAt: new Date() })).toBe(15); expect(personalAge({})).toBeUndefined();
  });
  it('rejects stale/future age assertions and falls through an invalid first birthday field', () => {
    const now = new Date('2026-09-25T01:00:00Z');
    expect(personalAge({ age: 15, ageRecordedAt: '2025-09-24' }, now)).toBeUndefined();
    expect(personalAge({ age: 15, ageRecordedAt: '2026-09-26' }, now)).toBeUndefined();
    expect(personalAge({ age: 15, ageRecordedAt: '2026-09-24' }, now)).toBe(15);
    expect(personalAge({ birthday: '2011-09-25' }, now)).toBeUndefined();
    expect(personalAge({ birthDate: 'not-a-date', dateOfBirth: '2011-09-25' }, now)).toBe(15);
    expect(personalAge({ birthDate: '2011-02-31', age: 15, ageRecordedAt: now }, now)).toBe(15);
    expect(personalAge({ birthDate: '2011-02-31' }, now)).toBeUndefined();
  });
  it('rejects invalid generation inputs before persisting a request', () => {
    expect(personalGenerationErrors(intake, 30, 'Work on close control')).toEqual([]);
    expect(personalGenerationErrors({ ...intake, age: 99 }, 0, 'a').length).toBe(3);
    expect(personalGenerationErrors(intake, 2.5, 'Work on close control')).toContain('Choose a whole number from 1 to 135 minutes.');
  });
});

describe('manual personal prescriptions', () => {
  it('uses the shared deterministic minutes formula and preserves the source assignment', () => {
    const source = { title: 'Assigned practice', blocks: [{ ...addPersonalDrill(personalDraft(), drill).blocks[0], blockId: 'b9' }] };
    const before = JSON.stringify(source), copy = personalDraft(source);
    const edited = recomputePersonalDraft({ ...copy, blocks: copy.blocks.map(b => ({ ...b, sets: 3 })) });
    expect(JSON.stringify(source)).toBe(before); expect(source.blocks[0].blockId).toBe('b9');
    expect(edited.estimatedMinutes).toBe(workoutEstimatedMinutes(edited.blocks.map(blockEstimatedMinutes)));
    expect(edited.blocks[0].blockId).toBe('b1');
    expect(personalDraftErrors({ ...edited, budgetMinutes: edited.estimatedMinutes }, [drill], intake)).toEqual([]);
  });
  it('retains existing IDs/counter for edits and never reuses a removed drill ID', () => {
    let d = addPersonalDrill(addPersonalDrill(personalDraft(), drill), drill);
    d = recomputePersonalDraft({ ...d, blocks: d.blocks.filter(b => b.blockId !== 'b2') });
    const restored = personalDraft(d, true), added = addPersonalDrill(restored, drill);
    expect(added.blocks.map(b => b.blockId)).toEqual(['b1', 'b3']);
  });
  it('blocks invalid doses, empty sessions, pain and changed catalog eligibility', () => {
    const d = addPersonalDrill(personalDraft(), drill);
    expect(personalDraftErrors(personalDraft(), [drill], intake)).toContain('Choose between 1 and 12 drills.');
    expect(personalDraftErrors({ ...d, blocks: [{ ...d.blocks[0], sets: 0 }] }, [drill], intake).join(' ')).toContain('Sets must');
    expect(personalDraftErrors({ ...d, blocks: [{ ...d.blocks[0], restSeconds: 2 }] }, [drill], intake).join(' ')).toContain('rest seconds');
    expect(personalDraftErrors(d, [{ ...drill, status: 'archived' }], intake).join(' ')).toContain('unavailable');
    expect(personalDraftErrors(d, [drill], { ...intake, painFlag: true }).join(' ')).toContain('Pause training');
  });
  it('requires target-time alignment and rejects duplicate drills before review', () => {
    const d = addPersonalDrill(personalDraft(), drill);
    expect(personalDraftErrors(d, [drill], intake).join(' ')).toContain('outside your 30-minute target');
    expect(personalDraftErrors({ ...d, budgetMinutes: d.estimatedMinutes }, [drill], intake)).toEqual([]);
    expect(personalDraftErrors(addPersonalDrill(d, drill), [drill], intake).join(' ')).toContain('Use each drill once');
  });
  it('strips unrecognized execution metadata while preserving explicit time inputs', () => {
    const d = addPersonalDrill(personalDraft(), drill);
    const payload = personalWorkoutPayload({ ...d, blocks: [{ ...d.blocks[0], arbitraryInstruction: 'not canonical' } as any] });
    expect(payload.blocks[0]).not.toHaveProperty('arbitraryInstruction');
    expect(payload.blocks[0]).toMatchObject({ restScope: 'sets', restBetweenSetsSeconds: null, familiarizationReps: 0, whyIncluded: 'Personal practice' });
  });
  it('keeps partial skip evidence and sends only permitted log mutation fields', () => {
    const rows = personalLogRows([{ blockId: 'b1', status: 'partial', setsCompleted: 1, skipReason: 'equipment', domain: 'passing', targetSets: 3, estimatedMinutes: 4 }]);
    expect(rows).toEqual([{ blockId: 'b1', status: 'partial', setsCompleted: 1, skipReason: 'equipment' }]);
  });
  it('adapts personal execution without adding a fake plan to the stored log', () => {
    const log = { workoutSnapshot: addPersonalDrill(personalDraft(), drill), workoutRevision: 2, elapsedSeconds: 120 };
    const execution = personalExecution({ workoutId: 'session1' }, log);
    expect(execution).toMatchObject({ id: 'personal_session1', planId: '__personal__', source: 'personal', recoveredActiveSeconds: 120, timerStartedHere: true });
    expect(log).not.toHaveProperty('planId');
  });
  it('counts a personal session once and retains sets completed before skipping', () => {
    const log = { workoutId: 'personal1', endedAt: 'now', elapsedSeconds: 50, blocks: [{ status: 'partial', setsCompleted: 1, skipReason: 'time' }] };
    expect(personalProgress([log, log])).toEqual({ sessions: 1, sets: 1, seconds: 50 });
  });
});

const pending = (): PendingPersonalJob => {
  const params = { expectedRevision: 0, title: 'Practice' };
  return { schemaVersion: 1, uid: 'athlete-auth', playerId: 'player-doc', capability: 'save_personal_workout', jobId: 'stable-job-001', signature: JSON.stringify({ capability: 'save_personal_workout', params }), params: { ...params, requestId: 'stable-request' } };
};
describe('accepted job recovery', () => {
  it('scopes recovery to the same account, player and unchanged request', () => {
    expect(restorePersonalJob(pending(), 'athlete-auth', 'player-doc')).toEqual(pending());
    expect(restorePersonalJob(pending(), 'another', 'player-doc')).toBeNull();
    expect(restorePersonalJob(pending(), 'athlete-auth', 'another')).toBeNull();
    expect(restorePersonalJob({ ...pending(), params: { requestId: 'x' } }, 'athlete-auth', 'player-doc')).toBeNull();
    expect(personalJobKey('a', 'b')).not.toBe(personalJobKey('b', 'a'));
  });
  it('recovers a lost create acknowledgement with the same accepted job, without duplicating it', async () => {
    let exists = false, online = false, accepted = 0, stored: PendingPersonalJob | null = null;
    const create = vi.fn(async (record: PendingPersonalJob) => { expect(record.jobId).toBe('stable-job-001'); if (exists) throw new Error('Create-only job cannot be overwritten'); exists = true; accepted++; throw new Error('Lost acknowledgement'); });
    const port = { persist: (r: PendingPersonalJob) => { stored = r; }, exists: async () => { if (!online) throw new Error('Offline'); return exists; }, create };
    await expect(ensurePersonalSubmission(pending(), port)).rejects.toThrow('Lost acknowledgement');
    expect(stored).toEqual(pending());
    online = true;
    await ensurePersonalSubmission(stored!, port);
    expect(create).toHaveBeenCalledTimes(2); expect(accepted).toBe(1);
  });
  it('creates a fresh job before attempting an owner-scoped read', async () => {
    const read = vi.fn(async () => { throw new Error('Missing document reads are forbidden'); }), create = vi.fn(async () => {});
    await ensurePersonalSubmission(pending(), { persist: () => {}, exists: read, create });
    expect(read).not.toHaveBeenCalled(); expect(create).toHaveBeenCalledOnce();
  });
  it('does not submit if its recovery record cannot be saved', async () => {
    const create = vi.fn();
    await expect(ensurePersonalSubmission(pending(), { persist: () => { throw new Error('Storage unavailable'); }, exists: async () => false, create })).rejects.toThrow('Storage unavailable');
    expect(create).not.toHaveBeenCalled();
  });
  it('distinguishes a definitively declined creation from an ambiguous network failure', async () => {
    const denied = Object.assign(new Error('Denied'), { code: 'permission-denied' });
    await expect(ensurePersonalSubmission(pending(), { persist: () => {}, create: async () => { throw denied; }, exists: async () => { throw denied; } })).rejects.toHaveProperty('definitiveRejection', true);
    const offline = Object.assign(new Error('Offline'), { code: 'unavailable' });
    await expect(ensurePersonalSubmission(pending(), { persist: () => {}, create: async () => { throw offline; }, exists: async () => { throw offline; } })).rejects.not.toHaveProperty('definitiveRejection');
  });
  it('never rolls a newer confirmed record backward when replaying an old result', () => {
    const current = { revision: 3, elapsedSeconds: 160 }, replay = { revision: 2, elapsedSeconds: 120 };
    expect(latestPersonalRevision(current, replay)).toBe(current);
    expect(latestPersonalRevision(replay, current)).toBe(current);
  });
});

describe('personal workout review screens', () => {
  const store = { enabled: true, workouts: [], logs: {}, catalog: [drill], scheduleRevision: 0, loaded: true, saving: false, error: '', status: '', pending: null, proposal: null, clearProposal: vi.fn(), setError: vi.fn() } as any;
  it('offers standalone creation without a training plan', () => {
    const html = renderToStaticMarkup(<PersonalWorkoutHub store={store} playerId="player-doc" athlete={{ age: 15 }} config={config} preview onBack={() => {}} />);
    expect(html).toContain('Create workout'); expect(html).toContain('without a multiweek plan');
  });
  it('opens a conversation without athlete drill editing controls', () => {
    const html = renderToStaticMarkup(<PersonalWorkoutHub store={store} playerId="player-doc" athlete={{ age: 15 }} config={config} preview initialCreate onBack={() => {}} />);
    expect(html).toContain('Create your workout.');
    expect(html).toContain('What do you want to work on?');
    for (const text of ['Add a drill', 'Search drills', 'Fine-tune drills', 'personal-dose-grid', 'personal-drill-actions']) expect(html).not.toContain(text);
  });
  it('labels an assigned copy and requires conditions before review', () => {
    const source = { workout: addPersonalDrill(personalDraft(), drill), reference: { planId: 'assigned', workoutId: 'slot', revision: 3 } };
    const html = renderToStaticMarkup(<PersonalWorkoutHub store={store} playerId="player-doc" athlete={{ age: 15 }} config={config} source={source} preview onBack={() => {}} />);
    expect(html).toContain('Your assigned workout stays as prescribed.');
    expect(html).not.toContain('Create my workout');
    expect(html).toContain('Where will you train?');
  });
});
