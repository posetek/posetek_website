import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ currentUser: null as any }));
vi.mock("../../../lib/firebase", () => ({ default: { auth: () => state }, db: {} }));
import { refreshAdminIdentity } from "./identity";

function user(claims: Record<string, unknown> = { email: "admin@posetek.net", email_verified: true, sub: "admin" }) {
  return { uid: "admin", email: "admin@posetek.net", emailVerified: true,
    reload: vi.fn(async () => {}), getIdTokenResult: vi.fn(async () => ({ claims })) };
}

describe("fresh admin identity", () => {
  beforeEach(() => { state.currentUser = null; });
  it("requires refreshed verified company claims", async () => {
    const account = user(); state.currentUser = account;
    expect((await refreshAdminIdentity(account)).isAdmin).toBe(true);
    expect(account.getIdTokenResult).toHaveBeenCalledWith(true);
  });
  it("does not promote a cached verified flag when refreshed claims are unverified", async () => {
    const account = user({ email: "admin@posetek.net", email_verified: false }); state.currentUser = account;
    expect((await refreshAdminIdentity(account)).isAdmin).toBe(false);
  });
  it("does not combine cached company email with a token missing its email", async () => {
    const account = user({ email_verified: true, sub: "admin" }); state.currentUser = account;
    expect((await refreshAdminIdentity(account)).isAdmin).toBe(false);
  });
  it("fails closed when refresh fails", async () => {
    const account = user(); state.currentUser = account;
    account.reload.mockRejectedValue(new Error("offline"));
    expect((await refreshAdminIdentity(account)).isAdmin).toBe(false);
  });
  it("ignores an identity response after the signed-in account changes", async () => {
    const account = user(); state.currentUser = { uid: "other" };
    expect((await refreshAdminIdentity(account)).isAdmin).toBe(false);
  });
  it("rejects token identity mismatch and non-company email", async () => {
    const account = user({ email: "admin@posetek.net", email_verified: true, sub: "other" }); state.currentUser = account;
    expect((await refreshAdminIdentity(account)).isAdmin).toBe(false);
    const outside = user({ email: "admin@example.test", email_verified: true, sub: "admin" }); state.currentUser = outside;
    expect((await refreshAdminIdentity(outside)).isAdmin).toBe(false);
  });
});
