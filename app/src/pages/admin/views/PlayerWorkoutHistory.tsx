import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkoutHistoryCard } from '../../coach-dashboard/views/WorkoutHistory';
import { getWorkoutNotificationStatus, loadPlayerWorkoutHistory, parseWorkoutFocus, selectWorkoutHistory, workoutFocusQuery, workoutPacificTime } from '../lib/workoutNotifications';
import type { FocusRequest, NotificationStatus, RecordedWorkoutLog, WorkoutFocus, WorkoutNotificationResult } from '../lib/workoutNotifications';
import '../workout-history.scss';

type HistoryLoad = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; logs: RecordedWorkoutLog[]; checkedAt: number };
type StatusLoad = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; result: WorkoutNotificationResult };
type SavedDrill = { blockId?: string; name?: string };

export default function PlayerWorkoutHistory({ playerId }: { playerId: string }) {
  const [query, setQuery] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const [load, setLoad] = useState<HistoryLoad>({ kind: 'loading' });
  const request = parseWorkoutFocus(query);
  useEffect(() => {
    let live = true;
    loadPlayerWorkoutHistory(playerId).then(logs => { if (live) setLoad({ kind: 'ready', logs, checkedAt: Date.now() }); })
      .catch(() => { if (live) setLoad({ kind: 'error' }); });
    return () => { live = false; };
  }, [playerId, refresh]);
  return <PlayerWorkoutHistoryContent playerId={playerId} load={load} request={request} refresh={refresh}
    onRefresh={() => { setLoad({ kind: 'loading' }); setRefresh(value => value + 1); }} onSelect={focus => setQuery(workoutFocusQuery(query, focus))} />;
}

export function PlayerWorkoutHistoryContent({ playerId, load, request, refresh = 0, onRefresh, onSelect }: {
  playerId: string; load: HistoryLoad; request: FocusRequest; refresh?: number; onRefresh: () => void; onSelect: (focus: WorkoutFocus) => void;
}) {
  const selection = load.kind === 'ready' ? selectWorkoutHistory(load.logs, request) : null;
  const target = useRef<HTMLDivElement>(null);
  const focusKey = request.kind === 'valid' ? `${request.focus.source}/${request.focus.logId}` : '';
  const hasFocus = Boolean(selection?.focused);
  useEffect(() => {
    if (!hasFocus || !target.current) return;
    target.current.focus({ preventScroll: true });
    target.current.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [focusKey, hasFocus]);
  return <section className="admin-card admin-workout-history" aria-labelledby="admin-workout-history-title">
    <div className="admin-heading">
      <div><h2 id="admin-workout-history-title">Workout activity</h2>
        <p>Saved workouts, reported progress, and notification delivery. Times are Pacific.</p></div>
      <button type="button" className="quiet-button" disabled={load.kind === 'loading'} onClick={onRefresh}>Refresh activity</button>
    </div>
    {load.kind === 'loading' && <p role="status" className="admin-note">Loading workout activity…</p>}
    {load.kind === 'error' && <p role="alert" className="form-message">Workout history is unavailable. Refresh activity to try again.</p>}
    {request.kind === 'invalid' && <p role="alert" className="form-message">This workout link is incomplete or invalid. Choose a recorded workout below to view its activity.</p>}
    {load.kind === 'ready' && <>
      <p className="admin-note">History checked {workoutPacificTime(load.checkedAt)}. This view does not update live.</p>
      {request.kind === 'valid' && !selection?.focused && <p role="alert" className="form-message">The exact workout in this link is unavailable. No other workout has been selected.</p>}
      {selection?.focused && request.kind === 'valid' && <div className="admin-focused-workout" ref={target} tabIndex={-1} aria-label="Selected workout">
        <p className="eyebrow">Selected saved workout</p>
        <WorkoutHistoryCard entry={selection.focused} formatTime={workoutPacificTime} expanded />
        <WorkoutNotificationPanel key={focusKey} playerId={playerId} focus={request.focus} refresh={refresh}
          drills={Array.isArray(selection.focused.snapshot?.blocks) ? selection.focused.snapshot.blocks : []} />
      </div>}
      {!load.logs.length && <p className="admin-empty">No recorded workouts yet. Activity appears here after the player starts tracking.</p>}
      {!!selection?.rows.length && <div className="admin-recorded-workouts">
        <h3>{selection.focused ? 'Other recorded workouts' : 'Recorded workouts'}</h3>
        <p className="admin-note">Saved prescriptions remain unchanged when a program is edited. Linked duplicate logs are counted once in this list.</p>
        {selection.rows.map(entry => <WorkoutHistoryCard key={entry.id} entry={entry} formatTime={workoutPacificTime}>
          <button type="button" className="quiet-button admin-workout-select" onClick={() => onSelect({ source: entry.log._workoutSource, logId: entry.log.id })}
            aria-label={`View activity and email status for ${entry.snapshot?.title || 'workout'} started ${workoutPacificTime(entry.start)}`}>
            View activity &amp; email status
          </button>
        </WorkoutHistoryCard>)}
      </div>}
    </>}
  </section>;
}

function WorkoutNotificationPanel({ playerId, focus, refresh, drills }: { playerId: string; focus: WorkoutFocus; refresh: number; drills: SavedDrill[] }) {
  const [load, setLoad] = useState<StatusLoad>({ kind: 'loading' });
  const { source, logId } = focus;
  useEffect(() => {
    let live = true;
    getWorkoutNotificationStatus(playerId, { source, logId }).then(result => { if (live) setLoad({ kind: 'ready', result }); })
      .catch(() => { if (live) setLoad({ kind: 'error' }); });
    return () => { live = false; };
  }, [playerId, source, logId, refresh]);
  return <WorkoutNotificationStatus load={load} drills={drills} />;
}

const STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Queued', sending: 'Sending', accepted: 'Accepted by email provider', delivered: 'Delivered to mail server',
  delayed: 'Delivery delayed', bounced: 'Bounced', suppressed: 'Suppressed', failed: 'Failed',
  needs_review: 'Delivery needs review', cancelled: 'Cancelled',
};
const SIGNAL_LABELS = { resume: 'Workout resumed', progress: 'Workout interaction recorded', pause: 'Workout paused', heartbeat: 'Connection signal received', saved: 'Workout saved' };

