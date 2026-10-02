import { useEffect, useRef, useState } from 'react';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { localDayString } from '../../../lib/contracts/planV3';
import TrainingLoadInstructions from '../../../components/TrainingLoadInstructions';
import type { Row } from './execution';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import { personalCapabilityEnabled } from './personal-workouts';
import type { SourceWorkout } from './personal-workouts';
import { applyEquipmentChanges, equipmentChanges, suppliedWorkoutConditions } from './personal-conversation';
import TrainingSetup from './TrainingSetup';
import WorkoutSetupWizard from './WorkoutSetupWizard';
import { confirmedSetup, emptySetup, locationSetup, readRememberedSetup, rememberSetup, setupForProposal, setupFromIntake, setupSignature, setupSummary, EQUIPMENT_LABELS } from './training-access';
import { locationFromRequest } from './guided-workout';
import type { SetupDraft } from './training-access';
import PlayerWorkout from './PlayerWorkout';
import './personal-workouts.css';

export function PersonalPrescription({ proposal, catalog = [] }: { proposal: Row; catalog?: Row[] }) {
  const w = proposal.workout || proposal, target = proposal.requestedMinutes ?? proposal.timeAvailableMinutes ?? w.budgetMinutes;
  return <section className="personal-prescription" aria-label="Workout prescription"><div className="personal-duration"><span><strong>{w.estimatedMinutes} min</strong><small>Calculated, including rest and transitions</small></span>{target && <span><strong>{target} min</strong><small>Your approximate target</small></span>}</div><h2>{w.title}</h2><p>{w.intent}</p><ol className="personal-prescription-list">{(w.blocks || []).map((b: Row, i: number) => <li className="portal-card" key={b.blockId}><span className="personal-drill-number" aria-hidden="true">{i + 1}</span><div><h3>{b.name}</h3><p>{blockDoseLine(b as any)}</p><small>About {b.estimatedMinutes} min · {b.restSeconds}s rest {b.restScope === 'reps' ? 'between repetitions' : 'between sets'}</small><DrillResources drill={catalog.find(d => d.drillId === b.drillId)} />{b.whyIncluded && <p className="muted-copy">{b.whyIncluded}</p>}<TrainingLoadInstructions block={b} /></div></li>)}</ol></section>;
}

function DrillResources({ drill }: { drill?: Row }) {
  if (!drill) return null;
  const requirements = drill.accessRequirements, space = requirements?.space || {};
  const equipment: string[] = Array.isArray(requirements?.equipment?.allOf) ? requirements.equipment.allOf : Array.isArray(drill.equipment) ? drill.equipment : [];
  const alternatives: string[][] = Array.isArray(requirements?.equipment?.anyOf) ? requirements.equipment.anyOf.filter(Array.isArray) : [];
  return <div className="personal-resource-requirements"><p><strong>Equipment:</strong> {equipment.length ? equipment.map(e => EQUIPMENT_LABELS[e] || e).join(', ') : 'No equipment'}{alternatives.map((choices, i) => <span key={i}> · {choices.map(e => EQUIPMENT_LABELS[e] || e).join(' or ')}</span>)}</p>
    {(space.minLengthMeters || space.minWidthMeters || space.overheadClear || space.requiresGoalArea || requirements?.participantMin > 1) && <p><strong>Space & people:</strong> {[
      space.minLengthMeters && `at least ${space.minLengthMeters} m clear length`, space.minWidthMeters && `at least ${space.minWidthMeters} m clear width`,
      space.overheadClear && 'clear overhead space', space.requiresGoalArea && 'marked goal / penalty area', requirements?.participantMin > 1 && `${requirements.participantMin} people, including you`,
    ].filter(Boolean).join(' · ')}</p>}
  </div>;
}

type Props = { store: PersonalWorkoutStore; playerId: string; athlete: Row; config: Row | null; preview: boolean;
  source?: { workout: Row; reference?: SourceWorkout }; initialWorkout?: Row; initialCreate?: boolean; initialRequest?: string; initialHandoff?: Row; initialConversation?: boolean;
  coachOnly?: boolean; onReview?: (proposal: Row) => void; onSelection?: (id?: string) => void; onBack: () => void };

