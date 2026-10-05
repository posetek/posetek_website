import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SignupStatus from "../admin/views/SignupStatus";
import { minuteText, TESTING_LABELS } from "./lib/expanded";
import type { ExpandedInsights, ExpandedPlayer } from "./lib/expanded";

export default function CoachRoster({ data, search, page, onSearch, onPrevious, onNext, playerLink, onOpen, preview = false, collapsible = false }: {
  data: ExpandedInsights; search: string; page: number; onSearch: (value: string) => void;
  onPrevious: () => void; onNext: () => void; playerLink: (player: ExpandedPlayer) => string;
  onOpen?: () => void; preview?: boolean; collapsible?: boolean;
}) {
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);
  const start = page * data.pagination.pageSize + (data.players.length ? 1 : 0);
  const end = page * data.pagination.pageSize + data.players.length;
  const content = <section className="insights-card coach-roster" aria-labelledby="coach-roster-heading">
    <div className="insights-section-title"><div><h2 id="coach-roster-heading">Roster</h2><p className="insights-note">Testing {data.testingMode === "cumulative" ? `through ${data.period.endDate}` : "in selected period"} · Workouts and active use {data.period.startDate}–{data.period.endDate}</p></div><span>{data.pagination.total} matching players</span></div>
    <form className="coach-roster-search" onSubmit={event => { event.preventDefault(); onSearch(draft.trim()); }}>
      <label>Find a player<input type="search" value={draft} maxLength={120} placeholder="Search by name" onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit" className="quiet-button">Search</button>{search && <button type="button" className="insights-text-button" onClick={() => { setDraft(""); onSearch(""); }}>Clear search</button>}
    </form>
    {data.players.length ? <div className="insights-table-wrap"><table className="insights-table coach-roster-table"><caption className="insights-sr-only">Current roster and reporting-period activity</caption>
      <thead><tr>{["Player", "Age", "Testing", "Workouts completed", "Estimated active use", "Signup actions"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.players.map(player => {
        const name = `${player.firstName} ${player.lastName}`.trim() || "Player";
        return <tr key={player.id}>
          <th scope="row"><Link to={playerLink(player)} onClick={onOpen}>{name}<span aria-hidden="true"> ↗</span></Link></th>
          <td data-label="Age">{player.age === null ? "Not recorded" : player.age}</td>
          <td data-label="Testing"><span className={`insights-status ${player.testing.status === "fullyTested" ? "full" : player.testing.status === "partiallyTested" ? "partial" : ""}`}>{TESTING_LABELS[player.testing.status] || player.testing.status}</span><span className="insights-subtle">{player.testing.exercisesComplete}/6 exercises{player.testing.hasDateUnknownAttempts ? " · Date unknown; needs review" : ""}</span></td>
          <td data-label="Workouts completed">{player.workouts.completed}</td>
          <td data-label="Estimated active use">{minuteText(player.usage.activeMinutes, player.usage.collected)}</td>
          <td data-label="Signup actions" className="coach-roster-signup">{preview ? <span className="insights-subtle">Preview · invitation actions disabled</span> : <SignupStatus playerId={player.id} playerName={name} registered={player.registered} reloadKey={data.generatedAtMillis} variant="club" />}</td>
        </tr>;
      })}</tbody></table></div> : <p>{search ? "No players match that name. Try another name or clear the search." : "No players match this selection. Check your filters or add a player below."}</p>}
    <div className="insights-pagination"><span>{data.players.length ? `${start}–${end} of ${data.pagination.total}` : "0 players"}{search ? " · Name search only changes this roster; reporting totals stay the same." : ""}</span><div><button type="button" className="quiet-button" disabled={page === 0} onClick={onPrevious}>Previous</button><button type="button" className="quiet-button" disabled={!data.pagination.nextCursor} onClick={onNext}>Next</button></div></div>
  </section>;
  return collapsible ? <details className="insights-roster-disclosure coach-roster-disclosure">
    <summary><strong>Roster</strong><span>{data.pagination.total.toLocaleString()} matching players</span><span className="material-symbols-outlined" aria-hidden="true">expand_more</span></summary>
    {content}
  </details> : content;
}
