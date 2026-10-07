"use strict";

const { millis } = require("./insights-v2-qualification");
const { overallD1, recentD1Change } = require("./insights-axis-scoring");
const DAY = 86400000;
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function activePlan(plans) {
  return plans.filter(plan => plan.data?.status === "active").sort((a, b) =>
    (millis(b.data.activatedAt ?? b.data.generatedAt) ?? 0) - (millis(a.data.activatedAt ?? a.data.generatedAt) ?? 0))[0] || null;
}
function planProgress(planRow, logs, now) {
  if (!planRow) return { sessionsDone: null, sessionsPlanned: null, activePlan: false, planAgeDays: null };
  const plan = planRow.data, context = plan.intake?.trainingContext || plan.trainingContext || {};
  const timezone = typeof plan.timezone === "string" ? plan.timezone : "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const recentStart = new Date(Date.parse(`${today}T12:00:00Z`) - 13 * DAY).toISOString().slice(0, 10);
  const startDate = validDate(context.startDate) ? context.startDate : validDate(plan.startDate) ? plan.startDate : null;
  const intervalStart = startDate && startDate > recentStart ? startDate : recentStart;
  const activeDays = startDate && intervalStart <= today ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${intervalStart}T12:00:00Z`)) / DAY) + 1 : 0;
  let sessionsPlanned = null;
  const weekdays = Array.isArray(context.sessionDays) ? [...new Set(context.sessionDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
  const perWeek = Number(plan.sessionsPerWeek ?? plan.intake?.sessionsPerWeek);
  if (context.scheduleConfirmed === true && weekdays.length && weekdays.length === perWeek && startDate) {
    sessionsPlanned = 0;
    for (let date = intervalStart; activeDays > 0 && date <= today; date = new Date(Date.parse(`${date}T12:00:00Z`) + DAY).toISOString().slice(0, 10)) {
      if (weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) sessionsPlanned++;
    }
  } else {
    if (Number.isFinite(perWeek) && perWeek > 0 && perWeek <= 7 && startDate && activeDays > 0) sessionsPlanned = Math.ceil(perWeek * activeDays / 7);
  }
  const planIds = new Set([planRow.id, plan.planId].filter(value => typeof value === "string" && value));
  const slots = new Set((Array.isArray(plan.weeks) ? plan.weeks : []).flatMap(week => Array.isArray(week?.workouts) ? week.workouts.map(workout => workout?.workoutId).filter(value => typeof value === "string" && value) : []));
  const done = new Set();
  for (const log of logs) {
    if (!planIds.has(log.planId) || log.source === "adhoc" || !log.workoutId || slots.size && !slots.has(log.workoutId)) continue;
    if (log.id && log.id !== `${log.planId}_${log.workoutId}`) continue;
    if (log.endReason === "completed" && millis(log.endedAt) !== null && millis(log.endedAt) >= now - 14 * DAY && millis(log.endedAt) <= now) done.add(log.workoutId);
  }
  const activatedAt = millis(plan.activatedAt ?? plan.generatedAt) ?? (startDate ? Date.parse(`${startDate}T00:00:00Z`) : null);
  return { sessionsDone: done.size, sessionsPlanned, activePlan: true,
    planAgeDays: activatedAt === null ? null : Math.max(0, Math.floor((now - activatedAt) / DAY)) };
}
function playerPerformance({ testing, profile, training, now, endMillis, timeZone }) {
  const tests = testing.filter(event => event.at !== null && event.at < endMillis);
  const change = recentD1Change(tests, timeZone);
  const progress = planProgress(training?.plan || null, training?.logs || [], now);
  const reasons = [];
  const changePoints = change.change === null ? null : Math.round(change.change);
  if (changePoints !== null && changePoints <= -5) reasons.push("D1 down at least 5 points");
  if (progress.activePlan && progress.planAgeDays !== null && progress.planAgeDays >= 3 && millis(profile.lastLogin) === null) reasons.push("No sign-in recorded");
  if (progress.activePlan && progress.planAgeDays !== null && progress.planAgeDays >= 7 && progress.sessionsPlanned > 0
    && progress.sessionsDone * 2 < progress.sessionsPlanned) reasons.push("Behind on training");
  return { d1: overallD1(tests), change: changePoints, lastTestDate: change.lastTestDate,
    previousTestDate: change.previousTestDate || null, ...progress, needsYouReasons: reasons };
}
module.exports = { activePlan, planProgress, playerPerformance };
