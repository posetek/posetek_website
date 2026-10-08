"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { activePlan, planProgress, playerPerformance } = require("./insights-overview");
const { recentD1Change, overallD1 } = require("./insights-axis-scoring");
const DAY = 86400000, NOW = Date.UTC(2026, 9, 6, 12);
const plan = { id: "plan", data: { status: "active", activatedAt: NOW - 10 * DAY,
  startDate: "2026-09-27", sessionsPerWeek: 2, timezone: "UTC",
  weeks: [{ workouts: [{ workoutId: "one" }, { workoutId: "two" }] }] } };
const event = (at, time, extra = {}) => ({ at, qualified: true, drill: "sprint", profileMetrics: { sprintCompletionTime: time }, ...extra });
test("latest active plan excludes drafts and preserves missing-plan counts", () => {
  assert.equal(activePlan([plan, { id: "draft", data: { status: "draft", activatedAt: NOW } }]).id, "plan");
  assert.deepEqual(planProgress(null, [], NOW), { sessionsDone: null, sessionsPlanned: null, activePlan: false, planAgeDays: null });
});
test("plan progress counts unique current assigned slots and excludes foreign, adhoc and future endings", () => {
  const log = { id: "plan_one", planId: "plan", workoutId: "one", endedAt: NOW - DAY, endReason: "completed" };
  const result = planProgress(plan, [log, log, { ...log, planId: "other" }, { ...log, source: "adhoc" },
    { ...log, workoutId: "unknown" }, { ...log, id: "plan_two", workoutId: "two", endedAt: NOW + DAY }], NOW);
  assert.equal(result.sessionsDone, 1); assert.equal(result.sessionsPlanned, 3);
});
test("confirmed schedule counts actual weekdays rather than estimated frequency", () => {
  const scheduled = { ...plan, data: { ...plan.data, intake: { trainingContext: { startDate: "2026-09-27", scheduleConfirmed: true, sessionDays: [1, 4] } } } };
  assert.equal(planProgress(scheduled, [], NOW).sessionsPlanned, 3);
});
test("D1 change uses local test dates and ignores duplicates, failed and undated results", () => {
  const events = [event(Date.UTC(2026, 9, 5, 1), 2), event(Date.UTC(2026, 9, 6, 1), 4),
    event(NOW, 0.5, { duplicate: true }), event(NOW, 0.5, { qualified: false }), event(null, 0.5)];
  const result = recentD1Change(events, "America/Los_Angeles");
  assert.equal(result.previousTestDate, "2026-10-04"); assert.equal(result.lastTestDate, "2026-10-05");
  assert.ok(Math.abs(result.change + 46) < 1e-10);
  assert.equal(overallD1([]), null);
});
test("follow-up reports threshold reasons while future tests do not contribute", () => {
  const result = playerPerformance({ testing: [event(NOW - 2 * DAY, 2), event(NOW - DAY, 4), event(NOW + DAY, 0.5)],
    profile: {}, training: { plan, logs: [] }, now: NOW, endMillis: NOW, timeZone: "UTC" });
  assert.deepEqual(result.needsYouReasons, ["D1 down at least 5 points", "No sign-in recorded", "Behind on training"]);
  assert.ok(Math.abs(result.d1 - 92) < 1e-10);
});
test("unusable explicit plan timezones retain absolute completions without inventing calendar targets", () => {
  const log = { id: "plan_one", planId: "plan", workoutId: "one", endedAt: NOW - DAY, endReason: "completed" };
  for (const timezone of ["not-a-timezone", "", null, 42]) {
    const invalid = { ...plan, data: { ...plan.data, timezone } };
    const progress = planProgress(invalid, [log], NOW);
    assert.equal(progress.sessionsDone, 1); assert.equal(progress.sessionsPlanned, null);
    assert.equal(progress.planAgeDays, 10); assert.equal(progress.activePlan, true);
    const performance = playerPerformance({ testing: [], profile: { lastLogin: NOW }, training: { plan: invalid, logs: [log] },
      now: NOW, endMillis: NOW + 1, timeZone: "UTC" });
    assert.deepEqual(performance.needsYouReasons, []);
  }
  const { timezone: _timezone, ...withoutTimezone } = plan.data;
  assert.equal(planProgress({ ...plan, data: withoutTimezone }, [], NOW).sessionsPlanned, 3);
  assert.equal(planProgress({ ...plan, data: { status: "active", startDate: "2026-09-27", sessionsPerWeek: 2, timezone: "invalid" } }, [], NOW).planAgeDays, null);
});
test("rolling training targets use the plan timezone, confirmed start, and exact absolute ending bounds", () => {
  const at = Date.UTC(2026, 9, 7, 1); // Still Tuesday in Los Angeles, Wednesday in UTC.
  const scheduled = timezone => ({ id: "plan", data: { ...plan.data, timezone,
    intake: { trainingContext: { startDate: "2026-09-30", scheduleConfirmed: true, sessionDays: [3, 6] } } } });
  const ending = (id, time) => ({ id: `plan_${id}`, planId: "plan", workoutId: id, endedAt: time, endReason: "completed" });
  const logs = [ending("one", at - 14 * DAY), ending("two", at), ending("unknown", at),
    { ...ending("one", at - 1), id: "mirror" }, ending("two", at + 1)];
  assert.equal(planProgress(scheduled("America/Los_Angeles"), logs, at).sessionsPlanned, 2);
  assert.equal(planProgress(scheduled("UTC"), logs, at).sessionsPlanned, 3);
  assert.equal(planProgress(scheduled("America/Los_Angeles"), logs, at).sessionsDone, 2);
  assert.equal(planProgress(scheduled("UTC"), [ending("one", at - 14 * DAY - 1)], at).sessionsDone, 0);
  const future = scheduled("UTC"); future.data.intake.trainingContext.startDate = "2026-10-08";
  assert.equal(planProgress(future, [], at).sessionsPlanned, 0);
});
