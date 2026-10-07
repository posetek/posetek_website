import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import OrganizationHeader from "./OrganizationHeader";

function header(ready = true, route = "/organization") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><OrganizationHeader ready={ready} orgId="club & one" teamId="team/one" onSignOut={() => {}} /></MemoryRouter>);
}
describe("organization header access and scope", () => {
  it("shares the menu structure but only links existing organization capabilities", () => {
    const html = header();
    for (const label of ["Overview", "Coaching hub", "Organization access", "People &amp; teams", "Planner"]) expect(html).toContain(label);
    expect(html).not.toContain('href="/admin');
    for (const label of ["AI incidents", "Device performance", "User issues", "App feedback", "Technique review", "Drill library"]) expect(html).not.toContain(label);
    expect(html).toContain('href="/organization?orgId=club+%26+one&amp;teamId=team%2Fone"');
    expect(html).toContain('href="/programs?orgId=club+%26+one&amp;teamId=team%2Fone"');
    expect(html).toContain('href="/feed?organizationId=club+%26+one&amp;teamId=team%2Fone"');
    expect(html).toContain("from=organization&amp;view=overview");
    expect(html).not.toContain("System &amp; User Insights");
  });
  it("hides workspace links until membership is established", () => {
    const html = header(false);
    expect(html).not.toContain('aria-label="Organization sections"');
    expect(html).not.toContain('href="/programs');
  });
  it("leaves report tabs within Overview instead of duplicating them in the header", () => {
    const html = header(true, "/insights?view=testing");
    for (const view of ["testing", "workouts", "usage"]) expect(html).not.toContain(`view=${view}`);
  });
});
