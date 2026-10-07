import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../../lib/organization-data", () => ({ getClubContext: vi.fn(), subscribeClubContextInvalidation: vi.fn() }));
import AdminHeader from "./AdminHeader";
describe("single admin workspace header", () => {
  it("has one People & organizations destination and an Overview entry to Insights", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts?orgId=club&reportView=usage"]}>
      <AdminHeader ready uid="fixture-admin" email="fixture@posetek.test" onSignOut={() => {}} />
    </MemoryRouter>);
    expect(html).toContain('aria-label="PoseTek people and organizations"');
    expect(html).toMatch(/href="\/insights\?from=organization&amp;view=overview"[^>]*>Overview<\/a>/);
    expect(html).toContain("People &amp; organizations"); expect(html).toContain(">Overview<");
    expect(html).toContain('href="/admin/accounts?orgId=club&amp;reportView=usage"');
    expect(html).not.toContain('Admin organization scope');
  });
  it("returns from a player to the exact workspace origin instead of a stale selected player scope", () => {
    const origin = "/admin/accounts?reportView=testing&reportStart=2026-09-01&search=Ana&page=2&reportCursor=opaque&reportMode=attention";
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/athlete?orgId=club&returnTo=" + encodeURIComponent(origin)]}>
      <AdminHeader ready uid="fixture-admin" onSignOut={() => {}} />
    </MemoryRouter>);
    expect(html).toContain(origin.replaceAll("&", "&amp;"));
  });
});
