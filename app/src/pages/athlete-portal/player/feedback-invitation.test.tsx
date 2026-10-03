import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlayerFeedbackInvitation, { PlayerResultsFeedbackLink } from './PlayerFeedbackInvitation';
import {
  claimBrowserFeedbackInvitation, claimFeedbackInvitation, eligibleWorkoutFeedback, FEEDBACK_INVITATION_INTERVAL_MS,
  FEEDBACK_INVITATION_KEY, savedWorkoutAllowsFeedback, showResultsFeedback,
} from './feedback-invitation';
import type { WorkoutFeedbackEligibility } from './feedback-invitation';

const eligible = (): WorkoutFeedbackEligibility => ({ endReason: 'completed', hasCompletedWork: true, painStopped: false,
  preview: false, currentAccount: true, currentTab: true, visible: true });
const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('feedback follows acknowledged workout completion', () => {
  it('waits for a successful finish before evaluating whether to offer feedback', async () => {
    let resolve!: () => void;
    const save = new Promise<void>(accept => { resolve = accept; });
    const read = vi.fn(eligible);
    const outcome = savedWorkoutAllowsFeedback(() => save, read);
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    resolve();
    await expect(outcome).resolves.toBe(true);
    expect(read).toHaveBeenCalledOnce();
  });

  it('never offers feedback for a failed save and leaves eligibility unread', async () => {
    const read = vi.fn(eligible);
    await expect(savedWorkoutAllowsFeedback(() => Promise.reject(new Error('Failed to save')), read)).rejects.toThrow('Failed to save');
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { endReason: 'endedEarly' }, { hasCompletedWork: false }, { painStopped: true }, { preview: true },
    { currentAccount: false }, { currentTab: false }, { visible: false },
  ])('excludes an unsuitable completion state: %j', changed => {
    expect(eligibleWorkoutFeedback({ ...eligible(), ...changed })).toBe(false);
  });

  it('rechecks account, ownership, pain and visibility after a deferred finish', async () => {
    for (const change of [{ currentAccount: false }, { currentTab: false }, { painStopped: true }, { visible: false }]) {
      let resolve!: () => void;
      let state = eligible();
      const pending = savedWorkoutAllowsFeedback(() => new Promise<void>(accept => { resolve = accept; }), () => state);
      state = { ...state, ...change };
      resolve();
      await expect(pending).resolves.toBe(false);
    }
  });
});

describe('same-browser invitation cooldown', () => {
  it('claims immediately on a new browser, suppresses subsequent workouts and opens at seven days', () => {
    const storage = memory(), now = 1000000;
    expect(claimFeedbackInvitation(storage, now)).toBe(true);
    expect(claimFeedbackInvitation(storage, now + 1000)).toBe(false);
    expect(claimFeedbackInvitation(storage, now + FEEDBACK_INVITATION_INTERVAL_MS - 1)).toBe(false);
    expect(claimFeedbackInvitation(storage, now + FEEDBACK_INVITATION_INTERVAL_MS)).toBe(true);
    expect([...storage.values.keys()]).toEqual([FEEDBACK_INVITATION_KEY]);
    expect(storage.values.get(FEEDBACK_INVITATION_KEY)).toBe(String(now + FEEDBACK_INVITATION_INTERVAL_MS));
  });

  it('shares the timestamp across sessions without using a player, team or workout identifier', () => {
    const storage = memory();
    expect(claimFeedbackInvitation(storage, 1000000)).toBe(true);
    const laterSession = { getItem: storage.getItem, setItem: storage.setItem };
    expect(claimFeedbackInvitation(laterSession, 2000000)).toBe(false);
    expect([...storage.values]).toEqual([[FEEDBACK_INVITATION_KEY, '1000000']]);
  });

  it('suppresses automatically when reads or writes are unavailable', () => {
    expect(claimFeedbackInvitation({ getItem: () => { throw new Error('Blocked'); }, setItem: () => {} }, 1000000)).toBe(false);
    expect(claimFeedbackInvitation({ getItem: () => null, setItem: () => { throw new Error('Full'); } }, 1000000)).toBe(false);
    expect(claimFeedbackInvitation({ getItem: () => null, setItem: () => {} }, 1000000)).toBe(false);
  });

  it('does not reset malformed or future cooldowns', () => {
    for (const value of ['bad', '', '-1', 'Infinity', '2000000']) {
      const storage = memory();
      storage.values.set(FEEDBACK_INVITATION_KEY, value);
      expect(claimFeedbackInvitation(storage, 1000000)).toBe(false);
      expect(storage.values.get(FEEDBACK_INVITATION_KEY)).toBe(value);
    }
  });

  it('uses a shared browser lock to serialize claims when supported', async () => {
    const storage = memory();
    const request = vi.fn(async (_name: string, callback: () => boolean) => callback());
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(claimBrowserFeedbackInvitation()).resolves.toBe(true);
    await expect(claimBrowserFeedbackInvitation()).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(FEEDBACK_INVITATION_KEY);
  });
});

describe('optional feedback entry points', () => {
  it('uses full-page links with only a broad source and clear dismissal', () => {
    const html = renderToStaticMarkup(<PlayerFeedbackInvitation onDismiss={() => {}} />);
    expect(html).toContain('Help us improve PoseTek — three quick questions.');
    expect(html).toContain('href="/feedback?source=workout" rel="noreferrer"');
    expect(html).toContain('Give feedback');
    expect(html).toContain('Not now');
    expect(html).toContain('Giving feedback is your choice');
    const link = renderToStaticMarkup(<PlayerResultsFeedbackLink />);
    expect(link).toContain('href="/feedback?source=results" rel="noreferrer"');
  });

  it('offers persistent results feedback for athletes with visible results, independent of cooldown', () => {
    expect(showResultsFeedback('athlete', 1)).toBe(true);
    expect(showResultsFeedback('athlete', 0)).toBe(false);
    expect(showResultsFeedback('athlete', Number.NaN)).toBe(false);
    for (const access of ['preview', 'coach', 'manager', 'admin', 'shared']) expect(showResultsFeedback(access, 10)).toBe(false);
  });
});
