import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { db } from '../../../lib/firebase';
import { currentWeekNumber, nextWorkout, orderedWeeks, orderedWorkouts, stateOf, workoutStates, findWorkout } from '../../../lib/contracts/planV3';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import TrainingLoadInstructions from '../../../components/TrainingLoadInstructions';
import { domainLabel } from '../../../lib/contracts/types';
import { submitLlmJob, waitForJob } from '../lib/loaders';
import { dateText } from '../lib/mobile';
import type { PortalContext } from '../views/shared';
import TrainingView from '../views/TrainingView';
import '../views/training-hub.css';
import { completedMinutes, executable } from './execution';
import type { Row } from './execution';
import { usePlayerWorkouts } from './use-player-workouts';
import { capabilityEnabled, useCoachConfig } from './gateway';
import ProgramIntake from './ProgramIntake';
import PlayerWorkout from './PlayerWorkout';
import DrillMedia from './DrillMedia';
import CoachChat from './CoachChat';
import { weekProgress } from './progress';
import { needsTrainingStartCheck } from './workout-repository';
import TrainingStartConfirmation from './TrainingStartConfirmation';
import PersonalWorkoutHub from './PersonalWorkoutHub';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import { personalDraftLink } from './personal-conversation';
import type { SourceWorkout } from './personal-workouts';
import { personalProgress } from './personal-workouts';

export function previewProgram(): Row {
  const today = new Date();
  return { id: 'preview-plan', schemaVersion: 3, status: 'active', horizonWeeks: 2, startDate: today.toLocaleDateString('en-CA'), timezone: 'America/Los_Angeles', sessionsPerWeek: 2, minutesPerSession: 30,
    assessment: { summary: 'A focused block to improve close control and quick changes of direction.' }, intake: { goals: ['dribbling', 'speedAgility'], setting: 'solo' },
    weeks: [1, 2].map(weekNumber => ({ weekNumber, theme: weekNumber === 1 ? 'Own your first touch' : 'Keep control at speed', focus: 'Stay controlled, then build speed.', targets: [{ domain: 'dribbling', exposures: 2 }, { domain: 'passing', exposures: 2 }],
      workouts: [1, 2].map(order => ({ workoutId: `w${weekNumber}s${order}`, revision: 1, order, title: order === 1 ? 'Keep the ball close' : 'Quick feet, sharp turns', intent: 'Build clean touches and stay balanced.', estimatedMinutes: 28, budgetMinutes: 30, focusDomains: ['dribbling', 'passing'],
        blocks: [{ blockId: 'b1', order: 1, drillId: 'DRB-005', name: 'Cone maze', kind: 'main', domain: 'dribbling', sets: 3, reps: 60, repUnit: 'seconds', restSeconds: 30, restScope: 'sets', estimatedMinutes: 14, cues: ['Small touches', 'Eyes up'] }, { blockId: 'b2', order: 2, drillId: 'PAS-001', name: 'Wall pass rhythm', kind: 'main', domain: 'passing', sets: 3, reps: 60, repUnit: 'seconds', restSeconds: 30, restScope: 'sets', estimatedMinutes: 12, cues: ['Open your body'] }] })) })) };
}

