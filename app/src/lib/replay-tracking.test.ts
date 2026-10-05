import { describe, expect, it } from "vitest";
import { poseTimeline } from "./pose-playback";
import { parseTracking, poseReplayUsable, selectReplaySource, trackingCenters, trackingShapes, trackingTimelineMeta } from "./replay-tracking";

const raw = {
  schemaVersion: 1, drill: "changeOfDirection", fps: 120, frameCount: 3, coordinates: "normalized_top_left",
  frames: [
    { index: 0, timestampMs: 0, person: { x: .25, y: .1, w: .5, h: .8 }, com: { x: .5, y: .5 }, ball: null },
    { index: 1, timestampMs: 8.333, person: null, com: null, ball: null },
    { index: 2, timestampMs: 16.667, person: { x: .3, y: .2, w: .2, h: .6 }, com: { x: .4, y: .5 }, ball: { x: .45, y: .9, w: .05, h: .05 } },
  ],
};

describe("replay artifact selection", () => {
  const tracking = parseTracking(raw)!;
  it("keeps the skeleton whenever pose exists and was computed (old reps unchanged)", () => {
    expect(selectReplaySource(40, {}, tracking)).toEqual({ kind: "pose" });
    expect(selectReplaySource(40, { poseComputed: true }, null)).toEqual({ kind: "pose" });
    expect(poseReplayUsable(40, {})).toBe(true);
  });
  it("uses tracking.json when pose is absent or poseComputed is false", () => {
    expect(selectReplaySource(0, {}, tracking)).toEqual({ kind: "tracking", tracking });
    expect(selectReplaySource(40, { poseComputed: false }, tracking)).toEqual({ kind: "tracking", tracking });
    expect(poseReplayUsable(40, { poseComputed: false })).toBe(false);
  });
  it("tolerates a rep with neither file (metrics only, as today)", () => {
    expect(selectReplaySource(0, {}, null)).toEqual({ kind: "none" });
    expect(selectReplaySource(0, { poseComputed: false }, parseTracking({ frames: [] }))).toEqual({ kind: "none" });
    expect(parseTracking(null)).toBeNull();
    expect(parseTracking({ schemaVersion: 1 })).toBeNull();
    // A stray pose file is still better than a blank viewer when tracking is missing.
    expect(selectReplaySource(12, { poseComputed: false }, null)).toEqual({ kind: "pose" });
  });
});

describe("tracking box mapping", () => {
  it("maps normalized top-left boxes and the COM into the drawn content rectangle", () => {
    const tracking = parseTracking(raw)!;
    expect(tracking.frames).toHaveLength(3);
    expect(trackingShapes(tracking, 0, 400, 300)).toEqual({ person: { x: 100, y: 30, w: 200, h: 240 }, com: { x: 200, y: 150 }, ball: null });
    const last = trackingShapes(tracking, 2, 400, 300);
    expect(last.ball!.x).toBeCloseTo(180); expect(last.ball!.y).toBeCloseTo(270); expect(last.ball!.w).toBeCloseTo(20);
    expect(trackingShapes(tracking, 1, 400, 300)).toEqual({ person: null, com: null, ball: null });
    expect(trackingShapes(tracking, 99, 400, 300)).toEqual({ person: null, com: null, ball: null });
    expect(trackingCenters(tracking)).toEqual([{ x: .5, y: .5 }, null, { x: .4, y: .5 }]);
  });
  it("places frames by index, keeps the declared frame count, and rejects degenerate boxes", () => {
    const tracking = parseTracking({ frameCount: 5, frames: [{ index: 3, person: { x: .1, y: .1, w: 0, h: .2 }, com: [.2, .3] }, { index: 1, person: { x: .1, y: .1, width: .2, height: .2 } }] })!;
    expect(tracking.frames).toHaveLength(5);
    expect(tracking.frames[3]).toEqual({ person: null, com: { x: .2, y: .3 }, ball: null });
    expect(tracking.frames[1].person).toEqual({ x: .1, y: .1, w: .2, h: .2 });
    expect(tracking.frames[0]).toEqual({ person: null, com: null, ball: null });
  });
  it("normalizes declared pixel coordinates by the video size and refuses them without one", () => {
    const pixel = { coordinates: "pixels", frames: [{ index: 0, person: { x: 480, y: 270, w: 960, h: 540 }, com: { x: 960, y: 540 } }] };
    expect(parseTracking(pixel, { videoDisplayWidth: 1920, videoDisplayHeight: 1080 })!.frames[0]).toEqual({ person: { x: .25, y: .25, w: .5, h: .5 }, com: { x: .5, y: .5 }, ball: null });
    expect(parseTracking(pixel)).toBeNull();
  });
  it("keeps the skeleton's metadata clock and falls back to tracking timing only when metadata has none", () => {
    const tracking = parseTracking(raw)!;
    const meta = { framesPerSecond: 240, videoDisplayWidth: 1080 };
    expect(trackingTimelineMeta(meta, tracking)).toBe(meta);
    const stamped = poseTimeline(trackingTimelineMeta({}, tracking), 3);
    expect(stamped.source).toBe("timestamps"); expect(stamped.times[2]).toBeCloseTo(.016667);
    const untimed = parseTracking({ ...raw, frames: raw.frames.map(frame => ({ ...frame, timestampMs: null })) })!;
    expect(poseTimeline(trackingTimelineMeta({}, untimed), 3).times[1]).toBeCloseTo(1 / 120);
  });
});
