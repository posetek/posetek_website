// Port of athlete-portal.js renderDashboard/sessionMarkup/renderChart.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewedResult } from "../../../lib/reviewed-results";
import ReviewedResults from "../player/ReviewedResults";
import { attemptLabel, resultLabel } from "../../../lib/result-values";
import Chart from "chart.js/auto";
import type { Drill } from "../lib/drills";
import {
  createdMillis,
  dashboardMetrics,
  dateText,
  displayValue,
  formatValue,
  fullName,
  mean,
  metricRaw,
  repNumber,
  sessionFolder,
  sessionsFor,
} from "../lib/metrics";
import type { SessionGroup } from "../lib/metrics";

interface DrillDashboardProps {
  drill: Drill;
  reps: any[];
  reviewedResults?: ReviewedResult[];
  athlete: any;
  onOpenRep: (folder: string, repId: any) => void;
}

export default function DrillDashboard({ drill, reps: rawReps, reviewedResults = [], athlete, onOpenRep }: DrillDashboardProps) {
  const reps = useMemo(
    () => rawReps.filter(r => !reviewedResults.some(review => review.repId === r.id)).sort((a, b) => createdMillis(b) - createdMillis(a) || repNumber(b) - repNumber(a)),
    [rawReps, reviewedResults],
  );
  const sessions = useMemo(() => sessionsFor(reps), [reps]);
  const metrics = useMemo(() => dashboardMetrics(drill, reps), [drill, reps]);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!reps.length || !drill.metric) return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const labels = sessions.slice().reverse().map(session => `Session ${session.number}`);
    const data = sessions.slice().reverse().map(session =>
      mean(session.items.map(rep => displayValue(metricRaw(rep, drill), drill)).filter((v): v is number => v !== null)),
    );
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: drill.label,
          data,
          borderColor: "#b7f34a",
          backgroundColor: "rgba(183,243,74,.14)",
          fill: true,
          tension: .34,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: "#b7f34a",
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item: any) => `${item.formattedValue} ${drill.unit}` } },
        },
        scales: {
          x: { ticks: { color: "#9fb8ae" }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { ticks: { color: "#9fb8ae", callback: (value: any) => `${value} ${drill.unit}` }, grid: { color: "rgba(255,255,255,.07)" } },
        },
      },
    });
    return () => chart.destroy();
  }, [drill, reps, sessions]);

  const isOpen = (session: SessionGroup, index: number) => openMap[session.folder] ?? index === 0;

  return (
    <section className="drill-dashboard">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">Athlete drill results</p>
          <h1>{drill.label}</h1>
          <p>{fullName(athlete)} · {sessions.length} {sessions.length === 1 ? "session" : "sessions"} · {reps.length} {reps.length === 1 ? "rep" : "reps"}</p>
        </div>
        <span className="hero-icon"><span className="material-symbols-outlined">{drill.icon}</span></span>
      </header>
      <ReviewedResults results={reviewedResults} onOpen={r => onOpenRep(`session${r.sessionNumber}`, r.repId)} />
      {reps.length ? (
        <>
          <div className="dashboard-grid">
            <section className="portal-card">
              <div className="card-heading">
                <div>
                  <h2>{drill.title}</h2>
                  <p>{drill.key === "freeRecord" ? "Open a session to review its pose video." : "Session performance, matching the mobile dashboard."}</p>
                </div>
              </div>
              {drill.key === "freeRecord" ? (
                <div className="no-results">
                  <span className="material-symbols-outlined">video_library</span>
                  <h3>{reps.length} recordings ready</h3>
                  <p>Choose a session from the list to begin playback.</p>
                </div>
              ) : (
                <div className="chart-wrap"><canvas id="progressChart" ref={chartCanvasRef} /></div>
              )}
            </section>
            <section className="portal-card">
              <div className="card-heading">
                <div>
                  <h2>Performance</h2>
                  <p>Current drill summary</p>
                </div>
              </div>
              <div className="metric-grid">
                {metrics.map(item => (
                  <article key={item.label} className="metric-tile">
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>
            </section>
          </div>
          <section className="portal-card">
            <div className="card-heading">
              <div>
                <h2>Latest Sessions</h2>
                <p>Tap a session, then choose a rep to view pose and video.</p>
              </div>
            </div>
            <div className="session-list">
              {sessions.map((session, index) => (
                <article key={session.folder} className={`session-row${isOpen(session, index) ? " open" : ""}`}>
                  <button
                    className="session-button"
                    type="button"
                    onClick={() => setOpenMap(prev => ({ ...prev, [session.folder]: !isOpen(session, index) }))}
                  >
                    <span>
                      <strong>Session {session.number}</strong>
                      <span>{dateText(session.date)} · {session.items.length} {session.items.length === 1 ? "rep" : "reps"}</span>
                    </span>
                    <span className="material-symbols-outlined">expand_more</span>
                  </button>
                  <div className="rep-list">
                    {session.items.map(rep => (
                      <button
                        key={String(rep.id)}
                        className="rep-button"
                        type="button"
                        data-rep-id={rep.id}
                        data-session={session.folder}
                        onClick={() => onOpenRep(sessionFolder(rep), rep.id)}
                      >
                        <strong>{attemptLabel(rep, session.items)}</strong>
                        <span>{drill.metric ? formatValue(metricRaw(rep, drill), drill) : "View recording"} · {resultLabel(rep) || "View analysis"}</span>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : !reviewedResults.length ? (
        <section className="portal-card no-results">
          <span className="material-symbols-outlined">add_circle</span>
          <h2>No {drill.label.toLowerCase()} results yet</h2>
          <p>Once this athlete completes the drill in the mobile app, the session and pose analysis will appear here automatically.</p>
        </section>
      ) : null}
    </section>
  );
}
