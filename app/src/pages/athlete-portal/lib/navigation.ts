import { accountContext, accountPlayerPath, accountQuery, accountReturnPath } from "../../admin/lib/accountHierarchy";
import type { Access } from "./loaders";
import { validatedAdminReturn } from "../../admin/lib/adminNavigation";

type AthleteNavigationFields = { id?: string; organizationId?: unknown; teamId?: unknown };

function currentContext(athlete: AthleteNavigationFields | null) {
  const orgId = typeof athlete?.organizationId === "string" && athlete.organizationId ? athlete.organizationId : undefined;
  const teamId = orgId && typeof athlete?.teamId === "string" && athlete.teamId ? athlete.teamId : undefined;
  return { orgId, teamId };
}

/** Called with a player returned by the authorized organization context. */
export function organizationPlayerPath(player: AthleteNavigationFields & { id: string }, admin = false) {
  const context = currentContext(player);
  if (admin) return accountPlayerPath(player.id, context);
  return `/athlete?player=${encodeURIComponent(player.id)}${accountQuery(context).replace(/^\?/, "&")}`;
}

/** Return scope comes from the authorized profile, never the incoming org/team hints. */
export function athleteRosterNavigation(access: Access | null, athlete: AthleteNavigationFields | null, search = "") {
  const context = currentContext(athlete);
  if (access === "admin") {
    const back = validatedAdminReturn(new URLSearchParams(search).get("returnTo"));
    if (back) return { to: back, label: "Back to player" };
    const prior = accountContext(search);
    const coachId = (prior.orgId ?? "") === (context.orgId ?? "") ? prior.coachId : undefined;
    return { to: accountReturnPath({ ...context, coachId }), label: "Accounts" };
  }
  if (context.orgId && (access === "manager" || access === "coach")) {
    return { to: `/organization${accountQuery(context)}`, label: "Organization" };
  }
  // Independent legacy coaches retain their published roster route.
  return { to: typeof athlete?.teamId === "string" && athlete.teamId
    ? `/roster?team=${encodeURIComponent(athlete.teamId)}` : "/roster?userType=coach", label: "Roster" };
}
