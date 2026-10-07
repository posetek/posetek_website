import { completeReport } from "./completeReport";
import { assertReportScope, reportPayload, type ExpandedInsights, type InsightScope } from "./expanded";
import type { ExpandedRequest } from "./expandedQuery";

/** Accept only a complete report for the still-current account and selection. */
export async function loadAuthorizedReport(
  request: ExpandedRequest,
  scope: InsightScope,
  load: (payload: ReturnType<typeof reportPayload>) => Promise<ExpandedInsights>,
  isCurrent: () => boolean,
  options: { adminOnly?: boolean; onRebuild?: () => void } = {},
): Promise<ExpandedInsights | null> {
  const result = await completeReport(() => load(reportPayload(request, scope, request.cursor)), isCurrent, options.onRebuild);
  if (!result || !isCurrent()) return null;
  assertReportScope(result, scope, request);
  if (options.adminOnly && result.scope.access !== "admin") {
    throw Object.assign(new Error("Admin access changed"), { code: "permission-denied" });
  }
  return result;
}
