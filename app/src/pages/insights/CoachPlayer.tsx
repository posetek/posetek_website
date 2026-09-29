/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { auth, db } from "../../lib/firebase";
import { clubCall } from "../../lib/organization-data";
import AthleteDetail from "../coach-dashboard/views/AthleteDetail";
import { loadAthleteBundle } from "../coach-dashboard/lib/data";
import { athleteSummary } from "../coach-dashboard/lib/logic";
import type { AthleteSummary } from "../coach-dashboard/lib/logic";
import { blockDoseLine } from "../../lib/contracts/drillV2";
import { completeReport } from "./lib/completeReport";
import { sameScope, scopePayload, expandedFailureMessage } from "./lib/expanded";
import type { InsightScope } from "./lib/expanded";
import type { ExpandedRequest } from "./lib/expandedQuery";
import "../coach-dashboard/coach-dashboard.scss";

export interface CoachComparison {
  schemaVersion: 1; scope: InsightScope; player: { id: string; firstName: string; lastName: string; age: number | null };
  period: { startDate: string; endDate: string; timeZone: string }; testingMode: "cumulative" | "period";
  generatedAtMillis: number; freshness: { complete: boolean }; roster: { total: number; included: number; excluded: number };
  axes: { key: string; label: string; percentile: number | null; measuredScore: number | null; sampleCount: number; status: "measured" | "unmeasured" | "insufficientComparison" }[];
}
export function assertCoachComparison(data: CoachComparison, scope: InsightScope, request: ExpandedRequest) {
  if (data.schemaVersion !== 1 || !sameScope(data.scope, scope) || data.player.id !== request.playerId || data.period.startDate !== request.startDate || data.period.endDate !== request.endDate || data.period.timeZone !== request.timezone || data.testingMode !== request.testingWindow || data.freshness.complete !== true) throw Object.assign(new Error("Player comparison no longer matches the current selection."), { code: "failed-precondition" });
}

