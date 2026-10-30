// Port of athlete-mobile-pages.js renderLeaderboards/loadTeamStandings/setupLeaderboards.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { fullName } from "../lib/metrics";
import { LEADERBOARD_CATEGORIES, boardSummary, initials, rankRows } from "../lib/mobile";
import type { StandingRow } from "../lib/mobile";
import { loadAthleteStandings, loadTeamStandings } from "../lib/loaders";
import { previewBoards } from "../lib/preview";
import { EmptyState, LockedPage, PageHero, PortalLoading } from "./shared";
import type { PortalContext } from "./shared";

export default function LeaderboardsView({ ctx }: { ctx: PortalContext }) {
  if (ctx.access === "shared") {
    return <LockedPage title="Leaderboards" copy="Team standings are visible only to connected athletes and coaches." />;
  }
  return <LeaderboardsContent ctx={ctx} />;
}

function LeaderboardsContent({ ctx }: { ctx: PortalContext }) {
  const [boards, setBoards] = useState<Record<string, StandingRow[]> | null>(() =>
    ctx.access === "preview" ? previewBoards(ctx.playerId!, fullName(ctx.athlete)) : null,
  );
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState("changeOfDirection");

  useEffect(() => {
    if (ctx.access === "preview") return;
    let cancelled = false;
    const standings = ["coach", "manager", "admin"].includes(ctx.access) ? loadTeamStandings(ctx.playerId!) : loadAthleteStandings();
    standings
      .then(result => { if (!cancelled) setBoards(result); })
      .catch(error => {
        console.error("[leaderboards]", error);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const category = LEADERBOARD_CATEGORIES.find(item => item.key === active)!;
  const rows = boards ? rankRows(boards[category.key] || [], category.lower) : [];
  const { athlete, percentile } = boardSummary(rows, category.lower, ctx.playerId);

  return (
    <section className="mobile-page leaderboard-page">
      <PageHero eyebrow="Team comparison" title="Leaderboards" description="See where this athlete ranks across measured drills." icon="leaderboard" />
      <nav className="leaderboard-tabs" id="leaderboardTabs">
        {LEADERBOARD_CATEGORIES.map(item => (
          <button
            key={item.key}
            type="button"
            className={item.key === active ? "active" : ""}
            data-board={item.key}
            onClick={() => setActive(item.key)}
          >
            <span className="material-symbols-outlined">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div id="leaderboardContent">
        {failed ? (
          <EmptyState icon="groups" title="No team leaderboard available" message="This athlete must be connected to a coach roster before team standings can be shown." />
        ) : !boards ? (
          <PortalLoading message="Building team standings…" />
        ) : rows.length ? (
          <>
            <section className="leaderboard-summary">
              <article>
                <small>Your rank</small>
                <strong>{athlete ? `#${athlete.rank}` : "—"}</strong>
                <span>of {rows.length}</span>
              </article>
              <article>
                <small>Team percentile</small>
                <strong>{percentile === null ? "—" : `${percentile}%`}</strong>
                <span>{category.lower ? "lower is faster" : "higher is better"}</span>
              </article>
              <article>
                <small>Personal best</small>
                <strong>{athlete ? athlete.value.toFixed(category.unit === "s" ? 2 : 1) : "—"}</strong>
                <span>{category.unit}</span>
              </article>
            </section>
            <section className="portal-card standings-card">
              <div className="card-heading">
                <div>
                  <h2>{category.label} standings</h2>
                  <p>Best recorded result per athlete</p>
                </div>
              </div>
              <div className="standings-list">
                {rows.map(row => (
                  <article key={row.id} className={`standing-row ${row.id === ctx.playerId ? "current" : ""}`}>
                    <span className="rank">{row.rank}</span>
                    <span className="athlete-avatar">{initials(row.name)}</span>
                    <span>
                      <strong>{row.name}{row.id === ctx.playerId ? " · You" : ""}</strong>
                      <small>{row.rank === 1 ? "Team leader" : `Rank ${row.rank}`}</small>
                    </span>
                    <strong>{row.value.toFixed(category.unit === "s" ? 2 : 1)} <small>{category.unit}</small></strong>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="portal-card">
            <EmptyState icon="leaderboard" title={`No ${category.label.toLowerCase()} standings yet`} message="Team members need at least one completed rep in this drill." />
          </section>
        )}
      </div>
    </section>
  );
}
