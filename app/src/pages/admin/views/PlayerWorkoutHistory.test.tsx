import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/firebase', () => ({ cloud: {}, db: {} }));
import { PlayerWorkoutHistoryContent, WorkoutNotificationStatus } from './PlayerWorkoutHistory';
import type { NotificationStatus, RecordedWorkoutLog, WorkoutNotificationResult } from '../lib/workoutNotifications';

const noop = () => {};
const log: RecordedWorkoutLog = { id: 'assigned', _workoutSource: 'workoutLogs', planId: 'plan', workoutId: 'workout',
  startedAt: new Date('2026-09-28T12:00:00Z'), activeSeconds: 120, blocks: [{ blockId: 'one', setsCompleted: 1, status: 'partial' }],
  workoutSnapshot: { title: 'Saved passing session', blocks: [{ blockId: 'one', name: 'Saved passing drill', sets: 3 }] } };
const statusResult: WorkoutNotificationResult = {
  settings: { enabled: true, sendEnabled: true, recipient: 'dylank@posetek.net', quietMinutes: 30 },
  activity: { lastActivityAtMillis: Date.parse('2026-09-28T12:02:00Z'), lastSeenAtMillis: Date.parse('2026-09-28T12:05:00Z'),
    lastSignal: 'pause', quietDueAtMillis: null, inactivityNotified: true, blockId: 'one', webObserved: true },
  notifications: [], observedAtMillis: Date.parse('2026-09-28T13:00:00Z'),
};
const renderStatus = (status: NotificationStatus) => renderToStaticMarkup(<WorkoutNotificationStatus load={{ kind: 'ready', result: { ...statusResult,
  notifications: [{ id: 'n', eventType: 'inactivity', status, createdAtMillis: Date.parse('2026-09-28T12:32:00Z'),
    lastAttemptAtMillis: null, acceptedAtMillis: null, deliveredAtMillis: null, failureMessage: null }] } }} />);

describe('admin recorded workout presentation', () => {
  it('shows the selected saved workout and opens its prescription without a fake ending', () => {
    const html = renderToStaticMarkup(<PlayerWorkoutHistoryContent playerId="p" load={{ kind: 'ready', logs: [log], checkedAt: Date.now() }}
      request={{ kind: 'valid', focus: { source: 'workoutLogs', logId: 'assigned' } }} onRefresh={noop} onSelect={noop} />);
    expect(html).toContain('Saved passing drill'); expect(html).toContain('No ending recorded');
    expect(html).toContain('2 min timer'); expect(html).toContain('Not all completed'); expect(html).toContain('<details open=""');
    expect(html).toContain('tabindex="-1"'); expect(html).toContain('aria-label="Selected workout"');
    expect(html).toContain('does not update live'); expect(html).not.toContain('Ended ');
  });
  it('does not select another workout when the exact link is missing', () => {
    const html = renderToStaticMarkup(<PlayerWorkoutHistoryContent playerId="p" load={{ kind: 'ready', logs: [log], checkedAt: Date.now() }}
      request={{ kind: 'valid', focus: { source: 'personalWorkoutLogs', logId: 'assigned' } }} onRefresh={noop} onSelect={noop} />);
    expect(html).toContain('No other workout has been selected'); expect(html).not.toContain('aria-label="Selected workout"');
    expect(html).toContain('View activity and email status for Saved passing session');
  });
  it('shows failed reads as unavailable and gives a refresh action', () => {
    const html = renderToStaticMarkup(<PlayerWorkoutHistoryContent playerId="p" load={{ kind: 'error' }} request={{ kind: 'none' }} onRefresh={noop} onSelect={noop} />);
    expect(html).toContain('role="alert"'); expect(html).toContain('Workout history is unavailable'); expect(html).toContain('Refresh activity');
    expect(html).not.toContain('No recorded workouts');
  });
  it('keeps quiet observation distinct from confirmed stopping and delivery distinct from reading', () => {
    const html = renderStatus('delivered');
    expect(html).toContain('Workout paused'); expect(html).toContain('does not confirm when or whether the player stopped');
    expect(html).toContain('Delivered to mail server'); expect(html).toContain('does not confirm the email was read');
    expect(html).not.toContain('Completed'); expect(html).not.toContain('Ended early');
  });
  it.each([['accepted', 'Accepted by email provider'], ['failed', 'Failed'], ['needs_review', 'Delivery needs review'],
    ['bounced', 'Bounced'], ['suppressed', 'Suppressed'], ['delayed', 'Delivery delayed'], ['cancelled', 'Cancelled']] as const)('labels %s honestly', (status, label) => {
    expect(renderStatus(status)).toContain(label);
    expect(renderStatus(status)).not.toContain('>Delivered to mail server<');
    expect(renderStatus(status)).not.toContain('<button');
  });
  it('keeps disabled sending and absent observations visible without inventing a sent email', () => {
    const html = renderToStaticMarkup(<WorkoutNotificationStatus load={{ kind: 'ready', result: { ...statusResult,
      activity: null, settings: { ...statusResult.settings, sendEnabled: false } } }} />);
    expect(html).toContain('Email sending is paused'); expect(html).toContain('No activity observation recorded');
    expect(html).toContain('No email notification is recorded');
  });
  it('separates connection signals from progress and resolves the last drill only from the saved prescription', () => {
    const result = { ...statusResult, activity: { ...statusResult.activity!, lastSignal: 'heartbeat' as const } };
    const html = renderToStaticMarkup(<WorkoutNotificationStatus load={{ kind: 'ready', result }} drills={[{ blockId: 'one', name: 'Saved passing drill' }]} />);
    expect(html).toContain('Connection signal received'); expect(html).toContain('5:02 AM PDT'); expect(html).toContain('5:05 AM PDT');
    expect(html).toContain('Last web signal received'); expect(html).toContain('Saved passing drill'); expect(html).not.toContain('Progress saved');
  });
  it('labels a limited pilot and sessions without web signals', () => {
    const html = renderToStaticMarkup(<WorkoutNotificationStatus load={{ kind: 'ready', result: { ...statusResult,
      settings: { ...statusResult.settings, pilot: true, playerIncluded: false }, activity: { ...statusResult.activity!, webObserved: false, lastSeenAtMillis: null } } }} />);
    expect(html).toContain('Test-player pilot only'); expect(html).toContain('not included in the pilot');
    expect(html).toContain('Quiet-session alerts are unavailable');
  });
});