export function CoachPercentile({ data }: { data: CoachComparison }) {
  const title = data.scope.kind === "coachRoster" ? "Roster percentile" : "Team percentile";
  const axes = data.axes, count = axes.length;
  const point = (index: number, value: number) => { const angle = index * Math.PI * 2 / count - Math.PI / 2; return [180 + Math.cos(angle) * value, 146 + Math.sin(angle) * value]; };
  const outline = (radius: number) => axes.map((_, index) => point(index, radius).join(",")).join(" ");
  const available = axes.filter(axis => axis.percentile !== null).length;
  const complete = available === count;
  const percent = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const suffix = (value: number) => { const displayed = Math.round(value * 10) / 10; return Number.isInteger(displayed) && (displayed % 100 < 11 || displayed % 100 > 13) ? (["th", "st", "nd", "rd"][displayed % 10] || "th") : "th"; };
  return <section className="insights-card coach-comparison" aria-labelledby="coach-comparison-heading">
    <div className="coach-comparison-heading"><div><h2 id="coach-comparison-heading">{title}</h2><p>Relative position by skill. Higher means a stronger measured score.</p></div><div className="coach-comparison-context"><span>{data.roster.included} eligible roster members</span><span>Measured results · {data.testingMode === "cumulative" ? `through ${data.period.endDate}` : `${data.period.startDate}–${data.period.endDate}`}</span></div></div>
    <div className="coach-comparison-body">
      <figure className="coach-comparison-radar">
        {available ? <><svg viewBox="0 0 360 280" role="img" aria-label={`${title}: ${axes.map(axis => `${axis.label} ${axis.percentile === null ? "comparison unavailable" : `${percent(axis.percentile)} percentile`}`).join(", ")}`}>
          {[25, 75, 100].map(value => <polygon key={value} points={outline(value)} className="coach-radar-grid" />)}
          {axes.map((axis, index) => <line key={axis.key} x1="180" y1="146" x2={point(index, 100)[0]} y2={point(index, 100)[1]} className="coach-radar-grid" />)}
          {complete && <polygon points={axes.map((axis, index) => point(index, axis.percentile!).join(",")).join(" ")} className="coach-radar-result" />}
          <polygon points={outline(50)} className="coach-radar-middle" />
          {axes.map((axis, index) => { const label = point(index, 126), marker = point(index, axis.percentile ?? 0); return <g key={axis.key}><text x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle">{axis.label}</text>{axis.percentile !== null && <circle cx={marker[0]} cy={marker[1]} r="4" className="coach-radar-point" />}</g>; })}
          <text x="185" y="49" className="coach-radar-scale">100</text>
        </svg><figcaption><div className="coach-radar-legend"><span><i className="coach-radar-player-key" />Player</span><span><i className="coach-radar-middle-key" />50 · scale midpoint</span></div>{!complete && <p>{available} of {count} skills available. Missing comparisons are not plotted.</p>}</figcaption></> : <div className="coach-radar-empty"><span className="material-symbols-outlined" aria-hidden="true">query_stats</span><strong>No comparisons yet</strong><p>A percentile needs a measured result for this player and at least one other player.</p></div>}
      </figure>
      <div className="coach-comparison-skills"><div className="coach-percentile-scale" aria-hidden="true"><span>0 · Lower</span><span>50 · Middle</span><span>100 · Higher</span></div><dl className="coach-percentile-list">{axes.map(axis => <div className={`coach-percentile-skill${axis.percentile === null ? " is-unavailable" : ""}`} key={axis.key}>
        <dt>{axis.label}</dt><dd className="coach-percentile-value">{axis.percentile === null ? <span aria-hidden="true">—</span> : <><strong>{percent(axis.percentile)}<sup>{suffix(axis.percentile)}</sup></strong><span>percentile</span></>}</dd>
        <dd className="coach-percentile-detail">{axis.percentile === null ? <p className="coach-percentile-unavailable">{axis.status === "unmeasured" ? "No measured result" : "Insufficient comparison data"}</p> : <div className="coach-percentile-track" aria-hidden="true"><i className="coach-percentile-dot" style={{ left: `${axis.percentile}%` }} /></div>}<p className="coach-percentile-sample">{axis.sampleCount} measured {axis.sampleCount === 1 ? "player" : "players"}{axis.status === "insufficientComparison" ? " · At least 2 needed" : axis.sampleCount === 2 && axis.percentile !== null ? " · Small comparison group" : ""}</p></dd>
      </div>)}</dl></div>
    </div>
    <div className="coach-comparison-guide"><p><strong>50 is the middle of the scale.</strong> 100 is the highest relative position, not a perfect test score.</p><details className="coach-comparison-method"><summary>How this comparison works</summary><p>Each skill compares the player with the roster members who have measured results for that skill, including this player in the count. Equal scores share the same percentile; if everyone is tied, each player is at 50.</p><p>Missing results and provisional estimates are excluded. Name searches and report filters do not change the comparison group. Comparisons are not adjusted for age or division.{!complete && " Available skills appear as points; missing comparisons are not plotted as zero."}</p></details></div>
  </section>;
}

export default function CoachPlayer({ uid, scope, request, onName, onPrescribe, onClose }: { uid: string; scope: InsightScope; request: ExpandedRequest; onName: (name: string) => void; onPrescribe: () => void; onClose: () => void }) {
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([uid, scope, request.playerId, request.startDate, request.endDate, request.timezone, request.testingWindow, retry]);
  const [result, setResult] = useState<{ key: string; comparison: CoachComparison; summary: AthleteSummary; personal: any[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    let current = true; const valid = () => current && auth.currentUser?.uid === uid;
    setResult(null); setFailure(null);
    void (async () => {
      try {
        const comparison = await completeReport(() => clubCall<CoachComparison>("getCoachPlayerComparison", { scope: scopePayload(scope), playerId: request.playerId, startDate: request.startDate, endDate: request.endDate, timeZone: request.timezone, testingMode: request.testingWindow }), valid);
        if (!comparison || !valid()) return;
        assertCoachComparison(comparison, scope, request);
        const ref = db.collection("players").doc(request.playerId);
        const [profile, bundle, config] = await Promise.all([ref.get({ source: "server" }), loadAthleteBundle(request.playerId), db.collection("config").doc("llm").get()]);
        if (!valid()) return;
        if (!profile.exists) throw Object.assign(new Error("Player is unavailable"), { code: "not-found" });
        const personal = config.data()?.personalWorkoutsEnabled === true ? (await ref.collection("personalWorkouts").get()).docs.map(doc => ({ ...doc.data(), id: doc.id })) : [];
        if (!valid()) return;
        const summary = athleteSummary({ ...profile.data(), id: request.playerId }, bundle.reps, bundle.plans, bundle.logs, bundle.provisionalEstimates, bundle.allResultReps);
        setResult({ key, comparison, summary, personal });
        onName(`${comparison.player.firstName} ${comparison.player.lastName}`.trim() || "Player");
      } catch (error) { if (valid()) setFailure({ key, message: expandedFailureMessage(error) }); }
    })();
    return () => { current = false; };
  // Only the exact selected player and comparison window invalidate these reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const ready = result?.key === key ? result : null;
  if (!ready) return failure?.key === key ? <section className="insights-card" role="alert"><h2>Player could not be loaded</h2><p>{failure.message}</p><button className="quiet-button" onClick={() => setRetry(value => value + 1)}>Retry player</button><button className="quiet-button" onClick={onClose}>Back to roster</button></section> : <p role="status">Loading player and current access…</p>;
  return <div className="coach-player-panel">
    <div className="coach-player-heading"><div><h2>{ready.comparison.player.firstName} {ready.comparison.player.lastName}</h2><p>Age {ready.comparison.player.age ?? "not recorded"} · Current roster</p></div><button className="primary-cta" type="button" onClick={onPrescribe}>Prescribe workouts</button></div>
    <CoachPercentile data={ready.comparison} />
    <section className="coach-player-training pt-coachdash" aria-label="Player training and testing detail"><p className="insights-note">The current plan and complete workout history are shown below. Stats retains the individual D1 benchmark comparison; reporting-period totals remain in Insights.</p><AthleteDetail embedded summary={ready.summary} job={null} onBack={onClose} onCreatePlan={onPrescribe} onPlanChanged={async () => { setRetry(value => value + 1); }} /></section>
    <section className="insights-card coach-personal-workouts"><h2>Published personal workouts</h2><p className="insights-note">Workouts the player has published. Their AI conversations and unpublished drafts remain private.</p>{ready.personal.length ? ready.personal.map(workout => <details key={workout.id}><summary>{String(workout.title || "Personal workout")}<span>{Number.isFinite(workout.estimatedMinutes) ? ` · approximately ${workout.estimatedMinutes} min` : ""}</span></summary><ul>{(Array.isArray(workout.blocks) ? workout.blocks : []).map((block: any, index: number) => <li key={block.blockId || index}><strong>{String(block.name || "Drill")}</strong><span>{blockDoseLine(block)}</span></li>)}</ul></details>) : <p>No published personal workouts yet.</p>}</section>
  </div>;
}