export default function PlayerTraining({ ctx, statsProfile, personal, request, onAcknowledge, onCompleted }: { ctx: PortalContext; statsProfile: Row; personal: PersonalWorkoutStore; request: Row | null; onAcknowledge: () => void; onCompleted?: () => void }) {
  const preview = ctx.access === 'preview';
  const [plans, setPlans] = useState<Row[] | null>(preview ? [previewProgram()] : null), [error, setError] = useState('');
  const [intake, setIntake] = useState(false), [seed, setSeed] = useState(''), [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [panel, setPanel] = useState('');
  const [review, setReview] = useState<Row | null>(null), [playing, setPlaying] = useState<Row | null>(null), [drillId, setDrillId] = useState('');
  const [chatTarget, setChatTarget] = useState<Row | null>(null), [proposal, setProposal] = useState<Row | null>(null);
  const [applying, setApplying] = useState(false), [newTime, setNewTime] = useState(30), [energy, setEnergy] = useState('normal');
  const config = useCoachConfig(preview);
  const location = useLocation(), navigate = useNavigate(), navigationType = useNavigationType();
  const [personalOpen, setPersonalOpen] = useState(false), [personalSource, setPersonalSource] = useState<{ workout: Row; reference?: SourceWorkout } | undefined>();
  const [personalSelected, setPersonalSelected] = useState<Row | undefined>();
  const [personalCreate, setPersonalCreate] = useState(false);
  const [personalHandoff, setPersonalHandoff] = useState<Row | undefined>();
  const [conversationOpen, setConversationOpen] = useState(false);
  const [personalEntry, setPersonalEntry] = useState(0);
  const requestedConversation = new URLSearchParams(location.search).get('personalConversation');
  const previousConversation = useRef(requestedConversation);
  useEffect(() => {
    const previous = previousConversation.current; previousConversation.current = requestedConversation;
    if (!personal.enabled || !personal.selectionReady) return;
    if (!requestedConversation) {
      if (previous && navigationType === 'POP') { setPersonalOpen(true); setPersonalCreate(false); setConversationOpen(false); setSeed(''); setPersonalSource(undefined); setPersonalSelected(undefined); setPersonalHandoff(undefined); setPersonalEntry(v => v + 1); }
      return;
    }
    // The conversation already selected by the visible hub only updates its
    // address. Do not remount it and discard the just-confirmed session setup.
    // Browser Back/Forward and external links still recover through the route.
    if (personalOpen && personal.conversationId === requestedConversation && navigationType !== 'POP') return;
    setPersonalOpen(true); setConversationOpen(true); setSeed(''); setPersonalEntry(v => v + 1);
    if (personal.conversationId !== requestedConversation) void personal.openConversation(requestedConversation).catch(e => setError(e.message));
  }, [requestedConversation, personal.enabled, personal.selectionReady]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const plan = plans?.find(p => p.status === 'active') || plans?.find(p => p.status === 'completed') || null;
  const store = usePlayerWorkouts(ctx.playerId!, playing?.planId || plan?.id || null, preview);
  const [recordedSessions, setRecordedSessions] = useState<Row[]>([]);
  useEffect(() => {
    if (preview) return;
    return db.collection('players').doc(ctx.playerId!).collection('trainingSessions').onSnapshot(s => setRecordedSessions(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
  }, [ctx.playerId, preview]);
  useEffect(() => {
    if (preview) return;
    return db.collection('players').doc(ctx.playerId!).collection('trainingPlans').onSnapshot(s => {
      setPlans(s.docs.map(d => ({ ...d.data(), id: d.id })).sort((a: Row, b: Row) => (b.generatedAt?.toMillis?.() || 0) - (a.generatedAt?.toMillis?.() || 0)));
      setError('');
    }, e => setError(e.message));
  }, [ctx.playerId, preview]);
  useEffect(() => {
    if (!request || !plans || playing || review || chatTarget || (!preview && !config)) return;
    setSeed(request.request || '');
    if (request.destination === 'personal_workout' && personal.enabled) {
      setPersonalSource(undefined); setPersonalSelected(undefined); setPersonalHandoff(request); setPersonalCreate(!request.conversationId); setConversationOpen(!!request.conversationId); setPersonalOpen(true); setPersonalEntry(v => v + 1);
      if (request.conversationId && personal.conversationId !== request.conversationId) void personal.openConversation(request.conversationId).catch(e => setError(e.message));
      onAcknowledge(); return;
    }
    if (request.destination === 'workout_builder' && personal.enabled) {
      const supplied = request.workoutRef, found = supplied?.kind === 'plan' && supplied.planId === plan?.id ? findWorkout(plan!, supplied.workoutId) : null;
      setPersonalSource(found ? { workout: found.workout, reference: { planId: plan!.id, workoutId: found.workout.workoutId, revision: Number(found.workout.revision || 1) } } : undefined);
      setPersonalSelected(undefined); setPersonalCreate(false); setPersonalOpen(true); onAcknowledge(); return;
    }
    if (request.destination !== 'program_intake' && plan?.schemaVersion === 3 && plan.status === 'active') {
      const supplied = request.workoutRef;
      if (supplied?.kind === 'plan') { setError('Personal workout copies are not enabled yet. Your assigned workout stays as prescribed.'); onAcknowledge(); return; }
      setChatTarget(supplied && (supplied.kind === 'adhoc' || (supplied.kind === 'new' && supplied.planId === plan.id)) ? supplied : { kind: 'new', planId: plan.id, timeAvailableMinutes: 30, energy: 'normal' });
    } else setIntake(true);
    onAcknowledge();
  }, [request, plans, playing, review, chatTarget, personal.enabled, config]);
  const start = async (w: Row) => { try { setPlaying(await store.start(w)); setReview(null); setChatTarget(null); } catch { /* store owns error */ } };
  const apply = async (andStart: boolean) => {
    if (!proposal || applying) return;
    setApplying(true); setError('');
    const stops: (() => void)[] = [];
    try {
      if (proposal.target?.kind === 'plan') throw new Error('Save adjustments as a personal copy. Assigned workouts stay as prescribed.');
      const ref = await submitLlmJob(ctx.playerId!, 'apply_workout_draft', { draftId: proposal.draftId });
      const job = await waitForJob(ref.id, () => {}, u => stops.push(u));
      if (!mounted.current) return;
      const result = job.result;
      if (!result?.applied || !['plan', 'adhoc'].includes(result.target?.kind)) throw new Error('The saved workout reference is unavailable. Retry this proposal.');
      if (result.target.kind === 'plan' && (result.target.planId !== proposal.target?.planId || result.target.workoutId !== proposal.target?.workoutId)) throw new Error('The saved target does not match this proposal. Reload training.');
      let ready: Row;
      if (result.target.kind === 'plan') {
        const doc = await db.collection('players').doc(ctx.playerId!).collection('trainingPlans').doc(result.target.planId).get({ source: 'server' });
        const p = { ...doc.data(), id: doc.id }, found = findWorkout(p, result.target.workoutId);
        if (!found) throw new Error('The saved workout could not be loaded. Refresh training.');
        ready = executable(p, found.workout, found.week.weekNumber);
      } else {
        const doc = await db.collection('players').doc(ctx.playerId!).collection('plannedWorkouts').doc(result.target.plannedWorkoutId).get({ source: 'server' });
        if (!doc.exists) throw new Error('The saved workout could not be loaded.');
        ready = executable(plan!, { ...doc.data(), id: doc.id }, doc.data()!.weekNumber, 'adhoc'); store.noteWorkout(ready);
      }
      if (!mounted.current) return;
      setChatTarget(null); setProposal(null); setReview(ready);
      if (andStart && !needsTrainingStartCheck(ready)) await start(ready);
    } catch (e: any) { setError(e.message); }
    finally { setApplying(false); stops.forEach(s => s()); }
  };
  const logs = Object.values(store.logs);
  const weekNumber = selected || (plan ? currentWeekNumber(plan) : 1);
  const week = plan && orderedWeeks(plan).find(w => w.weekNumber === weekNumber);
  const next = plan && nextWorkout(plan, logs);
  const states = workoutStates(plan?.id || '', logs);
  const progress = plan ? weekProgress(plan, week || undefined, logs, ctx.allStatsReps(), recordedSessions) : null;
  const openPlan = () => { setSeed(''); setIntake(true); setPanel(''); };
  const back = <button className="text-button" disabled={applying} onClick={() => { setPanel(''); setReview(null); setChatTarget(null); setDrillId(''); setProposal(null); }}>← Training</button>;
  const message = (error || store.error) && <p className="player-error" role="alert">{error || store.error}</p>;
  const openPersonal = (w?: Row, create = false) => { setSeed(''); setPersonalSource(undefined); setPersonalSelected(w); setPersonalHandoff(undefined); setConversationOpen(false); setPersonalCreate(create); if (create) personal.newConversation(); setPersonalOpen(true); setPersonalEntry(v => v + 1); };
  const personalResume = personal.enabled ? personal.workouts.find(w => personal.logs[w.workoutId] && !personal.logs[w.workoutId].endedAt) : undefined;
  const ownProgress = personalProgress(Object.values(personal.logs));
  const personalActions = personal.enabled && <div className="player-actions"><button onClick={() => openPersonal()}>Personal workouts</button><button onClick={() => setPanel('history')}>History</button></div>;

  const closePersonal = () => { setPersonalOpen(false); setPersonalSource(undefined); setPersonalSelected(undefined); setPersonalCreate(false); setConversationOpen(false); navigate({ search: personalDraftLink(location.search) }, { replace: true }); };
  if (personalOpen) return <PersonalWorkoutHub key={personalEntry} store={personal} playerId={ctx.playerId!} athlete={ctx.athlete} config={config} preview={preview} source={personalSource} initialWorkout={personalSelected} initialCreate={personalCreate} initialRequest={seed} initialHandoff={personalHandoff} initialConversation={conversationOpen} onSelection={id => { const search = personalDraftLink(location.search, id); if (new URLSearchParams(location.search).get('view') === 'training' && search !== new URLSearchParams(location.search).toString()) navigate({ search }); }} onBack={closePersonal} onCompleted={() => { closePersonal(); onCompleted?.(); }} />;
  if (playing) return <PlayerWorkout workout={playing} store={store} playerId={ctx.playerId!} preview={preview} onExit={() => setPlaying(null)} onCompleted={onCompleted} />;
  if (intake) return <ProgramIntake playerId={ctx.playerId!} athlete={ctx.athlete} statsProfile={statsProfile} preview={preview} initialText={seed} onReady={() => { setIntake(false); setReveal(true); }} onBack={() => setIntake(false)} />;
  if (!plans) return <section className="portal-card"><p>{error || 'Loading training…'}</p></section>;
  if (panel === 'history') return <>{back}<TrainingHistory playerId={ctx.playerId!} preview={preview} plans={plans} currentLogs={logs} onReview={w => { setPanel(''); setReview(w); }} /></>;
  if (!plan) return <><p className="eyebrow">Your training</p><h1>Choose today’s session.</h1>{personal.enabled && <section className="portal-card"><h2>Start with a single workout</h2><p>Ask your AI coach for a workout, review it, then track your sets.</p><button className="primary-cta" onClick={() => openPersonal(personalResume, !personalResume)}>{personalResume ? 'Resume personal workout' : 'Create a personal workout'}</button></section>}{personalActions}<section className="portal-card"><h2>Build a longer plan</h2><p>Turn your goals and results into a week of focused sessions.</p><button className="hub-secondary" onClick={openPlan}>Build my plan</button>{!personal.enabled && <button className="hub-secondary" onClick={() => setPanel('history')}>History</button>}</section></>;
  if (plan.schemaVersion !== 3) return <>{personalActions}<button className="hub-secondary" onClick={openPlan}>Build a new plan</button><TrainingView ctx={ctx} /></>;
  if (drillId) return <><button className="text-button" onClick={() => setDrillId('')}>← Back</button><DrillMedia drillId={drillId} preview={preview} /></>;
  if (chatTarget) return <>{back}<h2>{chatTarget.kind === 'new' ? 'Create your workout' : 'Adjust with your coach'}</h2>{message}
    <CoachChat key={JSON.stringify(chatTarget)} playerId={ctx.playerId!} preview={preview} capability="workout_chat" context={{ workoutRef: chatTarget }} initialText={seed} onDraft={setProposal} />
    {proposal && <section className="portal-card"><p className="eyebrow">Proposed workout · not saved yet</p><h3>{proposal.workout?.title}</h3><p>{proposal.workout?.intent}</p><WorkoutBlocks workout={proposal.workout} onDrill={setDrillId} /><div className="player-actions"><button className="primary-cta" disabled={applying || !capabilityEnabled(config, 'apply_workout_draft')} onClick={() => void apply(false)}>{applying ? 'Saving…' : 'Save workout'}</button><button disabled={applying || !capabilityEnabled(config, 'apply_workout_draft')} onClick={() => void apply(true)}>Save and start</button></div></section>}
  </>;
  if (review) {
    const log = store.logFor(review.id), snapshot = log?.workoutSnapshot || review;
    return <>{back}<p className="eyebrow">{log?.endedAt ? log.endReason === 'completed' ? 'Completed' : 'Ended early' : log ? 'In progress' : 'Your workout'}</p><h2>{snapshot.title || 'Workout'}</h2><p>{snapshot.intent}</p><p>{snapshot.estimatedMinutes} minutes · {snapshot.blocks?.length || 0} drills</p>{message}<WorkoutBlocks workout={snapshot} onDrill={setDrillId} />
      {log?.endedAt ? <p>Saved {dateText(log.endedAt)}. Completed sets remain in your history.</p> : needsTrainingStartCheck(review) ? <TrainingStartConfirmation key={review.id} disabled={store.saving || !store.logsLoaded || plan.status !== 'active'} resuming={Boolean(log)} onStart={confirmation => void start({ ...review, startConfirmation: confirmation })} /> : <button className="primary-cta" disabled={store.saving || !store.logsLoaded || plan.status !== 'active'} onClick={() => void start(review)}>{store.saving ? 'Starting…' : log ? 'Resume workout' : 'Start workout'}</button>}
      {personal.enabled && <button className="hub-secondary" onClick={() => { personal.newConversation(); setPersonalEntry(v => v + 1); setConversationOpen(false); setPersonalHandoff(undefined); setSeed(''); setPersonalSelected(undefined); setPersonalSource({ workout: snapshot, ...(review.source === 'plan' ? { reference: { planId: review.planId, workoutId: review.workoutId, revision: Number(review.workoutRevision || 1) } } : {}) }); setPersonalOpen(true); setReview(null); }}>Customize a personal copy</button>}
      {!log && review.source !== 'plan' && <button className="hub-secondary" disabled={!capabilityEnabled(config, 'workout_chat')} onClick={() => { setSeed(''); setChatTarget({ kind: 'adhoc', plannedWorkoutId: review.workoutId }); setReview(null); }}>Adjust with your AI coach</button>}
    </>;
  }
  if (panel === 'details') return <>{back}<section className="portal-card"><h2>Plan details</h2><p>{plan.assessment?.summary}</p><p>{plan.horizonWeeks} weeks · {plan.sessionsPerWeek || plan.intake?.sessionsPerWeek} sessions per week · {plan.minutesPerSession || plan.intake?.minutesPerSession} minutes per session</p><p>Goals: {(plan.intake?.goals || []).join(', ')}</p>{plan.intake?.freeTextGoals && <p>{plan.intake.freeTextGoals}</p>}{(plan.focusAreas || []).map((f: Row, i: number) => <p key={i}>{f.domain || f.title}: {f.rationale || f.reason}</p>)}<p>{(plan.disclaimers || []).join(' ')}</p><button className="hub-secondary" onClick={openPlan}>Start a new plan</button></section></>;
  return <section className="player-training"><p className="eyebrow">Your training</p><h1>Make every session count.</h1>{message}
    {reveal && <section className="portal-card"><h2>Your plan is ready</h2><p>{plan.assessment?.summary}</p><button onClick={() => setReveal(false)}>Explore my plan</button></section>}
    {plan.status === 'completed' && <section className="portal-card"><h2>Block complete</h2><p>Review your work and build your next block.</p><button className="primary-cta" onClick={openPlan}>Plan my next block</button></section>}
    {personalResume && <button className="primary-cta player-next" onClick={() => openPersonal(personalResume)}><span><small>Resume personal workout</small><strong>{personalResume.title}</strong></span><span>→</span></button>}
    {next && <button className="primary-cta player-next" disabled={!store.logsLoaded} onClick={() => setReview(executable(plan, next.workout, next.weekNumber))}><span><small>{next.reason === 'resume' ? 'Resume assigned workout' : `Next assigned · Week ${next.weekNumber}`}</small><strong>{next.workout.title}</strong></span><span>→</span></button>}
    <div className="player-actions">{personal.enabled && <button onClick={() => openPersonal(undefined, true)}>Create workout</button>}<button onClick={() => setPanel('history')}>History</button>{personal.enabled && <button onClick={() => openPersonal()}>My personal workouts</button>}</div>
    <nav className="player-week-rail" aria-label="Plan weeks">{orderedWeeks(plan).map(w => <button key={w.weekNumber} aria-pressed={w.weekNumber === weekNumber} onClick={() => setSelected(w.weekNumber)}><strong>Week {w.weekNumber}</strong><span>{w.theme}</span></button>)}</nav>
    <section className="portal-card"><p className="eyebrow">Week {weekNumber} of {plan.horizonWeeks}</p><h2>{week?.theme}</h2><p>{week?.focus}</p>{week?.progressionNote && <p>{week.progressionNote}</p>}</section>
    {!next && plan.status === 'active' && <section className="portal-card"><h2>You’ve reached the end of this schedule</h2><p>Review your progress or create a new workout.</p><button onClick={openPlan}>Build a new plan</button></section>}
    <WeekProgress plan={plan} week={week} logs={logs} reps={ctx.allStatsReps()} sessions={recordedSessions} />
    {personal.enabled && Object.keys(personal.logs).length > 0 && <section className="portal-card"><h2>Your personal training</h2><p>{ownProgress.sessions} finished {ownProgress.sessions === 1 ? 'session' : 'sessions'} · {ownProgress.sets} {ownProgress.sets === 1 ? 'set' : 'sets'} saved</p><p>{Math.floor(ownProgress.seconds / 60)}:{String(ownProgress.seconds % 60).padStart(2, '0')} active time recorded across your personal workouts.</p><button className="text-button" onClick={() => openPersonal()}>Review personal sessions →</button></section>}
    <section className="portal-card"><h2>This week’s workouts</h2>{orderedWorkouts(week).map(w => <button className="player-list-button" key={w.workoutId} onClick={() => setReview(executable(plan, w, weekNumber))}><strong>{w.title}</strong><small>{stateOf(states, w.workoutId).kind === 'finished' ? 'Finished' : stateOf(states, w.workoutId).kind === 'inProgress' ? 'In progress' : 'Not started'} · {w.estimatedMinutes} min</small></button>)}</section>
    <details className="portal-card"><summary>This week’s drills</summary>{[...new Map(orderedWorkouts(week).flatMap(w => w.blocks).map(b => [b.drillId, b])).values()].map(b => <button className="player-list-button" key={b.drillId} onClick={() => setDrillId(b.drillId)}>{b.name}<small>{progress?.drillDone[b.drillId] || 0}/{progress?.drillTargets[b.drillId] || 0} sessions completed · Demonstration →</small></button>)}</details>
    {plan.status === 'active' && !personal.enabled && <section className="portal-card"><h2>Create your workout</h2><p>Tell your coach what you have time and energy for today.</p><div className="player-choice-grid"><label>Minutes<input type="number" min={1} max={135} value={newTime} onChange={e => setNewTime(Number(e.target.value))} /></label><label>Energy<select value={energy} onChange={e => setEnergy(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label></div><button className="hub-secondary" disabled={!capabilityEnabled(config, 'workout_chat') || newTime < 1 || newTime > 135} onClick={() => { setSeed(''); setChatTarget({ kind: 'new', planId: plan.id, timeAvailableMinutes: newTime, energy }); }}>Choose my focus</button><small>Up to three workout adjustment requests per day.</small></section>}
    {!!store.workouts.length && <section className="portal-card"><h2>Extra workouts</h2>{store.workouts.map(w => <button className="player-list-button" key={w.id} onClick={() => setReview(executable(plan, w, w.weekNumber, 'adhoc'))}>{w.title || 'Workout'}<small>{dateText(w.generatedAt)}</small></button>)}</section>}
    <div className="player-actions"><button onClick={() => setPanel('details')}>Plan details</button></div>
    <p className="muted-copy">Record drill tests and free sessions in the PoseTek app. Your saved results and videos appear in Drills.</p>
  </section>;
}

function WorkoutBlocks({ workout, onDrill }: { workout: Row; onDrill: (id: string) => void }) {
  return <section className="portal-card">{(workout?.blocks || []).map((b: Row) => <button className="player-list-button" key={b.blockId} onClick={() => onDrill(b.drillId)}><strong>{b.name}</strong><small>{blockDoseLine({ ...b, sets: b.sets, reps: b.reps, repUnit: b.repUnit })}</small>{b.whyIncluded && <span>{b.whyIncluded}</span>}<TrainingLoadInstructions block={b} /></button>)}</section>;
}

function WeekProgress({ plan, week, logs, reps, sessions }: { plan: Row; week: any; logs: Row[]; reps: Row[]; sessions: Row[] }) {
  const progress = weekProgress(plan, week, logs, reps, sessions);
  return <section className="portal-card"><h2>This week’s progress</h2>{progress.domains.map(d => <div className="player-progress-row" key={d.domain}><span>{domainLabel(d.domain)}</span><strong>{d.target > 0 ? `${d.done}/${d.target}` : `${d.done} extra ${d.done === 1 ? 'session' : 'sessions'}`}</strong>{d.target > 0 && <progress max={d.target} value={Math.min(d.done, d.target)} />}</div>)}<p><strong>{progress.minutes} minutes</strong> credited from completed and partial drills.</p><small>Assigned workouts and eligible recorded sessions contribute to these plan targets. Personal workouts are listed separately.</small></section>;
}

function TrainingHistory({ playerId, preview, plans, currentLogs, onReview }: { playerId: string; preview: boolean; plans: Row[]; currentLogs: Row[]; onReview: (w: Row) => void }) {
  const [logs, setLogs] = useState<Row[]>(currentLogs), [sessions, setSessions] = useState<Row[]>([]), [error, setError] = useState('');
  useEffect(() => {
    if (preview) return;
    const player = db.collection('players').doc(playerId);
    const stop = player.collection('workoutLogs').onSnapshot(s => setLogs(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
    const stopSessions = player.collection('trainingSessions').onSnapshot(s => setSessions(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
    return () => { stop(); stopSessions(); };
  }, [playerId, preview]);
  const timestamp = (v: any) => v?.toMillis?.() || new Date(v).getTime() || 0;
  const rows = [...logs.map(row => ({ kind: 'workout', row })), ...sessions.map(row => ({ kind: 'session', row }))]
    .sort((a, b) => timestamp(b.row.startedAt) - timestamp(a.row.startedAt));
  return <section className="portal-card"><h2>Training history</h2>{error && <p role="alert">{error}</p>}{!rows.length && <p>Your completed workouts and app sessions will appear here.</p>}
    {rows.map(({ kind, row: l }) => kind === 'workout' ? <article className="player-history-row" key={`workout:${l.id}`}><div><strong>{l.workoutSnapshot?.title || 'Workout'} · Week {l.weekNumber}</strong><small>{dateText(l.startedAt)} · {l.endedAt ? l.endReason === 'completed' ? 'Completed' : 'Ended early' : 'In progress'}</small><p>{(l.blocks || []).filter((b: Row) => b.status === 'done').length} drills completed · {Math.round(completedMinutes(l))} min</p></div>{l.workoutSnapshot && plans.some(p => p.id === l.planId && p.status === 'active') && <button onClick={() => onReview({ ...l.workoutSnapshot, ...l, blocks: l.workoutSnapshot.blocks })}>View</button>}<details><summary>Completed sets</summary>{(l.blocks || []).map((b: Row) => <p key={b.blockId}>{l.workoutSnapshot?.blocks?.find((v: Row) => v.blockId === b.blockId)?.name || b.drillId}: {b.setsCompleted}/{b.targetSets} · {b.status}{b.skipReason ? ` · ${b.skipReason}` : ''}</p>)}</details></article>
      : <details className="player-history-row" key={`session:${l.id}`}><summary>{l.title || 'Recorded training session'} · {dateText(l.startedAt)}</summary><p>{l.isActive ? 'In progress' : l.endReason === 'completed' ? 'Completed' : 'Ended'}</p>{(l.sessionRefs || []).map((ref: Row, i: number) => <p key={ref.sessionDocId || i}>{ref.drillType} · Session {ref.sessionNumber}</p>)}<p>View saved videos and measurements in Drills.</p></details>)}
  </section>;
}
