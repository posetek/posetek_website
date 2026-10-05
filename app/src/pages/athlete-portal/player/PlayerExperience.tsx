import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth, cloud, db } from '../../../lib/firebase';
import { visibleAttempts } from '../../../lib/result-values';
import { parseProvisionalEstimates } from '../../../lib/provisional-estimates';
import { DRILLS, drillByKey } from '../lib/drills';
import { accepted, allStatsReps, normalizeRep } from '../lib/metrics';
import type { PortalContext } from '../views/shared';
import DrillDashboard from '../views/DrillDashboard';
import SessionView from '../views/SessionView';
import PlayerProfile from './PlayerProfile';
import PlayerTraining from './PlayerTraining';
import PlayerLeaderboards from './PlayerLeaderboards';
import CoachChat from './CoachChat';
import { usePersonalWorkouts } from './use-personal-workouts';
import { useCoachConfig } from './gateway';
import { personalDraftLink } from './personal-conversation';
import { defaultDataset, intakeSnapshot, playerProfile } from './scoring';
import type { Row } from './execution';
import PlayerShell, { PLAYER_TABS, communityPath } from './PlayerShell';
import './player.css';
import PlayerFeedbackInvitation, { PlayerResultsFeedbackLink } from './PlayerFeedbackInvitation';
import { claimBrowserFeedbackInvitation, showResultsFeedback } from './feedback-invitation';

