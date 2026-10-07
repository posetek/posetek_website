import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadPlayer, PLAYER_INDEX_LIMIT, resolvePlayerAge } from "../lib/accounts";
import type { CoachRow, OrganizationRow, PlayerRow } from "../lib/accounts";
import { hasClubIdentity, legacyCoachGroups, staffName } from "../lib/accountHierarchy";
import type { AccountContext, HierarchyTeam } from "../lib/accountHierarchy";
import { useAccountLoad } from "../lib/useAccountLoad";
import { directoryCoachPath, directoryPage, directoryPlayers, directorySource, unassignedDirectoryPlayers } from "../lib/adminDirectory";
import type { DirectoryRoster, DirectorySource } from "../lib/adminDirectory";
import { adminDirectoryPath, adminPlayerPath, parseAdminDirectoryState, withWorkspaceReport, workspaceReportRequest, workspaceReportSearch } from "../lib/adminNavigation";
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
import { WorkspaceAttention, WorkspaceMetricCells, WorkspaceReportControls, WorkspaceReportDetails, WorkspaceReportTabs, WorkspaceSummary } from "./WorkspaceReporting";
import type { WorkspaceMetricState, WorkspacePlayerMetric } from "./WorkspaceReporting";
import "./admin-directory.scss";

const tabs = [["players", "Players"], ["staff", "Staff"], ["teams", "Teams"], ["settings", "Organization settings"]] as const;
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
  useEffect(() => { document.title = "People & organizations | PoseTek admin"; }, []);
  return <div className="admin-directory">
    <section className="admin-heading"><div><h1>People & organizations</h1><p>Player activity, rosters and account management in one workspace.</p></div>
      <div className="admin-heading-actions"><button className="quiet-button" aria-label="Refresh organizations" onClick={refresh}>Refresh</button></div></section>
    <DirectoryTabs active={state.directoryTab} onChange={directoryTab => choose({ directoryTab, page: 1 })} />
    <div className="directory-layout">
      <aside className="directory-organizations" aria-label="Organization directory"><h2>Organizations</h2>
        {organizations.kind === "loading" && <p role="status">Loading organizations…</p>}
        {organizations.kind === "error" && <LoadError message={organizations.message} retry={refresh} />}
        {organizations.kind === "ready" && <>
          <div className="directory-organization-list">{organizations.data.map(org => <button type="button" key={org.id} aria-pressed={state.orgId === org.id}
            className={`directory-organization${state.orgId === org.id ? " selected" : ""}`} onClick={() => choose({ orgId: org.id, teamId: undefined, coachId: undefined, page: 1, search: "", directoryLookup: undefined, reportCursor: undefined, reportPage: undefined })}>
            {org.logoUrl ? <img src={org.logoUrl} alt="" /> : <AccountAvatar name={org.name} />}<span><strong>{org.name}</strong>{org.schemaVersion !== 2 && <small>Legacy organization</small>}</span>
          </button>)}</div>
          {!organizations.data.length && <p className="admin-empty">No organizations yet. Add one in Organization settings.</p>}
          <button className={`directory-organization directory-all${!state.orgId ? " selected" : ""}`} aria-pressed={!state.orgId}
            onClick={() => choose({ orgId: undefined, teamId: undefined, coachId: undefined, page: 1, search: "", directoryLookup: undefined, reportCursor: undefined, reportPage: undefined })}>
            <span className="material-symbols-outlined" aria-hidden="true">person_search</span><span><strong>All organizations & lookup</strong><small>Global reporting and independent accounts</small></span>
          </button>
        </>}
      </aside>
      <section className="directory-content" id={`directory-panel-${state.directoryTab}`} role="tabpanel" aria-labelledby={`directory-tab-${state.directoryTab}`}>
        {state.orgId && organizations.kind === "ready" && !selected ? <p className="form-message" role="alert">That organization is no longer available. Choose a current organization.</p>
          : selected ? <>
            <div className="directory-scope-title"><h2>{selected.name}</h2>{selected.schemaVersion !== 2 && <span className="admin-chip">Legacy</span>}</div>
            {state.directoryTab === "players" && <OrganizationPlayers key={selected.id} org={selected} state={state} choose={choose} source={source} />}
            {state.directoryTab !== "players" && selected.schemaVersion === 2 && <DirectoryManagement key={`${selected.id}:${state.directoryTab}`} org={selected} tab={state.directoryTab} state={state} choose={choose} source={source} onOrganizationsChanged={refresh} />}
            {state.directoryTab !== "players" && selected.schemaVersion !== 2 && <LegacyStaff key={selected.id} organization={selected} source={source} state={state} />}
          </> : !state.orgId && <>
            {state.directoryTab === "players" && <PlayerLookup source={source} state={state} choose={choose} canonicalOrganizationIds={organizations.kind === "ready" ? organizations.data.filter(org => org.schemaVersion === 2).map(org => org.id) : []} />}
            {state.directoryTab === "staff" && <IndependentStaff source={source} organizations={organizations.kind === "ready" ? organizations.data : []} state={state} />}
            {state.directoryTab === "teams" && <p className="admin-empty">Choose an organization to view its teams.</p>}
            {state.directoryTab === "settings" && <DirectoryManagement tab="settings" state={state} choose={choose} source={source} onOrganizationsChanged={refresh} />}
          </>}
      </section>
      {tabs.filter(([id]) => id !== state.directoryTab).map(([id]) => <section key={id} id={`directory-panel-${id}`} role="tabpanel" aria-labelledby={`directory-tab-${id}`} hidden />)}
    </div>
  </div>;
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

