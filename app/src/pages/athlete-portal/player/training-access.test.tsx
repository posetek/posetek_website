import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EQUIPMENT } from '../../../lib/contracts/types';
import TrainingSetup from './TrainingSetup';
import { ACCESS_GROUPS, EQUIPMENT_LABELS, confirmedSetup, emptySetup, readRememberedSetup, rememberSetup, setupForProposal, setupFromIntake, setupErrors, setupSignature } from './training-access';
import { applyEquipmentChanges, equipmentChanges, suppliedWorkoutConditions } from './personal-conversation';

afterEach(() => vi.unstubAllGlobals());
describe('confirmed resource choices', () => {
  it('covers the entire shared equipment vocabulary exactly once, with readable names', () => {
    const choices = ACCESS_GROUPS.flatMap(group => [...group.equipment]);
    expect(choices).toHaveLength(EQUIPMENT.length); expect(new Set(choices).size).toBe(EQUIPMENT.length);
    expect(choices.sort()).toEqual([...EQUIPMENT].sort());
    expect(choices.every(choice => !!EQUIPMENT_LABELS[choice])).toBe(true);
  });
  it('requires an explicit resource answer and confirmation; gym grants no kit', () => {
    const draft = { ...emptySetup(), facility: 'gym' as const, participantCount: 1, confirmed: true };
    expect(confirmedSetup(draft)).toBeNull();
    const none = { ...draft, equipmentAnswered: true };
    expect(confirmedSetup(none)?.equipment).toEqual([]);
    expect(confirmedSetup({ ...none, confirmed: false })).toBeNull();
    expect(confirmedSetup(none)?.access.space).not.toHaveProperty('lengthMeters');
  });
  it('preserves known dimensions and people without replacing unanswered space with invented measurements', () => {
    const value = { ...emptySetup(), facility: 'pitch' as const, participantCount: 4, equipment: ['ball'], equipmentAnswered: true, lengthMeters: 25, confirmed: true };
    expect(confirmedSetup(value)).toEqual({ equipment: ['ball'], setting: 'partner', access: { schemaVersion: 1, confirmed: true, facility: 'pitch', participantCount: 4, space: { lengthMeters: 25, overheadClear: false, goalArea: false } } });
    expect(setupErrors({ ...value, widthMeters: -1 })).not.toEqual([]);
    expect(setupErrors({ ...value, participantCount: 13 })).not.toEqual([]);
  });
  it('remembered resources remain scoped to the owner and player, requiring fresh confirmation', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) });
    const value = { ...emptySetup(), facility: 'home' as const, participantCount: 1, equipmentAnswered: true, confirmed: true };
    rememberSetup('owner', 'player', value);
    expect(readRememberedSetup('owner', 'player')?.confirmed).toBe(false);
    expect(readRememberedSetup('another', 'player')).toBeNull();
    expect(readRememberedSetup('owner', 'another')).toBeNull();
    expect([...storage.values()][0]).not.toMatch(/pain|age|password/);
  });
  it('detects resource changes independent of checkbox ordering and confirmation', () => {
    const original = setupFromIntake({ equipment: ['wall', 'ball'], setting: 'solo' });
    expect(setupSignature(original)).toBe(setupSignature({ ...original, equipment: ['ball', 'wall'], confirmed: true }));
    expect(setupSignature(original)).not.toBe(setupSignature({ ...original, equipment: ['ball'] }));
  });
  it('does not reuse a stored confirmation, but preserves a matching setup confirmed in this visit', () => {
    const current = { ...emptySetup(), facility: 'home' as const, participantCount: 1, equipmentAnswered: true, confirmed: true };
    const intake = confirmedSetup(current)!;
    expect(setupForProposal(intake, emptySetup()).confirmed).toBe(false);
    expect(setupForProposal(intake, current).confirmed).toBe(true);
    expect(setupForProposal({ ...intake, equipment: ['mat'] }, current).confirmed).toBe(false);
  });
  it('keeps compact location presets and equipment exceptions available without checklists', () => {
    const html = renderToStaticMarkup(<TrainingSetup value={emptySetup()} onChange={() => {}} onConfirm={() => {}} />);
    for (const label of ['At home', 'Gym', 'Field', 'Football', 'Goal', 'Adjust equipment', 'Use this setup']) expect(html).toContain(label);
    expect(html).toContain('role="switch"'); expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Add a drill');
  });
});
describe('equipment text is an unconfirmed suggestion', () => {
  it.each([
    ['I have a ball but do not have a goal', ['ball'], ['goal']],
    ['I have a mat but no access to a goal', ['mat'], ['goal']],
    ['I have a ball and no resistance band', ['ball'], ['resistanceBand']],
    ["I don't have a wall anymore", [], ['wall']],
    ['No wall today', [], ['wall']],
    ['I have a medicine ball', ['medicineBall'], []],
  ])('%s', (text, add, remove) => {
    expect(equipmentChanges(text)).toMatchObject({ add, remove });
  });
  it('removes unavailable equipment from a previous setup without discarding unaffected equipment', () => {
    expect(applyEquipmentChanges(['ball', 'cones', 'wall'], 'No wall today')).toEqual(['ball', 'cones']);
    expect(applyEquipmentChanges(['ball', 'cones'], 'I only have a mat')).toEqual(['mat']);
    expect(applyEquipmentChanges(['ball', 'wall'], 'No equipment')).toEqual([]);
    expect(suppliedWorkoutConditions('Give me a wall passing workout')).not.toHaveProperty('equipment');
  });
});
