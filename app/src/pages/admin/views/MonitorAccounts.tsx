import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadPlayer, PLAYER_INDEX_LIMIT, resolvePlayerAge } from "../lib/accounts";
import type { CoachRow, OrganizationRow, PlayerRow } from "../lib/accounts";
import { hasClubIdentity, legacyCoachGroups, staffName } from "../lib/accountHierarchy";
import type { AccountContext, HierarchyTeam } from "../lib/accountHierarchy";
import { useAccountLoad } from "../lib/useAccountLoad";
import { directoryCoachPath, directoryPage, directoryPlayers, directorySource, unassignedDirectoryPlayers } from "../lib/adminDirectory";
import type { DirectoryRoster, DirectorySource } from "../lib/adminDirectory";
import { adminDirectoryPath, adminPlayerPath, directoryLevelOf, parseAdminDirectoryState, selectDirectoryScope, withWorkspaceReport, workspaceReportRequest, workspaceReportSearch } from "../lib/adminNavigation";
import type { AdminDirectoryState } from "../lib/adminNavigation";
import PlayerRosterRow, { AccountAvatar } from "./PlayerRosterRow";
import SignupStatus from "./SignupStatus";
import DirectoryManagement, { DirectoryPlayerActions } from "./DirectoryManagement";
import { insightsLink } from "../../insights/lib/navigation";
import PlayerFilters from "../../insights/PlayerFilters";
import { clearPlayerFilters, hasPlayerFilters } from "../../insights/lib/expandedQuery";
import type { ExpandedRequest } from "../../insights/lib/expandedQuery";
import type { ExpandedPlayer, InsightScope } from "../../insights/lib/expanded";
import { useWorkspaceMetrics } from "../lib/workspaceMetrics";
import { WorkspaceAttention, WorkspaceMetricCells, WorkspaceReportControls, WorkspaceReportDetails, WorkspaceReportTabs, WorkspaceScopeSummary } from "./WorkspaceReporting";
import type { WorkspaceMetricState, WorkspacePlayerMetric } from "./WorkspaceReporting";
import DirectoryNavigator, { TeamDirectory } from "./DirectoryNavigator";
import "./admin-directory.scss";

const tabs = [["players", "Players"], ["staff", "Staff"], ["teams", "Manage teams"], ["settings", "Organization settings"]] as const;
type ChooseDirectory = (patch: Partial<AdminDirectoryState>, replace?: boolean) => void;

