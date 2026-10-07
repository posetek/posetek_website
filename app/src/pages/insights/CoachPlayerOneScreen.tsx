import { useMemo } from "react";
import type { AthleteSummary } from "../coach-dashboard/lib/logic";
import type { ExpandedPlayer, CoachTestScore } from "./lib/expanded";
import { coachPlanLabel, coachSessionRows, summaryDateLabel, validSummaryDay } from "./lib/coachPlayerSummary";

const TESTS = [
  { key: "shooting", label: "Shooting" }, { key: "sprint", label: "Sprint" },
  { key: "jump", label: "Vertical jump" }, { key: "broadJump", label: "Broad jump" },
  { key: "changeOfDirection", label: "Agility" }, { key: "dribbling", label: "Dribbling" },
];

export default function CoachPlayerOneScreen({ summary, performance, testScores, period, generatedAtMillis = Date.now(), onPrescribe, disabled = false }: {
  summary: AthleteSummary; performance?: ExpandedPlayer["performance"]; testScores?: CoachTestScore[];
  period?: { endDate: string; timeZone: string }; generatedAtMillis?: number; onPrescribe: () => void; disabled?: boolean;
}) {
  const plan = summary.plan, asOf = Number.isFinite(generatedAtMillis) ? generatedAtMillis : Date.now();
  const history = useMemo(() => coachSessionRows(summary, asOf, period?.timeZone || "UTC"), [summary, asOf, period?.timeZone]);
  const overall = performance?.d1 ?? null, change = performance?.change ?? null, reasons = performance?.needsYouReasons || [];
  const stage = !performance ? "Standing unavailable" : overall === null ? "Not enough measured tests" : overall >= 100 ? "At standard" : overall >= 85 ? "Approaching" : overall >= 65 ? "Developing" : "Early stage";
  const changeLabel = !performance ? "Change unavailable" : change === null ? "Needs two tests" : Math.abs(change) <= 2 ? "Within 2 points" : "D1 points";
  const currentName = `${summary.athlete?.firstName || "Player"} ${summary.athlete?.lastName || ""}`.trim();
  const coachNote = plan?.coachNote || plan?.coachNotes || plan?.intake?.coachNote;
  const recordedTest = plan?.nextTestDate || plan?.retestDate || plan?.assessment?.nextTestDate;
  const nextTest = validSummaryDay(recordedTest) ? recordedTest : null;
  const trainingKnown = performance?.activePlan && performance.sessionsDone !== null && performance.sessionsPlanned !== null;
  return <section className="coach-player-one-screen" aria-label="Player progress at a glance">
    <header className="coach-player-glance-heading"><h2>{currentName}</h2><button className="primary-cta" type="button" onClick={onPrescribe} disabled={disabled}>Prescribe workouts</button></header>
    <dl className="coach-snapshot-stats coach-player-summary" aria-label={`${currentName}: ${overall === null ? stage : `${Math.round(overall)}% of D1`}; ${changeLabel}`}>
      <div><dt>D1 standing</dt><dd className="coach-snapshot-value">{overall === null ? "—" : `${Math.round(overall)}%`}</dd><dd>{stage}</dd></div>
      <div><dt>Since last test</dt><dd className="coach-snapshot-value">{change === null ? "—" : Math.abs(change) <= 2 ? "Same" : `${change > 0 ? "▲ +" : "▼ −"}${Math.abs(change)}`}{change !== null && Math.abs(change) > 2 && <small> pts</small>}</dd><dd>{changeLabel}</dd></div>
      <div><dt>Training / 14 days</dt>{!performance ? <><dd className="coach-snapshot-value">—</dd><dd>Training unavailable</dd></> : performance.activePlan ? <>
        <dd className="coach-snapshot-value">{trainingKnown ? <>{performance.sessionsDone}<small> of {performance.sessionsPlanned}</small></> : "—"}</dd>
        <dd>{trainingKnown ? "Last 14 days" : performance.sessionsDone === null ? "Completion unavailable" : "Schedule unavailable"}</dd><dd>{coachPlanLabel(plan, asOf)}</dd>
      </> : <><dd className="coach-snapshot-value">—</dd><dd>No active plan · <button type="button" className="insights-text-button" onClick={onPrescribe} disabled={disabled}>Create one</button></dd></>}</div>
      <div className={reasons.length ? "coach-snapshot-need" : ""}><dt>Needs you</dt><dd className="coach-snapshot-value">{performance ? reasons.length : "—"}</dd><dd>{!performance ? "Follow-up unavailable" : reasons.length ? reasons.join(" · ") : "Nothing flagged"}</dd></div>
    </dl>
    <p className="insights-note">Standing uses best measured results{period ? ` through ${period.endDate}` : " through the selected end"}. Change compares the latest two test dates{period ? ` in ${period.timeZone}` : ""}. Test cards show each test’s latest measured result.</p>
    <div className="coach-player-test-grid" aria-label="Six tests compared with D1">
      {TESTS.map(test => {
        const score = testScores?.find(row => row.drill === test.key);
        const label = !score ? "Unavailable" : score.score === null ? "Not tested" : `${Math.round(score.score)}%`;
        return <div className="coach-player-test" key={test.key}>
          <div className="coach-player-test-label"><strong>{test.label}</strong><span>{label}</span></div>
          <div className="coach-player-test-track" role="img" aria-label={`${test.label}: ${label}`}><span style={{ width: `${Math.min(Math.max(score?.score ?? 0, 0), 100)}%` }} /><i aria-hidden="true" /></div>
          <small>{!score ? "Test summary unavailable" : score.change === null ? score.score === null ? "Not tested" : "No prior test" : Math.abs(score.change) <= 2 ? "Same · within 2 pts" : `${score.change > 0 ? "▲ +" : "▼ −"}${Math.abs(score.change)} pts`}{score?.lastTestDate && ` · ${summaryDateLabel(score.lastTestDate, true)}`}</small>
        </div>;
      })}
    </div>
    <div className="coach-player-glance-lower">
      <section className="coach-player-session-strip" aria-label="Last six sessions"><h3>Last six sessions</h3>{history.length ? <ol>{history.map(row => <li key={row.id} className={`is-${row.status.toLowerCase().replaceAll(" ", "-")}`} title={row.title}><strong>{row.status}</strong><span>{summaryDateLabel(row.date, true)}</span></li>)}</ol> : <p>No recent sessions recorded{plan && "; missed sessions need a confirmed schedule"}.</p>}</section>
      <section className="coach-player-coach-notes"><h3>Coach note & next test</h3><p><strong>Coach note:</strong> {typeof coachNote === "string" && coachNote.trim() ? coachNote : "No coach note recorded"}</p><p><strong>Next test:</strong> {summaryDateLabel(nextTest)}</p></section>
    </div>
  </section>;
}
