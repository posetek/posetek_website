import { describe, expect, it } from "vitest";
import { assertJumpPreview, assertJumpRecoverySaved, flightFrameProblem, jumpFrameAtTime, jumpFrameTime, jumpPlaybackProblem, jumpPresentedFrameMatches, markerProblem, validJumpSource } from "./jumpRecovery";
import type { JumpRecoveryInput, JumpRecoveryPreview, JumpReviewSource } from "./jumpRecovery";

const source: JumpReviewSource = { path: "synthetic/jump.mov", generation: "1", mediaUrl: "https://example.test/recording", width: 480, height: 640, poseAvailable: true, presentationTimestampsSeconds: [4, 4.008, 4.017, 4.027, 4.035] };
const request: JumpRecoveryInput = { schemaVersion: 1, operationId: "synthetic-operation", method: "flight_time", expectedRevisionId: null, sourceFingerprint: "synthetic-v1", source: { path: source.path, generation: source.generation }, takeoff: { lastGroundedFrame: 0, firstAirborneFrame: 1 }, landing: { lastAirborneFrame: 3, firstGroundedFrame: 4 }, confirmations: { sourceReviewed: true, contactsVisible: true, comparablePosture: true } };
const preview: JumpRecoveryPreview = { heightMetres: .24, displayValue: "~24 cm", label: "ESTIMATE", method: "flight_time", rangeMetres: [.22, .26], warnings: [], fields: { jumpHeight: .24 }, sourceFingerprint: request.sourceFingerprint };

describe("jump recovery source timing", () => {
  it("accepts exact variable frame timestamps, without deriving timing from fps", () => {
    expect(validJumpSource(source)).toBe(true);
    expect(jumpFrameTime(source.presentationTimestampsSeconds, 3)).toBeCloseTo(.027);
    expect(jumpFrameAtTime(source.presentationTimestampsSeconds, .016)).toBe(1);
    expect(jumpFrameAtTime(source.presentationTimestampsSeconds, .02)).toBe(2);
    expect(jumpFrameAtTime(source.presentationTimestampsSeconds, 100)).toBe(4);
  });
  it.each([[], [0], [0, 0], [0, -.01], [0, Number.NaN], [0, .1, .05]].map(times => ({ times })))("refuses incomplete/nonmonotonic timing $times", ({ times: presentationTimestampsSeconds }) => {
    expect(validJumpSource({ ...source, presentationTimestampsSeconds })).toBe(false);
  });
  it("requires exact media identity and dimensions", () => {
    expect(validJumpSource({ ...source, generation: "" })).toBe(false);
    expect(validJumpSource({ ...source, width: 0 })).toBe(false);
    expect(validJumpSource({ ...source, mediaUrl: "" })).toBe(false);
    expect(validJumpSource(null)).toBe(false);
    expect(validJumpSource({ ...source, presentationTimeOriginSeconds: 4 })).toBe(false);
    expect(validJumpSource({ ...source, presentationTimeOriginSeconds: 0 })).toBe(true);
  });
  it("blocks slow-motion playback, unknown duration and rotated/stretched media", () => {
    expect(jumpPlaybackProblem(source, { width: 480, height: 640, duration: .044 })).toBeNull();
    expect(jumpPlaybackProblem(source, { width: 640, height: 480, duration: .044 })).toMatch(/dimensions/);
    expect(jumpPlaybackProblem(source, { width: 480, height: 640, duration: 1 })).toMatch(/timing/);
    expect(jumpPlaybackProblem(source, { width: 480, height: 640, duration: Infinity })).toMatch(/timing/);
  });
  it("verifies the decoded frame timestamp, not the requested seek position", () => {
    const timestamps = source.presentationTimestampsSeconds;
    expect(jumpPresentedFrameMatches(timestamps, 2, .017)).toBe(true);
    expect(jumpPresentedFrameMatches(timestamps, 2, .017001)).toBe(true);
    expect(jumpPresentedFrameMatches(timestamps, 2, .008)).toBe(false);
    expect(jumpPresentedFrameMatches(timestamps, 2, .022)).toBe(false);
    expect(jumpPresentedFrameMatches(timestamps, 2, .027)).toBe(false);
    expect(jumpPresentedFrameMatches(timestamps, 2, Number.NaN)).toBe(false);
    expect(jumpPresentedFrameMatches(timestamps, 9, .017)).toBe(false);
  });
});

