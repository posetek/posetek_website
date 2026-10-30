import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../lib/jumpRecoveryData", () => ({ loadJumpReview: vi.fn(), previewJumpRecovery: vi.fn(), saveJumpRecovery: vi.fn() }));
import { JumpReviewEditor } from "./JumpReviewPanel";
import type { JumpReviewContext } from "../lib/jumpRecovery";

const empty: JumpReviewContext = { source: null, expectedRevisionId: null, originalHeight: null, availableMethods: [], blockers: ["No original recording was recovered."], sourceFingerprint: "" };
const props = { playerId: "synthetic", repId: "synthetic-jump", athleteName: "Example player", onSaved: vi.fn(), onReload: vi.fn() };
it("shows missing source and retest guidance without exposing a save", () => {
  const html = renderToStaticMarkup(<JumpReviewEditor {...props} context={empty} />);
  expect(html).toContain("ESTIMATE ONLY");
  expect(html).toContain("Recover the phone recording or mark this test for a retest");
  expect(html).not.toContain("Save estimate");
  expect(html).not.toContain("Calculate estimate");
});
it("shows manual corner and contact-based methods, with no valid-result checkbox", () => {
  const context: JumpReviewContext = { ...empty, blockers: [], availableMethods: ["manual_marker", "flight_time"], sourceFingerprint: "synthetic-v1", source: { path: "synthetic/jump.mov", generation: "synthetic-version", mediaUrl: "https://example.test/jump.mov", width: 480, height: 640, poseAvailable: true, presentationTimestampsSeconds: [0, .01, .02] } };
  const html = renderToStaticMarkup(<JumpReviewEditor {...props} context={context} />);
  expect(html).toContain("Select four corners");
  expect(html).toContain("Measured black-square side (cm)");
  expect(html).toContain("flight-time estimate");
  expect(html).toContain("Saved estimates stay out of verified team rankings");
  expect(html).toContain("synthetic-version");
  expect(html).not.toContain("Clear the processing failure");
  expect(html).toMatch(/disabled=""[^>]*>Calculate estimate/);
});
