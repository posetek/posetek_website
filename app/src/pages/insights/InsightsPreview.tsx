import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { InsightTabs, InsightsControls } from "./InsightsPage";
import CoachRoster from "./CoachRoster";
import CoachOverviewSnapshot from "./CoachOverviewSnapshot";
import { CoachPercentile } from "./CoachPlayer";
import type { CoachComparison } from "./CoachPlayer";
import CoachPlayerOneScreen from "./CoachPlayerOneScreen";
import AthleteDetail from "../coach-dashboard/views/AthleteDetail";
import { PREVIEW_BUNDLES, PREVIEW_PLAYERS } from "../coach-dashboard/lib/preview";
import { athleteSummary } from "../coach-dashboard/lib/logic";
import ExpandedReport from "./ExpandedReport";
import PlayerFilters from "./PlayerFilters";
import { expandedRequest, overviewReset } from "./lib/expandedQuery";
import type { ExpandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";
import type { InsightAccess } from "./lib/expanded";
import OrganizationHeader from "../organization/OrganizationHeader";
import AdminInsightsLayout from "./AdminInsightsLayout";
import { adminPlayerLinkFromReport } from "../admin/lib/adminNavigation";

export default function InsightsPreview({ embedded = false }: { embedded?: boolean }) {
  const location = useLocation(), navigate = useNavigate();
  const [request, setRequest] = useState(() => expandedRequest(window.location.search + (embedded ? "" : "&orgId=northfield&teamId=harbor")));
  useEffect(() => {
    const target = expandedRequest(location.search);
    setRequest(value => value.view === target.view && value.playerId === target.playerId ? value
      : { ...value, ...(target.view === "overview" && value.view !== "overview" ? overviewReset() : {}), view: target.view, playerId: target.playerId });
  }, [location.search]);
  const page = request.page;
  const [state, setState] = useState("normal"), [role, setRole] = useState<InsightAccess>(embedded ? "admin" : "coach");
  const data = previewInsights(request, page, state, role);
  const change = (patch: Partial<ExpandedRequest>) => {
    setRequest(value => ({ ...value, ...(patch.view === "overview" && value.view !== "overview" ? overviewReset() : {}), ...patch, page: patch.page ?? 0 }));
    if (!("view" in patch) && !("playerId" in patch)) return;
    const params = new URLSearchParams(location.search), view = patch.view ?? request.view, playerId = patch.playerId ?? request.playerId;
    params.set("view", view); if (playerId) params.set("playerId", playerId); else params.delete("playerId");
    if (params.toString() !== new URLSearchParams(location.search).toString()) navigate({ search: params.toString() });
  };
  const coach = !embedded && role === "coach";
  const selected = data.players.find(player => player.id === request.playerId) || data.players[0];
  const comparison: CoachComparison = { schemaVersion: 1, scope: data.scope, player: { id: selected?.id || "synthetic", firstName: selected?.firstName || "Sample", lastName: selected?.lastName || "Player", age: selected?.age ?? null }, period: data.period, testingMode: request.testingWindow, generatedAtMillis: Date.now(), freshness: { complete: true }, roster: data.roster, axes: ["Power", "Speed", "Agility", "Ball Control", "Striking"].map((label, index) => ({ key: label, label, percentile: [65, 82, 44, 71, 55][index], measuredScore: 75, sampleCount: 18 - index, status: "measured" })) };
  const sample = PREVIEW_PLAYERS[0], bundle = PREVIEW_BUNDLES[sample.id];
  const summary = athleteSummary({ ...sample, firstName: comparison.player.firstName, lastName: comparison.player.lastName }, bundle.reps, bundle.plans, bundle.logs);
  const content = <>
    {!embedded && request.view !== "player" && <div className="insights-preview-controls"><label>Preview role<select value={role} onChange={event => { setRole(event.target.value as InsightAccess); change({ orgId: event.target.value === "admin" ? undefined : "northfield", teamId: event.target.value === "coach" ? "harbor" : undefined }); }}><option value="admin">Admin</option><option value="manager">Manager</option><option value="coach">Assigned coach</option></select></label><label>Preview state<select value={state} onChange={event => { setState(event.target.value); setRequest(value => ({ ...value, page: 0 })); }}><option value="normal">Recorded data</option><option value="empty">Empty roster</option><option value="uncollected">Usage not collected</option><option value="loading">Loading</option><option value="error">Load failure</option></select></label></div>}
    {request.view !== "player" && <section className={`insights-heading${embedded ? " admin-overview-heading" : ""}`}><p className="eyebrow">{embedded ? "Admin" : "Insights"}</p><h1>{embedded ? "Overview" : data.scope.label}</h1>{!coach && <p>{embedded ? `${data.scope.label} · ` : ""}Understand your roster, successful testing, completed workouts and estimated active use.</p>}</section>}
    {request.view !== "player" && <InsightsControls choices={data.choices} request={request} scope={data.scope} loading={state === "loading"} hideScope={embedded} coach={coach} onChange={change} onRefresh={() => setState("normal")} />}
    <InsightTabs request={request} onChange={change} coach={coach} playerName={`${comparison.player.firstName} ${comparison.player.lastName}`} onClosePlayer={() => change({ view: "overview", playerId: "" })} />
    {["overview", "testing"].includes(request.view) && <div className="insights-toolbar"><p className="insights-note">Testing coverage</p><div className="insights-toggle"><button aria-pressed={request.testingWindow === "cumulative"} onClick={() => change({ testingWindow: "cumulative" })}>Through selected end</button><button aria-pressed={request.testingWindow === "period"} onClick={() => change({ testingWindow: "period" })}>Selected period only</button></div></div>}
    {(request.view === "testing" || request.view === "overview" && !coach) && <div className="insights-toolbar"><p className="insights-note">Testing coverage</p><div className="insights-toggle"><button aria-pressed={request.testingWindow === "cumulative"} onClick={() => change({ testingWindow: "cumulative" })}>Through selected end</button><button aria-pressed={request.testingWindow === "period"} onClick={() => change({ testingWindow: "period" })}>Selected period only</button></div></div>}
    {state === "loading" ? <p role="status">Loading complete Insights…</p> : state === "error" ? <div role="alert"><p>Insights could not be loaded. Retry or choose another scope.</p><button className="quiet-button" onClick={() => setState("normal")}>Retry Insights</button></div> : <div id="insights-report" role="tabpanel" aria-labelledby={`insights-tab-${request.view}`}>{coach && request.view === "overview" && <><PlayerFilters data={data} request={request} onChange={change} /><CoachOverviewSnapshot data={data} playerLink={player => `/insights?preview=1&view=player&playerId=${player.id}`} /><CoachRoster preview data={data} search={request.rosterSearch} page={page} onSearch={rosterSearch => change({ rosterSearch })} onPrevious={() => change({ page: page - 1 })} onNext={() => change({ page: page + 1 })} playerLink={player => `/insights?preview=1&view=player&playerId=${player.id}`} /></>}
      {coach && request.view === "overview" ? null : coach && request.view === "player" ? <><CoachPlayerOneScreen summary={summary} onPrescribe={() => {}} disabled /><section className="coach-player-more" aria-label="Team comparison and full player records"><header className="coach-player-more-header"><h2>Team comparison and full player records</h2></header><CoachPercentile data={comparison} /><section className="coach-player-training pt-coachdash"><AthleteDetail embedded preview summary={summary} job={null} onBack={() => change({ view: "overview" })} onCreatePlan={() => {}} onPlanChanged={async () => {}} /></section></section></>
      : coach && request.view === "community" ? <section className="insights-card"><h2>Community</h2><p>Synthetic preview. Team activity, people and sharing settings appear here for signed-in coaches.</p></section>
      : <ExpandedReport data={data} request={request} adminOverview={embedded && role === "admin"} onChange={change} page={page} onPrevious={() => change({ page: page - 1 })} onNext={() => change({ page: page + 1 })} playerLink={player => embedded ? adminPlayerLinkFromReport(player.id, "results", location.search, { orgId: player.organizationId, teamId: player.teamId || undefined }) : `/insights?preview=1&view=player&playerId=${player.id}`} playerActionLink={embedded ? (player, tab) => adminPlayerLinkFromReport(player.id, tab, location.search, { orgId: player.organizationId, teamId: player.teamId || undefined }) : undefined} />}</div>}
  </>;
  if (embedded) return <div className="pt-insights admin-insights">{content}</div>;
  if (role === "admin") return <AdminInsightsLayout uid="preview-admin" email="admin@posetek.test" preview onSignOut={() => {}}>{content}</AdminInsightsLayout>;
  if (role === "manager") return <div className="pt-pose portal-body pt-insights"><OrganizationHeader ready orgId={request.orgId} teamId={request.teamId} email="manager@example.test" preview onSignOut={() => {}} /><main className="insights-shell">{content}</main></div>;
  return <div className="pt-pose portal-body pt-insights"><header className="portal-header"><span className="portal-brand"><span className="portal-brand-mark">P</span>POSETEK</span><span className="insights-note">Synthetic preview · no live data</span></header><main className="insights-shell">{content}</main></div>;
}
