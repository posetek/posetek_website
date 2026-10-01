import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ states: [] as any[], refs: [] as { current: any }[], index: 0, refIndex: 0,
  effects: [] as { run: () => void | (() => void); dependencies?: any[] }[], step: undefined as string | undefined,
  assessment: null as any, checking: false, failure: '', assess: vi.fn(), generate: vi.fn(), saveAge: vi.fn(), storage: new Map<string, string>(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const index = harness.index++;
    if (!(index in harness.states)) harness.states[index] = index === 3 && harness.step ? harness.step : index === 8 ? harness.assessment : index === 9 ? harness.checking : index === 11 ? harness.failure : typeof initial === 'function' ? initial() : initial;
    return [harness.states[index], (next: any) => { harness.states[index] = typeof next === 'function' ? next(harness.states[index]) : next; }];
  },
  useRef: (initial: any) => harness.refs[harness.refIndex++] ||= { current: initial }, useId: () => 'wizard-test',
  useEffect: (run: () => void | (() => void), dependencies?: any[]) => { harness.effects.push({ run, dependencies }); },
}));
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'wizard-owner' } }, db: {}, cloud: {}, storage: {} }));
vi.mock('./player-age', () => ({ readOwnPlayerAge: async () => 21, saveOwnPlayerAge: harness.saveAge }));
import WorkoutSetupWizard from './WorkoutSetupWizard';
import { locationSetup } from './training-access';
import { rememberGuidedWorkout } from './guided-workout';

const setup = { ...locationSetup('pitch'), equipment: ['cones', 'markers', 'timer', 'ball', 'goal'] };
const unavailable = { schemaVersion: 1, supportedMinutes: [], scheduleRevision: 0, limitations: [
  { code: 'age_ineligible', domain: 'speed', message: 'The available Speed library covers ages 9–19, and does not include age 21.' },
  { code: 'age_ineligible', domain: 'agility', message: 'The available Agility library covers ages 9–19, and does not include age 21.' },
] };
const short = { schemaVersion: 1, supportedMinutes: Array.from({ length: 10 }, (_, index) => index + 1), scheduleRevision: 3, limitations: [] };
const props = { store: { ownerUid: 'wizard-owner', scheduleRevision: 0, assess: harness.assess } as any,
  playerId: 'wizard-player', athlete: { age: 21, ageRecordedAt: new Date() }, setup, onSetup: () => {}, initialRequest: '', initialMinutes: 30,
  initialFocus: ['speed', 'agility'], scheduledDate: '2026-10-01', onDate: () => {}, today: '2026-10-01', latestDate: '2026-10-29', timezone: 'UTC',
  preview: true, disabled: false, onGenerate: harness.generate };
function render(overrides = {}) {
  harness.index = 0; harness.refIndex = 0; harness.effects.length = 0;
  return WorkoutSetupWizard({ ...props, ...overrides });
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
}
function search(node: any, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) { const match = search(child, predicate); if (match) return match; } return; }
  if (predicate(node)) return node;
  return search(node.props?.children, predicate);
}
function find(node: any, predicate: (element: ReactElement<any>) => boolean) {
  const match = search(node, predicate); if (!match) throw new Error('Expected rendered control missing'); return match;
}
const button = (tree: ReactElement<any>, label: string | RegExp) => find(tree, element => element.type === 'button' && (typeof label === 'string' ? text(element) === label : label.test(text(element))));
const range = (tree: ReactElement<any>) => search(tree, element => element.type === 'input' && element.props.type === 'range');
const runCheck = () => { const effect = harness.effects.find(effect => effect.dependencies?.length === 7); if (!effect) throw new Error('Assessment effect missing'); return effect.run(); };

