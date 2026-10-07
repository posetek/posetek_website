import { accountContext } from "../../admin/lib/accountHierarchy";
import type { InsightsOrigin } from "./navigation";

export const INSIGHT_VIEWS = ["overview", "testing", "workouts", "usage"] as const;
export const COACH_VIEWS = [...INSIGHT_VIEWS, "community", "player"] as const;
export type InsightView = typeof COACH_VIEWS[number];
export const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "UTC"];
export const AGE_BANDS = ["under10", "10-12", "13-15", "16-18", "19+", "unknown"];
export const DIVISIONS = ["boys", "girls", "unknown"];
export const USAGE_FEATURES = ["workout", "video", "training", "results", "planner", "feed", "overview", "other"];
const choice = (value: string | null, values: readonly string[], fallback = "") => value && values.includes(value) ? value : fallback;
function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function dateInZone(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function expandedRequest(search: string, now = new Date()) {
  const params = new URLSearchParams(search), weeksInput = Number(params.get("weeks") || 8);
  const weeks = [4, 8, 12, 26].includes(weeksInput) ? weeksInput : 8;
  const timezone = choice(params.get("timezone"), TIMEZONES, "America/Los_Angeles");
  const today = dateInZone(now, timezone);
  const endDate = validDate(params.get("end")) && params.get("end")! <= today ? params.get("end")! : today;
  const startInput = params.get("start");
  const startDate = validDate(startInput) && startInput! <= endDate && startInput! >= shiftDate(endDate, -365) ? startInput! : shiftDate(endDate, 1 - weeks * 7);
  return { ...accountContext(params), from: choice(params.get("from"), ["accounts", "organization", "dashboard"], "organization") as InsightsOrigin,
    view: choice(params.get("view"), COACH_VIEWS, "overview") as InsightView,
    weeks, timezone, startDate, endDate,
    playerId: (params.get("playerId") || "").slice(0, 150), rosterSearch: (params.get("rosterSearch") || "").trim().slice(0, 120),
    page: Math.min(1000, Math.max(0, Math.floor(Number(params.get("page")) || 0))), cursor: (params.get("cursor") || "").slice(0, 2000),
    extra: Object.fromEntries(["panel", "connect", "activity", "preview"].flatMap(key => params.has(key) ? [[key, params.get(key)!]] : [])),
    testingWindow: choice(params.get("testingWindow"), ["cumulative", "period"], "cumulative") as "cumulative" | "period",
    division: choice(params.get("division"), DIVISIONS), ageBand: choice(params.get("ageBand"), AGE_BANDS),
    testingStatus: choice(params.get("testingStatus"), ["fullyTested", "partiallyTested", "noSuccessfulTests", "noRecordedTests"]),
    workoutStatus: choice(params.get("workoutStatus"), ["completed", "inProgress", "endedEarly", "abandoned", "none"]),
    usageStatus: choice(params.get("usageStatus"), ["returning", "active", "inactive", "notCollected"]),
    usagePlatform: choice(params.get("usagePlatform"), ["web", "ios", "both"]), usageFeature: choice(params.get("usageFeature"), USAGE_FEATURES),
    teamAssignment: choice(params.get("teamAssignment"), ["assigned", "unassigned"]),
  };
}
export type ExpandedRequest = ReturnType<typeof expandedRequest>;
export function expandedQuery(request: ExpandedRequest, patch: Partial<ExpandedRequest> = {}) {
  const next = { ...request, ...patch }, query = new URLSearchParams(next.extra);
  for (const key of ["orgId", "teamId", "coachId", "from", "view", "playerId", "rosterSearch", "cursor", "timezone", "testingWindow", "division", "ageBand", "testingStatus", "workoutStatus", "usageStatus", "usagePlatform", "usageFeature", "teamAssignment"] as const) if (next[key]) query.set(key, next[key]);
  if (next.page) query.set("page", String(next.page));
  query.set("weeks", String(next.weeks)); query.set("start", next.startDate); query.set("end", next.endDate);
  return query;
}
export function hasPlayerFilters(request: ExpandedRequest) { return !!(request.division || request.ageBand || request.testingStatus || request.workoutStatus || request.usageStatus || request.usagePlatform || request.usageFeature || request.teamAssignment); }
export function clearPlayerFilters(): Partial<ExpandedRequest> { return { division: "", ageBand: "", testingStatus: "", workoutStatus: "", usageStatus: "", usagePlatform: "", usageFeature: "", teamAssignment: "" }; }
/** Returning to Overview starts from the whole roster: report filters and name search are cleared; dates and scope stay. */
export function overviewReset(): Partial<ExpandedRequest> { return { ...clearPlayerFilters(), rosterSearch: "", cursor: "", page: 0 }; }
export const ageLabel = (key: string) => ({ under10: "Under 10", "10-12": "10–12", "13-15": "13–15", "16-18": "16–18", "19+": "19+", unknown: "Unknown" }[key] || key);
export const divisionLabel = (key: string) => ({ boys: "Boys", girls: "Girls", unknown: "Unknown" }[key] || key);
