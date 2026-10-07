import { describe, expect, it } from "vitest";
import type { PlayerRow } from "./accounts";
import { playerSummaryRequest } from "./playerSummary";
const player: PlayerRow = { id: "p", name: "Player", email: "", registered: false, signupCode: null, coachId: null,
  organizationId: "current", teamId: "current-team", raw: { organizationId: "current" } };
describe("individual reporting context", () => {
  it("uses current canonical ownership and preserves only the selected reporting period", () => {
    const request = playerSummaryRequest(player, "?orgId=old&teamId=old-team&search=Ana&page=2&reportStart=2026-09-01&reportEnd=2026-09-30&reportTimezone=UTC&reportTestingWindow=period&reportCursor=old&reportTestingStatus=noRecordedTests&reportSearch=Ana");
    expect(request.scope).toEqual({ kind: "organization", organizationId: "current" });
    expect(Object.fromEntries(new URLSearchParams(request.search))).toEqual({ start: "2026-09-01", end: "2026-09-30", timezone: "UTC", testingWindow: "period" });
  });
  it("recovers periods from validated legacy report returns", () => {
    const request = playerSummaryRequest(player, "?returnTo=" + encodeURIComponent("/admin?view=usage&start=2026-09-01&end=2026-09-30&timezone=UTC&cursor=old"));
    expect(new URLSearchParams(request.search).get("start")).toBe("2026-09-01");
    expect(new URLSearchParams(request.search).has("cursor")).toBe(false);
  });
  it("skips legacy or missing organization assignments instead of silently using stale URL scope", () => {
    expect(playerSummaryRequest({ ...player, raw: {} }, "?orgId=old").scope).toBeNull();
    expect(playerSummaryRequest({ ...player, organizationId: null }, "?orgId=old").scope).toBeNull();
    expect(playerSummaryRequest({ ...player, organizationId: "bad/path" }, "?orgId=old").scope).toBeNull();
  });
  it("supports an unassigned canonical player within their current organization", () => {
    expect(playerSummaryRequest({ ...player, teamId: null }, "").scope).toEqual({ kind: "organization", organizationId: "current" });
  });
  it("does not depend on a team still existing for a single-player summary", () => {
    expect(playerSummaryRequest({ ...player, teamId: "deleted-team" }, "?teamId=deleted-team").scope).toEqual({ kind: "organization", organizationId: "current" });
  });
});
