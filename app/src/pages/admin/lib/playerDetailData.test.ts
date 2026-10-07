import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ reads: [] as string[], noteFailure: false, historyFailure: false }));
vi.mock('./accounts', () => ({
  loadCoachOfPlayer: async () => { f.reads.push('coach'); return null; },
  loadCoachNote: async () => { f.reads.push('private-note'); if (f.noteFailure) throw Error('permission-denied'); return null; },
  loadPlayerPlans: async () => { f.reads.push('plans'); return [{ id: 'active', status: 'active' }]; },
  activePlan: (plans: any[]) => plans[0] || null,
  loadPlanAdjustments: async (id: string, plan: string) => { f.reads.push(`adjustments/${id}/${plan}`); return []; },
}));
vi.mock('../../../lib/firebase', () => {
  const ref = (path: string): any => ({ collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`), get: async () => {
    f.reads.push(path);
    if (path === 'config/llm') return { data: () => ({ personalWorkoutsEnabled: true }) };
    if (f.historyFailure && path.endsWith('/personalWorkoutLogs')) throw Error('permission-denied');
    return { docs: [{ id: 'record', data: () => ({ planId: 'active' }) }] };
  } });
  return { db: { collection: (name: string) => ref(name) }, cloud: {} };
});
import { loadPlayerProfileData, loadPlayerWorkoutsData, playerDetailPanel } from './playerDetailData';
import type { PlayerRow } from './accounts';
const player: PlayerRow = { id: 'p', name: 'Athlete', email: '', registered: true, organizationId: 'club', teamId: 'team',
  coachId: null, signupCode: null, raw: {} };
beforeEach(() => { f.reads = []; f.noteFailure = false; f.historyFailure = false; });

describe('admin player panel boundaries', () => {
  it('loads only coach and private-note inputs for Profile', async () => {
    await expect(loadPlayerProfileData(player)).resolves.toEqual({ coach: null, note: null });
    expect(f.reads).toEqual(['coach', 'private-note']);
  });
  it('reads workout collections and feature config exactly once for the entire Workouts panel', async () => {
    const data = await loadPlayerWorkoutsData('p');
    expect(f.reads).toEqual(['plans', 'players/p/workoutLogs', 'config/llm', 'players/p/personalWorkoutLogs', 'adjustments/p/active']);
    expect(data.logs.map(log => log._workoutSource)).toEqual(['workoutLogs', 'personalWorkoutLogs']);
    expect(data.plan?.id).toBe('active');
    expect(f.reads).not.toContain('coach'); expect(f.reads).not.toContain('private-note');
  });
  it('does not turn a denied private note into an empty editable note', async () => {
    f.noteFailure = true;
    await expect(loadPlayerProfileData(player)).rejects.toThrow('permission-denied');
  });
  it('does not display partial workout evidence after a denied collection read', async () => {
    f.historyFailure = true;
    await expect(loadPlayerWorkoutsData('p')).rejects.toThrow('permission-denied');
    expect(f.reads.some(path => path.startsWith('adjustments/'))).toBe(false);
  });
});
describe('legacy player destinations', () => {
  it('defaults every plain player name link to Results', () => {
    expect(playerDetailPanel(new URLSearchParams())).toBe('results');
    expect(playerDetailPanel(new URLSearchParams('playerTab=unknown'))).toBe('results');
  });
  it('opens existing exact saved-workout links without losing the target', () => {
    const query = new URLSearchParams('workoutSource=personalWorkoutLogs&workoutLog=exact');
    expect(playerDetailPanel(query)).toBe('workouts');
    expect(query.get('workoutLog')).toBe('exact');
  });
  it('gives explicit Results drill routes priority and explicit panel choices priority over old workout focus', () => {
    expect(playerDetailPanel(new URLSearchParams('playerTab=profile&workoutLog=exact'), true)).toBe('results');
    expect(playerDetailPanel(new URLSearchParams('playerTab=profile&workoutLog=exact'))).toBe('profile');
  });
});
