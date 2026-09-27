import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureStaffAccessLink, forgetStaffAccessLink, initialStaffAccessLink, matchesAccessLink, readStaffAccessLink, resolveAccountAccess, staffAccessUrl } from "./account-access";
import type { AccessDependencies, AccessUser } from "./account-access";

const code = "ACCESS-" + "A".repeat(64);
describe("staff access link privacy", () => {
  beforeEach(forgetStaffAccessLink);
  it("captures fragment links and removes the secret before later page consumers", () => {
    const replaceState = vi.fn();
    const browser = { location: { href: staffAccessUrl(code) }, history: { state: { retain: true }, replaceState } } as unknown as Pick<Window, "location" | "history">;
    captureStaffAccessLink(browser);
    expect(initialStaffAccessLink()).toEqual({ present: true, code });
    expect(replaceState).toHaveBeenCalledExactlyOnceWith({ retain: true }, "", "https://posetek.net/join");
    forgetStaffAccessLink(); expect(initialStaffAccessLink().present).toBe(false);
  });
  it.each([`?accessCode=${code}`, `#accessCode=${code}`, `?accessCode=${code}#accessCode=${code.toLowerCase()}`])("normalizes and scrubs %s", suffix => {
    expect(readStaffAccessLink("https://posetek.net/join" + suffix)).toEqual({ invitation: { present: true, code }, cleanUrl: "https://posetek.net/join" });
  });
  it("rejects conflicting or malformed secrets while still clearing them", () => {
    const result = readStaffAccessLink(`https://posetek.net/join?accessCode=${code}#accessCode=wrong&section=help`);
    expect(result).toEqual({ invitation: { present: true, code: "" }, cleanUrl: "https://posetek.net/join#section=help" });
  });
  it("does not activate on another route, but removes accidentally supplied secrets", () => {
    expect(readStaffAccessLink(`https://posetek.net/signin#accessCode=${code}`)).toEqual({ invitation: { present: false, code: "" }, cleanUrl: "https://posetek.net/signin" });
  });
  it("does not modify unrelated fragments or normal URLs", () => {
    expect(readStaffAccessLink("https://posetek.net/join#help").cleanUrl).toBe("https://posetek.net/join#help");
    expect(readStaffAccessLink("https://posetek.net/join").invitation.present).toBe(false);
  });
});

function setup(email = "coach@example.test", verified = true) {
  const user: AccessUser & { sendEmailVerification: ReturnType<typeof vi.fn> } = { uid: "user", reload: vi.fn(async () => {}), getIdTokenResult: vi.fn(async () => ({ claims: { email, email_verified: verified } })), sendEmailVerification: vi.fn() };
  const deps = { isCurrent: vi.fn(() => true), context: vi.fn<AccessDependencies["context"]>(async () => ({ role: "none", organization: null })), coach: vi.fn<AccessDependencies["coach"]>(async () => null), player: vi.fn<AccessDependencies["player"]>(async () => null) };
  return { user, deps };
}
describe("fresh account entry authority", () => {
  it("stops an unverified PoseTek account without email or identity fallthrough", async () => {
    const { user, deps } = setup("ADMIN@posetek.net", false);
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "activation", reason: "admin-unverified" });
    expect(user.getIdTokenResult).toHaveBeenCalledWith(true);
    expect(user.sendEmailVerification).not.toHaveBeenCalled();
    expect(deps.context).not.toHaveBeenCalled(); expect(deps.coach).not.toHaveBeenCalled(); expect(deps.player).not.toHaveBeenCalled();
  });
  it("routes verified exact-domain accounts to admin without relying on profile documents", async () => {
    const { user, deps } = setup("admin@posetek.net");
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "active", role: "admin" });
    expect(deps.context).not.toHaveBeenCalled();
  });
  it("does not infer admin status from a similar domain", async () => {
    const { user, deps } = setup("admin@posetek.net.evil");
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "activation", reason: "unlinked" });
  });
  it.each(["manager", "coach"])("uses current canonical %s membership before legacy records", async role => {
    const { user, deps } = setup();
    deps.context.mockResolvedValue({ role, organization: { id: "club", name: "Club" } });
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "active", role, organizationId: "club", organizationName: "Club" });
    expect(deps.coach).not.toHaveBeenCalled();
  });
  it.each([{ organizationId: "club" }, { organizationRole: "coach" }, { organizationId: null }])("does not resurrect inactive managed staff through a mirror %j", async data => {
    const { user, deps } = setup(); deps.coach.mockResolvedValue({ data: () => data });
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "activation", reason: "staff-inactive" });
    expect(deps.player).not.toHaveBeenCalled();
  });
  it("preserves independent/legacy coach and canonical player destinations", async () => {
    const { user, deps } = setup(); deps.coach.mockResolvedValue({ data: () => ({ organization: "legacy-ref" }) });
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "active", role: "independent" });
    deps.coach.mockResolvedValue(null); deps.player.mockResolvedValue({ id: "player-record" });
    expect(await resolveAccountAccess(user, deps)).toEqual({ kind: "active", role: "player", playerId: "player-record" });
  });
  it("does not treat failed membership reads as unlinked or independent", async () => {
    const { user, deps } = setup(); deps.context.mockRejectedValue(new Error("offline"));
    await expect(resolveAccountAccess(user, deps)).rejects.toThrow("offline"); expect(deps.coach).not.toHaveBeenCalled();
  });
  it.each(["reload", "token", "context", "coach", "player"])("rejects a stale account at %s", async step => {
    const { user, deps } = setup(); let current = true; deps.isCurrent.mockImplementation(() => current);
    if (step === "reload") vi.mocked(user.reload).mockImplementation(async () => { current = false; });
    if (step === "token") vi.mocked(user.getIdTokenResult).mockImplementation(async () => { current = false; return { claims: {} }; });
    if (step === "context") deps.context.mockImplementation(async () => { current = false; return { role: "none", organization: null }; });
    if (step === "coach") deps.coach.mockImplementation(async () => { current = false; return null; });
    if (step === "player") deps.player.mockImplementation(async () => { current = false; return null; });
    await expect(resolveAccountAccess(user, deps)).rejects.toThrow("sign-in changed");
  });
  it("requires same UID and current exact role/org after an activation", () => {
    const link = { targetUID: "user", purpose: "staff_activation" as const, role: "coach" as const, organizationId: "club" };
    expect(matchesAccessLink(link, "other", { kind: "active", role: "coach", organizationId: "club" })).toBe(false);
    expect(matchesAccessLink(link, "user", { kind: "active", role: "manager", organizationId: "club" })).toBe(false);
    expect(matchesAccessLink(link, "user", { kind: "active", role: "coach", organizationId: "elsewhere" })).toBe(false);
    expect(matchesAccessLink(link, "user", { kind: "active", role: "coach", organizationId: "club" })).toBe(true);
  });
});
