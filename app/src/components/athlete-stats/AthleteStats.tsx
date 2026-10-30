// CONTRACT — port of athlete-stats-view.js (window.PoseTekAthleteStats).
//
// Prop names mirror the option keys of the legacy `PoseTekAthleteStats.render(options)`
// call sites, verbatim. Both consumers pass exactly the same keys:
//   athlete-portal.js:     render({ athlete, athleteName, reps }) then bind(root)
//   athlete-drill-view.js: render({ reps, athleteName, athlete }) then bind(root)
// The component owns the DOM behavior legacy `bind(root)` attached (axis marker/label
// click + Enter/Space keyboard selection toggling the breakdown panels).
//
// buildProfile(reps) is the pure profile/axis scoring used by athlete-mobile-pages.js;
// it lives in ./profile.ts and is re-exported here.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AXES,
  RADAR_CEILING,
  athleteInitials,
  band,
  buildProfile,
  formatHeight,
  formatWeight,
  sessionCount
} from "./profile";
import type {
  ProfileAxis,
  StatsMetricDefinition,
  StatsMetricResult,
  StatsSection
} from "./profile";
import "./athlete-stats.scss";
import { activeProvisionalEstimates, provisionalScore, type ProvisionalEstimate } from '../../lib/provisional-estimates';
import { metrics as benchmarks } from '../../lib/benchmarks';
import ProvisionalEstimateNote from './ProvisionalEstimateNote';

export { buildProfile } from "./profile";
export type { AthleteProfile, ProfileAxis, StatsSection } from "./profile";

export interface AthleteStatsProps {
  reps: any[];
  athlete?: any;
  athleteName?: string;
  provisionalEstimates?: ProvisionalEstimate[];
  estimateReps?: any[];
}

function point(index: number, ratio: number, radius = 92, centerX = 180, centerY = 148) {
  const angle = (Math.PI * 2 / AXES.length) * index - Math.PI / 2;
  return {
    x: centerX + Math.cos(angle) * radius * ratio,
    y: centerY + Math.sin(angle) * radius * ratio
  };
}

function polygonPoints(ratio: number): string {
  return AXES.map((_, index) => {
    const current = point(index, ratio);
    return `${current.x.toFixed(1)},${current.y.toFixed(1)}`;
  }).join(" ");
}

