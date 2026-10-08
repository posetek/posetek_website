import { describe, expect, it, vi } from "vitest";
import { canManagePlayerRecovery, confirmRecoverySignIn, prepareRecoveryAttempt, recoveryError, recoverySelectionIsCurrent, recoveryStatus } from "./account-recovery";

const input = { email: " PLAYER@example.test ", name: " Sample Player ", organizationName: " Sample club ", contact: " Ask my organization admin " };
describe("sign-in help request retry", () => {
  it("keeps the same reference and immutable claims after an interrupted response", () => {
    const uuid = vi.fn(() => "request-one");
    const original = prepareRecoveryAttempt(input, null, uuid);
    expect(original.input).toEqual({ email: "player@example.test", name: "Sample Player", organizationName: "Sample club", contact: "Ask my organization admin" });
    expect(prepareRecoveryAttempt({ ...input, email: "player@example.test" }, original, uuid)).toBe(original);
    expect(uuid).toHaveBeenCalledOnce();
  });
  it("starts a separate request when the account claims or contact change", () => {
    const previous = prepareRecoveryAttempt(input, null, () => "request-one");
    for (const key of ["email", "name", "organizationName", "contact"] as const) {
      const next = prepareRecoveryAttempt({ ...input, [key]: "Changed" }, previous, () => "request-two");
      expect(next.requestId).toBe("request-two"); expect(next).not.toBe(previous);
    }
  });
  it("never exposes response text or secrets in an error message", () => {
    const secret = "ACCESS-" + "A".repeat(64);
    expect(recoveryError({ code: "functions/failed-precondition", message: secret })).not.toContain(secret);
    expect(recoveryError({ message: "player@example.test" })).not.toContain("player@example.test");
    expect(recoveryError({ code: "functions/resource-exhausted" })).toContain("Wait");
    expect(recoveryError({ code: "functions/permission-denied" })).toContain("cannot help");
    expect(recoveryError({ code: "functions/aborted" })).toContain("Refresh");
  });
});
describe("recovery authority and server evidence", () => {
  it("rejects a late result after sign-out, account change, player selection, scope change or reset", () => {
    const expected = { uid: "manager", organizationId: "club", playerId: "one", revision: 1 };
    expect(recoverySelectionIsCurrent(expected, { ...expected })).toBe(true);
    for (const changed of [{ uid: null }, { uid: "other-manager" }, { organizationId: "other-club" }, { playerId: "two" }, { revision: 2 }]) expect(recoverySelectionIsCurrent(expected, { ...expected, ...changed })).toBe(false);
  });
  it("only presents recovery tools for managers and PoseTek admins", () => {
    expect(canManagePlayerRecovery("manager")).toBe(true); expect(canManagePlayerRecovery("admin")).toBe(true);
    for (const role of ["player", "coach", "independent", "none", undefined]) expect(canManagePlayerRecovery(role)).toBe(false);
  });
  it("distinguishes creating, sharing, updating the password and confirming sign-in", () => {
    expect(recoveryStatus("link_ready")).toContain("awaiting sharing");
    expect(recoveryStatus("link_shared")).toContain("awaiting password update");
    expect(recoveryStatus("reset_completed")).toContain("sign-in not confirmed");
    expect(recoveryStatus("confirmed")).toBe("Sign-in confirmed");
    expect(recoveryStatus("expired")).toContain("expired"); expect(recoveryStatus("closed")).toBe("Closed");
  });
  it.each(["other", "stale", "activation", "missing-grant"])("does not acknowledge sign-in for %s", async scenario => {
    const confirm = vi.fn();
    await confirmRecoverySignIn({ purpose: scenario === "activation" ? "staff_activation" : "account_recovery", grantId: scenario === "missing-grant" ? undefined : "grant", targetUID: "player" }, scenario === "other" ? "another-player" : "player", () => scenario !== "stale", confirm);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("keeps access available when acknowledgement fails and never supplies a password", async () => {
    const confirm = vi.fn(async () => { throw new Error("response lost"); });
    await expect(confirmRecoverySignIn({ purpose: "account_recovery", grantId: "grant", targetUID: "player" }, "player", () => true, confirm)).resolves.toBeUndefined();
    expect(confirm).toHaveBeenCalledExactlyOnceWith("grant");
  });
  it("bounds a missing acknowledgement response and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      const confirm = vi.fn(() => new Promise<unknown>(() => {}));
      const attempt = confirmRecoverySignIn({ purpose: "account_recovery", grantId: "grant", targetUID: "player" }, "player", () => true, confirm);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(attempt).resolves.toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
