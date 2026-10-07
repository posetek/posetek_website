import { useMemo } from "react";
import { buildProfile } from "../../components/athlete-stats/AthleteStats";
import { currentWeekNumber, planHorizonWeeks } from "../athlete-portal/lib/training";
import { orderedWeeks, orderedWorkouts } from "../../lib/contracts/planV3";
import { workoutHistory } from "../coach-dashboard/lib/history";
import type { AthleteSummary } from "../coach-dashboard/lib/logic";

const TESTS = [
  { key: "shooting", label: "Shooting", drills: ["shooting"], section: "striking" },
  { key: "sprint", label: "Sprint", drills: ["sprint"], section: "speed" },
  { key: "jump", label: "Vertical jump", drills: ["jump"], section: "power" },
  { key: "broadJump", label: "Broad jump", drills: ["broadJump"], section: "power" },
  { key: "changeOfDirection", label: "Agility", drills: ["changeOfDirection"], section: "agility" },
  { key: "dribbling", label: "Dribbling", drills: ["dribbling"], section: "ballControl" },
] as const;

function repDate(rep: any, timezone: string) {
  const raw = rep.createdAtMillis ?? rep.createdAt ?? rep.timestamp;
  const value = typeof raw === "number" ? raw : typeof raw?.toMillis === "function" ? raw.toMillis() : typeof raw === "string" ? Date.parse(raw) : null;
  if (!Number.isFinite(value)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function scoreAt(reps: any[], test: typeof TESTS[number]) {
  const result = buildProfile(reps);
  const metrics = result.sections[test.section]?.metrics.filter(metric => metric.drills.some(drill => (test.drills as readonly string[]).includes(drill))) || [];
  return metrics.length ? metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length : null;
}
function testResults(reps: any[], timezone: string) {
  const byTest = new Map<string, Map<string, any[]>>();
  for (const test of TESTS) byTest.set(test.key, new Map());
  for (const rep of reps) {
    const drill = String(rep._statsDrill || rep.repType || rep.drillType || "");
    const test = TESTS.find(candidate => (candidate.drills as readonly string[]).includes(drill));
    const date = repDate(rep, timezone);
    if (!test || !date) continue;
    const days = byTest.get(test.key)!;
    days.set(date, [...(days.get(date) || []), rep]);
  }
  return TESTS.map(test => {
    const snapshots = [...byTest.get(test.key)!.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, score: scoreAt(rows, test) })).filter(row => row.score !== null);
    const current = snapshots.at(-1) || null, previous = snapshots.at(-2) || null;
    return { ...test, score: current?.score ?? null, change: current && previous ? Math.round(current.score! - previous.score!) : null,
      date: current?.date ?? null };
  });
}
function dateLabel(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not scheduled";
}
function sessionDateLabel(value: string | null) {
  if (!value) return "Date unavailable";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
function isoDay(value: any, timezone: string) {
  const raw = typeof value === "string" ? value : value?.toDate?.()?.toISOString?.().slice(0, 10);
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const millis = typeof value?.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : null;
  return Number.isFinite(millis) ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(millis)) : null;
}
function sessionRows(summary: AthleteSummary, now = new Date()) {
  const plan = summary.plan;
  const timezone = typeof plan?.timezone === "string" ? plan.timezone : "UTC";
  const logged = workoutHistory(summary.logs).filter(row => row.status === "completed" || row.status === "endedEarly" || row.status === "abandoned").map(row => ({
    id: `log:${row.id}`, date: isoDay(row.end ?? row.start, timezone),
    title: row.snapshot?.title || "Training session",
    status: row.status === "completed" ? "Done" : "Ended early",
  }));
  const context = plan?.intake?.trainingContext || plan?.trainingContext || {};
  const weekdays = Array.isArray(context.sessionDays) ? [...new Set(context.sessionDays.filter((day: unknown) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6))] : [];
  const expected = Number(plan?.sessionsPerWeek ?? plan?.intake?.sessionsPerWeek ?? plan?.intake?.daysPerWeek ?? context.sessionsPerWeek);
  const validPlanStart = typeof plan?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(plan.startDate) && Number.isFinite(Date.parse(`${plan.startDate}T12:00:00Z`));
  const canMarkMissed = context.scheduleConfirmed === true && weekdays.length > 0 && weekdays.length === expected && validPlanStart;
  const missed: { id: string; date: string; title: string; status: string }[] = [];
  if (canMarkMissed) {
    const activeIds = new Set([plan.id, plan.planId].filter(Boolean));
    const consumed = new Set(summary.logs.filter(log => activeIds.has(log.planId) && log.workoutId && (log.startedAt || log.endedAt))
      .map(log => `${log.planId}:${log.workoutId}`));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const start = plan.startDate;
    for (let date = start; date < today; date = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const slot = weekdays.indexOf(weekday);
      if (slot < 0) continue;
      const weekNumber = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / (7 * 86400000)) + 1;
      const week = orderedWeeks(plan).find(entry => Number(entry.weekNumber) === weekNumber);
      const workout: any = week ? orderedWorkouts(week)[slot] : null;
      if (!workout?.workoutId) continue;
      const planId = String(plan.planId || plan.id || "");
      if (consumed.has(`${planId}:${workout.workoutId}`)) continue;
      missed.push({ id: `missed:${date}:${workout.workoutId}`, date, title: workout.title || "Planned session", status: "Missed" });
    }
  }
  return [...logged, ...missed].filter(row => row.date).sort((a, b) => b.date!.localeCompare(a.date!) || a.id.localeCompare(b.id)).slice(0, 6);
}

