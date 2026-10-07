/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDays, currentWeekNumber, orderedWeeks, orderedWorkouts, planHorizonWeeks, workoutStates } from "../../../lib/contracts/planV3";
import { workoutHistory } from "../../coach-dashboard/lib/history";
import type { AthleteSummary } from "../../coach-dashboard/lib/logic";

const DAY = 86400000;
export function validSummaryDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function summaryTimeZone(value: unknown): string | null {
  const zone = value === undefined || value === null ? "UTC" : value;
  if (typeof zone !== "string" || !zone) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(); return zone; } catch { return null; }
}
function localDay(millis: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(millis));
}
export function summaryDateLabel(day: string | null, short = false) {
  return validSummaryDay(day) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(!short ? { year: "numeric" } as const : {}), timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)) : "Not scheduled";
}
function planCalendar(plan: any) {
  const context = plan?.intake?.trainingContext || plan?.trainingContext || {};
  const start = validSummaryDay(context.startDate) ? context.startDate : validSummaryDay(plan?.startDate) ? plan.startDate : null;
  const timezone = summaryTimeZone(plan?.timezone);
  const frequency = Number(plan?.sessionsPerWeek ?? plan?.intake?.sessionsPerWeek);
  return { context, start, timezone, frequency: Number.isInteger(frequency) && frequency > 0 && frequency <= 7 ? frequency : null };
}
function knownHorizon(plan: any) {
  const declared = Number(plan?.horizonWeeks);
  return Number.isSafeInteger(declared) && declared > 0 ? declared : Array.isArray(plan?.weeks) && plan.weeks.length ? planHorizonWeeks(plan) : null;
}
export function coachPlanLabel(plan: any, asOfMillis: number) {
  if (!plan) return "Plan details unavailable";
  const { start, timezone, frequency } = planCalendar(plan);
  const cadence = frequency === null ? "Cadence unavailable" : `${frequency} per week`;
  if (!start || !timezone) return `${cadence} · schedule unavailable`;
  const today = localDay(asOfMillis, timezone);
  if (today < start) return `${cadence} · starts ${summaryDateLabel(start)}`;
  const horizon = knownHorizon(plan);
  if (horizon === null) return `${cadence} · duration unavailable`;
  let windowEnd: string;
  try { windowEnd = addDays(start, horizon * 7); } catch { return `${cadence} · schedule unavailable`; }
  if (today >= windowEnd) return `${cadence} · plan period ended`;
  const week = currentWeekNumber({ ...plan, startDate: start, timezone }, new Date(asOfMillis));
  return `${cadence} · week ${week} of ${horizon}`;
}

/** Current completed/ended sessions; missed slots require a confirmed calendar. */
export function coachSessionRows(summary: AthleteSummary, asOfMillis: number, displayTimezone: string) {
  const plan = summary.plan, calendar = planCalendar(plan);
  const zone = (plan && calendar.timezone) || summaryTimeZone(displayTimezone) || "UTC";
  const logged = workoutHistory(summary.logs).flatMap(row => {
    if (!["completed", "endedEarly", "abandoned"].includes(row.status) || row.end === null || row.end <= 0 || row.end > asOfMillis
      || row.start !== null && (row.start <= 0 || row.end < row.start)) return [];
    return [{ id: `log:${row.id}`, date: localDay(row.end, zone), title: row.snapshot?.title || "Training session",
      status: row.status === "completed" ? "Done" : row.status === "abandoned" ? "Abandoned" : "Ended early" }];
  });
  const missed: { id: string; date: string; title: string; status: string }[] = [];
  const weekdays = Array.isArray(calendar.context.sessionDays) ? [...new Set<number>(calendar.context.sessionDays.filter((day: unknown) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6))] : [];
  const horizon = knownHorizon(plan);
  let planEnd: string | null = null;
  if (calendar.start && horizon !== null) try { planEnd = addDays(calendar.start, horizon * 7); } catch { /* Invalid legacy date arithmetic cannot imply missed sessions. */ }
  if (plan && planEnd && calendar.timezone && calendar.start && calendar.context.scheduleConfirmed === true && weekdays.length > 0 && weekdays.length === calendar.frequency) {
    const today = localDay(asOfMillis, calendar.timezone);
    // Only recent dates can enter a six-session strip. Do not scan years of stale schedules.
    const first = [calendar.start, addDays(today, -13)].sort().at(-1)!;
    const ids = new Set([plan.id, plan.planId].filter(Boolean));
    const consumed = workoutStates([...ids], summary.logs.filter(log => {
        const value = log.startedAt ?? log.endedAt;
        const at = typeof value?.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : null;
        return typeof at === "number" && Number.isFinite(at) && at > 0 && at <= asOfMillis;
      }));
    for (let date = first; date < today && date < planEnd; date = addDays(date, 1)) {
      const slot = weekdays.indexOf(new Date(`${date}T12:00:00Z`).getUTCDay());
      if (slot < 0) continue;
      const weekNumber = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${calendar.start}T12:00:00Z`)) / (7 * DAY)) + 1;
      const week = orderedWeeks(plan).find(entry => Number(entry.weekNumber) === weekNumber), workout: any = week ? orderedWorkouts(week)[slot] : null;
      if (!workout?.workoutId || consumed.has(String(workout.workoutId))) continue;
      missed.push({ id: `missed:${date}:${workout.workoutId}`, date, title: workout.title || "Planned session", status: "Missed" });
    }
  }
  return [...logged, ...missed].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, 6);
}