describe("manual frame and marker selection", () => {
  const corners = [{ x: .1, y: .6 }, { x: .3, y: .6 }, { x: .29, y: .8 }, { x: .11, y: .8 }];
  it("accepts either winding around a convex marker", () => {
    expect(markerProblem(corners)).toBeNull();
    expect(markerProblem([...corners].reverse())).toBeNull();
  });
  it("rejects crossed, missing, out-of-frame or duplicate corners", () => {
    expect(markerProblem([corners[0], corners[2], corners[1], corners[3]])).toMatch(/non-crossing/);
    expect(markerProblem(corners.slice(0, 3))).toMatch(/four/);
    expect(markerProblem([{ x: -1, y: 0 }, ...corners.slice(1)])).toMatch(/inside/);
    expect(markerProblem([corners[0], corners[0], ...corners.slice(2)])).toMatch(/non-crossing/);
  });
  it("requires adjacent contact boundaries, not guessed event points", () => {
    expect(flightFrameProblem([10, 11, 40, 41], 100)).toBeNull();
    expect(flightFrameProblem([10, 14, 40, 41], 100)).toMatch(/adjacent/);
    expect(flightFrameProblem([10, 11, 40, 40], 100)).toMatch(/order/);
    expect(flightFrameProblem([10, 11, 8, 9], 100)).toMatch(/order/);
    expect(flightFrameProblem([10, 11, 40, null], 100)).toMatch(/four/);
    expect(flightFrameProblem([10, 11, 40, 41], 30)).toMatch(/four/);
  });
});

describe("estimate preview identity", () => {
  it("requires estimate status, method and source to match the reviewed request", () => {
    expect(() => assertJumpPreview(preview, request)).not.toThrow();
    expect(() => assertJumpPreview({ ...preview, label: "VERIFIED" as "ESTIMATE" }, request)).toThrow(/did not match/);
    expect(() => assertJumpPreview({ ...preview, method: "manual_marker" }, request)).toThrow(/did not match/);
    expect(() => assertJumpPreview({ ...preview, sourceFingerprint: "new-source" }, request)).toThrow(/did not match/);
  });
  it("rejects invalid or reversed uncertainty instead of presenting a result", () => {
    expect(() => assertJumpPreview({ ...preview, heightMetres: Number.NaN }, request)).toThrow();
    expect(() => assertJumpPreview({ ...preview, rangeMetres: [.4, .2] }, request)).toThrow();
  });
});

describe("estimate save readback", () => {
  const recovery = { isEstimate: true, heightMetres: .24 };
  const result = { revisionId: "new-revision", rep: { jumpHeight: null, jumpRecovery: recovery } };
  const fresh = { source, expectedRevisionId: result.revisionId, originalHeight: .24, originalHeightIsEstimate: true, rootJumpHeight: null, jumpRecovery: recovery, availableMethods: ["flight_time" as const], blockers: [], sourceFingerprint: request.sourceFingerprint };
  it("accepts only a labeled nested estimate with empty legacy height", () => {
    expect(() => assertJumpRecoverySaved(result, fresh, preview)).not.toThrow();
    expect(() => assertJumpRecoverySaved({ ...result, rep: { ...result.rep, jumpHeight: .24 } }, fresh, preview)).toThrow();
    expect(() => assertJumpRecoverySaved(result, { ...fresh, rootJumpHeight: .24 }, preview)).toThrow();
    expect(() => assertJumpRecoverySaved(result, { ...fresh, jumpRecovery: { ...recovery, isEstimate: false } }, preview)).toThrow();
    expect(() => assertJumpRecoverySaved(result, { ...fresh, originalHeightIsEstimate: false }, preview)).toThrow();
  });
  it("rejects missing or changed nested evidence and stale revision", () => {
    expect(() => assertJumpRecoverySaved({ ...result, rep: { jumpHeight: null } }, fresh, preview)).toThrow();
    expect(() => assertJumpRecoverySaved(result, { ...fresh, jumpRecovery: { ...recovery, heightMetres: .23 } }, preview)).toThrow();
    expect(() => assertJumpRecoverySaved(result, { ...fresh, expectedRevisionId: "old" }, preview)).toThrow();
  });
});
