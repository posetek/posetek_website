import { describe, expect, it } from "vitest";
import { coachPlannerReturn, coachWorkspacePath } from "./coach-navigation";
describe("one coaching destination", () => {
  it("maps legacy team and athlete links without losing reporting or community state", () => {
    const url = new URL(coachWorkspacePath("?team=A&athlete=P&weeks=4&activity=post&from=dashboard"), "https://posetek.net");
    expect(url.pathname).toBe("/insights");
    expect(Object.fromEntries(url.searchParams)).toEqual({teamId:"A",playerId:"P",view:"player",weeks:"4",activity:"post"});
  });
  it("preserves the exact authorized workspace return selection", () => {
    const path = "/insights?orgId=O&teamId=T&playerId=P&view=player&page=2";
    expect(coachPlannerReturn("?returnTo="+encodeURIComponent(path))).toBe(path);
  });
  it.each(["https://example.test/insights", "//example.test/insights", "/admin", "/insights/../admin", "/insights?returnTo=https://example.test"])("does not create an external planner redirect from %s", value => {
    const result = coachPlannerReturn("?teamId=T&returnTo="+encodeURIComponent(value));
    expect(new URL(result,"https://posetek.net").origin).toBe("https://posetek.net");
    expect(new URL(result,"https://posetek.net").pathname).toBe("/insights");
  });
});
