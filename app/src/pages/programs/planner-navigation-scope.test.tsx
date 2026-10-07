import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { currentPlannerNavigationScope } from "../admin/views/PersonalizedPrograms";
import OrganizationHeader from "../organization/OrganizationHeader";

const clubA = { requestedOrgId: "club-a", orgId: "club-a", teamIds: ["team-a1", "team-a2"] };
const clubB = { requestedOrgId: "club-b", orgId: "club-b", teamIds: ["team-b1"] };

function headerLinks(context: typeof clubA, requestedOrgId: string, teamId: string) {
  const scope = currentPlannerNavigationScope(context, requestedOrgId, teamId, true);
  if (!scope) throw new Error("Expected a verified navigation scope");
  return renderToStaticMarkup(<MemoryRouter><OrganizationHeader ready {...scope} onSignOut={() => {}} /></MemoryRouter>);
}

describe("current staff Planner navigation scope", () => {
  it("updates all manager destinations when the current team changes", () => {
    const first = headerLinks(clubA, "club-a", "team-a1");
    const second = headerLinks(clubA, "club-a", "team-a2");
    expect(first).toContain('href="/programs?orgId=club-a&amp;teamId=team-a1"');
    expect(second).toContain('href="/organization?orgId=club-a&amp;teamId=team-a2"');
    expect(second).toContain('href="/insights?orgId=club-a&amp;teamId=team-a2&amp;from=organization&amp;view=overview"');
    expect(second).toContain('href="/feed?organizationId=club-a&amp;teamId=team-a2"');
    expect(second).not.toContain("team-a1");
  });

  it("clears pending organization navigation and uses only the new verified organization", () => {
    expect(currentPlannerNavigationScope(clubA, "club-b", "", true)).toBeNull();
    const next = headerLinks(clubB, "club-b", "team-b1");
    expect(next).toContain('href="/programs?orgId=club-b&amp;teamId=team-b1"');
    expect(next).toContain('href="/feed?organizationId=club-b&amp;teamId=team-b1"');
    expect(next).not.toContain("club-a");
  });

  it("uses the resolved default organization and omits teams outside its verified roster", () => {
    expect(currentPlannerNavigationScope({ ...clubA, requestedOrgId: "" }, "", "team-a2", true)).toEqual({ orgId: "club-a", teamId: "team-a2" });
    expect(currentPlannerNavigationScope(clubB, "club-b", "team-a2", true)).toEqual({ orgId: "club-b" });
    expect(currentPlannerNavigationScope(clubA, "club-a", "", true)).toEqual({ orgId: "club-a" });
  });

  it("publishes no organization navigation while authorization is absent or revoked", () => {
    expect(currentPlannerNavigationScope(clubA, "club-a", "team-a1", false)).toBeNull();
    expect(currentPlannerNavigationScope(null, "club-a", "team-a1", true)).toBeNull();
    expect(currentPlannerNavigationScope({ requestedOrgId: "", orgId: "", teamIds: [] }, "", "", true)).toBeNull();
  });
});
