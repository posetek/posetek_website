import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ExpandedReport from "../../insights/ExpandedReport";
import { minuteText, shortDate, TESTING_LABELS, WORKOUT_LABELS } from "../../insights/lib/expanded";
import type { ExpandedInsights, ExpandedPlayer } from "../../insights/lib/expanded";
import { dateInZone, hasPlayerFilters, shiftDate, TIMEZONES } from "../../insights/lib/expandedQuery";
import type { ExpandedRequest } from "../../insights/lib/expandedQuery";
import type { WorkspaceReportView } from "../lib/adminNavigation";
import "../../insights/insights.scss";
import "./workspace-report.scss";

export type WorkspacePlayerMetric = { playerId: string; status: "included"; player: ExpandedPlayer } | { playerId: string; status: "excluded" };
export type WorkspaceReport = ExpandedInsights & { rosterMetrics?: WorkspacePlayerMetric[] };
export interface WorkspaceMetricState { data: WorkspaceReport | null; loading: boolean; error: string; rebuilding?: boolean; legacy?: boolean }
export type WorkspaceSummaryProps = WorkspaceMetricState & { accountCount?: number; scopeLabel: string; request: ExpandedRequest };
const views: [WorkspaceReportView, string][] = [["overview", "Overview"], ["testing", "Testing"], ["workouts", "Workouts"], ["usage", "Usage"]];

/** Report views share one roster; tabs move focus before activating a reader. */
export function WorkspaceReportTabs({ active, onChange }: { active: WorkspaceReportView; onChange(view: WorkspaceReportView): void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="workspace-report-tabs" role="tablist" aria-label="Player reporting views">{views.map(([view, label], index) => <button type="button" key={view} ref={node => { buttons.current[index] = node; }}
    id={`workspace-report-tab-${view}`} role="tab" aria-selected={view === active} aria-controls={`workspace-report-panel-${view}`} tabIndex={view === active ? 0 : -1}
    onClick={() => onChange(view)} onKeyDown={event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length : undefined;
      if (next !== undefined) { event.preventDefault(); buttons.current[next]?.focus(); }
    }}>{label}</button>)}</div>;
}

export function WorkspaceReportControls({ request, disabled = false, onChange }: { request: ExpandedRequest; disabled?: boolean; onChange(patch: Partial<ExpandedRequest>): void }) {
  const [dates, setDates] = useState({ start: request.startDate, end: request.endDate }), [error, setError] = useState("");
  useEffect(() => { setDates({ start: request.startDate, end: request.endDate }); setError(""); }, [request.startDate, request.endDate]);
  const today = dateInZone(new Date(), request.timezone), preset = request.startDate === shiftDate(request.endDate, 1 - request.weeks * 7) ? request.weeks : 0;
  return <section className="workspace-report-controls" aria-label="Reporting period and testing coverage"><fieldset disabled={disabled}>
    <label>Timezone<select aria-label="Reporting timezone" value={request.timezone} onChange={event => onChange({ timezone: event.target.value })}>{TIMEZONES.map(zone => <option key={zone} value={zone}>{zone.replace("America/", "").replaceAll("_", " ")}</option>)}</select></label>
    <fieldset className="workspace-period"><legend>Period</legend><div>{[4, 8, 12, 26].map(weeks => <button type="button" key={weeks} aria-pressed={preset === weeks} onClick={() => onChange({ weeks, startDate: shiftDate(today, 1 - weeks * 7), endDate: today })}>{weeks} weeks</button>)}</div></fieldset>
    <details className="workspace-custom-period"><summary>Custom dates</summary><form onSubmit={event => {
      event.preventDefault();
      if (!dates.start || !dates.end || dates.start > dates.end || dates.end > today || dates.start < shiftDate(dates.end, -365)) { setError("Choose a valid period of up to one year ending today or earlier."); return; }
      setError(""); onChange({ startDate: dates.start, endDate: dates.end });
    }}><label>From<input type="date" value={dates.start} max={dates.end} onChange={event => setDates(value => ({ ...value, start: event.target.value }))} /></label><label>Through<input type="date" value={dates.end} min={dates.start} max={today} onChange={event => setDates(value => ({ ...value, end: event.target.value }))} /></label><button type="submit" className="quiet-button">Apply dates</button>{error && <p role="alert">{error}</p>}</form></details>
    <fieldset className="workspace-testing-window"><legend>Testing coverage</legend><div><button type="button" aria-pressed={request.testingWindow === "cumulative"} onClick={() => onChange({ testingWindow: "cumulative" })}>Through selected end</button><button type="button" aria-pressed={request.testingWindow === "period"} onClick={() => onChange({ testingWindow: "period" })}>Selected period only</button></div></fieldset>
  </fieldset></section>;
}

