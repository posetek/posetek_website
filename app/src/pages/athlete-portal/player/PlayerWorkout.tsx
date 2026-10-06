import { useCallback, useEffect, useRef, useState } from 'react';
import { auth, cloud } from '../../../lib/firebase';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { blockLogRow, skippedLogRow, SKIP_REASONS, endReasonFor, domainExposures } from '../lib/training';
import { domainLabel } from '../../../lib/contracts/types';
import type { PlayerWorkoutStore } from './use-player-workouts';
import type { Row } from './execution';
import DrillMedia from './DrillMedia';
import CoachChat from './CoachChat';
import { newClock, elapsed, restSeconds, pauseClock, resumeClock, reconcileClock, interactClock, stopRest, validClock } from './clock';
import type { Clock } from './clock';
import { applyConfirmedElapsed, canMutateWorkout, restoreRuntime, resumeIndex, runtimeKey, runtimeSnapshot, shouldYieldRuntime, watchWorkoutLifecycle } from './workout-runtime';
import TrainingLoadInstructions from '../../../components/TrainingLoadInstructions';
import { useWorkoutWakeLock } from './use-workout-wake-lock';
import { createWorkoutActivity, workoutActivityLog, workoutActivitySessionId, WORKOUT_ACTIVITY_HEARTBEAT_MS } from './workout-activity';
import type { WorkoutActivityReporter, WorkoutActivityResponse } from './workout-activity';
import './workout-experience.css';
import { savedWorkoutAllowsFeedback } from './feedback-invitation';