export function WorkoutNotificationStatus({ load, drills = [] }: { load: StatusLoad; drills?: SavedDrill[] }) {
  return <section className="admin-workout-notifications" aria-label="Observed activity and email notifications">
    <h3>Activity &amp; email notifications</h3>
    {load.kind === 'loading' && <p role="status" className="admin-note">Checking observed activity and email status…</p>}
    {load.kind === 'error' && <p role="alert" className="form-message">Activity and email status are unavailable. Refresh activity to check again. The saved workout above is unchanged.</p>}
    {load.kind === 'ready' && <>
      <dl className="admin-workout-observation">
        <div><dt>Last workout activity</dt><dd>{load.result.activity ? workoutPacificTime(load.result.activity.lastActivityAtMillis) : 'No activity observation recorded'}</dd></div>
        {load.result.activity?.lastSeenAtMillis != null && <div><dt>Last web signal received</dt><dd>{workoutPacificTime(load.result.activity.lastSeenAtMillis)}</dd></div>}
        {load.result.activity && <div><dt>Last signal</dt><dd>{SIGNAL_LABELS[load.result.activity.lastSignal] || 'Workout activity received'}</dd></div>}
        {load.result.activity?.blockId && <div><dt>Last recorded drill</dt><dd>{drills.find(drill => drill.blockId === load.result.activity?.blockId)?.name || 'Not available in the saved prescription'}</dd></div>}
      </dl>
      <p className="admin-note">A quiet-session alert means no new workout progress or resume was recorded for {load.result.settings.quietMinutes} minutes. It does not confirm when or whether the player stopped.</p>
      {load.result.activity && !load.result.activity.webObserved && <p className="admin-note">No web activity signals are recorded for this session. Quiet-session alerts are unavailable; saved workout endings can still be reported.</p>}
      <p className="admin-note">Recipient: {load.result.settings.recipient}</p>
      {load.result.settings.pilot && <p className="admin-note">Test-player pilot only.</p>}
      {load.result.settings.pilot && load.result.settings.playerIncluded === false && <p className="admin-note">This athlete is not included in the pilot.</p>}
      {(!load.result.settings.enabled || !load.result.settings.sendEnabled) && <p className="admin-note">{!load.result.settings.enabled ? 'Workout notifications are disabled.' : 'Email sending is paused.'}</p>}
      {!load.result.notifications.length && <p className="admin-empty">No email notification is recorded for this workout.</p>}
      {!!load.result.notifications.length && <ul className="admin-workout-email-list">{load.result.notifications.map(item => <li key={item.id}>
        <div className="admin-workout-email-heading"><strong>{item.eventType === 'terminal' ? 'Workout ending' : 'Quiet session'}</strong>
          <span className={`admin-chip ${['failed', 'bounced', 'suppressed'].includes(item.status) ? 'danger' : ['needs_review', 'delayed'].includes(item.status) ? 'warn' : ''}`}>{STATUS_LABELS[item.status] || 'Status unavailable'}</span></div>
        <dl className="admin-workout-observation">
          <div><dt>Created</dt><dd>{workoutPacificTime(item.createdAtMillis)}</dd></div>
          {item.lastAttemptAtMillis !== null && <div><dt>Last send attempt</dt><dd>{workoutPacificTime(item.lastAttemptAtMillis)}</dd></div>}
          {item.acceptedAtMillis !== null && <div><dt>Provider accepted</dt><dd>{workoutPacificTime(item.acceptedAtMillis)}</dd></div>}
          {item.deliveredAtMillis !== null && <div><dt>Mail server accepted</dt><dd>{workoutPacificTime(item.deliveredAtMillis)}</dd></div>}
        </dl>
        {item.failureMessage && <p className="admin-note">{item.failureMessage}</p>}
        {item.status === 'needs_review' && <p className="admin-note">Delivery could not be confirmed. Sending again is held to avoid a duplicate email.</p>}
      </li>)}</ul>}
      <p className="admin-note">Provider acceptance does not confirm delivery. Mail-server delivery does not confirm the email was read.</p>
      <p className="admin-note">Notification status checked {workoutPacificTime(load.result.observedAtMillis)}.</p>
    </>}
  </section>;
}
