import type { ExpandedRequest } from "./expandedQuery";
import { shiftDate } from "./expandedQuery";
export type InsightScope = { kind: "coachRoster"; coachId?: string } | { kind: "global" } | { kind: "organization"; organizationId: string } | { kind: "team"; organizationId: string; teamId: string };
export type CountGroup = { key: string; count: number };
export type InsightAccess = "admin" | "manager" | "coach";
export interface QualifiedProgress {
  drill: string; unit: string; lowerIsBetter: boolean; samples: number; players: number;
  weeks: { weekStart: string; best: number | null; samples: number; players: number }[];
}
export interface InsightChoices { coachRoster?: { label: string; coachId: string } | null; global: boolean; organizations: { id: string; name: string; role: InsightAccess; teams: { id: string; name: string }[] }[] }
export interface ExpandedPlayer {
  id: string; firstName: string; lastName: string; organizationId: string; organizationName: string; teamId: string | null; teamName: string | null;
  division: string; age: number | null; ageBand: string; registered?: boolean; signupInvitationReady?: boolean;
  testing: { status: string; exercisesComplete: number; exerciseKeys: string[]; recordedDocuments: number; distinctAttempts: number; qualifyingTests: number; dateUnknownAttempts?: number; hasDateUnknownAttempts?: boolean };
  performance?: { d1: number | null; change: number | null; lastTestDate: string | null; previousTestDate: string | null;
    sessionsDone: number | null; sessionsPlanned: number | null; activePlan: boolean; planAgeDays: number | null; needsYouReasons: string[] };
  workouts: { status: string; started: number; completed: number; timerMinutes: number; estimatedMinutes: number; allPrescribedSetsCompleted: number; unknownPrescription: number; outcomeEvents?: number; timerRecords?: number; estimatedRecords?: number };
  usage: { status: string; collected: boolean; webCollected: boolean; iosCollected: boolean; activeMinutes: number; webMinutes: number; iosMinutes: number; activeDays: number };
}
/** Optional admin-only metrics for account rows; excluded history is never returned. */
export type RosterMetric = { playerId: string; status: "included"; player: ExpandedPlayer }
  | { playerId: string; status: "excluded" };
