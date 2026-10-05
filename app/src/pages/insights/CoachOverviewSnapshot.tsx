import type { ExpandedInsights } from "./lib/expanded";
import { clearPlayerFilters } from "./lib/expandedQuery";

function snapshotDate(date: string, includeYear = false) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(includeYear ? { year: "numeric" as const } : {}), timeZone: "UTC",
  });
}

export default function CoachOverviewSnapshot({ data, onChange }: { data: ExpandedInsights; onChange: (patch: { view: "testing" | "workouts"; testingStatus?: string; workoutStatus?: string }) => void }) {
  const noTests = data.testing.statuses.find(row => row.key === "noRecordedTests")?.count || 0;
  const noWorkouts = data.workouts.statuses.find(row => row.key === "none")?.count || 0;
  const startYear = Number(data.period.startDate.slice(0, 4)), endYear = Number(data.period.endDate.slice(0, 4));
  const dateRange = startYear === endYear
    ? `${snapshotDate(data.period.startDate)}–${snapshotDate(data.period.endDate)}, ${endYear}`
    : `${snapshotDate(data.period.startDate, true)}–${snapshotDate(data.period.endDate, true)}`;
  const endDate = snapshotDate(data.period.endDate, true);
  return <section className="coach-overview-snapshot" aria-label="Team snapshot">
    <div className="coach-overview-narrative">
      <p className="eyebrow">Team snapshot</p>
      <p>In {dateRange}, <strong>{data.participation?.testingPlayers || 0} of {data.roster.filtered}</strong> players recorded testing and <strong>{data.participation?.workoutPlayers || 0}</strong> recorded workout activity.</p>
    </div>
    <div className="coach-overview-metrics" aria-label="Current team activity">
      <div><span>Players</span><strong>{data.roster.filtered.toLocaleString()}</strong></div>
      <div><span>Testing activity</span><strong>{data.participation?.testingPlayers || 0}</strong></div>
      <div><span>Workout activity</span><strong>{data.participation?.workoutPlayers || 0}</strong></div>
    </div>
    <section className="coach-overview-attention" aria-labelledby="coach-overview-attention-title">
      <div><h2 id="coach-overview-attention-title">Worth reviewing</h2><p>Activity signals only; a missing record does not show why a player was inactive.</p></div>
      <ul>
        <li><span><strong>{noTests.toLocaleString()}</strong> with no recorded testing {data.testingMode === "cumulative" ? `through ${endDate}` : "in the selected testing window"}</span><button type="button" className="quiet-button" onClick={() => onChange({ ...clearPlayerFilters(), view: "testing", testingStatus: "noRecordedTests" })}>Review testing</button></li>
        <li><span><strong>{noWorkouts.toLocaleString()}</strong> with no workout activity in this period</span><button type="button" className="quiet-button" onClick={() => onChange({ ...clearPlayerFilters(), view: "workouts", workoutStatus: "none" })}>Review workouts</button></li>
      </ul>
    </section>
  </section>;
}
