import { loadClubAccountData, loadCoaches, loadOrganizations, loadPlayerIndex, loadTeams } from "./accounts";
import type { CoachRow, OrganizationRow, PlayerRow, TeamRow } from "./accounts";
import { hasClubIdentity } from "./accountHierarchy";
import type { ClubContext } from "../../../lib/organization-data";
import { getClubContext } from "../../../lib/organization-data";
import { adminDirectoryPath, directoryQuery } from "./adminNavigation";
import type { AdminDirectoryState } from "./adminNavigation";
import { legacyOrganizationPlayers } from "./plannerScope";

export const DIRECTORY_PAGE_SIZE = 20;
export interface DirectoryRoster {
  players: PlayerRow[];
  context: ClubContext | null;
  notices: string[];
}

/** A selected roster never depends on the incomplete global lookup index. */
export async function loadDirectoryRoster(organization: OrganizationRow): Promise<DirectoryRoster> {
  if (organization.schemaVersion === 2) {
    const { context, hierarchy } = await loadClubAccountData(organization.id);
    return { players: hierarchy.players, context, notices: hierarchy.limits };
  }
  const roster = await legacyOrganizationPlayers(organization, [organization]);
  return { players: roster.players.filter(player => !hasClubIdentity(player)), context: null,
    notices: ["Legacy organization: players follow their existing organization and coach relationships.",
      ...(roster.limited ? ["Showing up to 2,000 players in this legacy organization. Contact PoseTek if an athlete is missing."] : [])] };
}

export async function loadDirectoryContext(organizationId: string): Promise<ClubContext> {
  const context = await getClubContext(organizationId);
  if (context.role !== "admin" || context.organization?.id !== organizationId) {
    throw new Error("PoseTek admin access to this organization is required.");
  }
  return context;
}

export function directoryPlayers(players: PlayerRow[], search: string, teamId?: string) {
  const needle = search.trim().toLowerCase();
  return players.filter(player => (!teamId || (teamId === "unassigned" ? !player.teamId : player.teamId === teamId))
    && (!needle || `${player.name} ${player.email}`.toLowerCase().includes(needle)));
}

export function directoryPage<T>(rows: T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / DIRECTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { page, totalPages, rows: rows.slice((page - 1) * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE) };
}

export function unassignedDirectoryPlayers(players: PlayerRow[], organizations: OrganizationRow[], coaches: CoachRow[], teams: TeamRow[]) {
  return players.filter(player => hasClubIdentity(player)
    ? !organizations.some(org => org.schemaVersion === 2 && org.id === player.organizationId)
      || !teams.some(team => team.organizationId === player.organizationId && team.id === player.teamId)
    : !coaches.some(coach => coach.members.includes(player.id) || coach.id === player.coachId || coach.userUID === player.coachId));
}

export function directoryCoachPath(coachId: string, state: AdminDirectoryState) {
  const query = directoryQuery(state);
  query.set("returnTo", adminDirectoryPath(state));
  return `/admin/accounts/coach/${encodeURIComponent(coachId)}?${query}`;
}

export const directorySource = {
  organizations: loadOrganizations,
  roster: loadDirectoryRoster,
  context: loadDirectoryContext,
  coaches: loadCoaches,
  teams: loadTeams,
  lookup: loadPlayerIndex,
};
export type DirectorySource = typeof directorySource;
