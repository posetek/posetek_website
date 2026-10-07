import { inFlightRequests } from "../../../lib/inflightRequests";
import { completeReport } from "../../insights/lib/completeReport";
import { expandedRequest } from "../../insights/lib/expandedQuery";
import { assertReportScope, reportPayload } from "../../insights/lib/expanded";
import type { ExpandedInsights, InsightScope } from "../../insights/lib/expanded";

export type WorkspaceReportPayload = ReturnType<typeof reportPayload> & { rosterPlayerIds?: string[] };
export type WorkspaceReportReader = (payload: WorkspaceReportPayload) => Promise<ExpandedInsights>;
const invalid = (message: string) => Object.assign(new Error(message), { code: "failed-precondition" });

export function workspaceMetricsPayload(search: string, scope: InsightScope, playerIds?: string[], now = new Date()): WorkspaceReportPayload {
  const request = expandedRequest(search, now);
  const ids = playerIds?.length ? [...playerIds].sort() : undefined;
  if (ids && (ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !id || id.includes("/")))) {
    throw invalid("The visible players changed. Refresh the roster before loading metrics.");
  }
  return { ...reportPayload(request, scope, request.cursor), pageSize: 20, ...(ids ? { rosterPlayerIds: ids } : {}) };
}

/** Keyed only by server-visible inputs, so changing the presentation tab reuses data. */
export function workspacePayloadKey(payload: WorkspaceReportPayload | null) { return payload ? JSON.stringify(payload) : ""; }
export function requestFromWorkspacePayload(payload: WorkspaceReportPayload) {
  return { ...expandedRequest(""), timezone: payload.timeZone, startDate: payload.startDate, endDate: payload.endDate,
    testingWindow: payload.testingMode, rosterSearch: payload.nameSearch || "", cursor: payload.cursor || "",
    division: "", ageBand: "", testingStatus: "", workoutStatus: "", usageStatus: "", usagePlatform: "", usageFeature: "", teamAssignment: "", ...payload.filters };
}
export function assertWorkspaceMetrics(data: ExpandedInsights, payload: WorkspaceReportPayload) {
  assertReportScope(data, payload.scope, requestFromWorkspacePayload(payload));
  if (data.scope.access !== "admin") throw Object.assign(new Error("Admin access changed."), { code: "permission-denied" });
  const requested = payload.rosterPlayerIds;
  if (!requested) return;
  const metrics = data.rosterMetrics;
  if (!Array.isArray(metrics) || metrics.length !== requested.length || new Set(metrics.map(row => row.playerId)).size !== requested.length) {
    throw invalid("The reporting service has not returned metrics for this roster. Refresh and retry.");
  }
  for (const metric of metrics) {
    if (!requested.includes(metric.playerId) || !["included", "excluded"].includes(metric.status)) throw invalid("The roster metrics no longer match this selection.");
    if (metric.status === "included") {
      const player = metric.player;
      const scope = payload.scope;
      if (!player || player.id !== metric.playerId
        || (scope.kind === "organization" || scope.kind === "team") && player.organizationId !== scope.organizationId
        || scope.kind === "team" && player.teamId !== scope.teamId) throw invalid("A player's organization or team changed. Refresh the roster.");
    } else if ("player" in metric) throw invalid("Excluded reporting evidence must not be returned.");
  }
}

/** Concurrent work only: no retained reports, profile index or cross-account results. */
export function createWorkspaceMetricsTransport(read: WorkspaceReportReader) {
  const requests = inFlightRequests<ExpandedInsights>();
  let actor: string | null = null;
  const observeIdentity = (uid: string | null) => { if (actor !== uid) { actor = uid; requests.clear(); } };
  return {
    observeIdentity,
    clear: () => requests.clear(),
    async load(uid: string, payload: WorkspaceReportPayload, isCurrent: () => boolean, onRebuild?: () => void) {
      if (!isCurrent()) return null;
      observeIdentity(uid);
      const data = await completeReport(() => requests.run(JSON.stringify([uid, payload]), () => read(payload)), isCurrent, onRebuild).catch(error => {
        if (/permission-denied|unauthenticated/.test(String(error?.code || ""))) requests.clear();
        throw error;
      });
      if (!data || !isCurrent() || actor !== uid) return null;
      assertWorkspaceMetrics(data, payload);
      return data;
    },
  };
}