/** Lookup and management are deliberately separate mounts from organization browsing. */
export default function MonitorAccounts({ source = directorySource }: { source?: DirectorySource }) {
  const { state: organizations, refresh } = useAccountLoad(source.organizations);
  const [query, setQuery] = useSearchParams();
  const state = parseAdminDirectoryState(query);
  const choose = (patch: Partial<AdminDirectoryState>, replace = false) => {
    const target = adminDirectoryPath({ ...state, ...patch });
    setQuery(new URLSearchParams(target.split("?")[1] || ""), { replace });
  };
  const selected = organizations.kind === "ready" ? organizations.data.find(org => org.id === state.orgId) : undefined;
  const available = organizations.kind === "ready" ? organizations.data : [];
  const navigateScope: ChooseDirectory = patch => choose(selectDirectoryScope(state, patch));
  const navigator = <DirectoryNavigator organizations={available} state={state} choose={navigateScope} pending={organizations.kind === "loading"} error={organizations.kind === "error" ? organizations.message : ""} retry={refresh} />;
  useEffect(() => { document.title = "People & organizations | PoseTek admin"; }, []);
  return <div className="admin-directory">
    <section className="admin-heading"><div><h1>People & organizations</h1><p>Choose an organization, then a team to review reporting and people.</p></div>
      <div className="admin-heading-actions"><button className="quiet-button" aria-label="Refresh organizations" onClick={refresh}>Refresh</button></div></section>
    <DirectoryTabs active={state.directoryTab} onChange={directoryTab => choose({ directoryTab, page: 1 })} />
    {selected && state.directoryTab === "players" ? <OrganizationPlayers key={selected.id} org={selected} organizations={available} state={state} choose={choose} navigateScope={navigateScope} source={source} /> : <DirectoryFrame navigator={navigator} state={state}>
        {state.orgId && organizations.kind === "ready" && !selected ? <p className="form-message" role="alert">That organization is no longer available. Choose a current organization.</p>
          : selected ? <>
            <div className="directory-scope-title"><h2>{selected.name}</h2>{selected.schemaVersion !== 2 && <span className="admin-chip">Legacy</span>}</div>
            {state.directoryTab === "staff" && <p className="admin-note">Staff access is organization-wide. Team assignments are shown for each coach; the Players team selection does not filter staff.</p>}
            {state.directoryTab !== "players" && selected.schemaVersion === 2 && <DirectoryManagement key={`${selected.id}:${state.directoryTab}`} org={selected} tab={state.directoryTab} state={state} choose={navigateScope} source={source} onOrganizationsChanged={refresh} />}
            {state.directoryTab !== "players" && selected.schemaVersion !== 2 && <LegacyStaff key={selected.id} organization={selected} source={source} state={state} />}
          </> : !state.orgId && <>
            {state.directoryTab === "players" && <PlayerLookup source={source} state={state} choose={choose} navigateScope={navigateScope} canonicalOrganizationIds={available.filter(org => org.schemaVersion === 2).map(org => org.id)} />}
            {state.directoryTab === "staff" && <IndependentStaff source={source} organizations={organizations.kind === "ready" ? organizations.data : []} state={state} />}
            {state.directoryTab === "teams" && <p className="admin-empty">Choose an organization to view its teams.</p>}
            {state.directoryTab === "settings" && <DirectoryManagement tab="settings" state={state} choose={navigateScope} source={source} onOrganizationsChanged={refresh} />}
          </>}
    </DirectoryFrame>}
      {tabs.filter(([id]) => id !== state.directoryTab).map(([id]) => <section key={id} id={`directory-panel-${id}`} role="tabpanel" aria-labelledby={`directory-tab-${id}`} hidden />)}
  </div>;
}

function DirectoryFrame({ navigator, state, children }: { navigator: ReactNode; state: AdminDirectoryState; children: ReactNode }) {
  return <div className="directory-layout">{navigator}<section className="directory-content" id={`directory-panel-${state.directoryTab}`} role="tabpanel" aria-labelledby={`directory-tab-${state.directoryTab}`}>{children}</section></div>;
}

/** In-page section jumps retain this mounted scope, its private reads and browser history. */
export function jumpToDirectorySection(event: Pick<MouseEvent<HTMLAnchorElement>, "preventDefault">, id: string) {
  event.preventDefault();
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: "start", behavior: "auto" });
  target?.focus({ preventScroll: true });
}

export function DirectoryTabs({ active, onChange }: { active: AdminDirectoryState["directoryTab"]; onChange(tab: AdminDirectoryState["directoryTab"]): void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="directory-tabs" role="tablist" aria-label="People and organization views">{tabs.map(([id, label], index) => <button key={id} type="button" ref={element => { buttons.current[index] = element; }}
    id={`directory-tab-${id}`} role="tab" aria-selected={active === id} aria-controls={`directory-panel-${id}`} tabIndex={active === id ? 0 : -1}
    onClick={() => onChange(id)} onKeyDown={event => {
      let next: number | undefined;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); buttons.current[next]?.focus(); }
    }}>{label}</button>)}</div>;
}

