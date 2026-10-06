import { lazy, Suspense } from "react";
import { InsightsWorkspace } from "../../insights/InsightsPage";

const Preview = import.meta.env.DEV ? lazy(() => import("../../insights/InsightsPreview")) : null;

export default function AdminOverview({ uid, preview = false }: { uid: string; preview?: boolean }) {
  if (preview && Preview) return <Suspense fallback={<p role="status">Loading synthetic preview…</p>}><Preview embedded /></Suspense>;
  return <InsightsWorkspace uid={uid} embedded />;
}