export default function PersonalWorkoutHub({ store, playerId, athlete, config, preview, source, initialWorkout, initialCreate = false, initialRequest = '', initialHandoff, initialConversation = false, coachOnly = false, onReview, onSelection, onBack }: Props) {
  const [mode, setMode] = useState<'list' | 'chat' | 'saved'>(source || initialRequest || initialCreate || initialConversation ? 'chat' : initialWorkout ? 'saved' : 'list');
  const [selected, setSelected] = useState<Row | null>(initialWorkout || null), [playing, setPlaying] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null), [sourceRef, setSourceRef] = useState(source?.reference);
  const [copyFromWorkoutId, setCopyFromWorkoutId] = useState<string | undefined>();
  const [requestText, setRequestText] = useState(initialConversation ? '' : initialRequest);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', today = localDayString(new Date(), timezone);
  const latest = new Date(`${today}T12:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 28);
  const [scheduledDate, setScheduledDate] = useState(today);
  const [revisionDate, setRevisionDate] = useState<string | undefined>();
  const [startPain, setStartPain] = useState('');
  const seedSetup = () => {
    const remembered = initialWorkout?.intake ? setupFromIntake(initialWorkout.intake) : readRememberedSetup(store.ownerUid, playerId) || emptySetup();
    const facility = locationFromRequest(initialRequest), prior = facility ? locationSetup(facility, remembered) : remembered;
    const explicit = suppliedWorkoutConditions(initialRequest);
    return { ...prior, ...(equipmentChanges(initialRequest).replace || equipmentChanges(initialRequest).add.length || equipmentChanges(initialRequest).remove.length ? { equipment: applyEquipmentChanges(prior.equipment, initialRequest), equipmentAnswered: true } : {}),
      ...(explicit.setting ? { participantCount: explicit.setting === 'solo' ? 1 : 2 } : {}), confirmed: false } as SetupDraft;
  };
  const [setup, setSetup] = useState<SetupDraft>(seedSetup), [setupOpen, setSetupOpen] = useState(true);
  const [setupNotice, setSetupNotice] = useState('');
  const confirmedRequest = useRef(''), proposalSetupId = useRef('');
  const access = confirmedSetup(setup);
  const p = mode === 'chat' ? store.proposal : null;
  const published = !!p && store.conversation?.publishedProposalId === p.proposalId;
  const setupChanged = !!p && (!p.intake?.access || setupSignature(setup) !== setupSignature(setupFromIntake(p.intake)));
  const blocked = store.saving || store.scheduleRevision === null || !!(store.pending && !store.pending.terminalFailed) || store.conversationLoading;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fail = (e: unknown) => store.setError(e instanceof Error ? e.message : 'The request could not finish. Your last reviewed draft is preserved.');
  const openSaved = (w: Row) => { setSelected(w); setMode('saved'); setSetup(setupFromIntake(w.intake)); setSetupOpen(true); setStartPain(''); setSetupNotice(''); };
  const confirmSetup = (next: SetupDraft) => { setSetup(next); setSetupOpen(false); setSetupNotice(''); confirmedRequest.current = requestText; rememberSetup(store.ownerUid, playerId, next); };
  useEffect(() => {
    if (!p || proposalSetupId.current === p.proposalId) return;
    proposalSetupId.current = p.proposalId;
    const next = setupForProposal(p.intake, setup);
    setSetup(next); setSetupOpen(!next.confirmed); setSetupNotice(''); confirmedRequest.current = '';
  }, [p?.proposalId]);
  const begin = (w?: Row, copy = false) => {
    store.newConversation(); onSelection?.(); setMode('chat'); setRequestText(w ? `${copy ? 'Create a personal session like' : 'Adjust'} ${w.title}.` : '');
    setScheduledDate(today); setEditing(w?.source === 'personal' && !copy ? w : null); setSourceRef(copy ? undefined : w?.sourceWorkout || undefined); setCopyFromWorkoutId(copy ? selected?.workoutId : undefined);
    setSetup(w && setup.confirmed ? setup : w?.intake ? setupFromIntake(w.intake) : seedSetup()); setSetupOpen(true); setSetupNotice(''); confirmedRequest.current = ''; proposalSetupId.current = '';
  };
  const generateGuided = async (params: Row) => {
    try {
      const result = await store.generate({ ...params, expectedRevision: editing?.revision || 0,
        ...(editing ? { workoutId: editing.workoutId } : {}), ...(sourceRef ? { sourceWorkout: sourceRef } : {}), ...(copyFromWorkoutId ? { copyFromWorkoutId } : {}),
        ...(initialHandoff?.originConversationId && initialHandoff?.originMessageId ? { originConversationId: initialHandoff.originConversationId, originMessageId: initialHandoff.originMessageId } : {}) });
      if (!mounted.current) return true;
      setSetupOpen(false); setRequestText(''); onSelection?.(result.conversationId); return true;
    } catch (e) { fail(e); return false; }
  };
  const send = async () => {
    if (blocked || requestText.trim().length < 3) return;
    try {
      if (confirmedRequest.current !== requestText) {
        const changes = equipmentChanges(requestText), parsed = suppliedWorkoutConditions(requestText);
        const suggested = { ...setup, equipment: applyEquipmentChanges(setup.equipment, requestText),
          equipmentAnswered: setup.equipmentAnswered || !!changes.add.length || changes.replace,
          ...(parsed.setting ? { participantCount: parsed.setting === 'solo' ? 1 : 2 } : {}) } as SetupDraft;
        if (setupSignature(suggested) !== setupSignature(setup)) {
          setSetup({ ...suggested, confirmed: false }); setSetupOpen(true); setSetupNotice('Your message changes the training setup. Review the selections, then send your request.'); return;
        }
      }
      if (!access) { setSetupOpen(true); setSetupNotice('Confirm your available equipment and space before creating a workout.'); return; }
      if (p) {
        const changes = suppliedWorkoutConditions(requestText);
        if (changes.painAnswer === 'yes') throw new Error('Pause workout changes and ask your coach about the pain or restriction.');
        const result = await store.refine(requestText.trim(), { expectedScheduleRevision: store.scheduleRevision, scheduledDate: revisionDate || (p.scheduledDate < today ? today : p.scheduledDate), timezone: p.timezone || timezone, ...(changes.minutes ? { timeAvailableMinutes: changes.minutes } : {}), intake: { ...p.intake, ...access } });
        if (!mounted.current) return;
        onSelection?.(result.conversationId);
      }
      setRequestText('');
    } catch (e) { fail(e); }
  };
  useEffect(() => { if (!coachOnly && store.lastResult?.capability === 'save_personal_workout' && store.lastResult.result.workout && mode === 'chat' && store.lastResult.result.workout.personalConversationId === store.conversationId) { openSaved(store.lastResult.result.workout); store.consumeResult(); } }, [store.lastResult, mode]);
  const publish = async () => { if (!published && (!access || setupChanged)) { setSetupOpen(true); setSetupNotice('Update the draft with your confirmed setup before publishing.'); return; } try { const result = await store.publish(); if (mounted.current) openSaved(result.workout); } catch (e) { if (mounted.current) fail(e); } };
  const openConversation = async (id: string, setupOverride?: SetupDraft) => {
    try {
      const proposal = await store.openConversation(id);
      if (!mounted.current) return;
      const next = setupOverride || setupForProposal(proposal.intake, setup);
      // Consume the saved-workout setup here, including when this is the same
      // proposal. An old override must never replace a later submitted setup.
      proposalSetupId.current = proposal.proposalId;
      setSetup(next); setSetupOpen(!next.confirmed); setSetupNotice(''); confirmedRequest.current = '';
      onSelection?.(id); setMode('chat'); setRequestText('');
    } catch (e) { if (mounted.current) fail(e); }
  };
  const start = async () => { if (selected && access && startPain === 'no') try { setPlaying(await store.start(selected, { equipmentConfirmed: true, painFlag: false, currentAccess: { ...selected.intake, ...access, painFlag: false } })); } catch (e) { fail(e); } };
  const notice = <>{store.error && <p className="player-error" role="alert">{store.error}</p>}{store.saving && <p role="status">{store.status || 'Checking your workout…'}</p>}{store.pending && !store.saving && !store.pending.terminalFailed && <section className="portal-card"><p>Your request is saved. Recover its result to continue.</p><button onClick={() => void store.recover()}>Recover saved request</button></section>}</>;
  if (playing) return <>{notice}<PlayerWorkout key={playing.id} workout={playing} store={store.adapter} playerId={playerId} preview={preview} onExit={() => { setPlaying(null); setMode('list'); }} /></>;
  if (!store.enabled) return <section className="portal-card"><h2>Personal workouts</h2><p>Personal workout tools are not enabled for this account yet.</p><button onClick={onBack}>Back to training</button></section>;
  return <section className={`personal-workouts${coachOnly ? ' personal-coach-creation' : ''}`}>
    {!coachOnly && <><button className="text-button" disabled={blocked} onClick={() => { if (mode === 'list') onBack(); else { setMode('list'); onSelection?.(); } }}>← {mode === 'list' ? 'Training' : 'Personal workouts'}</button><p className="eyebrow">Your own sessions</p><h1>{mode === 'chat' ? p ? 'Your workout conversation.' : 'Create your workout.' : mode === 'saved' ? selected?.title || 'Your workout' : 'Personal workouts'}</h1></>}{notice}
    {mode === 'list' && <><p>Tell your AI coach what you want to work on, review your session, then make it yours.</p><button className="primary-cta" disabled={blocked} onClick={() => begin()}>Create workout</button>
      {!!store.conversations?.length && <section className="portal-card"><h2>Workout conversations</h2><p className="muted-copy">Private drafts and earlier revisions stay here.</p>{store.conversations.map(c => <button className="player-list-button" key={c.id} disabled={blocked} onClick={() => void openConversation(c.id)}><strong>{c.title || 'Workout conversation'}</strong><small>{c.publishedWorkoutId ? 'Published workout · continue conversation' : 'Private draft · continue conversation'}</small></button>)}</section>}
      {!store.loaded ? <p role="status">Loading your workouts…</p> : !store.workouts.length ? <section className="portal-card"><h2>Your first session starts here</h2><p>Create a single workout without a multiweek plan. Review the prescription before publishing it.</p></section> : <div className="personal-workout-list">{[...store.workouts].sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate))).map(w => { const log = store.logs[w.workoutId]; return <button className="player-list-button" key={w.workoutId} disabled={blocked} onClick={() => openSaved(w)}><span className="personal-workout-meta">{log?.endedAt ? 'Finished' : log ? 'Resume' : 'Ready'} · {w.scheduledDate}</span><strong>{w.title}</strong><small>{w.estimatedMinutes} min · {w.blocks?.length || 0} drills</small></button>; })}</div>}
    </>}
    {mode === 'chat' && <>
      {sourceRef && <p className="muted-copy">You are creating a personal copy. Your assigned workout stays as prescribed.</p>}{store.conversationLoading && <p role="status">Opening your saved conversation…</p>}
      {setupNotice && <p className="workout-pause-note" role="status">{setupNotice}</p>}
      {!p && !store.conversationLoading && <WorkoutSetupWizard store={store} playerId={playerId} athlete={athlete} setup={setup} onSetup={setSetup} initialRequest={requestText} initialMinutes={initialHandoff?.timeAvailableMinutes ?? initialHandoff?.workoutRef?.timeAvailableMinutes ?? source?.workout?.budgetMinutes} initialFocus={source?.workout?.intake?.focusDomains || source?.workout?.focusDomains} scheduledDate={scheduledDate} onDate={setScheduledDate} today={today} latestDate={latest.toISOString().slice(0, 10)} timezone={timezone} preview={preview} disabled={blocked} canGenerate={personalCapabilityEnabled(config, 'generate_personal_workout', preview)} onGenerate={generateGuided} resumeDraft={!source && !initialHandoff && !editing && !copyFromWorkoutId} />}
      {p && !coachOnly && (setupOpen ? <TrainingSetup value={setup} onChange={setSetup} onConfirm={confirmSetup} disabled={blocked} /> : <section className="training-setup-summary"><div><strong>Training setup</strong><p>{setupSummary(setup)}</p></div><button type="button" className="hub-secondary" disabled={blocked} onClick={() => setSetupOpen(true)}>Change setup</button></section>)}
      {!!store.messages?.length && <div className="personal-conversation-messages" aria-label="Workout conversation" aria-live="polite">{store.messages.map((m, i) => <article key={m.id || i} className={`chat-message ${m.role === 'user' ? 'user' : 'assistant'}`}><small>{m.role === 'user' ? 'You' : 'AI Coach'}</small><p>{m.content || m.text}</p></article>)}</div>}
      {p && <><p className="eyebrow">{published ? 'Published prescription' : `Draft ${p.proposalRevision || 1} · private until published`}</p><PersonalPrescription proposal={p} catalog={store.catalog} />{coachOnly ? <button className="primary-cta" onClick={() => onReview?.(p)}>Review in Training</button> : <div className="personal-save-bar"><span><strong>{p.workout.estimatedMinutes} min</strong><small>{setupChanged ? 'Setup changed. Ask AI to update this draft.' : 'Review above, then publish'}</small></span><button className="primary-cta" disabled={blocked || !published && (!access || setupChanged)} onClick={() => void publish()}>{store.saving ? 'Checking…' : published ? 'Open published workout' : store.conversation?.publishedWorkoutId ? 'Republish workout' : 'Publish workout'}</button></div>}</>}
      {p && !coachOnly && <form className="personal-conversation-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
        <label>{p ? 'What would you like to change?' : 'Your focus and available time'}<textarea rows={3} maxLength={500} value={requestText} disabled={blocked} onChange={e => setRequestText(e.target.value)} placeholder={p ? 'Add passing, replace a drill, or make it shorter…' : 'I have 20 minutes for ball control. I’m solo and have a ball and cones…'} /></label>
        {p && <details><summary>Training date · {revisionDate || (p.scheduledDate < today ? today : p.scheduledDate)}</summary><label>Training date for this revision<input type="date" min={today} max={latest.toISOString().slice(0, 10)} value={revisionDate || (p.scheduledDate < today ? today : p.scheduledDate)} onChange={e => setRevisionDate(e.target.value)} disabled={blocked} /></label><p className="muted-copy">Sending a change checks the current schedule again. Review the new draft before publishing.</p></details>}
        {p && setupChanged && !requestText.trim() && <button type="button" className="hub-secondary" onClick={() => setRequestText('Adapt this workout to my confirmed training setup. Preserve suitable drills and replace only those that no longer fit.')}>Ask AI to use this setup</button>}
        <button className="primary-cta" type="submit" disabled={blocked || requestText.trim().length < 3 || !personalCapabilityEnabled(config, 'generate_personal_workout', preview) || !access}>{store.saving ? 'Preparing your workout…' : 'Send changes'}</button><small>Changes create a new draft to review before republishing.</small>
      </form>}
    </>}
    {mode === 'saved' && selected && (() => { const log = store.logs[selected.workoutId], snapshot = log?.workoutSnapshot || selected; return <><p className="personal-workout-meta">Saved to Personal workouts · {selected.scheduledDate}</p><PersonalPrescription proposal={snapshot} catalog={store.catalog} />
      {log?.endedAt ? <p className="workout-pause-note">{log.endReason === 'completed' ? 'Completed' : log.endReason === 'pain' ? 'Stopped for pain' : 'Ended early'} · {Math.floor(Number(log.elapsedSeconds || 0) / 60)}:{String(Number(log.elapsedSeconds || 0) % 60).padStart(2, '0')} active. Your completed sets remain in history.</p> : <>
        {setupOpen ? <TrainingSetup value={setup} onChange={setSetup} onConfirm={confirmSetup} disabled={blocked} title={log ? 'Confirm your setup to resume' : 'Your setup for today'} /> : <section className="training-setup-summary"><div><strong>Confirmed for today</strong><p>{setupSummary(setup)}</p></div><button className="hub-secondary" disabled={blocked} onClick={() => setSetupOpen(true)}>Change setup</button></section>}
        <fieldset className="portal-card" disabled={blocked}><legend>{log ? 'Ready to resume?' : 'Before you start'}</legend><p>We’ll check this prescription against the equipment and space you confirmed. If your setup has changed, ask AI for a suitable revision below.</p><label>Any pain or restriction today?<select value={startPain} onChange={e => setStartPain(e.target.value)}><option value="">Choose an answer</option><option value="no">No</option><option value="yes">Yes — pause training</option></select></label><button className="primary-cta" disabled={!access || startPain !== 'no' || !personalCapabilityEnabled(config, 'start_personal_workout', preview)} onClick={() => void start()}>{log ? 'Resume workout' : 'Start workout'}</button></fieldset>
        {log && <button className="hub-secondary" disabled={blocked} onClick={async () => { try { await store.adapter.finish(`personal_${selected.workoutId}`, 'stopped', log.elapsedSeconds || 0); setMode('list'); } catch (e) { fail(e); } }}>End this session and keep my progress</button>}
      </>}
      <button className="hub-secondary" disabled={blocked} onClick={() => { if (!log && selected.personalConversationId) { void openConversation(selected.personalConversationId, setup); } else begin(snapshot, !!log); }}>{log ? 'Ask AI for a personal copy' : 'Ask AI to change this workout'}</button></>; })()}
  </section>;
}