function activateOnKey(event: ReactKeyboardEvent, activate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

function SummaryRow({ icon, title, detail, tone }: { icon: string; title: string; detail: string; tone: string }) {
  return (
    <div className="stats-summary-row">
      <span className={`stats-summary-icon ${tone} material-symbols-outlined`}>{icon}</span>
      <span>
        <small>{title}</small>
        <strong>{detail}</strong>
      </span>
    </div>
  );
}

function Radar({
  axes,
  selectedAxis,
  onSelect,
  estimatedScores
}: {
  axes: ProfileAxis[];
  selectedAxis: string | null;
  onSelect: (key: string) => void;
  estimatedScores: Record<string, number | null>;
}) {
  const scored = axes.filter(axis => axis.score !== null);
  const athletePoints = axes.map((axis, index) =>
    axis.score === null ? null : point(index, Math.min(axis.score, RADAR_CEILING) / RADAR_CEILING)
  );
  const displayedPoints = axes.map((axis, index) => athletePoints[index] || (estimatedScores[axis.key] != null
    ? point(index, Math.min(estimatedScores[axis.key]!, RADAR_CEILING) / RADAR_CEILING) : null));
  return (
    <svg className="stats-radar" viewBox="0 0 360 300" role="img" aria-label="Athlete skill map compared with the D1 standard">
      {[0.25, 0.5, 0.75, 1].map(ratio => (
        <polygon key={ratio} className="stats-radar-grid" points={polygonPoints(ratio)} />
      ))}
      {axes.map((axis, index) => {
        const edge = point(index, 1);
        return (
          <line
            key={axis.key}
            className={`stats-radar-spoke${axis.score === null ? " missing" : ""}`}
            x1="180"
            y1="148"
            x2={edge.x}
            y2={edge.y}
          />
        );
      })}
      <polygon className="stats-radar-reference" points={polygonPoints(100 / RADAR_CEILING)} />
      {scored.length >= 3 && (
        <polygon
          className="stats-radar-athlete"
          points={athletePoints
            .filter((item): item is { x: number; y: number } => Boolean(item))
            .map(item => `${item.x},${item.y}`)
            .join(" ")}
        />
      )}
      {axes.map((axis, index) => {
        const estimatedScore = estimatedScores[axis.key];
        if (estimatedScore == null || axis.score !== null) return null;
        const current = point(index, Math.min(estimatedScore, RADAR_CEILING) / RADAR_CEILING);
        return <g key={`estimated-${axis.key}`} role="button" tabIndex={0} aria-label={`View estimated ${axis.label}, ${Math.round(estimatedScore)} vs D1`}
          onClick={() => onSelect(axis.key)} onKeyDown={event => activateOnKey(event, () => onSelect(axis.key))}>
          {[index - 1, index + 1].map(i => displayedPoints[(i + axes.length) % axes.length]).map((neighbor, i) => neighbor &&
            <line key={i} className="provisional-chart-line" x1={neighbor.x} y1={neighbor.y} x2={current.x} y2={current.y} />)}
          <circle className="stats-radar-marker-hit" cx={current.x} cy={current.y} r="25" />
          <circle className="provisional-chart-marker" cx={current.x} cy={current.y} r="6" />
        </g>;
      })}
      {athletePoints.map((current, index) =>
        current ? (
          <g
            key={axes[index].key}
            className={`stats-radar-marker-control${selectedAxis === axes[index].key ? " selected" : ""}`}
            data-stats-axis={axes[index].key}
            tabIndex={0}
            role="button"
            aria-label={`View ${axes[index].label} summary`}
            aria-pressed={selectedAxis === axes[index].key}
            onClick={() => onSelect(axes[index].key)}
            onKeyDown={event => activateOnKey(event, () => onSelect(axes[index].key))}
          >
            <circle className="stats-radar-marker-hit" cx={current.x} cy={current.y} r="25" />
            <circle className="stats-radar-marker" cx={current.x} cy={current.y} r="5" />
          </g>
        ) : null
      )}
      {axes.map((axis, index) => {
        const labelPoint = point(index, 1.34);
        const selected = selectedAxis === axis.key;
        return (
          <g
            key={axis.key}
            className={`stats-radar-label${axis.score === null ? " missing" : ""}${selected ? " selected" : ""}`}
            transform={`translate(${labelPoint.x} ${labelPoint.y})`}
            data-stats-axis={axis.key}
            tabIndex={0}
            role="button"
            aria-label={`View ${axis.label} summary`}
            aria-pressed={selected}
            onClick={() => onSelect(axis.key)}
            onKeyDown={event => activateOnKey(event, () => onSelect(axis.key))}
          >
            <rect className="stats-radar-label-hit" x="-56" y="-25" width="112" height="56" rx="11" />
            <text className="axis-name" textAnchor="middle" y="-2">{axis.label}</text>
            <text className="axis-score" textAnchor="middle" y="13" style={axis.score === null && estimatedScores[axis.key] != null ? { fill: '#ffc969' } : undefined}>{axis.score === null ? estimatedScores[axis.key] != null ? `${Math.round(estimatedScores[axis.key]!)} est.` : "—" : Math.round(axis.score)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Meter({ metric }: { metric: StatsMetricResult }) {
  const status = band(metric.score);
  const fill = Math.min(Math.max(metric.score, 0), RADAR_CEILING) / RADAR_CEILING * 100;
  const showDelta = metric.delta !== null && Math.abs(metric.delta) >= 0.5;
  return (
    <article className="benchmark-meter">
      <div className="benchmark-title">
        <strong>{metric.label}</strong>
        <span>{metric.format(metric.best)}</span>
      </div>
      <div className="benchmark-track">
        <span className={`benchmark-fill ${status.key}`} style={{ width: `${fill.toFixed(2)}%` }} />
        <i className="benchmark-reference" aria-hidden="true" />
      </div>
      <div className="benchmark-meta">
        <span className={`benchmark-band ${status.key}`}>
          <span className="material-symbols-outlined">{status.icon}</span>
          {status.label}
        </span>
        <span>{Math.round(metric.score)}% of D1</span>
        {showDelta && (
          <span className={`stats-delta ${(metric.delta as number) > 0 ? "up" : "down"}`}>
            {(metric.delta as number) > 0 ? "↗" : "↘"} {Math.abs(metric.delta as number).toFixed(0)} pts
          </span>
        )}
      </div>
      <p>D1 standard {metric.format(metric.reference)} · best of {metric.repCount} {metric.repCount === 1 ? "rep" : "reps"}</p>
    </article>
  );
}

function UnavailableMeter({ slot }: { slot: StatsMetricDefinition }) {
  const standard = slot.reference ? `D1 standard ${slot.format(slot.reference)}` : "D1 standard not published";
  const message = slot.placeholder ? "Measurement not available yet" : "No recorded result";
  return (
    <article className="benchmark-meter unavailable">
      <div className="benchmark-title">
        <strong>{slot.label}</strong>
        <span>—</span>
      </div>
      <div className="benchmark-track">
        <span className="benchmark-fill unavailable" />
        <i className="benchmark-reference" aria-hidden="true" />
      </div>
      <div className="benchmark-meta">
        <span className="benchmark-band unavailable">
          <span className="material-symbols-outlined">remove</span>
          {message}
        </span>
        <span>— vs D1</span>
      </div>
      <p>{standard}</p>
    </article>
  );
}

// Legacy standardBreakdown() wrapped by axisBreakdown(): every axis renders every
// metric slot (available metrics as meters, the rest as unavailable meters) inside a
// hidden-until-selected "stats-selected-card" panel.
function BreakdownPanel({ section, hidden }: { section: StatsSection; hidden: boolean }) {
  const hasData = section.metrics.length > 0;
  const sessions = sessionCount(section.reps);
  const repSummary = hasData
    ? `${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} · ${sessions} ${sessions === 1 ? "session" : "sessions"}`
    : "Not recorded yet";
  return (
    <section className="stats-breakdown-card stats-selected-card" data-breakdown-panel={section.key} hidden={hidden}>
      <header>
        <span className="stats-breakdown-icon material-symbols-outlined">{section.icon}</span>
        <span>
          <h3>{section.title}</h3>
          <p>{repSummary}</p>
        </span>
        {section.score !== null && (
          <span className="stats-drill-score">
            {Math.round(section.score)}
            <small>vs D1</small>
          </span>
        )}
      </header>
      <div className="benchmark-list">
        {section.slots.map(slot => {
          const available = section.availableByKey.get(slot.key);
          return available
            ? <Meter key={slot.key} metric={available} />
            : <UnavailableMeter key={slot.key} slot={slot} />;
        })}
      </div>
      {hasData && section.reps.length < 3 && (
        <p className="stats-confidence">
          <span className="material-symbols-outlined">info</span>
          Based on {section.reps.length} {section.reps.length === 1 ? "rep" : "reps"} — record more for a reliable score.
        </p>
      )}
    </section>
  );
}

export default function AthleteStats({ reps, athlete, athleteName, provisionalEstimates, estimateReps }: AthleteStatsProps) {
  const [selectedAxis, setSelectedAxis] = useState<string | null>(null);
  const selectAxis = (key: string) => setSelectedAxis(previous => (previous === key ? null : key));

  const profile = buildProfile(Array.isArray(reps) ? reps : []);
  const estimates = activeProvisionalEstimates(provisionalEstimates, estimateReps || (Array.isArray(reps) ? reps : []));
  const estimatedScores = Object.fromEntries(estimates.map(estimate => [estimate.axis,
    provisionalScore(estimate, estimate.drill === 'dribbling' ? benchmarks.dribbleTotalTime.reference : benchmarks.codTotalTime.reference)]));
  const ranked = (profile.axes.filter(axis => axis.score !== null) as (ProfileAxis & { score: number })[])
    .sort((left, right) => right.score - left.score);
  const strength = ranked[0];
  const focus = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const missing = profile.axes.filter(axis => axis.score === null).map(axis => axis.label).join(", ");
  const athleteData = athlete || {};
  const athleteDisplayName = athleteName || "Athlete";

  return (
    <section className="athlete-stats" aria-label="Athlete Stats">
      <section className="stats-profile-card">
        <div className="stats-athlete-identity">
          <span className="stats-athlete-avatar">{athleteInitials(athleteDisplayName)}</span>
          <span className="stats-athlete-name">
            <small>Athlete profile</small>
            <strong>{athleteDisplayName}</strong>
            <em>{profile.totalReps} reps · {profile.totalSessions} sessions</em>
          </span>
          <span className="stats-athlete-measure">
            <small>Height</small>
            <strong>{formatHeight(athleteData.height)}</strong>
          </span>
          <span className="stats-athlete-measure">
            <small>Weight</small>
            <strong>{formatWeight(athleteData.weight)}</strong>
          </span>
        </div>
        <div className="stats-focus-grid">
          {strength && <SummaryRow icon="star" title="Strength" detail={`${strength.label} · ${Math.round(strength.score)} vs D1`} tone="lime" />}
          {focus && <SummaryRow icon="center_focus_strong" title="Focus area" detail={`${focus.label} · ${Math.round(focus.score)} vs D1`} tone="orange" />}
          {missing && <SummaryRow icon="add_circle" title={estimates.length ? 'Missing recorded data' : 'Missing data'} detail={missing} tone="cyan" />}
        </div>
        <div className="stats-radar-section">
          <header>
            <div>
              <h2>Skill Map</h2>
              <p>Your profile against the D1 standard</p>
            </div>
            <span className="stats-recorded-count">{ranked.length}/{profile.axes.length} recorded</span>
          </header>
          <Radar axes={profile.axes} selectedAxis={selectedAxis} onSelect={selectAxis} estimatedScores={estimatedScores} />
          <div className="stats-radar-legend">
            <span className="you"><i />You</span>
            <span className="d1"><i />D1 standard</span>
            <span className="untested"><i />Not tested</span>
            {!!estimates.length && <span><i style={{ borderTop: '2px dashed #ffc969' }} />Estimated</span>}
          </div>
          {estimates.map(estimate => <ProvisionalEstimateNote key={estimate.id} estimate={estimate} score={estimatedScores[estimate.axis]} />)}
        </div>
        <section className="stats-selected-breakdown" aria-live="polite">
          <div className="stats-section-heading">
            <h2>Skill Breakdown</h2>
            <p>Tap a skill above to view its metrics</p>
          </div>
          <p className="stats-breakdown-prompt" hidden={selectedAxis !== null}>
            <span className="material-symbols-outlined">touch_app</span>
            Choose a skill on the chart.
          </p>
          <div className="stats-breakdowns">
            {profile.axes.map(axis => (
              <BreakdownPanel key={axis.key} section={profile.sections[axis.key]} hidden={selectedAxis !== axis.key} />
            ))}
          </div>
        </section>
      </section>
      <p className="stats-methodology">
        <span className="material-symbols-outlined">info</span>
        Scores are indexed so 100 equals the approved Generation 2 senior D1 reference for each metric. Shooting accuracy is shown as unavailable until a standard is published.
      </p>
    </section>
  );
}
