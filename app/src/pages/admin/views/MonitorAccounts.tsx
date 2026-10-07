import { useCallback, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PLAYER_INDEX_LIMIT, resolvePlayerAge } from "../lib/accounts";
import type { CoachRow, OrganizationRow, PlayerRow } from "../lib/accounts";
import { legacyCoachGroups, staffName } from "../lib/accountHierarchy";
import type { AccountContext, HierarchyTeam } from "../lib/accountHierarchy";
import { useAccountLoad } from "../lib/useAccountLoad";
import { directoryCoachPath, directoryPage, directoryPlayers, directorySource, unassignedDirectoryPlayers } from "../lib/adminDirectory";
import type { DirectoryRoster, DirectorySource } from "../lib/adminDirectory";
import { adminDirectoryPath, adminPlayerPath, parseAdminDirectoryState } from "../lib/adminNavigation";
import type { AdminDirectoryState } from "../lib/adminNavigation";
import PlayerRosterRow, { AccountAvatar } from "./PlayerRosterRow";
import SignupStatus from "./SignupStatus";
import DirectoryManagement, { DirectoryPlayerActions } from "./DirectoryManagement";
import { insightsLink } from "../../insights/lib/navigation";
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
    <section className="admin-heading"><div><h1>People & organizations</h1><p>Choose an organization to open its players, teams and staff.</p></div>
      <div className="admin-heading-actions"><button className="quiet-button" aria-label="Refresh organizations" onClick={refresh}>Refresh</button></div></section>
    <DirectoryTabs active={state.directoryTab} onChange={directoryTab => choose({ directoryTab, page: 1 })} />
    <div className="directory-layout">
      <aside className="directory-organizations" aria-label="Organization directory"><h2>Organizations</h2>
        {organizations.kind === "loading" && <p role="status">Loading organizations…</p>}
        {organizations.kind === "error" && <LoadError message={organizations.message} retry={refresh} />}
        {organizations.kind === "ready" && <>
          <div className="directory-organization-list">{organizations.data.map(org => <button type="button" key={org.id} aria-pressed={state.orgId === org.id}
            className={`directory-organization${state.orgId === org.id ? " selected" : ""}`} onClick={() => choose({ orgId: org.id, teamId: undefined, coachId: undefined, page: 1, search: "", directoryLookup: undefined })}>
            {org.logoUrl ? <img src={org.logoUrl} alt="" /> : <AccountAvatar name={org.name} />}<span><strong>{org.name}</strong>{org.schemaVersion !== 2 && <small>Legacy organization</small>}</span>
          </button>)}</div>
          {!organizations.data.length && <p className="admin-empty">No organizations yet. Add one in Organization settings.</p>}
          <button className={`directory-organization directory-all${!state.orgId ? " selected" : ""}`} aria-pressed={!state.orgId}
            onClick={() => choose({ orgId: undefined, teamId: undefined, coachId: undefined, page: 1, search: "", directoryLookup: undefined })}>
            <span className="material-symbols-outlined" aria-hidden="true">person_search</span><span><strong>Other accounts & lookup</strong><small>Independent coaches and player lookup</small></span>
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
            {state.directoryTab === "players" && <PlayerLookup source={source} state={state} choose={choose} />}
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
  const rows = roster ? directoryPlayers(unassigned && roster.context ? roster.players.filter(player => !roster.context!.teams.some(team => team.id === player.teamId)) : roster.players, state.search, !unassigned && teamValid ? state.teamId : undefined) : [];
  return <>
    <div className="directory-toolbar"><label className="directory-search"><span>Find a player in this organization</span><input type="search" value={state.search} placeholder="Name or email" onChange={event => choose({ search: event.target.value, page: 1 }, true)} /></label>
      {roster?.context && <label className="directory-team-filter">Team<select aria-label="Filter players by team" value={unassigned ? "__unassigned" : teamValid ? state.teamId || "" : ""} onChange={event => choose({ teamId: event.target.value === "__unassigned" ? undefined : event.target.value || undefined, directoryLookup: event.target.value === "__unassigned" ? "unassigned" : undefined, page: 1 })}><option value="">All teams</option><option value="__unassigned">Unassigned / unavailable team</option>{roster.context.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      <button className="quiet-button" aria-label="Refresh players" onClick={refresh}>Refresh</button>
    </div>
    {loaded.kind === "loading" && <p role="status">Loading players…</p>}
    {loaded.kind === "error" && <LoadError message={loaded.message} retry={refresh} />}
    {roster && <>{roster.notices.map(message => <p className="admin-note" role="status" key={message}>{message}</p>)}
      {!teamValid && <p className="form-message" role="alert">The selected team is no longer in this organization. Showing all organization players. <button className="quiet-button small" onClick={() => choose({ teamId: undefined, page: 1 })}>Clear team filter</button></p>}
      <p className="directory-result-count">{rows.length} {rows.length === 1 ? "player" : "players"}{state.search && " matching your search"}</p>
      <DirectoryPlayersTable players={rows} roster={roster} state={state} choose={choose} />
    </>}
    {org.schemaVersion === 2 && <DirectoryPlayerActions org={org} context={roster?.context || null} currentTeamId={state.teamId} denied={loaded.kind === "error" && /permission|access|denied|authorized/i.test(loaded.message)} onChanged={refresh} />}
  </>;
}

export function DirectoryPlayersTable({ players, roster, state, choose }: { players: PlayerRow[]; roster?: DirectoryRoster; state: AdminDirectoryState; choose(patch: Partial<AdminDirectoryState>): void }) {
  const page = directoryPage(players, state.page);
  return <>
    {players.length ? <table className="directory-player-table"><thead><tr><th scope="col">Player</th><th scope="col">Team</th><th scope="col">Age</th><th scope="col">Open</th></tr></thead><tbody>{page.rows.map(player => {
      const age = resolvePlayerAge(player.raw), team = roster?.context?.teams.find(entry => entry.id === player.teamId);
      return <tr key={player.id}>
        <td data-label="Player"><Link id={`admin-player-${player.id}`} className="directory-player-name" to={adminPlayerPath(player.id, "results", state)}><strong>{player.name}</strong></Link>
          <span className="directory-player-email">{player.email || "No email on file"}</span>{player.registered ? <span className="directory-account-status">Account claimed</span> : <SignupStatus playerId={player.id} playerName={player.name} reloadKey={player} />}
        </td>
        <td data-label="Team">{team?.name || (player.teamId ? roster?.context ? "Team unavailable" : "Assigned team" : "Unassigned")}</td><td data-label="Age">{age.age === null ? "Not recorded" : `${age.age} years`}</td>
        <td data-label="Open"><div className="directory-row-actions"><Link id={`admin-player-${player.id}-workouts`} className="quiet-button small" to={adminPlayerPath(player.id, "workouts", state)} aria-label={`Workouts for ${player.name}`}>Workouts</Link><Link id={`admin-player-${player.id}-profile`} className="quiet-button small" to={adminPlayerPath(player.id, "profile", state)} aria-label={`Profile for ${player.name}`}>Profile</Link></div></td>
      </tr>;
    })}</tbody></table> : <p className="admin-empty">{state.search ? "No players match this search." : "No players in this selection yet."}</p>}
    {page.totalPages > 1 && <nav className="directory-pagination" aria-label="Player pages"><button className="quiet-button" disabled={page.page === 1} onClick={() => choose({ page: page.page - 1 })}>Previous</button><span>Page {page.page} of {page.totalPages}</span><button className="quiet-button" disabled={page.page === page.totalPages} onClick={() => choose({ page: page.page + 1 })}>Next</button></nav>}
  </>;
}

function PlayerLookup({ source, state, choose }: { source: DirectorySource; state: AdminDirectoryState; choose: ChooseDirectory }) {
  const unassigned = state.directoryLookup === "unassigned";
  const used = state.search.trim().length >= 2 || unassigned;
  return <><h2>Find a player</h2><p className="admin-note">Browse an organization for its full roster, or use the bounded name/email lookup below.</p>
    <label className="directory-search"><span>Player lookup</span><input type="search" value={state.search} placeholder="Enter at least two characters" onChange={event => choose({ directoryLookup: undefined, search: event.target.value, page: 1 }, true)} /></label>
    <button className="quiet-button directory-unassigned" aria-pressed={unassigned} onClick={() => choose({ directoryLookup: unassigned ? undefined : "unassigned", search: "", page: 1 })}>Unassigned players in bounded lookup</button>
    {used && <LookupMatches source={source} state={state} choose={choose} unassigned={unassigned} />}
  </>;
}
function LookupMatches({ source, state, choose, unassigned }: { source: DirectorySource; state: AdminDirectoryState; choose(patch: Partial<AdminDirectoryState>): void; unassigned: boolean }) {
  const loader = useCallback(async () => {
    const index = await source.lookup();
    if (!unassigned) return { ...index, organizations: [] as OrganizationRow[], coaches: [] as CoachRow[], teams: [] as Awaited<ReturnType<DirectorySource["teams"]>> };
    const [organizations, coaches, teams] = await Promise.all([source.organizations(), source.coaches(), source.teams()]);
    return { ...index, organizations, coaches, teams };
  }, [source, unassigned]);
  const { state: loaded, refresh } = useAccountLoad(loader);
  if (loaded.kind === "loading") return <p role="status">Loading player lookup…</p>;
  if (loaded.kind === "error") return <LoadError message={loaded.message} retry={refresh} />;
  const rows = unassigned ? unassignedDirectoryPlayers(loaded.data.players, loaded.data.organizations, loaded.data.coaches, loaded.data.teams)
    : directoryPlayers(loaded.data.players, state.search);
  return <><p className="admin-note" role="status">Global lookup covers the first {PLAYER_INDEX_LIMIT} player profiles and displays up to 40 matches. Organization browsing remains available beyond this index.{loaded.data.truncated && " More profiles exist outside this lookup."}</p>
    {rows.length > 40 && <p className="admin-note">Showing the first 40 matches. Refine the name or email to narrow this lookup.</p>}
    <DirectoryPlayersTable players={rows.slice(0, 40)} state={state} choose={choose} />
  </>;
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
