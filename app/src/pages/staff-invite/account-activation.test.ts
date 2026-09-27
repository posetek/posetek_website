import { describe, expect, it, vi } from "vitest";
import { activateManagedAccount, confirmCurrentAccess, signInForAccessLink } from "./account-activation";
import type { AccountAccessLink } from "../../lib/account-access";
import type { ActivationDependencies } from "./account-activation";

const code = "ACCESS-" + "A".repeat(64);
const link: AccountAccessLink = { status: "ready", purpose: "staff_activation", accountMode: "new", email: "coach@example.test", targetUID: "new", firstName: "Test", lastName: "Coach", role: "coach", organizationId: "club", expiresAtMillis: 1000, requiresSignIn: false };
function setup() {
  const state = { user: null as { uid: string } | null, current: true };
  const deps = {
    isCurrent: vi.fn(() => state.current), currentUser: vi.fn(() => state.user),
    complete: vi.fn<ActivationDependencies<{ uid: string }>["complete"]>(async () => ({ status: "completed", purpose: link.purpose, targetUID: link.targetUID, email: link.email, role: link.role, organizationId: link.organizationId })),
    signIn: vi.fn(async () => { state.user = { uid: "new" }; return state.user; }),
    access: vi.fn<ActivationDependencies<{ uid: string }>["access"]>(async () => ({ kind: "active", role: "coach", organizationId: "club" })),
    sendEmailVerification: vi.fn(), sendPasswordResetEmail: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(),
  };
  return { state, deps };
}
describe("managed activation without email", () => {
  it("sets a new account's chosen password once, signs in and checks current access", async () => {
    const { deps } = setup();
    expect(await activateManagedAccount(link, code, "chosen-secret", deps)).toEqual({ access: { kind: "active", role: "coach", organizationId: "club" }, recovered: false });
    expect(deps.complete).toHaveBeenCalledExactlyOnceWith(code, "chosen-secret");
    expect(deps.signIn).toHaveBeenCalledExactlyOnceWith(link.email, "chosen-secret");
    for (const fn of [deps.sendEmailVerification, deps.sendPasswordResetEmail, deps.createUser, deps.deleteUser]) expect(fn).not.toHaveBeenCalled();
  });
  it("does not supply or reset an existing activation account's password", async () => {
    const { deps, state } = setup(); state.user = { uid: "new" };
    await activateManagedAccount({ ...link, accountMode: "existing", requiresSignIn: true }, code, undefined, deps);
    expect(deps.complete).toHaveBeenCalledExactlyOnceWith(code, undefined);
    expect(deps.signIn).not.toHaveBeenCalled();
    await expect(activateManagedAccount({ ...link, accountMode: "existing" }, code, "not-allowed", deps)).rejects.toThrow("existing password");
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });
  it("refuses an existing activation before the bound account is signed in", async () => {
    const { deps, state } = setup(); state.user = { uid: "another" };
    await expect(activateManagedAccount({ ...link, accountMode: "existing" }, code, undefined, deps)).rejects.toThrow("account named");
    expect(deps.complete).not.toHaveBeenCalled();
  });
  it("recovers a lost completion response through same-UID ordinary sign-in without replay", async () => {
    const { deps } = setup(); deps.complete.mockRejectedValueOnce(new Error("response lost"));
    expect((await activateManagedAccount(link, code, "chosen-secret", deps)).recovered).toBe(true);
    expect(deps.complete).toHaveBeenCalledTimes(2); expect(deps.complete.mock.calls[1]).toEqual([code]); expect(deps.signIn).toHaveBeenCalledTimes(1);
  });
  it("does not recover a lost response with another account's successful sign-in", async () => {
    const { deps, state } = setup(); deps.complete.mockRejectedValue(new Error("response lost"));
    deps.signIn.mockImplementation(async () => { state.user = { uid: "other" }; return state.user; });
    await expect(activateManagedAccount(link, code, "chosen-secret", deps)).rejects.toThrow("account named");
    expect(deps.access).not.toHaveBeenCalled(); expect(deps.complete).toHaveBeenCalledTimes(1);
  });
  it("does not turn existing membership in another organization into activation success", async () => {
    const { deps } = setup(); deps.access.mockResolvedValue({ kind: "active", role: "coach", organizationId: "other" });
    await expect(activateManagedAccount(link, code, "chosen-secret", deps)).rejects.toThrow("could not be confirmed");
  });
  it.each(["completed", "processing"] as const)("uses sign-in-only recovery after %s, never replays a password", async status => {
    const { deps } = setup();
    await expect(activateManagedAccount({ ...link, status }, code, "chosen-secret", deps)).rejects.toThrow("Sign in");
    await expect(signInForAccessLink({ ...link, status }, code, "chosen-secret", deps)).resolves.toMatchObject({ kind: "active" });
    expect(deps.complete).toHaveBeenCalledExactlyOnceWith(code);
  });
  it("requires code-only server acknowledgement for an already signed-in account", async () => {
    const { deps, state } = setup(); state.user = { uid: "new" };
    await expect(confirmCurrentAccess(link, code, deps)).resolves.toMatchObject({ kind: "active" });
    expect(deps.complete).toHaveBeenCalledExactlyOnceWith(code); expect(deps.signIn).not.toHaveBeenCalled();
  });
  it("resumes a server-confirmed processing stage before signing into a disabled new account", async () => {
    const { deps } = setup(); let enabled = false;
    deps.complete.mockImplementation(async () => { enabled = true; return { status: "completed", purpose: link.purpose, targetUID: link.targetUID, email: link.email, role: link.role, organizationId: link.organizationId }; });
    const signIn = deps.signIn.getMockImplementation()!;
    deps.signIn.mockImplementation(async (...args) => { expect(enabled).toBe(true); return signIn(...args); });
    await expect(signInForAccessLink({ ...link, status: "processing" }, code, "chosen-secret", deps)).resolves.toMatchObject({ kind: "active" });
    expect(deps.complete).toHaveBeenCalledExactlyOnceWith(code);
  });
  it("can sign in and acknowledge after an anonymous processing resume is refused", async () => {
    const { deps } = setup(); deps.complete.mockRejectedValueOnce(new Error("sign in first"));
    await expect(signInForAccessLink({ ...link, status: "processing" }, code, "chosen-secret", deps)).resolves.toMatchObject({ kind: "active" });
    expect(deps.complete.mock.calls).toEqual([[code], [code]]);
  });
  it("never reports a refused recovery as successful when the chosen password still signs in", async () => {
    const { deps } = setup();
    deps.complete.mockRejectedValue(Object.assign(new Error("Recovery refused"), { code: "failed-precondition" }));
    await expect(activateManagedAccount({ ...link, purpose: "account_recovery", accountMode: "existing" }, code, "same-old-password", deps)).rejects.toThrow("Recovery refused");
    expect(deps.signIn).toHaveBeenCalledExactlyOnceWith(link.email, "same-old-password");
    expect(deps.complete.mock.calls).toEqual([[code, "same-old-password"], [code]]);
    expect(deps.access).not.toHaveBeenCalled();
  });
  it("allows an expressly issued recovery link to set a chosen password", async () => {
    const { deps } = setup(); const recovery = { ...link, purpose: "account_recovery" as const, accountMode: "existing" as const };
    deps.complete.mockResolvedValue({ status: "completed", purpose: recovery.purpose, targetUID: link.targetUID, email: link.email, role: link.role, organizationId: link.organizationId });
    await activateManagedAccount(recovery, code, "recovered-password", deps);
    expect(deps.complete).toHaveBeenCalledExactlyOnceWith(code, "recovered-password");
  });
  it.each(["complete", "signin", "readback"])("ignores a late account response after %s", async stage => {
    const { deps, state } = setup();
    if (stage === "complete") deps.complete.mockImplementation(async () => { state.current = false; return { status: "completed", purpose: link.purpose, targetUID: link.targetUID, email: link.email, role: link.role, organizationId: link.organizationId }; });
    if (stage === "signin") deps.signIn.mockImplementation(async () => { state.current = false; state.user = { uid: "new" }; return state.user; });
    if (stage === "readback") deps.access.mockImplementation(async () => { state.current = false; return { kind: "active", role: "coach", organizationId: "club" }; });
    await expect(activateManagedAccount(link, code, "chosen-secret", deps)).rejects.toThrow("sign-in changed");
  });
});
