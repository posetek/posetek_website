import { resultUsable } from "../../lib/result-values";
// Canvas rendering ported from athlete-drill-view.js (drawFrame + overlays).
// Colors, line widths, fonts and label geometry are copied verbatim.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { PageDrillKey } from "./drill-config";
import {
  asInteger,
  asNumber,
  hipCenter,
  mergedMetric,
  metersToFeet,
  parsePoint,
  resolveShuttleBounds,
  shuttlePhaseAt,
  validPoint,
  type Frame,
  type Rep,
} from "./drill-lib";

export const skeleton33: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export const skeleton17: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
];

function canvasSetup(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function mapped(point: { x: number; y: number }, width: number, height: number) {
  return { x: point.x * width, y: point.y * height };
}

export interface PoseDrawOptions {
  canvas: HTMLCanvasElement;
  frames: Frame[];
  frameIndex: number;
  drillKey: PageDrillKey;
  artifacts: Record<string, any>;
  rep: Rep;
}

export function drawPoseFrame({ canvas, frames, frameIndex, drillKey, artifacts, rep }: PoseDrawOptions): void {
  const setup = canvasSetup(canvas);
  if (!setup) return;
  const { context, width, height } = setup;
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0a281b");
  gradient.addColorStop(1, "#03100b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const frame = frames[frameIndex] || [];
  if (!frame.length) {
    context.fillStyle = "rgba(255,255,255,.65)";
    context.font = "600 14px Inter, sans-serif";
    context.textAlign = "center";
    context.fillText(frames.length ? "Pose not detected in this frame" : "Pose artifact unavailable", width / 2, height / 2);
    return;
  }

  if (drillKey === "broadJump") drawBroadJumpOverlay(context, width, height, frameIndex, artifacts, rep);
  else drawShuttleOverlay(context, width, height, frames, frameIndex, artifacts, rep);

  const edges = frame.length >= 30 ? skeleton33 : skeleton17;
  context.strokeStyle = "rgba(247,251,249,.9)";
  context.lineWidth = 2;
  edges.forEach(([a, b]) => {
    const first = validPoint(frame, a);
    const second = validPoint(frame, b);
    if (!first || !second) return;
    const p1 = mapped(first, width, height);
    const p2 = mapped(second, width, height);
    context.beginPath();
    context.moveTo(p1.x, p1.y);
    context.lineTo(p2.x, p2.y);
    context.stroke();
  });
  frame.forEach(point => {
    if (!point) return;
    const p = mapped(point, width, height);
    context.beginPath();
    context.arc(p.x, p.y, 3, 0, Math.PI * 2);
    context.fillStyle = "#7cff18";
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.8)";
    context.lineWidth = 1;
    context.stroke();
  });
}

export function drawBroadJumpOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
  artifacts: Record<string, any>,
  rep: Rep,
): void {
  if (!resultUsable(rep)) return;
  const meta = (artifacts["metadata.json"] || {}) as Record<string, any>;
  const fit = (artifacts["foot_piecewise_fit.json"] || {}) as Record<string, any>;
  const ground = asNumber(meta.ground_loc_y);
  const takeoffX = asNumber(fit.startFootXNorm);
  const landingX = asNumber(fit.endFootXNorm);
  if (ground !== null && ground >= 0 && ground <= 1) {
    context.strokeStyle = "rgba(0,0,0,.75)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, ground * height);
    context.lineTo(width, ground * height);
    context.stroke();
  }
  const guides: [number | null, string][] = [[takeoffX, "#71d39b"], [landingX, "#ff7d7d"]];
  guides.forEach(([x, color]) => {
    if (x === null || x < 0 || x > 1) return;
    context.save();
    context.setLineDash([7, 5]);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x * width, 0);
    context.lineTo(x * width, height);
    context.stroke();
    context.restore();
  });
  if (takeoffX !== null && landingX !== null && takeoffX >= 0 && takeoffX <= 1 && landingX >= 0 && landingX <= 1) {
    const distance = mergedMetric(artifacts, rep, "broadJumpDistance");
    context.fillStyle = "rgba(0,0,0,.68)";
    const centerX = ((takeoffX + landingX) / 2) * width;
    const labelY = Math.max(22, (ground ?? 0.9) * height - 18);
    context.fillRect(centerX - 34, labelY - 15, 68, 24);
    context.fillStyle = "#fff";
    context.font = "700 12px Inter";
    context.textAlign = "center";
    context.fillText(distance === null ? "—" : `${metersToFeet(distance).toFixed(1)} ft`, centerX, labelY + 1);
  }

  const comSeries = Array.isArray(artifacts["com_midpoints.json"]) ? (artifacts["com_midpoints.json"] as any[]) : [];
  const low = Math.max(0, frameIndex - 40);
  context.strokeStyle = "#66d6e8";
  context.lineWidth = 2;
  context.beginPath();
  let started = false;
  for (let index = low; index <= frameIndex && index < comSeries.length; index += 1) {
    const point = parsePoint(comSeries[index]);
    if (!point) { started = false; continue; }
    const p = mapped(point, width, height);
    if (started) context.lineTo(p.x, p.y);
    else {
      context.moveTo(p.x, p.y);
      started = true;
    }
  }
  if (started) context.stroke();

  const currentCom = parsePoint(comSeries[frameIndex]);
  const footSeries = Array.isArray(artifacts["foot_centers.json"]) ? (artifacts["foot_centers.json"] as any[]) : [];
  const currentFoot = parsePoint(footSeries[frameIndex]);
  const dots: [{ x: number; y: number } | null, string, number][] = [
    [currentCom, "#66d6e8", 4],
    [currentFoot, "#ffad5c", 3.5],
  ];
  dots.forEach(([point, color, radius]) => {
    if (!point) return;
    const p = mapped(point, width, height);
    context.beginPath();
    context.arc(p.x, p.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  });
}

export function drawShuttleOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  frames: Frame[],
  frameIndex: number,
  artifacts: Record<string, any>,
  rep: Rep,
  // Body-centre track override: tracking.json COM for reps without pose.
  centers?: ({ x: number; y: number } | null)[],
): void {
  if (!resultUsable(rep)) return;
  const meta = (artifacts["metadata.json"] || {}) as Record<string, any>;
  const bounds = resolveShuttleBounds(meta, rep);
  const start = asInteger(meta.startFrame) ?? 0;
  const centerAt = (index: number) => centers ? centers[index] ?? null : hipCenter(frames[index]);
  const available = centers ? centers.length : frames.length;
  (["outbound", "turn", "inbound"] as const).forEach(phaseKey => {
    context.beginPath();
    let started = false;
    let phaseColor = "#fff";
    for (let index = start; index <= frameIndex && index < available; index += 1) {
      const phase = shuttlePhaseAt(index, bounds);
      const center = centerAt(index);
      if (!phase || phase.key !== phaseKey || !center) { started = false; continue; }
      phaseColor = phase.color;
      const p = mapped(center, width, height);
      if (started) context.lineTo(p.x, p.y);
      else {
        context.moveTo(p.x, p.y);
        started = true;
      }
    }
    if (started) {
      context.strokeStyle = phaseColor;
      context.lineWidth = 2.5;
      context.stroke();
    }
  });
  const center = centerAt(frameIndex);
  if (center) {
    const phase = shuttlePhaseAt(frameIndex, bounds);
    const p = mapped(center, width, height);
    context.beginPath();
    context.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    context.fillStyle = phase?.color || "#fff";
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 1;
    context.stroke();
  }
}
