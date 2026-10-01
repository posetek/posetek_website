import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'athlete' } }, db: {}, cloud: {}, storage: {} }));
import { clearGuidedWorkout, focusFromRequest, guidedRequest, locationFromRequest, nearestMinuteIndex, nearestSupportedMinutes, readGuidedWorkout, rememberGuidedWorkout, restoredGuidedSetup, supportedSliderMinutes, toggleWorkoutFocus } from './guided-workout';
import { clearSpaceRestrictions, confirmedSetup, emptySetup, locationSetup, setupForProposal, setupFromIntake } from './training-access';
import WorkoutSetupWizard from './WorkoutSetupWizard';
import PlayerAgeField from './PlayerAgeField';

afterEach(() => vi.unstubAllGlobals());
describe('guided workout choices', () => {
  it('prefills only the latest positive current location, excluding negated and historical settings', () => {
    expect(locationFromRequest('I am not at the gym, I am on the field')).toBe('pitch');
    expect(locationFromRequest('At home yesterday, now at gym')).toBe('gym');
    expect(locationFromRequest('I was at home, but now on the pitch')).toBe('pitch');
    expect(locationFromRequest("I cannot train at the gym; I am at home")).toBe('home');
    expect(locationFromRequest('At the gym first, instead at home')).toBe('home');
    expect(locationFromRequest('No gym access. At home yesterday.')).toBeUndefined();
    expect(locationFromRequest('Gym access is unavailable')).toBeUndefined();
    expect(locationFromRequest('I have no equipment at home')).toBe('home');
    expect(locationFromRequest('I am at the gym today')).toBe('gym');
    expect(locationFromRequest('I am currently at home')).toBe('home');
    expect(locationFromRequest('I trained at the gym.')).toBeUndefined();
    expect(locationFromRequest('I am not at the gym or at home')).toBeUndefined();
  });
  it('maps readable focus labels to canonical domains and preserves explicit ball mastery', () => {
    expect(focusFromRequest('Speed and agility')).toEqual(['speed', 'agility']);
    expect(focusFromRequest('First touch and finishing')).toEqual(['receiving', 'shooting']);
    expect(focusFromRequest('Ball mastery practice')).toEqual(['ballMastery']);
    expect(focusFromRequest('Strength, no passing')).toEqual(['strength']);
    expect(focusFromRequest('No speed or strength, I have 20 minutes for passing')).toEqual(['passing']);
    expect(focusFromRequest('No passing or finishing, strength')).toEqual(['strength']);
    expect(focusFromRequest('I already trained speed and strength, now passing')).toEqual(['passing']);
    expect(focusFromRequest('Speed, agility, strength and passing')).toEqual([]);
    expect(toggleWorkoutFocus(['speed', 'agility'], 'strength')).toEqual(['speed', 'agility']);
    expect(toggleWorkoutFocus(['speed', 'agility'], 'speed')).toEqual(['agility']);
    expect(guidedRequest(['speed', 'strength'], 20, 'No jumping.')).toContain('No jumping.');
  });
  it('uses the approved location bundles without silently granting a football or goal', () => {
    expect(locationSetup('home').equipment).toEqual(['timer']);
    expect(locationSetup('gym').equipment).toEqual(['dumbbells', 'resistanceBand', 'kettlebell', 'bench', 'timer']);
    expect(locationSetup('pitch').equipment).toEqual(['cones', 'markers', 'timer']);
    expect(locationSetup('pitch', { ...emptySetup(), equipment: ['ball'] }).equipment).toContain('ball');
  });
  it('sends the explicit space assumption while retaining known restrictions', () => {
    const standard = locationSetup('gym'), standardIntake = confirmedSetup({ ...standard, confirmed: true })!;
    expect(standardIntake.access.space).toEqual({ assumedSufficient: true });
    const restricted = locationSetup('pitch', setupFromIntake({ equipment: [], access: { facility: 'home', participantCount: 1, space: { lengthMeters: 3, overheadClear: false, goalArea: false } } }));
    expect(confirmedSetup({ ...restricted, confirmed: true })?.access.space).toEqual({ lengthMeters: 3, assumedSufficient: true, overheadClear: false, goalArea: false });
    expect(confirmedSetup({ ...clearSpaceRestrictions(restricted), confirmed: true })?.access.space).toEqual({ assumedSufficient: true });
    expect(setupForProposal(standardIntake, { ...standard, confirmed: true }).confirmed).toBe(true);
  });
  it('indexes only supported five-minute targets and retains gaps and custom targets', () => {
    const choices = supportedSliderMinutes([1, 5, 7, 15, 20, 20, 55, 65, 135]);
    expect(choices).toEqual([5, 15, 20, 55]);
    expect(nearestMinuteIndex(choices, 10)).toBe(0);
    expect(nearestMinuteIndex([25, 35], 20)).toBe(0);
    expect(nearestMinuteIndex(choices, 52)).toBe(3);
    expect(supportedSliderMinutes([2, 3, 4, 61])).toEqual([]);
    expect(nearestSupportedMinutes([20, 30, 80, 100], 95)).toBe(100);
    expect(nearestSupportedMinutes([23, 17], 20)).toBe(17);
    expect(nearestSupportedMinutes([], 20)).toBeNull();
  });
  it('restores choices by owner/player but never caches age, pain or confirmation', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    rememberGuidedWorkout('owner', 'player', { focusDomains: ['strength'], minutes: 25, scheduledDate: '2026-10-01', setup: { ...locationSetup('home'), confirmed: true }, step: 'ready' });
    expect(readGuidedWorkout('owner', 'player')?.setup.confirmed).toBe(false);
    expect(readGuidedWorkout('owner', 'player')?.minutes).toBe(25);
    expect(readGuidedWorkout('other', 'player')).toBeNull();
    expect([...values.values()][0]).not.toMatch(/pain|age|password/);
    clearGuidedWorkout('owner', 'player'); expect(readGuidedWorkout('owner', 'player')).toBeNull();
  });
  it('recovers an unfinished Field wizard over remembered Gym preferences while preserving explicit handoffs', () => {
    const cached = { focusDomains: ['speed'], minutes: 25, scheduledDate: '2026-10-01', setup: locationSetup('pitch'), step: 'time' };
    const remembered = locationSetup('gym');
    expect(restoredGuidedSetup(cached, remembered, false).facility).toBe('pitch');
    expect(restoredGuidedSetup(cached, remembered, false).equipment).toEqual(['cones', 'markers', 'timer']);
    expect(restoredGuidedSetup(cached, remembered, true)).toBe(remembered);
  });
});
describe('guided workout presentation', () => {
  const props = { store: { ownerUid: 'owner', scheduleRevision: 0 } as any, playerId: 'player', athlete: { age: 15, ageRecordedAt: new Date() }, setup: emptySetup(), onSetup: () => {}, initialRequest: '', scheduledDate: '2026-10-01', onDate: () => {}, today: '2026-10-01', latestDate: '2026-10-29', timezone: 'UTC', preview: true, disabled: false, onGenerate: async () => true };
  it('opens with one focused question and no checkbox or text-entry wall', () => {
    const html = renderToStaticMarkup(<WorkoutSetupWizard {...props} />);
    expect(html).toContain('What do you want to work on?'); expect(html).toContain('Choose up to two');
    expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('<textarea'); expect(html).not.toContain('Clear length');
  });
  it('carries a complete AI Coach request directly to readiness without repeating answered questions', () => {
    const html = renderToStaticMarkup(<WorkoutSetupWizard {...props} setup={locationSetup('home')} initialRequest="I have 27 minutes for strength at home." />);
    expect(html).toContain('Ready for your workout?'); expect(html).toContain('27 minutes');
    expect(html).not.toContain('What do you want to work on?'); expect(html).not.toContain('How old are you?');
    expect(html).toContain('Any pain or restriction affecting this session?');
  });
  it('asks missing age before showing supported time choices and saves only an age observation', () => {
    const html = renderToStaticMarkup(<WorkoutSetupWizard {...props} athlete={{}} setup={locationSetup('home')} initialRequest="Strength for 20 minutes" />);
    expect(html).toContain('How old are you?'); expect(html).toContain('type="range"'); expect(html).toContain('save your confirmed age');
    expect(html).not.toContain('How much time do you have?');
  });
  it('shows profile age from a birthday and protects it from a slider overwrite', () => {
    const html = renderToStaticMarkup(<PlayerAgeField playerId="player" athlete={{ birthDate: '2011-10-01' }} editable preview />);
    expect(html).toContain('years'); expect(html).not.toContain('Update age'); expect(html).not.toContain('Confirm age');
  });
});
