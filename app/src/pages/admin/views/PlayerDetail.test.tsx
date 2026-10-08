import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ panels: [] as string[], loads: 0 }));
vi.mock('../../../lib/firebase', () => ({ auth: {}, db: {}, cloud: {} }));
vi.mock('../lib/accounts', () => ({
  COACH_NOTE_MAX_CHARS: 500, loadPlayer: vi.fn(), savePlayerProfile: vi.fn(), saveCoachNote: vi.fn(), clearCoachNote: vi.fn(),
  activePlan: vi.fn(), loadCoachNote: vi.fn(), loadCoachOfPlayer: vi.fn(), loadPlanAdjustments: vi.fn(), loadPlayerPlans: vi.fn(),
  eligibilityFor: () => ({ maxDrillDifficulty: 5, source: 'default' }),
  resolvePlayerAge: () => ({ age: null, recordedAge: null, source: 'unknown', stale: false }),
}));
vi.mock('../lib/useAccountLoad', () => ({ useAccountLoad: () => {
  ++f.loads;
  return { state: { kind: 'ready', data: { coach: null, note: null, plan: null, plans: [], logs: [], adjustments: [], checkedAt: 0 } }, refresh: vi.fn() };
} }));
vi.mock('./AdminResults', () => ({ default: () => { f.panels.push('results'); return <p>Recorded results fixture</p>; } }));
vi.mock('./PlayerAiIncidents', () => ({ default: () => { f.panels.push('ai-incidents'); return <p>AI incidents fixture</p>; } }));
vi.mock('./PlayerWorkoutHistory', () => ({ PlayerWorkoutHistoryContent: () => { f.panels.push('workouts'); return <p>Workout activity fixture</p>; } }));
import { PlayerDetailContent } from './PlayerDetail';
import type { PlayerRow } from '../lib/accounts';
import type { PlayerDetailPanel } from '../lib/playerDetailData';
const player: PlayerRow = { id: 'athlete', name: 'Test athlete', email: 'athlete@example.test', registered: true,
  organizationId: 'current-org', teamId: 'current-team', coachId: null, signupCode: null, raw: {} };
const location = '/admin/accounts/player/athlete?orgId=old-org&teamId=old-team&search=Alex&page=2&returnTo=' + encodeURIComponent('/admin/accounts?orgId=old-org&search=Alex&page=2');
const render = (panel: PlayerDetailPanel) => renderToStaticMarkup(<MemoryRouter initialEntries={[location]}>
  <PlayerDetailContent player={player} panel={panel} onProfileSaved={async () => {}} />
</MemoryRouter>);
beforeEach(() => { f.panels = []; f.loads = 0; });
describe('full-width player workspace', () => {
  it.each(['results', 'workouts', 'profile', 'ai-incidents'] as const)('mounts only the selected %s panel', panel => {
    const html = render(panel);
    expect(f.panels).toEqual(panel === 'profile' ? [] : [panel]);
    // The summary has one common bounded organization validation; only the active evidence panel adds a reader.
    expect(f.loads).toBe(['profile', 'workouts'].includes(panel) ? 2 : 1);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(html).toContain(`id="admin-player-panel-${panel}"`);
    expect(html).toContain(`aria-labelledby="admin-player-tab-${panel}"`);
  });
  it('provides four manually activated keyboard tabs and a full-width panel', () => {
    const html = render('results');
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(html).toContain('Prescribe workouts'); expect(html).toContain('Read-only player preview');
  });
  it('prefills the planner with current ownership while preserving the prior directory return', () => {
    const html = render('profile');
    expect(html).toContain('href="/admin/programs?orgId=current-org&amp;teamId=current-team&amp;players=athlete');
    expect(html).toContain('href="/admin/accounts?orgId=old-org&amp;search=Alex&amp;page=2"');
    expect(html).toContain('returnTo=');
  });
  it('has no athlete execution commands in an administrative evidence view', () => {
    const html = render('workouts');
    expect(html).not.toContain('Start workout'); expect(html).not.toContain('Complete workout');
    expect(html).not.toContain('Resume workout');
  });
});
