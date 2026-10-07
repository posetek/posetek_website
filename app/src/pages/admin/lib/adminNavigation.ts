import { accountContext, accountQuery } from "./accountHierarchy";
import type { AccountContext } from "./accountHierarchy";

export const DIRECTORY_TABS = ["players", "staff", "teams", "settings"] as const;
export type DirectoryTab = typeof DIRECTORY_TABS[number];
export type PlayerPanel = "results" | "workouts" | "profile" | "ai-incidents";
export interface AdminDirectoryState {
  orgId?: string; teamId?: string; coachId?: string;
  directoryTab: DirectoryTab; search: string; page: number;
  returnTo?: string; preview?: boolean; directoryLookup?: "all" | "unassigned";
}
const queryOf = (search: string | URLSearchParams) => typeof search === "string" ? new URLSearchParams(search) : search;
export function parseAdminDirectoryState(search: string | URLSearchParams): AdminDirectoryState {
  const query = queryOf(search), tab = query.get("directoryTab");
  return { ...accountContext(query), directoryTab: DIRECTORY_TABS.includes(tab as DirectoryTab) ? tab as DirectoryTab : "players",
    search: (query.get("search") || "").slice(0, 120), page: Math.min(1000, Math.max(0, Math.floor(Number(query.get("page")) || 0))),
    ...(validatedAdminReturn(query.get("returnTo")) ? { returnTo: validatedAdminReturn(query.get("returnTo")) } : {}),
    ...(query.get("preview") === "1" ? { preview: true } : {}),
    ...(["all", "unassigned"].includes(query.get("directoryLookup") || "") ? { directoryLookup: query.get("directoryLookup") as "all" | "unassigned" } : {}) };
}
export function directoryQuery(state: Partial<AdminDirectoryState> = {}): URLSearchParams {
  const query = new URLSearchParams(accountQuery(state));
  if (state.directoryTab && state.directoryTab !== "players") query.set("directoryTab", state.directoryTab);
  if (state.search) query.set("search", state.search.slice(0, 120));
  if (state.page && Number.isFinite(state.page)) query.set("page", String(Math.min(1000, Math.max(0, Math.floor(state.page)))));
  if (state.preview) query.set("preview", "1");
  if (state.directoryLookup) query.set("directoryLookup", state.directoryLookup);
  return query;
}
const pathQuery = (path: string, query: URLSearchParams) => `${path}${query.size ? `?${query}` : ""}`;
export function adminDirectoryPath(state: Partial<AdminDirectoryState> = {}): string { return pathQuery("/admin/accounts", directoryQuery(state)); }

// Return destinations are known local tools, with at most one nested origin.
export function validatedAdminReturn(value: unknown, depth = 0): string | undefined {
  // eslint-disable-next-line no-control-regex -- Reject control bytes in navigation destinations.
  if (typeof value !== "string" || value.length > 8000 || !value.startsWith("/admin") || /[\\\u0000-\u001f\u007f]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(value)) return;
  try {
    const url = new URL(value, "https://posetek.net");
    if (url.origin !== "https://posetek.net" || !/^\/admin(?:\/(?:accounts(?:\/(?:player\/[^/]+(?:\/results(?:\/[^/]+(?:\/[^/]+)?)?)?|coach\/[^/]+))?|organizations|programs))?\/?$/.test(url.pathname) || /%(?:2f|5c|2e|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname)) return;
    const nested = depth < 1 && /^\/admin\/accounts\/player\//.test(url.pathname) ? validatedAdminReturn(url.searchParams.get("returnTo"), depth + 1) : undefined;
    url.searchParams.delete("returnTo");
    if (nested) url.searchParams.set("returnTo", nested);
    return url.pathname + url.search;
  } catch { return; }
}
function stateOf(state: Partial<AdminDirectoryState> | string) { return typeof state === "string" ? parseAdminDirectoryState(state) : state; }
export function adminPlayerPath(playerId: string, panel: PlayerPanel = "results", state: Partial<AdminDirectoryState> | string = {}): string {
  const selection = stateOf(state), query = directoryQuery(selection);
  if (panel !== "results") query.set("playerTab", panel);
  query.set("returnTo", validatedAdminReturn(selection.returnTo) || adminDirectoryPath(selection));
  return pathQuery(`/admin/accounts/player/${encodeURIComponent(playerId)}`, query);
}
export function adminPlayerLinkFromReport(playerId: string, panel: PlayerPanel, search: string, context: { orgId?: string; teamId?: string; coachId?: string } = {}): string {
  return adminPlayerPath(playerId, panel, { ...parseAdminDirectoryState(search), ...context, search: "", page: 0, returnTo: "/admin" + search });
}
export function adminPlayerReturn(search: string): string { const state = parseAdminDirectoryState(search); return state.returnTo || adminDirectoryPath(state); }
export function adminPlannerPath(playerId: string, state: Partial<AdminDirectoryState> | string = {}): string {
  const selection = stateOf(state), query = new URLSearchParams(accountQuery(selection));
  query.set("players", playerId);
  const tab = typeof state === "string" ? new URLSearchParams(state).get("playerTab") : null;
  const panel = ["workouts", "profile", "ai-incidents"].includes(tab || "") ? tab as PlayerPanel : "results";
  query.set("returnTo", adminPlayerPath(playerId, panel, selection));
  return pathQuery("/admin/programs", query);
}
export function legacyOrganizationsPath(search: string): string { return adminDirectoryPath({ ...parseAdminDirectoryState(search), directoryTab: "teams", page: 0 }); }

