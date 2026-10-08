import { describe, expect, it, vi } from "vitest";
import { accessLinkText, accessPurposeLabel, accessStatusLabel, refreshAfterIssued } from "./access-link-issuer";
import type { IssuedAccessLink } from "./access-link-issuer";

const issued: IssuedAccessLink = { grantId: "grant", code: `ACCESS-${"AB".repeat(32)}`, activationUrl: "https://posetek.net/join", expiresAtMillis: 1_800_000_000_000, email: "coach@example.test", accountMode: "new", purpose: "staff_activation" };
describe("private access sharing", () => {
  it("copies a first-party fragment link and does not trust another returned destination", () => {
    const link = accessLinkText({ ...issued, activationUrl: "https://elsewhere.example/password?code=unsafe" }, "link");
    expect(link).toBe(`https://posetek.net/join#accessCode=${issued.code}`);
    expect(new URL(link).search).toBe("");
    expect(accessLinkText(issued, "code")).toBe(issued.code);
  });
  it("refuses malformed secrets rather than creating an unusable link", () => {
    expect(() => accessLinkText({ ...issued, code: "undefined" }, "link")).toThrow("incomplete");
    expect(() => accessLinkText({ ...issued, code: `ACCESS-${"AB".repeat(32)}&destination=bad` }, "code")).toThrow("incomplete");
  });
  it("gives different truthful guidance for new, existing and recovery accounts", () => {
    expect(accessLinkText(issued, "instructions")).toContain("Choose your own password");
    const existing = accessLinkText({ ...issued, accountMode: "existing" }, "instructions");
    expect(existing).toContain("Sign in with your existing password");
    expect(existing).toContain("No email was sent");
    const recovery = accessLinkText({ ...issued, purpose: "account_recovery", accountMode: "existing" }, "instructions");
    expect(recovery).toContain("Choose a new password for your existing account");
    expect(recovery).not.toContain("activate your access");
  });
  it("uses readable invitation and completion states", () => {
    expect(accessStatusLabel("pending", "staff_activation", 300, 200)).toBe("Awaiting activation");
    expect(accessStatusLabel("pending", "staff_activation", 200, 200)).toBe("Expired");
    expect(accessStatusLabel("claimed")).toBe("Active");
    expect(accessStatusLabel("completed", "account_recovery")).toBe("Password updated");
    expect(accessStatusLabel("consuming")).toBe("Completing setup");
    expect(accessStatusLabel("blocked")).toBe("Needs PoseTek review");
    expect(accessPurposeLabel("internal_admin_activation")).toBe("PoseTek admin activation");
  });
});

describe("one-time issuance followed by a fallible refresh", () => {
  it("retains the issued secret before starting the list refresh", async () => {
    const order: string[] = [];
    const outcome = await refreshAfterIssued(issued, { isCurrent: () => true, retain: value => { expect(value).toBe(issued); order.push("retained"); }, refresh: async () => { order.push("refresh"); } });
    expect(order).toEqual(["retained", "refresh"]); expect(outcome).toBe("saved");
  });
  it("keeps the returned secret if refresh fails and reports partial success", async () => {
    const retain = vi.fn();
    const result = await refreshAfterIssued(issued, { isCurrent: () => true, retain, refresh: async () => { throw new Error("offline"); } });
    expect(retain).toHaveBeenCalledExactlyOnceWith(issued); expect(result).toBe("saved-refresh-failed");
  });
  it("does not publish a secret from a previous signed-in identity", async () => {
    const retain = vi.fn(), refresh = vi.fn();
    expect(await refreshAfterIssued(issued, { isCurrent: () => false, retain, refresh })).toBe("stale");
    expect(retain).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  });
  it("does not announce old-identity success after a competing auth change", async () => {
    let current = true;
    const retain = vi.fn();
    const result = await refreshAfterIssued(issued, { isCurrent: () => current, retain, refresh: async () => { current = false; throw new Error("changed identity"); } });
    expect(retain).toHaveBeenCalledOnce(); expect(result).toBe("stale");
  });
});
