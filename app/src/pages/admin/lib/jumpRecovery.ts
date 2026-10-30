/** Input-only recovery contract. The server owns the result and quality flags. */
export type JumpRecoveryMethod = "manual_marker" | "flight_time";
export type JumpPoint = { x: number; y: number };
export interface JumpReviewSource {
  path: string;
  generation: string;
  mediaUrl: string;
  width: number;
  height: number;
  presentationTimestampsSeconds: number[];
  presentationTimeOriginSeconds?: number;
  poseAvailable: boolean;
}
export interface JumpReviewContext {
  source: JumpReviewSource | null;
  expectedRevisionId: string | null;
  originalHeight: number | null;
  originalHeightIsEstimate: boolean;
  rootJumpHeight: number | null;
  jumpRecovery: { isEstimate: boolean; heightMetres: number } | null;
  availableMethods: JumpRecoveryMethod[];
  blockers: string[];
  sourceFingerprint: string;
}

/** Legacy clients read root height without its quality flags: keep it empty. */
export function assertJumpRecoverySaved(result: { revisionId: string; rep: { jumpHeight?: unknown; jumpRecovery?: { isEstimate?: unknown; heightMetres?: unknown } } }, fresh: JumpReviewContext, preview: JumpRecoveryPreview): void {
  const saved = result.rep?.jumpRecovery;
  const current = fresh.jumpRecovery;
  const sameHeight = (height: unknown) => typeof height === "number" && Number.isFinite(height) && Math.abs(height - preview.heightMetres) <= 1e-8;
  if (!result.revisionId || fresh.expectedRevisionId !== result.revisionId || result.rep?.jumpHeight !== null || fresh.rootJumpHeight !== null || saved?.isEstimate !== true || current?.isEstimate !== true || !sameHeight(saved.heightMetres) || !sameHeight(current.heightMetres) || fresh.originalHeightIsEstimate !== true || !sameHeight(fresh.originalHeight)) throw new Error("The saved estimate could not be verified separately from verified measurements. Reload the review before another save.");
}
export interface JumpRecoveryInput {
  schemaVersion: 1;
  method: JumpRecoveryMethod;
  operationId: string;
  expectedRevisionId: string | null;
  sourceFingerprint: string;
  source: { path: string; generation: string };
  marker?: { frame: number; corners: JumpPoint[]; sideMetres: number };
  baseline?: { fromFrame: number; toFrame: number };
  peakFrame?: number;
  takeoff?: { lastGroundedFrame: number; firstAirborneFrame: number };
  landing?: { lastAirborneFrame: number; firstGroundedFrame: number };
  confirmations: {
    sourceReviewed: true;
    markerSizeConfirmed?: true;
    contactsVisible?: true;
    comparablePosture?: true;
  };
}
export interface JumpRecoveryPreview {
  heightMetres: number;
  displayValue: string;
  label: "ESTIMATE";
  method: JumpRecoveryMethod;
  rangeMetres: [number, number];
  warnings: string[];
  fields: Record<string, unknown>;
  sourceFingerprint: string;
}

/** Strict source timing only; nominal FPS and HTML duration are not evidence. */
export function validJumpSource(source: JumpReviewSource | null): source is JumpReviewSource {
  if (!source || !source.path || !source.generation || !source.mediaUrl ||
      !Number.isFinite(source.width) || source.width <= 0 || !Number.isFinite(source.height) || source.height <= 0) return false;
  // A nonzero media start can map differently in browser containers. Do not
  // claim a frame correspondence until that mapping has been verified.
  if (source.presentationTimeOriginSeconds != null && (!Number.isFinite(source.presentationTimeOriginSeconds) || Math.abs(source.presentationTimeOriginSeconds) > 1e-6)) return false;
  const timestamps = source.presentationTimestampsSeconds;
  return Array.isArray(timestamps) && timestamps.length >= 2 && timestamps.every((t, i) =>
    Number.isFinite(t) && t >= 0 && (i === 0 || t > timestamps[i - 1]));
}