function OrganizationPlayers({ org, organizations, state, choose, navigateScope, source }: { org: OrganizationRow; organizations: OrganizationRow[]; state: AdminDirectoryState; choose: ChooseDirectory; navigateScope: ChooseDirectory; source: DirectorySource }) {
  const loader = useCallback(() => source.roster(org), [org, source]);
  const { state: loaded, refresh } = useAccountLoad(loader);
  const roster = loaded.kind === "ready" ? loaded.data : null;
  const identityScope = roster ? organizationPeopleScope(org, roster, state) : null;
  const team = identityScope?.team;
  const teamValid = identityScope?.valid ?? !state.teamId;
  const people = directoryLevelOf(state) === "people";
  const unassigned = identityScope?.unassigned || false;
  const selectedRows = identityScope?.players || [];
  const rows = directoryPlayers(selectedRows, state.search);
  const scope: InsightScope | null = org.schemaVersion !== 2 || !roster?.context || !teamValid ? null : state.teamId ? { kind: "team", organizationId: org.id, teamId: state.teamId } : { kind: "organization", organizationId: org.id };
  const navigator = <DirectoryNavigator organizations={organizations} state={state} choose={navigateScope} context={roster?.context} pending={loaded.kind === "loading"} />;
  return <DirectoryFrame navigator={navigator} state={state}>
    <div className="directory-scope-title"><h2>{teamValid && team ? team.name : org.name}</h2>{org.schemaVersion !== 2 && <span className="admin-chip">Legacy</span>}</div>
    {loaded.kind === "loading" && <p role="status">Loading organization and teams…</p>}
    {loaded.kind === "error" && <LoadError message={loaded.message} retry={refresh} />}
    {roster && !teamValid && <section className="directory-invalid-team" role="alert"><h2>Team unavailable</h2><p>This team is no longer available in {org.name}. No team reporting or people are shown.</p><button type="button" className="quiet-button" onClick={() => navigateScope({ teamId: undefined, directoryLevel: "teams" })}>Back to organization</button></section>}
    {roster && teamValid && <>{roster.notices.map(message => <p className="admin-note" role="status" key={message}>{message}</p>)}<PlayerReporting state={state} choose={choose} scope={scope} accountRows={people ? rows : undefined} roster={roster} accountCount={selectedRows.length} enabled legacy={org.schemaVersion !== 2} scopeLabel={identityScope?.label || org.name} showPeople={people}
    afterGraphs={!people && <TeamDirectory organization={org} context={roster.context} players={roster.players} choose={navigateScope} />}
    scopeControl={<div className="directory-graph-links"><button type="button" className="directory-text-button" onClick={() => navigateScope({ orgId: undefined, teamId: undefined, directoryLevel: "organizations" })}>Organizations</button>{people && <button type="button" className="directory-text-button" onClick={() => navigateScope({ teamId: undefined, directoryLevel: "teams" })}>Back to {org.name}</button>}</div>}
    toolbar={<div className="directory-toolbar"><label className="directory-search"><span>Find a player in this organization</span><input type="search" value={state.search} placeholder="Name or email" onChange={event => choose({ search: event.target.value, page: 1, reportMode: "directory" }, true)} /></label>
      <button className="quiet-button" aria-label="Refresh players" onClick={refresh}>Refresh roster</button>
    </div>}
    beforeRoster={unassigned && <p className="admin-note">The account roster shows unassigned or unavailable teams. Graphs use the unassigned reporting filter; each available account row retains its own recorded activity.</p>}
    afterRoster={org.schemaVersion === 2 && <DirectoryPlayerActions org={org} context={roster.context} currentTeamId={state.teamId} onChanged={refresh} />}
  /></>}</DirectoryFrame>;
}

/** Identity counts follow current context teams, including visible reporting-excluded accounts. */
export function organizationPeopleScope(org: OrganizationRow, roster: DirectoryRoster, state: AdminDirectoryState) {
  const teams = roster.context?.teams.filter(team => team.organizationId === org.id) || [];
  const team = teams.find(team => team.id === state.teamId), valid = !state.teamId || Boolean(team);
  const unassigned = !state.teamId && state.directoryLookup === "unassigned";
  const players = !valid ? [] : unassigned && roster.context ? roster.players.filter(player => !teams.some(team => team.id === player.teamId)) : directoryPlayers(roster.players, "", state.teamId);
  return { team, valid, unassigned, players, label: team?.name || (unassigned ? `Unassigned / unavailable team · ${org.name}` : org.name) };
}

