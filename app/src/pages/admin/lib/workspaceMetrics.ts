import { useEffect, useMemo, useState } from "react";
import { auth } from "../../../lib/firebase";
import { clubCall, subscribeClubContextInvalidation } from "../../../lib/organization-data";
import { expandedFailureMessage } from "../../insights/lib/expanded";
import type { ExpandedInsights, InsightScope } from "../../insights/lib/expanded";
import { createWorkspaceMetricsTransport, workspaceMetricsPayload, workspacePayloadKey } from "./workspaceMetricsData";
import type { WorkspaceReportPayload } from "./workspaceMetricsData";

const transport = createWorkspaceMetricsTransport(payload => clubCall<ExpandedInsights>("getClubInsightsV2", payload));
export interface WorkspaceMetricsInput { scope: InsightScope | null; search: string; playerIds?: string[]; enabled?: boolean }
type Outcome = { key: string; revision: number; uid: string; data: ExpandedInsights | null; error: string; rebuilding: boolean };

export function useWorkspaceMetrics({ scope, search, playerIds, enabled = true }: WorkspaceMetricsInput) {
  const key = workspacePayloadKey(enabled && scope ? workspaceMetricsPayload(search, scope, playerIds) : null);
  const payload = useMemo(() => key ? JSON.parse(key) as WorkspaceReportPayload : null, [key]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const stop = subscribeClubContextInvalidation(() => { transport.clear(); setRevision(value => value + 1); });
    return stop;
  }, []);
  useEffect(() => {
    let generation = 0;
    const stop = auth.onAuthStateChanged(user => {
      const attempt = ++generation;
      transport.observeIdentity(user?.uid || null);
      setOutcome(null);
      if (!payload || !user) return;
      const uid = user.uid;
      const current = () => generation === attempt && auth.currentUser?.uid === uid;
      const publish = (data: ExpandedInsights | null, error = "", rebuilding = false) => {
        if (current()) setOutcome({ key, revision, uid, data, error, rebuilding });
      };
      void transport.load(uid, payload, current, () => publish(null, "", true))
        .then(data => { if (data) publish(data); })
        .catch(error => publish(null, expandedFailureMessage(error)));
    });
    return () => { ++generation; stop(); };
  }, [payload, key, revision]);
  const matches = outcome?.key === key && outcome.revision === revision && outcome.uid === auth.currentUser?.uid;
  return {
    data: matches ? outcome.data : null,
    error: matches ? outcome.error : "",
    rebuilding: matches ? outcome.rebuilding : false,
    loading: Boolean(payload && (!matches || !outcome.data && !outcome.error)),
    refresh: () => { transport.clear(); setRevision(value => value + 1); },
  };
}
