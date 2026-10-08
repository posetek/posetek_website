import { describe, expect, it } from "vitest";
import { athleteRosterNavigation, organizationPlayerPath } from "./navigation";

describe("organization athlete navigation", () => {
  const player = { id: "player & id", organizationId: "current-club", teamId: "current-team" };

  it.each(["manager", "coach"] as const)("returns a canonical %s to the athlete's current team after opening results", access => {
    const opened = new URL(organizationPlayerPath(player), "https://test.invalid");
    opened.searchParams.set("view", "drills");
    opened.searchParams.set("drill", "shooting");
    expect(opened.searchParams.get("player")).toBe(player.id);
    expect(opened.searchParams.get("orgId")).toBe(player.organizationId);
    expect(opened.searchParams.get("teamId")).toBe(player.teamId);
    expect(athleteRosterNavigation(access, player, opened.search)).toEqual({
      to: "/organization?orgId=current-club&teamId=current-team", label: "Organization",
    });
  });

  it("uses the authorized profile after a move rather than stale URL hints or legacy coach pointers", () => {
    const moved = { ...player, organizationId: "new-club", teamId: "new-team", coachId: "old-manager" };
    const hints = "orgId=old-club&teamId=old-team&coachId=old-manager";
    expect(athleteRosterNavigation("manager", moved, hints).to).toBe("/organization?orgId=new-club&teamId=new-team");
    expect(athleteRosterNavigation("admin", moved, hints).to).toBe("/admin/accounts?orgId=new-club&teamId=new-team");
  });

  it("keeps compatible explicit admin account context", () => {
    expect(organizationPlayerPath(player, true)).toBe("/admin/accounts/player/player%20%26%20id?orgId=current-club&teamId=current-team");
    expect(athleteRosterNavigation("admin", player, "orgId=current-club&coachId=assigned-coach").to)
      .toBe("/admin/accounts/coach/assigned-coach?orgId=current-club&teamId=current-team&coachId=assigned-coach");
  });

  it("returns an unassigned canonical player to its organization", () => {
    const unassigned = { ...player, teamId: "" };
    expect(organizationPlayerPath(unassigned)).toBe("/athlete?player=player%20%26%20id&orgId=current-club");
    expect(athleteRosterNavigation("manager", unassigned).to).toBe("/organization?orgId=current-club");
  });

  it("preserves independent legacy coach roster destinations", () => {
    expect(athleteRosterNavigation("coach", { id: "legacy", teamId: "legacy team" }).to).toBe("/roster?team=legacy%20team");
    expect(athleteRosterNavigation("coach", { id: "legacy" }).to).toBe("/roster?userType=coach");
  });

  it("returns the authorized read-only admin preview to the requested player panel", () => {
    const back = "/admin/accounts/player/current?orgId=current-club&playerTab=workouts";
    expect(athleteRosterNavigation("admin", player, `?returnTo=${encodeURIComponent(back)}`)).toEqual({ to: back, label: "Back to player" });
    expect(athleteRosterNavigation("coach", player, `?returnTo=${encodeURIComponent(back)}`).label).toBe("Organization");
    expect(athleteRosterNavigation("admin", player, "?returnTo=https%3A%2F%2Fevil.test").to).toBe("/admin/accounts?orgId=current-club&teamId=current-team");
  });
});