export function DirectoryPlayersTable({ players, roster, state, choose, metrics, metricRows, serverPage = false }: { players: PlayerRow[]; roster?: DirectoryRoster; state: AdminDirectoryState; choose(patch: Partial<AdminDirectoryState>): void; metrics?: WorkspaceMetricState; metricRows?: WorkspacePlayerMetric[]; serverPage?: boolean }) {
  const page = directoryPage(players, state.page);
  const byId = new Map(metricRows?.map(row => [row.playerId, row]));
  return <>
    {players.length ? <table className={`directory-player-table${metrics ? " with-metrics" : ""}`}><thead><tr><th scope="col">Player</th><th scope="col">Team</th><th scope="col">Age</th>{metrics && <><th scope="col">Testing</th><th scope="col">Completed workouts</th><th scope="col">Estimated active use</th></>}<th scope="col">Open</th></tr></thead><tbody>{(serverPage ? players.slice(0, 20) : page.rows).map(player => {
      const age = resolvePlayerAge(player.raw), team = roster?.context?.teams.find(entry => entry.id === player.teamId);
      return <tr key={player.id}>
        <td data-label="Player"><Link id={`admin-player-${player.id}`} className="directory-player-name" to={adminPlayerPath(player.id, "results", state)}><strong>{player.name}</strong></Link>
          <span className="directory-player-email">{player.email || "No email on file"}</span>{player.registered ? <span className="directory-account-status">Account claimed</span> : <SignupStatus playerId={player.id} playerName={player.name} reloadKey={player} />}
        </td>
        <td data-label="Team">{team?.name || (player.teamId ? roster?.context ? "Team unavailable" : "Assigned team" : "Unassigned")}</td><td data-label="Age">{age.age === null ? "Not recorded" : `${age.age} years`}</td>
        {metrics && <WorkspaceMetricCells {...metrics} legacy={metrics.legacy || !hasClubIdentity(player)} metric={byId.get(player.id)} />}
        <td data-label="Open"><div className="directory-row-actions"><Link id={`admin-player-${player.id}-workouts`} className="quiet-button small" to={adminPlayerPath(player.id, "workouts", state)} aria-label={`Workouts for ${player.name}`}>Workouts</Link><Link id={`admin-player-${player.id}-profile`} className="quiet-button small" to={adminPlayerPath(player.id, "profile", state)} aria-label={`Profile for ${player.name}`}>Profile</Link></div></td>
      </tr>;
    })}</tbody></table> : <p className="admin-empty">{state.search ? "No players match this search." : "No players in this selection yet."}</p>}
    {!serverPage && page.totalPages > 1 && <nav className="directory-pagination" aria-label="Player pages"><button className="quiet-button" disabled={page.page === 1} onClick={() => choose({ page: page.page - 1 })}>Previous</button><span>Page {page.page} of {page.totalPages}</span><button className="quiet-button" disabled={page.page === page.totalPages} onClick={() => choose({ page: page.page + 1 })}>Next</button></nav>}
  </>;
}

