import { accountContext, accountQuery } from "./accountHierarchy";
import type { AccountContext } from "./accountHierarchy";
import { expandedRequest } from "../../insights/lib/expandedQuery";
import type { ExpandedRequest } from "../../insights/lib/expandedQuery";

export const DIRECTORY_TABS = ["players", "staff", "teams", "settings"] as const;
export type DirectoryTab = typeof DIRECTORY_TABS[number];
export type PlayerPanel = "results" | "workouts" | "profile" | "ai-incidents";
export type WorkspaceReportView = "overview" | "testing" | "workouts" | "usage";
export interface WorkspaceReportState {
  reportView?: WorkspaceReportView; reportMode?: "directory" | "attention";
  reportStart?: string; reportEnd?: string; reportWeeks?: number; reportTimezone?: string;
  reportTestingWindow?: "cumulative" | "period"; reportSearch?: string; reportCursor?: string; reportPage?: number;
  reportDivision?: string; reportAgeBand?: string; reportTestingStatus?: string; reportWorkoutStatus?: string;
  reportUsageStatus?: string; reportUsagePlatform?: string; reportUsageFeature?: string; reportTeamAssignment?: string;
}
export interface AdminDirectoryState extends WorkspaceReportState {
  orgId?: string; teamId?: string; coachId?: string;
  directoryTab: DirectoryTab; search: string; page: number;
  returnTo?: string; preview?: boolean; directoryLookup?: "all" | "unassigned";
}
const queryOf = (search: string | URLSearchParams) => typeof search === "string" ? new URLSearchParams(search) : search;
const REPORT_FIELDS = {
  reportView: "view", reportStart: "start", reportEnd: "end", reportWeeks: "weeks", reportTimezone: "timezone",
  reportTestingWindow: "testingWindow", reportSearch: "rosterSearch", reportCursor: "cursor", reportPage: "page",
  reportDivision: "division", reportAgeBand: "ageBand", reportTestingStatus: "testingStatus", reportWorkoutStatus: "workoutStatus",
  reportUsageStatus: "usageStatus", reportUsagePlatform: "usagePlatform", reportUsageFeature: "usageFeature", reportTeamAssignment: "teamAssignment",
} as const;
function reportState(query: URLSearchParams): WorkspaceReportState {
  const report = new URLSearchParams();
  for (const [field, name] of Object.entries(REPORT_FIELDS)) if (query.has(field)) report.set(name, query.get(field)!);
  const request = expandedRequest(report.toString());
  const result: Record<string, string | number> = {};
  const requestFields: Record<string, string> = { start: "startDate", end: "endDate" };
  for (const [field, name] of Object.entries(REPORT_FIELDS)) {
    if (!query.has(field)) continue;
    const raw = query.get(field) || "";
    if (name === "view") { result[field] = ["overview", "testing", "workouts", "usage"].includes(raw) ? raw : "overview"; continue; }
    if (name === "start" || name === "end") { if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) result[field] = raw; continue; }
    const value = request[(requestFields[name] || name) as keyof ExpandedRequest];
    if (typeof value === "string" || typeof value === "number") result[field] = value;
  }
  if (["directory", "attention"].includes(query.get("reportMode") || "")) result.reportMode = query.get("reportMode")!;
  return result as WorkspaceReportState;
}
export function parseAdminDirectoryState(search: string | URLSearchParams): AdminDirectoryState {
  const query = queryOf(search), tab = query.get("directoryTab");
  return { ...accountContext(query), ...reportState(query), directoryTab: DIRECTORY_TABS.includes(tab as DirectoryTab) ? tab as DirectoryTab : "players",
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
  for (const field of Object.keys(REPORT_FIELDS) as (keyof typeof REPORT_FIELDS)[]) {
    const value = state[field];
    if (value !== undefined && value !== "" && value !== 0) query.set(field, String(value));
  }
  if (state.reportMode === "attention") query.set("reportMode", state.reportMode);
  return query;
}
const pathQuery = (path: string, query: URLSearchParams) => `${path}${query.size ? `?${query}` : ""}`;
export function adminDirectoryPath(state: Partial<AdminDirectoryState> = {}): string { return pathQuery("/admin/accounts", directoryQuery(state)); }

/** Reporting has its own search and zero-based cursor pagination; directory inputs never leak into it. */
export function workspaceReportSearch(state: Partial<AdminDirectoryState> | string): string {
  const selection = stateOf(state), query = new URLSearchParams(accountQuery(selection));
  for (const [field, name] of Object.entries(REPORT_FIELDS)) {
    const value = selection[field as keyof WorkspaceReportState];
    if (value !== undefined && value !== "" && value !== 0) query.set(name, String(value));
  }
  return query.toString();
}
export function workspaceReportRequest(state: Partial<AdminDirectoryState> | string, now?: Date): ExpandedRequest {
  return expandedRequest(workspaceReportSearch(state), now);
}
export function withWorkspaceReport(state: AdminDirectoryState, patch: Partial<ExpandedRequest>): AdminDirectoryState {
  const next = { ...state };
  for (const [field, name] of Object.entries(REPORT_FIELDS)) {
    const key = name === "start" ? "startDate" : name === "end" ? "endDate" : name;
    if (!(key in patch)) continue;
    const value = patch[key as keyof ExpandedRequest];
    Object.assign(next, { [field]: value || undefined });
  }
  return next;
}
/** Compatible Overview links become the unified workspace without reusing report page/search as directory inputs. */
export function legacyAdminWorkspacePath(search: string): string {
  const legacy = new URLSearchParams(search), query = new URLSearchParams(accountQuery(accountContext(legacy)));
  for (const [field, name] of Object.entries(REPORT_FIELDS)) {
    if (legacy.has(name)) query.set(field, legacy.get(name)!);
    else if (legacy.has(field)) query.set(field, legacy.get(field)!);
  }
  if (legacy.get("preview") === "1") query.set("preview", "1");
  if (legacy.get("reportMode") === "attention" || Number(legacy.get("page")) > 0 || ["rosterSearch", "cursor", "division", "ageBand", "testingStatus", "workoutStatus", "usageStatus", "usagePlatform", "usageFeature", "teamAssignment"].some(key => legacy.get(key))) query.set("reportMode", "attention");
  return adminDirectoryPath(parseAdminDirectoryState(query));
}

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
  const workspace = legacyAdminWorkspacePath(search);
  return adminPlayerPath(playerId, panel, { ...parseAdminDirectoryState(workspace.split("?")[1] || ""), ...context, search: "", page: 0, returnTo: "/admin" + search });
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

const PHONE_PARAMS = ["phoneStart", "phoneEnd", "phoneDrill", "phoneAlgorithm", "phoneConfiguration", "phoneSession", "phoneCursor", "phoneRun"];
const DEVICE_FACT_PARAMS = ["start", "end", "days", "tz", "basis", "drill", "mode", "cbuild", "cmodel", "pmode", "xbuild", "xmodel", "net", "role", "size", "q", "sort", "cursor", "focus", "acursor", "attempt", "view", "section", "scenario"];
export function adminToolKey(path: string): string {
  if (path === "/admin" || path.startsWith("/admin/accounts") || path === "/admin/organizations") return "directory";
  if (path.startsWith("/admin/device-performance/team-sessions")) return "team-sessions";
  if (path.startsWith("/admin/device-performance/advanced")) return "device-facts";
  if (path.startsWith("/admin/device-performance")) return "devices";
  return path.split("/")[2] || "directory";
}
export function supportsAdminScope(path: string): boolean { return ["directory", "programs"].includes(adminToolKey(path)); }
function workspaceOrigin(search: string): string | undefined {
  let back = validatedAdminReturn(new URLSearchParams(search).get("returnTo"));
  for (let depth = 0; back && depth < 2; depth++) {
    const url = new URL(back, "https://posetek.net");
    if (url.pathname === "/admin") return legacyAdminWorkspacePath(url.search);
    if (url.pathname === "/admin/accounts" || url.pathname === "/admin/organizations") return url.pathname === "/admin/organizations" ? legacyOrganizationsPath(url.search) : back;
    back = validatedAdminReturn(url.searchParams.get("returnTo"));
  }
}
export function adminToolPath(destination: string, currentPath: string, search: string, retainedSearch = "", retainedScope?: AccountContext): string {
  const key = adminToolKey(destination), same = key === adminToolKey(currentPath);
  const workspaceReturn = key === "directory" && (/^\/admin\/accounts\/(?:player|coach)\//.test(currentPath) || currentPath === "/admin/programs") ? workspaceOrigin(search) : undefined;
  // Reuse the validated origin byte-for-byte, including parameter order: its
  // saved scroll position is keyed by the exact route the admin left.
  if (workspaceReturn !== undefined) return workspaceReturn;
  const source = new URLSearchParams(same ? search : retainedSearch), query = new URLSearchParams();
  // An empty selection on a scoped tool is deliberate. Never resurrect a
  // previous organization merely because its IDs are absent from this URL.
  let context = supportsAdminScope(currentPath) ? accountContext(search) : retainedScope ?? accountContext(retainedSearch || search);
  if (key === "directory") {
    if (currentPath === "/admin") return legacyAdminWorkspacePath(search);
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
      ...(changedScope ? { page: 0, reportPage: undefined, reportCursor: undefined } : {}), ...(new URLSearchParams(search).get("preview") === "1" ? { preview: true } : {}) });
  }
  const allowed = key === "devices" ? PHONE_PARAMS : key === "device-facts" ? DEVICE_FACT_PARAMS : key === "programs" ? ["orgId", "teamId", "coachId"] : key === "ai-incidents" ? ["q", "incident"] : [];
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
  return ["programs", "analysis", "drills", "ai-incidents", "user-issues", "feedback", "access"].includes(key) ? `/admin/${key}` : "/admin/accounts";
}
