import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import AdminHeader from "./AdminHeader";

describe("admin navigation", () => {
  it("includes User issues and keeps Community feed in the account menu", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready email="admin@example.test" onSignOut={() => {}} /></MemoryRouter>);
    for (const path of ["accounts", "organizations", "programs", "analysis", "drills", "ai-incidents", "user-issues"]) expect(html).toContain(`href="/admin/${path}"`);
    expect(html).toContain('href="/admin"');
    expect((html.match(/class="admin-nav-link/g) ?? []).length).toBe(8);
    expect(html).toContain('href="/feed"');
    expect(html).toContain("Community feed");
    expect(html).toContain('href="/admin/access"');
    expect(html).toContain("Account access");
    expect(html).toContain("Technique review");
    expect(html).not.toContain('href="/insights');
    expect(html).not.toContain("admin-nav-short");
  });

  it("does not expose ready-only navigation or account actions while signed out", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready={false} onSignOut={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('href="/admin/analysis"');
    expect(html).not.toContain('aria-label="Admin sections"');
    expect(html).not.toContain('aria-label="Admin account menu"');
    expect(html).not.toContain("Sign out");
  });

  it("carries the canonical organization and team across every admin tab", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts?orgId=club&teamId=team"]}><AdminHeader ready onSignOut={() => {}} /></MemoryRouter>);
    expect(html).toContain('href="/admin?orgId=club&amp;teamId=team"');
    expect(html).toContain('href="/admin/accounts?orgId=club&amp;teamId=team"');
    expect(html).toContain('href="/admin/analysis?orgId=club&amp;teamId=team"');
  });

  it("labels the shared scope switcher and the account menu for assistive technology", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready preview email="admin@posetek.test" onSignOut={() => {}} /></MemoryRouter>);
    expect(html).toContain('aria-label="Current scope: All organizations"');
    expect(html).toContain('aria-label="Admin organization scope"');
    expect(html).toContain('aria-label="Admin team scope"');
    expect(html).toContain('aria-label="Admin account menu"');
  });
});
