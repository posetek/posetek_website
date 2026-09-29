/** Compatibility routes converge on one workspace without dropping deep-link context. */
export function coachWorkspacePath(search = "", patch: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams(search);
  const team = query.get("teamId") || query.get("team");
  const player = query.get("playerId") || query.get("athlete");
  if (team) query.set("teamId", team);
  if (player) { query.set("playerId", player); query.set("view", "player"); }
  for (const key of ["team", "athlete", "userType", "from", "returnTo"]) query.delete(key);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) query.delete(key); else query.set(key, value);
  }
  return `/insights${query.size ? `?${query}` : ""}`;
}

/** Planner returns are local workspace URLs, never arbitrary redirects. */
export function coachPlannerReturn(search: string) {
  const params = new URLSearchParams(search), target = params.get("returnTo");
  if (target?.startsWith("/insights?") || target === "/insights") {
    const parsed = new URL(target, "https://posetek.net");
    if (parsed.origin === "https://posetek.net" && parsed.pathname === "/insights") return parsed.pathname + parsed.search;
  }
  return coachWorkspacePath("", { orgId: params.get("orgId") || undefined, teamId: params.get("teamId") || undefined });
}
