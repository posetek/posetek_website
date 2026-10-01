import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'athlete' } }, db: {}, cloud: {}, storage: {} }));
import { currentWorkoutConditions, personalDraftLink, suppliedWorkoutConditions } from './personal-conversation';
import PersonalWorkoutHub, { PersonalPrescription } from './PersonalWorkoutHub';

describe('conversational workout inputs', () => {
  it('carries explicit minutes, setting, available equipment and pain confirmation', () => {
    expect(suppliedWorkoutConditions("I'm 15. I have 20 minutes. I am solo. I have a ball and cones. No pain or restrictions.")).toEqual({ age: 15, minutes: 20, setting: 'solo', equipment: ['ball', 'cones'], painAnswer: 'no' });
  });
  it('does not infer available equipment, setting or pain status from a requested drill', () => {
    expect(suppliedWorkoutConditions('A wall passing and ball control workout for 15 min')).toEqual({ minutes: 15 });
    expect(suppliedWorkoutConditions('I have no wall. I want wall passes.')).not.toHaveProperty('equipment');
  });
  it('preserves supplied time and accepts explicit no-equipment availability', () => {
    expect(suppliedWorkoutConditions('Train alone, without any equipment.', 12)).toEqual({ minutes: 12, setting: 'solo', equipment: [] });
    expect(suppliedWorkoutConditions('I have 15 minutes, actually 25 minutes.').minutes).toBe(25);
    expect(suppliedWorkoutConditions('Make it 10 minutes', 20).minutes).toBe(10);
    expect(suppliedWorkoutConditions('I am 20 minutes from practice')).not.toHaveProperty('age');
    expect(suppliedWorkoutConditions('No restrictions but I have knee pain').painAnswer).toBe('yes');
  });
  it('keeps player context when linking a recoverable draft', () => {
    const p = new URLSearchParams(personalDraftLink('?preview=1&view=drills&rep=x', 'conversation1'));
    expect(Object.fromEntries(p)).toEqual({ preview: '1', view: 'training', personalConversation: 'conversation1' });
  });
  it('uses newly supplied time instead of a hidden earlier form answer', () => {
    const supplied = suppliedWorkoutConditions('Make it 15 minutes. I have knee pain.');
    expect(currentWorkoutConditions(supplied, { minutes: 30, painAnswer: 'no', age: 18 })).toEqual({ minutes: 15, painAnswer: 'yes', age: 18 });
    expect(currentWorkoutConditions({ age: 19 }, {}, 16).age).toBe(16);
  });
});
describe('reviewed workout presentation', () => {
  const proposal = { proposalId: 'proposal1', proposalRevision: 2, requestedMinutes: 15, workout: { title: 'Close control', estimatedMinutes: 17, blocks: [{ blockId: 'b1', name: 'Ball mastery', sets: 3, reps: 60, repUnit: 'seconds', restSeconds: 30, estimatedMinutes: 5 }] } };
  it('shows approximate requested and calculated durations without editable prescriptions', () => {
    const html = renderToStaticMarkup(<PersonalPrescription proposal={proposal} />);
    expect(html).toContain('17 min'); expect(html).toContain('15 min'); expect(html).toContain('rest and transitions'); expect(html).toContain('approximate target');
    expect(html).not.toMatch(/<(input|select|button)/); expect(html).toContain('Ball mastery');
  });
  it('publishes from a readable proposal and offers conversational revisions', () => {
    const store = { enabled: true, proposal, conversation: {}, conversations: [], workouts: [], logs: {}, messages: [], scheduleRevision: 0, loaded: true, saving: false } as any;
    const html = renderToStaticMarkup(<PersonalWorkoutHub store={store} playerId="athlete" athlete={{ age: 15 }} config={null} preview initialConversation onBack={() => {}} />);
    expect(html).toContain('Publish workout'); expect(html).toContain('What would you like to change?');
    expect(html).not.toContain('Search drills'); expect(html).not.toContain('Add a drill');
  });
  it('requests only missing conditions after a supplied AI Coach request', () => {
    const store = { enabled: true, proposal: null, workouts: [], logs: {}, messages: [], scheduleRevision: 0, loaded: true } as any;
    const html = renderToStaticMarkup(<PersonalWorkoutHub store={store} playerId="athlete" athlete={{ age: 15 }} config={null} preview initialRequest="I have 20 minutes. Solo. I have a ball and cones." onBack={() => {}} />);
    expect(html).not.toContain('About how many minutes?'); expect(html).not.toContain('Training with'); expect(html).not.toContain('What equipment do you have?'); expect(html).not.toContain('Your age');
    expect(html).toContain('What do you want to work on?');
    expect(html).toContain('Your request is included');
  });
  it('does not repeat the original request in the revision composer when opening an existing conversation', () => {
    const store = { enabled: true, proposal, conversation: {}, workouts: [], logs: {}, messages: [], scheduleRevision: 0, loaded: true } as any;
    const html = renderToStaticMarkup(<PersonalWorkoutHub store={store} playerId="athlete" athlete={{ age: 15 }} config={null} preview initialConversation initialRequest="Already sent original request" onBack={() => {}} />);
    expect(html).toContain('What would you like to change?');
    expect(html).not.toContain('Already sent original request');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send changes<\/button>/);
  });
});
