import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext, type ClubContext } from "../../lib/organization-data";
import { completeReport } from "./lib/completeReport";
import ExpandedReport from "./ExpandedReport";
import CoachRoster from "./CoachRoster";
import CoachPlayer from "./CoachPlayer";
import EmbeddedCoachCommunity from "../feed/EmbeddedCoachCommunity";
import EmbeddedRosterManagement from "../roster/EmbeddedRosterManagement";
import { assertReportScope, expandedFailureMessage, reportPayload, scopeFor } from "./lib/expanded";
import type { ExpandedInsights, InsightAccess, InsightChoices, InsightScope } from "./lib/expanded";
import { clearPlayerFilters, dateInZone, expandedQuery, expandedRequest, INSIGHT_VIEWS, shiftDate, TIMEZONES } from "./lib/expandedQuery";
import type { ExpandedRequest } from "./lib/expandedQuery";
import { createInsightsRequestGuard, insightsPlayerLink, insightsReturnLink, isInsightsStaff } from "./lib/navigation";
import "../../styles/pose-portal.css";
import "../../styles/admin-theme.scss";
import "./insights.scss";

const Preview = import.meta.env.DEV ? lazy(() => import("./InsightsPreview")) : null;

export default function InsightsPage() {
  const navigate = useNavigate(), location = useLocation();
  const preview = !!Preview && new URLSearchParams(location.search).get("preview") === "1";
  const [uid, setUid] = useState(auth.currentUser?.uid ?? "");
  useEffect(() => {
    if (preview) return;
    return auth.onAuthStateChanged(user => {
      setUid(user?.uid ?? "");
      if (!user) navigate(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    });
  }, [navigate, location.pathname, location.search, preview]);
  if (preview && Preview) return <Suspense fallback={<p>Loading synthetic preview…</p>}><Preview /></Suspense>;
  return uid ? <InsightsWorkspace key={uid} uid={uid} /> : <p role="status">Checking your sign-in…</p>;
}

export function InsightTabs({ request, onChange, coach = false, playerName = "Player", onClosePlayer }: { request: ExpandedRequest; onChange: (patch: Partial<ExpandedRequest>) => void; coach?: boolean; playerName?: string; onClosePlayer?: () => void }) {
  const views = [...INSIGHT_VIEWS, ...(coach ? ["community" as const] : []), ...(coach && request.playerId ? ["player" as const] : [])];
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabs.current, selected = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!nav || !selected) return;
    const left = selected.offsetLeft - nav.offsetLeft, right = left + selected.offsetWidth;
    if (left < nav.scrollLeft) nav.scrollLeft = left;
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
  }, [request.view, playerName]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const current = views.indexOf(request.view as typeof views[number]);
    const index = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    event.preventDefault(); onChange({ view: views[index] });
    document.getElementById(`insights-tab-${views[index]}`)?.focus();
  }
  return <div className="coach-tab-row"><nav ref={tabs} className="insights-tabs" aria-label={coach ? "Coach workspace" : "Insights views"} role="tablist" onKeyDown={keyboard}>{views.map(view => <button key={view} type="button" role="tab" tabIndex={request.view === view ? 0 : -1} aria-selected={request.view === view} aria-controls="insights-report" id={`insights-tab-${view}`} onClick={() => onChange({ view })}>{view === "player" ? playerName : view === "usage" && coach ? "Active use" : view[0].toUpperCase() + view.slice(1)}</button>)}</nav>{coach && request.playerId && <button className="coach-close-player" type="button" aria-label={`Close ${playerName} tab`} onClick={onClosePlayer}>×</button>}</div>;
}

