import { Link } from "react-router-dom";
import type { ExpandedInsights } from "./lib/expanded";

function snapshotDate(date: string, includeYear = false) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(includeYear ? { year: "numeric" as const } : {}), timeZone: "UTC",
  });
}

function PlayerNames({ players, playerLink, label, tone }: { players?: { id: string; name: string; reasons?: string[] }[]; playerLink: (player: { id: string }) => string; label: string; tone?: "warning" }) {
  if (!players) return <span className="coach-snapshot-none">Player names unavailable</span>;
  return players.length ? <ul className={`coach-snapshot-names${tone ? ` is-${tone}` : ""}`} aria-label={label}>{players.map(player => <li key={player.id}><Link to={playerLink(player)} title={player.reasons?.join(" · ")}>{player.name || "Player"}</Link></li>)}</ul> : <span className="coach-snapshot-none">None</span>;
}

/** One card answers the coach's four questions: D1 standing, change since the last test, training, and who needs follow-up. */
export default function CoachOverviewSnapshot({ data, playerLink = player => `/insights?view=player&playerId=${encodeURIComponent(player.id)}` }: { data: ExpandedInsights; playerLink?: (player: { id: string }) => string }) {
  const overview = data.overview;
  const noTests = data.testing.statuses.find(row => row.key === "noRecordedTests")?.count || 0;
  const noWorkoutStatus = data.workouts.statuses.find(row => row.key === "none")?.count || 0;
  const startYear = Number(data.period.startDate.slice(0, 4)), endYear = Number(data.period.endDate.slice(0, 4));
  const dateRange = startYear === endYear
    ? `${snapshotDate(data.period.startDate)}–${snapshotDate(data.period.endDate)}, ${endYear}`
    : `${snapshotDate(data.period.startDate, true)}–${snapshotDate(data.period.endDate, true)}`;
  const needYou = overview?.needsYouPlayers;
  return <section className="coach-snapshot" aria-label="Team snapshot">
    <header className="coach-snapshot-head"><h2 id="coach-snapshot-heading">Team snapshot</h2><span>{dateRange}</span></header>
    {data.participation ? <p>In {dateRange}, <strong>{data.participation.testingPlayers} of {data.roster.filtered}</strong> players recorded testing and <strong>{data.participation.workoutPlayers}</strong> recorded workout activity.</p> : <p>Participation summary unavailable for this period.</p>}
    <dl className="coach-snapshot-stats">
      <div><dt>D1 standing</dt><dd className="coach-snapshot-value">{overview?.averageD1 == null ? "—" : `${Math.round(overview.averageD1)}%`}</dd><dd>{overview ? <>team average · {overview.playersWithD1} of {data.roster.filtered} tested</> : "Standing summary unavailable"}</dd></div>
      <div><dt>Since last test</dt><dd className="coach-snapshot-value">{overview ? <>{overview.improved}<small> of {overview.playersWithChange}</small></> : "—"}</dd><dd>{overview ? "improved by more than 2 points" : "Change summary unavailable"}</dd></div>
      <div><dt>Training</dt><dd className="coach-snapshot-value">{overview ? <>{overview.keepingUp}<small> of {overview.planPlayers}</small></> : "—"}</dd><dd>{overview ? "keeping up · last 14 days" : "Training summary unavailable"}</dd></div>
      <div className="coach-snapshot-need"><dt>Need you</dt><dd className="coach-snapshot-value">{overview ? overview.coachFollowUp : "—"}</dd><dd>{overview ? overview.coachFollowUp > 0 ? "reasons in the roster" : "no follow-up needed" : "Follow-up summary unavailable"}</dd></div>
    </dl>
    <div className="coach-snapshot-lists">
      {(overview?.coachFollowUp || 0) > 0 && <div className="coach-snapshot-list"><span className="coach-snapshot-list-label is-warning">Need you <b>{overview?.coachFollowUp}</b></span><PlayerNames players={needYou} playerLink={playerLink} label="Players who need you" tone="warning" /></div>}
      <div className="coach-snapshot-list"><span className="coach-snapshot-list-label">Not tested{data.testingMode === "cumulative" ? "" : " this window"} <b>{noTests.toLocaleString()}</b></span><PlayerNames players={overview?.noTestingPlayers} playerLink={playerLink} label="Players with no recorded testing" /></div>
      <div className="coach-snapshot-list"><span className="coach-snapshot-list-label">No workout status <b>{noWorkoutStatus.toLocaleString()}</b></span><PlayerNames players={overview?.noWorkoutPlayers} playerLink={playerLink} label="Players with no available workout status in this period" /></div>
    </div>

  </section>;
}
