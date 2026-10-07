import type { ExpandedRequest } from "./expandedQuery";
import { AGE_BANDS, shiftDate, clearPlayerFilters } from "./expandedQuery";
import { EXERCISES, scopeFor } from "./expanded";
import type { ExpandedInsights, ExpandedPlayer, InsightAccess, InsightChoices, QualifiedProgress } from "./expanded";
import { athleteSummary } from "../../coach-dashboard/lib/logic";

export const PREVIEW_CHOICES: InsightChoices = { global: true, organizations: [
  { id: "northfield", name: "Northfield FC", role: "admin", teams: [{ id: "harbor", name: "Harbor U15" }, { id: "summit", name: "Summit U17" }] },
  { id: "riverside", name: "Riverside Athletic", role: "admin", teams: [{ id: "cedar", name: "Cedar U13" }, { id: "ridge", name: "Ridge U19" }] },
] };
const FIRST = ["Avery", "Jordan", "Morgan", "Alex", "Taylor", "Sam", "Casey", "Riley", "Cameron", "Jamie", "Robin", "Drew"];
const LAST = ["Stone", "Rivera", "Park", "Brooks", "Reed", "Morgan", "Chen"];
const sums = <T,>(rows: T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0);
const countGroups = <T,>(rows: T[], keys: string[], value: (row: T) => string) => keys.map(key => ({ key, count: rows.filter(row => value(row) === key).length }));
export function previewInsights(request: ExpandedRequest, page = 0, state = "normal", role: InsightAccess = "admin"): ExpandedInsights {
  const choices: InsightChoices = { global: role === "admin", organizations: PREVIEW_CHOICES.organizations.filter(org => role === "admin" || org.id === "northfield").map(org => ({ ...org, role, teams: org.teams.filter(team => role !== "coach" || team.id === "harbor") })) };
  const scope = scopeFor(request, role, role === "admin" ? undefined : "northfield");
  const all = Array.from({ length: state === "empty" ? 0 : 84 }, (_, i) => {
    const org = PREVIEW_CHOICES.organizations[i < 48 ? 0 : 1], team = i % 17 === 0 ? null : org.teams[i % 2];
    const exercisesComplete = i % 8 === 0 ? 0 : i % 4 === 0 ? 6 : 1 + i % 5;
    const complete = request.testingWindow === "period" ? Math.max(0, exercisesComplete - i % 3) : exercisesComplete;
    const recordedDocuments = exercisesComplete ? 4 + i % 13 : i % 16 === 0 ? 0 : 3;
    const usageStatus = state === "uncollected" || i % 7 === 0 ? "notCollected" : i % 6 === 0 ? "inactive" : i % 3 === 0 ? "active" : "returning";
    const activeMinutes = ["inactive", "notCollected"].includes(usageStatus) ? 0 : 15 + i % 67;
    const iosCollected = usageStatus !== "notCollected" && i % 3 !== 0;
    const activeDays = usageStatus === "returning" ? 2 + i % 9 : usageStatus === "active" ? 1 : 0;
    const workoutStatus = ["completed", "inProgress", "endedEarly", "abandoned", "none"][i % 5];
    const outcomeEvents = workoutStatus === "none" ? 0 : workoutStatus === "completed" ? 1 + i % 3 : 1;
    const planActive = i % 6 !== 0, sessionsPlanned = planActive ? 4 : null;
    const sessionsDone = planActive ? ([1, 3, 4].includes(i % 6) ? 2 : i % 4) : null;
    const d1Change = exercisesComplete > 0 && i % 3 !== 0 ? [-7, -2, 4, 1][i % 4] : null;
    const planAgeDays = planActive ? 3 + i % 14 : null;
    const needsYouReasons = [
      ...(d1Change !== null && d1Change <= -5 ? ["D1 down at least 5 points"] : []),
      ...(planActive && planAgeDays! >= 3 && i % 13 === 0 ? ["No sign-in recorded"] : []),
      ...(planActive && planAgeDays! >= 7 && sessionsPlanned! > 0 && sessionsDone! * 2 < sessionsPlanned! ? ["Behind on training"] : []),
    ];
    const age = i % 7 === 0 ? null : [9, 11, 14, 17, 21][i % 5];
    const row: ExpandedPlayer = { id: `synthetic-${i}`, firstName: FIRST[i % FIRST.length], lastName: LAST[Math.floor(i / FIRST.length)], organizationId: org.id, organizationName: org.name, teamId: team?.id || null, teamName: team?.name || null,
      division: i % 11 === 0 ? "unknown" : i % 2 ? "girls" : "boys", age, ageBand: age === null ? "unknown" : AGE_BANDS[[9,11,14,17,21].indexOf(age)],
      testing: { status: complete === 6 ? "fullyTested" : complete ? "partiallyTested" : recordedDocuments ? "noSuccessfulTests" : "noRecordedTests", exercisesComplete: complete, exerciseKeys: EXERCISES.slice(0, complete), recordedDocuments, distinctAttempts: Math.max(0, recordedDocuments - 1), qualifyingTests: complete ? complete + i % 3 : 0 },
      performance: { d1: exercisesComplete ? 62 + i % 42 : null, change: exercisesComplete > 0 && i % 3 !== 0 ? d1Change : null,
        lastTestDate: exercisesComplete > 0 ? shiftDate(request.endDate, -(i % 10)) : null,
        previousTestDate: exercisesComplete > 0 && i % 3 !== 0 ? shiftDate(request.endDate, -(18 + (i % 6))) : null,
        sessionsDone, sessionsPlanned, activePlan: planActive, planAgeDays, needsYouReasons },
      workouts: { status: workoutStatus, started: workoutStatus === "none" ? 0 : 1 + i % 4, completed: workoutStatus === "completed" ? 1 + i % 3 : 0, timerMinutes: workoutStatus === "completed" ? 30 + i % 25 : 0, estimatedMinutes: workoutStatus === "endedEarly" ? 12 + i % 12 : 0, allPrescribedSetsCompleted: workoutStatus === "completed" && i % 2 === 0 && i % 11 !== 0 ? 1 : 0, unknownPrescription: i % 11 === 0 ? outcomeEvents : 0, outcomeEvents, timerRecords: workoutStatus === "completed" ? outcomeEvents : 0, estimatedRecords: workoutStatus === "endedEarly" ? outcomeEvents : 0 },
      usage: { status: usageStatus, collected: usageStatus !== "notCollected", webCollected: usageStatus !== "notCollected", iosCollected, activeMinutes, webMinutes: activeMinutes * (iosCollected ? .7 : 1), iosMinutes: iosCollected ? activeMinutes * .45 : 0, activeDays } };
    return { ...row, overlapMinutes: iosCollected ? activeMinutes * .15 : 0, featureMinutes: { training: activeMinutes * .6, results: activeMinutes * .3, overview: activeMinutes * .1 } };
  });
  const included = all.filter(row => ((scope.kind === "global" || scope.kind === "coachRoster") || row.organizationId === scope.organizationId) && (scope.kind !== "team" || row.teamId === scope.teamId) && (role !== "coach" || row.teamId === "harbor"));
  const rows = included.filter(row => (!request.division || row.division === request.division) && (!request.ageBand || row.ageBand === request.ageBand) && (!request.testingStatus || row.testing.status === request.testingStatus) && (!request.workoutStatus || row.workouts.status === request.workoutStatus) && (!request.usageStatus || row.usage.status === request.usageStatus)
    && (!request.teamAssignment || (request.teamAssignment === "unassigned" ? !row.teamId : !!row.teamId))
    && (!request.usagePlatform || (request.usagePlatform === "web" ? row.usage.webMinutes - row.overlapMinutes : request.usagePlatform === "ios" ? row.usage.iosMinutes - row.overlapMinutes : row.overlapMinutes) > 0)
    && (!request.usageFeature || (row.featureMinutes[request.usageFeature as keyof typeof row.featureMinutes] || 0) > 0));
  const dates: string[] = []; for (let date = request.startDate; date <= request.endDate; date = shiftDate(date, 1)) dates.push(date);
  const total = (value: (row: typeof rows[number]) => number) => sums(rows, value), collectedPlayers = rows.filter(row => row.usage.collected).length;
  const weekStart = (date: string) => shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weeks = [...new Set(dates.map(weekStart))];
  const progress: QualifiedProgress[] = EXERCISES.flatMap((drill, drillIndex) => {
    const contributors = rows.filter(row => row.testing.exerciseKeys.includes(drill));
    if (!contributors.length) return [];
    const lowerIsBetter = ["changeOfDirection", "dribbling"].includes(drill);
    const captures = contributors.flatMap((row, index) => Array.from({ length: 1 + (drillIndex === 0 ? row.testing.qualifyingTests - row.testing.exerciseKeys.length : 0) }, (_, rep) => ({
      player: row.id, week: weekStart(dates[(index * 11 + drillIndex * 3 + rep * 7) % dates.length]), value: [18, 7, .4, 1.9, 6, 9][drillIndex] + (index % 7 + rep) * (drill === "jump" ? .01 : .1),
    })));
    return [{ drill, unit: drillIndex < 2 ? "m/s" : drillIndex < 4 ? "m" : "s", lowerIsBetter, samples: captures.length, players: contributors.length,
      weeks: weeks.map(week => { const points = captures.filter(point => point.week === week); return { weekStart: week, best: points.length ? (lowerIsBetter ? Math.min : Math.max)(...points.map(point => point.value)) : null, samples: points.length, players: new Set(points.map(point => point.player)).size }; }) }];
  });
  const testing = { statuses: countGroups(rows, ["fullyTested", "partiallyTested", "noSuccessfulTests", "noRecordedTests"], row => row.testing.status), recordedDocuments: total(row => row.testing.recordedDocuments), distinctAttempts: total(row => row.testing.distinctAttempts), qualifyingTests: total(row => row.testing.qualifyingTests), duplicateDocuments: rows.filter(row => row.testing.recordedDocuments > 0).length, needsReview: rows.filter(row => row.testing.status === "noSuccessfulTests").length, noResultDocuments: Math.floor(rows.length / 5), undatedDocuments: rows.length ? 3 : 0, futureDatedDocuments: rows.length ? 1 : 0,
    failureReports: rows.length ? 7 : 0, linkedFailureReports: rows.length ? 5 : 0, unmatchedFailureReports: rows.length ? 2 : 0,
    progress, exercises: EXERCISES.map(key => ({ key, playersQualified: rows.filter(row => row.testing.exerciseKeys.includes(key)).length, qualifyingTests: progress.find(series => series.drill === key)?.samples || 0, distinctAttempts: rows.filter(row => row.testing.exerciseKeys.includes(key)).length * 3 })), days: dates.map((date, i) => ({ date, recordedDocuments: i % 7 === 2 ? rows.length : 0, distinctAttempts: i % 7 === 2 ? Math.floor(rows.length * .8) : 0, qualifyingTests: i % 7 === 2 ? Math.floor(rows.length * .6) : 0 })) };
  const workouts = { statuses: countGroups(rows, ["completed", "inProgress", "endedEarly", "abandoned", "none"], row => row.workouts.status), started: total(row => row.workouts.started), completed: total(row => row.workouts.completed), inProgress: rows.filter(row => row.workouts.status === "inProgress").length, endedEarly: rows.filter(row => row.workouts.status === "endedEarly").length, abandoned: rows.filter(row => row.workouts.status === "abandoned").length, duplicateLogs: rows.length ? 2 : 0, doneBlocks: rows.length * 3, partialBlocks: rows.length, skippedBlocks: Math.floor(rows.length / 3), setsCompleted: rows.length * 11, timerMinutes: total(row => row.workouts.timerMinutes), estimatedMinutes: total(row => row.workouts.estimatedMinutes), unknownEnding: 0, outcomeEvents: total(row => row.workouts.outcomeEvents || 0), timerRecords: total(row => row.workouts.timerRecords || 0), estimatedRecords: total(row => row.workouts.estimatedRecords || 0), unknownDuration: total(row => (row.workouts.outcomeEvents || 0) - (row.workouts.timerRecords || 0) - (row.workouts.estimatedRecords || 0)), knownPrescription: total(row => (row.workouts.outcomeEvents || 0) - row.workouts.unknownPrescription), allPrescribedSetsCompleted: total(row => row.workouts.allPrescribedSetsCompleted), unknownPrescription: total(row => row.workouts.unknownPrescription), days: dates.map((date, i) => ({ date, started: i % 3 === 0 ? Math.floor(rows.length / 5) : 0, completed: i % 3 === 0 ? Math.floor(rows.length / 7) : 0, timerMinutes: i % 3 === 0 ? rows.length * 4 : 0, estimatedMinutes: i % 3 === 0 ? rows.length : 0 })) };
  const started = collectedPlayers ? new Date(`${request.startDate}T12:00:00Z`).valueOf() : null;
  const usage = { statuses: countGroups(rows, ["returning", "active", "inactive", "notCollected"], row => row.usage.status), collectedPlayers, notCollectedPlayers: rows.length - collectedPlayers, webCollectedPlayers: rows.filter(row => row.usage.webCollected).length, iosCollectedPlayers: rows.filter(row => row.usage.iosCollected).length, activePlayers: rows.filter(row => row.usage.activeDays > 0).length, returningPlayers: rows.filter(row => row.usage.activeDays > 1).length, activeMinutes: total(row => row.usage.activeMinutes), webMinutes: total(row => row.usage.webMinutes), iosMinutes: total(row => row.usage.iosMinutes), overlapMinutes: total(row => row.overlapMinutes), collectionStartedAtMillis: started, webCollectionStartedAtMillis: started, iosCollectionStartedAtMillis: started,
    featureMinutes: { training: total(row => row.featureMinutes.training), results: total(row => row.featureMinutes.results), overview: total(row => row.featureMinutes.overview) }, days: collectedPlayers ? dates.map((date, i) => ({ date, activeMinutes: i % 7 < 5 ? total(row => row.usage.activeMinutes) / dates.length : 0, webMinutes: i % 7 < 5 ? total(row => row.usage.webMinutes) / dates.length : 0, iosMinutes: i % 7 < 5 ? total(row => row.usage.iosMinutes) / dates.length : 0 })) : [] };
  const visible = rows.filter(row => !request.rosterSearch || `${row.firstName} ${row.lastName}`.toLocaleLowerCase().includes(request.rosterSearch.toLocaleLowerCase()))
    .sort((a, b) => {
      const signal = (row: typeof a) => row.performance?.needsYouReasons.length || 0;
      return Number(signal(b) > 0) - Number(signal(a) > 0)
        || Number(a.testing.qualifyingTests === 0) - Number(b.testing.qualifyingTests === 0)
        || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`) || a.id.localeCompare(b.id);
    });
  return { schemaVersion: 2, nameSearch: request.rosterSearch, scope: { ...scope, access: role, label: scope.kind === "coachRoster" ? "My roster" : scope.kind === "global" ? "All organizations" : scope.kind === "team" ? PREVIEW_CHOICES.organizations.flatMap(org => org.teams).find(team => team.id === scope.teamId)?.name || "Team" : choices.organizations.find(org => org.id === scope.organizationId)?.name || "Organization", assignedTeamsOnly: role === "coach" }, choices,
    period: { startDate: request.startDate, endDate: request.endDate, timeZone: request.timezone, startMillis: new Date(`${request.startDate}T00:00:00Z`).valueOf(), endMillis: new Date(`${shiftDate(request.endDate, 1)}T00:00:00Z`).valueOf() }, testingMode: request.testingWindow, filters: {}, generatedAtMillis: Date.now(), freshness: { complete: true, projectionVersion: 2, oldestRebuiltAtMillis: Date.now(), newestRebuiltAtMillis: Date.now(), qualification: "verified-artifacts", historicalOwnership: "current" }, roster: { total: included.length + 2, included: included.length, excluded: 2, filtered: rows.length },
    participation: { testingPlayers: rows.filter(row => row.testing.recordedDocuments > 0).length, workoutPlayers: rows.filter(row => row.workouts.started > 0).length, anyPlayers: rows.filter(row => row.testing.recordedDocuments > 0 || row.workouts.started > 0).length },
    demographics: { division: countGroups(rows, ["boys", "girls", "unknown"], row => row.division), ageBand: countGroups(rows, AGE_BANDS, row => row.ageBand) },
    scopeBreakdown: { organizations: choices.organizations.map(org => ({ id: org.id, name: org.name, count: rows.filter(row => row.organizationId === org.id).length })), teams: choices.organizations.flatMap(org => [...org.teams.map(team => ({ id: team.id as string | null, organizationId: org.id, name: team.name, count: rows.filter(row => row.teamId === team.id).length })), { id: null, organizationId: org.id, name: "Unassigned", count: rows.filter(row => row.organizationId === org.id && !row.teamId).length }]).filter(team => team.count > 0) },
    testing, workouts, usage,
    overview: { playersWithD1: rows.filter(row => row.performance?.d1 != null).length,
      averageD1: rows.some(row => row.performance?.d1 != null) ? rows.reduce((sum, row) => sum + (row.performance?.d1 || 0), 0) / rows.filter(row => row.performance?.d1 != null).length : null,
      playersWithChange: rows.filter(row => row.performance?.change != null).length,
      improved: rows.filter(row => (row.performance?.change || 0) > 2).length,
      planPlayers: rows.filter(row => row.performance?.sessionsPlanned != null && row.performance.sessionsPlanned > 0).length,
      keepingUp: rows.filter(row => row.performance?.sessionsPlanned != null && row.performance.sessionsPlanned > 0 && (row.performance.sessionsDone || 0) * 2 >= row.performance.sessionsPlanned).length,
      coachFollowUp: rows.filter(row => (row.performance?.needsYouReasons.length || 0) > 0).length,
      needsYouPlayers: rows.filter(row => (row.performance?.needsYouReasons.length || 0) > 0)
        .map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), reasons: row.performance?.needsYouReasons || [] }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      noTestingPlayers: rows.filter(row => row.testing.status === "noRecordedTests").map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim() })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      noWorkoutPlayers: rows.filter(row => row.workouts.status === "none").map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim() })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) },
    players: visible.slice(page * 25, (page + 1) * 25), pagination: { total: visible.length, pageSize: 25, nextCursor: (page + 1) * 25 < visible.length ? `synthetic-page-${page + 1}` : null } };
}

/** A player selection is scoped independently of roster filters and its visible page. */
export function previewInsightPlayer(request: ExpandedRequest, playerId: string, state: string, role: InsightAccess) {
  const unfiltered = { ...request, ...clearPlayerFilters(), rosterSearch: "", cursor: "", page: 0 };
  let page = 0, data = previewInsights(unfiltered, page, state, role);
  while (true) {
    const player = data.players.find(row => row.id === playerId);
    if (player || !data.pagination.nextCursor) return player;
    data = previewInsights(unfiltered, ++page, state, role);
  }
}

/** These fixtures contain aggregate data, not another sample athlete's private records. */
export function previewPlayerSummary(player: ExpandedPlayer) {
  return athleteSummary({ id: player.id, firstName: player.firstName, lastName: player.lastName,
    age: player.age, organizationId: player.organizationId, teamId: player.teamId }, [], [], []);
}
