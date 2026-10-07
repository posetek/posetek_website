import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SignupStatus from "../admin/views/SignupStatus";
import { TESTING_LABELS } from "./lib/expanded";
import type { ExpandedInsights, ExpandedPlayer } from "./lib/expanded";

function shortDate(date: string | null | undefined) {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : date || "";
}

export default function CoachRoster({ data, search, page, onSearch, onPrevious, onNext, playerLink, onOpen, preview = false, collapsible = false, disclosureOpen, onDisclosureChange }: {
  data: ExpandedInsights; search: string; page: number; onSearch: (value: string) => void;
  onPrevious: () => void; onNext: () => void; playerLink: (player: ExpandedPlayer) => string;
  onOpen?: () => void; preview?: boolean; collapsible?: boolean;
  disclosureOpen?: boolean; onDisclosureChange?: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);
  const start = page * data.pagination.pageSize + (data.players.length ? 1 : 0);
  const end = page * data.pagination.pageSize + data.players.length;
  const content = <section className="insights-card coach-roster" aria-labelledby="coach-roster-heading">
    <div className="insights-section-title"><h2 id="coach-roster-heading">Roster</h2><span>{data.pagination.total} matching players</span></div>
    <form className="coach-roster-search" onSubmit={event => { event.preventDefault(); onSearch(draft.trim()); }}>
      <label>Find a player<input type="search" value={draft} maxLength={120} placeholder="Search by name" onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit" className="quiet-button">Search</button>{search && <button type="button" className="insights-text-button" onClick={() => { setDraft(""); onSearch(""); }}>Clear search</button>}
    </form>
    {data.players.length ? <div className="insights-table-wrap"><table className="insights-table coach-roster-table"><caption className="insights-sr-only">Current roster and reporting-period activity</caption>
      <thead><tr>{["Player", "D1 standing", "Since last test", "Testing"].map(label => <th scope="col" key={label}>{label}</th>)}<th scope="col" className="coach-training-heading"><span>Training</span><span>14 days</span></th>{["Workouts completed", "Needs you", "Signup actions"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.players.map(player => {
        const name = `${player.firstName} ${player.lastName}`.trim() || "Player";
        return <tr key={player.id} className={player.performance?.needsYouReasons?.length ? "is-needs-you" : undefined}
          onClick={event => {
            if ((event.target as HTMLElement).closest("a, button, input, select, textarea, summary")) return;
            navigate(playerLink(player));
          }}>
          <th scope="row"><Link to={playerLink(player)} onClick={onOpen}>{name}</Link></th>
          <td data-label="D1 standing">{player.performance?.d1 == null ? "Not enough qualified testing" : <><strong>{Math.round(player.performance.d1)}% of D1</strong><span className="insights-subtle">{player.performance.d1 >= 100 ? "At standard" : player.performance.d1 >= 85 ? "Approaching" : player.performance.d1 >= 65 ? "Developing" : "Early stage"}</span></>}</td>
          <td data-label="Since last test">{player.performance?.change == null ? "Not enough tests" : Math.abs(player.performance.change) <= 2 ? <><strong>Same</strong><span className="insights-subtle">Within 2 points</span></> : <><strong>{player.performance.change > 0 ? "▲ +" : "▼ -"}{Math.abs(player.performance.change)} pts</strong><span className="insights-subtle"><span className="coach-roster-date">{shortDate(player.performance.previousTestDate)}</span> → <span className="coach-roster-date">{shortDate(player.performance.lastTestDate)}</span></span></>}</td>
          <td data-label="Testing"><span className={`insights-status ${player.testing.status === "fullyTested" ? "full" : player.testing.status === "partiallyTested" ? "partial" : ""}`}>{TESTING_LABELS[player.testing.status] || player.testing.status}</span><span className="insights-subtle">{player.testing.exercisesComplete}/6</span>{player.testing.hasDateUnknownAttempts ? <span className="insights-subtle">Date unknown; needs review</span> : null}</td>
          <td data-label="Training · 14 days">{!player.performance?.activePlan ? "No active plan" : player.performance.sessionsPlanned == null ? "Schedule unavailable" : `${player.performance.sessionsDone} of ${player.performance.sessionsPlanned}`}</td>
          <td data-label="Workouts completed">{player.workouts.completed}</td>
          <td data-label="Needs you">{player.performance?.needsYouReasons?.length ? <ul className="coach-needs-you">{player.performance.needsYouReasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <span className="insights-subtle">—</span>}</td>
          <td data-label="Signup actions" className="coach-roster-signup">{preview ? <span className="insights-subtle">Preview · invitation actions disabled</span> : <SignupStatus playerId={player.id} playerName={name} registered={player.registered} reloadKey={data.generatedAtMillis} variant="club" />}</td>
        </tr>;
      })}</tbody></table></div> : <p>{search ? "No players match that name. Try another name or clear the search." : "No players match this selection. Check your filters or add a player below."}</p>}
    <div className="insights-pagination"><span>{data.players.length ? `${start}–${end} of ${data.pagination.total}` : "0 players"}{search ? " · Name search only changes this roster; reporting totals stay the same." : ""}</span><div><button type="button" className="quiet-button" disabled={page === 0} onClick={onPrevious}>Previous</button><button type="button" className="quiet-button" disabled={!data.pagination.nextCursor} onClick={onNext}>Next</button></div></div>
  </section>;
  return collapsible ? <details className="insights-roster-disclosure coach-roster-disclosure" open={disclosureOpen} onToggle={event => onDisclosureChange?.(event.currentTarget.open)}>
    <summary><strong>Roster</strong><span>{data.pagination.total.toLocaleString()} matching players</span><span className="material-symbols-outlined" aria-hidden="true">expand_more</span></summary>
    {content}
  </details> : content;
}