/** Account scope stays compact; the selected reporting view owns its metric cards. */
export function WorkspaceScopeSummary({ data, loading, rebuilding, error, legacy, accountCount, scopeLabel, request }: WorkspaceSummaryProps) {
  const ready = !legacy && !loading && !rebuilding && !error && Boolean(data);
  const unavailable = legacy ? "Reporting unavailable for this legacy organization." : loading || rebuilding
    ? rebuilding ? "Preparing complete reporting…" : "Loading reporting…" : "Complete reporting is unavailable.";
  const accounts = accountCount ?? (ready ? data!.roster.total : null);
  const qualifyScope = ready && (hasPlayerFilters(request) || accountCount !== undefined && accountCount !== data!.roster.total);
  return <section className="workspace-scope-summary" aria-label="Current reporting scope" aria-busy={loading || rebuilding || false}>
    <div className="workspace-scope-primary"><strong className="workspace-scope-label">{scopeLabel}</strong>
      {accounts !== null && <span className="workspace-scope-accounts"><strong>{accounts.toLocaleString()}</strong> player {accounts === 1 ? "account" : "accounts"}</span>}
    </div>
    <p role={loading || rebuilding ? "status" : undefined}>{ready
      ? <>{qualifyScope && <>Across {data!.scope.label}: </>}{data!.roster.included.toLocaleString()} included in reporting · {data!.roster.excluded.toLocaleString()} excluded</>
      : unavailable}</p>
  </section>;
}

export function WorkspaceSummary({ data, loading, error, legacy, accountCount, scopeLabel, request }: WorkspaceSummaryProps) {
  const period = `${shortDate(request.startDate)}–${shortDate(request.endDate)}`, unavailable = legacy ? "Unavailable" : loading ? "Loading…" : error || !data ? "Unavailable" : "";
  const fullyTested = data?.testing.statuses.find(row => row.key === "fullyTested")?.count || 0;
  return <section className="workspace-summary" aria-label="Roster and activity summary">
    <div className="workspace-summary-card"><span>Players</span><strong>{accountCount !== undefined ? accountCount.toLocaleString() : data ? data.roster.total.toLocaleString() : unavailable}</strong><p>{scopeLabel}{data && <><br />{data.roster.included.toLocaleString()} included in reporting{data.roster.excluded > 0 ? ` · ${data.roster.excluded} excluded` : ""}</>}</p></div>
    <div className="workspace-summary-card"><span>Testing coverage</span><strong>{unavailable || `${fullyTested.toLocaleString()}/${data!.roster.filtered.toLocaleString()}`}</strong><p>All six exercises · {request.testingWindow === "cumulative" ? `through ${request.endDate}` : period}</p></div>
    <div className="workspace-summary-card"><span>Completed workouts</span><strong>{unavailable || data!.workouts.completed.toLocaleString()}</strong><p>Recorded completions · {period}</p></div>
    <div className="workspace-summary-card"><span>Estimated active use</span><strong>{unavailable || minuteText(data!.usage.activeMinutes, data!.usage.collectedPlayers > 0)}</strong><p>{data ? `${data.usage.collectedPlayers}/${data.roster.filtered} players with collection` : "Measured website and app activity"}<br />{period}</p></div>
  </section>;
}

export function WorkspaceAttention({ data, onChange }: { data: ExpandedInsights; onChange(patch: Partial<ExpandedRequest>): void }) {
  const noTests = data.testing.statuses.find(row => row.key === "noRecordedTests")?.count || 0;
  return <section className="workspace-attention" aria-label="Worth reviewing"><div><strong>{noTests.toLocaleString()}</strong><span>players with no recorded tests</span><button type="button" className="directory-text-button" disabled={!noTests} onClick={() => onChange({ view: "testing", testingStatus: "noRecordedTests", rosterSearch: "", cursor: "", page: 0 })}>Review these players</button></div><div><p>{data.testing.needsReview.toLocaleString()} reps need review · {(data.testing.unmatchedFailureReports || 0).toLocaleString()} unmatched failure reports</p><Link to="/admin/analysis">General technique review →</Link><small>The review tool uses its own selection; these counts do not open a filtered queue.</small></div></section>;
}

/** Missing measurements and reporting exclusions are distinct from a real zero. */
export function WorkspaceMetricCells({ metric, loading, error, legacy }: WorkspaceMetricState & { metric?: WorkspacePlayerMetric }) {
  const unavailable = legacy ? "Unavailable" : loading ? "Loading…" : error ? "Unavailable" : metric?.status === "excluded" ? "Excluded from reporting" : metric?.status !== "included" ? "Unavailable" : "";
  const player = metric?.status === "included" ? metric.player : null;
  return <><td data-label="Testing" className="directory-metric"><span>{unavailable || TESTING_LABELS[player!.testing.status] || "Unknown status"}</span>{!unavailable && <small>{player!.testing.exercisesComplete}/6 exercises{player!.testing.hasDateUnknownAttempts && " · undated results need review"}</small>}</td>
    <td data-label="Completed workouts" className="directory-metric"><span>{unavailable || player!.workouts.completed.toLocaleString()}</span>{!unavailable && <small>{WORKOUT_LABELS[player!.workouts.status] || "Status unavailable"}</small>}</td>
    <td data-label="Estimated active use" className="directory-metric"><span>{unavailable || minuteText(player!.usage.activeMinutes, player!.usage.collected)}</span>{!unavailable && player!.usage.collected && <small>{player!.usage.activeDays} active {player!.usage.activeDays === 1 ? "day" : "days"}</small>}</td></>;
}

/** Every graph, metric card and explanation is visible without an extra disclosure. */
export function WorkspaceReportDetails({ data, request, onChange }: { data: ExpandedInsights; request: ExpandedRequest; onChange(patch: Partial<ExpandedRequest>): void }) {
  return <div className="workspace-report-details pt-insights"><ExpandedReport data={data} request={request} onChange={onChange} hidePlayerTable hidePlayerFilters onPrevious={() => {}} onNext={() => {}} playerLink={() => "#workspace-roster"} /></div>;
}