export default function CoachPlayerOneScreen({ summary, onPrescribe, disabled = false }: { summary: AthleteSummary; onPrescribe: () => void; disabled?: boolean }) {
  const plan = summary.plan;
  const timezone = typeof plan?.timezone === "string" ? plan.timezone : "UTC";
  const tests = useMemo(() => testResults(summary.reps, timezone), [summary.reps, timezone]);
  const history = useMemo(() => sessionRows(summary), [summary]);
  const weekly = Number(plan?.sessionsPerWeek ?? plan?.intake?.sessionsPerWeek ?? plan?.intake?.daysPerWeek ?? plan?.intake?.trainingContext?.sessionsPerWeek);
  const week = plan ? currentWeekNumber(plan) : null, horizon = plan ? planHorizonWeeks(plan) : null;
  const orderedSnapshots = [...new Set(summary.reps.map(rep => repDate(rep, timezone)).filter(Boolean) as string[])].sort();
  const latestScore = orderedSnapshots.length ? buildProfile(summary.reps.filter(rep => repDate(rep, timezone) === orderedSnapshots.at(-1))).overall : null;
  const previousScore = orderedSnapshots.length > 1 ? buildProfile(summary.reps.filter(rep => repDate(rep, timezone) === orderedSnapshots.at(-2))).overall : null;
  const overall = latestScore ?? summary.profile.overall;
  const overallChange = latestScore !== null && previousScore !== null ? Math.round(latestScore - previousScore) : null;
  const level = overall === null ? "not enough measured tests" : overall >= 100 ? "at the D1 standard" : overall >= 85 ? "approaching the D1 standard" : overall >= 65 ? "developing toward the D1 standard" : "early in the D1 comparison";
  const changeText = overallChange === null ? "change since the last test is not available yet" : Math.abs(overallChange) <= 2 ? "same within 2 points since the last test" : `${overallChange > 0 ? "up" : "down"} ${Math.round(Math.abs(overallChange))} points since the last test`;
  const weekStart = plan?.startDate && week ? new Date(Date.parse(`${plan.startDate}T12:00:00Z`) + (week - 1) * 7 * 86400000).toISOString().slice(0, 10) : null;
  const weekEnd = weekStart ? new Date(Date.parse(`${weekStart}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10) : null;
  const doneThisWeek = plan ? workoutHistory(summary.logs).filter(row => {
    const day = isoDay(row.end ?? row.start, timezone);
    return row.log.planId === (plan.planId || plan.id) && row.status === "completed" && day !== null && day >= (weekStart || "") && day < (weekEnd || "");
  }).length : 0;
  const coachNote = plan?.coachNote || plan?.coachNotes || plan?.intake?.coachNote || plan?.notes || null;
  const explicitNextTest = plan?.nextTestDate || plan?.retestDate || plan?.assessment?.nextTestDate;
  const retestWeek = plan && plan.schemaVersion !== 3 ? Number(plan.horizonWeeks || plan.weeks?.length || 0) : null;
  const nextTest = isoDay(explicitNextTest, timezone) || (retestWeek && plan?.startDate ? new Date(Date.parse(`${plan.startDate}T12:00:00Z`) + (retestWeek - 1) * 7 * 86400000).toISOString().slice(0, 10) : null);
  const followUp = [...(overallChange !== null && overallChange <= -5 ? ["D1 down at least 5 points"] : []),
    ...(plan && summary.athlete?.lastLogin == null && plan.activatedAt && Date.now() - (typeof plan.activatedAt?.toMillis === "function" ? plan.activatedAt.toMillis() : new Date(plan.activatedAt).valueOf()) >= 3 * 86400000 ? ["no sign-in recorded"] : []),
    ...(history.some(row => row.status === "Missed") ? ["missed scheduled sessions"] : []),
    ...(history.some(row => row.status === "Ended early") ? ["sessions ended early"] : [])];
  const currentName = `${summary.athlete?.firstName || "Player"} ${summary.athlete?.lastName || ""}`.trim();
  const stage = overall === null ? "Not enough measured tests" : overall >= 100 ? "At standard" : overall >= 85 ? "Approaching" : overall >= 65 ? "Developing" : "Early stage";
  const reasons = followUp.map(reason => reason[0].toUpperCase() + reason.slice(1));
  return <section className="coach-player-one-screen" aria-label="Player progress at a glance">
    <header className="coach-player-glance-heading"><h2>{currentName}</h2><button className="primary-cta" type="button" onClick={onPrescribe} disabled={disabled}>Prescribe workouts</button></header>
    <dl className="coach-snapshot-stats coach-player-summary" aria-label={`${currentName}: ${overall === null ? "no D1 score yet" : `${Math.round(overall)}% of D1, ${level}`}; ${changeText}`}>
      <div><dt>D1 standing</dt><dd className="coach-snapshot-value">{overall === null ? "—" : `${Math.round(overall)}%`}</dd><dd>{stage}</dd></div>
      <div><dt>Since last test</dt><dd className="coach-snapshot-value">{overallChange === null ? "—" : Math.abs(overallChange) <= 2 ? "Same" : `${overallChange > 0 ? "▲ +" : "▼ −"}${Math.abs(overallChange)}`}{overallChange !== null && Math.abs(overallChange) > 2 && <small> pts</small>}</dd><dd>{overallChange === null ? "Needs two tests" : Math.abs(overallChange) <= 2 ? "Within 2 points" : "D1 points"}</dd></div>
      <div><dt>Training</dt>{plan ? <><dd className="coach-snapshot-value">{doneThisWeek}<small> of {Number.isFinite(weekly) ? weekly : "?"}</small></dd><dd>this week · week {week} of {horizon}</dd></> : <><dd className="coach-snapshot-value">—</dd><dd>No active plan · <button type="button" className="insights-text-button" onClick={onPrescribe} disabled={disabled}>Create one</button></dd></>}</div>
      <div className={reasons.length ? "coach-snapshot-need" : ""}><dt>Needs you</dt><dd className="coach-snapshot-value">{reasons.length || "—"}</dd><dd>{reasons.length ? reasons.join(" · ") : "Nothing flagged"}</dd></div>
    </dl>
    <div className="coach-player-test-grid" aria-label="Six tests compared with D1">
      {tests.map(test => <div className="coach-player-test" key={test.key}>
        <div className="coach-player-test-label"><strong>{test.label}</strong><span>{test.score === null ? "Not tested" : `${Math.round(test.score)}%`}</span></div>
        <div className="coach-player-test-track" role="img" aria-label={`${test.label}: ${test.score === null ? "not tested" : `${Math.round(test.score)} percent of D1`}`}><span style={{ width: `${Math.min(test.score ?? 0, 100)}%` }} /><i aria-hidden="true" /></div>
        <small>{test.change === null ? test.score === null ? "Not tested" : "No prior test" : Math.abs(test.change) <= 2 ? "Same · within 2 pts" : `${test.change > 0 ? "▲ +" : "▼ -"}${Math.abs(test.change)} pts`}</small>
      </div>)}
    </div>
    <div className="coach-player-glance-lower">
      <section className="coach-player-session-strip" aria-label="Last six sessions"><h3>Last six sessions</h3>{history.length ? <ol>{history.map(row => <li key={row.id} className={`is-${row.status.toLowerCase().replaceAll(" ", "-")}`} title={row.title}><strong>{row.status}</strong><span>{sessionDateLabel(row.date)}</span></li>)}</ol> : <p>No recent sessions recorded{plan && "; missed sessions need a confirmed schedule"}.</p>}</section>
      <section className="coach-player-coach-notes"><h3>Coach note & next test</h3><p><strong>Coach note:</strong> {typeof coachNote === "string" && coachNote.trim() ? coachNote : "No coach note recorded"}</p><p><strong>Next test:</strong> {dateLabel(nextTest)}</p></section>
    </div>
  </section>;
}
