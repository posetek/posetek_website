import { describe, expect, it } from "vitest";
import { accountDestination, accountError } from "./account-entry";
import type { AccountRole } from "./account-entry";
import { getSafeReturnToUrl } from "./landing-helpers";

const origin = "https://posetek.example";
const base = origin + "/signin";
const route = (role: AccountRole, target = "", player = "canonical-player") => accountDestination(role, player, target ? "?returnTo=" + encodeURIComponent(target) : "", base, origin);

describe("account entry destinations", () => {
  it.each(["/join", "/organization?orgId=club&teamId=team", "/programs?player=athlete&orgId=club", "/insights?orgId=club"]) ("accepts the explicit same-origin destination %s", target => {
    expect(getSafeReturnToUrl("?returnTo=" + encodeURIComponent(target), base, origin)).toBe(origin + target);
  });
  it.each(["https://elsewhere.example/join", "//elsewhere.example/programs", "javascript:alert(1)", "https://person:secret@posetek.example/join", "/signin", "/admin/unknown", "/join/unknown"]) ("rejects unsafe or unsupported return target %s", target => {
    expect(getSafeReturnToUrl("?returnTo=" + encodeURIComponent(target), base, origin)).toBeNull();
  });
  it.each(["admin", "manager", "coach"] as const)("honors staff return intent for %s", role => {
    expect(route(role, "/programs?player=p&orgId=o&teamId=t")).toBe(origin + "/programs?player=p&orgId=o&teamId=t");
    expect(route(role, "/insights?orgId=o")).toBe(origin + "/insights?orgId=o");
    expect(route(role, "/join")).toBe(origin + "/join");
  });
  it("uses current role homes without a return request", () => {
    expect(route("admin")).toBe("/admin");
    expect(route("manager")).toBe("/organization");
    expect(route("coach")).toBe("/organization");
    expect(route("independent")).toBe("/roster?userType=coach");
    expect(route("player")).toBe("/feed?player=canonical-player&userType=player");
    expect(route("pending")).toBe("/join");
  });
  it.each(["/admin", "/admin/access", "/admin/accounts/player/example?workoutSource=personalWorkoutLogs&workoutLog=log-1"])("preserves the admin destination only for administrators: %s", target => {
    expect(route("admin", target)).toBe(origin + target);
    for (const role of ["coach", "manager", "independent", "player", "pending"] as const) expect(route(role, target)).toBe(route(role));
  });
  it("returns players to Training and preserves canonical player parameters", () => {
    expect(route("player", "/programs?player=canonical-player")).toBe(origin + "/programs?player=canonical-player");
    expect(route("player", "/feed.html?activity=123")).toBe(origin + "/feed.html?activity=123");
  });
  it.each(["/organization", "/insights", "/roster", "/coachesview.html"]) ("does not route a player to staff-only surface %s", target => {
    expect(route("player", target)).toBe("/feed?player=canonical-player&userType=player");
  });
  it("does not confuse independent coaches with managed staff", () => {
    expect(route("independent", "/insights")).toBe("/roster?userType=coach");
    expect(route("independent", "/organization")).toBe(origin + "/organization");
    expect(route("independent", "/join")).toBe(origin + "/join");
  });
  it("sends unlinked accounts to activation, not arbitrary authenticated surfaces", () => {
    expect(route("pending", "/programs?player=other")).toBe("/join");
    expect(route("pending", "/insights")).toBe("/join");
    expect(route("pending", "/join")).toBe(origin + "/join");
  });
});

describe("recoverable account errors", () => {
  it("offers sign-in/reset for an existing address", () => {
    expect(accountError({ code: "auth/email-already-in-use" })).toMatch(/Sign in.*reset your password/);
  });
  it("does not echo provider errors containing user input", () => {
    expect(accountError({ code: "auth/invalid-credential", message: "secret@example.com password raw" })).not.toMatch(/secret|raw/);
    expect(accountError(new Error("secret"), "Try again.")).toBe("Try again.");
  });
});