export interface ExpandedInsights {
  schemaVersion: 2;
  scope: InsightScope & { label: string; access: InsightAccess; assignedTeamsOnly: boolean };
  choices: InsightChoices;
  period: { startDate: string; endDate: string; timeZone: string; startMillis: number; endMillis: number };
  testingMode: "cumulative" | "period"; filters: Record<string, string>; generatedAtMillis: number;
  freshness: { complete: true; projectionVersion: number; oldestRebuiltAtMillis: number | null; newestRebuiltAtMillis: number | null; qualification: string; historicalOwnership: "current" };
  roster: { total: number; included: number; excluded: number; filtered: number; matched?: number };
  nameSearch?: string;
  participation?: { testingPlayers: number; workoutPlayers: number; anyPlayers: number };
  overview?: { playersWithD1: number; averageD1: number | null; playersWithChange: number; improved: number; planPlayers: number; keepingUp: number; coachFollowUp: number; needsYouPlayers?: { id: string; name: string; reasons: string[] }[]; noTestingPlayers?: { id: string; name: string }[]; noWorkoutPlayers?: { id: string; name: string }[] };
  demographics: { division: CountGroup[]; ageBand: CountGroup[] };
  scopeBreakdown: { organizations: { id: string; name: string; count: number }[]; teams: { id: string | null; organizationId: string; name: string; count: number }[] };
  testing: { statuses: CountGroup[]; recordedDocuments: number; distinctAttempts: number; qualifyingTests: number; duplicateDocuments: number; needsReview: number; noResultDocuments: number; undatedDocuments: number; futureDatedDocuments: number; failureReports?: number; linkedFailureReports?: number; unmatchedFailureReports?: number;
    exercises: { key: string; playersQualified: number; qualifyingTests: number; distinctAttempts: number }[];
    progress?: QualifiedProgress[];
    days: { date: string; recordedDocuments: number; distinctAttempts: number; qualifyingTests: number }[] };
  workouts: { statuses: CountGroup[]; started: number; completed: number; inProgress: number; endedEarly: number; abandoned: number; unknownEnding: number; outcomeEvents?: number; timerRecords?: number; estimatedRecords?: number; knownPrescription?: number; duplicateLogs: number; doneBlocks: number; partialBlocks: number; skippedBlocks: number; setsCompleted: number; timerMinutes: number; estimatedMinutes: number; unknownDuration: number; allPrescribedSetsCompleted: number; unknownPrescription: number;
    days: { date: string; started: number; completed: number; timerMinutes: number; estimatedMinutes: number }[] };
  usage: { statuses: CountGroup[]; collectedPlayers: number; notCollectedPlayers: number; webCollectedPlayers: number; iosCollectedPlayers: number; activePlayers: number; returningPlayers: number; activeMinutes: number; webMinutes: number; iosMinutes: number; overlapMinutes: number; collectionStartedAtMillis: number | null; webCollectionStartedAtMillis: number | null; iosCollectionStartedAtMillis: number | null; featureMinutes: Record<string, number>;
    days: { date: string; activeMinutes: number | null; webMinutes: number | null; iosMinutes: number | null; collectedPlayers?: number; webCollectedPlayers?: number; iosCollectedPlayers?: number }[] };
  players: ExpandedPlayer[];
  rosterMetrics?: RosterMetric[];
  pagination: { total: number; pageSize: number; nextCursor: string | null };
}
export const TESTING_LABELS: Record<string, string> = { fullyTested: "Fully tested", partiallyTested: "Partially tested", noSuccessfulTests: "No successful tests", noRecordedTests: "No recorded tests" };
export const WORKOUT_LABELS: Record<string, string> = { completed: "Completed a workout", inProgress: "No ending record", endedEarly: "Ended early", abandoned: "Abandoned", none: "No workout status" };
export const USAGE_LABELS: Record<string, string> = { returning: "Returning", active: "Active on one day", inactive: "No active use", notCollected: "Not collected" };
export const EXERCISES = ["shooting", "sprint", "jump", "broadJump", "changeOfDirection", "dribbling"];
export const FEATURE_LABELS: Record<string, string> = { workout: "Workouts", video: "Video", training: "Training", results: "Results", planner: "Planner", feed: "Feed", overview: "Overview", other: "Other" };
export function scopeFor(request: ExpandedRequest, role: InsightAccess, defaultOrganizationId?: string): InsightScope {
  const organizationId = request.orgId || defaultOrganizationId;
  if (!organizationId && role === "admin") return { kind: "global" };
  if (!organizationId) throw new Error("No current organization is available.");
  return request.teamId ? { kind: "team", organizationId, teamId: request.teamId } : { kind: "organization", organizationId };
}
export function sameScope(a: InsightScope, b: InsightScope) {
  return a.kind === b.kind && (a.kind === "global" || a.kind === "coachRoster" && b.kind === "coachRoster" && (!a.coachId || !b.coachId || a.coachId === b.coachId) || b.kind !== "global" && b.kind !== "coachRoster" && a.kind !== "coachRoster" && a.organizationId === b.organizationId) && (a.kind !== "team" || b.kind === "team" && a.teamId === b.teamId);
}
/** Never send response-only labels, access metadata or a caller-selectable coach ID. */
export function scopePayload(scope: InsightScope): InsightScope {
  if (scope.kind === "coachRoster" || scope.kind === "global") return { kind: scope.kind };
  return scope.kind === "team" ? { kind: "team", organizationId: scope.organizationId, teamId: scope.teamId } : { kind: "organization", organizationId: scope.organizationId };
}
export function reportPayload(request: ExpandedRequest, scope: InsightScope, cursor?: string) {
  const filters = Object.fromEntries((["division", "ageBand", "testingStatus", "workoutStatus", "usageStatus", "usagePlatform", "usageFeature", "teamAssignment"] as const).filter(key => request[key]).map(key => [key, request[key]]));
  return { scope: scopePayload(scope), ...(request.rosterSearch ? { nameSearch: request.rosterSearch } : {}), timeZone: request.timezone, startDate: request.startDate, endDate: request.endDate, testingMode: request.testingWindow, filters, pageSize: 25, ...(cursor ? { cursor } : {}) };
}
export function assertReportScope(report: ExpandedInsights, scope: InsightScope, request: ExpandedRequest) {
  const expectedFilters = reportPayload(request, scope).filters;
  const filtersMatch = Object.keys(expectedFilters).length === Object.keys(report.filters || {}).length && Object.entries(expectedFilters).every(([key, value]) => report.filters[key] === value);
  if (report.schemaVersion !== 2 || report.freshness?.complete !== true || !sameScope(report.scope, scope) || report.period.startDate !== request.startDate || report.period.endDate !== request.endDate || report.period.timeZone !== request.timezone || report.testingMode !== request.testingWindow || !filtersMatch || (report.nameSearch || "") !== request.rosterSearch) {
    throw Object.assign(new Error("The report no longer matches this selection."), { code: "failed-precondition" });
  }
}
export const minuteText = (value: number, collected = true) => collected ? `${Math.max(0, value).toLocaleString(undefined, { maximumFractionDigits: 1 })} min` : "Not collected";
export function workoutDurationText(minutes: number, sourceRecords?: number) {
  return sourceRecords === undefined ? "Coverage unavailable" : sourceRecords === 0 ? "Not recorded" : minuteText(minutes);
}
export function workoutOutcomeSlices(workouts: ExpandedInsights["workouts"]): { key: string; label: string; value: number }[] {
  return [{ key: "completed", label: "Completed as logged", value: workouts.completed }, { key: "endedEarly", label: "Ended early", value: workouts.endedEarly }, { key: "inProgress", label: "No ending record", value: workouts.inProgress }, { key: "abandoned", label: "Abandoned", value: workouts.abandoned }, { key: "unknown", label: "Unknown ending", value: workouts.unknownEnding || 0 }];
}
export function shortDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
export function weeklySeries<T extends { date: string }>(days: T[], fields: (keyof T)[], startDate: string, endDate: string, collected: boolean[] = fields.map(() => true)) {
  const weeks = new Map<string, (number | null)[]>();
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay(), week = shiftDate(date, -(day + 6) % 7);
    if (!weeks.has(week)) weeks.set(week, fields.map(() => null));
  }
  for (const day of days) {
    if (day.date < startDate || day.date > endDate) continue;
    const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay(), key = shiftDate(day.date, -(weekday + 6) % 7), row = weeks.get(key);
    if (!row) continue;
    fields.forEach((field, index) => { const value = day[field]; if (collected[index] && typeof value === "number" && Number.isFinite(value)) row[index] = (row[index] ?? 0) + value; });
  }
  return { labels: [...weeks.keys()].map(shortDate), values: fields.map((_, index) => [...weeks.values()].map(row => row[index])) };
}
export function platformSlices(usage: ExpandedInsights["usage"]) {
  return [{ key: "web", label: "Website only", value: Math.max(0, usage.webMinutes - usage.overlapMinutes) }, { key: "ios", label: "iOS app only", value: Math.max(0, usage.iosMinutes - usage.overlapMinutes) }, { key: "both", label: "Both at once", value: Math.max(0, usage.overlapMinutes) }];
}
export function expandedFailureMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "").split("/").at(-1);
  if (code === "failed-precondition") return "This report is being refreshed or has changed. Refresh to request the latest complete report.";
  if (code === "resource-exhausted") return "This scope is too large to load completely right now. Choose an organization or team, then retry.";
  if (["permission-denied", "unauthenticated", "not-found"].includes(code || "")) return "Your access or this scope has changed. Refresh to check your current access.";
  return "Insights could not be loaded. Retry or choose another scope.";
}
