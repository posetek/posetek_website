/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ enabled: true, failPersonal: false, reads: [] as string[], call: vi.fn() }));
vi.mock('../../../lib/firebase', () => {
  const ref = (path: string): any => ({ collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`), get: async () => {
    f.reads.push(path);
    if (path === 'config/llm') return { data: () => ({ personalWorkoutsEnabled: f.enabled }) };
    if (path.endsWith('/personalWorkoutLogs') && f.failPersonal) throw Error('unavailable');
    return { docs: [{ id: 'same-log', data: () => ({ id: 'spoofed', _workoutSource: 'spoofed', workoutId: 'same-workout', source: 'plan' }) }] };
  } });
  return { db: { collection: (name: string) => ref(name) }, cloud: { httpsCallable: (name: string) => { expect(name).toBe('getWorkoutNotificationStatus'); return f.call; } } };
});
import { getWorkoutNotificationStatus, loadPlayerWorkoutHistory, parseWorkoutFocus, selectWorkoutHistory, workoutFocusQuery, workoutPacificTime } from './workoutNotifications';
import type { RecordedWorkoutLog } from './workoutNotifications';

beforeEach(() => { f.enabled = true; f.failPersonal = false; f.reads = []; f.call.mockReset(); });
describe('exact workout notification links', () => {
  it.each(['workoutLog=one', 'workoutSource=workoutLogs', 'workoutSource=unknown&workoutLog=one',
    'workoutSource=workoutLogs&workoutLog=a%2Fb', 'workoutSource=workoutLogs&workoutLog=..',
    'workoutSource=workoutLogs&workoutLog=one&workoutLog=two'])('does not infer missing or invalid link fields: %s', query => {
    expect(parseWorkoutFocus(new URLSearchParams(query))).toEqual({ kind: 'invalid' });
  });
  it('has no selection without a workout link and preserves scope when a workout is selected', () => {
    expect(parseWorkoutFocus(new URLSearchParams('orgId=club'))).toEqual({ kind: 'none' });
    expect(workoutFocusQuery(new URLSearchParams('orgId=club&teamId=team'), { source: 'personalWorkoutLogs', logId: 'one' }).toString())
      .toBe('orgId=club&teamId=team&workoutSource=personalWorkoutLogs&workoutLog=one');
  });
  it('matches source plus document ID even when IDs collide across collections', async () => {
    const logs = await loadPlayerWorkoutHistory('athlete');
    expect(logs.map(log => [log.id, log._workoutSource, log.source])).toEqual([
      ['same-log', 'workoutLogs', 'plan'], ['same-log', 'personalWorkoutLogs', 'personal'],
    ]);
    const result = selectWorkoutHistory(logs, { kind: 'valid', focus: { source: 'personalWorkoutLogs', logId: 'same-log' } });
    expect(result.focused?.log.source).toBe('personal'); expect(result.rows).toHaveLength(1);
    expect(selectWorkoutHistory(logs, { kind: 'valid', focus: { source: 'workoutLogs', logId: 'missing' } }).focused).toBeNull();
    expect(selectWorkoutHistory(logs, { kind: 'invalid' }).focused).toBeNull();
  });
  it('opens the linked duplicate itself instead of the preferred reporting document', () => {
    const base = { planId: 'plan', workoutId: 'workout', _workoutSource: 'workoutLogs' as const };
    const logs: RecordedWorkoutLog[] = [{ ...base, id: 'exact', blocks: [], endedAt: new Date('2026-09-01') },
      { ...base, id: 'preferred', workoutSnapshot: { title: 'Different saved log' }, endedAt: new Date('2026-09-02') }];
    const result = selectWorkoutHistory(logs, { kind: 'valid', focus: { source: 'workoutLogs', logId: 'exact' } });
    expect(result.focused?.log.id).toBe('exact'); expect(result.focused?.snapshot).toBeNull(); expect(result.rows).toEqual([]);
    expect(selectWorkoutHistory(logs, { kind: 'none' }).rows[0].log.id).toBe('preferred');
  });
  it('formats Pacific time across daylight-saving changes and keeps missing time unknown', () => {
    expect(workoutPacificTime(Date.parse('2026-09-28T12:00:00Z'))).toContain('PDT');
    expect(workoutPacificTime(Date.parse('2026-12-28T12:00:00Z'))).toContain('PST');
    expect(workoutPacificTime(null)).toBe('Not recorded');
  });
});

describe('admin workout reads', () => {
  it('keeps feature-gated personal reads out of inactive deployments', async () => {
    f.enabled = false;
    expect(await loadPlayerWorkoutHistory('athlete')).toHaveLength(1);
    expect(f.reads).not.toContain('players/athlete/personalWorkoutLogs');
  });
  it('does not replace a failed collection with empty history', async () => {
    f.failPersonal = true;
    await expect(loadPlayerWorkoutHistory('athlete')).rejects.toThrow('unavailable');
  });
  it('sends only the exact source and ID to the admin-only status callable', async () => {
    f.call.mockResolvedValue({ data: { notifications: [] } });
    expect(await getWorkoutNotificationStatus('athlete', { source: 'workoutLogs', logId: 'log' })).toEqual({ notifications: [] });
    expect(f.call).toHaveBeenCalledWith({ playerId: 'athlete', source: 'workoutLogs', logId: 'log' });
  });
});
