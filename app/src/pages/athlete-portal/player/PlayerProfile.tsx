import { useEffect, useState } from 'react';
import { getClubContext } from '../../../lib/organization-data';
import { db } from '../../../lib/firebase';
import { fullName } from '../lib/metrics';
import { heightText, weightText } from '../lib/mobile';
import BodyProfileView from '../views/BodyProfileView';
import type { PortalContext } from '../views/shared';
import type { PlayerProfile as Profile } from './scoring';
import type { Row } from './execution';
import TechniqueAnalysis from './TechniqueAnalysis';
import { activeProvisionalEstimates, provisionalScore, type ProvisionalEstimate } from '../../../lib/provisional-estimates';
import ProvisionalEstimateNote from '../../../components/athlete-stats/ProvisionalEstimateNote';
import PlayerAgeField from './PlayerAgeField';

export function SkillProfile({ profile, estimate = null, estimates = estimate ? [estimate] : [] }: { profile: Profile; estimate?: ProvisionalEstimate | null; estimates?: ProvisionalEstimate[] }) {
  const [selection, setSelection] = useState(() => [...profile.axes].filter(a => a.score !== null).sort((a, b) => a.score! - b.score!)[0]?.key || 'striking');
  const axis = profile.axes.find(a => a.key === selection)!;
  const estimatedScores = Object.fromEntries(estimates.map(entry => [entry.axis,
    profile.axes.find(a => a.key === entry.axis)?.score === null
      ? provisionalScore(entry, profile.metrics.find(m => m.key === (entry.drill === 'dribbling' ? 'dribbleTotalTime' : 'codTotalTime'))?.reference ?? null) : null]));
  const point = (index: number, ratio: number) => {
    const angle = index * Math.PI * 2 / 5 - Math.PI / 2;
    return `${180 + Math.cos(angle) * 100 * ratio},${145 + Math.sin(angle) * 100 * ratio}`;
  };
  return <section className="player-skill-profile"><div className="player-rating"><div><p className="eyebrow">Overall rating</p><strong>{profile.overall === null ? '—' : Math.round(profile.overall)}</strong><span>100 = D1 standard</span></div><small>{profile.totalReps} reps · {profile.totalSessions} sessions</small></div>
    <section className="portal-card"><h2>Your skill map</h2><svg className="player-radar" viewBox="0 0 360 300" aria-label="Skill map, select a category below" role="img">
      {[0.25, 0.5, 0.75, 1].map(r => <polygon key={r} points={profile.axes.map((_, i) => point(i, r)).join(' ')} fill="none" stroke="rgba(255,255,255,.12)" />)}
      <polygon points={profile.axes.map((_, i) => point(i, 100 / 130)).join(' ')} fill="none" stroke="#fff" strokeDasharray="4 5" />
      {profile.axes.filter(a => a.score !== null).length >= 3 && <polygon points={profile.axes.flatMap((a, i) => a.score === null ? [] : [point(i, Math.min(130, a.score) / 130)]).join(' ')} fill="rgba(183,243,74,.18)" stroke="#b7f34a" strokeWidth="2" />}
      {profile.axes.map((a, i) => {
        const estimatedScore = estimatedScores[a.key];
        if (estimatedScore == null) return null;
        const [cx, cy] = point(i, Math.min(130, estimatedScore) / 130).split(',');
        return <g key={`estimated-${a.key}`} role="button" tabIndex={0} aria-label={`Estimated ${a.label} ${Math.round(estimatedScore)}`} onClick={() => setSelection(a.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection(a.key); } }}>
          {[i - 1, i + 1].map(n => { const index = (n + 5) % 5, neighbor = profile.axes[index], score = neighbor.score ?? estimatedScores[neighbor.key]; if (score == null) return null; const [x, y] = point(index, Math.min(130, score) / 130).split(','); return <line key={n} x1={x} y1={y} x2={cx} y2={cy} className="provisional-chart-line" />; })}
          <circle cx={cx} cy={cy} r="6" className="provisional-chart-marker" />
        </g>;
      })}
      {profile.axes.map((a, i) => { const [x, y] = point(i, 1.24).split(','); const [cx, cy] = point(i, Math.min(130, a.score || 0) / 130).split(','); return <g key={a.key} role="button" tabIndex={0} aria-label={`Show ${a.label}`} onClick={() => setSelection(a.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection(a.key); } }}><text x={x} y={y} textAnchor="middle" fill={selection === a.key ? '#b7f34a' : '#dbe9e2'} fontSize="12">{a.label}</text>{a.score !== null && <circle cx={cx} cy={cy} r={selection === a.key ? 6 : 4} fill="#b7f34a" />}</g>; })}
    </svg><div className="player-skill-tabs">{profile.axes.map(a => <button key={a.key} aria-pressed={selection === a.key} onClick={() => setSelection(a.key)}>{a.label}<strong>{a.score === null ? estimatedScores[a.key] != null ? `${Math.round(estimatedScores[a.key]!)} est.` : '—' : Math.round(a.score)}</strong></button>)}</div>
      {estimates.filter(entry => estimatedScores[entry.axis] != null).map(entry => <ProvisionalEstimateNote key={entry.id} estimate={entry} score={estimatedScores[entry.axis]} scoreLabel="vs your standard" />)}</section>
    <section className="portal-card"><h2>{axis.label}</h2>{['speed', 'agility', 'ballControl'].includes(axis.key) && <p className="muted-copy">Completion time drives this rating.{axis.key === 'ballControl' ? ' Matching no-ball runs refine it when available.' : ''}</p>}
      {profile.metrics.filter(m => m.axis === axis.key).map(m => <div className="player-metric" key={m.key}><div><span>{m.label}</span><strong>{m.best === null ? '—' : m.format(m.best)}</strong></div><div className="player-meter"><i style={{ width: `${m.score === null ? 0 : Math.min(100, m.score / 130 * 100)}%` }} /></div><small>{m.score === null ? 'Not recorded' : `${Math.round(m.score)} · 100 = standard`}</small></div>)}
      {axis.key === 'striking' && <PersonalComparison label="Weak foot" value={profile.comparisons.kickRetention} detail={profile.comparisons.kickLeft && profile.comparisons.kickRight ? `Left ${(profile.comparisons.kickLeft * 2.23694).toFixed(1)} mph · Right ${(profile.comparisons.kickRight * 2.23694).toFixed(1)} mph` : 'Record both feet to compare.'} />}
      {axis.key === 'ballControl' && <><PersonalComparison label="Weak foot" value={profile.comparisons.dribbleRetention} detail={profile.comparisons.dribbleLeft && profile.comparisons.dribbleRight ? `Left ${profile.comparisons.dribbleLeft.toFixed(2)} s · Right ${profile.comparisons.dribbleRight.toFixed(2)} s` : 'Record both feet on a matching course.'} /><PersonalComparison label="Ball slowdown" value={profile.comparisons.slowdown} detail="Extra completion time compared with your matching no-ball run." /></>}
    </section><p className="muted-copy">D1 references are provisional. Missing measurements remain unscored. Personal comparisons are not D1 standards.</p>
  </section>;
}
function PersonalComparison({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <div className="player-metric"><div><span>{label}</span><strong>{value === null ? '—' : `${Math.round(value)}%`}</strong></div><small>{detail}</small></div>;
}

export default function PlayerProfile({ ctx, profile, onDrills }: { ctx: PortalContext; profile: Profile; onDrills: (rep?: Row) => void }) {
  const [club, setClub] = useState<Row | null>(ctx.access === 'preview' ? { name: 'PoseTek FC' } : null), [clubError, setClubError] = useState('');
  const [body, setBody] = useState(false), [sessions, setSessions] = useState<Row[]>([]), [sessionError, setSessionError] = useState('');
  useEffect(() => {
    if (ctx.access === 'preview') return;
    let alive = true;
    if (ctx.athlete.organizationId) getClubContext(ctx.athlete.organizationId).then(c => { if (alive) setClub(c.organization); }).catch(() => { if (alive) setClubError('Club unavailable'); });
    const stop = db.collection('players').doc(ctx.playerId!).collection('sessions').onSnapshot(s => setSessions(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setSessionError(e.message));
    return () => { alive = false; stop(); };
  }, [ctx.playerId, ctx.athlete.organizationId, ctx.access]);
  const day = (v: any) => { const d = v?.toDate?.() || new Date(v); return Number.isFinite(d.getTime()) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null; };
  const days = new Set(sessions.map(s => day(s.date || s.createdAt || s.startedAt)).filter((n): n is number => n !== null));
  const today = day(new Date())!; let cursor = new Date(today), streak = 0;
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.getTime())) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const counts: Record<string, number> = {};
  sessions.forEach(s => { const type = s.type || s.drillType || 'Drill'; counts[type] = (counts[type] || 0) + Math.max(s.repCount || 0, 1); });
  const favorite = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return <section className="player-profile"><div className="player-profile-hero"><section className="portal-card player-identity"><p className="eyebrow">Your profile</p><h1>{fullName(ctx.athlete)}</h1><p>{ctx.athlete.position || 'Position not set'}</p><div className="player-measurements"><span><small>Height</small>{heightText(Number(ctx.athlete.height) || null)}</span><span><small>Weight</small>{weightText(Number(ctx.athlete.weight) || null)}</span></div><button className="hub-secondary" onClick={() => setBody(v => !v)}>{body ? 'Close body scan' : 'View body scan'}</button></section><section className="portal-card player-club">{club?.logoUrl ? <img src={club.logoUrl} alt={`${club.name} crest`} /> : <span className="material-symbols-outlined">shield</span>}<h2>{club?.name || clubError || (ctx.athlete.organizationId ? 'Loading club…' : 'No club yet')}</h2></section></div>
    <PlayerAgeField playerId={ctx.playerId!} athlete={ctx.athlete} editable={ctx.access === 'athlete' || ctx.access === 'preview'} preview={ctx.access === 'preview'} />
    {body && <BodyProfileView ctx={ctx} />}
    <SkillProfile profile={profile} estimates={activeProvisionalEstimates(ctx.provisionalEstimates, ctx.allResultReps?.() || ctx.allStatsReps())} />
    {sessionError && <p className="player-error" role="status">Session history could not refresh: {sessionError}</p>}
    <section className="player-session-stats"><div><strong>{streak}</strong><small>Day streak</small></div><div><strong>{sessions.length || profile.totalSessions}</strong><small>Total sessions</small></div><div><strong>{favorite || '—'}</strong><small>Favorite drill</small></div></section>
    <TechniqueAnalysis playerId={ctx.playerId!} reps={ctx.allStatsReps()} preview={ctx.access === 'preview'} onReplay={onDrills} />
  </section>;
}