export default function PlayerWorkout({ workout, store, playerId, preview, onExit, onCompleted }: {
  workout: Row; store: PlayerWorkoutStore; playerId: string; preview: boolean; onExit: () => void; onCompleted?: () => void;
}) {
  const log = store.logFor(workout.id);
  const [blocks] = useState<Row[]>(() => workout.blocks || []);
  const [owner] = useState(() => ({ uid: auth.currentUser?.uid || 'preview', playerId, logId: String(workout.id), planId: String(workout.planId), workoutRevision: Number(workout.workoutRevision), ...(workout.source === 'personal' ? { kind: 'personal' as const } : {}) }));
  const [tabId] = useState(() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const tabActive = useRef(true);
  const [anotherTab, setAnotherTab] = useState(false), [localRecovery, setLocalRecovery] = useState(true);
  const key = runtimeKey(owner), legacyKey = `posetek:workout-clock:${owner.uid}:${playerId}:${workout.id}`;
  const [initial] = useState(() => {
    const recovered = (value: { clock: Clock; index: number; timerStartedHere: boolean }) => ({ ...value, clock: applyConfirmedElapsed(value.clock, workout.recoveredActiveSeconds, Date.now()), timerStartedHere: value.timerStartedHere || Number.isFinite(workout.recoveredActiveSeconds) });
    if (!preview) try {
      const raw = localStorage.getItem(key);
      const saved = restoreRuntime(JSON.parse(raw || 'null'), owner, blocks, log, Date.now());
      if (saved) return recovered(saved);
      const legacy = workout.source !== 'personal' && !raw && JSON.parse(localStorage.getItem(legacyKey) || 'null');
      if (validClock(legacy)) return recovered({ clock: reconcileClock(legacy, Date.now()), index: resumeIndex(blocks, log), timerStartedHere: false });
    } catch { /* Corrupt or unavailable device storage cannot prevent server-log recovery. */ }
    return recovered({ clock: newClock(Date.now()), index: resumeIndex(blocks, log), timerStartedHere: workout.timerStartedHere === true });
  });
  const [clock, updateClock] = useState<Clock>(initial.clock), clockRef = useRef(clock);
  const setClock = useCallback((change: Clock | ((old: Clock) => Clock)) => { const next = typeof change === 'function' ? change(clockRef.current) : change; clockRef.current = next; updateClock(next); }, []);
  const [now, setNow] = useState(() => Date.now()), [index, updateIndex] = useState(initial.index), indexRef = useRef(index);
  const setIndex = (i: number) => { indexRef.current = i; updateIndex(i); };
  const ended = useRef(!!log?.endedAt);
  useEffect(() => { if (log?.endedAt) ended.current = true; }, [log?.endedAt]);
  const [accountValid, setAccountValid] = useState(preview || auth.currentUser?.uid === owner.uid);
  const [summary, setSummary] = useState(false), [skip, setSkip] = useState(false), [chat, setChat] = useState(''), [pain, setPain] = useState(false);
  const painStopped = pain || !!log?.blocks?.some((r: Row) => r.skipReason === 'pain');
  const completionState = useRef({ painStopped, playerId, preview });
  completionState.current = { painStopped, playerId, preview };
  const wakeLock = useWorkoutWakeLock(accountValid && !anotherTab && !painStopped && !summary && !chat && !log?.endedAt && clock.runningSince !== null);
  const seconds = Math.floor(elapsed(clock, now));
  const usageElement = useRef<HTMLElement>(null);
  const activity = useRef<WorkoutActivityReporter | null>(null);
  const [activitySessionId] = useState(workoutActivitySessionId);
  const activityAttachment = useRef(0);
  const activityState = useRef({ playerId, painStopped, summary, chat });
  activityState.current = { playerId, painStopped, summary, chat };
  useEffect(() => {
    if (preview) return;
    const attached = ++activityAttachment.current;
    if (!activity.current) {
      activity.current = createWorkoutActivity({ uid: owner.uid, playerId: owner.playerId,
        ...workoutActivityLog(workout.source, owner.logId), sessionId: activitySessionId,
        newSessionId: workoutActivitySessionId,
        online: () => navigator.onLine !== false,
        read: () => ({ uid: auth.currentUser?.uid || null, playerId: activityState.current.playerId,
          currentOwner: tabActive.current, ended: ended.current,
          visible: document.visibilityState === 'visible' && !!usageElement.current?.getClientRects().length,
          running: !activityState.current.painStopped && !activityState.current.summary && !activityState.current.chat
            && reconcileClock(clockRef.current, Date.now()).runningSince !== null,
          blockId: blocks[indexRef.current]?.blockId }),
        send: async request => (await cloud.httpsCallable('recordWorkoutActivity')(request)).data as WorkoutActivityResponse,
      });
      // A restored paused timer waits for explicit Resume. Rendering it or
      // returning online is not evidence of new activity.
      activity.current.resume();
    }
    const report = () => activity.current?.heartbeat();
    const reconnect = () => { void activity.current?.flush(); };
    const timer = setInterval(report, WORKOUT_ACTIVITY_HEARTBEAT_MS);
    window.addEventListener('online', reconnect);
    return () => {
      clearInterval(timer); window.removeEventListener('online', reconnect);
      queueMicrotask(() => {
        if (activityAttachment.current === attached) {
          activity.current?.close(); activity.current = null;
        }
      });
    };
  }, [preview, owner, activitySessionId, workout.source, blocks]);
  useEffect(() => { if (clock.runningSince === null) activity.current?.pause(); }, [clock.runningSince]);
  useEffect(() => {
    const report = () => window.dispatchEvent(new CustomEvent('posetek:usage-workout', { detail: { active: document.visibilityState === 'visible' && accountValid && tabActive.current && !painStopped && !!usageElement.current?.getClientRects().length && !preview && !summary && !chat && !log?.endedAt && reconcileClock(clock, Date.now()).runningSince !== null } }));
    report(); const timer = setInterval(report, 500);
    return () => { clearInterval(timer); window.dispatchEvent(new CustomEvent('posetek:usage-workout', { detail: { active: false } })); };
  }, [clock, preview, summary, chat, log?.endedAt, accountValid, painStopped]);
  useEffect(() => { const id = setInterval(() => { const time = Date.now(); setNow(time); setClock(c => reconcileClock(c, time)); }, 500); return () => clearInterval(id); }, [setClock]);
  const persist = useCallback(() => { if (!preview && tabActive.current) try {
    if (ended.current) { localStorage.removeItem(key); localStorage.removeItem(legacyKey); }
    else {
      localStorage.setItem(key, JSON.stringify(runtimeSnapshot(owner, blocks, indexRef.current, clockRef.current, initial.timerStartedHere, tabId)));
      localStorage.removeItem(legacyKey);
    }
    setLocalRecovery(true);
  } catch { setLocalRecovery(false); } }, [preview, key, legacyKey, owner, blocks, initial.timerStartedHere, tabId]);
  useEffect(persist, [persist, clock, index, log?.endedAt]);
  const pause = useCallback((at = Date.now()) => { setClock(c => pauseClock(c, at)); persist(); activity.current?.pause(); }, [setClock, persist]);
  const resume = () => { setClock(c => resumeClock(c, Date.now())); activity.current?.resume(); };
  const attachment = useRef(0);
  useEffect(() => {
    const attached = ++attachment.current;
    const leave = () => pause();
    const sync = () => { const time = Date.now(); setNow(time); setClock(c => reconcileClock(c, time)); persist(); };
    const unwatch = watchWorkoutLifecycle(window, document, sync, leave);
    const changed = (event: StorageEvent) => {
      if (preview || event.key !== key || !tabActive.current || ended.current) return;
      try {
        const saved = JSON.parse(event.newValue || 'null');
        if (!shouldYieldRuntime(saved, tabId, owner, blocks, Date.now())) return;
        // The last opened tab owns the device timer. Stop this tab without
        // overwriting the new owner's position or bouncing storage events.
        tabActive.current = false; setAnotherTab(true);
        setClock(c => pauseClock(c, Date.now()));
      } catch { /* Ignore unrelated malformed storage events. */ }
    };
    window.addEventListener('storage', changed);
    const stop = preview ? () => {} : auth.onAuthStateChanged(user => { const valid = user?.uid === owner.uid; setAccountValid(valid); if (!valid) leave(); });
    return () => {
      const detachedAt = Date.now();
      stop(); unwatch(); window.removeEventListener('storage', changed);
      // StrictMode reattaches in the same turn. Real unmounts and hidden Activity
      // boundaries pause at their detach time, without counting the hidden time.
      queueMicrotask(() => { if (attachment.current === attached) pause(detachedAt); });
    };
  }, [pause, preview, owner, key, blocks, tabId, persist, setClock]);
  useEffect(() => { if (painStopped) pause(); }, [painStopped, pause]);
  const allowed = () => (preview || auth.currentUser?.uid === owner.uid) && tabActive.current && !painStopped && canMutateWorkout(clockRef.current, store.saving, ended.current, Date.now());
  const enabled = accountValid && !anotherTab && !painStopped && canMutateWorkout(clock, store.saving, !!log?.endedAt, now);
  const move = (i: number) => { if (!allowed()) return; setIndex(i); setClock(c => stopRest(c)); activity.current?.progress(); };
  const block = blocks[index];
  const row = log?.blocks?.find((r: Row) => r.blockId === block?.blockId);
  const done = row?.setsCompleted || 0, target = Math.max(1, block?.sets || 1);
  const rest = restSeconds(clock, now);
  const tick = async (count: number) => {
    if (!allowed()) return;
    const actionAt = Date.now();
    try {
      const next = Math.max(0, Math.min(target, count));
      const r = next ? { ...blockLogRow(block, next), estimatedMinutes: block.estimatedMinutes || 0 } : null;
      await store.saveBlock(workout.id, block.blockId, r, initial.timerStartedHere ? Math.floor(elapsed(clockRef.current, Date.now())) : undefined);
      activity.current?.progress(actionAt);
      const restSeconds = block.restScope === 'reps' ? Number(block.restBetweenSetsSeconds || 0) : Number(block.restSeconds || 0);
      setClock(c => next > done && next < target && restSeconds > 0 ? { ...c, restTotal: restSeconds, restUntil: c.runningSince !== null ? Date.now() + restSeconds * 1000 : null, frozenRest: c.runningSince === null ? restSeconds : null } : stopRest(c));
    } catch { /* store surfaces the retryable error */ }
  };
  const skipBlock = async (reason: string) => {
    if (!allowed()) return;
    const actionAt = Date.now();
    try {
      await store.saveBlock(workout.id, block.blockId, { ...skippedLogRow(block, done, reason), estimatedMinutes: block.estimatedMinutes || 0 }, initial.timerStartedHere ? Math.floor(elapsed(clockRef.current, Date.now())) : undefined);
      activity.current?.progress(actionAt);
      setSkip(false); setClock(c => stopRest(c));
      if (reason === 'pain') { pause(); setPain(true); }
      else if (index + 1 < blocks.length) setIndex(index + 1); else { pause(); setSummary(true); }
    } catch { /* retry remains visible */ }
  };
  const finish = async () => {
    if (store.saving || !tabActive.current || ended.current || !accountValid || (!preview && auth.currentUser?.uid !== owner.uid)) return;
    try {
      const stopped = pauseClock(clockRef.current, Date.now()); setClock(stopped); persist(); activity.current?.pause();
      // A clock first opened midway through a native/other-device workout cannot
      // replace its full duration with the minutes observed on this browser.
      const endReason = endReasonFor(blocks, log);
      const completedWork = blocks.some(b => log?.blocks?.some((r: Row) => r.blockId === b.blockId && Number(r.setsCompleted) > 0));
      const invite = await savedWorkoutAllowsFeedback(
        () => store.finish(workout.id, endReason, initial.timerStartedHere ? Math.floor(elapsed(stopped, Date.now())) : undefined),
        () => ({ endReason, hasCompletedWork: completedWork, painStopped: completionState.current.painStopped,
          preview: completionState.current.preview, currentAccount: auth.currentUser?.uid === owner.uid && completionState.current.playerId === owner.playerId,
          currentTab: tabActive.current, visible: document.visibilityState === 'visible' && !!usageElement.current?.getClientRects().length }));
      ended.current = true;
      activity.current?.dispose();
      persist();
      onExit();
      if (invite) onCompleted?.();
    } catch { /* do not dismiss before acknowledged save */ }
  };
  if (log?.endedAt) return <section ref={usageElement} className="portal-card"><h2>Workout saved</h2><p>This workout has ended.</p><button className="primary-cta" onClick={onExit}>Back to training</button></section>;
  if (chat) return <section><button className="text-button" onClick={() => setChat('')}>Back to workout</button><h2>Ask about this drill</h2><CoachChat key={block.blockId} playerId={playerId} preview={preview} capability="coaching_chat" initialText={chat.slice(0, 1900)} /></section>;
  return <section ref={usageElement} className="player-guided" onClickCapture={event => {
    setClock(c => interactClock(c, Date.now()));
    if (event.nativeEvent.isTrusted && !(event.target as Element).closest('[data-workout-activity="explicit"]')) activity.current?.progress();
  }}>
    <header className="player-workout-bar"><button data-workout-activity="explicit" aria-label="Back to training" onClick={() => { pause(); onExit(); }}>←</button><div className="workout-elapsed"><small>Elapsed{!initial.timerStartedHere ? ' here' : ''}</small><strong role="timer" aria-label="Workout elapsed time">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong></div><button data-workout-activity="explicit" disabled={!accountValid || anotherTab || painStopped || summary} onClick={() => clock.runningSince !== null ? pause() : resume()}>{clock.runningSince !== null ? 'Pause' : 'Resume'}</button><button data-workout-activity="explicit" disabled={store.saving || !accountValid || anotherTab} onClick={() => { pause(); setSummary(true); }}>End</button></header>
    {!accountValid ? <p className="player-error" role="alert">Your account changed. Return to training before continuing.</p> : anotherTab ? <p className="player-error" role="alert">This workout was opened in another tab. Continue there, or return to Training to resume here.</p> : clock.runningSince === null && !summary && !painStopped && <p className="workout-pause-note" role="status">{clock.pauseReason === 'inactivity' ? 'Paused after 30 minutes without activity. Resume when you are ready.' : 'Workout paused. Resume to continue.'}</p>}
    {store.error && <p className="player-error" role="alert">{store.error} Your last confirmed progress is preserved. Retry the action.</p>}
    <div className="workout-save-line" role="status">{store.saving ? 'Saving progress…' : preview ? 'Sample session · progress is not saved' : !store.error ? 'Progress saved' : 'Save needs attention'}</div>
    {!localRecovery && <p className="muted-copy" role="status">This browser could not save your timer for recovery. Confirmed sets are still saved to your account.</p>}
    {!summary && !painStopped && <details className="workout-screen-options"><summary>Screen and timer options</summary><label><input type="checkbox" checked={wakeLock.enabled} disabled={wakeLock.state === 'unsupported'} onChange={e => wakeLock.setEnabled(e.target.checked)} />Keep screen awake</label><p className="muted-copy" role="status">{wakeLock.state === 'unsupported' ? 'This browser does not support keeping the screen awake.' : wakeLock.state === 'active' ? 'Screen stays awake while this workout is open and running.' : wakeLock.state === 'unavailable' ? 'Your device could not keep the screen awake. You can continue training.' : wakeLock.enabled ? 'Screen stays awake when the workout is visible and running.' : 'Optional while training. You can turn it off at any time.'}</p>{wakeLock.state === 'unavailable' && wakeLock.enabled && <button onClick={wakeLock.retry}>Try again</button>}<p className="muted-copy">After unlocking, return here to see the updated timer. The website cannot show a live lock-screen timer. It pauses after 30 minutes without activity.</p></details>}
    {painStopped && !summary && <section className="portal-card"><h2>Stop here</h2><p>Tell a parent or coach about the pain and get it checked before training that area again.</p><button className="primary-cta" disabled={store.saving || anotherTab || !accountValid} onClick={() => void finish()}>End workout</button><button onClick={() => setSummary(true)}>Review what I completed</button></section>}
    {summary ? <>
      <section className="portal-card"><p className="eyebrow">{workout.source === 'personal' ? 'Personal session summary' : 'Session summary'}</p><h2>{endReasonFor(blocks, log) === 'completed' ? 'Nice work.' : 'Your work counts.'}</h2><p>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} active on this timer{!initial.timerStartedHere ? ' · Earlier timing was not collected here' : ''}</p>
        {blocks.map(b => { const r = log?.blocks?.find((v: Row) => v.blockId === b.blockId); return <div className="player-history-row" key={b.blockId}><strong>{b.name}</strong><span>{r?.status === 'skipped' ? `Skipped · ${r.skipReason}` : `${r?.setsCompleted || 0}/${b.sets || 1} sets`}</span></div>; })}
        <p>{domainExposures(blocks, log).map(e => `${domainLabel(e.domain)}: ${e.count} ${e.count === 1 ? 'drill' : 'drills'} with completed work`).join(' · ')}</p>
      </section><button className="primary-cta" disabled={store.saving || !accountValid || anotherTab} onClick={() => void finish()}>Save and finish</button><button data-workout-activity="explicit" className="hub-secondary" disabled={store.saving || !accountValid || anotherTab || painStopped} onClick={() => { setSummary(false); activityState.current.summary = false; resume(); }}>Keep training</button>
    </> : block && !painStopped && <>
      <nav className="player-block-strip" aria-label="Workout drills">{blocks.map((b, i) => <button key={b.blockId} disabled={!enabled} aria-label={`Drill ${i + 1}: ${b.name}`} aria-current={i === index ? 'step' : undefined} onClick={() => move(i)}>{i + 1}{log?.blocks?.find((r: Row) => r.blockId === b.blockId)?.status === 'done' ? ' ✓' : ''}</button>)}</nav>
      <p className="eyebrow">{domainLabel(block.domain)} · Drill {index + 1} of {blocks.length}</p><h2>{block.name}</h2><p>{blockDoseLine({ ...block, sets: block.sets, reps: block.reps, repUnit: block.repUnit })}</p>
      <div className="workout-progress-label"><span>{done} of {target} sets complete</span><span>{blocks.filter(b => log?.blocks?.some((r: Row) => r.blockId === b.blockId && ['done', 'skipped'].includes(r.status))).length} / {blocks.length} drills reviewed</span></div>
      <progress aria-label="Current drill sets completed" value={done} max={target} />
      <DrillMedia key={block.drillId} drillId={block.drillId} preview={preview} onChat={setChat} />
      <TrainingLoadInstructions block={block} />
      <section className="portal-card"><p className="eyebrow">{rest > 0 ? 'Rest now' : done >= target ? 'Drill complete' : `Up next · Set ${done + 1} of ${target}`}</p>
        {rest > 0 && <div className="player-rest"><div><strong role="timer" aria-label="Rest time remaining">{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</strong>{clock.restTotal ? <small>{Math.max(0, clock.restTotal - rest)}s of {clock.restTotal}s rested</small> : null}</div><button disabled={!enabled} onClick={() => { if (allowed()) setClock(c => stopRest(c)); }}>Skip rest</button></div>}
        <div className="player-sets">{Array.from({ length: target }, (_, i) => i + 1).map(n => <button key={n} disabled={!enabled} aria-pressed={n <= done} aria-label={`Set ${n}${n <= done ? ', completed' : ''}`} onClick={() => void tick(n === done ? n - 1 : n)}>{n <= done ? '✓' : n}</button>)}</div>
        {block.cues?.length > 0 && <ul>{block.cues.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}{block.whyIncluded && <p>{block.whyIncluded}</p>}
      </section>
      {skip ? <section className="portal-card"><h3>Why are you skipping this drill?</h3><div className="player-actions">{SKIP_REASONS.map(r => <button disabled={!enabled} key={r.id} onClick={() => void skipBlock(r.id)}>{r.label}</button>)}<button onClick={() => setSkip(false)}>Cancel</button></div></section> : <button className="text-button" disabled={!enabled} onClick={() => setSkip(true)}>Skip drill</button>}
      <div className="player-workout-controls"><button disabled={index === 0 || !enabled} onClick={() => move(index - 1)} aria-label="Previous drill">←</button><button className="primary-cta" disabled={!enabled} onClick={() => done < target && row?.status !== 'skipped' ? void tick(done + 1) : index + 1 < blocks.length ? move(index + 1) : (pause(), setSummary(true))}>{done < target && row?.status !== 'skipped' ? `Complete set ${done + 1}` : index + 1 < blocks.length ? 'Next drill' : 'See summary'}</button><button disabled={!enabled} aria-label="Next drill" onClick={() => index + 1 < blocks.length ? move(index + 1) : (pause(), setSummary(true))}>→</button></div>
    </>}
  </section>;
}
