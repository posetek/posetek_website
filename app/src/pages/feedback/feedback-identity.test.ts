import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackAccountLabel, feedbackAuthWithTimeout, feedbackNeedsSignIn, feedbackSignInPath } from "./feedback-identity";

afterEach(() => { vi.useRealTimers(); });
describe("feedback account policy", () => {
  it("requires the original account for workout/results while allowing anonymous shared links", () => {
    for (const source of ["workout", "results"] as const) expect(feedbackNeedsSignIn(source, null)).toBe(true);
    for (const source of ["qr", "message", "direct"] as const) expect(feedbackNeedsSignIn(source, null)).toBe(false);
    expect(feedbackNeedsSignIn("workout", { uid: "private", label: "Player" })).toBe(false);
    expect(feedbackNeedsSignIn("workout", null, true)).toBe(false);
  });

  it("uses recorded display name, then email, then account UID for the visible notice", () => {
    expect(feedbackAccountLabel({ uid: "uid", displayName: " Player ", email: "sample@example.test" })).toBe("Player");
    expect(feedbackAccountLabel({ uid: "uid", displayName: "  ", email: " sample@example.test " })).toBe("sample@example.test");
    expect(feedbackAccountLabel({ uid: "uid", displayName: null, email: null })).toBe("uid");
  });

  it("never carries another URL parameter into sign-in return links", () => {
    expect(feedbackSignInPath("results")).toBe("/signin?returnTo=%2Ffeedback%3Fsource%3Dresults");
  });

  it("turns a stuck auth initialization into a retryable failure instead of anonymous mode", async () => {
    vi.useFakeTimers();
    const operation = feedbackAuthWithTimeout(new Promise<never>(() => {}));
    const failed = expect(operation).rejects.toThrow("Account verification timed out");
    await vi.advanceTimersByTimeAsync(12000);
    await failed;
  });
});