function PlayerLookup({ source, state, choose, navigateScope, canonicalOrganizationIds }: { source: DirectorySource; state: AdminDirectoryState; choose: ChooseDirectory; navigateScope: ChooseDirectory; canonicalOrganizationIds: string[] }) {
  const people = directoryLevelOf(state) === "people";
  const unassigned = state.directoryLookup === "unassigned";
  const used = people && (state.search.trim().length >= 2 || unassigned);
  const loader = useCallback(async () => {
    if (!used) return null;
    const index = await source.lookup();
    if (!unassigned) return { ...index, organizations: [] as OrganizationRow[], coaches: [] as CoachRow[], teams: [] as Awaited<ReturnType<DirectorySource["teams"]>> };
    const [organizations, coaches, teams] = await Promise.all([source.organizations(), source.coaches(), source.teams()]);
    return { ...index, organizations, coaches, teams };
  }, [source, unassigned, used]);
  const { state: loaded, refresh } = useAccountLoad(loader);
  const index = used && loaded.kind === "ready" ? loaded.data : null;
  const rows = index ? unassigned ? unassignedDirectoryPlayers(index.players, index.organizations, index.coaches, index.teams) : directoryPlayers(index.players, state.search) : [];
  return <PlayerReporting state={state} choose={choose} scope={{ kind: "global" }} canonicalOrganizationIds={canonicalOrganizationIds} accountRows={used ? rows.slice(0, 40) : undefined} enabled scopeLabel="All current organizations" showPeople={people}
    afterGraphs={!people && <section className="directory-team-directory"><h3>Organizations</h3><p className="admin-note">Choose an organization in Browse to view its graphs and teams. Independent coaches are available in Staff.</p><button type="button" className="quiet-button" onClick={() => navigateScope({ orgId: undefined, teamId: undefined, directoryLevel: "people" })}>Find a player</button></section>}
    toolbar={<><h3 className="workspace-roster-heading">Find a player</h3><p className="admin-note">Browse an organization for its full roster, or use the bounded name/email lookup below.</p>
      <label className="directory-search"><span>Player lookup</span><input type="search" value={state.search} placeholder="Enter at least two characters" onChange={event => choose({ directoryLookup: undefined, search: event.target.value, page: 1, reportMode: "directory" }, true)} /></label>
      <button className="quiet-button directory-unassigned" aria-pressed={unassigned} onClick={() => choose({ directoryLookup: unassigned ? undefined : "unassigned", search: "", page: 1, reportMode: "directory" })}>Unassigned players in bounded lookup</button>
    </>}
    beforeRoster={<>{used && loaded.kind === "loading" && <p role="status">Loading player lookup…</p>}{used && loaded.kind === "error" && <LoadError message={loaded.message} retry={refresh} />}
      {index && <p className="admin-note" role="status">Global lookup covers the first {PLAYER_INDEX_LIMIT} player profiles and displays up to 40 matches. Organization browsing remains available beyond this index.{index.truncated && " More profiles exist outside this lookup."}</p>}
      {rows.length > 40 && <p className="admin-note">Showing the first 40 matches. Refine the name or email to narrow this lookup.</p>}
    </>}
  />;
}

