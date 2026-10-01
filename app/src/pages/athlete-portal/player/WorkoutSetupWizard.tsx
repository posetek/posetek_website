import { useEffect, useId, useRef, useState } from 'react';
import TrainingSetup from './TrainingSetup';
import { confirmedSetup, setupErrors, setupSignature, setupSummary } from './training-access';
import type { SetupDraft } from './training-access';
import { WORKOUT_FOCUSES, clearGuidedWorkout, focusFromRequest, focusLabel, guidedRequest, nearestMinuteIndex, nearestSupportedMinutes, readGuidedWorkout, rememberGuidedWorkout, restoredGuidedSetup, supportedSliderMinutes, toggleWorkoutFocus } from './guided-workout';
import { personalAge } from './personal-workouts';
import { readOwnPlayerAge, saveOwnPlayerAge } from './player-age';
import { applyEquipmentChanges, suppliedWorkoutConditions } from './personal-conversation';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import type { Row } from './execution';

type Step = 'focus' | 'setup' | 'time' | 'age' | 'ready';
const STEPS: Step[] = ['focus', 'setup', 'age', 'time', 'ready'];
export default function WorkoutSetupWizard({ store, playerId, athlete, setup, onSetup, initialRequest, initialMinutes, initialFocus, scheduledDate, onDate,
  today, latestDate, timezone, preview, disabled, onGenerate, resumeDraft = true, canGenerate = true }: {
  store: PersonalWorkoutStore; playerId: string; athlete: Row; setup: SetupDraft; onSetup: (next: SetupDraft) => void; initialRequest: string;
  initialMinutes?: number; initialFocus?: string[]; scheduledDate: string; onDate: (date: string) => void; today: string; latestDate: string;
  timezone: string; preview: boolean; disabled: boolean; onGenerate: (params: Row) => Promise<boolean>; resumeDraft?: boolean; canGenerate?: boolean;
}) {
  const cached = useRef(resumeDraft ? readGuidedWorkout(store.ownerUid, playerId) : null), supplied = suppliedWorkoutConditions(initialRequest, initialMinutes);
  const [focus, setFocus] = useState<string[]>(() => initialFocus?.length ? initialFocus.slice(0, 2) : focusFromRequest(initialRequest).length ? focusFromRequest(initialRequest) : cached.current?.focusDomains || []);
  const [minutes, setMinutes] = useState<number>(() => supplied.minutes || cached.current?.minutes || 20);
  const [customTime, setCustomTime] = useState(() => { const target = supplied.minutes || cached.current?.minutes || 20; return target % 5 !== 0 || target < 5 || target > 60; });
  const [step, setStep] = useState<Step>(() => {
    if (STEPS.includes(cached.current?.step as Step) && !initialRequest && !initialFocus?.length) return !personalAge(athlete) && ['time', 'ready'].includes(cached.current!.step) ? 'age' : cached.current!.step as Step;
    if (!(initialFocus?.length || focusFromRequest(initialRequest).length)) return 'focus';
    if (setupErrors(setup).length) return 'setup';
    return !personalAge(athlete) ? 'age' : supplied.minutes ? 'ready' : 'time';
  });
  const [age, setAge] = useState<number | undefined>(() => personalAge(athlete)), [ageChoice, setAgeChoice] = useState(supplied.age || 15), [ageSaving, setAgeSaving] = useState(false);
  const [pain, setPain] = useState(''), [assessment, setAssessment] = useState<Row | null>(null), [assessing, setAssessing] = useState(false), [error, setError] = useState('');
  const [assessmentError, setAssessmentError] = useState('');
  const [checkAttempt, setCheckAttempt] = useState(0);
  const id = useId(), heading = useRef<HTMLHeadingElement>(null), version = useRef(0), mounted = useRef(true), initialized = useRef(false);
  const available = confirmedSetup({ ...setup, confirmed: true }), signature = setupSignature(setup);
  const activeSteps = STEPS.filter(s => s !== 'age' || !age);
  const displayedStep = step === 'age' && age ? 'time' : step;
  const index = activeSteps.indexOf(displayedStep);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  useEffect(() => { if (!preview) void readOwnPlayerAge(playerId, store.ownerUid).then(recorded => { if (mounted.current && recorded !== undefined) setAge(recorded); }).catch(() => { /* Explicit confirmation still remains available. */ }); }, [playerId, store.ownerUid, preview]);
  useEffect(() => {
    if (initialized.current) return; initialized.current = true;
    if (cached.current && !initialRequest && !initialFocus?.length) {
      onSetup(restoredGuidedSetup(cached.current, setup, false));
      if (cached.current.scheduledDate >= today && cached.current.scheduledDate <= latestDate) onDate(cached.current.scheduledDate);
    }
  }, []);
  useEffect(() => { rememberGuidedWorkout(store.ownerUid, playerId, { focusDomains: focus, minutes, scheduledDate, setup, step: displayedStep }); }, [focus.join(','), minutes, scheduledDate, signature, displayedStep]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [displayedStep]);
  useEffect(() => {
    if (!age || !available || !focus.length || store.scheduleRevision === null || !store.assess) { setAssessment(null); setAssessmentError(''); setAssessing(false); return; }
    const token = ++version.current; setAssessment(null); setAssessmentError(''); setAssessing(true);
    const timeout = window.setTimeout(() => {
      void store.assess({ scheduledDate, timezone, timeAvailableMinutes: minutes, intake: { age, ...available, focusDomains: focus, painFlag: false } }).then(result => {
        if (!mounted.current || version.current !== token) return;
        if (result?.schemaVersion !== 1 || !Array.isArray(result.supportedMinutes) || result.supportedMinutes.some((minute: unknown) => !Number.isInteger(minute) || Number(minute) < 1 || Number(minute) > 135) || !Number.isInteger(result.scheduleRevision)) throw new Error('Your setup check returned an incomplete result. Retry the check.');
        setAssessment(result);
      }).catch(e => { if (mounted.current && version.current === token) setAssessmentError(e.message || 'Your setup could not be checked. Try again.'); })
        .finally(() => { if (mounted.current && version.current === token) setAssessing(false); });
    }, 250);
    return () => { clearTimeout(timeout); if (version.current === token) version.current++; };
  }, [focus.join(','), signature, age, scheduledDate, timezone, store.scheduleRevision, checkAttempt]);
  const supported: number[] = assessment?.supportedMinutes || [];
  const sliderMinutes = supportedSliderMinutes(supported), sliderIndex = nearestMinuteIndex(sliderMinutes, minutes);
  const suggestedMinutes = nearestSupportedMinutes(supported, minutes);
  const availability = assessing ? 'checking' : assessmentError ? 'error' : assessment ? supported.length ? 'available' : 'unavailable' : 'waiting';
  const ageLimited = assessment?.limitations?.some((limitation: Row) => limitation.code === 'age_ineligible');
  const chooseMinutes = (next: number) => { setMinutes(next); setCustomTime(!sliderMinutes.includes(next)); };
  const feasible = !!assessment && supported.includes(minutes);
  const chooseStep = (next: Step) => { setStep(next); setError(''); };
  const back = () => chooseStep(activeSteps[Math.max(0, index - 1)]);
  const next = () => {
    if (displayedStep === 'focus' && !focus.length) { setError('Choose one or two things to work on.'); return; }
    if (displayedStep === 'setup' && setupErrors(setup).length) { setError(setupErrors(setup)[0]); return; }
    if (displayedStep === 'time' && (!Number.isInteger(minutes) || minutes < 1 || minutes > 135)) { setError('Choose a time between 1 and 135 minutes.'); return; }
    if (displayedStep === 'time' && (!feasible || assessing)) return;
    chooseStep(activeSteps[Math.min(activeSteps.length - 1, index + 1)]);
  };
  const confirmAge = async () => {
    setAgeSaving(true); setError('');
    try {
      const confirmed = preview ? { age: ageChoice, ageRecordedAt: new Date() } : await saveOwnPlayerAge(playerId, store.ownerUid, ageChoice);
      if (!mounted.current) return; setAge(personalAge(confirmed)); chooseStep('time');
    } catch (e: any) { if (mounted.current) setError(e.message || 'Your age could not be saved. Try again.'); }
    finally { if (mounted.current) setAgeSaving(false); }
  };
  const generate = async () => {
    if (!available || !age || pain !== 'no' || !feasible || disabled || !canGenerate || ageSaving || assessing) return;
    const confirmed = { ...setup, confirmed: true }; onSetup(confirmed);
    const success = await onGenerate({ requestText: guidedRequest(focus, minutes, initialRequest), timeAvailableMinutes: minutes,
      expectedScheduleRevision: assessment!.scheduleRevision, scheduledDate, timezone, intake: { age, ...available, focusDomains: focus, painFlag: false } });
    if (success) clearGuidedWorkout(store.ownerUid, playerId);
  };
  const availabilityNotice = ['time', 'ready'].includes(displayedStep) && <>
    {availability === 'checking' && <p role="status">Checking the available drills and times for your setup…</p>}
    {availability === 'error' && <div className="player-error" role="alert"><p>{assessmentError}</p><button type="button" className="hub-secondary" onClick={() => setCheckAttempt(n => n + 1)}>Retry setup check</button></div>}
    {availability === 'unavailable' && <section className="workout-pause-note" aria-label="Workout availability"><strong>No eligible workout is available for these choices yet.</strong>{assessment?.limitations?.length ? assessment.limitations.map((limitation: Row, i: number) => <p key={`${limitation.code}:${limitation.domain || i}`}>{limitation.message}</p>) : <p>The current drill library does not support this focus, age and setup yet. Your choices are saved.</p>}<div className="workout-wizard-recovery"><button type="button" className="hub-secondary" onClick={() => chooseStep('focus')}>Change focus</button>{!ageLimited && <button type="button" className="hub-secondary" onClick={() => chooseStep('setup')}>Change setup</button>}</div></section>}
    {availability === 'waiting' && <section className="workout-pause-note" aria-label="Workout availability"><p>{!age ? 'Confirm your age before checking available times.' : !focus.length ? 'Choose your workout focus before checking available times.' : !available ? 'Confirm your training setting before checking available times.' : 'Your training schedule has not loaded. Refresh Training to reconnect; your choices are saved.'}</p><div className="workout-wizard-recovery">{!age ? <button type="button" className="hub-secondary" onClick={() => chooseStep('age')}>Confirm age</button> : !focus.length ? <button type="button" className="hub-secondary" onClick={() => chooseStep('focus')}>Choose focus</button> : !available ? <button type="button" className="hub-secondary" onClick={() => chooseStep('setup')}>Change setup</button> : <button type="button" className="hub-secondary" onClick={() => window.location.reload()}>Refresh Training</button>}</div></section>}
    {availability === 'available' && assessment?.limitations?.map((limitation: Row, i: number) => <p className="workout-pause-note" key={`${limitation.code}:${limitation.domain || i}`}>{limitation.message}</p>)}
  </>;
  return <section className="workout-wizard" aria-label="Create your workout">
    <div className="workout-wizard-progress"><span>Step {index + 1} of {activeSteps.length}</span><span>{displayedStep === 'ready' ? 'Ready to review' : 'Your session, your way'}</span><div aria-hidden="true">{activeSteps.map((s, i) => <i key={s} className={i <= index ? 'complete' : ''} />)}</div></div>
    <fieldset disabled={disabled || ageSaving}>
      {displayedStep === 'focus' && <><h2 ref={heading} tabIndex={-1}>What do you want to work on?</h2><p className="muted-copy">Choose up to two. Your AI coach will build the session around them.</p><div className="workout-resource-chips">{focus.filter(domain => !WORKOUT_FOCUSES.some(f => f.domain === domain)).map(domain => <button type="button" key={domain} aria-label={`Remove ${focusLabel(domain)} focus`} onClick={() => setFocus(toggleWorkoutFocus(focus, domain))}>{focusLabel(domain)} <span aria-hidden="true">×</span></button>)}</div><div className="workout-choice-grid workout-focus-options" role="group" aria-label="Workout focus">{WORKOUT_FOCUSES.map(f => <button type="button" key={f.domain} className="workout-choice" aria-pressed={focus.includes(f.domain)} disabled={focus.length === 2 && !focus.includes(f.domain)} onClick={() => setFocus(toggleWorkoutFocus(focus, f.domain))}><span className="material-symbols-outlined" aria-hidden="true">{f.icon}</span><span><strong>{f.label}</strong><small>{f.detail}</small></span><span className="workout-choice-check" aria-hidden="true">{focus.includes(f.domain) ? '✓' : '+'}</span></button>)}</div>{initialRequest && <details className="workout-carried-intent"><summary>Your request is included</summary><p>{initialRequest}</p></details>}</>}
      {displayedStep === 'setup' && <><h2 ref={heading} tabIndex={-1} className="sr-only">Your training setting</h2><TrainingSetup value={setup} onChange={next => onSetup(next.facility !== setup.facility ? { ...next, equipment: applyEquipmentChanges(next.equipment, initialRequest) } : next)} inline /></>}
      {displayedStep === 'time' && <>
        <h2 ref={heading} tabIndex={-1}>How much time do you have?</h2><p className="muted-copy">Choose an approximate target. You’ll see the calculated duration before publishing.</p>
        {sliderMinutes.length ? <label className="workout-slider" htmlFor={`${id}-time`}><span><strong>{minutes}</strong> minutes</span><input id={`${id}-time`} type="range" min={0} max={sliderMinutes.length - 1} step={1} value={sliderIndex} disabled={assessing} aria-valuetext={`${sliderMinutes[sliderIndex]} minutes`} onChange={e => { setMinutes(sliderMinutes[Number(e.target.value)]); setCustomTime(false); }} /><small><span>{sliderMinutes[0]} min</span><span>{sliderMinutes.at(-1)} min</span></small></label> : <div className="workout-slider"><span><strong>{minutes}</strong> minutes</span><small>{availability === 'unavailable' ? 'Your requested time is saved.' : availability === 'available' ? 'Choose an exact supported target below.' : 'Your approximate target'}</small></div>}
        {availabilityNotice}
        {availability !== 'unavailable' && <details className="workout-custom-time" open={customTime || availability === 'available' && !sliderMinutes.length || undefined} onToggle={e => setCustomTime(e.currentTarget.open)}><summary>Choose an exact time</summary><label>Minutes<input type="number" inputMode="numeric" min={1} max={135} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label><small>From 1 to 135 minutes, when supported by the available drills.</small></details>}
        <details><summary>Training date · {scheduledDate}</summary><label>Training date<input type="date" min={today} max={latestDate} value={scheduledDate} onChange={e => onDate(e.target.value)} /></label></details>
        {availability === 'available' && !feasible && <p className="workout-pause-note">Your {minutes}-minute target is outside the supported times for this setup. <button type="button" className="text-button" onClick={() => chooseMinutes(suggestedMinutes!)}>Use {suggestedMinutes!} minutes</button></p>}
      </>}
      {displayedStep === 'age' && <><h2 ref={heading} tabIndex={-1}>How old are you?</h2><p className="muted-copy">Your age helps us choose suitable training. We’ll save your confirmed age to your profile.</p><label className="workout-slider" htmlFor={`${id}-age`}><span><strong>{ageChoice}</strong> years old</span><input id={`${id}-age`} type="range" min={5} max={80} step={1} value={ageChoice} onChange={e => setAgeChoice(Number(e.target.value))} /><small><span>5 years</span><span>80 years</span></small></label><small>This records your current age. It does not set your birthday.</small></>}
      {displayedStep === 'ready' && <><h2 ref={heading} tabIndex={-1}>{availability === 'unavailable' ? 'Adjust your workout choices.' : 'Ready for your workout?'}</h2><dl className="workout-ready-summary"><div><dt>Focus</dt><dd>{focus.map(focusLabel).join(' + ')}</dd></div><div><dt>Time</dt><dd>{minutes} minutes</dd></div><div><dt>Setup</dt><dd>{setupSummary(setup)}</dd></div><div><dt>Age</dt><dd>{age ?? 'Not confirmed'} years</dd></div></dl>{availabilityNotice}<p className="muted-copy">We’ll use this setup and clear space suitable for each drill. Follow the exercise setup when you train. Floor exercises can be done without a mat.</p><fieldset className="workout-readiness"><legend>Any pain or restriction affecting this session?</legend><div className="workout-segments"><button type="button" aria-pressed={pain === 'no'} onClick={() => setPain('no')}>No, ready to train</button><button type="button" aria-pressed={pain === 'yes'} onClick={() => setPain('yes')}>Yes</button></div></fieldset>{pain === 'yes' && <p className="workout-pause-note" role="alert">Pause workout creation and ask your coach about a suitable return to training.</p>}
        {assessment && !feasible && supported.length > 0 && <button type="button" className="hub-secondary" onClick={() => chooseMinutes(suggestedMinutes!)}>Use a supported {suggestedMinutes!}-minute session</button>}
      </>}
      {error && <div className="player-error" role="alert"><p>{error}</p></div>}
      {displayedStep === 'ready' && !canGenerate && <p className="workout-pause-note">Workout creation is unavailable right now. Your setup is saved.</p>}
      <div className="workout-wizard-actions">{index > 0 && <button type="button" className="hub-secondary" onClick={back}>Back</button>}{displayedStep === 'age' ? <button type="button" className="primary-cta" onClick={() => void confirmAge()}>{ageSaving ? 'Saving age…' : `Confirm age ${ageChoice}`}</button> : ['time', 'ready'].includes(displayedStep) && availability === 'unavailable' ? null : displayedStep === 'ready' ? <button type="button" className="primary-cta" disabled={pain !== 'no' || !feasible || assessing || !age || !canGenerate} onClick={() => void generate()}>{disabled ? 'Preparing your workout…' : 'Create my workout'}</button> : <button type="button" className="primary-cta" disabled={displayedStep === 'time' && (!feasible || assessing)} onClick={next}>Next <span aria-hidden="true">→</span></button>}</div>
      {displayedStep === 'ready' && <small>You can ask for changes and review every drill before publishing.</small>}
    </fieldset>
  </section>;
}
