import { useEffect, useState } from "react";
import type { ClubContext } from "../../../lib/organization-data";
import type { OrganizationRow, PlayerRow } from "../lib/accounts";
import type { AdminDirectoryState } from "../lib/adminNavigation";
import { directoryLevelOf } from "../lib/adminNavigation";
import { staffName } from "../lib/accountHierarchy";
import "./directory-navigator.scss";

type Choose = (patch: Partial<AdminDirectoryState>) => void;

export function directoryOrganizationPatch(state: AdminDirectoryState, orgId?: string): Partial<AdminDirectoryState> {
  return { orgId, teamId: undefined, coachId: undefined, directoryLevel: orgId ? "teams" : "organizations", directoryTab: state.directoryTab };
}

/** Scope navigation contains no report or membership readers of its own. */
export default function DirectoryNavigator({ organizations, state, choose, context, pending = false, error = "", retry }: {
  organizations: OrganizationRow[]; state: AdminDirectoryState; choose: Choose; context?: ClubContext | null; pending?: boolean; error?: string; retry?(): void;
}) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 761px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 761px)"), changed = () => setOpen(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const organization = organizations.find(org => org.id === state.orgId), team = context?.teams.find(row => row.id === state.teamId);
  const level = directoryLevelOf(state), people = state.directoryTab === "players" && level === "people", unassigned = state.directoryLookup === "unassigned";
  const current = organization ? people && state.teamId ? team?.name || "Team unavailable" : people ? unassigned ? "Unassigned / unavailable team" : "All teams" : organization.name : level === "people" ? "Player lookup" : "Organizations";
  const selectOrganization = (orgId?: string) => { choose(directoryOrganizationPatch(state, orgId)); if (window.innerWidth <= 760) setOpen(false); };
  const selectTeam = (teamId?: string) => { choose({ orgId: organization?.id, teamId, coachId: undefined, directoryLevel: "people", directoryTab: "players" }); if (window.innerWidth <= 760) setOpen(false); };
  return <aside className="directory-navigator" aria-label="Organization and team navigation"><details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><small>Browse</small><strong>{current}</strong></span><span className="material-symbols-outlined" aria-hidden="true">expand_more</span></summary>
    <nav aria-label="Organization hierarchy"><button type="button" className={`directory-nav-root${!state.orgId && level === "organizations" ? " selected" : ""}`} aria-current={!state.orgId && level === "organizations" ? "page" : undefined} onClick={() => selectOrganization()}>All organizations</button>
      {pending && !organizations.length && <p role="status">Loading organizations…</p>}
      {error && <><p className="admin-note" role="alert">{error}</p>{retry && <button type="button" className="quiet-button" onClick={retry}>Retry organizations</button>}</>}
      <ul className="directory-nav-organizations">{organizations.map(org => <li key={org.id}>
        <button type="button" className={`directory-nav-org${state.orgId === org.id ? " selected" : ""}`} aria-current={state.orgId === org.id && !people ? "page" : undefined} onClick={() => selectOrganization(org.id)}>{org.logoUrl ? <img src={org.logoUrl} alt="" /> : <span className="material-symbols-outlined" aria-hidden="true">domain</span>}<span>{org.name}{org.schemaVersion !== 2 && <small>Legacy organization</small>}</span></button>
        {state.orgId === org.id && state.directoryTab === "players" && <ul className="directory-nav-teams"><li><button type="button" className={!state.teamId && !unassigned && people ? "selected" : ""} aria-current={!state.teamId && !unassigned && people ? "page" : undefined} onClick={() => selectTeam()}>{org.schemaVersion === 2 ? "All teams · people" : "Legacy roster · people"}</button></li>
          {org.schemaVersion === 2 && <li><button type="button" className={!state.teamId && unassigned && people ? "selected" : ""} aria-current={!state.teamId && unassigned && people ? "page" : undefined} onClick={() => { choose({ orgId: organization?.id, teamId: undefined, coachId: undefined, directoryLevel: "people", directoryLookup: "unassigned", directoryTab: "players" }); if (window.innerWidth <= 760) setOpen(false); }}>Unassigned / unavailable team</button></li>}
          {context?.teams.filter(row => row.organizationId === org.id).map(row => <li key={row.id}><button type="button" className={state.teamId === row.id && people ? "selected" : ""} aria-current={state.teamId === row.id && people ? "page" : undefined} onClick={() => selectTeam(row.id)}><span className="material-symbols-outlined" aria-hidden="true">groups</span>{row.name}</button></li>)}
          {pending && <li><p role="status">Loading teams…</p></li>}
        </ul>}
      </li>)}</ul>
      {!organizations.length && !pending && !error && <p className="admin-note">No organizations yet. Add one in Organization settings.</p>}
      <button type="button" className={`directory-nav-lookup${!state.orgId && level === "people" ? " selected" : ""}`} aria-current={!state.orgId && level === "people" ? "page" : undefined} onClick={() => { choose({ orgId: undefined, teamId: undefined, coachId: undefined, directoryLevel: "people", directoryTab: "players" }); if (window.innerWidth <= 760) setOpen(false); }}>Player lookup & unassigned accounts</button>
    </nav>
  </details></aside>;
}

/** Teams are a navigation destination, separate from membership-management forms. */
export function TeamDirectory({ organization, context, players, choose }: { organization: OrganizationRow; context: ClubContext | null; players: PlayerRow[]; choose: Choose }) {
  const teams = context?.teams.filter(team => team.organizationId === organization.id) || [];
  return <section className="directory-team-directory" aria-labelledby="directory-teams-heading"><div className="directory-team-directory-heading"><div><h3 id="directory-teams-heading">Teams in {organization.name}</h3><p className="admin-note">Choose a team to view its reporting and people.</p></div><div className="directory-row-actions"><button type="button" className="quiet-button" onClick={() => choose({ teamId: undefined, coachId: undefined, directoryLevel: "people", directoryTab: "players" })}>{organization.schemaVersion === 2 ? "All teams" : "View legacy roster"}</button>{organization.schemaVersion === 2 && <button type="button" className="quiet-button" onClick={() => choose({ teamId: undefined, coachId: undefined, directoryLevel: "people", directoryLookup: "unassigned", directoryTab: "players" })}>Unassigned / unavailable team</button>}</div></div>
    {organization.schemaVersion !== 2 ? <p className="admin-note">This legacy organization has no canonical team directory. Its existing player and coach relationships remain available in the legacy roster.</p> : teams.length ? <div className="directory-team-cards">{teams.map(team => {
      const count = players.filter(player => player.organizationId === organization.id && player.teamId === team.id).length;
      return <button type="button" key={team.id} className="directory-team-card" onClick={() => choose({ teamId: team.id, coachId: undefined, directoryLevel: "people", directoryTab: "players" })}><span className="directory-team-card-heading"><strong>{team.name}</strong><span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></span><span>{count} {count === 1 ? "player" : "players"}</span><small>{context!.staff.filter(member => member.role === "coach" && member.status === "active" && member.teamIds.includes(team.id)).map(staffName).join(", ") || "No active coach assigned"}</small></button>;
    })}</div> : <p className="admin-empty">No teams yet. Add one in Manage teams, or choose All teams to review unassigned players.</p>}
  </section>;
}