/** Map the authoritative normalized source timeline to browser media time. */
export function jumpFrameTime(timestamps: number[], frame: number): number {
  if (!Number.isInteger(frame) || frame < 0 || frame >= timestamps.length) return 0;
  return timestamps[frame] - timestamps[0];
}

/** A seek request is not proof that the decoder displayed the requested frame. */
export function jumpPresentedFrameMatches(timestamps: number[], frame: number, mediaTime: number): boolean {
  if (!Number.isInteger(frame) || frame < 0 || frame >= timestamps.length || !Number.isFinite(mediaTime)) return false;
  const previous = frame > 0 ? timestamps[frame] - timestamps[frame - 1] : Infinity;
  const next = frame + 1 < timestamps.length ? timestamps[frame + 1] - timestamps[frame] : Infinity;
  // Permit timestamp rounding, never an adjacent source frame or an arbitrary
  // position within the selected interval (HTML currentTime is not evidence).
  const tolerance = Math.max(1e-6, Math.min(.001, Math.min(previous, next) / 10));
  return Math.abs(mediaTime - jumpFrameTime(timestamps, frame)) <= tolerance;
}

export function jumpFrameAtTime(timestamps: number[], mediaTime: number): number {
  if (!timestamps.length || !Number.isFinite(mediaTime)) return 0;
  const target = Math.max(0, mediaTime) + timestamps[0];
  let low = 0, high = timestamps.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (timestamps[mid] <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function jumpPlaybackProblem(source: JumpReviewSource, decoded: { width: number; height: number; duration: number }): string | null {
  if (decoded.width !== source.width || decoded.height !== source.height) return "The displayed recording dimensions do not match its reviewed source. Reload the evidence before selecting points.";
  const timestamps = source.presentationTimestampsSeconds;
  const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]).sort((a, b) => a - b);
  const interval = intervals[Math.floor(intervals.length / 2)];
  const expected = timestamps[timestamps.length - 1] - timestamps[0] + interval;
  if (!Number.isFinite(decoded.duration) || !(decoded.duration > 0) || Math.abs(decoded.duration - expected) > Math.max(.1, 2 * interval)) return "Browser playback timing does not match the original frame timestamps. This recording needs a verified playback mapping before review.";
  return null;
}

export function markerProblem(corners: JumpPoint[]): string | null {
  if (corners.length !== 4) return "Select all four black-border corners, clockwise around the marker.";
  if (corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return "Each corner must be inside the recording.";
  const turns = corners.map((a, i) => {
    const b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  if (turns.some(t => Math.abs(t) < 1e-8) || !(turns.every(t => t > 0) || turns.every(t => t < 0))) return "Corners must trace one non-crossing square outline in order.";
  return null;
}

export function flightFrameProblem(frames: (number | null)[], lastFrame: number): string | null {
  if (frames.length !== 4 || frames.some(f => f === null || !Number.isInteger(f) || f < 0 || f > lastFrame)) return "Mark the four ground-contact boundary frames.";
  const [ground, airborne, beforeLanding, landed] = frames as number[];
  if (!(ground < airborne && airborne <= beforeLanding && beforeLanding < landed)) return "Takeoff must come before landing, with each contact boundary in order.";
  if (airborne - ground !== 1 || landed - beforeLanding !== 1) return "Use adjacent frames on each side of takeoff and landing.";
  return null;
}

export function assertJumpPreview(preview: JumpRecoveryPreview, input: JumpRecoveryInput): void {
  if (preview?.label !== "ESTIMATE" || preview.method !== input.method || preview.sourceFingerprint !== input.sourceFingerprint ||
      !Number.isFinite(preview.heightMetres) || preview.heightMetres <= 0 ||
      !Array.isArray(preview.rangeMetres) || preview.rangeMetres.length !== 2 ||
      preview.rangeMetres.some(n => !Number.isFinite(n) || n < 0) || preview.rangeMetres[0] > preview.rangeMetres[1]) {
    throw new Error("The review response did not match this recording. Reload its evidence before saving.");
  }
}