export { PLAYER_TABS } from './PlayerShell';
export function playerRoute(search: string) {
  const p = new URLSearchParams(search), raw = p.has('drill') ? 'drills' : p.get('view') || 'home';
  return { view: raw === 'profile' ? 'home' : raw === 'feed' || PLAYER_TABS.some(t => t.view === raw) ? raw : 'home',
    drill: DRILLS.some(d => d.key === p.get('drill')) ? p.get('drill')! : 'shooting', session: p.get('session'), rep: p.get('rep') };
}
export default function PlayerExperience({ ctx, initialReps }: { ctx: PortalContext; initialReps: Record<string, Row[]> }) {
  const location = useLocation(), navigate = useNavigate(), route = playerRoute(location.search);
  const preview = ctx.access === 'preview';
  const coachConfig = useCoachConfig(preview);
  const personal = usePersonalWorkouts(ctx.playerId!, preview, coachConfig);
  const [reps, setReps] = useState(initialReps), [athlete, setAthlete] = useState(ctx.athlete), [dataset, setDataset] = useState(defaultDataset);
  const [provisionalEstimates, setProvisionalEstimates] = useState(ctx.provisionalEstimates || []);
  const [visited, setVisited] = useState(new Set([route.view])), [request, setRequest] = useState<Row | null>(null), [refreshError, setRefreshError] = useState('');
  const [feedbackInvitation, setFeedbackInvitation] = useState(false);
  const [feedbackOwner] = useState(() => ({ uid: auth.currentUser?.uid, playerId: ctx.playerId }));
  const feedbackContext = useRef({ view: route.view, playerId: ctx.playerId, access: ctx.access });
  feedbackContext.current = { view: route.view, playerId: ctx.playerId, access: ctx.access };
  useEffect(() => {
    if (preview) return;
    const hide = () => { if (document.visibilityState !== 'visible') setFeedbackInvitation(false); };
    const stop = auth.onAuthStateChanged(user => { if (user?.uid !== feedbackOwner.uid) setFeedbackInvitation(false); });
    document.addEventListener('visibilitychange', hide);
    return () => { stop(); document.removeEventListener('visibilitychange', hide); };
  }, [preview, feedbackOwner]);
  useEffect(() => { if (route.view !== 'training') setFeedbackInvitation(false); }, [route.view]);
  const completedWorkout = () => {
    const current = () => feedbackContext.current.access === 'athlete' && feedbackContext.current.view === 'training'
      && feedbackContext.current.playerId === feedbackOwner.playerId && !!feedbackOwner.uid
      && auth.currentUser?.uid === feedbackOwner.uid && document.visibilityState === 'visible';
    if (!current()) return;
    void claimBrowserFeedbackInvitation().then(claimed => { if (claimed && current()) setFeedbackInvitation(true); });
  };
  useEffect(() => { if (route.view === 'feed') navigate(communityPath(location.search), { replace: true }); }, [route.view, location.search, navigate]);
  useEffect(() => { setVisited(old => new Set([...old, route.view])); }, [route.view]);
  useEffect(() => {
    if (route.view !== 'training') window.dispatchEvent(new CustomEvent('posetek:player-route-leave'));
  }, [route.view]);
  useEffect(() => {
    if (preview) return;
    const player = db.collection('players').doc(ctx.playerId!);
    let alive = true, refreshVersion = 0;
    const stopPlayer = player.onSnapshot(d => { if (d.exists) setAthlete({ ...d.data(), id: d.id }); }, e => setRefreshError(e.message));
    const stopReps = player.collection('reps').onSnapshot(() => {
      const version = ++refreshVersion;
      void cloud.httpsCallable('getAthleteEffectiveResults')({ playerId: ctx.playerId }).then(response => {
        if (!alive || version !== refreshVersion) return;
        const payload = response.data as Row;
        const rows = visibleAttempts((payload.reps || []).map(normalizeRep));
        setReps(old => Object.fromEntries(DRILLS.map(d => [d.key, d.key === 'freeRecord' ? old.freeRecord : rows.filter(r => accepted(r, d))])));
        setProvisionalEstimates(parseProvisionalEstimates(payload.provisionalEstimates));
        setRefreshError('');
      }).catch(e => { if (alive && version === refreshVersion) { setProvisionalEstimates([]); setRefreshError(e.message); } });
    }, e => setRefreshError(e.message));
    const stopBenchmarks = db.collection('benchmarks').doc('d1').onSnapshot(d => {
      const value = d.data();
      if (value?.schemaVersion === 1 && value.tier === 'd1' && value.cells && Number.isInteger(value.generation)) setDataset(old => value.generation > old.generation ? value : old);
    }, () => { /* bundled generation remains valid offline */ });
    return () => { alive = false; ++refreshVersion; stopPlayer(); stopReps(); stopBenchmarks(); };
  }, [ctx.playerId, preview]);
  const all = useMemo(() => allStatsReps(reps), [reps]);
  const profile = useMemo(() => playerProfile(all, athlete, dataset), [all, athlete, dataset]);
  const playerCtx = useMemo(() => ({ ...ctx, athlete, provisionalEstimates, allStatsReps: () => all, allResultReps: () => Object.values(reps).flat() }), [ctx, athlete, all, reps, provisionalEstimates]);
  const go = (view: string, drill?: string, session?: string, rep?: string) => {
    if (route.view === 'training' && view !== 'training') window.dispatchEvent(new CustomEvent('posetek:player-route-leave'));
    if (view === 'feed') { navigate(communityPath(location.search)); return; }
    const params = new URLSearchParams(location.search);
    params.set('view', view); ['drill', 'session', 'rep'].forEach(k => params.delete(k));
    if (drill) params.set('drill', drill); if (session) params.set('session', session); if (rep) params.set('rep', rep);
    navigate({ pathname: location.pathname, search: params.toString() });
    window.scrollTo({ top: 0 });
  };
  const activeDrill = drillByKey(route.drill);
  return <PlayerShell activeView={route.view} search={location.search} pathname={location.pathname} onNavigate={view => go(view, view === 'drills' ? route.drill : undefined)} onSignOut={preview ? undefined : () => { void auth.signOut(); }}>
      {preview && <p className="player-preview-note">Local preview · sample data · no account changes</p>}
      {refreshError && <p className="player-error" role="status">Could not refresh your latest results: {refreshError}</p>}
      {route.view === 'home' && <><PlayerProfile ctx={playerCtx} profile={profile} onDrills={rep => go('drills', 'shooting', rep ? rep.sessionFolder || `session${rep.sessionNumber}` : undefined, rep?.id)} />{showResultsFeedback(ctx.access, profile.totalReps) && <PlayerResultsFeedbackLink />}</>}
      {visited.has('aiCoach') && <div hidden={route.view !== 'aiCoach'}><h1>Your AI Coach</h1><CoachChat playerId={ctx.playerId!} preview={preview} personalStore={personal} athlete={athlete} active={route.view === 'aiCoach'} onHandoff={r => { setRequest(r); if (r.conversationId) navigate({ pathname: location.pathname, search: personalDraftLink(location.search, r.conversationId) }); else go('training'); }} /></div>}
      {route.view === 'drills' && <section className="player-drills"><p className="eyebrow">Your measured progress</p><h1>Drills</h1><p>Revisit your sessions, see your progress, and watch saved videos.</p><nav className="player-week-rail" aria-label="Drill results">{DRILLS.map(d => <button key={d.key} aria-pressed={d.key === route.drill} onClick={() => go('drills', d.key)}>{d.short || d.label}<small>{reps[d.key]?.length || 0} reps</small></button>)}</nav>
        {route.session ? <SessionView drill={activeDrill} folder={route.session} selectedId={route.rep} reps={reps[activeDrill.key] || []} access={ctx.access} playerId={ctx.playerId} shareToken={null} onBack={() => go('drills', route.drill)} onSelectRep={id => go('drills', route.drill, route.session!, String(id))} /> : <DrillDashboard drill={activeDrill} reps={reps[activeDrill.key] || []} athlete={athlete} onOpenRep={(folder, id) => go('drills', route.drill, folder, String(id))} />}
        <p className="muted-copy">Record and process new drills in the PoseTek app. Video appears here when it was saved to the cloud.</p>
        {showResultsFeedback(ctx.access, reps[activeDrill.key]?.length || 0) && <PlayerResultsFeedbackLink />}
      </section>}
      {visited.has('training') && <div hidden={route.view !== 'training'}>{feedbackInvitation && <PlayerFeedbackInvitation onDismiss={() => setFeedbackInvitation(false)} />}<PlayerTraining ctx={playerCtx} statsProfile={intakeSnapshot(profile)} personal={personal} request={route.view === 'training' ? request : null} onAcknowledge={() => setRequest(null)} onCompleted={completedWorkout} /></div>}
      {route.view === 'leaderboards' && <PlayerLeaderboards playerId={ctx.playerId!} preview={preview} reps={all} athlete={athlete} dataset={dataset} />}
  </PlayerShell>;
}
