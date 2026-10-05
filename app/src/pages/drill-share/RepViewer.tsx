/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import PosePlayback from "../../components/PosePlayback";
import { resultLabel } from "../../lib/result-values";
import { drawTrackingFrame, parseTracking, selectReplaySource, TRACKING_ARTIFACT, trackingCenters, trackingTimelineMeta } from "../../lib/replay-tracking";
import type { PageDrillConfig } from "./drill-config";
import { asNumber, markerDefs, metersToInches, normalizeFrames, repMetricCards, type Rep } from "./drill-lib";
import { drawBroadJumpOverlay, drawShuttleOverlay } from "./drawing";

interface RepViewerProps { config: PageDrillConfig; rep: Rep; artifacts: Record<string, any>; initialSpeed?: number; onSpeedChange?: (speed: number) => void }
export default function RepViewer({ config, rep, artifacts, initialSpeed, onSpeedChange }: RepViewerProps) {
  const meta = useMemo(() => artifacts["metadata.json"] || {}, [artifacts]);
  const normalized = useMemo(() => normalizeFrames(artifacts["pose.json"], meta), [artifacts, meta]);
  // Reps processed without pose replay the tracking.json person box + COM instead.
  const tracking = useMemo(() => {
    const replay = selectReplaySource(normalized.length, meta, parseTracking(artifacts[TRACKING_ARTIFACT], meta));
    return replay.kind === "tracking" ? replay.tracking : null;
  }, [artifacts, meta, normalized]);
  const centers = useMemo(() => tracking ? trackingCenters(tracking) : undefined, [tracking]);
  const playbackMeta = useMemo(() => tracking ? trackingTimelineMeta(meta, tracking) : meta, [tracking, meta]);
  const frames = useMemo(() => tracking ? [] : normalized.map(frame => frame.map(point => point || { x: null, y: null })), [normalized, tracking]);
  const [frame, setFrame] = useState(0);
  const cards = repMetricCards(config.key, artifacts, rep);
  const heights = artifacts["com_height.json"];
  const height = Array.isArray(heights) ? asNumber(heights[frame]) : null;
  return <div className="viewer-layout">
    <div>
      {resultLabel(rep) ? <p role="status">{resultLabel(rep)}</p> : null}
      <PosePlayback frames={frames} metadata={playbackMeta} mediaUrl={artifacts.mediaUrl} mediaSource={artifacts.mediaSource}
        markers={markerDefs(config.key, artifacts, rep)} title={config.title} initialSpeed={initialSpeed} onSpeedChange={onSpeedChange} onFrameChange={setFrame}
        frameCount={tracking?.frames.length}
        overlay={(context, width, height, current) => {
          if (config.key === "broadJump") return drawBroadJumpOverlay(context, width, height, current, artifacts, rep);
          // The shuttle overlay repaints the COM dot in its phase colour when the result is usable.
          if (tracking) drawTrackingFrame(context, tracking, current, width, height);
          drawShuttleOverlay(context, width, height, normalized, current, artifacts, rep, centers);
        }} />
    </div>
    <aside><div className="metric-grid">{cards.map(card => <article key={card.label} className="metric-card">
      <span className="material-symbols-outlined">{card.icon}</span>
      <span className="metric-value">{card.dynamicId ? height === null ? "—" : `${metersToInches(height).toFixed(1)} in` : card.value}</span>
      <span className="metric-label">{card.label}</span>
    </article>)}</div><div className="coach-note"><strong>What to review</strong><p>{config.key === "broadJump"
      ? "Use Takeoff and Landing to inspect launch angle, arm swing, hip extension, and the landing."
      : "Use Start, Turn, and Finish to inspect braking steps, the plant, and acceleration out of the turn."}</p></div></aside>
  </div>;
}
