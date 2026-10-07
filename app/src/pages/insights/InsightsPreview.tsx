import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { InsightTabs, InsightsControls } from "./InsightsPage";
import CoachRoster from "./CoachRoster";
import CoachOverviewSnapshot from "./CoachOverviewSnapshot";
import { CoachPercentile } from "./CoachPlayer";
import type { CoachComparison } from "./CoachPlayer";
import CoachPlayerOneScreen from "./CoachPlayerOneScreen";
import ExpandedReport from "./ExpandedReport";
import PlayerFilters from "./PlayerFilters";
import { expandedRequest, expandedQuery } from "./lib/expandedQuery";
import type { ExpandedRequest } from "./lib/expandedQuery";
import { previewInsights, previewInsightPlayer, previewPlayerSummary } from "./lib/preview";
import { EXERCISES } from "./lib/expanded";
import type { InsightAccess } from "./lib/expanded";
import AdminInsightsLayout from "./AdminInsightsLayout";
import { adminPlayerLinkFromReport } from "../admin/lib/adminNavigation";

export default function InsightsPreview({ embedded = false }: { embedded?: boolean }) {
  const location = useLocation(), navigate = useNavigate();
  const [request, setRequest] = useState(() => expandedRequest(window.location.search));
  useEffect(() => {
    const target = expandedRequest(location.search);
    setRequest(value => ({ ...value, ...target }));
  }, [location.search]);
  const page = request.page;
  const [state, setState] = useState("normal"), [role, setRole] = useState<InsightAccess>(embedded ? "admin" : "coach");
  const data = previewInsights(request, page, state, role);
  const change = (patch: Partial<ExpandedRequest>) => {
    const dataChange = Object.keys(patch).some(key => !["view", "playerId", "extra", "cursor", "page"].includes(key));
    const next = { ...request, ...patch, ...(dataChange ? { cursor: "", page: 0 } : {}) };
    setRequest(next);
    const params = expandedQuery(next);
    if (params.toString() !== new URLSearchParams(location.search).toString()) navigate({ search: params.toString() });
  };
  const playerLink = (player: { id: string }) => `/insights?${expandedQuery(request, { view: "player", playerId: player.id })}`;
  const coach = !embedded && role === "coach";
  const selected = request.playerId ? previewInsightPlayer(request, request.playerId, state, role) : data.players[0];
  const tested = selected && request.testingWindow === "period" ? previewInsightPlayer({ ...request, testingWindow: "cumulative" }, selected.id, state, role) : selected;
  const comparison: CoachComparison = { schemaVersion: 1, scope: data.scope, player: { id: selected?.id || "synthetic", firstName: selected?.firstName || "Sample", lastName: selected?.lastName || "Player", age: selected?.age ?? null }, period: data.period, testingMode: request.testingWindow, generatedAtMillis: Date.now(), freshness: { complete: true }, roster: data.roster,
    performance: selected?.performance, testScores: tested && EXERCISES.map((drill, index) => ({ drill, score: tested.testing.exerciseKeys.includes(drill) ? Math.max(1, (tested.performance?.d1 ?? 60) - index * 2) : null,
      change: tested.testing.exerciseKeys.includes(drill) ? tested.performance?.change ?? null : null, lastTestDate: tested.testing.exerciseKeys.includes(drill) ? tested.performance?.lastTestDate ?? null : null, previousTestDate: tested.testing.exerciseKeys.includes(drill) ? tested.performance?.previousTestDate ?? null : null })),
    axes: ["Power", "Speed", "Agility", "Ball Control", "Striking"].map((label, index) => ({ key: label, label, percentile: [65, 82, 44, 71, 55][index], measuredScore: 75, sampleCount: 18 - index, status: "measured" })) };
  const summary = selected ? previewPlayerSummary(selected) : null;
  const content = <>
    {!embedded && request.view !== "player" && <div className="insights-preview-controls"><label>Preview role<select value={role} onChange={event => { setRole(event.target.value as InsightAccess); change({ orgId: event.target.value === "admin" ? undefined : "northfield", teamId: event.target.value === "coach" ? "harbor" : undefined }); }}><option value="admin">Admin</option><option value="manager">Manager</option><option value="coach">Assigned coach</option></select></label><label>Preview state<select value={state} onChange={event => { setState(event.target.value); setRequest(value => ({ ...value, page: 0 })); }}><option value="normal">Recorded data</option><option value="empty">Empty roster</option><option value="uncollected">Usage not collected</option><option value="loading">Loading</option><option value="error">Load failure</option></select></label></div>}
    {request.view !== "player" && <section className={`insights-heading${embedded ? " admin-overview-heading" : ""}`}><p className="eyebrow">{embedded ? "Admin" : "Insights"}</p><h1>{embedded ? "Overview" : data.scope.label}</h1>{!coach && <p>{embedded ? `${data.scope.label} · ` : ""}Understand your roster, successful testing, completed workouts and estimated active use.</p>}</section>}
    {request.view !== "player" && <InsightsControls choices={data.choices} request={request} scope={data.scope} loading={state === "loading"} hideScope={embedded} coach={coach} onChange={change} onRefresh={() => setState("normal")} />}
    <InsightTabs request={request} onChange={change} coach={coach} playerName={selected ? `${comparison.player.firstName} ${comparison.player.lastName}` : "Player unavailable"} onClosePlayer={() => change({ view: "overview", playerId: "" })} />
    {["overview", "testing", "player"].includes(request.view) && <div className="insights-toolbar"><p className="insights-note">Testing coverage</p><div className="insights-toggle" aria-label="Testing coverage period"><button aria-pressed={request.testingWindow === "cumulative"} onClick={() => change({ testingWindow: "cumulative" })}>Through selected end</button><button aria-pressed={request.testingWindow === "period"} onClick={() => change({ testingWindow: "period" })}>Selected period only</button></div></div>}
    {state === "loading" ? <p role="status">Loading complete Insights…</p> : state === "error" ? <div role="alert"><p>Insights could not be loaded. Retry or choose another scope.</p><button className="quiet-button" onClick={() => setState("normal")}>Retry Insights</button></div> : <div id="insights-report" role="tabpanel" aria-labelledby={`insights-tab-${request.view}`}>{coach && request.view === "overview" && <><PlayerFilters data={data} request={request} onChange={change} /><CoachOverviewSnapshot data={data} playerLink={playerLink} /><CoachRoster preview data={data} search={request.rosterSearch} page={page} onSearch={rosterSearch => change({ rosterSearch })} onPrevious={() => change({ page: page - 1 })} onNext={() => change({ page: page + 1 })} playerLink={playerLink} /></>}
      {coach && request.view === "overview" ? null : coach && request.view === "player" ? summary ? <><CoachPlayerOneScreen summary={summary} performance={comparison.performance} testScores={comparison.testScores} period={comparison.period} generatedAtMillis={comparison.generatedAtMillis} onPrescribe={() => {}} disabled /><section className="coach-player-more" aria-label="Team comparison and full player records"><header className="coach-player-more-header"><h2>Team comparison and full player records</h2></header><CoachPercentile data={comparison} /><section className="coach-player-training insights-card"><p>This synthetic player has summary data only. Detailed plans, session records and coach notes are unavailable in this preview.</p></section></section></> : <section className="insights-card" role="alert"><h2>Player unavailable</h2><p>This player is not in the selected preview roster.</p><button className="quiet-button" onClick={() => change({ view: "overview", playerId: "" })}>Back to roster</button></section>
      : coach && request.view === "community" ? <section className="insights-card"><h2>Community</h2><p>Synthetic preview. Team activity, people and sharing settings appear here for signed-in coaches.</p></section>
      : <ExpandedReport data={data} request={request} adminOverview={embedded && role === "admin"} onChange={change} page={page} onPrevious={() => change({ page: page - 1 })} onNext={() => change({ page: page + 1 })} playerLink={player => embedded ? adminPlayerLinkFromReport(player.id, "results", location.search, { orgId: player.organizationId, teamId: player.teamId || undefined }) : playerLink(player)} playerActionLink={embedded ? (player, tab) => adminPlayerLinkFromReport(player.id, tab, location.search, { orgId: player.organizationId, teamId: player.teamId || undefined }) : undefined} />}</div>}
  </>;
  if (embedded) return <div className="pt-insights admin-insights">{content}</div>;
  if (role === "admin") return <AdminInsightsLayout uid="preview-admin" email="admin@posetek.test" preview onSignOut={() => {}}>{content}</AdminInsightsLayout>;
  return <div className="pt-pose portal-body pt-insights"><header className="portal-header"><span className="portal-brand"><span className="portal-brand-mark">P</span>POSETEK</span><span className="insights-note">Synthetic preview · no live data</span></header><main className="insights-shell">{content}</main></div>;
}