describe('workout availability and recovery', () => {
  beforeEach(() => {
    harness.states.length = 0; harness.refs.length = 0; harness.effects.length = 0; harness.storage.clear();
    harness.step = 'time'; harness.assessment = null; harness.checking = false; harness.failure = '';
    harness.assess.mockReset(); harness.generate.mockReset().mockResolvedValue(false); harness.saveAge.mockReset();
    vi.stubGlobal('localStorage', { getItem: (key: string) => harness.storage.get(key) || null, setItem: (key: string, value: string) => harness.storage.set(key, value), removeItem: (key: string) => harness.storage.delete(key) });
    vi.stubGlobal('window', { setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (timer: any) => clearTimeout(timer), location: { reload: vi.fn() } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('shows a completed age-coverage limit without a dead slider, checking text or a misleading setup retry', () => {
    harness.assessment = unavailable; const tree = render();
    expect(range(tree)).toBeUndefined(); expect(text(tree)).not.toMatch(/Checking|safe|unsafe/i);
    expect(text(tree)).toContain('No eligible workout is available'); expect(text(tree)).toContain(unavailable.limitations[0].message);
    expect(text(tree)).toContain('30 minutes'); expect(text(tree)).toContain('Your requested time is saved.');
    expect(search(tree, element => element.type === 'button' && /^Next/.test(text(element)))).toBeUndefined();
    expect(search(tree, element => element.type === 'button' && text(element) === 'Change setup')).toBeUndefined();
    button(tree, 'Change focus').props.onClick(); expect(text(render())).toContain('What do you want to work on?');
    expect(harness.saveAge).not.toHaveBeenCalled(); expect(harness.generate).not.toHaveBeenCalled();
  });

  it('retains generic setup recovery when the authoritative limit is not an age gap', () => {
    harness.assessment = { ...unavailable, limitations: [{ code: 'equipment_unavailable', message: 'No available drill fits this equipment.' }] };
    const tree = render(); expect(button(tree, 'Change setup').props.disabled).not.toBe(true);
    button(tree, 'Change setup').props.onClick(); expect(text(render())).toContain('Your training setting');
  });

  it('allows an exact target to be preselected while checking but cannot advance before assessment', () => {
    harness.checking = true; let tree = render(); expect(text(tree)).toContain('Checking the available drills and times');
    expect(range(tree)).toBeUndefined(); expect(button(tree, /^Next/).props.disabled).toBe(true);
    const number = find(tree, element => element.type === 'input' && element.props.type === 'number'); expect(number.props.disabled).not.toBe(true);
    number.props.onChange({ target: { value: '35' } }); tree = render(); expect(text(tree)).toContain('35 minutes');
    button(tree, /^Next/).props.onClick(); expect(text(render())).toContain('How much time do you have?'); expect(harness.generate).not.toHaveBeenCalled();
  });

  it('keeps an assessment error visible across Back/Next and gives an explicit retry', () => {
    harness.failure = 'The setup check timed out. Retry to recover the same check.'; let tree = render();
    expect(text(tree)).toContain(harness.failure); expect(text(tree)).not.toContain('Checking'); expect(range(tree)).toBeUndefined();
    button(tree, 'Back').props.onClick(); tree = render(); button(tree, /^Next/).props.onClick(); tree = render();
    expect(text(tree)).toContain(harness.failure); button(tree, 'Retry setup check').props.onClick(); expect(harness.states[12]).toBe(1);
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('offers only supported 5/10-minute slider values, retains target30, and generates only after explicit acceptance', async () => {
    harness.assessment = short; let tree = render({ initialFocus: ['strength'] });
    expect(range(tree)?.props.max).toBe(1); expect(range(tree)?.props['aria-valuetext']).toBe('10 minutes');
    expect(text(tree)).toContain('30-minute target is outside'); expect(button(tree, /^Next/).props.disabled).toBe(true);
    button(tree, 'Use 10 minutes').props.onClick(); tree = render(); expect(button(tree, /^Next/).props.disabled).toBe(false);
    button(tree, /^Next/).props.onClick(); tree = render(); button(tree, 'No, ready to train').props.onClick(); tree = render();
    expect(button(tree, 'Create my workout').props.disabled).toBe(false); await button(tree, 'Create my workout').props.onClick();
    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect(harness.generate.mock.calls[0][0]).toMatchObject({ timeAvailableMinutes: 10, expectedScheduleRevision: 3,
      intake: { age: 21, focusDomains: ['strength'], access: { facility: 'pitch' } } });
    expect(harness.saveAge).not.toHaveBeenCalled();
  });

  it('supports valid exact-minute targets even when the assessment contains no five-minute slider tick', () => {
    harness.assessment = { ...short, supportedMinutes: [2, 3, 4, 61] }; let tree = render(); expect(range(tree)).toBeUndefined();
    expect(find(tree, element => element.type === 'details' && element.props.className === 'workout-custom-time').props.open).toBe(true);
    button(tree, 'Use 4 minutes').props.onClick(); tree = render(); expect(button(tree, /^Next/).props.disabled).toBe(false); expect(text(tree)).not.toContain('Checking');
  });

  it('recovers an old Ready-step draft as an adjustment screen when no time is available', () => {
    harness.step = undefined; harness.assessment = unavailable;
    rememberGuidedWorkout('wizard-owner', 'wizard-player', { focusDomains: ['speed', 'agility'], minutes: 30, setup, scheduledDate: '2026-10-01', step: 'ready' });
    const tree = render({ initialFocus: undefined, initialMinutes: undefined }); expect(text(tree)).toContain('Adjust your workout choices.');
    expect(text(tree)).toContain('21 years'); expect(button(tree, 'Change focus')).toBeTruthy();
    expect(search(tree, element => element.type === 'button' && text(element) === 'Create my workout')).toBeUndefined();
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('treats an incomplete server result as a retryable error, never as no eligible workouts', async () => {
    vi.useFakeTimers(); harness.assess.mockResolvedValue({}); render(); runCheck(); await vi.advanceTimersByTimeAsync(250);
    const tree = render(); expect(text(tree)).toContain('incomplete result'); expect(text(tree)).not.toContain('No eligible workout');
    expect(button(tree, 'Retry setup check')).toBeTruthy(); expect(text(tree)).not.toContain('Checking'); expect(harness.generate).not.toHaveBeenCalled();
  });
});
