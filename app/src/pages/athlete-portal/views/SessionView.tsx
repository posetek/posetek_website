// Port of athlete-portal.js renderSession/loadRepViewer/setupViewer. The
// imperative canvas/video sync lives in an effect whose cleanup mirrors the
// legacy destroyViewer().

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import PosePlayback from "../../../components/PosePlayback";
import {
  drawTrackingFrame,
  parseTracking,
  poseReplayUsable,
  selectReplaySource,
  TRACKING_ARTIFACT,
  TRACKING_DRILLS,
  trackingTimelineMeta,
  type ReplayTracking,
} from "../../../lib/replay-tracking";
import { attemptLabel, resultLabel, sameResultStatus } from "../../../lib/result-values";
import type { Drill } from "../lib/drills";
import type { Access } from "../lib/loaders";
import { authArtifacts, fetchJson, sharedArtifacts } from "../lib/loaders";
import {
  frameMarkers,
  num,
  parsePose,
  repMetricSpecs,
  repNumber,
  sessionFolder,
  sessionNumber,
} from "../lib/metrics";
import type { FrameMarker, MetricTile, PosePoint } from "../lib/metrics";
import { PortalLoading } from "./shared";

interface SessionViewProps {
  drill: Drill;
  folder: string;
  selectedId: any;
  reps: any[];
  access: Access;
  playerId: string | null;
  shareToken: string | null;
  onBack: () => void;
  onSelectRep: (repId: any) => void;
}

export default function SessionView({ drill, folder, selectedId, reps, access, playerId, shareToken, onBack, onSelectRep }: SessionViewProps) {
  const sessionReps = reps
    .filter(rep => sessionFolder(rep) === folder)
    .sort((a, b) => repNumber(a) - repNumber(b));
  const selected = sessionReps.find(rep => String(rep.id) === String(selectedId)) || sessionReps[0];

  return (
    <section className="session-view">
      <div className="session-toolbar">
        <button className="quiet-button back-to-dashboard" type="button" id="backToDashboard" onClick={onBack}>
          <span className="material-symbols-outlined">arrow_back</span>
          <span>{drill.label}</span>
        </button>
        <strong>Session {num(folder.match(/\d+/)?.[0]) || (selected ? sessionNumber(selected) : 1)}</strong>
      </div>
      <nav className="rep-segments" aria-label="Session reps">
        {sessionReps.map(rep => (
          <button
            key={String(rep.id)}
            className={`rep-segment${rep === selected ? " active" : ""}`}
            type="button"
            data-session-rep={rep.id}
            onClick={() => onSelectRep(rep.id)}
          >
            {attemptLabel(rep, sessionReps)}
          </button>
        ))}
      </nav>
      <section id="repViewer">
        {selected ? (
          <RepViewer
            key={`${drill.key}:${String(selected.id)}`}
            drill={drill}
            rep={selected}
            access={access}
            playerId={playerId}
            shareToken={shareToken}
          />
        ) : null}
      </section>
    </section>
  );
}

interface ViewerData {
  mediaUrl: string | null;
  frames: PosePoint[][];
  tracking: ReplayTracking | null;
  playbackMetadata: Record<string, any>;
  metrics: MetricTile[];
  markers: FrameMarker[];
  metadata: Record<string, any>;
  mediaSource?: string;
}

interface RepViewerProps {
  drill: Drill;
  rep: any;
  access: Access;
  playerId: string | null;
  shareToken: string | null;
}

function RepViewer({ drill, rep, access, playerId, shareToken }: RepViewerProps) {
  const [data, setData] = useState<ViewerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const payload = access === "shared"
        ? await sharedArtifacts(drill, rep, shareToken)
        : await authArtifacts(drill, rep, playerId!);
      if (rep.resultStatus && payload.resultStatus && !sameResultStatus(rep.resultStatus, payload.resultStatus)) {
        throw new Error("This result changed since it was opened. Refresh the athlete results to view the latest revision.");
      }
      const urls = payload.artifactUrls || {};
      const [pose, metadata] = await Promise.all([
        fetchJson(urls["pose.json"]).catch(() => null),
        fetchJson(urls["metadata.json"]).catch(() => null),
      ]);
      if (cancelled) return;
      const meta = { ...(metadata || {}) };
      const frames = parsePose(pose, meta);
      // Reps processed without pose carry tracking.json (person box + COM per frame).
      const trackingRaw = TRACKING_DRILLS.has(drill.key) && !poseReplayUsable(frames.length, meta)
        ? await fetchJson(urls[TRACKING_ARTIFACT]).catch(() => null)
        : null;
      if (cancelled) return;
      const replay = selectReplaySource(frames.length, meta, parseTracking(trackingRaw, meta));
      const tracking = replay.kind === "tracking" ? replay.tracking : null;
      setData({
        mediaUrl: payload.mediaUrl || null,
        frames: tracking ? [] : frames,
        tracking,
        playbackMetadata: tracking ? trackingTimelineMeta(meta, tracking) : meta,
        metadata: meta,
        mediaSource: payload.source,
        metrics: repMetricSpecs(drill, rep, meta),
        markers: frameMarkers(drill, rep, rep.resultStatus ? { ...meta, ...rep } : meta),
      });
    })().catch(err => {
      console.error("[rep viewer]", err);
      if (!cancelled) setError(err?.message || "The rep files could not be opened.");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error !== null) {
    return (
      <div className="error-card">
        <span className="material-symbols-outlined">error</span>
        <h3>Analysis unavailable</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!data) return <PortalLoading message="Loading rep analysis…" />;

  return (
    <>
      {resultLabel(rep) ? <p role="status">{resultLabel(rep)}</p> : null}
      <PosePlayback frames={data.frames} metadata={data.playbackMetadata} mediaUrl={data.mediaUrl} mediaSource={data.mediaSource} markers={data.markers} title={drill.label}
        frameCount={data.tracking?.frames.length}
        overlay={data.tracking ? (context, width, height, frame) => drawTrackingFrame(context, data.tracking!, frame, width, height) : undefined} />
      <div className="rep-metrics">
        {data.metrics.map(item => (
          <article key={item.label} className="rep-metric">
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>
    </>
  );
}