const REPORT_PARAMS = ["orgId", "teamId", "coachId", "view", "weeks", "timezone", "start", "end", "rosterSearch", "page", "cursor", "testingWindow", "division", "ageBand", "testingStatus", "workoutStatus", "usageStatus", "usagePlatform", "usageFeature", "teamAssignment"];
const PHONE_PARAMS = ["phoneStart", "phoneEnd", "phoneDrill", "phoneAlgorithm", "phoneConfiguration", "phoneSession", "phoneCursor", "phoneRun"];
const DEVICE_FACT_PARAMS = ["start", "end", "days", "tz", "basis", "drill", "mode", "cbuild", "cmodel", "pmode", "xbuild", "xmodel", "net", "role", "size", "q", "sort", "cursor", "focus", "acursor", "attempt", "view", "section", "scenario"];
export function adminToolKey(path: string): string {
  if (path.startsWith("/admin/accounts") || path === "/admin/organizations") return "directory";
  if (path.startsWith("/admin/device-performance/team-sessions")) return "team-sessions";
  if (path.startsWith("/admin/device-performance/advanced")) return "device-facts";
  if (path.startsWith("/admin/device-performance")) return "devices";
  return path === "/admin" ? "report" : path.split("/")[2] || "report";
}
export function supportsAdminScope(path: string): boolean { return ["report", "directory", "programs"].includes(adminToolKey(path)); }
function reportingOrigin(search: string): string | undefined {
  let back = validatedAdminReturn(new URLSearchParams(search).get("returnTo"));
  for (let depth = 0; back && depth < 2; depth++) {
    const url = new URL(back, "https://posetek.net");
    if (url.pathname === "/admin") return url.search;
    back = validatedAdminReturn(url.searchParams.get("returnTo"));
  }
}
export function adminToolPath(destination: string, currentPath: string, search: string, retainedSearch = "", retainedScope?: AccountContext): string {
  const key = adminToolKey(destination), same = key === adminToolKey(currentPath);
  const reportReturn = key === "report" && (/^\/admin\/accounts\/(?:player|coach)\//.test(currentPath) || currentPath === "/admin/programs") ? reportingOrigin(search) : undefined;
  // Reuse the validated origin byte-for-byte, including parameter order: its
  // saved scroll position is keyed by the exact route the admin left.
  if (reportReturn !== undefined) return "/admin" + reportReturn;
  const source = new URLSearchParams(same ? search : retainedSearch), query = new URLSearchParams();
  // An empty selection on a scoped tool is deliberate. Never resurrect a
  // previous organization merely because its IDs are absent from this URL.
  let context = supportsAdminScope(currentPath) ? accountContext(search) : retainedScope ?? accountContext(retainedSearch || search);
  if (key === "directory") {
    let directorySearch = same ? search : retainedSearch;
    if (same && /^\/admin\/accounts\/(?:player|coach)\//.test(currentPath)) {
      const back = validatedAdminReturn(new URLSearchParams(search).get("returnTo"));
      // Reporting pages and opaque cursors have no directory meaning.
      if (back && adminToolKey(back.split("?")[0]) === "directory") {
        directorySearch = back.split("?")[1] || "";
        context = accountContext(directorySearch);
      } else directorySearch = retainedSearch;
    }
    const state = parseAdminDirectoryState(directorySearch);
    const changedScope = state.orgId !== context.orgId || state.teamId !== context.teamId;
    return adminDirectoryPath({ ...state, orgId: context.orgId, teamId: context.teamId, coachId: context.coachId,
      ...(changedScope ? { page: 0 } : {}), ...(new URLSearchParams(search).get("preview") === "1" ? { preview: true } : {}) });
  }
  const allowed = key === "report" ? REPORT_PARAMS : key === "devices" ? PHONE_PARAMS : key === "device-facts" ? DEVICE_FACT_PARAMS : key === "programs" ? ["orgId", "teamId", "coachId"] : key === "ai-incidents" ? ["q", "incident"] : [];
  for (const name of allowed) if (source.has(name)) query.set(name, source.get(name)!);
  if (supportsAdminScope(destination)) {
    const changedScope = query.get("orgId") !== (context.orgId || null) || query.get("teamId") !== (context.teamId || null);
    for (const name of ["orgId", "teamId", "coachId"] as const) { query.delete(name); if (context[name]) query.set(name, context[name]!); }
    if (changedScope) { query.delete("cursor"); query.delete("page"); }
  }
  if (new URLSearchParams(search).get("preview") === "1") query.set("preview", "1");
  return pathQuery(destination, query);
}

/** Discard identity-bound record destinations when the signed-in admin changes. */
export function adminAccountResetPath(path: string): string {
  if (path.startsWith("/admin/device-performance")) return "/admin/device-performance";
  const key = adminToolKey(path);
  if (key === "directory") return "/admin/accounts";
  return ["programs", "analysis", "drills", "ai-incidents", "user-issues", "feedback", "access"].includes(key) ? `/admin/${key}` : "/admin";
}
