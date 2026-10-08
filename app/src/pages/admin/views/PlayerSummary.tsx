import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import type { PlayerRow } from "../lib/accounts";
import { playerSummaryRequest } from "../lib/playerSummary";
import { useWorkspaceMetrics } from "../lib/workspaceMetrics";
import { loadPlayerSummaryOrganization } from "../lib/playerSummaryData";
import { useAccountLoad } from "../lib/useAccountLoad";
import { minuteText, TESTING_LABELS, WORKOUT_LABELS } from "../../insights/lib/expanded";
import type { ExpandedInsights, ExpandedPlayer } from "../../insights/lib/expanded";

export default function PlayerSummary({ player }: { player: PlayerRow }) {
  const location = useLocation();
  const request = playerSummaryRequest(player, location.search);
  const organizationId = request.scope?.kind === "organization" ? request.scope.organizationId : null;
  const loader = useCallback(() => loadPlayerSummaryOrganization(organizationId), [organizationId]);
  const organization = useAccountLoad(loader);
  const canonical = Boolean(organizationId && organization.state.kind === "ready" && organization.state.data.kind === "canonical"
    && organization.state.data.organizationId === organizationId);
  const report = useWorkspaceMetrics({ ...request, playerIds: [player.id], enabled: canonical });
  const metric = report.data?.rosterMetrics?.find(row => row.playerId === player.id);
  const status = organization.state.kind === "loading" ? "loading" : organization.state.kind === "error" ? "error"
    : organization.state.data.kind === "legacy" ? "legacy" : !canonical ? "unavailable-scope"
      : report.loading ? report.rebuilding ? "rebuilding" : "loading" : report.error ? "error"
        : metric?.status === "excluded" ? "excluded" : metric?.status === "included" ? "ready" : "unavailable";
  return <PlayerSummaryContent data={report.data} metric={metric?.status === "included" ? metric.player : null}
    status={status} error={organization.state.kind === "error" ? organization.state.message : report.error}
    onRetry={organization.state.kind === "error" ? organization.refresh : report.refresh} />;
}

export function PlayerSummaryContent({ data, metric, status, error = "", onRetry }: {
  data: ExpandedInsights | null; metric: ExpandedPlayer | null;
  status: "legacy" | "unavailable-scope" | "loading" | "rebuilding" | "error" | "excluded" | "unavailable" | "ready";
  error?: string; onRetry?: () => void;
}) {
  return <section className="admin-player-summary" aria-label="Player activity summary" aria-busy={status === "loading" || status === "rebuilding"}>
    <div className="admin-player-summary-heading"><h2>Activity at a glance</h2>
      {data && <p><time dateTime={data.period.startDate}>{data.period.startDate}</time> – <time dateTime={data.period.endDate}>{data.period.endDate}</time> · {data.period.timeZone}</p>}
    </div>
    {(status === "loading" || status === "rebuilding") && <p role="status">{status === "rebuilding" ? "Refreshing complete activity metrics…" : "Loading activity metrics…"}</p>}
    {status === "error" && <div><p className="form-message" role="alert">{error || "Activity metrics could not be loaded."}</p>{onRetry && <button type="button" className="quiet-button" onClick={onRetry}>Retry summary</button>}</div>}
    {status === "legacy" && <p className="admin-note">Activity metrics are unavailable for this legacy organization. Recorded results and workouts remain available below.</p>}
    {status === "unavailable-scope" && <p className="admin-note">This profile’s current organization is unavailable for activity reporting. Recorded results and workouts remain available below.</p>}
    {status === "excluded" && <p className="admin-note">Excluded from reporting for this scope. This does not mean zero activity; inspect the recorded evidence below.</p>}
    {status === "unavailable" && <p className="admin-note">Complete reporting metrics are unavailable. This does not mean zero activity; inspect the recorded evidence below.</p>}
    {status === "ready" && metric && data && <>
      <p className="admin-player-summary-scope">{metric.organizationName}{metric.teamName ? ` · ${metric.teamName}` : " · Unassigned"}</p>
      <dl className="admin-player-summary-metrics">
        <div><dt>Testing</dt><dd>{metric.testing.exercisesComplete}<span> of 6 exercises</span></dd>
          <dd className="admin-player-summary-detail">{TESTING_LABELS[metric.testing.status] || "Status unavailable"} · {data.testingMode === "cumulative" ? `Recorded through ${data.period.endDate}` : "Selected period"}</dd></div>
        <div><dt>Workouts completed</dt><dd>{metric.workouts.completed}</dd><dd className="admin-player-summary-detail">{WORKOUT_LABELS[metric.workouts.status] || "Status unavailable"}</dd></div>
        <div><dt>Estimated active use</dt><dd className={metric.usage.collected ? "" : "missing"}>{minuteText(metric.usage.activeMinutes, metric.usage.collected)}</dd>
          <dd className="admin-player-summary-detail">{metric.usage.collected ? `${metric.usage.activeDays} active ${metric.usage.activeDays === 1 ? "day" : "days"}` : "Usage collection is unavailable"}</dd></div>
      </dl>
      <p className="admin-player-summary-note">Workout and active-use totals cover the dates above. Active use is estimated; it is separate from workout timer duration.</p>
    </>}
  </section>;
}