/** One reporting reader and one roster per scope; history never substitutes for current account ownership. */
export function PlayerReporting({ state, choose, scope, canonicalOrganizationIds, accountRows, roster, accountCount, enabled, legacy = false, scopeLabel, scopeControl, toolbar, beforeRoster, afterRoster, afterGraphs, showPeople }: {
  state: AdminDirectoryState; choose: ChooseDirectory; scope: InsightScope | null; canonicalOrganizationIds?: string[]; accountRows?: PlayerRow[]; roster?: DirectoryRoster; accountCount?: number; enabled: boolean; legacy?: boolean; scopeLabel: string; scopeControl?: ReactNode; toolbar: ReactNode; beforeRoster?: ReactNode; afterRoster?: ReactNode; afterGraphs?: ReactNode; showPeople: boolean;
}) {
  const attention = state.reportMode === "attention", request = workspaceReportRequest(state);
  const visible = directoryPage(accountRows || [], state.page).rows;
  const playerIds = !showPeople || attention ? undefined : supportedWorkspacePlayerIds(visible, scope, canonicalOrganizationIds);
  const metrics = useWorkspaceMetrics({ scope, search: workspaceReportSearch(state), playerIds, enabled });
  const report = metrics.data;
  const focusReview = useRef(false);
  const update = (patch: Partial<ExpandedRequest>) => {
    const next = withWorkspaceReport(state, { ...patch, cursor: "", page: 0 });
    const filterChanged = ["division", "ageBand", "testingStatus", "workoutStatus", "usageStatus", "usagePlatform", "usageFeature", "teamAssignment", "rosterSearch"].some(key => key in patch);
    if (filterChanged) next.reportMode = hasPlayerFilters(workspaceReportRequest(next)) || Boolean(next.reportSearch) ? "attention" : "directory";
    if (filterChanged && patch.view) focusReview.current = true;
    choose(next);
  };
  const queueKey = showPeople && attention && scope?.kind === "global" && report ? JSON.stringify(report.players.slice(0, 20).map(player => ({ id: player.id, organizationId: player.organizationId, teamId: player.teamId }))) : "[]";
  const queueLoader = useCallback(async () => {
    const expected = JSON.parse(queueKey) as Pick<ExpandedPlayer, "id" | "organizationId" | "teamId">[];
    const profiles = await Promise.all(expected.map(player => loadPlayer(player.id)));
    return profiles.filter((player, index): player is PlayerRow => Boolean(player && hasClubIdentity(player) && (player.organizationId || "") === (expected[index].organizationId || "") && (player.teamId || null) === (expected[index].teamId || null)));
  }, [queueKey]);
  const { state: queueProfiles, refresh: refreshQueue } = useAccountLoad(queueLoader);
  const availableQueueProfiles = scope?.kind === "global" ? queueProfiles.kind === "ready" ? queueProfiles.data : [] : roster?.players || [];
  const queueById = new Map(availableQueueProfiles.map(player => [player.id, player]));
  const queue = report?.players.slice(0, 20).flatMap(expected => {
    const profile = queueById.get(expected.id);
    return profile && hasClubIdentity(profile) && (profile.organizationId || "") === (expected.organizationId || "") && (profile.teamId || null) === (expected.teamId || null) ? [profile] : [];
  }) || [];
  const metricRows: WorkspacePlayerMetric[] = attention ? report?.players.map(player => ({ playerId: player.id, status: "included", player })) || [] : report?.rosterMetrics || [];
  const metricState = { ...metrics, legacy };
  const view = state.reportView || "overview";
  const rosterDisplayed = showPeople && (attention ? Boolean(report) && (scope?.kind !== "global" || queueProfiles.kind === "ready") : accountRows !== undefined);
  useEffect(() => {
    if (attention && focusReview.current) { focusReview.current = false; document.getElementById("workspace-review-heading")?.focus({ preventScroll: true }); }
  }, [attention, view]);
  return <>
    {scopeControl}
    <WorkspaceReportControls request={request} disabled={legacy} onChange={update} />
    <WorkspaceScopeSummary {...metricState} accountCount={accountCount} scopeLabel={scopeLabel} request={request} />
    <p className="admin-note">{attention ? "Activity totals reflect reporting filters; queue name search changes only the player list." : "Name/email search and account pages change the player list, not organization/team summary totals."}</p>
    <p className="admin-note">Testing coverage is {request.testingWindow === "cumulative" ? "cumulative through the selected end date" : "limited to the selected period"}. Workouts and estimated use cover {request.startDate} through {request.endDate}, in {request.timezone.replaceAll("_", " ")}. Reporting follows current membership; excluded history and uncollected use remain distinct from zero.</p>
    {legacy && <p className="admin-note" role="status">Activity reporting is unavailable for this legacy organization. Its accounts and signup controls remain available below.</p>}
    <WorkspaceReportTabs active={view} onChange={reportView => choose({ reportView })} />
    <section id={`workspace-report-panel-${view}`} role="tabpanel" aria-labelledby={`workspace-report-tab-${view}`}>
      {metrics.loading && <p role="status">{metrics.rebuilding ? "Preparing the latest complete activity report…" : "Loading activity reporting…"}</p>}
      {metrics.error && <LoadError message={metrics.error} retry={() => { metrics.refresh(); refreshQueue(); }} />}
      <div id="directory-report-graphs" tabIndex={-1} role="region" aria-label="Report graphs">
        {report && <>{rosterDisplayed && <nav className="directory-graph-links" aria-label="Within this scope"><a href="#workspace-roster" onClick={event => jumpToDirectorySection(event, "workspace-roster")}>Jump to people</a></nav>}<WorkspaceReportDetails data={report} request={request} onChange={update} /></>}
      </div>
      {afterGraphs}
      {showPeople && <>
      <div className="directory-people-heading"><h3>People{state.teamId ? ` · ${scopeLabel}` : state.orgId ? state.directoryLookup === "unassigned" ? " · unassigned / unavailable team" : " · all teams" : " · player lookup"}</h3>{rosterDisplayed && <a href="#directory-report-graphs" className="directory-text-button" onClick={event => jumpToDirectorySection(event, "directory-report-graphs")}>Back to graphs</a>}</div>
      {report && view === "overview" && <WorkspaceAttention data={report} onChange={update} />}
      {attention && <><h3 id="workspace-review-heading" tabIndex={-1} className="workspace-roster-heading">{view[0].toUpperCase() + view.slice(1)} player review</h3><div className="workspace-queue-toolbar"><label className="directory-search"><span>Find in reporting queue · names only</span><input type="search" value={state.reportSearch || ""} placeholder="Player name" onChange={event => update({ rosterSearch: event.target.value })} /></label><button className="quiet-button" onClick={() => choose({ ...withWorkspaceReport(state, { ...clearPlayerFilters(), rosterSearch: "", cursor: "", page: 0 }), reportMode: "directory" })}>Back to account roster</button></div>{report && <p className="directory-result-count">{report.pagination.total} matching {report.pagination.total === 1 ? "player" : "players"} in this reporting queue{request.rosterSearch ? " · name search applied" : ""}</p>}</>}
      {attention && report && <div className="pt-insights"><PlayerFilters data={report} request={request} onChange={update} /></div>}
      {!attention && toolbar}
      {beforeRoster}
      <div id="workspace-roster" tabIndex={-1} role="region" aria-label="Player roster">
        {!attention && accountRows !== undefined && <><p className="directory-result-count">{accountRows.length} {accountRows.length === 1 ? "player" : "players"}{state.search && " matching your name or email search"}</p><DirectoryPlayersTable players={accountRows} roster={roster} state={state} choose={choose} metrics={metricState} metricRows={metricRows} /></>}
        {attention && report && <>
          {scope?.kind === "global" && queueProfiles.kind === "loading" && <p role="status">Checking current player accounts…</p>}
          {scope?.kind === "global" && queueProfiles.kind === "error" && <LoadError message={queueProfiles.message} retry={refreshQueue} />}
          {(scope?.kind !== "global" || queueProfiles.kind === "ready") && <>{queue.length !== report.players.length && <p className="admin-note" role="status">Some accounts in this report are no longer available in the current roster. Refresh the roster and report to check membership.</p>}
            <DirectoryPlayersTable players={queue} roster={roster} state={state} choose={choose} metrics={metricState} metricRows={metricRows} serverPage />
            <nav className="directory-pagination" aria-label="Reporting player pages"><button className="quiet-button" disabled={!request.page} onClick={() => choose({ reportCursor: undefined, reportPage: undefined })}>First page</button><span>{report.pagination.total} matching players · page {request.page + 1}</span><button className="quiet-button" disabled={!report.pagination.nextCursor} onClick={() => choose({ reportCursor: report.pagination.nextCursor || undefined, reportPage: request.page + 1 })}>Next</button></nav>
          </>}
        </>}
      </div>
      {!attention && afterRoster}
      </>}
    </section>
    {["overview", "testing", "workouts", "usage"].filter(id => id !== view).map(id => <section key={id} id={`workspace-report-panel-${id}`} role="tabpanel" aria-labelledby={`workspace-report-tab-${id}`} hidden />)}
  </>;
}

