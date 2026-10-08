// An athlete's recorded results inside the admin console: the same drill
// dashboard the athlete portal renders (chart, summary, sessions → reps), with
// every rep opening the rep tools instead of the read-only viewer.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import DrillDashboard from "../../athlete-portal/views/DrillDashboard";
import { DRILLS, drillByKey } from "../../athlete-portal/lib/drills";
import { fullName } from "../../athlete-portal/lib/metrics";
import { loadAdminResults, resultsPath } from "../lib/results";
import type { AdminResults as AdminResultsData } from '../lib/results';
import { adminPlayerPath } from "../lib/adminNavigation";
import { useAccountLoad } from "../lib/useAccountLoad";
import { ADMIN_RETURN_STATE } from '../lib/useAdminNavigation';

export default function AdminResults({ embedded = false, athlete }: { embedded?: boolean; athlete?: any }) {
  const { playerId = "", drillKey = "" } = useParams();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const retainedQuery = new URLSearchParams(query);
  retainedQuery.delete('playerTab');
  const suffix = retainedQuery.size ? `?${retainedQuery}` : '';
  const loader = useCallback(() => loadAdminResults(playerId, athlete), [playerId, athlete]);
  const { state: load, refresh } = useAccountLoad(loader);

  useEffect(() => {
    document.title = "Recorded results | PoseTek admin";
  }, []);

  useEffect(() => {
    if (!drillKey && !embedded) navigate(resultsPath(playerId, "changeOfDirection") + suffix, { replace: true });
  }, [drillKey, embedded, navigate, playerId, suffix]);

  const results = load.kind === "ready" ? load.data : null;

  return (
    <>
      {!embedded && <section className="admin-heading">
        <Link className="icon-button" state={ADMIN_RETURN_STATE} to={adminPlayerPath(playerId, 'results', query.toString())} aria-label="Back to the athlete">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">Recorded results</p>
          <h1>{results ? fullName(results.athlete) : "Athlete"}</h1>
          <p>Open a session, then a rep, to inspect it and run the rep tools: fix event frames, annotate the athlete and the ball, and re-process.</p>
        </div>
      </section>}

      {embedded && <p className="admin-note">Recorded testing evidence. Open a session, then a rep, to inspect processing and use the rep tools.</p>}

      {load.kind === "loading" && <div className="portal-loading"><span className="spinner" /><p>Loading results…</p></div>}
      {load.kind === "error" && <><p className="form-message" role="alert">{load.message}</p><button className="quiet-button" onClick={refresh}>Try again</button></>}

      {results && <AdminResultsContent results={results} playerId={playerId} drillKey={drillKey} search={suffix} />}
    </>
  );
}

export function AdminResultsContent({ results, playerId, drillKey, search = '' }: { results: AdminResultsData; playerId: string; drillKey: string; search?: string }) {
  const navigate = useNavigate();
  const drill = drillByKey(drillKey || 'changeOfDirection');
  const suffix = search && !search.startsWith('?') ? `?${search}` : search;
  return <>
          <nav className="drill-tabs admin-drill-tabs" aria-label="Drill results">
            {DRILLS.map(item => (
              <Link
                key={item.key}
                className={`drill-tab${item.key === drill.key ? " active" : ""}`}
                aria-current={item.key === drill.key ? 'page' : undefined}
                to={resultsPath(playerId, item.key) + suffix}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.short || item.label}
                <span className="count">{results.reps[item.key]?.length ?? 0}</span>
              </Link>
            ))}
          </nav>
          <DrillDashboard
            key={drill.key}
            drill={drill}
            reps={results.reps[drill.key] ?? []}
            athlete={results.athlete}
            onOpenRep={(folder, repId) => {
              const target = new URLSearchParams(suffix);
              target.set("session", folder);
              navigate(`${resultsPath(playerId, drill.key, repId)}?${target}`);
            }}
          />
        </>;
}
