"use strict";

const { createHash } = require("node:crypto");
const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, activeMember } = require("./club-access");
const { EXERCISES, testingStatus, demographics } = require("./insights-v2-qualification");
const { createInsightProjection, completeQuery, mapBounded, PROJECTION_VERSION } = require("./insights-v2-projection");
const { readPlayerUsage, FEATURES } = require("./insight-usage");
const { comparePlayer } = require("./insights-axis-scoring");
const DAY = 86400000;
const FILTERS = Object.freeze({ division: ["boys", "girls", "unknown"], ageBand: ["under10", "10-12", "13-15", "16-18", "19+", "unknown"],
  testingStatus: ["fullyTested", "partiallyTested", "noSuccessfulTests", "noRecordedTests"],
  workoutStatus: ["completed", "inProgress", "endedEarly", "abandoned", "none"], usageStatus: ["returning", "active", "inactive", "notCollected"],
  usagePlatform: ["web", "ios", "both"], usageFeature: FEATURES, teamAssignment: ["assigned", "unassigned"] });
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tidy = value => typeof value === "string" ? value.slice(0, 120) : "";
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
const counts = (keys, rows, keyOf) => keys.map(key => ({ key, count: rows.filter(row => keyOf(row) === key).length }));
const dateFormatters = new Map();
function localDate(at, timeZone) {
  if (!dateFormatters.has(timeZone)) {
    if (dateFormatters.size >= 128) dateFormatters.clear();
    dateFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
  }
  const parts = dateFormatters.get(timeZone).formatToParts(new Date(at));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shiftDate(date, count) { return new Date(Date.parse(`${date}T12:00:00Z`) + count * DAY).toISOString().slice(0, 10); }
function localWeekStart(date) { return shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)); }
function verifiedProgress(rows, period, now) {
  const first = localWeekStart(period.startDate), last = localWeekStart(period.endDate), weeks = [];
  for (let week = first; week <= last; week = shiftDate(week, 7)) weeks.push(week);
  const series = new Map();
  for (const row of rows) for (const event of row.history.testing) {
    if (!event.qualified || event.at === null || event.at < period.startMillis || event.at >= period.endMillis || event.at > now) continue;
    const metric = event.metric, expectedUnit = ["shooting", "sprint"].includes(event.drill) ? "m/s"
      : ["jump", "broadJump"].includes(event.drill) ? "m" : ["changeOfDirection", "dribbling"].includes(event.drill) ? "s" : null;
    if (!expectedUnit || metric?.unit !== expectedUnit || typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value <= 0) continue;
    if (!series.has(event.drill)) series.set(event.drill, { drill: event.drill, unit: expectedUnit, lowerIsBetter: expectedUnit === "s", samples: 0,
      playerIds: new Set(), weeks: new Map(weeks.map(weekStart => [weekStart, { weekStart, best: null, samples: 0, playerIds: new Set() }])) });
    const entry = series.get(event.drill), week = entry.weeks.get(localWeekStart(localDate(event.at, period.timeZone)));
    if (!week) continue;
    entry.samples++; entry.playerIds.add(row.id); week.samples++; week.playerIds.add(row.id);
    if (week.best === null || (entry.lowerIsBetter ? metric.value < week.best : metric.value > week.best)) week.best = metric.value;
  }
  return EXERCISES.filter(drill => series.has(drill)).map(drill => {
    const entry = series.get(drill);
    return { drill, unit: entry.unit, lowerIsBetter: entry.lowerIsBetter, samples: entry.samples, players: entry.playerIds.size,
      weeks: [...entry.weeks.values()].map(week => ({ weekStart: week.weekStart, best: week.best, samples: week.samples, players: week.playerIds.size })) };
  });
}
function midnight(date, timeZone) {
  const guess = Date.parse(`${date}T00:00:00Z`);
  let low = guess - 2 * DAY, high = guess + 2 * DAY;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(middle, timeZone) < date) low = middle + 1; else high = middle;
  }
  if (localDate(low, timeZone) !== date) throw new Error("Local date does not exist");
  return low;
}
function periodOf(data, now, fail) {
  const timeZone = data.timeZone ?? "America/Los_Angeles";
  if (typeof timeZone !== "string" || timeZone.length > 100) fail("invalid-argument", "Choose a valid IANA time zone.");
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); } catch { fail("invalid-argument", "Choose a valid IANA time zone."); }
  const today = localDate(now, timeZone), endDate = data.endDate ?? today, startDate = data.startDate ?? shiftDate(endDate, -55);
  const valid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(startDate) || !valid(endDate) || startDate > endDate || endDate > today
    || Date.parse(endDate) - Date.parse(startDate) > 365 * DAY) fail("invalid-argument", "Choose a valid date range of at most 366 dates, ending today or earlier.");
  try { return { startDate, endDate, timeZone, startMillis: midnight(startDate, timeZone), endMillis: midnight(shiftDate(endDate, 1), timeZone) }; }
  catch { fail("invalid-argument", "Choose dates that exist in the selected time zone."); }
}
function summarizeWorkouts(events, period, now) {
  const inside = at => at !== null && at >= period.startMillis && at < period.endMillis && at <= now;
  const selected = events.filter(event => event.at !== null && event.at <= now && (inside(event.at) || inside(event.end)));
  const safe = selected.map(event => {
    if (event.end !== null && (event.end < event.at || event.end > now)) return { ...event, startedInPeriod: inside(event.at), endedInPeriod: false,
      status: "unknown", timerMinutes: 0, estimatedMinutes: 0, durationSource: "unknown", unknownDuration: 1, allPrescribedSetsCompleted: 0 };
    const endedInPeriod = inside(event.end);
    return { ...event, startedInPeriod: inside(event.at), endedInPeriod, status: event.end !== null && !endedInPeriod ? "outsidePeriod" : event.status,
      ...(event.end !== null && !endedInPeriod ? { timerMinutes: 0, estimatedMinutes: 0, allPrescribedSetsCompleted: 0 } : {}) };
  });
  const output = { started: safe.filter(e => e.startedInPeriod).length, completed: safe.filter(e => e.status === "completed").length,
    inProgress: safe.filter(e => e.status === "inProgress").length, endedEarly: safe.filter(e => e.status === "endedEarly").length,
    abandoned: safe.filter(e => e.status === "abandoned").length, unknownEnding: safe.filter(e => e.status === "unknown").length };
  const outcomes = safe.filter(event => event.status !== "outsidePeriod");
  output.outcomeEvents = outcomes.length;
  output.timerRecords = outcomes.filter(event => event.durationSource === "timer").length;
  output.estimatedRecords = outcomes.filter(event => event.durationSource === "estimate").length;
  output.knownPrescription = outcomes.filter(event => event.unknownPrescription === 0).length;
  for (const field of ["duplicateLogs", "doneBlocks", "partialBlocks", "skippedBlocks", "setsCompleted", "timerMinutes", "estimatedMinutes", "allPrescribedSetsCompleted", "unknownPrescription"]) output[field] = sum(outcomes, field);
  output.unknownDuration = output.outcomeEvents - output.timerRecords - output.estimatedRecords;
  output.status = ["completed", "inProgress", "endedEarly", "abandoned"].find(key => output[key] > 0) || "none";
  return { ...output, events: safe };
}
function createInsightsV2({ db, bucket, HttpsError, now = () => Date.now(), maxPlayers = 5000,
  maxOrganizations = 500, maxTeams = 2000, maxRebuilds = 25, projection: suppliedProjection,
  usageReader = readPlayerUsage, ...projectionOptions }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  for (const [value, maximum] of [[maxPlayers, 5000], [maxOrganizations, 500], [maxTeams, 2000], [maxRebuilds, 25]]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error("Invalid Insights processing limits");
  }
  const projection = suppliedProjection || createInsightProjection({ db, bucket, HttpsError, now, ...projectionOptions });
  const ref = path => db.doc(path);
  // Directory internals never enter the allowlisted callable response.
  const independentAuthorities = new WeakMap();
  async function directory(caller, transaction) {
    const admin = isClubAdmin(caller), read = reference => transaction ? transaction.get(reference) : reference.get();
    const organizations = await completeQuery(db.collection("organizations"), maxOrganizations, HttpsError, 250, read);
    let managed = false;
    const result = await mapBounded(organizations.filter(doc => doc.data()?.schemaVersion === 2), 8, async doc => {
      const org = transaction ? await read(doc.ref) : doc;
      if (!org.exists || org.data()?.schemaVersion !== 2) return null;
      const member = admin ? null : (await read(ref(`organizations/${doc.id}/members/${caller.uid}`))).data();
      // An inactive or malformed club membership cannot turn into legacy access.
      if (member) managed = true;
      if (!admin && (!activeMember(member, caller.uid) || !member.teamIds.every(playerSegment))) return null;
      const teamDocs = await completeQuery(db.collection("teams").where("organizationId", "==", doc.id), maxTeams, HttpsError, 250, read);
      const teams = [];
      for (const row of teamDocs) {
        const fresh = transaction ? await read(row.ref) : row;
        if (fresh.exists && fresh.data()?.organizationId === doc.id && (admin || member.role === "manager" || member.teamIds.includes(row.id))) {
          teams.push({ id: row.id, name: tidy(fresh.data().name) || "Team" });
        }
      }
      return { id: doc.id, name: tidy(org.data().name) || "Organization", role: admin ? "admin" : member.role, teams };
    });
    const choices = { global: admin, organizations: result.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), coachRoster: null };
    if (!admin) {
      const coaches = await completeQuery(db.collection("coaches").where("userUID", "==", caller.uid), 20, HttpsError, 20, read);
      if (coaches.some(doc => Object.hasOwn(doc.data(), "organizationId") || Object.hasOwn(doc.data(), "organizationRole"))) managed = true;
      if (!managed && coaches.length === 1) {
        const coach = coaches[0], members = [...new Set((Array.isArray(coach.data().members) ? coach.data().members : []).filter(playerSegment))];
        if (members.length > maxPlayers) fail("resource-exhausted", "The complete roster exceeds the current reporting bound.");
        choices.coachRoster = { coachId: coach.id, label: "My roster" };
        independentAuthorities.set(choices, { uid: caller.uid, coachId: coach.id, members });
      }
    }
    return choices;
  }
  function resolveScope(input, choices) {
    if (!input || !["global", "organization", "team", "coachRoster"].includes(input.kind)) fail("invalid-argument", "Choose an explicit report scope.");
    if (input.kind === "coachRoster") {
      if (input.organizationId || input.teamId || input.coachId || input.coachUID) fail("invalid-argument", "My roster is resolved from your signed-in account.");
      if (!choices.coachRoster) fail("permission-denied", "An independent coach profile with active access is required.");
      return { kind: "coachRoster", ...choices.coachRoster, access: "coach", assignedTeamsOnly: false };
    }
    if (input.kind === "global") {
      if (!choices.global) fail("permission-denied", "Global Insights requires administrator access.");
      if (input.organizationId || input.teamId) fail("invalid-argument", "Global scope does not accept team identifiers.");
      return { kind: "global", label: "All organizations", access: "admin", assignedTeamsOnly: false };
    }
    if (!playerSegment(input.organizationId) || (input.kind === "team" && !playerSegment(input.teamId))) fail("invalid-argument", "Choose a valid organization and team.");
    const org = choices.organizations.find(row => row.id === input.organizationId);
    if (!org) fail("permission-denied", "You no longer have access to this organization.");
    const team = input.kind === "team" ? org.teams.find(row => row.id === input.teamId) : null;
    if (input.kind === "team" && !team) fail("permission-denied", "You no longer have access to this team.");
    return { kind: input.kind, organizationId: org.id, ...(team ? { teamId: team.id } : {}),
      label: team?.name || (org.role === "coach" ? `${org.name} · Assigned teams` : org.name), access: org.role, assignedTeamsOnly: org.role === "coach" };
  }
  function inScope(profile, scope, choices, playerId) {
    if (scope.kind === "coachRoster") {
      const authority = independentAuthorities.get(choices);
      if (!authority || Object.hasOwn(profile, "organizationId")) return false;
      // Match the canonical legacyAssignedCoachData rule as well as the
      // effective-results callable: every listed row must open its profile,
      // plans and logs through the existing client permissions.
      const coachDocument = Object.hasOwn(profile, "coachDocId") ? profile.coachDocId : authority.uid;
      return [profile.coachUID, profile.coachId, profile.coachDocId].includes(authority.uid)
        || (coachDocument === authority.coachId && authority.members.includes(playerId));
    }
    const org = choices.organizations.find(row => row.id === profile.organizationId);
    if (!org || (scope.kind !== "global" && org.id !== scope.organizationId)) return false;
    if (scope.kind === "team" && profile.teamId !== scope.teamId) return false;
    return org.role !== "coach" || org.teams.some(team => team.id === profile.teamId);
  }
  async function rosterFor(scope, choices, read = query => query.get()) {
    const snapshots = new Map();
    const append = docs => {
      for (const doc of docs) if (doc.exists && inScope(doc.data(), scope, choices, doc.id)) snapshots.set(doc.id, doc);
      if (snapshots.size > maxPlayers) fail("resource-exhausted", "The complete roster exceeds the current reporting bound. No partial total was returned.");
    };
    if (scope.kind === "coachRoster") {
      const authority = independentAuthorities.get(choices);
      append(await mapBounded(authority.members, 8, id => read(ref(`players/${id}`))));
      for (const field of ["coachUID", "coachId", "coachDocId"]) for (const id of new Set([authority.uid, authority.coachId])) {
        append(await completeQuery(db.collection("players").where(field, "==", id), maxPlayers, HttpsError, 250, read));
      }
    } else {
      for (const org of choices.organizations.filter(org => scope.kind === "global" || org.id === scope.organizationId)) {
        let query = db.collection("players").where("organizationId", "==", org.id);
        if (scope.kind === "team") query = query.where("teamId", "==", scope.teamId);
        append(await completeQuery(query, maxPlayers, HttpsError, 250, read));
      }
    }
    return [...snapshots.values()];
  }
  async function report(data, caller, comparison = false) {
    if (!caller?.uid || !playerSegment(caller.uid) || caller.isAnonymous === true) fail("unauthenticated", "Sign in to continue.");
    data ||= {};
    const generatedAtMillis = now(), period = periodOf(data, generatedAtMillis, fail), testingMode = data.testingMode ?? "cumulative";
    if (!["cumulative", "period"].includes(testingMode)) fail("invalid-argument", "Choose cumulative or period testing.");
    const filters = data.filters || {};
    if (typeof filters !== "object" || Array.isArray(filters) || Object.entries(filters).some(([key, value]) => !Object.hasOwn(FILTERS, key) || !FILTERS[key].includes(value))) fail("invalid-argument", "Choose valid report filters.");
    const pageSize = data.pageSize ?? 50;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) fail("invalid-argument", "Choose a page size between 1 and 100.");
    if (data.nameSearch !== undefined && (typeof data.nameSearch !== "string" || data.nameSearch.length > 120)) fail("invalid-argument", "Keep roster searches under 120 characters.");
    const nameSearch = (data.nameSearch || "").trim();
    if (comparison && (!playerSegment(data.playerId) || !["team", "coachRoster"].includes(data.scope?.kind))) fail("invalid-argument", "Choose a player and a team or independent roster.");
    const choices = await directory(caller), scope = resolveScope(data.scope, choices);
    const snapshots = await rosterFor(scope, choices);
    if (comparison && !snapshots.some(doc => doc.id === data.playerId)) fail("permission-denied", "This player is not in the selected roster.");
    let rebuilds = 0, facts = 0;
    const loaded = await mapBounded(snapshots, 4, async doc => {
      const reporting = (await ref(`players/${doc.id}/insightMetadata/reporting`).get()).data() || {};
      if (reporting.include === false) return { id: doc.id, excluded: true };
      const [history, usage] = await Promise.all([projection.loadInsightPlayer(doc.id, { allowRebuild: () => rebuilds++ < maxRebuilds }),
        usageReader(db, doc.id, period.startMillis, Math.min(period.endMillis, generatedAtMillis), period.timeZone)]);
      if (!history) fail("aborted", "A player changed during loading. Retry to refresh the complete roster.");
      if (usage.complete !== true) fail("failed-precondition", "Usage history is incomplete. Retry after the report is rebuilt.");
      facts += history.testing.length + history.workouts.length + history.failures.length;
      if (facts > 200000) fail("resource-exhausted", "The complete history exceeds the current reporting bound. No partial total was returned.");
      return { id: doc.id, history, usage };
    });
    // Authorize at response time and refresh canonical ownership and reporting
    // inclusion in one read-only transaction. Cached ownership is never a grant.
    const fresh = await db.runTransaction(async transaction => {
      const currentChoices = await directory(caller, transaction), currentScope = resolveScope(data.scope, currentChoices);
      const currentRosterIds = (await rosterFor(currentScope, currentChoices, query => transaction.get(query))).map(doc => doc.id);
      if (hash(currentRosterIds.sort()) !== hash(snapshots.map(doc => doc.id).sort())) fail("aborted", "The roster changed. Retry to refresh every player in the report.");
      const rows = await mapBounded(loaded.filter(Boolean), 8, async row => {
        const [profile, reporting, summary, state] = await Promise.all([
          transaction.get(ref(`players/${row.id}`)), transaction.get(ref(`players/${row.id}/insightMetadata/reporting`)),
          row.history ? transaction.get(ref(`players/${row.id}/insightSummaries/current`)) : null,
          row.history ? transaction.get(ref(`players/${row.id}/insightSummaries/state`)) : null,
        ]);
        if (!profile.exists || !inScope(profile.data(), currentScope, currentChoices, row.id)) return null;
        if (reporting.data()?.include === false) return { id: row.id, excluded: true };
        if (row.excluded) fail("aborted", "Reporting inclusion changed. Retry to refresh the complete report.");
        if (summary.data()?.revisionId !== row.history.summary.revisionId || (state.data()?.token || null) !== row.history.summary.token) fail("aborted", "Player data changed. Retry to refresh the report.");
        return { ...row, profile: profile.data(), reporting: reporting.data() || {} };
      });
      return { choices: currentChoices, scope: currentScope, rows: rows.filter(Boolean) };
    }, { readOnly: true });
    const validEnd = Math.min(period.endMillis, generatedAtMillis + 1);
    const allRows = fresh.rows.filter(row => !row.excluded).map(row => {
      const org = fresh.choices.organizations.find(o => o.id === row.profile.organizationId);
      const team = org?.teams.find(t => t.id === row.profile.teamId);
      const selected = row.history.testing.filter(event => event.at !== null && event.at < validEnd
        && (testingMode === "cumulative" || event.at >= period.startMillis));
      const status = testingStatus(selected);
      const dateUnknownAttempts = sum(row.history.testing.filter(event => event.at === null), "attempt");
      if (status.status === "noRecordedTests" && dateUnknownAttempts > 0) status.status = "noSuccessfulTests";
      const testing = { ...status, missingExerciseKeys: EXERCISES.filter(key => !status.exerciseKeys.includes(key)),
        dateUnknownAttempts, hasDateUnknownAttempts: dateUnknownAttempts > 0,
        undatedDocuments: row.history.testing.filter(event => event.at === null).length,
        futureDatedDocuments: row.history.testing.filter(event => event.at > generatedAtMillis).length };
      const workouts = summarizeWorkouts(row.history.workouts, period, generatedAtMillis);
      const usage = { ...row.usage, status: !row.usage.collected ? "notCollected" : row.usage.returning ? "returning" : row.usage.totalMillis > 0 ? "active" : "inactive" };
      return { ...row, organizationId: org?.id || "", organizationName: org?.name || "", teamId: team?.id || null, teamName: team?.name || null,
        firstName: tidy(row.profile.firstName), lastName: tidy(row.profile.lastName), ...demographics(row.profile, row.reporting, generatedAtMillis), testing, workouts, usage, selected };
    });
    if (comparison) {
      const player = allRows.find(row => row.id === data.playerId);
      if (!player) fail("permission-denied", "This player is unavailable in the selected report.");
      const rebuilt = allRows.map(row => row.history.summary.rebuiltAtMillis);
      return { schemaVersion: 1, scope: fresh.scope, period, testingMode, generatedAtMillis,
        freshness: { complete: true, projectionVersion: PROJECTION_VERSION, oldestRebuiltAtMillis: rebuilt.length ? Math.min(...rebuilt) : null,
          newestRebuiltAtMillis: rebuilt.length ? Math.max(...rebuilt) : null, qualification: "verified-artifacts", historicalOwnership: "current" },
        player: { id: player.id, firstName: player.firstName, lastName: player.lastName, age: player.age },
        roster: { total: fresh.rows.length, included: allRows.length, excluded: fresh.rows.filter(row => row.excluded).length },
        axes: comparePlayer(allRows, data.playerId) };
    }
    const rows = allRows.filter(row => Object.entries(filters).every(([key, value]) => {
      if (key === "division" || key === "ageBand") return row[key] === value;
      if (key === "teamAssignment") return (row.teamId ? "assigned" : "unassigned") === value;
      if (key === "usagePlatform") return (value === "both" ? row.usage.overlapMillis : row.usage[`${value}Millis`] - row.usage.overlapMillis) > 0;
      if (key === "usageFeature") return (row.usage.featureMillis[value] || 0) > 0;
      return row[key.replace("Status", "")].status === value;
    })).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`) || a.id.localeCompare(b.id));
    const rosterRows = rows.filter(row => `${row.firstName} ${row.lastName}`.toLocaleLowerCase("en-US").includes(nameSearch.toLocaleLowerCase("en-US")));
    const fingerprint = hash([caller.uid, fresh.scope, period, testingMode, filters, nameSearch, rows.map(row => [row.id, row.history.summary.revisionId, row.usage.latestAtMillis, row.division, row.ageBand, row.teamId])]);
    let offset = 0;
    if (data.cursor !== undefined) {
      try { const parsed = JSON.parse(Buffer.from(data.cursor, "base64url").toString()); if (parsed.fingerprint !== fingerprint || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0 || parsed.offset >= rosterRows.length) throw new Error(); offset = parsed.offset; }
      catch { fail("failed-precondition", "The report changed. Refresh the first page."); }
    }
    const dates = [];
    for (let date = period.startDate; date <= period.endDate; date = shiftDate(date, 1)) dates.push(date);
    const selectedTests = rows.flatMap(row => row.selected), allTests = rows.flatMap(row => row.history.testing), allFailures = rows.flatMap(row => row.history.failures),
      selectedFailures = allFailures.filter(event => event.at !== null && event.at >= period.startMillis && event.at < validEnd), workoutRows = rows.map(row => row.workouts), usageRows = rows.map(row => row.usage);
    const testDays = new Map(), workoutDays = new Map(), usageDays = new Map();
    for (const event of allTests) if (event.at !== null && event.at >= period.startMillis && event.at < validEnd) {
      const date = localDate(event.at, period.timeZone), value = testDays.get(date) || { date, recordedDocuments: 0, distinctAttempts: 0, qualifyingTests: 0, failureReports: 0, linkedFailureReports: 0, unmatchedFailureReports: 0 };
      value.recordedDocuments++; value.distinctAttempts += event.attempt; value.qualifyingTests += event.qualified; testDays.set(date, value);
    }
    for (const event of selectedFailures) {
      const date = localDate(event.at, period.timeZone), value = testDays.get(date) || { date, recordedDocuments: 0, distinctAttempts: 0, qualifyingTests: 0, failureReports: 0, linkedFailureReports: 0, unmatchedFailureReports: 0 };
      value.failureReports++; value.linkedFailureReports += event.linked; value.unmatchedFailureReports += event.unmatched; testDays.set(date, value);
    }
    for (const event of workoutRows.flatMap(row => row.events)) {
      const startDate = localDate(event.at, period.timeZone), endDate = event.endedInPeriod ? localDate(event.end, period.timeZone) : startDate;
      const get = date => { if (!workoutDays.has(date)) workoutDays.set(date, { date, started: 0, completed: 0, timerMinutes: 0, estimatedMinutes: 0 }); return workoutDays.get(date); };
      if (event.startedInPeriod) get(startDate).started++;
      if (event.status === "completed") get(endDate).completed++;
      if (event.endedInPeriod || event.end === null) { get(endDate).timerMinutes += event.timerMinutes; get(endDate).estimatedMinutes += event.estimatedMinutes; }
    }
    for (const day of usageRows.flatMap(row => row.days)) {
      const value = usageDays.get(day.date) || { date: day.date, activeMinutes: 0, webMinutes: 0, iosMinutes: 0 };
      value.activeMinutes += day.activeMillis / 60000; value.webMinutes += day.webMillis / 60000; value.iosMinutes += day.iosMillis / 60000;
      usageDays.set(day.date, value);
    }
    const testing = { statuses: counts(FILTERS.testingStatus, rows, row => row.testing.status), recordedDocuments: selectedTests.length,
      progress: verifiedProgress(rows, period, generatedAtMillis),
      failureReports: selectedFailures.length, linkedFailureReports: sum(selectedFailures, "linked"), unmatchedFailureReports: sum(selectedFailures, "unmatched"),
      undatedFailureReports: allFailures.filter(event => event.at === null).length, futureDatedFailureReports: allFailures.filter(event => event.at > generatedAtMillis).length,
      distinctAttempts: sum(selectedTests, "attempt"), qualifyingTests: sum(selectedTests, "qualified"), duplicateDocuments: sum(selectedTests, "duplicate"),
      needsReview: sum(selectedTests, "needsReview"), undatedDocuments: allTests.filter(e => e.at === null).length,
      noResultDocuments: selectedTests.filter(event => event.reason === "noPrimaryResult").length,
      futureDatedDocuments: allTests.filter(e => e.at > generatedAtMillis).length,
      exercises: EXERCISES.map(key => ({ key, playersQualified: rows.filter(row => row.testing.exerciseKeys.includes(key)).length,
        qualifyingTests: sum(selectedTests.filter(e => e.drill === key), "qualified"), distinctAttempts: sum(selectedTests.filter(e => e.drill === key), "attempt") })),
      days: dates.map(date => testDays.get(date) || { date, recordedDocuments: 0, distinctAttempts: 0, qualifyingTests: 0, failureReports: 0, linkedFailureReports: 0, unmatchedFailureReports: 0 }) };
    const workouts = { statuses: counts(FILTERS.workoutStatus, rows, row => row.workouts.status) };
    for (const key of ["started", "completed", "inProgress", "endedEarly", "abandoned", "unknownEnding", "outcomeEvents", "timerRecords", "estimatedRecords", "knownPrescription", "duplicateLogs", "doneBlocks", "partialBlocks", "skippedBlocks", "setsCompleted", "timerMinutes", "estimatedMinutes", "unknownDuration", "allPrescribedSetsCompleted", "unknownPrescription"]) workouts[key] = sum(workoutRows, key);
    workouts.days = dates.map(date => workoutDays.get(date) || { date, started: 0, completed: 0, timerMinutes: 0, estimatedMinutes: 0 });
    const firstCollected = usageRows.map(row => row.collectionStartedAtMillis).filter(Number.isFinite);
    const firstWeb = usageRows.map(row => row.webCollectionStartedAtMillis).filter(Number.isFinite), firstIos = usageRows.map(row => row.iosCollectionStartedAtMillis).filter(Number.isFinite);
    const collectionDates = ["collectionStartedAtMillis", "webCollectionStartedAtMillis", "iosCollectionStartedAtMillis"].map(field =>
      usageRows.filter(row => Number.isFinite(row[field])).map(row => localDate(row[field], period.timeZone)).sort());
    const collectionIndices = [0, 0, 0];
    const usage = { statuses: counts(FILTERS.usageStatus, rows, row => row.usage.status), collectedPlayers: usageRows.filter(r => r.collected).length,
      notCollectedPlayers: usageRows.filter(r => !r.collected).length, webCollectedPlayers: usageRows.filter(r => r.webCollected).length, iosCollectedPlayers: usageRows.filter(r => r.iosCollected).length,
      activePlayers: usageRows.filter(r => r.totalMillis > 0).length, returningPlayers: usageRows.filter(r => r.returning).length,
      activeMinutes: sum(usageRows, "totalMillis") / 60000, webMinutes: sum(usageRows, "webMillis") / 60000, iosMinutes: sum(usageRows, "iosMillis") / 60000,
      overlapMinutes: sum(usageRows, "overlapMillis") / 60000, collectionStartedAtMillis: firstCollected.length ? Math.min(...firstCollected) : null,
      webCollectionStartedAtMillis: firstWeb.length ? Math.min(...firstWeb) : null, iosCollectionStartedAtMillis: firstIos.length ? Math.min(...firstIos) : null,
      featureMinutes: Object.fromEntries(FEATURES.map(key => [key, usageRows.reduce((n, r) => n + (r.featureMillis[key] || 0), 0) / 60000])),
      days: dates.map(date => {
        for (let i = 0; i < 3; i++) while (collectionIndices[i] < collectionDates[i].length && collectionDates[i][collectionIndices[i]] <= date) collectionIndices[i]++;
        const [collectedPlayers, webCollectedPlayers, iosCollectedPlayers] = collectionIndices;
        const totals = usageDays.get(date);
        return { date, collectedPlayers, webCollectedPlayers, iosCollectedPlayers,
          activeMinutes: collectedPlayers ? totals?.activeMinutes || 0 : null, webMinutes: webCollectedPlayers ? totals?.webMinutes || 0 : null,
          iosMinutes: iosCollectedPlayers ? totals?.iosMinutes || 0 : null };
      }) };
    const page = rosterRows.slice(offset, offset + pageSize).map(row => ({ id: row.id, firstName: row.firstName, lastName: row.lastName,
      organizationId: row.organizationId, organizationName: row.organizationName, teamId: row.teamId, teamName: row.teamName,
      registered: row.profile.registered === true || Boolean(row.profile.authenticationUID || row.profile.userUID), signupInvitationReady: row.profile.signupInvitationReady === true,
      division: row.division, age: row.age, ageBand: row.ageBand, testing: row.testing,
      workouts: Object.fromEntries(["status", "started", "completed", "outcomeEvents", "timerRecords", "estimatedRecords", "unknownDuration", "knownPrescription", "timerMinutes", "estimatedMinutes", "allPrescribedSetsCompleted", "unknownPrescription"].map(key => [key, row.workouts[key]])),
      usage: { status: row.usage.status, collected: row.usage.collected, webCollected: row.usage.webCollected, iosCollected: row.usage.iosCollected,
        activeMinutes: row.usage.totalMillis / 60000, webMinutes: row.usage.webMillis / 60000, iosMinutes: row.usage.iosMillis / 60000, activeDays: row.usage.activeDays } }));
    const rebuilt = rows.map(row => row.history.summary.rebuiltAtMillis);
    const testingParticipants = new Set(rows.filter(row => row.history.testing.some(event => event.at !== null
      && event.at >= period.startMillis && event.at < validEnd)).map(row => row.id));
    const workoutParticipants = new Set(rows.filter(row => row.workouts.events.some(event => event.startedInPeriod || event.endedInPeriod)).map(row => row.id));
    return { schemaVersion: 2, scope: fresh.scope, choices: fresh.choices, period, testingMode, filters, nameSearch, generatedAtMillis,
      freshness: { complete: true, projectionVersion: PROJECTION_VERSION, oldestRebuiltAtMillis: rebuilt.length ? Math.min(...rebuilt) : null,
        newestRebuiltAtMillis: rebuilt.length ? Math.max(...rebuilt) : null, qualification: "verified-artifacts", historicalOwnership: "current" },
      roster: { total: fresh.rows.length, included: allRows.length, excluded: fresh.rows.filter(r => r.excluded).length, filtered: rows.length, ...(nameSearch ? { matched: rosterRows.length } : {}) },
      participation: { testingPlayers: testingParticipants.size, workoutPlayers: workoutParticipants.size,
        anyPlayers: new Set([...testingParticipants, ...workoutParticipants]).size },
      demographics: { division: counts(FILTERS.division, rows, row => row.division), ageBand: counts(FILTERS.ageBand, rows, row => row.ageBand) },
      scopeBreakdown: { organizations: fresh.choices.organizations.map(org => ({ id: org.id, name: org.name, count: rows.filter(row => row.organizationId === org.id).length })),
        teams: fresh.choices.organizations.filter(org => fresh.scope.kind === "global" || org.id === fresh.scope.organizationId)
          .flatMap(org => [...org.teams, ...(org.role === "coach" ? [] : [{ id: null, name: "Unassigned" }])].map(team => ({ id: team.id, organizationId: org.id, name: team.name, count: rows.filter(row => row.organizationId === org.id && row.teamId === team.id).length }))) },
      testing, workouts, usage, players: page, pagination: { total: rosterRows.length, pageSize,
        nextCursor: offset + pageSize < rosterRows.length ? Buffer.from(JSON.stringify({ offset: offset + pageSize, fingerprint })).toString("base64url") : null } };
  }
  const getClubInsightsV2 = (data, caller) => report(data, caller);
  const getCoachPlayerComparison = (data, caller) => report({ ...data, filters: {}, nameSearch: "", cursor: undefined, pageSize: 1 }, caller, true);
  return { getClubInsightsV2, getCoachPlayerComparison, ...projection };
}
module.exports = { createInsightsV2, periodOf, localDate, midnight, shiftDate, summarizeWorkouts, verifiedProgress, FILTERS };