/** Canonical membership is required even when a legacy profile owns an organizationId field. */
export function supportedWorkspacePlayerIds(players: PlayerRow[], scope: InsightScope | null, canonicalOrganizationIds: string[] = []) {
  return players.slice(0, 20).filter(player => hasClubIdentity(player) && Boolean(player.organizationId)
    && (scope?.kind === "global" ? canonicalOrganizationIds.includes(player.organizationId!) : (scope?.kind === "organization" || scope?.kind === "team") && player.organizationId === scope.organizationId))
    .map(player => player.id);
}
function LegacyStaff({ organization, source, state }: { organization: OrganizationRow; source: DirectorySource; state: AdminDirectoryState }) {
  const { state: loaded, refresh } = useAccountLoad(source.coaches);
  if (loaded.kind === "loading") return <p role="status">Loading legacy coaches…</p>;
  if (loaded.kind === "error") return <LoadError message={loaded.message} retry={refresh} />;
  const groups = legacyCoachGroups([organization], loaded.data);
  return <><p className="admin-note">This legacy organization retains its existing coach relationships. Canonical team and staff controls apply to current club organizations.</p><CoachList coaches={groups.groups.get(organization.id) || []} state={state} /></>;
}
function IndependentStaff({ source, organizations, state }: { source: DirectorySource; organizations: OrganizationRow[]; state: AdminDirectoryState }) {
  const { state: loaded, refresh } = useAccountLoad(source.coaches);
  if (loaded.kind === "loading") return <p role="status">Loading independent coaches…</p>;
  if (loaded.kind === "error") return <LoadError message={loaded.message} retry={refresh} />;
  const groups = legacyCoachGroups(organizations, loaded.data);
  return <><h2>Independent coaches</h2><CoachList coaches={groups.independent} state={state} />
    {groups.unknown.length > 0 && <><h3>Accounts with an unavailable organization</h3><p className="admin-note">Their accounts remain available for review; their old roster does not grant current organization access.</p><CoachList coaches={groups.unknown} state={state} /></>}
    <Link className="quiet-button" to="/admin/access">PoseTek admin access & recovery</Link>
  </>;
}
function CoachList({ coaches, state }: { coaches: CoachRow[]; state: AdminDirectoryState }) {
  if (!coaches.length) return <p className="admin-empty">No coaches in this selection.</p>;
  return <div className="admin-rows">{coaches.map(coach => <Link key={coach.id} className="admin-row" to={directoryCoachPath(coach.id, state)}>
    <AccountAvatar name={coach.name} /><span className="admin-row-copy"><strong>{coach.name}</strong><span className="admin-row-meta">{coach.email || "No email on file"} · Legacy roster</span></span><span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></Link>)}</div>;
}

