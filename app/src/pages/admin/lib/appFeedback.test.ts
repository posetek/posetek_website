import { describe, expect, it } from "vitest";
import {
  feedbackDate, feedbackRate, feedbackReadError, feedbackShareUrl, normalizeAppFeedbackResponse, normalizeAppFeedbackReview,
} from "./appFeedback";

const response = { id: "response-1", formVersion: 1, entrySource: "qr", answers: { feature: "workouts", ease: "easy", obstruction: "none", comment: "" }, createdAtMillis: Date.UTC(2026, 9, 3, 17) };
const review = { responses: [response], nextCursor: { at: response.createdAtMillis, id: response.id }, metrics: { opened: 100, started: 60, submitted: 30 }, retentionDays: 90 };

describe("app feedback admin helpers", () => {
  it("uses session-wide counts supplied by the server rather than the 50-response page", () => {
    const parsed = normalizeAppFeedbackReview(review);
    expect(parsed.responses).toHaveLength(1);
    expect(parsed.metrics).toEqual({ opened: 100, started: 60, submitted: 30 });
    expect(feedbackRate(parsed.metrics.submitted, parsed.metrics.opened)).toBe("30%");
    expect(feedbackRate(parsed.metrics.submitted, parsed.metrics.started)).toBe("50%");
    expect(feedbackRate(0, 0)).toBe("—");
  });

  it("retains the stable server cursor and distinguishes a final page", () => {
    expect(normalizeAppFeedbackReview(review).nextCursor).toEqual(review.nextCursor);
    expect(normalizeAppFeedbackReview({ ...review, nextCursor: null }).nextCursor).toBeNull();
    for (const nextCursor of [undefined, {}, { at: 0, id: "x" }, { at: response.createdAtMillis, id: "" }]) {
      expect(() => normalizeAppFeedbackReview({ ...review, nextCursor })).toThrow("cursor");
    }
  });

  it("rejects invalid counts, unsupported versions and oversized pages instead of displaying misleading rates", () => {
    expect(() => normalizeAppFeedbackReview({ ...review, metrics: { ...review.metrics, opened: -1 } })).toThrow();
    expect(() => normalizeAppFeedbackReview({ ...review, metrics: { ...review.metrics, submitted: "30" } })).toThrow();
    expect(() => normalizeAppFeedbackReview({ ...review, retentionDays: 30 })).toThrow();
    expect(() => normalizeAppFeedbackReview({ ...review, responses: [{ ...response, formVersion: 2 }] })).toThrow();
    expect(() => normalizeAppFeedbackReview({ ...review, responses: Array.from({ length: 51 }, () => response) })).toThrow();
  });

  it("handles skipped answers and absent duration without inventing times", () => {
    const row = normalizeAppFeedbackResponse("x", { answers: { feature: null, ease: null, obstruction: null, comment: "" } });
    expect(row.answers).toEqual({ feature: null, ease: null, obstruction: null, comment: "" });
    expect(row.createdAtMillis).toBeNull();
    expect(row.durationSeconds).toBeUndefined();
    expect(feedbackDate(null)).toBe("Date unavailable");
    expect(feedbackDate(response.createdAtMillis)).toContain("10:00 AM");
    expect(normalizeAppFeedbackResponse("x", { createdAt: { seconds: 1791046800, nanoseconds: 123000000 }, durationSeconds: -1 }).createdAtMillis).toBe(1791046800123);
  });

  it("makes broad share links without player identifiers, accounts or claims of message delivery", () => {
    expect(feedbackShareUrl("qr")).toBe("https://posetek.net/feedback?source=qr");
    expect(feedbackShareUrl("message")).toBe("https://posetek.net/feedback?source=message");
    expect(feedbackReadError({ code: "functions/permission-denied" })).toContain("admin access");
    expect(feedbackReadError({ message: "private backend details" })).not.toContain("private backend details");
  });
});