function OrganizationPlayers({ org, state, choose, source }: { org: OrganizationRow; state: AdminDirectoryState; choose: ChooseDirectory; source: DirectorySource }) {
  const loader = useCallback(() => source.roster(org), [org, source]);
  const { state: loaded, refresh } = useAccountLoad(loader);
  const roster = loaded.kind === "ready" ? loaded.data : null;
  const teamValid = !state.teamId || Boolean(roster?.context?.teams.some(team => team.id === state.teamId));
  const unassigned = state.directoryLookup === "unassigned";
  const selectedRows = roster ? unassigned && roster.context ? roster.players.filter(player => !roster.context!.teams.some(team => team.id === player.teamId)) : directoryPlayers(roster.players, "", teamValid ? state.teamId : undefined) : [];
  const rows = directoryPlayers(selectedRows, state.search);
  const scope: InsightScope | null = org.schemaVersion !== 2 || !roster?.context ? null : state.teamId && teamValid ? { kind: "team", organizationId: org.id, teamId: state.teamId } : { kind: "organization", organizationId: org.id };
  const refreshAll = () => { refresh(); };
  return <PlayerReporting state={state} choose={choose} scope={scope} accountRows={rows} roster={roster || undefined} accountCount={roster ? unassigned ? roster.players.length : selectedRows.length : undefined} enabled={Boolean(roster)} legacy={org.schemaVersion !== 2} scopeLabel={state.teamId && teamValid ? roster?.context?.teams.find(team => team.id === state.teamId)?.name || org.name : org.name}
    scopeControl={roster?.context && <div className="directory-toolbar"><label className="directory-team-filter">Team<select aria-label="Filter players by team" value={unassigned ? "__unassigned" : teamValid ? state.teamId || "" : ""} onChange={event => choose({ teamId: event.target.value === "__unassigned" ? undefined : event.target.value || undefined, directoryLookup: event.target.value === "__unassigned" ? "unassigned" : undefined, page: 1, reportCursor: undefined, reportPage: undefined })}><option value="">All teams</option><option value="__unassigned">Unassigned / unavailable team</option>{roster.context.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label></div>}
    toolbar={<div className="directory-toolbar"><label className="directory-search"><span>Find a player in this organization</span><input type="search" value={state.search} placeholder="Name or email" onChange={event => choose({ search: event.target.value, page: 1, reportMode: "directory" }, true)} /></label>
      <button className="quiet-button" aria-label="Refresh players" onClick={refreshAll}>Refresh roster</button>
    </div>}
    beforeRoster={<>{unassigned && <p className="admin-note">The account roster below shows unassigned or unavailable teams. Summary reporting covers the whole organization; each available row still shows its own activity.</p>}{loaded.kind === "loading" && <p role="status">Loading players…</p>}
    {loaded.kind === "error" && <LoadError message={loaded.message} retry={refresh} />}
    {roster && <>{roster.notices.map(message => <p className="admin-note" role="status" key={message}>{message}</p>)}
      {!teamValid && <p className="form-message" role="alert">The selected team is no longer in this organization. Showing all organization players. <button className="quiet-button small" onClick={() => choose({ teamId: undefined, page: 1 })}>Clear team filter</button></p>}
    </>}</>}
    afterRoster={org.schemaVersion === 2 && <DirectoryPlayerActions org={org} context={roster?.context || null} currentTeamId={teamValid ? state.teamId : undefined} denied={loaded.kind === "error" && /permission|access|denied|authorized/i.test(loaded.message)} onChanged={refresh} />}
  />;
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

function PlayerLookup({ source, state, choose, canonicalOrganizationIds }: { source: DirectorySource; state: AdminDirectoryState; choose: ChooseDirectory; canonicalOrganizationIds: string[] }) {
  const unassigned = state.directoryLookup === "unassigned";
  const used = state.search.trim().length >= 2 || unassigned;
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
  return <PlayerReporting state={state} choose={choose} scope={{ kind: "global" }} canonicalOrganizationIds={canonicalOrganizationIds} accountRows={used ? rows.slice(0, 40) : undefined} enabled scopeLabel="All current organizations"
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
function PlayerReporting({ state, choose, scope, canonicalOrganizationIds, accountRows, roster, accountCount, enabled, legacy = false, scopeLabel, scopeControl, toolbar, beforeRoster, afterRoster }: {
  state: AdminDirectoryState; choose: ChooseDirectory; scope: InsightScope | null; canonicalOrganizationIds?: string[]; accountRows?: PlayerRow[]; roster?: DirectoryRoster; accountCount?: number; enabled: boolean; legacy?: boolean; scopeLabel: string; scopeControl?: ReactNode; toolbar: ReactNode; beforeRoster?: ReactNode; afterRoster?: ReactNode;
}) {
  const attention = state.reportMode === "attention", request = workspaceReportRequest(state);
  const visible = directoryPage(accountRows || [], state.page).rows;
  const playerIds = attention ? undefined : supportedWorkspacePlayerIds(visible, scope, canonicalOrganizationIds);
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
  const queueKey = attention && scope?.kind === "global" && report ? JSON.stringify(report.players.slice(0, 20).map(player => ({ id: player.id, organizationId: player.organizationId, teamId: player.teamId }))) : "[]";
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
  useEffect(() => {
    if (attention && focusReview.current) { focusReview.current = false; document.getElementById("workspace-review-heading")?.focus({ preventScroll: true }); }
  }, [attention, view]);
  return <>
    {scopeControl}
    <WorkspaceReportControls request={request} disabled={legacy} onChange={update} />
    <WorkspaceSummary {...metricState} accountCount={attention ? undefined : accountCount} scopeLabel={scopeLabel} request={request} />
    <p className="admin-note">{attention ? "Activity totals reflect reporting filters; queue name search changes only the player list." : "Name/email search and account pages change the player list, not organization/team summary totals."}</p>
    <p className="admin-note">Testing coverage is {request.testingWindow === "cumulative" ? "cumulative through the selected end date" : "limited to the selected period"}. Workouts and estimated use cover {request.startDate} through {request.endDate}, in {request.timezone.replaceAll("_", " ")}. Reporting follows current membership; excluded history and uncollected use remain distinct from zero.</p>
    {legacy && <p className="admin-note" role="status">Activity reporting is unavailable for this legacy organization. Its accounts and signup controls remain available below.</p>}
    <WorkspaceReportTabs active={view} onChange={reportView => choose({ reportView })} />
    <section id={`workspace-report-panel-${view}`} role="tabpanel" aria-labelledby={`workspace-report-tab-${view}`}>
      {metrics.loading && <p role="status">{metrics.rebuilding ? "Preparing the latest complete activity report…" : "Loading activity reporting…"}</p>}
      {metrics.error && <LoadError message={metrics.error} retry={() => { metrics.refresh(); refreshQueue(); }} />}
      {report && view === "overview" && <WorkspaceAttention data={report} onChange={update} />}
      {attention && <><h3 id="workspace-review-heading" tabIndex={-1} className="workspace-roster-heading">{view[0].toUpperCase() + view.slice(1)} player review</h3><div className="workspace-queue-toolbar"><label className="directory-search"><span>Find in reporting queue · names only</span><input type="search" value={state.reportSearch || ""} placeholder="Player name" onChange={event => update({ rosterSearch: event.target.value })} /></label><button className="quiet-button" onClick={() => choose({ ...withWorkspaceReport(state, { ...clearPlayerFilters(), rosterSearch: "", cursor: "", page: 0 }), reportMode: "directory" })}>Back to account roster</button></div>{report && <p className="directory-result-count">{report.pagination.total} matching {report.pagination.total === 1 ? "player" : "players"} in this reporting queue{request.rosterSearch ? " · name search applied" : ""}</p>}</>}
      {attention && report && <div className="pt-insights"><PlayerFilters data={report} request={request} onChange={update} /></div>}
      {!attention && toolbar}
      {beforeRoster}
      <div id="workspace-roster">
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
      {report && <WorkspaceReportDetails data={report} request={request} onChange={update} />}
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