/** Retained for older embedded team roster consumers. Directory browsing no longer requires it. */
export function TeamRoster({ row, selected, choose }: { row: HierarchyTeam; selected: AccountContext; choose: (context: AccountContext) => void }) {
  const open = selected.teamId === row.team.id, context = { ...selected, orgId: row.team.organizationId, teamId: row.team.id };
  return <div className={`admin-team${open ? " open" : ""}`}><button type="button" className="admin-row admin-team-toggle" aria-expanded={open} onClick={() => choose({ ...context, teamId: open ? undefined : row.team.id })}><span className="material-symbols-outlined" aria-hidden="true">{open ? "expand_more" : "chevron_right"}</span><span className="admin-row-copy"><strong>{row.team.name}</strong><span className="admin-row-meta">{row.players.length} {row.players.length === 1 ? "athlete" : "athletes"} · {row.coaches.map(staffName).join(", ") || "No linked coach account"}</span></span></button>
    {open && <div className="admin-team-players"><Link className="quiet-button" to={insightsLink(context, "accounts")}>Team Insights</Link>{!row.players.length && <p className="admin-empty">No athletes on this team yet.</p>}{row.players.map(player => <PlayerRosterRow key={player.id} player={player} compact context={context} />)}</div>}</div>;
}
export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div><p className="form-message" role="alert">{message}</p><button className="quiet-button" onClick={retry}>Try again</button></div>;
}
