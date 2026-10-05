/* eslint-disable @typescript-eslint/no-explicit-any */
// Replay fallback for reps processed without pose (sprint, change of direction,
// dribbling from mobile build 6 onward). Those reps carry `tracking.json`: one
// entry per decoded frame with the YOLO person box, its centre point (COM) and,
// for dribbling, the ball box. Coordinates follow pose.json: normalized to the
// upright video frame, origin top-left, a box's x/y is its top-left corner.
import { finiteNumber } from "./result-values";
import { poseTimeline } from "./pose-playback";

export const TRACKING_ARTIFACT = "tracking.json";
export const TRACKING_DRILLS: ReadonlySet<string> = new Set(["sprint", "changeOfDirection", "dribbling"]);
const MAX_FRAMES = 100_000;

export interface TrackingBox { x: number; y: number; w: number; h: number }
export interface TrackingPoint { x: number; y: number }
export interface TrackingFrame { person: TrackingBox | null; com: TrackingPoint | null; ball: TrackingBox | null }
export interface ReplayTracking { frames: TrackingFrame[]; fps: number | null; timestampsMs: (number | null)[] }
export type ReplaySource = { kind: "pose" } | { kind: "tracking"; tracking: ReplayTracking } | { kind: "none" };

// Pose stays the replay source whenever it exists and was actually computed.
export function poseReplayUsable(poseFrameCount: number, meta: any): boolean {
  return poseFrameCount > 0 && meta?.poseComputed !== false;
}

export function selectReplaySource(poseFrameCount: number, meta: any, tracking: ReplayTracking | null): ReplaySource {
  if (poseReplayUsable(poseFrameCount, meta)) return { kind: "pose" };
  if (tracking && tracking.frames.length > 0) return { kind: "tracking", tracking };
  return poseFrameCount > 0 ? { kind: "pose" } : { kind: "none" };
}

export function parseTracking(raw: any, meta: any = {}): ReplayTracking | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.frames)) return null;
  const pixels = String(raw.coordinates ?? "").toLowerCase().includes("pixel");
  const width = finiteNumber(raw.width ?? raw.videoWidth ?? meta.videoDisplayWidth ?? meta.videoWidth ?? meta.imageWidth ?? meta.frameWidth);
  const height = finiteNumber(raw.height ?? raw.videoHeight ?? meta.videoDisplayHeight ?? meta.videoHeight ?? meta.imageHeight ?? meta.frameHeight);
  if (pixels && !(width && width > 0 && height && height > 0)) return null;
  const sx = pixels ? width! : 1, sy = pixels ? height! : 1;
  const declared = finiteNumber(raw.frameCount);
  let count = declared !== null && Number.isInteger(declared) && declared > 0 ? declared : 0;
  const placed = raw.frames.map((entry: any, position: number) => {
    const index = finiteNumber(entry?.index);
    return { slot: index !== null && Number.isInteger(index) && index >= 0 ? index : position, entry };
  }).filter(({ slot }: { slot: number }) => slot < MAX_FRAMES);
  for (const { slot } of placed) count = Math.max(count, slot + 1);
  count = Math.min(count, MAX_FRAMES);
  const frames: TrackingFrame[] = Array.from({ length: count }, () => ({ person: null, com: null, ball: null }));
  const timestampsMs: (number | null)[] = Array.from({ length: count }, () => null);
  for (const { slot, entry } of placed) {
    if (!entry || typeof entry !== "object") continue;
    frames[slot] = { person: box(entry.person, sx, sy), com: point(entry.com, sx, sy), ball: box(entry.ball, sx, sy) };
    timestampsMs[slot] = finiteNumber(entry.timestampMs);
  }
  const fps = finiteNumber(raw.fps);
  return { frames, fps: fps !== null && fps > 0 && fps <= 1000 ? fps : null, timestampsMs };
}

function box(value: any, sx: number, sy: number): TrackingBox | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = finiteNumber(value.x), y = finiteNumber(value.y);
  const w = finiteNumber(value.w ?? value.width), h = finiteNumber(value.h ?? value.height);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x: x / sx, y: y / sy, w: w / sx, h: h / sy };
}

function point(value: any, sx: number, sy: number): TrackingPoint | null {
  const x = finiteNumber(Array.isArray(value) ? value[0] : value?.x), y = finiteNumber(Array.isArray(value) ? value[1] : value?.y);
  return x === null || y === null ? null : { x: x / sx, y: y / sy };
}

// Timing for the tracking slider. Metadata timing wins so the frame clock is the
// one the skeleton used for the same decoded frames; tracking fills gaps only.
export function trackingTimelineMeta(meta: any, tracking: ReplayTracking): Record<string, any> {
  const count = tracking.frames.length, base = meta || {};
  if (poseTimeline(base, count).source !== "unavailable") return base;
  const stamped = { ...base, frameTimestampsMs: tracking.timestampsMs };
  if (poseTimeline(stamped, count).source !== "unavailable") return stamped;
  return tracking.fps ? { ...base, framesPerSecond: tracking.fps } : base;
}

export interface TrackingShapes {
  person: TrackingBox | null;
  com: TrackingPoint | null;
  ball: TrackingBox | null;
}

// Maps one frame into the drawn content rectangle (the overlay hook's width/height).
export function trackingShapes(tracking: ReplayTracking, frameIndex: number, width: number, height: number): TrackingShapes {
  const frame = tracking.frames[frameIndex];
  if (!frame) return { person: null, com: null, ball: null };
  const scaleBox = (value: TrackingBox | null) => value && { x: value.x * width, y: value.y * height, w: value.w * width, h: value.h * height };
  return {
    person: scaleBox(frame.person),
    com: frame.com && { x: frame.com.x * width, y: frame.com.y * height },
    ball: scaleBox(frame.ball),
  };
}

export function trackingCenters(tracking: ReplayTracking): (TrackingPoint | null)[] {
  return tracking.frames.map(frame => frame.com);
}

export function drawTrackingFrame(context: CanvasRenderingContext2D, tracking: ReplayTracking, frameIndex: number, width: number, height: number): void {
  const { person, ball, com } = trackingShapes(tracking, frameIndex, width, height);
  context.save();
  context.lineWidth = 2.5;
  if (person) { context.strokeStyle = "#b7f34a"; context.strokeRect(person.x, person.y, person.w, person.h); }
  if (ball) { context.strokeStyle = "#ffad5c"; context.strokeRect(ball.x, ball.y, ball.w, ball.h); }
  if (com) {
    context.beginPath(); context.arc(com.x, com.y, 4.5, 0, Math.PI * 2);
    context.fillStyle = "#f7fbf9"; context.fill();
  }
  context.restore();
}
