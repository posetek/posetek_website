/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { contentRect, frameAtTime, poseTimeline, type PosePoint } from "../lib/pose-playback";

const edges17 = [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
const edges33 = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]];
export interface PosePlaybackProps {
  frames: PosePoint[][];
  metadata: Record<string, any>;
  mediaUrl?: string | null;
  mediaSource?: string;
  markers?: { label: string; frame: number | null }[];
  title: string;
  initialSpeed?: number;
  onSpeedChange?: (speed: number) => void;
  onFrameChange?: (frame: number) => void;
  overlay?: (context: CanvasRenderingContext2D, width: number, height: number, frame: number) => void;
  /** Frame count when the replay has no pose (tracking.json drives the slider); defaults to the pose frame count. */
  frameCount?: number;
}

export default function PosePlayback({ frames, metadata, mediaUrl, mediaSource, markers = [], title, initialSpeed = 1, onSpeedChange, onFrameChange, overlay, frameCount }: PosePlaybackProps) {
  const count = frames.length || Math.max(0, Math.floor(frameCount ?? 0)), source = frames.length ? "pose" : "tracking";
  const stageRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), videoRef = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(initialSpeed);
  const [videoError, setVideoError] = useState(false), [playError, setPlayError] = useState(false);
  const [showVideo, setShowVideo] = useState(true);
  const timeline = useMemo(() => poseTimeline(metadata, count), [metadata, count]);
  const timed = timeline.times.length > 0, hasVideo = Boolean(mediaUrl) && !videoError && showVideo;
  const frameRef = useRef(0);
  function updateFrame(next: number) {
    const safe = Math.max(0, Math.min(Math.max(0, count - 1), Math.round(next)));
    frameRef.current = safe; setFrame(safe); onFrameChange?.(safe);
  }
  function seek(next: number) {
    if (!hasVideo) setPlaying(false);
    updateFrame(next);
    const video = videoRef.current, time = timeline.times[frameRef.current];
    if (video && timed && Number.isFinite(video.duration) && time <= video.duration) video.currentTime = time;
  }
  function toggle() {
    const video = videoRef.current;
    if (hasVideo && video) {
      if (video.paused) { setPlayError(false); void video.play().catch(() => { setPlaying(false); setPlayError(true); }); }
      else video.pause();
    } else if (timed && count) {
      if (frame >= count - 1) updateFrame(0);
      setPlaying(value => !value);
    }
  }
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed, mediaUrl]);
  useEffect(() => {
    if (!playing || hasVideo || !timed) return;
    const started = performance.now(), origin = timeline.times[frameRef.current];
    let animation = 0;
    const tick = (now: number) => {
      const time = origin + (now - started) / 1000 * speed;
      updateFrame(frameAtTime(timeline, time));
      if (time >= timeline.times.at(-1)!) setPlaying(false);
      else animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
    // The clock starts once for each play/rate change; frame changes do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hasVideo, timed, speed, timeline]);
  useEffect(() => {
    const video = videoRef.current;
    if (!hasVideo || !video || !timed) return;
    let callback = 0, animation = 0, stopped = false;
    const sync = (_now?: number, info?: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      updateFrame(frameAtTime(timeline, info?.mediaTime ?? video.currentTime));
      if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(sync);
      else animation = requestAnimationFrame(sync);
    };
    if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(sync);
    else animation = requestAnimationFrame(sync);
    const onSeek = () => updateFrame(frameAtTime(timeline, video.currentTime));
    video.addEventListener("seeked", onSeek);
    return () => { stopped = true; if (callback) video.cancelVideoFrameCallback(callback); cancelAnimationFrame(animation); video.removeEventListener("seeked", onSeek); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVideo, timeline, timed]);
  useEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      const width = stage.clientWidth, height = stage.clientHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      // An untimed pose must not be presented as synchronized with a moving video.
      if (hasVideo && !timed) return;
      const video = videoRef.current;
      const rect = contentRect(width, height, video?.videoWidth || metadata.videoDisplayWidth || metadata.videoWidth || metadata.imageWidth || metadata.frameWidth, video?.videoHeight || metadata.videoDisplayHeight || metadata.videoHeight || metadata.imageHeight || metadata.frameHeight);
      ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip(); ctx.translate(rect.x, rect.y);
      overlay?.(ctx, rect.width, rect.height, frame);
      const points = frames[frame] || [], valid = (p?: PosePoint) => p && p.x !== null && p.y !== null && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (p.visibility == null || p.visibility >= .1);
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#b7f34a";
      for (const [a,b] of points.length <= 20 ? edges17 : edges33) {
        const p = points[a], q = points[b]; if (!valid(p) || !valid(q)) continue;
        ctx.beginPath(); ctx.moveTo(p.x! * rect.width, p.y! * rect.height); ctx.lineTo(q.x! * rect.width, q.y! * rect.height); ctx.stroke();
      }
      ctx.fillStyle = "#f7fbf9";
      for (const p of points) if (valid(p)) { ctx.beginPath(); ctx.arc(p.x! * rect.width, p.y! * rect.height, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(stage);
    videoRef.current?.addEventListener("loadedmetadata", draw);
    const video = videoRef.current;
    return () => { observer.disconnect(); video?.removeEventListener("loadedmetadata", draw); };
  }, [frame, frames, metadata, hasVideo, timed, overlay]);

  return <section className="pose-card">
    <div ref={stageRef} className="pose-stage" style={{ position: "relative", width: "100%", minHeight: 280, aspectRatio: "16 / 9", background: "#03100b", overflow: "hidden" }}>
      <span className="viewer-badge">{title}</span>
      {hasVideo ? <video ref={videoRef} playsInline preload="metadata" src={mediaUrl!} controls={!count || !timed}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setVideoError(true); setPlaying(false); }} /> : null}
      <canvas ref={canvasRef} aria-label="Pose playback" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
    </div>
    <p role="status">{mediaSource === "error" ? "Recording files could not be loaded. Refresh the page to retry." : videoError ? "Video could not be loaded. Reopen this recording to refresh access." : hasVideo ? mediaSource === "diagnostic" ? "Original diagnostic recording" : "Original recording" : mediaUrl ? source === "pose" ? "Pose frames. Original video available." : "Tracking frames. Original video available." : count ? source === "pose" ? "Pose playback available. Original video unavailable." : "Tracking playback available. Original video unavailable." : "No video or pose data is available for this attempt."}
      {count && !timed ? hasVideo ? ` Frame timing unavailable; switch to ${source} frames for manual inspection.` : source === "pose" ? " Frame timing unavailable; inspect poses with the frame slider." : " Frame timing unavailable; inspect tracking with the frame slider." : ""}
      {playError ? " Playback could not start. Use the video controls or reopen this recording." : ""}</p>
    {mediaUrl && !videoError && count > 0 ? <button className="quiet-button" type="button" onClick={() => { videoRef.current?.pause(); setPlaying(false); setShowVideo(value => !value); }}>{showVideo ? `Show ${source} frames` : "Show video"}</button> : null}
    <div className="playback-bar">
      <button className="play-button" type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!hasVideo && (!timed || !count)}><span className="material-symbols-outlined">{playing ? "pause" : "play_arrow"}</span></button>
      <input type="range" min={0} max={Math.max(0, count - 1)} value={frame} onChange={event => seek(Number(event.target.value))} aria-label="Frame" disabled={!count || (hasVideo && !timed)} />
      <button className="speed-button" type="button" onClick={() => { const rates = [.25,.5,1,2], next = rates[(rates.indexOf(speed) + 1) % rates.length]; setSpeed(next); onSpeedChange?.(next); }}>{speed}×</button>
      <span>Frame {count ? frame + 1 : 0} / {count}</span>
    </div>
    <div className="frame-markers">{markers.map(marker => <button key={marker.label} className="frame-marker" type="button"
      disabled={marker.frame === null || !Number.isInteger(marker.frame) || marker.frame < 0 || marker.frame >= count || (hasVideo && !timed)}
      onClick={() => marker.frame !== null && seek(marker.frame)}>{marker.label}</button>)}</div>
  </section>;
}
