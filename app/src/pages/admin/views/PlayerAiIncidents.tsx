// The athlete page's AI section (AI_OBSERVABILITY_AND_IMPROVEMENT_PLAN §3.4:
// the incident drawer links to PlayerDetail, and this links back). The newest
// incidents for one playerId, read through the (playerId, createdAt desc) index.
// PlayerDetail keys it by playerId, so a new athlete starts from "loading".

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback } from "react";
import { Link } from "react-router-dom";
import {
  PLAYER_INCIDENT_LIMIT, TRIAGE_LABELS, incidentPath, loadPlayerIncidents, pacificShort, playerIncidentsPath,
  readError, whenOf,
} from "../lib/aiIncidents";
import type { AiIncident } from "../lib/aiIncidents";
import { useAccountLoad } from "../lib/useAccountLoad";
import "../ai-incidents.scss";

type Load = { kind: "loading" } | { kind: "ready"; incidents: AiIncident[] } | { kind: "error"; message: string };

export default function PlayerAiIncidents({ playerId }: { playerId: string }) {
  const loader = useCallback(() => loadPlayerIncidents(playerId).catch(error => {
    throw new Error(readError(error, "This athlete's AI incidents"));
  }), [playerId]);
  const { state, refresh } = useAccountLoad(loader);
  const load: Load = state.kind === 'ready' ? { kind: 'ready', incidents: state.data }
    : state.kind === 'error' ? { kind: 'error', message: state.message } : state;
  return <><PlayerAiIncidentsCard playerId={playerId} load={load} />
    {state.kind === 'error' && <button type="button" className="quiet-button" onClick={refresh}>Try again</button>}</>;
}

export function PlayerAiIncidentsCard({ playerId, load }: { playerId: string; load: Load }) {
  return (
    <section className="admin-card ai-player-incidents">
      <div className="admin-heading" style={{ marginBottom: 8 }}>
        <div>
          <h2>AI incidents</h2>
          <p>AI failures and refusals this athlete ran into, newest first, in Pacific time.</p>
        </div>
        <div className="admin-heading-actions">
          <Link className="quiet-button small" to={playerIncidentsPath(playerId)}>All of this athlete's incidents</Link>
        </div>
      </div>
      {load.kind === "loading" && <p className="admin-note">Loading AI incidents…</p>}
      {load.kind === "error" && <p className="form-message" role="alert">{load.message}</p>}
      {load.kind === "ready" && !load.incidents.length && <p className="admin-empty">No AI incidents recorded for this athlete.</p>}
      {load.kind === "ready" && load.incidents.length > 0 && <div className="admin-rows">
        {load.incidents.map(incident => (
          <Link key={incident.id} className="admin-row" to={incidentPath(incident.id)}>
            <span className="admin-row-copy">
              <strong>{incident.code} <span className="ai-row-capability">· {incident.capability}</span></strong>
              <span className="admin-row-meta">
                <span>{pacificShort(whenOf(incident))}</span>
                <span className={`admin-chip ${incident.kind === "failure" ? "danger" : incident.kind === "refusal" ? "warn" : ""}`}>{incident.kind}</span>
                {incident.isTest && <span className="admin-chip">test</span>}
                {incident.triage.state !== "new" && <span className="admin-chip">{TRIAGE_LABELS[incident.triage.state]}</span>}
                {incident.message && <span className="ai-row-message">{incident.message}</span>}
              </span>
            </span>
            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </Link>
        ))}
      </div>}
      {load.kind === "ready" && load.incidents.length >= PLAYER_INCIDENT_LIMIT && (
        <p className="admin-note">Showing the newest {PLAYER_INCIDENT_LIMIT}. Open the full list for the rest.</p>
      )}
    </section>
  );
}
