export const FEEDBACK_INVITATION_KEY = 'posetek:feedback:last-invitation';
export const FEEDBACK_INVITATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type InvitationStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface WorkoutFeedbackEligibility {
  endReason: string;
  hasCompletedWork: boolean;
  painStopped: boolean;
  preview: boolean;
  currentAccount: boolean;
  currentTab: boolean;
  visible: boolean;
}

export function eligibleWorkoutFeedback(value: WorkoutFeedbackEligibility): boolean {
  return value.endReason === 'completed' && value.hasCompletedWork && !value.painStopped && !value.preview
    && value.currentAccount && value.currentTab && value.visible;
}

/** Read the current owner/visibility after the actual finish acknowledgement. */
export async function savedWorkoutAllowsFeedback(save: () => Promise<void>, read: () => WorkoutFeedbackEligibility): Promise<boolean> {
  await save();
  return eligibleWorkoutFeedback(read());
}

/** The cooldown is one browser timestamp, never an account/workout identifier. */
export function claimFeedbackInvitation(storage: InvitationStorage, now = Date.now()): boolean {
  if (!Number.isFinite(now) || now <= 0) return false;
  try {
    const raw = storage.getItem(FEEDBACK_INVITATION_KEY);
    if (raw !== null) {
      const previous = Number(raw);
      if (!Number.isFinite(previous) || previous <= 0 || now - previous < FEEDBACK_INVITATION_INTERVAL_MS) return false;
    }
    const timestamp = String(Math.floor(now));
    storage.setItem(FEEDBACK_INVITATION_KEY, timestamp);
    return storage.getItem(FEEDBACK_INVITATION_KEY) === timestamp;
  } catch { return false; }
}

export async function claimBrowserFeedbackInvitation(): Promise<boolean> {
  try {
    // Web Locks serializes simultaneous completions across supported browser
    // tabs. Device storage also enforces the shared cooldown between visits.
    if (navigator.locks) return await navigator.locks.request(FEEDBACK_INVITATION_KEY,
      () => claimFeedbackInvitation(localStorage));
    return claimFeedbackInvitation(localStorage);
  } catch { return false; }
}

export function showResultsFeedback(access: string, visibleResults: number): boolean {
  return access === 'athlete' && Number.isFinite(visibleResults) && visibleResults > 0;
}