export function InsightsControls({ choices, request, scope, loading, hideScope = false, coach = false, onChange, onRefresh }: {
  choices: InsightChoices;
  request: ExpandedRequest;
  scope: InsightScope;
  loading: boolean;
  hideScope?: boolean;
  coach?: boolean;
  onChange: (patch: Partial<ExpandedRequest>) => void;
  onRefresh: () => void;
}) {
  const orgId = (scope.kind === "global" || scope.kind === "coachRoster") ? "" : scope.organizationId, teamId = scope.kind === "team" ? scope.teamId : "";
  const organization = choices.organizations.find(org => org.id === orgId);
  const [dates, setDates] = useState({ start: request.startDate, end: request.endDate });
  const [dateError, setDateError] = useState("");
  useEffect(() => setDates({ start: request.startDate, end: request.endDate }), [request.startDate, request.endDate]);
  const today = dateInZone(new Date(), request.timezone);
  const preset = request.startDate === shiftDate(request.endDate, 1 - request.weeks * 7) ? request.weeks : 0;

  return <section className="insights-controls" aria-label="Report scope and dates">
    <div className="insights-control-row">
      {!hideScope && scope.kind !== "coachRoster" && <>
        <label>Organization<select value={orgId} onChange={event => onChange({ orgId: event.target.value || undefined, teamId: undefined, coachId: undefined, ...clearPlayerFilters() })}>{choices.global && <option value="">All organizations</option>}{choices.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
        <label>Team<select value={teamId} disabled={!organization} onChange={event => onChange({ teamId: event.target.value || undefined, teamAssignment: "" })}>{!coach && <option value="">{organization?.role === "coach" ? "All assigned teams" : "All teams + unassigned"}</option>}{coach && !teamId && <option value="" disabled>Choose a team</option>}{organization?.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      </>}
      <label>Timezone<select value={request.timezone} onChange={event => onChange({ timezone: event.target.value })}>{TIMEZONES.map(zone => <option key={zone} value={zone}>{zone.replace("America/", "").replaceAll("_", " ")}</option>)}</select></label>
      <fieldset className="insights-period-presets"><legend>Period</legend><div>{[4, 8, 12, 26].map(weeks => <button key={weeks} type="button" aria-pressed={preset === weeks} onClick={() => onChange({ weeks, startDate: shiftDate(today, 1 - weeks * 7), endDate: today })}>{weeks}w</button>)}</div></fieldset>
      <details className="insights-custom-period">
        <summary>Custom</summary>
        <form onSubmit={event => {
          event.preventDefault();
          if (!dates.start || !dates.end || dates.start > dates.end || dates.end > today || dates.start < shiftDate(dates.end, -365)) {
            setDateError("Choose a valid date range of up to one year ending today or earlier."); return;
          }
          setDateError(""); onChange({ startDate: dates.start, endDate: dates.end });
        }}>
          <label>From<input type="date" value={dates.start} max={dates.end} onChange={event => setDates(value => ({ ...value, start: event.target.value }))} /></label>
          <label>Through<input type="date" value={dates.end} min={dates.start} max={today} onChange={event => setDates(value => ({ ...value, end: event.target.value }))} /></label>
          <button className="quiet-button" type="submit">Apply dates</button>
          {dateError && <p className="insights-note" role="alert">{dateError}</p>}
        </form>
      </details>
      <button className="insights-refresh" type="button" disabled={loading} onClick={onRefresh} aria-label="Refresh Insights" title="Refresh Insights"><span className="material-symbols-outlined" aria-hidden="true">refresh</span></button>
    </div>
  </section>;
}

export function InsightsWorkspace({ uid, embedded = false }: { uid: string; embedded?: boolean }) {
  const navigate = useNavigate(), location = useLocation();
  const [query, setQuery] = useSearchParams(), request = expandedRequest(query.toString());
  // React Router replaces its setter when any query parameter changes. Keep
  // that presentation-only identity out of the server request lifecycle.
  const queryWriter = useRef(setQuery); queryWriter.current = setQuery;
  const [response, setResponse] = useState<{ key: string; data: ExpandedInsights } | null>(null);
  const [choices, setChoices] = useState<InsightChoices | null>(null), [context, setContext] = useState<ClubContext | null>(null);
  const [scope, setScope] = useState<InsightScope | null>(null), [role, setRole] = useState<InsightAccess | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [accessDenied, setAccessDenied] = useState(false);
  const [retry, setRetry] = useState(0), [playerLabel, setPlayerLabel] = useState({ id: "", name: "Player" });
  const scrollPosition = useRef(0), previousView = useRef(request.view);
  const cursorHistory = useRef<Record<number, string>>({ 0: "" });
  const guard = useRef(createInsightsRequestGuard(() => auth.currentUser?.uid)).current;
  // Presentation-only tabs, feed links and player selection never reload the report.
  const requestKey = JSON.stringify([uid, embedded, request.orgId, request.teamId, request.startDate, request.endDate, request.timezone, request.testingWindow, request.division, request.ageBand, request.testingStatus, request.workoutStatus, request.usageStatus, request.usagePlatform, request.usageFeature, request.teamAssignment, request.rosterSearch, request.cursor, retry]);
  const report = response?.key === requestKey ? response.data : null;
  const coach = !embedded && role === "coach";
  const currentScope = report?.scope || scope;
  const selectedName = report?.players.find(player => player.id === request.playerId);
  const playerName = selectedName ? `${selectedName.firstName} ${selectedName.lastName}` : playerLabel.id === request.playerId ? playerLabel.name : "Player";

  useEffect(() => {
    if (previousView.current === "overview" && request.view !== "overview") scrollPosition.current = window.scrollY;
    if (request.view === "overview" && previousView.current !== "overview") requestAnimationFrame(() => window.scrollTo({ top: scrollPosition.current, behavior: "instant" }));
    previousView.current = request.view;
  }, [request.view]);

  useEffect(() => {
    document.title = embedded ? "Admin overview | PoseTek" : "Team Insights | PoseTek";
    const isCurrent = guard.begin(uid);
    setResponse(null); setContext(null); setError(""); setLoading(true); setRebuilding(false); setAccessDenied(false); setChoices(null); setScope(null);
    void (async () => {
      try {
        const club = await getClubContext(request.orgId);
        if (!isCurrent()) return;
        if (!isInsightsStaff(club.role) && club.role !== "none") { setAccessDenied(true); return; }
        const access: InsightAccess = club.role === "none" ? "coach" : club.role as InsightAccess;
        const canonical = club.organization?.schemaVersion === 2 ? club.organization : null;
        if (request.orgId && canonical?.id !== request.orgId) throw Object.assign(new Error("Organization access changed"), { code: "permission-denied" });
        let selected: InsightScope;
        if (access === "coach" && !canonical) {
          if (request.orgId || request.teamId) throw Object.assign(new Error("Team access changed"), { code: "permission-denied" });
          selected = { kind: "coachRoster" };
        } else selected = scopeFor(request, access, access === "admin" ? undefined : canonical?.id);
        const available: InsightChoices = { global: access === "admin", organizations: club.organizations.filter(org => org.schemaVersion === 2).map(org => ({ id: org.id, name: org.name, role: access, teams: club.teams.filter(team => team.organizationId === org.id).map(team => ({ id: team.id, name: team.name })) })) };
        setChoices(available); setRole(access); setContext(club);
        if (access === "coach" && canonical) {
          const teams = club.teams.filter(team => team.organizationId === canonical.id);
          if (request.teamId && !teams.some(team => team.id === request.teamId)) throw Object.assign(new Error("Team access changed"), { code: "permission-denied" });
          let remembered = "";
          try { remembered = localStorage.getItem(`posetek:insights-team:${uid}:${canonical.id}`) || ""; } catch { /* Storage is optional. */ }
          const teamId = request.teamId || teams.find(team => team.id === remembered)?.id || teams[0]?.id;
          if (!teamId) { setAccessDenied(true); return; }
          selected = { kind: "team", organizationId: canonical.id, teamId };
          try { localStorage.setItem(`posetek:insights-team:${uid}:${canonical.id}`, teamId); } catch { /* Storage is optional. */ }
          if (!request.orgId || !request.teamId) { queryWriter.current(current => expandedQuery(expandedRequest(current.toString()), { orgId: canonical.id, teamId }), { replace: true }); return; }
        }
        setScope(selected);
        if (selected.kind !== "global" && selected.kind !== "coachRoster" && !request.orgId) { queryWriter.current(current => expandedQuery(expandedRequest(current.toString()), { orgId: selected.organizationId }), { replace: true }); return; }
        const result = await completeReport(() => clubCall<ExpandedInsights>("getClubInsightsV2", reportPayload(request, selected, request.cursor)), isCurrent, () => setRebuilding(true));
        if (!result || !isCurrent()) return;
        assertReportScope(result, selected, request);
        setChoices(result.choices); setScope(result.scope); setRole(result.scope.access); setResponse({ key: requestKey, data: result });
        cursorHistory.current[request.page] = request.cursor;
        if (result.pagination.nextCursor) cursorHistory.current[request.page + 1] = result.pagination.nextCursor;
      } catch (failure) {
        if (!isCurrent()) return;
        const code = String((failure as { code?: string })?.code || "").split("/").at(-1);
        if (["unauthenticated", "permission-denied", "not-found"].includes(code || "")) { setChoices(null); setScope(null); setContext(null); }
        setResponse(null); setError(expandedFailureMessage(failure));
      } finally { if (isCurrent()) setLoading(false); }
    })();
    return () => guard.cancel();
  // requestKey contains only fields used by the server; view/feed changes preserve state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, guard]);

  function change(patch: Partial<ExpandedRequest>) {
    const dataChange = Object.keys(patch).some(key => !["view", "playerId", "extra", "cursor", "page"].includes(key));
    const scopeChange = Object.hasOwn(patch, "orgId") || Object.hasOwn(patch, "teamId");
    if (dataChange) cursorHistory.current = { 0: "" };
    const next = expandedQuery(request, { ...patch, ...(dataChange ? { cursor: "", page: 0 } : {}), ...(scopeChange ? { playerId: "", view: "overview" } : {}) });
    if (next.toString() === query.toString()) return;
    if (dataChange || Object.hasOwn(patch, "cursor")) { guard.cancel(); setResponse(null); setLoading(true); }
    setQuery(next);
  }
  function refresh() {
    guard.cancel(); setResponse(null); setLoading(true); cursorHistory.current = { 0: "" };
    // A changed roster invalidates opaque cursors. Refresh starts a fresh page
    // while preserving the selected player, reporting filters and dates.
    if (request.cursor || request.page) setQuery(expandedQuery(request, { cursor: "", page: 0 }), { replace: true });
    setRetry(value => value + 1);
  }
  function previousPage() {
    if (request.page < 1) return;
    const previous = cursorHistory.current[request.page - 1];
    if (previous !== undefined) { change({ page: request.page - 1, cursor: previous }); return; }
    // A refreshed deep link may not have local cursor history. Ask the service for
    // each preceding page rather than decoding or fabricating its opaque cursor.
    guard.cancel(); setResponse(null); setLoading(true);
    const isCurrent = guard.begin(uid);
    void (async () => { try {
      let cursor = "";
      for (let page = 0; page < request.page - 1; page++) {
        const result = await completeReport(() => clubCall<ExpandedInsights>("getClubInsightsV2", reportPayload(request, currentScope!, cursor)), isCurrent, () => setRebuilding(true));
        if (!result || !isCurrent()) return; assertReportScope(result, currentScope!, request);
        if (!result.pagination.nextCursor) throw Object.assign(new Error("Roster changed"), { code: "failed-precondition" });
        cursor = result.pagination.nextCursor; cursorHistory.current[page + 1] = cursor;
      }
      if (isCurrent()) change({ page: request.page - 1, cursor });
    } catch (failure) { if (isCurrent()) { setError(expandedFailureMessage(failure)); setLoading(false); } } })();
  }
  function nextPage() { if (report?.pagination.nextCursor) change({ page: request.page + 1, cursor: report.pagination.nextCursor }); }
  function playerLink(player: { id: string }) { return `/insights?${expandedQuery(request, { view: "player", playerId: player.id })}`; }
  function closePlayer() { change({ view: "overview", playerId: "" }); }
  function prescribe() {
    if (!report || !request.playerId) return;
    const params = new URLSearchParams({ players: request.playerId, returnTo: location.pathname + location.search });
    if (report.scope.kind === "team" || report.scope.kind === "organization") params.set("orgId", report.scope.organizationId);
    if (report.scope.kind === "team") params.set("teamId", report.scope.teamId);
    navigate(`/programs?${params}`);
  }
  const activeView = request.view === "player" || request.view === "community" ? coach ? request.view : "overview" : request.view;
  const content = <>
    <section className={`insights-heading${embedded ? " admin-overview-heading" : ""}`}>
      {!embedded && <p className="eyebrow">{coach ? "Team Insights" : "Insights"}</p>}
      <h1>{embedded ? "Overview" : report?.scope.label || (scope?.kind === "global" ? "All organizations" : "Team Insights")}</h1>
      <p>{embedded && (report?.scope.label || "")} {coach ? "Your roster, player progress and training in one place." : "Understand your roster, successful testing, completed workouts and estimated active use."}</p>
    </section>
    {choices && currentScope && activeView !== "community" && <InsightsControls choices={choices} request={request} scope={currentScope} loading={loading} hideScope={embedded} coach={coach} onChange={change} onRefresh={refresh} />}
    <InsightTabs request={{ ...request, view: activeView }} onChange={change} coach={coach} playerName={playerName} onClosePlayer={closePlayer} />
    {["overview", "testing", "player"].includes(activeView) && <div className="insights-toolbar"><p className="insights-note">Testing coverage</p><div className="insights-toggle" aria-label="Testing coverage period"><button type="button" aria-pressed={request.testingWindow === "cumulative"} onClick={() => change({ testingWindow: "cumulative" })}>Through selected end</button><button type="button" aria-pressed={request.testingWindow === "period"} onClick={() => change({ testingWindow: "period" })}>Selected period only</button></div></div>}
    {error && <div className="insights-message error" role="alert"><p>{error}</p><button className="quiet-button" type="button" onClick={refresh}>Retry Insights</button></div>}
    {accessDenied && <section className="insights-card"><h2>No current coaching scope</h2><p>Ask your organization manager to assign a team, or sign in with your active coach account.</p><Link className="quiet-button" to="/organization">Open organization</Link></section>}
    {loading && <p role="status">{rebuilding ? "Refreshing team records…" : "Loading complete Insights…"}</p>}
    {report && !loading && <div id="insights-report" role="tabpanel" aria-labelledby={`insights-tab-${activeView}`} tabIndex={0}>
      {coach && request.playerId && <div hidden={activeView !== "player"}><CoachPlayer key={JSON.stringify([uid, report.scope, request.playerId])} uid={uid} scope={report.scope} request={request} onName={name => setPlayerLabel({ id: request.playerId, name })} onPrescribe={prescribe} onClose={closePlayer} /></div>}
      {coach && activeView === "community" ? <EmbeddedCoachCommunity uid={uid} organizationId={report.scope.kind === "team" || report.scope.kind === "organization" ? report.scope.organizationId : undefined} />
        : activeView !== "player" ? <>
          {coach && activeView === "overview" && <><CoachRoster data={report} search={request.rosterSearch} page={request.page} onSearch={rosterSearch => change({ rosterSearch })} onPrevious={previousPage} onNext={nextPage} playerLink={playerLink} /><EmbeddedRosterManagement context={context || undefined} teamId={report.scope.kind === "team" ? report.scope.teamId : undefined} onRefresh={refresh} /></>}
          <ExpandedReport data={report} request={{ ...request, view: activeView === "community" ? "overview" : activeView }} onChange={change} hidePlayerTable={coach && activeView === "overview"} adminOverview={embedded && role === "admin"} page={request.page} onPrevious={previousPage} onNext={nextPage} playerLink={player => coach ? playerLink(player) : insightsPlayerLink(role || undefined, player.id, { orgId: player.organizationId, teamId: player.teamId || undefined, coachId: request.coachId })} />
        </> : !request.playerId ? <section className="insights-card"><h2>Select a player</h2><button type="button" className="quiet-button" onClick={closePlayer}>Open roster</button></section> : null}
    </div>}
  </>;
  if (embedded) return <div className="pt-insights admin-insights">{content}</div>;
  const back = insightsReturnLink(role || undefined, { orgId: request.orgId, teamId: request.teamId, coachId: request.coachId }, request.from);
  return <div className="pt-pose portal-body pt-insights">
    <header className="portal-header"><Link className="portal-brand" to={coach ? `/insights?${expandedQuery(request, { view: "overview" })}` : back}><span className="portal-brand-mark">P</span>POSETEK</Link>{!coach && role && <Link className="quiet-button" to={back}>{role === "admin" ? "Accounts" : "Organization"}</Link>}<button className="quiet-button" onClick={() => { guard.cancel(); setResponse(null); setContext(null); setScope(null); void auth.signOut().catch(() => setError("Sign out failed. Try again.")); }}>Sign out</button></header>
    <main className="insights-shell">{content}</main>
  </div>;
}
